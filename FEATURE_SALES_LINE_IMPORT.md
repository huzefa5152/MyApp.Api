# Sales Detail line-item import — plan (verified against real data 2026-09-04)

## What is missing today
598 ledger-imported invoices in company 451. ALL of them:
  - Subtotal = the GROSS total, GSTRate = 0, WithholdingTaxAmount = 0
  - ZERO InvoiceItems
The ledger import only ever had a per-document total, so the tax split and the
item detail were never in the database. That is why the Sales Detail report
cannot reproduce Book100.xlsx. The fix is to load the detail, not to change
the report.

## Sheet shape (Book100.xlsx, sheet "Sales Detail", header row 1, 24 cols A..X)
S. No | Date | Month | DC | DC No:- | DC # | R | No | Inv # | Party Name |
Address | Ntn | HS CODE | Description | U | Qty | Rate | Excl | Tax Rate |
S.Tax | Incl | 236-G Tax | Further Tax | Total Amt

Notes from the 3 real rows:
  - `Inv #` = `R` + `No`  (e.g. "AA-" + 1 = "AA-1")
  - `DC #`  = `DC` + `DC No:-`
  - `HS CODE` carries a trailing ":-"  → "7314.3900:-"  (strip it)
  - `Tax Rate` is a FRACTION (0.18), not a percent
  - `Qty`/`Rate` are back-derived from `Excl` and carry 12 dp
    (597.487035209237 x 549.802724815545 = 328500). decimal(28,12) holds
    them exactly — import verbatim, do NOT round, do NOT apply the
    line-total whole-quantity rule (that rule is for operator entry).
  - `236-G Tax` rate varies: 0.1% on registered (387.63/387630),
    2% on unregistered (939.60/46980)
  - Last row of the sheet is a TOTALS row: only Excl / S.Tax / Incl are
    populated, every identity column is null. Skip rows with a null `Inv #`.

## Matching — already solved, no fuzzy logic needed
The ledger import wrote `Invoice.ExternalRef = "ledger-inv:{companyId}:{Inv #}"`.
The sheet's `Inv #` is the same token. Direct lookup.

Verified three-way against the DB:
  AA-1  -> Id 6898  2025-07-01  Rh Enterprises     GrandTotal 388017.63  (sheet Total Amt 388017.63)
  AA-2  -> Id 6899  2025-07-01  Pakistan Hardware  GrandTotal 185209.02  (sheet 185209.024)
  AA-3  -> Id 6900  2025-07-01  Unregister Sales   GrandTotal  47919.60  (sheet 47919.6)
Date, client and grand total all agree. Tolerance 0.01 (sheet carries 3 dp
on 236-G, the DB stores money at 2 dp).

## What the import does per invoice
Group sheet rows by `Inv #`, in sheet order.

1. Look up ExternalRef. No hit -> UNMATCHED bucket, nothing written.
2. Reconcile: SUM(Total Amt) over the group vs stored GrandTotal, +/-0.01.
   Mismatch -> CONFLICT bucket, nothing written. GrandTotal is the one
   number the ledger import got right; it is the anchor.
3. REPLACE the invoice's InvoiceItems (delete all, insert the group).
   Replace, not append, so a re-run is idempotent and cannot duplicate.
   There are zero lines today, so the first run is purely additive.
4. Per line: HSCode (":-" stripped), Description, UOM = `U`,
   Quantity = `Qty`, UnitPrice = `Rate`, LineTotal = `Excl`,
   ItemTypeId = NULL.
5. Restate the header from the lines:
   Subtotal = SUM(Excl), GSTRate = `Tax Rate` * 100,
   WithholdingTaxAmount = SUM(236-G Tax), FurtherTax = SUM(Further Tax).
   GrandTotal is NOT recomputed — it is asserted (step 2).

## ItemTypeId stays NULL — deliberate, and it is what protects inventory
StockService writes StockMovement with a non-nullable ItemTypeId, so a line
with no ItemTypeId records no movement. These are historical sales whose
stock was already accounted for by the opening-stock import; classifying
them would drive 598 invoices' worth of phantom OUT movements. Same
behaviour the codebase already relies on ("a bill created against a no-HS
item records no IN", CLAUDE.md).

## Where it plugs in
The module is already built for this. Add:
  - ImportKinds.SalesLineDetail            (Models/ImportProfile.cs)
  - ImportLayouts.FlatLineRows, allowed for that kind
  - Services/Implementations/SalesLineImportService.cs   (parse -> preview)
  - ...SalesLineImportService.Commit.cs                  (replace lines + restate header)
  - Controllers/SalesLineImportController.cs             (preview/commit, [HasPermission], _access.AssertAccessAsync)
  - a default profile in Helpers/DefaultImportLayouts.cs so an unrecognised
    workbook still starts from a described layout
  - frontend screen modelled on the customer-ledger import preview

## Assumptions applied (say if any is wrong)
  - Unmatched `Inv #` is REPORTED, never created. "Don't create duplicate
    entries" reads as: touch only what is already there.
  - Mixed `Tax Rate` within one `Inv #` -> CONFLICT, skipped. Invoice.GSTRate
    is a single header field and cannot hold two rates honestly.
  - Receipts are not in this sheet (no receipt columns), so nothing about
    receipts changes. If receipt detail is coming, it is a second sheet
    shape and a second profile.
  - InvoiceNumber stays in the migrated 900001+ band. Untouched.
  - `DC #` is captured but not linked to DeliveryChallans in v1.

## Test plan
  - offline fixture harness over Book100.xlsx (3 rows + totals row)
  - a fuller run against tomorrow's file on the local MyApp_ImporterLedger DB
  - re-run the same file twice: line count must not change (idempotence)
  - after commit: the Sales Detail report reproduces the sheet column-for-column
  - python scripts/test_stock_itemtype_reflow.py must stay green: the import
    must move no stock
