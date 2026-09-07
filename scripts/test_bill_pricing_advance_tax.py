#!/usr/bin/env python3
"""
Bill line pricing from stock value, and advance income tax (236G / 236H).

Two features, both on the bill paths, verified for BOTH bill flows:

  A. Line total -> quantity. The operator knows the amount they are billing,
     not the unit count. The unit price is the stock's weighted-average cost
     (value excluding tax / quantity) read from the ONE valuation walk in
     Helpers/StockValuation -- so:

         UnitPrice = stock value excluding tax / stock quantity
         Quantity  = line total / UnitPrice

     Edge cases: nothing on hand, stock with no value, a line total larger
     than the stock is worth, and fractional units.

  B. Advance tax collected from the buyer, charged on the total INCLUDING
     sales tax and ADDED to what is collectible:

         236G  0.1% active   2.0% non-active
         236H  0.5% active   2.5% non-active

     100,000 + 18,000 sales tax = 118,000, and 236G active collects 118.
     GrandTotal, GSTAmount and the FBR payload must not move.

Usage:
    python scripts/test_bill_pricing_advance_tax.py [--base URL] [--keep]
"""

import argparse
import math
import sys
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("requests is required:  pip install requests")
    sys.exit(2)

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

results = []
CENT = 0.005


def check(name, ok, detail=""):
    results.append((ok, name, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" -- {detail}"))
    return ok


def near(a, b, tol=CENT):
    return abs(float(a or 0) - float(b or 0)) <= tol


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    api = args.base.rstrip("/") + "/api"
    r = requests.post(f"{api}/auth/login", timeout=60,
                      json={"username": args.username, "password": args.password})
    if not r.ok:
        print(f"FATAL: login failed ({r.status_code})")
        return 2
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    tag = datetime.now().strftime("%m%d%H%M%S")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

    cid = requests.post(f"{api}/companies", headers=h, timeout=60, json={
        "name": f"_bill_pricing {tag}", "brandName": "BPT",
        "fullAddress": "1 Test Street", "phone": "021-0000000", "ntn": "1234567-8",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
        "fbrEnabled": False, "inventoryTrackingEnabled": True, "enableGl": False,
    }).json()["id"]
    print(f"\ncompany {cid}")
    requests.post(f"{api}/accounts/company/{cid}/seed-wholesale", headers=h, timeout=180)
    requests.post(f"{api}/stock/company/{cid}/flow-version", headers=h, timeout=60,
                  json={"version": 2})
    client = requests.post(f"{api}/clients", headers=h, timeout=60, json={
        "name": f"Pricing Client {tag}", "address": "1 Road", "phone": "021-1",
        "companyId": cid, "registrationType": "Unregistered"}).json()

    def make_item(name, uom="Pcs", hs=None):
        body = {"name": name, "uom": uom, "companyId": cid, "isFavorite": True}
        if hs:
            body["hsCode"] = hs
        rr = requests.post(f"{api}/itemtypes", headers=h, timeout=60,
                           params={"companyId": cid}, json=body)
        return rr.json()["id"] if rr.ok else None

    def set_stock(item_id, qty, value, rate=18):
        return requests.post(f"{api}/stock/opening", headers=h, timeout=60, json={
            "companyId": cid, "itemTypeId": item_id, "quantity": qty,
            "valueExcludingTax": value, "salesTaxRate": rate,
            "asOfDate": "2026-07-01", "notes": "pricing test"})

    def pricing(ids):
        rr = requests.get(f"{api}/invoices/company/{cid}/stock-pricing", headers=h,
                          timeout=120, params={"itemTypeIds": ",".join(str(i) for i in ids)})
        return {x["itemTypeId"]: x for x in rr.json()} if rr.ok else {}

    try:
        # ── A. Pricing a line from what the stock is worth ─────────────────
        print("\n-- A. Line total -> quantity --")
        # The requirement's own table.
        a = make_item(f"Priced A {tag}")
        b = make_item(f"Priced B {tag}")
        c = make_item(f"Priced C {tag}")
        set_stock(a, 10, 1000)
        set_stock(b, 20, 5000)
        set_stock(c, 50, 10000)
        p = pricing([a, b, c])
        for item, qty, val, want in ((a, 10, 1000, 100), (b, 20, 5000, 250), (c, 50, 10000, 200)):
            row = p.get(item, {})
            check(f"stock {qty} worth {val} prices at {want}",
                  row.get("canPrice") and near(row.get("unitCost"), want, 0.0001),
                  f"unitCost={row.get('unitCost')}")

        # A line total of 1,000 against each -> 10, 4 and 5 units.
        for item, want_qty in ((a, 10), (b, 4), (c, 5)):
            unit = float(p[item]["unitCost"])
            check(f"a line total of 1,000 becomes {want_qty} units",
                  near(1000 / unit, want_qty, 0.0001), f"got {1000 / unit}")

        # The derived line really does bill for what was typed.
        unit_a = float(p[a]["unitCost"])
        inv = requests.post(f"{api}/invoices/standalone", headers=h, timeout=120, json={
            "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 18,
            "items": [{"description": f"Priced A {tag}", "itemTypeId": a,
                       "quantity": 500 / unit_a, "uom": "Pcs", "unitPrice": unit_a}]})
        check("a bill built from the derived quantity totals what was entered",
              inv.ok and near(inv.json().get("subtotal"), 500, 0.02),
              f"subtotal={inv.json().get('subtotal') if inv.ok else inv.text[:120]}")

        # ── The entered amount is the source of truth ─────────────────────
        #
        # The quantity derived from an amount is ALWAYS a whole number, whatever
        # the unit allows, and the rate absorbs the rounding so the line comes to
        # exactly the amount that was typed. Before this, a decimal-capable unit
        # kept a fractional quantity (2.5) and the amount was re-snapped to
        # quantity x rate, so the operator's own figure could move.
        #
        # This mirrors the arithmetic the form does, then proves the SERVER
        # stores a line worth exactly the entered amount -- the server always
        # recomputes LineTotal = Quantity x UnitPrice into decimal(18,2), so a
        # 12-decimal rate is what makes it land exactly.
        print("\n-- A. The entered amount is authoritative --")

        def js_round(x):
            """JavaScript's Math.round: HALF UP, always.

            Python's round() is banker's rounding, so round(2.5) is 2 while
            Math.round(2.5) is 3. The form runs in the browser, so a mirror that
            used Python's rule would disagree with the shipped behaviour on
            exactly the .5 cases this feature is about (100 at a cost of 40 is
            2.5 units, and the requirement says that becomes 3).
            """
            return math.floor(x + 0.5)

        def derive(total, unit_cost):
            """What the form does: whole quantity, 12dp rate."""
            qty = max(1, js_round(total / unit_cost))
            rate = round(total / qty, 12)
            return qty, rate

        # A decimal-capable unit must behave the same as a whole-unit one.
        dec_uom = next((u["name"] for u in requests.get(f"{api}/units", headers=h, timeout=60).json()
                        if u.get("allowsDecimalQuantity")), None)

        # The requirement's worked examples: (line total, unit cost, wanted qty,
        # wanted rate). Each is a case where the old rule kept a fraction.
        cases = [
            (100.0,   40.0,  3, 100.0 / 3),      # 2.5  -> 3  @ 33.333333333333
            (500.0,   119.05, 4, 125.0),         # 4.2  -> 4  @ 125
            (1000.0,  270.0,  4, 250.0),         # 3.7  -> 4  @ 250
        ]
        for total, cost, want_qty, want_rate in cases:
            qty, rate = derive(total, cost)
            check(f"{total:,.0f} at a cost of {cost} gives {want_qty} units",
                  qty == want_qty, f"got {qty}")
            check(f"  and a rate of {want_rate:.6f}", near(rate, want_rate, 1e-9),
                  f"got {rate}")
            check(f"  and quantity x rate comes back to {total:,.2f}",
                  near(round(qty * rate, 2), total, 0.005),
                  f"got {round(qty * rate, 2)}")

        # Now through the API, on a unit that ALLOWS decimals -- the UOM must not
        # change the outcome.
        auth = make_item(f"Authoritative {tag}", uom=dec_uom or "Pcs")
        set_stock(auth, 100, 4000)                      # 40.00 each
        for total, want_qty in ((100.0, 3), (500.0, 13), (1000.0, 25)):
            qty, rate = derive(total, 40.0)
            check(f"{total:,.0f} on a '{dec_uom or 'Pcs'}' line still gives a whole {want_qty}",
                  qty == want_qty, f"got {qty}")
            rr = requests.post(f"{api}/invoices/standalone", headers=h, timeout=120, json={
                "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 0,
                "items": [{"description": f"Authoritative {tag}", "itemTypeId": auth,
                           "quantity": qty, "uom": dec_uom or "Pcs", "unitPrice": rate}]})
            j = rr.json() if rr.ok else {}
            check(f"  the saved bill is worth exactly {total:,.2f}",
                  rr.ok and near(j.get("subtotal"), total, 0.005),
                  f"subtotal={j.get('subtotal') if rr.ok else rr.text[:140]}")
            # Reopen it: the stored line must still read back at the same money.
            if rr.ok:
                back = requests.get(f"{api}/invoices/{j['id']}", headers=h, timeout=60).json()
                line = (back.get("items") or [{}])[0]
                check(f"  and reopens with a line total of {total:,.2f}",
                      near(line.get("lineTotal"), total, 0.005),
                      f"lineTotal={line.get('lineTotal')}")
                check("  with the quantity still whole",
                      float(line.get("quantity") or 0) == float(qty),
                      f"quantity={line.get('quantity')}")

        # Very small: an amount worth less than one unit still bills one unit,
        # priced at the amount -- never a zero quantity, which would bill nothing.
        tiny_qty, tiny_rate = derive(10.0, 1000.0)
        check("an amount below one unit's cost bills a single unit",
              tiny_qty == 1 and near(tiny_rate, 10.0, 1e-9),
              f"qty={tiny_qty} rate={tiny_rate}")

        # Very large, and an amount with paisa in it.
        big_qty, big_rate = derive(9_999_999.99, 3.0)
        check("a very large amount stays exact to the paisa",
              near(round(big_qty * big_rate, 2), 9_999_999.99, 0.005),
              f"qty={big_qty} rate={big_rate} -> {round(big_qty * big_rate, 2)}")

        odd_qty, odd_rate = derive(1234.56, 7.0)
        check("an amount with paisa stays exact",
              near(round(odd_qty * odd_rate, 2), 1234.56, 0.005),
              f"qty={odd_qty} rate={odd_rate} -> {round(odd_qty * odd_rate, 2)}")

        # A third that cannot be written exactly in 2dp: this is the case the
        # 12-decimal unit price exists for.
        third_qty, third_rate = derive(100.0, 33.34)
        check("100 over 3 units books as exactly 100.00, not 99.99",
              third_qty == 3 and near(round(third_qty * third_rate, 2), 100.0, 0.005),
              f"qty={third_qty} rate={third_rate} -> {round(third_qty * third_rate, 2)}")

        # ── Edge cases ────────────────────────────────────────────────────
        print("\n-- A. Edge cases --")
        empty = make_item(f"No Stock {tag}")
        p2 = pricing([empty])
        check("an item with nothing on hand cannot be priced",
              p2[empty]["canPrice"] is False and near(p2[empty]["unitCost"], 0),
              f"{p2[empty]}")
        check("and says why", "nothing on hand" in (p2[empty].get("note") or "").lower(),
              f"note={p2[empty].get('note')}")

        valueless = make_item(f"No Value {tag}")
        set_stock(valueless, 25, 0)
        p3 = pricing([valueless])
        check("stock carrying no value cannot be priced",
              p3[valueless]["canPrice"] is False,
              f"{p3[valueless]}")
        check("and says why", "no value" in (p3[valueless].get("note") or "").lower(),
              f"note={p3[valueless].get('note')}")

        # A line total above what the stock is worth implies more units than
        # exist -- the two conditions are the same thing, which is what lets
        # the form warn once.
        over_total = 1500.0
        implied = over_total / float(p[a]["unitCost"])
        check("a line total above the stock value implies more units than exist",
              implied > float(p[a]["availableQuantity"]),
              f"{implied} vs {p[a]['availableQuantity']}")

        # Fractional units, where the unit allows them.
        frac = make_item(f"Frac {tag}", uom="Kg")
        set_stock(frac, 7.5, 1875)
        p4 = pricing([frac])
        check("a fractional-unit item prices per unit",
              near(p4[frac]["unitCost"], 250, 0.0001), f"{p4[frac]['unitCost']}")
        check("a line total of 1,000 becomes 4 Kg",
              near(1000 / float(p4[frac]["unitCost"]), 4, 0.0001))

        check("an unknown item id is reported, not guessed at",
              pricing([999999]).get(999999, {}).get("canPrice") is False)


        # ── The invariant the operator is promised ────────────────────────
        # Enter the amount; quantity and rate are derived; and the bill totals
        # to exactly the sum of those amounts plus GST plus any withholding and
        # advance tax. Two stored precisions decide the arithmetic:
        #   UnitPrice is decimal(18,2), so the rate must BE a 2dp figure
        #   a unit without AllowsDecimalQuantity can only hold a whole quantity
        # This mirrors applyLineTotal in the bill form, and asserts the SERVER
        # stores what that derivation predicts.
        print("\n-- A. The amount drives the line, exactly --")

        def derive(unit_cost, total, whole_only):
            rate = round(unit_cost + 1e-12, 2)
            raw = total / rate
            qty = max(1, round(raw)) if whole_only else round(raw, 4)
            return qty, rate, round(qty * rate + 1e-12, 2)

        def bill_lines(lines):
            """lines: (item_id, name, uom, qty, rate)"""
            return requests.post(f"{api}/invoices/standalone", headers=h, timeout=120, json={
                "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 18,
                "items": [{"description": nm, "itemTypeId": iid, "quantity": q,
                           "uom": u, "unitPrice": rt} for iid, nm, u, q, rt in lines]})

        # Whole-number unit, clean division: 10 @ 1,000 -> 100.00 each.
        whole = make_item(f"Whole {tag}", uom="Pcs")
        set_stock(whole, 10, 1000)
        # A whole-number unit where the amount does NOT divide cleanly.
        awkward = make_item(f"Awkward {tag}", uom="Pcs")
        set_stock(awkward, 3, 1000)
        # A unit that takes decimals.
        kg = make_item(f"Kilos {tag}", uom="Kg")
        set_stock(kg, 7.5, 1875)
        pr = pricing([whole, awkward, kg])

        q1, r1, t1 = derive(float(pr[whole]["unitCost"]), 500, True)
        check("a whole unit dividing cleanly needs no snapping",
              (q1, r1, t1) == (5, 100.0, 500.0), f"{(q1, r1, t1)}")

        q2, r2, t2 = derive(float(pr[awkward]["unitCost"]), 1000, True)
        check("a whole unit that cannot hold the amount snaps it",
              q2 == 3 and near(r2, 333.33, 0.0001) and near(t2, 999.99, 0.0001),
              f"{(q2, r2, t2)}")

        q3, r3, t3 = derive(float(pr[kg]["unitCost"]), 1000, False)
        check("a decimal unit takes the amount as given",
              (q3, r3, t3) == (4, 250.0, 1000.0), f"{(q3, r3, t3)}")

        # Every line multiplies out, and the bill sums to them.
        rr = bill_lines([
            (whole,   f"Whole {tag}",   "Pcs", q1, r1),
            (awkward, f"Awkward {tag}", "Pcs", q2, r2),
            (kg,      f"Kilos {tag}",   "Kg",  q3, r3),
        ])
        j = rr.json() if rr.ok else {}
        check("the bill is created from the derived lines", rr.ok,
              f"http {rr.status_code}: {rr.text[:160]}")
        want_sub = round(t1 + t2 + t3, 2)
        check("every line total is its own quantity x rate",
              rr.ok and all(near(li["lineTotal"], round(li["quantity"] * li["unitPrice"], 2), 0.005)
                            for li in (j.get("items") or [])),
              f"lines={[(li.get('quantity'), li.get('unitPrice'), li.get('lineTotal')) for li in (j.get('items') or [])]}")
        check(f"the subtotal is exactly the sum of the amounts ({want_sub:,.2f})",
              rr.ok and near(j.get("subtotal"), want_sub, 0.005),
              f"got {j.get('subtotal')}")
        check("the grand total is that plus GST",
              rr.ok and near(j.get("grandTotal"), round(want_sub * 1.18, 2), 0.02),
              f"got {j.get('grandTotal')} want {round(want_sub * 1.18, 2)}")

        # ... and with withholding and advance tax on top of the same bill.
        rr = requests.post(f"{api}/invoices/standalone", headers=h, timeout=120, json={
            "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 18,
            "withholdingTaxRate": 1, "advanceTaxSection": "236G",
            "advanceTaxFilerActive": True,
            "items": [{"description": f"Whole {tag}", "itemTypeId": whole,
                       "quantity": q1, "uom": "Pcs", "unitPrice": r1}]})
        j = rr.json() if rr.ok else {}
        gt = round(500 * 1.18, 2)
        check("withholding and advance tax both sit on top of the same total",
              rr.ok and near(j.get("subtotal"), 500, 0.005)
              and near(j.get("grandTotal"), gt, 0.005)
              and near(j.get("withholdingTaxAmount"), round(gt * 0.01, 2), 0.02)
              and near(j.get("advanceTaxAmount"), round(gt * 0.001, 2), 0.02),
              f"sub={j.get('subtotal')} gt={j.get('grandTotal')} "
              f"wht={j.get('withholdingTaxAmount')} adv={j.get('advanceTaxAmount')}")

        # ── B. Advance tax ────────────────────────────────────────────────
        print("\n-- B. Advance income tax (236G / 236H) --")
        base = make_item(f"AdvTax {tag}")
        set_stock(base, 1000, 100000)

        def bill(section=None, active=None, qty=1000, price=100):
            body = {"date": today, "companyId": cid, "clientId": client["id"],
                    "gstRate": 18,
                    "items": [{"description": f"AdvTax {tag}", "itemTypeId": base,
                               "quantity": qty, "uom": "Pcs", "unitPrice": price}]}
            if section is not None:
                body["advanceTaxSection"] = section
            if active is not None:
                body["advanceTaxFilerActive"] = active
            return requests.post(f"{api}/invoices/standalone", headers=h, timeout=120, json=body)

        # 100 x 1000 = 100,000 excluding; 18% = 18,000; 118,000 including.
        for section, active, rate, want in (("236G", True, 0.1, 118.0),
                                            ("236H", True, 0.5, 590.0),
                                            ("236G", False, 2.0, 2360.0),
                                            ("236H", False, 2.5, 2950.0)):
            rr = bill(section, active)
            j = rr.json() if rr.ok else {}
            label = f"{section} at {rate}% ({'active' if active else 'non-active'})"
            check(f"{label} collects {want:,.2f}",
                  rr.ok and near(j.get("advanceTaxAmount"), want, 0.02),
                  f"got {j.get('advanceTaxAmount') if rr.ok else rr.text[:140]}")
            check(f"{label} stores the rate it was issued at",
                  rr.ok and near(j.get("advanceTaxRate"), rate, 0.001),
                  f"rate={j.get('advanceTaxRate') if rr.ok else '-'}")
            check(f"{label} leaves the sales-tax invoice alone",
                  rr.ok and near(j.get("subtotal"), 100000, 0.02)
                  and near(j.get("gstAmount"), 18000, 0.02)
                  and near(j.get("grandTotal"), 118000, 0.02),
                  f"sub={j.get('subtotal')} gst={j.get('gstAmount')} gt={j.get('grandTotal')}")

        none_sel = bill()
        jn = none_sel.json() if none_sel.ok else {}
        check("no selection means no advance tax",
              none_sel.ok and near(jn.get("advanceTaxAmount"), 0)
              and not jn.get("advanceTaxSection"),
              f"amount={jn.get('advanceTaxAmount')} section={jn.get('advanceTaxSection')}")

        half = bill("236G", None)
        jh = half.json() if half.ok else {}
        check("a section with no filer status charges nothing",
              half.ok and near(jh.get("advanceTaxAmount"), 0)
              and not jh.get("advanceTaxSection"),
              f"amount={jh.get('advanceTaxAmount')} section={jh.get('advanceTaxSection')}")

        bogus = bill("236Z", True)
        jb = bogus.json() if bogus.ok else {}
        check("an unknown section charges nothing",
              bogus.ok and near(jb.get("advanceTaxAmount"), 0),
              f"amount={jb.get('advanceTaxAmount')}")

        # Halving the bill halves the advance tax.
        smaller = bill("236H", False, qty=500, price=100)
        js = smaller.json() if smaller.ok else {}
        check("the amount follows the bill's own total",
              smaller.ok and near(js.get("grandTotal"), 59000, 0.02)
              and near(js.get("advanceTaxAmount"), 1475.0, 0.02),
              f"gt={js.get('grandTotal')} adv={js.get('advanceTaxAmount')}")

        # Editing the bill re-charges it on the new total.
        target = bill("236G", False, qty=1000, price=100)
        if target.ok:
            tid = target.json()["id"]
            upd = requests.put(f"{api}/invoices/{tid}", headers=h, timeout=120, json={
                "id": tid, "companyId": cid, "clientId": client["id"], "date": today,
                "gstRate": 18,
                "items": [{"description": f"AdvTax {tag}", "itemTypeId": base,
                           "quantity": 500, "uom": "Pcs", "unitPrice": 100}]})
            after = requests.get(f"{api}/invoices/{tid}", headers=h, timeout=60).json()
            check("editing the bill recomputes the advance tax",
                  upd.ok and near(after.get("grandTotal"), 59000, 0.02)
                  and near(after.get("advanceTaxAmount"), 1180.0, 0.02),
                  f"gt={after.get('grandTotal')} adv={after.get('advanceTaxAmount')}")

        # An edit can SET advance tax on a bill that was issued without it,
        # and can take it off again. Both were impossible: UpdateAsync never
        # read the field, so it recomputed from whatever the bill already
        # carried and the edit form's dropdown had nothing to write to.
        edit_item = make_item(f"AdvEdit {tag}")
        set_stock(edit_item, 3000, 300000)

        def plain_bill(qty=1000, price=100):
            return requests.post(f"{api}/invoices/standalone", headers=h, timeout=120, json={
                "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 18,
                "items": [{"description": f"AdvEdit {tag}", "itemTypeId": edit_item,
                           "quantity": qty, "uom": "Pcs", "unitPrice": price}]})

        plain = plain_bill()
        if check("a bill is issued with no advance tax",
                 plain.ok and not plain.json().get("advanceTaxSection"),
                 f"http {plain.status_code}: {plain.text[:160]}"):
            pid = plain.json()["id"]
            base_body = {
                "id": pid, "companyId": cid, "clientId": client["id"], "date": today,
                "gstRate": 18,
                "items": [{"description": f"AdvEdit {tag}", "itemTypeId": edit_item,
                           "quantity": 1000, "uom": "Pcs", "unitPrice": 100}],
            }

            # SET it: 118,000 including sales tax, 236G active at 0.1% = 118.
            requests.put(f"{api}/invoices/{pid}", headers=h, timeout=120,
                         json={**base_body, "advanceTaxSection": "236G",
                               "advanceTaxFilerActive": True})
            got = requests.get(f"{api}/invoices/{pid}", headers=h, timeout=60).json()
            check("an edit can add advance tax to a bill that had none",
                  got.get("advanceTaxSection") == "236G"
                  and near(got.get("advanceTaxRate"), 0.1)
                  and near(got.get("advanceTaxAmount"), 118.0, 0.02),
                  f"section={got.get('advanceTaxSection')} rate={got.get('advanceTaxRate')} amt={got.get('advanceTaxAmount')}")
            check("and the sales-tax invoice itself does not move",
                  near(got.get("grandTotal"), 118000, 0.02),
                  f"gt={got.get('grandTotal')}")

            # An edit that does not MENTION advance tax keeps it -- an API
            # client editing only the lines must not silently drop a charge.
            requests.put(f"{api}/invoices/{pid}", headers=h, timeout=120, json=base_body)
            kept = requests.get(f"{api}/invoices/{pid}", headers=h, timeout=60).json()
            check("an edit that omits advance tax leaves it alone",
                  kept.get("advanceTaxSection") == "236G"
                  and near(kept.get("advanceTaxAmount"), 118.0, 0.02),
                  f"section={kept.get('advanceTaxSection')} amt={kept.get('advanceTaxAmount')}")

            # "" is how the form says None, and it clears the charge.
            requests.put(f"{api}/invoices/{pid}", headers=h, timeout=120,
                         json={**base_body, "advanceTaxSection": "",
                               "advanceTaxFilerActive": None})
            off = requests.get(f"{api}/invoices/{pid}", headers=h, timeout=60).json()
            check("an explicit None takes advance tax off the bill",
                  not off.get("advanceTaxSection") and near(off.get("advanceTaxAmount"), 0.0),
                  f"section={off.get('advanceTaxSection')} amt={off.get('advanceTaxAmount')}")

            # Editing a bill must move the stock it sold, in QUANTITY and in
            # VALUE -- an outward movement is valued by the weighted-average
            # walk, so halving the line has to hand half the value back.
            def on_hand():
                rr = requests.get(f"{api}/invoices/company/{cid}/stock-pricing", headers=h,
                                  timeout=120, params={"itemTypeIds": str(edit_item)})
                row = (rr.json() or [{}])[0] if rr.ok else {}
                return float(row.get("availableQuantity") or 0), float(row.get("availableValueExcludingTax") or 0)

            q_before, v_before = on_hand()
            requests.put(f"{api}/invoices/{pid}", headers=h, timeout=120, json={
                **base_body,
                "items": [{"description": f"AdvEdit {tag}", "itemTypeId": edit_item,
                           "quantity": 400, "uom": "Pcs", "unitPrice": 100}]})
            q_after, v_after = on_hand()
            check("cutting a bill's quantity gives the stock back",
                  near(q_after - q_before, 600.0, 0.01),
                  f"on hand {q_before} -> {q_after} (expected +600)")
            check("and gives its VALUE back at the average cost",
                  v_after > v_before,
                  f"value {v_before} -> {v_after}")

        # ── Both bill flows ───────────────────────────────────────────────
        print("\n-- B. From a delivery challan --")
        ch = requests.post(f"{api}/deliverychallans/company/{cid}", headers=h, timeout=120,
            json={"deliveryDate": today, "clientId": client["id"],
                  "customerPoNumber": f"PO-{tag}",
                  "items": [{"itemTypeId": base, "description": f"AdvTax {tag}",
                             "quantity": 1000, "unit": "Pcs"}]})
        if check("a challan is created", ch.ok, f"http {ch.status_code}: {ch.text[:160]}"):
            chj = ch.json()
            fromch = requests.post(f"{api}/invoices", headers=h, timeout=120, json={
                "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 18,
                "challanIds": [chj["id"]],
                "advanceTaxSection": "236G", "advanceTaxFilerActive": True,
                "items": [{"deliveryItemId": chj["items"][0]["id"], "unitPrice": 100,
                           "description": f"AdvTax {tag}"}]})
            jf = fromch.json() if fromch.ok else {}
            check("a bill from a challan takes the advance tax too",
                  fromch.ok and near(jf.get("advanceTaxAmount"), 118.0, 0.02),
                  f"got {jf.get('advanceTaxAmount') if fromch.ok else fromch.text[:160]}")
            check("and its sales-tax invoice is untouched",
                  fromch.ok and near(jf.get("grandTotal"), 118000, 0.02),
                  f"gt={jf.get('grandTotal')}")
        # ── C. Further tax (s.3(1A)) ──────────────────────────────────────
        # The MIRROR of advance tax above, and the difference is the point:
        # advance tax is collected OUTSIDE the sales-tax invoice and leaves
        # GrandTotal alone, while further tax is part of the supply's own tax
        # and goes INSIDE it. Charged on the NET value of supply -- the same
        # base FbrLineTax uses per line, so the document and the FBR payload
        # cannot disagree.
        print("")
        print("-- C. Further tax (s.3(1A)) --")
        ft_item = make_item(f"FurtherTax {tag}")
        set_stock(ft_item, 1000, 100000, 18)

        def bill(rate, qty=10, price=1000, **extra):
            body = {"date": today, "companyId": cid, "clientId": client["id"],
                    "gstRate": 18, "documentType": 4, "paymentMode": "Cash",
                    "items": [{"itemTypeId": ft_item, "description": f"FT {tag}",
                               "quantity": qty, "uom": "Pcs", "unitPrice": price}]}
            if rate is not None:
                body["furtherTaxRate"] = rate
            body.update(extra)
            return requests.post(f"{api}/invoices/standalone", headers=h, timeout=120, json=body)

        # 10 x 1000 = 10,000 net; GST 18% = 1,800; further tax 4% of the NET.
        r4 = bill(4)
        j4 = r4.json() if r4.ok else {}
        check("a bill takes a further-tax rate", r4.ok, f"http {r4.status_code}: {r4.text[:160]}")
        check("further tax is charged on the net, not the gross",
              near(j4.get("furtherTaxAmount"), 400.0, 0.02),
              f"expected 400 (4% of 10,000), got {j4.get('furtherTaxAmount')}")
        check("the stored rate is what was asked for",
              near(j4.get("furtherTaxRate"), 4.0, 0.001), f"got {j4.get('furtherTaxRate')}")
        check("subtotal and GST are untouched by it",
              near(j4.get("subtotal"), 10000, 0.02) and near(j4.get("gstAmount"), 1800, 0.02),
              f"subtotal={j4.get('subtotal')} gst={j4.get('gstAmount')}")
        check("and it is INSIDE the grand total",
              near(j4.get("grandTotal"), 12200, 0.02),
              f"expected 10,000 + 1,800 + 400 = 12,200, got {j4.get('grandTotal')}")

        # The identity the whole feature rests on.
        check("grand total == subtotal + GST + further tax",
              near(j4.get("grandTotal"),
                   (j4.get("subtotal") or 0) + (j4.get("gstAmount") or 0)
                   + (j4.get("furtherTaxAmount") or 0), 0.02))

        # No rate at all must behave exactly as every bill written before this
        # existed -- that is what keeps historic documents readable.
        r0 = bill(None)
        j0 = r0.json() if r0.ok else {}
        check("a bill with no further-tax rate charges none",
              r0.ok and (j0.get("furtherTaxAmount") or 0) == 0,
              f"got {j0.get('furtherTaxAmount')}")
        check("and its grand total is subtotal + GST",
              near(j0.get("grandTotal"), 11800, 0.02), f"got {j0.get('grandTotal')}")

        # A fractional rate must survive: the print field formats with fmtQty
        # for exactly this reason ({{fmt}} renders 2.5% as 3%).
        rhalf = bill(2.5)
        jh = rhalf.json() if rhalf.ok else {}
        check("a fractional rate is kept, not rounded",
              rhalf.ok and near(jh.get("furtherTaxRate"), 2.5, 0.001),
              f"got {jh.get('furtherTaxRate')}")
        check("and charges 2.5% of the net",
              near(jh.get("furtherTaxAmount"), 250.0, 0.02),
              f"expected 250, got {jh.get('furtherTaxAmount')}")

        # ── the print DTOs both carry it ──
        if r4.ok:
            iid = j4["id"]
            pb = requests.get(f"{api}/invoices/{iid}/print/bill", headers=h, timeout=60)
            pt = requests.get(f"{api}/invoices/{iid}/print/tax-invoice", headers=h, timeout=60)
            jb = pb.json() if pb.ok else {}
            jt = pt.json() if pt.ok else {}
            check("the bill print carries the rate and amount",
                  near(jb.get("furtherTaxAmount"), 400.0, 0.02) and near(jb.get("furtherTaxRate"), 4.0, 0.001),
                  f"rate={jb.get('furtherTaxRate')} amt={jb.get('furtherTaxAmount')}")
            check("the tax invoice print does too",
                  near(jt.get("furtherTaxAmount"), 400.0, 0.02) and near(jt.get("furtherTaxRate"), 4.0, 0.001),
                  f"rate={jt.get('furtherTaxRate')} amt={jt.get('furtherTaxAmount')}")
            # A totals block shows this in the "Value Incl. Tax" cell of its
            # TOTAL row so the column still sums to the lines above it.
            check("the print exposes the pre-further-tax total for the column sum",
                  near(jb.get("totalBeforeFurtherTax"), 11800, 0.02),
                  f"got {jb.get('totalBeforeFurtherTax')}")
            check("net payable = grand total less WHT plus advance tax",
                  near(jb.get("collectible"), 12200, 0.02),
                  f"got {jb.get('collectible')}")

        # ── editing: absent leaves it, a value sets it, 0 clears it ──
        if r4.ok:
            iid = j4["id"]
            items_only = {"date": today, "gstRate": 18, "clientId": client["id"],
                          "documentType": 4, "paymentMode": "Cash",
                          "items": [{"itemTypeId": ft_item, "description": f"FT {tag}",
                                     "quantity": 10, "uom": "Pcs", "unitPrice": 1000}]}
            e1 = requests.put(f"{api}/invoices/{iid}", headers=h, timeout=120, json=items_only)
            g1 = requests.get(f"{api}/invoices/{iid}", headers=h, timeout=60).json()
            check("an edit that never mentions further tax keeps the charge",
                  e1.ok and near(g1.get("furtherTaxAmount"), 400.0, 0.02),
                  f"got {g1.get('furtherTaxAmount')}")

            e2 = requests.put(f"{api}/invoices/{iid}", headers=h, timeout=120,
                              json={**items_only, "furtherTaxRate": 3})
            g2 = requests.get(f"{api}/invoices/{iid}", headers=h, timeout=60).json()
            check("changing the rate re-charges it",
                  e2.ok and near(g2.get("furtherTaxAmount"), 300.0, 0.02),
                  f"got {g2.get('furtherTaxAmount')}")
            check("and the grand total follows",
                  near(g2.get("grandTotal"), 12100, 0.02), f"got {g2.get('grandTotal')}")

            e3 = requests.put(f"{api}/invoices/{iid}", headers=h, timeout=120,
                              json={**items_only, "furtherTaxRate": 0})
            g3 = requests.get(f"{api}/invoices/{iid}", headers=h, timeout=60).json()
            check("a rate of zero clears the charge",
                  e3.ok and (g3.get("furtherTaxAmount") or 0) == 0,
                  f"got {g3.get('furtherTaxAmount')}")
            check("and the grand total drops back",
                  near(g3.get("grandTotal"), 11800, 0.02), f"got {g3.get('grandTotal')}")

        # ── D. Further tax in the ledger ──────────────────────────────────
        # The company above has the GL off, so this needs its own. This is the
        # part that would corrupt the books rather than merely look wrong:
        # PostingService derives the sale as GrandTotal - GSTAmount, and
        # further tax is now inside GrandTotal, so without subtracting it too
        # the tax would be credited to SALES as revenue.
        print("")
        print("-- D. Further tax in the ledger --")
        gl_cid = requests.post(f"{api}/companies", headers=h, timeout=60, json={
            "name": f"_ft_gl {tag}", "brandName": "FTG",
            "fullAddress": "1 Test Street", "phone": "021-0000000", "ntn": "1234567-8",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "fbrEnabled": False, "inventoryTrackingEnabled": False,
        }).json()["id"]
        try:
            en = requests.post(f"{api}/accounting/gl/company/{gl_cid}/enable", headers=h, timeout=180)
            check("the GL can be switched on for a fresh company", en.ok, f"http {en.status_code}")

            gl_client = requests.post(f"{api}/clients", headers=h, timeout=60, json={
                "name": f"FT GL Client {tag}", "address": "1 Road", "phone": "021-1",
                "companyId": gl_cid, "registrationType": "Unregistered"}).json()
            gl_item = requests.post(f"{api}/itemtypes", headers=h, timeout=60,
                                    params={"companyId": gl_cid},
                                    json={"name": f"FT GL Item {tag}", "uom": "Pcs",
                                          "companyId": gl_cid, "isFavorite": True}).json()["id"]

            gb = requests.post(f"{api}/invoices/standalone", headers=h, timeout=120, json={
                "date": today, "companyId": gl_cid, "clientId": gl_client["id"],
                "gstRate": 18, "documentType": 4, "paymentMode": "Cash",
                "furtherTaxRate": 4,
                "items": [{"itemTypeId": gl_item, "description": f"FT GL {tag}",
                           "quantity": 10, "uom": "Pcs", "unitPrice": 1000}]})
            gj = gb.json() if gb.ok else {}
            check("a bill with further tax is created on a GL company",
                  gb.ok and near(gj.get("grandTotal"), 12200, 0.02),
                  f"http {gb.status_code}: {gb.text[:160] if not gb.ok else gj.get('grandTotal')}")

            if gb.ok:
                ent = requests.get(f"{api}/journal-entries/company/{gl_cid}/paged",
                                   headers=h, timeout=120,
                                   params={"page": 1, "pageSize": 50})
                lines = []
                if ent.ok:
                    for e in ent.json().get("items", []):
                        if (e.get("sourceDocType") == "Invoice"
                                and e.get("sourceDocId") == gj["id"]):
                            lines = e.get("lines") or []
                            break
                else:
                    print(f"    (journal fetch http {ent.status_code}: {ent.text[:160]})")
                by = {}
                for l in lines:
                    nm = (l.get("accountName") or "").lower()
                    by[nm] = by.get(nm, 0) + (l.get("credit") or 0) - (l.get("debit") or 0)

                check("the invoice posted a journal entry", len(lines) > 0,
                      f"{len(lines)} lines")
                if lines:
                    dr = sum(l.get("debit") or 0 for l in lines)
                    cr = sum(l.get("credit") or 0 for l in lines)
                    check("the entry balances", near(dr, cr, 0.02), f"dr={dr} cr={cr}")
                    check("receivable is the whole grand total, further tax included",
                          near(dr, 12200, 0.02), f"dr={dr}")
                    sales = next((v for k, v in by.items() if "sales" in k and "tax" not in k), None)
                    check("SALES is the net only -- the tax is not revenue",
                          sales is not None and near(sales, 10000, 0.02),
                          f"sales credit {sales} (10,400 would mean further tax was booked as income)")
                    outp = next((v for k, v in by.items() if "output" in k), None)
                    check("output sales tax is unchanged at 18% of the net",
                          outp is not None and near(outp, 1800, 0.02), f"output tax {outp}")
                    furth = next((v for k, v in by.items() if "further" in k), None)
                    check("further tax lands in its own liability account",
                          furth is not None and near(furth, 400, 0.02),
                          f"further tax payable {furth}")
        finally:
            requests.delete(f"{api}/companies/{gl_cid}", headers=h, timeout=600)

    finally:
        if args.keep:
            print(f"\nkeeping company {cid}")
        else:
            d = requests.delete(f"{api}/companies/{cid}", headers=h, timeout=600)
            print(f"\nteardown: delete company {cid} -> {d.status_code}")

    passed = sum(1 for ok, _, _ in results if ok)
    failed = [n for ok, n, _ in results if not ok]
    print("\n" + "=" * 70)
    for ok, n, d in results:
        if not ok:
            print(f"  FAIL  {n} -- {d}")
    print(f"{passed}/{len(results)} checks passed")
    print("=" * 70)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
