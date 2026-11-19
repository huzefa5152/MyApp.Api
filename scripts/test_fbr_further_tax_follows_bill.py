"""
FBR is sent the further tax the bill carries, and nothing else.

On this line the filing allocates the bill's saved further tax amount across
the filed items, so the two cannot differ. This pins that: the importer line
once filed the statutory 4% for a bill saved at 0% (2026-11-19), and the same
checks run here so that shape of bug cannot arrive unnoticed.

Runs against a LOCAL backend on a throwaway company. The preview endpoint builds
the payload without sending anything, so the dummy token never reaches PRAL.

  python scripts/test_fbr_further_tax_follows_bill.py --base http://localhost:5134 [--keep]
"""
import argparse, json, sys, urllib.error, urllib.request
from datetime import datetime

results = []
STANDARD = "Goods at Standard Rate (default)"


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
    ap.add_argument("--keep", action="store_true", help="leave the throwaway company for a look at the screens")
    a = ap.parse_args()
    b = a.base

    s, login = http(b, "POST", "/api/auth/login", body={"username": a.user, "password": a.password})
    if s != 200:
        sys.exit(f"login failed: {s} {login}")
    t = login["token"]
    tag = datetime.now().strftime("%Y%m%d%H%M%S")

    s, co = http(b, "POST", "/api/companies", t, {
        "name": f"_test_fbr_further {tag}", "fullAddress": "Test HQ", "ntn": "9999999",
        "fbrEnabled": True, "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Importer", "fbrSector": "All Other Sectors",
        "fbrToken": "test-token-not-used-for-real-pral-calls", "fbrSellerNtnCnic": "9999999",
        "startingInvoiceNumber": 1, "inventoryTrackingEnabled": False, "enableGl": False})
    if s not in (200, 201):
        sys.exit(f"create company failed: {s} {co}")
    cid = co["id"]
    made_items, made_bills = [], []
    try:
        def client(name, reg):
            s, cl = http(b, "POST", "/api/clients", t, {
                "name": f"{name} {tag}", "address": "1 Test Road, Karachi", "companyId": cid,
                "ntn": "1234567" if reg == "Registered" else None,
                "fbrProvinceCode": 8, "registrationType": reg})
            assert s in (200, 201), f"create client {name}: {s} {cl}"
            return cl

        unreg = client("Unregistered Buyer", "Unregistered")
        reg = client("Registered Buyer", "Registered")

        s, it = http(b, "POST", f"/api/itemtypes?companyId={cid}", t, {
            "name": f"Further Tax Valve {tag}", "hsCode": "8481.8090", "uom": "Numbers, pieces, units",
            "fbrUOMId": 69, "saleType": STANDARD, "isFavorite": True})
        assert s in (200, 201), f"create item: {s} {it}"
        made_items.append(it["id"])

        # 10 x 1000 = 10,000 net, so 4% is 400 and 3% is 300.
        line = {"itemTypeId": it["id"], "description": "Valve", "quantity": 10, "unitPrice": 1000,
                "uom": "Numbers, pieces, units", "hsCode": "8481.8090", "fbrUOMId": 69,
                "saleType": STANDARD}

        def bill(buyer, rate, scenario="SN002"):
            body = {"date": datetime.now().strftime("%Y-%m-%dT00:00:00Z"), "companyId": cid,
                    "clientId": buyer["id"], "gstRate": 18, "taxTreatment": "FBR",
                    "scenarioId": scenario, "documentType": 4, "paymentMode": "Credit",
                    "items": [line]}
            if rate != "absent":
                body["furtherTaxRate"] = rate
            s, d = http(b, "POST", "/api/invoices/standalone", t, body)
            assert s in (200, 201), f"create bill (rate {rate}): {s} {d}"
            made_bills.append(d["id"])
            return d

        def filed(bill_id, scenario="SN002"):
            """(further tax, sales tax, total) the FBR payload carries, summed over items."""
            s, pv = http(b, "GET", f"/api/fbr/{bill_id}/preview-payload?scenarioId={scenario}", t)
            if s != 200 or not pv.get("success"):
                return None, f"{s} {pv}"
            items = json.loads((pv.get("preview") or {}).get("json") or "{}").get("items", [])
            return (sum(float(i["furtherTax"]) for i in items),
                    sum(float(i["salesTaxApplicable"]) for i in items),
                    sum(float(i["totalValues"]) for i in items)), ""

        expected = {}  # bill id -> the further tax it should carry everywhere

        def expect(name, bill_id, further, scenario="SN002"):
            expected[bill_id] = further
            got, err = filed(bill_id, scenario)
            if got is None:
                check(name, False, err)
                return
            check(name, abs(got[0] - further) < 0.005, f"FBR would get further tax {got[0]}, expected {further}")
            s, d = http(b, "GET", f"/api/invoices/{bill_id}", t)
            doc = float(d.get("furtherTaxAmount") or 0) if s == 200 else None
            check(f"  and that is what the bill itself charges ({further})",
                  doc is not None and abs(doc - further) < 0.005 and abs(got[0] - doc) < 0.005,
                  f"bill={doc} fbr={got[0]}")
            check("  sales tax is untouched (1,800)", abs(got[1] - 1800) < 0.005, got[1])

        print("\n[1. Unregistered buyer, on create]")
        expect("rate 0 files 0, not the statutory 4%", bill(unreg, 0)["id"], 0)
        expect("no rate sent files 0", bill(unreg, "absent")["id"], 0)
        expect("rate null files 0", bill(unreg, None)["id"], 0)
        b4 = bill(unreg, 4)
        expect("rate 4 files 4% (400)", b4["id"], 400)
        expect("rate 3 files 3% (300), not 4%", bill(unreg, 3)["id"], 300)
        expect("rate 0 with no scenario on the bill still files 0", bill(unreg, 0, scenario=None)["id"], 0)

        print("\n[2. Unregistered buyer, on edit]")
        s, d = http(b, "GET", f"/api/invoices/{b4['id']}", t)
        edit = {"gstRate": 18, "paymentTerms": d.get("paymentTerms"), "items": [{
            "id": l["id"], "description": l.get("description"), "quantity": l["quantity"],
            "unitPrice": l["unitPrice"], "uom": l.get("uom"), "itemTypeId": l.get("itemTypeId"),
            "hsCode": l.get("hsCode"), "fbrUOMId": l.get("fbrUOMId"), "saleType": l.get("saleType"),
        } for l in d["items"]]}
        s, r = http(b, "PUT", f"/api/invoices/{b4['id']}", t, {**edit, "furtherTaxRate": 0})
        check("the 4% bill is edited to 0", s == 200, f"{s} {r}")
        expect("after 4 -> 0 the filing is 0", b4["id"], 0)
        s, r = http(b, "PUT", f"/api/invoices/{b4['id']}", t, {**edit, "furtherTaxRate": 4})
        check("and edited back to 4", s == 200, f"{s} {r}")
        expect("after 0 -> 4 the filing is 4% again", b4["id"], 400)

        print("\n[3. Registered buyer]")
        expect("no rate files 0", bill(reg, "absent", scenario="SN001")["id"], 0, "SN001")
        expect("a rate the operator set is filed (4% = 400)", bill(reg, 4, scenario="SN001")["id"], 400, "SN001")

        print("\n[4. Several lines: the filed items add up to the bill to the paisa]")
        # Three lines of 33.33 at 4% round to 1.33 each (3.99); the bill charges 4.00.
        s, d = http(b, "POST", "/api/invoices/standalone", t, {
            "date": datetime.now().strftime("%Y-%m-%dT00:00:00Z"), "companyId": cid, "clientId": unreg["id"],
            "gstRate": 18, "taxTreatment": "FBR", "scenarioId": "SN002", "documentType": 4, "paymentMode": "Credit",
            "furtherTaxRate": 4, "printGroupTaxInvoiceByItemType": False,
            "items": [{**line, "description": f"Part {n}", "quantity": 1, "unitPrice": 33.33} for n in (1, 2, 3)]})
        assert s in (200, 201), f"create three-line bill: {s} {d}"
        made_bills.append(d["id"])
        s, pv = http(b, "GET", f"/api/fbr/{d['id']}/preview-payload?scenarioId=SN002", t)
        pitems = json.loads(((pv or {}).get("preview") or {}).get("json") or "{}").get("items", []) if s == 200 else []
        filed_total = round(sum(float(i["furtherTax"]) for i in pitems), 2)
        check("the bill charges 4.00", abs(float(d.get("furtherTaxAmount") or 0) - 4.00) < 0.005, d.get("furtherTaxAmount"))
        check("the filing adds up to 4.00 too, whatever the item rounding",
              bool(pitems) and filed_total == 4.00, f"items={[i['furtherTax'] for i in pitems]} total={filed_total}")
    finally:
        if a.keep:
            print(f"kept company {cid}")
            made_bills, made_items, cid = [], [], None
        for bid in made_bills:
            http(b, "DELETE", f"/api/invoices/{bid}", t)
        for iid in made_items:
            http(b, "DELETE", f"/api/itemtypes/{iid}", t)
        if cid:
            http(b, "DELETE", f"/api/companies/{cid}", t)

    passed = sum(results)
    print(f"\n=== {passed}/{len(results)} FBR further tax checks passed ===")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
