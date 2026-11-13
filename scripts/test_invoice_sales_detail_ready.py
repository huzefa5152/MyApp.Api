"""Invoice Sales Detail -> "Ready for FBR": classified bills waiting for FBR, with the filed HS code.

A bill line usually carries no HS code; the consultant classifies it on the Invoices screen
(tax filing rows). The report's HS column shows that filed code, and FBR status "ready" lists
exactly the FBR bills the Tax Sheet does not: not sent, not excluded, every line classified.

Runs against a LOCAL backend on throwaway data it deletes afterwards.

  python scripts/test_invoice_sales_detail_ready.py --base http://localhost:5134
"""
import argparse, io, json, sys, urllib.error, urllib.request, zipfile
from datetime import datetime, timezone

PW = "ReadyCheck#2026"
results = []


def http(base, method, path, token=None, body=None, raw=False):
    req = urllib.request.Request(base.rstrip("/") + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return r.status, data if raw else (json.loads(data) if data else None)
    except urllib.error.HTTPError as e:
        data = e.read().decode()
        try:
            return e.code, json.loads(data)
        except Exception:
            return e.code, data


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" -- {detail}"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    b = ap.parse_args().base
    a = ap.parse_args()
    t = http(b, "POST", "/api/auth/login", body={"username": a.user, "password": a.password})[1]["token"]
    tag = datetime.now().strftime("%H%M%S")
    made_companies, made_users = [], []

    def company(name):
        s, c = http(b, "POST", "/api/companies", t, {"name": f"{name} {tag}", "fullAddress": "Test HQ", "ntn": "9999999",
            "fbrEnabled": True, "fbrEnvironment": "sandbox", "fbrProvinceCode": 8, "fbrBusinessActivity": "Wholesaler",
            "fbrSector": "Wholesale / Retails", "fbrToken": "test-token-not-used", "fbrSellerRegistrationNo": "9999999",
            "startingInvoiceNumber": 1, "inventoryTrackingEnabled": False, "enableGl": False})
        assert s in (200, 201), (s, c)
        made_companies.append(c["id"])
        return c["id"]

    try:
        cid = company("_isd_ready")
        other = company("_isd_ready_other")
        s, cl = http(b, "POST", "/api/clients", t, {"name": f"Buyer {tag}", "address": "1 Test Road, Karachi", "companyId": cid,
            "ntn": "1234567", "fbrProvinceCode": 8, "registrationType": "Registered"})
        assert s in (200, 201), (s, cl)

        def item(name, hs, uom, fu):
            s, it = http(b, "POST", f"/api/itemtypes?companyId={cid}", t, {"name": f"{name} {tag}", "hsCode": hs, "uom": uom,
                "fbrUOMId": fu, "saleType": "Goods at Standard Rate (default)" if hs else None, "isFavorite": True})
            assert s in (200, 201), (s, it)
            return it

        generic = item("Hardware Item", None, "Pcs", None)
        valves = item("Valves", "8481.8090", "Numbers, pieces, units", 69)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

        def bill(desc):
            s, x = http(b, "POST", "/api/invoices/standalone", t, {"date": today, "companyId": cid, "clientId": cl["id"],
                "gstRate": 18, "scenarioId": "SN001", "items": [{"itemTypeId": generic["id"], "description": desc,
                "quantity": 2, "uom": "Pcs", "unitPrice": 500}]})
            assert s in (200, 201), (s, x)
            return x

        def classify(x):
            ed = http(b, "GET", f"/api/invoices/{x['id']}/tax-filing", t)[1]
            line = ed["bill"]["items"][0]
            s, r = http(b, "PUT", f"/api/invoices/{x['id']}/tax-filing", t, {"version": ed["version"], "rows": [{
                "sourceLineIds": [line["id"]], "itemTypeId": valves["id"], "hsCode": "8481.8090", "description": "Valve",
                "uom": "Numbers, pieces, units", "fbrUOMId": 69, "quantity": line["quantity"], "valueExclTax": line["lineTotal"]}]})
            assert s == 200, (s, r)

        ready, todo, excluded = bill("GATE VALVE"), bill("DOOR HINGE"), bill("BALL VALVE")
        classify(ready)
        classify(excluded)
        s, r = http(b, "PUT", f"/api/invoices/{excluded['id']}/fbr-excluded", t, {"excluded": True})
        assert s == 200, (s, r)
        q = f"/api/reports/company/{cid}/invoice-sales-detail?period=thisMonth"

        print("\n[1. Ready for FBR lists classified, unsent, not-excluded bills only]")
        s, rep = http(b, "GET", q + "&fbrStatus=ready", t)
        ids = {r["invoiceId"] for r in rep["rows"]} if s == 200 else set()
        check("ready filter answers", s == 200, f"{s} {rep}")
        check("the classified bill is listed", ready["id"] in ids, ids)
        check("the unclassified bill is not", todo["id"] not in ids, ids)
        check("the bill excluded from FBR is not", excluded["id"] not in ids, ids)
        check("the bill count matches", s == 200 and rep["invoiceCount"] == 1, rep.get("invoiceCount") if s == 200 else "")

        print("\n[2. HS column shows the consultant's classification]")
        s, all_ = http(b, "GET", q, t)
        hs = {r["invoiceId"]: r["hsCode"] for r in all_["rows"]}
        check("a classified line shows its filed HS code", hs.get(ready["id"]) == "8481.8090", hs.get(ready["id"]))
        check("an unclassified line stays blank", hs.get(todo["id"]) == "", hs.get(todo["id"]))
        check("the unfiltered report still lists all three bills", all_["invoiceCount"] == 3, all_["invoiceCount"])

        print("\n[3. The Tax Sheet is the other half]")
        now = datetime.now()
        s, ts = http(b, "GET", f"/api/reports/company/{cid}/tax-sheet?year={now.year}&month={now.month}", t)
        text = json.dumps(ts)
        check("the Tax Sheet lists the unclassified bill", s == 200 and "DOOR HINGE" in text, s)
        check("the Tax Sheet does not list the ready bill", s == 200 and "GATE VALVE" not in text, s)

        print("\n[4. Excel holds the same bills]")
        s, xl = http(b, "GET", f"/api/reports/company/{cid}/invoice-sales-detail/excel?period=thisMonth&fbrStatus=ready", t, raw=True)
        sheet = zipfile.ZipFile(io.BytesIO(xl)).read("xl/sharedStrings.xml").decode() if s == 200 else ""
        check("Excel downloads", s == 200, s)
        check("Excel holds the ready bill's HS code", "8481.8090" in sheet)
        check("Excel leaves out the other bills", "DOOR HINGE" not in sheet and "BALL VALVE" not in sheet)
        s, bad = http(b, "GET", q + "&fbrStatus=nonsense", t)
        check("an unknown status is refused", s == 400, s)

        print("\n[5. Another company's user is refused]")
        s, roles = http(b, "GET", "/api/roles", t)
        sales = next(r for r in roles if r["name"] == "Sales Edition")
        s, u = http(b, "POST", "/api/users", t, {"username": f"isdready{tag}", "fullName": "isd ready", "password": PW, "role": "User"})
        assert s in (200, 201), (s, u)
        made_users.append(u["id"])
        http(b, "PUT", f"/api/users/{u['id']}/roles", t, {"roleIds": [sales["id"]]})
        http(b, "PUT", f"/api/usercompanies/user/{u['id']}", t, {"companyIds": [other]})
        ut = http(b, "POST", "/api/auth/login", body={"username": f"isdready{tag}", "password": PW})[1]["token"]
        s, _ = http(b, "GET", f"/api/reports/company/{other}/invoice-sales-detail?period=thisMonth&fbrStatus=ready", ut)
        check("the user reads their own company", s == 200, s)
        s, _ = http(b, "GET", q + "&fbrStatus=ready", ut)
        check("the user is refused the other company's report", s == 403, s)
        s, _ = http(b, "GET", f"/api/reports/company/{cid}/invoice-sales-detail/excel?period=thisMonth&fbrStatus=ready", ut, raw=True)
        check("and its Excel", s == 403, s)
    finally:
        for uid in made_users:
            http(b, "DELETE", f"/api/users/{uid}", t)
        for c in made_companies:
            for i in (http(b, "GET", f"/api/invoices/company/{c}/paged?page=1&pageSize=200", t)[1] or {}).get("items", []):
                http(b, "PUT", f"/api/invoices/{i['id']}/fbr-excluded", t, {"excluded": False})
                http(b, "DELETE", f"/api/invoices/{i['id']}", t)
            http(b, "DELETE", f"/api/companies/{c}", t)

    passed = sum(results)
    print(f"\n=== {passed}/{len(results)} ready-for-FBR report checks passed ===")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
