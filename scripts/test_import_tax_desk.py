#!/usr/bin/env python3
"""
Import Tax Desk, end to end (2026-10-05).

    1. GD register: a GD costing line's duties and import taxes, its claim
       month and status, and the collectorate / type read from the GD number.
    2. Input-tax worksheet: GD input tax lands in its CLAIM month (not the GD's),
       carries forward with no output tax, and the claim-window list names a GD
       whose input tax was never claimed.
    3. Month-end tie-out: ledger off (stock = Annex-H1) and ledger on (stock =
       Inventory to the paisa now arrivals post at declared value; re-post idempotent).
    4. Refusals: a malformed month, a range past today.

Both companies are created here and deleted at the end.

Usage:
    python scripts/test_import_tax_desk.py [--base URL] [--username U] [--password P] [--keep]
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


def line(gd, gddate, hs, desc, qty, assessed, claim=None, st=18, ast=3, it=6, duty=0, rd=0, others=0):
    d = {"gdNumber": gd, "gdDate": gddate, "description": desc, "hsCode": hs, "quantity": qty, "unit": "Pcs",
         "assessedValue": assessed, "customsDuty": duty, "acd": 0, "regulatoryDuty": rd, "others": others,
         "salesTaxRate": st, "astRate": ast, "incomeTaxRate": it, "addOnProfit": 0, "sellingValue": None}
    if claim:
        d["claimMonth"] = claim
    return d


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

    def company(name):
        r = requests.post(f"{api}/companies", headers=h, timeout=60, json={
            "name": f"{name} {tag}", "brandName": "TAXDESK", "fullAddress": "1 Test Street",
            "phone": "021-0000000", "ntn": "1234567-8", "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "fbrEnabled": False, "inventoryTrackingEnabled": True, "enableGl": False})
        r.raise_for_status()
        made.append(r.json()["id"])
        return r.json()["id"]

    def bring_in(cid, lines):
        pv = requests.post(f"{api}/spreadsheet-import/gd-costing/preview-manual", headers=h, timeout=120,
                           params={"companyId": cid, "mode": "new-arrivals"}, json={"lines": lines}).json()
        r = requests.post(f"{api}/spreadsheet-import/gd-costing/commit", headers=h, timeout=300, json={
            "companyId": cid, "fileSha256": pv["fileSha256"], "fileName": pv["fileName"],
            "fileSizeBytes": pv["fileSizeBytes"], "lines": pv["lines"], "createMissingStock": True,
            "mode": "new-arrivals"})
        return r

    try:
        # A weighted-average company keeps a blank claim month blank, which is
        # what lets the claim-window list be tested.
        wa = company("_taxdesk wa")
        r = requests.put(f"{api}/stock/company/{wa}/costing-method", headers=h, json={"method": "WeightedAverage"}, timeout=60)
        check("setup: a fresh company can stay on the weighted average", r.ok, f"http {r.status_code} {r.text[:200]}")
        # GD-A dated Jan, claimed in Mar; GD-B dated Feb, never claimed (lapsed by Sep).
        r = bring_in(wa, [
            line("KAPE-HC-90001", "2026-01-12", "8481.2000", f"TAXDESK PUMP {tag}", 10, 100000, claim="2026-03-01",
                 duty=10000, rd=5000),
            line("KAPW-HC-90002", "2026-02-20", "8517.6250", f"TAXDESK ROUTER {tag}", 5, 50000),
        ])
        check("setup: two GDs come in", r.ok, f"http {r.status_code} {r.text[:300]}")

        print("\n-- 1. GD register --")
        reg = requests.get(f"{api}/import-tax/company/{wa}/gd-register", headers=h, timeout=60).json()
        by = {l["gdNumber"]: l for l in reg.get("lines", [])}
        a_ = by.get("KAPE-HC-90001", {})
        # Base for sales tax = assessed + duties = 115,000; ST 18% = 20,700; AST 3% = 3,450.
        check("sales tax is 18% of value plus duties", near(a_.get("salesTax"), 20700), str(a_.get("salesTax")))
        check("value added tax is 3% of the same base", near(a_.get("valueAddedTax"), 3450), str(a_.get("valueAddedTax")))
        check("input tax = sales tax + value added tax", near(a_.get("inputTax"), 24150), str(a_.get("inputTax")))
        check("the claimed GD reads claimed in Mar 2026",
              a_.get("claimStatus") == "claimed" and (a_.get("claimMonth") or "")[:7] == "2026-03", str(a_)[:200])
        check("collectorate and type are read from the number",
              a_.get("collectorate") == "KAPE" and a_.get("gdTypeName") == "Home consumption", str(a_)[:200])
        b_ = by.get("KAPW-HC-90002", {})
        check("the unclaimed GD is lapsed (Feb + 6 periods has passed)",
              b_.get("claimStatus") == "lapsed" and (b_.get("claimBy") or "")[:7] == "2026-08", str(b_)[:200])
        check("register totals add up", near(reg.get("totalInputTax"), a_.get("inputTax", 0) + b_.get("inputTax", 0)),
              str(reg.get("totalInputTax")))
        r = requests.get(f"{api}/import-tax/company/{wa}/gd-register", headers=h, params={"unclaimedOnly": "true"}, timeout=60)
        check("the unclaimed filter keeps only the unclaimed GD",
              [l["gdNumber"] for l in r.json().get("lines", [])] == ["KAPW-HC-90002"], r.text[:200])
        r = requests.get(f"{api}/import-tax/company/{wa}/gd-register/excel", headers=h, timeout=60)
        check("the register downloads as Excel", r.ok and r.content[:2] == b"PK", str(r.status_code))

        print("\n-- 2. Input-tax worksheet --")
        w = requests.get(f"{api}/import-tax/company/{wa}/input-tax", headers=h,
                         params={"from": "2026-01", "to": "2026-09"}, timeout=60).json()
        months = {m["month"][:7]: m for m in w.get("months", [])}
        check("the GD's input tax lands in its CLAIM month, not its GD month",
              near(months.get("2026-03", {}).get("importSalesTax"), 20700)
              and near(months.get("2026-01", {}).get("importSalesTax"), 0), str({k: v["importSalesTax"] for k, v in months.items()}))
        check("with no sales it all carries forward",
              near(months.get("2026-09", {}).get("carriedForward"), 24150)
              and near(months.get("2026-09", {}).get("payable"), 0), str(months.get("2026-09")))
        check("the lapsed GD is listed with its input tax",
              any(t["gdNumber"] == "KAPW-HC-90002" and t["status"] == "lapsed" for t in w.get("timeLimit", []))
              and near(w.get("lapsedInputTax"), b_.get("inputTax")), str(w.get("timeLimit"))[:200])
        r = requests.get(f"{api}/import-tax/company/{wa}/input-tax/excel", headers=h,
                         params={"from": "2026-01", "to": "2026-09"}, timeout=60)
        check("the worksheet downloads as Excel", r.ok and r.content[:2] == b"PK", str(r.status_code))

        print("\n-- 3. Month-end tie-out --")
        fifo = company("_taxdesk fifo")
        r = bring_in(fifo, [line("KAPE-HC-90003", "2026-08-05", "8481.2000", f"TAXDESK VALVE {tag}", 4, 40000)])
        check("setup: a FIFO company's GD comes in", r.ok, f"http {r.status_code} {r.text[:200]}")
        t = requests.get(f"{api}/stock/company/{fifo}/tie-out", headers=h, params={"month": "2026-08"}, timeout=300).json()
        check("stock and Annex-H1 agree", near(t.get("stockValue"), t.get("annexH1Closing")) and t.get("stockValue", 0) > 0, str(t)[:300])
        check("with the ledger off only the two are compared, and they tie",
              t.get("ledgerOn") is False and t.get("agrees") is True and t.get("ledgerInventory") is None, str(t)[:300])
        # 3b. Ledger ON (2026-10-05): an arrival now debits Inventory at its
        # DECLARED value, so stock and the Inventory account agree to the paisa
        # and the landed - declared gap sits in the valuation reserve.
        glco = company("_taxdesk gl")
        r = requests.post(f"{api}/accounting/gl/company/{glco}/enable", headers=h, timeout=300)
        check("setup: the ledger switches on", r.ok, f"http {r.status_code} {r.text[:200]}")
        r = bring_in(glco, [line("KAPE-HC-90004", "2026-08-06", "8481.2000", f"TAXDESK GL VALVE {tag}", 4, 40000, duty=4000)])
        check("setup: a GD comes in with the ledger on", r.ok, f"http {r.status_code} {r.text[:200]}")
        t = requests.get(f"{api}/stock/company/{glco}/tie-out", headers=h, params={"month": "2026-08"}, timeout=300).json()
        check("stock equals the Inventory account to the paisa (declared basis)",
              t.get("ledgerOn") is True and near(t.get("stockVsLedger"), 0, 0.01) and near(t.get("arrivalsBasisGap"), 0, 0.01),
              str(t)[:300])
        check("what the GD owes equals Import Clearing, and it all ties",
              near(t.get("clearingDifference"), 0, 0.01) and t.get("agrees") is True, str(t)[:300])
        r = requests.post(f"{api}/accounting/gl/company/{glco}/repost-arrivals", headers=h, timeout=300)
        g = (r.json() or {}).get("gds", []) if r.ok else []
        check("re-posting arrivals is idempotent: same credit, still ties",
              r.ok and len(g) == 1 and g[0].get("reposted") and near(g[0].get("clearingBefore"), g[0].get("clearingAfter"))
              and requests.get(f"{api}/stock/company/{glco}/tie-out", headers=h, params={"month": "2026-08"}, timeout=300).json().get("agrees") is True,
              r.text[:300])

        r = requests.get(f"{api}/stock/company/{wa}/tie-out", headers=h, params={"month": "2026-08"}, timeout=60)
        check("the tie-out needs FIFO by GD (weighted average refused)", r.status_code == 400, str(r.status_code))

        print("\n-- 4. Refusals --")
        r = requests.get(f"{api}/import-tax/company/{wa}/input-tax", headers=h, params={"from": "Jan"}, timeout=60)
        check("a malformed month is refused", r.status_code == 400, str(r.status_code))
        r = requests.get(f"{api}/import-tax/company/{wa}/input-tax", headers=h, params={"to": "2099-01"}, timeout=60)
        check("a month that has not started is refused", r.status_code == 400, str(r.status_code))
        r = requests.get(f"{api}/import-tax/company/{wa}/input-tax", headers=h,
                         params={"from": "2020-01", "to": "2026-01"}, timeout=60)
        check("more than 36 months is refused", r.status_code == 400, str(r.status_code))
    finally:
        if not a.keep:
            for cid in made:
                requests.delete(f"{api}/companies/{cid}", headers=h, timeout=300)

    failed = [x for x in results if x[0] == "FAIL"]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} checks passed ===")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
