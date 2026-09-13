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

- **Nothing is posted to the general ledger in Backfill mode.** A New Arrivals
  commit DOES post one journal entry per GD — see §7.
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

## 7. Accounting impact — NEW ARRIVALS POSTS; BACKFILL DOES NOT

**As of commit `077f3db` (2026-09-13) a New Arrivals commit writes one balanced
journal entry per GD, dated the GD's own date:**

```
Dr  Inventory                        Σ Cost              (every costed line)
Dr  Input Tax                        Σ (SalesTax + AST + Others)
Dr  Advance Income Tax on Imports    Σ IncomeTax
    Cr  Import Clearing              the balancing total
```

- **Inventory is debited for EVERY costed line — CostOnly and StockPosted
  alike, not new-stock lines only.** Under New Arrivals a CostOnly (matched)
  line is exactly where new quantity, cost and selling value are ADDED onto an
  existing balance (§3) — genuinely new goods landing against an
  already-known product — so its landed cost belongs in Inventory the same as
  a brand-new StockPosted line's does. An earlier build excluded it, which
  understated Inventory while the full cost still credited Import Clearing —
  wrong on the ordinary, common-case path (a matched line is the usual
  outcome from month 2 onward). Fixed 2026-09-13; see §12.
- **Backfill posts NOTHING, and that is deliberate, not a gap.** A Backfill
  commit is RE-PRICING stock already on the books — its quantity and value
  were posted (or opened) long before this GD — so there is no new asset, no
  new tax paid THIS period, and no new liability to record. Posting one now
  would claim tax in the wrong period and invent a payable that was in fact
  settled long ago. `PostImportConsignmentAsync` is never even called for a
  Backfill commit — the caller (`GdCostingImportService.CommitAsync`) only
  invokes it under New Arrivals.
- **`ImportClearing` is where the import payable sits** between clearance and
  settlement — the accounts-payable answer for an import. The costing sheet
  names no supplier and no payment reference, so there is nothing else to
  credit. **Do NOT also book a purchase bill or a manual journal for the
  landed cost itself on a New Arrivals GD** — the liability would be booked
  twice: once by this import, once by the manual entry.
- **Settling it is now a per-GD subledger (Task 23, commit range starting
  2026-09-13), not just an account balance.** Every consignment carries:
  - `ImportClearingCredited` — what THIS GD actually credited to Import
    Clearing when it posted (written once, at commit time; 0 for Backfill or
    for a New Arrivals commit made while the ledger was off — both genuinely
    owe nothing through this route).
  - `AmountSettled` — Σ of every non-cancelled payment recorded against it.
  - `Outstanding = Credited − Settled`, always derived, never stored.

  **To settle one**: Purchases → Consignments → the green "Settle" action on
  a row that still owes something, or an ordinary money-out Payment whose
  allocation is `{ kind: "ImportConsignment", importConsignmentId, amount }`
  (`PaymentAllocation.Kind.ImportConsignment`) — both go through the exact
  same `PaymentService`/`PostingService` machinery a purchase-bill payment
  does: Dr Import Clearing, Cr Bank/Cash. Guards mirror the purchase-bill
  ones exactly: a settlement can't exceed what is still outstanding, and a
  consignment with `ImportClearingCredited == 0` (Backfill, or GL-off at
  commit time) cannot be settled at all — there is nothing there to clear,
  and the refusal names the mode so the operator isn't left guessing why.
  Deleting/undoing a consignment (§ delete path) is refused while any
  settlement stands against it.

  **To see which GD is unpaid**: the Consignments screen has Credited /
  Settled / Outstanding columns and a status (Not posted / Unpaid / Part
  paid / Settled) on every row, defaults to unpaid-first, can filter to only
  what's owed, and shows a company-wide total that ties to the Import
  Clearing account's own balance. A row's detail lists every settling
  payment (date, reference, amount).

  **A manual journal or an ordinary purchase bill against Import Clearing
  still works to move money off the ACCOUNT**, but it settles nothing at the
  per-GD level — `AmountSettled` only ever moves via a
  `PaymentAllocation` row pointed at that specific consignment. Doing it the
  manual way leaves that GD's own Outstanding at its full credited amount
  forever, even though the account total looks clear — use the Payment /
  Settle route so the two stay in step.
- Both control accounts **exist and are seeded**, on new and existing charts
  alike: `ImportCostingAccountSeeder` runs at startup and adds
  `ImportClearing` (a LIABILITY, beside Accounts Payable) and
  `AdvanceIncomeTaxOnImports` (an ASSET, beside Withholding Receivable — kept
  separate because import income tax is withheld by nobody, and mixing a
  second tax into that control account would stop it reconciling) to any
  company whose chart already exists and lacks them; `CoaPresetSeeder` gives
  both to any company set up from now on. Neither is `Suspense`, which exists
  to make imbalances visible and would be useless if every import were parked
  there.
- Nothing posts on a company with `GlPostingEnabled` false, New Arrivals or
  Backfill alike.
- Actual cost remains inventory management information for the stock
  dashboard regardless of mode — see §2's permission note — but under New
  Arrivals it is now ALSO a real, ledger-posted asset movement, not merely a
  dashboard figure.

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
| Backfill posts nothing to the GL; New Arrivals posts one entry per GD | Yes | §7 |
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
| Full live suite | `python scripts/test_gd_import_costing.py` | `285 passed, 0 failed` |
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
| 2026-09-13 | — | Test suites leaving item types behind | `ItemType` is a GLOBAL catalog with no `CompanyId`, so deleting a throwaway company does NOT remove the item types a suite created. They pile up under real HS codes. | The GD suite now deletes what it creates. 139 leftover rows removed; two tariff placeholders it had renamed were restored to their published descriptions and un-adopted. |
| 2026-09-13 | — | `test_spreadsheet_import` 133/2 | Its "every item is new on a first upload" assertion fails against HS-tariff placeholders that **its own earlier runs** adopted and renamed (`WASHING PARTS`, `LED ONE`). Self-polluting, and unrelated to GD costing — clearing the GD suite's residue changed nothing. | Not fixed. That suite needs its own teardown, or fixture HS codes nothing else adopts. |
| 2026-09-13 | — | Architecture review, Finding 1 (CRITICAL): New Arrivals understates Inventory while overstating the liability | `PostImportConsignmentAsync` debited Inventory for `StockPosted` lines only. Under New Arrivals a matched (`CostOnly`) line ADDS quantity, cost and selling value onto an existing balance (§3) — genuinely new goods — so its tax and full cost were posted (debited/credited) while its cost never reached Inventory. Balanced arithmetically (the credit is defined as the debit sum) but wrong: Inventory understated, Import Clearing overstated by the same amount, on the ordinary matched-line path from month 2 onward. | Fixed: the Inventory debit now reads the consignment's own `Mode` (persisted since `7d2871c`) rather than disposition alone — every costed line (`CostOnly` and `StockPosted`) debits Inventory under New Arrivals; Backfill still posts nothing (§7). |
| 2026-09-13 | — | Architecture review, Finding 2 (CRITICAL): `stock.actualcost.view` is decorative | The permission is defined and the frontend gates rendering on it, but no controller action checked it — `StockController.BuildOnHandAsync` populated actual cost and margin on every row of the on-hand grid, the Excel export and the movements drill-down regardless, so anyone who could see stock at all received the company's landed cost and margin in the raw JSON or a downloadable spreadsheet. | Fixed: `StockController` now checks the permission imperatively (`IPermissionService`) and nulls `ActualCostExcludingTax` / `OpeningActualCostExcludingTax` / `ActualUnitCost` / `RunningActualValue` on all three surfaces when the caller lacks it — nulled rather than zeroed, so a redacted row cannot be misread as "actual cost is zero" (zero already means that) or make Margin read as the full selling value. `StockExcelBuilder`'s Cost-of-Good-Sold block falls back to its existing client-formula branch automatically. |
| 2026-09-13 | — | Architecture review, Finding 3 (IMPORTANT): nothing stops the overwrite recurring | A Backfill commit SETs `ActualCostExcludingTax` with no check that the balance already carried a cost from an earlier GD — already corrupted 26 real opening balances (9 on company 5, 17 on company 6), each holding only the last consignment's rate applied to the whole accumulated quantity. | Fixed at PREVIEW time (not blocked — a deliberate re-backfill after a correction is legitimate): a Backfill line matching a balance whose `ActualCostExcludingTax` is already non-zero carries a new `OverwriteWarning` naming the figure that would be replaced, counted in the preview's `OverwriteWarningCount`, and rendered next to the line beside its match note. The 26 already-corrupted balances are NOT touched by this fix — a separate, maintainer-approved data operation. |

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
| 2026-09-13 | GL posting for New Arrivals (`077f3db`): `ImportClearing` / `AdvanceIncomeTaxOnImports` control accounts, seeded on new and existing charts; `PostImportConsignmentAsync`; a Consignments screen to view and delete a recorded import, mode-aware reversal |
| 2026-09-13 | Architecture-review fixes (Findings 1-3, §12): Inventory debit made mode-aware so a matched New Arrivals line is no longer excluded; `stock.actualcost.view` enforced server-side across the on-hand grid, the Excel export and the movements drill-down; a Backfill preview against an already-costed balance now warns before overwriting it |
| 2026-09-13 | Task 23 — Import Clearing subledger: `PaymentAllocation.Kind.ImportConsignment` (a Payment debiting Import Clearing, the AP mirror of a purchase-bill allocation); `ImportConsignment.ImportClearingCredited` / `AmountSettled`, the latter recomputed alongside `PurchaseBill.AmountPaid` on every create/update/delete; over-settle and never-posted (Backfill/GL-off) guards; the Consignments screen gained Credited/Settled/Outstanding/Status columns, unpaid-first default order, an only-outstanding filter, a company-wide total, a per-row settlement list, and a Settle action (`SettleConsignmentDialog`, a focused dialog rather than a fourth PaymentForm purpose — see the guide's §7 and the dialog's own doc comment for why); a migration backfills `ImportClearingCredited` for consignments that posted before the column existed |

Deferred: a screen listing consignments now exists (Consignments, above) but an
upsert path for re-importing a GD already recorded is still not built.
