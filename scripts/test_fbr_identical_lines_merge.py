"""
Lines FBR cannot tell apart are filed as one item; the bill keeps them apart.

ProductDescription is filed blank on this line, so two item types with the same
HS code, unit, sale type and SRO reach PRAL as identical items and the second is
refused "DUPLICATE INVOICE EXISTS" (importer bill 115, 2026-11-12). The FBR
payload now sums them; the bill, its lines and their HS codes stay as entered.

Runs against a LOCAL backend on a throwaway company. The preview endpoint builds
the payload without sending anything, so the dummy token never reaches PRAL.

  python scripts/test_fbr_identical_lines_merge.py --base http://localhost:5134
"""
import argparse, json, sys, urllib.error, urllib.request
from datetime import datetime

results = []


def http(base, method, path, token=None, body=None):
    req = urllib.request.Request(base.rstrip("/") + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def check(name, ok, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" -- {detail}"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    a = ap.parse_args()
    b = a.base

    s, login = http(b, "POST", "/api/auth/login", body={"username": a.user, "password": a.password})
    if s != 200:
        sys.exit(f"login failed: {s} {login}")
    t = login["token"]
    tag = datetime.now().strftime("%Y%m%d%H%M%S")

    s, co = http(b, "POST", "/api/companies", t, {
        "name": f"_test_fbr_merge {tag}", "fullAddress": "Test HQ", "ntn": "9999999",
        "fbrEnabled": True, "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Importer", "fbrSector": "All Other Sectors",
        "fbrToken": "test-token-not-used-for-real-pral-calls", "fbrSellerNtnCnic": "9999999",
        "startingInvoiceNumber": 1, "inventoryTrackingEnabled": False, "enableGl": False})
    if s not in (200, 201):
        sys.exit(f"create company failed: {s} {co}")
    cid = co["id"]
    made_items, made_bills = [], []
    try:
        s, cl = http(b, "POST", "/api/clients", t, {
            "name": f"Test Buyer {tag}", "address": "1 Test Road, Karachi", "companyId": cid,
            "ntn": "1234567", "fbrProvinceCode": 8, "registrationType": "Registered"})
        assert s in (200, 201), f"create client: {s} {cl}"

        def item(name, hs):
            s, it = http(b, "POST", f"/api/itemtypes?companyId={cid}", t, {
                "name": f"{name} {tag}", "hsCode": hs, "uom": "Numbers, pieces, units",
                "fbrUOMId": 69, "saleType": None, "isFavorite": True})
            assert s in (200, 201), f"create item {name}: {s} {it}"
            made_items.append(it["id"])
            return it

        track = item("Rail Track", "9405.1190")
        light = item("Rail Track Light", "9405.1190")
        panel = item("Panel Light", "9405.4200")

        def line(it, qty, price, desc):
            return {"itemTypeId": it["id"], "description": desc, "quantity": qty, "unitPrice": price,
                    "uom": "Numbers, pieces, units", "hsCode": it["hsCode"], "fbrUOMId": 69,
                    "saleType": "Exempt Goods", "sroScheduleNo": "6th Schd Table I", "sroItemSerialNo": "100"}

        s, bill = http(b, "POST", "/api/invoices/standalone", t, {
            "date": datetime.utcnow().strftime("%Y-%m-%dT00:00:00Z"), "companyId": cid,
            "clientId": cl["id"], "gstRate": 0, "taxTreatment": "FBR", "scenarioId": "SN006",
            "documentType": 4, "paymentMode": "Credit",
            "items": [line(track, 1, 3000, "Track"), line(light, 4, 4500, "Track light"),
                      line(panel, 2, 1000, "Panel")]})
        assert s in (200, 201), f"create bill: {s} {bill}"
        made_bills.append(bill["id"])

        print("\n[1. Filing merges the lines FBR cannot tell apart]")
        s, pv = http(b, "GET", f"/api/fbr/{bill['id']}/preview-payload?scenarioId=SN006", t)
        check("preview builds", s == 200 and pv.get("success"), f"{s} {pv}")
        p = pv.get("preview") or {}
        items = json.loads(p.get("json") or "{}").get("items", [])
        check("3 bill lines -> 2 FBR items", p.get("originalLineCount") == 3 and p.get("itemCount") == 2,
              f"lines={p.get('originalLineCount')} items={p.get('itemCount')}")
        same = [i for i in items if i["hsCode"] == "9405.1190"]
        check("one item for HS 9405.1190", len(same) == 1, f"{len(same)} items")
        if same:
            check("its quantity is 1 + 4", float(same[0]["quantity"]) == 5, same[0]["quantity"])
            check("its value is 3,000 + 18,000", float(same[0]["valueSalesExcludingST"]) == 21000,
                  same[0]["valueSalesExcludingST"])
        check("the other HS stays its own item", sum(i["hsCode"] == "9405.4200" for i in items) == 1)

        print("\n[2. The bill keeps every line]")
        s, d = http(b, "GET", f"/api/invoices/{bill['id']}", t)
        lines = d.get("items", []) if s == 200 else []
        check("still 3 lines", len(lines) == 3, f"{len(lines)}")
        check("each line keeps its HS code",
              sorted(l["hsCode"] for l in lines) == ["9405.1190", "9405.1190", "9405.4200"],
              [l["hsCode"] for l in lines])
        check("each line keeps its item and description",
              sorted((l["itemTypeId"], l["description"]) for l in lines)
              == sorted([(track["id"], "Track"), (light["id"], "Track light"), (panel["id"], "Panel")]))
    finally:
        for bid in made_bills:
            http(b, "DELETE", f"/api/invoices/{bid}", t)
        for iid in made_items:
            http(b, "DELETE", f"/api/itemtypes/{iid}", t)
        http(b, "DELETE", f"/api/companies/{cid}", t)

    passed = sum(results)
    print(f"\n=== {passed}/{len(results)} FBR merge checks passed ===")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
