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
    /// Assigns roles to users. Seed admin's role assignments are locked: no
    /// caller (regardless of permissions) can change them — the seed admin is
    /// the source of truth and must always hold the Administrator role.
    /// </summary>
    [ApiController]
    [Route("api/users/{userId:int}/roles")]
    [Authorize]
    public class UserRolesController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IPermissionService _permissions;
        private readonly int _seedAdminUserId;

        public UserRolesController(AppDbContext context, IPermissionService permissions, IConfiguration configuration)
        {
            _context = context;
            _permissions = permissions;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        private int? CurrentUserId()
        {
            var sub = User.FindFirstValue(JwtRegisteredClaimNames.Sub)
                      ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
            return int.TryParse(sub, out var id) ? id : null;
        }

        [HttpGet]
        [HasPermission("rbac.userroles.view")]
        public async Task<ActionResult<UserRolesDto>> Get(int userId)
        {
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId);
            if (user == null) return NotFound(new { message = "User not found" });

            var roles = await _context.UserRoles
                .Where(ur => ur.UserId == userId)
                .Include(ur => ur.Role)
                .Select(ur => new RoleSummaryDto
                {
                    Id = ur.Role!.Id,
                    Name = ur.Role!.Name,
                    IsSystemRole = ur.Role!.IsSystemRole
                })
                .OrderByDescending(r => r.IsSystemRole)
                .ThenBy(r => r.Name)
                .ToListAsync();

            return Ok(new UserRolesDto
            {
                UserId = user.Id,
                Username = user.Username,
                FullName = user.FullName,
                Roles = roles
            });
        }

        /// <summary>
        /// Replaces the user's role set. Seed admin is locked — any attempt
        /// to change their roles is rejected.
        /// </summary>
        [HttpPut]
        [HasPermission("rbac.userroles.assign")]
        public async Task<ActionResult<UserRolesDto>> Assign(int userId, [FromBody] AssignUserRolesDto dto)
        {
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId);
            if (user == null) return NotFound(new { message = "User not found" });

            if (userId == _seedAdminUserId)
                return BadRequest(new { message = "The primary admin's roles cannot be modified" });

            var targetRoleIds = (dto.RoleIds ?? new List<int>()).Distinct().ToList();
            if (targetRoleIds.Count > 0)
            {
                var found = await _context.Roles.Where(r => targetRoleIds.Contains(r.Id)).Select(r => r.Id).ToListAsync();
                if (found.Count != targetRoleIds.Count)
                    return BadRequest(new { message = "One or more role IDs are invalid" });
            }

            var existing = await _context.UserRoles.Where(ur => ur.UserId == userId).ToListAsync();
            var existingIds = existing.Select(ur => ur.RoleId).ToHashSet();
            var target = targetRoleIds.ToHashSet();

            foreach (var ur in existing.Where(ur => !target.Contains(ur.RoleId)).ToList())
                _context.UserRoles.Remove(ur);

            var assignedBy = CurrentUserId();
            foreach (var rid in target.Where(id => !existingIds.Contains(id)))
                _context.UserRoles.Add(new UserRole
                {
                    UserId = userId,
                    RoleId = rid,
                    AssignedAt = DateTime.UtcNow,
                    AssignedByUserId = assignedBy
                });

            await _context.SaveChangesAsync();
            _permissions.InvalidateUser(userId);

            return await Get(userId);
        }
    }
}
