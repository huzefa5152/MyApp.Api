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
  1. Receipt with NO allocation  -> saves, unallocatedAmount == amount, and the
                                    uncovered cash credits the CLIENT'S OWN
                                    Accounts receivable (2026-08-31: money held
                                    for a party lives on that party's control
                                    account, not on a separate "Advance from
                                    Customers" liability, which is no longer
                                    seeded — see ControlType.CustomerAdvances)
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
  9. Ledger integrity            -> trial balance balanced, the run's advance
                                    total, and A/R == the A/R column
  10. Allocate advance           -> POST /api/receipts/{id}/allocate applies part
                                    of an existing advance to invoices raised
                                    LATER; over-allocation past the remaining
                                    unallocated cash, another company's invoice,
                                    a money-out target and a cancelled receipt
                                    are all rejected; a mixed cash+write-off
                                    allocate line that exceeds the remaining
                                    cash only under the SETTLEMENT figure (not
                                    cash alone) is accepted — the cash-only
                                    invariant on the allocate path itself
  11. Money-out Amount gate      -> Payment.Amount is authoritative for a
                                    RECEIPT only (suite 1) — a money-out payment
                                    cannot inflate it past Σ allocation cash on
                                    EITHER create or edit; PostingService would
                                    otherwise plug the gap to Suspense silently
  12. Allocate GL integrity      -> allocating moves NOTHING (the cash was
                                    already on the client's A/R), the entry
                                    stays balanced, a SECOND allocate on the
                                    same receipt does not duplicate the first
                                    call's journal lines (re-post REPLACES), and
                                    each allocated slice is tagged to the invoice
                                    it settled while the rest stays untagged
  13. Allocate an explicit
      on-account advance         -> the OTHER way to record an advance (an
                                    AllocationKind.OnAccount line rather than a
                                    line-less receipt) is spendable too:
                                    allocating draws the parked line down by the
                                    cash applied, removes it once spent, leaves
                                    Payment.Amount untouched, and re-labels the
                                    party-control leg instead of re-valuing it

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
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# Direct-SQL escape hatch for the one thing the API cannot do: Payment.IsCancelled
# has no controller action (it's legacy-import-only — voided rows carried over
# from Manager). Used ONLY by suite 10's cancelled-receipt case, and only when
# --db is passed explicitly, so this script never fires a raw UPDATE against an
# unintended database just because --base pointed somewhere unexpected.
SQLCMD = r"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\sqlcmd.exe"
SQL_SERVER = r"CRKRL-HUSSAHUZ1\MSSQLSERVER2"

PKT = timezone(timedelta(hours=5))
results: list[tuple[str, str, bool, str]] = []   # (suite, name, ok, reason)
# A skipped check is NEITHER pass nor fail — it was never exercised (e.g. the
# cancelled-receipt case needs --db). Tracked separately from `results` so it
# can never silently vanish from the final count: report() always prints it
# and appends ", N skipped" to the summary line, so a plain run with no --db
# cannot look "fully green" while quietly omitting a check (coordinator
# review, 2026-08-30).
skipped: list[tuple[str, str, str]] = []   # (suite, name, reason)


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


def skip(suite: str, name: str, reason: str) -> None:
    skipped.append((suite, name, reason))
    print(f"SKIP - {name}   [{reason}]")


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


def post_allocate(base, token, rid, lines):
    """lines is a raw JSON array of {invoiceId, amount, ...} — the endpoint
    takes List<CreatePaymentAllocationDto> directly, not a wrapped object."""
    return http("POST", f"/api/receipts/{rid}/allocate", base, token=token, body=lines)


def sql_cancel_payment(db, payment_id) -> bool:
    """Flip Payment.IsCancelled via direct SQL. Returns False (never raises) if
    --db wasn't supplied or sqlcmd isn't on this machine, so the caller can
    treat the cancelled-receipt case as skippable rather than fatal."""
    if not db or not os.path.exists(SQLCMD):
        return False
    out = subprocess.run(
        [SQLCMD, "-S", SQL_SERVER, "-d", db, "-E", "-C", "-N", "-I", "-Q",
         f"UPDATE Payments SET IsCancelled = 1 WHERE Id = {int(payment_id)};"],
        capture_output=True, text=True, timeout=30)
    return out.returncode == 0


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
def suite_1_advance(base, token, cid, client_id, ar_acct, advance_acct):
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

    # The advance sits on the CLIENT'S OWN Accounts receivable (2026-08-31), not
    # on a separate liability: money held for a party belongs on that party's
    # control account, where it nets against what they owe and is visible to
    # their ledger, the A/R column and the aged reports. This is the first suite
    # to run, so A/R starts at 0 and the credit is the whole balance. (The flat
    # balance is debit-positive, so a credit reads negative.)
    if ar_acct:
        bal = balance_of(base, token, cid, ar_acct["id"])
        check(suite, "the client's Accounts receivable carries the 100000 as a credit",
              bal is not None and eq(bal, -100000), f"balance = {bal}")
    else:
        check(suite, "'Accounts receivable' account exists", False,
              "no AccountsReceivable account on this company's chart")

    # …and the superseded "Advance from Customers" account is not seeded at all
    # any more, so nothing can quietly start posting there again.
    check(suite, "no 'Advance from Customers' account on a freshly seeded chart",
          advance_acct is None,
          f"CustomerAdvances account still seeded: {advance_acct}")
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


def suite_9_ledger(base, token, cid, ar_acct):
    suite = "9. Ledger integrity"
    print(f"\n=== {suite} ===")
    st, tb = http("GET", f"/api/accounting/reports/company/{cid}/trial-balance",
                  base, token=token)
    tb = tb if isinstance(tb, dict) else {}
    check(suite, "trial balance is balanced", st == 200 and eq(tb.get("totalDebit"),
          tb.get("totalCredit")),
          f"got {st} debit={tb.get('totalDebit')} credit={tb.get('totalCredit')}")

    # The advances this run produces are unchanged — 100000 (suite 1) + 250000
    # (suite 2) + 700000 (suite 3) + 400000 (suite 7) + 60000 (suite 8). What
    # changed on 2026-08-31 is WHERE they live: on the party's own Accounts
    # receivable instead of a dedicated liability. So the total is pinned from
    # the receipts themselves…
    st, page = http("GET", f"/api/payments/receipts/company/{cid}/paged?pageSize=200",
                    base, token=token)
    items = (page or {}).get("items") if isinstance(page, dict) else None
    advances = sum(float(r.get("unallocatedAmount") or 0) for r in (items or []))
    check(suite, "unallocated receipt cash totals 1,510,000 across the run",
          st == 200 and eq(advances, 1510000), f"got {st} total = {advances}")

    # …and that total is pinned INSIDE A/R, where it now nets against what the
    # same customers owe. The run raises 1,606,100 of invoices (500,000 + 300,000
    # + 1,100 + 500,000 + 200,000 + 5,000 + 100,000) and takes 1,931,100 of
    # receipts against them — 421,100 settling documents and the 1,510,000 of
    # advance cash above — leaving A/R at -325,000, i.e. in credit. Under the old
    # treatment A/R would have read +1,185,000 with the advances parked on a
    # separate liability, so this number is the change.
    #
    # KNOWN GAP, pre-existing and not part of this change: suite 6's zero-cash
    # pure write-off (5,000) never reaches the ledger, because
    # PostPaymentAsync skips a payment whose Amount is 0. That is why A/R is
    # -325,000 here and the A/R column reads -330,000; test_expense_payee.py
    # suite 17 pins the two agreeing on a run with no such write-off.
    if ar_acct:
        bal = balance_of(base, token, cid, ar_acct["id"])
        check(suite, "A/R nets the run's invoices against its receipts (-325,000)",
              bal is not None and eq(bal, -325000), f"balance = {bal}")
        check(suite, "so A/R is in credit — the advances outweigh what is owed",
              bal is not None and bal < 0, f"balance = {bal}")


def suite_10_allocate(base, token, cid, client_id, item_type_id, foreign, disc_acct, db):
    """POST /api/receipts/{id}/allocate — apply part of an existing advance to
    invoices raised AFTER the receipt was taken (Task 4). Shares this file's
    cash-vs-settlement invariant: the guard against the RECEIPT is Σ a.Amount
    only (no AdjustmentAmount), so it must not reject cash+write-off lines."""
    suite = "10. Allocate advance to invoices"
    print(f"\n=== {suite} ===")

    st, rcp = post_receipt(base, token, cid, receipt_body(client_id, amount=5000000))
    if not check(suite, "5,000,000 advance receipt created", st in (200, 201),
                 f"got {st} {err_of(rcp)}"):
        return
    rid = rcp["id"]
    check(suite, "unallocatedAmount starts at 5,000,000",
          eq(rcp.get("unallocatedAmount"), 5000000), f"unallocatedAmount = {rcp.get('unallocatedAmount')}")

    inv = make_invoice(base, token, cid, client_id, item_type_id, 300000)
    if not check(suite, "300000 invoice created (after the receipt)", inv is not None,
                 "invoice create failed"):
        return

    st, r = post_allocate(base, token, rid, [{"invoiceId": inv["id"], "amount": 300000}])
    if not check(suite, "allocating 300000 of the advance is accepted", st == 200, f"got {st} {err_of(r)}"):
        return
    check(suite, "unallocatedAmount drops by exactly the cash applied (4,700,000)",
          eq(r.get("unallocatedAmount"), 4700000), f"unallocatedAmount = {r.get('unallocatedAmount')}")
    after_inv = get_invoice(base, token, inv["id"])
    check(suite, "invoice amountPaid rises by exactly the settled amount (300000)",
          eq(after_inv.get("amountPaid"), 300000), f"amountPaid = {after_inv.get('amountPaid')}")

    # Over-allocating beyond the remaining unallocated cash (4,700,000) is rejected.
    inv2 = make_invoice(base, token, cid, client_id, item_type_id, 5000000)
    if inv2:
        st, r = post_allocate(base, token, rid, [{"invoiceId": inv2["id"], "amount": 4800000}])
        check(suite, "allocating beyond the remaining unallocated cash is rejected (400)",
              st == 400 and "unallocated" in err_of(r).lower(), f"got {st} {err_of(r)}")
        st, still = http("GET", f"/api/payments/receipts/{rid}", base, token=token)
        still = still if isinstance(still, dict) else {}
        check(suite, "the rejected over-allocation changed nothing (still 4,700,000 unallocated)",
              eq(still.get("unallocatedAmount"), 4700000), f"unallocatedAmount = {still.get('unallocatedAmount')}")

    # Allocating to another company's invoice is rejected — cross-tenant guard,
    # shared with Create/Update via AssertInvoicesBelongToCompanyAsync.
    foreign_inv = make_invoice(base, token, foreign["company_id"], foreign["client_id"], item_type_id, 50000)
    if foreign_inv:
        st, r = post_allocate(base, token, rid, [{"invoiceId": foreign_inv["id"], "amount": 50000}])
        check(suite, "allocating to another company's invoice is rejected (400)",
              st == 400 and "belong to this company" in err_of(r), f"got {st} {err_of(r)}")

    # Cash-vs-settlement on the ALLOCATE path (coordinator review, 2026-08-30):
    # cash (4,700,000) + write-off (100,000) = 4,800,000 exceeds the remaining
    # unallocated cash (4,700,000), but the CASH alone exactly matches it. Only
    # the cash-only rule accepts this. This is the exact defect this plan has
    # hit twice before — flip PaymentService.cs's cash-fit check (~:464) to
    # Σ(a.Amount + a.AdjustmentAmount) and THIS assertion is what turns red;
    # nothing else in this suite uses AdjustmentAmount on an allocate call, so
    # a flip-and-revert is a clean, isolated proof (see task-4-report.md).
    st, r = post_allocate(base, token, rid, [{
        "invoiceId": inv2["id"], "amount": 4700000,
        "adjustmentAmount": 100000, "adjustmentAccountId": disc_acct}])
    if check(suite, "cash (4,700,000) + write-off (100,000) exceeding the remaining "
                    "unallocated cash, but cash ALONE not exceeding it, is accepted",
             st == 200, f"got {st} {err_of(r)}"):
        check(suite, "unallocatedAmount drops to exactly 0 (cash-only, not cash+write-off)",
              eq(r.get("unallocatedAmount"), 0), f"unallocatedAmount = {r.get('unallocatedAmount')}")
        after_inv2 = get_invoice(base, token, inv2["id"])
        check(suite, "inv2 amountPaid settles for cash + write-off (4,800,000)",
              eq(after_inv2.get("amountPaid"), 4800000), f"amountPaid = {after_inv2.get('amountPaid')}")

    # Money-out cannot be allocated to an invoice — only a Receipt qualifies.
    st, pay = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
        "direction": "Payment", "date": today_iso(), "contactType": "Other",
        "contactId": None, "method": "Cash",
        "allocations": [{"accountId": disc_acct, "amount": 5000}]})
    if check(suite, "money-out payment created (for the negative test)", st in (200, 201),
             f"got {st} {err_of(pay)}"):
        st, r = post_allocate(base, token, pay["id"], [{"invoiceId": inv["id"], "amount": 1000}])
        check(suite, "a money-out payment cannot be allocated to an invoice (400)",
              st == 400 and "only a receipt" in err_of(r).lower(), f"got {st} {err_of(r)}")

    # A cancelled receipt cannot be allocated. Payment.IsCancelled has no API
    # (legacy-import-only), so this is exercised via direct SQL, opt-in via --db.
    st, rcp2 = post_receipt(base, token, cid, receipt_body(client_id, amount=100000))
    if check(suite, "second advance receipt created (for the cancelled-receipt test)",
             st in (200, 201), f"got {st} {err_of(rcp2)}"):
        if sql_cancel_payment(db, rcp2["id"]):
            inv3 = make_invoice(base, token, cid, client_id, item_type_id, 10000)
            if inv3:
                st, r = post_allocate(base, token, rcp2["id"], [{"invoiceId": inv3["id"], "amount": 10000}])
                check(suite, "a cancelled receipt cannot be allocated (400)",
                      st == 400 and "cancelled" in err_of(r).lower(), f"got {st} {err_of(r)}")
        else:
            skip(suite, "a cancelled receipt cannot be allocated",
                 "pass --db <name> (direct-SQL escape hatch; no API sets IsCancelled)")


def suite_11_moneyout_amount_gate(base, token, cid, supplier_id, disc_acct):
    """2026-08-30: Payment.Amount became authoritative (suite 1) without being
    gated to Direction == Receipt, so a money-out payload could declare an
    Amount above its allocation cash total — PostingService's advance leg is
    skipped for money-out (isEqReceipt false), so the uncovered remainder was
    silently plugged to Suspense. No pre-existing caller could hit this (the
    field is new), but it contradicted the plan's money-out-byte-for-byte-
    unchanged constraint and nothing tested it. Fixed by making ResolveAmount
    IGNORE dto.Amount for Direction == Payment and always derive Σ allocations —
    the same value every pre-2026-08-29 caller got, no matter what a caller now
    sends. Applied identically on Create and Update."""
    suite = "11. Money-out Amount gate"
    print(f"\n=== {suite} ===")

    st, pay = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
        "direction": "Payment", "date": today_iso(), "contactType": "Supplier",
        "contactId": supplier_id, "method": "Cash", "amount": 999999,
        "allocations": [{"accountId": disc_acct, "amount": 7000}]})
    ok = check(suite, "money-out with amount far above the allocation cash total is accepted (not rejected)",
               st in (200, 201), f"got {st} {err_of(pay)}")
    if ok:
        check(suite, "the inflated amount is IGNORED — stored amount is the allocation cash total (7000)",
              eq(pay.get("amount"), 7000), f"amount = {pay.get('amount')}")
        check(suite, "unallocatedAmount is 0 — no advance concept for money-out",
              eq(pay.get("unallocatedAmount"), 0), f"unallocatedAmount = {pay.get('unallocatedAmount')}")

    # A normal money-out payment (amount == allocation cash total) is unaffected.
    st, pay2 = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
        "direction": "Payment", "date": today_iso(), "contactType": "Supplier",
        "contactId": supplier_id, "method": "Cash", "amount": 3000,
        "allocations": [{"accountId": disc_acct, "amount": 3000}]})
    ok2 = check(suite, "a normal money-out payment (amount == allocation total) is unaffected",
                st in (200, 201) and eq(pay2.get("amount"), 3000),
                f"got {st} amount={pay2.get('amount') if isinstance(pay2, dict) else pay2}")

    # The Update (edit) path must not be able to inflate it either — the fix
    # was applied to BOTH ResolveAmount call sites, not just Create's.
    if ok2:
        st, edited = http("PUT", f"/api/payments/payments/{pay2['id']}", base, token=token, body={
            "direction": "Payment", "date": today_iso(), "contactType": "Supplier",
            "contactId": supplier_id, "method": "Cash", "amount": 999999,
            "allocations": [{"accountId": disc_acct, "amount": 3000}]})
        check(suite, "editing money-out with an inflated amount is also ignored (still 3000)",
              st == 200 and eq(edited.get("amount"), 3000),
              f"got {st} amount={edited.get('amount') if isinstance(edited, dict) else edited}")


def payment_entry(base, token, cid, payment_id):
    """The journal entry the posting engine wrote for one payment."""
    st, page = http("GET", f"/api/journal-entries/company/{cid}/paged?pageSize=200",
                    base, token=token)
    rows = (page or {}).get("items") if isinstance(page, dict) else None
    for e in rows or []:
        if e.get("sourceDocType") == "Payment" and e.get("sourceDocId") == payment_id:
            st2, full = http("GET", f"/api/journal-entries/{e['id']}", base, token=token)
            return full if st2 == 200 and isinstance(full, dict) else e
    return None


def suite_12_allocate_gl_integrity(base, token, cid, client_id, item_type_id, ar_acct, bank_acct):
    """GL proof for AllocateAsync's re-post (coordinator review, 2026-08-30;
    reworked 2026-08-31 for the new posting target).

    An advance now sits on the client's OWN Accounts receivable, so allocating it
    to an invoice moves NOTHING in the ledger — the money was already on A/R and
    the allocation only re-labels which invoice the credit belongs to. That is a
    stronger claim than the "advance leg shrinks / AR leg grows" it replaces, and
    it is pinned here together with the two things only a SECOND allocate call can
    prove: that re-posting REPLACES the payment's journal entry rather than
    appending to it (an appended entry would duplicate the 900,000 bank leg), and
    that each allocated slice ends up tagged to the invoice it settled.

    A fresh receipt is used so before/after deltas are exact regardless of what
    earlier suites already posted to these same control accounts."""
    suite = "12. Allocate GL integrity"
    print(f"\n=== {suite} ===")
    if not ar_acct or not bank_acct:
        skip(suite, "A/R + bank balance movement and no-duplicate-lines on re-post",
             "'Accounts receivable' or 'Bank & Cash' control account not found")
        return

    before_ar_0 = balance_of(base, token, cid, ar_acct["id"])
    before_bank_0 = balance_of(base, token, cid, bank_acct["id"])
    st, rcp = post_receipt(base, token, cid, receipt_body(client_id, amount=900000))
    if not check(suite, "900,000 advance receipt created", st in (200, 201),
                 f"got {st} {err_of(rcp)}"):
        return
    rid = rcp["id"]
    after_create_ar = balance_of(base, token, cid, ar_acct["id"])
    after_create_bank = balance_of(base, token, cid, bank_acct["id"])
    check(suite, "the advance credits A/R by the full 900000 straight away",
          before_ar_0 is not None and after_create_ar is not None
          and eq(after_create_ar, before_ar_0 - 900000),
          f"before={before_ar_0}, after={after_create_ar}")
    check(suite, "and debits bank/cash by the same 900000",
          before_bank_0 is not None and after_create_bank is not None
          and eq(after_create_bank, before_bank_0 + 900000),
          f"before={before_bank_0}, after={after_create_bank}")

    inv_a = make_invoice(base, token, cid, client_id, item_type_id, 200000)
    inv_b = make_invoice(base, token, cid, client_id, item_type_id, 150000)
    if not check(suite, "two invoices created (200000, 150000)",
                 inv_a is not None and inv_b is not None, "invoice create failed"):
        return

    # ── First allocate: 200,000 cash to inv_a ──────────────────────────
    before_ar_1 = balance_of(base, token, cid, ar_acct["id"])
    st, r = post_allocate(base, token, rid, [{"invoiceId": inv_a["id"], "amount": 200000}])
    if not check(suite, "first allocate (200000 cash) accepted", st == 200, f"got {st} {err_of(r)}"):
        return
    after_ar_1 = balance_of(base, token, cid, ar_acct["id"])
    after_bank_1 = balance_of(base, token, cid, bank_acct["id"])
    check(suite, "allocating moves A/R by nothing — the money was already there",
          before_ar_1 is not None and after_ar_1 is not None and eq(after_ar_1, before_ar_1),
          f"before={before_ar_1}, after={after_ar_1}")
    check(suite, "and moves no cash (the bank leg is not duplicated)",
          after_bank_1 is not None and eq(after_bank_1, after_create_bank),
          f"after create={after_create_bank}, after allocate={after_bank_1}")
    st_tb1, tb1 = http("GET", f"/api/accounting/reports/company/{cid}/trial-balance", base, token=token)
    tb1 = tb1 if isinstance(tb1, dict) else {}
    check(suite, "trial balance still balanced after first allocate",
          st_tb1 == 200 and eq(tb1.get("totalDebit"), tb1.get("totalCredit")),
          f"got {st_tb1} debit={tb1.get('totalDebit')} credit={tb1.get('totalCredit')}")

    # ── Second allocate, SAME receipt, a DIFFERENT invoice: if PostPaymentAsync
    #    appended instead of replacing the payment's journal entry, the entry
    #    below would carry the first call's legs a second time. ──────────────
    st, r2 = post_allocate(base, token, rid, [{"invoiceId": inv_b["id"], "amount": 150000}])
    if not check(suite, "second allocate (150000 cash, different invoice) accepted",
                 st == 200, f"got {st} {err_of(r2)}"):
        return
    after_ar_2 = balance_of(base, token, cid, ar_acct["id"])
    after_bank_2 = balance_of(base, token, cid, bank_acct["id"])
    check(suite, "A/R still unmoved after the second allocate",
          after_ar_2 is not None and eq(after_ar_2, before_ar_1),
          f"before any allocate={before_ar_1}, after second={after_ar_2}")
    check(suite, "bank still unmoved after the second allocate",
          after_bank_2 is not None and eq(after_bank_2, after_create_bank),
          f"after create={after_create_bank}, after second={after_bank_2}")
    st_tb2, tb2 = http("GET", f"/api/accounting/reports/company/{cid}/trial-balance", base, token=token)
    tb2 = tb2 if isinstance(tb2, dict) else {}
    check(suite, "trial balance still balanced after second allocate (no duplicate lines)",
          st_tb2 == 200 and eq(tb2.get("totalDebit"), tb2.get("totalCredit")),
          f"got {st_tb2} debit={tb2.get('totalDebit')} credit={tb2.get('totalCredit')}")
    check(suite, "unallocatedAmount reflects BOTH allocations (900000 - 350000 = 550000)",
          eq(r2.get("unallocatedAmount"), 550000), f"unallocatedAmount = {r2.get('unallocatedAmount')}")

    # ── The entry itself: one bank leg, and the A/R credit split by invoice.
    #    This is what "re-post REPLACES" means in the ledger, and it proves the
    #    allocated slices are attributed rather than merely totalled. ─────────
    entry = payment_entry(base, token, cid, rid)
    if not check(suite, "the receipt's journal entry is readable", entry is not None,
                 "no Payment entry found for this receipt"):
        return
    lines = entry.get("lines") or []
    bank_legs = [l for l in lines if l.get("accountId") == bank_acct["id"]]
    ar_legs = [l for l in lines if l.get("accountId") == ar_acct["id"]]
    check(suite, "exactly ONE bank leg, for the full 900000",
          len(bank_legs) == 1 and eq(bank_legs[0].get("debit"), 900000), str(bank_legs))
    check(suite, "the A/R credits still sum to the full 900000",
          eq(sum(float(l.get("credit") or 0) for l in ar_legs), 900000),
          str([l.get("credit") for l in ar_legs]))
    by_inv = {l.get("invoiceId"): float(l.get("credit") or 0) for l in ar_legs}
    check(suite, "200000 of it is tagged to the first invoice",
          eq(by_inv.get(inv_a["id"]), 200000), str(by_inv))
    check(suite, "150000 of it is tagged to the second invoice",
          eq(by_inv.get(inv_b["id"]), 150000), str(by_inv))
    check(suite, "and the remaining 550000 carries no invoice — still an advance",
          eq(by_inv.get(None), 550000), str(by_inv))
    check(suite, "every A/R leg names the client",
          all(l.get("partyType") == "Client" and l.get("partyId") == client_id for l in ar_legs),
          str([(l.get("partyType"), l.get("partyId")) for l in ar_legs]))


def suite_13_allocate_on_account_line(base, token, cid, client_id, item_type_id, ar_acct, bank_acct):
    """An advance recorded as an EXPLICIT "advance / on account" line must be
    spendable, exactly like the line-less shape suites 10 and 12 cover.

    Two shapes record the same thing — a receipt saved with no allocation lines
    (Payment.Amount is authoritative, 2026-08-29) and a receipt carrying an
    AllocationKind.OnAccount line (2026-08-31) — and they are indistinguishable
    to the operator. Until this suite existed, AllocateAsync counted the
    OnAccount line as cash already applied, so the second shape reported zero
    free cash and refused every allocation: that customer's advance could never
    settle a later invoice, which is the whole point of holding it.

    Allocating must therefore DRAW DOWN the parked line by the cash applied,
    leaving the remainder parked and removing the line once it is spent, so
    Payment.Amount still equals the sum of its parts and the re-post stays
    balanced."""
    suite = "13. Allocate an explicit on-account advance"
    print(f"\n=== {suite} ===")
    if not ar_acct or not bank_acct:
        skip(suite, "explicit OnAccount advance is spendable",
             "'Accounts receivable' or 'Bank & Cash' control account not found")
        return

    before_ar = balance_of(base, token, cid, ar_acct["id"])
    before_bank = balance_of(base, token, cid, bank_acct["id"])
    st, rcp = post_receipt(base, token, cid, receipt_body(
        client_id, amount=500000, allocations=[{"kind": "OnAccount", "amount": 500000}]))
    if not check(suite, "500,000 receipt with an explicit OnAccount line created",
                 st in (200, 201), f"got {st} {err_of(rcp)}"):
        return
    rid = rcp["id"]
    allocs = rcp.get("allocations") or []
    check(suite, "it carries exactly one OnAccount line for the full 500,000",
          len(allocs) == 1 and allocs[0].get("kind") == "OnAccount"
          and eq(allocs[0].get("amount"), 500000), str(allocs))
    check(suite, "unallocatedAmount reports the parked 500,000, not 0",
          eq(rcp.get("unallocatedAmount"), 500000),
          f"unallocatedAmount = {rcp.get('unallocatedAmount')}")
    check(suite, "A/R is credited the full 500,000 straight away",
          before_ar is not None and eq(balance_of(base, token, cid, ar_acct["id"]), before_ar - 500000),
          f"before={before_ar}, after={balance_of(base, token, cid, ar_acct['id'])}")
    after_create_bank = balance_of(base, token, cid, bank_acct["id"])
    check(suite, "and bank/cash debited the same 500,000",
          before_bank is not None and eq(after_create_bank, before_bank + 500000),
          f"before={before_bank}, after={after_create_bank}")

    # ── Partial: 200,000 of the 500,000 ────────────────────────────────
    inv_a = make_invoice(base, token, cid, client_id, item_type_id, 200000)
    if not check(suite, "200,000 invoice created (after the advance)", inv_a is not None,
                 "invoice create failed"):
        return
    ar_before_alloc = balance_of(base, token, cid, ar_acct["id"])
    st, r = post_allocate(base, token, rid, [{"invoiceId": inv_a["id"], "amount": 200000}])
    if not check(suite, "allocating 200,000 of the parked advance is ACCEPTED",
                 st == 200, f"got {st} {err_of(r)} - an explicit advance must be spendable"):
        return
    check(suite, "the invoice is settled for the 200,000",
          eq(get_invoice(base, token, inv_a["id"]).get("amountPaid"), 200000),
          f"amountPaid = {get_invoice(base, token, inv_a['id']).get('amountPaid')}")
    check(suite, "Payment.Amount is untouched at 500,000", eq(r.get("amount"), 500000),
          f"amount = {r.get('amount')}")

    allocs = r.get("allocations") or []
    parked = [a for a in allocs if a.get("kind") == "OnAccount"]
    applied = [a for a in allocs if a.get("invoiceId") == inv_a["id"]]
    check(suite, "the OnAccount line SHRANK to 300,000 (drawn down, not duplicated)",
          len(parked) == 1 and eq(parked[0].get("amount"), 300000), str(allocs))
    check(suite, "and a 200,000 invoice line sits beside it",
          len(applied) == 1 and eq(applied[0].get("amount"), 200000), str(allocs))
    check(suite, "the lines still sum to Payment.Amount (300,000 + 200,000)",
          eq(sum(float(a.get("amount") or 0) for a in allocs), 500000), str(allocs))
    check(suite, "unallocatedAmount follows the parked line down to 300,000",
          eq(r.get("unallocatedAmount"), 300000), f"unallocatedAmount = {r.get('unallocatedAmount')}")

    check(suite, "A/R total is unmoved — the cash was already on the client's account",
          eq(balance_of(base, token, cid, ar_acct["id"]), ar_before_alloc),
          f"before={ar_before_alloc}, after={balance_of(base, token, cid, ar_acct['id'])}")
    check(suite, "and no cash moved (the bank leg is not duplicated)",
          eq(balance_of(base, token, cid, bank_acct["id"]), after_create_bank),
          f"after create={after_create_bank}, after allocate={balance_of(base, token, cid, bank_acct['id'])}")

    entry = payment_entry(base, token, cid, rid)
    if entry:
        lines = entry.get("lines") or []
        ar_legs = [l for l in lines if l.get("accountId") == ar_acct["id"]]
        by_inv = {l.get("invoiceId"): float(l.get("credit") or 0) for l in ar_legs}
        check(suite, "the party-control leg shrank by exactly what the invoice leg gained",
              eq(by_inv.get(None), 300000) and eq(by_inv.get(inv_a["id"]), 200000), str(by_inv))
        check(suite, "one bank leg only, and the entry balances",
              len([l for l in lines if l.get("accountId") == bank_acct["id"]]) == 1
              and eq(sum(float(l.get("debit") or 0) for l in lines),
                     sum(float(l.get("credit") or 0) for l in lines)), str(lines))

    # ── Over-allocating past what is left is refused ───────────────────
    inv_over = make_invoice(base, token, cid, client_id, item_type_id, 400000)
    if inv_over:
        st, r_over = post_allocate(base, token, rid, [{"invoiceId": inv_over["id"], "amount": 400000}])
        check(suite, "allocating more than the remaining 300,000 is rejected (400)",
              st == 400 and "unallocated" in err_of(r_over).lower(), f"got {st} {err_of(r_over)}")

    # ── Full: the last 300,000 ─────────────────────────────────────────
    inv_b = make_invoice(base, token, cid, client_id, item_type_id, 300000)
    if not check(suite, "300,000 invoice created", inv_b is not None, "invoice create failed"):
        return
    # Bracket the second allocate on its own: inv_over and inv_b were raised
    # since the first one and legitimately DEBIT A/R, so the "unmoved" claim is
    # about what allocating does, not about the whole stretch.
    ar_before_alloc2 = balance_of(base, token, cid, ar_acct["id"])
    st, r2 = post_allocate(base, token, rid, [{"invoiceId": inv_b["id"], "amount": 300000}])
    if not check(suite, "allocating the whole remaining balance is accepted", st == 200,
                 f"got {st} {err_of(r2)}"):
        return
    allocs2 = r2.get("allocations") or []
    check(suite, "the spent OnAccount line is GONE, not left at zero",
          not any(a.get("kind") == "OnAccount" for a in allocs2), str(allocs2))
    check(suite, "only the two invoice lines remain, summing to 500,000",
          len(allocs2) == 2 and eq(sum(float(a.get("amount") or 0) for a in allocs2), 500000),
          str(allocs2))
    check(suite, "unallocatedAmount is 0 — the advance is fully spent",
          eq(r2.get("unallocatedAmount"), 0), f"unallocatedAmount = {r2.get('unallocatedAmount')}")
    check(suite, "the second allocate moves A/R by nothing either (no duplicate legs)",
          eq(balance_of(base, token, cid, ar_acct["id"]), ar_before_alloc2),
          f"before={ar_before_alloc2}, after={balance_of(base, token, cid, ar_acct['id'])}")
    check(suite, "bank still unmoved after the second allocate",
          eq(balance_of(base, token, cid, bank_acct["id"]), after_create_bank),
          f"after create={after_create_bank}, now={balance_of(base, token, cid, bank_acct['id'])}")

    entry2 = payment_entry(base, token, cid, rid)
    if entry2:
        lines2 = entry2.get("lines") or []
        ar_legs2 = [l for l in lines2 if l.get("accountId") == ar_acct["id"]]
        by_inv2 = {l.get("invoiceId"): float(l.get("credit") or 0) for l in ar_legs2}
        check(suite, "no untagged party-control leg is left — every rupee names an invoice",
              None not in by_inv2 and eq(by_inv2.get(inv_a["id"]), 200000)
              and eq(by_inv2.get(inv_b["id"]), 300000), str(by_inv2))
        check(suite, "one bank leg only, and the entry still balances",
              len([l for l in lines2 if l.get("accountId") == bank_acct["id"]]) == 1
              and eq(sum(float(l.get("debit") or 0) for l in lines2),
                     sum(float(l.get("credit") or 0) for l in lines2)), str(lines2))

    st, tb = http("GET", f"/api/accounting/reports/company/{cid}/trial-balance", base, token=token)
    tb = tb if isinstance(tb, dict) else {}
    check(suite, "trial balance still balanced", st == 200 and eq(tb.get("totalDebit"), tb.get("totalCredit")),
          f"got {st} debit={tb.get('totalDebit')} credit={tb.get('totalCredit')}")


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
    for s, n, r in skipped:
        print(f"SKIPPED {s} :: {n}   [{r}]")
    suffix = f", {len(skipped)} skipped" if skipped else ""
    print(f"{passed}/{total} checks passed{suffix}")
    return 0 if passed == total else 1


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://localhost:5134")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw", default="admin123")
    p.add_argument("--keep", action="store_true",
                   help="Leave the ephemeral company in the DB after the run.")
    p.add_argument("--db", default=None,
                   help="Database name for the direct-SQL escape hatch suite 10 "
                        "needs to flip Payment.IsCancelled (no API sets it). "
                        "Omit to skip only that one case.")
    args = p.parse_args()
    base = args.base

    token, cid, client_id, supplier_id, item_type_id, foreign = setup(
        base, args.admin_user, args.admin_pw)
    flat = flat_accounts(base, token, cid)

    def by_control(ct):
        return next((a for a in flat if a.get("controlType") == ct), None)

    # Superseded 2026-08-31 — an advance posts to the party's own control
    # account now, and the preset no longer creates this one. Looked up so
    # suite 1 can assert it is GONE.
    advance = by_control("CustomerAdvances")
    ar = by_control("AccountsReceivable")
    bank = by_control("BankCash")
    disc = (by_control("DiscountAllowed") or {}).get("id")
    bad_debt = (by_control("BadDebtWriteOff") or {}).get("id")
    print(f"\n== company={cid} client={client_id} supplier={supplier_id} "
          f"itemType={item_type_id} ar={ar['id'] if ar else None} "
          f"bank={bank['id'] if bank else None} "
          f"disc={disc} badDebt={bad_debt} foreign={foreign} ==")

    try:
        suite_1_advance(base, token, cid, client_id, ar, advance)
        suite_2_amountpaid(base, token, cid, client_id, item_type_id)
        suite_3_partial(base, token, cid, client_id, item_type_id)
        suite_4_cash_vs_settlement(base, token, cid, client_id, item_type_id, disc)
        suite_5_guards(base, token, cid, client_id, item_type_id, disc)
        money_out = suite_6_backcompat(base, token, cid, client_id, item_type_id, bad_debt, disc)
        suite_7_edit(base, token, cid, client_id, item_type_id, money_out)
        suite_8_contact_type(base, token, cid, client_id, supplier_id, foreign, disc)
        suite_9_ledger(base, token, cid, ar)
        suite_10_allocate(base, token, cid, client_id, item_type_id, foreign, disc, args.db)
        suite_11_moneyout_amount_gate(base, token, cid, supplier_id, disc)
        suite_12_allocate_gl_integrity(base, token, cid, client_id, item_type_id, ar, bank)
        suite_13_allocate_on_account_line(base, token, cid, client_id, item_type_id, ar, bank)
    finally:
        teardown(base, token, [cid, foreign["company_id"]], args.keep)

    return report()


if __name__ == "__main__":
    sys.exit(main())
