#!/usr/bin/env python3
"""Focused smoke test for the Payments/Receipts feature (design Phase A).

Creates an ephemeral company + client + standalone invoice, then exercises the
receipt lifecycle end-to-end against a running backend (default :5134):

  • due-date setter drives status,
  • partial receipt -> PartiallyPaid + balance reflow,
  • full receipt -> Paid,
  • over-allocation rejected (400),
  • receipts list,
  • delete receipt -> balance/status restored.

Read-only-safe: all data is created under a throwaway company and torn down.
Usage: python scripts/smoke_payments.py [--base URL] [--keep]
"""
import argparse, json, sys, urllib.request, urllib.error
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
PASS, FAIL = "[PASS]", "[FAIL]"
results: list[tuple[bool, str, str]] = []


def http(method, path, base, token=None, body=None):
    url = base + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def check(name, ok, reason=""):
    results.append((ok, name, reason))
    print(f"  {PASS if ok else FAIL} {name:<55} {'' if ok else reason}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--pw", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()
    base = args.base

    st, data = http("POST", "/api/auth/login", base, body={"username": args.user, "password": args.pw})
    if st != 200:
        print(f"FATAL: login failed ({st} {data})"); sys.exit(2)
    token = data["token"]

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    st, company = http("POST", "/api/companies", base, token=token, body={
        "name": f"_smoke_payments {suffix}", "fullAddress": "Test HQ", "phone": "+92-21-0",
        "ntn": "9999999", "strn": "9999999999999", "startingInvoiceNumber": 1,
        "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Manufacturer", "fbrSector": "All Other Sectors",
    })
    if st not in (200, 201):
        print(f"FATAL: create company failed ({st} {company})"); sys.exit(2)
    cid = company["id"]
    st, client = http("POST", "/api/clients", base, token=token, body={
        "name": f"Smoke Client {suffix}", "companyId": cid, "ntn": "1234567",
        "fbrProvinceCode": 8, "registrationType": "Registered",
    })
    if st not in (200, 201):
        print(f"FATAL: create client failed ({st} {client})"); sys.exit(2)

    try:
        today = datetime.now().strftime("%Y-%m-%dT00:00:00")
        # Standalone invoice: 1000 + 18% = 1180 grand total.
        st, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
            "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 18,
            "items": [{"description": "Smoke item", "quantity": 1, "uom": "Pcs", "unitPrice": 1000}],
        })
        check("invoice created (grand 1180)", st in (200, 201) and abs(float(inv.get("grandTotal", 0)) - 1180) < 0.01, f"{st} {inv}")
        iid = inv["id"]
        grand = float(inv["grandTotal"])

        # Fresh invoice: unpaid, balance == grand.
        st, inv = http("GET", f"/api/invoices/{iid}", base, token=token)
        check("fresh invoice Unpaid", inv.get("paymentStatus") == "Unpaid", inv.get("paymentStatus"))
        check("fresh balanceDue == grand", abs(float(inv.get("balanceDue", 0)) - grand) < 0.01, str(inv.get("balanceDue")))

        # Due date in the past -> Overdue while unpaid.
        st, inv = http("PUT", f"/api/invoices/{iid}/due-date", base, token=token, body={"dueDate": "2020-01-01T00:00:00"})
        check("set due-date 200", st == 200, str(st))
        check("past due + unpaid -> Overdue", inv.get("paymentStatus") == "Overdue", inv.get("paymentStatus"))
        check("daysOverdue > 0", int(inv.get("daysOverdue", 0)) > 0, str(inv.get("daysOverdue")))

        # Partial receipt of 400.
        st, rc = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
            "date": today, "contactType": "Client", "contactId": client["id"], "method": "Cash",
            "allocations": [{"invoiceId": iid, "amount": 400}],
        })
        check("partial receipt created (201)", st in (200, 201), f"{st} {rc}")
        check("receipt amount 400", abs(float(rc.get("amount", 0)) - 400) < 0.01, str(rc.get("amount")))
        check("receipt reference RCP-*", str(rc.get("reference", "")).startswith("RCP-"), str(rc.get("reference")))
        rcid = rc["id"]

        st, inv = http("GET", f"/api/invoices/{iid}", base, token=token)
        check("after partial: amountPaid 400", abs(float(inv.get("amountPaid", 0)) - 400) < 0.01, str(inv.get("amountPaid")))
        check("after partial: balanceDue 780", abs(float(inv.get("balanceDue", 0)) - 780) < 0.01, str(inv.get("balanceDue")))
        # Due date is in the past, so a partly-paid invoice is Overdue (Overdue
        # outranks PartiallyPaid when past due — design §11.3).
        check("after partial: status Overdue (past due)", inv.get("paymentStatus") == "Overdue", inv.get("paymentStatus"))

        # Over-allocation: applying 800 (balance is 780) must be rejected.
        st, err = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
            "date": today, "contactType": "Client", "contactId": client["id"], "method": "Cash",
            "allocations": [{"invoiceId": iid, "amount": 800}],
        })
        check("over-allocation rejected (400)", st == 400, f"{st} {err}")

        # Settle the remaining 780 -> Paid.
        st, rc2 = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
            "date": today, "contactType": "Client", "contactId": client["id"], "method": "Cheque",
            "chequeNumber": "CHQ-1", "chequeDate": today,
            "allocations": [{"invoiceId": iid, "amount": 780}],
        })
        check("settle receipt created", st in (200, 201), f"{st} {rc2}")
        st, inv = http("GET", f"/api/invoices/{iid}", base, token=token)
        check("after settle: balanceDue 0", abs(float(inv.get("balanceDue", 0))) < 0.01, str(inv.get("balanceDue")))
        check("after settle: status Paid (not Overdue)", inv.get("paymentStatus") == "Paid", inv.get("paymentStatus"))

        # Receipts list shows both.
        st, page = http("GET", f"/api/payments/receipts/company/{cid}/paged", base, token=token)
        check("receipts list >= 2", st == 200 and page.get("totalCount", 0) >= 2, f"{st} {page.get('totalCount')}")

        # by-invoice panel.
        st, panel = http("GET", f"/api/payments/company/{cid}/by-invoice/{iid}", base, token=token)
        check("by-invoice returns the receipts", st == 200 and len(panel or []) >= 2, f"{st} {len(panel or [])}")

        # Delete the partial receipt -> balance restored to 400 outstanding (paid drops to 780).
        st, _ = http("DELETE", f"/api/payments/receipts/{rcid}", base, token=token)
        check("delete receipt 204", st in (200, 204), str(st))
        st, inv = http("GET", f"/api/invoices/{iid}", base, token=token)
        check("after delete: amountPaid 780", abs(float(inv.get("amountPaid", 0)) - 780) < 0.01, str(inv.get("amountPaid")))
        # Still past due with a balance -> Overdue.
        check("after delete: status Overdue (past due)", inv.get("paymentStatus") == "Overdue", inv.get("paymentStatus"))

        # A payment (money out) must not be allowed to settle a sales invoice.
        st, err = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
            "date": today, "contactType": "Supplier", "method": "Cash",
            "allocations": [{"invoiceId": iid, "amount": 10}],
        })
        check("payment can't settle an invoice (400)", st == 400, f"{st} {err}")
    finally:
        if not args.keep:
            http("DELETE", f"/api/companies/{cid}", base, token=token)
            print(f"\n=== Torn down company id={cid} ===")
        else:
            print(f"\n=== Kept company id={cid} ===")

    passed = sum(1 for ok, _, _ in results if ok)
    total = len(results)
    print(f"\n=== {passed}/{total} checks passed ===")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
