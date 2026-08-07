# Feature — Withholding Tax on Invoices & Purchase Bills (Manager.io parity)

Status: BACKEND DONE + VERIFIED 2026-08-07 on `customize-solution-for-other`; frontend + print in progress.
Delete this doc once fully shipped + verified (transient-feature-doc rule); durable record = README changelog + TECHNICAL_SPEC.

## Verification (2026-08-07, local, DeliveryChallanDb)

`scripts/test_withholding_tax.py` — 23/23 checks pass on a fresh GL-enabled company:
- Sales invoice rate mode = Manager #1316 exactly: grand 161,070, GST 24,570 (both unchanged), WHT 8,858.85, balance due 152,211.15.
- Receipt of the collectible (152,211.15) → invoice Paid, balance 0.
- Over-allocation past the collectible → 400 (both sales receipt + purchase payment).
- Fixed-amount mode (rate null, amount 200) → balance = grand − 200.
- No-WHT invoice → balance == grand (backward compatible).
- Purchase bill rate mode → balance due (owed to supplier) reduced; payment of collectible → Paid.

GL split confirmed by SQL (JournalLines):
- Invoice: Dr AR 152,211.15 + Dr WHT receivable (ctrl 9) 8,858.85 / Cr Sales 136,500 + Cr Output tax 24,570 — balanced 161,070.
- Bill: Dr COGS 136,500 + Dr Input tax 24,570 / Cr AP 152,211.15 + Cr WHT payable (ctrl 10) 8,858.85 — balanced.

Also folded a WHT suite into `scripts/test_basic_flows.py` (suite 8).

## Follow-ups (not v1)

- Print TEMPLATES: backend print DTOs (`PrintBillDto`, `PrintPurchaseBillDto`) now expose
  `WithholdingTaxRate` / `WithholdingTaxAmount` / `BalanceDueAfterWht`, but the starter
  template DESIGNS don't yet render a WHT line + net-payable — a template-authoring task.
  `PrintTaxInvoiceDto` (FBR tax-invoice layout), quote/order/PDN prints not wired (WHT is off-FBR).
- Template sample data has no WHT preview values yet.

## Goal

Mirror Manager.io: a withholding-tax (income-tax, s.153) rate/amount on a sales
Invoice or PurchaseBill that **reduces the balance due** by the WHT amount and
moves a dedicated WHT control account. WHT is on top of sales tax — it never
changes the FBR sales-tax invoice.

## Manager.io behaviour — confirmed via api2 (Al-Qahera, sales invoice #1316)

- Fields on the invoice: `WithholdingTax` (bool) + `WithholdingTaxPercentage` (5.5). Rate/Amount toggle in UI.
- lines net 35×3900 = 136,500; +18% GST = **161,070** gross; WHT = 5.5% × **gross** = **8,858.85**; `balanceDue` = **152,211.15**.
- WHT % is taken on the GROSS amount (net + sales tax). GST + invoice total unchanged.
- Accounting direction: sales → Withholding tax **receivable** (asset); purchase → Withholding tax **payable** (liability = "AP increase").

## Decisions (locked with user)

1. Both sales Invoice and PurchaseBill.
2. Rate model: per-doc `%`, pre-filled from a **company-level default** rate, overridable/clearable.
3. Modes: **percentage OR fixed amount** (Manager Rate/Amount toggle).
4. Settlement is **immediate** (Manager-style): WHT reduces collectible at doc time.
5. WHT is **excluded from FBR** payload.
6. Existing `WithholdingTaxReceipt` (manual customer certificates) stays independent, no GL posting.
7. Receipt/Payment-from-doc uses the **WHT-reduced collectible** as balance due + over-allocation cap.

## Data model (additive)

- `Invoice` + `PurchaseBill`:
  - `WithholdingTaxRate decimal?` — null unless rate mode.
  - `WithholdingTaxAmount decimal` (default 0) — resolved PKR, the single value all downstream logic uses.
  - Mode is implicit: rate non-null → rate mode; rate null & amount>0 → fixed-amount; both empty → no WHT (backward-compatible; existing rows read as 0).
- `Company`: `DefaultWithholdingTaxRate decimal?` — pre-fill only.

Migration: additive columns, apply to the branch local DB manually (EF design-time
factory targets DeliveryChallanDb — see project_ef_designtime_factory_db memory).

## Computation

- Gross = `GrandTotal` (= net + GSTAmount).
- Rate mode: `WithholdingTaxAmount = Round(WithholdingTaxRate/100 × GrandTotal, 2)` (half-up, paisa).
- Amount mode: operator supplies `WithholdingTaxAmount`, rate null.
- Recompute in the same totals path that sets GrandTotal/GSTAmount (create + update), so line/GST edits reflow WHT (rate mode).
- Guard: `0 ≤ WithholdingTaxAmount ≤ GrandTotal`.

## Balance due / payment status

- `Collectible = GrandTotal − WithholdingTaxAmount`.
- `BalanceDue = Collectible − AmountPaid` (clamped ≥ 0); paid-in-full when `AmountPaid ≥ Collectible`.
- `PaymentStatusCalculator`: add WHT-aware overloads taking `withheld` (or pass `Collectible` as the effective total). Update every invoice/bill DTO projection (list + detail) to pass collectible.
- `PaymentService` over-allocation guard (lines ~160/170/336/346): cap at `Collectible`, not `GrandTotal`; fix the "balance due is …" messages. `SyncAmountPaid` unchanged (AmountPaid = Σ allocations).
- Receipt-from-invoice / payment-from-bill prefill surfaces `Collectible − AmountPaid` as the remaining amount (auto-updates balance due — user requirement).

## GL posting (only when Company.GlPostingEnabled) — PostingService

Sales invoice (`PostInvoiceAsync`): split the AR line.
```
Dr Accounts receivable        Collectible
Dr Withholding tax receivable WHTAmount   (ControlType.WithholdingReceivable = 9)
Cr Sales (per-line split)     net
Cr Output tax                 GSTAmount
```
Purchase bill (`PostPurchaseBillAsync`): split the AP line.
```
Dr Purchases/COGS (split)     net
Dr Input tax                  GSTAmount
Cr Accounts payable           Collectible
Cr Withholding tax payable    WHTAmount   (ControlType.WithholdingPayable = 10)
```
Resolve the WHT account via existing `ResolveAsync(ControlType.Withholding{Receivable,Payable})`.
Ensure CoA preset seeds both control accounts (CoaPresetSeeder). Credit Note (DocType 10)
reverses same-direction; notes carry no WHT in v1 (WHTAmount = 0 → no split, unchanged).

## FBR

No change. `GrandTotal`, `GSTAmount`, line values sent to PRAL stay identical.
`FbrService` never reads WHT fields. WHT is income-tax, out of scope of the sales-tax invoice.

## Print templates

Add merge fields `WithholdingTaxRate`, `WithholdingTaxAmount`, `BalanceDueAfterWht`
to invoice/bill print DTOs; render a WHT line + reduced balance due. Follow
PRINT_TEMPLATE_GUIDE.md; only emit the WHT line when amount > 0.

## Frontend

- Invoice form + Bill form: Rate/Amount toggle + value; pre-fill rate from company default; clearable; live-recompute WHT + reduced balance due next to totals.
- Company settings page: `Default withholding tax rate (%)` field (gated `companies.manage.update` — no new permission module → no permissionSections churn).
- Payment/Receipt form: remaining-amount prefill already reads balanceDue (now collectible-based).

## Permissions

None new (field on existing create/update; company default under `companies.manage.update`).

## Testing (local, full)

- `dotnet build` 0 errors.
- Extend `scripts/test_basic_flows.py`: sales invoice + purchase bill with 5.5% → assert WHTAmount = 5.5% gross, balanceDue = collectible, GrandTotal/GST unchanged, GL split balances (both control types), receipt of `Collectible` → paid-in-full, over-allocation by WHT rejected. Fixed-amount mode case. Backward-compat: no-WHT doc unchanged.
- Manager parity check: reproduce #1316 numbers exactly.
- Pre-push HARD gate: `scripts/test_stock_itemtype_reflow.py` 140/140 (WHT doesn't touch stock; must stay green).
- README `## Changelog` dated entry.

## Phases

1. Model + migration (Invoice, PurchaseBill, Company) + apply to local DB.
2. Compute + totals reflow in InvoiceService/PurchaseBillService; DTO fields.
3. Balance-due: PaymentStatusCalculator + DTO projections + PaymentService cap.
4. GL: PostingService split lines both sides + CoA seed.
5. Frontend: forms + company setting + totals display.
6. Print DTOs + templates.
7. Tests + local verify + README changelog.

## Out of scope (v1)

WHT on credit/debit notes; per-party default rates; posting the standalone WHT-receipt module to GL.
