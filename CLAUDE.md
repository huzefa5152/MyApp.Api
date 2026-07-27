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

### 3. Responsive UI — MANDATORY on every screen

**Every new feature screen, form, modal, table and list MUST be designed for
all three breakpoints and give the best UX for the flow on each — this is a
hard standard, not a nice-to-have.** Full patterns + recipes live in
`RESPONSIVE_UI_GUIDE.md` (read it before building any UI). The essentials:

- Test at **375px** (phone), **768px** (tablet), **1280px** (desktop). **No horizontal page scroll on a phone**, ever.
- Grids: `gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))"` — collapses to one column on phones with no media queries. NEVER hardcode `"1fr 1fr 1fr"` on a form grid.
- **Line-item entry** → use the shared **`Components/LineItemsEditor.jsx`** (responsive table/cards + desktop keyboard quick-add) for any new quote/order/challan-style grid. For FBR/complex tables that can't adopt it, render a responsive branch `{isNarrow ? <stacked cards> : <existing table>}` (breakpoint 760px, `resize` listener) — reuse the existing cells/handlers, change no logic, keep the desktop `<table>` intact. Wide tables (`overflowX:auto` + `minWidth`) are a phone anti-pattern — give them a card view.
- **Modals** → use the shared `formStyles` from `theme.js` (backdrop `position:fixed; inset:0; display:flex; overflowY:auto; padding`; modal `maxHeight:96vh`; body `overflowY:auto; flex:1`). This never clips. **Never** use `display:grid; placeItems:center` with no `overflowY` on an overlay — a card taller than the viewport gets its top clipped unreachable (CorrectionWizard bug, 2026-07-27).
- **Icon buttons**: `display:grid; placeItems:center; padding:0; boxShadow:none` — the `padding:0`/`boxShadow:none` override the global `button` rule in index.css that otherwise off-centres the glyph and adds a shadow. Tap targets ≥ 44×44 px.
- Long names: `display: "-webkit-box"; WebkitLineClamp: 2; WebkitBoxOrient: "vertical"` — DO NOT use `whiteSpace: "nowrap"` + `textOverflow: "ellipsis"` on user-supplied strings (it collapsed "MEKO FABRICS" and "MEKO DENIM" into identical-looking rows, see dashboard incident 2026-05-13).
- Picker dropdowns: full-width on phone (`flex: 1`), capped on desktop (`maxWidth: 260`).
- **Verify** every UI change at 375/768/1280 (browser or `resize_window`) before calling it done — compile ≠ verified.

### 4. Data integrity

- Document numbers (`InvoiceNumber`, `PurchaseBillNumber`, `GoodsReceiptNumber`) are **UNIQUE** per `CompanyId`. Create paths must wrap in retry-on-conflict via `MyApp.Api.Helpers.NumberAllocationRetry`.
- `DeliveryChallan.ChallanNumber` is **non-unique by design** — the Duplicate Challan flow emits same-number rows intentionally. Do not add a unique index.
- Multi-step writes use `BeginTransactionAsync` with explicit commit/rollback.
- Cross-tenant link guard: when writing a record that references a `Client`/`Supplier`/`Invoice`, verify `child.CompanyId == parent.CompanyId`.
- Demo invoices (`IsDemo = true`) are **excluded** from every dashboard KPI and from the real numbering sequence.

### 5. Dashboard / aggregation grouping

- Sales-by-client / purchases-by-supplier: group by `Client.ClientGroupId ?? -ClientId` (and `Supplier.SupplierGroupId ?? -SupplierId`). Same legal entity across tenants merges; legacy rows without a group fall back to ClientId. See `Services/Implementations/DashboardService.cs:ComputeSalesAsync`.

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

> ### 🔴 HARD PRE-PUSH GATE — inventory flow (non-negotiable)
> **Claude runs every push and deploy for this repo — the operator does not.**
> So this gate lives here, not in CI. **Before ANY `git push` that reaches
> `master`** (a direct push, or a merge/PR that lands on it), you MUST:
> 1. have a backend running against a schema-current DB, and
> 2. run `python scripts/test_stock_itemtype_reflow.py` and see **`all checks
>    passed`** (currently **140/140**).
>
> If it is **red**, or you **cannot run it**, **DO NOT PUSH.** A broken inventory
> in/out flow must never reach master — ever. Run it even when the change looks
> unrelated to stock (stock reflow is reachable from invoice, bill, challan, and
> the FBR dual-book overlay paths). No exceptions, no "it's a tiny change."

| Check | Command | Must show |
|---|---|---|
| Backend build | `dotnet build MyApp.Api.csproj` | `0 Error(s)` |
| Audit verifier (static) | `python scripts/verify_audit_2026_05_13_security.py` | `67/67 checks passed` |
| Audit verifier (live, optional but recommended) | `python scripts/verify_audit_2026_05_13_security.py --live` | `73/73 checks passed` |
| Basic flows | `python scripts/test_basic_flows.py` | `all PASS` |
| Tenant isolation | `python scripts/test_tenant_isolation.py` | `all PASS` |
| Stock item-type reflow **(hard pre-push gate — see box above)** | `python scripts/test_stock_itemtype_reflow.py` | `all checks passed` (currently `140/140`) |
| PO parser corpus (offline) | `cd scripts/po_parser_harness && dotnet run -c Release` | `ALL REGRESSION CORPORA PASSED` |
| PO parser vs prod PDFs (read-only) | `python scripts/po_parser_prod_regression.py` (see guide) | `REGRESSIONS 0` |

**PO parser / import changes — MANDATORY.** Any change to
`Services/Implementations/RuleBasedPOParser.cs` or the import flow
(`Controllers/POImportController.cs`, `myapp-frontend/src/Components/POImportForm.jsx`)
must keep BOTH the offline corpus harness AND the production read-only check
green, and add corpus cases for the new behaviour. Full runbook (parser
internals, feedback system, cross-branch cherry-pick, prod-check setup) is in
`PO_IMPORT_PARSER_GUIDE.md`.

If you add a new endpoint that takes `companyId`, add a tenant-isolation
case to `scripts/test_tenant_isolation.py`. If you touch invoice/bill
math, add the case to `scripts/test_basic_flows.py`. If you touch stock
movement reflow (purchase/invoice/challan edits, StockService), add the
case to `scripts/test_stock_itemtype_reflow.py`.

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
- **FBR dual-book overlay matrix (suites 8–13)** — the tax-consultant adjustment path (`PATCH /invoices/{id}/itemtypes-and-qty` `writeMode:"adjustment"`, which writes `InvoiceItemAdjustment.AdjustedItemTypeId`/`AdjustedQuantity` and leaves the physical line untouched). Stock keys off the **effective** type/qty (`Adjusted?? physical`, mirroring `FbrService`): a non-HS base reclassified to HS gets its OUT on the HS type; an HS→HS→HS reclassification chain reverts the old type and OUTs the new each hop; a bill (PUT) edit under an overlay reflows physical qty only while no filed qty is set, then the filed qty wins; repeated qty re-adjustment tracks the latest; multi-line overlays stay independent; challan qty changes reflow onto the overlay type; every case reverses on revert-to-base and on delete.

---

## Git workflow

- Branch from `origin/master`: `fix/...` or `feat/...`
- Imperative commit subjects ("Fix dashboard duplicates", not "Fixed" / "This fixes")
- Commit-per-phase for large changes
- **Never** include `Co-Authored-By: Claude …` or any AI-attribution footer — global rule from user memory
- Ask before commit AND push every time (each needs fresh confirmation)
- Frontend bundle rebuild goes in the **same commit** as the source change that necessitated it

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
