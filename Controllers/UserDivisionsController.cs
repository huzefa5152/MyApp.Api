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
    /// Maintains division-level access: the <see cref="UserCompany.RestrictToDivisions"/>
    /// flag plus the <see cref="UserDivision"/> grants it activates. Mirror of
    /// <see cref="UserCompaniesController"/>, but company-scoped — divisions
    /// only mean something inside one company, so every route carries a
    /// companyId and is tenant-guarded.
    ///
    /// Gated by <c>divisionaccess.manage.*</c>; the RbacSeeder syncs those to
    /// the Administrator role automatically.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/[controller]")]
    public class UserDivisionsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly int _seedAdminUserId;
        private readonly ILogger<UserDivisionsController> _logger;

        public UserDivisionsController(AppDbContext context, IDivisionAccessGuard divisionAccess,
            IConfiguration configuration, ILogger<UserDivisionsController> logger)
        {
            _context = context;
            _divisionAccess = divisionAccess;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// One row per user who can reach this company (has a UserCompany
        /// grant), with the restriction flag and per-division tick state.
        /// Seed admin is hidden — it bypasses every guard.
        /// </summary>
        [HttpGet("company/{companyId:int}")]
        [HasPermission("divisionaccess.manage.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<UserDivisionAssignmentDto>>> GetForCompany(int companyId)
        {
            var members = await _context.UserCompanies
                .Where(uc => uc.CompanyId == companyId && uc.UserId != _seedAdminUserId)
                .Select(uc => new
                {
                    uc.UserId,
                    uc.RestrictToDivisions,
                    uc.User!.Username,
                    uc.User.FullName,
                    uc.User.AvatarPath,
                })
                .OrderBy(u => u.FullName)
                .ToListAsync();

            var divisions = await _context.Divisions
                .Where(d => d.CompanyId == companyId)
                .OrderBy(d => d.Name)
                .Select(d => new { d.Id, d.Name })
                .ToListAsync();

            var divisionIds = divisions.Select(d => d.Id).ToList();
            var grants = await _context.UserDivisions
                .Where(ud => divisionIds.Contains(ud.DivisionId))
                .Select(ud => new { ud.UserId, ud.DivisionId, ud.AssignedAt })
                .ToListAsync();
            var byUser = grants
                .GroupBy(g => g.UserId)
                .ToDictionary(g => g.Key, g => g.ToDictionary(x => x.DivisionId, x => x.AssignedAt));

            var result = members.Select(m => new UserDivisionAssignmentDto
            {
                UserId = m.UserId,
                Username = m.Username,
                FullName = m.FullName,
                AvatarPath = m.AvatarPath,
                RestrictToDivisions = m.RestrictToDivisions,
                Divisions = divisions.Select(d =>
                {
                    var userGrants = byUser.TryGetValue(m.UserId, out var dict) ? dict : null;
                    var has = userGrants != null && userGrants.ContainsKey(d.Id);
                    return new UserDivisionMemberDto
                    {
                        DivisionId = d.Id,
                        DivisionName = d.Name,
                        HasExplicitGrant = has,
                        AssignedAt = has ? userGrants![d.Id] : (DateTime?)null,
                    };
                }).ToList(),
            }).ToList();

            return Ok(result);
        }

        /// <summary>
        /// Replace one user's division set + restriction flag for one company.
        /// Idempotent. Only this company's divisions are touched — grants the
        /// user holds in other companies are left alone.
        /// </summary>
        [HttpPut("user/{userId:int}/company/{companyId:int}")]
        [HasPermission("divisionaccess.manage.assign")]
        [AuthorizeCompany]
        public async Task<ActionResult<SetUserDivisionsResultDto>> SetForUser(
            int userId, int companyId, [FromBody] SetUserDivisionsDto dto)
        {
            if (userId == _seedAdminUserId)
                return BadRequest(new { message = "The seed admin always has access to every division; assignments are not stored for it." });

            var membership = await _context.UserCompanies
                .FirstOrDefaultAsync(uc => uc.UserId == userId && uc.CompanyId == companyId);
            if (membership == null)
                return BadRequest(new { message = "The user has no access to this company — grant company access first (Tenant Access)." });

            var requested = (dto.DivisionIds ?? new List<int>()).Distinct().ToList();
            var companyDivisionIds = await _context.Divisions
                .Where(d => d.CompanyId == companyId)
                .Select(d => d.Id)
                .ToListAsync();
            var unknown = requested.Except(companyDivisionIds).ToList();
            if (unknown.Count > 0)
                return BadRequest(new { message = $"Division id(s) not in this company: {string.Join(", ", unknown)}." });

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                membership.RestrictToDivisions = dto.RestrictToDivisions;

                // Replace-all, scoped to THIS company's divisions.
                var existing = await _context.UserDivisions
                    .Where(ud => ud.UserId == userId && companyDivisionIds.Contains(ud.DivisionId))
                    .ToListAsync();
                var existingSet = existing.Select(e => e.DivisionId).ToHashSet();
                var requestedSet = requested.ToHashSet();

                var toAdd = requestedSet.Except(existingSet).ToList();
                var toRemove = existing.Where(e => !requestedSet.Contains(e.DivisionId)).ToList();

                foreach (var did in toAdd)
                {
                    _context.UserDivisions.Add(new UserDivision
                    {
                        UserId = userId,
                        DivisionId = did,
                        AssignedAt = DateTime.UtcNow,
                        AssignedByUserId = CurrentUserId == 0 ? (int?)null : CurrentUserId,
                    });
                }
                if (toRemove.Count > 0)
                    _context.UserDivisions.RemoveRange(toRemove);

                await _context.SaveChangesAsync();
                await tx.CommitAsync();

                _divisionAccess.InvalidateUser(userId);

                return Ok(new SetUserDivisionsResultDto
                {
                    UserId = userId,
                    CompanyId = companyId,
                    RestrictToDivisions = dto.RestrictToDivisions,
                    Added = toAdd.Count,
                    Removed = toRemove.Count,
                    Total = requestedSet.Count,
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SetUserDivisions transaction failed for userId={UserId} companyId={CompanyId}", userId, companyId);
                await tx.RollbackAsync();
                throw;
            }
        }
    }
}
