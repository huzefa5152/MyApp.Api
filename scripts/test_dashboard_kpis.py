#!/usr/bin/env python3
"""
Dashboard KPIs, end to end (2026-10-18).

    1. Common sale-invoice filter: credit notes subtract, debit notes add, an
       empty company reads zero, a custom from/to range returns only that range,
       a bill cancelled at the FBR portal leaves net sales (needs --db), and the
       sales breakdown ties to the hero figure.

    2. Receivables = the customer balance (net of on-account receipts, equal to the
       accounting summary, 236G/H billed shown apart), received in period.

    3. Payable to FBR: 236G/H, the total identity, FIFO input = the Import Tax Desk
       worksheet, weighted-average fallback, division-restricted refusal, and the
       12-month series.

Later dashboard tasks add suites 4..6 below. Companies are created here and
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

        print("\n-- 2. Receivables as customer balance --")
        today = datetime.now().strftime("%Y-%m-%d")
        rc = company("_dashkpi recv")
        c2 = client(rc, "DashKpi R")

        def gst_bill(extra=None):
            body = {"date": f"{today}T00:00:00Z", "companyId": rc, "clientId": c2, "gstRate": 18,
                    "items": [{"description": f"DASHKPI recv {tag}", "quantity": 1000, "uom": "Pcs",
                               "unitPrice": 100, "itemTypeId": item_type}]}
            body.update(extra or {})
            return requests.post(f"{api}/invoices/standalone", headers=h, timeout=60, json=body)

        r1 = gst_bill()
        r2 = gst_bill({"advanceTaxSection": "236G", "advanceTaxFilerActive": True})
        check("setup: two 118,000 bills, one with 236G", r1.ok and r2.ok, f"{r1.status_code} {r2.status_code} {r2.text[:200]}")
        rr = requests.post(f"{api}/payments/receipts/company/{rc}", headers=h, timeout=60, json={
            "direction": "Receipt", "date": f"{today}T00:00:00Z", "contactType": "Client", "contactId": c2,
            "method": "Cash", "amount": 50000, "allocations": [{"kind": "OnAccount", "amount": 50000}]})
        check("setup: a 50,000 on-account receipt", rr.ok, f"{rr.status_code} {rr.text[:200]}")

        hr = hero(rc, period="all-time")
        check("receivables = invoices less the on-account receipt (236,000 - 50,000)",
              near(hr.get("receivablesTotal"), 186000), str(hr.get("receivablesTotal")))
        s_ = requests.get(f"{api}/accounting/summary/company/{rc}", headers=h, timeout=60)
        acct = ((s_.json().get("receivables") or {}).get("total")) if s_.ok else None
        check("it equals the accounting summary's receivables total", s_.ok and near(hr.get("receivablesTotal"), acct),
              f"{hr.get('receivablesTotal')} vs {acct} ({s_.status_code})")
        check("236G billed (0.1% of 118,000) is shown apart, not in the balance",
              near(hr.get("receivablesAdvanceTaxBilled"), 118), str(hr.get("receivablesAdvanceTaxBilled")))
        check("received in period = 50,000", near(hr.get("receivedInPeriod"), 50000), str(hr.get("receivedInPeriod")))
        h_old = hero(rc, **{"from": "2020-01-01", "to": "2020-01-31"})
        check("a period with no receipts reads zero received", near(h_old.get("receivedInPeriod"), 0), str(h_old.get("receivedInPeriod")))
        check("the declared gross profit and Sales-Purchases fields are gone",
              "grossProfit" not in hr and "net" not in hr, str(sorted(hr))[:200])
        check("landed margin fields are present", all(f in hr for f in ("landedCostOfSales", "grossMarginLanded", "uncostedItemCount")), str(sorted(hr))[:200])

        # A division-restricted user must not see the company-wide balance.
        rd = requests.post(f"{api}/divisions/company/{rc}", headers=h, timeout=60, json={"name": f"DashKpi Div {tag}"})
        div_id = rd.json().get("id") if rd.ok else None
        rl = requests.post(f"{api}/roles", headers=h, timeout=60, json={
            "name": f"DashKpi role {tag}", "description": "t",
            "permissionKeys": ["dashboard.view", "dashboard.kpi.sales.view"]})
        role_id = rl.json().get("id") if rl.ok else None
        ru = requests.post(f"{api}/users", headers=h, timeout=60, json={
            "username": f"dashkpi{tag}", "fullName": "DashKpi Restricted", "password": "test1234a", "role": "User"})
        uid = ru.json().get("id") if ru.ok else None
        check("setup: division, role and user are created", bool(div_id and role_id and uid), f"{rd.status_code} {rl.status_code} {ru.status_code}")
        try:
            if div_id and role_id and uid:
                requests.put(f"{api}/users/{uid}/roles", headers=h, timeout=60, json={"roleIds": [role_id]})
                requests.put(f"{api}/usercompanies/user/{uid}", headers=h, timeout=60, json={"companyIds": [rc]})
                rs = requests.put(f"{api}/userdivisions/user/{uid}/company/{rc}", headers=h, timeout=60,
                                  json={"restrictToDivisions": True, "divisionIds": [div_id]})
                check("setup: user restricted to one division", rs.ok, f"{rs.status_code} {rs.text[:200]}")
                lt = requests.post(f"{api}/auth/login", json={"username": f"dashkpi{tag}", "password": "test1234a"}, timeout=60)
                uh = {"Authorization": f"Bearer {lt.json().get('token')}"} if lt.ok else {}
                rk = requests.get(f"{api}/dashboard/kpis", headers=uh, timeout=60, params={"companyId": rc, "period": "all-time"})
                hu = (rk.json().get("hero") or {}) if rk.ok else {}
                check("restricted user: receivablesTotal is null", rk.ok and hu.get("receivablesTotal") is None, f"{rk.status_code} {hu.get('receivablesTotal')}")
                check("restricted user: receivablesScopeRestricted is true", hu.get("receivablesScopeRestricted") is True, str(hu.get("receivablesScopeRestricted")))
                ha = hero(rc, period="all-time")
                check("admin still gets the number and the flag is false",
                      near(ha.get("receivablesTotal"), 186000) and ha.get("receivablesScopeRestricted") is False,
                      f"{ha.get('receivablesTotal')} {ha.get('receivablesScopeRestricted')}")
        finally:
            if uid: requests.delete(f"{api}/users/{uid}", headers=h, timeout=60)
            if role_id: requests.delete(f"{api}/roles/{role_id}", headers=h, timeout=60)

        print("\n-- 3. Payable to FBR (tax position) + monthly series --")
        tf = company("_dashkpi tax")           # new companies start on FIFO
        c3 = client(tf, "DashKpi T")
        thismonth = datetime.now().strftime("%Y-%m")
        day = datetime.now().strftime("%Y-%m-%d")

        def tbill(cid_, client_id, extra=None, rate=18):
            body = {"date": f"{day}T00:00:00Z", "companyId": cid_, "clientId": client_id, "gstRate": rate,
                    "items": [{"description": f"DASHKPI tax {tag}", "quantity": 1000, "uom": "Pcs",
                               "unitPrice": 100, "itemTypeId": item_type}]}
            body.update(extra or {})
            return requests.post(f"{api}/invoices/standalone", headers=h, timeout=60, json=body)

        r1 = tbill(tf, c3)
        r2 = tbill(tf, c3, {"advanceTaxSection": "236G", "advanceTaxFilerActive": True})
        r3 = tbill(tf, c3, {"advanceTaxSection": "236H", "advanceTaxFilerActive": False})
        check("setup: a plain, a 236G and a 236H bill", r1.ok and r2.ok and r3.ok,
              f"{r1.status_code} {r2.status_code} {r3.status_code} {r3.text[:200]}")
        a236g = float((r2.json() or {}).get("advanceTaxAmount") or 0) if r2.ok else 0
        a236h = float((r3.json() or {}).get("advanceTaxAmount") or 0) if r3.ok else 0

        def tax(cid_, hdr=None, **params):
            return requests.get(f"{api}/dashboard/tax-position", headers=hdr or h, timeout=120,
                                params={"companyId": cid_, **params})

        rt = tax(tf, period="this-month")
        check("tax-position answers 200", rt.ok, f"{rt.status_code} {rt.text[:200]}")
        t = rt.json() if rt.ok else {}
        check("the months used are reported (this month only)",
              t.get("fromMonth") == thismonth and t.get("toMonth") == thismonth, f"{t.get('fromMonth')}..{t.get('toMonth')}")
        check("output tax = 18% of three 100,000 bills", near(t.get("outputTax"), 54000), str(t.get("outputTax")))
        check("236G = the 236G bill's AdvanceTaxAmount", a236g > 0 and near(t.get("adv236G"), a236g), f"{t.get('adv236G')} vs {a236g}")
        check("236H = the 236H bill's AdvanceTaxAmount", a236h > 0 and near(t.get("adv236H"), a236h), f"{t.get('adv236H')} vs {a236h}")
        check("total payable = sales tax payable + 236G + 236H + WHT",
              near(t.get("totalPayable"), float(t.get("salesTaxPayable") or 0) + float(t.get("adv236G") or 0)
                   + float(t.get("adv236H") or 0) + float(t.get("whtPayable") or 0)), str(t))
        check("a FIFO company reads the Import Tax Desk worksheet", t.get("inputBasis") == "worksheet", str(t.get("inputBasis")))
        ws = requests.get(f"{api}/import-tax/company/{tf}/input-tax", headers=h, timeout=120,
                          params={"from": thismonth, "to": thismonth})
        wsm = ws.json().get("months", []) if ws.ok else []
        check("input tax claimed = the worksheet's input for the same months",
              ws.ok and near(t.get("inputTaxClaimed"), sum(m.get("inputThisMonth", 0) for m in wsm)),
              f"{t.get('inputTaxClaimed')} vs {[m.get('inputThisMonth') for m in wsm]}")
        check("sales tax payable = the worksheet's payable",
              near(t.get("salesTaxPayable"), sum(m.get("payable", 0) for m in wsm)),
              f"{t.get('salesTaxPayable')} vs {[m.get('payable') for m in wsm]}")
        check("GL is off: ledger flag false and GL lines zero",
              t.get("ledgerEnabled") is False and near(t.get("whtPayable"), 0)
              and near(t.get("recoverableImportAdvanceTax"), 0) and near(t.get("recoverableWhtDeducted"), 0), str(t))
        check("one month row carrying the output tax", len(t.get("months", [])) == 1
              and near(t["months"][0].get("outputTax"), 54000), str(t.get("months")))
        t12 = tax(tf, period="this-year").json()
        check("this-year runs January to the current month, one row each",
              str(t12.get("fromMonth", "")).endswith("-01") and t12.get("toMonth") == thismonth
              and len(t12.get("months", [])) == int(thismonth[5:]), f"{t12.get('fromMonth')}..{t12.get('toMonth')} {len(t12.get('months', []))}")
        check("a bad range is refused", tax(tf, **{"from": "2026-09-30"}).status_code == 400)

        wa = company("_dashkpi wavg")
        rm = requests.put(f"{api}/stock/company/{wa}/costing-method", headers=h, timeout=60, json={"method": "WeightedAverage"})
        check("setup: a weighted-average company", rm.ok, f"{rm.status_code} {rm.text[:200]}")
        cw = client(wa, "DashKpi W")
        tbill(wa, cw)
        rw = tax(wa, period="this-month")
        tw = rw.json() if rw.ok else {}
        check("weighted-average company: 200 with gl-before-cap", rw.ok and tw.get("inputBasis") == "gl-before-cap", f"{rw.status_code} {rw.text[:200]}")
        check("its payable falls back to output + further - input (no GL = no input)",
              near(tw.get("salesTaxPayable"), 18000) and near(tw.get("totalPayable"), 18000), str(tw))

        km = kpis(tf, period="this-month").json()
        mo = km.get("monthly") or []
        check("monthly series has 12 points ending this month", len(mo) == 12 and mo[-1].get("month") == thismonth, str([m_.get("month") for m_ in mo]))
        check("this month's net sales = 300,000 and the earlier months are zero",
              near(mo[-1].get("netSales"), 300000) and all(near(m_.get("netSales"), 0) for m_ in mo[:-1]), str(mo)[:300])
        check("monthly net sales ties to the hero for the month", near(mo[-1].get("netSales"), (km.get("hero") or {}).get("netSales")),
              f"{mo[-1].get('netSales')} vs {(km.get('hero') or {}).get('netSales')}")
        check("monthly points carry landedCost and marginPct", all("landedCost" in m_ and "marginPct" in m_ for m_ in mo))
        km2 = kpis(tf, **{"from": "2026-03-01", "to": "2026-03-31"}).json().get("monthly") or []
        check("the series ends at the period's end month", len(km2) == 12 and km2[-1].get("month") == "2026-03", str([m_.get("month") for m_ in km2][-2:]))

        km_h = km.get("hero") or {}
        check("monthly landed cost = the hero's landed cost of sales (this month)",
              near(mo[-1].get("landedCost"), km_h.get("landedCostOfSales")), f"{mo[-1].get('landedCost')} vs {km_h.get('landedCostOfSales')}")

        # A GL-enabled weighted-average company: WHT, input-tax fallback, recoverables.
        gw = company("_dashkpi gl")
        requests.put(f"{api}/stock/company/{gw}/costing-method", headers=h, timeout=60, json={"method": "WeightedAverage"})
        en = requests.post(f"{api}/accounting/gl/company/{gw}/enable", headers=h, timeout=180)
        check("setup: the GL is switched on", en.ok, f"{en.status_code} {en.text[:200]}")
        cg = client(gw, "DashKpi G")
        sg = requests.post(f"{api}/suppliers", headers=h, timeout=60, json={
            "name": f"DashKpi Sup {tag}", "companyId": gw, "ntn": "7654321", "registrationType": "Registered", "fbrProvinceCode": 8})
        sup = sg.json().get("id") if sg.ok else None
        sale = tbill(gw, cg, {"withholdingTaxRate": 5.5})
        sale_j = sale.json() if sale.ok else {}
        sale_wht = float(sale_j.get("withholdingTaxAmount") or 0)
        pb = requests.post(f"{api}/purchasebills", headers=h, timeout=60, json={
            "date": f"{day}T00:00:00Z", "companyId": gw, "supplierId": sup, "gstRate": 18, "withholdingTaxRate": 10,
            "items": [{"itemTypeId": item_type, "description": f"DASHKPI pb {tag}", "quantity": 500, "uom": "Pcs", "unitPrice": 100}]})
        pb_j = pb.json() if pb.ok else {}
        pb_wht = float(pb_j.get("withholdingTaxAmount") or 0)
        pb_gst = float(pb_j.get("gstAmount") or 0)
        check("setup: a sale with WHT and a purchase bill with WHT + GST on the GL company",
              sale.ok and pb.ok and sale_wht > 0 and pb_wht > 0 and pb_gst > 0,
              f"{sale.status_code} {pb.status_code} {sale_wht} {pb_wht} {pb_gst} {pb.text[:150]}")
        tg = tax(gw, period="this-month").json()
        check("GL company: ledgerEnabled is true", tg.get("ledgerEnabled") is True, str(tg.get("ledgerEnabled")))
        check("whtPayable = the purchase bill's WHT (a sale's WHT is not payable)", near(tg.get("whtPayable"), pb_wht), f"{tg.get('whtPayable')} vs {pb_wht}")
        check("recoverableWhtDeducted = the sale's WHT (receivable)", near(tg.get("recoverableWhtDeducted"), sale_wht), f"{tg.get('recoverableWhtDeducted')} vs {sale_wht}")
        check("the GL input fallback = the purchase bill's GST", tg.get("inputBasis") == "gl-before-cap" and near(tg.get("inputTaxClaimed"), pb_gst),
              f"{tg.get('inputBasis')} {tg.get('inputTaxClaimed')} vs {pb_gst}")
        check("salesTaxPayable = max(0, output + further - input)",
              near(tg.get("salesTaxPayable"), max(0.0, float(tg.get("outputTax") or 0) + float(tg.get("furtherTax") or 0) - pb_gst)), str(tg))
        check("total payable still = sales tax + 236G + 236H + WHT",
              near(tg.get("totalPayable"), float(tg.get("salesTaxPayable")) + float(tg.get("adv236G")) + float(tg.get("adv236H")) + float(tg.get("whtPayable"))), str(tg))

        tree = requests.get(f"{api}/accounts/company/{gw}/tree", headers=h, timeout=60).json()
        coa = {}

        def walk(n):
            if isinstance(n, dict):
                if "controlType" in n and "balance" in n:
                    coa[n["controlType"]] = coa.get(n["controlType"], 0) + n["balance"]
                for v in n.values():
                    walk(v)
            elif isinstance(n, list):
                for v in n:
                    walk(v)
        walk(tree)
        check("recoverable WHT = the CoA balance of WithholdingReceivable", near(tg.get("recoverableWhtDeducted"), coa.get("WithholdingReceivable", 0)),
              f"{tg.get('recoverableWhtDeducted')} vs {coa.get('WithholdingReceivable')}")
        check("recoverable import advance tax = the CoA balance of AdvanceIncomeTaxOnImports",
              near(tg.get("recoverableImportAdvanceTax"), coa.get("AdvanceIncomeTaxOnImports", 0)),
              f"{tg.get('recoverableImportAdvanceTax')} vs {coa.get('AdvanceIncomeTaxOnImports')}")
        check("whtPayable = minus the CoA balance of WithholdingPayable", near(tg.get("whtPayable"), -coa.get("WithholdingPayable", 0)),
              f"{tg.get('whtPayable')} vs {coa.get('WithholdingPayable')}")

        # dashboard.view alone is not enough; the sales KPI permission is.
        role_v = requests.post(f"{api}/roles", headers=h, timeout=60, json={
            "name": f"DashKpi vrole {tag}", "description": "t", "permissionKeys": ["dashboard.view"]})
        rv = role_v.json().get("id") if role_v.ok else None
        ru_v = requests.post(f"{api}/users", headers=h, timeout=60, json={
            "username": f"dashkpiv{tag}", "fullName": "DashKpi ViewOnly", "password": "test1234a", "role": "User"})
        uv = ru_v.json().get("id") if ru_v.ok else None
        try:
            if rv and uv:
                requests.put(f"{api}/users/{uv}/roles", headers=h, timeout=60, json={"roleIds": [rv]})
                requests.put(f"{api}/usercompanies/user/{uv}", headers=h, timeout=60, json={"companyIds": [tf]})
                lv = requests.post(f"{api}/auth/login", json={"username": f"dashkpiv{tag}", "password": "test1234a"}, timeout=60)
                vh = {"Authorization": f"Bearer {lv.json().get('token')}"} if lv.ok else {}
                r_no = tax(tf, hdr=vh, period="this-month")
                check("dashboard.view only: tax position is 403", r_no.status_code == 403 and "outputTax" not in r_no.text, f"{r_no.status_code} {r_no.text[:120]}")
                requests.put(f"{api}/roles/{rv}", headers=h, timeout=60, json={
                    "name": f"DashKpi vrole {tag}", "description": "t", "permissionKeys": ["dashboard.view", "dashboard.kpi.sales.view"]})
                lv2 = requests.post(f"{api}/auth/login", json={"username": f"dashkpiv{tag}", "password": "test1234a"}, timeout=60)
                vh2 = {"Authorization": f"Bearer {lv2.json().get('token')}"} if lv2.ok else {}
                r_yes = tax(tf, hdr=vh2, period="this-month")
                check("with dashboard.kpi.sales.view: 200", r_yes.status_code == 200, f"{r_yes.status_code} {r_yes.text[:120]}")
            else:
                check("setup: view-only role and user", False, f"{role_v.status_code} {ru_v.status_code}")
        finally:
            if uv: requests.delete(f"{api}/users/{uv}", headers=h, timeout=60)
            if rv: requests.delete(f"{api}/roles/{rv}", headers=h, timeout=60)

        # A division-restricted user is refused the company-wide tax position.
        rd3 = requests.post(f"{api}/divisions/company/{tf}", headers=h, timeout=60, json={"name": f"DashKpi TDiv {tag}"})
        d3 = rd3.json().get("id") if rd3.ok else None
        rl3 = requests.post(f"{api}/roles", headers=h, timeout=60, json={
            "name": f"DashKpi trole {tag}", "description": "t", "permissionKeys": ["dashboard.view", "dashboard.kpi.sales.view"]})
        role3 = rl3.json().get("id") if rl3.ok else None
        ru3 = requests.post(f"{api}/users", headers=h, timeout=60, json={
            "username": f"dashkpit{tag}", "fullName": "DashKpi TRestricted", "password": "test1234a", "role": "User"})
        u3 = ru3.json().get("id") if ru3.ok else None
        try:
            if d3 and role3 and u3:
                requests.put(f"{api}/users/{u3}/roles", headers=h, timeout=60, json={"roleIds": [role3]})
                requests.put(f"{api}/usercompanies/user/{u3}", headers=h, timeout=60, json={"companyIds": [tf]})
                requests.put(f"{api}/userdivisions/user/{u3}/company/{tf}", headers=h, timeout=60,
                             json={"restrictToDivisions": True, "divisionIds": [d3]})
                lt3 = requests.post(f"{api}/auth/login", json={"username": f"dashkpit{tag}", "password": "test1234a"}, timeout=60)
                uh3 = {"Authorization": f"Bearer {lt3.json().get('token')}"} if lt3.ok else {}
                rr3 = tax(tf, hdr=uh3, period="this-month")
                check("division-restricted user: 403 with the company-wide message",
                      rr3.status_code == 403 and "company-wide only" in rr3.text, f"{rr3.status_code} {rr3.text[:200]}")
                rk3 = requests.get(f"{api}/dashboard/kpis", headers=uh3, timeout=60, params={"companyId": tf, "period": "this-month"})
                check("their Overview KPIs are unaffected", rk3.ok, str(rk3.status_code))
            else:
                check("setup: division, role and user for the restricted case", False, f"{rd3.status_code} {rl3.status_code} {ru3.status_code}")
        finally:
            if u3: requests.delete(f"{api}/users/{u3}", headers=h, timeout=60)
            if role3: requests.delete(f"{api}/roles/{role3}", headers=h, timeout=60)

        print("\n-- 4. Accounting summary: owed-by-customers + monthly series --")
        def acct(c):
            return requests.get(f"{api}/accounting/summary/company/{c}", headers=h, timeout=120)
        rs = acct(gw)
        check("GL company: summary answers 200", rs.ok, f"{rs.status_code} {rs.text[:200]}")
        sm = rs.json() if rs.ok else {}
        rec = float((sm.get("receivables") or {}).get("total") or 0)
        check("GL company has receivables to compare", rec > 0, str(rec))
        check("capitalOwedByCustomers == receivables.total", near(sm.get("capitalOwedByCustomers"), rec),
              f"{sm.get('capitalOwedByCustomers')} vs {rec}")
        mo = sm.get("monthly") or []
        check("monthly has 12 points", len(mo) == 12, str(len(mo)))
        check("monthly ends at the current month", bool(mo) and mo[-1].get("month") == thismonth, str(mo[-1:] ))
        check("glEnabled true for the GL company", sm.get("glEnabled") is True)
        check("monthly net = income - expense", all(near(x["netProfit"], x["income"] - x["expense"]) for x in mo))
        rs2 = acct(tf)
        s2 = rs2.json() if rs2.ok else {}
        check("GL-off company: 200 and glEnabled false", rs2.ok and s2.get("glEnabled") is False,
              f"{rs2.status_code} {rs2.text[:120]}")
        m2 = s2.get("monthly") or []
        check("GL-off: 12 points, income/expense zero", len(m2) == 12
              and all(near(x["income"], 0) and near(x["expense"], 0) and near(x["netProfit"], 0) for x in m2))

        # Suites 5..6 are added by the later dashboard tasks.
    finally:
        if not a.keep:
            for cid_ in made:
                requests.delete(f"{api}/companies/{cid_}", headers=h, timeout=300)

    failed = [x for x in results if x[0] == "FAIL"]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} checks passed ===")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
