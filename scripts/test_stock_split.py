#!/usr/bin/env python3
"""
Split a merged item by GD line, end to end (2026-10-03).

One item ("MIXED SCALE") holds three different products on three GDs -- the
shape a real client ended up with when nine weight-scale products were held as
one item. Set up through Reconcile to my stock sheet:

    GD-S1  KITCHEN SCALE   40 / 20,000
    GD-S2  BATH SCALE      30 / 18,000
    GD-S3  WEIGHT PARTS    30 /  9,000      item total 100 / 47,000

    1. The split tool lists the item's GD lines.
    2. Moving GD-S1 to a NEW item: the source keeps 60 / 27,000 on S2 + S3, the
       new item holds 40 / 20,000 on GD-S1 with its claim month, the company's
       total value is unchanged.
    3. Moving GD-S2 into an EXISTING item adds it there.
    4. Refusals: moving every line, an unknown line, a target that is the source.

Usage:
    python scripts/test_stock_split.py [--base URL] [--username U] [--password P] [--keep]
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
        "name": f"_split {tag}", "brandName": "SPLIT", "fullAddress": "1 Test Street",
        "phone": "021-0000000", "ntn": "1234567-8", "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
        "fbrEnabled": False, "inventoryTrackingEnabled": True, "enableGl": False})
    if not r.ok:
        print(f"FATAL: create company ({r.status_code} {r.text[:200]})")
        return 2
    cid = r.json()["id"]
    item_ids = []

    def onhand():
        return {x["itemTypeId"]: x for x in requests.get(f"{api}/stock/company/{cid}/onhand", headers=h, timeout=60).json()}

    try:
        def item(name):
            r = requests.post(f"{api}/itemtypes", headers=h, params={"companyId": cid}, timeout=60,
                              json={"name": name, "hsCode": "8423.9000", "uom": "Pcs", "isFavorite": True})
            r.raise_for_status()
            item_ids.append(r.json()["id"])
            return r.json()["id"]

        mixed = item(f"MIXED SCALE {tag}")
        other = item(f"OTHER SCALE {tag}")
        for iid, q, v in ((mixed, 100, 47000), (other, 10, 5000)):
            requests.post(f"{api}/stock/opening", headers=h, timeout=60, json={
                "companyId": cid, "itemTypeId": iid, "quantity": q, "valueExcludingTax": v,
                "salesTaxRate": 18, "asOfDate": "2026-07-01"}).raise_for_status()

        def row(n, gd, name, qty, value, itm):
            return {"sourceRow": n, "itemNameOnSheet": name, "hsCode": "8423.9000", "lotRef": gd,
                    "lotDate": "2026-07-10", "claimMonth": "2026-07-01", "unit": "Pcs", "balanceQuantity": qty,
                    "balanceValueExcludingTax": value, "balanceSalesTaxRate": 18, "chosenItemTypeId": itm}

        req = {"asOf": "2026-09-30", "sourceFile": "split-setup.xlsx", "rows": [
            row(1, "GD-S1", "KITCHEN SCALE", 40, 20000, mixed),
            row(2, "GD-S2", "BATH SCALE", 30, 18000, mixed),
            row(3, "GD-S3", "WEIGHT PARTS", 30, 9000, mixed),
            row(4, "GD-O1", "OTHER SCALE", 10, 5000, other)]}
        r = requests.post(f"{api}/stock/company/{cid}/reconcile/apply", headers=h, json=req, timeout=300)
        if not check("setup: the mixed item holds three GD lines", r.ok, f"http {r.status_code}: {r.text[:300]}"):
            return 1
        total_before = sum(x["valueExcludingTax"] for x in onhand().values())

        print("\n-- 1. The item's GD lines --")
        r = requests.get(f"{api}/stock/company/{cid}/split/lines", headers=h, params={"itemTypeId": mixed}, timeout=60)
        lines = r.json() if r.ok else []
        by_gd = {l["gdNumber"]: l for l in lines}
        check("three lines, one per GD", set(by_gd) == {"GD-S1", "GD-S2", "GD-S3"}, str(list(by_gd)))

        print("\n-- 2. Move GD-S1 to a new item --")
        new_name = f"KITCHEN SCALE {tag}"
        r = requests.post(f"{api}/stock/company/{cid}/split", headers=h, timeout=300, json={
            "sourceItemTypeId": mixed, "poolKeys": [by_gd["GD-S1"]["poolKey"]], "newItemName": new_name})
        res = r.json() if r.ok else {}
        check("the split succeeds", r.ok, f"http {r.status_code}: {r.text[:300]}")
        new_id = res.get("targetItemTypeId")
        if new_id:
            item_ids.append(new_id)
        oh = onhand()
        check("the source keeps 60 / 27,000", near(oh[mixed]["onHand"], 60, 1e-4) and near(oh[mixed]["valueExcludingTax"], 27000),
              f"{oh[mixed]['onHand']} / {oh[mixed]['valueExcludingTax']}")
        check("the new item holds 40 / 20,000", new_id in oh and near(oh[new_id]["onHand"], 40, 1e-4)
              and near(oh[new_id]["valueExcludingTax"], 20000), str(oh.get(new_id))[:200])
        check("the company's stock value is unchanged",
              near(sum(x["valueExcludingTax"] for x in oh.values()), total_before), str(total_before))
        r = requests.get(f"{api}/stock/company/{cid}/split/lines", headers=h, params={"itemTypeId": new_id}, timeout=60)
        nl = r.json() if r.ok else []
        check("the new item's line is GD-S1, claim month kept",
              len(nl) == 1 and nl[0]["gdNumber"] == "GD-S1" and (nl[0].get("claimMonth") or "")[:7] == "2026-07", str(nl)[:200])
        src = requests.get(f"{api}/stock/company/{cid}/split/lines", headers=h, params={"itemTypeId": mixed}, timeout=60).json()
        check("the source now holds GD-S2 and GD-S3 only", sorted(l["gdNumber"] for l in src) == ["GD-S2", "GD-S3"], str(src)[:200])

        print("\n-- 3. Move GD-S2 into an existing item --")
        s2 = next(l for l in src if l["gdNumber"] == "GD-S2")
        r = requests.post(f"{api}/stock/company/{cid}/split", headers=h, timeout=300, json={
            "sourceItemTypeId": mixed, "poolKeys": [s2["poolKey"]], "targetItemTypeId": other})
        check("the split into an existing item succeeds", r.ok, f"http {r.status_code}: {r.text[:300]}")
        oh = onhand()
        check("the existing item now holds 40 / 23,000 on two GDs",
              near(oh[other]["onHand"], 40, 1e-4) and near(oh[other]["valueExcludingTax"], 23000),
              f"{oh[other]['onHand']} / {oh[other]['valueExcludingTax']}")
        check("the source keeps 30 / 9,000", near(oh[mixed]["onHand"], 30, 1e-4) and near(oh[mixed]["valueExcludingTax"], 9000),
              f"{oh[mixed]['onHand']} / {oh[mixed]['valueExcludingTax']}")
        check("still no value created or lost", near(sum(x["valueExcludingTax"] for x in oh.values()), total_before))

        print("\n-- 4. Refusals --")
        last = requests.get(f"{api}/stock/company/{cid}/split/lines", headers=h, params={"itemTypeId": mixed}, timeout=60).json()
        r = requests.post(f"{api}/stock/company/{cid}/split", headers=h, timeout=60, json={
            "sourceItemTypeId": mixed, "poolKeys": [l["poolKey"] for l in last], "newItemName": "X"})
        check("moving every line is refused", r.status_code == 400, str(r.status_code))
        r = requests.post(f"{api}/stock/company/{cid}/split", headers=h, timeout=60, json={
            "sourceItemTypeId": mixed, "poolKeys": ["lot-999999"], "newItemName": "X"})
        check("an unknown line is refused", r.status_code == 400, str(r.status_code))
        r = requests.post(f"{api}/stock/company/{cid}/split", headers=h, timeout=60, json={
            "sourceItemTypeId": other, "poolKeys": ["x"], "targetItemTypeId": other})
        check("a target that is the source is refused", r.status_code == 400, str(r.status_code))
    finally:
        if not a.keep:
            requests.delete(f"{api}/companies/{cid}", headers=h, timeout=300)
            for iid in item_ids:
                requests.delete(f"{api}/itemtypes/{iid}", headers=h, timeout=60)

    failed = [x for x in results if x[0] == "FAIL"]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} checks passed ===")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
