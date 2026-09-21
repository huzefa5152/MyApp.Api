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

There are **four separate production installations** on MonsterASP, not one
product with four stages. Each has its own live database, its own deploy
workflow and its own long-lived branch. A fifth branch carries audit work.

| Branch | Role | Local database |
|---|---|---|
| `master` | Production #1 (`deploy.yml`) | `MyApp_Master_Local` |
| `customize-solution-for-other` | Production #2 (`deploy-other.yml`) | `MyApp_Customize_Local` |
| `feat/importer-ledger-receipts` | Production #3 (`deploy-importer.yml`) | `MyApp_Importer_Local` |
| `TraderFbrInvoicingSystem` | Production #4 (`deploy-trader.yml`) | `MyApp_Trader_Local` |
| `fix/audit-2026-08-02` | Audit / security, ahead of `master` — not an environment | `MyApp_Master_Local` |

**These five are the only valid branches.** A short-lived working branch is
fine; delete it when the work lands. Never delete a branch with unique commits.

**Never merge one production line into another.** They have deliberately
diverged (site shape, dozens of migrations). A change asked for on one branch
stays there unless the maintainer asks for a port. Security fixes usually
should reach all four — but each port is a deliberate, reviewed act.

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
>    passed`** (currently **166/166**).
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
| Line arithmetic — qty / unit price / line total derive each other (offline) | `node scripts/test_line_amount.mjs` | `23 passed, 0 failed` |
| Grouped quantity spread — no bill line left at zero (offline) | `node scripts/test_group_quantity_split.mjs` | `21 passed, 0 failed` |
| Invoice exact line total — the consultant's adjustment re-sums to the bill | `python scripts/test_invoice_exact_line_total.py` | `69/69 checks` |
| Every screen is behind a permission (offline) | `node scripts/test_route_permissions.mjs` | `142 passed, 0 failed` |
| Product editions + the no-escalation rule, proven end to end | `python scripts/test_edition_roles.py` | `80/80 checks` |
| Every company-scoped action asserts the companyId it was handed (offline) | `python scripts/verify_tenant_scope.py` | `every company-scoped action is guarded` |
| Cross-tenant leak sweep — both editions against a company they were never given | `python scripts/test_tenant_leak_sweep.py` | `105/105 checks` |
| Every permission module lands in a navbar section (offline) | `python scripts/verify_permission_sections.py` | `All permission modules are mapped` |
| Accounting — chart of accounts | `python scripts/test_accounting_chart.py` | `103/103 checks` |
| Accounting — general ledger core | `python scripts/test_accounting_gl.py` | `93/93 checks` |
| Accounting — further tax + withholding on documents | `python scripts/test_document_taxes.py` (add `--db "<conn>"` for the credit-note suite) | `67/67 checks` (62 without `--db`) |
| Accounting — posting from documents | `python scripts/test_accounting_posting.py` (add `--db "<conn>"` for the note + demo-bill suites) | `82/82 checks` (72 without `--db`) |
| Accounting — reports | `python scripts/test_accounting_reports.py` | `55/55 checks` |
| Customer portal — the only anonymous surface (IDOR suite) | `python scripts/test_customer_portal.py` | `73/73 checks` |
| Accounting — one-shot GL back-post | `python scripts/test_gl_backfill.py --db "<conn>"` | `46/46 checks` |
| Deleting an item type that still holds stock is refused | `python scripts/test_item_type_delete_guard.py` | `5/5 checks passed` |
| Bill / invoice numbering — Auto vs a hand-typed number, both create paths + renumbering on edit | `python scripts/test_custom_bill_number.py` (add `--db "<conn>"` for the FBR-filed lock suite) | `47/47 checks passed` (5 skipped without `--db`) |
| Admin scope isolation (seed / Administrator trees, Tenant Access, IDOR) | `python scripts/test_admin_scope_isolation.py` | `all checks passed` (currently `115/115`) |
| FBR cancellation + reversal releases challans | `python scripts/test_fbr_cancellation.py --db "<conn>"` | `26/26 checks passed` |
| Stock item-type reflow **(hard pre-push gate — see box above)** | `python scripts/test_stock_itemtype_reflow.py` | `all checks passed` (currently `166/166`) |
| PDF export pagination | `python scripts/test_pdf_pagination.py` | `all checks passed` (230 cases) |
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

**Print/PDF export changes.** Any change to `myapp-frontend/src/utils/exportUtils.js`,
`printDocument.js`, or a tax-invoice template must keep
`python scripts/test_pdf_pagination.py` green. It drives the real `exportToPdf()`
in headless Chromium (`pip install playwright && python -m playwright install chromium`;
no backend or DB needed) across item counts × substituted font stacks × device
pixel ratios, and asserts the two invariants: every production-shape invoice
exports as one page on any font, and a page cut never runs through the FBR
block — a sliced QR does not scan. Add `--prod-template "<conn str>"` to also
run the live per-company template, and `--engines chromium,firefox` for
cross-engine coverage.

If you add a new endpoint that takes `companyId`, add a tenant-isolation
case to `scripts/test_tenant_isolation.py`. If you add or change an endpoint that
reads or writes users, roles-on-users or tenant-access grants, add the
seed / Admin A / Admin B case to `scripts/test_admin_scope_isolation.py`
(see the **Management scope** section in `IManagementScopeService`). If you touch invoice/bill
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
- **Oversell guard (suite 14, 2026-09-11)** — an invoice edit or consultant adjustment that takes an HS item below zero saves with `stockWarnings` on the response while `Company.StockGuardHardBlock` is off, and is refused (400, rolled back) when it is on; a full edit under a live overlay stays governed by the filed qty. The form shows the same projection inline and asks "You are out of this inventory. Save anyway?".
- **FBR dual-book overlay matrix (suites 8–13)** — the tax-consultant adjustment path (`PATCH /invoices/{id}/itemtypes-and-qty` `writeMode:"adjustment"`, which writes `InvoiceItemAdjustment.AdjustedItemTypeId`/`AdjustedQuantity` and leaves the physical line untouched). Stock keys off the **effective** type/qty (`Adjusted?? physical`, mirroring `FbrService`): a non-HS base reclassified to HS gets its OUT on the HS type; an HS→HS→HS reclassification chain reverts the old type and OUTs the new each hop; a bill (PUT) edit under an overlay reflows physical qty only while no filed qty is set, then the filed qty wins; repeated qty re-adjustment tracks the latest; multi-line overlays stay independent; challan qty changes reflow onto the overlay type; every case reverses on revert-to-base and on delete.

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

## Production deploy notes

- Live host: **MonsterASP** at `hakimitraders.runasp.net`
- `appsettings.Production.json` provides `Jwt:Key` + `ConnectionStrings` — never committed (gitignored)
- DataProtection keys persist to `data/keys/` — if MonsterASP wipes that on redeploy, previously-encrypted `Company.FbrToken` values become unreadable (Unprotect returns null → operator re-enters token). Verify persistence after first deploy.
- `ForwardedHeaders:KnownProxies` should be populated with MonsterASP's proxy IPs once known (audit C-12) so the rate-limit partition key uses the real client IP.
- Two real tenants currently: **Hakimi Traders** (CompanyId=1) and **Roshan Traders** (CompanyId=2). Do not modify their existing data without explicit say-so.

---

## Reversing a sale: challans, stock and what stops being a sale (2026-09-04)

A filed sale stops being a sale in exactly two ways, and BOTH must hand the
goods back. Getting this wrong stranded three of Hakimi's challans (4387, 4391,
4393) behind reversed bills 3912 and 3913 — the goods could not be re-billed
because the challans stayed `Invoiced` against a bill reversed to nothing.

- **A challan is billable again only when BOTH are true:** `Status IN
  ('Pending','Imported')` (`DeliveryChallanRepository.GetPendingChallansByCompanyAsync`)
  AND `InvoiceId IS NULL` (the bill form's own filter). Setting one without the
  other leaves it invisible. `InvoiceService.ReleaseChallans` is the ONE place
  that does it — and the transition is not simply "Pending": an imported challan
  goes back to `Imported` and a PO-less one to `No PO`.
- **A FULL credit note releases the challans; a PARTIAL one does not.** Part of
  the bill still stands. A DEBIT note never releases anything — it increases the
  bill rather than reversing it.
- **`Invoice.FbrCancelledAt` is NOT `IsCancelled`.** FBR lets a filed invoice be
  withdrawn on their portal within 72 hours; this records that the operator did
  so. The bill keeps its number and its IRN and stays visible with a marker,
  because it really was filed and then withdrawn. Voiding a filed bill is
  refused precisely because it would desync us from FBR; this is the honest
  alternative. No note document is created.
- **Stock comes back ONCE.** `StockAlreadyReturnedByNoteAsync` is the guard: a
  live credit note with `NoteAffectsStock = true` has already booked the inward
  half, so the FBR-cancel path must NOT also purge the bill's movements — doing
  both leaves the note's inward half unmatched and on-hand climbs by the
  quantity sold.
- **The Sales Report drops a withdrawn bill AND one reversed in full.** That
  report lists sale invoices only (`NoteKind == 0`) and never shows the
  offsetting note, so leaving them in reports revenue that was given back
  entirely. A partly reversed bill stays. The Tax Sheet and the pending-FBR list
  need no such filter: both select `FbrSubmittedAt == null`, so a filed-then-
  withdrawn bill cannot appear in either.
- Suite: `scripts/test_fbr_cancellation.py` (26 checks). It needs `--db` to fake
  the filing, because none of these paths is reachable on an unfiled bill.

## The accounting module and the two editions (2026-09-19)

The Trader line carries a full double-entry accounting module — chart of
accounts, general ledger, journal entries, accounting reports and a public
customer portal — on top of the sales product. It is **sold two ways**, so the
boundary between them is a thing the code has to keep, not a sales promise.

### The editions

`Helpers/EditionCatalog.cs` is the definition, and `Data/RbacSeeder.cs` keeps
two **system roles** in step with it on every start:

- **Sales Edition** — the whole sales, purchase, inventory and FBR product,
  including receipts and payments. No general ledger.
- **Complete Edition** — the above plus the accounting module.

Three things about that split are deliberate and easy to undo by accident:

- **It is by key PREFIX, not by the catalog's `Module` column.**
  `accounting.receipts.*`, `accounting.payments.*` and
  `accounting.paymentstatus.*` share the `accounting.` namespace but predate the
  module and need no ledger. Splitting on `Module == "Accounting"` strands them
  in Complete and a Sales tenant cannot take a payment.
- **Neither edition carries `rbac.*`, `users.*`, `tenantaccess.*` or
  `auditlogs.*`.** This is load bearing, not tidiness: `RolesController` accepts
  any catalog key when a role is edited, so a tenant holding
  `rbac.roles.update` could add the accounting keys to their own role and walk
  through the boundary. Administration of the software stays with whoever
  operates it. If tenant self-administration is ever wanted, add the
  "may only grant what you hold" rule to `RolesController` and
  `UserRolesController` FIRST.
- **They are system roles**, so `RolesController` refuses update and delete on
  them and an edition cannot drift. A variation is a CLONE, not an edit.

### Tenant administrators, and the rule that bounds them

A third system role, **Tenant Administrator**, carries the administration keys
and no product features: create staff accounts, build roles for them, grant them
companies. It is assigned ALONGSIDE an edition — "Sales Edition + Tenant
Administrator" is the Sales admin — so a new edition costs no new admin role.

One key is deliberately absent from it: `tenantaccess.manage.update`, because
that toggles `Company.IsTenantIsolated`, which decides who can see a company at
all — a platform decision, not a tenant one.

`auditlogs.view` IS in it, but only since the audit log was **scoped by company**
(2026-09-21). It was one unscoped table: that single key read every tenant's
activity, and it was safe only because no tenant role carried it. `AuditLog`
already had a nullable `CompanyId`, so scoping needed no migration —
`AuditLogsController` now passes the caller's accessible companies down to the
repository, and the seed admin passes null for "everything".

**A scoped caller does not see the CompanyId-less rows**, and that is the point
rather than an oversight: login failures, startup and anything raised outside a
company context are platform events. It means a tenant's log is honestly partial
— locally 33 of 327 rows carry a company — rather than misleadingly complete. If
the log is ever un-scoped again, take `auditlogs.view` back out of the role.

**What actually bounds an administrator is `RolesController.GrantableKeysAsync`:
nobody may put a key into a role, or assign a role carrying one, unless they hold
it themselves.** Without it the editions were decoration once tenant admins
existed — every SYSTEM role is visible to everyone (that is what lets an admin
hand out the edition they are on), so an administrator on Sales Edition could
see Complete Edition in the picker and assign it, to their staff or to
themselves. **Visible is not grantable**, and that distinction is the boundary.
It needs no new permission key, and it cannot be walked around through the
management tree, because an ancestor's keys are not the caller's.

The role editor filters itself to the caller's own keys for the same reason a
button the operator cannot use is not rendered: offering a checkbox that always
fails on save is a trap, and for a tenant administrator it would advertise the
module they did not buy. The server enforces it regardless — the filter is
courtesy, not the control.

A permission added to `PermissionCatalog` lands in the right edition on its own.
Adding one that must NOT reach a Sales tenant means adding its prefix to
`AccountingModulePrefixes`. `scripts/test_edition_roles.py` derives the expected
sets from the live catalog and proves the boundary end to end — a Sales user
getting 403 on every accounting screen while still reaching invoices, challans,
receipts and payments.

### Every screen is behind a permission

`config/routePermissions.js` maps every route to the key that opens it and
`Components/RequirePermission.jsx` enforces it before the page mounts. Hiding a
sidebar link was never access control — the URL still worked, and a page that
mounts without its permissions just fills with 403s, which reads as a broken
product rather than a closed door. **The guard fails closed**: a path with no
entry is refused. The server is still the authority; this makes the refusal
legible and names the key the operator needs.

Add a screen → add its route entry. `node scripts/test_route_permissions.mjs`
fails if the router and the map disagree, or if a mapped key is not in
`PermissionCatalog`.

### Accounting rules that cost something to learn

- **Further tax is INSIDE `GrandTotal`.** The sale is
  `GrandTotal − GSTAmount − FurtherTaxAmount`. Miss the subtraction and the tax
  posts to Sales as revenue — the books still balance and the income statement
  is quietly wrong, which is the worst shape a bug can take here. It posts to
  its own liability account, `FurtherTaxPayable`.
- **Withholding is deducted by the buyer, not added.** It never moves
  `GrandTotal`; it changes what is collectible. Both taxes default to None and
  are charged only on an explicit, complete selection, and the resolved rate is
  stored on the document so it keeps the rate it was issued at.
- **The GL is always on.** It is enabled at company creation, is absent from
  every DTO so no request can write it, and there is no toggle in API, service
  or UI.
- **`GeneralLedgerService.WriteEntryAsync` is the ONE place an entry is
  written**, which is what gives the balanced-entry invariant a single home.
  `PostingService` composes legs; it does not write.
- **A rebuild must respect the period lock.** `RebuildAsync` once cleared
  system entries with `ExecuteDeleteAsync` — raw SQL, invisible to the lock
  check — and then re-posted through the writer, which does see it. On a company
  with a lock date that DELETED the closed period and refused to write it back.
  It now leaves closed-period entries alone, skips the documents behind them,
  and runs the whole rebuild in one transaction.
- **The customer portal is the only anonymous surface in the repo.** No tenant
  guard works there (every guard takes a userId and the seed admin is granted
  everything) — **never synthesise a user id**; scope comes from the resolved
  token and every query filters on BOTH CompanyId and ClientId. No public method
  takes a company, client or invoice id from the caller: the route carries the
  document NUMBER, resolved inside the portal's scope. **One generic 404 for
  every token failure** — unknown, malformed, disabled, revoked — because
  `GlobalExceptionMiddleware` echoes 4xx messages verbatim and distinct wording
  is an enumeration oracle. The token is a bearer secret: redacted, masked from
  Serilog, masked in audit rows, never logged.
- **Per-item-type GL accounts are deliberately not built.** Which account a sale
  posts to comes from `Company.DefaultSalesAccountId` /
  `DefaultPurchaseAccountId`. If per-item-type mapping is wanted, build a
  trader-native `(CompanyId, ItemTypeId, SaleAccountId, PurchaseAccountId)`
  table and teach `PostingService.ResolveSalesAsync` / `ResolvePurchasesAsync`
  about it — nothing else has to change. Do NOT port the importer's
  `CompanyItemTypeSetting`: it carries that line's inventory redesign and a
  division scope, and the stock-reflow gate depends on this line's behaviour.

---

### Pickers are not screens (2026-09-21)

A dropdown on a form is not the screen that manages the thing it lists.
`clients.manage.view` opens the **Clients page**; requiring it to fill the buyer
dropdown meant a role built to raise bills — and entitled to that form — got a
403 where the buyer name belongs. The rule: gate a picker on the audience that
**uses the document**, with `[HasAnyPermission]`, not on the management screen's
own key. `AccountsController.GetFlat` set the precedent; `ClientsController`,
`SuppliersController` and `ItemTypesController` follow it.

The tenant guard, not the permission, is what bounds a picker. Widening the
permission does NOT widen the company: every one of these still asserts the
companyId. `scripts/test_tenant_leak_sweep.py` suite 5 holds both halves — a
bills-only role fills every picker for its own company and is refused all of
them for another.

### Tenant leaks found on 2026-09-21, and the shape they share

All four trusted something the caller said. None of them looked wrong in review.

- **`GET /api/itemtypes?companyId=`** returned that company's **on-hand stock**
  per item, with no `[HasPermission]` at all — any authenticated user of any
  tenant. The branch beside it derived the caller's accessible set correctly,
  which is exactly why it survived: the file looked like it did the right thing.
- **`GET /api/poformats`** with no companyId listed **every tenant's** formats,
  and the row carries `CompanyName` and `ClientName`. The cheapest possible
  request handed over other tenants' company and customer names.
- **`GET /api/poformats/{id}`** resolved any id for anyone — the id-in-the-path
  shape of the same bug, which no amount of companyId guarding on the list
  endpoint helps with.
- **`ItemTypes` create/update** took a companyId that chooses **whose FBR token**
  calls PRAL, unchecked — one tenant's bearer spending another's quota.

**Known and accepted: three catalogs are install-wide.** `ItemType`,
`ItemDescription` and `Unit` carry no `CompanyId`, so one tenant's saved item
descriptions and units appear in another tenant's autocomplete. This is the
schema as designed — item types are deliberately common across a user's tenants,
and `ItemTypesController.GetAll` aggregates on-hand across the caller's whole
accessible set for exactly that reason. It was reviewed on 2026-09-21 and left
alone. Scoping them per company means a migration, a rule for who owns the
existing rows, and a change to every picker; do not "fix" it in passing.

Two scripts now stand watch, and they are complementary:
`verify_tenant_scope.py` reads every controller action that names a companyId
and fails unless it asserts it — **deriving a set from the caller on another
branch does not count**, because that is a different question. And
`test_tenant_leak_sweep.py` puts real users of both editions in front of a
company they were never given and tries every read. It proves each probe path
answers 200 for the seed admin FIRST: a probe that 404s because the URL is wrong
would otherwise "pass" while testing nothing, which is worse than no test — and
three of its paths were wrong on the first run.

---

### `IsTenantIsolated` decides nothing (2026-09-21)

`CompanyAccessGuard` is **fail-closed**: a non-seed user reaches exactly the
companies listed in `UserCompanies`, and nothing else. `IsTenantIsolated` is
never consulted in that decision. It mattered under the older "open mode falls
through" semantics, where an un-isolated company was reachable by any
authenticated user and the join table only bound the isolated ones.

Three places still described the old behaviour, and the worst of them was the
operator-facing copy on the Tenant Access screen itself — "only takes effect on
companies marked Tenant Isolated; open companies stay visible to anyone with the
right RBAC permission". A reader checking production against that sentence
concludes there is a leak. All three are corrected, and the switch is **retired
from the UI**: a control that implies a protection it does not provide is worse
than no control.

What remains, deliberately: the column, the `tenantaccess.manage.update`
permission key, and the API field — the flag is the historical record the
one-time `RBAC_USERCOMPANIES_BACKFILL_V1` keyed on (existing users were granted
the *open* companies so they would not go dark on the upgrade).

**`UpdateCompanyDto.IsTenantIsolated` is `bool?` and null means "leave it
alone".** That is load bearing now that no form sends it: bound as a plain
`bool`, an absent field reads as `false` and every company save by anyone
holding `tenantaccess.manage.update` would silently clear the flag. Pinned by
`test_tenant_leak_sweep.py`.

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
