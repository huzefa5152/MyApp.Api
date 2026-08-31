# MyApp.Api — Claude Code session standards

You are working on **MyApp.Api**, an FBR Digital Invoicing ERP for Pakistani
wholesalers. Production live at `hakimitraders.runasp.net` (MonsterASP).
Two real tenants today (Hakimi Traders, Roshan Traders); the codebase is
being evolved into a multi-tenant SaaS.

**This file is the single source of truth that every Claude session must
follow.** It is auto-loaded into every conversation — read it once and
treat the rules as non-negotiable unless the user explicitly overrides
them in their message.

---

## Stack & layout

- Backend: **.NET 9**, **EF Core 9**, **SQL Server**, Serilog
- Frontend: **React 19** + **Vite**, served as static files from `wwwroot/`
- Tenant isolation: `Company.IsTenantIsolated` + `UserCompany` join table
- RBAC: `Helpers/PermissionCatalog.cs` is the catalog of every permission key
- FBR integration: `Services/Implementations/FbrService.cs` (PRAL HTTP client)

Key directories:
```
Controllers/                 HTTP layer
Services/Implementations/    Business logic
Repositories/Implementations/EF Core data access
Models/                      EF entities
DTOs/                        Wire shapes
Helpers/                     Cross-cutting helpers (Permission, Pagination, ImageUpload, …)
Middleware/                  GlobalException, CorrelationId
Migrations/                  EF migrations
myapp-frontend/src/          React app
scripts/                     Python verification / test scripts
data/keys/                   ASP.NET DataProtection key ring (gitignored, must persist in prod)
```

---

## Running locally

```bash
# Backend (Development env loads appsettings.Development.json → Jwt:Key)
ASPNETCORE_ENVIRONMENT=Development dotnet run --no-launch-profile --urls "http://localhost:5134"

# Frontend dev server (hot reload, separate port)
cd myapp-frontend && npm run dev

# Frontend production-style (serve from backend at :5134)
cd myapp-frontend && npm run build
# then copy myapp-frontend/dist/* → wwwroot/  (powershell snippet in this repo's history)
```

**Operator rules (do NOT violate without explicit say-so):**
- Never auto-restart the backend
- Never auto-commit
- Never auto-push (master or any branch)
- Frontend rebuild (`npm run build` + copy dist→wwwroot) IS fine to run automatically after frontend source edits

---

## Coding standards (every PR must follow)

### 1. Tenant isolation — MANDATORY

Every endpoint that accepts a `companyId` (route, query, form, body) **must** assert access:

```csharp
await _access.AssertAccessAsync(CurrentUserId, companyId);   // throws → 403
```

For "list across companies" endpoints, scope to the caller's accessible set:

```csharp
var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
var rows = await _service.GetAllAsync();
return Ok(rows.Where(r => allowed.Contains(r.CompanyId)));
```

**Never trust `dto.CompanyId` directly.** For updates, load the existing entity
and assert against its stored `CompanyId` — body fields can be forged.

### 2. Permissions — MANDATORY

Every controller action **must** have `[HasPermission("module.page.action")]`
(read endpoints included — least-privilege). New permission keys go in
`Helpers/PermissionCatalog.cs`. The seeder upserts the catalog on startup;
admins **cannot** invent keys through the UI.

Frontend:

```jsx
import { usePermissions, Can } from "../contexts/PermissionsContext";
const { has } = usePermissions();
{has("invoices.list.view") && <Link to="/invoices">Open</Link>}
// or declaratively:
<Can permission="users.manage.create"><button>New user</button></Can>
```

Action buttons that the user can't activate **must not render**. Don't show a
button that 403s on click.

**Permission-module grouping (user rule, 2026-07-04):** every `Module` string
in `PermissionCatalog.cs` **must** be mapped to its navbar section in
`myapp-frontend/src/config/permissionSections.js` — nothing may fall into the
role editor's "Other" bucket. When a new feature adds a permission module,
add the mapping in the same change, under the section where the feature lives
in the sidebar. `python scripts/verify_permission_sections.py` enforces this
(fails on unmapped or stale modules) — run it whenever the catalog changes.

### 3. Mobile-first UI

- Grids: `gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))"` — collapses to one column on phones with no media queries
- Test at **375px** (phone), **768px** (tablet), **1280px** (desktop)
- Long names: `display: "-webkit-box"; WebkitLineClamp: 2; WebkitBoxOrient: "vertical"` — DO NOT use `whiteSpace: "nowrap"` + `textOverflow: "ellipsis"` on user-supplied strings (it collapsed "MEKO FABRICS" and "MEKO DENIM" into identical-looking rows, see dashboard incident 2026-05-13)
- Tap targets ≥ 44×44 px
- Picker dropdowns: full-width on phone (`flex: 1`), capped on desktop (`maxWidth: 260`)
- Icon buttons: **always verify the icon actually renders** before shipping (DOM-measure the `svg` width > 0, or reload) — a green build is not visual proof; screenshots are broken on this machine. For NEW fixed-size icon-only buttons prefer the house pattern `display: "grid", placeItems: "center"` with a fixed `width`/`height` (copy `iconBtn` from `WithholdingTaxReceiptsPage.jsx`) and pass an explicit `size` — it's the convention and a cheap hedge against the rare flex/SVG sizing quirk. (An audit of 115 icon buttons found 0 real collapse bugs, so `inline-flex` is NOT broken — don't go refactoring existing inline-flex icon buttons.)
- Reuse existing filter/select styling — pass `style={dropdownStyles.base}` to shared components like `DivisionSelect` (a bare `<DivisionSelect>` renders an unstyled native `<select>`).

### 4. Data integrity

- Document numbers (`InvoiceNumber`, `PurchaseBillNumber`, `GoodsReceiptNumber`) are **UNIQUE** per `CompanyId`. Create paths must wrap in retry-on-conflict via `MyApp.Api.Helpers.NumberAllocationRetry`.
- `DeliveryChallan.ChallanNumber` is **non-unique by design** — the Duplicate Challan flow emits same-number rows intentionally. Do not add a unique index.
- Multi-step writes use `BeginTransactionAsync` with explicit commit/rollback.
- Cross-tenant link guard: when writing a record that references a `Client`/`Supplier`/`Invoice`, verify `child.CompanyId == parent.CompanyId`.
- Demo invoices (`IsDemo = true`) are **excluded** from every dashboard KPI and from the real numbering sequence.

### 5. Dashboard / aggregation grouping

- Sales-by-client / purchases-by-supplier: group by `Client.ClientGroupId ?? -ClientId` (and `Supplier.SupplierGroupId ?? -SupplierId`). Same legal entity across tenants merges; legacy rows without a group fall back to ClientId. See `Services/Implementations/DashboardService.cs:ComputeSalesAsync`.

### 5b. Copy Document

`Services/Implementations/DocumentCopyService.cs` is the ONLY place a document
is copied or converted. It maps a source onto the destination's existing
create-DTO and then calls that document's own `CreateAsync` — numbering,
validation, stock and GL posting must never be re-implemented there. Where a
conversion already exists (quote→order, order→challan, order→bill) the copy
delegates to it rather than re-deriving the mapping.

The supported source→destination matrix, the UI labels, and the permission key
per type live in `Helpers/DocumentCopyTypes.cs`. Adding a pair means adding a
mapper + a matrix entry + a case in `scripts/test_document_copy.py` — never a
branch in a controller. Copy lineage is written to the nullable
`CopiedFromType` / `CopiedFromId` columns (plain columns, not FKs, since the
source may be a different entity).

### 5b-2. HS code master — reference data, NOT tenant data (2026-08-30)

`Models/HsCode.cs` is the installation-wide tariff master, filled by
`Services/Implementations/HsCodeService.cs` from FBR's `/pdi/v1/itemdesccode`.
It exists so item-type classification does not depend on FBR at all:

```
HsCode (master) → ItemType → company documents → FBR submission (optional)
```

Rules:

- **Nothing in the HS path may be gated on `Company.FbrEnabled`.** That flag
  decides whether invoices are SUBMITTED, nothing else. The HS Code field on the
  Item Type form renders for every company; only Sale Type stays FBR-gated.
- **The import is an upsert keyed on `HsCode.Code`** and never deletes. Pressing
  the button twice must add zero rows — `scripts/test_hscode_master.py` pins
  that. It creates a placeholder `ItemType` per new code
  (`IsAutoGenerated = true`, `IsFavorite = false`).
- **`ItemType` is a GLOBAL catalog**, so those ~7.8k placeholders are excluded
  from `GET /api/itemtypes` unless `includeAutoGenerated=true` (server-capped at
  200). Never remove that filter — the Item Catalog page and every document
  picker render the full list.
- **Credentials come from the installation, not a tenant.** The reference token
  lives in `SystemSettings` (`Fbr.ReferenceToken`), encrypted with the same
  `IFbrTokenProtector` as `Company.FbrToken`, and is used ONLY for read-only
  catalogs. Never borrow another tenant's token for it (audit H-9).
- **HS validation is master-first**: once the master holds rows, a code missing
  from it is rejected. The old PRAL/format fallback only applies while the
  master is empty. Test fixtures therefore have to use REAL tariff codes.
- `Company.FbrEnabled` now defaults **false** on the model (new companies start
  with FBR off). `UpdateCompanyDto` still defaults true on purpose — an update
  that omits the field must not switch a live tenant's FBR off.

### 5c. Customer Portal — the only anonymous surface

`Controllers/PublicCustomerPortalController.cs` is one of just two
`[AllowAnonymous]` controllers in the repo (the other serves product images).
Authorization here is opt-in per controller — there is NO global fallback
policy — so the attribute is carried explicitly and the reasoning lives in a
header comment. Read it before touching anything in that file.

Rules that must not be relaxed:

- **No tenant guard works on this path.** Every `ICompanyAccessGuard` /
  `IDivisionAccessGuard` method takes a `userId`, and the seed admin id (1) is
  granted everything unconditionally. Never synthesise a user id to reuse them.
  Scope comes from `[ResolvePortal]` → `ResolvedPortal`, and every query filters
  on BOTH its CompanyId and ClientId.
- **No public method takes a company, client or invoice id from the caller.**
  The route carries the document NUMBER, resolved inside the portal's scope.
- **One generic 404 for every token failure** (unknown / malformed / disabled /
  revoked). `GlobalExceptionMiddleware` echoes 4xx messages verbatim, so
  distinct wording is an enumeration oracle.
- **The token is a bearer secret.** It is in `SensitiveDataRedactor`, masked out
  of Serilog by `Helpers/PortalTokenLogMasker`, and masked in audit rows. Never
  log it, and never echo the management list response into a log.
- The portal serves ONE document type, stored on the row (`CustomerPortal.DocumentType`:
  `Bill` | `TaxInvoice` | NULL = auto, legacy rows only). Bill and Tax Invoice are
  different templates fed by different print DTOs, so template and data are chosen
  together in `ResolveDocumentAsync` — never swap one for the other. An explicit
  choice is absolute: if that template is missing, printing is OFF.
  Beware `IPrintTemplateRepository.GetForExportAsync` — despite the name it filters
  `ExcelTemplatePath != null`, so it is the EXCEL resolver and returns null for
  HTML-only templates.
- Any new public endpoint needs a case in `scripts/test_customer_portal.py`
  suite 4 (IDOR) — that suite is the only automated proof the hand-rolled scope
  holds.

### 5d. Public file allowlist

`data/` holds user uploads. Program.cs mounts ONLY the folders a browser must
fetch with a plain `<img src>` — `uploads/logos`, `uploads/stamps`,
`uploads/quoteitems`, `images` — each on its own provider. Everything else under
`data/` is private by default.

Do NOT re-introduce a blanket `/data` mount with per-folder denies: that is what
leaked the PO audit archive, the Excel templates and the import PDFs. If a new
feature writes somewhere under `data/` and a browser needs it, add the folder to
that array and to `scripts/verify_public_file_allowlist.py`; if it does not,
serve it through an authenticated endpoint like attachments do.

### 6. Pagination

Every paged endpoint clamps via `MyApp.Api.Helpers.PaginationHelper`:

```csharp
var clampedPage = PaginationHelper.ClampPage(page);
var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
// or for audit-log-style endpoints:
var size = PaginationHelper.Clamp(pageSize, _defaultPageSize, PaginationHelper.AuditMax);
```

Max defaults: 100 normal, 200 audit. Caller-supplied `pageSize=999999` is silently capped.

### 7. Error handling

- Never return `ex.Message` to the client — log via `_logger.LogError(ex, "...")`, return a generic operator-friendly message.
- Audit-log writes go through `AuditLogService.LogAsync` which fingerprints + dedups inside a SERIALIZABLE transaction.
- Sensitive fields in request bodies: extend `Helpers/SensitiveDataRedactor.cs` (it already covers password, token, NTN, CNIC, STRN, address, phone, email).

### 8. Uploads

- Logo, avatar, image uploads: use `Helpers/ImageUploadValidator.Validate(file, maxBytes)` — extension allowlist + size cap + magic-bytes sniff.
- Excel/CSV exports: route every operator string through `CsvSafe` (server) or `csvSafe` (client) so `=WEBSERVICE`/`=HYPERLINK` injections are neutralised.

### 9. Privileged operations

- FBR token write: gated by `companies.manage.fbrtoken` (NOT `companies.manage.update`).
- `IsTenantIsolated` flip: gated by `tenantaccess.manage.update`.
- Role string assignment of "Admin": **seed admin only** (`_seedAdminUserId`).
- Server-side `/auth/logout` rotates `SecurityStamp` → previous JWTs reject on next request.

### 10. FBR integration specifics

- POST to FBR (`/submit`, `/validate`) is **never retried** by the Polly resilience handler — see `Program.cs: Retry.ShouldHandle` skipping `HttpMethod.Post`. Retrying a POST after a timeout can issue a duplicate IRN.
- Reference-data endpoints (`/provinces`, `/hscodes`, …): gated by `fbr.reference.read`. Never bleed one tenant's token to fetch catalogs for another tenant.

### 11. SQL Server gotchas

- **A single batch that both ALTERs a table and references the new column will fail at parse time** even when execution is guarded by `IF NOT EXISTS`. Split into separate `ExecuteSqlRaw` calls. Wrap column-dependent statements in `EXEC('...')` so they're parsed only at execution time. See `Program.cs:SecurityStamp backfill` for the pattern.
- Idempotent backfills mark completion in an AuditLog row (`ExceptionType = '<NAME>_BACKFILL_V1'`). RBAC bootstrap also gates on `UserRoles.Any()` so a truncated AuditLogs table can't re-grant Administrator.

### 12. EF Core

- Never run two `AppDbContext` operations concurrently — it's not thread-safe.
- Reads: `.AsNoTracking()`.
- Migrations auto-apply at startup when `Database:AutoMigrate` is true (default). Production may flip false.
- DataProtection encrypts `Company.FbrToken` via EF value converter; legacy plaintext payloads pass through reads and re-encrypt on next save.

---

## Test discipline — required before any push

| Check | Command | Must show |
|---|---|---|
| Backend build | `dotnet build MyApp.Api.csproj` | `0 Error(s)` |
| Audit verifier (static) | `python scripts/verify_audit_2026_05_13_security.py` | `67/67 checks passed` |
| Audit verifier (live, optional but recommended) | `python scripts/verify_audit_2026_05_13_security.py --live` | `73/73 checks passed` |
| Basic flows | `python scripts/test_basic_flows.py` | `all PASS` |
| Tenant isolation | `python scripts/test_tenant_isolation.py` | `all PASS` |
| Stock item-type reflow (V1) | `python scripts/test_stock_itemtype_reflow.py` | `76/76 checks passed` |
| Inventory V2 lifecycle | `python scripts/test_stock_v2_lifecycle.py` | `29/29 checks passed` |
| Division isolation | `python scripts/test_division_isolation.py` | `all checks passed` |
| Document copy | `python scripts/test_document_copy.py` | `184/184 checks passed` |
| Customer Portal (incl. IDOR suite) | `python scripts/test_customer_portal.py` | `116/116 checks passed` |
| Customer receipts + advances | `python scripts/test_customer_receipts_ledger.py` | `87/87 checks passed` (1 skipped) |
| Customer ledger | `python scripts/test_customer_ledger.py` | `79/79 checks passed` |
| Customer ledger grouping | `python scripts/test_customer_ledger_groups.py` | `47/47 checks passed` |
| Client Ledger report | `python scripts/test_client_ledger_report.py` | `97/97 checks passed` |
| Accounting reports | `python scripts/test_accounting_reports.py` | `210/210 checks passed` |
| Public file allowlist | `python scripts/verify_public_file_allowlist.py` | `10/10 checks passed` |
| Print pagination (offline) | see `PRINT_TEMPLATE_GUIDE.md` §11 | `0 failing cases` |
| HS code master + FBR-off classification | `python scripts/test_hscode_master.py --fbr-token <token>` | `all PASS` (15 checks) |
| Bulk client import | `python scripts/test_client_import.py` | `all PASS` (23 checks) |
| Permission-section mapping (static) | `python scripts/verify_permission_sections.py` | `All permission modules are mapped` |
| PO parser corpus (offline) | `cd scripts/po_parser_harness && dotnet run -c Release` | `ALL REGRESSION CORPORA PASSED` |
| PO parser vs prod PDFs (read-only) | `python scripts/po_parser_prod_regression.py` (see guide) | `REGRESSIONS 0` |

**PO parser / import changes — MANDATORY.** Any change to
`Services/Implementations/RuleBasedPOParser.cs` or the import flow
(`Controllers/POImportController.cs`, `myapp-frontend/src/Components/POImportForm.jsx`)
must keep BOTH the offline corpus harness AND the production read-only check
green, and add corpus cases for the new behaviour. Full runbook (parser
internals, feedback system, cross-branch cherry-pick, prod-check setup) is in
`PO_IMPORT_PARSER_GUIDE.md`.

**Accounting reports — MANDATORY.** Any change to
`Services/Implementations/AccountingReportService*.cs`,
`Controllers/AccountingReportsController.cs`, `Helpers/ReportPeriod.cs` or
`Helpers/ReportExcelBuilder.cs` must keep `scripts/test_accounting_reports.py`
green and add a case for the new behaviour. That suite is deliberately built out
of CROSS-CHECKS against the existing engine (expense total vs trial balance,
cash-book closing vs the CoA balance, register totals vs the dashboard summary),
because a reporting bug shows up as a plausible wrong number, not a crash. A
report must never grow its own accounting calculation — read `JournalLines` and
reuse `GeneralLedgerService`'s primitives. Report scope for a division-restricted
user comes from `ReportFilterDto.AllowedDivisionIds`, which is `[BindNever]` and
set only by the controller; never widen it, and never let a report skip
`ScopeToDivisions`.

If you add a new endpoint that takes `companyId`, add a tenant-isolation
case to `scripts/test_tenant_isolation.py`. If you touch invoice/bill
math, add the case to `scripts/test_basic_flows.py`. If you touch stock
movement reflow (purchase/invoice/challan edits, StockService), add the
case to `scripts/test_stock_itemtype_reflow.py` (V1 semantics — keep it
byte-identical, it pins the legacy HS-gated polarity). If you touch the
**Inventory V2** engine (InventoryReadService buckets, SalesOrder reservation
guard, invoice lineage/oversell guard, the V2 flow-version toggle, StockLock),
add the case to `scripts/test_stock_v2_lifecycle.py` — the V2 benchmark that
pins the reserve→deliver→bill lifecycle, over-commit hard-block (409), and the
race-free concurrent guard. See `INVENTORY_FLOW_AUDIT_2026_07_05.md` for the
full design + decisions.

If you touch **customer receipts, advances or the customer ledger**, add the
case to the matching script: allocation/advance maths and the GL postings
behind them go in `scripts/test_customer_receipts_ledger.py`; ledger entries,
opening/closing and the statement's own arithmetic go in
`scripts/test_customer_ledger.py`; the "one business kept under two client
records reads as one customer" behaviour goes in
`scripts/test_customer_ledger_groups.py`; and the company-wide report, its
Excel export and its picker feed go in `scripts/test_client_ledger_report.py`
(suite 6 is where every route on that controller gets its cross-company 403).

**Inventory V2 (2026-07):** tracking has a per-company version —
`Company.InventoryFlowVersion` (1 = legacy: only HS-coded items tracked;
2 = standard: ALL item types are inventory, HS code is FBR metadata only).
Default 1, so existing tenants are untouched. Flip via
`POST /api/stock/company/{id}/flow-version` (permission `stock.policy.manage`,
reversible + audited; turning on V2 defaults `StockGuardHardBlock` on). The
logical buckets (Committed / To-Deliver / Delivered / Incoming) are a DERIVED
read model — never persisted, computed from live documents by
`InventoryReadService`, so nothing can drift. Per-item opt-outs live in
`CompanyItemTypeSettings` (never on the global `ItemType`).

The basic-flow script covers (see `scripts/test_basic_flows.py` for detail):
- Challan creation
- Bill creation **from** a challan
- Bill creation **without** a challan (standalone)
- Invoice update (description / qty / unit-price → totals reflow)
- Item Rate History (quantity-suggestion source on bill form)
- Tax calculation correctness (standard 18% GST, exempt 0%, 3rd Schedule retail price)

The stock-reflow script (`scripts/test_stock_itemtype_reflow.py`) proves
inventory stays settled when item types change — it spins up an ephemeral
tracking-enabled company and asserts on-hand after each edit:
- Purchase bill: create IN, change item type (reverse old + add new), change qty, switch to an un-classified (no-HS) item (no IN), delete (reverse).
- Classify-after-create **phantom guard**: a bill created against a no-HS item records no IN; classifying the item then editing must NOT fabricate a negative reversal.
- Invoice OUT via **narrow** item-type edit (`PATCH /itemtypes`), **full** edit (`PUT /{id}`), and the **challan-driven** add/remove/qty path — each reverses the old item's OUT and re-records on the new, restores on clear/remove, and reverses on delete.

---

## Git workflow

- Branch from `origin/master`: `fix/...` or `feat/...`
- Imperative commit subjects ("Fix dashboard duplicates", not "Fixed" / "This fixes")
- Commit-per-phase for large changes
- **Never** include `Co-Authored-By: Claude …` or any AI-attribution footer — global rule from user memory
- Ask before commit AND push every time (each needs fresh confirmation)
- Frontend bundle rebuild goes in the **same commit** as the source change that necessitated it

---

## Transient feature/research docs — delete once done (every session)

Planning / research / spec / audit `.md` files created to build a feature are
**transient**. Once that feature is **implemented AND verified**, delete its
`.md` in the same session (the durable record is the README `## Changelog` +
git history + `TECHNICAL_SPEC.md`). Applies to future `FEATURE_*`, `*_DESIGN`,
`*_AUDIT`, gap-analysis, and research notes you author.

- **Keep** while the feature is **not done / not verified** (e.g.
  `FEATURE_TAX_OPTIMIZATION_GATE.md` — approved, not started).
- **Never delete** the permanent docs: `README.md`, `CLAUDE.md`,
  `TECHNICAL_SPEC.md`, `USER_GUIDE.md`, `AGENTS.md`, the `*_GUIDE.md` runbooks,
  and any doc still cited from **source code, scripts, or `CLAUDE.md`** — strip
  the citation first (or fold the doc's essence into `TECHNICAL_SPEC.md`) before
  removing it, so nothing points at a missing file.
- **Never delete another session's in-progress docs** (e.g. a `FEATURE_*` marked
  DESIGN ONLY that a parallel session owns).

## README changelog — MANDATORY (every session)

`README.md` is the running, incremental record of this product's evolution.
**Every session that ships a feature or bug fix MUST append a dated entry to the
`## Changelog` section of `README.md` (newest first) before committing** —
one concise entry per session summarising what changed (features, fixes,
migrations). This is a hard rule, on par with the test-discipline checks.

- Group same-day work under a single dated heading (`### YYYY-MM-DD`); add
  bullets, don't rewrite history.
- When a **new module/page/entity** ships, also keep the README **Features**,
  **Roadmap**, and (if structural) **Project Structure** sections in sync.
- Keep entries user-facing and honest — no internal-only notes (DB names,
  session ids, throwaway company ids). Those belong in the audit/feature docs.
- The changelog edit is part of the same commit as the feature/fix (or its own
  commit in the same session), never deferred to "later".

---

## Production deploy notes

- Live host: **MonsterASP** at `hakimitraders.runasp.net`
- `appsettings.Production.json` provides `Jwt:Key` + `ConnectionStrings` — never committed (gitignored)
- DataProtection keys persist to `data/keys/` — if MonsterASP wipes that on redeploy, previously-encrypted `Company.FbrToken` values become unreadable (Unprotect returns null → operator re-enters token). Verify persistence after first deploy.
- `ForwardedHeaders:KnownProxies` should be populated with MonsterASP's proxy IPs once known (audit C-12) so the rate-limit partition key uses the real client IP.
- Two real tenants currently: **Hakimi Traders** (CompanyId=1) and **Roshan Traders** (CompanyId=2). Do not modify their existing data without explicit say-so.

---

## Anti-patterns I keep finding (don't repeat them)

- ❌ Trusting `dto.CompanyId` from request body without `_access.AssertAccessAsync`
- ❌ Grouping dashboard aggregates by `ClientId+Name` (causes duplicate rows on Common Clients)
- ❌ Returning `ex.Message` to the client (leaks internals — log + return a generic message)
- ❌ A single SQL batch that adds a column AND references it (fails at parse time)
- ❌ Action buttons rendered without permission check (operator sees a button that 403s)
- ❌ `whiteSpace: "nowrap"` + `textOverflow: "ellipsis"` on user-supplied names (collapses similar-prefix names visually)
- ❌ Shipping a UI change without confirming it renders (green build ≠ visual proof — DOM-measure `svg`/element or reload the page; e.g. the "invisible icons" report)
- ❌ Retrying POSTs to FBR (can issue duplicate IRN)
- ❌ Logging passwords / JWTs / FBR tokens (use `SensitiveDataRedactor`)
- ❌ Cross-tenant entity links (`Invoice.ClientId` pointing at a `Client` whose `CompanyId` doesn't match)

---

## Quick reference: where to look

| Need | File |
|---|---|
| Add a permission key | `Helpers/PermissionCatalog.cs` |
| Add a tenant guard | use `ICompanyAccessGuard` (registered in `Program.cs`) |
| Clamp page size | `Helpers/PaginationHelper.cs` |
| Redact a new sensitive field | `Helpers/SensitiveDataRedactor.cs` |
| Add CSV-safe export | `Helpers/ExcelTemplateEngine.cs:CsvSafe` |
| Validate an image upload | `Helpers/ImageUploadValidator.cs` |
| Retry on number collision | `Helpers/NumberAllocationRetry.cs` |
| Encrypt at rest | `Helpers/FbrTokenProtector.cs` + EF value converter in `AppDbContext` |
| Audit doc + phased fix plan | `AUDIT_2026_05_13_SECURITY.md` |
| Verify all the above | `scripts/verify_audit_2026_05_13_security.py` |
