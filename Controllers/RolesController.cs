using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using Microsoft.Data.SqlClient;
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

        private async Task<bool> RoleVisibleAsync(Role role, int userId) =>
            _scope.IsSeedAdmin(userId) || role.IsSystemRole ||
            (role.TenantAdminUserId.HasValue && role.TenantAdminUserId ==
                await RoleTenantScope.ResolveAsync(_context, _scope, userId));

        private static bool RoleGrantableBy(Role r, HashSet<string> grantable) =>
            r.RolePermissions.Where(rp => rp.Permission != null)
                .All(rp => grantable.Contains(rp.Permission!.Key));

        private async Task<bool> CanEditRoleAsync(Role r, int userId)
        {
            if (r.IsSystemRole) return false;
            if (_scope.IsSeedAdmin(userId)) return true;
            if (r.TenantAdminUserId == userId) return true;
            if (!await RoleVisibleAsync(r, userId)) return false;
            return r.TenantAdminUserId == userId || r.CreatedByUserId == userId ||
                (r.CreatedByUserId.HasValue && await _scope.CanManageUserAsync(userId, r.CreatedByUserId.Value));
        }

        internal static async Task<HashSet<int>> VisibleRoleIdsAsync(
            AppDbContext db, IManagementScopeService scope, IPermissionService permissions, int userId)
        {
            if (scope.IsSeedAdmin(userId))
                return (await db.Roles.Select(r => r.Id).ToListAsync()).ToHashSet();
            var tenant = await RoleTenantScope.ResolveAsync(db, scope, userId);
            var rows = await db.Roles.Include(r => r.RolePermissions).ThenInclude(rp => rp.Permission)
                .Where(r => r.IsSystemRole || (tenant != null && r.TenantAdminUserId == tenant))
                .ToListAsync();
            var grantable = new HashSet<string>(await permissions.GetUserPermissionsAsync(userId), StringComparer.OrdinalIgnoreCase);
            return rows.Where(r => RoleGrantableBy(r, grantable)).Select(r => r.Id).ToHashSet();
        }

        private Task<bool> NameClashesAsync(string name, int? tenant, int? excludeId = null) =>
            _context.Roles.AnyAsync(r => r.Id != excludeId && r.Name == name &&
                (r.IsSystemRole || r.TenantAdminUserId == tenant));

        private static bool IsNameConflict(DbUpdateException ex) =>
            ex.InnerException is SqlException sql && (sql.Number == 2601 || sql.Number == 2627);

        /// <summary>
        /// The permission keys this caller is allowed to hand out. Seed admin:
        /// the whole catalog. Anyone else: exactly what they hold themselves.
        ///
        /// This is what makes an edition mean something once tenant admins
        /// exist. Role editing accepts any key in the catalog, so without this
        /// an Administrator on the Sales edition could write the accounting
        /// keys into a role and assign it - to their users or to themselves -
        /// and the tier they were sold would be a suggestion. "You may delegate
        /// what you have" is the whole rule; it needs no new permission key and
        /// it cannot be escaped by going up the tree, because an ancestor's
        /// keys are not the caller's.
        /// </summary>
        internal static async Task<HashSet<string>> GrantableKeysAsync(
            IPermissionService permissions, int userId)
        {
            if (permissions.IsSeedAdmin(userId)) return new HashSet<string>(PermissionCatalog.All.Select(p => p.Key), StringComparer.OrdinalIgnoreCase);
            var mine = await permissions.GetUserPermissionsAsync(userId);
            var grantable = new HashSet<string>(mine, StringComparer.OrdinalIgnoreCase);
            if (!permissions.IsSeedAdmin(userId))
                grantable.RemoveWhere(key => key.StartsWith("mcp.", StringComparison.OrdinalIgnoreCase));
            return grantable;
        }

        /// <summary>
        /// Keys in <paramref name="requested"/> the caller may not grant, in a
        /// stable order so the message reads the same twice.
        /// </summary>
        internal static List<string> UngrantableKeys(
            IEnumerable<string>? requested, HashSet<string> grantable) =>
            (requested ?? Enumerable.Empty<string>())
                .Where(k => !string.IsNullOrWhiteSpace(k))
                .Select(k => k.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Where(k => !grantable.Contains(k))
                .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
                .ToList();

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
            var tenant = await RoleTenantScope.ResolveAsync(_context, _scope, me);
            var roleQuery = _context.Roles.AsQueryable();
            if (!_scope.IsSeedAdmin(me))
                roleQuery = roleQuery.Where(r => r.IsSystemRole || (tenant != null && r.TenantAdminUserId == tenant));
            var roles = await roleQuery
                .Include(r => r.RolePermissions).ThenInclude(rp => rp.Permission)
                .Include(r => r.UserRoles)
                .OrderByDescending(r => r.IsSystemRole)
                .ThenBy(r => r.Name)
                .ToListAsync();

            if (!_scope.IsSeedAdmin(me))
            {
                var grantable = new HashSet<string>(await _permissions.GetUserPermissionsAsync(me), StringComparer.OrdinalIgnoreCase);
                roles = roles
                    .Where(r => (r.IsSystemRole || (tenant != null && r.TenantAdminUserId == tenant)) && (r.IsSystemRole || RoleGrantableBy(r, grantable)))
                    .ToList();
            }
            // UserCount counts only users the caller can see, so a shared
            // role never reveals how many accounts exist in other trees.
            var visibleUsers = await _scope.GetVisibleUserIdsAsync(me);

            var editable = new HashSet<int>();
            foreach (var r in roles) if (await CanEditRoleAsync(r, me)) editable.Add(r.Id);
            var dto = roles.Select(r => new RoleDto
            {
                Id = r.Id,
                TenantAdminUserId = r.TenantAdminUserId,
                CanEdit = editable.Contains(r.Id),
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

        [HttpGet("tenants")]
        [HasPermission("rbac.roles.create")]
        public async Task<ActionResult> Tenants()
        {
            if (!_scope.IsSeedAdmin(CurrentUserId() ?? 0)) return Forbid();
            var rows = await _context.Users.AsNoTracking()
                .Select(u => new { u.Id, u.Username, u.FullName, u.CreatedByUserId }).ToListAsync();
            var grants = await _context.UserCompanies.AsNoTracking()
                .Select(uc => new { uc.UserId, Name = uc.Company!.Name }).ToListAsync();
            var roots = rows.Where(u => _scope.IsSeedAdmin(u.Id) || u.CreatedByUserId == null ||
                _scope.IsSeedAdmin(u.CreatedByUserId.Value)).Select(u => new
                {
                    userId = u.Id, u.Username, u.FullName,
                    companies = grants.Where(g => g.UserId == u.Id).Select(g => g.Name).OrderBy(n => n).ToList()
                });
            return Ok(roots);
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
            if (!_scope.IsSeedAdmin(me) && !await RoleVisibleAsync(role, me))
                return NotFound(new { message = "Role not found" });
            var visibleUsers = await _scope.GetVisibleUserIdsAsync(me);

            return Ok(new RoleDto
            {
                Id = role.Id,
                TenantAdminUserId = role.TenantAdminUserId,
                CanEdit = await CanEditRoleAsync(role, CurrentUserId() ?? 0),
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

            var actor = CurrentUserId() ?? 0;
            var ownTenant = await RoleTenantScope.ResolveAsync(_context, _scope, actor);
            if (ownTenant == null) return Forbid();
            if (dto.TenantAdminUserId.HasValue && !_scope.IsSeedAdmin(actor) && dto.TenantAdminUserId != ownTenant)
                return Forbid();
            var tenant = dto.TenantAdminUserId ?? ownTenant.Value;
            if (await RoleTenantScope.ResolveAsync(_context, _scope, tenant) != tenant)
                return BadRequest(new { message = "Select a tenant administrator" });
            var name = dto.Name.Trim();
            if (name.Length > 100 || dto.Description?.Length > 500)
                return BadRequest(new { message = "Role name or description is too long" });
            if (await NameClashesAsync(name, tenant))
                return Conflict(new { message = "A role with this name already exists" });

            // Only permission keys that exist in the catalog are accepted...
            var validPermIds = await ResolvePermissionIdsAsync(dto.PermissionKeys);

            // ...and only keys the caller holds themselves. Without this an
            // Administrator on one edition could write another edition's keys
            // into a new role and assign it, which would make the tier they
            // were sold a suggestion rather than a boundary.
            var grantable = await GrantableKeysAsync(_permissions, CurrentUserId() ?? 0);
            var refused = UngrantableKeys(dto.PermissionKeys, grantable);
            if (refused.Count > 0)
                return BadRequest(new
                {
                    message = "A role cannot grant more than you hold yourself. "
                            + $"You do not have: {string.Join(", ", refused)}"
                });

            var role = new Role
            {
                Name = name,
                Description = string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description.Trim(),
                IsSystemRole = false,
                CreatedAt = DateTime.UtcNow,
                CreatedByUserId = CurrentUserId(),
                TenantAdminUserId = tenant
            };
            foreach (var pid in validPermIds)
                role.RolePermissions.Add(new RolePermission { PermissionId = pid });
            _context.Roles.Add(role);
            try { await _context.SaveChangesAsync(); }
            catch (DbUpdateException ex) when (IsNameConflict(ex))
            { return Conflict(new { message = "A role with this name already exists in this tenant" }); }

            _permissions.InvalidateAll();

            return CreatedAtAction(nameof(Get), new { id = role.Id }, new RoleDto
            {
                Id = role.Id,
                TenantAdminUserId = role.TenantAdminUserId,
                CanEdit = await CanEditRoleAsync(role, CurrentUserId() ?? 0),
                Name = role.Name,
                Description = role.Description,
                IsSystemRole = role.IsSystemRole,
                CreatedAt = role.CreatedAt,
                UserCount = 0,
                PermissionKeys = (dto.PermissionKeys ?? new List<string>()).Where(k => !string.IsNullOrWhiteSpace(k))
                    .Select(k => k.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(k => k).ToList()
            });
        }

        [HttpPost("{id:int}/copy")]
        [HasPermission("rbac.roles.create")]
        public async Task<ActionResult<List<RoleDto>>> Copy(int id, [FromBody] CopyRoleDto dto)
        {
            var actor = CurrentUserId() ?? 0;
            if (!_scope.IsSeedAdmin(actor)) return Forbid();
            var source = await _context.Roles.Include(r => r.RolePermissions)
                .FirstOrDefaultAsync(r => r.Id == id);
            if (source == null) return NotFound(new { message = "Role not found" });
            var targets = (dto.TenantAdminUserIds ?? new List<int>()).Distinct().ToList();
            if (targets.Count == 0 || targets.Count > 100)
                return BadRequest(new { message = "Select between one and 100 tenant administrators" });
            var name = string.IsNullOrWhiteSpace(dto.Name) ? source.Name : dto.Name.Trim();
            if (name.Length > 100) return BadRequest(new { message = "Role name is too long" });
            foreach (var target in targets)
            {
                if (await RoleTenantScope.ResolveAsync(_context, _scope, target) != target)
                    return BadRequest(new { message = "Select a tenant administrator" });
                if (await NameClashesAsync(name, target))
                    return Conflict(new { message = "A role with this name already exists in a selected tenant. Choose another name." });
            }
            var copies = targets.Select(target => new Role
            {
                Name = name, Description = source.Description, CreatedByUserId = actor,
                TenantAdminUserId = target, CreatedAt = DateTime.UtcNow,
                RolePermissions = source.RolePermissions.Select(rp => new RolePermission { PermissionId = rp.PermissionId }).ToList()
            }).ToList();
            _context.Roles.AddRange(copies);
            try { await _context.SaveChangesAsync(); }
            catch (DbUpdateException ex) when (IsNameConflict(ex))
            { return Conflict(new { message = "A role with this name already exists in a selected tenant" }); }
            _permissions.InvalidateAll();
            var permissionIds = source.RolePermissions.Select(rp => rp.PermissionId).ToList();
            var keys = await _context.Permissions.Where(p => permissionIds.Contains(p.Id))
                .Select(p => p.Key).OrderBy(k => k).ToListAsync();
            return Ok(copies.Select(r => new RoleDto { Id = r.Id, Name = r.Name,
                Description = r.Description, TenantAdminUserId = r.TenantAdminUserId, CanEdit = true,
                CreatedAt = r.CreatedAt, PermissionKeys = keys }).ToList());
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
                    if (newName.Length > 100) return BadRequest(new { message = "Role name is too long" });
                    var clash = await NameClashesAsync(newName, role.TenantAdminUserId, id);
                    if (clash) return Conflict(new { message = "A role with this name already exists" });
                    role.Name = newName;
                }
            }

            if (dto.Description?.Length > 500) return BadRequest(new { message = "Description is too long" });
            if (dto.Description != null)
                role.Description = string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description.Trim();

            if (dto.PermissionKeys != null)
            {
                // Same rule as Create: you may only delegate what you hold.
                var grantable = await GrantableKeysAsync(_permissions, CurrentUserId() ?? 0);
                var refused = UngrantableKeys(dto.PermissionKeys, grantable);
                if (refused.Count > 0)
                    return BadRequest(new
                    {
                        message = "A role cannot grant more than you hold yourself. "
                                + $"You do not have: {string.Join(", ", refused)}"
                    });

                var targetIds = await ResolvePermissionIdsAsync(dto.PermissionKeys);
                var currentIds = role.RolePermissions.Select(rp => rp.PermissionId).ToHashSet();

                foreach (var rp in role.RolePermissions.Where(rp => !targetIds.Contains(rp.PermissionId)).ToList())
                    _context.RolePermissions.Remove(rp);

                foreach (var pid in targetIds.Where(pid => !currentIds.Contains(pid)))
                    _context.RolePermissions.Add(new RolePermission { RoleId = role.Id, PermissionId = pid });
            }

            try { await _context.SaveChangesAsync(); }
            catch (DbUpdateException ex) when (IsNameConflict(ex))
            { return Conflict(new { message = "A role with this name already exists in this tenant" }); }
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
