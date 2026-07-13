# Bank Reconciliation — Research & Design (planning only, not implemented)

**Status:** DESIGN / PLAN. Nothing here is built. Author date: 2026-07-13.
**Goal:** reach parity with the reference product (Manager.io / TechvoLogix) on the
**Bank & Cash Accounts** experience — the six balance columns and the reconciliation
workflow behind them — and define exactly how it plugs into our existing GL engine.

---

## 1. What the reference product (Manager.io) actually does

Manager's **Bank and Cash Accounts** tab shows, per account:

| Column | Meaning |
|---|---|
| Uncategorized Receipts | imported bank-statement lines (money in) **not yet assigned** to an account/contact |
| Uncategorized Payments | imported bank-statement lines (money out) not yet assigned |
| **Cleared balance** | balance counting only transactions the bank has **cleared** (what the bank statement shows) |
| Pending deposits | money-in transactions entered in the books but **not yet cleared** by the bank |
| Pending withdrawals | money-out transactions entered but not yet cleared |
| **Actual balance** | balance counting **all** transactions (cleared + pending) = the book/GL balance |

The governing identity:

```
Actual = Cleared + Pending deposits − Pending withdrawals
```

### How Manager relates reconciliation to the GL — the key insight
- **The general ledger always reflects the *Actual* balance.** A transaction posts to the
  bank account the moment it's entered, regardless of clearing state.
- **"Cleared" is metadata on each transaction, not a GL posting.** Each bank transaction
  carries a *cleared status / cleared date*. The Cleared-balance column and the reconciliation
  report are computed by **filtering** transactions on that flag — they never create or move
  journal entries.
- **"Uncategorized" is a staging concept.** Importing a bank statement creates rows that exist
  as *un-posted* bank lines; they only hit the GL once you **categorize** them (assign an
  account + contact), at which point they become ordinary receipts/payments.
- **Bank Reconciliation** = pick a statement date + statement closing balance; the system shows
  *book cleared balance* vs *statement balance*; you tick transactions cleared until the
  difference is zero, then lock that reconciliation.

**Design consequence for us:** reconciliation is a **metadata + read-model layer on top of the
GL**, exactly the "derived read model" philosophy we already used for Inventory V2. We do **not**
change how postings work.

---

## 2. What we already have (and it's a lot)

| Piece | Where | State |
|---|---|---|
| Bank/cash accounts as first-class accounts | `Account` w/ `ControlType.BankCash` | ✅ |
| Bank & Cash Accounts screen (list + balances + ledger drill-down + create) | `pages/BankCashAccountsPage.jsx` | ✅ shipped |
| GL posting for receipts/payments/transfers | `PostingService.PostPaymentAsync` / `PostTransferAsync` | ✅ (flag-gated per company) |
| **Bank-account FK on payments** | `Payment.BankAccountId` (nullable) | ⚠️ **exists but unpopulated** — model comment: *"wired in when BankAccount exists"* |
| Posting bank resolution | `PostPaymentAsync` uses `BankAccountId` if set, **else falls back** to the `BankCash` control account | ✅ (the hook is already there) |
| Cheque / PDC lifecycle | `ChequeStatus { None, Pending, Deposited, Cleared, Bounced }` + `SetChequeStatusAsync` | ✅ partial "cleared" signal, cheque-only |
| PDC "pending in/out" aggregation | `GeneralLedgerService` (PdcIn/PdcOut from `ChequeStatus`) | ✅ a proto "pending deposits/withdrawals" |
| Signed account balances (opening + GL movement) | `GeneralLedgerService.GetAccountBalancesAsync` | ✅ = **Actual balance** |
| Running-balance ledger per account | `GetAccountLedgerAsync` + `AccountLedgerDialog` | ✅ |
| Transfers already account-attributed | `AccountTransfer.FromAccountId / ToAccountId` | ✅ |
| Period-close / lock date guard | `PostingService.AssertPeriodOpenAsync` | ✅ (pattern to reuse for reconciliation lock) |

**Read that table again:** the plumbing is ~70% there. The two structural gaps are
(a) `Payment.BankAccountId` is never populated, so payments aren't attributable to a *specific*
bank account, and (b) there is no per-transaction *reconciliation-cleared* flag or statement-import
staging.

---

## 3. The gaps to close (in dependency order)

1. **Attribution.** Populate `Payment.BankAccountId` (create/edit forms + Manager importer + a
   one-time backfill). Without this, every receipt/payment lands on the single `BankCash` control
   account (why Manager's per-account view is richer than ours today).
2. **Cleared/Pending state.** A per-transaction reconciliation flag on `Payment` and
   `AccountTransfer` (distinct from `ChequeStatus`, which is a cheque-lifecycle dimension).
3. **Uncategorized staging.** Bank-statement import → un-posted lines → categorize into
   receipts/payments.
4. **Reconciliation object.** Statement date + balance, tick-to-clear, difference-to-zero, lock.

---

## 4. Target design

### 4.1 Data model additions (additive, nullable — safe for live tenants)
- `Payment.ReconciledDate : DateTime?` — `null` = uncleared/pending, set = cleared as of that
  bank date. (Keep separate from `ChequeStatus`; a cash receipt has no cheque but can still clear.)
- `AccountTransfer.ReconciledDate : DateTime?` — same, for both legs.
- `Payment.BankAccountId` — already exists; **populate it** (no schema change).
- `BankStatementImport` — one row per uploaded statement: `CompanyId, BankAccountId, FileName,
  ImportedAt, RowCount`.
- `BankStatementLine` — staging: `ImportId, Date, Description, Amount, Direction, Status
  (Uncategorized|Matched|Categorized|Ignored), MatchedPaymentId?`.
- `BankReconciliation` — `CompanyId, BankAccountId, StatementDate, StatementBalance,
  ClearedBookBalance, Difference, Status (Draft|Locked), LockedAt`.

### 4.2 The six columns as a **derived read model** (nothing persisted but the flags above)
Per bank account, computed by a new `BankReconciliationReadService` from live documents — same
"never drift" principle as `InventoryReadService`:

```
Actual balance      = GetAccountBalancesAsync(account)            # already implemented
Cleared balance     = opening + Σ movements where ReconciledDate ≤ asOf
Pending deposits    = Σ receipts (+ transfers-in)  with ReconciledDate == null
Pending withdrawals = Σ payments (+ transfers-out) with ReconciledDate == null
Uncategorized R/P   = count/Σ of BankStatementLine where Status == Uncategorized (by direction)
```

Invariant to assert in tests: `Actual == Cleared + PendingDeposits − PendingWithdrawals`.

### 4.3 GL integration principle (non-negotiable, mirrors Manager)
- **Postings are unchanged.** Receipts/payments/transfers post to the bank account exactly as
  today; the GL is always the *Actual* balance.
- **Reconciliation never touches journal entries.** `ReconciledDate` and statement staging are
  pure metadata; marking cleared/uncleared moves **zero** money in the ledger.
- **Cleared balance derives from the subledger** (Payments + Transfers with a bank account),
  not from raw journal lines — so it works even for GL-off companies (the flags live on the
  documents). Manual journal entries that hit a bank account are the one edge case: treat them as
  *always cleared* in v1 (documented decision), or add an opt-in `JournalLine.ReconciledDate`
  later.
- **Lock semantics reuse `AssertPeriodOpenAsync`'s pattern:** editing/deleting a *cleared*
  transaction dated on/before a *locked* reconciliation is blocked, so a signed-off statement
  can't silently change.

### 4.4 Attribution & the Manager-import connection
Populating `BankAccountId` is the same work that fixes the **Al-Qahera "0 accounts"** gap
(see `root-cause` in chat / migration notes):
- The importer already reads Manager's `bank-and-cash-accounts` into `bankNameByGuid` and stamps
  `Payment.BankAccountName`. Change it to **create one `Account` (ControlType.BankCash) per Manager
  bank account**, keep a `guid → accountId` map, and set `Payment.BankAccountId` (+ transfer legs).
- New receipt/payment forms already have the bank/cash picker (`BankCashSelect`); wire its value
  into `BankAccountId` instead of only `BankAccountName`.

---

## 5. Phased plan (each phase shippable, flag-gated, additive)

### Phase 0 — Bank-account attribution *(foundation; also fixes the migration gap)*
- Populate `Payment.BankAccountId` on create/edit (forms → DTO → service).
- Manager importer: create BankCash `Account`s per Manager bank account; set FK on payments/transfers.
- One-time backfill: map existing `BankAccountName` → account by name where unambiguous; else leave null (still falls back to the control account, so nothing breaks).
- Outcome: per-account balances/ledgers become real for imported tenants.
- **Effort: ~1 day.** No new UI, no reconciliation concepts yet.

### Phase 1 — Cleared vs Actual + Pending columns *(manual clearing)*
- Migration: add `ReconciledDate` to `Payment` + `AccountTransfer`.
- `BankReconciliationReadService` computing the derived columns (§4.2, minus Uncategorized).
- Bank & Cash screen: add Cleared / Pending deposits / Pending withdrawals / Actual columns.
- Ledger drill-down: a per-row "cleared" toggle (sets/clears `ReconciledDate`).
- Tests: the `Actual == Cleared + Pending` invariant; tenant isolation on the new endpoints.
- **Effort: ~2 days.** Delivers 4 of the 6 columns with purely manual clearing.

### Phase 2 — Bank statement import + categorization *(the Uncategorized columns)*
- `BankStatementImport` / `BankStatementLine` + CSV import endpoint (reuse `CsvSafe`, magic-byte
  validation) — start CSV-only; OFX/QIF later.
- Categorization UI: turn an uncategorized line into a receipt/payment (assign account + contact +
  optional allocation), or match it to an existing unreconciled payment.
- Uncategorized Receipts/Payments columns populate.
- **Effort: ~3–4 days** (import parsing + categorization UX are the bulk).

### Phase 3 — Reconciliation object + lock + auto-match
- `BankReconciliation` entity + "New reconciliation" flow: statement date + closing balance →
  show book-cleared vs statement, tick-to-clear until difference == 0, **Lock**.
- Edit/delete guard on cleared txns before a locked reconciliation (reuse period-close pattern).
- Auto-match imported lines to existing unreconciled payments by (amount, date±window, ref/cheque#).
- **Effort: ~3 days.**

**Total: ~9–10 working days** across four shippable phases. Phase 0 is worth doing on its own
regardless (it fixes attribution + the Al-Qahera view).

---

## 6. Key decisions to confirm before build
1. **`ReconciledDate` vs reusing `ChequeStatus.Cleared`.** Recommendation: separate field.
   `ChequeStatus` is a cheque-lifecycle dimension (PDC register); bank clearing applies to cash and
   transfers too. Optionally auto-set `ReconciledDate` when a cheque is marked `Cleared`.
2. **Manual JEs hitting a bank account** — treat as always-cleared in v1 (simplest, correct for
   99% of cases) vs add `JournalLine.ReconciledDate`. Recommendation: always-cleared v1.
3. **Per-company flag.** Gate the whole feature behind a `Company.BankReconciliationEnabled` (or
   reuse GL-enabled), default off, so live tenants are untouched — same pattern as
   `InventoryFlowVersion` / GL enablement.
4. **Statement import format** — CSV first (column-mapping UI), OFX/QIF later.
5. **Permissions** — new keys under the `Accounting` module: `accounting.reconciliation.view` /
   `.manage` (+ map in `permissionSections.js`). Statement import gated by `.manage`.

---

## 7b. Build progress (RESUME HERE)

- **Phase 0 — Attribution: DONE (was already in place).** `CreatePaymentDto.BankAccountId` is
  persisted (`PaymentService` create/update), `PaymentForm` sends it, `BankCashSelect` returns the
  id, and there's a name→`Account.Code` fallback for legacy rows. The only remaining bit (import
  Manager's individual bank accounts as `BankCash` accounts + backfill) == the deferred Al-Qahera
  migration fix — NOT done, by user instruction.
- **Phase 1 — Cleared/Pending columns: DONE + verified.** Added `ReconciledDate` to `Payment` +
  `AccountTransfer` (migration `20260713122729_AddBankReconciledDate`, idempotent guards).
  `BankReconciliationService` + `/api/bank-reconciliation/company/{id}/summary` +
  `payment|transfer/{id}/cleared` toggles. Permissions `accounting.reconciliation.view/.manage`.
  Bank & Cash screen now shows Cleared / Pending In / Pending Out / Actual columns + totals.
  Verified: API script 9/9 (invariant holds for all accounts; clearing shifts pending→cleared
  with actual unchanged; 401 guard); browser columns render with totals reconciling.
  **NOT yet built in Phase 1:** the interactive per-row "mark cleared" UI — deferred to Phase 3
  where tick-to-clear lives (the summary read model + toggle endpoints already exist to back it).
- **Phase 2 — Statement import: NOT STARTED.** `BankStatementImport`/`BankStatementLine` +
  CSV import + categorize-into-receipt/payment → the Uncategorized columns.
- **Phase 3 — Reconciliation object + tick-to-clear + lock + auto-match: NOT STARTED.** This is
  where the AccountLedgerDialog (or a dedicated reconcile view) gets the per-row cleared toggle
  calling `setPaymentCleared`/`setTransferCleared` (both API client fns already added).

## 7. Out of scope for v1 (parked)
- Multi-currency bank accounts / FX revaluation.
- IBAN storage, per-account credit limits (Manager's create-form extras) — cosmetic until
  reconciliation exists; add with Phase 1 if wanted.
- Automated bank feeds (Plaid-style) — CSV import only.
