"""SRB / non-FBR bills on the importer line (ported from Trader).

A company the seed admin has switched to "Allow SRB / non-FBR bills" may raise
a bill with tax treatment SRB (any rate 0-100) or NoTax (0%). Such a bill is a
real sale -- stock, balances and the sales report carry it -- but it is never
sent to FBR and stays out of FBR's tax figures. What the importer adds over
Trader: the imported-rate guard does not apply to it, its goods still leave
stock, and the Import Tax Desk's output tax leaves it out.

Usage: python scripts/test_importer_non_fbr_bills.py --base http://localhost:5134
Local only: it creates throwaway companies and deletes them.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import date, datetime

HS_A = "8518.2990"  # a real tariff code; its opening stock is recorded at 18%

passed = 0
failures: list[str] = []


def check(name, ok, detail=""):
    global passed
    if ok:
        passed += 1
        print(f"  PASS {name}")
    else:
        failures.append(name)
        print(f"  FAIL {name}  {detail}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--pw", default="admin123")
    a = ap.parse_args()
    assert "localhost" in a.base or "127.0.0.1" in a.base, "local only"

    def http(method, path, body=None, token=None, params=None):
        url = a.base + path
        if params:
            url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
        req = urllib.request.Request(url, method=method,
                                     data=json.dumps(body).encode() if body is not None else None)
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return r.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw) if raw else None
            except ValueError:
                return e.code, raw.decode(errors="replace")

    s, d = http("POST", "/api/auth/login", {"username": a.user, "password": a.pw})
    assert s == 200, f"login {s} {d}"
    tok = d["token"]

    def api(method, path, body=None, params=None, token=None):
        return http(method, path, body, token or tok, params)

    stamp = datetime.now().strftime("%m%d%H%M%S")
    today = date.today().isoformat()
    s, co = api("POST", "/api/companies", {
        "name": f"ZZ SRB {stamp}", "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingCreditNoteNumber": 1, "startingDebitNoteNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnabled": False, "inventoryTrackingEnabled": True, "enableGl": False,
    })
    assert s in (200, 201), f"company {s} {co}"
    cid = co["id"]
    user_id = role_id = None
    try:
        s, client = api("POST", "/api/clients", {"companyId": cid, "name": f"ZZ Buyer {stamp}",
                                                 "registrationType": "Unregistered"})
        assert s in (200, 201), f"client {s} {client}"
        s, item = api("POST", "/api/itemtypes", {"name": f"ZZ Speaker {stamp}", "hsCode": HS_A, "uom": "Pcs",
                                                 "companyId": cid, "isFavorite": True}, params={"companyId": cid})
        assert s in (200, 201), f"item {s} {item}"
        s, r = api("POST", "/api/stock/opening", {
            "companyId": cid, "itemTypeId": item["id"], "quantity": 100, "valueExcludingTax": 100000,
            "salesTaxRate": 18, "asOfDate": "2026-07-01", "notes": "srb test"})
        assert s in (200, 201), f"opening {s} {r}"

        def bill(kind="FBR", rate=18, qty=2, **extra):
            body = {"companyId": cid, "clientId": client["id"], "date": today, "gstRate": rate,
                    "taxTreatment": kind,
                    "items": [{"description": "ZZ Speaker", "quantity": qty, "unitPrice": 5000,
                               "UOM": "Pcs", "itemTypeId": item["id"]}]}
            body.update(extra)
            return api("POST", "/api/invoices/standalone", body)

        def onhand():
            _, rows = api("GET", f"/api/stock/company/{cid}/onhand")
            return next((r["onHand"] for r in rows or [] if r["itemTypeId"] == item["id"]), None)

        print("\n=== Off by default ===")
        check("a new company starts with SRB / non-FBR bills off", co.get("allowNonFbrBills") is False, str(co.get("allowNonFbrBills")))
        s, _ = bill("SRB", 15)
        check("an SRB bill is refused while the switch is off", s == 400, str(s))
        s, normal = bill("FBR", 18)
        check("an FBR bill is unchanged (18%, 1,800 tax)",
              s in (200, 201) and normal["taxTreatment"] == "FBR" and normal["gstAmount"] == 1800, f"{s} {normal}")

        print("\n=== Only the seed admin flips the switch ===")
        s, full = api("GET", f"/api/companies/{cid}")
        full["allowNonFbrBills"] = True
        s, _ = api("PUT", f"/api/companies/{cid}", full)
        check("the seed admin switches it on", s in (200, 204), str(s))

        uname = f"zz_srb_{stamp}"
        s, u = api("POST", "/api/users", {"username": uname, "fullName": "ZZ SRB tester",
                                          "password": "Srb-test-123!", "role": "User"})
        assert s in (200, 201), f"user {s} {u}"
        user_id = u["id"]
        s, role = api("POST", "/api/roles", {"name": uname, "permissionKeys": [
            "companies.manage.view", "companies.manage.update", "bills.list.view"]})
        assert s in (200, 201), f"role {s} {role}"
        role_id = role["id"]
        api("PUT", f"/api/users/{user_id}/roles", {"roleIds": [role_id]})
        api("PUT", f"/api/usercompanies/user/{user_id}", {"companyIds": [cid]})
        s, ld = http("POST", "/api/auth/login", {"username": uname, "password": "Srb-test-123!"})
        utok = ld["token"]
        off = dict(full, allowNonFbrBills=False)
        s, _ = api("PUT", f"/api/companies/{cid}", off, token=utok)
        check("a user with company edit rights cannot switch it", s == 403, str(s))

        print("\n=== An SRB bill ===")
        before = onhand()
        s, srb = bill("SRB", 25, qty=3)
        check("an SRB bill at 25% saves", s in (200, 201), f"{s} {srb}")
        check("its tax is 25% of the value (3,750) and inside the total",
              srb["gstAmount"] == 3750 and srb["grandTotal"] == 18750, f"{srb['gstAmount']} {srb['grandTotal']}")
        check("the imported-rate guard does not refuse it (goods came in at 18%)", srb["taxRateOverrideReason"] is None)
        check("it is never FBR ready", srb["fbrReady"] is False)
        check("its goods leave stock like any sale", before is not None and onhand() == before - 3, f"{before} -> {onhand()}")
        s, _ = bill("FBR", 25)
        check("the same 25% on an FBR bill is still refused by the imported-rate guard", s == 400, str(s))

        print("\n=== Never sent to FBR ===")
        for verb, path in [("POST", "validate"), ("POST", "submit"), ("GET", "preview-payload")]:
            s, r = api(verb, f"/api/fbr/{srb['id']}/{path}")
            check(f"FBR {path} refuses it", not (r or {}).get("success", False) and "outside FBR" in json.dumps(r), f"{s} {r}")
        s, r = api("POST", f"/api/fbr/{srb['id']}/reset-submission",
                   {"mode": "recordManual", "reason": "test", "manualFbrInvoiceNumber": "X-1"})
        check("it cannot be recorded as filed on FBR's portal", "outside FBR" in json.dumps(r), f"{s} {r}")
        s, pr = api("GET", f"/api/invoices/{srb['id']}/print/tax-invoice")
        check("the print carries the SRB label", s == 200 and pr["taxTreatment"] == "SRB" and pr["taxLabel"] == "SRB sales tax", f"{s}")

        print("\n=== Edits ===")
        s, ed = api("PUT", f"/api/invoices/{srb['id']}", {"gstRate": 12.5, "items": srb["items"]})
        check("an edit that omits the treatment keeps SRB, at the new rate",
              s == 200 and ed["taxTreatment"] == "SRB" and ed["gstAmount"] == 1875, f"{s} {ed if s != 200 else ed['gstAmount']}")
        s, _ = api("PUT", f"/api/invoices/{srb['id']}", {"gstRate": 15, "furtherTaxRate": 4, "items": srb["items"]})
        check("further tax is refused on an SRB bill", s == 400, str(s))

        print("\n=== No tax, and bad input ===")
        s, nt = bill("NoTax", 0)
        check("a no-tax bill saves at zero", s in (200, 201) and nt["gstAmount"] == 0 and nt["grandTotal"] == 10000, f"{s}")
        for kind, rate in [("bogus", 15), ("SRB", 101), ("SRB", -1), ("NoTax", 15)]:
            s, _ = bill(kind, rate)
            check(f"{kind} at {rate}% is refused", s == 400, str(s))

        print("\n=== FBR figures leave it out; sales keep it ===")
        y, m = date.today().year, date.today().month
        # The tax sheet lists lines still to be classified, so these use an item with no HS code.
        s, cat = api("POST", "/api/itemtypes", {"name": f"ZZ Service {stamp}", "uom": "Pcs",
                                                "companyId": cid, "isFavorite": True}, params={"companyId": cid})
        assert s in (200, 201), f"category {s} {cat}"
        def plain(kind, rate):
            s, b = api("POST", "/api/invoices/standalone", {
                "companyId": cid, "clientId": client["id"], "date": today, "gstRate": rate, "taxTreatment": kind,
                "items": [{"description": f"ZZ service {kind}", "quantity": 1, "unitPrice": 1000, "UOM": "Pcs",
                           "itemTypeId": cat["id"]}]})
            assert s in (200, 201), f"plain {kind} {s} {b}"
            return b
        plain_fbr = plain("FBR", 18)
        plain_srb = plain("SRB", 15)
        s, ts = api("GET", f"/api/reports/company/{cid}/tax-sheet", params={"year": y, "month": m})
        nums = [str(r.get("documentNumber")) for r in (ts or {}).get("rows", [])]
        check("the tax sheet lists the FBR bill",
              any(n.endswith(str(plain_fbr["invoiceNumber"])) for n in nums), str(nums))
        check("the tax sheet leaves the SRB bill out",
              not any(n.endswith(str(plain_srb["invoiceNumber"])) for n in nums), str(nums))
        s, rep = api("GET", f"/api/reports/company/{cid}/invoice-sales-detail", params={"period": "thismonth"})
        check("the sales detail keeps it, marked Outside FBR",
              any(r["invoiceId"] == srb["id"] and "Outside FBR" in r["fbrStatus"] for r in (rep or {}).get("rows", [])),
              f"{s}")
        s, ws = api("GET", f"/api/import-tax/company/{cid}/input-tax", params={"from": f"{y}-{m:02d}", "to": f"{y}-{m:02d}"})
        out = sum(x["outputTax"] for x in (ws or {}).get("months", []))
        fbr_out = normal["gstAmount"] + plain_fbr["gstAmount"]
        check("the Import Tax Desk output tax is the FBR bills' only", s == 200 and out == fbr_out, f"{s} {out}")
        s, tp = api("GET", "/api/dashboard/tax-position", params={"companyId": cid})
        check("the dashboard's Payable to FBR output tax is the FBR bill's only",
              s == 200 and tp["outputTax"] == fbr_out, f"{s} {tp and tp.get('outputTax')}")

        print("\n=== Switching off ===")
        s, full = api("GET", f"/api/companies/{cid}")
        full["allowNonFbrBills"] = False
        api("PUT", f"/api/companies/{cid}", full)
        s, _ = bill("SRB", 15)
        check("no new SRB bill once switched off", s == 400, str(s))
        s, keep = api("PUT", f"/api/invoices/{srb['id']}", {"gstRate": 10, "items": srb["items"]})
        check("an existing SRB bill stays SRB and editable", s == 200 and keep["taxTreatment"] == "SRB", f"{s}")
    finally:
        if user_id:
            api("DELETE", f"/api/users/{user_id}")
        if role_id:
            api("DELETE", f"/api/roles/{role_id}")
        s, _ = api("DELETE", f"/api/companies/{cid}")
        print(f"\n  teardown: company delete {s}")

    print(f"\n{passed}/{passed + len(failures)} non-FBR bill checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
