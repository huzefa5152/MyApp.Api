"""
Withholding-tax (Manager.io parity) verification — sales Invoice + PurchaseBill.

Proves the WHT feature end-to-end against a running backend on a FRESH ephemeral
GL-enabled company (production data untouched):

  A. Sales invoice, RATE mode (Manager invoice #1316 numbers):
       35 x 3900 = 136,500 net; +18% GST = 161,070 gross;
       WHT 5.5% of gross = 8,858.85; balance due = 152,211.15.
     - GrandTotal/GSTAmount unchanged (WHT sits on top, off the FBR payload).
  B. Receipt of the collectible (152,211.15) => invoice Paid, balance due 0.
  C. Over-allocation beyond the collectible is rejected (cap = collectible, not grand total).
  D. Sales invoice, FIXED-AMOUNT mode: typed WHT amount reduces balance due.
  E. Backward compatibility: no WHT => balance due == grand total (unchanged).
  F. Purchase bill, RATE mode: balance due (owed to supplier) reduced; payment of
     collectible => Paid; over-allocation rejected.

Prints the created company/invoice/bill ids so the GL split can be verified in SQL.

Usage: python scripts/test_withholding_tax.py [--base URL] [--keep]
Exit 0 = all pass.
"""
from __future__ import annotations
import argparse, json, sys, urllib.error, urllib.request
from datetime import datetime, timezone, timedelta

PKT = timezone(timedelta(hours=5))
def pkt_date_iso(off: int = 0) -> str:
    return (datetime.now(PKT) + timedelta(days=off)).date().strftime("%Y-%m-%dT00:00:00Z")

results: list[tuple[str, bool, str]] = []

def http(method, path, base, token=None, body=None, timeout=60):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        try:
            return e.code, (json.loads(raw) if raw else None)
        except Exception:
            return e.code, raw

def check(name, ok, reason=""):
    results.append((name, ok, reason))
    print(("PASS" if ok else "FAIL") + f" — {name}" + ("" if ok else f"   [{reason}]"))

def approx(a, b, tol=0.01):
    return abs(float(a) - float(b)) < tol

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://localhost:5134")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw", default="admin123")
    p.add_argument("--keep", action="store_true")
    args = p.parse_args()
    base = args.base

    st, data = http("POST", "/api/auth/login", base, body={"username": args.admin_user, "password": args.admin_pw})
    if st != 200:
        print(f"FATAL: login failed ({st} {data})"); return 2
    token = data["token"]

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    st, company = http("POST", "/api/companies", base, token=token, body={
        "name": f"_test_wht {suffix}", "fullAddress": "Test HQ", "phone": "+92-21-0",
        "ntn": "9999999", "cnic": "9999999999999", "strn": "9999999999999",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Manufacturer", "fbrSector": "All Other Sectors",
        "fbrToken": "test-token", "fbrEnabled": True,
        "inventoryTrackingEnabled": False, "enableGl": True,
    })
    if st not in (200, 201):
        print(f"FATAL: company create failed ({st} {company})"); return 2
    cid = company["id"]

    st, client = http("POST", "/api/clients", base, token=token, body={
        "name": f"WHT Client {suffix}", "address": "1 Test Rd", "phone": "021-1",
        "companyId": cid, "ntn": "1234567", "strn": "1234567890123",
        "fbrProvinceCode": 8, "registrationType": "Registered"})
    st2, supplier = http("POST", "/api/suppliers", base, token=token, body={
        "name": f"WHT Supplier {suffix}", "companyId": cid, "phone": "021-2"})
    if st not in (200, 201) or st2 not in (200, 201):
        print(f"FATAL: client/supplier create failed ({st}/{st2})"); return 2

    _, its = http("GET", "/api/itemtypes", base, token=token)
    rows = its if isinstance(its, list) else (its.get("items") or its.get("data") or [])
    it_id = rows[0]["id"] if rows else None

    print(f"\n== company={cid}  client={client['id']}  supplier={supplier['id']}  itemType={it_id} ==\n")

    # ── A. Sales invoice, RATE mode (Manager #1316 parity) ──
    st, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": pkt_date_iso(), "companyId": cid, "clientId": client["id"], "gstRate": 18,
        "withholdingTaxRate": 5.5,
        "items": [{"description": "NESPRESSO PARIS", "quantity": 35, "uom": "Pcs",
                   "unitPrice": 3900, "itemTypeId": it_id}]})
    if st not in (200, 201):
        print(f"FATAL: invoice create failed ({st} {inv})"); return 2
    inv_id = inv["id"]
    check("A1 grand total = 161070 (unchanged by WHT)", approx(inv.get("grandTotal"), 161070), f"{inv.get('grandTotal')}")
    check("A2 GST amount = 24570 (unchanged by WHT)", approx(inv.get("gstAmount"), 24570), f"{inv.get('gstAmount')}")
    check("A3 WHT rate echoed = 5.5", approx(inv.get("withholdingTaxRate"), 5.5), f"{inv.get('withholdingTaxRate')}")
    check("A4 WHT amount = 8858.85 (5.5% of gross)", approx(inv.get("withholdingTaxAmount"), 8858.85), f"{inv.get('withholdingTaxAmount')}")
    check("A5 balance due = 152211.15 (grand - WHT)", approx(inv.get("balanceDue"), 152211.15), f"{inv.get('balanceDue')}")

    # ── B. Receipt of the collectible => Paid ──
    st, rc = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "direction": "Receipt", "date": pkt_date_iso(), "contactType": "Client",
        "contactId": client["id"], "method": "Cash",
        "allocations": [{"invoiceId": inv_id, "amount": 152211.15}]})
    check("B1 receipt of collectible accepted", st in (200, 201), f"{st} {rc}")
    _, inv2 = http("GET", f"/api/invoices/{inv_id}", base, token=token)
    check("B2 invoice balance due now 0", approx(inv2.get("balanceDue"), 0), f"{inv2.get('balanceDue')}")
    check("B3 invoice status Paid", inv2.get("paymentStatus") == "Paid", f"{inv2.get('paymentStatus')}")

    # ── C. Over-allocation beyond collectible rejected ──
    st, over = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "direction": "Receipt", "date": pkt_date_iso(), "contactType": "Client",
        "contactId": client["id"], "method": "Cash",
        "allocations": [{"invoiceId": inv_id, "amount": 1.00}]})
    check("C1 over-allocation (past collectible) rejected", st == 400, f"expected 400, got {st} {over}")

    # ── D. Fixed-amount mode ──
    st, invf = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": pkt_date_iso(), "companyId": cid, "clientId": client["id"], "gstRate": 18,
        "withholdingTaxAmount": 200,
        "items": [{"description": "Fixed WHT good", "quantity": 10, "uom": "Pcs",
                   "unitPrice": 100, "itemTypeId": it_id}]})
    check("D1 fixed-amount invoice created", st in (200, 201), f"{st} {invf}")
    if st in (200, 201):
        check("D2 grand total = 1180", approx(invf.get("grandTotal"), 1180), f"{invf.get('grandTotal')}")
        check("D3 WHT rate null (amount mode)", invf.get("withholdingTaxRate") in (None, 0, 0.0), f"{invf.get('withholdingTaxRate')}")
        check("D4 WHT amount = 200", approx(invf.get("withholdingTaxAmount"), 200), f"{invf.get('withholdingTaxAmount')}")
        check("D5 balance due = 980 (1180 - 200)", approx(invf.get("balanceDue"), 980), f"{invf.get('balanceDue')}")

    # ── E. Backward compatibility: no WHT ──
    st, invn = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": pkt_date_iso(), "companyId": cid, "clientId": client["id"], "gstRate": 18,
        "items": [{"description": "No WHT good", "quantity": 10, "uom": "Pcs",
                   "unitPrice": 100, "itemTypeId": it_id}]})
    check("E1 no-WHT invoice created", st in (200, 201), f"{st} {invn}")
    if st in (200, 201):
        check("E2 WHT amount = 0", approx(invn.get("withholdingTaxAmount"), 0), f"{invn.get('withholdingTaxAmount')}")
        check("E3 balance due == grand total (unchanged)", approx(invn.get("balanceDue"), invn.get("grandTotal")), f"{invn.get('balanceDue')} vs {invn.get('grandTotal')}")

    # ── F. Purchase bill, RATE mode ──
    st, bill = http("POST", "/api/purchasebills", base, token=token, body={
        "date": pkt_date_iso(), "companyId": cid, "supplierId": supplier["id"], "gstRate": 18,
        "withholdingTaxRate": 5.5,
        "items": [{"description": "Bought goods", "quantity": 35, "unitPrice": 3900,
                   "uom": "Pcs", "itemTypeId": it_id}]})
    if st not in (200, 201):
        print(f"WARN: purchase bill create failed ({st} {bill})")
        check("F0 purchase bill created", False, f"{st} {bill}")
        bill_id = None
    else:
        bill_id = bill["id"]
        check("F1 grand total = 161070", approx(bill.get("grandTotal"), 161070), f"{bill.get('grandTotal')}")
        check("F2 WHT amount = 8858.85", approx(bill.get("withholdingTaxAmount"), 8858.85), f"{bill.get('withholdingTaxAmount')}")
        check("F3 balance due = 152211.15 (owed to supplier)", approx(bill.get("balanceDue"), 152211.15), f"{bill.get('balanceDue')}")
        st, pm = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
            "direction": "Payment", "date": pkt_date_iso(), "contactType": "Supplier",
            "contactId": supplier["id"], "method": "Cash",
            "allocations": [{"purchaseBillId": bill_id, "amount": 152211.15}]})
        check("F4 payment of collectible accepted", st in (200, 201), f"{st} {pm}")
        _, bill2 = http("GET", f"/api/purchasebills/{bill_id}", base, token=token)
        check("F5 bill balance due now 0 / Paid", approx(bill2.get("balanceDue"), 0) and bill2.get("paymentStatus") == "Paid",
              f"bal={bill2.get('balanceDue')} status={bill2.get('paymentStatus')}")
        st, over2 = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
            "direction": "Payment", "date": pkt_date_iso(), "contactType": "Supplier",
            "contactId": supplier["id"], "method": "Cash",
            "allocations": [{"purchaseBillId": bill_id, "amount": 1.00}]})
        check("F6 over-payment (past collectible) rejected", st == 400, f"expected 400, got {st}")

    print(f"\n== IDS for GL/SQL check: company={cid} invoice={inv_id} bill={bill_id} ==")

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{passed}/{total} checks passed")
    if not args.keep:
        http("DELETE", f"/api/companies/{cid}", base, token=token)
        print("(ephemeral company deleted)")
    else:
        print(f"(kept company {cid} for inspection)")
    return 0 if passed == total else 1

if __name__ == "__main__":
    sys.exit(main())
