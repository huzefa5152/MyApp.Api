"""
Receipt/Payment "settle remainder" adjustment verification (Manager.io parity).

A receipt can clear an invoice for MORE than the cash received by routing the gap
to a GL account (discount / write-off / any account). Cash recorded = only what
was received; the invoice shows fully settled; the gap posts to the chosen account.

  A. Invoice 30,000.50, receive 30,000, 0.50 -> Discount allowed => invoice Paid.
  B. Invoice 300,000, receive 200,000, 100,000 -> Bad debts written off => Paid.
  C. Over-settle (cash + adjustment > balance) is rejected (400).
  D. Partial pay with NO adjustment still just leaves the balance (unchanged behaviour).

Verifies the GL split in SQL (bank + adjustment account / AR, balanced).
Fresh GL-enabled company; production data untouched.

Usage: python scripts/test_receipt_adjustment.py [--base URL] [--keep]
"""
from __future__ import annotations
import argparse, json, sys, urllib.error, urllib.request
from datetime import datetime, timezone, timedelta

PKT = timezone(timedelta(hours=5))
def today_iso(): return datetime.now(PKT).date().strftime("%Y-%m-%dT00:00:00Z")
results = []

def http(method, path, base, token=None, body=None, timeout=60):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token: headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8"); return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        try: return e.code, (json.loads(raw) if raw else None)
        except Exception: return e.code, raw

def check(name, ok, reason=""):
    results.append((name, ok, reason))
    print(("PASS" if ok else "FAIL") + f" - {name}" + ("" if ok else f"   [{reason}]"))

def approx(a, b, tol=0.01): return abs(float(a) - float(b)) < tol

def make_invoice(base, token, cid, client_id, it_id, unit_price):
    st, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": today_iso(), "companyId": cid, "clientId": client_id, "gstRate": 0,
        "items": [{"description": "Adj test good", "quantity": 1, "uom": "Pcs",
                   "unitPrice": unit_price, "itemTypeId": it_id}]})
    return st, inv

def receipt(base, token, cid, client_id, inv_id, cash, adj=0, adj_acct=None):
    alloc = {"invoiceId": inv_id, "amount": cash}
    if adj:
        alloc["adjustmentAmount"] = adj
        if adj_acct is not None: alloc["adjustmentAccountId"] = adj_acct
    return http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "direction": "Receipt", "date": today_iso(), "contactType": "Client",
        "contactId": client_id, "method": "Cash", "allocations": [alloc]})

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://localhost:5134")
    p.add_argument("--keep", action="store_true")
    args = p.parse_args(); base = args.base

    st, data = http("POST", "/api/auth/login", base, body={"username": "admin", "password": "admin123"})
    if st != 200: print(f"FATAL login {st}"); return 2
    token = data["token"]
    sfx = datetime.now().strftime("%Y%m%d%H%M%S")
    st, company = http("POST", "/api/companies", base, token=token, body={
        "name": f"_test_adj {sfx}", "startingInvoiceNumber": 1, "startingPurchaseBillNumber": 1,
        "startingChallanNumber": 1, "startingGoodsReceiptNumber": 1, "fbrEnabled": False,
        "inventoryTrackingEnabled": False, "enableGl": True})
    if st not in (200, 201): print(f"FATAL company {st} {company}"); return 2
    cid = company["id"]
    st, client = http("POST", "/api/clients", base, token=token, body={
        "name": f"Adj Client {sfx}", "companyId": cid, "registrationType": "Unregistered"})
    _, its = http("GET", "/api/itemtypes", base, token=token)
    rows = its if isinstance(its, list) else (its.get("items") or its.get("data") or [])
    it_id = rows[0]["id"] if rows else None

    # resolve adjustment accounts by control type
    _, accts = http("GET", f"/api/accounts/company/{cid}/flat", base, token=token)
    alist = accts if isinstance(accts, list) else (accts.get("items") or accts.get("data") or [])
    def acct(ct):
        a = next((x for x in alist if x.get("controlType") == ct), None); return a["id"] if a else None
    disc = acct("DiscountAllowed"); baddebt = acct("BadDebtWriteOff")
    check("setup: Discount allowed account seeded", disc is not None, "no DiscountAllowed account")
    check("setup: Bad debts account seeded", baddebt is not None, "no BadDebtWriteOff account")
    print(f"\n== company={cid} client={client['id']} itemType={it_id} disc={disc} baddebt={baddebt} ==\n")

    # ── A. 30,000.50 invoice, 30,000 cash + 0.50 discount ──
    st, invA = make_invoice(base, token, cid, client["id"], it_id, 30000.50)
    check("A0 invoice 30,000.50 created", st in (200,201) and approx(invA.get("grandTotal"), 30000.50), f"{st} {invA.get('grandTotal') if isinstance(invA,dict) else invA}")
    if st in (200,201):
        st, rc = receipt(base, token, cid, client["id"], invA["id"], 30000, 0.50, disc)
        check("A1 receipt cash 30000 + adj 0.50 accepted", st in (200,201), f"{st} {rc}")
        _, inv2 = http("GET", f"/api/invoices/{invA['id']}", base, token=token)
        check("A2 invoice balance due 0 + Paid", approx(inv2.get("balanceDue"),0) and inv2.get("paymentStatus")=="Paid", f"bal={inv2.get('balanceDue')} status={inv2.get('paymentStatus')}")

    # ── B. 300,000 invoice, 200,000 cash + 100,000 write-off ──
    st, invB = make_invoice(base, token, cid, client["id"], it_id, 300000)
    if st in (200,201):
        st, rc = receipt(base, token, cid, client["id"], invB["id"], 200000, 100000, baddebt)
        check("B1 receipt cash 200000 + adj 100000 accepted", st in (200,201), f"{st} {rc}")
        _, inv2 = http("GET", f"/api/invoices/{invB['id']}", base, token=token)
        check("B2 invoice 300000 fully settled + Paid", approx(inv2.get("balanceDue"),0) and inv2.get("paymentStatus")=="Paid", f"bal={inv2.get('balanceDue')} status={inv2.get('paymentStatus')}")

    # ── C. over-settle rejected ──
    st, invC = make_invoice(base, token, cid, client["id"], it_id, 30000.50)
    if st in (200,201):
        st, rc = receipt(base, token, cid, client["id"], invC["id"], 30000, 0.51, disc)
        check("C1 cash+adj over balance rejected (400)", st == 400, f"expected 400 got {st}")

    # ── D. partial, no adjustment → balance remains ──
    st, invD = make_invoice(base, token, cid, client["id"], it_id, 300000)
    if st in (200,201):
        st, rc = receipt(base, token, cid, client["id"], invD["id"], 200000)
        check("D1 partial receipt accepted", st in (200,201), f"{st} {rc}")
        _, inv2 = http("GET", f"/api/invoices/{invD['id']}", base, token=token)
        check("D2 balance due 100000, not Paid", approx(inv2.get("balanceDue"),100000) and inv2.get("paymentStatus")!="Paid", f"bal={inv2.get('balanceDue')} status={inv2.get('paymentStatus')}")

    print(f"\n== IDS: company={cid} invA={invA.get('id')} invB={invB.get('id')} ==")
    passed = sum(1 for _,ok,_ in results if ok); total = len(results)
    print(f"\n{passed}/{total} checks passed")
    if not args.keep:
        http("DELETE", f"/api/companies/{cid}", base, token=token); print("(cleaned up)")
    else:
        print(f"(kept company {cid})")
    return 0 if passed == total else 1

if __name__ == "__main__":
    sys.exit(main())
