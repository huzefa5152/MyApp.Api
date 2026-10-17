#!/usr/bin/env python3
"""
Dashboard KPIs, end to end (2026-10-18).

    1. Common sale-invoice filter: credit notes subtract, debit notes add, an
       empty company reads zero, a custom from/to range returns only that range,
       a bill cancelled at the FBR portal leaves net sales (needs --db), and the
       sales breakdown ties to the hero figure.

Later dashboard tasks add suites 2..6 below. Companies are created here and
deleted at the end.

Usage:
    python scripts/test_dashboard_kpis.py [--base URL] [--username U] [--password P]
        [--db "Server=...;Database=...;..."] [--keep]
"""
import argparse
import subprocess
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


def skip(name, why):
    print(f"  [SKIP] {name} -- {why}")


def near(a, b, tol=0.02):
    try:
        return abs(float(a) - float(b)) <= tol
    except (TypeError, ValueError):
        return False


def sql(conn, query):
    """Run a statement through sqlcmd (only to fake an FBR filing)."""
    server = db = ""
    for part in conn.split(";"):
        k, _, v = part.partition("=")
        k = k.strip().lower()
        if k == "server":
            server = v.strip()
        elif k in ("database", "initial catalog"):
            db = v.strip()
    out = subprocess.run(["sqlcmd", "-S", server, "-d", db, "-E", "-C", "-I", "-h", "-1", "-W", "-Q", query],
                         capture_output=True, text=True, timeout=120)
    return (out.stdout or "") + (out.stderr or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--db", default=None, help="connection string; enables the FBR-cancelled case")
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
            "name": f"{name} {tag}", "brandName": "DASHKPI", "fullAddress": "1 Test Street",
            "phone": "021-0000000", "ntn": "1234567-8", "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "fbrEnabled": False, "inventoryTrackingEnabled": False, "enableGl": False})
        r.raise_for_status()
        made.append(r.json()["id"])
        return r.json()["id"]

    def client(cid, name):
        r = requests.post(f"{api}/clients", headers=h, timeout=60, json={
            "name": f"{name} {tag}", "address": "1 Road", "phone": "021-1", "companyId": cid,
            "registrationType": "Registered", "ntn": "1234567", "fbrProvinceCode": 8})
        r.raise_for_status()
        return r.json()["id"]

    its = requests.get(f"{api}/itemtypes", headers=h, timeout=60).json()
    its = its if isinstance(its, list) else (its.get("items") or its.get("data") or [])
    item_type = its[0]["id"]

    def bill(cid, client_id, date, qty, price):
        r = requests.post(f"{api}/invoices/standalone", headers=h, timeout=60, json={
            "date": f"{date}T00:00:00Z", "companyId": cid, "clientId": client_id, "gstRate": 0,
            "items": [{"description": f"DASHKPI good {tag}", "quantity": qty, "uom": "Pcs",
                       "unitPrice": price, "itemTypeId": item_type}]})
        return r.json() if r.status_code in (200, 201) else None

    def note(inv, doc_type, date, qty):
        line = inv["items"][0]["id"]
        r = requests.post(f"{api}/invoices/notes", headers=h, timeout=60, json={
            "originalInvoiceId": inv["id"], "documentType": doc_type, "reason": "Return of goods",
            "affectsStock": False, "date": f"{date}T00:00:00Z",
            "lines": [{"invoiceItemId": line, "quantity": qty}]})
        return r.status_code in (200, 201), r.text[:200]

    def kpis(cid, **params):
        r = requests.get(f"{api}/dashboard/kpis", headers=h, timeout=60, params={"companyId": cid, **params})
        return r

    def hero(cid, **params):
        r = kpis(cid, **params)
        return (r.json().get("hero") or {}) if r.ok else {}

    try:
        print("\n-- 1. Common sale-invoice filter --")
        cid = company("_dashkpi sales")
        c1 = client(cid, "DashKpi A")
        # Sept: 100,000 (5 x 20,000) + 50,000, a 20,000 credit note. Aug: 10,000 + a 5,000 debit note.
        i1 = bill(cid, c1, "2026-09-05", 5, 20000)
        i2 = bill(cid, c1, "2026-09-20", 1, 50000)
        i3 = bill(cid, c1, "2026-08-10", 2, 5000)
        i4 = bill(cid, c1, "2026-07-15", 1, 7000)
        check("setup: four bills are created", all([i1, i2, i3, i4]), "a bill was refused")
        ok, msg = note(i1, 10, "2026-09-25", 1)
        check("setup: a 20,000 credit note", ok, msg)
        ok, msg = note(i3, 9, "2026-08-20", 1)
        check("setup: a 5,000 debit note", ok, msg)

        h_sep = hero(cid, **{"from": "2026-09-01", "to": "2026-09-30"})
        check("net sales = invoices - credit notes (100k + 50k - 20k)", near(h_sep.get("netSales"), 130000), str(h_sep.get("netSales")))
        check("sales incl. tax follows the same documents", near(h_sep.get("salesInclTax"), 130000), str(h_sep.get("salesInclTax")))
        check("the existing TotalSales field still reads the same", near(h_sep.get("totalSales"), 130000), str(h_sep.get("totalSales")))

        h_aug = hero(cid, **{"from": "2026-08-01", "to": "2026-08-31"})
        check("a custom range returns only that range, debit note added (10k + 5k)", near(h_aug.get("netSales"), 15000), str(h_aug.get("netSales")))
        k = kpis(cid, **{"from": "2026-09-01", "to": "2026-09-30"}).json()
        check("the response reports the custom period",
              (k.get("period") or {}).get("code") == "custom" and (k.get("period") or {}).get("from", "")[:10] == "2026-09-01",
              str(k.get("period")))
        sales = k.get("sales") or {}
        check("invoice count counts invoices, not notes", sales.get("invoiceCount") == 2, str(sales.get("invoiceCount")))

        h_all = hero(cid, period="all-time")
        check("all time = every range together", near(h_all.get("netSales"), 130000 + 15000 + 7000), str(h_all.get("netSales")))

        bd = requests.get(f"{api}/dashboard/breakdown", headers=h, timeout=60,
                          params={"companyId": cid, "kind": "sales", "from": "2026-09-01", "to": "2026-09-30"}).json()
        check("the sales breakdown carries the credit note as a negative row",
              any(near(r_.get("amount"), -20000) for r_ in bd.get("rows", [])), str(bd.get("rows"))[:200])
        check("the breakdown total ties to the hero figure", near(bd.get("total"), h_sep.get("salesInclTax")), f"{bd.get('total')} vs {h_sep.get('salesInclTax')}")

        r = kpis(cid, **{"from": "2026-09-01"})
        check("from without to is refused", r.status_code == 400, str(r.status_code))
        r = kpis(cid, **{"from": "2026-09-30", "to": "2026-09-01"})
        check("to before from is refused", r.status_code == 400, str(r.status_code))
        r = kpis(cid, **{"from": "09/01/2026", "to": "2026-09-30"})
        check("a malformed date is refused", r.status_code == 400, str(r.status_code))

        empty = company("_dashkpi empty")
        h0 = hero(empty, period="all-time")
        check("an empty company reads zero across the hero",
              all(near(h0.get(f), 0) for f in ("netSales", "salesInclTax", "totalSales", "gstOutput")), str(h0)[:200])
        bd0 = requests.get(f"{api}/dashboard/breakdown", headers=h, timeout=60,
                           params={"companyId": empty, "kind": "sales", "period": "all-time"}).json()
        check("and its sales breakdown has no rows", len(bd0.get("rows", [])) == 0, str(bd0)[:200])

        if a.db:
            before = hero(cid, period="all-time").get("netSales")
            sql(a.db, f"UPDATE Invoices SET FbrStatus='Submitted', FbrIRN='IRN-{tag}', "
                      f"FbrInvoiceNumber='IRN-{tag}', FbrSubmittedAt=GETUTCDATE() WHERE Id={i4['id']}")
            r = requests.post(f"{api}/invoices/{i4['id']}/fbr-cancelled", headers=h, timeout=60,
                              json={"reason": "withdrawn at the FBR portal"})
            check("setup: the bill is recorded as cancelled at FBR", r.ok, f"{r.status_code} {r.text[:200]}")
            after = hero(cid, period="all-time").get("netSales")
            check("a bill cancelled at FBR leaves net sales", near(float(before or 0) - float(after or 0), 7000), f"{before} -> {after}")
        else:
            skip("a bill cancelled at FBR leaves net sales", "needs --db")

        # Suites 2..6 are added by the later dashboard tasks.
    finally:
        if not a.keep:
            for cid_ in made:
                requests.delete(f"{api}/companies/{cid_}", headers=h, timeout=300)

    failed = [x for x in results if x[0] == "FAIL"]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} checks passed ===")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
