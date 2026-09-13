# GD Import Costing — operator runbook and build record

Permanent doc. Not transient — this is the reference for every future monthly
import, and the place where a reported problem gets written down and turned into
either a fix or a stated expected behaviour.

Branch: `feat/importer-ledger-receipts` (importer production line).
First shipped: 2026-09-13.

---

## 1. What this feature is

An importer buys a consignment against a customs **Goods Declaration (GD)**. The
GD states an assessed value and the duties charged on it. That total is what the
goods actually cost.

Before this feature the system knew only what stock was worth **to sell**. It now
also knows what it **cost**, so margin is answerable.

**Cost = Assessed Value + C.Duty + ACD + RD.** Sales tax, additional sales tax
and income tax at import are computed and displayed but are NOT cost — the first
two are recoverable input tax and the third is adjustable.

**Selling value is derived, not marked up.** It is
`(SalesTax + AST) / SalesTaxRate`, which reduces to `Cost × (1 + ASTRate/STRate)`
— the value at which the output sales tax on the eventual sale exactly absorbs
the input tax paid at import. At the usual 18% / 3% that is a fixed ×7/6. A
selling value typed on the sheet always overrides the computed one.

---

## 2. Where it lives

| What | Where |
|---|---|
| Run an import | **Purchases ▸ Import Costing** (`/imports/costing`) |
| Type one line by hand | Same screen, "Enter a line by hand" |
| In-app operator guide | **Guides ▸ Import Guide** (`/guides/import`) |
| See the result | **Dashboards ▸ Inventory ▸ On-Hand** — Actual Cost, Margin |
| Opening figures | **Dashboards ▸ Inventory ▸ Opening Balances** |
| Correct a figure | Same screen, or the **Adjust** dialog on On-Hand |

Permissions: `importcosting.sheet.run` to import, `stock.actualcost.view` to see
actual cost and margin anywhere. Actual cost is internal management information
and is gated separately on purpose — somebody who prices and sells does not
automatically see the margin.

---

## 3. The two import modes — READ THIS BEFORE EVERY MONTHLY IMPORT

The choice sits next to the file picker and it is the single most consequential
control on the screen.

| Mode | What a MATCHED line does | Use it for |
|---|---|---|
| **These goods are already on the books** (default) | **SETS** the actual cost: `unitCost × balance quantity`. Quantity untouched. | The one-off backfill of historical cost onto stock already loaded. |
| **These are new arrivals** | **ADDS** quantity, actual cost and selling value to what is on the books, so the per-unit cost becomes a weighted average across consignments. | Every monthly GD from now on. |

**Why this exists.** The feature was first specified as a one-time backfill. With
only that behaviour, month 2 breaks: an item imported in month 1 now has a
balance, so month 2's line MATCHES, the cost is overwritten with month 2's unit
rate applied to month 1's quantity, and the newly arrived units never appear.
The mode makes the operator say which act they are performing.

A line that matches NOTHING is unaffected by the mode — it is offered as new
stock under the separate opt-in below.

---

## 4. Bringing in items that are not on the books yet

Off by default. Tick **"Also bring unmatched lines in as new stock"** and an
unmatched line will:

1. **Reuse an existing item type only when the HS code AND the name both match**
   (case- and trailing-space-insensitive). One tariff line legitimately carries
   several different products, so a name mismatch means a different product, not
   a duplicate.
2. Otherwise **create** an item type from the sheet's own name, HS code and unit.
3. If it reuses an HS-tariff placeholder, **adopt** it (`IsFavorite = true`) so it
   reaches that company's pickers. The placeholder is never renamed — item types
   are installation-wide and a rename would be visible to every tenant.
4. Create the opening balance with the line's quantity, selling value, actual
   cost, tax rate and the GD date.

---

## 5. What the import does NOT touch

- **Nothing is posted to the general ledger.** See §7.
- No stock movements are written. The opening balance is the vehicle.
- Selling prices, quantities on existing documents, and anything filed with FBR
  are untouched.
- `Company.GlLockDate` is not set.

---

## 6. Baseline — the three sheets as imported on 2026-09-13

Keep this. It is what next month's run should be compared against.

| Company | Lines read | Totals rows skipped | Other warnings | Dispositions |
|---|---|---|---|---|
| Alpha Traders (4) | 26 | 1 | — | 17 cost-only, 9 unmatched |
| AY TRADERS (5) | 51 | 2 | 3 column relocations, 1 override | 51 cost-only |
| PAK TRADE CO (6) | 83 | 6 | 9 selling-value overrides | 80 cost-only, 3 unmatched |

After committing: Alpha 17 of 39 balances costed, AY 37 of 78, PAK 47 of 60
(PAK gained 3 balances from the create-missing-stock run).

Worked reference line, Alpha row 3: assessed 62,490, no duties, ST 18%, AST 3%
→ cost 62,490, sales tax 11,248.20, AST 1,874.70, subtotal 75,612.90, income tax
4,536.77, input tax 13,122.90, **selling value 72,905.00**.

Depletion proof, ASSORTED CONVEYOR BELT: opening actual cost 1,734,740.78 over
3,450.4142 units → average 502.763054/unit → on hand 1,650.4142 shows
**829,767.28**, predicted 829,767.28, difference 0.00.

---

## 7. Accounting impact — WHAT POSTS TODAY: NOTHING

**As of 2026-09-13 the GD costing import writes no journal entry at all.**
Verified: `JournalEntries` on this installation contains only `SourceDocType = 1`
(invoices). The control accounts named below **do not exist yet** — there is no
`ImportClearing` and no `AdvanceIncomeTaxOnImports` in `ControlType`.

So today:

- Actual cost is **inventory management information only**. It changes the stock
  dashboard and nothing else.
- **No accounts payable is created.** The money you owe the supplier and the
  clearing agent is not recorded by this import. Record it the way you do now —
  a purchase bill or a manual journal — and be aware it is NOT linked to the
  consignment.
- Input sales tax and AST paid at import are computed and shown on the preview so
  you can reconcile against the GD, but they are **not** posted to a recoverable
  tax account.
- Income tax at import is likewise computed and shown but not posted.

### What is DESIGNED to post, when phase 2 is built

Recorded here so the intent is not lost, and so nobody mistakes it for current
behaviour. Per GD, dated the GD date, one balanced entry:

```
Dr  Inventory                        Σ Cost              (new-stock lines only)
Dr  Input Tax                        Σ (SalesTax + AST)
Dr  Advance Income Tax on Imports    Σ IncomeTax
    Cr  Import Clearing              the balancing total
```

Two new control accounts are required and neither is built:

- **`ImportClearing`** — a LIABILITY. This is the accounts-payable answer to the
  question "where does the import liability sit". The costing sheet names no
  supplier and no payment reference, so there is nothing else to credit; the
  operator settles it when the real payment to the supplier and the clearing
  agent is recorded. It is deliberately NOT `Suspense`, which exists to make
  imbalances visible and would be useless if every import were parked there.
- **`AdvanceIncomeTaxOnImports`** — an ASSET. Deliberately NOT the existing
  `WithholdingReceivable`, which the tax-control report labels "Income tax
  withheld by customers" — import income tax is withheld by nobody, and mixing a
  second tax into a control account stops it reconciling.

A **cost-only** line will contribute no inventory debit even then: those goods
were never posted to the ledger in the first place (these companies' journals
hold invoices only), so debiting inventory for stock the ledger has never carried
would create an asset with no counterpart. Its input tax and income tax still
post — those were really paid.

Nothing will post on a company with `GlPostingEnabled` false.

---

## 8. Known limits and stated expected behaviours

Check a reported "problem" against this list first. Several of these are
deliberate and are the correct behaviour.

| Behaviour | Deliberate? | Note |
|---|---|---|
| A line matching nothing is not imported unless the opt-in is ticked | Yes | Stops inventory being invented by accident |
| An ambiguous line (HS code matches 2+ items) is left alone | Yes | The system will not guess which item you meant |
| A "Total" row is skipped | Yes | Importing one would double the consignment |
| Re-running the same file is refused | Yes | Duplicate `FileSha256` |
| Re-importing a GD number already recorded is refused | Yes | No upsert path for a GD in this release |
| A rate written `0.18`, `18%` or `18` all mean 18% | Yes | Three real sheets each write it differently |
| A typed selling value overrides the computed one | Yes | 9 real PAK lines rely on this |
| Margin can be negative | Yes | A real state; never clamped |
| Margin % shows a dash | Yes | When there is no selling value to measure against |
| Actual cost of 0 | Yes | Means "not known" |
| Nothing posts to the GL | Yes, for now | §7 |
| A purchase bill at 25% GST does not move the item onto 25% | **NO — pre-existing bug** | See §9 |

---

## 9. Open defects

**A purchase at a different GST rate does not re-rate the item.**
`scripts/test_stock_valuation_flow.py` reports 82/84, failing "the item moves
onto the new rate" and "sales tax is recomputed at the new rate". Proved
**pre-existing** by A/B: the same suite against commit `90fe432` (before the
actual-cost pool was added) fails identically. Not caused by this feature. Not
yet diagnosed.

---

## 10. Test suites

| Suite | Command | Expect |
|---|---|---|
| Costing chain, layout, reader (offline) | `cd scripts/gd_costing_harness && dotnet run -c Release` | `75 checks, 0 failed` |
| Same, against a real workbook | add `-- --file "<path>" --expect-lines N` | see §6 |
| Full live suite | `python scripts/test_gd_import_costing.py` | `151 passed, 0 failed` |
| Stock valuation (adjustments) | `python scripts/test_stock_valuation_flow.py` | 82/84 — see §9 |
| Stock export layout | `cd scripts/stock_export_harness && dotnet run -c Release` | `255/255` |

---

## 11. Diagnosing next month's import

Work down this list before reporting a defect.

1. **Did the line counts match the sheet?** The preview reports
   `sourceRowCount` and the number of lines kept. A count one higher than
   expected usually means a totals row was not recognised — check its
   Description cell and whether it carries a Selling Value.
2. **Read the warnings.** Every skipped row, every relocated column and every
   selling-value override is named there. A silently relocated column is how a
   wrong column becomes a confident wrong import.
3. **Was the right mode selected?** §3. A month of new arrivals imported in
   backfill mode overwrites cost and adds no stock.
4. **Is a line unmatched that should have matched?** Matching is by GD number +
   HS code against existing lots first, then by the item type's HS code. If the
   item exists under a *different* HS code, it will not match.
5. **Is a line ambiguous?** Two of your items share that HS code. Either merge
   them or set the cost by hand on the Opening Balances screen.
6. **Do the figures disagree with the sheet?** The server recomputes every cost
   from the raw duty inputs and ignores the sheet's own computed columns. If the
   sheet's arithmetic differs, the server's is the one that lands — check the
   sheet's formulas.

---

## 12. Issue log

Record every problem a real user reports, and its resolution. A problem that
turns out to be intended behaviour gets written into §8 instead of fixed.

| Date | Sheet / company | What the user saw | Diagnosis | Outcome |
|---|---|---|---|---|
| 2026-09-13 | Alpha Traders | "EMPTY PLASTIC DISTRIBUTION BOX, 3923.2900 — Not matched" | Correct at the time: unmatched lines were reported, not imported. | Built the create-missing-stock opt-in (§4). |
| 2026-09-13 | — | "sheet for every month will be imported ... some will use existing item type and some will have new" | Month 2 would have overwritten cost and added no stock. | Built the two import modes (§3). |
| | | | | |

---

## 13. Build record

| Date | Change |
|---|---|
| 2026-09-13 | Costing calculator, sheet reader, one built-in layout with heading aliases, totals-row guard, rate normalisation |
| 2026-09-13 | `ImportConsignment` / `ImportConsignmentLine`; `OpeningStockBalance.ActualCostExcludingTax` |
| 2026-09-13 | Preview + commit, per-line matching, server-side re-verification of every match and every cost |
| 2026-09-13 | Actual cost on the Opening Balances screen; nullable margin percent |
| 2026-09-13 | Import screen, in-app guide, permissions, nav |
| 2026-09-13 | Create missing item types and opening balances, opt-in |
| 2026-09-13 | Second actual-cost pool in `StockValuation`; Actual Cost and Margin on On-Hand, depleting with sales |
| 2026-09-13 | Actual cost in the stock Adjust dialog, both modes |
| 2026-09-13 | Hand-typed single-line entry, through the same preview and commit as the sheet |
| 2026-09-13 | Backfill vs new-arrivals mode |

Deferred: GL posting (§7); a screen to browse recorded consignments
(`importcosting.consignments.view` exists but nothing consumes it); an upsert
path for re-importing a GD already recorded.
