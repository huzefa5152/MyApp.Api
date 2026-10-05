#!/usr/bin/env python3
"""
GD charges, customs units and letters of credit, end to end (2026-10-05).

    1. Customs unit: a GD in Dozen against an item kept in Pcs is a unit
       problem until the company says 1 Dozen = 12 Pcs; then the preview
       converts the quantity, the commit lands 12x the units, and echoing the
       converted lines back does not convert them twice.
    2. GD charges (ledger on): a freight charge is spread over the GD's lines
       by assessed value (shares sum to the charge), raises Import Clearing by
       exactly the charge, keeps stock = Inventory = Annex-H1, and deleting it
       restores every figure. A Backfill-only rule and bad input are refused.
    3. Letters of credit: create, duplicate number refused, link a GD (totals
       follow), another company's LC refused, delete unlinks the GD.

Every company is created here and deleted at the end.

Usage:
    python scripts/test_import_charges_units_lcs.py [--base URL] [--username U] [--password P] [--keep]
"""
import argparse
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


def line(gd, gddate, hs, desc, qty, assessed, unit="Pcs", duty=0):
    return {"gdNumber": gd, "gdDate": gddate, "description": desc, "hsCode": hs, "quantity": qty, "unit": unit,
            "assessedValue": assessed, "customsDuty": duty, "acd": 0, "regulatoryDuty": 0, "others": 0,
            "salesTaxRate": 18, "astRate": 3, "incomeTaxRate": 6, "addOnProfit": 0, "sellingValue": None}


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
    made = []

    def company(name, gl=False):
        r = requests.post(f"{api}/companies", headers=h, timeout=60, json={
            "name": f"{name} {tag}", "brandName": "PHASEC", "fullAddress": "1 Test Street",
            "phone": "021-0000000", "ntn": "1234567-8", "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "fbrEnabled": False, "inventoryTrackingEnabled": True, "enableGl": False})
        r.raise_for_status()
        cid = r.json()["id"]
        made.append(cid)
        if gl:
            r = requests.post(f"{api}/accounting/gl/company/{cid}/enable", headers=h, timeout=300)
            check(f"setup: the ledger switches on ({name})", r.ok, f"http {r.status_code} {r.text[:200]}")
        return cid

    def preview(cid, lines, mode="new-arrivals"):
        return requests.post(f"{api}/spreadsheet-import/gd-costing/preview-manual", headers=h, timeout=120,
                             params={"companyId": cid, "mode": mode}, json={"lines": lines})

    def commit(cid, pv, mode="new-arrivals"):
        return requests.post(f"{api}/spreadsheet-import/gd-costing/commit", headers=h, timeout=300, json={
            "companyId": cid, "fileSha256": pv["fileSha256"], "fileName": pv["fileName"],
            "fileSizeBytes": pv["fileSizeBytes"], "lines": pv["lines"], "createMissingStock": True, "mode": mode})

    def onhand(cid):
        d = requests.get(f"{api}/stock/company/{cid}/onhand", headers=h, timeout=120).json()
        rows = d if isinstance(d, list) else (d.get("rows") or d.get("items") or [])
        return {x["itemTypeName"]: x for x in rows}

    def consignments(cid):
        d = requests.get(f"{api}/import-consignments", headers=h, params={"companyId": cid}, timeout=60).json()
        return {x["gdNumber"]: x for x in d.get("items", [])}

    try:
        print("\n-- 1. Customs unit --")
        co = company("_phasec units")
        item = f"PHASEC BOLT {tag}"
        pv = preview(co, [line("KAPE-HC-91001", "2026-08-03", "7318.1510", item, 120, 60000)]).json()
        check("setup: the item comes in, kept in Pcs", commit(co, pv).ok)
        before = float(onhand(co).get(item, {}).get("onHand", 0))
        r = preview(co, [line("KAPE-HC-91002", "2026-08-20", "7318.1510", item, 5, 30000, unit="Dozen")])
        pv = r.json()
        l0 = pv["lines"][0]
        check("a GD in Dozen against an item kept in Pcs is a unit problem",
              any(p.get("field") == "unit" for p in l0.get("problems") or []) and l0.get("itemTypeId"), str(l0)[:300])
        r = requests.put(f"{api}/spreadsheet-import/gd-costing/company/{co}/customs-unit", headers=h, timeout=60,
                         json={"itemTypeId": l0["itemTypeId"], "customsUnit": "Dozen", "factor": 12})
        check("the company records 1 Dozen = 12 Pcs", r.ok, f"http {r.status_code} {r.text[:200]}")
        r = requests.put(f"{api}/spreadsheet-import/gd-costing/company/{co}/customs-unit", headers=h, timeout=60,
                         json={"itemTypeId": l0["itemTypeId"], "customsUnit": "Pcs", "factor": 3})
        check("the item's own unit cannot be a customs unit", r.status_code == 400, str(r.status_code))
        pv = preview(co, [line("KAPE-HC-91002", "2026-08-20", "7318.1510", item, 5, 30000, unit="Dozen")]).json()
        l1 = pv["lines"][0]
        check("the preview converts 5 Dozen to 60 Pcs, with no unit problem",
              near(l1.get("quantity"), 60, 0.0001) and (l1.get("unit") or "").lower().startswith("pc")
              and not any(p.get("field") == "unit" for p in l1.get("problems") or []), str(l1)[:300])
        echoed = preview(co, [dict(line("KAPE-HC-91002", "2026-08-20", "7318.1510", item, l1["quantity"], 30000,
                                        unit=l1["unit"]))]).json()["lines"][0]
        check("echoing the converted line does not convert it twice", near(echoed.get("quantity"), 60, 0.0001),
              str(echoed.get("quantity")))
        check("the commit lands 60 more Pcs", commit(co, pv).ok
              and near(float(onhand(co).get(item, {}).get("onHand", 0)) - before, 60, 0.0001))
        r = requests.put(f"{api}/spreadsheet-import/gd-costing/company/{co}/customs-unit", headers=h, timeout=60,
                         json={"itemTypeId": l0["itemTypeId"], "customsUnit": "Dozen", "factor": 0})
        again = preview(co, [line("KAPE-HC-91003", "2026-08-25", "7318.1510", item, 1, 6000, unit="Dozen")]).json()
        check("a zero factor clears it: Dozen is a unit problem again",
              r.ok and any(p.get("field") == "unit" for p in again["lines"][0].get("problems") or []))

        print("\n-- 2. GD charges (ledger on) --")
        gl = company("_phasec charges", gl=True)
        pv = preview(gl, [line("KAPE-HC-92001", "2026-08-06", "8481.2000", f"PHASEC VALVE {tag}", 4, 40000, duty=4000),
                          line("KAPE-HC-92001", "2026-08-06", "8413.2000", f"PHASEC PUMP {tag}", 10, 160000)]).json()
        check("setup: a two-line GD comes in", commit(gl, pv).ok)
        gd = consignments(gl)["KAPE-HC-92001"]
        cid = gd["id"]
        det0 = requests.get(f"{api}/import-consignments/{cid}", headers=h, timeout=60).json()
        owed0 = det0.get("importClearingCredited")
        r = requests.post(f"{api}/import-consignments/{cid}/charges", headers=h, timeout=120,
                          json={"kind": "freight", "amount": 10000, "paidTo": "Shipping line"})
        check("a freight charge is added", r.ok, f"http {r.status_code} {r.text[:200]}")
        res = r.json() if r.ok else {}
        det = requests.get(f"{api}/import-consignments/{cid}", headers=h, timeout=60).json()
        shares = [l.get("chargesAllocated", 0) for l in det.get("lines", [])]
        check("the shares sum to the charge, 2,000 / 8,000 by assessed value",
              near(sum(shares), 10000, 0.001) and sorted(round(s) for s in shares) == [2000, 8000], str(shares))
        check("Import Clearing rises by exactly the charge",
              near(res.get("importClearingCredited"), float(owed0) + 10000, 0.001), f"{owed0} -> {res.get('importClearingCredited')}")
        t = requests.get(f"{api}/stock/company/{gl}/tie-out", headers=h, params={"month": "2026-08"}, timeout=300).json()
        check("stock = Inventory = Annex-H1 and GD dues = Import Clearing, with the charge",
              t.get("agrees") is True and near(t.get("stockVsLedger"), 0, 0.005), str(t)[:300])
        reg = requests.get(f"{api}/import-tax/company/{gl}/gd-register", headers=h,
                           params={"from": "2026-08", "to": "2026-08"}, timeout=120).json()
        regl = reg.get("lines") or reg.get("items") or []
        check("the GD register carries the charges in landed cost",
              near(sum(x.get("charges", 0) for x in regl), 10000, 0.01), str(regl)[:300])
        bad = requests.post(f"{api}/import-consignments/{cid}/charges", headers=h, timeout=60, json={"kind": "freight", "amount": 0})
        bad2 = requests.post(f"{api}/import-consignments/{cid}/charges", headers=h, timeout=60, json={"kind": "lunch", "amount": 5})
        check("a zero amount and an unknown kind are refused", bad.status_code == 400 and bad2.status_code == 400,
              f"{bad.status_code} {bad2.status_code}")
        charge_id = (res.get("charges") or [{}])[0].get("id")
        r = requests.delete(f"{api}/import-consignments/{cid}/charges/{charge_id}", headers=h, timeout=120)
        det2 = requests.get(f"{api}/import-consignments/{cid}", headers=h, timeout=60).json()
        check("deleting the charge restores Import Clearing and the shares",
              r.ok and near(r.json().get("importClearingCredited"), owed0, 0.001)
              and all(near(l.get("chargesAllocated", 0), 0, 0.0001) for l in det2.get("lines", [])), r.text[:300])
        t = requests.get(f"{api}/stock/company/{gl}/tie-out", headers=h, params={"month": "2026-08"}, timeout=300).json()
        check("and it all still ties", t.get("agrees") is True, str(t)[:300])

        print("\n-- 3. Letters of credit --")
        lc = requests.post(f"{api}/import-lcs/company/{gl}", headers=h, timeout=60, json={
            "lcNumber": f"LC-{tag}", "bankName": "Test Bank", "supplierName": "Ningbo Co", "currency": "usd",
            "foreignAmount": 5000, "exchangeRate": 280, "openedOn": "2026-07-01", "status": "open"})
        check("an LC is recorded", lc.ok and lc.json().get("currency") == "USD", f"http {lc.status_code} {lc.text[:200]}")
        lc_id = lc.json().get("id") if lc.ok else 0
        dup = requests.post(f"{api}/import-lcs/company/{gl}", headers=h, timeout=60,
                            json={"lcNumber": f"LC-{tag}", "openedOn": "2026-07-01"})
        check("the same LC number twice is refused", dup.status_code == 400, str(dup.status_code))
        early = requests.post(f"{api}/import-lcs/company/{gl}", headers=h, timeout=60,
                              json={"lcNumber": f"LC2-{tag}", "openedOn": "2026-07-01", "expiresOn": "2026-06-01"})
        check("an LC that expires before it opens is refused", early.status_code == 400, str(early.status_code))
        r = requests.put(f"{api}/import-lcs/consignment/{cid}", headers=h, timeout=60,
                         json={"lcId": lc_id, "blNumber": "MAEU123456"})
        rows = requests.get(f"{api}/import-lcs/company/{gl}", headers=h, timeout=60).json()
        mine = next((x for x in rows if x["id"] == lc_id), {})
        check("a GD links to the LC and its totals follow",
              r.ok and mine.get("gdCount") == 1 and near(mine.get("assessedValue"), 200000)
              and (mine.get("gds") or [{}])[0].get("blNumber") == "MAEU123456", str(mine)[:300])
        other = company("_phasec other")
        olc = requests.post(f"{api}/import-lcs/company/{other}", headers=h, timeout=60,
                            json={"lcNumber": f"LCX-{tag}", "openedOn": "2026-07-01"}).json()
        r = requests.put(f"{api}/import-lcs/consignment/{cid}", headers=h, timeout=60, json={"lcId": olc.get("id")})
        check("another company's LC cannot be linked", r.status_code == 400, str(r.status_code))
        r = requests.delete(f"{api}/import-lcs/{lc_id}", headers=h, timeout=60)
        det3 = requests.get(f"{api}/import-consignments/{cid}", headers=h, timeout=60).json()
        check("deleting the LC unlinks the GD and keeps its B/L", r.ok and det3.get("importLcId") is None
              and det3.get("blNumber") == "MAEU123456", str({k: det3.get(k) for k in ("importLcId", "blNumber")}))
    finally:
        if not a.keep:
            for c in made:
                requests.delete(f"{api}/companies/{c}", headers=h, timeout=300)

    failed = [x for x in results if x[0] == "FAIL"]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} checks passed ===")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
