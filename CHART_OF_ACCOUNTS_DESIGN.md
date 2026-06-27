# Chart of Accounts, Payments/Receipts & Data Migration — Design & Plan

> **Companion to** [`ACCOUNTING_MODULE_STRATEGY.md`](ACCOUNTING_MODULE_STRATEGY.md) (the whole
> accounting/GL vision). This file is the build + migration plan for the **Chart of Accounts**,
> **Payments/Receipts (invoice balance due + payment status)**, and **importing the client's data**.
>
> **Status (2026-06-19):** research + database analysis complete; decisions locked; **nothing built
> yet** — ready to start. No application code or data was changed; the legacy DB was analyzed read-only.
>
> **Decisions locked:**
> - Reference product = **Manager.io** (rebranded as "TechvoLogix"). Copy the *model*, not the code;
>   make the hard data entry easy ("documents in, ledger out").
> - Migration scope = **legacy DB `Data_2021` only** (2018–2022, 5 companies); current Manager data later.
> - Data-only migration is **feasible with exact figures**, verified by GL reconciliation (§12–14).
>
> **Build order:** (1) Payments/Receipts + invoice balance/status (§11) → (2) Chart of Accounts + sector
> seed (§4–6) → (3) ETL importer + reconciliation (§13) → (4) posting engine / GL (strategy doc §11.2).
>
> **Section map:** §0 TL;DR · §1–3 reference model · §4–6 CoA model/migration/seed · §7–8 API & UI ·
> §9 scope · §10 CoA checklist · §11 Payments/Receipts + balance/status · §12 legacy DB analysis ·
> §13 migration execution plan · §14 migration-capability checklist.
>
> **Researched:** 2026-06-17 (CoA + payments/receipts); database analysis 2026-06-19 (Hussain).

---

## 0. TL;DR

- We studied a reference product (**TechvoLogix Accounts**) and confirmed it is a **white-labeled
  [Manager.io](https://www.manager.io)** instance.
- Its CoA model is **statement-first** (Balance Sheet | Profit & Loss), organized **Group → Account**,
  with **control accounts fed by subledgers**, **manual drag-ordering**, **optional account codes**,
  and user-defined **subtotal "Totals"** on the P&L.
- MyApp.Api already owns the **subledgers** (`Client` = A/R, `Supplier` = A/P, `ItemType`/stock =
  Inventory), multi-tenancy, RBAC, FBR, and audit. The CoA + GL spine is the **missing piece**.
- Build order: **(1) CoA tree + sector seed → (2) posting engine + `JournalEntry` → (3)** defer
  Totals / multi-currency / cash-flow-statement classification.
- Sleeper high-leverage item: a **Manager → MyApp importer** (prospects are already on this product;
  migration is the real switching cost).

---

## 1. Reference product studied: TechvoLogix = Manager.io

The page reviewed was an authenticated CoA for a real trading business ("Jorbai Groups"). Fingerprint
that identifies it as **Manager.io, rebranded**:

- Module set in the left nav: Receipts, Payments, **Inter Account Transfers**, **Expense Claims**,
  **Withholding Tax Receipts**, Delivery Notes, Credit/Debit Notes, **Capital Accounts**,
  **Special Accounts**, Production Orders, Journal Entries, **Folders**.
- The two-column **Balance Sheet | Profit & Loss** CoA with **New Group / New Account / New Total**.
- Build-number format `24.x.x.xxxx`; account edit URLs like `/balance-sheet-account-form`,
  `/control-account-for-bank-accounts-form`; accounts keyed by **GUID**.

**Why this matters:** we're not reverse-engineering a black box. Manager's model is well-documented,
so we can copy the parts that fit an FBR-native multi-tenant SaaS and skip the rest. It also means a
**data importer is feasible** (GUID-keyed, predictable schema).

---

## 2. The CoA model observed

### 2.1 Structure

Not a flat 5-type list — it's a two-statement tree:

```
BALANCE SHEET                              PROFIT & LOSS STATEMENT
  Group: Assets                              Group: Income
    Account (regular)                          Account ...
    Account (control)  ── fed by subledger     Group: (cost of sales)
    Group: Bank & Cash (control)               Group: (expenses, nestable)
       Account, Account ... (nested)           Total: Gross/Net Profit (subtotal line)
  Group: Liabilities                         ...
  Group: Equity
  Group: Uncategorized
```

| Property | Observed |
|---|---|
| **Statement split** | Each account belongs to **Balance Sheet** or **P&L**; each column has its own add buttons |
| **Groups (nestable)** | Groups contain accounts and **sub-groups** (multi-level) |
| **Control accounts** | `Accounts receivable`, `Accounts payable`, `Inventory on hand`, `Bank & Cash`, `Capital Accounts`, `Withholding tax receivable/payable`, `Production in progress` (WIP). Detail lives in subledgers — you don't post to these directly. |
| **Manual ordering** | Every row has a drag handle; order is user-controlled, **not** by code |
| **Codes optional** | The reviewed CoA used **no account numbers** — name-driven |
| **Totals** | P&L supports `New Total` = presentation subtotal lines |
| **Per-account currency** | Manager supports currency per account (esp. bank accounts) |

### 2.2 Account edit-form field shapes (captured read-only)

Two distinct shapes — this is the core design rule:

**Regular account** (Manager type `Balance Sheet Account` / `Profit and Loss Statement Account`):
- Name (required)
- Code (**optional**)
- Group (picker → statement + group)
- Cash Flow Statement class: Operating / Investing / Financing / Cash & cash equivalents *(BS only)*
- Division *(optional dimension)*
- Starting balance + **Debit/Credit**
- Autofill — Line description *(toggle)*
- Autofill — Tax Code *(toggle → default tax)*
- Inactive
- Update / Delete

**Control / special account** (e.g. `ControlAccountForBankAccounts`,
`BalanceSheetProductionInProgressAccount`) — deliberately **thin**:
- Name, Code (optional), Group, Inactive only.
- No cash-flow / division / opening balance / autofill — because the **subledger** drives it.
- System control accounts cannot be deleted.

> Note: each named bank line in the CoA (e.g. a bank's account) is itself a *control account*
> (`ControlAccountForBankAccounts`); the **real** bank record (balance, statement, reconciliation)
> lives in the separate **Bank and Cash Accounts** module and points at that control account.

### 2.3 The live example (aggregate, no PII reproduced)

The reviewed CoA was a Karachi wholesale/trading family business: ~30 bank/cash accounts, person-named
**loan receivable / loan payable** sub-groups, a **home-vs-shop expense** split on the P&L, and
**GST / SST / WHT** tax accounts. This is exactly the persona in the strategy doc — confirming the
sector-preset CoA bet.

---

## 3. Mapping onto MyApp.Api (reuse vs new)

Data flow (the CoA is the account dimension postings land on):

```
BUSINESS DOCUMENTS            → IPostingService →   GL SPINE         → CHART OF ACCOUNTS → SUBLEDGERS
Invoice / PurchaseBill /        (new)               JournalEntry        AccountGroup        Client  → A/R   (existing)
GoodsReceipt (existing) +                           JournalLine         Account·Regular     Supplier→ A/P   (existing)
Payment/Receipt (new)                               (new)               Account·Control     ItemType→ Inv   (existing)
                                                                        (new)               BankAccount    (new)
```

| CoA concept | Already in MyApp | To build |
|---|---|---|
| A/R control | `Client` (subledger) | `Account` row + party-tagged GL lines |
| A/P control | `Supplier` (subledger) | same |
| Inventory on hand | `ItemType` + stock movements | inventory → GL valuation/COGS |
| Bank & Cash | — | `BankAccount` subledger + BankCash control account |
| Multi-company CoA | `Company` + `UserCompany` + `ICompanyAccessGuard` | per-company `Account`/`AccountGroup` tree |
| Permissions | `PermissionCatalog.cs` + `[HasPermission]` + `Can` | `accounting.coa.*` keys |
| FBR tax | `FbrService` (output/input tax computed) | bind tax accounts → default FBR rate |
| Division dimension | **Divisions already exist** (recent commits) | reuse on `Account.DivisionId` |
| Audit | `AuditLogService` | log CoA mutations + GL immutability |

---

## 4. Proposed data model — `Models/Accounting/`

```csharp
public enum FinancialStatement { BalanceSheet, ProfitAndLoss }
public enum AccountType        { Asset, Liability, Equity, Income, Expense }
public enum CashFlowClass      { Operating, Investing, Financing, CashEquivalent }
public enum ControlType {
    None, AccountsReceivable, AccountsPayable, Inventory, BankCash, Capital,
    RetainedEarnings, OutputTax, InputTax, WithholdingReceivable,
    WithholdingPayable, ProductionWip, EmployeeClearing, Rounding
}

public class AccountGroup {                 // "New Group"
    public int Id { get; set; }
    public int CompanyId { get; set; }      // tenant scope on every table
    public string Name { get; set; } = "";
    public FinancialStatement Statement { get; set; }
    public int? ParentGroupId { get; set; } // nesting
    public int Position { get; set; }        // manual drag-order
    public bool IsSystem { get; set; }       // Assets/Liabilities/Equity/Income/Expenses
}

public class Account {                       // "New Account"
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public string Name { get; set; } = "";
    public string? Code { get; set; }                       // optional
    public int AccountGroupId { get; set; }                 // → group (carries Statement)
    public AccountType AccountType { get; set; }
    public CashFlowClass? CashFlowClass { get; set; }       // BS accounts only
    public int? DivisionId { get; set; }                    // REUSE existing Divisions
    [Column(TypeName="decimal(19,4)")] public decimal OpeningBalance { get; set; }
    public bool OpeningBalanceIsDebit { get; set; }
    public string? DefaultLineDescription { get; set; }     // "Autofill — Line description"
    public int? DefaultTaxRateId { get; set; }              // "Autofill — Tax Code" → FBR rate
    public bool IsControlAccount { get; set; }
    public ControlType ControlType { get; set; }            // binds the subledger
    public bool IsActive { get; set; } = true;
    public int Position { get; set; }
}

public class BankAccount {                   // real bank record; CoA shows a BankCash control account
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public string Name { get; set; } = "";
    public string? AccountNumber { get; set; }
    public string? BankName { get; set; }
    public string CurrencyCode { get; set; } = "PKR";
    public int ControlAccountId { get; set; }               // → Account (ControlType=BankCash)
    public bool IsActive { get; set; } = true;
}

// (Optional, later) AccountTotal — P&L presentation subtotal lines.
```

The **GL spine** (`JournalEntry` immutable header + `JournalLine` with `Debit/Credit/PartyType/PartyId/
DivisionId`, idempotency-keyed) is specced in `ACCOUNTING_MODULE_STRATEGY.md` §11.2 — the CoA above is
the account dimension those lines reference.

---

## 5. Migration sketch (one EF migration)

- **New tables:** `AccountGroups`, `Accounts`, `BankAccounts` (+ `JournalEntries`/`JournalLines` with
  the spine).
- **Tenant:** `CompanyId` + FK to `Company` on every table; index `(CompanyId, Statement, Position)`.
- **Indexes:** filtered unique `(CompanyId, Code) WHERE Code IS NOT NULL`. **No** unique name index —
  account names legitimately repeat.
- **Money:** `decimal(19,4)` (CLAUDE.md §12). Never `float`/`real`.
- **Seeding:** on company create, upsert a sector-preset CoA — mirror the `PermissionCatalog` upsert in
  `Program.cs` (idempotent; gate on an AuditLog marker so it can't double-seed).
- **SQL Server gotcha (CLAUDE.md §11):** don't ALTER a table and reference the new column in the same
  batch — split `ExecuteSqlRaw`, wrap column-dependent statements in `EXEC('…')`.

---

## 6. Seed template — "Wholesale / Distribution" preset (FBR-wired)

The differentiator over Manager (which starts empty). Ship sector presets; first invoice in minutes.

```
BALANCE SHEET                              PROFIT & LOSS
Assets                                     Income
  • Bank & Cash          [BankCash]          • Sales
  • Accounts receivable  [AR]              Cost of Sales
  • Inventory on hand    [Inventory]         • Cost of goods sold      [Inventory]
  • Input Sales Tax      [InputTax]  18%   Expenses
  • Fixed assets (group)                     • Salaries, Rent, Utilities, Freight/Cartage,
Liabilities                                    Commission, Bank charges, Discount allowed,
  • Accounts payable     [AP]                  Depreciation, Misc
  • Output Sales Tax     [OutputTax] 18%
  • WHT payable          [WHTPayable]   ← 236G/236H
Equity
  • Owner's capital      [Capital]
  • Retained earnings    [RetainedEarnings]
```

`[OutputTax]`/`[InputTax]` carry `DefaultTaxRateId` → the existing FBR rate, so tax lands in the right
account automatically on a sale/purchase. That is the strategy-doc thesis ("compliance falls out of
normal data entry") made concrete. Plan presets for **wholesale / distribution / import / retail /
trading**.

---

## 7. API · permissions · tenant isolation

- `Controllers/AccountsController.cs`: `GET …/company/{id}/tree`, `POST/PUT/DELETE /api/accounts`,
  `POST …/groups`, `POST …/reorder`.
- **Every** endpoint: `await _access.AssertAccessAsync(CurrentUserId, companyId)`; never trust
  `dto.CompanyId` (CLAUDE.md §1). For updates, load the entity and assert against its stored
  `CompanyId`.
- New permission keys in `PermissionCatalog.cs`: `accounting.coa.view`, `accounting.coa.manage`.
- Control accounts: **block delete** and **block direct posting** (postings go via the subledger,
  which resolves the control account).
- `PaginationHelper` on flat lists; `CsvSafe` on export; `AuditLogService.LogAsync` on every mutation.

---

## 8. Frontend

- `myapp-frontend/src/pages/ChartOfAccountsPage.jsx`: two-column **Balance Sheet | P&L**, mobile-first
  grid (`repeat(auto-fit, minmax(min(220px,100%),1fr))`, 44px taps), drag-to-reorder, `Can`-gated
  New/Edit buttons (no button that 403s).
- Watch import casing: `Components/` capital-C, `pages/` lowercase (Linux CI is case-sensitive).

---

## 9. Recommendation, scope & open questions

**Phasing**
1. **CoA tree first** — `Account` + `AccountGroup` + `ControlType` + sector seed. Visible, low-risk,
   demos well.
2. **Posting engine + `JournalEntry`** wired to existing Invoice / PurchaseBill / GoodsReceipt — the
   CoA comes alive.
3. **Defer** Totals, multi-currency, cash-flow-statement classification.
4. **Parallel high-leverage:** **Manager → MyApp importer** (accounts + parties + opening balances).

**Open questions to resolve before/while building**
- Account PK: `int` (house convention) vs `Guid` (eases a Manager import). Leaning `int` + an optional
  `ExternalRef` column for import mapping.
- Do we expose "Totals" in v1 or hard-code the standard subtotals (Gross/Net profit) in the report?
- Per-account currency now or later? (Multi-currency banks exist in the wild — see the example.)
- Are control accounts a separate `IsControlAccount` flag (chosen here) or a separate table? Flag is
  simpler and matches Manager's single account hierarchy.

---

## 10. Build checklist for the next session

- [ ] `Models/Accounting/`: `AccountGroup`, `Account`, `BankAccount` + enums.
- [ ] `AppDbContext`: DbSets + Fluent config (decimals, indexes, FKs, no unique-name index).
- [ ] EF migration (mind the SQL Server ALTER+reference gotcha).
- [ ] Sector-preset seeder (wholesale first) on company create, idempotent + AuditLog-gated.
- [ ] `accounting.coa.view` / `accounting.coa.manage` in `PermissionCatalog.cs`.
- [ ] `AccountsController` + service + repository (tenant guard on every endpoint).
- [ ] `ChartOfAccountsPage.jsx` (two-column, mobile-first, drag-reorder, `Can`-gated).
- [ ] Tests: tenant-isolation case in `scripts/test_tenant_isolation.py`; CoA seed/CRUD in
      `scripts/test_basic_flows.py`.
- [ ] `dotnet build` → 0 errors; verify before any push (CI deploys to prod).

---

## 11. Payments, Receipts & Invoice Balance / Payment Status  *(researched 2026-06-17)*

> Studied the same Manager.io-based product (Receipts, Payments, Sales & Purchase Invoices) to model
> **balance due + payment status**, which MyApp invoices currently lack entirely.

### 11.1 What Manager shows (observed)

- **Sales Invoices list** columns: Issue date, **Due date**, Reference, Customer, …, **Balance due**,
  **Invoice Amount**, **Status**, **Days overdue**.
- **Purchase Invoices list** columns: Issue date, Reference, Supplier, …, **Invoice Amount**,
  **Balance due**, **Days overdue**, **Status**.
- **Status values:** `Paid in full`, `Overdue` (+ days, red badge), `Coming due` (unpaid, due date in
  future), and partially-paid rows show balance < total. (Manager's full set also includes
  Unpaid/Awaiting payment, Partially paid.)

### 11.2 Receipt & Payment structure (observed forms)

Receipt (money **in**) and Payment (money **out**) are mirror documents:

| | Receipt | Payment |
|---|---|---|
| Header | Date · Reference (auto) · **Paid by** contact (Customer/Supplier/Other) · **Received in** account (bank/cash) · Description | Date · Reference (auto) · **Paid from** account (bank/cash) · **Payee** contact · Description |
| Lines | # · Item · **Account** · Amount | same (default line account "Suspense") |
| Invoice allocation line | Account = **Accounts receivable** → then **Customer + Invoice + Amount** | Account = **Accounts payable** → then **Supplier + Purchase Invoice + Amount** |
| Direct line | Account = income/other (no invoice) | Account = expense/other (no invoice) |
| Multi-invoice | one receipt → many invoices | one payment → many invoices (observed: 1 payment settled 7 bills) |

Opened **from an invoice** ("New Receipt" button), the line pre-fills Account = AR, the Customer, the
Invoice, and Amount = **the invoice's current balance due**.

### 11.3 The data flow (how balance due & status are produced)

```
Invoice (total, due date)
   ▲  allocation (amount)
   │
Receipt/Payment line ── targets ──► AR/AP control account, scoped to Customer/Supplier + this Invoice

Balance due  = Invoice total − Σ allocations to this invoice   (− credit/debit notes later)
Status       = Paid in full           when balance == 0
               Partially paid         when 0 < balance < total
               Awaiting / Coming due  when balance == total and due date ≥ today
               Overdue (+ days)       when balance > 0 and due date < today
Days overdue = today − due date        (when overdue)
GL effect    = Receipt: Dr Bank, Cr AR  │  Payment: Dr AP, Cr Bank   (once GL lands)
```

Also observed: **post-dated cheque** payments (future-dated, clock-flagged, cheque # captured) — the
PDC reality the strategy doc targets.

### 11.4 What MyApp has vs. needs

- MyApp `Invoice` / `PurchaseBill` have `GrandTotal` but **no due date, amount paid, balance, or
  status**, and there is **no payment/receipt entity at all**.
- Add a lightweight **AR/AP payment subledger** now; fold it into the GL when the posting engine lands
  (the same entities feed both — no rework).

### 11.5 Proposed entities (Phase A — delivers balance/status WITHOUT needing the full GL)

```csharp
public enum PaymentDirection    { Receipt, Payment }    // money in / out
public enum InvoicePaymentStatus{ Unpaid, PartiallyPaid, Paid, Overdue }
public enum ChequeStatus        { None, Pending, Deposited, Cleared, Bounced }

public class Payment {
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public PaymentDirection Direction { get; set; }
    public DateTime Date { get; set; }
    public string? Reference { get; set; }              // auto if blank
    public string ContactType { get; set; } = "";       // Client | Supplier | Other
    public int? ContactId { get; set; }
    public int BankAccountId { get; set; }              // received-in / paid-from
    public string? Description { get; set; }
    [Column(TypeName="decimal(19,4)")] public decimal Amount { get; set; }
    public string? ChequeNumber { get; set; }           // cheque / PDC
    public DateTime? ChequeDate { get; set; }           // post-dated if > today
    public ChequeStatus ChequeStatus { get; set; }
}

public class PaymentAllocation {                        // one line; many per payment
    public int Id { get; set; }
    public int PaymentId { get; set; }
    public int? InvoiceId { get; set; }                 // sales invoice (Receipt)
    public int? PurchaseBillId { get; set; }            // purchase bill (Payment)
    public int? AccountId { get; set; }                 // OR a direct income/expense account
    [Column(TypeName="decimal(19,4)")] public decimal Amount { get; set; }
}
```

On `Invoice` / `PurchaseBill` add:
- `DueDate` (issue + `PaymentTermsDays`, default per Client/Company)
- `AmountPaid` = Σ allocations · `BalanceDue` = `GrandTotal − AmountPaid`
- `PaymentStatus` (derived) + days-overdue (computed at read)

Recompute balance/status inside a transaction on every allocation create/edit/delete. Tenant guard +
permissions (e.g. `accounting.receipt.manage`, `accounting.payment.manage`). FBR is invoice-level only —
receipts/payments are **internal AR/AP**, no FBR coupling (low risk to existing flows).

### 11.6 UI to add (the user's gap)

- Invoice & bill **lists**: add **Due date · Balance due · Status badge · Days overdue** columns.
- Invoice **detail**: status badge + a **Payments/Receipts panel** (the allocations) + a
  **"Record Receipt/Payment"** button that pre-fills amount = balance due (Manager's pattern).
- New **Receipts** and **Payments** screens (list + form); one line can allocate to one/many invoices.
- Cheque/PDC: capture cheque # + date, flag post-dated; a "Cheque Register" view can come later.

### 11.7 Phasing

1. **Phase A (this feature):** `Payment` + `PaymentAllocation` + invoice due date / balance / status +
   UI. Delivers exactly the missing "balance due / payment status" with no GL dependency.
2. **Phase B:** when CoA + posting engine land, each payment also posts Dr/Cr (Bank ↔ AR/AP) and
   balance becomes an AR/AP subledger view over the GL. Same entities — no rework.

---

## 12. Data migration analysis — legacy DB `Data_2021`  *(analyzed 2026-06-19)*

> Analyzed a restored SQL Server backup (`Data_2021`) on `.\MSSQLSERVER2` (read-only; MyApp's
> `DeliveryChallanDb` untouched) to assess importing the client's historical data with exact values.

### 12.1 What this database actually is

- A **mature relational double-entry ERP** (116 tables, classic Master/Detail), **not** the Manager.io-
  style app reviewed earlier and **not** Manager's object store. Hallmarks of a Pakistani desktop ERP
  (`VoucherMaster/Detail`, `Trader`, `CounterDenomination`, `TerminalConfiguration`, `Folio`).
- **5 companies** (`CompanyProfile`): Al Moazzam Traders, **Ali Asghar Supply Agency**, Al Aazam
  Traders, AMS Engineering, Concept Traders — the same entities behind "Jorbai Groups" in the Manager
  app, so this is the **client's legacy/previous system**.
- **Date range ≈ 2018–2022** (sales 2020-08…2022-09; receipts 2018-06…2022-10; payments 2019…2022).
  The Manager app held data into **2026** → **this `.bak` is historical, not the current live data.**

### 12.2 Core tables & the key linkages

| Area | Tables (rows) | Notes |
|---|---|---|
| Chart of Accounts | `ChartOfAccounts` (981) | Hierarchical (`Lineage`, `ControlAccountCode`, `AccountLevel`), `AccountType` A/L/E/R/C, `IsControlAccount`, stored `OpeningDebit/Credit`, `ClosingBalance`. Keyed by `AccountCode`. |
| Parties | `Trader` (806) + `TraderContactPersons` | type 1 = 592 customers, type 2 = 210 suppliers, 0 = 4 other. Each `Trader.FKAccountCode` → its CoA control account. |
| Sales invoices | `SalesInvoiceMaster` (792) / `SalesInvoiceDetail` (4,238) | Header tax/discount/charges; lines have item, qty, price, discount, tax, `FKDocumentNumber_DC` (→ challan). |
| Purchases | `PurchaseMaster` (3,045) / `PurchaseDetail` (7,084) | Multi-currency (`FKForeignCurrencyID`, `RateOfExchange`), `SupplierInvoiceNumber`. |
| Receipts (money in) | `ReceiptMaster` (755) / `ReceiptDetail` (1,729) | **`ReceiptDetail.FKDocumentNumber_Sale` → the sales invoice each line pays.** Bank in `FKAccountCode_Bank`; cheque (`ChequeNumber`, `ChequeRealizationDate`). |
| Payments (money out) | `PaymentMaster` (3,802) / `PaymentDetail` (5,495) | **`PaymentDetail.FKDocumentNumber_GRN` → the purchase each line settles.** Same cheque/bank fields. |
| General Ledger | `VoucherMaster` (10,732) / `VoucherDetail` (21,518) | Authoritative double-entry: `FKAccountCode` + `Debit`/`Credit` + `GeneratedFrom` (source doc). |
| Inventory / dims | `Item`/`MasterItem` (354), `CostCentreHierarchy/Level`, `DeliveryChallanMaster/Detail`, `QuotationMaster/Detail` | Items, cost centres (≈ divisions), challans, quotes. |

### 12.3 Data quality (control totals)

- **GL near-balanced:** Σ Debit 2,250,411,287 vs Σ Credit 2,250,211,287 → off by exactly **Rs 200,000**
  (one unbalanced voucher to find & fix during migration; otherwise clean).
- **Allocation coverage 100%:** every receipt line → a sales invoice; every payment line → a purchase.
  ⇒ per-invoice paid/balance is exactly reconstructable.

### 12.4 Source → MyApp mapping

| Legacy | MyApp target |
|---|---|
| `CompanyProfile` (5) | `Company` (one per profile) |
| `ChartOfAccounts` | `Account` + `AccountGroup` (§4) — map A/L/E/R/C → AccountType; `IsControlAccount`+`ControlAccountCode` → control flag; `Lineage` → group tree |
| `Trader` (+`FKAccountCode`) | `Client` (type 1) / `Supplier` (type 2), each tied to its control account |
| `SalesInvoiceMaster/Detail` | `Invoice` + `InvoiceItem` |
| `PurchaseMaster/Detail` | `PurchaseBill` + items |
| `ReceiptMaster/Detail` | `Payment{Direction=Receipt}` + `PaymentAllocation`→`Invoice` (§11.5) |
| `PaymentMaster/Detail` | `Payment{Direction=Payment}` + `PaymentAllocation`→`PurchaseBill` |
| `VoucherMaster/Detail` | `JournalEntry`/`JournalLine` (Phase C) **or** the reconciliation source of truth |
| `Item/MasterItem` | `ItemType` |
| `CostCentre*` | Divisions / branches |

### 12.5 Feasibility verdict & method

**Verdict: a full, exact-value import is feasible.** Reasons: clean master/detail tables, 100% explicit
receipt/payment→invoice allocation, and a complete GL to verify against.

**ETL approach:** restore → stage → map per the table above → load into MyApp (preserving document
numbers, dates, line items, tax, opening balances) → **prove correctness by reconciliation**: rebuild
a per-account trial balance from `VoucherDetail` and compare to MyApp's computed AR/AP balances, bank
balances, and totals. Tie-out ⇒ exact values.

**Caveats:** 5 companies to map; multi-currency on purchases; the Rs 200k GL imbalance; and **the date
gap** — this is 2018–2022 history; current (2022–2026) data lives in the Manager app and would need its
own export. Open decision: migrate legacy history, current data, or both (and whether to bring full GL
history or just documents + opening balances).

---

## 13. Execution plan — scope decided: migrate `Data_2021` (legacy) only  *(2026-06-19)*

Decision: import the legacy DB (2018–2022, 5 companies) into MyApp with exact values. Current Manager
data is out of scope for now.

**Sequencing — you can't import into entities that don't exist yet, so build the target first:**

**Step 1 — Build target schema in MyApp** (the feature upgrade):
- CoA: `Account` + `AccountGroup` (§4) — needed to receive `ChartOfAccounts`.
- Payments: `Payment` + `PaymentAllocation`; invoice/bill `DueDate`/`AmountPaid`/`BalanceDue`/
  `PaymentStatus` (§11.5) — needed to receive receipts/payments.
- Migrate flag: add an optional `ExternalRef` (legacy AccountCode / DocumentNumber + CostCentre) on
  imported rows so the ETL is idempotent and traceable.

**Step 2 — ETL importer** (an admin-only command/service in MyApp that reads `Data_2021` on
`.\MSSQLSERVER2` and writes the MyApp DB). Load in FK order, per company:
1. `CompanyProfile` → `Company` (5).
2. `ChartOfAccounts` → `AccountGroup` + `Account` (map A/L/E/R/C; rebuild tree from `Lineage`).
3. `Trader` → `Client`/`Supplier` (type 1/2), tying each to its control account via `FKAccountCode`.
4. `Item/MasterItem` → `ItemType`.
5. `SalesInvoiceMaster/Detail` → `Invoice`+items; `PurchaseMaster/Detail` → `PurchaseBill`+items
   (preserve document numbers, dates, tax, discounts; multi-currency → store original + converted).
6. `ReceiptMaster/Detail` → `Payment{Receipt}` + `PaymentAllocation`→Invoice (via
   `FKDocumentNumber_Sale`); `PaymentMaster/Detail` → `Payment{Payment}` + allocation→PurchaseBill
   (via `FKDocumentNumber_GRN`).
7. Recompute `AmountPaid`/`BalanceDue`/`PaymentStatus`; import opening balances from
   `ChartOfAccounts.OpeningDebit/Credit`.

**Step 3 — Reconcile (prove exact values):** rebuild a per-account trial balance from legacy
`VoucherDetail` (Σ Debit/Credit by `FKAccountCode`) and compare to MyApp's post-import AR/AP balances,
bank balances, and total sales/purchases. Tie-out = done. Resolve the **Rs 200,000 GL imbalance**
(find the bad voucher; fix at source or post a documented suspense adjustment).

**Build-time questions to resolve (not feasibility blockers):**
- `FKCostCentreID` vs `FKCompanyID` — which is the true tenant partition for these 5 entities, and do
  they become 5 MyApp `Company` rows or one group? (`FKCostCentreID` appears on nearly every table.)
- The purchase-payment link is via `FKDocumentNumber_GRN` — confirm whether GRN = `PurchaseMaster` or a
  separate goods-receipt table.
- Foreign-currency purchases — store both transaction and functional amounts.
- How much to bring: documents + opening balances (recommended) vs full `VoucherMaster/Detail` GL
  history (only if Phase C posting engine exists by then).

---

## 14. Is MyApp capable of a faithful data-only migration? — capability checklist  *(2026-06-19)*

> Question: once we build CoA + Payments/Receipts, can we pull their latest DB and map all
> invoices/payments/receipts/accounts into MyApp's structure with **correct figures**?
> **Answer: Yes — it's an ETL/field-mapping (data, not structure), provided MyApp carries the items
> below.** Evidence from `Data_2021`.

| # | Capability MyApp must have | Why / evidence | Status |
|---|---|---|---|
| 1 | **Import path that stores source totals verbatim** (subtotal, discount, tax, grand total, paid, balance) + `ExternalRef` — not always recompute | Guarantees exact figures despite tax/discount-model differences. MyApp's normal create recomputes totals (`InvoiceService`); migration needs an explicit-totals path | **NEW** |
| 2 | Header **add/less adjustment** on invoices (or covered by #1) | 95/792 sales invoices use AddAmount/LessAmount | **NEW** |
| 3 | **Multi-company** mapping (source company → MyApp Company) | 5 companies | EXISTS |
| 4 | **Party-as-subledger** transform: their per-party GL accounts → Client/Supplier under AR/AP control, tie-out kept | `Trader.FKAccountCode`; 592 cust + 210 supp | EXISTS + CoA design |
| 5 | **Payment → many invoices** allocation (partial amounts) + direct non-invoice lines | per-line invoice links in Receipt/Payment detail | PLANNED (§11.5) |
| 6 | Preserve **document numbers** on import (explicit, per company, no collision) | `DocumentNumber` per company/cost-centre | **NEW** |
| 7 | **Void/cancel** state on payments/receipts/invoices | 181 payments + 85 receipts voided | PARTLY EXISTS |
| 8 | **Cheque/PDC** fields (number, date, status) | 623 receipts + 690 payments are cheques | PLANNED (§11.5) |
| 9 | **Opening balances** per account | `ChartOfAccounts.OpeningDebit/Credit` | PLANNED (§4) |
| 10 | **Migrated/historical flag** (exclude from FBR submit + demo KPIs) | legacy 2018–2022, pre-FBR | **NEW (small)** |
| 11 | **Multi-currency ready** (currency + FX + dual amounts) | NOT used here (0/3,045) but the *current* Manager system may → build to be safe | NEW (defer if PKR-only) |

**De-risked (absent in this data):** foreign currency, second tax line, rounding/extra-charge/additional-
discount, returns (~5).

**Correct-figures guarantee = reconciliation:** after import, rebuild the trial balance from their GL and
tie out AR/AP balances, bank balances, and document totals. Tie-out ⇒ figures are provably exact.
Resolve the Rs 200,000 GL imbalance here.

**For the *latest* (current Manager) DB:** same method + capabilities, but re-validate against its actual
schema when provided (it may use multi-currency / FBR IRNs this legacy set doesn't).

---

*This document is a design proposal. No application code has been changed.*
