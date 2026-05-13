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

### 3. Mobile-first UI

- Grids: `gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))"` — collapses to one column on phones with no media queries
- Test at **375px** (phone), **768px** (tablet), **1280px** (desktop)
- Long names: `display: "-webkit-box"; WebkitLineClamp: 2; WebkitBoxOrient: "vertical"` — DO NOT use `whiteSpace: "nowrap"` + `textOverflow: "ellipsis"` on user-supplied strings (it collapsed "MEKO FABRICS" and "MEKO DENIM" into identical-looking rows, see dashboard incident 2026-05-13)
- Tap targets ≥ 44×44 px
- Picker dropdowns: full-width on phone (`flex: 1`), capped on desktop (`maxWidth: 260`)

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

| Check | Command | Must show |
|---|---|---|
| Backend build | `dotnet build MyApp.Api.csproj` | `0 Error(s)` |
| Audit verifier (static) | `python scripts/verify_audit_2026_05_13_security.py` | `67/67 checks passed` |
| Audit verifier (live, optional but recommended) | `python scripts/verify_audit_2026_05_13_security.py --live` | `73/73 checks passed` |
| Basic flows | `python scripts/test_basic_flows.py` | `all PASS` |
| Tenant isolation | `python scripts/test_tenant_isolation.py` | `all PASS` |

If you add a new endpoint that takes `companyId`, add a tenant-isolation
case to `scripts/test_tenant_isolation.py`. If you touch invoice/bill
math, add the case to `scripts/test_basic_flows.py`.

The basic-flow script covers (see `scripts/test_basic_flows.py` for detail):
- Challan creation
- Bill creation **from** a challan
- Bill creation **without** a challan (standalone)
- Invoice update (description / qty / unit-price → totals reflow)
- Item Rate History (quantity-suggestion source on bill form)
- Tax calculation correctness (standard 18% GST, exempt 0%, 3rd Schedule retail price)

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
