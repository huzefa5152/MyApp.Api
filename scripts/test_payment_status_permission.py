"""
Payment-status permission test.

Proves that the AR/AP payment fields (AmountPaid / BalanceDue / PaymentStatus /
DaysOverdue) are access-controlled SERVER-SIDE on the invoices/bills list +
get-by-id endpoints — not merely hidden in the UI. A caller without
`accounting.paymentstatus.view` (and without receipts.*/payments.*) must get
those fields as null; a caller with visibility (seed admin) must get them
populated.

Setup (all cleaned up on success):
  - a fresh non-isolated company + a client + one standalone bill (Unpaid),
  - an RBAC role with ONLY bills.list.view + invoices.list.view (no payment
    permissions), and a user assigned to it.

Then GET the paged list + get-by-id as admin (fields present) and as the
restricted user (fields nulled).

Usage: python scripts/test_payment_status_permission.py
Exit 0 = all pass, 1 = a failure (leaves test rows for inspection).
Requires the backend running on :5134 with the payment-scrub change applied.
"""
from __future__ import annotations
import json, sys, urllib.request, urllib.error
from typing import Any

BASE = "http://localhost:5134"
CO_NAME = "Test PayPerm Co."
ROLE_NAME = "PayPerm NoView (test)"
USER_NAME = "payperm_user"
PAY_FIELDS = ["amountPaid", "balanceDue", "paymentStatus", "daysOverdue"]

results: list[tuple[bool, str]] = []


def request(method: str, path: str, token: str | None = None, body: Any = None) -> tuple[int, Any]:
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        try:
            return e.code, (json.loads(raw) if raw else None)
        except Exception:
            return e.code, raw


def login(username: str, password: str) -> str:
    status, data = request("POST", "/api/auth/login", body={"username": username, "password": password})
    assert status == 200 and data and data.get("token"), f"login {username}: {status} {data}"
    return data["token"]


def check(ok: bool, label: str):
    results.append((ok, label))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}")


def find_row(rows: list[dict], bill_id: int) -> dict | None:
    return next((r for r in (rows or []) if r.get("id") == bill_id), None)


def main() -> int:
    admin = login("admin", "admin123")

    # ── Clean up leftovers from a prior run ──
    _, users = request("GET", "/api/users", token=admin)
    for u in (users or []):
        if u.get("username") == USER_NAME:
            request("DELETE", f"/api/users/{u['id']}", token=admin)
    _, companies = request("GET", "/api/companies", token=admin)
    for c in (companies or []):
        if c.get("name") == CO_NAME:
            request("DELETE", f"/api/companies/{c['id']}", token=admin)
    _, roles = request("GET", "/api/roles", token=admin)
    for r in (roles or []):
        if r.get("name") == ROLE_NAME:
            request("DELETE", f"/api/roles/{r['id']}", token=admin)

    company = client = role = user = bill = None
    try:
        # ── Company (non-isolated → the restricted user has access) ──
        status, company = request("POST", "/api/companies", token=admin, body={
            "name": CO_NAME, "fullAddress": "PayPerm HQ", "phone": "+92-21-00000000",
            "ntn": "1234567", "cnic": "1234567890123", "strn": "1234567890123",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        })
        assert status in (200, 201), f"create company: {status} {company}"
        cid = company["id"]

        # ── Client ──
        status, client = request("POST", "/api/clients", token=admin, body={
            "companyId": cid, "name": "PayPerm Client", "phone": "+92-00-0000000",
            "site": "Karachi", "ntn": "0000001", "cnic": "0000001000001",
            "strn": "0000001000001", "registrationType": "Registered",
        })
        assert status in (200, 201), f"create client: {status} {client}"

        # ── Standalone bill (Unpaid) ──
        status, bill = request("POST", "/api/invoices/standalone", token=admin, body={
            "companyId": cid, "clientId": client["id"], "date": "2026-07-27", "gstRate": 18,
            "items": [{"description": "Test line", "quantity": 2, "uom": "Numbers, pieces, units", "unitPrice": 500}],
        })
        assert status in (200, 201), f"create standalone bill: {status} {bill}"
        bill_id = bill["id"]

        # ── Restricted role: can list bills/invoices, NO payment visibility ──
        status, role = request("POST", "/api/roles", token=admin, body={
            "name": ROLE_NAME, "description": "test — list access without payment status",
            "permissionKeys": ["bills.list.view", "invoices.list.view"],
        })
        assert status in (200, 201), f"create role: {status} {role}"

        # ── User assigned ONLY that role ──
        status, user = request("POST", "/api/users", token=admin, body={
            "username": USER_NAME, "email": "payperm@test.local",
            "password": "test1234", "fullName": "PayPerm User", "role": "User",
        })
        assert status in (200, 201), f"create user: {status} {user}"
        status, _ = request("PUT", f"/api/users/{user['id']}/roles", token=admin, body={"roleIds": [role["id"]]})
        assert status == 200, f"assign role: {status}"
        # Explicit company access (the company is non-isolated, but be deterministic).
        request("PUT", f"/api/usercompanies/user/{user['id']}", token=admin, body={"companyIds": [cid]})

        restricted = login(USER_NAME, "test1234")

        # ── Admin sees payment fields populated ──
        status, paged = request("GET", f"/api/invoices/company/{cid}/paged", token=admin)
        row = find_row(paged.get("items") if isinstance(paged, dict) else paged, bill_id)
        check(status == 200 and row is not None and row.get("paymentStatus") not in (None, "")
              and row.get("balanceDue") is not None,
              "admin: paged list HAS payment status + balance (populated)")

        status, one = request("GET", f"/api/invoices/{bill_id}", token=admin)
        check(status == 200 and one and one.get("paymentStatus") not in (None, ""),
              "admin: get-by-id HAS payment status")

        # ── Restricted user gets them nulled ──
        status, paged_r = request("GET", f"/api/invoices/company/{cid}/paged", token=restricted)
        row_r = find_row(paged_r.get("items") if isinstance(paged_r, dict) else paged_r, bill_id)
        got_list = status == 200 and row_r is not None
        check(got_list, "restricted: can still list bills (bills.list.view)")
        if got_list:
            check(all(row_r.get(f) is None for f in PAY_FIELDS),
                  f"restricted: paged list NULLS payment fields ({', '.join(PAY_FIELDS)})")

        status, one_r = request("GET", f"/api/invoices/{bill_id}", token=restricted)
        check(status == 200 and one_r is not None and all(one_r.get(f) is None for f in PAY_FIELDS),
              "restricted: get-by-id NULLS payment fields")
    finally:
        if user:    request("DELETE", f"/api/users/{user['id']}", token=admin)
        if company: request("DELETE", f"/api/companies/{company['id']}", token=admin)  # cascades bill + client
        if role:    request("DELETE", f"/api/roles/{role['id']}", token=admin)

    passed = sum(1 for ok, _ in results if ok)
    total = len(results)
    print(f"\n{passed}/{total} checks passed")
    if passed == total and total >= 5:
        print("all PASS")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
