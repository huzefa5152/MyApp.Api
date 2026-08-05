#!/usr/bin/env python3
"""Invoice correction (supplement) — FBR-OFF path + dedup live check.

Branch rule: when a company has FBR integration OFF, a bill can be corrected
(supplemented with a delta bill) only once it is FULLY PAID. Also: no duplicate
correction per bill. This exercises the new POST /invoices/{id}/supplement.
Self-cleaning (creates + deletes one company)."""
import json, sys, urllib.request, urllib.error, time
B = "http://localhost:5134"

def H(m, p, tok=None, body=None):
    d = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(B + p, data=d, method=m); r.add_header("Content-Type", "application/json")
    if tok: r.add_header("Authorization", "Bearer " + tok)
    try:
        x = urllib.request.urlopen(r, timeout=60); raw = x.read().decode(); return x.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except: return e.code, raw

results = []
def check(name, ok, detail=""):
    results.append(ok); print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))

_, d = H("POST", "/api/auth/login", body={"username": "admin", "password": "admin123"}); tok = d["token"]
suffix = time.strftime("%H%M%S")
_, its = H("GET", "/api/itemtypes", tok); it_id = (its[0]["id"] if isinstance(its, list) and its else None)
print(f"item type id={it_id}")

cid = None
try:
    # FBR-OFF company (also GL off / inventory off to isolate the correction rule).
    _, c = H("POST", "/api/companies", tok, {"name": f"_corr {suffix}", "fullAddress": "HQ",
        "startingInvoiceNumber": 1, "fbrEnabled": False, "inventoryTrackingEnabled": False,
        "inventoryFlowVersion": 1, "enableGl": False})
    cid = c["id"]; check("FBR-off company created", c.get("fbrEnabled") is False, f"id={cid}")
    _, cl = H("POST", "/api/clients", tok, {"name": "Corr Client", "companyId": cid, "ntn": "1234567",
        "fbrProvinceCode": 8, "registrationType": "Registered"})

    def make_bill():
        st, b = H("POST", "/api/invoices/standalone", tok, {"date": "2026-07-04T00:00:00.000Z",
            "companyId": cid, "clientId": cl["id"], "gstRate": 18, "documentType": 4, "paymentMode": "Cash",
            "items": [{"description": f"Widget {suffix}", "quantity": 10, "uom": "Numbers, pieces, units",
                       "unitPrice": 100, "itemTypeId": it_id}]})
        return st, b

    st, bill = make_bill()
    check("classified bill created", st in (200, 201), f"{st}")
    iid = bill["id"]; line_id = bill["items"][0]["id"]; num = bill["invoiceNumber"]
    print(f"  bill id={iid} number={num} grandTotal={bill.get('grandTotal')}")

    # A) unpaid -> correction blocked (FBR-off requires fully paid)
    st, err = H("POST", f"/api/invoices/{iid}/supplement", tok, {"lines": [{"invoiceItemId": line_id, "quantity": 5}]})
    check("A: unpaid bill correction blocked (400)", st == 400, f"{st} {str(err)[:80]}")
    check("A: message cites fully-paid rule", "paid" in str(err).lower(), str(err)[:90])

    # pay in full -> Paid
    st, rc = H("POST", f"/api/payments/receipts/company/{cid}", tok, {"date": "2026-07-04T00:00:00.000Z",
        "contactType": "Client", "contactId": cl["id"], "method": "Cash",
        "allocations": [{"invoiceId": iid, "amount": bill["grandTotal"]}]})
    check("receipt (full) recorded", st in (200, 201), f"{st}")

    # B) paid -> supplement succeeds, delta bill links back + correct math
    st, sup = H("POST", f"/api/invoices/{iid}/supplement", tok, {"lines": [{"invoiceItemId": line_id, "quantity": 5}], "carryChallan": False, "reason": "Balance qty"})
    check("B: paid bill correction succeeds", st in (200, 201), f"{st} {str(sup)[:80]}")
    if isinstance(sup, dict) and sup.get("id"):
        check("B: delta bill links to original (supplementsInvoiceId)", sup.get("supplementsInvoiceId") == iid, f"{sup.get('supplementsInvoiceId')}")
        check("B: delta bill numbered next in sequence", sup.get("invoiceNumber") == num + 1, f"{sup.get('invoiceNumber')} vs {num+1}")
        check("B: delta subtotal = 5x100 = 500", abs(float(sup.get("subtotal", 0)) - 500) < 0.01, str(sup.get("subtotal")))
        check("B: delta grand = 590 (18% GST)", abs(float(sup.get("grandTotal", 0)) - 590) < 0.01, str(sup.get("grandTotal")))

    # C) dedup: second correction blocked
    st, err2 = H("POST", f"/api/invoices/{iid}/supplement", tok, {"lines": [{"invoiceItemId": line_id, "quantity": 2}]})
    check("C: duplicate correction blocked (400)", st == 400, f"{st} {str(err2)[:80]}")
    check("C: message cites existing correction", "already" in str(err2).lower(), str(err2)[:90])
finally:
    if cid: H("DELETE", f"/api/companies/{cid}", tok); print(f"cleanup company {cid}")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
