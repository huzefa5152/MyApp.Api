using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Seed-admin console (2026-09-11). One read endpoint that returns the
    /// management tree: every top-level account (created by the seed admin,
    /// or root-level legacy rows) with the users beneath it, the companies
    /// that belong to that tree and the current tenant-access grants.
    /// Writes reuse the existing endpoints — POST/PUT/DELETE /api/users,
    /// PUT /api/users/{id}/roles, PUT /api/usercompanies/user/{id} — so no
    /// second write path exists for the same data.
    ///
    /// Seed admin only. [HasPermission] is satisfied trivially by the seed
    /// admin; the explicit IsSeedAdmin check is what keeps every other
    /// account out, however many permissions it holds.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/[controller]")]
    public class AdministratorsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IManagementScopeService _scope;
        private readonly int _seedAdminUserId;

        public AdministratorsController(AppDbContext context, IManagementScopeService scope, IConfiguration configuration)
        {
            _context = context;
            _scope = scope;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet]
        [HasPermission("users.manage.view")]
        public async Task<ActionResult<List<AdministratorTreeDto>>> GetTree()
        {
            if (!_scope.IsSeedAdmin(CurrentUserId))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    message = "Only the seed admin can view the administrators console."
                });
            }

            var users = await _context.Users
                .AsNoTracking()
                .Select(u => new { u.Id, u.Username, u.FullName, u.Role, u.AvatarPath, u.CreatedAt, u.CreatedByUserId })
                .ToListAsync();

            var roleNames = await _context.UserRoles
                .AsNoTracking()
                .Select(ur => new { ur.UserId, Name = ur.Role!.Name })
                .ToListAsync();
            var rolesByUser = roleNames
                .GroupBy(r => r.UserId)
                .ToDictionary(g => g.Key, g => g.Select(r => r.Name).OrderBy(n => n).ToList());

            var grants = await _context.UserCompanies
                .AsNoTracking()
                .Select(uc => new { uc.UserId, uc.CompanyId })
                .ToListAsync();
            var grantsByUser = grants
                .GroupBy(g => g.UserId)
                .ToDictionary(g => g.Key, g => g.Select(x => x.CompanyId).OrderBy(x => x).ToList());

            var companies = await _context.Companies
                .AsNoTracking()
                .Select(c => new { c.Id, c.Name, c.IsTenantIsolated, c.CreatedByUserId })
                .ToListAsync();

            var topLevel = users
                .Where(u => u.Id != _seedAdminUserId
                            && (u.CreatedByUserId == null || u.CreatedByUserId == _seedAdminUserId))
                .OrderBy(u => u.FullName)
                .ToList();

            var result = new List<AdministratorTreeDto>();
            foreach (var admin in topLevel)
            {
                var tree = await _scope.GetManageableUserIdsAsync(admin.Id);
                var treeWithSelf = new HashSet<int>(tree) { admin.Id };

                var treeCompanyIds = companies
                    .Where(c => (c.CreatedByUserId.HasValue && treeWithSelf.Contains(c.CreatedByUserId.Value))
                                || grants.Any(g => g.CompanyId == c.Id && treeWithSelf.Contains(g.UserId)))
                    .Select(c => c.Id)
                    .ToHashSet();

                result.Add(new AdministratorTreeDto
                {
                    UserId = admin.Id,
                    Username = admin.Username,
                    FullName = admin.FullName,
                    Role = admin.Role,
                    AvatarPath = admin.AvatarPath,
                    CreatedAt = admin.CreatedAt,
                    IsLegacyRoot = admin.CreatedByUserId == null,
                    Roles = rolesByUser.TryGetValue(admin.Id, out var ar) ? ar : new List<string>(),
                    CompanyIds = grantsByUser.TryGetValue(admin.Id, out var ag) ? ag : new List<int>(),
                    Users = users
                        .Where(u => tree.Contains(u.Id))
                        .OrderBy(u => u.FullName)
                        .Select(u => new AdministratorTreeUserDto
                        {
                            UserId = u.Id,
                            Username = u.Username,
                            FullName = u.FullName,
                            Role = u.Role,
                            AvatarPath = u.AvatarPath,
                            CreatedAt = u.CreatedAt,
                            CreatedByUserId = u.CreatedByUserId,
                            Roles = rolesByUser.TryGetValue(u.Id, out var r) ? r : new List<string>(),
                            CompanyIds = grantsByUser.TryGetValue(u.Id, out var g) ? g : new List<int>(),
                        })
                        .ToList(),
                    Companies = companies
                        .Where(c => treeCompanyIds.Contains(c.Id))
                        .OrderBy(c => c.Name)
                        .Select(c => new AdministratorTreeCompanyDto
                        {
                            CompanyId = c.Id,
                            Name = c.Name,
                            IsTenantIsolated = c.IsTenantIsolated,
                            CreatedByUserId = c.CreatedByUserId,
                        })
                        .ToList(),
                });
            }

            return Ok(result);
        }
    }
}
