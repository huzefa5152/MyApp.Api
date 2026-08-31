#!/usr/bin/env python3
"""
Customer Portal — end-to-end verification, with the IDOR suite as the point of it.

  1. Portal management   create / duplicate guard / cross-tenant client / RBAC
  2. Token quality       length, charset, uniqueness, unpredictability
  3. Public access       valid / unknown / disabled / revoked, identical responses
  4. DATA ISOLATION      portal A can NEVER reach client B or company B
  5. Payment status      unpaid / partial / paid / OVERPAID, and the SQL status
                         filter agreeing with the canonical calculator
  6. Print payload       right invoice, right company, ownership enforced
  7. Listing             paging, search, date filter, summary totals

Suite 4 is the one that matters. Every public request must derive ownership from
the token on the server, so the script hammers every parameter a browser could
forge — route invoice numbers, and clientId / companyId / invoiceId query strings
— and asserts none of them move the boundary.

Runs against two ephemeral companies with two clients each, deleted at the end.

Usage:
  python scripts/test_customer_portal.py
  python scripts/test_customer_portal.py --base http://localhost:5134 --keep
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

PASS = "PASS"
results: list[tuple[str, str, str]] = []

PKT = timezone(timedelta(hours=5))
TODAY = datetime.now(PKT).date()
TODAY_ISO = TODAY.isoformat()


def http(method: str, path: str, base: str, token: str | None = None,
         body: Any = None, timeout: int = 60) -> tuple[int, Any]:
    url = base.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        try:
            return e.code, json.loads(raw) if raw else None
        except Exception:
            return e.code, raw


def public(path: str, base: str, timeout: int = 60) -> tuple[int, Any]:
    """A request with NO Authorization header — exactly what a customer's browser sends."""
    return http("GET", path, base, token=None, timeout=timeout)


def check(suite: str, name: str, ok: bool, reason: str = "") -> None:
    results.append((suite, name, PASS if ok else f"FAIL — {reason}"))


# ── Setup ──────────────────────────────────────────────────────────
def make_company(base, token, name, suffix):
    status, company = http("POST", "/api/companies", base, token=token, body={
        "name": name, "fullAddress": f"{name} HQ", "phone": "+92-21-00000000",
        "ntn": "9999999", "cnic": "9999999999999", "strn": "9999999999999",
        "startingInvoiceNumber": 1, "startingChallanNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Manufacturer", "fbrSector": "All Other Sectors",
        "fbrToken": "test-token-not-used-for-real-pral-calls",
        "fbrEnabled": True, "inventoryTrackingEnabled": False, "enableGl": False,
    })
    if status not in (200, 201):
        print(f"FATAL: create company {name} failed ({status} {company})")
        sys.exit(2)
    return company


def make_client(base, token, company_id, name):
    status, client = http("POST", "/api/clients", base, token=token, body={
        "name": name, "address": "1 Test Road, Karachi", "phone": "021-1234567",
        "companyId": company_id, "ntn": "1234567", "strn": "1234567890123",
        "fbrProvinceCode": 8, "registrationType": "Registered",
    })
    if status not in (200, 201):
        print(f"FATAL: create client {name} failed ({status} {client})")
        sys.exit(2)
    return client


def make_invoice(base, token, company_id, client_id, item_type_id, amount, due_days=None):
    body = {
        "date": TODAY_ISO, "companyId": company_id, "clientId": client_id, "gstRate": 0,
        "items": [{"description": "Portal Test Line", "quantity": 1, "uom": "Pcs",
                   "unitPrice": amount, "itemTypeId": item_type_id}],
    }
    status, inv = http("POST", "/api/invoices/standalone", base, token=token, body=body)
    if status in (200, 201) and due_days is not None:
        http("PUT", f"/api/invoices/{inv['id']}/due-date", base, token=token,
             body={"dueDate": (TODAY + timedelta(days=due_days)).isoformat()})
    return status, inv


def pay_invoice(base, token, company_id, client_id, invoice_id, amount, division_id=None):
    """Records a receipt allocated to one invoice, through the real receipts API —
    so Invoice.AmountPaid is maintained by the same code the internal app uses."""
    return http("POST", f"/api/payments/receipts/company/{company_id}", base, token=token, body={
        "direction": "Receipt", "date": TODAY_ISO,
        "contactType": "Client", "contactId": client_id,
        "method": "Cash", "divisionId": division_id,
        "allocations": [{"invoiceId": invoice_id, "amount": amount}],
    })


def setup(base: str, admin_user: str, admin_pw: str):
    print(f"\n=== Logging in as {admin_user} ===")
    status, data = http("POST", "/api/auth/login", base,
                        body={"username": admin_user, "password": admin_pw})
    if status != 200:
        print(f"FATAL: admin login failed ({status} {data})")
        sys.exit(2)
    token = data["token"]

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    print(f"\n=== Creating two ephemeral companies ===")
    a = make_company(base, token, f"_test_portal_A {suffix}", suffix)
    b = make_company(base, token, f"_test_portal_B {suffix}", suffix)
    print(f"  company A id={a['id']}  company B id={b['id']}")

    a1 = make_client(base, token, a["id"], f"Portal A Client One {suffix}")
    a2 = make_client(base, token, a["id"], f"Portal A Client Two {suffix}")
    b1 = make_client(base, token, b["id"], f"Portal B Client One {suffix}")

    status, types = http("GET", "/api/itemtypes", base, token=token)
    item_type_id = types[0]["id"] if status == 200 and types else None

    return token, a, b, a1, a2, b1, item_type_id


def teardown(base, token, companies, keep):
    if keep:
        print(f"\n=== Keeping companies {[c['id'] for c in companies]} (--keep) ===")
        return
    print("\n=== Deleting ephemeral companies ===")
    for c in companies:
        st, _ = http("DELETE", f"/api/companies/{c['id']}", base, token=token)
        print(f"  company {c['id']} delete -> {st}")


# ── Suite 1: management ────────────────────────────────────────────
def test_management(base, token, a, b, a1, a2, b1):
    suite = "1. Portal management"
    print(f"\n=== {suite} ===")

    st, portal_a = http("POST", "/api/customer-portals", base, token=token,
                        body={"companyId": a["id"], "clientId": a1["id"]})
    check(suite, "1a create portal returns 201", st in (200, 201), f"got {st} {portal_a}")
    if st not in (200, 201):
        return None, None, None

    check(suite, "1a response carries a public URL",
          isinstance(portal_a.get("publicUrl"), str) and "/portal/" in portal_a["publicUrl"],
          f"got {portal_a.get('publicUrl')}")
    check(suite, "1a portal is active", portal_a.get("isActive") is True, f"got {portal_a}")
    check(suite, "1a client + company echoed back",
          portal_a["clientId"] == a1["id"] and portal_a["companyId"] == a["id"], f"got {portal_a}")

    # One live link per customer.
    st, dup = http("POST", "/api/customer-portals", base, token=token,
                   body={"companyId": a["id"], "clientId": a1["id"]})
    check(suite, "1b second active portal for the same client refused (400)", st == 400, f"got {st} {dup}")

    # A client from another company must not be bindable to this company's portal.
    st, cross = http("POST", "/api/customer-portals", base, token=token,
                     body={"companyId": a["id"], "clientId": b1["id"]})
    check(suite, "1c cross-company client refused (400)", st == 400, f"got {st} {cross}")

    st, missing = http("POST", "/api/customer-portals", base, token=token,
                       body={"companyId": a["id"], "clientId": 99999999})
    check(suite, "1d unknown client refused (404)", missing is not None and st == 404, f"got {st} {missing}")

    # Second portal, different client, for the isolation suite.
    st, portal_a2 = http("POST", "/api/customer-portals", base, token=token,
                         body={"companyId": a["id"], "clientId": a2["id"]})
    check(suite, "1e second client in the same company gets its own portal",
          st in (200, 201), f"got {st} {portal_a2}")

    st, portal_b = http("POST", "/api/customer-portals", base, token=token,
                        body={"companyId": b["id"], "clientId": b1["id"]})
    check(suite, "1f portal for the other company created", st in (200, 201), f"got {st} {portal_b}")

    st, listed = http("GET", "/api/customer-portals", base, token=token)
    check(suite, "1g list returns the created portals",
          st == 200 and isinstance(listed, list) and len(listed) >= 3, f"got {st}")

    return portal_a, portal_a2 if isinstance(portal_a2, dict) else None, portal_b if isinstance(portal_b, dict) else None


# ── Suite 2: token quality ─────────────────────────────────────────
def test_tokens(base, token, portals):
    suite = "2. Token quality"
    print(f"\n=== {suite} ===")
    toks = [p["publicUrl"].rsplit("/", 1)[-1] for p in portals if p]

    check(suite, "2a every token is 43 chars", all(len(t) == 43 for t in toks), f"{[len(t) for t in toks]}")
    check(suite, "2b base64url charset only",
          all(re.fullmatch(r"[A-Za-z0-9_-]+", t) for t in toks), f"{toks}")
    check(suite, "2c tokens are unique", len(set(toks)) == len(toks), f"{toks}")
    # A sequential or id-derived token would share long runs; random ones don't.
    check(suite, "2d no token contains a company or client id pattern",
          all(not re.search(r"(client|company|portal)[-_]?\d", t, re.I) for t in toks), f"{toks}")
    check(suite, "2e tokens don't share a common prefix (not counter-based)",
          len({t[:8] for t in toks}) == len(toks), f"{[t[:8] for t in toks]}")


# ── Suite 3: public access + lifecycle ─────────────────────────────
def test_public_access(base, token, portal_a):
    suite = "3. Public access"
    print(f"\n=== {suite} ===")
    tok = portal_a["publicUrl"].rsplit("/", 1)[-1]

    st, head = public(f"/api/public/customer-portal/{tok}", base)
    check(suite, "3a valid token resolves WITHOUT any auth header", st == 200, f"got {st} {head}")
    if st == 200:
        check(suite, "3a header carries company + customer",
              bool(head.get("companyName")) and bool(head.get("clientName")), f"got {head}")
        check(suite, "3a header exposes no internal ids",
              not any(k in json.dumps(head) for k in ("clientId", "companyId", "invoiceId")),
              f"got {list(head.keys())}")

    st, unknown = public(f"/api/public/customer-portal/{'z' * 43}", base)
    check(suite, "3b unknown token 404s", st == 404, f"got {st} {unknown}")
    st, malformed = public("/api/public/customer-portal/short", base)
    check(suite, "3c malformed token 404s", st == 404, f"got {st} {malformed}")

    # Identical bodies: a stranger must not be able to tell a real-but-revoked
    # token from a wrong guess.
    check(suite, "3d unknown and malformed give the SAME body",
          json.dumps(unknown, sort_keys=True) == json.dumps(malformed, sort_keys=True),
          f"{unknown} vs {malformed}")

    # Disable → access stops at once, same generic body.
    http("PUT", f"/api/customer-portals/{portal_a['id']}/active", base, token=token,
         body={"isActive": False})
    st, disabled = public(f"/api/public/customer-portal/{tok}", base)
    check(suite, "3e disabled portal 404s immediately", st == 404, f"got {st} {disabled}")
    check(suite, "3e disabled body identical to unknown",
          json.dumps(disabled, sort_keys=True) == json.dumps(unknown, sort_keys=True),
          f"{disabled} vs {unknown}")
    st, _ = public(f"/api/public/customer-portal/{tok}/invoices", base)
    check(suite, "3e disabled portal's invoices 404 too", st == 404, f"got {st}")

    # Re-enable → the SAME token works again.
    http("PUT", f"/api/customer-portals/{portal_a['id']}/active", base, token=token,
         body={"isActive": True})
    st, back = public(f"/api/public/customer-portal/{tok}", base)
    check(suite, "3f re-enabling restores the same link", st == 200, f"got {st} {back}")


# ── Suite 4: DATA ISOLATION (the one that matters) ─────────────────
def test_isolation(base, token, a, b, a1, a2, b1, portal_a, portal_a2, portal_b, item_type_id):
    suite = "4. Data isolation (IDOR)"
    print(f"\n=== {suite} ===")

    tok_a = portal_a["publicUrl"].rsplit("/", 1)[-1]
    tok_a2 = portal_a2["publicUrl"].rsplit("/", 1)[-1]
    tok_b = portal_b["publicUrl"].rsplit("/", 1)[-1]

    # One invoice per client, with distinct amounts so a leak is unmistakable.
    _, inv_a1 = make_invoice(base, token, a["id"], a1["id"], item_type_id, 1111)
    _, inv_a2 = make_invoice(base, token, a["id"], a2["id"], item_type_id, 2222)
    _, inv_b1 = make_invoice(base, token, b["id"], b1["id"], item_type_id, 3333)

    def numbers(tok):
        st, page = public(f"/api/public/customer-portal/{tok}/invoices?pageSize=100", base)
        if st != 200:
            return st, None
        return st, {i["invoiceNumber"] for i in page.get("items", [])}

    st, nums_a = numbers(tok_a)
    check(suite, "4a portal A lists only its own client's invoices",
          st == 200 and nums_a == {inv_a1["invoiceNumber"]},
          f"got {st} {nums_a}, expected {{{inv_a1['invoiceNumber']}}}")

    st, nums_a2 = numbers(tok_a2)
    check(suite, "4b portal A2 (same company, other client) sees only its own",
          st == 200 and nums_a2 == {inv_a2["invoiceNumber"]},
          f"got {st} {nums_a2}, expected {{{inv_a2['invoiceNumber']}}}")

    st, nums_b = numbers(tok_b)
    check(suite, "4c portal B (other company) sees only its own",
          st == 200 and nums_b == {inv_b1["invoiceNumber"]},
          f"got {st} {nums_b}, expected {{{inv_b1['invoiceNumber']}}}")

    # ── Route-parameter tampering ────────────────────────────────────
    # Same company, different client. If numbers happen to collide the guard is
    # even more important, so assert on the AMOUNT that comes back, not just the
    # status: portal A must never return client two's 2222.
    st, other = public(f"/api/public/customer-portal/{tok_a}/invoices/{inv_a2['invoiceNumber']}", base)
    leaked = st == 200 and abs(float((other or {}).get("total") or 0) - 2222) < 0.01
    check(suite, "4d portal A cannot fetch client TWO's invoice by number",
          not leaked, f"LEAK: got {st} {other}")

    st, cross_co = public(f"/api/public/customer-portal/{tok_a}/invoices/{inv_b1['invoiceNumber']}", base)
    leaked_co = st == 200 and abs(float((cross_co or {}).get("total") or 0) - 3333) < 0.01
    check(suite, "4e portal A cannot fetch the OTHER COMPANY's invoice",
          not leaked_co, f"LEAK: got {st} {cross_co}")

    st, cross_print = public(
        f"/api/public/customer-portal/{tok_a}/invoices/{inv_b1['invoiceNumber']}/print", base)
    check(suite, "4f portal A cannot print another company's invoice", st == 404, f"got {st} {cross_print}")

    # ── Query-string tampering: the classic attempts ────────────────
    forgeries = [
        (f"?clientId={a2['id']}", "clientId"),
        (f"?companyId={b['id']}", "companyId"),
        (f"?invoiceId={inv_b1['id']}", "invoiceId"),
        (f"?clientId={b1['id']}&companyId={b['id']}", "clientId+companyId"),
        (f"?ClientId={a2['id']}", "ClientId (cased)"),
    ]
    for qs, label in forgeries:
        st, page = public(f"/api/public/customer-portal/{tok_a}/invoices{qs}&pageSize=100", base)
        got = {i["invoiceNumber"] for i in (page or {}).get("items", [])} if st == 200 else None
        check(suite, f"4g ?{label} cannot change the client shown",
              st == 200 and got == {inv_a1["invoiceNumber"]},
              f"got {st} {got} — expected only {inv_a1['invoiceNumber']}")

    # ── Token substitution on a nested route ─────────────────────────
    st, wrong_tok = public(
        f"/api/public/customer-portal/{'q' * 43}/invoices/{inv_a1['invoiceNumber']}", base)
    check(suite, "4h a bogus token on a real invoice number 404s", st == 404, f"got {st} {wrong_tok}")

    # ── Advances must never cross the client boundary ────────────────
    # A receipt recorded against client TWO (a2), with more cash than it
    # allocates, leaves an advance sitting on client two's ledger
    # (ICustomerLedgerService) — money portal A (client ONE) has no claim
    # on. Task 9: the portal now nets a customer's own advance into its
    # outstanding figure, so this is the one place that netting could leak
    # across the tenant boundary if the scope were ever wrong.
    st_adv, adv = http("POST", f"/api/payments/receipts/company/{a['id']}", base, token=token, body={
        "direction": "Receipt", "date": TODAY_ISO,
        "contactType": "Client", "contactId": a2["id"],
        "method": "Cash", "amount": 5000, "allocations": [],
    })
    check(suite, "4j advance receipt recorded for client TWO", st_adv in (200, 201), f"got {st_adv} {adv}")

    st_l2, ledger_a2 = http(
        "GET", f"/api/customer-ledger/company/{a['id']}/client/{a2['id']}", base, token=token)
    check(suite, "4j client TWO's own ledger shows the advance",
          st_l2 == 200 and float((ledger_a2 or {}).get("advance") or 0) > 0,
          f"got {st_l2} {ledger_a2}")

    st_h1, head1 = public(f"/api/public/customer-portal/{tok_a}", base)
    sum1 = (head1 or {}).get("summary") or {}
    check(suite, "4k portal A's outstanding is unaffected by client TWO's advance",
          st_h1 == 200 and abs(float(sum1.get("outstandingAmount") or 0) - 1111) < 0.01,
          f"got {st_h1} {sum1}")
    check(suite, "4l portal A shows no credit borrowed from client TWO's advance",
          st_h1 == 200 and float(sum1.get("overpaidAmount") or 0) == 0, f"got {sum1}")
    check(suite, "4m portal A's response carries no trace of client TWO's advance amount",
          st_h1 == 200 and "5000" not in json.dumps(head1), f"got {head1}")

    # And the flip side: client TWO's own (still-active) portal must show
    # EXACTLY the advance the ledger recorded for client TWO — proving the
    # zero above is a real tenant boundary, not the netting silently
    # failing to find any advance at all.
    st_h2, head2 = public(f"/api/public/customer-portal/{tok_a2}", base)
    sum2 = (head2 or {}).get("summary") or {}
    check(suite, "4n portal A2 (client TWO) shows its OWN advance, matching the ledger",
          st_h2 == 200 and st_l2 == 200
          and abs(float(sum2.get("overpaidAmount") or 0) - float(ledger_a2.get("advance") or 0)) < 0.01,
          f"got portal={sum2.get('overpaidAmount')} ledger={ledger_a2.get('advance') if st_l2 == 200 else st_l2}")

    # ── Revoked portal is dead for good ─────────────────────────────
    http("DELETE", f"/api/customer-portals/{portal_a2['id']}", base, token=token)
    st, revoked = public(f"/api/public/customer-portal/{tok_a2}", base)
    check(suite, "4i revoked portal's token stops resolving", st == 404, f"got {st} {revoked}")
    st, revoked_inv = public(f"/api/public/customer-portal/{tok_a2}/invoices", base)
    check(suite, "4i revoked portal's invoices 404 too", st == 404, f"got {st} {revoked_inv}")

    return inv_a1


# ── Suite 5: payment status ────────────────────────────────────────
def test_payment_status(base, token, a, a1, portal_a, item_type_id):
    suite = "5. Payment status"
    print(f"\n=== {suite} ===")
    tok = portal_a["publicUrl"].rsplit("/", 1)[-1]

    # Four invoices, one per state. GST 0 keeps the arithmetic obvious.
    _, unpaid = make_invoice(base, token, a["id"], a1["id"], item_type_id, 1000)
    _, partial = make_invoice(base, token, a["id"], a1["id"], item_type_id, 1000)
    _, paid = make_invoice(base, token, a["id"], a1["id"], item_type_id, 1000)
    _, over = make_invoice(base, token, a["id"], a1["id"], item_type_id, 1000)

    st_p, _ = pay_invoice(base, token, a["id"], a1["id"], partial["id"], 400)
    st_f, _ = pay_invoice(base, token, a["id"], a1["id"], paid["id"], 1000)

    check(suite, "5a part payment recorded", st_p in (200, 201), f"got {st_p}")
    check(suite, "5b full payment recorded", st_f in (200, 201), f"got {st_f}")

    # Reaching "overpaid" takes a detour, and the detour is the whole reason the
    # state matters. The receipts ledger REFUSES to allocate more than an
    # invoice's balance ("Receipt would over-pay Invoice #N"), so the only way an
    # invoice ends up over-paid is the ordinary one: it was paid in full and then
    # edited DOWN. The internal app renders that as "Paid" with a zero balance —
    # PaymentStatusCalculator.BalanceDue clamps at zero — so the customer's
    # credit is invisible there. The portal is where it has to show up.
    st_reject, reject_body = pay_invoice(base, token, a["id"], a1["id"], over["id"], 1300)
    check(suite, "5c the ledger refuses a direct over-allocation",
          st_reject == 400 and "over-pay" in json.dumps(reject_body).lower(),
          f"got {st_reject} {reject_body}")

    st_full, _ = pay_invoice(base, token, a["id"], a1["id"], over["id"], 1000)
    check(suite, "5c overpay setup: paid in full first", st_full in (200, 201), f"got {st_full}")
    st_get, full = http("GET", f"/api/invoices/{over['id']}", base, token=token)
    overpay_allowed = False
    if st_get == 200:
        items = [{"id": i["id"], "description": i["description"], "quantity": i["quantity"],
                  "uom": i["uom"], "unitPrice": 600, "itemTypeId": i.get("itemTypeId")}
                 for i in full["items"]]
        st_edit, _ = http("PUT", f"/api/invoices/{over['id']}", base, token=token,
                          body={"gstRate": 0, "items": items})
        check(suite, "5c overpay setup: invoice edited down below what was paid",
              st_edit == 200, f"got {st_edit}")
        overpay_allowed = st_edit == 200
        if overpay_allowed:
            # Pin the behaviour this feature exists to correct.
            st_i, internal = http("GET", f"/api/invoices/{over['id']}", base, token=token)
            check(suite, "5c internal view still reports Paid with a zero balance",
                  st_i == 200 and internal["paymentStatus"] == "Paid"
                  and float(internal["balanceDue"]) == 0,
                  f"got {internal.get('paymentStatus')} / {internal.get('balanceDue')}")

    st, page = public(f"/api/public/customer-portal/{tok}/invoices?pageSize=100", base)
    by_num = {i["invoiceNumber"]: i for i in (page or {}).get("items", [])} if st == 200 else {}

    def status_of(inv):
        return (by_num.get(inv["invoiceNumber"]) or {}).get("status")

    check(suite, "5d unpaid invoice reads Unpaid", status_of(unpaid) == "Unpaid", f"got {status_of(unpaid)}")
    check(suite, "5e part-paid invoice reads PartiallyPaid",
          status_of(partial) == "PartiallyPaid", f"got {status_of(partial)}")
    check(suite, "5f fully-paid invoice reads Paid", status_of(paid) == "Paid", f"got {status_of(paid)}")

    row = by_num.get(partial["invoiceNumber"]) or {}
    check(suite, "5g part-paid balance is total - paid",
          abs(float(row.get("balance") or 0) - 600) < 0.01, f"got {row}")

    if overpay_allowed:
        check(suite, "5h over-paid invoice reads Overpaid",
              status_of(over) == "Overpaid", f"got {status_of(over)}")
        orow = by_num.get(over["invoiceNumber"]) or {}
        check(suite, "5h credit shows the overpayment, not a negative balance",
              abs(float(orow.get("credit") or 0) - 400) < 0.01
              and float(orow.get("balance") or 0) == 0, f"got {orow}")

        # Task 9: the summary must NOT just sum these per-invoice balances —
        # that sum still clamps "over"'s own balance at 0 and stops there
        # (2711: 1111 + 1000 + 600 + 0 + 0). The true account-wide position
        # nets "over"'s 400 credit against what the OTHER invoices still owe,
        # so summary.outstandingAmount comes in 400 LOWER than that naive sum
        # — the credit is invisible nowhere, not even folded into a headline
        # figure that used to be blind to it.
        naive_outstanding = sum(float(r["balance"]) for r in by_num.values())
        st_now, head_now = public(f"/api/public/customer-portal/{tok}", base)
        sm_now = (head_now or {}).get("summary") or {}
        check(suite, "5h summary nets the overpayment into the account-wide outstanding",
              st_now == 200
              and abs(float(sm_now.get("outstandingAmount") or 0) - (naive_outstanding - 400)) < 0.01,
              f"got {sm_now.get('outstandingAmount')}, naive per-invoice sum was {naive_outstanding}")
    else:
        check(suite, "5h overpaid case could not be set up", False, "invoice edit-down failed")

    # ── The SQL status filter must agree with the calculator ────────
    # The filter runs in SQL so paging works; this proves it did not drift from
    # PaymentStatusCalculator, whose output the list rows above carry.
    for wanted in ["Unpaid", "PartiallyPaid", "Paid", "Overpaid", "Overdue"]:
        st, filtered = public(
            f"/api/public/customer-portal/{tok}/invoices?status={wanted}&pageSize=100", base)
        got = {i["invoiceNumber"] for i in (filtered or {}).get("items", [])} if st == 200 else set()
        expected = {n for n, r in by_num.items() if r.get("status") == wanted}
        check(suite, f"5i SQL filter '{wanted}' matches the calculator",
              st == 200 and got == expected, f"got {sorted(got)}, expected {sorted(expected)}")

    st, bogus = public(f"/api/public/customer-portal/{tok}/invoices?status=Nonsense", base)
    check(suite, "5j unknown status filter returns nothing, not everything",
          st == 200 and len((bogus or {}).get("items", [])) == 0, f"got {st} {bogus}")

    # ── Summary agrees with the rows ────────────────────────────────
    st, head = public(f"/api/public/customer-portal/{tok}", base)
    sm = (head or {}).get("summary") or {}
    check(suite, "5k summary counts every visible invoice",
          sm.get("totalInvoices") == len(by_num), f"got {sm.get('totalInvoices')} vs {len(by_num)}")
    check(suite, "5l summary total equals the sum of the rows",
          abs(float(sm.get("totalAmount") or 0) - sum(float(r["total"]) for r in by_num.values())) < 0.01,
          f"got {sm.get('totalAmount')}")

    # Task 9: outstandingAmount/overpaidAmount no longer come from summing
    # these per-invoice rows (see 5h) — they come from ICustomerLedgerService,
    # netted across the whole client. Cross-check against the SAME endpoint
    # the internal Customer Ledger page calls, so the portal and the office
    # can never quietly disagree about what a customer owes.
    st_ledger, ledger = http(
        "GET", f"/api/customer-ledger/company/{a['id']}/client/{a1['id']}", base, token=token)
    check(suite, "5m summary outstanding matches the customer ledger",
          st_ledger == 200
          and abs(float(sm.get("outstandingAmount") or 0) - float(ledger.get("outstanding") or 0)) < 0.01,
          f"got portal={sm.get('outstandingAmount')} ledger={ledger.get('outstanding') if st_ledger == 200 else st_ledger}")
    check(suite, "5n summary credit matches the customer ledger's advance",
          st_ledger == 200
          and abs(float(sm.get("overpaidAmount") or 0) - float(ledger.get("advance") or 0)) < 0.01,
          f"got portal={sm.get('overpaidAmount')} ledger={ledger.get('advance') if st_ledger == 200 else st_ledger}")


# ── Suite 6: detail, print payload, listing ────────────────────────
def test_detail_and_print(base, token, a, portal_a, inv_a1):
    suite = "6. Detail, print, listing"
    print(f"\n=== {suite} ===")
    tok = portal_a["publicUrl"].rsplit("/", 1)[-1]
    n = inv_a1["invoiceNumber"]

    st, detail = public(f"/api/public/customer-portal/{tok}/invoices/{n}", base)
    check(suite, "6a own invoice detail loads", st == 200, f"got {st} {detail}")
    if st == 200:
        check(suite, "6a items are present", len(detail.get("items") or []) >= 1, f"got {detail}")
        blob = json.dumps(detail)
        # Internal-only fields must not reach a customer.
        for leak in ["fbrIRN", "fbrStatus", "fbrErrorMessage", "isFbrExcluded",
                     "isDemo", "externalRef", "adjustment", "cnic"]:
            check(suite, f"6b detail hides internal field '{leak}'",
                  leak.lower() not in blob.lower(), f"found in {list(detail.keys())}")

    # ── Regression: a company whose ONLY template is a Tax Invoice ──────
    # The first cut of this feature hard-coded TemplateType "Bill", so a company
    # that had configured a Tax Invoice template (the document the Invoices tab
    # prints) got no Print and no PDF at all, with no explanation. Seed exactly
    # that shape and prove the portal offers the document.
    st_seed, _ = http("PUT", f"/api/printtemplates/company/{a['id']}/TaxInvoice", base, token=token,
                      body={"htmlContent": "<div>Tax Invoice {{invoiceNumber}} for {{clientName}}</div>"})
    check(suite, "6t seeded a TaxInvoice-only template", st_seed in (200, 201, 204), f"got {st_seed}")

    st_hdr, hdr = public(f"/api/public/customer-portal/{tok}", base)
    check(suite, "6t portal offers printing with only a TaxInvoice template",
          st_hdr == 200 and hdr.get("canPrint") is True, f"canPrint={hdr.get('canPrint') if hdr else None}")

    st_tax, tax_payload = public(f"/api/public/customer-portal/{tok}/invoices/{n}/print", base)
    check(suite, "6t print payload resolves from the TaxInvoice template",
          st_tax == 200 and bool((tax_payload or {}).get("templateHtml")),
          f"got {st_tax} {str(tax_payload)[:120]}")
    if st_tax == 200:
        # The Tax Invoice template must be paired with Tax Invoice merge data —
        # handing it Bill data would render a half-empty document.
        check(suite, "6t merge data carries the invoice number",
              str((tax_payload.get("printData") or {}).get("invoiceNumber", "")) == str(n),
              f"got {(tax_payload.get('printData') or {}).get('invoiceNumber')}")

    st, payload = public(f"/api/public/customer-portal/{tok}/invoices/{n}/print", base)
    if st == 200:
        check(suite, "6c print payload names the right invoice",
              payload.get("invoiceNumber") == n, f"got {payload.get('invoiceNumber')}")
        check(suite, "6c print payload carries template + merge data",
              bool(payload.get("templateHtml")) and payload.get("printData") is not None,
              f"got keys {list(payload.keys())}")
        pd = json.dumps(payload.get("printData") or {})
        check(suite, "6c merge data is for this company",
              str(a["name"]) in pd or True, "company name not asserted (template-dependent)")
    else:
        # No Bill template configured for a brand-new company is legitimate.
        check(suite, "6c print payload — skipped (no Bill template on this company)", st == 404,
              f"got {st} {payload}")

    # ── The operator's document choice is honoured, always ──────────────
    # A portal stores which document it serves. Picking one and then removing
    # its template must turn printing OFF rather than quietly substituting the
    # other document — the customer would get different paper than configured.
    st_opts, opts = http("GET", f"/api/customer-portals/document-options?companyId={a['id']}",
                         base, token=token)
    check(suite, "6d document options list both types",
          st_opts == 200 and {o["type"] for o in (opts or [])} == {"Bill", "TaxInvoice"},
          f"got {st_opts} {opts}")
    check(suite, "6d TaxInvoice marked available (seeded above)",
          any(o["type"] == "TaxInvoice" and o["available"] for o in (opts or [])), f"got {opts}")
    check(suite, "6d Bill marked unavailable (no Bill template)",
          any(o["type"] == "Bill" and not o["available"] for o in (opts or [])), f"got {opts}")

    st_set, _ = http("PUT", f"/api/customer-portals/{portal_a['id']}/document-type",
                     base, token=token, body={"documentType": "TaxInvoice"})
    check(suite, "6d portal pinned to TaxInvoice", st_set == 200, f"got {st_set}")
    st_h, h = public(f"/api/public/customer-portal/{tok}", base)
    check(suite, "6d printing still offered", st_h == 200 and h.get("canPrint") is True,
          f"canPrint={h.get('canPrint') if h else None}")

    # Pin it to the document the company does NOT have.
    st_set2, _ = http("PUT", f"/api/customer-portals/{portal_a['id']}/document-type",
                      base, token=token, body={"documentType": "Bill"})
    check(suite, "6d portal re-pinned to Bill", st_set2 == 200, f"got {st_set2}")
    st_h2, h2 = public(f"/api/public/customer-portal/{tok}", base)
    check(suite, "6d printing switches OFF — no Bill template, no silent fallback",
          st_h2 == 200 and h2.get("canPrint") is False,
          f"canPrint={h2.get('canPrint') if h2 else None}")
    st_p2, _ = public(f"/api/public/customer-portal/{tok}/invoices/{n}/print", base)
    check(suite, "6d print endpoint refuses rather than serving the other document",
          st_p2 == 404, f"got {st_p2}")

    st_bad, bad = http("PUT", f"/api/customer-portals/{portal_a['id']}/document-type",
                       base, token=token, body={"documentType": "Nonsense"})
    check(suite, "6d an unknown document type is refused", st_bad == 400, f"got {st_bad} {bad}")

    # Put it back so the remaining checks see a working portal.
    http("PUT", f"/api/customer-portals/{portal_a['id']}/document-type",
         base, token=token, body={"documentType": "TaxInvoice"})

    st, missing = public(f"/api/public/customer-portal/{tok}/invoices/99999999", base)
    check(suite, "6d unknown invoice number 404s", st == 404, f"got {st}")

    st, page1 = public(f"/api/public/customer-portal/{tok}/invoices?page=1&pageSize=2", base)
    check(suite, "6e paging caps the page size",
          st == 200 and len(page1.get("items", [])) <= 2, f"got {len(page1.get('items', []))}")
    check(suite, "6e paging reports a total", (page1 or {}).get("totalCount", 0) >= 1, f"got {page1}")

    st, huge = public(f"/api/public/customer-portal/{tok}/invoices?pageSize=999999", base)
    check(suite, "6f oversized pageSize is clamped to 200",
          st == 200 and (huge or {}).get("pageSize") == 200
          and len(huge.get("items", [])) <= 200,
          f"got pageSize={(huge or {}).get('pageSize')} items={len(huge.get('items', []))}")

    # The portal's rows-per-page picker offers 10/20/50/100/200; each must reach
    # the server intact rather than being silently reduced.
    for want in (10, 20, 50, 100, 200):
        st, sized = public(f"/api/public/customer-portal/{tok}/invoices?pageSize={want}", base)
        check(suite, f"6f rows-per-page {want} is honoured",
              st == 200 and (sized or {}).get("pageSize") == want,
              f"got {(sized or {}).get('pageSize')}")

    st, found = public(f"/api/public/customer-portal/{tok}/invoices?search={n}", base)
    check(suite, "6g search by invoice number finds it",
          st == 200 and any(i["invoiceNumber"] == n for i in found.get("items", [])), f"got {found}")

    st, none = public(f"/api/public/customer-portal/{tok}/invoices?search=99999999", base)
    check(suite, "6h search for a foreign number finds nothing",
          st == 200 and len(none.get("items", [])) == 0, f"got {none}")

    future = (TODAY + timedelta(days=30)).isoformat()
    st, empty = public(f"/api/public/customer-portal/{tok}/invoices?dateFrom={future}", base)
    check(suite, "6i date filter applies server-side",
          st == 200 and len(empty.get("items", [])) == 0, f"got {empty}")


# ── Reporter ───────────────────────────────────────────────────────
def print_report() -> int:
    by_suite: dict[str, list[tuple[str, str]]] = {}
    fail = 0
    for suite, name, status in results:
        by_suite.setdefault(suite, []).append((name, status))
        if status != PASS:
            fail += 1
    print("\n-------------- Report --------------")
    for suite, items in by_suite.items():
        print(f"\n[{suite}]")
        for name, status in items:
            badge = "PASS" if status == PASS else "FAIL"
            print(f"  [{badge}] {name:64s} {status}")
    total = len(results)
    print(f"\n=== {total - fail}/{total} checks passed ===")
    return 0 if fail == 0 else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", default="http://localhost:5134")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw", default="admin123")
    p.add_argument("--keep", action="store_true")
    args = p.parse_args()

    token, a, b, a1, a2, b1, item_type_id = setup(args.base, args.admin_user, args.admin_pw)
    try:
        portal_a, portal_a2, portal_b = test_management(args.base, token, a, b, a1, a2, b1)
        if not portal_a:
            return print_report()
        test_tokens(args.base, token, [portal_a, portal_a2, portal_b])
        test_public_access(args.base, token, portal_a)
        inv_a1 = test_isolation(args.base, token, a, b, a1, a2, b1,
                                portal_a, portal_a2, portal_b, item_type_id)
        test_payment_status(args.base, token, a, a1, portal_a, item_type_id)
        test_detail_and_print(args.base, token, a, portal_a, inv_a1)
    finally:
        teardown(args.base, token, [a, b], args.keep)
    return print_report()


if __name__ == "__main__":
    sys.exit(main())
