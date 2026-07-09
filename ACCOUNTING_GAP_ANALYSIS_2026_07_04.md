# Accounting Module — Functional Gap Analysis vs TechvoLogix (Manager.io)

**Date:** 2026-07-04 · **Branch analyzed:** `feat/sales-quote-order` · **DB:** `DeliveryChallanDb` on `CRKRL-HUSSAHUZ1\MSSQLSERVER2`
**Reference:** https://accounts.techvologix.com — a rebranded **Manager.io Server Edition 24.3.10.1347** (verified from the app footer). Live business inspected: "Jorbai Groups" (30 bank accounts, 914 receipts, 15,417 payments, 586 transfers, 138 journal entries, 1,384 sales invoices, 5,086 purchase invoices).

---

## 0. Executive summary

**The single architectural difference that explains almost every gap:** in Manager.io, *every transaction is a general-ledger posting* and *every figure on every screen is computed live from the ledger*. In MyApp, **no general ledger exists** — there is no `JournalEntry`/`JournalLine` table, no posting engine, and no transaction ever debits or credits an account. Our accounting module today is:

1. an **AR/AP settlement subledger** (`Payments` + `PaymentAllocations` → `Invoice.AmountPaid` / `PurchaseBill.AmountPaid` roll-ups),
2. a **display-only Chart of Accounts** tree (opening balances only),
3. a **legacy ETL** that reads the old GL (`VoucherDetail`) for document totals but discards the journal detail.

This was a deliberate phasing decision — `Models/Accounting/Payment.cs:15-18` says it outright: *"Phase A … delivers invoice/bill balance-due and payment status WITHOUT the GL. When the posting engine lands (Phase B) the same row also posts Dr/Cr."* Phase B (design build-order step 4 in `CHART_OF_ACCOUNTS_DESIGN.md:17`, fully specced in `ACCOUNTING_MODULE_STRATEGY.md §11`) **was never built**. Both reported bugs trace back to this plus one frontend decision (details in §6 and §7).

---

## 1. How the reference app works (the model to match)

### 1.1 Ledger-first architecture
- Receipts, Payments, Inter Account Transfers, Journal Entries, Sales/Purchase Invoices, Credit/Debit Notes are all *source documents that generate balanced GL postings* at save time.
- **All balances are live queries over the ledger** — the Summary page, the CoA, the bank list, per-customer AR, and every report are the same data at different groupings. Nothing is denormalized; editing/deleting a document immediately reflows every figure.
- **Control accounts have subsidiary dimensions**: Accounts receivable → Customer → Invoice; Accounts payable → Supplier → Purchase invoice; Bank & Cash → bank account; also Employee clearing, Capital accounts, Special accounts, Inventory (per item). A posting to a control account *requires* the sub-entity (the receipt form's AR line demands Customer + optionally a specific Invoice).
- **Drill-down chain everywhere:** Summary figure → control account per-sub-account balances → transaction ledger with running Dr/Cr balance → each row's Edit/View form.

### 1.2 Chart of Accounts (Settings → Chart of Accounts)
Two panes — **Balance Sheet** and **Profit & Loss** — each with `New Group` / `New Account`; P&L also has **`New Total`** (presentation subtotal rows, e.g. "Net loss"). Rows have Edit + drag-reorder handles.

**Balance Sheet account form:** Name · Code (optional) · Group (searchable dropdown of top-level sections *and* custom groups — Assets, Liabilities, Equity, Bank & Cash, ADVANCES SHOP, LOAN PAYABLE, …) · **Cash Flow Statement classification** (Operating / Investing / Financing / Cash & cash equivalents) · Division (optional) · **Starting balance (amount + Debit/Credit selector)** · Autofill—Line description · Autofill—Tax Code · Inactive · Update/Delete.

**P&L account form:** same minus Starting balance and Division.

**Group form:** Name + parent Group only — groups nest arbitrarily; an account's "type" is *derived from its placement* (which statement pane + which group), not a separate enum field. Custom P&L groups carry "Less:" semantics for the statement layout.

**Built-in control accounts** (Accounts receivable, Accounts payable, Inventory on hand, Retained earnings, Suspense, Employee clearing, WHT payable/receivable, Capital accounts): editable only for Name (rename), Code, Group placement — **no Delete button**. Unplaced accounts land in an **"Uncategorized"** bucket that renders at the bottom of the statement.

**Custom control accounts** (Settings → Control Accounts → "Bank and Cash Accounts" category): per-bank control accounts (Name/Code/Group/Inactive) so each bank renders as its own balance-sheet line under the "Bank & Cash" group. Manager supports control accounts "made of" customers, suppliers, employees, inventory items, special accounts, fixed assets.

**A Suspense account** exists as a built-in equity row — unbalanced/miscoded amounts land there and are visibly non-zero until fixed (Jorbai shows −385,057).

### 1.3 Bank & Cash Accounts (main tab)
Bank accounts are **subledger entities** (not plain CoA rows) created via "New Bank or Cash Account": Name · Code · Division · **Control account** (which CoA line this bank aggregates into — its own dedicated control account in Jorbai's setup) · Starting balance (PKR) · IBAN toggle · **"Can have pending transactions"** (enables cleared-vs-actual tracking) · Credit limit toggle · Inactive.

List columns: **Uncategorized Receipts · Uncategorized Payments (badge counts of transactions needing coding) · Cleared balance · Pending deposits · Pending withdrawals · Actual balance · Last Bank Reconciliation date**, plus footer totals. Tools: Import bank statement, Advanced Queries, Batch Operations, Edit columns, Copy to clipboard, "Find & recode" (bulk re-account).

**Money movement documents:**
- **Receipt:** Date · auto-numbered Reference · Paid by (Contact: Other/Customer/Supplier) · Received in (bank/cash account) · **Cleared (On the same date / On a later date)** · Description · lines = Item? · **Account** (any GL account; picking AR reveals Customer + Invoice sub-selectors for allocation) · Qty/Discount optional columns · Amount · tax-inclusive/exclusive toggle · Fixed total · attachments. **Posting: Dr bank, Cr per-line accounts** (AR line reduces that customer's/invoice's balance).
- **Payment:** mirror (Paid from / Payee); lines additionally carry **Tax Code, Project, Division**. **Posting: Dr per-line accounts (AP line settles supplier invoices), Cr bank.**
- **Inter Account Transfer:** separate doc — Paid from + Received in + amount (both sides for FX) · Dr receiving bank, Cr paying bank. 586 of them in Jorbai — this is a first-class daily workflow.
- **Bank Reconciliation:** per bank per date, operator asserts the **statement balance**; system computes the ledger closing balance; shows **Discrepancy** and Reconciled/Unreconciled status; works with per-transaction cleared/pending status.

Paid/unpaid status on invoices is *derived from the AR ledger* (receipt allocations), same as ours — but theirs also feeds customer statements, aged receivables, and the Customers tab (per-customer AR balance, WHT receivable, Paid/Unpaid badge, uninvoiced amounts).

### 1.4 Journal Entries
- Form: Date · auto Reference · Narration · lines = **Account (searchable, includes control accounts with Customer/Supplier + Invoice sub-selectors) · Debit · Credit · Tax Code · Project · Division** · live footer totals for both columns · optional Description/Qty columns · "Cash transaction for cash-flow-statement purposes" flag · attachments.
- **Validation: entry must balance** (Σ debit = Σ credit); list shows a green **"Balanced"** status per row.
- **Restriction:** bank/cash accounts cannot be posted via JE (Manager forces receipts/payments/transfers for money movement — keeps reconciliation coherent).
- Edit and delete are unrestricted (with full History audit trail per record); balances recompute instantly.
- Real-world use seen in Jorbai: small **DISCOUNT** JEs crediting specific customer invoices (Dr Discount expense, Cr AR→customer→invoice) — i.e. JEs participate in invoice settlement alongside receipts.

### 1.5 Summary page (their dashboard)
- Config (Edit): **period From/To**, **cash-basis toggle**, show account codes, exclude zero balances, groups to collapse.
- Layout = a live **Balance Sheet (as at To-date)** and **P&L (for the period)** side by side, using the CoA's exact groups; every amount is a link into the GL drill-down.
- **Warning banner:** "There are 64,656 transactions dated after 31/01/2024 therefore they are not accounted for in this view" — date-scope transparency.
- Computed rows: group subtotals, **Retained earnings** (all prior P&L), **Net profit/loss** for the period, Suspense, Uncategorized.
- Left nav shows **record counts per module** (badges) — a lightweight health/summary signal.

### 1.6 Reports catalog (all ledger-derived)
Financial: P&L, P&L Actual-vs-Budget (from Forecasts), Balance Sheet, **Cash Flow Statement**, Statement of Changes in Equity, Cash & cash equivalents, Receipts & Payments Summary, Bank Account Summary. GL: **Trial Balance, General Ledger Summary, General Ledger Transactions**. Tax: Tax Audit/Summary/Reconciliation/Transactions, Taxable Sales per Customer, Taxable Purchases per Supplier. AR/AP: **Aged Receivables, Aged Payables, Customer/Supplier Summary, Customer/Supplier Statements (Unpaid Invoices | Transactions)**. Plus sales-invoice totals ×3, inventory ×3, expense claims, capital accounts, employee/payslip, Division Exception Report, Custom Reports.

### 1.7 Other accounting-relevant settings
**Lock Date** (period close — blocks edits before a date), Tax Codes, Divisions, Recurring Transactions, Capital subaccounts, Forecasts (budget), Non-inventory items, Customer portals. Every list has Advanced Queries, Batch Operations, Edit Columns, Copy to clipboard, per-record **History** (audit trail), attachments on any document, Form Defaults per doc type.

---

## 2. What we have today (verified inventory)

| Layer | Exists | Evidence |
|---|---|---|
| Chart of Accounts (groups tree + accounts, 5 `AccountType`s, 14 `ControlType`s, opening balances, wholesale preset seeder, tenant-guarded CRUD ×10 endpoints) | ✅ | `Models/Accounting/*`, `Controllers/AccountsController.cs`, `Services/Implementations/AccountService.cs`, `CoaPresetSeeder.cs` |
| Receipts & Payments subledger (direction-scoped numbering, allocations to invoices/bills, over-allocation guard, void, cheque/PDC fields, AmountPaid reflow, paid-status calculator) | ✅ | `PaymentService.cs`, `PaymentsController.cs`, `Helpers/PaymentStatusCalculator.cs` |
| Legacy ETL (masters/documents/receipts-payments from `Data_2021` .bak) | ✅ (3c broken — see §8) | `LegacyImportService.cs` |
| Frontend: Receipts, Payments, Chart of Accounts, Data Migration pages; payment history + record-payment embedded in invoice/bill screens | ✅ | `myapp-frontend/src/pages/*`, `Components/PaymentForm.jsx` |
| **General ledger (JournalEntry/JournalLine)** | ❌ absent | repo-wide grep hits only the two design docs |
| **Posting engine (IPostingService)** | ❌ absent | — |
| **Manual journal entries (UI + API)** | ❌ absent | no controller, no permission keys |
| **Account balances from transactions** | ❌ | CoA tree returns `OpeningBalanceTotal` only (`AccountService.cs:49-52`) |
| **Bank account subledger / transfers / reconciliation / statement import** | ❌ | no entities |
| **Trial balance / P&L / Balance Sheet / ledger reports** | ❌ | no endpoints |
| **Accounting dashboard (cash, AR/AP, profit)** | ❌ | `DashboardService.cs` is sales/purchase/FBR/inventory only |
| **Lock date / period close** | ❌ | — |

**DB reality check** (read-only, CompanyId=5 "Jorbai Groups"): Accounts=167 (0 null/invalid types), AccountGroups=21, Payments=1,932, PaymentAllocations=2,695, Invoices=1,271, PurchaseBills=2,375. **No ledger table exists.** `Payments.BankAccountId` NULL on 1,931/1,932; `PaymentAllocations.AccountId` NULL on all 2,695. Neither column has an FK to `Accounts`.

---

## 3. Gap analysis — Chart of Accounts

| # | Gap | Reference behaviour | Ours | Severity |
|---|---|---|---|---|
| C1 | **Live balances per account/group** | Every CoA row shows its ledger balance; groups subtotal; drill-down to transactions | Opening balance only, everything 0 | **Critical** |
| C2 | **Cash Flow Statement classification** used | Operating/Investing/Financing/CashEquivalent on every account, feeds CFS report | `CashFlowClass` column exists, nothing consumes it, seeder leaves null | Medium |
| C3 | **P&L "Totals"** (subtotal presentation rows) | `New Total` button on P&L pane | Not modeled (deferred in design §2.1) | Low |
| C4 | **Autofill — Line description / Tax code** on postings | Checkbox on account form, auto-fills transaction lines | Columns exist (`DefaultLineDescription`, `DefaultTaxRateId`), no TaxRate entity, nothing consumes them | Low (until posting engine) |
| C5 | Reorder UX | Drag handles | `Position` via update DTO only; no /reorder endpoint | Low |
| C6 | **Uncategorized bucket** | Group-less accounts render in "Uncategorized" | Account must have a group (FK not null) — fine, but imported dual trees (seed + legacy, duplicate "Assets"/"Liabilities" roots) render confusingly | Medium (UX) |
| C7 | Built-in control accounts renameable but undeletable, always present | AR/AP/Inventory/RE/Suspense guaranteed to exist per business | Seeding is **manual** (`POST seed-wholesale`); a company can have **zero** accounts, no AR/Sales rows — the future posting engine would have nothing to target | **High** |
| C8 | **Suspense account** behaviour | Unbalanced/miscoded amounts surface visibly | No concept | Medium (comes with GL) |
| C9 | Inactive accounts hidden from pickers but retain history | Same idea | `IsActive` exists and is respected by bank-cash picker ✅ — but no "has transactions" delete-guard (nothing references Accounts by FK), orphan `PaymentAllocation.AccountId` possible | **High** (integrity) |
| C10 | Per-record **History** (audit) on CoA edits | Every record has History | No `AuditLogService` calls in CoA mutations (design §7 item skipped) | Medium |
| C11 | Account codes shown/toggleable on statements | "Show account codes" summary option | Code chip in tree only | Low |
| C12 | UI-created control accounts | n/a (built-ins) | UI create sends `controlType` but never `isControlAccount` → account gets control type without the flag → not delete-protected (`AccountService.cs:233` trusts DTO) | **High** (one-line server fix: derive flag from ControlType) |

**Missing validations/business rules (CoA):** cycle detection beyond self-parent on group moves; statement-consistency on account type *changes* (moot while immutable); division/tax-rate existence+tenant checks on account DTOs; group delete allowed only when empty ✅ (have); code-unique-per-company ✅ (have).

## 4. Gap analysis — Bank & Cash

| # | Gap | Severity |
|---|---|---|
| B1 | **No bank-account subledger entity** — banks are plain CoA rows; no IBAN/number/branch, no credit limit, no per-bank control-account mapping | High |
| B2 | **No running bank balances** (cleared vs actual, pending deposits/withdrawals). Our `ChequeStatus` (Pending/Deposited/Cleared/Bounced) is the seed of "pending transactions" but nothing aggregates it | **Critical** (with GL) |
| B3 | **No Inter Account Transfer** document — moving cash bank↔cash today would require a fake payment+receipt pair (which would double-count contact-wise) | **High** |
| B4 | **No bank reconciliation** (statement-balance assertion + discrepancy + status) | Medium |
| B5 | **No bank statement import** | Low |
| B6 | **No cheque/PDC register view**; no endpoint to update `ChequeStatus` independently of a full payment edit | Medium |
| B7 | Direct income/expense lines on receipts/payments (their line "Account" can be *any* GL account) — our `PaymentAllocation.AccountId` is modeled but UI never sends it, no FK, no validation | **High** |
| B8 | Multiple bank accounts | ✅ supported (30 in picker incl. migrated ones via group-name heuristic) — but imported payments carry the legacy GL code in free-text `BankAccountName` instead of `BankAccountId` (1,931/1,932 NULL) even though those accounts exist with matching `ExternalRef` — **backfillable today** | High |

**How their postings work (for our posting-engine spec):**
- Customer receipt: `Dr Bank/Cash (bank sub-account) — Cr AR (customer, invoice)` [+ Cr any direct income lines]
- Supplier payment: `Dr AP (supplier, purchase invoice) [+ Dr direct expense lines] — Cr Bank/Cash`
- Sales invoice: `Dr AR (customer, invoice) — Cr Income account(s) per line — Cr Tax payable` (+ `Dr Inventory-cost / Cr Inventory on hand` for stock items)
- Purchase invoice: `Dr Inventory on hand / expense lines + Dr Input tax — Cr AP (supplier, bill)`
- Credit note: exact reversal of the invoice posting; Debit note: reversal of purchase posting
- Transfer: `Dr receiving bank — Cr paying bank`
- WHT receipts: `Dr WHT receivable — Cr AR (customer)`

## 5. Gap analysis — Journal Entries

Everything is missing (module absent). Their contract to replicate:
- Header: Date, auto Reference, Narration; lines: Account + (Customer|Supplier + Invoice when control account) + Debit + Credit + TaxCode + Project/Division; **Σ Dr = Σ Cr enforced**; live totals in form; "Balanced" badge in list.
- **Bank/cash accounts excluded from JE account picker** (money movement must be receipt/payment/transfer).
- Edit/delete allowed with audit History; every save reflows balances (trivial when balances are queries).
- Automation hooks: JE lines allocating to specific invoices participate in AR settlement (their DISCOUNT pattern) — for us that means JE lines with `InvoiceId` should also feed `AmountPaid` reflow, or better: paid-status should come from the AR ledger once it exists.

## 6. Root cause A — CoA edit form "Type / Control Type dropdowns do not load" ✅ SOLVED

**They are not failing to load — they are deliberately disabled in edit mode.** Verified directly:

- `myapp-frontend/src/pages/ChartOfAccountsPage.jsx:279` — `<select value={accountType} … disabled={isEdit}>`
- `ChartOfAccountsPage.jsx:289` — `<select value={controlType} … disabled={isEdit}>`
- `isEdit = isAccount && !!form.id` (line 192). Create mode → enabled (works); edit mode → a disabled `<select>` never opens its option list, which operators report as "doesn't load".

There is **no API call behind these dropdowns at all** — options are hardcoded arrays (`ACCOUNT_TYPES` line 13, `CONTROL_TYPES` lines 14-15), so no 404/permission/serialization issue is possible. DB is clean (0 null/invalid type values across 167 accounts; enums are ints in DB, strings on the wire, matching option values exactly). This has been the behaviour since the original CoA UI commit (`5324631`) — a deliberate end-to-end immutability contract: `UpdateAccountDto` (`DTOs/CoaDtos.cs:98-111`) has **no** `AccountType`/`ControlType` members and `UpdateAccountAsync` never writes them, so even an enabled dropdown would silently not persist.

**Secondary defect:** `CONTROL_TYPES` omits three backend enum values (`ProductionWip`, `EmployeeClearing`, `Rounding` — `AccountingEnums.cs:35-37`). A controlled select whose value isn't among its options renders blank. No current data produces these values, but it's a latent trap.

**Exact fix — two options (pick one):**

**Option A (recommended — matches reference: Manager also fixes classification at creation; group placement is what you re-home):**
1. In `CoaForm`, when `isEdit`, render Type and Control type as read-only text (e.g. `<input readOnly disabled value={accountType} title="Fixed after creation" />`) instead of disabled selects, with a hint "Fixed after creation — create a new account to reclassify".
2. Stop sending `accountType`/`controlType` in the update payload (lines 213-217) — they're dead fields.
3. Add the 3 missing values to `CONTROL_TYPES` (or consciously keep them backend-only).

**Option B (make them editable):**
1. Remove `disabled={isEdit}` (lines 279, 289).
2. Add `public string? AccountType { get; set; }` / `public string? ControlType { get; set; }` to `UpdateAccountDto`.
3. In `UpdateAccountAsync` parse+assign them, **validating** that a type change keeps the account's statement consistent with its group (`StatementFor`, `AccountService.cs:331-333`), re-deriving `IsControlAccount = ControlType != None`, and blocking control-type changes on seeded system accounts (they're delete-protected for a reason).

**In both options (server-side hardening):** in `CreateAccountAsync`, derive `IsControlAccount` from `ControlType` instead of trusting the DTO — today a UI-created "AccountsReceivable" account is not flagged, so it isn't delete-protected.

## 7. Root cause B — every CoA balance shows zero ✅ SOLVED

**The CoA screen has never displayed transactional balances — it displays `Account.OpeningBalance`, and the ledger that should feed real balances was never built.**

The complete chain (all verified):
1. `ChartOfAccountsPage.jsx:90` renders `node.openingBalanceTotal`; line 103 renders `a.openingBalance`. The page makes exactly one data call: `getCoaTree` → `GET /api/accounts/company/{id}/tree`.
2. `AccountService.GetTreeAsync` (`AccountService.cs:21-63`) — the *only* balance math in the whole CoA path is lines 49-52: an in-memory Σ of the static `OpeningBalance` column + children. **Tables read: `AccountGroups`, `Accounts`. Nothing else.**
3. Every seeded account starts with `OpeningBalance = 0`; legacy-imported accounts also got 0 because the old system kept activity in `VoucherDetail`, not in the CoA's OpeningDebit/OpeningCredit columns. So the sum of zeros is zero, everywhere, always.
4. Meanwhile the 1,932 payments / 2,695 allocations / 1,271 invoices / 2,375 bills write **only their own module tables** + `AmountPaid` roll-ups. Repo-wide: no `JournalEntry`, no `LedgerEntry`, no `IPostingService`, no debit/credit column anywhere. `PaymentService` touches `Accounts` read-only (bank-name resolution). Invoice/bill/credit-note services never touch `Accounts` at all.

Ruled out with evidence: wrong companyId filter (correct at `AccountRepository.cs:19,25`), date filter (none exists), response-shape/undefined→0 (fields match), unlinked AccountId as *primary* cause (real — all 2,695 allocations have NULL AccountId — but secondary; nothing aggregates them anyway).

**Complete solution = build Phase B (the GL spine).** Concretely:
1. **Schema:** `JournalEntries` (Id, CompanyId, EntryNo, Date, Narration, SourceDocType, SourceDocId, Status, ReversalOfEntryId, DivisionId?, CreatedAt/By) + `JournalLines` (Id, JournalEntryId, AccountId FK→Accounts, Debit decimal(19,4), Credit decimal(19,4), PartyType/PartyId, InvoiceId?/PurchaseBillId?, Description, DivisionId?). Unique `(CompanyId, SourceDocType, SourceDocId)` for idempotency; index `(CompanyId, AccountId, Date)` for balance queries. Additive migration only (per prod rules).
2. **`IPostingService`** with the four invariants from `ACCOUNTING_MODULE_STRATEGY.md §11.2`: always balanced, immutable after post (edits = reversal + repost), idempotent per source document, transactional inside the *caller's* existing `BeginTransactionAsync`. Resolve target accounts via `Account.ControlType` (AR/AP/BankCash/OutputTax/InputTax/Inventory/RetainedEarnings) — and fail loudly (or route to a Suspense account) when a control account is missing.
3. **Wire into existing flows** (each already has a transaction to join): `PaymentService` create/update/delete, `InvoiceService` create/edit/cancel + credit/debit notes, `PurchaseBillService` create/edit/delete. Feature-flag per company (`Company.GlPostingEnabled`) so Hakimi/Roshan are untouched until enabled (additive/tenant-scoped per operating rules).
4. **Backfill job:** idempotent one-time posting of existing Payments/Invoices/PurchaseBills (AuditLog marker `GL_BACKFILL_V1` per CLAUDE.md §11 pattern), runnable per company.
5. **Balance query:** `Balance = signed(OpeningBalance) + Σ(JournalLines.Debit − Credit)` grouped by account, one `.AsNoTracking()` query; add `balance`/`balanceTotal` to `AccountDto`/`CoaGroupNode`; optional `asAt`/`from`/`to` params.
6. **Frontend:** CoA renders real balances (credit-natural accounts sign-flipped for display), each amount links to a new account-ledger view.
7. **Interim option (if you want non-zero numbers before the GL lands):** compute control-account figures from existing subledgers — AR = Σ invoice `BalanceDue`, AP = Σ bill `BalanceDue`, Bank/Cash = Σ signed payments per `BankAccountId`, P&L lines from `PaymentAllocation.AccountId`. Cheap, but it can't produce Equity/Retained earnings or a balanced statement — treat it as a stopgap only.

## 8. Bonus defect found during analysis (not in your list)

**Legacy import Step 3 (receipts) is broken at HEAD:** commit `48fa176` changed the invoice ExternalRef writer to `$"sinv:{h.CompanyId}:{h.Doc}"` (`LegacyImportService.cs:479`) but the receipt-allocation resolver still builds `$"sinv:{doc}"` (line 829). Every receipt allocation resolves to nothing and is silently skipped. Purchase-bill side (`pbill:{doc}`) is unaffected. Fix requires division-disambiguating the legacy doc number on the receipt side (via receipt header/trader context). Also: `ReadCoa` silently drops legacy accounts with unmapped type chars (line 1052) without counting them.

## 9. Database / design recommendations

1. **Wire the missing FKs now** (independent of the GL): `Payments.BankAccountId → Accounts.Id` and `PaymentAllocations.AccountId → Accounts.Id` (Restrict/NoAction to avoid cascade cycles), plus service-side tenant validation of allocation `AccountId`. Today nothing stops dangling references (`AppDbContext.cs:678-679` says "wire the FK then" — the table has existed since June).
2. **Backfill `Payments.BankAccountId`** from `BankAccountName` (legacy GL code) ↔ `Account.ExternalRef/Code` — data is already matchable; 1,931 rows.
3. **Auto-seed the CoA on company create** (idempotent, AuditLog-gated) or at minimum block enabling GL posting until control accounts exist. The posting engine must never find "no AR account".
4. **Do not build a `BalanceSnapshot`/denormalized balance column.** Match the reference: balances are queries. With `(CompanyId, AccountId, Date)` indexed and per-company row counts in the tens of thousands, live aggregation is milliseconds. Add caching only if proven necessary.
5. `decimal(19,4)` for Debit/Credit (matches Account.OpeningBalance precision); keep document amounts 18,2.
6. **Period locking:** `Company.LockDate` (nullable) checked by the posting service and by document create/edit/delete — the reference's Lock Date is the minimum viable "period close".
7. Journal immutability: no UPDATE path on posted lines; corrections are reversal entries linked via `ReversalOfEntryId` (keeps FBR-grade auditability and mirrors your credit-note pattern).
8. Merge/mark the **dual CoA trees** for CompanyId=5 (seeded `seed:*` tree + imported legacy tree with duplicate roots) before turning balances on — otherwise statements will show two "Assets" sections.
9. Add accounting cases to the pre-push suite: a `scripts/test_accounting_posting.py` proving Σ debits = Σ credits per entry, per company trial balance = 0, invoice→receipt→balance roll-forward, and tenant isolation on all new endpoints (CLAUDE.md test-discipline table).

## 10. Dashboard — theirs, and a better one for us

**Their Summary =** live BS + P&L for a configurable period, cash-basis toggle, drill-down everywhere, "N transactions outside range" banner, nav badges as record counts. All values live GL queries; nothing cached.

**Proposed MyApp Accounting Dashboard** (new `/accounting/dashboard`, backend `GET /api/accounting/summary?companyId&from&to&divisionId`, permission `accounting.dashboard.view`; all figures live queries; every card click-through to its ledger/list):

*Row 1 — Cash & liquidity:* Total Cash & Bank (Σ BankCash account balances) with per-account breakdown; Pending cheques in (PDC receivable) / out from `ChequeStatus=Pending|Deposited`; Net cash flow this period (Σ receipts − Σ payments).
*Row 2 — Working capital:* Receivables total + **aging buckets (0-30/31-60/61-90/90+)** from invoice due dates (we already store DueDate/BalanceDue — buildable **today**, pre-GL); Payables total + aging; Net working capital.
*Row 3 — Profitability (needs GL):* Income, Expenses, **Net profit** for period + 12-month trend; Gross margin (Sales − Inventory-cost); GST position (Output − Input — already on the hero band, move/copy here).
*Row 4 — Action lists:* Top 5 debtors (drill to statement), Top 5 creditors, overdue invoice count/value, PDCs due in next 7 days, recent receipts/payments, unreconciled bank accounts (once B4 exists), Suspense ≠ 0 warning.
*Extras the reference lacks:* division filter (we have divisions on all docs), FBR-compliance cross-link (unsubmitted invoice value), DSO/DPO trend, per-division P&L mini-cards.

Rows 1-2 and half of Row 4 are computable from the **existing subledger** — they don't wait on the posting engine.

## 11. Prioritized implementation plan

### P0 — Fixes (hours each)
| # | Task |
|---|---|
| P0-1 | CoA edit form: Option A read-only Type/Control-type + hint; drop dead payload fields; sync `CONTROL_TYPES` (+3 values) |
| P0-2 | Server: derive `IsControlAccount` from `ControlType` in `CreateAccountAsync` |
| P0-3 | Fix 3c receipts-import ExternalRef mismatch (`sinv:{companyId}:{doc}` resolver) |
| P0-4 | Wire FKs: `Payments.BankAccountId`, `PaymentAllocations.AccountId` → `Accounts` + tenant validation of allocation AccountId |
| P0-5 | Backfill `Payments.BankAccountId` from legacy code ↔ `Account.ExternalRef` |

### P1 — GL spine (the big one; ~1.5-2 weeks, ships value at every step)
| # | Task |
|---|---|
| P1-1 | `JournalEntry`/`JournalLine` schema + migration + indexes + `Company.GlPostingEnabled` flag + `LockDate` |
| P1-2 | `IPostingService` (balanced/idempotent/immutable/transactional) + posting profiles via ControlType + missing-account guard |
| P1-3 | Wire receipts/payments (create/update/void) → postings |
| P1-4 | Wire invoices + credit/debit notes → postings (Dr AR / Cr Sales / Cr Output tax; reversals) |
| P1-5 | Wire purchase bills → postings (Dr Inventory|Expense + Input tax / Cr AP) |
| P1-6 | Backfill job (`GL_BACKFILL_V1`) per company |
| P1-7 | CoA balances: grouped ledger query + `balance`/`balanceTotal` in DTOs + frontend render + as-at param |
| P1-8 | Account ledger drill-down endpoint + page (transactions, running balance) |
| P1-9 | Manual Journal Entries: entity reuse + `accounting.journal.view/create/delete` permissions + balanced-entry validation + UI (block bank/cash accounts in the picker) |
| P1-10 | `scripts/test_accounting_posting.py` + tenant-isolation cases |

### P2 — Banking parity
| # | Task |
|---|---|
| P2-1 | Bank account details (extend Account or small `BankAccountProfile`: number/IBAN, branch, credit limit) + Bank & Cash list page with live balances |
| P2-2 | Inter Account Transfer document (Dr/Cr two bank accounts, own numbering) |
| P2-3 | Cleared/pending tracking (generalize ChequeStatus to a per-payment cleared state + cleared date) → Cleared vs Actual balance columns |
| P2-4 | Cheque/PDC register view + standalone ChequeStatus update endpoint |
| P2-5 | Bank reconciliation (statement balance assertion, discrepancy, status) |
| P2-6 | Direct income/expense lines in PaymentForm (send `accountId` allocations) |

### P3 — Reporting & dashboard
| # | Task |
|---|---|
| P3-1 | Trial Balance endpoint + page |
| P3-2 | P&L + Balance Sheet reports (period params, cash-basis later) |
| P3-3 | Aged Receivables/Payables + Customer/Supplier statements (buildable pre-GL from subledger; upgrade to GL later) |
| P3-4 | Accounting dashboard (§10) — subledger cards first, GL cards after P1 |
| P3-5 | GL Transactions / GL Summary reports; CSV export via `CsvSafe` |
| P3-6 | Cash Flow Statement (consumes `CashFlowClass`) + Statement of Changes in Equity |
| P3-7 | Lock-date UI + Recurring transactions (later) |

**Not worth cloning:** customer portals, forecasts/budget (until asked), payslips/expense-claims accounting, special accounts, multi-currency (single-currency PKR assumption holds), "Find & recode" (until GL exists).

---
*Sources: live walkthrough of accounts.techvologix.com (Jorbai Groups) on 2026-07-03/04; 7-agent codebase inventory; read-only inspection of DeliveryChallanDb. Design lineage: `CHART_OF_ACCOUNTS_DESIGN.md`, `ACCOUNTING_MODULE_STRATEGY.md`.*
