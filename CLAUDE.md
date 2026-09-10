# MyApp.Api — Claude Code session standards

You are working on **MyApp.Api**, an FBR Digital Invoicing ERP for Pakistani
wholesalers. Production live at `hakimitraders.runasp.net` (MonsterASP).
Two real tenants today (Hakimi Traders, Roshan Traders); the codebase is
being evolved into a multi-tenant SaaS.

**This file is the single source of truth that every Claude session must
follow.** It is auto-loaded into every conversation — read it once and
treat the rules as non-negotiable unless the user explicitly overrides
them in their message.

## Environments — READ `docs/ENVIRONMENTS.md` BEFORE TOUCHING ANYTHING

There are **three separate production installations** on MonsterASP, not one
product with three stages. Each has its own live database, its own deploy
workflow and its own long-lived branch. A fourth branch carries audit work.

| Branch | Role | Local database |
|---|---|---|
| `master` | Production #1 (`deploy.yml`) | `MyApp_Master_Local` |
| `customize-solution-for-other` | Production #2 (`deploy-other.yml`) | `MyApp_Customize_Local` |
| `feat/importer-ledger-receipts` | Production #3 (`deploy-importer.yml`) | `MyApp_Importer_Local` |
| `fix/audit-2026-08-02` | Audit / security, ahead of `master` — not an environment | `MyApp_Master_Local` |

**These four are the only valid branches.** A short-lived working branch is
fine; delete it when the work lands. Never delete a branch with unique commits.

**Never merge one production line into another.** They have deliberately
diverged (site shape, dozens of migrations). A change asked for on one branch
stays there unless the maintainer asks for a port. Security fixes usually
should reach all three — but each port is a deliberate, reviewed act.

**The branch picks the database by itself.** `Helpers/LocalDevDatabase.cs`
reads `.git/HEAD` at startup and looks the branch up in `local.databases.json`.
Checking out a branch is the whole switch — never edit a connection string to
change environment. Startup prints the database it chose; check that line.

**Local runs never touch a production server.** `Helpers/DevelopmentSqlGuard.cs`
refuses to start a Development process pointed at anything but this machine.
Production databases are **READ-ONLY**, queried from a SQL client for
investigation only — never `INSERT` / `UPDATE` / `DELETE` / `MERGE` /
`TRUNCATE` / `ALTER` / `DROP` / `CREATE` / migrations without a written
override from the maintainer.

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
- **Decimal precision is split by MEANING, not by column (2026-09-02).**
  *Rates* — `UnitPrice`, `AdjustedUnitPrice`, `FixedNotifiedValueOrRetailPrice`,
  `Default{Sale,Purchase}Price`, every `Quantity`, `ReorderLevel` — are
  `decimal(28,12)` (20 columns, migration `20260902084604`). *Money* —
  `LineTotal`, `Subtotal`, `GSTAmount`, `WithholdingTaxAmount`, `GrandTotal`,
  `AmountPaid`, `Payments.Amount`, `JournalLines.Debit/Credit` — stays 2dp
  (4dp on journal lines). So `Math.Round(qty * unitPrice, 2)` on a line total is
  CORRECT and must not be "fixed" to 12: that rounding is what makes
  `12 x 3283.333333333333` book as exactly `39,400.00`.
  - 28, not 30: C# `decimal` carries only 28-29 significant digits, so a wider
    column would not round-trip.
  - A new price/qty input uses `step="any"`. Integer-only UOMs keep `step="1"`
    (`QuantityInput` sanitises fractions away, and the server rejects them).
  - Money inputs keep `step="0.01"`. Do not widen them.
  - FBR is never sent a unit price; the transmitted `Quantity` is pinned to 4dp
    in `FbrService` because that is all PRAL has ever received. Do not widen it
    without testing against PRAL.

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

### 5c-3. Bulk invoice download — ONE service, two authorization scopes (2026-09-09)

`Services/Implementations/InvoiceBulkService.cs` resolves a batch of invoices to
render, and it is the ONLY place that does. Both surfaces call it: the internal
Invoices screen (`Controllers/InvoiceBulkController.cs`) and the public Customer
Portal (`POST .../invoices/bulk`). **The only difference between them is the
`InvoiceBulkScope`** — everything else (selection, template resolution, naming,
date validation, the cap) is shared, so the two cannot drift.

- **Rendering is in the BROWSER, and that is not a shortcut.** There is no
  server-side PDF writer in this solution and the templates are arbitrary
  HTML+CSS, so a .NET PDF library cannot render them without rewriting all ~233
  of them. The split is: server decides WHAT (authorization, selection,
  templates, names), `myapp-frontend/src/utils/bulkInvoiceDocuments.js` decides
  HOW (merge, render, ZIP, consolidated). Both surfaces then share one renderer,
  which is why a bulk PDF of one invoice equals its one-off PDF.
- **`InvoiceBulkScope` has no public constructor** — only `ForUser` and
  `ForPortal`. Same reasoning as `ResolvePortalAttribute` being a filter: the
  check must be impossible to forget on the endpoint someone adds later. A
  request's `clientId` / `divisionId` are FILTERS intersected with the scope and
  can only narrow it.
- **The portal's request type is deliberately smaller.** `PortalBulkRequestDto`
  carries a date window and nothing else, so a customer POSTing `clientId` or
  `templateId` is not rejected — the value has nowhere to land. Absent beats
  validated.
- **ONE request per batch, never one per invoice.** The portal is behind the
  120-per-minute `"portal"` limiter, so a per-invoice loop would trip it at ~120
  documents and look like abuse. The template HTML is therefore sent ONCE per
  distinct template (8–15 KB each) rather than once per invoice.
- **A pinned template must belong to the scope's company**, and a portal may
  never pin one. A template row carries its company's letterhead, logo and
  stamp, so rendering company A's invoice through company B's template produces
  a document with the wrong business's identity on it — refused, not warned.
- **Consolidated print is ONE PDF of real pages, not concatenated HTML.**
  `printLayout.js` pins the signature with `position: fixed; bottom: 0` and a
  document has exactly one such element, so a merged HTML document would print
  invoice 1's signature on every page of invoices 2..N; template CSS is also
  unscoped and would collide. Each invoice is rendered alone and appended with
  `pdf.addPage()`, so the page breaks are physical.
- **Cap is 200 (`InvoiceBulkService.MaxBatchSize`), and `Truncated` must be
  surfaced.** The constraint is browser memory, not SQL. A truncated run that
  reads as a complete one is the worst outcome this feature has.
- Suites: `python scripts/test_invoice_bulk.py` (39 checks — runs the same
  scenarios through BOTH callers and asserts they hand the browser byte-identical
  template html and print data) and `node scripts/test_pdf_page_cuts.mjs`.

### 5c-4. A PDF page break must not cut a line item (2026-09-09)

`myapp-frontend/src/utils/pdfPageCuts.js` decides where each PDF page ends, and
it is a separate dependency-free module so it can be tested under plain node.

**A template cannot fix this.** html2canvas paints the whole document as ONE
continuous bitmap with no concept of a page, so `page-break-inside: avoid` is
inert on the PDF path — it only works on the browser print path, where
`printDocument.js` injects it. The slicer used to advance by a fixed pixel
height, which on a 40-line invoice cut a row through the middle: its top half at
the foot of page 1, its bottom half at the head of page 2, unreadable on both.
Reported against a real 2-page bulk PDF.

`choosePageCuts` now ends each page at the largest block boundary that fits —
the bottom edges of `tr` / `img` / `.no-break`, the same set the print path
protects. A block taller than a page is still cut, because the alternative is an
endless document, and a `minFillRatio` floor stops a page ending just after it
began. All 32 built-in templates emit a `<tr>` per line item, so the fix reaches
every one of them, every operator-created template, and single-invoice exports.

<<<<<<< HEAD
=======
### 5c-1b. Default print templates — one source, two copies (2026-09-10)

`myapp-frontend/src/utils/defaultTemplates.js` is the ONLY place the built-in
Challan / Bill / Tax Invoice designs are written. `scripts/sync_default_print_
templates.mjs` copies them to `Data/DefaultPrintTemplates/*.html`, embedded in
the API for `Helpers/DefaultPrintTemplates.cs`, which (a) seeds the three rows
onto every NEW company in `CompanyService.CreateAsync` and (b) stands in for a
missing row in the bulk download. `usePrintTemplates` does the same on screen:
a scope with no saved template of one of those types prints through the
built-in (division -> company-wide -> built-in), never a disabled button. The
CUSTOMER PORTAL is excluded from the fallback on purpose (5c: the operator's
document choice is absolute; a missing template turns portal printing OFF).
Suites that need a company WITHOUT a template must delete the seeded row first
(`drop_templates` / `drop_seeded_bill_template`). Run
`node scripts/sync_default_print_templates.mjs` after editing a default and
keep `--check` green; the two copies must never be edited by hand.

### 5c-2. Print-template artwork is a FILE, never inline base64 (2026-09-07)

A bespoke print template must reference its logos, letterheads and banners by
URL. Do not paste a `data:image/...;base64,...` URI into a template.

Why: on the Alpha Traders templates the inline artwork was **87% of the Bill
template (65KB) and 90% of the Challan (43KB)**. Those bytes are stored in the
row, re-sent on every render, every editor load and every preview, and they
bloat the print HTML (80KB -> 11KB once hosted).

Where the files go:

```
myapp-frontend/public/print-assets/company-<id>/<name>-<WxH>.png
```

Vite copies `public/` into `dist/`, CI copies `dist/` into `wwwroot/`, so the
asset deploys with the app. It is version-controlled, identical in every
environment, and needs no new public-file mount (it is NOT under `data/`, so
`§5d`'s allowlist does not apply). Uploads under `data/` would also survive —
the FTP action runs `dangerous-clean-slate: false` — but they are not in git and
a fresh environment would render without them.

**Reference it RELATIVELY**, with no leading slash:

```html
<img src="print-assets/company-4/bill-header-915x168.png">
```

`mergeTemplate` injects `<base href="{origin}{BASE_URL}">`, so a relative path
resolves wherever the app is mounted — this installation serves the ERP under
`/admin/`. A ROOT-relative path (`/print-assets/...`) ignores the base path and
404s here; that is exactly why `PrintBillDto.FbrLogoUrl`'s
`/images/fbr-logo.png` does not resolve on a based deployment.

**Both export paths wait for images.** `printDocument.writeAndPrint` has since
the Jorbai Sales Quote bug (2026-06-27); `exportToPdf` and `exportToExcel` gained
it on 2026-09-07 (`waitForImages`, awaiting `decode()` with a 5s cap). Without
that, html2canvas rasterises a still-loading image as nothing and the PDF loses
a logo while its text renders fine. If you add another export path, wait there
too or hosted artwork will be intermittently blank.

Prove a swap changed nothing: merge the template before and after and compare
the flow height (`.tail` bottom) — it must be identical to the pixel. On the
Bill it was 1049px both ways.

>>>>>>> f902702 (Seed default print templates on new companies, fall back to built-in)
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
- **An EMPTY sale type is not an error; it is the company default** (2026-09-10).
  `Helpers/FbrSaleTypeDefaults.cs` resolves it (company `FbrDefaultSaleType`,
  else FBR's `Goods at Standard Rate (default)`), and `utils/saleType.js`
  mirrors it for the three bill forms' scenario filter. The HS tariff import
  creates item types with no sale type and nothing asks for one on adoption, so
  a live tenant's every item carried NULL: pre-flight refused every invoice
  and the edit forms' picker dropped the bill's own item. Do not reintroduce a
  "Sale Type is required" check or a `saleType === target` filter.
- **Resolve a line's UoM against the HS CODE's valid list, not the company-wide
  one** (`FbrService.ResolveUomDesc`, HS first). FBR's catalog lists "Pcs",
  "NO" and "Kilogram" as units in their own right, so an exact match against
  the whole list sent "Pcs" for 8481.1000 and FBR answered `[0099]`; only
  "Numbers, pieces, units" is valid there. `Helpers/FbrUomAliases.SameUnit` is
  the ONE spelling rule (families: pcs/nos/units, kg/kgs, mtr/m, …) and both
  the pre-flight and the payload builder use it, so what passes is what is sent.
- **An NTN is SEVEN CHARACTERS, and a letter counts** (2026-09-10). IRIS issues
  `A113680-1`; FBR's invoice API takes `A113680` (letter kept, check digit
  dropped) and answers Valid. `A113680-1` is `[0002]`, `A1136801` is `[0002]`,
  and the digits-only `1136801` is a DIFFERENT number FBR calls Unregistered,
  so every bill for such a buyer was `[0205]` while the sanitiser stripped
  letters. `Helpers/FbrBuyerIdentity.Resolve` is the ONE rule for a buyer's
  number (pre-flight, payload, challan readiness, and the client form's
  "Check with FBR"); a CNIC is an alternative, never a requirement.
- **A buyer's STRN is not an FBR field.** The buyer block is NTN/CNIC, name,
  province, address, registration type. `DeliveryChallanService.IsFbrReady`
  gates a Registered buyer on NTN-or-CNIC and an Unregistered one on nothing;
  it used to demand an STRN and an NTN from every client.

### 11. SQL Server gotchas

- **A single batch that both ALTERs a table and references the new column will fail at parse time** even when execution is guarded by `IF NOT EXISTS`. Split into separate `ExecuteSqlRaw` calls. Wrap column-dependent statements in `EXEC('...')` so they're parsed only at execution time. See `Program.cs:SecurityStamp backfill` for the pattern.
- Idempotent backfills mark completion in an AuditLog row (`ExceptionType = '<NAME>_BACKFILL_V1'`). RBAC bootstrap also gates on `UserRoles.Any()` so a truncated AuditLogs table can't re-grant Administrator.

### 12. EF Core

- Never run two `AppDbContext` operations concurrently — it's not thread-safe.
- Reads: `.AsNoTracking()`.
- Migrations auto-apply at startup when `Database:AutoMigrate` is true (default). Production may flip false.
- DataProtection encrypts `Company.FbrToken` via EF value converter; legacy plaintext payloads pass through reads and re-encrypt on next save.
- **A null `Company.FbrToken` is never written over an existing value.** `Unprotect` fails closed to null when the key ring cannot read an `enc:v1:` payload, so `AppDbContext.PreserveUnreadableFbrTokens` (runs inside every `SaveChanges`) drops the property from a Modified Company's UPDATE whenever its CLR value is null — `DbSet.Update()` marks every column modified and would otherwise erase the ciphertext on the first bill. Null means "unreadable or absent", never "clear"; the API clears with `""`. Suite: `scripts/test_fbr_token_unreadable_survives_save.py --db "<conn>"` (22 checks).

---

## Test discipline — required before any push

| Check | Command | Must show |
|---|---|---|
| Backend build | `dotnet build MyApp.Api.csproj` | `0 Error(s)` |
| Audit verifier (static) | `python scripts/verify_audit_2026_05_13_security.py` | `67/67 checks passed` |
| Audit verifier (live, optional but recommended) | `python scripts/verify_audit_2026_05_13_security.py --live` | `73/73 checks passed` |
<<<<<<< HEAD
| Basic flows | `python scripts/test_basic_flows.py` | `all PASS` |
=======
| Basic flows | `python scripts/test_basic_flows.py` | `all PASS` (72 checks) |
>>>>>>> f902702 (Seed default print templates on new companies, fall back to built-in)
| Tenant isolation | `python scripts/test_tenant_isolation.py` | `all PASS` |
| Stock item-type reflow (V1) | `python scripts/test_stock_itemtype_reflow.py` | `76/76 checks passed` |
| Unreadable FBR token survives Company saves | `python scripts/test_fbr_token_unreadable_survives_save.py --db "<conn>"` | `22/22 checks passed` |
| Inventory V2 lifecycle | `python scripts/test_stock_v2_lifecycle.py` | `29/29 checks passed` |
| Division isolation | `python scripts/test_division_isolation.py` | `all checks passed` |
| Document copy | `python scripts/test_document_copy.py` | `184/184 checks passed` |
| Customer Portal (incl. IDOR suite) | `python scripts/test_customer_portal.py` | `94/94 checks passed` |
| Accounting reports | `python scripts/test_accounting_reports.py` | `315/315 checks passed` |
| Public file allowlist | `python scripts/verify_public_file_allowlist.py` | `10/10 checks passed` |
| Print pagination (offline) | see `PRINT_TEMPLATE_GUIDE.md` §11 | `0 failing cases` |
| PDF page breaks never cut a line item (offline) | `node scripts/test_pdf_page_cuts.mjs` | `10 passed, 0 failed` |
| Bulk invoice download / consolidated print, through BOTH callers | `python scripts/test_invoice_bulk.py` | `39 passed, 0 failed` |
| Permission-section mapping (static) | `python scripts/verify_permission_sections.py` | `All permission modules are mapped` |
<<<<<<< HEAD
=======
| Default print templates in sync with the frontend (static) | `node scripts/sync_default_print_templates.mjs --check` | `default print templates are in sync` |
| Stock dashboard Excel export (offline layout) | `cd scripts/stock_export_harness && dotnet run -c Release` | `STOCK EXPORT HARNESS PASSED` (64 checks) |
| Stock dashboard Excel export (live, ties to the grid) | `python scripts/test_stock_export_excel.py` | `STOCK EXPORT LIVE SUITE PASSED` (37 checks) |
| FBR duplicate-submit prevention (live sandbox) | `python scripts/test_fbr_no_double_submit.py --fbr-token <sandbox> --db-name <branch db>` | `11 passed, 0 failed` (1 skipped with a live token) |
| FBR cancellation + reversal releases challans | `python scripts/test_fbr_cancellation.py --db "<conn>"` | `26/26 checks passed` |
| FBR sandbox E2E (Importer + Exporter, scenario matrix) | `python scripts/test_fbr_sandbox_e2e.py --fbr-token <sandbox>` | see the suite banner; skips every live suite without a token |
| FBR permissions (validate / submit / reset are separate) | `python scripts/test_fbr_rbac.py --fbr-token <sandbox>` | `18/18 checks passed` |
| Inventory Overlay (two books, one total; normal mode unchanged) | `python scripts/test_inventory_overlay.py` (add `--db <branch db>` for the submitted-lock case) | `71/71 checks passed` (1 skipped without `--db`) |
>>>>>>> f902702 (Seed default print templates on new companies, fall back to built-in)
| PO parser corpus (offline) | `cd scripts/po_parser_harness && dotnet run -c Release` | `ALL REGRESSION CORPORA PASSED` |
| PO parser vs prod PDFs (read-only) | `python scripts/po_parser_prod_regression.py` (see guide) | `REGRESSIONS 0` |
| No production identifiers in tracked files | `python scripts/verify_no_production_identifiers.py` | `no production identifiers in tracked files` |

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
- Item-description casing collision (a typed item name that already exists in
  the global catalog under another case, or with a trailing space, must still bill)

The stock-reflow script (`scripts/test_stock_itemtype_reflow.py`) proves
inventory stays settled when item types change — it spins up an ephemeral
tracking-enabled company and asserts on-hand after each edit:
- Purchase bill: create IN, change item type (reverse old + add new), change qty, switch to an un-classified (no-HS) item (no IN), delete (reverse).
- Classify-after-create **phantom guard**: a bill created against a no-HS item records no IN; classifying the item then editing must NOT fabricate a negative reversal.
- Invoice OUT via **narrow** item-type edit (`PATCH /itemtypes`), **full** edit (`PUT /{id}`), and the **challan-driven** add/remove/qty path — each reverses the old item's OUT and re-records on the new, restores on clear/remove, and reverses on delete.

---

## Git workflow

### Commit identity — MANDATORY, every branch, every session

**This project is PERSONAL work, not Kinetic work.** Every commit on every branch
must be authored as the personal GitHub account `huzefa5152`, and every push must
go from that account.

```
user.name  = Huzefa Hussain
user.email = 45231321+huzefa5152@users.noreply.github.com
```

The noreply address is what makes GitHub attribute the commit to `huzefa5152`.
It is set **repo-local** (`git config --local`), which covers every branch
automatically. Verify before your first commit of a session:

```bash
git config user.email        # must be the 45231321+huzefa5152 address
gh auth status               # active account must be huzefa5152
```

**Never fix this by changing the global config.** The machine's global identity is
the Kinetic one (`huzefa.hussain@kineticsoftware.com`) and must stay that way for
kx.payments / kinetic-software work. If a commit lands with the wrong author, fix
it with `git commit --amend --reset-author` before pushing.

**Cherry-picks preserve the ORIGINAL author.** Picking a commit that was made
under the Kinetic identity carries that identity across, even with the repo-local
config set. Follow with `git commit --amend --reset-author` when you want the
branch's authorship uniform — or leave it deliberately and say so, since the
original author is honest provenance for a transplanted commit.

### Everything else

- Branch from `origin/master`: `fix/...` or `feat/...`
- Imperative commit subjects ("Fix dashboard duplicates", not "Fixed" / "This fixes")
- Commit-per-phase for large changes
- **Never** include `Co-Authored-By: Claude …` or any AI-attribution footer — global rule from user memory
- Ask before commit AND push every time (each needs fresh confirmation)
- With several agents or sessions live in one tree, stage explicit paths —
  `git commit -F <msgfile> -- <paths>`. A bare `git add -A` has already swept one
  agent's work into another's commit and silently clobbered a third's edit.
- `wwwroot/` is **gitignored** and has no tracked files on any branch; CI rebuilds
  it on every deploy. Do not commit it, and do not `git add -f` it.

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
- DataProtection keys persist to `data/keys/` — if MonsterASP wipes that on redeploy, previously-encrypted `Company.FbrToken` values become unreadable (Unprotect returns null → operator re-enters token). The ciphertext itself is preserved — `AppDbContext.PreserveUnreadableFbrTokens` keeps a Company save from writing that null back (2026-09-10) — so restoring the original key ring restores the token. Verify persistence after first deploy.
- `ForwardedHeaders:KnownProxies` should be populated with MonsterASP's proxy IPs once known (audit C-12) so the rate-limit partition key uses the real client IP.
- Two real tenants currently: **Hakimi Traders** (CompanyId=1) and **Roshan Traders** (CompanyId=2). Do not modify their existing data without explicit say-so.

---

## Never name production in a tracked file

**This repository is PUBLIC.** The production databases sit on a public host
whose subdomain IS the database name, and the SQL username is the database name
too — so a database name written into a comment, a guide or a docstring hands
out two thirds of a working credential. The MonsterASP FTP hosts are the same
shape.

**Never commit** a production database name, SQL host, FTP host, login,
password, API key or FBR token — not in prose, not in a code comment, not in a
migration comment, not in a docstring, not in a commit message. Write a
placeholder:

```
<master-prod-db>   <customize-prod-db>   <importer-prod-db>
<prod-sql-host>    <prod-ftp-host>
```

Real values live in the gitignored `production.databases.json` and in GitHub
Actions secrets. `RESTORE FILELISTONLY` reads the real logical names straight
out of a backup, so a runbook never needs to state them.

`python scripts/verify_no_production_identifiers.py` enforces this — run it
whenever you touch docs, comments or scripts. Deliberate exceptions live in an
explicit list inside that script, each with a reason saying what would have to
happen for it to go away.

**Scrubbing after the fact is not a fix.** It cleans the current tip; the names
stay in the pushed history and are recoverable from it. That is why the rule is
"never write it down", not "clean it up later" — on 2026-09-09 a scrub across
16 files was needed precisely because that had not been the rule.

---

## Anti-patterns I keep finding (don't repeat them)

- ❌ Naming a production database / SQL host / FTP host in any tracked file (prose, code comment, migration comment, docstring). The repo is PUBLIC and the database name is also the SQL username — use a placeholder; `scripts/verify_no_production_identifiers.py` fails on it.
- ❌ Trusting `dto.CompanyId` from request body without `_access.AssertAccessAsync`
- ❌ Grouping dashboard aggregates by `ClientId+Name` (causes duplicate rows on Common Clients)
- ❌ Returning `ex.Message` to the client (leaks internals — log + return a generic message)
- ❌ A single SQL batch that adds a column AND references it (fails at parse time)
- ❌ Action buttons rendered without permission check (operator sees a button that 403s)
- ❌ `whiteSpace: "nowrap"` + `textOverflow: "ellipsis"` on user-supplied names (collapses similar-prefix names visually)
- ❌ Shipping a UI change without confirming it renders (green build ≠ visual proof — DOM-measure `svg`/element or reload the page; e.g. the "invisible icons" report)
- ❌ Retrying POSTs to FBR (can issue duplicate IRN)
- ❌ Widening a MONEY column or money input to 12dp because a price needed it.
  Money is currency; a sub-paisa total breaks the GL, aging, reconciliation and
  the accounting reports that cross-check to the paisa. Precision belongs on the
  rate, and the line total rounds it back to money.
- ❌ Logging passwords / JWTs / FBR tokens (use `SensitiveDataRedactor`)
- ❌ Cross-tenant entity links (`Invoice.ClientId` pointing at a `Client` whose `CompanyId` doesn't match)
- ❌ Treating a null `Company.FbrToken` as "clear the token" — null is what an unreadable ciphertext decrypts to, and writing it back destroys the token (2026-09-10). Clear with `""`; `AppDbContext.PreserveUnreadableFbrTokens` drops null from every Company UPDATE.
- ❌ De-duplicating against a UNIQUE index with a case-sensitive C# check.
  SQL Server's default collation is **CI + ANSI PadSpace**, so `"X"`, `"x"` and
  `"X "` are ONE key. A SQL probe that matches, followed by an ordinal
  `existing.Contains(name)` that doesn't, inserts a row the index then rejects.
  Route item names and unit names through `ItemDescriptionRegistry` /
  `UnitRegistry`. Worse inside a create that carries a
  `when (NumberAllocationRetry.IsUniqueViolation(ex))` handler: that predicate
  matches 2601/2627 from *any* index, so the duplicate is misdiagnosed as a
  document-number collision and the operator is told numbering failed.

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
| Register a typed item name / unit | `Helpers/ItemDescriptionRegistry.cs`, `Helpers/UnitRegistry.cs` |
| Encrypt at rest | `Helpers/FbrTokenProtector.cs` + EF value converter in `AppDbContext` |
| Audit doc + phased fix plan | `AUDIT_2026_05_13_SECURITY.md` |
| Verify all the above | `scripts/verify_audit_2026_05_13_security.py` |
