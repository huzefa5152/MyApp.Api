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
        private readonly IPermissionService _permissions;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly int _seedAdminUserId;

        public UsersController(AppDbContext context, IPermissionService permissions,
            ICompanyAccessGuard access, IDivisionAccessGuard divisionAccess, IConfiguration configuration)
        {
            _context = context;
            _permissions = permissions;
            _access = access;
            _divisionAccess = divisionAccess;
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

            // ── One-step provisioning (optional) ────────────────────────────
            // Validate EVERYTHING before creating the user so a bad request can
            // never leave an orphaned account. Each sub-grant is gated by its own
            // permission — the endpoint itself only requires users.manage.create,
            // so a plain user-admin can still create accounts, they just can't
            // silently escalate access they don't themselves hold the rights to grant.
            var roleIds = (dto.RoleIds ?? new List<int>()).Distinct().ToList();
            var companyIds = (dto.CompanyIds ?? new List<int>()).Distinct().ToList();
            var divisionGrants = dto.Divisions ?? new List<CreateUserDivisionGrantDto>();

            if (roleIds.Count > 0 && !await _permissions.HasPermissionAsync(CurrentUserId, "rbac.userroles.assign"))
                return Forbid();
            if (companyIds.Count > 0 && !await _permissions.HasPermissionAsync(CurrentUserId, "tenantaccess.manage.assign"))
                return Forbid();
            if (divisionGrants.Count > 0 && !await _permissions.HasPermissionAsync(CurrentUserId, "divisionaccess.manage.assign"))
                return Forbid();

            if (roleIds.Count > 0)
            {
                var foundRoleCount = await _context.Roles.CountAsync(r => roleIds.Contains(r.Id));
                if (foundRoleCount != roleIds.Count)
                    return BadRequest(new { message = "One or more role IDs are invalid" });
            }
            if (companyIds.Count > 0)
            {
                var validCompanyIds = await _context.Companies
                    .Where(c => companyIds.Contains(c.Id)).Select(c => c.Id).ToListAsync();
                var unknownCompanies = companyIds.Except(validCompanyIds).ToList();
                if (unknownCompanies.Count > 0)
                    return BadRequest(new { message = $"Unknown company id(s): {string.Join(", ", unknownCompanies)}." });
            }

            // Division grants: each must target a company we're also granting, its
            // divisions must belong to that company, and the ACTOR must have access
            // to that company (mirrors [AuthorizeCompany] on the division endpoint).
            var companyIdSet = companyIds.ToHashSet();
            var grantByCompany = new Dictionary<int, CreateUserDivisionGrantDto>();
            foreach (var g in divisionGrants)
            {
                if (!companyIdSet.Contains(g.CompanyId))
                    return BadRequest(new { message = $"Division grant references company {g.CompanyId} which is not in the company access list." });
                if (!grantByCompany.TryAdd(g.CompanyId, g))
                    return BadRequest(new { message = $"Duplicate division grant for company {g.CompanyId}." });

                await _access.AssertAccessAsync(CurrentUserId, g.CompanyId); // throws → 403

                var wantDivs = (g.DivisionIds ?? new List<int>()).Distinct().ToList();
                if (g.RestrictToDivisions && wantDivs.Count > 0)
                {
                    var companyDivisionIds = await _context.Divisions
                        .Where(d => d.CompanyId == g.CompanyId).Select(d => d.Id).ToListAsync();
                    var unknownDivs = wantDivs.Except(companyDivisionIds).ToList();
                    if (unknownDivs.Count > 0)
                        return BadRequest(new { message = $"Division id(s) not in company {g.CompanyId}: {string.Join(", ", unknownDivs)}." });
                }
            }

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

            // One transaction so a half-provisioned user is never committed.
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                _context.Users.Add(user);
                await _context.SaveChangesAsync(); // need user.Id for the join rows

                int? assignedBy = CurrentUserId == 0 ? (int?)null : CurrentUserId;

                foreach (var rid in roleIds)
                    _context.UserRoles.Add(new Models.UserRole
                    {
                        UserId = user.Id, RoleId = rid,
                        AssignedAt = DateTime.UtcNow, AssignedByUserId = assignedBy
                    });

                foreach (var cid in companyIds)
                    _context.UserCompanies.Add(new Models.UserCompany
                    {
                        UserId = user.Id, CompanyId = cid,
                        RestrictToDivisions = grantByCompany.TryGetValue(cid, out var g) && g.RestrictToDivisions,
                        AssignedAt = DateTime.UtcNow, AssignedByUserId = assignedBy
                    });

                foreach (var g in divisionGrants.Where(x => x.RestrictToDivisions))
                    foreach (var did in (g.DivisionIds ?? new List<int>()).Distinct())
                        _context.UserDivisions.Add(new Models.UserDivision
                        {
                            UserId = user.Id, DivisionId = did,
                            AssignedAt = DateTime.UtcNow, AssignedByUserId = assignedBy
                        });

                await _context.SaveChangesAsync();
                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            // Brand-new id, but drop any stale cache entries defensively so the
            // grants take effect on the very first request.
            _permissions.InvalidateUser(user.Id);
            _access.InvalidateUser(user.Id);
            _divisionAccess.InvalidateUser(user.Id);

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

            // Attachment.UploadedByUserId is a NoAction FK — detach the uploader
            // audit trail or a user who ever uploaded a file can't be deleted.
            await _context.Attachments
                .Where(a => a.UploadedByUserId == id)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.UploadedByUserId, (int?)null));

            _context.Users.Remove(user);
            await _context.SaveChangesAsync();

            return Ok(new { message = "User deleted" });
        }
    }
}
