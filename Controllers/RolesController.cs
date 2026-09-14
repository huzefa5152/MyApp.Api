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
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class RolesController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IPermissionService _permissions;
        private readonly IManagementScopeService _scope;

        public RolesController(AppDbContext context, IPermissionService permissions, IManagementScopeService scope)
        {
            _context = context;
            _permissions = permissions;
            _scope = scope;
        }

        // ── Role scope (2026-09-11) ──
        // System roles and legacy rows (no creator) are shared with everyone.
        // A custom role is visible along its creator's chain: to the creator,
        // to everyone the creator manages (so it can be assigned to them and
        // they can see what they hold) and to the creator's ancestors. It is
        // editable/deletable only by its creator, an ancestor of the creator,
        // or the seed admin. Two sibling Administrators therefore never see
        // each other's roles.
        private async Task<HashSet<int>> VisibleCreatorIdsAsync(int userId)
        {
            var set = await _scope.GetManageableUserIdsAsync(userId);
            set.Add(userId);
            foreach (var a in await _scope.GetAncestorUserIdsAsync(userId)) set.Add(a);
            return set;
        }

        private static bool RoleVisibleTo(Role r, HashSet<int> creators) =>
            r.IsSystemRole || r.CreatedByUserId == null || creators.Contains(r.CreatedByUserId.Value);

        private async Task<bool> CanEditRoleAsync(Role r, int userId)
        {
            if (_scope.IsSeedAdmin(userId)) return true;
            if (r.CreatedByUserId == null) return false;
            if (r.CreatedByUserId == userId) return true;
            return await _scope.CanManageUserAsync(userId, r.CreatedByUserId.Value);
        }

        /// <summary>Ids of the roles the caller may see or assign (seed: all).</summary>
        internal static async Task<HashSet<int>> VisibleRoleIdsAsync(AppDbContext db, IManagementScopeService scope, int userId)
        {
            if (scope.IsSeedAdmin(userId))
                return (await db.Roles.Select(r => r.Id).ToListAsync()).ToHashSet();
            var creators = await scope.GetManageableUserIdsAsync(userId);
            creators.Add(userId);
            foreach (var a in await scope.GetAncestorUserIdsAsync(userId)) creators.Add(a);
            var rows = await db.Roles
                .Where(r => r.IsSystemRole || r.CreatedByUserId == null || creators.Contains(r.CreatedByUserId.Value))
                .Select(r => r.Id)
                .ToListAsync();
            return rows.ToHashSet();
        }

        private int? CurrentUserId()
        {
            var sub = User.FindFirstValue(JwtRegisteredClaimNames.Sub)
                      ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
            return int.TryParse(sub, out var id) ? id : null;
        }

        [HttpGet]
        [HasPermission("rbac.roles.view")]
        public async Task<ActionResult<List<RoleDto>>> GetAll()
        {
            var me = CurrentUserId() ?? 0;
            var roles = await _context.Roles
                .Include(r => r.RolePermissions).ThenInclude(rp => rp.Permission)
                .Include(r => r.UserRoles)
                .OrderByDescending(r => r.IsSystemRole)
                .ThenBy(r => r.Name)
                .ToListAsync();

            if (!_scope.IsSeedAdmin(me))
            {
                var creators = await VisibleCreatorIdsAsync(me);
                roles = roles.Where(r => RoleVisibleTo(r, creators)).ToList();
            }
            // UserCount counts only users the caller can see, so a shared
            // role never reveals how many accounts exist in other trees.
            var visibleUsers = await _scope.GetVisibleUserIdsAsync(me);

            var dto = roles.Select(r => new RoleDto
            {
                Id = r.Id,
                Name = r.Name,
                Description = r.Description,
                IsSystemRole = r.IsSystemRole,
                CreatedAt = r.CreatedAt,
                UserCount = r.UserRoles.Count(ur => visibleUsers.Contains(ur.UserId)),
                PermissionKeys = r.RolePermissions
                    .Where(rp => rp.Permission != null)
                    .Select(rp => rp.Permission!.Key)
                    .OrderBy(k => k)
                    .ToList()
            }).ToList();

            return Ok(dto);
        }

        [HttpGet("{id}")]
        [HasPermission("rbac.roles.view")]
        public async Task<ActionResult<RoleDto>> Get(int id)
        {
            var me = CurrentUserId() ?? 0;
            var role = await _context.Roles
                .Include(r => r.RolePermissions).ThenInclude(rp => rp.Permission)
                .Include(r => r.UserRoles)
                .FirstOrDefaultAsync(r => r.Id == id);
            if (role == null) return NotFound(new { message = "Role not found" });
            if (!_scope.IsSeedAdmin(me) && !RoleVisibleTo(role, await VisibleCreatorIdsAsync(me)))
                return NotFound(new { message = "Role not found" });
            var visibleUsers = await _scope.GetVisibleUserIdsAsync(me);

            return Ok(new RoleDto
            {
                Id = role.Id,
                Name = role.Name,
                Description = role.Description,
                IsSystemRole = role.IsSystemRole,
                CreatedAt = role.CreatedAt,
                UserCount = role.UserRoles.Count(ur => visibleUsers.Contains(ur.UserId)),
                PermissionKeys = role.RolePermissions
                    .Where(rp => rp.Permission != null)
                    .Select(rp => rp.Permission!.Key)
                    .OrderBy(k => k)
                    .ToList()
            });
        }

        [HttpPost]
        [HasPermission("rbac.roles.create")]
        public async Task<ActionResult<RoleDto>> Create([FromBody] CreateRoleDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.Name))
                return BadRequest(new { message = "Role name is required" });

            var name = dto.Name.Trim();
            if (await _context.Roles.AnyAsync(r => r.Name == name))
                return Conflict(new { message = "A role with this name already exists" });

            // Only permission keys that exist in the catalog are accepted.
            var validPermIds = await ResolvePermissionIdsAsync(dto.PermissionKeys);

            var role = new Role
            {
                Name = name,
                Description = string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description.Trim(),
                IsSystemRole = false,
                CreatedAt = DateTime.UtcNow,
                CreatedByUserId = CurrentUserId()
            };
            _context.Roles.Add(role);
            await _context.SaveChangesAsync();

            foreach (var pid in validPermIds)
                _context.RolePermissions.Add(new RolePermission { RoleId = role.Id, PermissionId = pid });
            if (validPermIds.Count > 0) await _context.SaveChangesAsync();

            _permissions.InvalidateAll();

            return CreatedAtAction(nameof(Get), new { id = role.Id }, new RoleDto
            {
                Id = role.Id,
                Name = role.Name,
                Description = role.Description,
                IsSystemRole = role.IsSystemRole,
                CreatedAt = role.CreatedAt,
                UserCount = 0,
                PermissionKeys = dto.PermissionKeys.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(k => k).ToList()
            });
        }

        [HttpPut("{id}")]
        [HasPermission("rbac.roles.update")]
        public async Task<ActionResult<RoleDto>> Update(int id, [FromBody] UpdateRoleDto dto)
        {
            var role = await _context.Roles
                .Include(r => r.RolePermissions)
                .FirstOrDefaultAsync(r => r.Id == id);
            if (role == null) return NotFound(new { message = "Role not found" });

            // System roles (Administrator) are immutable.
            if (role.IsSystemRole)
                return BadRequest(new { message = "System roles cannot be edited" });

            // Role scope: only the creator's chain (or the seed admin) edits it.
            if (!await CanEditRoleAsync(role, CurrentUserId() ?? 0))
                return NotFound(new { message = "Role not found" });

            if (!string.IsNullOrWhiteSpace(dto.Name))
            {
                var newName = dto.Name.Trim();
                if (!string.Equals(newName, role.Name, StringComparison.Ordinal))
                {
                    var clash = await _context.Roles.AnyAsync(r => r.Name == newName && r.Id != id);
                    if (clash) return Conflict(new { message = "A role with this name already exists" });
                    role.Name = newName;
                }
            }

            if (dto.Description != null)
                role.Description = string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description.Trim();

            if (dto.PermissionKeys != null)
            {
                var targetIds = await ResolvePermissionIdsAsync(dto.PermissionKeys);
                var currentIds = role.RolePermissions.Select(rp => rp.PermissionId).ToHashSet();

                foreach (var rp in role.RolePermissions.Where(rp => !targetIds.Contains(rp.PermissionId)).ToList())
                    _context.RolePermissions.Remove(rp);

                foreach (var pid in targetIds.Where(pid => !currentIds.Contains(pid)))
                    _context.RolePermissions.Add(new RolePermission { RoleId = role.Id, PermissionId = pid });
            }

            await _context.SaveChangesAsync();
            _permissions.InvalidateAll();

            return await Get(id);
        }

        [HttpDelete("{id}")]
        [HasPermission("rbac.roles.delete")]
        public async Task<ActionResult> Delete(int id)
        {
            var role = await _context.Roles
                .Include(r => r.UserRoles)
                .FirstOrDefaultAsync(r => r.Id == id);
            if (role == null) return NotFound(new { message = "Role not found" });

            if (role.IsSystemRole)
                return BadRequest(new { message = "System roles cannot be deleted" });

            if (!await CanEditRoleAsync(role, CurrentUserId() ?? 0))
                return NotFound(new { message = "Role not found" });

            if (role.UserRoles.Count > 0)
                return BadRequest(new
                {
                    message = $"Cannot delete this role — it is currently assigned to {role.UserRoles.Count} user(s). Remove the assignments first."
                });

            _context.Roles.Remove(role);
            await _context.SaveChangesAsync();
            _permissions.InvalidateAll();

            return Ok(new { message = "Role deleted" });
        }

        private async Task<HashSet<int>> ResolvePermissionIdsAsync(IEnumerable<string>? keys)
        {
            if (keys == null) return new HashSet<int>();
            var distinct = keys
                .Where(k => !string.IsNullOrWhiteSpace(k))
                .Select(k => k.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (distinct.Count == 0) return new HashSet<int>();

            var ids = await _context.Permissions
                .Where(p => distinct.Contains(p.Key))
                .Select(p => p.Id)
                .ToListAsync();
            return ids.ToHashSet();
        }
    }
}
