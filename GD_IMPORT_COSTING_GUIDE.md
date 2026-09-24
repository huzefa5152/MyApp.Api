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
| Type a GD by hand | Same screen, step 2 "Type the GD" |
| In-app operator guide | **Guides ▸ Import Guide** (`/guides/import`) |
| See the result | **Dashboards ▸ Inventory ▸ On-Hand** — Actual Cost, Margin |
| Opening figures | **Dashboards ▸ Inventory ▸ Opening Balances** |
| Correct a figure | Same screen, or the **Adjust** dialog on On-Hand |
| Correct ONE line of a recorded GD | **Purchases ▸ Consignments** — expand the GD, then the pencil on the line |
| See what changed a cost, and when | **Dashboards ▸ Inventory ▸ On-Hand** — the **History** button on a row, or **Cost History** in the header for the whole company |
| Settle a GD (in full, or short) | **Purchases ▸ Consignments** — **Settle**; edit it later from **Accounting ▸ Payments** |

Permissions: `importcosting.sheet.run` to import, `stock.actualcost.view` to see
actual cost and margin anywhere. Actual cost is internal management information
and is gated separately on purpose — somebody who prices and sells does not
automatically see the margin.

---

## 3. The two import modes — READ THIS BEFORE EVERY MONTHLY IMPORT

The choice is step 1 of the screen and it is the single most consequential
control on it. Since 2026-09-25 the screen OPENS on New arrivals; Backfill sits
behind its own "One-off: price stock that is already on the books" button and,
once picked, carries a warning. (An API caller that sends no `mode` still gets
Backfill, as before.)

| Mode | What a MATCHED line does | Use it for |
|---|---|---|
| **New goods arrived on this GD** (the screen's default) | **ADDS** quantity, actual cost and selling value to what is on the books, so the per-unit cost becomes a weighted average across consignments. | Every monthly GD. |
| **One-off: these goods are already on the books** | **SETS** the actual cost: `unitCost × balance quantity`. Quantity untouched. | The one-off backfill of historical cost onto stock already loaded. |

**Why this exists.** The feature was first specified as a one-time backfill. With
only that behaviour, month 2 breaks: an item imported in month 1 now has a
balance, so month 2's line MATCHES, the cost is overwritten with month 2's unit
rate applied to month 1's quantity, and the newly arrived units never appear.
The mode makes the operator say which act they are performing.

A line that matches NOTHING becomes new stock (§4); the mode only decides whether
the screen brings it in by default.

---

## 4. Bringing in items that are not on the books yet

On **New arrivals** every such line comes in by default and has its own **Leave
out** button; on **Backfill** it is left out until the operator brings it in (the
screen's default, not the server's: the API still takes `createMissingStock` plus a
per-line `leaveOut`). Before it can come in, its HS code must be in the tariff
master and every line creating the same item must give the same unit. The review
says which of the three below will happen (*New item* / *First stock of* /
*Adopts the tariff item*). A line brought in will:

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
  outcome from month 2 onward). Fixed 2026-09-13; see §17.
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

## 8. Correcting a recorded GD — one line, not the whole sheet

Before 2026-09-13 the only correction was deleting the consignment and
re-importing the sheet. A **settled** consignment cannot be deleted at all (a
payment against its Import Clearing liability blocks it), so one mistyped duty
on one row of an 83-line sheet had nowhere to go.

**Purchases ▸ Consignments ▸** expand the GD **▸** the pencil on the line.

What it edits: the costing INPUTS only — quantity, assessed value, customs duty,
ACD, regulatory duty, others, the three rates, add-on profit, the selling-value
override and the row's description.

What it will NOT edit, on purpose: **which item the line feeds**. Moving a line
to another item unwinds one item's stock and loads another's; that is a
delete-and-reimport, and the dialog says so.

What happens when you save:

| | |
|---|---|
| The cost and selling value | Recomputed **server-side** from the inputs you typed, through the same calculator the sheet path uses. The preview in the dialog is a courtesy; the server's answer is what lands. |
| A **Backfill** line's balance | The actual cost is **re-derived** — this GD's corrected unit cost applied to the balance's whole quantity, byte-for-byte the formula the import used. Quantity and selling value are untouched. |
| A **New Arrivals** line's balance | The **difference** is applied to quantity, cost and selling value, so anything that has happened to the balance since is left alone. |
| The journal entry | Withdrawn and re-posted, so Import Clearing carries the corrected liability. Exactly one entry per GD, never two. |
| The cost history | A `GD line corrected` entry, carrying the reason you typed. |

**Two refusals worth knowing.** A correction that would take a balance's
quantity, cost or value negative is refused whole — something else has already
reduced it below what this line brought in. And a correction that drops the GD's
liability **below what has already been settled** against it is refused whole
too, with the two figures named: reduce or cancel the settlement first.

Both roll everything back. There is no half-correction.

---

## 9. Settling a GD — and why most of yours cannot be

**Only a New Arrivals import can be settled.** It is the only mode that credits
Import Clearing, so it is the only one that creates a payable. A **Backfill**
import re-prices stock already on the books — those goods were accounted for
when they first arrived — so it posts nothing and there is nothing to settle.
The Settle action is hidden on such a row, correctly, and expanding the row now
says so in as many words rather than showing an empty space.

All nine consignments on production today are Backfill, which is why none of
them offers Settle. That is the feature working, not a missing button.

A GD that says **Not posted** but WAS imported as New Arrivals means the ledger
was off for that company at the time. Turn it on and rebuild
(**Accounting ▸ rebuild the ledger**); the consignment posts then, and becomes
settleable.

### Settling one short — cash plus a write-off

A GD's Import Clearing liability is an **estimate** until the clearing agent's
final bill arrives. When the final bill comes in under, the old options were to
overstate the cash paid or leave the GD showing an outstanding balance forever.

On **Settle**, enter the cash actually paid; if it is less than outstanding, the
dialog offers **Discount received**, **Write back the rest** or **Other
account**. The remainder clears the liability without moving money:

```
Dr  Import Clearing              cash + adjustment      (the liability, cleared in full)
    Cr  Bank / Cash              cash                   (what actually left)
    Cr  Sundry balances written back (or your choice)    the adjustment
```

- **The payment document itself carries only the CASH.** The write-off is not
  money; it settles the GD, not the payment.
- **`Settled` counts both**, and so does the over-settle guard — or a GD could
  be settled twice, once in cash and once as a write-off.
- With the ledger **off** the adjustment still clears the GD and posts nowhere.
- The chosen account must belong to the company. A body id from another
  company's chart is refused, not silently dropped.

**Editing a settlement.** Accounting ▸ Payments ▸ Edit on a GD settlement opens
the same Settle dialog, not the general payment form — the general form keys a
saved allocation back to a row by invoice or bill id, and a GD line has neither,
so it would vanish on load and be dropped on the next save. (Until 2026-09-13
the Edit action was simply hidden for these payments, which made a mis-keyed
settlement uncorrectable.)

---

## 10. The cost history — what changed a figure, and when

The actual-cost pool is **SET, not accumulated**: a Backfill import overwrites
it, a New Arrivals import adds to it, a hand edit replaces it, a consignment
delete reverses it. Until 2026-09-13 there was no record anywhere of what a
figure had been, so *"the margin looks wrong"* could only be answered by
re-deriving it from the sheets — which is exactly what the person asking no
longer trusts.

**Dashboards ▸ Inventory ▸ On-Hand ▸ History** on a row, or **Cost History** in
the header for the whole company (use that one when you know an import went
wrong but not yet which item).

Each entry states the time, the person, what did it, and all three figures
before and after:

| Source | Written by |
|---|---|
| `GD costing import` | A sheet commit, in either mode. Names the GD. |
| `GD line corrected` | §8. Carries the reason typed into the dialog. |
| `Consignment deleted` | The undo, including balances removed with it. |
| `Opening balance` | The Opening Balances tab, created or edited. |
| `Opening balance removed` | Recorded before the row goes — otherwise the one item that vanished would be the one with no explanation. |
| `Stock adjustment` | The Adjust dialog, carrying the operator's own note. |

Notes:

- **Gated on `stock.actualcost.view`**, the same key that redacts the cost
  columns on the grid — the rows ARE landed cost and margin, so anything softer
  would hand out through the history what the grid hides.
- **Saving without changing anything writes nothing.** A no-op leaves no entry.
- **Nothing before 2026-09-13 is in it.** The table starts empty; earlier
  changes were not recorded and cannot be reconstructed.
- **Append-only.** Nothing edits or deletes an entry; deleting the company takes
  its whole history with it.

---

## 11. The preview's three warnings

None of them blocks a commit. Each names its own figures so the operator can
judge rather than take the system's word.

**"This balance already carries an actual cost."** A second Backfill would
REPLACE a cost an earlier GD wrote. Switch to New Arrivals if the goods are
additional rather than a correction.

**"This would cost X at N, more than / N% away from what its selling value
implies."** (2026-09-14.) Backfill applies one GD's UNIT cost to a balance's
WHOLE quantity — sound while the goods the GD priced represent the goods on the
books, wrong when they do not. The check compares the projected figure against
`ImportCostingCalculator.ExpectedCostFromSelling` (the chain run backwards:
cost = selling x ST / (ST + AST)) and fires when the projection exceeds the
selling value outright, or sits more than 20% away from expected.

The message carries the *why*: how much of the balance this GD actually covers,
and — where the stock sheet merged several products under one HS code — how
many. That second sentence is the useful one: it means the answer is to split
the item, not to retype a cost.

It assumes the selling value on the books came from this same costing
convention. On an importer's books it does (verified to the paisa across 46
groups, §6). A company pricing at a genuine markup would trip it legitimately,
which is the other reason it warns rather than blocks. New Arrivals never raises
it — that mode adds cost for the quantity it actually brings, so there is no
extrapolation to be wrong about.

**"Rate looks misread: income tax 100%."** A cell holding `1` is
indistinguishable from a fraction, so `PercentRate` reads it as 100%. Write 1%
as `0.01`, or as the text `1%`. Cost and selling value are unaffected — income
tax sits outside both chains — but the same rate drives the Advance Income Tax
on Imports debit if the consignment is ever posted under New Arrivals.

---

## 12. Entering a GD by hand — several lines, one consignment

**Purchases ▸ Import Costing ▸ step 2, Type the GD.**

A real GD carries several HS codes: Alpha's single declaration has 26 lines,
PAK's `KAPE-HC-2965` has 24. So hand entry takes a LIST.

1. Type the GD number and date once — they are per consignment.
2. Fill a line and press **Add line and type the next**. The GD header, the unit
   and the three rates carry over to the next line; the product fields clear. A
   box that has been used says in red what it still needs (§12a).
3. Repeat. Edit or remove any staged row before checking.
4. **Check** sends every line in ONE call.

That last point is not a detail. Matching, per-balance pooling and the
plausibility check all reason over the whole SET: two lines landing on the same
item must pool into a single unit cost, and previewing them one at a time would
report each as though it were alone — the exact arithmetic error that produced
the production mispricing in §17.

You do not have to press Add for a single-line GD; what is in the form is
included in the check by itself -- incomplete or not, since the review shows
each line's problems and fixes them in place.

## 12a. What every line needs, and fixing it in the review (2026-09-25)

`Helpers/GdLineRules.cs` is the one definition, for an uploaded row and a typed
line alike: **GD number, GD date, item name, HS code, quantity > 0, unit and
assessed value > 0**; no negative duty, other charge or add-on profit; every rate
0 to under 100 (a "1" read as 100% is refused, not just warned about). On top,
from the books: the unit must be the one the matched item is kept in
(`FbrUomAliases.SameUnit` -- Pcs, Nos and "Numbers, pieces, units" are one unit),
and a new item's HS code must be in the tariff master.

- The preview reports these **per line** (`problems`), never as a refusal of the
  whole set. Commit re-checks every line that WRITES and refuses, naming rows.
- **Fix** opens the same editor the typed path uses. The corrected set is
  re-checked through the hand-entry route with the upload's own `source` (file
  name, SHA-256), so the import is still recorded against the file and that file
  still cannot be imported twice.
- **Leave out** records the line as Skipped ("Left out when importing") and
  writes nothing for it. Its goods do not come in; the summary says so.
- **Several items under one code.** If exactly one carries the line's own name it
  is used ("Matched by name"). Otherwise the operator picks one of the candidates
  ("You chose ..."); a pick that is not a candidate is ignored at commit.

**There is still no way to add a line to a GD already committed.** `GdNumber` is
unique per company and there is no upsert. Correct a line in place (§8), or
delete the consignment and enter it again.

---

## 13. Known limits and stated expected behaviours

Check a reported "problem" against this list first. Several of these are
deliberate and are the correct behaviour.

| Behaviour | Deliberate? | Note |
|---|---|---|
| A line matching nothing is not imported unless the opt-in is ticked | Yes | Stops inventory being invented by accident |
| An ambiguous line (HS code matches 2+ items) is left alone | Yes | The system will not guess which item you meant |
| A "Total" row is skipped | Yes | Importing one would double the consignment |
| Re-running the same file is refused | Yes | Duplicate `FileSha256` |
| Re-importing a GD number already recorded is refused | Yes | Correct ONE line instead (§8); there is still no whole-GD upsert |
| A rate written `0.18`, `18%` or `18` all mean 18% | Yes | Three real sheets each write it differently |
| A typed selling value overrides the computed one | Yes | 9 real PAK lines rely on this |
| Margin can be negative | Yes | A real state; never clamped |
| Margin % shows a dash | Yes | When there is no selling value to measure against |
| Actual cost of 0 | Yes | Means "not known" |
| Backfill posts nothing to the GL; New Arrivals posts one entry per GD | Yes | §7 |
| A line correction cannot move a line to another item | Yes | §8 — that is a delete-and-reimport |
| A correction that drops the liability below what is settled is refused | Yes | §8 |
| A GD settled short with a write-off reads as `Settled`, not `Part paid` | Yes | §9 — both halves clear the liability |
| The cost history is empty for anything before 2026-09-13 | Yes | §10 — the table starts empty and cannot be back-filled |
| Saving an opening balance unchanged leaves no history entry | Yes | §10 |
| A Backfill line can warn that its cost does not fit the stock | Yes | §11 — warns, never blocks |
| A rate at or above 50% is warned about | Yes | §11 — a bare `1` cannot be told from a fraction |
| Hand entry takes MANY lines under one GD | Yes | §12 — one GD normally carries several HS codes |
| A purchase bill at 25% GST does not move the item onto 25% | Resolved | Was §14; the failure was environmental, not a code defect — see §17 |

---

## 14. Open defects

**None outstanding for this feature.**

*Closed 2026-09-13* — "a purchase at a different GST rate does not re-rate the
item". `scripts/test_stock_valuation_flow.py` reported 82/84 for several days.
It was proved pre-existing by A/B (the same failure at commit `90fe432`, before
the actual-cost pool existed) and then went green on its own once the global
`ItemType` catalog was cleaned of test residue: the failing rows were matching
another suite's leftover item under the same HS code. **Environmental, not a
code defect.** It now reports 84/84. If it ever reads 82/84 again, look at the
catalog before looking at the valuation walk.

---

## 15. Test suites

| Suite | Command | Expect |
|---|---|---|
| Costing chain, layout, reader, line rules (offline) | `cd scripts/gd_costing_harness && dotnet run -c Release` | `102 checks, 0 failed` |
| Same, against a real workbook | add `-- --file "<path>" --expect-lines N` | see §6 |
| Full live suite | `python scripts/test_gd_import_costing.py` | `452 passed, 0 failed` (section 29 = the line rules) |
| The screen's rules mirror, outcomes, checklist, summary (offline) | `node scripts/test_gd_costing_entry.mjs` | `54/54 checks passed` |
| Stock valuation (adjustments) | `python scripts/test_stock_valuation_flow.py` | `84/84` |
| Stock export layout | `cd scripts/stock_export_harness && dotnet run -c Release` | `256 checks` |
| Tenant isolation (both new routes) | `python scripts/test_tenant_isolation.py` | all PASS |
| Spreadsheet import (its own teardown) | `python scripts/test_spreadsheet_import.py` | `135 passed, 0 failed`, twice in a row |

---

## 16. Diagnosing next month's import

Work down this list before reporting a defect.

0. **Open the cost history first** (§10). Dashboards ▸ Inventory ▸ On-Hand ▸
   **Cost History**. It names every change to every item's cost since
   2026-09-13, newest first, with the figures before and after and who made
   them. Most reports of "the numbers are wrong" are answered here in one
   screen — and if the change you are looking for is NOT in it, the figure was
   not changed by this system since the trail started, which is just as useful.
1. **Read the three warnings on the preview** (§11) before anything else. The
   cost-plausibility one exists precisely because a figure can be arithmetically
   correct and still wrong for the stock it lands on.
4. **Did the line counts match the sheet?** The preview reports
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

## 17. Issue log

Record every problem a real user reports, and its resolution. A problem that
turns out to be intended behaviour gets written into §13 instead of fixed.

| Date | Sheet / company | What the user saw | Diagnosis | Outcome |
|---|---|---|---|---|
| 2026-09-13 | Alpha Traders | "EMPTY PLASTIC DISTRIBUTION BOX, 3923.2900 — Not matched" | Correct at the time: unmatched lines were reported, not imported. | Built the create-missing-stock opt-in (§4). |
| 2026-09-13 | — | "sheet for every month will be imported ... some will use existing item type and some will have new" | Month 2 would have overwritten cost and added no stock. | Built the two import modes (§3). |
| 2026-09-13 | — | Test suites leaving item types behind | `ItemType` is a GLOBAL catalog with no `CompanyId`, so deleting a throwaway company does NOT remove the item types a suite created. They pile up under real HS codes. | The GD suite now deletes what it creates. 139 leftover rows removed; two tariff placeholders it had renamed were restored to their published descriptions and un-adopted. |
| 2026-09-13 | — | `test_spreadsheet_import` 133/2 | Its "every item is new on a first upload" assertion fails against HS-tariff placeholders that **its own earlier runs** adopted and renamed (`WASHING PARTS`, `LED ONE`). Self-polluting, and unrelated to GD costing — clearing the GD suite's residue changed nothing. | **Fixed** 2026-09-13. Two parts. (a) The suite now snapshots every item type under its four fixture HS codes before it runs and restores them afterwards — deleting what it created, renaming back and un-adopting the placeholders it took over. (b) The assertion itself was wrong for a tariff-loaded installation: adopting the placeholder for a code IS the designed first-upload behaviour, so it now pins the property that actually matters — four distinct items, none of them an item an operator already owns — rather than the state of the HS master. 135/0 on two consecutive runs, with no residue left behind. |
| 2026-09-13 | — | Architecture review, Finding 1 (CRITICAL): New Arrivals understates Inventory while overstating the liability | `PostImportConsignmentAsync` debited Inventory for `StockPosted` lines only. Under New Arrivals a matched (`CostOnly`) line ADDS quantity, cost and selling value onto an existing balance (§3) — genuinely new goods — so its tax and full cost were posted (debited/credited) while its cost never reached Inventory. Balanced arithmetically (the credit is defined as the debit sum) but wrong: Inventory understated, Import Clearing overstated by the same amount, on the ordinary matched-line path from month 2 onward. | Fixed: the Inventory debit now reads the consignment's own `Mode` (persisted since `7d2871c`) rather than disposition alone — every costed line (`CostOnly` and `StockPosted`) debits Inventory under New Arrivals; Backfill still posts nothing (§7). |
| 2026-09-13 | — | Architecture review, Finding 2 (CRITICAL): `stock.actualcost.view` is decorative | The permission is defined and the frontend gates rendering on it, but no controller action checked it — `StockController.BuildOnHandAsync` populated actual cost and margin on every row of the on-hand grid, the Excel export and the movements drill-down regardless, so anyone who could see stock at all received the company's landed cost and margin in the raw JSON or a downloadable spreadsheet. | Fixed: `StockController` now checks the permission imperatively (`IPermissionService`) and nulls `ActualCostExcludingTax` / `OpeningActualCostExcludingTax` / `ActualUnitCost` / `RunningActualValue` on all three surfaces when the caller lacks it — nulled rather than zeroed, so a redacted row cannot be misread as "actual cost is zero" (zero already means that) or make Margin read as the full selling value. `StockExcelBuilder`'s Cost-of-Good-Sold block falls back to its existing client-formula branch automatically. |
| 2026-09-13 | — | Architecture review, Finding 3 (IMPORTANT): nothing stops the overwrite recurring | A Backfill commit SETs `ActualCostExcludingTax` with no check that the balance already carried a cost from an earlier GD — already corrupted 26 real opening balances (9 on company 5, 17 on company 6), each holding only the last consignment's rate applied to the whole accumulated quantity. | Fixed at PREVIEW time (not blocked — a deliberate re-backfill after a correction is legitimate): a Backfill line matching a balance whose `ActualCostExcludingTax` is already non-zero carries a new `OverwriteWarning` naming the figure that would be replaced, counted in the preview's `OverwriteWarningCount`, and rendered next to the line beside its match note. The 26 already-corrupted balances are NOT touched by this fix — a separate, maintainer-approved data operation. |

| 2026-09-13 | — | Teardown deleted nothing on its first cut | An item type created by a company that has since been DELETED is invisible to every API: visibility is derived from the caller's accessible companies (CLAUDE.md 5b-2b), and an orphan is neither owned by a live company nor an un-adopted tariff placeholder. `GET /itemtypes/paged?search=8481.1000` answered 2 rows for a code holding 9. So the teardown found nothing to clean and left one orphan per run — silently, because the same invisibility hides them from every screen. | Fixed: the teardown now works out what to undo **while the run's companies still exist**, and deletes by id afterwards. Worth knowing generally: orphaned item types accumulate where nobody can see them. |
| 2026-09-13 | all | `ControlType` 19 was two roles at once | `FurtherTaxPayable` and the superseded `CustomerAdvances` were declared as the same C# enum value. On a chart carrying the legacy "Advance from Customers" account, `PostingService.ResolveAsync(FurtherTaxPayable)` could credit further tax — a liability owed to FBR — to a customer-advances liability instead: the entry balances and the balance sheet is wrong, the worst shape a bug takes here. Worse, `FurtherTaxAccountSeeder` read that same row as proof the company already had a further-tax account, so such a chart was never given the real one. | Fixed: `CustomerAdvances` renumbered to 22, with migration `SplitCustomerAdvancesControlType` restamping the legacy rows (keyed on their `seed:customer_advances` external ref — no operator could ever have created one, the Chart of Accounts picker only offered 0-13). The seeder then creates the missing account on next startup. **A company that filed further tax while this was wrong must rebuild its ledger** (Accounting ▸ rebuild) to move the amounts onto the correct account — a journal line references an account by id, so the migration cannot move them. No such row exists on the local importer database; production was checked read-only after deploy. |
| 2026-09-13 | Alpha / AY / PAK | Three live item types carry a test suite's name | `WASHING PARTS 7511AF` (8450.9000), `LED ONE 7511AF` (8513.1090) and `CHILDREN BICYCLE 7511AF` (8712.0000) are HS-tariff placeholders that `test_spreadsheet_import` adopted and renamed — *after* real imports had already filed stock against them. All three companies hold real quantities under them (AY 4,089 units of the first; PAK 2,970 of the second). The `7511AF` suffix is a suite run tag. | **Not renamed — the operator's call.** The lot audit trail (`OpeningStockLots.ItemNameOnSheet`) recovers what the real sheets called them: 8450.9000 is "Washing Machine Parts"; 8513.1090 covers five different rechargeable-light products merged under one code (§5b-3 groups on the HS code by design). Rename them on the Item Catalog screen. The suite can no longer do this again (row above). |

| 2026-09-14 | Alpha / AY / PAK | First real production import of all three sheets | Landed exactly as the local baseline predicted: 26/51/83 lines, 0 skipped, 0 ambiguous, 10 sheet overrides, the worked reference line reproducing 72,905.00 to the paisa. The 173 pre-existing balances' selling value was byte-identical before and after (159,578,674.68), proving Backfill moved no selling figure; the +3,028,198.61 was entirely the 12 balances the import created. All 9 consignments were Backfill, so nothing posted — correct, and deliberate, with the ledger switched ON for all three companies. | No action. Recorded as the production baseline. |
| 2026-09-14 | PAK TRADE CO | RECHARGEABLE PROJECTOR LIGHTS costed at 1,850,278.46 against a 999,924.33 selling value — a −85% margin | The stock sheet merged FOUR products under HS 8513.1090 (torch lights 2,080 @ 172.34, starry projector 325 @ 710.18, warm light 342 @ 714.13, vanity mirror 223 @ 746.28). The costing sheets priced only two of them — 565 units at a pooled 622.99 — and Backfill applied that rate to all 2,970 units, including the 2,080 torch lights worth a third of it. The arithmetic was exactly as designed; the extrapolation was not sound. | **Data corrected 2026-09-14** to 857,078.00 — the 351,989.00 the GDs actually prove for 565 units, plus the remaining 2,405 at 6/7 of their selling value (505,089.00), the same relationship the stock export uses for uncosted stock. Margin now 14.29%. Recorded in the cost history as an `OpeningBalanceEdit` beside the import that caused it. **Prevented going forward** by the cost-plausibility warning (§11). |
| 2026-09-14 | Alpha Traders | SS BALL VALVE costed slightly ABOVE its selling value (ratio 1.011) | Investigated and **left alone**. Of the five catalog items under 8481.1000 only SS BALL VALVE is Alpha's — the rest have no openings, movements or invoice lines there. The balance's own notes name lot `KAPW-HC-8876`, the same GD the costing line came from, so the sheet and the costing sheet are describing one consignment under two labels. A real landed unit cost (2,487.91) on real stock selling at 2,460.20; −1.1% is plausible for a valve line. | None. Changing it would have invented a number over a figure that traces correctly. The new warning does flag it, which is the right outcome: an operator looks, decides, imports. |
| 2026-09-14 | AY TRADERS | GD `KAPE-HC-6575` shows income tax at 20.4% of cost against 5-7% elsewhere | Two lines (rows 41 and 44) hold an income-tax rate of 100%. Their sheet cells hold a bare `1` meaning 1%; `PercentRate` cannot tell a bare 1 from a fraction and reads it as 100%. Eight other lines on the same sheets write 1% correctly as `0.01`. No effect on cost or selling value (income tax is outside both chains) and none on the ledger (Backfill posts nothing) — it would matter only if that GD were re-imported as New Arrivals. | Data left as imported. **Prevented going forward** by the rate warning (§11). |
| 2026-09-14 | — | Hand entry could not record a real GD | The form took exactly ONE line, and committing a second under the same GD number is refused (unique per company, no upsert) — so it only served the rare single-line consignment. | Fixed: hand entry now stages many lines and previews them in one call (§12). |

---

## 18. Build record

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
| 2026-09-13 | Architecture-review fixes (Findings 1-3, §17): Inventory debit made mode-aware so a matched New Arrivals line is no longer excluded; `stock.actualcost.view` enforced server-side across the on-hand grid, the Excel export and the movements drill-down; a Backfill preview against an already-costed balance now warns before overwriting it |
| 2026-09-13 | Task 23 — Import Clearing subledger: `PaymentAllocation.Kind.ImportConsignment` (a Payment debiting Import Clearing, the AP mirror of a purchase-bill allocation); `ImportConsignment.ImportClearingCredited` / `AmountSettled`, the latter recomputed alongside `PurchaseBill.AmountPaid` on every create/update/delete; over-settle and never-posted (Backfill/GL-off) guards; the Consignments screen gained Credited/Settled/Outstanding/Status columns, unpaid-first default order, an only-outstanding filter, a company-wide total, a per-row settlement list, and a Settle action (`SettleConsignmentDialog`, a focused dialog rather than a fourth PaymentForm purpose — see the guide's §7 and the dialog's own doc comment for why); a migration backfills `ImportClearingCredited` for consignments that posted before the column existed |

| 2026-09-13 | Polish round (all six remaining items): a **cost audit trail** (`StockCostChange` + `GET /api/stock/company/{id}/cost-changes`, gated on `stock.actualcost.view`, written by all six paths that move the pool, §10); **per-line GD correction** (`PUT /api/import-consignments/{id}/lines/{lineId}`, mode-aware balance re-derivation, GL re-post, settled-liability floor, §8); **write-off on a GD settlement** (`AllocationKind.ImportConsignment` may now carry an `AdjustmentAmount`, §9); **editing a GD settlement** (PaymentsPage routes Edit to `SettleConsignmentDialog` instead of hiding it); **`ControlType` 19 un-aliased** (`CustomerAdvances` 19 → 22 + migration, §17) and the Chart of Accounts picker widened to the settle-remainder, further-tax and import roles; **`test_spreadsheet_import` given its own teardown** (§17) |

| 2026-09-14 | First production import of all three sheets, then the guards it taught us: a **cost-plausibility warning** comparing a Backfill projection against what the balance's own selling value implies, carrying the coverage and the merged-product count as its explanation (§11); an **implausible-rate warning** at 50% (§11); and **multi-line hand entry** — a staged list previewed in one call, because pooling and matching reason over the set (§12). `ImportCostingCalculator.ExpectedCostFromSelling` runs the chain backwards and is the one place that inversion lives |

Deferred: a screen listing consignments now exists (Consignments, above), and a
single line of a recorded GD can be corrected in place (§8), but an upsert path
for re-importing a whole GD already recorded is still not built.
