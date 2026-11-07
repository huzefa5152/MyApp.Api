# Engineering standards — Importer (feat/importer-ledger-receipts)

Scope: production line `feat/importer-ledger-receipts`. Written 2026-11-05 from the code at commit 65a15e58. It describes what the code does on this line. Where the code and this file disagree, the code is right and this file is corrected in the same commit as the change.

The rules (what must and must not happen) live in `CLAUDE.md`. This document holds the architecture: where each mechanism lives, how the parts connect, and which existing piece to reuse. Read both before any change. Before writing a new screen, dialog, endpoint or helper, look for the existing one here first.

## 1. This line at a glance

| Item | This line |
|---|---|
| Production workflow | `deploy-importer.yml` to the Importer site on MonsterASP. |
| Local database | `MyApp_Importer_Local` (chosen by branch, see section 9) |
| Business focus | import costing for goods that arrive under a GD (customs declaration): GD costing import, consignments, FIFO-by-GD stock, the customs stock sheet and Annex-H1, letters of credit, the import tax desk and input-tax worksheet, and FBR filing. |
| Size (2026-11-05) | 85 controllers, 88 services, 38 repositories, 79 models, 289 migrations, 63 pages. |
| Distinctive modules | `ImportConsignments`, `ImportLcs`, `ImportTax`, `ImportProfiles`, `SpreadsheetImport`, `LegacyImport`, `ManagerImport`, `ClientImport`, `CustomerLedger`, `HsCodes`, `NonInventoryItems`, `InvoiceBulk`, `DocumentCopy`. |

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
- The seed admin can set `User.CompanyChangesLocked` from New user and Edit user. `PermissionService` then removes the company create, update, delete and FBR token keys for that account and every account below it in `CreatedByUserId`, so `[HasPermission]`, `has()` and MCP tool gates all follow.

### 5.2 Administrators

- **Administrator** is a company-scoped role. It reaches only the companies in `UserCompanies`, and only the divisions in `UserDivisions` where divisions apply.
- There is no Tenant Administrator role and no edition role on this line. Company and user administration is done by the seed admin, and by Administrator accounts within the companies they hold.
- The seed admin is the only account that may use installation-wide writes (section 5.1).

### 5.3 Company membership and divisions

- `UserCompanies` links a user to the companies they may use. Access requires the permission and the membership together: a permission is not a company grant, and a company is not a permission grant. A revoked company is unreachable on the next request.
- Divisions are sub-units of a company: `Divisions` controller and `UserDivisions`. `DivisionAccessGuard` (`Services/Implementations`) and `IDivisionAccessGuard` (`Services/Interfaces`) apply the division rule to division-tagged reads and writes. Read the division notes in this line's `CLAUDE.md` (search for `IDivisionAccessGuard`) before touching division-tagged data.

### 5.4 Customer portal

The portal is the only anonymous surface. Its scope comes from the resolved token, every query filters on both `CompanyId` and `ClientId`, and every token failure returns the same generic 404. Never synthesise a user id for it (`Controllers/PublicCustomerPortalController.cs`, `Services/Implementations/CustomerPortalService.cs`).

### 5.5 Roles on this line

| Role | Who | What it grants |
|---|---|---|
| Administrator | Company administrators | Company-scoped administration |
| MCP Access | AI agents' owners | MCP access (policy-controlled) |
| MCP Write | AI agents' owners | MCP write tools (policy-controlled) |

There are no editions, no Tenant Administrator and no Email Workspace role on this line. Check the role seeder before adding any of them.

## 6. Permissions and the role editor

- The catalog is `Helpers/PermissionCatalog.cs`. Keys are `area.page.action`, lower case, and are never renamed after release, because a rename silently revokes every grant that holds it. The seeder upserts the catalog on start; admins cannot invent keys.
- The role editor's section tree is `myapp-frontend/src/config/permissionSections.js`. Check it with `python scripts/verify_permission_sections.py`, which fails on unlisted modules, bad section order, duplicate keys, and keys that the code checks but the catalog lacks.
- There is no route map file on this line. Every route in `src/App.jsx` is wrapped in `RequirePermission`, with a permission or an `anyPrefix` list (58 wrappers). A route without a wrapper is not guarded on the client, so new routes must have one.
- The sidebar section tree is documented in this line's `CLAUDE.md` (section 2b, "The permission structure"): Dashboards, Stock, Sales, Purchases, Accounting, Reports, Master Data, Settings, Administration.
- Frontend: `has("key")` and `<Can permission="key">` hide controls the user cannot use. The backend still refuses.

## 7. UI design system

### 7.1 Tokens

- `src/theme.js` exports: `colors`, `formShell`, `formBodyFill`, `stepTone`, `cardHover`, `buttonHover`, `cardStyles`, `dropdownStyles`, `modalSizes`, `formStyles`. Use these objects and tokens. Do not hard-code a colour, font or spacing value that a token already covers.
- `src/index.css` `:root` defines: `--font-sans`; `--color-bg-dark` and `--color-bg-light`; `--color-text-dark` and `--color-text-light`; `--color-primary` and `--color-primary-hover`; `--color-button-bg-dark` and `--color-button-bg-light`; `--radius`; `--transition`; and the `--dash-*` variables for the stock and dashboard screens (about 27 lines in `index.css`).
- Light and dark themes both go through these tokens.

### 7.2 Dialogs and modals

- Confirmations use `Components/ConfirmDialog.jsx` through `useConfirm()` (44 call sites on this line). The confirm text names the record and the consequence.
- Form modals and overlays use `formStyles` and `modalSizes` from `theme.js`. CLAUDE section 3 has the overlay rules: backdrop, maximum height, scrolling body, footer always visible.
- Screen-specific dialogs live in `Components/`. Look for a dialog that fits before creating one. Examples on this line: `BulkInvoiceDialog`, `CorrectConsignmentLineDialog`, `CostHistoryDialog`, `SettleConsignmentDialog`, `ClientOpeningBalanceDialog`, `SupplierStatementDialog`, `HsCodeImportModal`, `ClientImportModal`, `DivisionAccessModal`, `FbrRecordManualModal`, `CreateChallanFromBillModal`.
- A blocked state for a missing permission uses `Components/PermissionLackedHint.jsx`.

### 7.3 Reusable parts

- Line items: `Components/LineItemsEditor.jsx` (responsive table or cards, keyboard quick-add). Use it for any new quote, order, challan or invoice-style grid.
- Hooks in `src/hooks/`: `useDocumentCopy`, `useImportedTaxRates`, `useIsNarrow`, `useListViewMode`, `usePageSize`, `usePersistentFilter`, `usePrintTemplates`, `useScenarioFollowsGoods`, `useScrollToError`, `useStarterTemplates`, `useUiPreference`.
- Lists: `useListViewMode` and `usePageSize` remember each screen's view and page size.
- Printing: `usePrintTemplates` for the template picker; `utils/printDocument` and the `templateEngine` merge for output. A new print path must go through `mergeTemplate`.

### 7.4 Responsive rules

There is no `RESPONSIVE_UI_GUIDE.md` on this line. Use the rules in this line's `CLAUDE.md` (section 3, "Mobile-first UI") and the breakpoints below. Copying the Trader guide in would be a documentation change for the maintainer to approve. Breakpoints are 375, 768 and 1280 px. No horizontal scroll at 375 px. Tap targets are at least 44 px. Modals follow the overlay rules in 7.2.

### 7.5 Formatting

Prettier (`.prettierrc.json`; `npm run format:check` in `myapp-frontend`) and `dotnet format` (`.editorconfig`). CLAUDE section 3a has the commands and the rule for formatting-only commits.

## 8. Backend standards

- A new endpoint carries `[HasPermission]` on every action. Any company id is asserted (section 4). Paged lists clamp through `Helpers/PaginationHelper.cs`. Errors are logged with `_logger.LogError` and the client receives a generic message, never `ex.Message`.
- Business rules live in one service. A rule is not repeated in a controller and in a screen; the screen calls the service through the API.
- Multi-row writes use an explicit `BeginTransactionAsync` with commit and rollback (about 66 call sites on this line).
- `AuditLogService.LogAsync` records changes (about 71 call sites). It writes in its own serializable transaction (CLAUDE section 7). Sensitive fields are redacted by `Helpers/SensitiveDataRedactor.cs`.
- Document numbers are unique per company and are allocated through `Helpers/NumberAllocationRetry.cs`.
- Uploads go through `Helpers/ImageUploadValidator.cs`. Excel and CSV exports route every text cell through `CsvSafe`.
- Print fields: a new field lands in three places before it counts as done (CLAUDE, print-template rule): the `Print*Dto` property and its projection; `utils/templateEngine.js`; `utils/templateSampleData.js`. Then the branch's print-template skill, merge-fields reference, is updated.
- Template HTML: This line has no `Helpers/TemplateHtmlSafety.cs` and no `utils/printSafety.js`. The MCP print-design tool refuses active HTML outright (scripts, event handlers, `javascript:` links, frames) rather than stripping it. Confirm how the template editor's save path handles script before relying on either behaviour. Do not assume Trader's sanitiser is present here.
- MCP tools are defined in `Helpers/McpToolAccessCatalog.cs` and implemented in the `McpController` partial files. A tool that writes uses prepare, then commit after a human approves the plan.

## 9. Configuration, environments and deployment

- `appsettings.json` sets `Database:AutoMigrate` (`true`) and `AppSettings:SeedAdminUserId` (`1`). Secrets (the JWT key, connection strings) come from the environment or from `appsettings.Production.json`, which is gitignored. They are never committed.
- Local runs load `appsettings.Development.json` (gitignored; the example file is tracked). `Helpers/LocalDevDatabase.cs` reads `.git/HEAD`, which also works in a worktree, and maps the branch to a local database through `local.databases.json`. Checking out a branch is the whole switch.
- `Helpers/DevelopmentSqlGuard.cs` refuses to start a Development process against any SQL server except this machine.
- Production databases are read-only, queried from a SQL client for investigation only, and never written without the maintainer's written override (`docs/ENVIRONMENTS.md`).
- Deployment: `deploy-importer.yml` is this line's pipeline. `deploy-other.yml` is also present on this branch but belongs to the Customize site. Do not use it for this site, and check which workflow runs before any push. The retired master pipeline (`deploy.yml`) still fires on a push to `master`, so `master` is never pushed.
- Before any push to this line, the hard pre-push gate in CLAUDE must pass: `python scripts/test_stock_itemtype_reflow.py` must print `all checks passed`.
- Production names never go into a tracked file. After touching docs or scripts, run `python scripts/verify_no_production_identifiers.py`.

## 10. Business workflows on this line

- **GD costing import.** A GD is imported from the costing sheet, either as new arrivals or as a backfill of stock already held. Landed cost, input sales tax, advance income tax and GD charges post to Import Clearing. Each consignment records what it credited and what has been settled (`AmountSettled`).
- **Stock.** FIFO by GD: a sale uses claimed GDs first. Opening stock comes from a sheet. The monthly customs stock sheet and Annex-H1 must tie to the ledger (`get_stock_tie_out`). Restatements and corrections post to the equity account "Stock value corrections" (see `PostingService`, monthly stock relief).
- **Sales.** Invoices are standalone or from challans. A bill is priced at the rate the goods came in at. Inventory Overlay Behaviour keeps two books with one total (CLAUDE 5b-12).
- **Import tax desk.** The GD register, the input-tax worksheet by claim month, and the tie-out.
- **Letters of credit and charges** are recorded per consignment.
- **Hard pre-push gate.** `python scripts/test_stock_itemtype_reflow.py` must print `all checks passed` before any push to this line.

## 11. Development workflow

Five phases, in order, for every change. They match the standards in CLAUDE.

1. **Understand.** Read the requirement, the affected lines, the existing implementation, and the RBAC and tenant rules that apply.
2. **Plan.** Name the existing components and services to reuse, the files to change, the authorization boundaries, and the other lines that need the same change.
3. **Implement.** The smallest safe change, on the existing design system, with no unrelated edits. One commit per change, with explicit paths.
4. **Verify.** Build. Run the relevant suites. Check permitted and cross-company access. Check the UI at 375, 768 and 1280 px. Check other lines and shared code. Check formatting.
5. **Report.** What changed, what was reused, what was added and why, how access was checked, which lines were touched, what was verified, and what remains.

Commit identity and commit rules are in CLAUDE (Git workflow). Ask before every commit and every push.

## 12. Differences from the other production lines

- Only Importer has GD costing, consignments, letters of credit, the import tax desk, the customs stock sheet and FIFO by GD.
- Importer and Customize have divisions; Trader has none.
- Importer has no Tenant Administrator role, no edition roles and no Email Workspace role. Trader and Customize have them.
- Importer has no `EmailWorkspace` controller, which Trader and Customize have.
- Importer carries the `--dash-*` CSS variables and extra theme helpers (`formShell`, `formBodyFill`, `stepTone`).
- Importer's `CLAUDE.md` documents the permission section tree (section 2b). The other two lines do not.
- Importer's `CLAUDE.md` has no tenant INVARIANT section. The rule is enforced in code (`CompanyAccessGuard`).

## 13. Known gaps on this line

- No `RESPONSIVE_UI_GUIDE.md`, no route map and no route test on this line. Trader has all three.
- No `Helpers/TemplateHtmlSafety.cs`. Trader and Customize have it. Confirm the template save path before relying on sanitising (section 8).
- The tenant INVARIANT section is missing from this line's `CLAUDE.md`. Add it when the maintainer agrees.
- `deploy-other.yml` is present on this branch (section 9).

## 14. Documents for this line

- `docs/ENVIRONMENTS.md` — the three lines, databases and deploy workflows.
- `docs/MCP_AGENT_ACCESS.md` — MCP access.
- `docs/FBR_TAX_MAPPING_ARCHITECTURE.md` — FBR tax mapping.
- `docs/USER_GUIDE.pdf`, `docs/screenshots/`, `docs/superpowers/`.
- Import, costing and stock rules are in this line's `CLAUDE.md` (sections 5b-2 to 5b-22), not in separate files.
