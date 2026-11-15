"""Reads a consultant's stock sheet and says what in it will stop a reconcile.

    python scripts/stock_sheet_check/read_sheet.py <sheet.xlsx> <rows.json>

Writes the rows as JSON for compare.py and prints the totals and the rows that need
attention. Changes nothing. Put a downloaded sheet in its own empty folder and pass
the path; do not run Python from inside that folder.
"""
import collections
import json
import sys

from sheetlib import Sheet, num

path, out = sys.argv[1], sys.argv[2]
sheet = Sheet(path)
rows = sheet.records()
json.dump(rows, open(out, "w"), default=str)

print(f"heading row {sheet.header_row}; {len(rows)} GD rows")
print(f"opening {sum(num(r['ov']) for r in rows):,.2f} | consumed {sum(num(r['cv']) for r in rows):,.2f} | "
      f"balance {sum(num(r['bv']) for r in rows):,.2f} | sales tax on balance {sum(num(r['btax']) for r in rows):,.2f}")

blank = [r for r in rows if not r["item"]]
if blank:
    print(f"\nNO DESCRIPTION -- the software skips these rows ({sum(num(r['bv']) for r in blank):,.2f} of stock):")
    for r in blank:
        print(f"  row {r['row']} GD {r['gd']} HS {r['hs']} balance {num(r['bv']):,.2f}")

negative = [r for r in rows if num(r["bv"]) < 0]
if negative:
    print(f"\nNEGATIVE BALANCE -- more was deducted than the row held ({sum(num(r['bv']) for r in negative):,.2f}):")
    for r in negative:
        print(f"  row {r['row']} GD {r['gd']} HS {r['hs']} {r['item'][:34]} balance {num(r['bv']):,.2f}")

by_hs = collections.defaultdict(list)
for r in rows:
    by_hs[r["hs"]].append(r)
refused = {k: v for k, v in by_hs.items() if sum(num(r["bq"]) for r in v) <= 0}
if refused:
    print("\nCLOSING QUANTITY ZERO OR BELOW -- the software refuses the whole sheet while any item is like this:")
    for k, v in sorted(refused.items()):
        print(f"  HS {k}: rows {[r['row'] for r in v]} quantity {sum(num(r['bq']) for r in v):,.4f} value {sum(num(r['bv']) for r in v):,.2f}")

sold_out = [r for r in rows if 0 <= num(r["bv"]) < 1 and num(r["bq"]) >= 1]
if sold_out:
    print("\nSOLD OUT BUT THE QUANTITY IS STILL THERE -- the plan will offer to add these back:")
    for r in sold_out:
        print(f"  row {r['row']} GD {r['gd']} HS {r['hs']} {r['item'][:34]} quantity {num(r['bq']):,.2f} value {num(r['bv']):,.2f}")

crumbs = [r for r in rows if 0 < num(r["bq"]) < 1 and num(r["bv"]) >= 1]
if crumbs:
    print("\nLEFTOVERS UNDER ONE UNIT:")
    for r in crumbs:
        print(f"  row {r['row']} GD {r['gd']} HS {r['hs']} {r['item'][:34]} quantity {num(r['bq']):,.4f} value {num(r['bv']):,.2f}")
