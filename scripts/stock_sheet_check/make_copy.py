"""Makes the copy of a consultant's stock sheet that the Reconcile screen can read.

    python scripts/stock_sheet_check/make_copy.py <sheet.xlsx> <copy.xlsx> <stock.json> [options]

The consultant's file is never edited. The copy holds VALUES only (no formulas) and
differs from the original only in the ways listed below, each of which is printed:

  always         removes the sheet's own totals and notes under the data
  always         removes rows that are sold out (balance value under 1, including
                 the negative ones) -- the books hold none of them
  always         removes leftovers under one unit on a GD the books hold nothing of
  always         where a part-sold line still shows its full quantity, sets it to
                 what the books hold on the same GD line (values are never changed);
                 only where the HS code is one item in the books and each GD has one row
  --fill R=NAME  gives row R the description NAME (a row with none is skipped by
                 the reader). R is the row number in the ORIGINAL sheet.
  --split R=NAME:QTY:VALUE,NAME:QTY:VALUE
                 replaces row R with one row per item, when the books hold two items
                 on a line the sheet shows once. The values must add up to the row's.
  --keep-qty HS  leaves that HS code's quantities as the sheet has them, for a line
                 whose COUNT is the thing being corrected (repeatable)

<stock.json> is the reader's output for the same month. Row numbers in the options
are the original sheet's; give every option before anything is removed.
"""
import collections
import copy
import json
import sys

from sheetlib import Sheet, gd_key, hs8, num

src, dst, stock = sys.argv[1:4]
fills, splits, keep_qty = {}, {}, set()
args = sys.argv[4:]
while args:
    opt, val = args[0], args[1]
    args = args[2:]
    if opt == "--fill":
        r, name = val.split("=", 1)
        fills[int(r)] = name
    elif opt == "--split":
        r, parts = val.split("=", 1)
        splits[int(r)] = [(n, float(q), float(v)) for n, q, v in (p.split(":") for p in parts.split(","))]
    elif opt == "--keep-qty":
        keep_qty.add(val)
    else:
        raise SystemExit(f"unknown option {opt}")

sheet = Sheet(src)
ws = sheet.ws
rows = sheet.data_rows()
before = sum(num(sheet.cell(r, "bv").value) for r in rows)

held = collections.defaultdict(lambda: collections.defaultdict(float))
item_count, total = collections.Counter(), collections.Counter()
for i in json.load(open(stock))["items"]:
    p = i["per"]["end"]
    if p["qty"] > 1e-6:
        k = hs8(i["hs"])
        item_count[k] += 1
        total[k] += p["qty"]
        for q in p["pools"]:
            if q["q"] > 1e-9:
                held[k][gd_key(q["gd"])] += q["q"]

for r, name in fills.items():
    print(f"description on row {r}: \"{name}\"  (balance {num(sheet.cell(r, 'bv').value):,.2f})")
    sheet.cell(r, "item").value = name

rec = {r: sheet.record(r) for r in rows}
drop = [r for r in rows if num(rec[r]["bv"]) < 1 and r not in splits]
for r in drop:
    print(f"remove sold-out row {r}: HS {rec[r]['hs']} GD {rec[r]['gd']} {rec[r]['item'][:30]} balance {num(rec[r]['bv']):,.2f}")

by_hs = collections.defaultdict(list)
for r in rows:
    if r not in drop and r not in splits:
        by_hs[rec[r]["hs"]].append(r)
for k, rs in sorted(by_hs.items()):
    if k in keep_qty or item_count[k] != 1:
        continue
    left = [r for r in rs if num(rec[r]["bq"]) < 1 and held[k][gd_key(rec[r]["gd"])] < 1e-9]
    for r in left:
        print(f"remove leftover row {r}: HS {k} GD {rec[r]['gd']} {rec[r]['item'][:30]} quantity {num(rec[r]['bq']):.4f} balance {num(rec[r]['bv']):,.2f}")
    drop += left
    keep = [r for r in rs if r not in left]
    if abs(sum(num(rec[r]["bq"]) for r in keep) - total[k]) < 1e-4:
        continue
    by_gd = collections.defaultdict(list)
    for r in keep:
        by_gd[gd_key(rec[r]["gd"])].append(r)
    one_row_each = all(len(v) == 1 for v in by_gd.values())
    all_held = all(held[k][g] > 1e-9 for g in by_gd)
    if one_row_each and all_held and abs(sum(held[k][g] for g in by_gd) - total[k]) < 1e-4:
        for g, (r,) in by_gd.items():
            new = round(held[k][g], 4)
            if abs(num(rec[r]["bq"]) - new) > 1e-4:
                print(f"quantity on row {r}: HS {k} GD {rec[r]['gd']} {rec[r]['item'][:26]} {num(rec[r]['bq']):,.4f} -> {new:,.4f}")
                sheet.cell(r, "bq").value = new
    else:
        print(f"quantities left as the sheet has them for HS {k}: sheet {sum(num(rec[r]['bq']) for r in keep):,.4f}, books {total[k]:,.4f}")

# Structural edits from the bottom up, so earlier row numbers stay valid.
last = max(rows)
if ws.max_row > last:
    ws.delete_rows(last + 1, ws.max_row - last)
for r in sorted(set(drop) | set(splits), reverse=True):
    if r in splits:
        parts = splits[r]
        if abs(sum(v for _, _, v in parts) - num(rec[r]["bv"])) > 0.01:
            raise SystemExit(f"--split {r}: the parts add up to {sum(v for _, _, v in parts):,.2f}, the row holds {num(rec[r]['bv']):,.2f}")
        rate = num(sheet.cell(r, "rate").value)
        ws.insert_rows(r + 1, len(parts) - 1)
        for n in range(1, len(parts)):
            for c in range(1, ws.max_column + 1):
                a, b = ws.cell(r, c), ws.cell(r + n, c)
                b.value = a.value
                if a.has_style:
                    b._style = copy.copy(a._style)
        for n, (name, q, v) in enumerate(parts):
            sheet.cell(r + n, "item").value = name
            sheet.cell(r + n, "bq").value = q
            sheet.cell(r + n, "bv").value = round(v, 2)
            sheet.cell(r + n, "btax").value = round(v * rate, 2)
            print(f"row {r} split: \"{name}\" quantity {q:,.4f} value {v:,.2f}")
    else:
        ws.delete_rows(r)

sheet.wb.save(dst)
check = Sheet(dst)
final = check.records()
blank = [r["row"] for r in final if not r["item"]]
print(f"\noriginal: {len(rows)} rows, balance {before:,.2f}")
print(f"copy:     {len(final)} rows, balance {sum(num(r['bv']) for r in final):,.2f}")
if blank:
    print(f"STILL WITHOUT A DESCRIPTION in the copy (rows {blank}) -- use --fill with the ORIGINAL row numbers")
