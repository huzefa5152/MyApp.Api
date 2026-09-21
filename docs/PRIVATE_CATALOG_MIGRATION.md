# Company-private catalog upgrade

`20260921121717_PrivateCompanyCatalogs` makes item types, item descriptions and units private to a company. With `Database:AutoMigrate` enabled (the default), startup applies the migration before serving requests. If the host disables it, apply the migration explicitly before starting the new application.

## Existing data

- Each legacy item type is copied into every company whose documents or stock reference it. All nine item-reference paths are remapped, including invoice adjustments. Document quantities and amounts are unchanged.
- Description defaults and custom units are copied only where document history proves company usage. Public FBR unit names are seeded independently for each company.
- Original catalog rows remain with `CompanyId = NULL` for recovery. They are hidden from every HTTP catalog query, including platform administrators. Unused custom entries cannot be assigned safely because the old schema recorded no owner; a verified owner must be assigned through a separately reviewed data operation if those entries are needed.
- Shared usage counters reset on the new copies. Numeric catalog IDs change; integrations must reload the selected company's catalog.

## Request contract

Catalog requests select a company using `companyId` in the query or `X-Company-Id`. Creation DTOs also accept `companyId`. A caller with exactly one company may omit it. A caller with multiple companies must select one. Row-ID endpoints verify both access and ownership. Document/stock writes reject item IDs from another company, including writes by the platform administrator.

## Deployment and rollback

Take and verify a database backup before deploying this upgrade. Restore it together with the previous application version if rollback is required: the migration deliberately refuses a destructive downgrade that would merge private catalogs back together. Test on a restored production database before the production push, especially where external integrations retain item IDs. The host-maintained production settings and credentials are not changed by this work.

## Local regression checks

- `dotnet run --project scripts/accounting_audit_checks/accounting_audit_checks.csproj` creates and removes a unique local SQL Server database on `.\MSSQLSERVER02`; it checks migration preservation, tenant filtering, rejected foreign item references, backfill recovery and audit isolation.
- `python scripts/test_private_catalogs.py --base http://localhost:5104` checks private catalog API reads/writes and cleans up its users and companies. Run against a migrated local instance.
- Existing accounting, role and tenant regression scripts remain applicable. Space login-heavy suites at least one minute apart to respect the login rate limiter.
