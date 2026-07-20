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
| 2 | Print Template — multi-doc, Company-level | ⬜ not started |
| 3 | Receipt (Accounting), GL-stripped, both directions | ⬜ not started |

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

## 2. TODO — Phase 2: Print Template (multi-doc, Company-level, Division-free)

Master has the **old single-template** PrintTemplate (types: `Challan`, `Bill`,
`TaxInvoice`, validated inline). The customer build has a **multi-template**
version. Bring that in, Division-free, and add doc types **Sales Quote, Sales
Order, Credit Note, Debit Note** (master's notes are reversed invoices —
`Invoice.DocumentType` 9 = Debit, 10 = Credit, with `OriginalInvoiceId`).

**Backend**
- `Helpers/PrintTemplateTypes.cs` — create (master lacks it). Add the target
  doc-type strings (`SalesQuote`, `SalesOrder`, `CreditNote`, `DebitNote`, plus
  the existing 3). Frontend mirror = `utils/templateSampleData.js`.
- `Models/PrintTemplate.cs` — add **`Name`** + **`IsDefault`** only (NOT
  DivisionId). New migration: drop old unique `IX_PrintTemplates_CompanyId_TemplateType`;
  add `IsDefault` (bit default 0) + `Name` (nvarchar(200) default 'Default');
  `UPDATE PrintTemplates SET IsDefault=1`; create filtered-unique
  `UX_PrintTemplates_DefaultPerScope` on `(CompanyId, TemplateType) WHERE IsDefault=1`.
  **Strip the ParserFeedbacks CreateTable from the generated migration + the
  ParserFeedback block from the snapshot** (see §4).
- Replace `PrintTemplateRepository` / `PrintTemplatesController` /
  `DTOs/PrintTemplateDto` with the customer versions, **Division-stripped** (drop
  every `divisionId` param, `.Include(Division)`, and `IDivisionAccessGuard`
  assert — keep `ICompanyAccessGuard`). Adds the id-based multi-template CRUD
  surface master lacks: `GET /{id}`, `POST company/{cid}`, `PUT /{id}`,
  `POST /{id}/apply-starter`, `PUT /{id}/default`, `DELETE /{id}`, and the id-based
  excel endpoints. New permission keys: `printtemplates.manage.view/update/delete`,
  `printtemplates.starter.apply`, `printtemplates.manage.sheetpin`,
  `config.mergefields.manage`.
- Merge-field seeders: port `Data/SalesMergeFieldSeeder.cs` (Quote/Order) +
  `Data/NoteAndPurchaseMergeFieldSeeder.cs` (notes/purchase/goods-receipt); wire
  into `Program.cs`. **SKIP `DivisionMergeFieldSeeder`.** `MergeFieldsController`
  is byte-identical to master — no change.
- Print DTOs: `PrintQuoteDto` / `PrintOrderDto` already exist (added this branch).
  For sales Credit/Debit note printing there is **no dedicated DTO in the customer
  build** (only `PrintPurchaseDebitNoteDto`); decide: reuse the existing
  invoice/note print path (a note is a reversed invoice) vs author
  `PrintCreditNoteDto`/`PrintDebitNoteDto`. Check master's existing note print
  first.

**Frontend (new)**: `pages/PrintTemplatesPage.jsx`, `Components/PrintTemplateSelect.jsx`,
`hooks/usePrintTemplates.js`, `utils/templateSampleData.js`, `utils/starters/*.js`
(`quote`, `order`, `creditNote`, `debitNote`, …). Strip `divisionId` from
`usePrintTemplates` (param, scopeKey, filter), `PrintTemplatesPage` (division
picker + create-scope modal), `api/printTemplateApi` (`createTemplate` divisionId).

**Wire it up**: swap the built-in defaults in `utils/salesDocTemplates.js` for
`usePrintTemplates("SalesQuote"|"SalesOrder")` + `PrintTemplateSelect` on the
sales pages; add the note doc types to the credit/debit-note print screens.

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

1. Merge current master into this branch; resolve the snapshot/ParserFeedback +
   migration lineage carefully.
2. Run the full pre-merge suite above.
3. Merge to master. **Master deploys to `hakimitraders` prod via CI** — verify
   the app end-to-end before merging (there is no staging).
