using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Controllers;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class UsersController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IManagementScopeService _scope;
        private readonly ILogger<UsersController> _logger;
        private readonly int _seedAdminUserId;

        public UsersController(
            AppDbContext context,
            IConfiguration configuration,
            IManagementScopeService scope,
            ILogger<UsersController> logger)
        {
            _context = context;
            _scope = scope;
            _logger = logger;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // GET /api/users
        [HttpGet]
        [HasPermission("users.manage.view")]
        public async Task<ActionResult> GetUsers()
        {
            // Management scope (2026-09-11): an Administrator sees itself
            // and the accounts beneath it in the CreatedBy chain — never
            // the seed admin, never a sibling Administrator's tree. The
            // seed admin sees everyone. Same response shape as before.
            var visible = await _scope.GetVisibleUserIdsAsync(CurrentUserId);
            var users = await _context.Users
                .Where(u => visible.Contains(u.Id))
                .OrderByDescending(u => u.CreatedAt)
                .Select(u => new
                {
                    u.Id,
                    u.Username,
                    u.FullName,
                    u.Role,
                    u.AvatarPath,
                    u.CreatedAt
                })
                .ToListAsync();

            return Ok(users);
        }

        // GET /api/users/{id}
        [HttpGet("{id}")]
        [HasPermission("users.manage.view")]
        public async Task<ActionResult> GetUser(int id)
        {
            // Out-of-scope ids answer 404, not 403, so an Administrator
            // cannot probe which ids exist in another tree.
            if (id != CurrentUserId && !await _scope.CanManageUserAsync(CurrentUserId, id))
                return NotFound(new { message = "User not found" });

            var user = await _context.Users
                .Where(u => u.Id == id)
                .Select(u => new
                {
                    u.Id,
                    u.Username,
                    u.FullName,
                    u.Role,
                    u.AvatarPath,
                    u.CreatedAt
                })
                .FirstOrDefaultAsync();

            if (user == null) return NotFound(new { message = "User not found" });
            return Ok(user);
        }

        // POST /api/users
        [HttpPost]
        [HasPermission("users.manage.create")]
        public async Task<ActionResult> CreateUser([FromBody] CreateUserDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.Username) || string.IsNullOrWhiteSpace(dto.Password))
                return BadRequest(new { message = "Username and password are required" });

            // Audit H-12 (2026-05-13): shared password policy.
            var policyError = AuthController.ValidatePasswordPolicy(dto.Password);
            if (policyError != null) return BadRequest(new { message = policyError });

            if (string.IsNullOrWhiteSpace(dto.FullName))
                return BadRequest(new { message = "Full name is required" });

            // Audit C-15 (2026-05-13): the legacy free-text Role column is
            // still consumed by some JWT-claim consumers. Restrict the
            // privileged value "Admin" to the seed admin only — anyone
            // else picking it from the dropdown becomes a regular user.
            var desiredRole = string.IsNullOrWhiteSpace(dto.Role) ? "User" : dto.Role.Trim();
            if (string.Equals(desiredRole, "Admin", StringComparison.OrdinalIgnoreCase)
                && CurrentUserId != _seedAdminUserId)
            {
                return Forbid();
            }

            var exists = await _context.Users.AnyAsync(u => u.Username == dto.Username);
            if (exists)
                return Conflict(new { message = "Username already exists" });

            // Permissions are driven by the RBAC role-assignment system, but
            // the legacy "Role" text column is still surfaced as the pill on
            // the user card and used by some JWT-claim consumers. Honor what
            // the operator picked in the dropdown instead of hard-coding it
            // — otherwise the card always reads "User" regardless of the
            // role the operator chose at create time.
            var user = new Models.User
            {
                Username = dto.Username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password),
                FullName = dto.FullName,
                Role = desiredRole,
                CreatedAt = DateTime.UtcNow,
                // Ownership: the creator manages this account from now on
                // (and so does everyone above the creator). Seed-created
                // accounts are the top-level Administrators.
                CreatedByUserId = CurrentUserId == 0 ? (int?)null : CurrentUserId
            };

            _context.Users.Add(user);
            await _context.SaveChangesAsync();
            _scope.InvalidateAll();

            return CreatedAtAction(nameof(GetUser), new { id = user.Id }, new
            {
                user.Id,
                user.Username,
                user.FullName,
                user.Role,
                user.CreatedAt
            });
        }

        // PUT /api/users/{id}
        [HttpPut("{id}")]
        [HasPermission("users.manage.update")]
        public async Task<ActionResult> UpdateUser(int id, [FromBody] UpdateUserDto dto)
        {
            if (id == _seedAdminUserId)
                return BadRequest(new { message = "The primary admin account cannot be modified" });

            // Management scope: the seed admin, an ancestor in the CreatedBy
            // chain, or the account itself (the Users page offers Edit on
            // the caller's own card, as it always has). Roles are NOT set
            // here — UserRolesController refuses self-assignment — and the
            // privileged legacy "Admin" text stays seed-only below.
            if (id != CurrentUserId && !await _scope.CanManageUserAsync(CurrentUserId, id))
                return NotFound(new { message = "User not found" });

            var user = await _context.Users.FindAsync(id);
            if (user == null) return NotFound(new { message = "User not found" });

            if (!string.IsNullOrWhiteSpace(dto.Username) && dto.Username != user.Username)
            {
                var exists = await _context.Users.AnyAsync(u => u.Username == dto.Username && u.Id != id);
                if (exists) return Conflict(new { message = "Username already exists" });
                user.Username = dto.Username;
            }

            if (!string.IsNullOrWhiteSpace(dto.FullName))
                user.FullName = dto.FullName;

            // Persist the Role text so the user card's pill reflects the
            // operator's pick. Permissions still come from the RBAC role-
            // assignment system (UserRoles join table) — the frontend's
            // Edit modal calls assignUserRoles() right after this PUT to
            // keep the two in sync. Without this assignment the pill would
            // forever show whatever role the user was created with.
            // Audit C-15: the privileged value "Admin" stays seed-admin
            // only — same gate as Create.
            if (!string.IsNullOrWhiteSpace(dto.Role))
            {
                var desiredRole = dto.Role.Trim();
                if (string.Equals(desiredRole, "Admin", StringComparison.OrdinalIgnoreCase)
                    && CurrentUserId != _seedAdminUserId)
                {
                    return Forbid();
                }
                user.Role = desiredRole;
            }

            if (!string.IsNullOrWhiteSpace(dto.Password))
            {
                // Audit H-12 (2026-05-13).
                var policyError = AuthController.ValidatePasswordPolicy(dto.Password);
                if (policyError != null) return BadRequest(new { message = policyError });
                user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password);
                // Bump the security stamp so the affected user's existing
                // JWTs stop authenticating (audit C-6).
                user.SecurityStamp = Guid.NewGuid().ToString("N");
            }

            await _context.SaveChangesAsync();

            return Ok(new
            {
                user.Id,
                user.Username,
                user.FullName,
                user.Role,
                user.CreatedAt
            });
        }

        // DELETE /api/users/{id}
        [HttpDelete("{id}")]
        [HasPermission("users.manage.delete")]
        public async Task<ActionResult> DeleteUser(int id)
        {
            if (id == _seedAdminUserId)
                return BadRequest(new { message = "The primary admin account cannot be deleted" });

            if (!await _scope.CanManageUserAsync(CurrentUserId, id))
                return NotFound(new { message = "User not found" });

            // Prevent self-deletion
            var currentUsername = User.FindFirstValue(ClaimTypes.Name);
            var user = await _context.Users.FindAsync(id);
            if (user == null) return NotFound(new { message = "User not found" });

            if (user.Username == currentUsername)
                return BadRequest(new { message = "You cannot delete your own account" });

            // Re-parent whatever this account created to its own parent so
            // ownership stays honest: an Administrator's users and
            // companies move up to whoever managed that Administrator
            // (the seed admin, for a top-level one). Without this the
            // NoAction FKs would reject the delete outright.
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                var newParent = user.CreatedByUserId;
                var childUsers = await _context.Users.Where(u => u.CreatedByUserId == id).ToListAsync();
                foreach (var c in childUsers) c.CreatedByUserId = newParent;
                var childCompanies = await _context.Companies.Where(c => c.CreatedByUserId == id).ToListAsync();
                foreach (var c in childCompanies) c.CreatedByUserId = newParent;
                if (childUsers.Count > 0 || childCompanies.Count > 0)
                    await _context.SaveChangesAsync();

                _context.Users.Remove(user);
                await _context.SaveChangesAsync();
                await tx.CommitAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "DeleteUser transaction failed for userId={UserId}", id);
                await tx.RollbackAsync();
                throw;
            }
            _scope.InvalidateAll();

            return Ok(new { message = "User deleted" });
        }
    }
}
