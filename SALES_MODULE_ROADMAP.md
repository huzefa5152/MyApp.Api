# Sales Module Roadmap — `feat/sales-quote-order-flow`

Working doc for porting select features from `customize-solution-for-other` into
**master**, kept **Division-free**. Delete a phase's section once it's shipped +
verified. This branch is where all the work lands; it merges to master only when
every phase is done (urgent bug fixes go to master separately in the meantime).

**Golden rule:** master has **no Division and no NonInventory** concept — it
isolates tenants with `Company.IsTenantIsolated` + `UserCompany`. Strip *all*
Division / NonInventory code when porting anything from the customer build.

Reference source = branch **`customize-solution-for-other`**. Use a read-only
worktree to read it, e.g. `git worktree add --detach ../_ref-customize customize-solution-for-other`.

---

## 0. Status at a glance

| Phase | What | State |
|---|---|---|
| 1 | Sales Quote + Sales Order (Division-free) | ✅ done (commit 8c3be52) |
| 1.5 | PO import → SQ/SO, order→challan→bill wiring, PO threading, lifecycle, bill-time PO | ✅ done (commit 8c3be52) |
| 2 | Print Template — multi-doc, Company-level | ✅ CODE-COMPLETE (all stages A–F, uncommitted, awaiting merge permission) |
| 3 | Receipt (Accounting), GL-stripped, both directions | ⬜ not started |

**Phase 2 progress (2026-07-21, uncommitted on this branch):**
- ✅ **Stage A — backend multi-template core**: PrintTemplate +Name/+IsDefault; `Helpers/PrintTemplateTypes.cs` (10 types); DTOs (Create/Update); repo id-based CRUD/set-default/delete/apply-starter/GetForExport; controller (id endpoints + audit, per-action `[AuthorizeCompany]`); perms `printtemplates.manage.delete`+`.starter.apply`; AppDbContext filtered-unique `UX_PrintTemplates_DefaultPerScope` on `(CompanyId,TemplateType)`; **idempotent migration `20260721084126_AddNameAndIsDefaultToPrintTemplate`** (guarded SQL, safe on db46684 which already had the columns + on true prod). Verified 24/24 smoke on db46684.
- ✅ **Stage B — print data + seeders**: PrintDtos +Company* block/note fields on PrintTaxInvoiceDto, +UnitPrice on PrintTaxItemDto, +PrintPurchaseBillDto/+PrintGoodsReceiptDto (Division-free); InvoiceService tax-invoice mapping fills Company*/UnitPrice/note fields (NoteKind 1=Debit/2=Credit, OriginalInvoice nav); NEW print endpoints `GET /purchasebills/{id}/print` + `GET /goodsreceipts/{id}/print` (+ perm `goodsreceipts.print.view`); ported `SalesMergeFieldSeeder`+`NoteAndPurchaseMergeFieldSeeder` (skipped Division one) wired in Program.cs. Verified: merge fields seeded (SQ44/SO35/CN49/DN49/PB45/GR26), print endpoints return correct payloads on real data, GR 404s gracefully.
- ✅ **Stage C — frontend infra**: `printTemplateApi` id-based fns; `usePrintTemplates` hook (no divisionId, localStorage `printTpl:{company}:{type}`); `PrintTemplateSelect`; `templateEngine.js` adopted customer superset (+fmtDMY/fmtQty/richText, MERGE_FIELDS trimmed to Challan/Bill/TaxInvoice/Receipt); `templateSampleData.js` (10 types, Division-stripped, new-type defaults from starters[0]); 10 starter files + aggregator ported (Division tokens stripped from purchaseBill×2/receipt×4). `salesDocTemplates.js` already Division-free. **Frontend `npm run build` green.**
- ✅ **Stage D — management screen**: `PrintTemplatesPage.jsx` (Division-free 3-tab manage: Print/Starter/Excel) + `TemplateEditorPage.jsx` upgraded to multi-template/by-id (create+edit, name field, type locked, id-based Excel) + `StarterGallery`/`ApplyStarterModal`/`A4PreviewFrame` ported. Routes: `/templates`→PrintTemplatesPage, `/templates/edit`→editor. **Browser-verified**: management page + 139-starter gallery + editor load, zero console errors, Hakimi untouched.
- ✅ **Stage E — selector on 9 screens**: `usePrintTemplates`+`PrintTemplateSelect` on Challan/Bill/TaxInvoice/CreditNote/DebitNote (InvoicePage mode-keyed type), SalesQuote, SalesOrder + NEW Print/PDF flow (card+table) on PurchaseBills/GoodsReceipts (+ `getPurchaseBillPrintData`/`getGoodsReceiptPrintData` api fns). Receipt deferred to Phase 3. Browser-verified: picker shows where a template exists (Challan), hides where none (PurchaseBill), no errors.
- ✅ **Stage F — docs+verify**: README changelog; PRINT_TEMPLATE_GUIDE.md + scripts/print_templates ported (Division-free note prepended). Regression GREEN: backend build 0 err, frontend build clean (657 mod), audit 67/67, basic flows 37/37, tenant iso all-pass; **zero Division code confirmed** (only a comment stating Division-free). Optional not-yet-done: port `test_print_templates_multidoc.py` as a dedicated regression + explicit tenant-iso cases for the 3 new endpoints (behavior already covered by the suite + browser E2E).
- **DB migration** `20260721084126_AddNameAndIsDefaultToPrintTemplate` (idempotent, applied to db46684). Backend server running on :5134 vs db46684. Recon maps in scratchpad (`wafhydde0.output`, `reconB_*.md`).
- **⏳ AWAITING: user permission to commit + (later) merge.** Nothing committed. Do NOT commit/merge without explicit say-so.

---

## 1. DONE — Sales Quote + Sales Order + flow (committed)

- **Entities/DTOs/repos/services/controllers** for `SalesQuote` (priced) and
  `SalesOrder` (quantity-only); 10 permission keys; migration
  `20260720150456_AddSalesQuoteAndSalesOrder`. Division + NonInventory stripped,
  ItemType kept, per-company numbering via `NumberAllocationRetry`.
- **React**: `SalesQuotePage` / `SalesOrderPage`, their forms + detail modals,
  `CreateChallanFromOrderModal`, `SearchableSelect`, `salesQuoteApi` /
  `salesOrderApi`, nav + routes + `permissionSections`, `printDocument`,
  `salesDocTemplates`.
- **Item catalog + price memory**: quote/order lines upsert descriptions into
  the generic `ItemDescription` table (`Helpers/ItemDescriptionRegistry`);
  quote unit price flows to the Bill via the order→bill prefill.
- **PO import (multi-target)**: `POImportForm` now drives challan / sales order /
  sales quote (default = challan); "Import PO" buttons on both sales pages.
- **Order → challan**: "From Sales Order" picker on `ChallanForm` routes through
  `POST /salesorders/{id}/create-challan` (links each line, auto-closes the order
  when fully delivered).
- **PO threading**: `SalesOrder.CustomerPoNumber/Date` inherited by new challans
  and **propagated to linked unbilled challans** on order edit
  (`SalesOrderService.PropagatePoToChallansAsync`).
- **Bill from order (both paths)**: standalone bill prefills the order's lines +
  resolved prices (`/salesorders/{id}/invoice-prefill`); challan-linked bill
  pre-ticks the order's billable challans.
- **PO at bill time (both paths)**: new `Invoice.PoNumber/PoDate` (migration
  `20260720210204_AddInvoicePoFields`) — settable on both bill forms, overrides
  the challan-derived PO; blank = derive from challans. **FBR ignores the PO.**
- **Lifecycle**: quotes auto-expire past validity (blocked from convert, dropped
  from pickers); orders auto-close on full delivery on every challan path.

---

## 2. TODO — Phase 2: Print Template System (multi-doc, Company-level, Division-free)

> **Authoritative spec (user-provided 2026-07-21).** Port the Print Template
> enhancements from `customize-solution-for-other` into master, **Division-free**,
> extending the template system from master's current 3 doc types to **10**.

**Master today:** old single-template PrintTemplate — types `Challan`, `Bill`,
`TaxInvoice` (Sales Tax Invoice), validated inline; documents always print the
DEFAULT; there is no template dropdown.

**Target — 10 supported doc types:**
- Existing: **Delivery Challan, Bill, Sales Tax Invoice**.
- Add: **Sales Quote, Sales Order, Purchase Invoice (Purchase Bill), Goods
  Receipt, Debit Note, Credit Note, Receipt**.

**Source:** the customer branch already has most of this — its multi-doc print
work added Debit/Credit Note + Purchase Bill + Goods Receipt (~60 starters,
~15/type) + a generic `usePrintTemplates` hook + `PrintTemplateSelect` dropdown on
~9 doc screens (localStorage-remembered). Port that Division-stripped; add Sales
Quote / Sales Order / Receipt on top. **Read repo `PRINT_TEMPLATE_GUIDE.md` +
`scripts/print_templates/` FIRST** (mandatory for any print-template work) —
author against real print-DTO fields, match the borderless Manager style, verify
via JS DOM asserts (screenshots are broken on this machine).

### Feature 1 — template support for each new doc type
- Add each new type to the Print Template **management screen**; full
  create/edit/delete/manage exactly like the existing types.
- **~15 professionally designed starter templates PER new type** (7 new types →
  ~105 starters). Research common business layouts; match the existing library's
  quality + styling. Every template must support placeholders for totals, taxes,
  company details, logos, signatures, and the document-specific fields.
- Print + PDF for each document must only use templates belonging to **its own**
  doc type.

### Feature 2 — generic Template Selector on EVERY doc screen
- Build ONE reusable **Print Template Selector** (generic `usePrintTemplates` hook
  + `PrintTemplateSelect` component). The backend already stores multiple templates
  per type once the multi-template upgrade lands — this only EXPOSES it on the UI.
- Add it to all **10** doc screens: Sales Quote, Sales Order, Delivery Challan,
  Bill, Sales Tax Invoice, Purchase Invoice, Goods Receipt, Debit Note, Credit
  Note, Receipt.
- Behaviour: list all ACTIVE templates for the current doc type; initially select
  the DEFAULT; allow switching; **remember the user's last selection (localStorage)**;
  use the selection for BOTH Print and PDF; fall back to the default when there is
  no prior selection.
- Generic + config-driven: a future doc type is added by CONFIG, not new code. No
  hardcoded per-document behaviour; no duplicate code.

### Backend port (Division-free)
- `Helpers/PrintTemplateTypes.cs` (new) — the 10 type strings; frontend mirror
  `utils/templateSampleData.js`.
- `Models/PrintTemplate.cs` — add **`Name`** + **`IsDefault`** ONLY (NO DivisionId).
  New migration: drop old unique `IX_PrintTemplates_CompanyId_TemplateType`; add
  `IsDefault` (bit default 0) + `Name` (nvarchar(200) default 'Default'); backfill
  `IsDefault=1`; filtered-unique `UX_PrintTemplates_DefaultPerScope` on
  `(CompanyId, TemplateType) WHERE IsDefault=1`. **Strip ParserFeedbacks from the
  migration + snapshot** (§4).
- Replace `PrintTemplateRepository` / `PrintTemplatesController` / `PrintTemplateDto`
  with the customer versions **Division-stripped** (drop every `divisionId` param,
  `.Include(Division)`, `IDivisionAccessGuard` — keep `ICompanyAccessGuard`). Adds
  the id-based multi-template CRUD master lacks (`GET /{id}`, `POST company/{cid}`,
  `PUT /{id}`, `POST /{id}/apply-starter`, `PUT /{id}/default`, `DELETE /{id}`,
  id-based excel endpoints). New perms: `printtemplates.manage.view/update/delete`,
  `printtemplates.starter.apply`, `printtemplates.manage.sheetpin`,
  `config.mergefields.manage`.
- Merge-field seeders (Sales, Note/Purchase) → wire into `Program.cs`; **SKIP**
  `DivisionMergeFieldSeeder`. `MergeFieldsController` is byte-identical — no change.
- Print DTOs / endpoints per type: `PrintQuoteDto`/`PrintOrderDto` exist. Need
  print data for Purchase Invoice, Goods Receipt, Debit/Credit Note, and **Receipt**
  (from Phase 3). Notes are reversed invoices — reuse the invoice/tax-invoice print
  path or author `PrintCreditNoteDto`/`PrintDebitNoteDto` (check master's note print
  first).

### Frontend (new/ported, Division-stripped)
`pages/PrintTemplatesPage.jsx`, `Components/PrintTemplateSelect.jsx`,
`hooks/usePrintTemplates.js`, `utils/templateSampleData.js`, `utils/starters/*.js`.
Strip every `divisionId` (hook param/scopeKey/filter; page division picker +
create-scope modal; `printTemplateApi.createTemplate`). Wire the selector into all
10 screens — this branch's sales screens currently use the built-in defaults in
`utils/salesDocTemplates.js`; swap them to the DB-template picker.

### ⚠ Cross-phase dependency — Receipt
The **Receipt** template type needs the Receipt document (entity + print DTO +
screen) from **Phase 3**. Either do Phase 3 first, or add the Receipt template
TYPE + starters in Phase 2 and wire the selector-on-Receipt-screen once Phase 3
lands. Everything else in Phase 2 is independent of Phase 3.

### Regression (MANDATORY — this touches the whole printing system)
Verify UNCHANGED: existing templates, Print, PDF, default-template behaviour,
template management, existing permissions, existing reports. Verify each of the 10
doc types individually; the selector behaves consistently on every screen; and
**zero Division-related code exists anywhere** in the implementation.

### Deliverables (per the spec)
1. Architecture summary. 2. Modified-files list. 3. DB changes. 4. New reusable
components/services. 5. Manual testing checklist. 6. Regression results.
7. Confirmations: no Division introduced; existing functionality intact; Print +
PDF work for all 10 doc types; follows master architecture and is production-ready.

---

## 3. TODO — Phase 3: Receipt (Accounting), GL-stripped, BOTH directions

Receipt is the money-in direction of a **unified `Payment`** entity
(`PaymentDirection` Receipt vs Payment). Decisions already made with the user:
**port both directions** (money-in vs invoices, money-out vs purchase bills) and
**strip the GL**.

**Backend (Division-free, GL-stripped, CoA-optional, Attachments-stripped)**
- `Models/Accounting/Payment.cs` (+ enums) and `PaymentAllocation.cs`. Drop
  `DivisionId`. Keep the free-text `BankAccountName` + `Method`; the `BankAccountId`
  → Account FK and the allocation `AccountId` are CoA (master has none) — drop the
  FKs (keep columns FK-less, or drop `AccountId` entirely).
- `PaymentService`: **remove the ~6 `IPostingService` calls** (`AssertPeriodOpenAsync`,
  `PostPaymentAsync`) INCLUDING the delete path's unconditional
  `RemoveForSourceAsync` (it `ExecuteDelete`s on `JournalEntries`, which master
  lacks). Keep the AR/AP subledger untouched: `RecomputeInvoiceAsync` (AmountPaid
  reflow), over-allocation guard, per-direction numbering, cheque lifecycle.
- `PaymentRepository` (drop `.Include(Division)`), `PaymentsController` (drop
  `IDivisionAccessGuard`; keep company access + the 8 keys
  `accounting.receipts.*` / `accounting.payments.*`).
- Helpers master lacks: `Helpers/PakistanClock.cs`, `Helpers/PaymentStatusCalculator.cs`.
- **Schema change to production tables** (user approved this pattern): add
  `AmountPaid` (decimal(18,2) default 0) + `DueDate` (nullable) to **both**
  `Invoices` and `PurchaseBills`; surface `AmountPaid`/`BalanceDue`/`DueDate` on
  the invoice + purchase-bill DTOs and the paged-list projections (the payment
  form reads `balanceDue`). Add a `SetDueDate` endpoint on invoices/bills.
  **Strip ParserFeedbacks from the migration + snapshot** (see §4).
- `Program.cs`: register `IPaymentService`/`IPaymentRepository`; the ported
  service no longer needs `IPostingService`.

**Frontend**: `pages/PaymentsPage.jsx` (rendered twice — `mode="receipts"` and
`"payments"`), `Components/PaymentForm.jsx`, `PaymentHistoryDialog.jsx`,
`api/paymentApi.js`; routes/nav/permissionSections. **Strip** `DivisionSelect`,
`BankCashSelect` (replace with the free-text bank/cash name), `AttachmentManager`.

---

## 4. Rules & gotchas — READ before coding

- **Division- and NonInventory-free.** Master has neither. Strip on every port.
- **ParserFeedback migration trap.** Every `dotnet ef migrations add` re-bundles
  a `CreateTable "ParserFeedbacks"` because that table is raw-SQL-managed
  (`Data/ParserFeedbackSchema.cs`, run at startup) and deliberately kept out of
  migrations; `Program.cs` ignores `PendingModelChangesWarning` at runtime. After
  EVERY `migrations add`: delete the ParserFeedbacks `CreateTable`/`DropTable`
  from the new migration **and** delete the `ParserFeedback` entity block from
  `Migrations/AppDbContextModelSnapshot.cs`.
- **`dotnet ef database update` (tooling) fails** with PendingModelChangesWarning
  because of that same drift — apply migrations via the **app's AutoMigrate**
  (runtime `db.Database.Migrate()` ignores the warning). i.e. restart the app.
- **SPA fallback masks 404s as 200-HTML.** A wrong API route returns `index.html`
  (200); test scripts must parse JSON and treat HTML as a failure.
- **FBR ignores the PO** field entirely — it's internal/print only.
- **Tenant guard on every companyId endpoint**: `ICompanyAccessGuard.AssertAccessAsync`
  + `[AuthorizeCompany]` + `[HasPermission("...")]`. Never trust `dto.CompanyId`.
- **EF**: no concurrent `AppDbContext` ops; reads `.AsNoTracking()`. Unique
  document numbers via `NumberAllocationRetry`.

---

## 5. Environment / database — IMPORTANT

- **The prod `.bak` is SQL Server 2025 (internal v998); local instances are SQL
  2022 (v957, default `CRKRL-HUSSAHUZ1`) and SQL 2019 (v904, `\MSSQLSERVER2`). A
  `.bak` cannot restore to an older engine.** For real prod data locally use a
  **`.bacpac`** (version-independent, `sqlpackage`) or install SQL Server 2025.
- **Dev DB in use: `db46684`** — real prod-replica data (Hakimi id=1 / Roshan
  id=2), default instance, loaded earlier from a `.bacpac`. It was polluted by an
  earlier customer-branch run: **empty** leftover `SalesQuotes/SalesOrders/…`
  (carrying a vestigial `DivisionId` master ignores) + Division/AmountPaid columns
  on real `Invoices`/`DeliveryChallans`.
  - We **adopted** the empty leftover sales tables (inserted the
    `AddSalesQuoteAndSalesOrder` migration id into `__EFMigrationsHistory` so
    master reuses them instead of recreating). `AddInvoicePoFields` was genuinely
    applied (added `PoNumber`/`PoDate`).
  - **Optional clean rebuild** for a schema that matches master exactly: drop the
    empty leftover customer tables + their unused columns + the foreign migration
    rows, then let AutoMigrate rebuild. The app runs fine without this (it ignores
    the extra columns).
- **`appsettings.Development.json` points at `DeliveryChallanDb` (branch DB on
  `\MSSQLSERVER2`), NOT db46684** — so master needs a per-run override:
  ```bash
  ConnectionStrings__DefaultConnection="Server=CRKRL-HUSSAHUZ1;Database=db46684;Trusted_Connection=True;TrustServerCertificate=True;" \
  ASPNETCORE_ENVIRONMENT=Development Database__AutoMigrate=true \
  dotnet run --no-launch-profile --urls "http://localhost:5134"
  ```
  There's also an empty **`db46684_salesport`** (built fresh by EF) for a clean,
  no-real-data DB. Login: **admin / admin123**.
- **Test companies** created while verifying (delete when convenient — never
  touch Hakimi id=1 / Roshan id=2): `SO Enhance Test Co` (~124), `… 2` / `… PO3`
  (~125/126) on db46684; `Sales Port Test Co` on db46684_salesport.
- **Frontend build needs Node 20** (nvm `v20.20.2`; PATH-prefix it — shell
  default node is 18): `cd myapp-frontend && npm run build`, then copy
  `dist/{assets,index.html,runtime-env.js}` → `wwwroot/` (wwwroot is gitignored;
  CI rebuilds). The running server serves the new static files immediately — no
  backend restart needed for a frontend-only change; **hard-refresh** the browser
  (bundle hash changes). Screenshots are broken on this machine — verify via
  `read_page` / JS DOM checks.

---

## 6. Verify (pre-merge)

- `dotnet build MyApp.Api.csproj` → 0 errors. Frontend `npm run build` → clean.
- `python scripts/verify_audit_2026_05_13_security.py` (67/67);
  `test_basic_flows.py`; `test_tenant_isolation.py`;
  `test_stock_itemtype_reflow.py`. Add tenant-isolation cases for every new
  companyId endpoint (SalesQuotes/SalesOrders now; Payments/PrintTemplates next).
- Smoke-test each new flow against `db46684` on a fresh **test company** (never
  Hakimi/Roshan).

## 7. Merge to master (only when all phases done)

> 🚫 **DO NOT MERGE WITHOUT THE USER'S EXPLICIT PERMISSION** — even after ALL
> phases are complete and green. "All phases done" is a precondition for merging,
> NOT authorization to merge. Ask, wait for a clear yes, then merge. Same for
> pushing the branch. (User set 2026-07-21.)

1. Merge current master into this branch; resolve the snapshot/ParserFeedback +
   migration lineage carefully.
2. Run the full pre-merge suite above.
3. **Ask the user for explicit permission to merge.** Only after a clear yes:
   merge to master. **Master deploys to `hakimitraders` prod via CI** — verify
   the app end-to-end before merging (there is no staging).
