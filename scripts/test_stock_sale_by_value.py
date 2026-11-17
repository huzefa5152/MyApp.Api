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
     5. An invoice for more than the stock is worth is refused.
     6. Editing an invoice's amount moves the stock by the difference.
     7. Deleting an invoice puts its amount back.
     8. A back-dated invoice entered now sells by value too. Every invoice
        entered before the deploy keeps its quantity: a fresh suite cannot
        create one, so the read-only production check proves that part.
     9. The bill cost check shows no gap on a sale by value.
    10. MCP: an invoice made through prepare_bill sells by value too.

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

    def gd(number, gd_date, qty, selling):
        line = {"gdNumber": number, "gdDate": gd_date, "description": name, "hsCode": hs, "quantity": qty,
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

        print("\n-- 5. More than the stock is worth is refused --")
        r = invoice("2026-11-07", 1, 1000000)
        check("an invoice of 1,000,000 against 140,010 of stock is refused (409)", r.status_code == 409, f"{r.status_code} {r.text[:200]}")
        check("and says amount, value and to enter the GD first",
              "stock value" in r.text and "GD" in r.text, r.text[:300])

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
    finally:
        if not args.keep:
            call("DELETE", f"/companies/{cid}")

    failed = sum(1 for ok, _ in results if not ok)
    print(f"\n{len(results) - failed}/{len(results)} sale-by-value checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
