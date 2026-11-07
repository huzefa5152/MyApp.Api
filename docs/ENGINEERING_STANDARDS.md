# Engineering standards — Trader (TraderFbrInvoicingSystem)

Scope: production line `TraderFbrInvoicingSystem`. Written 2026-11-05 from the code at commit c37b8900. It describes what the code does on this line. Where the code and this file disagree, the code is right and this file is corrected in the same commit as the change.

The rules (what must and must not happen) live in `CLAUDE.md`. This document holds the architecture: where each mechanism lives, how the parts connect, and which existing piece to reuse. Read both before any change. Before writing a new screen, dialog, endpoint or helper, look for the existing one here first.

## 1. This line at a glance

| Item | This line |
|---|---|
| Production workflow | `deploy-trader.yml` to the Trader site on MonsterASP. |
| Local database | `MyApp_Trader_Local` (chosen by branch, see section 9) |
| Business focus | FBR digital invoicing for wholesale sales; challans and bills; purchases; stock with commercial costs; double-entry accounting in two editions; customer portal; email workspace; MCP for AI agents. |
| Size (2026-11-05) | 81 controllers, 84 services, 36 repositories, 66 models, 253 migrations, 60 pages. |
| Distinctive modules | `CommercialCosts`, `StockEntries`, `LocalPurchaseSyncService` (automatic purchase bills from costed challan lines), `AccountingCatalog`, `OnboardingImport`, `CustomerWorkbookImport`, `DocumentNumbers`, `EmailWorkspace` (Gmail provider), `CompanyStampService`, `StarterTemplates`. |

## 2. Architecture

### 2.1 Backend layers

- `Controllers/` — HTTP only. Every action carries `[HasPermission]`. Every route that names a company passes an access check (section 4). MCP lives in `McpController*.cs` partial files, one per area.
- `Services/Interfaces/` and `Services/Implementations/` — business logic. Controllers call services. Services do not return HTTP results.
- `Repositories/Implementations/` — data access over `AppDbContext`. Reads use `AsNoTracking()`.
- `Models/` (EF entities), `DTOs/` (wire shapes; print payloads are `Print*Dto`), `Helpers/` (cross-cutting: permissions, pagination, catalogs, number allocation, validation), `Middleware/` (authorization attributes, exception handling, correlation id), `Data/` (startup seeders), `Migrations/` (EF).
- Services are registered in `Program.cs`.

### 2.2 Startup (`Program.cs`)

1. The database: `Database:AutoMigrate` (default `true`) applies EF migrations at start. Production may set it to `false`; migrations are then applied by hand.
2. Roles and permissions: `RbacSeeder.SeedAsync(db, seedAdminUserId)` runs on every start. It upserts the permission catalog and the system roles, and refreshes labels by key.
3. Backfills and repairs: each one writes a single AuditLog row under its own `ExceptionType` and never runs twice (CLAUDE section 11).
4. Seeders in `Data/` add reference data (merge fields, FBR codes, starter designs). They are idempotent.

### 2.3 Frontend layers

- `src/pages/` — one file per screen. `src/Components/` — parts of screens and dialogs. `src/api/` — one module per backend area, over the shared HTTP client. `src/hooks/` — shared behaviour. `src/contexts/` — `PermissionsContext` (`has()`, `<Can>`) and company selection. `src/utils/` — pure helpers (print merge, formatting, billing rules). `src/theme.js` and `src/index.css` — the design tokens.
- The UI hides what a user cannot use. Hiding is never the control: the server decides (section 4).

### 2.4 One request through the layers

A user opens a sales document: page (`src/pages`) → API module (`src/api`) → controller action with `[HasPermission]` and a company check → service → repository over `AppDbContext`, inside an explicit transaction when several rows change → `AuditLogService.LogAsync` records the change → response. A new feature should follow this shape.

## 3. Authentication

- Sign-in issues a JWT (`Controllers/AuthController.cs`). Sessions are server-side rows; logout revokes the session of this device.
- A password change, an admin reset and "sign out everywhere" rotate `SecurityStamp` and revoke the user's MCP agent tokens (`Helpers/McpTokenRevocation`). MCP tokens carry the stamp and are refused on a mismatch (`McpAgentAuthHandler`).
- An MCP agent authenticates with its own token. Each MCP tool is gated by `Helpers/McpToolAccessCatalog.cs` (permissions, scope, write flag, seed-admin-only flag) and by the account's MCP access policy.

## 4. Authorization: three server-side gates

1. **Permission.** `[HasPermission("area.page.action")]` (`Middleware/HasPermissionAttribute.cs`), evaluated by `Services/Implementations/PermissionService.cs` (`HasPermissionAsync`). The seed admin passes every key except the two MCP keys, which follow the MCP access policy (`IsMcpKey`).
2. **Company.** `[AuthorizeCompany]` (`Middleware/AuthorizeCompanyAttribute.cs`), or an explicit `AssertAccessAsync` for a company id taken from the route, query, form or body. `Services/Implementations/CompanyAccessGuard.cs` is fail-closed: a user reaches only the companies in `UserCompanies`, and the seed admin reaches all. Its public methods are `HasAccessAsync`, `AssertAccessAsync`, `InvalidateUser` and `InvalidateAll`; the last two clear cached access when membership changes, so revocation applies on the next request. The `IsTenantIsolated` column is kept, but the decision does not read it (the comment in `CompanyAccessGuard` says so).
3. **Record.** A record reached by id is loaded and its stored `CompanyId` is asserted. Every linked record (client, supplier, invoice, bill, GD) must belong to the same company. Request bodies are never trusted for either.

Installation-wide tables and endpoints use `[SeedAdminOnly]` (`Middleware/SeedAdminOnlyAttribute.cs`). A permission key alone does not reach them.

Before a change is called done: check permitted access and attempted cross-company access, for reads and writes, on each affected route and MCP tool (CLAUDE, "Test discipline").

## 5. Tenancy, the seed admin and the administrator hierarchy

### 5.1 Seed admin

- The account whose id equals `AppSettings:SeedAdminUserId` (default `1`). It is an id comparison, never a role name, and it is read in `Program.cs`.
- It reaches every company and every permission key, except the two MCP keys that follow the MCP access policy. It is the only account that may use installation-wide `[SeedAdminOnly]` writes and the all-companies MCP token. Its audit-log reads are unscoped.
- Never give anyone else seed-admin power through a role name, and never reuse its id.
- The seed admin can set `User.CompanyChangesLocked` from Edit user. `PermissionService` then removes the company create, update, delete and FBR token keys for that account and every account below it in `CreatedByUserId`, so `[HasPermission]`, `has()` and MCP tool gates all follow.

### 5.2 Administrators

- **Administrator** is a company-scoped role. It reaches only the companies in `UserCompanies`.
- **Tenant Administrator** is a system role. It carries the administration keys (create staff accounts, build roles, grant companies) and no product keys. It is assigned alongside an edition. Its keys are bounded by `RolesController.GrantableKeysAsync`: a user may put into a role, or assign a role carrying, only keys that user holds. Visible is not grantable. `tenantaccess.manage.update` is deliberately absent from it.
- The seed admin is the only account that may use installation-wide writes (section 5.1).

### 5.3 Company membership and divisions

- `UserCompanies` links a user to the companies they may use. Access requires the permission and the membership together: a permission is not a company grant, and a company is not a permission grant. A revoked company is unreachable on the next request.
- Trader has no divisions: no `Divisions` controller and no `UserDivisions` table. Do not add division scoping to a Trader feature without the maintainer's decision.

### 5.4 Customer portal

The portal is the only anonymous surface. Its scope comes from the resolved token, every query filters on both `CompanyId` and `ClientId`, and every token failure returns the same generic 404. Never synthesise a user id for it (`Controllers/PublicCustomerPortalController.cs`, `Services/Implementations/CustomerPortalService.cs`).

### 5.5 Roles on this line

| Role | Who | What it grants |
|---|---|---|
| Administrator | Company administrators | Company-scoped administration |
| Tenant Administrator | Tenant administrators | Administration keys only (staff, roles, company grants); no product keys |
| Sales Edition | Sales customers | Sales, purchases, inventory, FBR, receipts and payments; no general ledger |
| Complete Edition | Full customers | Sales Edition plus the accounting module |
| Email Workspace | Mail users | Email workspace |
| MCP Access | AI agents' owners | MCP access (policy-controlled) |
| MCP Write | AI agents' owners | MCP write tools (policy-controlled) |

The editions are system roles. They are defined in `Helpers/EditionCatalog.cs` by key prefix (`AccountingModulePrefixes`). `RolesController` refuses to edit or delete a system role; a variation is a clone.

## 6. Permissions and the role editor

- The catalog is `Helpers/PermissionCatalog.cs`. Keys are `area.page.action`, lower case, and are never renamed after release, because a rename silently revokes every grant that holds it. The seeder upserts the catalog on start; admins cannot invent keys.
- The role editor's section tree is `myapp-frontend/src/config/permissionSections.js`. Check it with `python scripts/verify_permission_sections.py`, which fails on unlisted modules, bad section order, duplicate keys, and keys that the code checks but the catalog lacks.
- Route map: `myapp-frontend/src/config/routePermissions.js` maps every route to the key that opens it. `Components/RequirePermission.jsx` refuses a path with no entry (fail closed). Adding a screen means adding its route entry. Check with `node scripts/test_route_permissions.mjs`.
- Frontend: `has("key")` and `<Can permission="key">` hide controls the user cannot use. The backend still refuses.

## 7. UI design system

### 7.1 Tokens

- `src/theme.js` exports: `colors`, `cardHover`, `buttonHover`, `cardStyles`, `dropdownStyles`, `modalSizes`, `formStyles`. Use these objects and tokens. Do not hard-code a colour, font or spacing value that a token already covers.
- `src/index.css` `:root` defines: `--font-sans`; `--color-bg-dark` and `--color-bg-light`; `--color-text-dark` and `--color-text-light`; `--color-primary` and `--color-primary-hover`; `--color-button-bg-dark` and `--color-button-bg-light`; `--radius`; `--transition`. There are no `--dash-*` variables on this line.
- Light and dark themes both go through these tokens.

### 7.2 Dialogs and modals

- Confirmations use `Components/ConfirmDialog.jsx` through `useConfirm()` (43 call sites on this line). The confirm text names the record and the consequence.
- Form modals and overlays use `formStyles` and `modalSizes` from `theme.js`. CLAUDE section 3 has the overlay rules: backdrop, maximum height, scrolling body, footer always visible.
- Screen-specific dialogs live in `Components/`. Look for a dialog that fits before creating one. Examples on this line: `ChallanModal`, `CommercialCostDialog`, `BulkFbrPreviewDialog`, `FbrPreviewDialog`, `PaymentHistoryDialog`, `ReconcileModal`, `StatementImportModal`, `TaxSheetImportDialog`, `HandoverDialog`, `DuplicateChallanDialog`, `templateEditor/NewTemplateDialog`.
- A blocked state for a missing permission uses `Components/PermissionLackedHint.jsx`.

### 7.3 Reusable parts

- Line items: `Components/LineItemsEditor.jsx` (responsive table or cards, keyboard quick-add). Use it for any new quote, order, challan or invoice-style grid.
- Hooks in `src/hooks/`: `useAdminAccessibility`, `useEntityAttachmentCounts`, `useIsNarrow`, `useLineEntryMode`, `useListViewMode`, `usePageSize`, `usePrintTemplates`, `useQueryAction`, `useScrollToError`, `useStarterTemplates`, `useUiPreference`.
- Lists: `useListViewMode` and `usePageSize` remember each screen's view and page size.
- Printing: `usePrintTemplates` for the template picker; `utils/printDocument` and the `templateEngine` merge for output. A new print path must go through `mergeTemplate`.

### 7.4 Responsive rules

`RESPONSIVE_UI_GUIDE.md` is in the repository and is the detailed reference. Read it before building any screen. Breakpoints are 375, 768 and 1280 px. No horizontal scroll at 375 px. Tap targets are at least 44 px. Modals follow the overlay rules in 7.2.

### 7.5 Formatting

Prettier (`.prettierrc.json`; `npm run format:check` in `myapp-frontend`) and `dotnet format` (`.editorconfig`). CLAUDE section 3a has the commands and the rule for formatting-only commits.

## 8. Backend standards

- A new endpoint carries `[HasPermission]` on every action. Any company id is asserted (section 4). Paged lists clamp through `Helpers/PaginationHelper.cs`. Errors are logged with `_logger.LogError` and the client receives a generic message, never `ex.Message`.
- Business rules live in one service. A rule is not repeated in a controller and in a screen; the screen calls the service through the API.
- Multi-row writes use an explicit `BeginTransactionAsync` with commit and rollback (about 68 call sites on this line).
- `AuditLogService.LogAsync` records changes (about 63 call sites). It writes in its own serializable transaction (CLAUDE section 7). Sensitive fields are redacted by `Helpers/SensitiveDataRedactor.cs`.
- Document numbers are unique per company and are allocated through `Helpers/NumberAllocationRetry.cs`.
- Uploads go through `Helpers/ImageUploadValidator.cs`. Excel and CSV exports route every text cell through `CsvSafe`.
- Print fields: a new field lands in three places before it counts as done (CLAUDE, print-template rule): the `Print*Dto` property and its projection; `utils/templateEngine.js`; `utils/templateSampleData.js`. Then the branch's print-template skill, merge-fields reference, is updated.
- Template HTML: `Helpers/TemplateHtmlSafety.cs` strips script on save. Printing runs under the script-blocking CSP in `utils/printSafety.js`. A print path must never bypass `mergeTemplate`.
- MCP tools are defined in `Helpers/McpToolAccessCatalog.cs` and implemented in the `McpController` partial files. A tool that writes uses prepare, then commit after a human approves the plan.

## 9. Configuration, environments and deployment

- `appsettings.json` sets `Database:AutoMigrate` (`true`) and `AppSettings:SeedAdminUserId` (`1`). Secrets (the JWT key, connection strings) come from the environment or from `appsettings.Production.json`, which is gitignored. They are never committed.
- Local runs load `appsettings.Development.json` (gitignored; the example file is tracked). `Helpers/LocalDevDatabase.cs` reads `.git/HEAD`, which also works in a worktree, and maps the branch to a local database through `local.databases.json`. Checking out a branch is the whole switch.
- `Helpers/DevelopmentSqlGuard.cs` refuses to start a Development process against any SQL server except this machine.
- Production databases are read-only, queried from a SQL client for investigation only, and never written without the maintainer's written override (`docs/ENVIRONMENTS.md`).
- Deployment: `deploy-trader.yml` is this line's pipeline. The retired master pipeline (`deploy.yml`) still fires on a push to `master`, so `master` is never pushed.
- Before any push to this line, the hard pre-push gate in CLAUDE must pass: `python scripts/test_stock_itemtype_reflow.py` must print `all checks passed`.
- Production names never go into a tracked file. After touching docs or scripts, run `python scripts/verify_no_production_identifiers.py`.

## 10. Business workflows on this line

- **Sales.** Bills are created from a challan or standalone. FBR validate, submit, exclusion, cancellation within the FBR window, credit and debit notes, and bulk FBR actions. Filing rules are in CLAUDE section 10.
- **Purchases and cost.** A costed challan line that has a supplier books an automatic purchase bill (`LocalPurchaseSyncService`). It becomes fixed once paid or credited. A supplier bill entered by hand wins over an automatic one. Commercial costs pool landed costs per document.
- **Stock.** On-hand, adjustments and stock entries. Each invoice relieves stock at the running average cost of purchases up to its date (CLAUDE, "A sale relieves inventory").
- **Accounting.** The ledger is always on for a company. Postings go through `PostingService` and are written only by `GeneralLedgerService.WriteEntryAsync`. A closed period is locked. Further tax sits inside `GrandTotal`; withholding is deducted by the buyer.
- **Customer portal and email.** Invoice links for customers; the email workspace for mail.
- **MCP.** AI agents act through the MCP tools, under the same gates as a user.

## 11. Development workflow

Five phases, in order, for every change. They match the standards in CLAUDE.

1. **Understand.** Read the requirement, the affected lines, the existing implementation, and the RBAC and tenant rules that apply.
2. **Plan.** Name the existing components and services to reuse, the files to change, the authorization boundaries, and the other lines that need the same change.
3. **Implement.** The smallest safe change, on the existing design system, with no unrelated edits. One commit per change, with explicit paths.
4. **Verify.** Build. Run the relevant suites. Check permitted and cross-company access. Check the UI at 375, 768 and 1280 px. Check other lines and shared code. Check formatting.
5. **Report.** What changed, what was reused, what was added and why, how access was checked, which lines were touched, what was verified, and what remains.

Commit identity and commit rules are in CLAUDE (Git workflow). Ask before every commit and every push.

## 12. Differences from the other production lines

- Only Trader has commercial costs, stock entries, local purchase sync, the onboarding and customer-workbook importers, the document-numbering module and the accounting catalog.
- Only Trader has no divisions. Customize and Importer both have them.
- Only Trader has a route map (`routePermissions.js`) and its test, and the responsive guide file.
- Trader and Customize share the same role set (Administrator, Tenant Administrator, two editions, Email Workspace, MCP). Importer has only Administrator and the two MCP roles.
- Trader's `CLAUDE.md` is the only one with the tenant INVARIANT section. The rule is the same on all three lines in code (`CompanyAccessGuard`).

## 13. Known gaps on this line

- The route map and its test exist only here. Any new route on this line needs its map entry, or it is refused.
- Every new endpoint needs a cross-company case in `scripts/test_tenant_isolation.py` (CLAUDE, Test discipline).
- No other gaps are known from this review.

## 14. Documents for this line

- `docs/ENVIRONMENTS.md` — the three lines, databases and deploy workflows.
- `docs/MCP_AGENT_ACCESS.md`, `docs/MCP_ADMIN_ROADMAP.md`, `docs/MCP_WRITE_DESIGN.md` — MCP access, roadmap and write design.
- `docs/FBR_TAX_MAPPING_ARCHITECTURE.md` — FBR tax mapping.
- `docs/PRIVATE_CATALOG_MIGRATION.md` — company-private catalogs.
- `docs/PO_FORMAT_TENANCY.md`, `docs/LETTERHEAD_PRINTING.md`, `docs/BILLED_CHALLAN_EDITING.md`, `docs/CUSTOMER_DOCUMENT_IMPORT.md`.
- Trader-specific: `docs/TRADER_ACCOUNTING_PORT_STATUS.md`, `docs/TRADER_DOCUMENT_NUMBERING.md`, `docs/TRADER_NON_FBR_BILLING.md`, `docs/TRADER_PRIVATE_ROLES.md`, `docs/TRADER_QUOTE_LINE_IMAGES.md`, `docs/TRADER_REPORT_EXPORTS.md`, `docs/TRADER_TENANT_SECURITY_AUDIT.md`.
- Email: `docs/GMAIL_EMAIL_WORKSPACE.md` and its verification note.
- `docs/superpowers/`, `docs/screenshots/`, `docs/USER_GUIDE.pdf`.
