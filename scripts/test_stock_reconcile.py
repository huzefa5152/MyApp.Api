#!/usr/bin/env python3
"""
Reconcile to my stock sheet, end to end (2026-10-03). Rules: CLAUDE.md 5b-17.

A fresh FIFO company holds two items. Its stock sheet says:

    item     on books        sheet rows                       expectation
    VALVE    100 / 10,000    GD-R1 60 / 7,000, GD-R2 30 / 2,000   counted 90 != 100:
                                                               quantity correction PROPOSED
    PUMP     100 / 20,000    GD-R3 59.3712 / 9,000,             derived 59.3712: books' 100
                             GD-R4 40 / 12,000                  kept, gap on the derived line
    (none)   --              GD-R5 under an unknown HS code      unmatched -> must be decided

    1. The plan says what will happen and refuses Apply while a row is undecided.
    2. Leaving that row out makes the plan applicable.
    3. Apply corrects VALVE to 90 (dated at the sheet's month end) and restates
       both items to the sheet's GD lines; PUMP keeps 100 units.
    4. Re-planning the same sheet afterwards finds nothing left to change.
    6. The sample sheet the screen offers reads for reconcile even after the
       same file was imported as opening stock (the "already imported" checks
       belong to importing, not reconciling).
    5. A plan for a company that does not exist is refused (cross-company:
       test_tenant_isolation.py suite 21).

Usage:
    python scripts/test_stock_reconcile.py [--base URL] [--username U] [--password P] [--keep]
"""
import argparse
import os
import sys
from datetime import datetime

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


def check(name, ok, detail=""):
    results.append(("PASS" if ok else "FAIL", name, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" -- {detail}" if detail and not ok else ""))
    return ok


def near(a, b, tol=0.02):
    try:
        return abs(float(a) - float(b)) <= tol
    except (TypeError, ValueError):
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    api = a.base.rstrip("/") + "/api"
    r = requests.post(f"{api}/auth/login", json={"username": a.username, "password": a.password}, timeout=60)
    if not r.ok:
        print(f"FATAL: login failed ({r.status_code})")
        return 2
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    tag = datetime.now().strftime("%m%d%H%M%S")

    r = requests.post(f"{api}/companies", headers=h, timeout=60, json={
        "name": f"_reconcile {tag}", "brandName": "RECON", "fullAddress": "1 Test Street",
        "phone": "021-0000000", "ntn": "1234567-8", "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
        "fbrEnabled": False, "inventoryTrackingEnabled": True, "enableGl": False})
    if not r.ok:
        print(f"FATAL: create company ({r.status_code} {r.text[:200]})")
        return 2
    cid = r.json()["id"]
    item_ids = []
    try:
        def item(name, hs):
            r = requests.post(f"{api}/itemtypes", headers=h, params={"companyId": cid}, timeout=60,
                              json={"name": name, "hsCode": hs, "uom": "Pcs", "isFavorite": True})
            r.raise_for_status()
            item_ids.append(r.json()["id"])
            return r.json()["id"]

        valve = item(f"RECON VALVE {tag}", "8481.8090")
        pump = item(f"RECON PUMP {tag}", "8413.7090")
        for iid, value in ((valve, 10000), (pump, 20000)):
            r = requests.post(f"{api}/stock/opening", headers=h, timeout=60, json={
                "companyId": cid, "itemTypeId": iid, "quantity": 100, "valueExcludingTax": value,
                "salesTaxRate": 18, "asOfDate": "2026-07-01"})
            check(f"opening set for item {iid}", r.ok, r.text[:200])

        def row(n, gd, hs, name, qty, value):
            return {"sourceRow": n, "itemNameOnSheet": name, "hsCode": hs, "lotRef": gd, "lotDate": "2026-07-15",
                    "claimMonth": "2026-07-01", "unit": "Pcs", "balanceQuantity": qty,
                    "balanceValueExcludingTax": value, "balanceSalesTaxRate": 18}

        rows = [row(4, "GD-R1", "8481.8090", f"RECON VALVE {tag}", 60, 7000),
                row(5, "GD-R2", "8481.8090", f"RECON VALVE {tag}", 30, 2000),
                row(6, "GD-R3", "8413.7090", f"RECON PUMP {tag}", 59.3712, 9000),
                row(7, "GD-R4", "8413.7090", f"RECON PUMP {tag}", 40, 12000),
                row(8, "GD-R5", "9999.9999", "MYSTERY GOODS", 5, 500)]
        req = {"asOf": "2026-09-30", "sourceFile": "recon.xlsx", "rows": rows}

        print("\n-- 1. The plan --")
        r = requests.post(f"{api}/stock/company/{cid}/reconcile/plan", headers=h, json=req, timeout=120)
        p = r.json() if r.ok else {}
        items = {i["itemTypeId"]: i for i in p.get("items", [])}
        check("the plan answers", r.ok, f"http {r.status_code}: {r.text[:200]}")
        check("an unknown HS code is a question, not a guess",
              [u["sourceRow"] for u in p.get("unmatched", [])] == [8], str(p.get("unmatched")))
        check("Apply is refused while a row is undecided", p.get("canApply") is False)
        v = items.get(valve, {})
        check("VALVE: counted 90 against 100 -> a quantity correction is proposed",
              v.get("proposeSheetQuantity") is True and near(v.get("sheetQuantity"), 90, 1e-4), str(v)[:200])
        pm = items.get(pump, {})
        check("PUMP: a derived 59.3712 is not proposed; the books' 100 is kept",
              pm.get("proposeSheetQuantity") is False and near(pm.get("targetQuantity"), 100, 1e-4)
              and any(near(l["quantity"], 60, 1e-4) for l in pm.get("lines", [])), str(pm)[:300])

        print("\n-- 2. Leave the unknown row out --")
        rows[4]["chosenItemTypeId"] = -1
        r = requests.post(f"{api}/stock/company/{cid}/reconcile/plan", headers=h, json=req, timeout=120)
        p = r.json() if r.ok else {}
        check("the plan becomes applicable", r.ok and p.get("canApply") is True,
              f"{r.status_code} unmatched={p.get('unmatched')} errors={[i.get('error') for i in p.get('items', [])]}")
        check("and the plan's value is the sheet's for the two items",
              near(p.get("plannedValueExcludingTax"), 9000 + 21000), str(p.get("plannedValueExcludingTax")))

        print("\n-- 3. Apply --")
        req["useSheetQuantityItemTypeIds"] = [valve]
        r = requests.post(f"{api}/stock/company/{cid}/reconcile/apply", headers=h, json=req, timeout=300)
        check("Apply succeeds", r.ok and r.json().get("applied") is True, f"http {r.status_code}: {r.text[:300]}")
        oh = {x["itemTypeId"]: x for x in requests.get(f"{api}/stock/company/{cid}/onhand", headers=h, timeout=60).json()}
        check("VALVE corrected to 90 / 9,000", near(oh[valve]["onHand"], 90, 1e-4) and near(oh[valve]["valueExcludingTax"], 9000),
              f"{oh[valve]['onHand']} / {oh[valve]['valueExcludingTax']}")
        check("PUMP keeps 100 units, valued at the sheet's 21,000",
              near(oh[pump]["onHand"], 100, 1e-4) and near(oh[pump]["valueExcludingTax"], 21000),
              f"{oh[pump]['onHand']} / {oh[pump]['valueExcludingTax']}")
        mv = requests.get(f"{api}/stock/company/{cid}/movements", headers=h, timeout=60,
                          params={"itemTypeId": valve, "pageSize": 50}).json().get("items", [])
        check("the quantity correction is dated at the sheet's month end",
              any(m["sourceType"] == "Adjustment" and m["movementDate"][:10] == "2026-09-30" for m in mv),
              str([(m["sourceType"], m["movementDate"][:10]) for m in mv]))
        # The restatement too (2026-10-05): dated "today" it sat after the month it
        # restated, and that month's sheet, Annex-H1 and tie-out never saw it.
        check("the GD restatement is dated at the sheet's month end, not today",
              any(m["sourceType"] == "Revaluation" and m["movementDate"][:10] == "2026-09-30" for m in mv)
              and not any(m["sourceType"] == "Revaluation" and m["movementDate"][:10] != "2026-09-30" for m in mv),
              str([(m["sourceType"], m["movementDate"][:10]) for m in mv]))
        gd = requests.get(f"{api}/stock/company/{cid}/gd-details", headers=h, timeout=60).json()
        names = sorted({g["gdNumber"] for g in gd})
        check("both items now hold the sheet's GD lines", {"GD-R1", "GD-R2", "GD-R3", "GD-R4"} <= set(names), str(names))

        print("\n-- 4. Re-plan the same sheet --")
        req.pop("useSheetQuantityItemTypeIds", None)
        p = requests.post(f"{api}/stock/company/{cid}/reconcile/plan", headers=h, json=req, timeout=120).json()
        changed = [i["itemTypeName"] for i in p.get("items", [])
                   if not near(i["targetValueExcludingTax"], i["currentValueExcludingTax"], 0.01)
                   or (i["useSheetQuantity"] and not near(i["sheetQuantity"], i["onHand"], 1e-4))]
        check("nothing is left to change", not changed, str(changed))

        print("\n-- 5. A company that does not exist --")
        # Cross-company access is pinned in test_tenant_isolation.py suite 21;
        # here the seed admin passes the access guard and the request must still
        # be refused before anything is read or written.
        r = requests.post(f"{api}/stock/company/999999999/reconcile/plan", headers=h, json=req, timeout=60)
        check("a company that does not exist is refused", r.status_code in (400, 403, 404), str(r.status_code))

        print("\n-- 6. The sample sheet reads for reconcile after being imported --")
        sample = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "myapp-frontend", "public",
                              "templates", "opening-stock-template.xlsx")
        body = open(sample, "rb").read()
        r = requests.post(f"{api}/companies", headers=h, timeout=60, json={
            "name": f"_reconcile sample {tag}", "brandName": "RECS", "fullAddress": "1 Test Street",
            "phone": "021-0000000", "ntn": "1234567-8", "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "fbrEnabled": False, "inventoryTrackingEnabled": True, "enableGl": False})
        sample_co = r.json()["id"] if r.ok else None
        profiles = requests.get(f"{api}/import-profiles", headers=h, timeout=60,
                                params={"kind": "OpeningStock", "companyId": sample_co}).json() or []
        prof = next((x for x in profiles if x.get("isDefault")), profiles[0] if profiles else {})

        def preview(purpose=None):
            params = {"companyId": sample_co, "profileId": prof.get("id")}
            if purpose:
                params["purpose"] = purpose
            return requests.post(f"{api}/spreadsheet-import/opening-stock/preview", headers=h, timeout=120,
                                 params=params, files={"file": ("opening-stock-template.xlsx", body)})

        pv = preview().json()
        check("the sample sheet reads cleanly as opening stock", not pv.get("blockingErrors") and len(pv.get("rows", [])) > 0,
              str(pv.get("blockingErrors"))[:200])
        r = requests.post(f"{api}/spreadsheet-import/opening-stock/commit", headers=h, timeout=300, json={
            "companyId": sample_co, "importProfileId": pv.get("importProfileId"), "profileVersion": pv.get("profileVersion"),
            "fileSha256": pv["fileSha256"], "fileName": "opening-stock-template.xlsx",
            "fileSizeBytes": pv["fileSizeBytes"], "asOfDate": "2026-07-01",
            "postInventoryValue": False, "enableInventoryTracking": True,
            "rows": [{"itemName": x["itemName"], "hsCode": x["hsCode"], "isHsCodePartial": x["isHsCodePartial"],
                      "unit": x["unit"], "quantity": x["quantity"], "value": x["value"], "lotRefs": x["lotRefs"],
                      "itemTypeId": x["itemTypeId"], "lots": x.get("lots")} for x in pv["rows"]]})
        check("the sample imports as opening stock", r.ok, f"http {r.status_code} {r.text[:200]}")
        again = preview().json()
        check("importing the same file again is refused as already imported",
              any("already imported" in e or "already been imported" in e for e in again.get("blockingErrors", [])),
              str(again.get("blockingErrors"))[:200])
        rec = preview("reconcile").json()
        check("reading the same file for reconcile is not refused, and returns its rows",
              not rec.get("blockingErrors") and len(rec.get("rows", [])) == len(pv["rows"]),
              f"{rec.get('blockingErrors')} rows={len(rec.get('rows', []))}")
    finally:
        if not a.keep:
            requests.delete(f"{api}/companies/{cid}", headers=h, timeout=300)
            if "sample_co" in locals() and sample_co:
                requests.delete(f"{api}/companies/{sample_co}", headers=h, timeout=300)
            for iid in item_ids:
                requests.delete(f"{api}/itemtypes/{iid}", headers=h, timeout=60)

    failed = [x for x in results if x[0] == "FAIL"]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} checks passed ===")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
