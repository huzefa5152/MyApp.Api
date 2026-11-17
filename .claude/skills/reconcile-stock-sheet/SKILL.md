---
name: reconcile-stock-sheet
description: Use when an importer's stock in the software does not match the consultant's monthly GD stock sheet - "stock is not matching", "difference from the consultant's sheet", "software stock vs my book", "reconcile the stock sheet", "match inventory with the sheet", or a stock sheet .xlsx is handed over with a difference figure. Finds the cause of the difference invoice by invoice with read-only tools, corrects the invoices that caused it, and runs Reconcile to stock sheet safely. Importer line only.
---

# Reconcile the books to a consultant's stock sheet

Project-local to **MyApp.Api**, branch `feat/importer-ledger-receipts` (the importer
installation). Read `CLAUDE.md` sections 5b-17 (FIFO by GD, Reconcile) and 5b-23
(stock quantity on amount-priced lines) first.

## How the two books differ

| | Consultant's sheet | Software |
|---|---|---|
| What a sale removes | the invoice **amount** | the FIFO **cost** of the quantity that left |
| Quantity | usually worked out as value / price, and often **not reduced** when a line is sold | counted; an invoice takes it out |
| One row is | a product on a GD | a GD line of an **item**; several products under one HS code can share an item |

So the two agree while every sale leaves stock at about what it was billed for, and
drift when it does not. Every invoice entered after 17 Nov 2026 takes its AMOUNT out
(CLAUDE.md 5b-24), so for those the two can only differ by an invoice on the
wrong item, a sheet slip, or which GD row the consultant drew from (per-HS
totals agree). The difference is almost never spread thinly: one or two
invoices explain nearly all of it. Find them before touching anything.

## Rules

1. **Diagnose read-only first.** Nothing in steps 1-3 writes anywhere.
2. **Never write production SQL.** Fixes go through the app (screen, API or MCP) so
   the stock walk, the ledger and the audit trail move together.
3. **Never type a production password.** The operator signs in to the importer
   site in the browser pane; you work in that session.
4. **Do not reconcile to a sheet you have not checked.** Reconcile makes the books
   hold the sheet. A sheet with a blank description, a negative row or an
   un-reduced quantity will write stock off or add sold stock back.
5. **Read the plan's three figures before pressing Reconcile** (step 5). If "After
   reconcile" is not what you worked out, stop.
6. **Never edit the consultant's file.** Work from a copy and say what the copy
   changes.
7. **Customer figures stay out of the repository** (it is public): no sheet, no
   output of these tools, no company's numbers in a commit.
8. Deleting an invoice, changing a filed invoice, or anything the maintainer has
   not asked for needs their yes.

## Step 1 - Read the sheet

Copy the sheet into its own empty folder in the scratchpad (never run Python from
inside it) and run:

```bash
python scripts/stock_sheet_check/read_sheet.py <sheet.xlsx> <scratch>/rows.json
```

It prints the totals and the rows that will stop a reconcile:

| It reports | What it means |
|---|---|
| No description | The reader skips the row; its whole value would be written off |
| Negative balance | More was deducted than the row held (usually a rounded-up amount, sometimes a typing slip) |
| Closing quantity zero or below | The Reconcile screen refuses the **whole sheet** while any item is like this |
| Sold out but the quantity is still there | The plan will offer to add that quantity back |
| Leftovers under one unit | Crumbs; the plan cannot place them on a GD the books hold nothing of |

The sheet often carries its own note at the bottom ("Software / My Book /
Difference"). Compare it with what you compute; the consultant's "software" figure
may be days old.

## Step 2 - Read the software's stock (read-only)

```bash
dotnet build MyApp.Api.csproj
```

```bash
cd scripts/stock_sheet_check && dotnet run -c Release -- "<part of the company name>" <yyyy-MM> <scratch>/stock.json
```

It runs the shipped FIFO walk over production with `SELECT` only and prints the
stock value at the start of the month, at its end and now. Add `--local` to read
the branch's local database instead. If the walk is running while invoices for the
month are still being typed, "end" and "now" keep changing: note the time.

## Step 3 - Compare, and find the cause

```bash
python scripts/stock_sheet_check/compare.py <scratch>/rows.json <scratch>/stock.json
```

Read its sections in this order. Each difference should land under one cause:

| What you see | Cause | Fix |
|---|---|---|
| An invoice line whose stock cost is far above its amount; the item is now empty or far lower than the sheet | A small amount was billed against costly units, or the quantity was typed by hand to clear the item (often **several products share one item** and FIFO took the cheaper or claimed GD first) | Correct the invoice line (step 4). Do not adjust stock. |
| Two HS codes off by equal and opposite amounts | One invoice is billed on the wrong item | Move the invoice line to the right item (step 4) |
| Sheet "consumed" on an HS code differs from the invoices by the size of an invoice | An invoice is missing on one side | Ask the maintainer which is right; enter or delete it |
| Sheet "consumed" is a round figure slightly above the row's value, balance slightly negative | The consultant deducted a rounded amount | Sheet-side; tell the consultant |
| One row deducted by a figure a digit off (a round thousand) | Typing slip on the sheet | Sheet-side; tell the consultant |
| Values agree, quantities do not | Sheet quantity is derived or was never reduced | Leave the books' quantity; never "correct" it to the sheet |
| The books hold more than one item under an HS code and the sheet shows one row | The plan will match the row to one item and leave the other on top (double count) | Split the row in the copy (step 5) |
| Several products with very different unit costs sit under one item | The opening import groups rows on the HS code | Correct the invoices as above; ask the maintainer whether the item should be split (Stock screen) so it cannot recur |
| Small differences on many lines, a few hundred rupees in total | Whole-unit rounding on invoices priced before stock quantities existed | The reconcile closes it |

`GET /api/stock/company/{id}/bill-cost-check` (MCP `check_bill_stock_cost`) gives the
first row of this table directly, from inside the app.

Tell the maintainer the cause and the figures before changing anything.

## Step 4 - Correct the invoices that caused it

Only invoices not yet filed with FBR can be edited. On the Invoices screen:

- **A line that took out far more than it billed:** re-enter its **Line Total**. The
  quantity is then worked out from stock and stock gives up what the amount buys.
  If the item has no stock left (this invoice took the last of it), the amount
  cannot price it: type the quantity the amount buys and let the rate follow, or
  delete and re-enter the invoice.
- **A line on the wrong item:** pick the right item, then change the quantity and
  re-enter the Line Total so the quantity is worked out from that item's stock.
  (Typing the same amount over itself does nothing; change the quantity first.)
- Invoice totals must not move. Check the grand total before saving.

Then run steps 2 and 3 again. The remaining difference should now be small and
entirely explainable.

## Step 5 - Reconcile

The consultant's sheet is rarely fit to reconcile to as it stands. Make the copy:

```bash
python scripts/stock_sheet_check/make_copy.py <sheet.xlsx> <copy.xlsx> <scratch>/stock.json [--fill R=NAME] [--split R=NAME:QTY:VALUE,NAME:QTY:VALUE] [--keep-qty HS]
```

It removes sold-out and leftover rows, sets un-reduced quantities to what the books
hold on the same GD line, and prints every change. Values are never changed.
`--fill` names a row that has no description (use the item's name in the books),
`--split` replaces one row by one row per book item, and `--keep-qty` leaves an HS
code's quantity as the sheet has it when the **count** is what is being corrected.
Save the copy where the operator can find it (their Downloads folder).

On Stock -> Reconcile to my stock sheet (`/stock/reconcile`), with the company and
the sheet's month chosen, the operator picks the copy; the browser tools cannot
choose a file. Then read the plan:

| Figure | Must be |
|---|---|
| Rows read | Every row of the copy. Fewer means rows were skipped. |
| Sheet total | The copy's balance, to the paisa |
| After reconcile | Sheet total, less the rows listed under "Left as they are", plus what the books hold that is "not on the sheet; not touched" |

- **Untick every quantity correction** unless the maintainer has confirmed that
  count is really wrong in the books. "Suggested: a counted figure" only means the
  number is whole.
- "Decide every highlighted row and item" means an item has an error. The text of
  the item says which; it is usually a leftover row or an un-reduced quantity the
  copy still carries.
- If the screen says rows cannot be imported without saying which, the reason is in
  the preview's response: items whose closing quantity is zero or below.
- A quantity correction that corrects an earlier count posts as "correct earlier
  counts (equity)", not as a loss.
- The confirmation dialog repeats the two values. Reconcile is all or nothing.

## Step 6 - Verify, and say what is left

Run steps 2 and 3 again against the consultant's **original** sheet. Every item the
sheet carries should match line by line; what remains must be on the sheet's side
(negative rows, leftovers, a slip) and should be listed for the consultant with row
numbers. Say plainly what was not checked (the ledger tie-out: MCP
`get_stock_tie_out`, or Purchases -> Import Tax Desk).

## For the consultant

Ask for these every month, because each one blocks or distorts the reconcile:
a description on every row; no negative balances; quantity reduced when a line is
sold; one row per product, including two products under one HS code on one GD; and
the claim month filled in where a GD has been claimed.
