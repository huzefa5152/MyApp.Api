# GD Import Costing — design

**Branch:** `feat/importer-ledger-receipts` only. Not a candidate for porting to
the other three production lines unless the maintainer asks.

**Status:** design approved 2026-09-12. Transient — delete once the feature ships
and is verified (CLAUDE.md, "Transient feature/research docs").

---

## 1. The problem

The three tenants on this installation are commercial importers. Every unit they
own arrived on a customs GD (Goods Declaration). Today the system has no way to
record one.

Local `MyApp_Importer_Local`, which mirrors production:

| Company | Opening rows | Opening selling value | Lots | Inward stock movements |
|---|---|---|---|---|
| 4 Alpha Traders | 39 | 20,612,012.50 | none | **none** |
| 5 AY TRADERS | 78 | 72,736,594.04 | 120 across 19 GDs | **none** |
| 6 PAK TRADE CO | 57 | 67,230,068.14 | 117 across 19 GDs | none (2 adjustments) |

`StockMovements` holds sales (`SourceType = 2`) and two adjustments. Nothing
inward. The entire inventory of all three companies was loaded once as an
opening balance; the next consignment has nowhere to go.

Second problem: the opening balance stores a **selling** value where a cost
basis belongs, so nothing in the system knows what the goods cost. Margin is
unanswerable.

## 2. What the costing sheets are

Three workbooks, one per company (`Alpha Trader Costing.xlsx`,
`Ay trader Costing.xlsx`, `Pak Trade Co Costing.xlsx`). Same layout — identical
merged header ranges, same 26-column skeleton, two header rows.

Read from the cell formulas, not inferred:

```
K  Total          = AssessedValue + C.Duty + ACD + RD        ← the cost basis
M  S.Tax          = K × STRate
O  AST            = K × ASTRate
Q  Subtotal       = K + M + O + Others
R  Income Tax     = Q × ITRate
U  InputTax       = M + O
T  Value          = U / STRate
W  Selling Value  = T + AddOnProfit
Y  Profit         = W − K
Z  Profit Rate    = Y / W × 100
```

`T` reduces to `K × (1 + ASTRate / STRate)`. That is not an arbitrary markup: it
is the value at which the output sales tax on the eventual sale exactly absorbs
the input tax paid at import, since `W × STRate = K × (STRate + ASTRate) = M + O`.
At the usual 18% / 3% that is a fixed ×7/6. Every line of the Alpha sheet reads
a ratio of 1.1667 bar one.

Cost excludes sales tax, AST and income tax, all three of which are recoverable
or adjustable. The sheet's own `Profit = W − K` confirms it.

### It reconciles against live data

Company 5, joined on GD + HS code over 46 matched groups:

```
costing sheet  Selling Value    46,154,294.45
OpeningStockLots BalanceExcl    46,154,294.46
```

One paisa apart. Company 6 matched 66 quantities exactly. So
`OpeningStockBalance.ValueExcludingTax` **is** the costing sheet's column W, and
the missing figure is column K.

This is what makes the feature cheap: the selling value does not need to be
entered or migrated. It is already right. Only the cost is missing, and the
selling value is derivable from the cost, so the two agree by construction.

### Sheet volumes

| Company | Data lines | Totals rows | GDs | Cost (K) | Selling (W) | Markup |
|---|---|---|---|---|---|---|
| Alpha | 26 | 1 | 1 | 18,816,870.00 | 21,940,496.99 | 16.600% |
| AY | 51 | 2 | 2 | 39,750,726.00 | 46,154,294.45 | 16.109% |
| PAK | 83 | 6 | 6 | 37,808,581.00 | 44,337,680.16 | 17.269% |

### Layout variants and traps

One profile with header aliases, per CLAUDE.md §5b-3b ("layouts are data, not
code"). Do not add a second layout.

| | PAK | AY | Alpha |
|---|---|---|---|
| `PNL/FIN` column | absent | Q | absent |
| Subtotal | Q, omits `Others` | R | Q |
| Income Tax / rate | R / S | S / T | R / S |
| Cost value | T "Cost Valve" | U "Value" | T "Value" |
| Input tax | U "S.Tax" | V "Total Tax Amt…" | U "Total Tax Amt…" |
| Selling Value | W | X | W |

Four traps, each found in the real files:

1. **Totals rows carry a GD number.** Alpha row 30 has `K = 18,816,870` — the
   sum of the 26 lines above it — and no description, no selling value. Parsed
   naively it doubles the consignment. Detect by empty Description **and**
   non-positive Selling Value; warn per skipped row, the way `ReadLots` warns
   for heading rows.
2. **AST rate is percent TEXT** (`3%`) in Alpha and AY, numeric (`0.03`) in PAK.
   This is the §5b-3b trap that once understated tax by 115,270.18.
   `Helpers/ExcelImport/CellNumber.cs` already handles a trailing `%` and is the
   only parser either reader may use.
3. **Income-tax rate is `6` in AY, `0.06` in the others.** Normalise: a rate
   greater than 1 is a percentage. Not a second layout.
4. **Nine of PAK's 83 lines break the formula** (ratios 1.39, 1.33, 1.56) —
   manual overrides. The computed selling value is a default the operator can
   edit, never a value forced over what the sheet states. When the sheet states
   a selling value that differs from the computed one, the sheet wins and the
   preview says so.

Alpha also carries a stray helper column at `AB` (`=AB3*18%`). Ignored.

### The goods are mostly already in the books

Every GD in the AY and PAK costing sheets is already present in
`OpeningStockLots`. Alpha has no lots, but its opening balance has absorbed
**part** of its single GD:

| Alpha, sheet HS groups vs opening balance | count |
|---|---|
| match exactly (qty and value) | 9 |
| opening holds more (GD is one of several) | 6 |
| opening holds less (partly consumed) | 2 |
| absent from the opening balance | 8 |

So the post-vs-backfill decision cannot be made per file, and for Alpha not even
per GD. It is decided **per line**.

## 3. Scope of round one

In:

- the costing-sheet import, its profile and its calculator
- a GD header entity, created by the import, with no hand-entry screen
- actual cost as a second valuation pool
- GL posting per GD
- actual cost / margin on the stock dashboard
- the adjustment dialog setting both values

Out, deliberately, for a later round:

- a screen to create or edit a GD by hand
- landed-cost apportionment of freight and clearing charges across lines (the
  sheet already states each line's own assessed value and duties, so there is
  nothing to apportion)
- posting the historic opening stock itself to the GL

## 4. Data model

### `ImportConsignment` (new)

The GD header. Created by the import; it exists in round one because a GL entry
is keyed `(CompanyId, SourceDocType, SourceDocId)` and needs something real to
point at, and because posting must be **per GD dated to the GD date** — PAK's
six GDs span July and August, and input tax is claimed in the GD's own tax
period. One entry per uploaded file would collapse them onto one wrong date.

```
Id, CompanyId, GdNumber, GdDate,
TotalCostExcludingTax, TotalInputTax, TotalIncomeTax, TotalSellingValue,
ImportRunId (nullable — the run that created it),
Notes, CreatedAt
```

`GdNumber` is UNIQUE per `CompanyId`. It is an externally issued number, not
allocated by us, so `NumberAllocationRetry` does not apply — a collision is a
duplicate import and must be reported as one.

### `ImportConsignmentLine` (new)

One row per sheet line, kept as written, in the spirit of `OpeningStockLot`.

```
Id, ImportConsignmentId, SourceRow,
DescriptionOnSheet, HsCode, Quantity, Unit,
AssessedValue, CustomsDuty, Acd, RegulatoryDuty, Others,
SalesTaxRate, AstRate, IncomeTaxRate,          -- resolved, stored
AddOnProfit,
CostExcludingTax, SellingValueExcludingTax,    -- resolved, stored
Disposition,                                   -- CostOnly | StockPosted | Skipped
ItemTypeId (nullable), OpeningStockBalanceId (nullable), StockMovementId (nullable)
```

Rates are stored resolved, for the reason §5b-5 and §5b-10 already record: the
document keeps the rate it was costed at when the published rates change.

`CostExcludingTax` and `SellingValueExcludingTax` are stored rather than derived
on read because a line may carry an operator override, and because the GL entry
must reproduce exactly what was posted.

### `StockMovement` — two new nullable columns

`ActualUnitCostExcludingTax` mirrors `UnitCostExcludingTax` exactly. Null means
"value me at the running actual average", the same contract the selling pool
already uses, which is what lets every existing write path stay untouched.

`ActualValueAdjustmentExcludingTax` mirrors `ValueAdjustmentExcludingTax`: a
signed correction applied without moving quantity, set only on a `Revaluation`
row. A revaluation may now correct either pool or both.

### `OpeningStockBalance.ActualCostExcludingTax` (new, `decimal(18,2)`, default 0)

A TOTAL, like `ValueExcludingTax` beside it and for the same reason.

## 5. `Helpers/ImportCostingCalculator.cs`

Pure, static, no database — the only place the chain in §2 is computed. Same
shape as `FurtherTaxCalculator` and `AdvanceTaxRates`.

```csharp
public readonly record struct ImportCosting(
    decimal Cost,          // K
    decimal SalesTax,      // M
    decimal Ast,           // O
    decimal Subtotal,      // Q
    decimal IncomeTax,     // R
    decimal InputTax,      // U = M + O
    decimal SellingValue); // W = U / STRate + AddOnProfit
```

Rules it enforces:

- a non-positive `STRate` yields a selling value equal to cost plus add-on,
  never a division by zero
- `Others` participates in the subtotal (PAK's sheet omits it from its own
  formula, but every PAK row has `Others = 0`, so following the majority costs
  nothing and is the correct general rule)
- income tax is computed and reported but never included in cost

## 6. `StockValuation` — the second pool

`Compute` gains a parallel accumulator running under **identical** rules:

- an inward movement uses `ActualUnitCostExcludingTax` when stated, otherwise
  the running actual average
- an outward movement always leaves at the running actual average, never at a
  sale price — the same invariant, for the same reason
- an emptied bin holds exactly zero actual cost
- a revaluation may carry a signed actual-cost correction

`Position` gains `ActualValueExcludingTax`, `ActualUnitCost` and a derived
`Margin` (`ValueExcludingTax − ActualValueExcludingTax`). `Step` gains the
actual unit cost and running actual value, so the movements drill-down and the
Excel export can show both without a second walk.

This is the one risky change in the feature. It touches the helper every stock
figure in the product depends on. Mitigation is in §10.

## 7. The import pipeline

Reuses the existing machinery end to end: `ImportProfile` + structural
fingerprint, preview-takes-the-file / commit-takes-the-reviewed-rows,
`ImportRun` with its `FileSha256` filtered unique index, `CellNumber`.

### Preview

1. Identify the layout by fingerprint; offer the nearest built-in pre-selected.
2. Resolve every `headerAliases` entry **together**, not one at a time — §5b-3b
   records why: applying them singly cannot express a swap.
3. Read rows, skipping totals rows, warning on each skip by name.
4. Compute the costing per line.
5. **Match each line to existing stock**, in this order:
   - where the company has lots, `OpeningStockLot.LotRef == GdNumber` **and**
     cleaned `HsCode` equal — precise, and covers AY and PAK
   - otherwise, an `OpeningStockBalance` whose `ItemType.HSCode` matches —
     covers Alpha
   - several candidates is **ambiguous**, reported as such, defaulting to no
     action rather than a guess
6. Report per line: matched or not, and the resulting disposition.

### Disposition, decided per line

- **matched → `CostOnly`.** Writes `ActualCostExcludingTax` onto the existing
  `OpeningStockBalance`. No stock movement, no inventory GL. The stock is
  already in the books; only its cost was missing.
- **unmatched → offered as `StockPosted`, opt-in.** Writes a `StockMovement` IN
  at `SellingValue / Qty` for the selling pool and `Cost / Qty` for the actual
  pool, `SourceType = ImportConsignment`, `SourceId = consignment id`, dated the
  GD date.
- **operator declines → `Skipped`**, recorded with its reason.

Defaulting to cost-only is the only behaviour that survives Alpha, whose single
GD needs both dispositions at once.

### Commit

One transaction. Creates the consignments and lines, applies the dispositions,
posts the GL, stamps `ImportRunId`, sets `Company.GlLockDate` if the opening
import's rule requires it. Re-importing identical bytes is refused by the
existing index; a re-exported copy with no new content is refused by the
content comparison.

## 8. General ledger

New `SourceDocType.ImportConsignment`. One balanced entry per GD, dated the GD
date, idempotent on `(CompanyId, ImportConsignment, consignmentId)` — so
re-posting replaces rather than duplicates, exactly as invoices do.

```
Dr  Inventory              Σ Cost              (StockPosted lines only)
Dr  Input Tax              Σ (SalesTax + AST)
Dr  Advance Income Tax     Σ IncomeTax
    Cr  Import Clearing    the balancing total
```

Two new control types, both seeded onto existing charts by
`Data/ImportCostingAccountSeeder.cs`, following the pattern
`FurtherTaxAccountSeeder` established:

- **`ControlType.ImportClearing`** (liability). Credited because the sheet names
  no supplier and no payment reference, so there is genuinely nothing else to
  credit; the operator settles it when the real payment to the supplier and
  clearing agent is recorded. Parking it in `Suspense` was rejected: Suspense
  exists to make imbalances visible, and burying every import in it destroys
  that.
- **`ControlType.AdvanceIncomeTaxOnImports`** (asset). Deliberately NOT the
  existing `WithholdingReceivable`, which
  `AccountingReportService.TaxControl.cs:78` labels "Income tax withheld by
  customers" — import income tax is withheld by nobody. This is the same rule
  §5b-10 records for keeping further tax out of `OutputTax`: the tax reports
  read these accounts, so a second tax mixed into one stops it reconciling and
  loses the check the report exists to provide. Add it to the tax-control
  report's roster in the same change.

**A `CostOnly` line contributes no inventory debit.** The goods were never
posted to the GL in the first place (these companies' journals hold invoices
only), so debiting inventory for stock that the ledger has never carried would
create an asset with no counterpart. Its input tax and income tax still post —
those were really paid.

Nothing posts on a company with `GlPostingEnabled` false.

## 9. UI, navigation, permissions

**Navigation.** `Import Costing` under the existing **Purchases** group — a GD
is a procurement document. No new top-level group for one screen. Actual cost
and margin appear as columns on the Inventory dashboard that already exists,
not as a separate page.

**The three stock surfaces must all carry both figures.** A cost the import can
write but the operator cannot correct is worse than no cost at all: the first
wrong row becomes permanent. So the dashboard, the opening-balance screen and
the adjustment dialog each handle actual cost as a first-class figure, for an
item already in stock and for one being added for the first time.

### Stock dashboard — On-Hand

Gains **Actual Cost**, **Margin** (`ValueExcludingTax − ActualValueExcludingTax`)
and **Margin %**, beside the existing value columns, all from the one walk. The
movements drill-down gains the actual unit cost and running actual value per
movement, from `Step` — never recomputed. The Excel export gains the same,
harness first (`scripts/stock_export_harness`).

Margin is negative when an item's selling value has fallen below its cost. That
is a real state and must render as such, not be clamped to zero.

### Opening Balances tab

`UpsertOpeningBalanceDto.ActualCostExcludingTax` is **nullable, and null means
"not mentioned"** — the row keeps the cost it had. Only a supplied value sets
it, and `0` clears it. This is the distinction §5b-7 records for
`UpdateInvoiceDto.AdvanceTaxSection`, and it matters here for the same reason:
the sheet importer, the UI and any API client all post to this endpoint, and a
caller editing only the quantity must not silently erase a cost that took an
import to establish. `ValueExcludingTax` keeps its existing non-nullable
overwrite behaviour — changing it would alter how every current caller behaves.

`GET company/{id}/opening` must select the new column, and
`OpeningStockBalanceDto` gains `ActualCostExcludingTax` plus derived `Margin`
and `MarginPercent`, computed the same way the DTO already derives `SalesTax`
and `ValueIncludingTax`.

The form shows Quantity / Selling Value / Actual Cost / Tax Rate with a live
margin preview beside the existing tax preview, so a mistyped cost is visible
before saving rather than after.

Adding a balance for an **item type that has never held stock** — including an
HS-tariff placeholder being adopted — already works: the picker is
`SearchableItemTypeSelect`, which searches the server (§5b-2), and writing an
opening balance is one of the legs `ItemTypeRepository.CompanyItemTypeIds`
unions, so the item becomes visible to that company on save (§5b-2b). No change
needed; it needs a test, because nothing currently pins it.

### Adjustment dialog

`set` mode gains `TargetActualCostExcludingTax`; `delta` mode gains
`ActualValueDelta` and, for an adjustment up, `ActualUnitCostExcludingTax`.

`StockMovement` gains `ActualValueAdjustmentExcludingTax`, a second signed
correction mirroring `ValueAdjustmentExcludingTax` exactly, so a `Revaluation`
row can correct either pool or both.

The `set`-mode arithmetic must be mirrored, not shared: the actual-cost delta
nets off whatever the quantity movement will itself do to the **actual** pool,
predicted from the actual average, before the revaluation closes the gap.
Measuring it against the current actual value instead takes the cost down twice
when a correction lowers both figures — the bug §5b-4 records for the selling
pool, which will reappear here verbatim if the prediction step is skipped.

The three invariants carry over unchanged, refused with a message rather than
silently dropped:

- actual cost may not go negative
- a zero quantity may not be left holding actual cost
- an outward movement is never valued at a stated cost

Adjusting an item with **no stock at all** — the "new HS code" case — is
supported by the same `set` mode: the operator states the truth
(`targetQuantity`, `targetValueExcludingTax`, `targetActualCostExcludingTax`)
against a current position of zero, and the server derives the movements. The
resulting `StockMovement` is itself a membership leg, so the item appears in
that company's pickers immediately. Tracking being off does not block it — the
existing endpoint deliberately bypasses that gate so a back-fill before flipping
the flag stays possible, and actual cost inherits that.

`CurrentPositionAsync` must return the actual pool alongside the selling one, or
every prediction above is computed against zero.

**Permissions**, in `Helpers/PermissionCatalog.cs`, module mapped in
`myapp-frontend/src/config/permissionSections.js` in the same change:

| Key | Module | Meaning |
|---|---|---|
| `importcosting.sheet.run` | ImportCosting | Import a GD costing workbook |
| `importcosting.consignments.view` | ImportCosting | View consignments and their lines |
| `stock.actualcost.view` | Inventory | See actual cost and margin |

Actual cost is an internal figure. It is gated separately from
`stock.dashboard.view` so an operator who prices and sells does not necessarily
see the margin. Action buttons the caller cannot use do not render.

## 10. Testing

New: `scripts/test_gd_import_costing.py`, covering

- the costing chain against the three real sheets' own stated outputs, line by
  line, including the nine PAK overrides
- percent-text and whole-number rate normalisation
- totals-row detection (Alpha row 30 must not become a line)
- all three header-alias variants resolving, applied together
- per-line disposition on the Alpha shape: 9 exact matches, 6 partials, 2
  shortfalls, 8 unmatched
- cost-only writing no stock movement and no inventory debit
- GL entry balanced, dated to the GD date, idempotent on re-post
- a re-import of identical and of re-exported bytes both refused

Extended, because the second pool touches them:

- `scripts/test_stock_valuation_flow.py` — the actual pool depletes with sales,
  never goes negative, an emptied bin holds zero cost; and the three operator
  surfaces round-trip it:
  - an opening balance saved with both figures reads both back
  - an upsert that omits `actualCostExcludingTax` leaves it untouched, and one
    that sends `0` clears it
  - `set`-mode adjustment lowering quantity **and** actual cost together lands
    on the stated cost exactly, not on twice the correction (the §5b-4 bug,
    re-tested for the actual pool)
  - `set`-mode adjustment against an item with no stock at all creates the
    position and makes the item visible to that company's picker
  - a target pairing zero quantity with a non-zero actual cost is refused
- `scripts/test_stock_export_excel.py` and `scripts/stock_export_harness` — the
  new columns, and the workbook still unable to disagree with the screen
- `scripts/test_accounting_reports.py` — both new control accounts appear in the
  trial balance, the balance sheet and the tax-control report, and the reports
  still cross-check
- `scripts/test_tenant_isolation.py` — every new endpoint taking a `companyId`
- `scripts/verify_permission_sections.py` — the new module mapped

Unchanged and expected to stay green: `test_basic_flows`,
`test_stock_itemtype_reflow` (V1 semantics are byte-identical),
`test_stock_v2_lifecycle`, `test_bill_pricing_advance_tax`.

## 11. Phases

Each phase ends green and is independently useful.

1. **Costing calculator + sheet reader.** `ImportCostingCalculator`, the profile,
   the aliases, the traps. Offline-testable against the three workbooks. No
   database change.
2. **Consignment entities + preview.** Header, lines, matching, the preview
   endpoint and screen. Read-only — nothing is written to stock yet.
3. **Commit: cost-only**, and the opening-balance surface. Writes
   `OpeningStockBalance.ActualCostExcludingTax`; the Opening Balances tab can
   enter and edit it, for an existing item and for one added for the first time.
   This alone loads actual cost for all three clients' existing stock and makes
   it correctable, which is the request that unblocks them.
4. **The second valuation pool.** `StockMovement`'s two columns,
   `StockValuation`, `CurrentPositionAsync`, the dashboard columns and
   drill-down, the export.
5. **The adjustment surface.** Both modes, both pools, the mirrored prediction,
   the three invariants, the no-stock case.
6. **Commit: post stock** for unmatched lines.
7. **GL posting**, the two new control accounts and their seeder.

Phases 1–3 deliver the actual-cost backfill and make it maintainable. Phases 4–5
make it stay correct as stock moves. Phases 6–7 make the next consignment work.

Phase 3 is usable without 4: an opening balance's actual cost is a stored figure
the screen can show directly. The dashboard's **on-hand** actual cost and margin
need phase 4, because only the walk knows what is left.

## 12. Deferred, recorded so it is not lost

- A screen to create or edit a GD by hand. The entity is built for it.
- Posting the historic opening stock to the GL. The Inventory account currently
  carries no opening position at all, which is a pre-existing gap this feature
  neither creates nor fixes.
- On the standalone bill, letting an entered **quantity** derive the unit price
  from the stock's selling value, as the entered **amount** already does. Raised
  in discussion, genuinely small, unrelated to the costing chain. Its own change.
- Per-client default add-on profit, as §5b-10 deferred per-client further-tax
  defaults.
