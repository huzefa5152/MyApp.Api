using Microsoft.EntityFrameworkCore;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Syncs the code-defined <see cref="PermissionCatalog"/> into the database
    /// and ensures the built-in "Administrator" system role (all permissions)
    /// exists and is assigned to the seed-admin user.
    ///
    /// Runs on every app start. Idempotent — safe to re-run.
    /// </summary>
    public static class RbacSeeder
    {
        public const string AdministratorRoleName = "Administrator";

        public const string BootstrapMarker = "RBAC_BOOTSTRAP_V1_ADMIN_AUTO_ASSIGN";

        public static async Task SeedAsync(AppDbContext db, int seedAdminUserId)
        {
            await UpsertPermissionsAsync(db);
            await EnsureAdministratorRoleAsync(db, seedAdminUserId);
            await EnsureEditionRolesAsync(db, seedAdminUserId);
            await BootstrapExistingAdminUsersAsync(db);
        }

        /// <summary>
        /// Runs once per database: assigns the Administrator role to every
        /// pre-existing user whose legacy <c>User.Role</c> column is "Admin"
        /// and who has no <c>UserRole</c> rows yet. This preserves behaviour
        /// for admins who existed before RBAC was introduced — without this
        /// they'd lose access the moment the new [HasPermission] gates go
        /// live. Gated by an AuditLog marker so subsequent starts don't re-
        /// assign roles that an operator has since removed.
        /// </summary>
        private static async Task BootstrapExistingAdminUsersAsync(AppDbContext db)
        {
            // Audit M-3 (2026-05-13): the original gate was the AuditLogs
            // marker alone. If an operator ever truncated AuditLogs the
            // bootstrap re-ran and silently re-granted Administrator to
            // every User.Role='Admin' row — including ones that had been
            // explicitly demoted. Belt + suspenders: check the marker
            // AND make sure there are no UserRoles assigned yet. If any
            // UserRole exists, the bootstrap clearly already happened
            // (either via marker or operator manual setup), so skip.
            var alreadyRan = await db.AuditLogs
                .AnyAsync(a => a.ExceptionType == BootstrapMarker);
            if (alreadyRan) return;

            var anyUserRoles = await db.UserRoles.AnyAsync();
            if (anyUserRoles)
            {
                // Bootstrap clearly ran (or operator manually wired RBAC).
                // Write the marker so we don't keep re-checking on every
                // startup.
                db.AuditLogs.Add(new AuditLog
                {
                    Timestamp = DateTime.UtcNow,
                    Level = "Info",
                    UserName = "system",
                    HttpMethod = "SEED",
                    RequestPath = "/rbac/bootstrap",
                    StatusCode = 200,
                    ExceptionType = BootstrapMarker,
                    Message = "RBAC bootstrap skipped — UserRoles already populated (marker recreated for future starts)."
                });
                await db.SaveChangesAsync();
                return;
            }

            var adminRole = await db.Roles.FirstOrDefaultAsync(r => r.Name == AdministratorRoleName);
            if (adminRole == null) return; // EnsureAdministratorRoleAsync should have just created it

            // Candidates: User.Role='Admin' AND no UserRole rows at all
            var candidateIds = await db.Users
                .Where(u => u.Role == "Admin" && !db.UserRoles.Any(ur => ur.UserId == u.Id))
                .Select(u => u.Id)
                .ToListAsync();

            var count = 0;
            foreach (var uid in candidateIds)
            {
                db.UserRoles.Add(new UserRole
                {
                    UserId = uid,
                    RoleId = adminRole.Id,
                    AssignedAt = DateTime.UtcNow,
                    AssignedByUserId = null // system assignment
                });
                count++;
            }

            db.AuditLogs.Add(new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = "Info",
                UserName = "system",
                HttpMethod = "SEED",
                RequestPath = "/rbac/bootstrap",
                StatusCode = 200,
                ExceptionType = BootstrapMarker,
                Message = $"RBAC bootstrap complete — auto-assigned Administrator role to {count} pre-existing user(s)."
            });

            await db.SaveChangesAsync();
        }

        /// <summary>
        /// Keeps the two product editions (<see cref="EditionCatalog"/>) in the
        /// Roles table as system roles, with their permission sets synced to the
        /// catalog on every start.
        ///
        /// They are SYSTEM roles on purpose. A tenant is put on an edition by
        /// being assigned one role, and <c>RolesController</c> refuses update and
        /// delete on a system role — so the tier stays what the catalog says it
        /// is. An operator who wants a variation clones it into a role of their
        /// own; the edition itself does not drift, which is the whole point of
        /// being able to say "this tenant is on Sales".
        ///
        /// Sync is one-directional and total: whatever the code says, the role
        /// holds. A key added to the catalog therefore reaches the editions that
        /// should have it without anyone remembering to go and tick it.
        /// </summary>
        private static async Task EnsureEditionRolesAsync(AppDbContext db, int seedAdminUserId)
        {
            var permissionIdByKey = await db.Permissions
                .ToDictionaryAsync(p => p.Key, p => p.Id, StringComparer.OrdinalIgnoreCase);

            foreach (var (name, description, keys) in EditionCatalog.All)
            {
                var role = await db.Roles
                    .Include(r => r.RolePermissions)
                    .FirstOrDefaultAsync(r => r.Name == name);

                if (role == null)
                {
                    role = new Role
                    {
                        Name = name,
                        Description = description,
                        IsSystemRole = true,
                        CreatedAt = DateTime.UtcNow,
                        CreatedByUserId = seedAdminUserId
                    };
                    db.Roles.Add(role);
                    await db.SaveChangesAsync();
                }
                else
                {
                    var changed = false;
                    // An edition that somehow lost its system flag would become
                    // editable, and then it is no longer an edition.
                    if (!role.IsSystemRole) { role.IsSystemRole = true; changed = true; }
                    if (role.Description != description) { role.Description = description; changed = true; }
                    if (changed) await db.SaveChangesAsync();
                }

                // Keys the catalog no longer defines simply do not resolve; the
                // stale-permission sweep in UpsertPermissionsAsync has already
                // removed the rows behind them.
                var targetIds = keys
                    .Where(permissionIdByKey.ContainsKey)
                    .Select(k => permissionIdByKey[k])
                    .ToHashSet();

                var currentIds = role.RolePermissions.Select(rp => rp.PermissionId).ToHashSet();
                var toAdd = targetIds.Except(currentIds).ToList();
                var toRemove = role.RolePermissions.Where(rp => !targetIds.Contains(rp.PermissionId)).ToList();

                foreach (var pid in toAdd)
                    db.RolePermissions.Add(new RolePermission { RoleId = role.Id, PermissionId = pid });
                if (toRemove.Count > 0)
                    db.RolePermissions.RemoveRange(toRemove);

                if (toAdd.Count > 0 || toRemove.Count > 0)
                    await db.SaveChangesAsync();
            }
        }

        private static async Task UpsertPermissionsAsync(AppDbContext db)
        {
            var existing = await db.Permissions.ToListAsync();
            var existingByKey = existing.ToDictionary(p => p.Key, StringComparer.OrdinalIgnoreCase);
            var catalogByKey = PermissionCatalog.All.ToDictionary(p => p.Key, StringComparer.OrdinalIgnoreCase);

            // Insert new + update drifted
            foreach (var def in PermissionCatalog.All)
            {
                if (existingByKey.TryGetValue(def.Key, out var row))
                {
                    if (row.Module != def.Module || row.Page != def.Page ||
                        row.Action != def.Action || row.Description != def.Description)
                    {
                        row.Module = def.Module;
                        row.Page = def.Page;
                        row.Action = def.Action;
                        row.Description = def.Description;
                    }
                }
                else
                {
                    db.Permissions.Add(new Permission
                    {
                        Key = def.Key,
                        Module = def.Module,
                        Page = def.Page,
                        Action = def.Action,
                        Description = def.Description
                    });
                }
            }

            // Remove stale keys no longer in the catalog. RolePermissions are
            // cascade-deleted by the FK.
            var stale = existing.Where(p => !catalogByKey.ContainsKey(p.Key)).ToList();
            if (stale.Count > 0)
                db.Permissions.RemoveRange(stale);

            await db.SaveChangesAsync();
        }

        private static async Task EnsureAdministratorRoleAsync(AppDbContext db, int seedAdminUserId)
        {
            var allPermissionIds = await db.Permissions.Select(p => p.Id).ToListAsync();

            var adminRole = await db.Roles
                .Include(r => r.RolePermissions)
                .FirstOrDefaultAsync(r => r.Name == AdministratorRoleName);

            if (adminRole == null)
            {
                adminRole = new Role
                {
                    Name = AdministratorRoleName,
                    Description = "Built-in system role with every permission. Cannot be deleted or edited.",
                    IsSystemRole = true,
                    CreatedAt = DateTime.UtcNow,
                    CreatedByUserId = seedAdminUserId
                };
                db.Roles.Add(adminRole);
                await db.SaveChangesAsync();
            }
            else if (!adminRole.IsSystemRole)
            {
                adminRole.IsSystemRole = true;
                await db.SaveChangesAsync();
            }

            // Sync the Administrator role's permission set to "everything".
            var currentPermIds = adminRole.RolePermissions.Select(rp => rp.PermissionId).ToHashSet();
            var targetPermIds = allPermissionIds.ToHashSet();

            var toAdd = targetPermIds.Except(currentPermIds).ToList();
            var toRemove = adminRole.RolePermissions.Where(rp => !targetPermIds.Contains(rp.PermissionId)).ToList();

            if (toAdd.Count > 0)
            {
                foreach (var pid in toAdd)
                    db.RolePermissions.Add(new RolePermission { RoleId = adminRole.Id, PermissionId = pid });
            }
            if (toRemove.Count > 0)
                db.RolePermissions.RemoveRange(toRemove);

            if (toAdd.Count > 0 || toRemove.Count > 0)
                await db.SaveChangesAsync();

            // Ensure the seed-admin user is assigned to Administrator. (Seed
            // admin bypasses permission checks anyway, but the assignment is
            // visible in the UI and makes the "who has Administrator?" answer
            // correct.)
            var seedAdminExists = await db.Users.AnyAsync(u => u.Id == seedAdminUserId);
            if (seedAdminExists)
            {
                var already = await db.UserRoles
                    .AnyAsync(ur => ur.UserId == seedAdminUserId && ur.RoleId == adminRole.Id);
                if (!already)
                {
                    db.UserRoles.Add(new UserRole
                    {
                        UserId = seedAdminUserId,
                        RoleId = adminRole.Id,
                        AssignedAt = DateTime.UtcNow,
                        AssignedByUserId = seedAdminUserId
                    });
                    await db.SaveChangesAsync();
                }
            }
        }
    }
}
