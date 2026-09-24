# COGS relief on the declared-value basis

**Date:** 2026-09-17
**Branch:** `feat/importer-ledger-receipts` (importer production line)
**Status:** design approved, not yet implemented

## The problem

"Inventory on hand" never goes down. It is an opening balance plus purchases:
`PostingService.ResolvePurchasesAsync` sends purchase bills to the Inventory
control account when a company tracks stock, and nothing ever credits it.
`AccountingReportService.Statements.cs` already admits this in a notice printed
on the P&L — "a sale does not yet move the cost of the goods out of stock".

So every company that tracks inventory reports revenue with no matched cost,
and its balance sheet overstates stock by everything it has ever sold. On the
importer line that is 9,690,724.57 on one company alone.

This was found on 2026-09-17 while reconciling a customer's stock sheet against
the dashboard. A separate defect found in the same session — a GD costing
import never posting created stock to the Inventory account — is already fixed
(commit `5c7f569`) and is **not** this work.

## Decisions taken

| Question | Decision |
|---|---|
| Valuation basis | **Declared** (`OpeningStockBalance.ValueExcludingTax`), not actual landed cost |
| Granularity | **Periodic** — one entry per company per month |
| Trigger | **Automatic** upsert whenever stock changes |
| Non-sale movements | **Split** — sales to COGS, adjustments/revaluations to their own account |
| History | **Backfill** every month that has movements |
| Rollout | **Importer line only** for now |

### Why periodic rather than per-invoice

Weighted average is path-dependent: the cost of a sale is the average standing
at that moment, so editing an old invoice changes the COGS of every sale after
it. Per-invoice postings would mean one edit rewriting dozens of entries, and
would collide with `GlLockDate` on closed periods.

A monthly entry sidesteps this entirely, and it matches how the domain already
works — the accountant's stock sheet *is* monthly, with a Consumed block per
month.

### Why the declared basis, knowing what it shows

On the declared basis the three real importer companies show roughly zero or
slightly negative gross profit:

| Co | Sales excl | COGS declared | Gross profit |
|---|---|---|---|
| 4 | 9,684,530.00 | 9,690,724.57 | −6,194.57 |
| 5 | 13,213,791.40 | 13,216,386.61 | −2,595.21 |
| 6 | 5,510,879.68 | 5,511,677.94 | −798.26 |

That is arithmetic, not a defect: these companies invoice at essentially the
declared customs value, so declared-basis margin is ~0 by construction. Their
real economics sit in the landed-cost gap (company 4 makes +774,283.30 against
actual landed cost). The maintainer confirmed this picture is intended, because
the ledger must reconcile to the stock sheet that is actually filed.

**This work does not make Total Sales equal the stock sheet's Consumed + tax,
and is not meant to.** Those measure sale price and declared stock value
respectively. After this lands the difference stops being unexplained and
becomes the gross profit line. Note also that the Consumed block's S.Tax column
is a derived notional (`Excl × rate ÷ 100`) that never reaches the ledger — it
is not comparable to output tax on sales.

## Design

### The entry

A new `SourceDocType.InventoryPeriod = 7`. One entry per `(CompanyId, period)`:

- `SourceDocId` = `year * 100 + month` (e.g. `202608`)
- dated the last day of that month
- idempotent through the existing filtered unique index on
  `(CompanyId, SourceDocType, SourceDocId)` — the same repost-replaces
  behaviour every other document already has

Lines:

| Side | Account | Amount |
|---|---|---|
| Cr | Inventory (`ControlType.Inventory`) | total non-purchase value leaving the pool that month |
| Dr | Cost of goods sold | the `SourceType.Invoice` portion, net of credit-note inward movements |
| Dr/Cr | Inventory adjustments | the `Adjustment` + `ValueCorrection` portion |

Balanced by construction, since the two debits are a partition of the credit. A
month that is net inward (credit notes exceeding sales) flips the entry.

Purchases are deliberately excluded: they already debit Inventory through
`PostPurchaseBillAsync`, and that path is exact — on companies 9/10/11 the
movement value, the bill subtotal and the GL debit agree to the rupee
(2,246,692.50 / 3,684,749.00 / 3,111,452.50). Including them would double-count.

### Where the numbers come from

`Helpers/StockValuation.Compute` already accepts a `trace` recording what each
movement was costed at — its own comment notes the cost of a movement exists
only as part of the walk.

A new helper walks each item **once** over its entire movement history in date
order and buckets each traced movement into `(month, source-class)`. One walk
per item yields every month at once, so a recompute is O(items × movements),
not O(months × items × movements).

Source classes:

- `Invoice` (2) → COGS. Outward on a sale or debit note, inward on a credit
  note that affects stock.
- `Adjustment` (3) and `ValueCorrection` (6) → Inventory adjustments.
- `PurchaseBill` (1), `GoodsReceipt` (4), `PurchaseDebitNote` (5),
  `OpeningBalance` (0) → excluded; already in the ledger or not a value change.

Two things need no special handling because they are already resolved before a
movement is written, and this design reads movements only:

- **The FBR dual-book overlay.** `StockService` already keys stock off the
  *effective* item type and quantity (`InvoiceItemAdjustment.AdjustedItemTypeId
  ?? physical`, mirroring `FbrService`), so a tax-consultant adjustment is
  already reflected in the movements the walk reads. COGS follows the adjusted
  position automatically, which is the correct answer: the goods that really
  left are the ones being costed.
- **`InventoryFlowVersion` 1 vs 2** (HS-gate versus all-tracked). It decides
  which items get movements at all; whatever movements exist are what the walk
  values.

### When it runs

`IInventoryPeriodPostingService.RepostAsync(companyId, fromDate)`, called after
`StockService` writes movements, inside the caller's transaction. Skipped when
GL posting is off for the company.

A change in month M changes M **and every later month**, so a repost always
covers M through the latest month, never M alone.

Locked periods need no extra guard. A chronological walk means a September
document cannot alter August's COGS, and a backdated document is already
refused by the existing `PostingService.AssertPeriodOpenAsync`.

### Accounts

- **Cost of goods sold** — needs its **own** resolver: `seed:cogs` → an expense
  named "cost of goods" → first Expense → Suspense. It must **not** reuse
  `ResolvePurchasesAsync`, which returns the Inventory account when tracking is
  on; that would debit and credit the same account and post nothing.
- **Inventory adjustments** — new seeded Expense account,
  `ExternalRef = "seed:inventory-adjustments"`, created on demand in the manner
  of `EnsureDefaultInventoryAccountsAsync`.

### Backfill

A startup backfill across every GL-enabled, inventory-tracking company,
completion marked by an `AuditLog` row with
`ExceptionType = 'COGS_PERIOD_BACKFILL_V1'` — the pattern CLAUDE.md §11
documents for idempotent backfills. Six companies of ~40 movements each on this
line, so cost is trivial.

Backfilling is not optional. With automatic upsert, skipping history would mean
the first edit to an old invoice makes that month suddenly sprout a full COGS
entry from nowhere.

## Testing

New `scripts/test_cogs_periodic.py`, on an ephemeral company, following the
house pattern of the existing suites:

- sales across two months produce one entry each, at the walked value
- an invoice edit reposts its month **and every later month**
- a credit note that affects stock reduces the month's COGS
- cancel, and FBR-exclude, remove the consumption
- an adjustment lands in Inventory adjustments, never in COGS
- a value-only correction moves Inventory with no quantity
- backfill is idempotent — running it twice changes nothing

The load-bearing assertion after every step is the invariant that was violated:
**Inventory account balance == the stock walk's closing value.**

Existing suites that must stay green: `test_gd_import_costing.py` (419),
`test_stock_itemtype_reflow.py` (76), `test_spreadsheet_import.py` (138),
`test_basic_flows.py`, `test_tenant_isolation.py`.

## Non-goals

- Actual-landed-cost COGS or reporting. Explicitly declined in favour of the
  declared basis.
- Per-invoice gross margin. Periodic posting cannot produce it.
- Porting to `master`, `customize-solution-for-other` or
  `TraderFbrInvoicingSystem`. Each is a separate, reviewed act per
  `docs/ENVIRONMENTS.md` §1a. **Recorded here so it is not silently forgotten,
  which is how the original gap survived.**

## Risks

- **Recompute on every stock write.** Mitigated by one walk per item and by
  reposting only the affected months. Worth measuring if an installation grows
  far past the current ~40 movements per company.
- **Historical P&L changes.** The backfill moves reported profit on live
  customer books. Intended, but the customer should be told before it deploys
  rather than discovering it in a report.
- **`GlLockDate` is null on every company on this line today**, so the backfill
  is unobstructed. An installation with locked periods would need the backfill
  run before locking, or those periods left without COGS.
