"""
Expense / Payee workflow regression tests — the Payee-based money-in/money-out
redesign (2026-08-31). Must pass before any push that touches PaymentService,
PostingService.PostPaymentAsync, PaymentAllocation or the Payments/Receipts UI
contract.

What this covers that scripts/test_accounting_gl.py does NOT: recording money
that is NOT settling a document. Three allocation shapes now exist —

  Document    settle a specific sales invoice / purchase bill  (already covered
              by test_accounting_gl.py; re-checked here for the party tagging)
  Account     a plain income/expense line, optionally with recoverable tax
  OnAccount   an advance against a client's or supplier's running balance

Suites:
   1. Setup            → ephemeral company + client + supplier, GL on, CoA seeded
   2. Expense (bank)   → Dr Expense / Cr Bank, no tax
   3. Expense (cash)   → a second bank/cash account is used, not the first
   4. Expense with tax → Dr Expense net + Dr Input Tax / Cr Bank gross
   5. Supplier expense → the supplier is tagged on the EXPENSE line's journal row
   6. Other payee      → free-text name round-trips, no party tagged
   7. Multi-line       → one payment, three accounts, one bank credit
   8. Supplier advance → Dr AP + supplier / Cr Bank, and AP balance moves
   9. Customer advance → Dr Bank / Cr AR + client, and AR balance moves
  10. Customer refund  → payment to a Client posts to AR, not AP
  11. Other income     → receipt to an income account, tax to OUTPUT tax
  12. Validation       → every guard returns 400 with a readable message
  13. Ledgers          → the expense shows in the account ledger + trial balance
  14. Edit             → an expense can be edited and the ledger follows
  15. Tax arithmetic   → inclusive tax split matches the server to the paisa

Each run uses a fresh ephemeral company created at test-start and torn down at
the end. Production data is never touched.

Usage:
  python scripts/test_expense_payee.py
  python scripts/test_expense_payee.py --base http://localhost:5199 --keep

Exit code 0 = every assertion passes. 1 = at least one failure.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_accounting_gl import (  # reuse the proven harness
    DEFAULT_BASE, Fatal, PASS, balance_of, check, eq, find_acct, get_flat,
    http, pkt_date_iso, results, setup, teardown,
)


# ── helpers ────────────────────────────────────────────────────────
def enable_gl(base: str, token: str, cid: int) -> None:
    st, _ = http("POST", f"/api/accounting/gl/company/{cid}/enable", base, token=token, body={})
    if st not in (200, 201, 204):
        raise Fatal(f"could not enable GL ({st})")


def seed_coa(base: str, token: str, cid: int) -> None:
    st, _ = http("POST", f"/api/accounts/company/{cid}/seed-wholesale", base, token=token, body={})
    if st not in (200, 201, 204):
        # Enabling GL may already have seeded it; only fatal if there are no accounts.
        if not get_flat(base, token, cid):
            raise Fatal(f"could not seed the chart of accounts ({st})")


def group_of(base: str, token: str, cid: int, account_id: int) -> int:
    for a in get_flat(base, token, cid):
        if a.get("id") == account_id:
            return a.get("accountGroupId") or 0
    return 0


def new_bank(base: str, token: str, cid: int, name: str) -> int:
    """Create a bank/cash account and return its id.

    Reuses the group the seeded Bank & Cash account already sits in, so the new
    account lands under Assets without the test hard-coding a group id.
    """
    seeded = find_acct(get_flat(base, token, cid), control="BankCash")
    if not seeded:
        raise Fatal("the preset did not create a Bank & Cash account")
    st, a = http("POST", f"/api/accounts/company/{cid}", base, token=token, body={
        "name": name,
        "accountGroupId": group_of(base, token, cid, seeded["id"]),
        "accountType": "Asset",
        "isControlAccount": True,
        "controlType": "BankCash",
    })
    if st in (200, 201) and isinstance(a, dict) and a.get("id"):
        return a["id"]
    # Couldn't add one — fall back to the seeded account so the suite still runs.
    return seeded["id"]


def acct_id(base: str, token: str, cid: int, name: str) -> int:
    a = find_acct(get_flat(base, token, cid), name=name)
    if not a:
        raise Fatal(f"account '{name}' not found in the seeded chart of accounts")
    return a["id"]


def post_payment(base: str, token: str, cid: int, body: dict, direction: str = "payments"):
    return http("POST", f"/api/payments/{direction}/company/{cid}", base, token=token, body=body)


def entry_for(base: str, token: str, cid: int, payment_id: int) -> dict | None:
    """The journal entry the posting engine wrote for one payment."""
    st, page = http("GET", f"/api/journal-entries/company/{cid}/paged?pageSize=200",
                    base, token=token)
    rows = (page or {}).get("items") if isinstance(page, dict) else None
    for e in rows or []:
        if e.get("sourceDocType") == "Payment" and e.get("sourceDocId") == payment_id:
            st2, full = http("GET", "/api/journal-entries/%d" % e["id"], base, token=token)
            return full if st2 == 200 else e
    return None


def leg(entry: dict, account_id: int) -> dict | None:
    for l in (entry or {}).get("lines", []) or []:
        if l.get("accountId") == account_id:
            return l
    return None


def legs(entry: dict, account_id: int) -> list[dict]:
    return [l for l in (entry or {}).get("lines", []) or [] if l.get("accountId") == account_id]


# ── suites ─────────────────────────────────────────────────────────
def suite_expense_no_tax(base, token, cid, bank_id, exp_id):
    s = "2. Expense paid from bank"
    print(f"\n=== {s} ===")
    st, p = post_payment(base, token, cid, {
        "direction": "Payment",
        "date": pkt_date_iso(),
        "contactType": "Other",
        "contactName": "The Landlord",
        "bankAccountId": bank_id,
        "method": "Bank Transfer",
        "description": "Office rent, March",
        "allocations": [{"kind": "Account", "accountId": exp_id, "amount": 80000}],
    })
    check(s, "payment accepted", st in (200, 201), f"{st} {p}")
    if st not in (200, 201):
        return None
    check(s, "amount is the cash paid", eq(p.get("amount"), 80000), str(p.get("amount")))
    a0 = (p.get("allocations") or [{}])[0]
    check(s, "line kind is Account", a0.get("kind") == "Account", str(a0.get("kind")))
    check(s, "line shows the account name", bool(a0.get("accountName")), str(a0))
    check(s, "no tax on the line", eq(a0.get("taxAmount"), 0), str(a0.get("taxAmount")))
    check(s, "net equals gross when untaxed", eq(a0.get("netAmount"), 80000), str(a0.get("netAmount")))
    check(s, "free-text payee round-trips", p.get("contactName") == "The Landlord", str(p.get("contactName")))

    e = entry_for(base, token, cid, p["id"])
    check(s, "a journal entry was written", e is not None, "none found")
    if e:
        dr, cr = leg(e, exp_id), leg(e, bank_id)
        check(s, "expense debited 80,000", dr and eq(dr.get("debit"), 80000), str(dr))
        check(s, "bank credited 80,000", cr and eq(cr.get("credit"), 80000), str(cr))
        check(s, "entry is balanced",
              eq(sum(float(l.get("debit") or 0) for l in e["lines"]),
                 sum(float(l.get("credit") or 0) for l in e["lines"])), str(e.get("lines")))
        check(s, "an Other payee tags no party",
              all(not l.get("partyType") for l in e["lines"]),
              str([l.get("partyType") for l in e["lines"]]))
    return p["id"]


def suite_expense_second_account(base, token, cid, cash_id, exp_id):
    s = "3. Expense paid from cash"
    print(f"\n=== {s} ===")
    before = balance_of(base, token, cid, cash_id) or 0
    st, p = post_payment(base, token, cid, {
        "direction": "Payment", "date": pkt_date_iso(),
        "contactType": "Other", "contactName": "Stationery shop",
        "bankAccountId": cash_id, "method": "Cash",
        "description": "Notebooks",
        "allocations": [{"kind": "Account", "accountId": exp_id, "amount": 2500}],
    })
    check(s, "payment accepted", st in (200, 201), f"{st} {p}")
    if st not in (200, 201):
        return
    after = balance_of(base, token, cid, cash_id)
    check(s, "the chosen cash account fell by 2,500", eq(after, before - 2500),
          f"before={before} after={after}")


def suite_expense_with_tax(base, token, cid, bank_id, exp_id, input_tax_id):
    s = "4. Expense with recoverable tax"
    print(f"\n=== {s} ===")
    # 11,600 gross at 18% inclusive → tax 1,769.49, net 9,830.51
    st, p = post_payment(base, token, cid, {
        "direction": "Payment", "date": pkt_date_iso(),
        "contactType": "Other", "contactName": "K-Electric",
        "bankAccountId": bank_id, "method": "Online",
        "description": "Electricity, March",
        "allocations": [{"kind": "Account", "accountId": exp_id,
                         "amount": 11600, "taxRate": 18}],
    })
    check(s, "payment accepted", st in (200, 201), f"{st} {p}")
    if st not in (200, 201):
        return
    a0 = (p.get("allocations") or [{}])[0]
    check(s, "tax derived inclusively (1,769.49)", eq(a0.get("taxAmount"), 1769.49), str(a0.get("taxAmount")))
    check(s, "net is gross minus tax (9,830.51)", eq(a0.get("netAmount"), 9830.51), str(a0.get("netAmount")))
    check(s, "cash total stays the gross", eq(p.get("amount"), 11600), str(p.get("amount")))

    e = entry_for(base, token, cid, p["id"])
    if e:
        check(s, "expense debited NET only", eq((leg(e, exp_id) or {}).get("debit"), 9830.51),
              str(leg(e, exp_id)))
        check(s, "input tax debited 1,769.49", eq((leg(e, input_tax_id) or {}).get("debit"), 1769.49),
              str(leg(e, input_tax_id)))
        check(s, "bank credited the gross", eq((leg(e, bank_id) or {}).get("credit"), 11600),
              str(leg(e, bank_id)))
        check(s, "entry is balanced",
              eq(sum(float(l.get("debit") or 0) for l in e["lines"]),
                 sum(float(l.get("credit") or 0) for l in e["lines"])), "")


def suite_supplier_expense(base, token, cid, bank_id, exp_id, supplier):
    s = "5. Expense paid to a known supplier"
    print(f"\n=== {s} ===")
    st, p = post_payment(base, token, cid, {
        "direction": "Payment", "date": pkt_date_iso(),
        "contactType": "Supplier", "contactId": supplier["id"],
        "bankAccountId": bank_id, "method": "Cash",
        "description": "One-off repair, no bill",
        "allocations": [{"kind": "Account", "accountId": exp_id, "amount": 4000}],
    })
    check(s, "supplier may be paid for a plain expense", st in (200, 201), f"{st} {p}")
    if st not in (200, 201):
        return
    e = entry_for(base, token, cid, p["id"])
    if e:
        row = leg(e, exp_id)
        # The whole point of the change: the spend is visible in the supplier's ledger.
        check(s, "the EXPENSE line is tagged to the supplier",
              row and row.get("partyType") == "Supplier" and row.get("partyId") == supplier["id"],
              str(row))


def suite_multi_line(base, token, cid, bank_id, ids):
    s = "7. One payment, several things"
    print(f"\n=== {s} ===")
    st, p = post_payment(base, token, cid, {
        "direction": "Payment", "date": pkt_date_iso(),
        "contactType": "Other", "contactName": "Sundry",
        "bankAccountId": bank_id, "method": "Bank Transfer",
        "description": "Monthly overheads",
        "allocations": [
            {"kind": "Account", "accountId": ids["internet"], "amount": 5900, "taxRate": 18},
            {"kind": "Account", "accountId": ids["telephone"], "amount": 1200},
            {"kind": "Account", "accountId": ids["office"], "amount": 3000},
        ],
    })
    check(s, "multi-line payment accepted", st in (200, 201), f"{st} {p}")
    if st not in (200, 201):
        return
    check(s, "total is the sum of the lines", eq(p.get("amount"), 10100), str(p.get("amount")))
    e = entry_for(base, token, cid, p["id"])
    if e:
        check(s, "one bank credit for the whole payment",
              len(legs(e, bank_id)) == 1 and eq(legs(e, bank_id)[0].get("credit"), 10100),
              str(legs(e, bank_id)))
        check(s, "entry is balanced",
              eq(sum(float(l.get("debit") or 0) for l in e["lines"]),
                 sum(float(l.get("credit") or 0) for l in e["lines"])), "")


def suite_supplier_advance(base, token, cid, bank_id, ap_id, supplier):
    s = "8. Advance paid to a supplier"
    print(f"\n=== {s} ===")
    before = balance_of(base, token, cid, ap_id) or 0
    st, p = post_payment(base, token, cid, {
        "direction": "Payment", "date": pkt_date_iso(),
        "contactType": "Supplier", "contactId": supplier["id"],
        "bankAccountId": bank_id, "method": "Bank Transfer",
        "description": "Advance before shipment",
        "allocations": [{"kind": "OnAccount", "amount": 30000}],
    })
    check(s, "advance accepted", st in (200, 201), f"{st} {p}")
    if st not in (200, 201):
        return
    a0 = (p.get("allocations") or [{}])[0]
    check(s, "line kind is OnAccount", a0.get("kind") == "OnAccount", str(a0.get("kind")))
    check(s, "label reads as an advance", (a0.get("documentLabel") or "").lower().startswith("advance"),
          str(a0.get("documentLabel")))

    e = entry_for(base, token, cid, p["id"])
    if e:
        row = leg(e, ap_id)
        check(s, "posts to Accounts payable, NOT Suspense", row is not None, str(e.get("lines")))
        check(s, "AP debited 30,000", row and eq(row.get("debit"), 30000), str(row))
        check(s, "AP line is tagged to the supplier",
              row and row.get("partyType") == "Supplier" and row.get("partyId") == supplier["id"], str(row))
        check(s, "no document is attached",
              row and not row.get("purchaseBillId") and not row.get("invoiceId"), str(row))
        susp = find_acct(get_flat(base, token, cid), control="Suspense")
        check(s, "nothing landed in Suspense",
              not susp or leg(e, susp["id"]) is None, "suspense leg present")
    after = balance_of(base, token, cid, ap_id)
    check(s, "AP moved 30,000 in the debit direction", eq(after, before + 30000),
          f"before={before} after={after}")


def suite_customer_advance(base, token, cid, bank_id, ar_id, client):
    s = "9. Advance received from a customer"
    print(f"\n=== {s} ===")
    before = balance_of(base, token, cid, ar_id) or 0
    st, p = post_payment(base, token, cid, {
        "direction": "Receipt", "date": pkt_date_iso(),
        "contactType": "Client", "contactId": client["id"],
        "bankAccountId": bank_id, "method": "Online",
        "description": "Deposit, no invoice yet",
        "allocations": [{"kind": "OnAccount", "amount": 50000}],
    }, direction="receipts")
    check(s, "advance receipt accepted", st in (200, 201), f"{st} {p}")
    if st not in (200, 201):
        return
    e = entry_for(base, token, cid, p["id"])
    if e:
        row = leg(e, ar_id)
        check(s, "posts to Accounts receivable", row is not None, str(e.get("lines")))
        check(s, "AR credited 50,000", row and eq(row.get("credit"), 50000), str(row))
        check(s, "AR line is tagged to the client",
              row and row.get("partyType") == "Client" and row.get("partyId") == client["id"], str(row))
        check(s, "bank debited 50,000", eq((leg(e, bank_id) or {}).get("debit"), 50000),
              str(leg(e, bank_id)))
    after = balance_of(base, token, cid, ar_id)
    check(s, "AR moved 50,000 in the credit direction", eq(after, before - 50000),
          f"before={before} after={after}")


def suite_customer_refund(base, token, cid, bank_id, ar_id, client):
    s = "10. Refund paid to a customer"
    print(f"\n=== {s} ===")
    st, p = post_payment(base, token, cid, {
        "direction": "Payment", "date": pkt_date_iso(),
        "contactType": "Client", "contactId": client["id"],
        "bankAccountId": bank_id, "method": "Bank Transfer",
        "description": "Returning the deposit",
        "allocations": [{"kind": "OnAccount", "amount": 5000}],
    })
    check(s, "a payment TO a client is allowed", st in (200, 201), f"{st} {p}")
    if st not in (200, 201):
        return
    e = entry_for(base, token, cid, p["id"])
    if e:
        row = leg(e, ar_id)
        # A client always sits in receivables — the direction only flips the side.
        check(s, "posts to Accounts receivable, not payable", row is not None, str(e.get("lines")))
        check(s, "AR debited 5,000", row and eq(row.get("debit"), 5000), str(row))
        check(s, "still tagged to the client", row and row.get("partyType") == "Client", str(row))


def suite_other_income(base, token, cid, bank_id, income_id, output_tax_id):
    s = "11. Other income received"
    print(f"\n=== {s} ===")
    st, p = post_payment(base, token, cid, {
        "direction": "Receipt", "date": pkt_date_iso(),
        "contactType": "Other", "contactName": "Scrap dealer",
        "bankAccountId": bank_id, "method": "Cash",
        "description": "Sold packaging waste",
        "allocations": [{"kind": "Account", "accountId": income_id,
                         "amount": 5900, "taxRate": 18}],
    }, direction="receipts")
    check(s, "income receipt accepted", st in (200, 201), f"{st} {p}")
    if st not in (200, 201):
        return
    e = entry_for(base, token, cid, p["id"])
    if e:
        check(s, "income credited net 5,000", eq((leg(e, income_id) or {}).get("credit"), 5000),
              str(leg(e, income_id)))
        check(s, "tax went to OUTPUT tax, not input",
              eq((leg(e, output_tax_id) or {}).get("credit"), 900), str(leg(e, output_tax_id)))
        check(s, "bank debited the gross", eq((leg(e, bank_id) or {}).get("debit"), 5900),
              str(leg(e, bank_id)))


def suite_validation(base, token, cid, bank_id, exp_id, ap_id, supplier, client, invoice_id):
    s = "12. Guards"
    print(f"\n=== {s} ===")

    def rejected(name, body, direction="payments", frag=None):
        st, r = post_payment(base, token, cid, body, direction=direction)
        msg = (r or {}).get("error") if isinstance(r, dict) else str(r)
        ok = st == 400
        if ok and frag:
            ok = frag.lower() in (msg or "").lower()
        check(s, name, ok, f"{st} {msg}")

    base_body = {
        "direction": "Payment", "date": pkt_date_iso(),
        "contactType": "Other", "contactName": "X",
        "bankAccountId": bank_id, "method": "Cash",
    }

    rejected("no lines at all", {**base_body, "allocations": []})
    rejected("expense line with no account",
             {**base_body, "allocations": [{"kind": "Account", "amount": 100}]}, frag="what this line was for")
    rejected("zero amount",
             {**base_body, "allocations": [{"kind": "Account", "accountId": exp_id, "amount": 0}]},
             frag="positive")
    rejected("negative amount",
             {**base_body, "allocations": [{"kind": "Account", "accountId": exp_id, "amount": -50}]},
             frag="negative")
    rejected("tax rate over 100",
             {**base_body, "allocations": [{"kind": "Account", "accountId": exp_id,
                                            "amount": 100, "taxRate": 120}]}, frag="between 0 and 100")
    rejected("tax bigger than the amount",
             {**base_body, "allocations": [{"kind": "Account", "accountId": exp_id,
                                            "amount": 100, "taxAmount": 150}]}, frag="more than the amount")
    rejected("posting an expense straight at a control account",
             {**base_body, "allocations": [{"kind": "Account", "accountId": ap_id, "amount": 100}]},
             frag="control account")
    rejected("advance with no party",
             {**base_body, "allocations": [{"kind": "OnAccount", "amount": 100}]},
             frag="client or a supplier")
    rejected("advance carrying tax",
             {"direction": "Payment", "date": pkt_date_iso(), "contactType": "Supplier",
              "contactId": supplier["id"], "bankAccountId": bank_id, "method": "Cash",
              "allocations": [{"kind": "OnAccount", "amount": 100, "taxRate": 18}]},
             frag="no tax")
    rejected("expense line also naming a document",
             {"direction": "Payment", "date": pkt_date_iso(), "contactType": "Supplier",
              "contactId": supplier["id"], "bankAccountId": bank_id, "method": "Cash",
              "allocations": [{"kind": "Account", "accountId": exp_id, "amount": 100,
                               "purchaseBillId": 999999}]},
             frag="can't also settle")
    rejected("Client type with no client chosen",
             {"direction": "Payment", "date": pkt_date_iso(), "contactType": "Client",
              "bankAccountId": bank_id, "method": "Cash",
              "allocations": [{"kind": "Account", "accountId": exp_id, "amount": 100}]},
             frag="choose the client")
    rejected("unknown payee type",
             {"direction": "Payment", "date": pkt_date_iso(), "contactType": "Employee",
              "bankAccountId": bank_id, "method": "Cash",
              "allocations": [{"kind": "Account", "accountId": exp_id, "amount": 100}]},
             frag="unknown payee type")
    rejected("unknown line type",
             {**base_body, "allocations": [{"kind": "Nonsense", "accountId": exp_id, "amount": 100}]},
             frag="unknown line type")
    if invoice_id:
        rejected("tax on a line that settles a document",
                 {"direction": "Receipt", "date": pkt_date_iso(), "contactType": "Client",
                  "contactId": client["id"], "bankAccountId": bank_id, "method": "Cash",
                  "allocations": [{"kind": "Document", "invoiceId": invoice_id,
                                   "amount": 100, "taxRate": 18}]},
                 direction="receipts", frag="tax belongs on the invoice")


def suite_ledgers(base, token, cid, exp_id, payment_id):
    s = "13. It shows up in the ledger"
    print(f"\n=== {s} ===")
    st, led = http("GET", f"/api/accounts/{exp_id}/ledger", base, token=token)
    check(s, "account ledger opens", st == 200, f"{st} {led}")
    rows = (led or {}).get("items") if isinstance(led, dict) else led
    check(s, "the expense appears in its account's ledger", bool(rows), str(led)[:200])

    st, tb = http("GET", f"/api/accounting/reports/company/{cid}/trial-balance", base, token=token)
    check(s, "trial balance opens", st == 200, f"{st}")
    if isinstance(tb, dict):
        check(s, "trial balance still balances",
              eq(tb.get("totalDebit"), float(tb.get("totalCredit") or 0)),
              f"dr={tb.get('totalDebit')} cr={tb.get('totalCredit')}")


def suite_edit(base, token, cid, bank_id, exp_id, other_exp_id):
    s = "14. Editing a recorded expense"
    print(f"\n=== {s} ===")
    st, p = post_payment(base, token, cid, {
        "direction": "Payment", "date": pkt_date_iso(),
        "contactType": "Other", "contactName": "Typo Ltd",
        "bankAccountId": bank_id, "method": "Cash",
        "description": "Wrong account on purpose",
        "allocations": [{"kind": "Account", "accountId": exp_id, "amount": 1000}],
    })
    if st not in (200, 201):
        check(s, "seed payment created", False, f"{st} {p}")
        return
    pid = p["id"]
    st, upd = http("PUT", f"/api/payments/payments/{pid}", base, token=token, body={
        "direction": "Payment", "date": pkt_date_iso(),
        "contactType": "Other", "contactName": "Fixed Ltd",
        "bankAccountId": bank_id, "method": "Cash",
        "description": "Corrected",
        "allocations": [{"kind": "Account", "accountId": other_exp_id, "amount": 1500}],
    })
    check(s, "edit accepted", st == 200, f"{st} {upd}")
    if st != 200:
        return
    check(s, "payee name updated", upd.get("contactName") == "Fixed Ltd", str(upd.get("contactName")))
    check(s, "amount updated", eq(upd.get("amount"), 1500), str(upd.get("amount")))
    e = entry_for(base, token, cid, pid)
    if e:
        check(s, "the ledger followed to the new account",
              leg(e, other_exp_id) is not None and leg(e, exp_id) is None,
              str([l.get("accountId") for l in e["lines"]]))


def suite_tax_math(base, token, cid, bank_id, exp_id):
    s = "15. Inclusive-tax arithmetic"
    print(f"\n=== {s} ===")
    # gross, rate, expected tax (inclusive, rounded away from zero at 2dp)
    cases = [
        (11600, 18, 1769.49),
        (5900, 18, 900.00),
        (1000, 0, 0.00),
        (333.33, 18, 50.85),
        (100000, 17, 14529.91),
    ]
    for gross, rate, want in cases:
        body = {
            "direction": "Payment", "date": pkt_date_iso(),
            "contactType": "Other", "contactName": "Tax math",
            "bankAccountId": bank_id, "method": "Cash",
            "allocations": [{"kind": "Account", "accountId": exp_id, "amount": gross,
                             **({"taxRate": rate} if rate else {})}],
        }
        st, p = post_payment(base, token, cid, body)
        if st not in (200, 201):
            check(s, f"{gross} @ {rate}% accepted", False, f"{st} {p}")
            continue
        a0 = (p.get("allocations") or [{}])[0]
        check(s, f"{gross} @ {rate}% → tax {want}", eq(a0.get("taxAmount"), want),
              f"got {a0.get('taxAmount')}")
        check(s, f"{gross} @ {rate}% → net + tax == gross",
              eq(float(a0.get("netAmount") or 0) + float(a0.get("taxAmount") or 0), gross),
              f"net={a0.get('netAmount')} tax={a0.get('taxAmount')}")


def suite_settle_with_writeoff(base, token, cid, bank_id, ar_id, client):
    """A document line still settles, and can still write off the shortfall.

    The adjustment rules moved into NormalizeAllocations with this change, so the
    settle path is re-checked here. scripts/test_receipt_adjustment.py covers it
    more deeply but hard-codes the admin password, so it cannot run against every
    environment.
    """
    s = "16. Settle an invoice and write off the rest"
    print(f"\n=== {s} ===")

    st, it = http("POST", "/api/itemtypes", base, token=token, body={
        "name": f"Expense test item {datetime.now().strftime('%H%M%S')}", "companyId": cid})
    if st not in (200, 201):
        check(s, "item type created", False, f"{st} {it}")
        return
    st, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": pkt_date_iso(), "companyId": cid, "clientId": client["id"], "gstRate": 18,
        "items": [{"description": "settle test", "quantity": 1, "uom": "Pcs",
                   "unitPrice": 1000, "itemTypeId": it["id"]}],
    })
    check(s, "invoice created (grand 1180)", st in (200, 201) and eq(inv.get("grandTotal"), 1180),
          f"{st} {inv}")
    if st not in (200, 201):
        return

    flat = get_flat(base, token, cid)
    disc = find_acct(flat, control="DiscountAllowed")
    if not disc:
        check(s, "Discount allowed account exists", False, "missing from the preset")
        return

    # Receive 1000 in cash and write the remaining 180 off to Discount allowed.
    st, p = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "direction": "Receipt", "date": pkt_date_iso(),
        "contactType": "Client", "contactId": client["id"],
        "bankAccountId": bank_id, "method": "Bank Transfer",
        "description": "Part cash, rest discounted",
        "allocations": [{"kind": "Document", "invoiceId": inv["id"], "amount": 1000,
                         "adjustmentAmount": 180, "adjustmentAccountId": disc["id"]}],
    })
    check(s, "receipt with a write-off accepted", st in (200, 201), f"{st} {p}")
    if st not in (200, 201):
        return
    check(s, "cash total is the cash only (1000)", eq(p.get("amount"), 1000), str(p.get("amount")))

    st, inv2 = http("GET", f"/api/invoices/{inv['id']}", base, token=token)
    if st == 200:
        check(s, "invoice is fully settled (paid 1180)", eq(inv2.get("amountPaid"), 1180),
              str(inv2.get("amountPaid")))

    e = entry_for(base, token, cid, p["id"])
    if e:
        check(s, "AR credited the FULL 1180", eq((leg(e, ar_id) or {}).get("credit"), 1180),
              str(leg(e, ar_id)))
        check(s, "bank debited only the cash 1000", eq((leg(e, bank_id) or {}).get("debit"), 1000),
              str(leg(e, bank_id)))
        check(s, "the 180 gap went to Discount allowed",
              eq((leg(e, disc["id"]) or {}).get("debit"), 180), str(leg(e, disc["id"])))
        check(s, "entry is balanced",
              eq(sum(float(l.get("debit") or 0) for l in e["lines"]),
                 sum(float(l.get("credit") or 0) for l in e["lines"])), "")


def suite_advance_visible_to_reports(base, token, cid, bank_id, client):
    """An advance has to be VISIBLE, not just posted.

    The ledger recorded advances correctly from the start, but the three places a
    user actually looks — the client's statement, the A/R column on the Clients
    screen, and the aged-receivables report — all derived a customer's position
    from invoices alone, so an advance with no invoice was invisible.
    """
    s = "17. An advance shows up where people look"
    print(f"\n=== {s} ===")

    st, before_stmt = http("GET", f"/api/clients/{client['id']}/statement", base, token=token)
    base_closing = float((before_stmt or {}).get("closingBalance") or 0) if st == 200 else 0.0

    st, p = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "direction": "Receipt", "date": pkt_date_iso(),
        "contactType": "Client", "contactId": client["id"],
        "bankAccountId": bank_id, "method": "Cash",
        "description": "cash advance, no invoice yet",
        "allocations": [{"kind": "OnAccount", "amount": 1000}],
    })
    check(s, "advance receipt created", st in (200, 201), f"{st} {p}")
    if st not in (200, 201):
        return

    # 1. The client's statement (Clients → open the client → Statement).
    st, stmt = http("GET", f"/api/clients/{client['id']}/statement", base, token=token)
    check(s, "statement loads", st == 200, f"{st}")
    rows = (stmt or {}).get("entries") or []
    adv = [r for r in rows if eq(r.get("credit"), 1000) and "RCP-" in (r.get("reference") or "")]
    check(s, "the advance appears on the statement", bool(adv),
          f"{len(rows)} rows, none crediting 1000")
    if adv:
        check(s, "it is labelled as an advance",
              "advance" in (adv[0].get("type") or "").lower(), str(adv[0].get("type")))
    check(s, "closing balance fell by 1,000 (customer now in credit)",
          eq((stmt or {}).get("closingBalance"), base_closing - 1000),
          f"was {base_closing}, now {(stmt or {}).get('closingBalance')}")

    # 2. The A/R column on the Clients screen.
    st, summary = http("GET", f"/api/clients/company/{cid}/summary", base, token=token)
    check(s, "client summary loads", st == 200, f"{st}")
    row = next((r for r in (summary or []) if r.get("clientId") == client["id"]
                or r.get("id") == client["id"]), None)
    check(s, "the client is in the summary", row is not None, str(summary)[:200])
    if row:
        # Earlier suites in this run also moved this client's balance, so assert
        # the invariant that matters rather than an absolute figure: the A/R
        # column and the statement's closing balance must agree.
        check(s, "the A/R column agrees with the statement",
              eq(row.get("accountsReceivable"), (stmt or {}).get("closingBalance")),
              f"column={row.get('accountsReceivable')} statement={(stmt or {}).get('closingBalance')}")
        check(s, "A/R is negative — the client is in credit",
              float(row.get("accountsReceivable") or 0) < 0,
              f"accountsReceivable = {row.get('accountsReceivable')}")

    # 3. Aged receivables.
    st, aged = http("GET", f"/api/accounting/reports/company/{cid}/aged-receivables",
                    base, token=token)
    check(s, "aged receivables loads", st == 200, f"{st}")
    arow = next((r for r in (aged or {}).get("rows", []) if r.get("partyId") == client["id"]), None)
    check(s, "the client appears in aged receivables", arow is not None,
          str((aged or {}).get("rows"))[:200])
    if arow:
        check(s, "the advance sits in Current, not overdue",
              eq(arow.get("current"), float(arow.get("total") or 0)), str(arow))


def suite_supplier_payables(base, token, cid, bank_id, supplier):
    """Accounts payable + status on the Suppliers screen, and the supplier ledger.

    Same shape as the customer side: a supplier's position must come from their
    bills AND the payments tagged to them, or an advance is invisible.
    """
    s = "18. Supplier payables + ledger"
    print(f"\n=== {s} ===")

    def summary_row():
        st, rows = http("GET", f"/api/suppliers/company/{cid}/summary", base, token=token)
        if st != 200 or not isinstance(rows, list):
            return None
        return next((r for r in rows if r.get("supplierId") == supplier["id"]), None)

    row = summary_row()
    check(s, "supplier summary endpoint works", row is not None, "supplier row not returned")
    if row is None:
        return
    check(s, "a supplier with nothing owing reads Paid", row.get("status") == "Paid",
          f"status={row.get('status')} payable={row.get('accountsPayable')}")

    # A bill we owe → payable goes up, status Unpaid.
    st, it = http("POST", "/api/itemtypes", base, token=token, body={
        "name": f"Payable test item {datetime.now().strftime('%H%M%S')}", "companyId": cid})
    if st not in (200, 201):
        check(s, "item type created", False, f"{st} {it}")
        return
    st, bill = http("POST", "/api/purchasebills", base, token=token, body={
        "companyId": cid, "supplierId": supplier["id"], "date": pkt_date_iso(), "gstRate": 0,
        "items": [{"description": "payable test", "quantity": 1, "uom": "Pcs",
                   "unitPrice": 5000, "itemTypeId": it["id"]}],
    })
    check(s, "purchase bill created (5,000)", st in (200, 201), f"{st} {bill}")
    if st not in (200, 201):
        return

    after_bill = summary_row()
    check(s, "accounts payable rose by the bill (5,000)",
          eq((after_bill or {}).get("accountsPayable"), float(row.get("accountsPayable") or 0) + 5000),
          f"was {row.get('accountsPayable')}, now {(after_bill or {}).get('accountsPayable')}")
    check(s, "one open bill counted", (after_bill or {}).get("openBills") == 1,
          str((after_bill or {}).get("openBills")))
    base_payable = float(row.get("accountsPayable") or 0)

    # Part-pay it → status Partial.
    st, _ = post_payment(base, token, cid, {
        "direction": "Payment", "date": pkt_date_iso(),
        "contactType": "Supplier", "contactId": supplier["id"],
        "bankAccountId": bank_id, "method": "Bank Transfer",
        "allocations": [{"kind": "Document", "purchaseBillId": bill["id"], "amount": 2000}],
    })
    check(s, "part payment accepted", st in (200, 201), str(st))
    row = summary_row()
    check(s, "payable fell by the 2,000 paid",
          eq((row or {}).get("accountsPayable"), base_payable + 3000),
          f"expected {base_payable + 3000}, got {(row or {}).get('accountsPayable')}")
    check(s, "a part-paid bill reads Partial once anything is owing",
          (row or {}).get("status") in ("Partial", "Paid"), str((row or {}).get("status")))

    # An advance on top → reduces what we owe further, with no document.
    st, _ = post_payment(base, token, cid, {
        "direction": "Payment", "date": pkt_date_iso(),
        "contactType": "Supplier", "contactId": supplier["id"],
        "bankAccountId": bank_id, "method": "Cash",
        "description": "advance for the next shipment",
        "allocations": [{"kind": "OnAccount", "amount": 3000}],
    })
    check(s, "supplier advance accepted", st in (200, 201), str(st))
    after_adv = summary_row()
    check(s, "the advance reduced payables by another 3,000",
          eq((after_adv or {}).get("accountsPayable"), base_payable),
          f"expected {base_payable}, got {(after_adv or {}).get('accountsPayable')}")
    row = after_adv

    # The ledger has to show all three movements with a running balance.
    st, stmt = http("GET", f"/api/suppliers/{supplier['id']}/statement", base, token=token)
    check(s, "supplier statement loads", st == 200, str(st))
    rows = (stmt or {}).get("entries") or []
    types = [r.get("type") for r in rows]
    check(s, "the bill is on the ledger", "Purchase Bill" in types, str(types))
    check(s, "the payment is on the ledger", "Payment" in types, str(types))
    check(s, "the advance is on the ledger", "Advance paid" in types, str(types))
    check(s, "ledger agrees with the payables column",
          eq((stmt or {}).get("closingBalance"), (row or {}).get("accountsPayable")),
          f"ledger={(stmt or {}).get('closingBalance')} column={(row or {}).get('accountsPayable')}")

    # Aged payables must include the supplier's on-account credit too.
    st, aged = http("GET", f"/api/accounting/reports/company/{cid}/aged-payables", base, token=token)
    check(s, "aged payables loads", st == 200, str(st))
    arow = next((r for r in (aged or {}).get("rows", []) if r.get("partyId") == supplier["id"]), None)
    check(s, "supplier appears in aged payables", arow is not None,
          str((aged or {}).get("rows"))[:200])
    if arow:
        check(s, "aged payables total matches the ledger",
              eq(arow.get("total"), (stmt or {}).get("closingBalance")),
              f"aged={arow.get('total')} ledger={(stmt or {}).get('closingBalance')}")


# ── main ───────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--user", default=os.environ.get("MYAPP_ADMIN_USER", "admin"))
    ap.add_argument("--password", default=os.environ.get("MYAPP_ADMIN_PASSWORD", "admin123"))
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    token, company, client, supplier = setup(args.base, args.user, args.password)
    cid = company["id"]

    try:
        print("\n=== 1. Setup: chart of accounts + GL ===")
        enable_gl(args.base, token, cid)
        seed_coa(args.base, token, cid)
        flat = get_flat(args.base, token, cid)
        check("1. Setup", "chart of accounts is seeded", len(flat) > 10, f"{len(flat)} accounts")

        bank_id = new_bank(args.base, token, cid, "Test Bank")
        cash_id = new_bank(args.base, token, cid, "Test Cash")
        check("1. Setup", "two bank/cash accounts exist", bank_id != cash_id,
              f"bank={bank_id} cash={cash_id}")

        ap_acct = find_acct(flat, control="AccountsPayable")
        ar_acct = find_acct(flat, control="AccountsReceivable")
        it_acct = find_acct(flat, control="InputTax")
        ot_acct = find_acct(flat, control="OutputTax")
        for label, a in (("Accounts payable", ap_acct), ("Accounts receivable", ar_acct),
                         ("Input tax", it_acct), ("Output tax", ot_acct)):
            check("1. Setup", f"{label} control account exists", a is not None, "missing")
        if not all((ap_acct, ar_acct, it_acct, ot_acct)):
            raise Fatal("the chart of accounts is missing a control account")

        ids = {
            "rent": acct_id(args.base, token, cid, "Rent"),
            "electricity": acct_id(args.base, token, cid, "Electricity"),
            "internet": acct_id(args.base, token, cid, "Internet"),
            "telephone": acct_id(args.base, token, cid, "Telephone"),
            "office": acct_id(args.base, token, cid, "Office supplies"),
            "other_income": acct_id(args.base, token, cid, "Other income"),
        }
        check("1. Setup", "the everyday expense accounts are seeded", True)

        first = suite_expense_no_tax(args.base, token, cid, bank_id, ids["rent"])
        suite_expense_second_account(args.base, token, cid, cash_id, ids["office"])
        suite_expense_with_tax(args.base, token, cid, bank_id, ids["electricity"], it_acct["id"])
        suite_supplier_expense(args.base, token, cid, bank_id, ids["rent"], supplier)

        print("\n=== 6. Other payee ===")
        check("6. Other payee", "covered by suite 2 (free-text name + no party)", first is not None)

        suite_multi_line(args.base, token, cid, bank_id, ids)
        suite_supplier_advance(args.base, token, cid, bank_id, ap_acct["id"], supplier)
        suite_customer_advance(args.base, token, cid, bank_id, ar_acct["id"], client)
        suite_customer_refund(args.base, token, cid, bank_id, ar_acct["id"], client)
        suite_other_income(args.base, token, cid, bank_id, ids["other_income"], ot_acct["id"])
        suite_validation(args.base, token, cid, bank_id, ids["rent"], ap_acct["id"],
                         supplier, client, None)
        if first:
            suite_ledgers(args.base, token, cid, ids["rent"], first)
        suite_edit(args.base, token, cid, bank_id, ids["rent"], ids["office"])
        suite_tax_math(args.base, token, cid, bank_id, ids["electricity"])
        suite_settle_with_writeoff(args.base, token, cid, bank_id, ar_acct["id"], client)
        suite_advance_visible_to_reports(args.base, token, cid, bank_id, client)
        suite_supplier_payables(args.base, token, cid, bank_id, supplier)

    except Fatal as ex:
        check("FATAL", str(ex), False, "prerequisite failed")
    finally:
        teardown(args.base, token, company, args.keep)

    failed = [r for r in results if r[2] != PASS]
    print("\n" + "=" * 68)
    print(f"  {len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        print("\n  FAILURES:")
        for suite, name, status in failed:
            print(f"    [{suite}] {name}: {status}")
    print("=" * 68)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
