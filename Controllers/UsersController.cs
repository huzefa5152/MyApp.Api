using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Controllers;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class UsersController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly int _seedAdminUserId;

        public UsersController(AppDbContext context, IConfiguration configuration)
        {
            _context = context;
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
            var users = await _context.Users
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
                CreatedAt = DateTime.UtcNow
            };

            _context.Users.Add(user);
            await _context.SaveChangesAsync();

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

            // Prevent self-deletion
            var currentUsername = User.FindFirstValue(ClaimTypes.Name);
            var user = await _context.Users.FindAsync(id);
            if (user == null) return NotFound(new { message = "User not found" });

            if (user.Username == currentUsername)
                return BadRequest(new { message = "You cannot delete your own account" });

            _context.Users.Remove(user);
            await _context.SaveChangesAsync();

            return Ok(new { message = "User deleted" });
        }
    }
}
