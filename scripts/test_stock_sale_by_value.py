#!/usr/bin/env python3
"""
Invoices take their AMOUNT out of stock (CLAUDE.md 5b-24, 2026-11-17).

A consultant's GD stock sheet deducts each invoice's amount from the GD rows
and works quantity out from value. Every invoice ENTERED after this shipped,
in every FIFO-by-GD company, does the same, so an item's stock value is

    what its GDs brought in  -  what was invoiced

whatever order the GDs and invoices were typed in. One fresh company:

     1. A GD brings 100 Pcs worth 100,000.
     2. An invoice of 25,000 (quantity typed 1) takes out 25,000; 25 Pcs leave.
     3. Any typed quantity: 999 Pcs for 9,990 is allowed (the stock check is on
        value) and 9.99 Pcs leave.
     4. A GD dated BEFORE those invoices, entered after them (the late GD):
        the value is exactly in - invoiced; quantities are worked out again and
        the movement feed adds up to the on-hand quantity.
     5. (Replaced 2026-11-21: an invoice beyond stock is no longer refused
        under FIFO by GD -- see 11. This step used to assert the refusal.)
     6. Editing an invoice's amount moves the stock by the difference.
     7. Deleting an invoice puts its amount back.
     8. A back-dated invoice entered now sells by value too. Every invoice
        entered before the deploy keeps its quantity: a fresh suite cannot
        create one, so the read-only production check proves that part.
     9. The bill cost check shows no gap on a sale by value.
    10. MCP: an invoice made through prepare_bill sells by value too.
    11. Selling before the GD lands (2026-11-21): with "block selling beyond
        stock" ON, an invoice for more than the stock holds still saves; the
        item goes negative; the next GD pays the oldest pre-sale off first and
        only the rest is new stock. A weighted-average company with the same
        switch is still refused, and the company record says which blocks.

Usage:
    python scripts/test_stock_sale_by_value.py --base http://localhost:5139 [--keep]
"""

import argparse
import json
import sys
from datetime import datetime

import requests

import mcp_importer_fixture as fx

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

results = []


def check(name, ok, detail=""):
    results.append((ok, name))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" -- {str(detail)[:400]}"))
    return ok


def near(a, b, tol=0.02):
    return abs(float(a or 0) - float(b or 0)) <= tol


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5139")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()
    api = args.base.rstrip("/") + "/api"
    fx.set_base(args.base)

    r = requests.post(f"{api}/auth/login", json={"username": args.username, "password": args.password}, timeout=60)
    if not r.ok:
        print(f"FATAL: login failed ({r.status_code})")
        return 2
    h = {"Authorization": f"Bearer {r.json()['token']}"}

    def call(method, path, **kw):
        kw.setdefault("timeout", 180)
        return requests.request(method, f"{api}{path}", headers=h, **kw)

    tag = datetime.now().strftime("%m%d%H%M%S")
    r = call("POST", "/companies", json={
        "name": f"_sale_by_value {tag}", "brandName": "SBV", "fullAddress": "1 Test Street",
        "phone": "021-0000000", "ntn": "1234567-8", "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1, "startingSalesQuoteNumber": 1,
        "startingSalesOrderNumber": 1, "fbrEnabled": False, "inventoryTrackingEnabled": True,
        "stockGuardHardBlock": True, "enableGl": False})  # as on the live importer companies
    if not r.ok:
        print(f"FATAL: create company ({r.status_code} {r.text[:200]})")
        return 2
    cid = r.json()["id"]
    print(f"\nCompany id={cid}  base={args.base}")
    call("POST", f"/stock/company/{cid}/flow-version", json={"version": 2})
    client = call("POST", "/clients", json={"name": f"SBV Client {tag}", "address": "1 Test Road, Karachi",
                                             "phone": "021-1234567", "companyId": cid,
                                             "registrationType": "Unregistered"}).json()["id"]
    hs, name = "8481.1000", f"SBV VALVE {tag}"

    def gd(number, gd_date, qty, selling, desc=None, code=None):
        line = {"gdNumber": number, "gdDate": gd_date, "description": desc or name, "hsCode": code or hs, "quantity": qty,
                "unit": "Pcs", "assessedValue": selling * 0.8, "customsDuty": 0, "acd": 0, "regulatoryDuty": 0,
                "others": 0, "salesTaxRate": 18, "astRate": 3, "incomeTaxRate": 6, "addOnProfit": 0,
                "sellingValue": selling}
        p = call("POST", "/spreadsheet-import/gd-costing/preview-manual",
                 params={"companyId": cid, "mode": "new-arrivals"}, json={"lines": [line]})
        if not p.ok:
            return p
        prev = p.json()
        return call("POST", "/spreadsheet-import/gd-costing/commit", json={
            "companyId": cid, "fileSha256": prev.get("fileSha256"), "fileName": prev.get("fileName"),
            "fileSizeBytes": prev.get("fileSizeBytes"), "lines": prev.get("lines", []),
            "createMissingStock": True, "mode": "new-arrivals"})

    def item():
        rows = call("GET", f"/stock/company/{cid}/onhand").json()
        return next((x for x in rows if x["itemTypeName"].upper().startswith("SBV VALVE")), None)

    def invoice(on, qty, price):
        it = item()
        return call("POST", "/invoices/standalone", json={
            "date": f"{on}T00:00:00Z", "companyId": cid, "clientId": client, "gstRate": 18,
            "items": [{"itemTypeId": it["itemTypeId"], "description": name, "quantity": qty, "uom": "Pcs",
                       "unitPrice": price}]})

    def moved_qty():
        it = item()
        rows = call("GET", f"/stock/company/{cid}/movements",
                    params={"itemTypeId": it["itemTypeId"], "pageSize": 100}).json().get("items", [])
        return rows

    def position(label, value, qty, qtol=0.0002):
        it = item()
        ok = it and near(it["valueExcludingTax"], value) and near(it["onHand"], qty, qtol)
        check(label, ok, it and (it["onHand"], it["valueExcludingTax"], "expected", qty, value))
        return it

    try:
        print("\n-- 1. A GD brings 100 Pcs worth 100,000 --")
        r = gd("SBV-GD-1", "2026-10-20", 100, 100000)
        check("GD 1 commits", r.ok, r.text[:300])
        position("100 Pcs worth 100,000", 100000, 100)

        print("\n-- 2. An invoice takes out its amount --")
        r = invoice("2026-11-05", 1, 25000)
        check("invoice of 25,000 with quantity 1 saves", r.ok, r.text[:300])
        inv1 = r.json()["id"] if r.ok else None
        position("value 75,000 left; 25 Pcs left the stock, not 1", 75000, 75)

        print("\n-- 3. Any typed quantity --")
        r = invoice("2026-11-06", 999, 10)
        check("999 Pcs for 9,990 is allowed: the stock has the value", r.ok, r.text[:300])
        inv2 = r.json()["id"] if r.ok else None
        position("value 65,010; 9.99 Pcs left", 65010, 65.01)

        print("\n-- 4. The late GD: dated before the invoices, entered after them --")
        r = gd("SBV-GD-0", "2026-10-01", 50, 75000)
        check("GD 0 (dated 1 Oct) commits after the November invoices", r.ok, r.text[:300])
        it = position("value = 175,000 in - 34,990 invoiced = 140,010 (the consultant's figure)",
                      140010, 150 - 25 - 9.99, qtol=0.001)
        rows = moved_qty()
        out_qty = sum(float(m["quantity"]) for m in rows if m.get("direction") in ("Out", 1))
        in_qty = sum(float(m["quantity"]) for m in rows if m.get("direction") in ("In", 0))
        check("the invoices keep what they took (25 + 9.99 Pcs): a GD typed later never re-prices them",
              near(out_qty, 25 + 9.99, 0.001), (out_qty, [(m.get("direction"), m["quantity"]) for m in rows]))
        check("the movement feed adds up to the on-hand quantity", it and near(in_qty - out_qty, it["onHand"], 0.001),
              (in_qty, out_qty, it and it["onHand"]))
        g = {x["gdNumber"]: x for x in call("GET", f"/stock/company/{cid}/gd-details",
                                             params={"itemTypeId": it["itemTypeId"]}).json()}
        check("GD panel: the late GD is held whole (75,000)",
              "SBV-GD-0" in g and near(g["SBV-GD-0"].get("remainingValueExcludingTax"), 75000, 0.05),
              json.dumps(g)[:400])

        print("\n-- 6. Editing an invoice's amount --")
        cur = call("GET", f"/invoices/{inv1}").json()
        lines = [{"id": i["id"], "itemTypeId": i["itemTypeId"], "description": i["description"], "quantity": 1,
                  "uom": "Pcs", "unitPrice": 15000} for i in cur["items"]]
        r = call("PUT", f"/invoices/{inv1}", json={"date": cur["date"], "clientId": client, "gstRate": 18,
                                                     "items": lines})
        check("invoice 1 edited from 25,000 to 15,000", r.ok, r.text[:300])
        # Saving the invoice again re-enters it after GD 0, so its 15,000 now
        # comes off the older GD 0 (10 Pcs at 1,500).
        position("stock value up by exactly 10,000", 150010, 150 - 15000 / 1500 - 9.99, qtol=0.001)

        print("\n-- 7. Deleting an invoice --")
        r = call("DELETE", f"/invoices/{inv2}")
        check("invoice 2 deleted", r.ok, r.text[:200])
        position("its 9,990 is back", 160000, 150 - 15000 / 1500, qtol=0.001)

        print("\n-- 8. A back-dated invoice entered now --")
        r = invoice("2026-10-25", 1, 99999)
        check("an invoice dated 25 Oct, entered now, saves", r.ok, r.text[:300])
        # It is walked before November: 75,000 empties the 1 Oct GD (50 Pcs),
        # 24,999 comes off the 20 Oct GD (24.999 Pcs); November's 15,000 then
        # takes 15 Pcs. Every invoice entered after the deploy sells by value,
        # whatever its date.
        position("it took out its 99,999 too: 175,000 - 99,999 - 15,000", 60001, 150 - 74.999 - 15, qtol=0.001)

        print("\n-- 9. The bill cost check --")
        r = call("GET", f"/stock/company/{cid}/bill-cost-check",
                 params={"from": "2026-11-01", "to": "2026-11-30", "minGap": 0})
        body = r.json() if r.ok else {}
        check("November: the stock took out exactly what was billed",
              r.ok and body.get("rows") and near(body.get("gap"), 0, 0.05)
              and near(body.get("billedExcludingTax"), body.get("stockCostOut"), 0.05), r.text[:400])

        print("\n-- 10. MCP --")
        admin = fx.login(args.username, args.password)
        fx.remove_users(admin, "sbv_")
        sysr = fx.system_roles(admin)
        uid, jw = fx.make_user(admin, f"sbv_agent", [cid], [fx.staff_role(admin), sysr["MCP Access"], sysr["MCP Write"]])
        tok = fx.token_for(jw, [cid])
        before = item()
        refused, text = fx.call(tok, "prepare_bill", {"companyId": cid, "clientId": client, "date": "2026-11-12",
                                                      "items": [{"itemTypeId": before["itemTypeId"], "description": name,
                                                                 "quantity": "3", "unit": "Pcs", "unitPrice": "2000"}]})
        plan = None if refused else json.loads(text)
        if plan:
            refused, text = fx.call(tok, "commit_action", {"planId": plan["planId"]})
        after = item()
        check("an invoice through MCP takes out its amount (6,000)",
              plan and not refused and near(before["valueExcludingTax"] - after["valueExcludingTax"], 6000),
              (text[:300], before and before["valueExcludingTax"], after and after["valueExcludingTax"]))
        fx.remove_users(admin, "sbv_")

        print("\n-- 11. Selling before the GD lands --")
        co = call("GET", f"/companies/{cid}").json()
        check("company record: switch ON, but FIFO by GD does not block a sale",
              co.get("stockGuardHardBlock") is True and co.get("stockBlocksSale") is False,
              {k: co.get(k) for k in ("stockGuardHardBlock", "stockBlocksSale")})
        pump_name = f"SBV PUMP {tag}"
        r = gd("SBV-PUMP-1", "2026-10-01", 10, 10000, pump_name, "8413.7090")
        check("pump GD 1: 10 Pcs worth 10,000", r.ok, r.text[:300])
        def pump():
            rows = call("GET", f"/stock/company/{cid}/onhand").json()
            return next((x for x in rows if x["itemTypeName"].upper().startswith("SBV PUMP")), None)
        def pump_invoice(on, amount):
            p = pump()
            return call("POST", "/invoices/standalone", json={
                "date": f"{on}T00:00:00Z", "companyId": cid, "clientId": client, "gstRate": 18,
                "items": [{"itemTypeId": p["itemTypeId"], "description": pump_name, "quantity": 1, "uom": "Pcs",
                           "unitPrice": amount}]})
        r = pump_invoice("2026-11-08", 30000)
        check("an invoice of 30,000 against 10,000 of stock SAVES (no 409)", r.ok, f"{r.status_code} {r.text[:300]}")
        p = pump()
        check("the pump is now negative: -20,000 owed to the next GD",
              p and near(p["valueExcludingTax"], -20000) and float(p["onHand"]) < 0, p and (p["onHand"], p["valueExcludingTax"]))
        r = pump_invoice("2026-11-09", 5000)
        check("a second pre-sale of 5,000 saves too", r.ok, r.text[:300])
        p = pump()
        check("owed is now 25,000", p and near(p["valueExcludingTax"], -25000), p and p["valueExcludingTax"])
        r = gd("SBV-PUMP-2", "2026-11-15", 50, 100000, pump_name, "8413.7090")
        check("pump GD 2 arrives: 50 Pcs worth 100,000 (2,000 each)", r.ok, r.text[:300])
        p = pump()
        # 10,000 + 100,000 in - 35,000 invoiced = 75,000. Quantity: the first
        # sale took GD 1's 10 Pcs (10,000) and 10 Pcs of GD 2 for its other
        # 20,000; the second took 2.5 Pcs. 60 - 22.5 = 37.5 Pcs at 2,000.
        check("value = 110,000 in - 35,000 invoiced = 75,000", p and near(p["valueExcludingTax"], 75000),
              p and p["valueExcludingTax"])
        check("on hand = 37.5 Pcs, all at GD 2's 2,000", p and near(p["onHand"], 37.5, 0.001), p and p["onHand"])
        g = {x["gdNumber"]: x for x in call("GET", f"/stock/company/{cid}/gd-details",
                                             params={"itemTypeId": p["itemTypeId"]}).json()}
        check("GD 2 paid the pre-sales off first: 25,000 of it is consumed, 75,000 left",
              "SBV-PUMP-2" in g and near(g["SBV-PUMP-2"].get("remainingValueExcludingTax"), 75000, 0.05),
              json.dumps(g)[:400])
        check("GD 1 is used up", "SBV-PUMP-1" not in g or near(g["SBV-PUMP-1"].get("remainingValueExcludingTax"), 0, 0.05),
              json.dumps(g)[:400])

        # Annex-H1 for November: GD 2 is a purchase of its FULL 100,000, even
        # though 25,000 of it went straight to the pre-sales (it once showed
        # 75,000 purchased and -25,000 in Other).
        import io
        import openpyxl
        r = call("GET", f"/stock/company/{cid}/annex-h1/excel", params={"month": "2026-11"})
        h1 = {}
        if r.ok:
            ws = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)["Annex-H1"]
            for row in ws.iter_rows(min_row=5, values_only=True):
                if isinstance(row[0], (int, float)) and row[1] == "8413.7090":
                    h1 = {"open": row[5], "in": row[7], "supplies": (row[9] or 0) + (row[11] or 0),
                          "other": row[13], "close": row[15]}
        check("Annex-H1 Nov, pump: opening 10,000, purchased the full 100,000, supplies 35,000, other 0, closing 75,000",
              h1 and near(h1["open"], 10000) and near(h1["in"], 100000) and near(h1["supplies"], 35000)
              and near(h1["other"], 0) and near(h1["close"], 75000), (r.status_code, h1))
        r = call("GET", f"/stock/company/{cid}/onhand/excel/monthly", params={"month": "2026-11"})
        rows = []
        if r.ok:
            ws = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True).worksheets[0]
            rows = [x for x in ws.iter_rows(min_row=4, values_only=True)
                    if isinstance(x[3], str) and x[3].upper().startswith("SBV PUMP")]
        gd2 = next((x for x in rows if x[1] == "SBV-PUMP-2"), None)
        check("monthly sheet Nov: GD 2 opens at its full 100,000, hands 25,000 to the pre-sales (Other), closes 75,000",
              gd2 and near(gd2[10], 100000) and near(gd2[34], 25000) and near(gd2[18], 75000), gd2)
        check("monthly sheet Nov: every pump row adds up (Opening - Consumed - Other = Balance)",
              rows and all(near((x[10] or 0) - (x[14] or 0) - (x[34] or 0), x[18] or 0) for x in rows), rows)

        print("\n-- 11b. Weighted average with the same switch still blocks --")
        r = call("POST", "/companies", json={
            "name": f"_sale_by_value_wa {tag}", "brandName": "SBVWA", "fullAddress": "1 Test Street",
            "phone": "021-0000000", "ntn": "1234567-8", "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1, "startingSalesQuoteNumber": 1,
            "startingSalesOrderNumber": 1, "fbrEnabled": False, "inventoryTrackingEnabled": True,
            "stockGuardHardBlock": True, "enableGl": False})
        wa = r.json()["id"] if r.ok else None
        try:
            call("POST", f"/stock/company/{wa}/flow-version", json={"version": 2})
            r = call("PUT", f"/stock/company/{wa}/costing-method", json={"method": "WeightedAverage"})
            check("second company put on the weighted average", r.ok, r.text[:200])
            co = call("GET", f"/companies/{wa}").json()
            check("its record says a sale beyond stock is blocked", co.get("stockBlocksSale") is True, co.get("stockBlocksSale"))
            wclient = call("POST", "/clients", json={"name": f"SBV WA Client {tag}", "address": "1 Test Road, Karachi",
                                                     "phone": "021-1234567", "companyId": wa,
                                                     "registrationType": "Unregistered"}).json()["id"]
            ni = call("POST", "/itemtypes", params={"companyId": wa}, json={
                "name": f"SBV WA ITEM {tag}", "hsCode": "8481.1000", "uom": "Pcs", "isFavorite": True})
            it_id = ni.json().get("id") if ni.ok else None
            check("an item with no stock is created on it", it_id is not None, ni.text[:200])
            r = call("POST", "/invoices/standalone", json={
                "date": "2026-11-10T00:00:00Z", "companyId": wa, "clientId": wclient, "gstRate": 18,
                "items": [{"itemTypeId": it_id, "description": "WA item", "quantity": 5, "uom": "Pcs", "unitPrice": 100}]})
            check("weighted average + switch on: selling with no stock is refused (409)", r.status_code == 409,
                  f"{r.status_code} {r.text[:300]}")
        finally:
            if wa and not args.keep:
                call("DELETE", f"/companies/{wa}")
    finally:
        if not args.keep:
            call("DELETE", f"/companies/{cid}")

    failed = sum(1 for ok, _ in results if not ok)
    print(f"\n{len(results) - failed}/{len(results)} sale-by-value checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
