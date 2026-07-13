# FEATURE — Perpetual GL migration (Manager.io → MyApp, full fidelity)

## ✅ DONE 2026-07-13 — implemented, run, and verified on a dev company (uncommitted)

Built end-to-end and proven on **company 2190 "Al-Qahera GL"** (DeliveryChallanDb):
- **78 accounts** (66 CoA GUID-keyed + 13 banks) with control types + starting balances;
  **5,751 journal entries / 15,341 lines** posted as ManualJournal (SourceDocId=null).
- **Balance sheet balances and matches Manager** (verified via new-code API on :5199):
  Assets 192,376,369.57 / Liab 28,071,614.55 / **Equity 164,304,755 (incl. the new
  "Current-Year Earnings" line) vs Manager 164,295,356 — diff 9.4K**; Income +11K, Exp +2K.
  Only real variance: **AR +1.23M / AP −1.23M** — the known advances/nettings, which
  OFFSET (balance-sheet-neutral); accepted per user ("decide while building").
- **Bank/account ledgers populated**: `GET /accounts/{id}/ledger` returns the posted
  receipts/payments/transfers with running balance; e.g. "AQT - DIB 2024" = 17 entries,
  closing 3,517,780.34 (exact). This is the Manager-style per-account ledger the user wanted.
- **GL live + cutover**: `GlPostingEnabled=true`, `GlLockDate=11/07/2026` (reused as the
  migration cutover — migrated history locked; new documents dated after post normally).

**Code (all UNCOMMITTED):** `ManagerImportService.PerpetualGl.cs` (new, the builder);
`AccountService.GetTreeAsync` (Current-Year Earnings equity line); `ManagerImportService`
(RE un-bake); `GeneralLedgerService.EnableAsync` (rebuild skips locked docs);
`IManagerImportService` + `tools/ManagerImport/Program.cs` (`--build-perpetual`). Release build 0 err.

**To run:** `dotnet run --project tools/ManagerImport -c Release -- <BASE>/alqahera-export "<conn>" --build-perpetual --ref <BASE>/perpetual --trial-balance <tb.txt> --company-name "<Name>"` where BASE = `C:\Users\hussahuz\Downloads\alqahera-perpetual`.

**To SEE it live / switch the real company:** the running :5134 is OLD code — deploy the new
code first (rebuild backend), else the Current-Year Earnings line + RE un-bake aren't active
and a snapshot company's equity would look off. After deploy: either use 2190, or run
`--build-perpetual` on **2178** to convert it (it has the documents; the build wipes only its
CoA+GL and posts the perpetual ledger + sets the cutover). Until deployed, **leave 2178 as-is**.

**Remaining tail (optional):** AR/AP advances modelling (currently offsetting ±1.23M);
the `/api/manager-import` endpoint could expose `--build-perpetual` for prod (console-only today).

---

**Status:** DESIGN + Phase 1 in progress (2026-07-13). Chosen by the user over the
snapshot/cutover approaches: reproduce Manager's ledger so **every account has a
Manager-style transaction ledger** AND the balance sheet / P&L match to the rupee.

**Scope:** the migrated company (Al-Qahera, id 2178) on `DeliveryChallanDb`. This is
a big, phased build with a **reconciliation gate at each phase** — do not advance a
phase until it ties to Manager.

---

## The model (why this differs from what we have)

Today 2178 is a **snapshot**: each account's *current* balance loaded as an opening
balance, GL off, nothing posted → summary matches but per-account ledgers are empty.

Manager is **perpetual**: *starting* balance + every posted transaction = current
balance. The transactions **are** the ledger. To reproduce it:

1. Opening balance = Manager **starting** balance (mostly 0; only 5 banks + 1 BS
   account are non-zero).
2. **Post every historical document as a faithful journal entry** using the exact
   Manager accounts/amounts/tax/WHT — built directly by the importer (NOT re-derived
   by `PostingService`, which would guess control accounts).
3. Set a **GL cutover date** so `PostingService` skips the migrated (pre-cutover)
   documents on enable/edit — only NEW documents post via the engine going forward.
4. Result: GL = starting balances + imported historical JEs (+ future new-doc JEs).
   Every account has a ledger; summary = Manager.

This combines perpetual history (imported JEs) with a clean going-forward engine
(cutover + wired control accounts).

---

## Reconstruction recipe (verified against the live Manager file)

**Accounts.** `chart-of-accounts` = 66 rows `{key, code, name}` (no type). Type comes
from the **Trial Balance** section (match by name). Import each as a MyApp `Account`
keyed `ExternalRef = mgr-acct:{guid}`. Control types by name:
- "Accounts receivable" → `AccountsReceivable`; "Accounts payable" → `AccountsPayable`
- the 13 bank/cash accounts → `BankCash` (already have `mgr-bankcash:` — reconcile keys)
- the tax-code account "TT GST" (`8d3e4504`) → `OutputTax`/`InputTax` (same account here)
- a Suspense account → `Suspense`
- everything else → `None`
- Accounts referenced by a document but absent from the TB (zero-balance) → create
  with type inferred from context (income/expense by where used), else `None`.

**Starting balances.** `bank-or-cash-account-starting-balance-list` (5) +
`balance-sheet-account-starting-balance-list` (1). Set `OpeningBalance` from these;
all other accounts open at 0.

**Tax.** 2 codes (17%, 18%), both → "TT GST". Line amounts are **tax-exclusive**:
`lineNet = Qty × UnitPrice`; `lineTax = lineNet × rate`. Invoice posts
`Cr income (net) + Cr TT GST (tax)`, `Dr AR (net+tax − WHT)`. Verified:
136,500 × 1.18 = 161,070 = `invoiceAmount`.

**Withholding.** Invoice header `WithholdingTax=true`, `WithholdingTaxPercentage`
(e.g. 5.5). `wht = taxableBase × pct`; posts `Dr Withholding tax receivable`, and AR
is reduced by `wht` (buyer withholds). Reconciles the 11.18M WHT-receivable.

**Sales invoice JE** (per doc):
```
Dr  Accounts receivable      net + tax − wht
Dr  Withholding tax recv.    wht                     (if WithholdingTax)
  Cr  income account(s)      net        (per line Account/Item → mapped account)
  Cr  TT GST                 tax        (Σ line tax)
```
**Purchase bill JE:** mirror — Dr expense/inventory (per line), Dr Input tax, Cr AP.

**Receipts / payments.** Each line has `Account` (GUID) + optional
`AccountsReceivableSalesInvoice`/`PurchaseInvoice`. Post `Dr/Cr bank` (the specific
bank account, mapped from the header bank GUID → `mgr-bankcash:`), other leg to the
line's `Account` (AR for invoice allocations, expense for on-account lines).

**Transfers (72).** `Cr PaidFrom bank`, `Dr ReceivedIn bank`, `CreditAmount`.

**Journals (131).** Post each `Line{Account, Debit, Credit}` verbatim.

---

## Phases (each ends with a reconciliation gate)

**Phase 0 — feasibility.** ✅ DONE. Data sufficient (table above).

**Phase 1 — CoA foundation.** Import the 66-account CoA by GUID with types (from TB) +
control types + starting balances; groups by section + bank/cash child. Build a
`Dictionary<managerGuid,int accountId>` for later phases. *Gate:* every doc-referenced
account GUID resolves to a MyApp account; starting balances load.

**Phase 2 — Sales invoices + notes as JEs.** Build the sales-invoice JE (net/tax/WHT)
directly; post credit/debit notes as reversing JEs. *Gate:* Σ income = Manager income
per account; Output-tax (TT GST) balance; AR movement.

**Phase 3 — Purchases as JEs.** Bill JEs (expense/inventory + input tax + AP). *Gate:*
expense accounts + AP.

**Phase 4 — Receipts / payments / transfers / journals as JEs.** *Gate:* bank balances
per account (== Manager's 13), AR/AP net to Manager's outstanding.

**Phase 5 — Wire cutover + engine.** Set `Company.GlStartDate`; `PostingService` +
`EnableAsync` skip `Date < GlStartDate`; enable GL. *Gate:* full balance sheet + P&L ==
Manager to the rupee; bank/account ledger drill-down shows the transactions.

**Phase 6 — UI.** Verify the bank-cash drill-down + account ledger render the imported
JEs. (Uses the existing `/accounts/{id}/ledger` + `AccountLedgerDialog`.)

---

## Risks / open items

- **Rounding**: per-line tax rounding vs Manager's invoice total — anchor to
  `invoiceAmount`; push any residual to a rounding line if needed.
- **Zero-balance / doc-only accounts** not in the TB → type inference; log any unresolved.
- **Idempotency**: JEs keyed by `SourceDocType` + doc id; `--fresh` wipes JEs first.
- **This is large** (~5.7k JEs / ~18k lines). Expect iteration at each gate.
- Does **not** change the snapshot importer — perpetual is a separate mode/flag so the
  proven snapshot stays available.

---

## Continuity

- Branch `feat/sales-quote-order`; DB `DeliveryChallanDb`; company **2178**.
- Manager Desktop must be open (token via env `MGR_KEY`); endpoints under
  `http://127.0.0.1:55667/api2`. Detail via `{entity}-form/{key}`.
- Related: [[FEATURE_MANAGER_BANKCASH_IMPORT]] (bank/cash accounts, Phase 1 reuses it),
  snapshot importer in `ManagerImportService.ImportTrialBalanceAsync`.

---

# ▶▶ RESUME HERE (handoff 2026-07-13 EOD — finish end-to-end in ONE session)

**Goal for the resuming session:** complete the perpetual GL so a migrated company
shows Manager-style per-account transaction ledgers AND the balance sheet + P&L match
Manager. Build on a **fresh dev company** (do NOT touch 2178 until it reconciles).
User wants it **working end-to-end**; run straight through; **you decide the AR/AP
~1.2M** while building (model advances if clean, else park residual in Suspense + note).

## State as of handoff
- **DECISIONS LOCKED:** perpetual full GL; **app-wide** equity (net profit shown as a
  computed "Current-Year Earnings" line + Retained earnings stored un-baked).
- **DONE + compiling (Release 0 err), UNCOMMITTED in working tree:**
  - `AccountService.GetTreeAsync` → adds "Current-Year Earnings" equity line (= Σ P&L,
    gated on P&L activity so no-CoA companies unaffected).
  - `ManagerImportService.ImportTrialBalanceAsync` → un-bakes Retained earnings
    (TB RE − net profit) + Path A bank/cash split (13 BankCash accounts).
  - Path A also: `IManagerImportService`, `ManagerImportController`, `tools/ManagerImport/Program.cs`.
- **Prototype PROVEN:** `perp_recon.py` reconciles — 13 banks exact, ~40 accounts exact.
- **⚠️ CAVEAT — user's :5134 runs OLD code.** 2178 currently has RE **baked** (old
  import) and displays correctly on :5134. Do NOT re-import 2178's TB or restart :5134
  onto the new code without re-importing 2178, or 2178's equity will DOUBLE (baked RE +
  new earnings line). Keep 2178 as-is; build perpetual on a NEW company.
- **⚠️ scratchpad is per-session.** All staged data was copied to a DURABLE folder:
  **`C:\Users\hussahuz\Downloads\alqahera-perpetual\`** =
  `alqahera-export/` (summary root + `detail/` 14 files), `perpetual/`
  (chart-of-accounts, bank-starting-balances, bs-starting-balances, taxcodes-resolved,
  noninv-resolved), `perp_recon.py` (paths already point here), the two fix SQLs. TB at
  `Downloads\al-qahera-trial-balance.txt`. Re-run recipe: `python Downloads\alqahera-perpetual\perp_recon.py`.

## The plan (one session)
1. **Port `perp_recon.py` → C# `BuildPerpetualGlAsync`** in a new partial file
   `Services/Implementations/ManagerImportService.PerpetualGl.cs` (mark the class
   `partial`). It: wipes CoA+GL; creates **66 CoA accounts** (`mgr-acct:{guid}`, skip
   "Cash & cash equivalents" roll-up) + **13 banks** (`mgr-bankcash:{guid}`, BankCash),
   types from TB section by name / heuristic, control types by name (AR="Accounts
   receivable", AP="Accounts payable", OutputTax/InputTax="TT GST", Suspense,
   WithholdingReceivable/Payable), starting balances (5 banks + Retained earnings
   `74dfd025` = 12,805,100 Cr, rest 0); then posts every doc as a **ManualJournal
   JournalEntry (SourceDocId=null → exempt from EnableAsync recompute)** per the recipe
   in perp_recon.py. EntryNo = seq. Route unmapped accounts → Suspense. Report per-account
   recon vs TB.
2. **Console mode** (`--build-perpetual`) in `tools/ManagerImport/Program.cs`; run
   `--fresh` into a NEW company (e.g. "Al-Qahera GL") from `Downloads\alqahera-perpetual`.
3. **Verify** via an **ephemeral new-code web instance** (do NOT touch :5134): build/publish
   to a temp dir, run `--urls http://localhost:5199` (Development env → uses DeliveryChallanDb,
   set `Database__AutoMigrate=false`), login admin/admin123, GET `/api/accounts/company/{id}/tree`
   → assert BS Assets/Liab/Equity(incl Current-Year Earnings) + P&L == Manager
   (Assets 191,140,689.53 / Liab 26,845,333.61 / Equity 164,295,355.92 / Income 193,857,817.18 /
   Expenses 42,050,725.96); GET `/api/accounts/{bankId}/ledger` → shows receipts/payments.
   Stop the ephemeral instance after.
4. **AR/AP ~1.2M** (advances/nettings): investigate on-account receipts/payments +
   customer=supplier nettings; model if clean, else park residual in Suspense + note.
   WHT-recv remaining 648K = post the 88 WHT-receipt docs (Cr WHT-recv; offset TBD).
5. **Phase 5** — add `Company.GlStartDate` (EF migration, additive) + cutover guards:
   `GeneralLedgerService.EnableAsync` backfill queries + `PostingService.PostXxxAsync`
   skip `Date < GlStartDate` (null = today's behavior, backward compatible). Importer
   sets GlStartDate = TB date + 1. Then GlPostingEnabled can be safely ON.
6. **Phase 6** — confirm bank-cash drill-down (`AccountLedgerDialog` → `/accounts/{id}/ledger`)
   + CoA ledger render the JEs.
7. When reconciled on the dev company, present to user; switching 2178 = run the same
   build on 2178 (+ its :5134 needs the new code deployed).

## Guardrails
- Ask before commit AND push; don't touch the other session's uncommitted WHT/Client work.
- Keep 2178 (matched snapshot) intact; work on a dev company.
- If context runs low mid-build, UPDATE this section + memory and hand off again.
- Recon truth: income/expense accounts vs TB, banks vs `bank-and-cash-accounts` actualBalance
  (NOT line-vs-invoiceAmount — invoiceAmount is a summary field absent from detail forms).
