"""
Customer receipts + customer ledger benchmark.

Pins the 2026-08-29 change that made `Payment.Amount` authoritative and
allocations OPTIONAL for a customer receipt, so cash can be taken from a client
with no invoice selected and the uncovered remainder becomes their advance.

The two quantities this suite exists to keep apart:
  * settled against the INVOICE = allocation.Amount + allocation.AdjustmentAmount
    (cash + non-cash write-off) — drives Invoice.AmountPaid and the over-pay guard.
  * spent from the RECEIPT     = allocation.Amount only — drives the invariant,
    PaymentDto.UnallocatedAmount and the customer advance.
Conflating them either rejects a valid 1000-cash receipt that clears an 1100
invoice via a 100 write-off (suite 4), or silently misstates the advance.

Suites:
  1. Receipt with NO allocation  -> saves, unallocatedAmount == amount, posts to
                                    "Advance from Customers"
  2. Invoice.AmountPaid          -> an unallocated receipt contributes NOTHING
  3. Partial allocation          -> remainder is the advance
  4. Cash vs settlement          -> cash + write-off clearing a bigger invoice is
                                    accepted, remainder 0
  5. Guards                      -> over-spend, money-out, party-less "Other",
                                    zero and negative amounts all rejected
  6. Backward compatibility      -> callers that omit `amount` behave exactly as
                                    before, incl. the zero-cash pure write-off
                                    and the money-out direct-account line
  7. Edit path                   -> UpdateAsync mirrors every create-path rule;
                                    an edit can neither destroy nor forge cash
  8. Contact type normalisation  -> a line-less receipt no longer inherits a
                                    tenant check from an allocated invoice, so
                                    "client" and "Client" must mean the same
                                    thing to BOTH the allocations-optional test
                                    and the belongs-to-this-company guard
  9. Ledger integrity            -> trial balance balanced, advance account total

Runs against a fresh ephemeral GL-enabled company + client, plus a second
company used only as the "other tenant" in suite 8. Both torn down at the end.
Production data is never touched.

Usage:
  python scripts/test_customer_receipts_ledger.py --base http://localhost:5135
  python scripts/test_customer_receipts_ledger.py --base http://localhost:5135 --keep

Exit code 0 = every check passed. 1 = at least one failure.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

PKT = timezone(timedelta(hours=5))
results: list[tuple[str, str, bool, str]] = []   # (suite, name, ok, reason)


def today_iso() -> str:
    return datetime.now(PKT).date().strftime("%Y-%m-%dT00:00:00Z")


def http(method: str, path: str, base: str, token: str | None = None,
         body=None, timeout: int = 60):
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


def check(suite: str, name: str, ok: bool, reason: str = "") -> bool:
    results.append((suite, name, ok, reason))
    print(("PASS" if ok else "FAIL") + f" - {name}" + ("" if ok else f"   [{reason}]"))
    return ok


def eq(a, b, tol: float = 0.01) -> bool:
    try:
        return abs(float(a) - float(b)) < tol
    except (TypeError, ValueError):
        return False


def err_of(body) -> str:
    if isinstance(body, dict):
        return str(body.get("error") or body)
    return str(body)


# ── Document helpers ───────────────────────────────────────────────
def make_invoice(base, token, cid, client_id, item_type_id, total):
    st, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": today_iso(), "companyId": cid, "clientId": client_id, "gstRate": 0,
        "items": [{"description": "Receipt-ledger test good", "quantity": 1,
                   "uom": "Pcs", "unitPrice": total, "itemTypeId": item_type_id}]})
    return (inv if st in (200, 201) and isinstance(inv, dict) else None)


def receipt_body(client_id, amount=None, allocations=None,
                 contact_type="Client", contact_id=..., date=None):
    body = {
        "direction": "Receipt",
        "date": date or today_iso(),
        "contactType": contact_type,
        "contactId": client_id if contact_id is ... else contact_id,
        "method": "Cash",
        "allocations": allocations if allocations is not None else [],
    }
    if amount is not None:
        body["amount"] = amount
    return body


def post_receipt(base, token, cid, body):
    return http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body=body)


def put_receipt(base, token, rid, body):
    return http("PUT", f"/api/payments/receipts/{rid}", base, token=token, body=body)


def get_invoice(base, token, invoice_id):
    _, inv = http("GET", f"/api/invoices/{invoice_id}", base, token=token)
    return inv if isinstance(inv, dict) else {}


def flat_accounts(base, token, cid):
    st, rows = http("GET", f"/api/accounts/company/{cid}/flat", base, token=token)
    return rows if st == 200 and isinstance(rows, list) else []


def balance_of(base, token, cid, account_id):
    for a in flat_accounts(base, token, cid):
        if a.get("id") == account_id:
            return float(a.get("balance") or 0)
    return None


# ── Suites ─────────────────────────────────────────────────────────
def suite_1_advance(base, token, cid, client_id, advance_acct):
    suite = "1. Receipt with no allocation"
    print(f"\n=== {suite} ===")
    st, r = post_receipt(base, token, cid, receipt_body(client_id, amount=100000))
    if not check(suite, "receipt with no allocation lines is accepted",
                 st in (200, 201), f"got {st} {err_of(r)}"):
        return None
    check(suite, "amount is the posted 100000 (not sum of allocations = 0)",
          eq(r.get("amount"), 100000), f"amount = {r.get('amount')}")
    check(suite, "unallocatedAmount == 100000", eq(r.get("unallocatedAmount"), 100000),
          f"unallocatedAmount = {r.get('unallocatedAmount')}")
    check(suite, "no allocation rows were invented", len(r.get("allocations") or []) == 0,
          f"allocations = {r.get('allocations')}")

    st, again = http("GET", f"/api/payments/receipts/{r['id']}", base, token=token)
    again = again if isinstance(again, dict) else {}
    check(suite, "read path returns the same amount + remainder",
          st == 200 and eq(again.get("amount"), 100000)
          and eq(again.get("unallocatedAmount"), 100000),
          f"got {st} amount={again.get('amount')} unallocated={again.get('unallocatedAmount')}")

    if advance_acct:
        bal = balance_of(base, token, cid, advance_acct["id"])
        check(suite, "'Advance from Customers' carries the 100000",
              bal is not None and eq(abs(bal), 100000), f"balance = {bal}")
    else:
        check(suite, "'Advance from Customers' account exists", False,
              "no CustomerAdvances account on this company's chart")
    return r


def suite_2_amountpaid(base, token, cid, client_id, item_type_id):
    suite = "2. Invoice.AmountPaid untouched"
    print(f"\n=== {suite} ===")
    inv = make_invoice(base, token, cid, client_id, item_type_id, 500000)
    if not check(suite, "500000 invoice created", inv is not None, "invoice create failed"):
        return None
    before = get_invoice(base, token, inv["id"])
    st, r = post_receipt(base, token, cid, receipt_body(client_id, amount=250000))
    check(suite, "250000 unallocated receipt accepted", st in (200, 201), f"got {st} {err_of(r)}")
    after = get_invoice(base, token, inv["id"])
    check(suite, "invoice amountPaid is unchanged (0)",
          eq(after.get("amountPaid"), before.get("amountPaid") or 0),
          f"before = {before.get('amountPaid')}, after = {after.get('amountPaid')}")
    check(suite, "invoice is NOT reported Paid", after.get("paymentStatus") != "Paid",
          f"paymentStatus = {after.get('paymentStatus')}")
    check(suite, "invoice balanceDue still 500000", eq(after.get("balanceDue"), 500000),
          f"balanceDue = {after.get('balanceDue')}")
    return inv


def suite_3_partial(base, token, cid, client_id, item_type_id):
    suite = "3. Partial allocation"
    print(f"\n=== {suite} ===")
    inv = make_invoice(base, token, cid, client_id, item_type_id, 300000)
    if not check(suite, "300000 invoice created", inv is not None, "invoice create failed"):
        return
    st, r = post_receipt(base, token, cid, receipt_body(
        client_id, amount=1000000, allocations=[{"invoiceId": inv["id"], "amount": 300000}]))
    if not check(suite, "1,000,000 receipt allocating 300000 accepted",
                 st in (200, 201), f"got {st} {err_of(r)}"):
        return
    check(suite, "amount stays 1,000,000", eq(r.get("amount"), 1000000), f"amount = {r.get('amount')}")
    check(suite, "unallocatedAmount == 700000", eq(r.get("unallocatedAmount"), 700000),
          f"unallocatedAmount = {r.get('unallocatedAmount')}")
    after = get_invoice(base, token, inv["id"])
    check(suite, "invoice amountPaid == 300000 and Paid",
          eq(after.get("amountPaid"), 300000) and after.get("paymentStatus") == "Paid",
          f"amountPaid = {after.get('amountPaid')}, status = {after.get('paymentStatus')}")


def suite_4_cash_vs_settlement(base, token, cid, client_id, item_type_id, disc_acct):
    suite = "4. Cash vs settlement"
    print(f"\n=== {suite} ===")
    inv = make_invoice(base, token, cid, client_id, item_type_id, 1100)
    if not check(suite, "1100 invoice created", inv is not None, "invoice create failed"):
        return
    st, r = post_receipt(base, token, cid, receipt_body(
        client_id, amount=1000, allocations=[{
            "invoiceId": inv["id"], "amount": 1000,
            "adjustmentAmount": 100, "adjustmentAccountId": disc_acct}]))
    if not check(suite, "1000 cash + 100 write-off clearing an 1100 invoice is accepted",
                 st in (200, 201),
                 f"got {st} {err_of(r)} - the invariant must be cash-only"):
        return
    check(suite, "unallocatedAmount == 0 (write-off is not receipt cash)",
          eq(r.get("unallocatedAmount"), 0), f"unallocatedAmount = {r.get('unallocatedAmount')}")
    after = get_invoice(base, token, inv["id"])
    check(suite, "invoice settled for the full 1100 and Paid",
          eq(after.get("amountPaid"), 1100) and after.get("paymentStatus") == "Paid",
          f"amountPaid = {after.get('amountPaid')}, status = {after.get('paymentStatus')}")


def suite_5_guards(base, token, cid, client_id, item_type_id, disc_acct):
    suite = "5. Guards"
    print(f"\n=== {suite} ===")
    inv = make_invoice(base, token, cid, client_id, item_type_id, 500000)
    if inv:
        st, r = post_receipt(base, token, cid, receipt_body(
            client_id, amount=10000, allocations=[{"invoiceId": inv["id"], "amount": 20000}]))
        check(suite, "allocating more cash than the receipt amount is rejected (400)",
              st == 400 and "more than the receipt amount" in err_of(r),
              f"got {st} {err_of(r)}")

    st, r = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
        "direction": "Payment", "date": today_iso(), "contactType": "Supplier",
        "contactId": None, "method": "Cash", "amount": 50000, "allocations": []})
    check(suite, "money-out with no allocation is still rejected (400)",
          st == 400 and "at least one allocation line" in err_of(r), f"got {st} {err_of(r)}")

    st, r = post_receipt(base, token, cid, receipt_body(
        client_id, amount=50000, contact_type="Other", contact_id=None))
    check(suite, "party-less 'Other' receipt with no allocation is rejected (400)",
          st == 400 and "at least one allocation line" in err_of(r), f"got {st} {err_of(r)}")

    st, r = post_receipt(base, token, cid, receipt_body(client_id))
    check(suite, "customer receipt with no allocation AND no amount is rejected (400)",
          st == 400 and "positive amount" in err_of(r), f"got {st} {err_of(r)}")

    st, r = post_receipt(base, token, cid, receipt_body(client_id, amount=-5000))
    check(suite, "negative amount is rejected (400)",
          st == 400 and "positive amount" in err_of(r), f"got {st} {err_of(r)}")


def suite_6_backcompat(base, token, cid, client_id, item_type_id, bad_debt_acct, disc_acct):
    suite = "6. Backward compatibility"
    print(f"\n=== {suite} ===")
    inv = make_invoice(base, token, cid, client_id, item_type_id, 200000)
    if inv:
        # No `amount` in the body at all — every pre-change caller looks like this.
        st, r = post_receipt(base, token, cid, receipt_body(
            client_id, allocations=[{"invoiceId": inv["id"], "amount": 120000}]))
        ok = check(suite, "receipt WITHOUT `amount` still saves", st in (200, 201),
                   f"got {st} {err_of(r)}")
        if ok:
            check(suite, "amount falls back to the allocation cash total (120000)",
                  eq(r.get("amount"), 120000) and eq(r.get("unallocatedAmount"), 0),
                  f"amount = {r.get('amount')}, unallocated = {r.get('unallocatedAmount')}")

    # Zero-cash pure write-off: legal before this change (PaymentForm.jsx ships it),
    # so the "positive amount" guard must only bite a LINE-LESS document.
    inv2 = make_invoice(base, token, cid, client_id, item_type_id, 5000)
    if inv2:
        st, r = post_receipt(base, token, cid, receipt_body(
            client_id, allocations=[{"invoiceId": inv2["id"], "amount": 0,
                                     "adjustmentAmount": 5000,
                                     "adjustmentAccountId": bad_debt_acct}]))
        ok = check(suite, "zero-cash pure write-off receipt still accepted",
                   st in (200, 201), f"got {st} {err_of(r)}")
        if ok:
            check(suite, "its amount is 0 and remainder is 0",
                  eq(r.get("amount"), 0) and eq(r.get("unallocatedAmount"), 0),
                  f"amount = {r.get('amount')}, unallocated = {r.get('unallocatedAmount')}")
            after = get_invoice(base, token, inv2["id"])
            check(suite, "the written-off invoice reads Paid",
                  after.get("paymentStatus") == "Paid", f"status = {after.get('paymentStatus')}")

    # Money-out, direct account line — the untouched path.
    st, pay = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
        "direction": "Payment", "date": today_iso(), "contactType": "Other",
        "contactId": None, "method": "Cash",
        "allocations": [{"accountId": disc_acct, "amount": 5000}]})
    ok = check(suite, "money-out with a direct account line still saves",
               st in (200, 201), f"got {st} {err_of(pay)}")
    if ok:
        check(suite, "its amount is the allocation cash total (5000), remainder 0",
              eq(pay.get("amount"), 5000) and eq(pay.get("unallocatedAmount"), 0),
              f"amount = {pay.get('amount')}, unallocated = {pay.get('unallocatedAmount')}")
    return pay if ok else None


def suite_7_edit(base, token, cid, client_id, item_type_id, money_out):
    suite = "7. Edit path"
    print(f"\n=== {suite} ===")
    st, rcp = post_receipt(base, token, cid, receipt_body(client_id, amount=400000))
    if not check(suite, "400000 advance receipt created", st in (200, 201),
                 f"got {st} {err_of(rcp)}"):
        return
    rid = rcp["id"]
    inv = make_invoice(base, token, cid, client_id, item_type_id, 100000)
    if not check(suite, "100000 invoice created", inv is not None, "invoice create failed"):
        return

    st, r = put_receipt(base, token, rid, receipt_body(
        client_id, amount=400000, allocations=[{"invoiceId": inv["id"], "amount": 100000}]))
    ok = check(suite, "editing the advance to settle an invoice is accepted",
               st == 200, f"got {st} {err_of(r)}")
    if ok:
        check(suite, "amount survives the edit; remainder drops to 300000",
              eq(r.get("amount"), 400000) and eq(r.get("unallocatedAmount"), 300000),
              f"amount = {r.get('amount')}, unallocated = {r.get('unallocatedAmount')}")
        check(suite, "the settled invoice now reads 100000 paid",
              eq(get_invoice(base, token, inv["id"]).get("amountPaid"), 100000),
              f"amountPaid = {get_invoice(base, token, inv['id']).get('amountPaid')}")

    st, r = put_receipt(base, token, rid, receipt_body(client_id, amount=400000))
    ok = check(suite, "editing back to no allocation is accepted", st == 200,
               f"got {st} {err_of(r)}")
    if ok:
        check(suite, "the whole 400000 is an advance again",
              eq(r.get("amount"), 400000) and eq(r.get("unallocatedAmount"), 400000),
              f"amount = {r.get('amount')}, unallocated = {r.get('unallocatedAmount')}")
        check(suite, "the dropped invoice reflows back to 0 paid",
              eq(get_invoice(base, token, inv["id"]).get("amountPaid"), 0),
              f"amountPaid = {get_invoice(base, token, inv['id']).get('amountPaid')}")

    st, r = put_receipt(base, token, rid, receipt_body(
        client_id, amount=400000, contact_type="Other", contact_id=None))
    check(suite, "edit to a party-less receipt with no allocation is rejected (400)",
          st == 400 and "at least one allocation line" in err_of(r), f"got {st} {err_of(r)}")

    st, r = put_receipt(base, token, rid, receipt_body(
        client_id, amount=50000, allocations=[{"invoiceId": inv["id"], "amount": 100000}]))
    check(suite, "edit spending more cash than the amount is rejected (400)",
          st == 400 and "more than the receipt amount" in err_of(r), f"got {st} {err_of(r)}")

    if money_out:
        st, r = http("PUT", f"/api/payments/payments/{money_out['id']}", base, token=token, body={
            "direction": "Payment", "date": today_iso(), "contactType": "Other",
            "contactId": None, "method": "Cash", "amount": 5000, "allocations": []})
        check(suite, "editing money-out to no allocation is still rejected (400)",
              st == 400 and "at least one allocation line" in err_of(r), f"got {st} {err_of(r)}")

    st, final = http("GET", f"/api/payments/receipts/{rid}", base, token=token)
    final = final if isinstance(final, dict) else {}
    check(suite, "the rejected edits changed nothing (still a 400000 advance)",
          eq(final.get("amount"), 400000) and eq(final.get("unallocatedAmount"), 400000),
          f"amount = {final.get('amount')}, unallocated = {final.get('unallocatedAmount')}")


def suite_8_contact_type(base, token, cid, client_id, own_supplier, foreign, disc_acct):
    """The relaxation made allocations optional for a customer receipt, which
    removed the indirect tenant check a line-less receipt used to inherit from
    its allocated invoice. If IsCustomerReceipt and the belongs-to-this-company
    guard disagree about the spelling of "Client", such a receipt can keep a
    ContactId owned by another tenant."""
    suite = "8. Contact type normalisation"
    print(f"\n=== {suite} ===")
    fclient, fsupplier = foreign["client_id"], foreign["supplier_id"]

    st, r = post_receipt(base, token, cid, receipt_body(
        None, amount=60000, contact_type="client", contact_id=fclient))
    check(suite, "lowercase 'client' + another company's client is rejected (400)",
          st == 400 and "belong to this company" in err_of(r),
          f"got {st} {err_of(r)}")

    st, page = http("GET", f"/api/payments/receipts/company/{cid}/paged?page=1&pageSize=100",
                    base, token=token)
    rows = (page or {}).get("items", []) if isinstance(page, dict) else []
    check(suite, "no receipt was stored carrying the foreign contactId",
          all(row.get("contactId") != fclient for row in rows),
          f"foreign contactId {fclient} found among {len(rows)} receipts")

    st, r = post_receipt(base, token, cid, receipt_body(
        None, amount=60000, contact_type="Client", contact_id=fclient))
    check(suite, "canonical 'Client' + another company's client still rejected (400)",
          st == 400 and "belong to this company" in err_of(r), f"got {st} {err_of(r)}")

    st, r = post_receipt(base, token, cid, receipt_body(
        None, amount=60000, contact_type="client", contact_id=client_id))
    ok = check(suite, "lowercase 'client' + this company's own client is accepted",
               st in (200, 201), f"got {st} {err_of(r)}")
    rid = r.get("id") if ok else None
    if ok:
        check(suite, "it is stored canonically as 'Client'", r.get("contactType") == "Client",
              f"contactType = {r.get('contactType')}")
        check(suite, "its contact name resolves and the advance is 60000",
              bool(r.get("contactName")) and eq(r.get("unallocatedAmount"), 60000),
              f"contactName = {r.get('contactName')}, unallocated = {r.get('unallocatedAmount')}")

    if rid:
        st, r = put_receipt(base, token, rid, receipt_body(
            None, amount=60000, contact_type="client", contact_id=fclient))
        check(suite, "editing it onto another company's client is rejected (400)",
              st == 400 and "belong to this company" in err_of(r), f"got {st} {err_of(r)}")

    st, r = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
        "direction": "Payment", "date": today_iso(), "contactType": "supplier",
        "contactId": fsupplier, "method": "Cash",
        "allocations": [{"accountId": disc_acct, "amount": 5000}]})
    check(suite, "money-out: lowercase 'supplier' + another company's supplier rejected (400)",
          st == 400 and "belong to this company" in err_of(r), f"got {st} {err_of(r)}")

    if own_supplier:
        st, r = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
            "direction": "Payment", "date": today_iso(), "contactType": "Supplier",
            "contactId": own_supplier, "method": "Cash",
            "allocations": [{"accountId": disc_acct, "amount": 5000}]})
        ok = check(suite, "money-out: proper 'Supplier' + own supplier still saves",
                   st in (200, 201), f"got {st} {err_of(r)}")
        if ok:
            check(suite, "its amount is 5000 and the supplier name resolves",
                  eq(r.get("amount"), 5000) and bool(r.get("contactName")),
                  f"amount = {r.get('amount')}, contactName = {r.get('contactName')}")


def suite_9_ledger(base, token, cid, advance_acct):
    suite = "9. Ledger integrity"
    print(f"\n=== {suite} ===")
    st, tb = http("GET", f"/api/accounting/reports/company/{cid}/trial-balance",
                  base, token=token)
    tb = tb if isinstance(tb, dict) else {}
    check(suite, "trial balance is balanced", st == 200 and eq(tb.get("totalDebit"),
          tb.get("totalCredit")),
          f"got {st} debit={tb.get('totalDebit')} credit={tb.get('totalCredit')}")
    if advance_acct:
        # 100000 (suite 1) + 250000 (suite 2) + 700000 (suite 3)
        # + 400000 (suite 7) + 60000 (suite 8)
        bal = balance_of(base, token, cid, advance_acct["id"])
        check(suite, "advance account totals 1,510,000 across the run",
              bal is not None and eq(abs(bal), 1510000), f"balance = {bal}")


# ── Setup / teardown ───────────────────────────────────────────────
def make_company(base, token, name, gl=True):
    st, company = http("POST", "/api/companies", base, token=token, body={
        "name": name, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingChallanNumber": 1,
        "startingGoodsReceiptNumber": 1, "fbrEnabled": False,
        "inventoryTrackingEnabled": False, "enableGl": gl})
    if st not in (200, 201):
        print(f"FATAL: company create failed ({st} {company})")
        sys.exit(2)
    return company["id"]


def make_client(base, token, cid, name):
    st, c = http("POST", "/api/clients", base, token=token, body={
        "name": name, "companyId": cid, "registrationType": "Unregistered"})
    if st not in (200, 201):
        print(f"FATAL: client create failed ({st} {c})")
        sys.exit(2)
    return c["id"]


def make_supplier(base, token, cid, name):
    st, s = http("POST", "/api/suppliers", base, token=token, body={
        "name": name, "companyId": cid})
    return s["id"] if st in (200, 201) and isinstance(s, dict) else None


def setup(base, user, pw):
    st, data = http("POST", "/api/auth/login", base, body={"username": user, "password": pw})
    if st != 200:
        print(f"FATAL: login failed ({st} {data})")
        sys.exit(2)
    token = data["token"]
    sfx = datetime.now().strftime("%Y%m%d%H%M%S")

    cid = make_company(base, token, f"_test_receipts_ledger {sfx}")
    client_id = make_client(base, token, cid, f"Ledger Client {sfx}")
    supplier_id = make_supplier(base, token, cid, f"Ledger Supplier {sfx}")

    # A SECOND tenant, so the suite can prove a contact id belonging to another
    # company is refused rather than quietly stored on the receipt.
    other_cid = make_company(base, token, f"_test_receipts_other {sfx}", gl=False)
    foreign = {
        "company_id": other_cid,
        "client_id": make_client(base, token, other_cid, f"Foreign Client {sfx}"),
        "supplier_id": make_supplier(base, token, other_cid, f"Foreign Supplier {sfx}"),
    }

    _, its = http("GET", "/api/itemtypes", base, token=token)
    rows = its if isinstance(its, list) else (its.get("items") or its.get("data") or [])
    item_type_id = rows[0]["id"] if rows else None
    return token, cid, client_id, supplier_id, item_type_id, foreign


def teardown(base, token, cids, keep):
    if keep:
        print(f"\n(kept companies {cids})")
        return
    for cid in cids:
        http("DELETE", f"/api/companies/{cid}", base, token=token)
    print(f"\n(cleaned up companies {cids})")


def report() -> int:
    passed = sum(1 for _, _, ok, _ in results if ok)
    total = len(results)
    print("\n" + "=" * 62)
    failures = [(s, n, r) for s, n, ok, r in results if not ok]
    for s, n, r in failures:
        print(f"FAILED  {s} :: {n}   [{r}]")
    print(f"{passed}/{total} checks passed")
    return 0 if passed == total else 1


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://localhost:5134")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw", default="admin123")
    p.add_argument("--keep", action="store_true",
                   help="Leave the ephemeral company in the DB after the run.")
    args = p.parse_args()
    base = args.base

    token, cid, client_id, supplier_id, item_type_id, foreign = setup(
        base, args.admin_user, args.admin_pw)
    flat = flat_accounts(base, token, cid)

    def by_control(ct):
        return next((a for a in flat if a.get("controlType") == ct), None)

    advance = by_control("CustomerAdvances")
    disc = (by_control("DiscountAllowed") or {}).get("id")
    bad_debt = (by_control("BadDebtWriteOff") or {}).get("id")
    print(f"\n== company={cid} client={client_id} supplier={supplier_id} "
          f"itemType={item_type_id} advance={advance['id'] if advance else None} "
          f"disc={disc} badDebt={bad_debt} foreign={foreign} ==")

    try:
        suite_1_advance(base, token, cid, client_id, advance)
        suite_2_amountpaid(base, token, cid, client_id, item_type_id)
        suite_3_partial(base, token, cid, client_id, item_type_id)
        suite_4_cash_vs_settlement(base, token, cid, client_id, item_type_id, disc)
        suite_5_guards(base, token, cid, client_id, item_type_id, disc)
        money_out = suite_6_backcompat(base, token, cid, client_id, item_type_id, bad_debt, disc)
        suite_7_edit(base, token, cid, client_id, item_type_id, money_out)
        suite_8_contact_type(base, token, cid, client_id, supplier_id, foreign, disc)
        suite_9_ledger(base, token, cid, advance)
    finally:
        teardown(base, token, [cid, foreign["company_id"]], args.keep)

    return report()


if __name__ == "__main__":
    sys.exit(main())
