"""Compares a consultant's stock sheet with the software's stock at the month end.

    python scripts/stock_sheet_check/compare.py <rows.json> <stock.json> [tolerance]

<rows.json> comes from read_sheet.py and <stock.json> from the reader in this folder.
Prints where the two differ, per HS code, and the usual causes so each difference
can be traced to an invoice. Changes nothing.
"""
import collections
import json
import sys

from sheetlib import gd_key, hs8, num

sheet = json.load(open(sys.argv[1]))
data = json.load(open(sys.argv[2]))
tol = float(sys.argv[3]) if len(sys.argv) > 3 else 5
items, invoices = data["items"], data["invoices"]
print(f"{data['company']} -- {data['month']} -- costing {data['costing']}")

books_value = sum(i["per"]["end"]["value"] for i in items)
books_tax = sum(i["per"]["end"]["value"] * i["per"]["end"]["rate"] / 100 for i in items)
sheet_value = sum(num(r["bv"]) for r in sheet)
print(f"sheet balance {sheet_value:>16,.2f}   sales tax {sum(num(r['btax']) for r in sheet):>14,.2f}")
print(f"books balance {books_value:>16,.2f}   sales tax {books_tax:>14,.2f}")
print(f"books - sheet {books_value - sheet_value:>16,.2f}")

sh = collections.defaultdict(lambda: {"q": 0.0, "v": 0.0, "c": 0.0, "names": set(), "rows": []})
for r in sheet:
    s = sh[r["hs"]]
    s["q"] += num(r["bq"]); s["v"] += num(r["bv"]); s["c"] += num(r["cv"]); s["names"].add(r["item"][:24]); s["rows"].append(r)
bk = collections.defaultdict(lambda: {"q": 0.0, "v": 0.0, "items": []})
for i in items:
    p = i["per"]["end"]
    if abs(p["qty"]) > 1e-6 or abs(p["value"]) > 0.005:
        b = bk[hs8(i["hs"])]
        b["q"] += p["qty"]; b["v"] += p["value"]; b["items"].append(i)
sales = collections.defaultdict(lambda: {"amount": 0.0, "cost": 0.0, "inv": set()})
lines = []
for inv in invoices:
    if inv["documentType"] in (9, 10) or inv["demo"]:
        continue
    for x in inv["lines"]:
        if x["keptInStock"] or not x["itemTypeId"]:
            continue
        s = sales[hs8(x["hs"])]
        s["amount"] += x["amount"]; s["cost"] += x["costOut"]; s["inv"].add(inv["number"])
        lines.append((inv, x))

print(f"\nPER HS CODE (value difference over {tol:g})")
print(f"{'HS':<10}{'item':<26}{'sheet':>14}{'books':>14}{'diff':>13} |{'sheet consumed':>15}{'invoices':>13}{'cost out':>13}  invoice nos.")
listed = rest = 0.0
for k in sorted(set(sh) | set(bk)):
    d = bk[k]["v"] - sh[k]["v"]
    if abs(d) <= tol:
        rest += d
        continue
    listed += d
    name = "/".join(sorted(sh[k]["names"])) or "/".join(i["name"][:24] for i in bk[k]["items"])
    print(f"{k:<10}{name[:25]:<26}{sh[k]['v']:>14,.2f}{bk[k]['v']:>14,.2f}{d:>13,.2f} |{sh[k]['c']:>15,.2f}{sales[k]['amount']:>13,.2f}{sales[k]['cost']:>13,.2f}  {sorted(sales[k]['inv'])}")
print(f"listed {listed:,.2f}; the rest (each within {tol:g}) {rest:,.2f}")

print("\nINVOICE LINES WHOSE STOCK COST IS FAR FROM THE AMOUNT BILLED (over 2% and over 100)")
found = False
for inv, x in sorted(lines, key=lambda t: -abs(t[1]["costOut"] - t[1]["amount"])):
    gap = x["costOut"] - x["amount"]
    if abs(gap) > 100 and abs(gap) > 0.02 * max(x["amount"], 1):
        found = True
        how = "priced from its amount" if x["stockQuantity"] is not None else "quantity typed by hand, or priced before stock quantities existed"
        print(f"  invoice {inv['number']} {inv['date'][:10]} fbr '{inv['fbr'] or 'not filed'}' HS {hs8(x['hs'])} {str(x['description'])[:24]}: "
              f"billed {x['quantity']:,.4f} {x['uom']} = {x['amount']:,.2f}; {x['leftStock']:,.4f} left stock costing {x['costOut']:,.2f}; gap {gap:,.2f} ({how})")
if not found:
    print("  none")

print("\nCONSUMED ON THE SHEET AGAINST INVOICES, PER HS CODE (difference over 1)")
for k in sorted(set(sh) | set(sales)):
    d = sales[k]["amount"] - sh[k]["c"]
    if abs(d) > 1:
        print(f"  {k}: sheet {sh[k]['c']:>14,.2f}  invoices {sales[k]['amount']:>14,.2f}  diff {d:>12,.2f}  invoices {sorted(sales[k]['inv'])}")
print("  (two HS codes with equal and opposite differences usually mean one invoice is on the wrong item)")

print("\nHS CODES WHERE THE BOOKS HOLD MORE THAN ONE ITEM (the plan matches sheet rows to them by name)")
for k in sorted(bk):
    if len(bk[k]["items"]) > 1:
        print(f"  {k}")
        for i in bk[k]["items"]:
            p = i["per"]["end"]
            print(f"      books: {i['name'][:44]:<44} qty {p['qty']:>12,.4f} value {p['value']:>14,.2f}")
        for r in sh[k]["rows"]:
            print(f"      sheet row {r['row']}: {r['item'][:38]:<38} qty {num(r['bq']):>12,.4f} value {num(r['bv']):>14,.2f}")

print("\nPART-SOLD LINES WHOSE QUANTITY THE SHEET DID NOT REDUCE (books hold less on the same GD)")
for k in sorted(sh):
    if len(bk[k]["items"]) != 1:
        continue
    held = collections.defaultdict(float)
    for p in bk[k]["items"][0]["per"]["end"]["pools"]:
        held[gd_key(p["gd"])] += p["q"]
    for r in sh[k]["rows"]:
        if num(r["bv"]) >= 1 and num(r["bq"]) - held[gd_key(r["gd"])] > 0.5:
            print(f"  row {r['row']} HS {k} GD {r['gd']} {r['item'][:30]}: sheet {num(r['bq']):,.4f}, books {held[gd_key(r['gd'])]:,.4f}")
