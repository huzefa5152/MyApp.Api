# Accounting Reports — full reporting system

**Status:** Phase 1 COMPLETE + verified (2026-08-31). Phases 2–6 designed, not started.
Not yet committed — awaiting the user's go-ahead.
**Branch:** `customize-solution-for-other`
**Transient doc** — delete once every phase is implemented + verified (CLAUDE.md rule).
The durable record is the README `## Changelog`, `accountingGuide.js`, and git history.

---

## 0. Goal

Turn the accounting module into a reporting system a business actually runs on:
Dashboard → Report → Summary → Transaction → Original Document, without losing the
accounting trail.

Non-negotiable constraints (from the request and CLAUDE.md):

- **No second accounting engine.** Reports read `JournalLines` / the existing
  subledgers. `PostingService` stays the only thing that writes Dr/Cr.
- **No fake data.** A report that needs data the model doesn't hold is not built;
  the dependency is documented instead (§2).
- **No regression** to invoices, payments, receipts, purchases, taxes, ledgers,
  CoA or RBAC.

---

## 1. What already exists (reuse, never rebuild)

`JournalLine` already carries the subledger dimensions on every line —
`PartyType`/`PartyId`, `InvoiceId`, `PurchaseBillId`, `AccountId`, `DivisionId`.
Customer Ledger, Supplier Ledger, Cash Book, Bank Book, Tax drill-down and
General Ledger are therefore **the same query with different filters**.

| Capability | Where | Notes |
|---|---|---|
| Posting engine | `Services/Implementations/PostingService.cs` | replace-on-edit, balance-asserted, 6 source types |
| Account ledger (paginated, opening/closing, running balance) | `GeneralLedgerService.GetAccountLedgerAsync` | **the** ledger primitive; Cash/Bank Book reuse its semantics |
| Trial balance | `GeneralLedgerService.GetTrialBalanceAsync` | opening + Dr + Cr + closing + totals |
| AR / AP aging | `GeneralLedgerService.GetAged{Receivables,Payables}Async` | subledger-derived; works GL-off. **No drill-down, no `asOf` param** |
| Account balances | `GeneralLedgerService.GetAccountBalancesAsync` | debit-positive, optional `asAt` |
| Accounting summary (dashboard) | `GeneralLedgerService.GetSummaryAsync` | cash, AR/AP buckets, income/expense, receipts/payments, PDC |
| Customer statement | `GET /clients/{id}/statement` | **no date filters, row-capped** |
| Supplier statement | `GET /suppliers/{id}/statement` | same limits |
| Customer / supplier balance summary | `GET /{clients,suppliers}/company/{id}/summary` | |
| Journal register | `pages/JournalEntriesPage.jsx` | |
| FBR Sales report + Tax Sheet (styled Excel) | `ReportService` | **copy its ClosedXML style pattern** |
| Excel export | `ClosedXML 0.104.2` server-side; `exportUtils.exportToExcel` client-side | ClosedXML 0.104.2 has a known totals-row corruption bug — write totals as an ordinary row, never a table totals row |
| PDF export | `exportUtils.exportToPdf` — `html2canvas` + `jsPDF`, A4 | **raster, not selectable text**; fine for statements, capped for long detail |
| Print | `utils/printDocument.js` + `utils/printLayout.js` | per-page signature already handled |

### Correction to a common assumption

**There is no Balance Sheet or P&L report.** What exists is the *Chart of Accounts
tree* split into `BalanceSheet` / `ProfitAndLoss` sections with balances
(`AccountService.GetCoaTreeAsync` → `ChartOfAccountsPage.jsx`), plus an injected
"Current-Year Earnings" line. No period statement, no comparatives. Real
statements are a Phase 3 gap, not an existing feature.

---

## 2. Data-model gaps — reports NOT built, and why

Per request §32: identify the missing data, explain the dependency, don't fake it.

| Requested | Verdict | Evidence |
|---|---|---|
| **Supplier Sales Report** (§9) | **Not built.** Suppliers are purchase-side only. | `Invoice.ClientId` is non-nullable; no supplier→sale path anywhere in `Models/` |
| **Customer Purchase Report** (§6) | **Not built as named.** | `PurchaseBill.SupplierId` only. Built instead as *Customer Sales by Item* — "what this customer bought from us" |
| **Discount columns** (§5, §8, §12, §13) | **Derived, not stored.** | No discount field on `Invoice`, `InvoiceItem`, `PurchaseBill`, `PurchaseItem`. Discounts are modelled as (a) a `NonInventoryItem` line named "Discount", (b) `PaymentAllocation.AdjustmentAmount` + `AdjustmentAccountId` (settlement discount / write-off). Reports expose a *nominated discount account* total, labelled as such |
| **Gross / Net Profit, Customer Profitability, Monthly Profit** (§22) | **Blocked on COGS.** Phase 6. | `PostInvoiceAsync` posts Dr AR / Cr Sales / Cr Output tax — **nothing relieves inventory**. Purchase bills Dr Inventory (tracking on) or Dr COGS (tracking off). Inventory-tracking companies (the default for new companies) therefore show revenue with no cost |
| **Unposted / Draft transactions** | **No such state.** | Documents post immediately (replace-on-edit). Shipped instead as *Posting Exceptions*: `Suspense` balance + documents with no journal entry + GL-off companies |
| **Branch filter** | **= Division.** | Existing `DivisionId` + `IDivisionAccessGuard`. No new concept |
| **Expense "Category"** | **= Account Group.** | No separate category concept. UI labels it `Category (Account Group)` |
| **"Expense No."** | **= payment number** (`PMT-####`) | No Expense entity; an expense is a `PaymentAllocation` with `Kind = Account` |
| **Payee Type** | `Payment.ContactType` | `Client` \| `Supplier` \| `Other`; free-text payee in `ContactName` |

### COGS prerequisite (Phase 6, own spec required)

Approved in principle, but it is **not** a `PostingService` tweak. No cost basis is
stored anywhere:

- `StockMovement` — `Quantity` only, no unit cost (`grep 'public decimal.*Cost' Models/` → 0 hits)
- `OpeningStockBalance` — `Quantity` + `AsOfDate`, **no opening value**
- Cost is only derivable from `PurchaseItem.UnitPrice` per `ItemTypeId`

Implementing it means: a cost column on `StockMovement`, a weighted-average costing
engine (no lot/FIFO layers exist), an opening-stock valuation field, interaction with
`InventoryFlowVersion` 1-vs-2 and `GlLockDate` migration cutovers, and a **GL rebuild
on live tenants** (Al-Qahera is on customer prod with frozen pre-cutover entries).
Own spec, own test suite, own risk review — before Phase 6.

---

## 3. Architecture

### 3.1 One envelope

Every report returns the same shape, so one frontend renderer serves all of them and
later reports are **backend-only work**.

```csharp
public class ReportResultDto<TRow>
{
    public string Title { get; set; }
    public string CompanyName { get; set; }
    public string PeriodLabel { get; set; }      // "1 Aug 2026 – 31 Aug 2026" | "All periods"
    public List<string> FiltersApplied { get; set; }  // printed in the header
    public DateTime GeneratedAt { get; set; }
    public List<ReportColumnDto> Columns { get; set; }
    public List<TRow> Rows { get; set; }
    public Dictionary<string, decimal> Totals { get; set; }
    public List<ReportGroupSummaryDto> GroupSummaries { get; set; }
    public bool LedgerSourced { get; set; }      // false = GL-off fallback, banner shown
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalCount { get; set; }
}
```

### 3.2 Six engines, ~100 report names

| Engine | Source | Serves |
|---|---|---|
| **GL** | `JournalLines` | General Ledger, Account Ledger, Customer/Supplier Ledger, Cash Book, Bank Book, Tax Transaction Detail, Journal Register, Account Balance Summary, Trial Balance |
| **Document register** | `Invoices` / `PurchaseBills` | Sales + Purchase Bill Registers, Outstanding, Payment Status, Sales/Purchases by customer·item·itemtype·account·date·tax |
| **Money register** | `Payments` / `PaymentAllocations` | Company Expense Report, Expense by ×7, Payment + Receipt Registers, Cheques, Unallocated |
| **Statement** | GL + subledger | Customer + Supplier Statement (print/PDF/Excel, sendable) |
| **Period summary** | GL | Monthly Sales/Purchases/Expenses/Profit, Revenue + Expense Summary, Cash Flow |
| **Statements** | GL + `AccountGroup` tree | Balance Sheet + P&L with comparatives |

### 3.3 Expense data source — the decision that makes or breaks the flagship

Two candidates:

- `PaymentAllocation` where `Kind = Account` → has payee, payment account, cheque ref,
  tax. **Misses** expenses booked via purchase bills and manual journals.
- `JournalLines` where `Account.AccountType = Expense` → complete and ledger-true.
  **Has no** payee / payment-account columns.

**Chosen:** query `JournalLines` (GL truth, per request §27), then LEFT JOIN the source
document via `JournalEntry.SourceDocType` / `SourceDocId` to enrich payee / payment
account / reference when the source is a `Payment`. Complete *and* payment-enriched.

When `Company.GlPostingEnabled = false`, fall back to the `PaymentAllocation` path and
set `LedgerSourced = false` so the UI states the report is subledger-derived.

---

## 4. Phase 1 — Expenses + Cash & Bank + shell + drill-down

### 4.1 Shared shell (net-new; every later phase reuses it)

| File | Purpose |
|---|---|
| `Helpers/ReportPeriod.cs` | The 9 date presets — Today, This Week, This Month, Last Month, This Quarter, This Year, Last Year, Custom, **All Periods** — resolved and validated server-side off `PakistanClock.Today` |
| `Helpers/ReportExcelBuilder.cs` | Generic styled workbook over the envelope. Banner/header/money style copied from `ReportService.GetSalesReportExcelAsync`. Every operator string through `CsvSafe`. Totals as an ordinary row (ClosedXML 0.104.2 bug) |
| `DTOs/AccountingReportDtos.cs` | Envelope + row shapes |
| `Controllers/AccountingReportsController.cs` | `api/accounting/reports/…`, one action per report |
| `Services/Interfaces/IAccountingReportService.cs` | |
| `Services/Implementations/AccountingReportService.Expenses.cs` | partial |
| `Services/Implementations/AccountingReportService.CashBank.cs` | partial |
| `myapp-frontend/src/config/accountingReports.js` | Declarative registry: `{ id, category, title, blurb, route, permission, filters[], drillTo }` — drives the index page and each report's filter bar |
| `myapp-frontend/src/Components/ReportShell.jsx` | Header (company, title, period, filters-used, generated-at) · `overflow-x:auto` table · mobile card fallback via `useIsNarrow` · totals footer · `Pagination` + `PageSizeSelect` · Excel/Print/PDF actions |
| `myapp-frontend/src/Components/ReportFilterBar.jsx` | Renders only the filters a report declares |

Filter-bar building blocks — all already on this branch:
`SearchableSelect` (clients/suppliers — note `SearchableClientSelect` exists only on
another branch; do **not** port it), `AccountSelect`, `BankCashSelect` (payment
account), `DivisionSelect` (pass `style={dropdownStyles.base}` — a bare one renders
unstyled), `dropdownStyles`, `cardStyles`.

`AccountingReportsPage.jsx` becomes the **categorised index**: 10 category cards,
each listing its reports with a one-line blurb, permission-filtered. The current
Trial Balance / Aged Receivables / Aged Payables tabs move to their own report
routes — nothing is lost, and AR/AP gain drill-down + an `asOf` param.

### 4.2 Expenses (9 reports — one query + `groupBy`)

Company Expense Report · Expense by Account · by Payee · by Category (Account Group) ·
by Date · by Payment Account · by Tax · Expense Summary · Expense Detail.

**Company Expense Report** (request §2) is the flagship.

Filters: Company · Division · date preset/range · Expense Account · Account Group ·
Payee Type · Payee · Payment Account · Tax · Status.

Detail columns: Date · Payment/Expense No. · Payee · Payee Type · Description ·
Expense Account · Payment Account · Subtotal · Tax · Total · Reference.

Footer totals: Total Expenses · Total Tax · Total Paid · Transaction count.

Two group summaries rendered under the detail: **by Account** and **by Payee**.

Subtotal/Tax split: an `Account`-kind allocation stores `Amount` **gross** with
`TaxAmount` the slice inside it, so `Subtotal = Amount − TaxAmount`.

### 4.3 Cash & Bank (10 reports)

Cash Book · Bank Book · Cash & Bank Summary · Payments Register · Receipts Register ·
Payment by Account · Receipt by Account · Cheques in Hand · Cheques Issued ·
Unallocated Payments.

- **Cash Book / Bank Book** reuse `GetAccountLedgerAsync`'s exact opening/movement/
  closing semantics, presented as Receipt/Payment columns instead of Debit/Credit.
  Account set = `ControlType.BankCash` (or the bank/cash account group, matching
  `GetSummaryAsync`'s existing resolution). **No second ledger calculation.**
- **Cash & Bank Summary** reuses `GetAccountBalancesAsync`.
- **Cheques in Hand** = receipt-side `ChequeStatus` Pending/Deposited;
  **Cheques Issued** = payment-side.
- **Unallocated Payments** = `AllocationKind.OnAccount` rows (advances not yet absorbed).

### 4.4 Dashboard drill-down (request §23)

Existing cards become links, period carried through in the query string:

| Card | Target |
|---|---|
| Cash & Bank, Net Cash Flow | Cash & Bank Summary |
| Receipts | Receipts Register |
| Payments | Payments Register |
| Expenses | Company Expense Report |
| Receivables, Net Position | AR Aging |
| Payables | AP Aging |
| Cheques (in/out) | Cheques in Hand / Cheques Issued |
| Recent activity row | that payment/receipt document |

**Income and Net Profit stay non-clickable this phase** — their target (real P&L) is
Phase 3. A dead card beats a wrong link.

### 4.5 Schema — indexes only, no table or column changes

```
PaymentAllocation (Kind, AccountId)      -- expense grouping + GL-off fallback
Payment (CompanyId, Direction, Date)     -- registers filter by date; today only (CompanyId, Direction, Number) exists
```

Already present, no change needed: `JournalEntry (CompanyId, Date)`,
`JournalLine (AccountId)`, `JournalLine (InvoiceId)`, `JournalLine (PurchaseBillId)`.

Deferred to Phase 2 (party ledgers): `JournalLine (PartyType, PartyId)`.

Migration is additive index-only. `dotnet ef` design-time factory targets
`DeliveryChallanDb`, **not** the branch DB — apply manually to
`db55808_custom` on `localhost\MSSQLSERVER02` and strip any spurious drift from the
generated migration.

### 4.6 Permissions — no access regression

- All Phase-1 reports gate on the **existing** `accounting.reports.view`.
- One new key: `accounting.reports.export` (Excel/PDF), **idempotently backfilled to
  every role already holding `accounting.reports.view`**, marked with an `AuditLog`
  row `ACCT_REPORTS_EXPORT_BACKFILL_V1` (CLAUDE.md §11 pattern).
- Module stays `Accounting` — already mapped in `permissionSections.js`, so
  `verify_permission_sections.py` stays green.
- Per-category keys (`…reports.expenses.view` etc.) **deferred**: adding ~20 keys now
  would silently strip access from every existing role.
- Every action carries `[HasPermission]` + `[AuthorizeCompany]`; Division scoping via
  the existing `IDivisionAccessGuard`. Export buttons don't render without the key.

### 4.7 Performance

- All aggregation in SQL (`GroupBy` server-side), never materialised then summed in C#.
- Detail reports paginated through `PaginationHelper` (100 normal cap).
- Excel export streams the **full filtered set**, hard ceiling 50 000 rows with an
  explicit message beyond that. PDF stays page-capped (it rasterises).
- Date windows ride `JournalEntry (CompanyId, Date)`.
- `.AsNoTracking()` on every read. Never two concurrent `AppDbContext` operations.

### 4.8 Nav

Categories nest inside the **existing sidebar `Reports` group** — no route churn, and
the accounting guide's existing "Reports → Accounting Reports" paths stay valid.

---

## 5. Verification

New `scripts/test_accounting_reports.py`, asserting against the *existing* engine
rather than against itself:

- Expense report total == Σ Dr to expense accounts per the trial balance
- Group subtotals sum to the grand total; a drill-down's detail sums to its group row
- Cash Book: `opening + receipts − payments == closing`, **and** `closing ==
  GetAccountBalancesAsync` for that account
- Register totals == dashboard summary `receiptsTotal` / `paymentsTotal`
- Cheques in Hand == dashboard `pdcIn`
- Cross-tenant leak check — another company's rows never appear
- `pageSize=999999` clamps to 100

Plus, per CLAUDE.md: a case in `scripts/test_tenant_isolation.py` for the new
`companyId` endpoints, and the full pre-push gate —
`dotnet build` 0 errors · `verify_audit_2026_05_13_security.py` 67/67 ·
`test_basic_flows.py` · `test_tenant_isolation.py` ·
**`test_stock_itemtype_reflow.py` 140/140 (hard gate)** ·
`test_accounting_gl.py` · `verify_permission_sections.py` ·
`verify_public_file_allowlist.py`.

UI verified by DOM measurement at 375 / 768 / 1280 (screenshots are unreliable on this
machine) — icon `svg` width > 0, no horizontal page scroll.

---

## 6. Documentation

- `myapp-frontend/src/content/accountingGuide.js` — new "Reports" group, one section
  per report in the existing block format (`path` / `p` / `steps` / `note`), using
  **real routes**: what it is, why a business uses it, where to find it, filters,
  column meanings, how totals are computed, which transactions are included, whether
  it drills down, how to export.
- `README.md` `## Changelog` — dated entry (mandatory, same commit as the feature).

---

## 7. Later phases (designed, not started)

| Phase | Contents | Blocked on |
|---|---|---|
| 2 | Customers + Suppliers: Ledger (all-periods), Statement, Balance Summary, AR/AP aging drill-down, Outstanding, Customer Sales by Item | — (needs `JournalLine (PartyType, PartyId)` index) |
| 3 | Financial Statements: **real Balance Sheet + P&L with comparatives**, General Ledger, Account Balance Summary, Trial Balance upgrade | — |
| 4 | Sales + Purchases: both Registers, by customer·item·itemtype·account·date·tax, Payment Status, Outstanding | Discount columns need a nominated discount account (§2) |
| 5 | Taxes + Accounting Control: Tax Summary, Output/Input Tax, Tax by Customer/Supplier, Tax Transaction Detail, Journal Register, Posting Exceptions | — |
| 6 | Management: Revenue/Expense Summary, **Gross Profit, Net Profit, Customer Profitability**, Monthly Sales/Purchases/Expenses/Profit, Cash Flow Summary | **COGS-on-sale (§2) — own spec first** |

---

## 8. Phase 1 task tracker

Ordered so each task ends at a verifiable state. Backend first (compiles + testable
via HTTP), frontend second, docs/gate last.

- [x] **T1 — Backend foundation.** `Helpers/ReportPeriod.cs` (9 presets off
  `PakistanClock.Today`, validated), `DTOs/AccountingReportDtos.cs` (envelope +
  row shapes), `Helpers/ReportExcelBuilder.cs` (styled workbook, `CsvSafe`,
  totals as ordinary row). Gate: `dotnet build` 0 errors.
- [x] **T2 — Expense engine.** `IAccountingReportService` +
  `AccountingReportService.cs` + `.Expenses.cs`; `AccountingReportsController`
  expense actions; DI in `Program.cs`; `accounting.reports.export` in
  `PermissionCatalog`. Gate: build + live GET returns real rows.
- [x] **T3 — Cash & Bank engine.** `.CashBank.cs` + controller actions. Cash/Bank
  Book delegate to the `GetAccountLedgerAsync` opening/movement/closing pattern.
  Gate: build + live GET; Cash Book closing == `GetAccountBalancesAsync`.
- [x] **T4 — Indexes + permission backfill.** `AppDbContext` index config,
  additive index-only migration, `ACCT_REPORTS_EXPORT_BACKFILL_V1` idempotent
  grant. Apply manually to `db55808_custom` (design-time factory targets
  `DeliveryChallanDb`). Gate: migration applied, no drift, existing roles can export.
- [x] **T5 — Frontend shell.** `config/accountingReports.js`,
  `Components/ReportFilterBar.jsx`, `Components/ReportShell.jsx`,
  `api/accountingReportApi.js`; `AccountingReportsPage.jsx` → categorised index +
  report host; routes in `App.jsx`. Gate: `npm run build` green.
- [x] **T6 — Report views.** 9 Expense + 10 Cash & Bank; re-home Trial Balance /
  AR / AP with drill-down + `asOf`. Gate: build + DOM-verified at 375/768/1280.
- [x] **T7 — Dashboard drill-down.** Cards → report links, period in query string.
  Income/Net Profit stay inert (P&L is Phase 3).
- [x] **T8 — Tests.** `scripts/test_accounting_reports.py` (cross-checks vs trial
  balance / account balances / dashboard summary, leak check, pageSize clamp) +
  a case in `scripts/test_tenant_isolation.py`.
- [x] **T9 — Docs + gate.** `accountingGuide.js` "Reports" group with real routes;
  README `## Changelog`; frontend build + copy `dist`→`wwwroot`; full pre-push
  suite incl. `test_stock_itemtype_reflow.py` 140/140.
