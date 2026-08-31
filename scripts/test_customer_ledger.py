"""
Customer ledger benchmark — CustomerLedgerService (2026-08-30).

Pins the derived money-in / money-out trail that replaced
`ClientService.GetStatementAsync`, and the four defects of that old statement
that must never come back:

  1. credit and debit notes were EXCLUDED  (DocumentType 9 / 10 filtered out);
  2. only `PaymentAllocation.Amount` was credited while `Invoice.AmountPaid`
     counts `Amount + AdjustmentAmount`, so every settle-remainder write-off
     left the closing balance disagreeing with A/R;
  3. receipts were summed PER ALLOCATION, so unallocated cash — a customer
     advance — never appeared in the trail;
  4. a hard 200-row cap with no date range and no opening balance.

COLUMN CONVENTION (user decision, 2026-08-30) — the operator's own workbook,
the MIRROR of the textbook A/R presentation:
    invoice / debit note              -> CREDIT column
    receipt / credit note / adjustment -> DEBIT  column
    balance = opening + SUM(credit) - SUM(debit)
Positive balance = the customer owes; negative = they hold an advance. This is
PRESENTATION ONLY — the GL is untouched (an invoice still posts Dr A/R).

Cash vs settlement are deliberately NOT conflated:
  * against the INVOICE an allocation settles Amount + AdjustmentAmount;
  * against the RECEIPT only Amount counts, and the receipt shows in the ledger
    at its FULL Payment.Amount.

Suites:
  1. Client scenario        -> the requirement's own 5-row table, closing -4,500,000
  2. Settle remainder       -> closing balance == A/R even after a 10k write-off
  3. Credit / debit notes   -> both appear, on the right side of the ledger
  4. Unallocated cash       -> one receipt row at its FULL amount, no double count
  5. Scope + exclusions     -> per-client, per-company, deleted receipts drop out
  6. Plain A/R agreement    -> closing == invoice balanceDue when nothing exotic
  7. Cash from another contact -> a receipt whose contact is "Other" can settle
                               this client's invoice (PaymentService checks the
                               COMPANY, not the contact), so it must show on the
                               trail — and an own-contact receipt reachable from
                               both sources must still be counted exactly once
  8. Income line on a receipt -> an AllocationKind.Account line on a client's
                               receipt posts to the chosen income account, never
                               to A/R, so it must not debit their ledger: the
                               drill-down, the aggregate row, the client-detail
                               statement and the Customers-screen A/R column all
                               have to report the same number

KNOWN LIMITATION, deliberately not asserted: invoices are charged at full
GrandTotal while `Invoice.BalanceDue` settles against
`Collectible = GrandTotal - WithholdingTaxAmount`, so with withholding tax in
play the closing balance does NOT equal BalanceDue. Inherited from the statement
this replaced; accepted 2026-08-30, to be picked up deliberately later.

REACHABLE SURFACE: the ledger has no HTTP route of its own yet (the controller
is a later task), so this suite drives it through `GET /api/clients/{id}/statement`,
which now delegates to CustomerLedgerService. The date-window / opening-balance /
type-filter / paging arguments are therefore NOT exercised end-to-end here —
re-run this suite with direct ledger assertions once that route exists.

Each suite uses its own client inside one ephemeral company so the balances are
independent. Everything is torn down at the end. Production data is never touched.

Usage:
  python scripts/test_customer_ledger.py --base http://localhost:5147
  python scripts/test_customer_ledger.py --base http://localhost:5147 --keep

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


def days_ago_iso(n: int) -> str:
    """A date N days back in Karachi terms, shaped the way the forms submit."""
    return (datetime.now(PKT) - timedelta(days=n)).date().strftime("%Y-%m-%dT00:00:00Z")


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
def make_invoice(base, token, cid, client_id, item_type_id, total, date=None):
    st, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": date or today_iso(), "companyId": cid, "clientId": client_id,
        "gstRate": 0,
        "items": [{"description": "Ledger test good", "quantity": 1, "uom": "Pcs",
                   "unitPrice": total, "itemTypeId": item_type_id}]})
    return inv if st in (200, 201) and isinstance(inv, dict) else None


def make_receipt(base, token, cid, client_id, amount, allocations=None, date=None,
                 contact_type="Client"):
    body = {"direction": "Receipt", "date": date or today_iso(),
            "contactType": contact_type, "method": "Cash", "amount": amount,
            "allocations": allocations or []}
    # A party-less "Other" receipt carries no ContactId (and is REQUIRED to
    # carry allocations — PaymentService.AssertAllocationsPresent).
    if contact_type == "Client":
        body["contactId"] = client_id
    st, r = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body=body)
    return st, r


def get_invoice(base, token, invoice_id):
    _, inv = http("GET", f"/api/invoices/{invoice_id}", base, token=token)
    return inv if isinstance(inv, dict) else {}


def statement(base, token, client_id):
    """The customer trail, as the UI reads it. Entries come back newest-first;
    reversing gives the service's own chronological order."""
    st, s = http("GET", f"/api/clients/{client_id}/statement", base, token=token)
    if st != 200 or not isinstance(s, dict):
        return None
    s["_chrono"] = list(reversed(s.get("entries") or []))
    return s


def rows_of(stmt, type_name):
    return [e for e in (stmt.get("entries") or []) if e.get("type") == type_name]


def sum_col(stmt, col):
    return sum(float(e.get(col) or 0) for e in (stmt.get("entries") or []))


# ── Suite 1: the requirement's own table ───────────────────────────
def suite_1_client_scenario(base, token, cid, client_id, item_type_id):
    """01 INV 300k, 05 REC 100k, 10 INV 500k, 15 REC 200k, 20 REC 5,000k
       -> running balance 300k, 200k, 700k, 500k, -4,500,000."""
    suite = "1. Client scenario"
    print(f"\n=== {suite} ===")

    i1 = make_invoice(base, token, cid, client_id, item_type_id, 300000, days_ago_iso(20))
    if not check(suite, "300,000 invoice created (day -20)", i1 is not None, "create failed"):
        return
    st, r1 = make_receipt(base, token, cid, client_id, 100000, date=days_ago_iso(16),
                          allocations=[{"invoiceId": i1["id"], "amount": 100000}])
    check(suite, "100,000 receipt created (day -16)", st in (200, 201), f"got {st} {err_of(r1)}")

    i2 = make_invoice(base, token, cid, client_id, item_type_id, 500000, days_ago_iso(11))
    if not check(suite, "500,000 invoice created (day -11)", i2 is not None, "create failed"):
        return
    st, r2 = make_receipt(base, token, cid, client_id, 200000, date=days_ago_iso(6),
                          allocations=[{"invoiceId": i2["id"], "amount": 200000}])
    check(suite, "200,000 receipt created (day -6)", st in (200, 201), f"got {st} {err_of(r2)}")

    # The big one is pure cash with nothing to settle — the advance the old
    # per-allocation statement could not see at all.
    st, r3 = make_receipt(base, token, cid, client_id, 5000000, date=days_ago_iso(1))
    check(suite, "5,000,000 unallocated receipt created (day -1)",
          st in (200, 201), f"got {st} {err_of(r3)}")

    s = statement(base, token, client_id)
    if not check(suite, "statement loads", s is not None, "statement request failed"):
        return

    chrono = s["_chrono"]
    check(suite, "exactly 5 ledger entries", len(chrono) == 5,
          f"got {len(chrono)}: {[e.get('reference') for e in chrono]}")

    balances = [round(float(e.get("balance") or 0), 2) for e in chrono]
    expected = [300000.0, 200000.0, 700000.0, 500000.0, -4500000.0]
    check(suite, f"running balances are {expected}", balances == expected, f"got {balances}")

    check(suite, "closing balance is -4,500,000 (customer holds an advance)",
          eq(s.get("closingBalance"), -4500000), f"got {s.get('closingBalance')}")

    # Workbook convention: the document sits in Credit, the money in Debit.
    invs = rows_of(s, "Invoice")
    recs = rows_of(s, "Receipt")
    check(suite, "3 receipts and 2 invoices are typed correctly",
          len(invs) == 2 and len(recs) == 3, f"invoices={len(invs)} receipts={len(recs)}")
    check(suite, "invoices sit in the CREDIT column (workbook convention)",
          all(eq(e.get("debit"), 0) and float(e.get("credit") or 0) > 0 for e in invs),
          f"got {[(e.get('debit'), e.get('credit')) for e in invs]}")
    check(suite, "receipts sit in the DEBIT column (workbook convention)",
          all(eq(e.get("credit"), 0) and float(e.get("debit") or 0) > 0 for e in recs),
          f"got {[(e.get('debit'), e.get('credit')) for e in recs]}")
    check(suite, "column sums: credit 800,000 / debit 5,300,000",
          eq(sum_col(s, "credit"), 800000) and eq(sum_col(s, "debit"), 5300000),
          f"credit={sum_col(s, 'credit')} debit={sum_col(s, 'debit')}")
    check(suite, "closing == SUM(credit) - SUM(debit)",
          eq(s.get("closingBalance"), sum_col(s, "credit") - sum_col(s, "debit")),
          f"closing={s.get('closingBalance')}")


# ── Suite 2: the discount bug ──────────────────────────────────────
def suite_2_settle_remainder(base, token, cid, client_id, item_type_id, disc_acct):
    """A 90,000 cash receipt with a 10,000 write-off clears a 100,000 invoice.
       The old statement credited only the 90,000 cash, so its closing balance
       said 10,000 while A/R said 0."""
    suite = "2. Settle remainder vs A/R"
    print(f"\n=== {suite} ===")

    if not check(suite, "company has a DiscountAllowed account", disc_acct is not None,
                 "no DiscountAllowed control account on this chart"):
        return
    inv = make_invoice(base, token, cid, client_id, item_type_id, 100000)
    if not check(suite, "100,000 invoice created", inv is not None, "create failed"):
        return

    st, r = make_receipt(base, token, cid, client_id, 90000, allocations=[{
        "invoiceId": inv["id"], "amount": 90000,
        "adjustmentAmount": 10000, "adjustmentAccountId": disc_acct}])
    if not check(suite, "90,000 cash + 10,000 write-off accepted",
                 st in (200, 201), f"got {st} {err_of(r)}"):
        return

    after = get_invoice(base, token, inv["id"])
    check(suite, "invoice is settled: amountPaid 100,000, balanceDue 0",
          eq(after.get("amountPaid"), 100000) and eq(after.get("balanceDue"), 0),
          f"amountPaid={after.get('amountPaid')} balanceDue={after.get('balanceDue')}")

    s = statement(base, token, client_id)
    if not check(suite, "statement loads", s is not None, "statement request failed"):
        return

    check(suite, "closing balance is 0 — agrees with A/R (was 10,000 before the fix)",
          eq(s.get("closingBalance"), 0), f"got {s.get('closingBalance')}")
    check(suite, "closing balance equals the invoice balanceDue",
          eq(s.get("closingBalance"), after.get("balanceDue")),
          f"ledger={s.get('closingBalance')} A/R={after.get('balanceDue')}")

    adj = rows_of(s, "Adjustment")
    check(suite, "one Adjustment row for the 10,000 write-off",
          len(adj) == 1 and eq(adj[0].get("debit"), 10000),
          f"rows={[(a.get('reference'), a.get('debit')) for a in adj]}")

    rec = rows_of(s, "Receipt")
    check(suite, "the receipt row carries CASH ONLY (90,000) — no double count",
          len(rec) == 1 and eq(rec[0].get("debit"), 90000),
          f"rows={[(x.get('reference'), x.get('debit')) for x in rec]}")
    check(suite, "SUM(debit) 100,000 == SUM(credit) 100,000",
          eq(sum_col(s, "debit"), 100000) and eq(sum_col(s, "credit"), 100000),
          f"debit={sum_col(s, 'debit')} credit={sum_col(s, 'credit')}")


# ── Suite 3: notes are in the trail ────────────────────────────────
def suite_3_notes(base, token, cid, client_id, item_type_id):
    """Credit and debit notes were filtered out of the old statement entirely.
       FBR is off on this company, so a note needs a fully PAID original."""
    suite = "3. Credit / debit notes"
    print(f"\n=== {suite} ===")

    inv = make_invoice(base, token, cid, client_id, item_type_id, 200000)
    if not check(suite, "200,000 invoice created", inv is not None, "create failed"):
        return
    st, r = make_receipt(base, token, cid, client_id, 200000,
                         allocations=[{"invoiceId": inv["id"], "amount": 200000}])
    if not check(suite, "invoice fully paid (note eligibility, FBR off)",
                 st in (200, 201), f"got {st} {err_of(r)}"):
        return

    # DocumentType 10 = CREDIT NOTE, 9 = DEBIT NOTE. Pinned by
    # Models/Invoice.cs:151 and InvoiceService.CreateNoteAsync.
    st, cn = http("POST", "/api/invoices/notes", base, token=token, body={
        "originalInvoiceId": inv["id"], "documentType": 10,
        "reason": "Return of goods", "affectsStock": False})
    if not check(suite, "credit note (DocumentType 10) created",
                 st in (200, 201), f"got {st} {err_of(cn)}"):
        return
    cn_total = float(cn.get("grandTotal") or 0)

    s = statement(base, token, client_id)
    if not check(suite, "statement loads", s is not None, "statement request failed"):
        return
    cn_rows = rows_of(s, "Credit Note")
    check(suite, "the credit note appears in the trail (old statement dropped it)",
          len(cn_rows) == 1, f"rows={[e.get('reference') for e in cn_rows]}")
    if cn_rows:
        check(suite, "credit note sits in the DEBIT column — it reverses the sale",
              eq(cn_rows[0].get("debit"), cn_total) and eq(cn_rows[0].get("credit"), 0),
              f"debit={cn_rows[0].get('debit')} credit={cn_rows[0].get('credit')} total={cn_total}")
        check(suite, "credit note reference is CN-prefixed",
              str(cn_rows[0].get("reference", "")).startswith("CN-"),
              f"reference={cn_rows[0].get('reference')}")
    check(suite, f"closing balance dropped by the note ({-cn_total})",
          eq(s.get("closingBalance"), -cn_total), f"got {s.get('closingBalance')}")

    st, dn = http("POST", "/api/invoices/notes", base, token=token, body={
        "originalInvoiceId": inv["id"], "documentType": 9,
        "reason": "Change in value of supply", "affectsStock": False})
    if not check(suite, "debit note (DocumentType 9) created",
                 st in (200, 201), f"got {st} {err_of(dn)}"):
        return
    dn_total = float(dn.get("grandTotal") or 0)

    s = statement(base, token, client_id)
    dn_rows = rows_of(s, "Debit Note")
    check(suite, "the debit note appears in the trail", len(dn_rows) == 1,
          f"rows={[e.get('reference') for e in dn_rows]}")
    if dn_rows:
        check(suite, "debit note sits in the CREDIT column — it increases what is owed",
              eq(dn_rows[0].get("credit"), dn_total) and eq(dn_rows[0].get("debit"), 0),
              f"credit={dn_rows[0].get('credit')} debit={dn_rows[0].get('debit')} total={dn_total}")
        check(suite, "debit note reference is DN-prefixed",
              str(dn_rows[0].get("reference", "")).startswith("DN-"),
              f"reference={dn_rows[0].get('reference')}")
    check(suite, "note kinds are not swapped: closing back to 0 after CN + DN of equal value",
          eq(s.get("closingBalance"), dn_total - cn_total), f"got {s.get('closingBalance')}")


# ── Suite 4: unallocated cash ──────────────────────────────────────
def suite_4_unallocated_cash(base, token, cid, client_id, item_type_id):
    """An 800,000 receipt settling a 500,000 invoice must show ONCE, at 800,000."""
    suite = "4. Unallocated cash"
    print(f"\n=== {suite} ===")

    inv = make_invoice(base, token, cid, client_id, item_type_id, 500000)
    if not check(suite, "500,000 invoice created", inv is not None, "create failed"):
        return
    st, r = make_receipt(base, token, cid, client_id, 800000,
                         allocations=[{"invoiceId": inv["id"], "amount": 500000}])
    if not check(suite, "800,000 receipt allocating 500,000 accepted",
                 st in (200, 201), f"got {st} {err_of(r)}"):
        return
    check(suite, "receipt reports 300,000 unallocated",
          eq(r.get("unallocatedAmount"), 300000), f"got {r.get('unallocatedAmount')}")

    s = statement(base, token, client_id)
    if not check(suite, "statement loads", s is not None, "statement request failed"):
        return
    rec = rows_of(s, "Receipt")
    check(suite, "exactly ONE receipt row (not one per allocation)", len(rec) == 1,
          f"rows={[(x.get('reference'), x.get('debit')) for x in rec]}")
    if rec:
        check(suite, "it carries the FULL 800,000, so the advance is visible",
              eq(rec[0].get("debit"), 800000), f"got {rec[0].get('debit')}")
    check(suite, "closing balance is -300,000 (the advance)",
          eq(s.get("closingBalance"), -300000), f"got {s.get('closingBalance')}")

    after = get_invoice(base, token, inv["id"])
    check(suite, "invoice amountPaid still 500,000 — the ledger did not change settlement",
          eq(after.get("amountPaid"), 500000), f"got {after.get('amountPaid')}")


# ── Suite 5: scope and exclusions ──────────────────────────────────
def suite_5_scope(base, token, cid, client_id, other_client_id, item_type_id, foreign):
    """One client's documents must never leak into another's, in this company
       or any other, and a deleted receipt must drop out of the trail."""
    suite = "5. Scope and exclusions"
    print(f"\n=== {suite} ===")

    mine = make_invoice(base, token, cid, client_id, item_type_id, 111000)
    theirs = make_invoice(base, token, cid, other_client_id, item_type_id, 222000)
    if not check(suite, "one invoice for each of two clients in the same company",
                 mine is not None and theirs is not None, "create failed"):
        return

    a = statement(base, token, client_id)
    b = statement(base, token, other_client_id)
    if not check(suite, "both statements load", a is not None and b is not None, "request failed"):
        return
    check(suite, "client A sees only its own 111,000", eq(a.get("closingBalance"), 111000),
          f"got {a.get('closingBalance')}")
    check(suite, "client B sees only its own 222,000", eq(b.get("closingBalance"), 222000),
          f"got {b.get('closingBalance')}")
    refs_a = {e.get("reference") for e in (a.get("entries") or [])}
    refs_b = {e.get("reference") for e in (b.get("entries") or [])}
    check(suite, "the two trails share no reference", not (refs_a & refs_b),
          f"overlap={refs_a & refs_b}")

    # A different tenant's client, with its own money, stays entirely separate.
    f_inv = make_invoice(base, token, foreign["company_id"], foreign["client_id"],
                         foreign["item_type_id"], 999000)
    check(suite, "foreign tenant's 999,000 invoice created", f_inv is not None, "create failed")
    a2 = statement(base, token, client_id)
    check(suite, "client A's balance is unmoved by the other tenant's document",
          a2 is not None and eq(a2.get("closingBalance"), 111000),
          f"got {a2.get('closingBalance') if a2 else None}")
    f = statement(base, token, foreign["client_id"])
    check(suite, "the foreign client's own trail is exactly its 999,000",
          f is not None and eq(f.get("closingBalance"), 999000),
          f"got {f.get('closingBalance') if f else None}")

    # A receipt that no longer exists must not be counted.
    st, r = make_receipt(base, token, cid, client_id, 11000,
                         allocations=[{"invoiceId": mine["id"], "amount": 11000}])
    if not check(suite, "11,000 receipt created", st in (200, 201), f"got {st} {err_of(r)}"):
        return
    mid = statement(base, token, client_id)
    check(suite, "balance drops to 100,000 while the receipt exists",
          mid is not None and eq(mid.get("closingBalance"), 100000),
          f"got {mid.get('closingBalance') if mid else None}")
    dst, dbody = http("DELETE", f"/api/payments/receipts/{r['id']}", base, token=token)
    check(suite, "receipt deleted", dst in (200, 204), f"got {dst} {err_of(dbody)}")
    end = statement(base, token, client_id)
    check(suite, "the deleted receipt is gone from the trail (back to 111,000)",
          end is not None and eq(end.get("closingBalance"), 111000),
          f"got {end.get('closingBalance') if end else None}")
    check(suite, "no Receipt row survives the delete",
          end is not None and len(rows_of(end, "Receipt")) == 0,
          f"rows={[e.get('reference') for e in rows_of(end, 'Receipt')] if end else None}")


# ── Suite 6: plain A/R agreement ───────────────────────────────────
def suite_6_plain_ar(base, token, cid, client_id, item_type_id):
    """With no advance, note or write-off in play the ledger's closing balance
       is the customer's A/R figure exactly."""
    suite = "6. Plain A/R agreement"
    print(f"\n=== {suite} ===")

    inv = make_invoice(base, token, cid, client_id, item_type_id, 100000)
    if not check(suite, "100,000 invoice created", inv is not None, "create failed"):
        return
    st, r = make_receipt(base, token, cid, client_id, 40000,
                         allocations=[{"invoiceId": inv["id"], "amount": 40000}])
    if not check(suite, "40,000 part payment accepted", st in (200, 201), f"got {st} {err_of(r)}"):
        return

    after = get_invoice(base, token, inv["id"])
    s = statement(base, token, client_id)
    if not check(suite, "statement loads", s is not None, "statement request failed"):
        return
    check(suite, "closing balance 60,000 == invoice balanceDue",
          eq(s.get("closingBalance"), 60000) and eq(s.get("closingBalance"), after.get("balanceDue")),
          f"ledger={s.get('closingBalance')} balanceDue={after.get('balanceDue')}")
    check(suite, "a positive balance means the customer owes",
          float(s.get("closingBalance") or 0) > 0, f"got {s.get('closingBalance')}")
    check(suite, "entries are returned newest-first",
          len(s["_chrono"]) == 2 and s["_chrono"][0].get("type") == "Invoice"
          and s["_chrono"][-1].get("type") == "Receipt",
          f"chronological types={[e.get('type') for e in s['_chrono']]}")


# ── Suite 7: cash from a receipt naming another contact ────────────
def suite_7_foreign_contact_cash(base, token, cid, client_id, item_type_id, disc_acct):
    """PaymentService only checks that an allocation's invoice shares the
       COMPANY — never the contact — so a receipt whose contact is "Other" can
       settle client X's invoice. X's AmountPaid rises, so X's ledger MUST show
       that money or the closing balance stops agreeing with BalanceDue. The
       old allocation-sourced statement did capture it; dropping it would be a
       regression."""
    suite = "7. Cash from another contact"
    print(f"\n=== {suite} ===")

    inv = make_invoice(base, token, cid, client_id, item_type_id, 400000)
    if not check(suite, "400,000 invoice created", inv is not None, "create failed"):
        return

    st, r = make_receipt(base, token, cid, client_id, 400000, contact_type="Other",
                         allocations=[{"invoiceId": inv["id"], "amount": 400000}])
    if not check(suite, "'Other'-contact receipt settling the invoice accepted",
                 st in (200, 201), f"got {st} {err_of(r)}"):
        return

    after = get_invoice(base, token, inv["id"])
    check(suite, "the invoice really was settled by it (amountPaid 400,000)",
          eq(after.get("amountPaid"), 400000) and eq(after.get("balanceDue"), 0),
          f"amountPaid={after.get('amountPaid')} balanceDue={after.get('balanceDue')}")

    s = statement(base, token, client_id)
    if not check(suite, "statement loads", s is not None, "statement request failed"):
        return
    rec = rows_of(s, "Receipt")
    check(suite, "the money appears on this customer's trail", len(rec) == 1,
          f"rows={[(x.get('reference'), x.get('debit')) for x in rec]}")
    if rec:
        check(suite, "it is the allocated 400,000, in the DEBIT column",
              eq(rec[0].get("debit"), 400000) and eq(rec[0].get("credit"), 0),
              f"debit={rec[0].get('debit')} credit={rec[0].get('credit')}")
    check(suite, "closing balance 0 == invoice balanceDue (no phantom receivable)",
          eq(s.get("closingBalance"), 0) and eq(s.get("closingBalance"), after.get("balanceDue")),
          f"ledger={s.get('closingBalance')} balanceDue={after.get('balanceDue')}")

    # De-duplication: a NORMAL receipt (contact = this client, allocated to this
    # client's own invoice) is reachable from both sources and must be counted
    # exactly once — at its full amount, not once per allocation.
    inv2 = make_invoice(base, token, cid, client_id, item_type_id, 100000)
    if not check(suite, "second 100,000 invoice created", inv2 is not None, "create failed"):
        return
    st, r2 = make_receipt(base, token, cid, client_id, 150000,
                          allocations=[{"invoiceId": inv2["id"], "amount": 100000}])
    if not check(suite, "150,000 own-contact receipt allocating 100,000 accepted",
                 st in (200, 201), f"got {st} {err_of(r2)}"):
        return
    s2 = statement(base, token, client_id)
    rec2 = rows_of(s2, "Receipt")
    check(suite, "still one row per receipt — the own-contact one is NOT double counted",
          len(rec2) == 2, f"rows={[(x.get('reference'), x.get('debit')) for x in rec2]}")
    check(suite, "own-contact receipt shows its FULL 150,000 exactly once",
          len([x for x in rec2 if eq(x.get("debit"), 150000)]) == 1,
          f"rows={[(x.get('reference'), x.get('debit')) for x in rec2]}")
    check(suite, "closing balance -50,000 (the 50,000 advance), not -150,000",
          eq(s2.get("closingBalance"), -50000), f"got {s2.get('closingBalance')}")

    # And the write-off slice still rides alongside, never inside, the cash.
    if disc_acct is not None:
        inv3 = make_invoice(base, token, cid, client_id, item_type_id, 60000)
        st, r3 = make_receipt(base, token, cid, client_id, 50000, contact_type="Other",
                              allocations=[{"invoiceId": inv3["id"], "amount": 50000,
                                            "adjustmentAmount": 10000,
                                            "adjustmentAccountId": disc_acct}])
        if check(suite, "'Other' receipt with a 10,000 write-off accepted",
                 st in (200, 201), f"got {st} {err_of(r3)}"):
            s3 = statement(base, token, client_id)
            adj = rows_of(s3, "Adjustment")
            check(suite, "its adjustment row is present exactly once",
                  len(adj) == 1 and eq(adj[0].get("debit"), 10000),
                  f"rows={[(a.get('reference'), a.get('debit')) for a in adj]}")
            check(suite, "closing still -50,000 — the 60,000 bill is fully cleared",
                  eq(s3.get("closingBalance"), -50000), f"got {s3.get('closingBalance')}")


# ── Suite 8: an income line on a customer's receipt ────────────────
def suite_8_income_line(base, token, cid, client_id, item_type_id, income_acct):
    """A receipt naming a Client may carry an AllocationKind.Account line — a
       cash sale, or any income booked straight to a GL account. That cash
       NEVER touches the customer's Accounts receivable: PostingService sends
       it to the account the operator picked (Cr Other income), and the A/R
       column on the Customers screen (ClientService.GetSummaryAsync, via
       Helpers.PartyOnAccount) correctly reports 0 for it.

       So the ledger must not debit it either. Debiting the raw Payment.Amount
       makes two authenticated screens show one customer two different numbers:
       the ledger invents an advance the customer does not hold and understates
       what they owe by the whole cash-sale amount.

       Pinned on BOTH ledger surfaces — the drill-down and the aggregate row —
       because they carry the rule separately and a row that disagrees with the
       panel it expands into is the same defect seen from the other side."""
    suite = "8. Income line on a client receipt"
    print(f"\n=== {suite} ===")

    if income_acct is None:
        check(suite, "an income account exists in the seeded chart", False,
              "no 'Other income' account found")
        return

    inv = make_invoice(base, token, cid, client_id, item_type_id, 100000)
    if not check(suite, "100,000 invoice created", inv is not None, "create failed"):
        return

    # 50,000 cash sale recorded against this customer, booked to income.
    st, r = make_receipt(base, token, cid, client_id, 50000,
                         allocations=[{"kind": "Account", "accountId": income_acct,
                                       "amount": 50000}])
    if not check(suite, "50,000 cash-sale receipt with an income line accepted",
                 st in (200, 201), f"got {st} {err_of(r)}"):
        return
    lines = (r or {}).get("allocations") or []
    check(suite, "it really is the Account shape — one income line of 50,000",
          len(lines) == 1 and lines[0].get("kind") == "Account"
          and eq(lines[0].get("amount"), 50000), f"got {lines}")

    # The invoice is untouched: an income line settles no document.
    after = get_invoice(base, token, inv["id"])
    check(suite, "the invoice is untouched — balanceDue still 100,000",
          eq(after.get("balanceDue"), 100000), f"got {after.get('balanceDue')}")

    # The Customers screen — the reference figure the ledger has to agree with.
    st_sum, rows = http("GET", f"/api/clients/company/{cid}/summary", base, token=token)
    ar_row = next((x for x in (rows or []) if x.get("clientId") == client_id), None) \
        if st_sum == 200 and isinstance(rows, list) else None
    if not check(suite, "the Customers-screen A/R row loads", ar_row is not None,
                 f"got {st_sum}"):
        return
    ar = float(ar_row.get("accountsReceivable") or 0)
    check(suite, "A/R column charges the customer 100,000 — the income line is not their money",
          eq(ar, 100000), f"got {ar}")

    # The drill-down — CustomerLedgerService.BuildEntriesAsync.
    st_led, led = http("GET",
                       f"/api/customer-ledger/company/{cid}/client/{client_id}?pageSize=200",
                       base, token=token)
    if not check(suite, "the customer's ledger loads", st_led == 200 and isinstance(led, dict),
                 f"got {st_led} {led}"):
        return
    check(suite, "ledger closing agrees with the A/R column",
          eq(led.get("closingBalance"), ar),
          f"ledger={led.get('closingBalance')} A/R column={ar}")
    check(suite, "ledger closing is 100,000 — no phantom 50,000 advance",
          eq(led.get("closingBalance"), 100000), f"got {led.get('closingBalance')}")
    check(suite, "the customer is not shown as holding an advance",
          eq(led.get("advance"), 0), f"got advance={led.get('advance')}")
    rcp = [e for e in (led.get("entries") or []) if e.get("type") == "Receipt"]
    check(suite, "the receipt row debits 0 — none of that cash reduced what they owe",
          len(rcp) == 1 and eq(rcp[0].get("debit"), 0),
          f"rows={[(x.get('reference'), x.get('debit')) for x in rcp]}")

    # And the same figure through ClientService.GetStatementAsync, the tab the
    # client-detail modal renders.
    s = statement(base, token, client_id)
    check(suite, "the client-detail statement agrees too",
          s is not None and eq(s.get("closingBalance"), 100000),
          f"got {None if s is None else s.get('closingBalance')}")

    # The aggregate row must say the same thing as the panel it expands into —
    # GetAllCustomersAsync carries the rule separately from BuildEntriesAsync.
    st_agg, agg = http("GET", f"/api/customer-ledger/company/{cid}", base, token=token)
    rows_agg = agg if st_agg == 200 and isinstance(agg, list) else []
    row = next((x for x in rows_agg if x.get("clientId") == client_id), None)
    if not check(suite, "the aggregate ledger row loads", row is not None, f"got {st_agg}"):
        return
    check(suite, "the aggregate row closing matches the drill-down and the A/R column",
          eq(row.get("closing"), 100000) and eq(row.get("closing"), ar),
          f"row={row.get('closing')} drilldown={led.get('closingBalance')} A/R={ar}")
    check(suite, "the aggregate 'received' column excludes the income line",
          eq(row.get("received"), 0), f"got {row.get('received')}")


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


def first_item_type(base, token):
    _, its = http("GET", "/api/itemtypes", base, token=token)
    rows = its if isinstance(its, list) else ((its or {}).get("items") or (its or {}).get("data") or [])
    return rows[0]["id"] if rows else None


def setup(base, user, pw):
    st, data = http("POST", "/api/auth/login", base, body={"username": user, "password": pw})
    if st != 200:
        print(f"FATAL: login failed ({st} {data})")
        sys.exit(2)
    token = data["token"]
    sfx = datetime.now().strftime("%Y%m%d%H%M%S")

    cid = make_company(base, token, f"_test_customer_ledger {sfx}")
    # One client per suite so the balances stay independent and readable.
    clients = {k: make_client(base, token, cid, f"Ledger {k} {sfx}")
               for k in ("scenario", "discount", "notes", "advance",
                         "scopeA", "scopeB", "plain", "foreigncontact", "cashsale")}

    other_cid = make_company(base, token, f"_test_customer_ledger_other {sfx}", gl=False)
    foreign = {
        "company_id": other_cid,
        "client_id": make_client(base, token, other_cid, f"Foreign Client {sfx}"),
        "item_type_id": first_item_type(base, token),
    }
    return token, cid, clients, first_item_type(base, token), foreign


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
    for s, n, ok, r in results:
        if not ok:
            print(f"FAILED  {s} :: {n}   [{r}]")
    print(f"{passed}/{total} checks passed")
    return 0 if passed == total else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", default="http://localhost:5134")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw", default="admin123")
    p.add_argument("--keep", action="store_true",
                   help="Leave the ephemeral companies in the DB after the run.")
    args = p.parse_args()
    base = args.base

    token, cid, clients, item_type_id, foreign = setup(base, args.admin_user, args.admin_pw)

    st, flat = http("GET", f"/api/accounts/company/{cid}/flat", base, token=token)
    flat = flat if st == 200 and isinstance(flat, list) else []
    disc = next((a["id"] for a in flat if a.get("controlType") == "DiscountAllowed"), None)
    income = next((a["id"] for a in flat
                   if (a.get("name") or "").strip().lower() == "other income"), None)
    print(f"\n== company={cid} itemType={item_type_id} discountAccount={disc} "
          f"incomeAccount={income} clients={clients} foreign={foreign} ==")

    try:
        suite_1_client_scenario(base, token, cid, clients["scenario"], item_type_id)
        suite_2_settle_remainder(base, token, cid, clients["discount"], item_type_id, disc)
        suite_3_notes(base, token, cid, clients["notes"], item_type_id)
        suite_4_unallocated_cash(base, token, cid, clients["advance"], item_type_id)
        suite_5_scope(base, token, cid, clients["scopeA"], clients["scopeB"], item_type_id, foreign)
        suite_6_plain_ar(base, token, cid, clients["plain"], item_type_id)
        suite_7_foreign_contact_cash(base, token, cid, clients["foreigncontact"],
                                     item_type_id, disc)
        suite_8_income_line(base, token, cid, clients["cashsale"], item_type_id, income)
    finally:
        teardown(base, token, [cid, foreign["company_id"]], args.keep)

    return report()


if __name__ == "__main__":
    sys.exit(main())
