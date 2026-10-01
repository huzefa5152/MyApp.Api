# Trader private custom roles

Custom roles belong to a tenant administrator's user hierarchy, independently
of company assignments. A permission never grants access to an unassigned
company. Built-in system roles remain shared and immutable.

- A tenant administrator and its descendants use one role-name namespace.
- Names are trimmed and SQL Server's existing name collation applies. Two
  different tenants may use the same name; duplicates inside a tenant fail.
- The seed admin selects the owner when creating a role. The tenant
  administrator may manage that role even when the seed admin created it.
- The seed admin can copy a custom role into several destination tenants.
  Copies contain independent permission rows and no user assignments. A name
  conflict in any destination rejects the whole request. Choose another name
  to copy into a tenant that already uses the source name.
- Assigning another tenant's private role directly is refused, including for
  the seed admin. Copy first, then assign the destination role.
- Permission resolution also rejects a private role belonging to another
  hierarchy. Changing a user's hierarchy does not carry private permissions
  into the new tenant.

## Upgrade

Apply `ScopeTraderCustomRoles` before starting the new application when automatic
migrations are disabled. It adds `Roles.TenantAdminUserId` and replaces global
name uniqueness with filtered global and per-tenant indexes.

Startup scopes existing custom roles under a transaction and database application
lock. The creator's top-level administrator owns the original. Existing
assignments in other hierarchies are moved to independent copies with the same
permissions. Creatorless roles remain seed-owned, with copies for their existing
tenant assignments. Existing permission grants are preserved; no new user
receives an assignment. Re-running startup does not repeat the conversion.

After duplicate names or legacy copies exist, an older application's global
name assumptions are incompatible. Rollback requires the verified pre-upgrade
database backup and matching application version; do not delete roles or rename
them merely to force the old unique index to fit.

## Verification

Use synthetic data on a disposable local database:

```
python scripts/test_private_roles.py --base http://127.0.0.1:5210
python scripts/test_admin_scope_isolation.py --base http://127.0.0.1:5210
python scripts/test_edition_roles.py --base http://127.0.0.1:5212
python scripts/test_trader_security_boundaries.py --base http://127.0.0.1:5210 --peer http://127.0.0.1:5212
```

The upgrade rehearsal must compare effective user-permission sets before and
after startup and include a legacy custom role assigned to separate tenants.
Check the create and copy dialogs at 375, 768 and 1280 pixels.
