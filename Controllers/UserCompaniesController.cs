using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Maintains the <see cref="UserCompany"/> join — the source of truth
    /// for "which companies can this user reach when
    /// <see cref="Company.IsTenantIsolated"/> is true". The seed admin and
    /// every user with the open companies (IsTenantIsolated=false) bypass
    /// this table; rows here only matter for isolated companies.
    ///
    /// All endpoints are gated by <c>tenantaccess.manage.*</c> permissions
    /// — only the seed admin grants those to a role by default, but the
    /// grant can be propagated via the existing role editor.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/[controller]")]
    public class UserCompaniesController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ICompanyAccessGuard _access;
        private readonly int _seedAdminUserId;

        public UserCompaniesController(AppDbContext context, ICompanyAccessGuard access, IConfiguration configuration)
        {
            _context = context;
            _access = access;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// One row per non-admin user with their assigned companies (every
        /// company in the system is included so the grid can show ticked /
        /// unticked boxes). Seed admin is hidden from the grid because it
        /// always bypasses the guard — assigning rows for it would be
        /// misleading.
        /// </summary>
        [HttpGet]
        [HasPermission("tenantaccess.manage.view")]
        public async Task<ActionResult<List<UserCompanyAssignmentDto>>> GetAll()
        {
            var users = await _context.Users
                .Where(u => u.Id != _seedAdminUserId)
                .OrderBy(u => u.FullName)
                .Select(u => new
                {
                    u.Id, u.Username, u.FullName, u.AvatarPath,
                })
                .ToListAsync();

            var companies = await _context.Companies
                .OrderBy(c => c.Name)
                .Select(c => new { c.Id, c.Name, c.IsTenantIsolated })
                .ToListAsync();

            var assignments = await _context.UserCompanies
                .Select(uc => new { uc.UserId, uc.CompanyId, uc.AssignedAt })
                .ToListAsync();
            var byUser = assignments
                .GroupBy(a => a.UserId)
                .ToDictionary(g => g.Key, g => g.ToDictionary(a => a.CompanyId, a => a.AssignedAt));

            var result = users.Select(u => new UserCompanyAssignmentDto
            {
                UserId = u.Id,
                Username = u.Username,
                FullName = u.FullName,
                AvatarPath = u.AvatarPath,
                Companies = companies.Select(c =>
                {
                    var grants = byUser.TryGetValue(u.Id, out var dict) ? dict : null;
                    var hasGrant = grants != null && grants.ContainsKey(c.Id);
                    return new UserCompanyMemberDto
                    {
                        CompanyId = c.Id,
                        CompanyName = c.Name,
                        IsTenantIsolated = c.IsTenantIsolated,
                        HasExplicitGrant = hasGrant,
                        AssignedAt = hasGrant ? grants![c.Id] : (DateTime?)null,
                    };
                }).ToList(),
            }).ToList();

            return Ok(result);
        }

        /// <summary>One user's row — useful for the user-edit drawer.</summary>
        [HttpGet("user/{userId:int}")]
        [HasPermission("tenantaccess.manage.view")]
        public async Task<ActionResult<UserCompanyAssignmentDto>> GetForUser(int userId)
        {
            if (userId == _seedAdminUserId)
                return BadRequest(new { message = "The seed admin always has access to every company." });

            var user = await _context.Users
                .Where(u => u.Id == userId)
                .Select(u => new { u.Id, u.Username, u.FullName, u.AvatarPath })
                .FirstOrDefaultAsync();
            if (user == null) return NotFound();

            var companies = await _context.Companies
                .OrderBy(c => c.Name)
                .Select(c => new { c.Id, c.Name, c.IsTenantIsolated })
                .ToListAsync();

            var grants = await _context.UserCompanies
                .Where(uc => uc.UserId == userId)
                .ToDictionaryAsync(uc => uc.CompanyId, uc => uc.AssignedAt);

            return Ok(new UserCompanyAssignmentDto
            {
                UserId = user.Id,
                Username = user.Username,
                FullName = user.FullName,
                AvatarPath = user.AvatarPath,
                Companies = companies.Select(c => new UserCompanyMemberDto
                {
                    CompanyId = c.Id,
                    CompanyName = c.Name,
                    IsTenantIsolated = c.IsTenantIsolated,
                    HasExplicitGrant = grants.ContainsKey(c.Id),
                    AssignedAt = grants.TryGetValue(c.Id, out var ts) ? ts : (DateTime?)null,
                }).ToList(),
            });
        }

        /// <summary>
        /// Replace the full set of companies a user has access to. Idempotent.
        /// </summary>
        [HttpPut("user/{userId:int}")]
        [HasPermission("tenantaccess.manage.assign")]
        public async Task<ActionResult<SetUserCompaniesResultDto>> SetForUser(
            int userId, [FromBody] SetUserCompaniesDto dto)
        {
            if (userId == _seedAdminUserId)
                return BadRequest(new { message = "The seed admin always has access to every company; assignments are not stored for it." });

            if (!await _context.Users.AnyAsync(u => u.Id == userId))
                return NotFound(new { message = "User not found." });

            var requested = (dto.CompanyIds ?? new List<int>()).Distinct().ToList();
            if (requested.Count > 0)
            {
                var validIds = await _context.Companies
                    .Where(c => requested.Contains(c.Id))
                    .Select(c => c.Id)
                    .ToListAsync();
                var unknown = requested.Except(validIds).ToList();
                if (unknown.Count > 0)
                    return BadRequest(new { message = $"Unknown company id(s): {string.Join(", ", unknown)}." });
            }

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                var existing = await _context.UserCompanies
                    .Where(uc => uc.UserId == userId)
                    .ToListAsync();
                var existingSet = existing.Select(e => e.CompanyId).ToHashSet();
                var requestedSet = requested.ToHashSet();

                var toAdd = requestedSet.Except(existingSet).ToList();
                var toRemove = existing.Where(e => !requestedSet.Contains(e.CompanyId)).ToList();

                foreach (var cid in toAdd)
                {
                    _context.UserCompanies.Add(new UserCompany
                    {
                        UserId = userId,
                        CompanyId = cid,
                        AssignedAt = DateTime.UtcNow,
                        AssignedByUserId = CurrentUserId == 0 ? (int?)null : CurrentUserId,
                    });
                }
                if (toRemove.Count > 0)
                    _context.UserCompanies.RemoveRange(toRemove);

                await _context.SaveChangesAsync();
                await tx.CommitAsync();

                _access.InvalidateUser(userId);

                return Ok(new SetUserCompaniesResultDto
                {
                    UserId = userId,
                    Added = toAdd.Count,
                    Removed = toRemove.Count,
                    Total = requestedSet.Count,
                });
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }
    }
}
