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
  200). **Never remove that filter** — every document picker renders the whole
  result it is given, and the un-adopted placeholders would bury the real items.
  `IsFavorite` is the adoption signal (`!IsAutoGenerated || IsFavorite`), NOT
  `IsAutoGenerated` alone: that flag records who made the row and is never
  cleared, so filtering on it hid a renamed placeholder forever.
- **The Item Catalog screen is the exception, via `GET /api/itemtypes/paged`**
  (2026-09-02). It pages server-side and searches server-side, so it shows
  EVERYTHING in one list — typed by hand, HS-import placeholder,
  spreadsheet-imported — with no "show placeholders" switch. Ordering there is
  SQL-side (`IsFavorite desc, Name, Id`); the pickers' on-hand-first sort cannot
  apply, because on-hand is computed after the page is fetched. `ItemTypeDto.
  IsAutoGenerated` is exposed read-only so the list can badge a row's origin.
- **The published tariff has no unit column**, so on a tariff-loaded
  installation an HS code cannot auto-fill a UOM. `TaxMappingEngine` therefore
  falls back to `CatalogUomSuggestion`: the unit this installation's other item
  types under the same 4-digit heading already use. It fills an EMPTY field
  only, carries no `UOM_ID`, and the form says where it came from. Do not
  re-introduce copy that promises an auto-fill unconditionally. The filter is
  `!it.IsAutoGenerated || it.IsFavorite`, NOT `!it.IsAutoGenerated`:
  `IsAutoGenerated` is never cleared (it records that the HS import made the
  row), so filtering on it alone hid an ADOPTED placeholder forever — renaming
  one, giving it a unit and ticking "show in dropdowns" still never reached a
  picker, which left an imported catalogue unusable. `IsFavorite` is the
  adoption signal.
- **Pickers search the server.** `SearchableItemTypeSelect` filters the parent's
  curated list client-side AND, once two characters are typed, queries
  `/api/itemtypes?includeAutoGenerated=true&search=…`. Without that a code the
  server never sent can never be found, however hard the operator types.
- **There is exactly ONE place a UOM is resolved:**
  `TaxMappingEngine.GetValidUomsForHsCodeAsync` — local HS master, then the
  company token, then the installation reference token. `/itemtypes/fbr-hints`
  used to bypass the master and try only the company's token, so a company with
  FBR off got no unit even when the master held it; because the Item Type form
  gates Update on a non-empty unit, that also made the form unsaveable. Do not
  reintroduce a second UOM path.
- **Credentials come from the installation, not a tenant.** The reference token
  lives in `SystemSettings` (`Fbr.ReferenceToken`), encrypted with the same
  `IFbrTokenProtector` as `Company.FbrToken`, and is used ONLY for read-only
  catalogs. Never borrow another tenant's token for it (audit H-9).
- **There is a token-free path, and it is the default one to reach for.** Every
  PRAL `pdi/*` endpoint answers `401 Missing Credentials` without OAuth, so an
  installation that has never been issued a token could not classify anything.
  FBR publishes the Pakistan Customs Tariff as an open PDF; that is parsed
  offline by `scripts/build_hscode_dataset.py` into
  `Data/HsCodes/pakistan-customs-tariff.csv`, embedded in the assembly, and
  loaded by `ImportFromTariffAsync` — same upsert contract as the FBR import.
  It brings NO UOMs: the tariff has no unit column. Regenerate it once a year
  when FBR publishes a new tariff.
- **The HS picker searches the local tariff FIRST, then FBR** (2026-09-08).
  `HsCodeService.SearchWithFbrFallbackAsync`: a code the operator has typed in
  FULL that the master does not hold triggers one throttled fetch of FBR's
  `itemdesccode` catalog, folded into the master, so the code they pick is one
  FBR accepts. Two codes off a client's stock sheet (`9405.9010`, `8513.6019`)
  turned out to be in neither — genuinely dead codes, and the picker now proves
  that rather than leaving the operator guessing. PRAL has no per-code search,
  so the only fetch available is the whole catalog: that is why it fires on a
  complete code only, is throttled to once per 10 minutes installation-wide,
  and is self-healing (one miss fixes the master for every later caller,
  including the opening-stock import).
- **That refresh is ADD-ONLY, and must stay that way.** `UpsertAsync` also
  refreshes the description of a code it already knows — correct when an
  operator presses "Import HS Codes" and asks for FBR's version, wrong as a
  silent side effect of typing. FBR's `itemdesccode` carries the CHAPTER
  heading ("FURNITURE; BEDDING, MATRESSES…") where the embedded Pakistan tariff
  carries the leaf ("Of chandelier"), so letting it through rewrote 7,590
  precise descriptions into useless ones the first time this ran. Pass only
  codes the master does not have.
- **Rank code matches above description matches in the picker.** Description
  matching is a substring, so searching `45` used to answer `2903.4700` first —
  "245fa" inside a chemical's name — and the ranking has to happen BEFORE
  `take`, or the codes the operator is typing are the ones thrown away.
- **Pakistan splits some WCO subheadings into national lines**, so `8536.5000`
  and `7318.1500` genuinely do not exist while `8536.5010` and `7318.1510` do.
  A fixture that invents a code is rejected by master-first validation and the
  failure looks like an importer bug — it is not.
- **HS validation is master-first**: once the master holds rows, a code missing
  from it is rejected. The old PRAL/format fallback only applies while the
  master is empty. Test fixtures therefore have to use REAL tariff codes.
- `Company.FbrEnabled` now defaults **false** on the model (new companies start
  with FBR off). `UpdateCompanyDto` still defaults true on purpose — an update
  that omits the field must not switch a live tenant's FBR off.

### 5b-3. Spreadsheet import — layouts are data, not code (2026-09-01)

`Services/Implementations/OpeningStockImportService.cs` and
`CustomerLedgerImportService*.cs` read a workbook through an `ImportProfile`:
a saved, versioned JSON mapping matched by a structural fingerprint, exactly as
`POFormat` does for PO PDFs. A new workbook shape is a new PROFILE, never a new
branch in the parser.

- **Preview takes the file; commit takes the reviewed rows.** Commit never
  re-reads the upload, so what the operator approved is what lands.
- **Opening stock groups on the HS CODE, not the item name** (2026-09-02).
  An `ItemType` is identified by its code, so every sheet row under one code
  resolves to the SAME item type at commit — and `UpsertOpeningBalanceAsync`
  SETS rather than adds (it must, or re-importing a corrected sheet would
  double the figures). Grouping by name therefore produced one preview row per
  name and the last one written silently overwrote its siblings' balance. On
  the client's sheet that lost 11 items and 2,312,996.50 of stock value: 8
  codes carried more than one product name (4 under 8543.7090, 3 under each of
  8513.1090 / 8413.2000 / 8481.1000). Rows with NO code still group on the
  name. The merged row names what it folded in, so a four-into-one merge is
  visible rather than silent. Pinned by `scripts/test_spreadsheet_import.py`.
- **A re-import does NOT remove balances it did not touch.** Changing the
  grouping therefore strands the old rows: 41 per-name balances become 38
  per-code ones, and the 3 orphaned `8481.1000` rows keep their values
  alongside the merged one. Clear a company's opening balances before
  re-importing after any grouping change.
- **Two duplicate defences, because they catch different things.** Identical
  bytes are stopped by the filtered unique index on
  `ImportRun (CompanyId, Kind, FileSha256) WHERE IsSuperseded = 0` — in the
  database, so two concurrent commits cannot both win. A re-exported copy has
  different bytes and identical content, so preview also compares what is
  already there and refuses a run where nothing is new. A file that has
  genuinely GAINED rows must still import.
- **Amounts are rounded to stored precision (2dp) while building the preview.**
  Otherwise the reconciliation compares a figure at a precision the system
  cannot keep, and paisa-level differences appear only after the import. The
  ledger's per-customer tolerance therefore scales with document count
  (`ToleranceFor`) — one paisa per document, since each stored document can
  differ from the sheet by up to half a paisa.
- **The ledger will not import a customer that does not reconcile** against the
  workbook's own index sheet. A reporting import fails as a plausible wrong
  number rather than a crash, so this check is the feature, not a nicety.
- **Receipts import as a single `OnAccount` allocation.** These workbooks never
  record which invoice a payment settled; linking them would invent an
  unauditable fact.
- Commit sets `Company.GlLockDate`. Without it `GeneralLedgerService.EnableAsync`
  refuses to enable the GL on the company afterwards (migrated invoices +
  non-zero openings + no lock date).
- Operator runbook: `SPREADSHEET_IMPORT_GUIDE.md`.

### 5b-3b. THE opening stock sheet is one layout, found by heading (2026-09-08)

There is exactly ONE built-in opening-stock layout, published as
`myapp-frontend/public/templates/opening-stock-template.xlsx` and described in
`SPREADSHEET_IMPORT_GUIDE.md`. Do not add a second layout for a client whose
column order differs.

- **`LotRowsMapping.HeaderAliases` corrects the column numbers against the
  sheet's own heading row.** Numbers stay the contract; aliases only relocate.
  Two real accountants agreed on everything from the Price column rightwards and
  swapped the four identity columns (`Items, Sub cat, 4 Digit Hs Code, 8 Digit Hs
  Code` vs `4 Digit Hs Code, 8 Digit Hs Code, Description, Sub Category`), and
  titled one column `GDs No` against `GD Number`. Fixed numbers made the second
  file import the heading `9506` as a product name.
- **Aliases are resolved for ALL fields first and applied together.** Applying
  them one at a time cannot express a SWAP — whichever moved first found the
  other's column occupied and declined, leaving the layout half corrected. A
  heading matching zero or more than one column leaves the mapped number alone,
  which is what makes it safe to alias `balanceQty` (`Bal Qty` is unique on one
  sheet, and plain `Qty` appears three times on the other).
- **Columns 10-21 stay pinned by POSITION.** `Qty`, `Rate` and `S.Tax` each
  appear once per Opening / Consumed / Balance block, so no heading can say which
  block is meant; the row-2 band labels are for humans. Only the BALANCE block
  drives the import.
- **Every relocation is a preview warning.** A silently relocated column is how a
  wrong column becomes a confident wrong import.
- **The heading row is never data**, whatever `firstDataRow` says. `ReadLots`
  starts at `max(firstDataRow, headerRow + 1)` and warns. The scaffold's old
  `firstDataRow: 2` against a `headerRow: 3` imported the heading "Description"
  as a product: one phantom item and a second blocking error.
- **AN UNMAPPED TAX RATE IS A BLOCKING ERROR, not a warning.** If the layout
  has no `balanceTaxRate` and the sheet HAS a rate column, `ReadLots` refuses
  the import and names the column. Sales tax is derived from value x rate
  (§5b-4), so an unmapped rate silently values an entire opening stock at 0%
  — it happened to a live client: 72,737,094.04 of stock, no tax, and a preview
  that looked perfect because every other figure WAS right. There is nothing
  downstream that can catch it. A sheet with no rate column at all still
  imports, so tax-free stock is unaffected.
- **Closing figures mapped before the "Balance" band are warned about.** The
  three blocks repeat Qty / Exl / Rate / S.Tax, so a closing quantity at column
  10 reads the OPENING position and matches the balance only while nothing has
  been consumed. `headerAliases` repairs this by itself ("Bal Qty" relocates
  10 back to 18); an operator-saved layout without aliases gets the warning.
- **Both checks scan the sheet's TOP ROWS, not `headerRow`.**
  `FindRateColumns` / `FindBandStart` deliberately ignore the mapped heading
  row: the layout that omits a tax rate is usually the same one whose
  `headerRow` is wrong, and a guard that trusts it finds nothing exactly when it
  is needed. Learned the hard way — the first cut scanned `headerRow` and did
  not fire on the very layout it was written for.
- **A heading row is recognised by its TEXT, not by `headerRow`.**
  `LotRowsMapping.LooksLikeHeadingText` holds the layout's heading vocabulary and
  `ReadLots` skips any row whose item name matches it AND that has no closing
  quantity. Arithmetic on `headerRow`/`firstDataRow` cannot catch the real case:
  a layout saved with `headerRow: 1` against a sheet whose headings are on row 3,
  reading from row 3, has nothing wrong with those numbers — and the heading row
  then imports as a product called "Description" with HS code "8", whose "No
  closing quantity" error BLOCKS the whole file. The quantity half of the test is
  what keeps a genuine product called "Item" importable. Every skip is a named
  preview warning.
- **`StockSignature` / `StockTokens` are the TEMPLATE's own fingerprint**, so the
  file we hand a client is an exact match. Regenerate both from the template (via
  the identify step) whenever its headings change; the suite's "the shipped
  template recognises itself" case is what catches drift. Keep `StockTokens`
  TIGHT — similarity is Jaccard, so padding it with wording variants LOWERS every
  score (pooling both clients' vocabularies scored them 0.76/0.67; the template's
  own 25 tokens score them 0.92/0.68). Wording belongs in `headerAliases`.
- **`DefaultImportLayouts.SeedAsync` upgrades a built-in whose CURRENT version was
  written by `"system"`**, not `CurrentVersion == 1` — the version test froze the
  moment the seeder itself shipped a v2. Its `changed` test covers every field the
  seeder owns (mapping, name, signature, tokens, notes); testing the mapping alone
  silently skipped a release that changed only the signature.
- **A near-match is offered PRE-SELECTED in the UI.** Selecting nothing fell back
  to `scaffold()`, a five-column stub with no tax, price or lot columns — so an
  operator who corrected the boxes they could see still imported at 0% tax. The
  scaffold is now the house template, and the preview reports what it read.
- **Percent TEXT is a number.** `Helpers/ExcelImport/CellNumber.cs` is the single
  text-to-number parser for both workbook readers, and a trailing `%` means a
  percentage. Two rows of 120 held the literal string `18%`; they parsed as
  nothing and, because a merged item's rate is weighted by value, dragged HS
  8450.9000 from 18% to 14.74% and understated the tax by 115,270.18. Nothing
  looked broken.
- Suite: `scripts/test_spreadsheet_import.py` section 15.

### 5b-3c. A merged stock line keeps its rows (2026-09-08)

Grouping on the HS code is still correct (see 5b-3) and still lossy for
everything else on the row. `Models/OpeningStockLot.cs` keeps one row per source
sheet row against the balance it fed: its own product name, GD number, GD date,
landed unit price, unit, and its own opening / consumed / balance triple.

- **Nothing derives stock from this table.** `StockValuation`, the opening
  balance and the dashboard are untouched — it is the audit trail that says which
  declarations at which costs add up to the position. Do not start reading
  quantities or values from it.
- **Lots are SET, not added**, exactly as the balance is: a re-import deletes the
  balance's existing lots before writing the new ones, or the two would describe
  different sheets.
- **The FK cascades from `OpeningStockBalance` and NOT from `Company`** — the
  balance already restricts on Company, and a second path gives SQL Server two
  cascade routes to one table. `CompanyService.DeleteAsync` needs no change: its
  `ExecuteDeleteAsync` on the balances cascades in the database.
- **`ImportRunId` is stamped after the run is inserted**, inside the same
  transaction, so a lot never carries a null pointing at nothing.
- **`OpeningStockCommitRowDto.Lots` is OPTIONAL.** Commit takes the reviewed rows
  rather than the file, so the frontend passes them straight back; a caller that
  omits them still imports the balance and simply keeps no detail.
- On the two client sheets this preserves 112 product names each, against 78 and
  57 stock lines.

### 5b-4. Stock carries a VALUE, not just a quantity (2026-09-02)

`Helpers/StockValuation.cs` is the only place stock is valued. WEIGHTED AVERAGE,
walked in date order (then by id, so same-day rows apply in the order written).

- **An inward movement may state its own cost** (`StockMovement.UnitCostExcludingTax`,
  `SalesTaxRate`, both nullable). A purchase passes the line's unit price and the
  bill's GST rate; an adjustment up may state a cost; **null means "value me at
  the running average"**, which is why every sale, challan and cost-less
  adjustment path stays untouched.
- **An outward movement is NEVER valued at its sale price.** Selling at a margin
  would drain more value than the goods cost and drive stock value negative
  while quantity was still positive. `RecordMovementAsync` drops a cost passed
  on an `Out` movement rather than trusting the caller.
- **An emptied bin is worth exactly zero.** The last unit out takes whatever is
  left, so rounding cannot leave a stray paisa behind a zero quantity.
- **Sales tax and the inclusive total are DERIVED** (`value × rate / 100`, and
  their sum) everywhere — opening balance, on-hand row, preview. The client's
  own sheet satisfies that identity on every row, so a second stored copy would
  only have somewhere to drift.
- The five figures on the stock dashboard (Qty, Excluding, S.Tax %, Sales Tax,
  Including) and the per-movement money in the movements feed all come from
  `StockValuation` — the feed's figures via its `Step` trace, since a movement's
  cost only exists as part of the walk. Never recompute either elsewhere.
- **A wrong VALUE is fixable without moving goods** (2026-09-02).
  `StockMovementSourceType.Revaluation` is a movement with `Quantity = 0`
  carrying a signed `StockMovement.ValueAdjustmentExcludingTax`. Before it,
  value could only change when quantity changed, so an operator who had counted
  right and valued wrong had nowhere to go.
- **`POST /api/stock/adjust` has two modes**, and `set` is the default the UI
  uses. `set` takes the TRUTH (`targetQuantity`, `targetValueExcludingTax`) and
  the server derives the change from the current position; `delta` takes the
  change itself (`delta`, `valueDelta`). Someone fixing a mistake knows the
  right answer, not the size of their error — the arithmetic is the system's job.
- **In `set` mode the value delta must net off what the quantity movement will
  itself do.** A quantity movement is valued by the walk (outward at the
  average, a cost-less inward at the average), so measuring the money against
  the CURRENT value took it down twice when a correction lowered both figures.
  Predict the post-movement value first, then let the revaluation close the gap.
- **The revaluation's traced amount is POSITIVE and its Direction carries the
  sign**, as with every other movement. Signing it in both places made a
  write-down read as a write-up in the feed and in the reconciliation.
- Two invariants a correction may not break: neither quantity nor value may go
  negative, and **zero quantity may not be left holding money** — the same rule
  the outward path keeps, refused with a message rather than silently dropped.
- Suite: `scripts/test_stock_valuation_flow.py` (78 checks).

### 5b-5. Advance tax, and pricing a bill line from stock (2026-09-02)

**Advance income tax (s.236G / s.236H)** is the MIRROR of the withholding tax
already on `Invoice`, and must keep that shape:

- It sits ON TOP of sales tax and OUTSIDE the FBR sales-tax invoice.
  `Subtotal`, `GSTAmount`, `GrandTotal` and the PRAL payload never move —
  only what is collectible does:
  `Collectible = GrandTotal − WithholdingTaxAmount + AdvanceTaxAmount`.
- Rates live in ONE table, `Helpers/AdvanceTaxRates.cs`: 236G 0.1% / 236H 0.5%
  for an ACTIVE filer, 2% / 2.5% for a non-active one. Charged on the amount
  INCLUDING sales tax (118,000 at 0.1% collects 118).
- The RESOLVED RATE is stored beside the section, so a bill keeps the rate it
  was issued at when the published rates change.
- A half-chosen selection (section with no filer status, or an unknown section)
  resolves to NOTHING rather than charging the buyer on a guess.
- Credit / debit notes are deliberately excluded — advance tax is charged on a
  sale, not on a note adjusting one.
- Print: `advanceTaxAmount`, `advanceTaxSection`, `advanceTaxLabel`
  ("Advanced Income Tax 236-G") and `totalWithAdvanceTax` are on both
  `PrintBillDto` and `PrintTaxInvoiceDto`; the merge fields are seeded at
  RUNTIME by `Data/AdvanceTaxMergeFieldSeeder.cs`, not via `HasData`, because
  the Bill/TaxInvoice merge fields carry hard-coded ids that collide with
  operator-created rows.

**A bill line priced from stock** — the STANDALONE bill only (a bill from a
challan keeps unit-price entry, because the challan already fixed the
quantity):

- The operator enters the line AMOUNT; quantity and rate are derived and shown
  read-only until the amount is cleared.
- `UnitPrice = stock value excluding tax / stock quantity` comes from
  `IStockService.GetValuationsAsync`, which is the ONE weighted-average walk in
  `Helpers/StockValuation`. Never add a second valuation for this.
- Two stored precisions decide the arithmetic, and both matter:
  `InvoiceItem.UnitPrice` is `decimal(18,2)`, so the rate must BE a 2dp figure;
  and a unit without `AllowsDecimalQuantity` can only hold a WHOLE quantity
  (5.5 Pcs is not a thing). So the amount SNAPS to what quantity × rate
  actually makes, and the field shows the snapped figure — that is what keeps
  the bill summing exactly to the amounts on screen.
- Nothing on hand, or stock with no value, reports `canPrice: false` with a
  reason instead of returning a zero the form would divide by.
- The endpoint is `GET /api/invoices/company/{id}/stock-pricing`, gated by
  `bills.manage.create` — the same reasoning as `last-rates`: if you cannot
  make a bill, you do not need its pricing.
- Suite: `scripts/test_bill_pricing_advance_tax.py` (102 checks).

### 5b-6. Delivering a bill: challans raised AFTER the invoice (2026-09-02)

The reverse of the long-standing challan-then-bill flow, and it must not be
confused with it.

- **`DeliveryItem.InvoiceItemId`** is the per-line link, mirroring
  `SalesOrderItemId` exactly. Delivered = `SUM(Quantity)` over challan lines
  pointing at a billed line, ignoring cancelled challans; remaining = billed −
  delivered. That one sum is what makes all four shapes work: every line on one
  challan, one line in instalments, a single line alone, or a mix.
- **A challan writes NO stock movements.** Outward stock belongs to the invoice
  and V2's buckets are derived from live documents, so raising a challan
  against an already-billed invoice cannot double-count inventory. Do not
  "fix" this by emitting movements here.
- **`DeliveryChallan.InvoiceId` is set on the created challan**, which links it
  to the bill AND keeps it out of the "pending challans to bill" picker — it is
  already billed. The generic challan create path deliberately does not write
  that field (it belongs to the billed-once flow), so
  `CreateChallanFromInvoiceAsync` sets it after creating.
- **An empty `Lines` list means "everything still outstanding"** — the one-click
  case. Otherwise only the lines given, at the quantities given. Over-delivery
  is refused server-side with the figures in the message, whatever the form
  sends.
- **`InvoiceDto.ChallanRemainingQuantity`** is a QUANTITY, not a flag, and is
  filled by a batched query on the paged list (`AttachChallanRemainingAsync`).
  The card and the table both hide the action when it reaches zero; a partly
  delivered bill keeps it for the rest. A migrated bill reports zero — it has
  no line items to deliver.
- The new FK is `Restrict`, so `CompanyService.DeleteAsync` unlinks
  `DeliveryItems.InvoiceItemId` before deleting invoice items. Without that,
  deleting a company that ever delivered a bill fails with a 500 — the same
  trap `CompanyItemTypeSettings` had.
- Suite: `scripts/test_challan_from_bill.py` (27 checks).

### 5b-7. Editing a bill, and what each tab may change (2026-09-03)

`EditBillForm.jsx` serves BOTH tabs and the read-only view. Four rules it must
keep:

- **A bill list is ordered by when the row was WRITTEN**
  (`CreatedAt desc, Id desc` in `InvoiceRepository`), not by invoice number.
  Imported history sits in the reserved 900001+ band, so ordering on the number
  put every migrated document ahead of the bill raised a minute ago — on a real
  import that is hundreds of rows, i.e. the operator's own bill on the last page.
- **A challan raised FROM a bill does not make that bill challan-driven** — on
  the SERVER as well as in the form. `UpdateAsync` tested
  `invoice.DeliveryChallans.Any()` and froze a plain standalone bill's items the
  moment a delivery was recorded; it now tests the lines. What has already gone
  out is protected instead: a delivered line may not be removed, and a kept line
  may not drop below its delivered quantity (which is also what keeps the
  `Restrict` FK on `DeliveryItems.InvoiceItemId` from turning an edit into a
  500). Billing exactly what was delivered is allowed.
- **The same direction test, in the form.**
  The direction is read from the LINES: a bill BUILT from a challan has
  `InvoiceItem.DeliveryItemId` set, while the reverse flow sets
  `DeliveryItem.InvoiceItemId` and only adds a challan number. Judging by
  `challanNumbers` alone locked a plain standalone bill's buyer and its
  add/remove-items the moment a delivery was recorded, and told the operator to
  go and edit the challan instead.
- **The Invoices tab is not read-only when FBR is off.** It used to shadow
  `readOnly` (`groupingOnly`), which left a "View Bill" screen with no Save at
  all — a misclassified line could only be fixed from the Bills tab. It now
  behaves as it does with FBR on: item type, quantity, unit price and the line
  amount are editable, and the total-preservation guard holds the bill's own
  total, so a stock movement can be re-pointed but never invented.
- **An entered line AMOUNT is the source of truth, and the UOM does not touch
  it** (2026-09-03). The quantity is rounded to a WHOLE number and the rate
  carries the remainder at `UnitPrice`'s 12 decimals, so `Quantity x UnitPrice`
  rounds to the typed figure at `LineTotal`'s 2dp — 100 over 3 units is
  33.333333333333 each and books as exactly 100.00. `isDecimalUnit` is
  deliberately NOT consulted here: a decimal-capable unit used to keep 2.5, and
  the amount was then re-snapped to quantity x rate, so the operator's own
  number could move. It still governs a quantity the operator TYPES
  (`QuantityInput`), which is where that rule belongs. The server always
  recomputes `LineTotal = Quantity x UnitPrice`, so the 12-decimal rate is what
  makes the round trip exact.
- **Picking an item type seeds the description ONLY when the line has none**, in
  both modes. The create form's save used to ship `itemTypeName || description`
  for the Invoices tab, which replaced a typed description — or one prefilled
  from a sales order — with the catalog name on the way to the server.
- **The line AMOUNT is an input on both tabs, and means different things:**
  on the Bills tab for a plain standalone bill the quantity follows at the
  stock's weighted-average cost (same contract as the create form — whole units
  unless the UOM allows decimals, amount snapped to quantity x rate); anywhere
  else the QUANTITY is fixed and the rate absorbs the change, which is what
  redistributing a bill across lines means.

**Advance tax on an EDIT distinguishes absent from None.** `UpdateInvoiceDto.
AdvanceTaxSection` `null` = the caller did not mention it, so the bill keeps
what it had (an API client editing only items must not silently drop a charge);
`""` = the form's "None", which clears it. Before this, `UpdateAsync` never read
the field at all and recomputed from the stored choice, so the section could
never be set or cleared once the bill existed.

**`getStockPricing(companyId, ids)` takes a COMMA-SEPARATED STRING.** Handing it
an array makes axios send `itemTypeIds[]=84`, which binds to nothing on
`[FromQuery] string?` and returns an empty list with a 200 — the line amount
then silently stops pricing from stock with no error anywhere. The helper now
joins an array itself.

### 5b-8. Payment status is NOT shown anywhere (2026-09-03)

Receipts in these books are taken **on account**, not allocated to an invoice.
So an individual document's `AmountPaid` is usually zero and
`PaymentStatusCalculator.Status` never reaches `Paid` — the status described the
state of the ALLOCATION, not the state of the customer, and read as a debt that
had in fact been settled.

Removed, and not to be re-added without the operator asking:

- the status pill on invoice / bill / note cards and tables (a **Receipts** or
  **Payments** drill-down took its place — what HAS been applied is a fact),
  and the same on purchase bills
- the note picker's status chip and its "Paid only" filter
- the Payment History dialog's Status cell
- the **Sales / Purchase Payment Status** reports — route, export case, service
  method and interface member, not merely unlisted
- **aging**: `GetAgingReportAsync` is now *Customer / Supplier Outstanding
  Balances*. The buckets and the Past Due total measured each document against
  what had been allocated to it, so a settled customer's whole balance sat in
  "90+". The Outstanding report lost its Days-overdue / Age / Status columns and
  its overdue ordering for the same reason.
- the accounting dashboard's aging bucket bars (the total stays — it is a real
  balance — now with an open-document count)
- the customer portal's Status column, detail pill and status filter chips.
  Telling a customer they owe money they have already sent is the most damaging
  place to get this wrong.

**What deliberately REMAINS:** `PaymentStatus`, `BalanceDue` and `DaysOverdue`
on the DTOs, and `PaymentStatusCalculator` itself. `BalanceDue` is load-bearing
for recording a receipt and for the over-allocation guard — removing it breaks
receipts. Nothing renders the status.

A side effect worth knowing: the aging report used to show Past Due
(346,340,796) exceeding Total Receivable (233,005,315), which is impossible.
The buckets were the broken part; the report's total now ties to the Chart of
Accounts A/R balance.

**Eligibility never depends on payment.** A Credit/Debit Note
(`CreateNoteAsync`) and a correction (`CreateSupplementAsync`) are gated at
COMPANY level — FBR-submitted when FBR is on, any valid document when it is off.
Do not reintroduce a "fully paid" test in either.

### 5b-9. Exporting the stock dashboard (2026-09-04)

`GET /api/stock/company/{id}/onhand/excel` → `Helpers/StockExcelBuilder.cs`.
One row per item (Opening / Total In / Total Out / On Hand / Unit Cost /
Excluding / Tax Rate / Sales Tax / Including / Last Movement), with that item's
movement history nested underneath as a **collapsed Excel outline group**.

- **The grid and the export come out of ONE walk.**
  `StockController.BuildOnHandAsync(companyId, withMovements)` serves both, and
  `withMovements` decides only whether `StockValuation`'s `Step` trace is
  collected. A movement's cost is the weighted average standing when it
  happened, so the per-movement money exists only as a by-product of valuing
  the item — computing it twice would be two chances to disagree, and the
  workbook would then contradict the screen it was taken from.
- **Movement detail is a separate capability.** The route is gated by
  `stock.dashboard.export`; the drill-down is included only when the caller
  ALSO holds `stock.movements.view`, checked imperatively via
  `IPermissionService`. A workbook without it says so on its face rather than
  shipping bare rows that look complete.
- **Item rows and movement rows share the same columns** wherever they mean the
  same thing (Qty In / Qty Out / balance / unit cost / value), with a sub-header
  inside each group naming the movement meanings. Do not give movements their
  own sheet: the screen's drill-down is per item, and a flat movement sheet
  loses which figures a movement explains.
- **Column widths are measured from the longest value actually written**, banner
  text excluded (a merged 14-column title would otherwise stretch column A to
  nothing useful). Item names and notes WRAP — they are the two fields no cap
  can size away, and the row carries no explicit height so Excel grows it.
  `scripts/stock_export_harness` fails on any clipped cell.
- **ClosedXML 0.104.2 files the ROW outline depth under
  `sheetFormatPr/@outlineLevelCol` and never writes `@outlineLevelRow`** —
  reproduced both ways (rows-only and columns-only grouping both emit
  `outlineLevelCol="1"`). `StockExcelBuilder.FixRowOutlineLevel` corrects the
  saved part. It is deliberately conservative: an unexpected element shape
  returns the bytes untouched, so a fixed ClosedXML cannot be made wrong by it.
- **Consecutive movements on the same document and direction fold into one
  line**, as the dashboard's drill-down does — one bill can touch an item on
  several lines, and a reader wants "Purchase Bill #204 — 300 in", not three
  thirds of it. Rows with no `SourceId` (adjustments, opening stock, reversals)
  never fold.
- **Two suites, because they answer different questions.** The LAYOUT is pinned
  offline against synthetic rows by `scripts/stock_export_harness`
  (`dotnet run -c Release`, 64 checks — it links the real builder rather than a
  copy, so no database and no running server). That the workbook cannot
  DISAGREE with the screen is pinned live by
  `scripts/test_stock_export_excel.py` (37 checks): it compares the sheet
  row-for-row against `GET .../onhand`, ties the totals to the API's own sum,
  reconciles the drill-down against the movements feed, and exercises both
  halves of the permission split with throwaway roles it deletes afterwards.
  A new column belongs in the harness; a new figure belongs in both.

### 5b-10. Further tax s.3(1A) — the THIRD tax, and the only one inside the total (2026-09-07)

Three taxes now sit on a sale and they behave differently. Getting them mixed
up is the easiest way to corrupt this ledger, so:

| | Withholding s.153 | Advance income tax 236G/H | **Further tax s.3(1A)** |
|---|---|---|---|
| Direction | DEDUCTED by the buyer | ADDED, outside the invoice | **ADDED, inside the invoice** |
| In `GrandTotal`? | no | no | **yes** |
| On the FBR payload? | no | no | **yes — it is sales tax** |
| Charged on | net | net + sales tax | **net** |

- **`GrandTotal = Subtotal + GSTAmount + FurtherTaxAmount`**, and the
  collectible line stays `GrandTotal − WithholdingTaxAmount + AdvanceTaxAmount`.
  Further tax is part of the supply's tax, not a collection on top of it, which
  is why it is the only one of the three that moves the grand total.
- **`Helpers/FurtherTaxCalculator.cs` is the only place it is computed.** A null
  or non-positive rate, or a non-positive subtotal, resolves to zero — a
  half-filled form must not charge the buyer on a guess, the same rule advance
  tax keeps.
- **The RESOLVED RATE is stored on the invoice**, so a bill keeps the rate it
  was issued at. The form defaults to **4%** (the statutory rate for a supply
  to an unregistered buyer) and the operator may edit it; per-client defaults
  were deliberately left for later.
- **`PostingService` derives the sale by SUBTRACTION**, so further tax must be
  subtracted there too:
  `net = GrandTotal − GSTAmount − FurtherTaxAmount`. Miss it and the tax is
  credited to **Sales** as revenue — the books balance and the income statement
  is wrong, which is the worst shape a bug can take here. It posts to its own
  liability account, `ControlType.FurtherTaxPayable`, seeded onto existing
  charts by `Data/FurtherTaxAccountSeeder.cs`.
- **`Helpers/FbrLineTax.cs` takes the DOCUMENT's rate** (`documentFurtherTaxRate`)
  and a stored rate wins over the statutory 4%, so what is filed matches what
  was printed.
- Merge fields are seeded at RUNTIME (`Data/FurtherTaxMergeFieldSeeder.cs`) for
  the reason `AdvanceTaxMergeFieldSeeder` records — the Bill/TaxInvoice fields
  carry hard-coded `HasData` ids that collide with operator-created rows.
- Suite: `scripts/test_bill_pricing_advance_tax.py` section C (the arithmetic,
  both print DTOs, and the three edit cases) and section D, which spins up a
  GL-enabled company purely to prove the tax is **not** booked as revenue.

### 5b-11. FIFO auto-allocation of receipts (2026-09-08)

A receipt can now be spread across a customer's outstanding invoices oldest
first, instead of being ticked by hand. Almost none of this is new machinery —
`Payment` / `PaymentAllocation` / `AllocateAsync` already did the work — so the
rule to keep is that **auto-allocation only ever CHOOSES; it never settles.**

- **`Helpers/ReceiptAllocationPlanner.cs` is the only place the split is
  computed**, and it is PURE: no database, no service, no GL. It proposes lines;
  `PaymentService.AllocateAsync` applies them and owns every guard (cross-tenant,
  cross-party, over-pay, period close) and the posting. So auto-allocation can
  never settle something a hand-typed allocation could not. Do not add a second
  splitter, and do not let the planner write.
- **Headroom is `Collectible − AmountPaid`, never `GrandTotal − AmountPaid`.**
  A withheld slice was settled by the customer at invoice time, so it was never
  receivable — that is exactly the cap `AssertNoInvoiceOverpayAsync` enforces,
  and the planner matches it rather than restating it. Get this wrong and the
  button proposes lines the service then rejects.
- **Order is Date then Id** — the same tie-break `StockValuation` uses, so two
  invoices raised on one day are consumed in the order they were written.
- **An invoice this receipt has already part-paid is still fair game.** Its
  headroom already counts this receipt's own earlier line, so a top-up cannot
  overpay. Excluding them (the first cut did) left a receipt that had manually
  paid 50,000 of an invoice refusing to spend the rest of itself on the other
  68,000, while reporting "no outstanding invoices" — with the customer plainly
  still owing money.
- **A CREDIT NOTE (`NoteKind` 2) is excluded; a DEBIT NOTE (1) is not.** A credit
  note reduces the receivable, so taking cash against one is backwards; a debit
  note is an undercharge the customer genuinely owes. Cancelled and demo
  invoices are excluded, the same pair every report excludes.
- **The sweep applies each receipt in its OWN transaction**, oldest receipt
  first, and a receipt that cannot be applied (closed period, nothing left
  outstanding) is reported in `AdvanceSweepResultDto.Receipts` with its reason
  rather than aborting the rest. A sweep that stops halfway with no explanation
  is worse than one that says what it could not do.
- **Three routes, all under the existing receipt permissions** — no new keys:
  `GET /api/receipts/company/{id}/allocation-plan` (preview, `.view`),
  `POST /api/receipts/{id}/auto-allocate` and
  `POST /api/receipts/company/{id}/apply-advances` (both `.create`).
- **The form asks the SERVER for the split.** `PaymentForm`'s "Spread oldest
  first" calls the preview endpoint and fills its boxes with the answer; every
  box stays editable and saving goes through the ordinary create path. Never
  reimplement the ordering in JavaScript. The button is create-only: on an edit
  the server measures each balance with this receipt's own lines still counted
  as settled, so it would propose less than the form allows.
- **This does NOT reopen §5b-8.** Allocation being automatic does not make
  per-document payment status safe to show again — receipts are still taken on
  account by default, and a customer who has not been swept still reads as
  unpaid. The status pills, aging buckets and Payment Status reports stay
  removed unless the operator asks for them back.
- Suite: `scripts/test_customer_receipts_ledger.py` suite 17 (ordering, the
  collectible cap, the note/cancelled exclusions, the top-up case, both sweep
  outcomes) and `scripts/test_tenant_isolation.py` suite 13, which covers the
  id-based route that takes no company at all.

### 5b-12. Inventory Overlay Behaviour — two books, one total (2026-09-08)

`Company.InventoryOverlayEnabled` splits a sale into two books that share a
subtotal. **OFF is the default and every existing company keeps it**, so none of
this applies to them; the migration lands `defaultValue: false` and nothing
reads the flag unless it is on.

| | the BILL | the INVOICE |
|---|---|---|
| What it is | what the customer ordered and signed | the same money decomposed for FBR |
| Item types | **no HS code** | **HS code required** |
| Quantity / price | typed by hand | adjusted for the filing |
| Stored on | `InvoiceItem` | `InvoiceItemAdjustment` |

- **The one rule everything serves: adjusting the invoice never changes the
  bill.** A customer who signed for 10 at 1,000 still sees 10 at 1,000 on the
  bill, its edit form and its print, after the consultant has refiled it as
  5 at 2,000.
- **The overlay widens under the flag.** It was narrowed to numbers only on
  2026-05-12 because item type / UOM / HS code are bill data — and that stays
  true for a normal company, whose overlays are still cleared exactly as
  before. An overlay company needs the classification to DIFFER between books,
  so `AdjustedItemTypeId` / `AdjustedHSCode` / `AdjustedSaleType` / `AdjustedUOM`
  live again, gated on the flag in `UpdateItemTypesAsync`.
- **`asAdjustment` is forced true for an overlay company.** It cannot wait for
  `dto.WriteMode` (the operator did not choose to keep two books line by line —
  the company did) and must not require `fbrOn`: a company can separate the
  commercial book from the tax book before it ever files anything.
- **`myapp-frontend/src/utils/itemTypeBooks.js` is the one place the pickers
  are split**, because three screens ask (standalone bill, challan bill, and the
  edit form serving both tabs) and a picker disagreeing with its neighbour would
  build a line the other book cannot hold.
- **The scenario's sale-type filter is skipped on an overlay BILL.** It exists to
  stop a mixed-sale-type FILING; a commercial no-HS item carries no sale type, so
  applying both filters left the picker empty. It still applies on the Invoices
  tab — that IS the filing.
- **A bill line stops pricing itself from stock** under the flag. Not fetching is
  the whole switch: with no pricing, `canPrice` is never true, `deriveFromTotal`
  returns null and the form falls back to the qty x price path it already had.
- **STALENESS IS THE TWO TOTALS DISAGREEING** — no version column, no hash, so
  nothing can drift out of step with it. But the filed total must be **derived**:
  an overlay only stores `AdjustedLineTotal` when it differs from the bill line,
  and a redistribution is exactly the case where it does not (5 x 2,000 and
  10 x 1,000 are both 10,000), so reading the column made every filing look
  current however far the bill had moved. Use
  `InvoiceService.EffectiveFiledLineTotal`, which both the DTO flag and the
  `FbrService` gate call. When stale: `FbrReady` is forced false and validate,
  submit AND the dry run are refused — hiding a button is not enough when the
  endpoint is reachable without one.
- Staleness is **overlay-only**. A normal company's overlay has always been
  allowed to drift, and forcing `FbrReady` false there would change behaviour
  for every existing customer.
- Suite: `scripts/test_inventory_overlay.py` (71 checks). Its suite 2 walks a
  NORMAL company through the same steps and is the one that catches a
  regression in the behaviour existing customers rely on.

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
- **A submit is CLAIMED before it is sent** (ported from master 2026-09-08).
  `FbrService` runs a conditional `ExecuteUpdateAsync` — `SET FbrStatus='Submitting'
  WHERE FbrIRN IS NULL AND FbrStatus IN (null,'Failed','Validated')` — immediately
  before the POST. Zero rows affected means someone else holds the claim, and
  **no POST is sent**. The old load-time `FbrIRN` read was a TOCTOU that issued
  **two IRNs for invoice 3816** in production; PRAL does NOT honour our
  `X-Idempotency-Key`, so the duplicate was real. The WHERE clause mirrors
  `Helpers/FbrSubmissionStatus.IsSubmittable` and is written as inline constants
  because EF cannot translate a method call to SQL — change one, change the other.
- **A lost outcome is `Uncertain`, never `Failed`.** If the bytes went out and the
  answer did not come back (timeout, or a crash after send), FBR may hold the
  invoice. `Uncertain` is deliberately NOT claimable, so nothing can auto-retry
  into a duplicate. `Failed` stays re-submittable and is only used when we know
  nothing was sent. The recovery valve is
  `POST /api/fbr/{id}/reset-submission` (permission `invoices.fbr.reset`, modes
  `retry` / `recordExisting`, audited) — an administrator verifies at FBR first.
- **`Helpers/FbrStatus`'s two in-flight states must never read as "not submitted".**
  `myapp-frontend/src/utils/fbrStatus.js` (`isFbrInFlight`) is the ONE definition,
  shared by the table and the cards, because a bill showing "Pending FBR
  submission" on its card while the table calls it "Submitting…" invites exactly
  the re-submit the claim exists to prevent. Submitted / Submitting / Uncertain
  are rendered ABOVE the `fbrEnabled` gate on purpose: they are facts about a
  filing that already left the building, and switching FBR off must not hide one.
- **Cancellation at the FBR portal is RECORDED here, not performed here**
  (`Invoice.FbrCancelledAt/Reason/By`, `POST /api/invoices/{id}/fbr-cancelled`).
  FBR allows a filing to be withdrawn on their portal within 72 hours; that
  happens THERE. Deliberately NOT `IsCancelled`: a void hides the bill, while
  this keeps it visible with its number and IRN and merely stops it counting as
  a sale. Recording it releases the delivery challans back to the billable pool
  and returns the stock — **once**: a full credit note that already returned the
  goods must not return them again. Pinned by `scripts/test_fbr_cancellation.py`.
- **Sandbox vs production is per company**, `Company.FbrEnvironment`; anything
  but `"production"` routes to PRAL's `*_sb` endpoints, so null fails safe to
  sandbox. Do not assert this from config — `scripts/test_fbr_sandbox_e2e.py`
  proves it from the FBR communication log, i.e. the URL actually called.
- **FBR's reference APIs want `dd-MMM-yyyy`.** An ISO date is not rejected: it
  comes back as an EMPTY list, which reads like "this company has no rates"
  rather than "you asked wrongly". Bitten once; worth knowing before debugging
  an empty dropdown.
- **Never guess a rate for a sale type.** FBR answers `[0046] Provided Rate is
  not correct` for a mismatch, and some transaction types list 21 rates (reduced
  rate runs 0.5% to Rs.700/MT). Resolve it: transaction type -> `saletyperates`
  -> the rate whose value matches. Picking the first put a Cement bill at 2%,
  which then demanded an SRO schedule it had no business needing.

- **The FBR block belongs on the Bill template too, and its data now reaches
  it.** A Bill and a Tax Invoice are the SAME `Invoice` row printed through two
  templates, so a filed bill can carry an IRN — but `PrintBillDto` had no FBR
  fields at all, so the block was dead there while the tax invoice showed it.
  `PrintBillDto` now mirrors `PrintTaxInvoiceDto` field for field (same names,
  same meanings) so one block works in either type, and
  `Data/BillFbrMergeFieldSeeder` offers the fields in the Bill editor. The
  CreditNote/DebitNote DEFAULTS need nothing: `purchaseNoteDocTemplates.classic()`
  returns the `*-classic-serif` STARTER's html, and those starters already carry
  the block. `defaultBillTemplate` is a standalone literal, which is why Bill
  alone needed editing in two places.
- **`{{{fbrQrPngDataUrl}}}` needs TRIPLE braces** — it is a `data:image/png;base64,…`
  URI and Handlebars HTML-escapes a double-brace value, which renders a broken
  image. The merge-field labels say so, because the editor inserts the label's
  expression verbatim.
- **The template editor's preview needs a FILED sample document.** The block is
  wrapped in `{{#if fbrIRN}}`, and `templateSampleData` supplied no IRN for any
  type (Bill/TaxInvoice had no FBR keys; the notes had `fbrIRN: ""`), so
  inserting the block previewed as nothing and looked broken. Keep those sample
  values populated.
### 10b. Filing a scenario other than the standard rate (2026-09-08)

Getting a non-standard scenario accepted turns on four values, and only two of
them can be resolved from FBR.

- **A sale type is FBR's string, verbatim.** `transactiontypes` is the authority
  and it is not tidy: `'Goods at standard rate (default)'` is lower case,
  `' 3rd Schedule Goods '` is padded, and `'Processing/Conversion of Goods'` has
  no space after the slash. Our catalog carried the spaced form, so SN016 could
  never be filed — `[0204] Sale type not match with provided scenario`.
  `FbrService.SaleTypeCanonicalMap` is where a stored variant gets corrected;
  add both spellings when you find one.
- **The RATE comes from `saletyperates`, never from the catalog's headline.**
  Reduced rate lists 21 rates (0.5% to Rs.700/MT); SRO 297(I)/2023 lists exactly
  one, and it is 25%, not the 18% the catalog claimed. Reference data, so this
  part is deterministic — resolve it (§10 already says never guess a rate).
- **An SRO reference is required by the SCENARIO, not by "rate ≠ 18%".** FBR
  REFUSES a schedule on an exempt supply (`[0046]`) and on a zero-rated one
  (`[0078]`), and both are 0%. `TaxMappingEngine` used the rate test and so
  blocked, locally, filings FBR would take. It now reads
  `TaxResolution.RequiresSroReference`.
- **`sroschedule` answers an EMPTY list for every rate of every one of these
  transaction types.** So the schedule string cannot be resolved and has to come
  from the scenario or from the operator. Which is why
  `TaxResolutionInput.SroScheduleNo` / `SroItemSerialNo` exist: the LINE wins
  over the catalog default. Before that the operator's own entry was invisible to
  the very check that demanded it.
- **The pre-flight must be told the scenario.** `PreValidate` takes `scenarioId`;
  the `[SN0xx]` marker in `PaymentTerms` is only a fallback for bills written
  before it was threaded through.
- **A zero-rated line needs a genuinely zero-rated commodity.** `8481.8090`
  (valves) is refused `[0052]`; `1001.1900` (wheat) is accepted. Same for the
  HS/UoM pair — FBR names the units it will take, and the pre-flight surfaces
  that before the call.
- **`SroSchedule` lives on `pdi/v1/`. Everything around it is `pdi/v2/`.**
  Spec §5.7. Called on v2 it returns **200 and an empty array**, not a 404 — so
  it reads as "this rate has no schedules" and the mistake survived for months.
  That single wrong path is why the SRO reference could not be resolved and why
  four scenarios depended on hard-coded guesses. `SaleTypeToRate`, `SROItem` and
  `HS_UOM` are all v2; check the spec before adding another.
- **`SROItem` takes an ISO date; the others take `dd-MMM-yyyy`.** Spec §5.10
  (`date=2025-03-25`) against §5.7 (`date=04-Feb-2024`). `GetSROItemsAsync`
  converts, so callers pass the one format.
- **RESOLVE the SRO reference, never spell it.** `SaleTypeToRate` → rateId,
  `SroSchedule` → `srO_DESC` (that IS the string to file), `SROItem` → the valid
  serials. FBR's own values look nothing like their legal names: `6th Schd Table
  I` for the Sixth Schedule, `297(I)/2023-Table-I` with no "SRO" prefix, and
  parenthesised serials like `1(i)`. A spelling FBR does not know comes back as
  `[0077] Valid SRO/Schedule No. is mandatory` — identical to sending none, which
  is what makes this so easy to misread. Right schedule, wrong serial is
  `[0078]`.
- **Once ANY schedule is in play FBR treats the line as 3rd-Schedule** and
  requires a `FixedNotifiedValueOrRetailPrice` (`[0090]`). It is an operator
  input, so the catalog does not default it — but a scenario with an SRO cannot
  file without one.
- **An exempt line's rate is the WORD "Exempt", not "0%".** `saletyperates`
  returns `ratE_DESC` "Exempt" for transaction type 81, and FBR rejects `0%` with
  `[0046]` "Provided Rate is not correct" — a vocabulary error wearing a rate
  error's clothes. `FbrService.IsExemptSaleType` is where that is decided.
- **A zero-rated line needs a zero-rated COMMODITY.** 8481.8090 is refused
  `[0052]` however correct everything else is; 1001.1900 is accepted.
- **THE SANDBOX DOES NOT ALWAYS REPEAT ITSELF.** SN005, SN006, SN007 and SN024
  were each accepted once and then refused on a byte-identical payload; a plain
  standard-rate submit once came back `[0090] Fixed/Notified Value or Retail
  Price is mandatory` on a line that is not 3rd-Schedule. Request bodies were
  compared and the only variable was time. So do NOT ship a catalog value on the
  strength of one green run — record it in
  `scripts/test_fbr_sandbox_e2e.py:REGISTERED_SHAPES` with
  `filesInSuite=False` and promote it when the sandbox repeats. A suite that
  goes red on PRAL's mood teaches nobody anything.
- Suite: `scripts/test_fbr_sandbox_e2e.py` suite H (`--cnic` for a 13-digit
  seller registration; `--file-codes` to choose what is actually filed).

---

### 10c. The FBR-only screens, and who may see them (2026-09-08)

`FBR Sandbox` and `FBR Monitor` are gated in TWO places and both matter.

- **The sidebar gate is "does this installation file with FBR at all"** —
  `anyCompanyHasFbr(companies)` in `myapp-frontend/src/config/navVisibility.js`,
  ANDed into the nav links and into `settingsKeys` via `applyFbrCompanyGate` so
  the section's "[N]" badge matches the links rendered. Deliberately ANY company,
  not the selected one: a tab that appears and disappears as the operator
  switches company reads as a bug, and support calls follow.
- **The page gate is per company**, and it must resolve `fbrEnabled` from the
  live `companies` list by id (`companyHasFbr`), never from a company object the
  caller is holding. Callers hold objects of several vintages — the context's
  `selectedCompany`, a row a page cached, one a picker returned — and a stale one
  made the screen say "FBR integration is off for Overlay Traders" while listing
  Overlay Traders as a company that files.
- **`FbrSandboxPage` has its OWN company picker**, separate from the global
  selection by design, so its gate follows that picker and `FbrOnlyNotice` takes
  the `companyId` explicitly. Its start-up effect must return after each branch:
  two bare `if`s reading the same stale `companyId` both fired on the first pass,
  so "fall back to companies[0]" overwrote "use the globally selected company"
  and the page opened on the wrong company every time.
- A non-FBR company gets `Components/FbrOnlyNotice.jsx`, which names the company,
  says where to switch it on, and offers a one-click switch to each company that
  does file. Never an empty grid — that reads as a fault.

---

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
| Basic flows | `python scripts/test_basic_flows.py` | `all PASS` (65 checks) |
| Tenant isolation | `python scripts/test_tenant_isolation.py` | `all PASS` |
| Stock item-type reflow (V1) | `python scripts/test_stock_itemtype_reflow.py` | `76/76 checks passed` |
| Inventory V2 lifecycle | `python scripts/test_stock_v2_lifecycle.py` | `29/29 checks passed` |
| Division isolation | `python scripts/test_division_isolation.py` | `all checks passed` |
| Document copy | `python scripts/test_document_copy.py` | `184/184 checks passed` |
| Customer Portal (incl. IDOR suite) | `python scripts/test_customer_portal.py` | `120/120 checks passed` |
| Customer receipts, advances + FIFO auto-allocation | `python scripts/test_customer_receipts_ledger.py` | `184/184 checks passed` (3 skipped without `--db`) |
| Customer ledger | `python scripts/test_customer_ledger.py` | `100/100 checks passed` |
| Customer ledger grouping | `python scripts/test_customer_ledger_groups.py` | `47/47 checks passed` |
| Client Ledger report | `python scripts/test_client_ledger_report.py` | `97/97 checks passed` |
| Accounting reports | `python scripts/test_accounting_reports.py` | `326/326 checks passed` |
| Public file allowlist | `python scripts/verify_public_file_allowlist.py` | `10/10 checks passed` |
| Print pagination (offline) | see `PRINT_TEMPLATE_GUIDE.md` §11 | `0 failing cases` |
| HS code master + FBR-off classification | `python scripts/test_hscode_master.py` (add `--fbr-token <token>` to also exercise the live PRAL fetch) | `all PASS` (24 checks, 1 skipped without a token) |
| Bulk client import | `python scripts/test_client_import.py` | `all PASS` (23 checks) |
| Item Type lifecycle + picker reachability | `python scripts/test_item_type_lifecycle.py` | `all PASS` (24 checks) |
| Spreadsheet import (layouts, heading aliases, tax-rate guard, stock, lots, ledger) | `python scripts/test_spreadsheet_import.py` | `all PASS` (135 checks) |
| Bill line pricing, advance tax (236G/236H) + further tax s.3(1A), incl. edit and GL posting | `python scripts/test_bill_pricing_advance_tax.py` | `102/102 checks passed` |
| Delivery challans raised from a bill (incl. editing a delivered bill) | `python scripts/test_challan_from_bill.py` | `34/34 checks passed` |
| Stock valuation flow (import -> purchase -> sale -> adjustment -> correction) | `python scripts/test_stock_valuation_flow.py` (add `--stock-file <xlsx>` to run a real sheet through the shipped layout) | `78/78 checks passed` |
| Item Type lifecycle + pickers | `python scripts/test_item_type_lifecycle.py` | `all PASS` (24 checks) |
| Permission-section mapping (static) | `python scripts/verify_permission_sections.py` | `All permission modules are mapped` |
| Stock dashboard Excel export (offline layout) | `cd scripts/stock_export_harness && dotnet run -c Release` | `STOCK EXPORT HARNESS PASSED` (64 checks) |
| Stock dashboard Excel export (live, ties to the grid) | `python scripts/test_stock_export_excel.py` | `STOCK EXPORT LIVE SUITE PASSED` (37 checks) |
| FBR duplicate-submit prevention (live sandbox) | `python scripts/test_fbr_no_double_submit.py --fbr-token <sandbox> --db-name <branch db>` | `11 passed, 0 failed` (1 skipped with a live token) |
| FBR cancellation + reversal releases challans | `python scripts/test_fbr_cancellation.py --db "<conn>"` | `26/26 checks passed` |
| FBR sandbox E2E (Importer + Exporter, scenario matrix) | `python scripts/test_fbr_sandbox_e2e.py --fbr-token <sandbox>` | see the suite banner; skips every live suite without a token |
| FBR permissions (validate / submit / reset are separate) | `python scripts/test_fbr_rbac.py --fbr-token <sandbox>` | `18/18 checks passed` |
| Inventory Overlay (two books, one total; normal mode unchanged) | `python scripts/test_inventory_overlay.py` (add `--db <branch db>` for the submitted-lock case) | `71/71 checks passed` (1 skipped without `--db`) |
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
