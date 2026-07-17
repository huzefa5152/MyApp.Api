"""
General Ledger (Phase B) regression tests — double-entry posting engine,
Chart-of-Accounts balances, manual journals, transfers, reports and the
cheque register. Must pass before any push that touches the accounting
module (GeneralLedgerService / PostingService / JournalEntryService /
AccountTransferService / PaymentService posting hooks).

Base URL resolution: the MYAPP_BASE_URL environment variable overrides the
default of http://localhost:5199; the --base flag overrides both.

Covers:
   2. Enable GL           → seeds the wholesale CoA, turns posting on
   3. Sales invoice       → Dr AR / Cr Sales + Output tax, trial balance
   4. Receipt             → Dr Bank / Cr AR, summary cash total
   5. Purchase bill       → Cr AP (credit balance), trial balance
   6. Supplier payment    → Dr AP / Cr Bank (overdrawn bank is fine)
   7. Manual journal      → Dr/Cr 250, manualOnly list, negative tests
   8. Second bank + transfer → both balances move, still balanced
   9. Receipt edit        → ledger recomputes, entryCount stable
  10. Payment delete      → entry removed, balances restored
  11. Ledger drill-down   → runningBalance chain == closingBalance
  12. Aging + summary     → AR aging row == remaining balance, income
  13. Cheque register     → PATCH cheque-status Cleared / invalid → 400

Each run uses a fresh ephemeral company + client + supplier created at
test-start and torn down at the end. Production data is never touched.

Usage:
  python scripts/test_accounting_gl.py
  python scripts/test_accounting_gl.py --base http://localhost:5199 --keep

Flags:
  --keep    leave test rows in the DB after the run (default: delete)
  --base    backend base URL (default: MYAPP_BASE_URL or http://localhost:5199)

Exit code 0 = every assertion passes. 1 = at least one failure.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DEFAULT_BASE = os.environ.get("MYAPP_BASE_URL", "http://localhost:5199")

PASS = "PASS"
FAIL = "FAIL"
results: list[tuple[str, str, str]] = []  # (suite, name, status)

# Pakistan Standard Time (UTC+5, no DST) — invoices dated "today" must be
# today in Karachi, not the server's UTC date, or the FBR [0043] future-date
# guard misfires in the 19:00–23:59 UTC window (same convention as
# scripts/test_basic_flows.py).
PKT = timezone(timedelta(hours=5))


def pkt_date_iso(day_offset: int = 0) -> str:
    d = (datetime.now(PKT) + timedelta(days=day_offset)).date()
    return d.strftime("%Y-%m-%dT00:00:00Z")


# ── HTTP helper ────────────────────────────────────────────────────
def http(method: str, path: str, base: str, token: str | None = None,
         body: Any = None, timeout: int = 60) -> tuple[int, Any]:
    url = base.rstrip("/") + path
    data = None
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
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


def check(suite: str, name: str, ok: bool, reason: str = "") -> None:
    results.append((suite, name, PASS if ok else f"FAIL — {reason}"))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{'' if ok else '  <- ' + reason}")


def eq(a: Any, b: float) -> bool:
    """Money comparison: |a - b| < 0.01."""
    try:
        return abs(float(a) - float(b)) < 0.01
    except (TypeError, ValueError):
        return False


class Fatal(Exception):
    """A prerequisite failed — stop asserting (teardown + report still run)."""


# ── GL read helpers ────────────────────────────────────────────────
def gl_status(base: str, token: str, cid: int) -> dict:
    st, s = http("GET", f"/api/accounting/gl/company/{cid}/status", base, token=token)
    return s if st == 200 and isinstance(s, dict) else {}


def get_flat(base: str, token: str, cid: int) -> list[dict]:
    st, rows = http("GET", f"/api/accounts/company/{cid}/flat", base, token=token)
    return rows if st == 200 and isinstance(rows, list) else []


def find_acct(flat: list[dict], control: str | None = None,
              name: str | None = None) -> dict | None:
    for a in flat:
        if control and a.get("controlType") != control:
            continue
        if name and a.get("name") != name:
            continue
        return a
    return None


def balance_of(base: str, token: str, cid: int, account_id: int) -> float | None:
    """Live signed (debit-positive) balance from the flat list."""
    for a in get_flat(base, token, cid):
        if a.get("id") == account_id:
            return float(a.get("balance") or 0)
    return None


def tree_find_account(nodes: list[dict], account_id: int) -> dict | None:
    for n in nodes or []:
        for a in n.get("accounts", []):
            if a.get("id") == account_id:
                return a
        found = tree_find_account(n.get("children", []), account_id)
        if found:
            return found
    return None


def assert_balanced(base: str, token: str, cid: int, suite: str, label: str) -> dict:
    st, tb = http("GET", f"/api/accounting/reports/company/{cid}/trial-balance",
                  base, token=token)
    ok = (st == 200 and isinstance(tb, dict)
          and eq(tb.get("totalDebit"), float(tb.get("totalCredit") or -1)))
    check(suite, label, ok,
          f"got {st} totalDebit={tb.get('totalDebit') if isinstance(tb, dict) else tb} "
          f"totalCredit={tb.get('totalCredit') if isinstance(tb, dict) else ''}")
    return tb if isinstance(tb, dict) else {}


# ── Setup / teardown ───────────────────────────────────────────────
def setup(base: str, admin_user: str, admin_pw: str):
    print(f"\n=== Logging in as {admin_user} ===")
    status, data = http("POST", "/api/auth/login", base, body={
        "username": admin_user, "password": admin_pw})
    if status != 200:
        print(f"FATAL: admin login failed ({status} {data})")
        sys.exit(2)
    token = data["token"]

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    company_name = f"_test_accounting_gl {suffix}"

    print(f"\n=== Creating ephemeral test company '{company_name}' ===")
    status, company = http("POST", "/api/companies", base, token=token, body={
        "name": company_name,
        "fullAddress": "Test HQ",
        "phone": "+92-21-00000000",
        "ntn": "9999999",
        "strn": "9999999999999",
        "startingChallanNumber": 1,
        "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1,
        "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox",
        "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Manufacturer",
        "fbrSector": "All Other Sectors",
    })
    if status not in (200, 201):
        print(f"FATAL: create company failed ({status} {company})")
        sys.exit(2)
    print(f"  company id={company['id']}  name={company['name']}")

    print("\n=== Creating client + supplier ===")
    status, client = http("POST", "/api/clients", base, token=token, body={
        "name": f"GL Client {suffix}",
        "address": "1 Test Road, Karachi",
        "phone": "021-1234567",
        "companyId": company["id"],
        "ntn": "1234567",
        "strn": "1234567890123",
        "fbrProvinceCode": 8,
        "registrationType": "Registered",
    })
    if status not in (200, 201):
        print(f"FATAL: create client failed ({status} {client})")
        sys.exit(2)
    status, supplier = http("POST", "/api/suppliers", base, token=token, body={
        "name": f"GL Supplier {suffix}",
        "companyId": company["id"],
        "ntn": "7654321",
        "registrationType": "Registered",
        "fbrProvinceCode": 8,
    })
    if status not in (200, 201):
        print(f"FATAL: create supplier failed ({status} {supplier})")
        sys.exit(2)
    print(f"  client id={client['id']}  supplier id={supplier['id']}")

    return token, company, client, supplier


def teardown(base: str, token: str, company: dict, keep: bool) -> None:
    if keep:
        print(f"\n=== Skipping teardown — leaving company id={company['id']} in place ===")
        return
    print(f"\n=== Tearing down company id={company['id']} ===")
    status, _ = http("DELETE", f"/api/companies/{company['id']}", base, token=token)
    print(f"  delete returned {status}")


# ── Main flow ──────────────────────────────────────────────────────
def run(base: str, token: str, company: dict, client: dict, supplier: dict) -> None:
    cid = company["id"]
    today = pkt_date_iso()

    # ── 2. Enable GL ────────────────────────────────────────────────
    suite = "2. GL enable"
    print(f"\n=== {suite} ===")
    st, enabled = http("POST", f"/api/accounting/gl/company/{cid}/enable", base, token=token)
    check(suite, "enable returns 200", st == 200, f"got {st} {enabled}")
    if st != 200:
        raise Fatal("GL enable failed")
    check(suite, "enable seeded the wholesale CoA (seededAccounts > 0)",
          int(enabled.get("seededAccounts") or 0) > 0,
          f"seededAccounts = {enabled.get('seededAccounts')}")
    status = gl_status(base, token, cid)
    check(suite, "status.enabled == true", status.get("enabled") is True, str(status))
    check(suite, "status.hasCoa == true", status.get("hasCoa") is True, str(status))
    check(suite, "status.accountCount > 0",
          int(status.get("accountCount") or 0) > 0, f"accountCount = {status.get('accountCount')}")
    check(suite, "status.isBalanced (empty ledger)", status.get("isBalanced") is True, str(status))

    # Resolve the seeded control accounts once — everything below leans on them.
    flat = get_flat(base, token, cid)
    ar = find_acct(flat, control="AccountsReceivable")
    ap = find_acct(flat, control="AccountsPayable")
    bank = find_acct(flat, control="BankCash")
    salaries = find_acct(flat, name="Salaries")
    capital = find_acct(flat, control="Capital")
    check(suite, "seeded control accounts present (AR/AP/Bank/Salaries/Capital)",
          all([ar, ap, bank, salaries, capital]),
          f"AR={bool(ar)} AP={bool(ap)} Bank={bool(bank)} "
          f"Salaries={bool(salaries)} Capital={bool(capital)}")
    if not all([ar, ap, bank, salaries, capital]):
        raise Fatal("seeded accounts missing")
    print(f"  AR id={ar['id']}  AP id={ap['id']}  Bank id={bank['id']} ('{bank['name']}')")

    # ── 3. Sales invoice posting ────────────────────────────────────
    suite = "3. Sales invoice posting"
    print(f"\n=== {suite} ===")
    # Every bill line must be classified (Item Type or Non-Inventory item), so
    # seed a plain item type first. With no overlay account it resolves to the
    # company's default Sales income account — the pre-split baseline.
    st, it0 = http("POST", f"/api/itemtypes?companyId={cid}", base, token=token, body={
        "name": f"GL base c{cid}", "isFavorite": True,
    })
    check(suite, "seeded a plain item type", st in (200, 201) and isinstance(it0, dict) and it0.get("id"),
          f"got {st} {it0}")
    if st not in (200, 201):
        raise Fatal("item type creation failed")
    # Standalone invoice: 1000 net + 18 % GST = 1180 grand total.
    st, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 18,
        "items": [{"description": "GL test item", "quantity": 1,
                   "uom": "Pcs", "unitPrice": 1000, "itemTypeId": it0["id"]}],
    })
    check(suite, "standalone invoice created (grand 1180)",
          st in (200, 201) and eq(inv.get("grandTotal") if isinstance(inv, dict) else None, 1180),
          f"got {st} {inv}")
    if st not in (200, 201):
        raise Fatal("invoice creation failed")
    inv_id = inv["id"]

    tb = assert_balanced(base, token, cid, suite, "trial balance debits == credits")
    check(suite, "trial balance has movement (totalDebit > 0)",
          float(tb.get("totalDebit") or 0) > 0, f"totalDebit = {tb.get('totalDebit')}")

    check(suite, "AR balance == 1180 (flat list)",
          eq(balance_of(base, token, cid, ar["id"]), 1180),
          f"balance = {balance_of(base, token, cid, ar['id'])}")
    st, tree = http("GET", f"/api/accounts/company/{cid}/tree", base, token=token)
    tree_ar = tree_find_account((tree or {}).get("balanceSheet", []), ar["id"]) if st == 200 else None
    check(suite, "AR balance == 1180 (tree node)",
          tree_ar is not None and eq(tree_ar.get("balance"), 1180),
          f"got {st} tree balance = {tree_ar.get('balance') if tree_ar else None}")

    # Income accounts carry credit balances: debit-positive closing == -1000.
    income_closing = sum(float(r.get("closing") or 0)
                         for r in tb.get("rows", []) if r.get("accountType") == "Income")
    check(suite, "income accounts credited 1000 (Σ closing == -1000)",
          eq(income_closing, -1000), f"Σ income closing = {income_closing}")

    # ── 4. Receipt posting ──────────────────────────────────────────
    suite = "4. Receipt posting"
    print(f"\n=== {suite} ===")
    st, bank_cash = http("GET", f"/api/accounts/company/{cid}/bank-cash", base, token=token)
    check(suite, "bank-cash picker lists the seeded account",
          st == 200 and any(a.get("id") == bank["id"] for a in (bank_cash or [])),
          f"got {st} {bank_cash}")
    st, receipt = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "date": today, "contactType": "Client", "contactId": client["id"],
        "method": "Cash", "bankAccountId": bank["id"],
        "allocations": [{"invoiceId": inv_id, "amount": 500}],
    })
    check(suite, "receipt of 500 created", st in (200, 201), f"got {st} {receipt}")
    if st not in (200, 201):
        raise Fatal("receipt creation failed")
    receipt_id = receipt["id"]

    check(suite, "AR balance drops to 680",
          eq(balance_of(base, token, cid, ar["id"]), 680),
          f"balance = {balance_of(base, token, cid, ar['id'])}")
    check(suite, "bank balance == 500",
          eq(balance_of(base, token, cid, bank["id"]), 500),
          f"balance = {balance_of(base, token, cid, bank['id'])}")
    assert_balanced(base, token, cid, suite, "trial balance still balanced")
    st, summary = http("GET", f"/api/accounting/summary/company/{cid}", base, token=token)
    check(suite, "summary.cashAndBankTotal == 500",
          st == 200 and eq((summary or {}).get("cashAndBankTotal"), 500),
          f"got {st} cashAndBankTotal = {(summary or {}).get('cashAndBankTotal')}")

    # ── 5. Purchase bill posting ────────────────────────────────────
    suite = "5. Purchase bill posting"
    print(f"\n=== {suite} ===")
    # 2000 net + 18 % GST = 2360 grand total. Line classified with the plain
    # item type (required on purchase bills too).
    st, bill = http("POST", "/api/purchasebills", base, token=token, body={
        "date": today, "companyId": cid, "supplierId": supplier["id"], "gstRate": 18,
        "items": [{"description": "GL purchase item", "quantity": 1,
                   "uom": "Pcs", "unitPrice": 2000, "itemTypeId": it0["id"]}],
    })
    check(suite, "purchase bill created (grand 2360)",
          st in (200, 201) and eq(bill.get("grandTotal") if isinstance(bill, dict) else None, 2360),
          f"got {st} {bill}")
    if st not in (200, 201):
        raise Fatal("purchase bill creation failed")
    bill_id = bill["id"]

    # AP is a liability — debit-positive balance is NEGATIVE (a credit).
    check(suite, "AP balance == -2360 (credit balance)",
          eq(balance_of(base, token, cid, ap["id"]), -2360),
          f"balance = {balance_of(base, token, cid, ap['id'])}")
    assert_balanced(base, token, cid, suite, "trial balance still balanced")

    # ── 6. Supplier payment ─────────────────────────────────────────
    suite = "6. Supplier payment"
    print(f"\n=== {suite} ===")
    st, payment = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
        "date": today, "contactType": "Supplier", "contactId": supplier["id"],
        "method": "Bank Transfer", "bankAccountId": bank["id"],
        "allocations": [{"purchaseBillId": bill_id, "amount": 800}],
    })
    check(suite, "payment of 800 created", st in (200, 201), f"got {st} {payment}")
    if st not in (200, 201):
        raise Fatal("payment creation failed")
    payment_id = payment["id"]

    check(suite, "AP reduced by 800 (== -1560)",
          eq(balance_of(base, token, cid, ap["id"]), -1560),
          f"balance = {balance_of(base, token, cid, ap['id'])}")
    check(suite, "bank balance == -300 (overdrawn is fine)",
          eq(balance_of(base, token, cid, bank["id"]), -300),
          f"balance = {balance_of(base, token, cid, bank['id'])}")
    assert_balanced(base, token, cid, suite, "trial balance still balanced")

    # ── 7. Manual journal entries ───────────────────────────────────
    suite = "7. Manual journal entries"
    print(f"\n=== {suite} ===")
    # Two NON-bank accounts from the seeded preset: Dr Salaries / Cr Capital.
    st, je = http("POST", f"/api/journal-entries/company/{cid}", base, token=token, body={
        "date": today, "narration": "GL test manual journal",
        "lines": [
            {"accountId": salaries["id"], "debit": 250, "credit": 0},
            {"accountId": capital["id"],  "debit": 0,   "credit": 250},
        ],
    })
    check(suite, "manual JE Dr 250 / Cr 250 created", st in (200, 201), f"got {st} {je}")

    st, page = http("GET", f"/api/journal-entries/company/{cid}/paged?manualOnly=true",
                    base, token=token)
    manual_items = (page or {}).get("items", []) if st == 200 else []
    check(suite, "JE appears in manualOnly list", len(manual_items) == 1,
          f"got {st} totalCount = {(page or {}).get('totalCount')}")
    listed = manual_items[0] if manual_items else {}
    check(suite, "listed JE totalDebit == totalCredit == 250",
          eq(listed.get("totalDebit"), 250) and eq(listed.get("totalCredit"), 250),
          f"totals = {listed.get('totalDebit')}/{listed.get('totalCredit')}")

    check(suite, "Salaries balance == 250",
          eq(balance_of(base, token, cid, salaries["id"]), 250),
          f"balance = {balance_of(base, token, cid, salaries['id'])}")
    check(suite, "Owner's capital balance == -250 (credit)",
          eq(balance_of(base, token, cid, capital["id"]), -250),
          f"balance = {balance_of(base, token, cid, capital['id'])}")

    # Negative: unbalanced lines must be rejected.
    st, err = http("POST", f"/api/journal-entries/company/{cid}", base, token=token, body={
        "date": today, "narration": "unbalanced",
        "lines": [
            {"accountId": salaries["id"], "debit": 250, "credit": 0},
            {"accountId": capital["id"],  "debit": 0,   "credit": 100},
        ],
    })
    check(suite, "unbalanced JE rejected (400)", st == 400, f"got {st} {err}")

    # Negative: manual journals may not hit a bank/cash account (use a
    # receipt/payment/transfer instead — the bank subledger must reconcile).
    st, err = http("POST", f"/api/journal-entries/company/{cid}", base, token=token, body={
        "date": today, "narration": "hits bank",
        "lines": [
            {"accountId": bank["id"],    "debit": 100, "credit": 0},
            {"accountId": capital["id"], "debit": 0,   "credit": 100},
        ],
    })
    check(suite, "JE hitting a bank/cash account rejected (400)", st == 400, f"got {st} {err}")

    # ── 8. Second bank account + transfer ───────────────────────────
    suite = "8. Second bank account + transfer"
    print(f"\n=== {suite} ===")
    st, till = http("POST", f"/api/accounts/company/{cid}", base, token=token, body={
        "name": "Till", "accountGroupId": bank["accountGroupId"],
        "accountType": "Asset", "controlType": "BankCash",
    })
    check(suite, "second bank/cash account 'Till' created",
          st in (200, 201) and (till or {}).get("controlType") == "BankCash",
          f"got {st} {till}")
    if st not in (200, 201):
        raise Fatal("Till account creation failed")

    st, transfer = http("POST", f"/api/account-transfers/company/{cid}", base, token=token, body={
        "date": today, "fromAccountId": bank["id"], "toAccountId": till["id"],
        "amount": 100, "description": "GL test transfer",
    })
    check(suite, "transfer 100 bank -> Till created", st in (200, 201), f"got {st} {transfer}")
    check(suite, "bank balance == -400 after transfer",
          eq(balance_of(base, token, cid, bank["id"]), -400),
          f"balance = {balance_of(base, token, cid, bank['id'])}")
    check(suite, "Till balance == 100 after transfer",
          eq(balance_of(base, token, cid, till["id"]), 100),
          f"balance = {balance_of(base, token, cid, till['id'])}")
    assert_balanced(base, token, cid, suite, "trial balance still balanced")

    # ── 9. Receipt edit reflow ──────────────────────────────────────
    suite = "9. Receipt edit reflow"
    print(f"\n=== {suite} ===")
    entries_before = int(gl_status(base, token, cid).get("entryCount") or 0)
    st, updated = http("PUT", f"/api/payments/receipts/{receipt_id}", base, token=token, body={
        "date": today, "contactType": "Client", "contactId": client["id"],
        "method": "Cash", "bankAccountId": bank["id"],
        "allocations": [{"invoiceId": inv_id, "amount": 300}],
    })
    check(suite, "receipt updated 500 -> 300",
          st == 200 and eq((updated or {}).get("amount"), 300), f"got {st} {updated}")
    check(suite, "AR recomputed to 880 (1180 - 300)",
          eq(balance_of(base, token, cid, ar["id"]), 880),
          f"balance = {balance_of(base, token, cid, ar['id'])}")
    check(suite, "bank recomputed to -600 (-400 - 200)",
          eq(balance_of(base, token, cid, bank["id"]), -600),
          f"balance = {balance_of(base, token, cid, bank['id'])}")
    entries_after = int(gl_status(base, token, cid).get("entryCount") or 0)
    check(suite, "entryCount stable after edit (no duplicate posting)",
          entries_after == entries_before,
          f"before = {entries_before}, after = {entries_after}")
    assert_balanced(base, token, cid, suite, "trial balance still balanced")

    # ── 10. Payment delete reflow ───────────────────────────────────
    suite = "10. Payment delete reflow"
    print(f"\n=== {suite} ===")
    entries_before = int(gl_status(base, token, cid).get("entryCount") or 0)
    st, _ = http("DELETE", f"/api/payments/payments/{payment_id}", base, token=token)
    check(suite, "payment deleted (204)", st in (200, 204), f"got {st}")
    check(suite, "AP restored to -2360",
          eq(balance_of(base, token, cid, ap["id"]), -2360),
          f"balance = {balance_of(base, token, cid, ap['id'])}")
    check(suite, "bank restored to 200 (-600 + 800)",
          eq(balance_of(base, token, cid, bank["id"]), 200),
          f"balance = {balance_of(base, token, cid, bank['id'])}")
    entries_after = int(gl_status(base, token, cid).get("entryCount") or 0)
    check(suite, "entryCount decremented by 1 (entry removed)",
          entries_after == entries_before - 1,
          f"before = {entries_before}, after = {entries_after}")
    assert_balanced(base, token, cid, suite, "trial balance still balanced")

    # ── 11. Ledger drill-down ───────────────────────────────────────
    suite = "11. Ledger drill-down"
    print(f"\n=== {suite} ===")
    st, ledger = http("GET", f"/api/accounts/{bank['id']}/ledger?page=1&pageSize=50",
                      base, token=token)
    check(suite, "bank ledger returns 200", st == 200, f"got {st} {ledger}")
    ledger = ledger if isinstance(ledger, dict) else {}
    items = ledger.get("items", [])
    # Rows still hitting the bank account: the (edited) receipt and the
    # transfer-out. The supplier payment's entry was removed on delete.
    check(suite, "totalCount == 2 (receipt + transfer; deleted payment gone)",
          ledger.get("totalCount") == 2 and len(items) == 2,
          f"totalCount = {ledger.get('totalCount')}, items = {len(items)}")
    check(suite, "last runningBalance == closingBalance",
          bool(items) and eq(items[-1].get("runningBalance"),
                             float(ledger.get("closingBalance") or 1e9)),
          f"last = {items[-1].get('runningBalance') if items else None}, "
          f"closing = {ledger.get('closingBalance')}")
    check(suite, "closingBalance == 200 (matches flat balance)",
          eq(ledger.get("closingBalance"), 200),
          f"closing = {ledger.get('closingBalance')}")

    # ── 12. Aging + summary ─────────────────────────────────────────
    suite = "12. Aging + summary"
    print(f"\n=== {suite} ===")
    st, aged_ar = http("GET", f"/api/accounting/reports/company/{cid}/aged-receivables",
                       base, token=token)
    row = next((r for r in (aged_ar or {}).get("rows", [])
                if r.get("partyId") == client["id"]), None) if st == 200 else None
    check(suite, "aged receivables lists the client", row is not None, f"got {st} {aged_ar}")
    check(suite, "client aging total == 880 (remaining invoice balance)",
          row is not None and eq(row.get("total"), 880),
          f"total = {row.get('total') if row else None}")
    check(suite, "aged receivables report total == 880",
          st == 200 and eq((aged_ar or {}).get("total"), 880),
          f"total = {(aged_ar or {}).get('total')}")

    st, aged_ap = http("GET", f"/api/accounting/reports/company/{cid}/aged-payables",
                       base, token=token)
    ap_row = next((r for r in (aged_ap or {}).get("rows", [])
                   if r.get("partyId") == supplier["id"]), None) if st == 200 else None
    check(suite, "aged payables: supplier total == 2360 (payment deleted)",
          ap_row is not None and eq(ap_row.get("total"), 2360),
          f"got {st} total = {ap_row.get('total') if ap_row else None}")

    st, summary = http("GET", f"/api/accounting/summary/company/{cid}", base, token=token)
    summary = summary if isinstance(summary, dict) else {}
    check(suite, "summary.glEnabled == true", summary.get("glEnabled") is True, f"got {st} {summary}")
    check(suite, "summary receivables.total == 880",
          eq((summary.get("receivables") or {}).get("total"), 880),
          f"total = {(summary.get('receivables') or {}).get('total')}")
    check(suite, "summary income == 1000 for the period",
          eq(summary.get("income"), 1000), f"income = {summary.get('income')}")
    check(suite, "summary cashAndBankTotal == 300 (bank 200 + Till 100)",
          eq(summary.get("cashAndBankTotal"), 300),
          f"cashAndBankTotal = {summary.get('cashAndBankTotal')}")

    # ── 13. Cheque register ─────────────────────────────────────────
    suite = "13. Cheque register"
    print(f"\n=== {suite} ===")
    st, chq = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "date": today, "contactType": "Client", "contactId": client["id"],
        "method": "Cheque", "chequeNumber": "CHQ-GL-1", "chequeDate": today,
        "bankAccountId": bank["id"],
        "allocations": [{"invoiceId": inv_id, "amount": 100}],
    })
    check(suite, "cheque receipt created", st in (200, 201), f"got {st} {chq}")
    if st in (200, 201):
        st, patched = http("PATCH", f"/api/payments/{chq['id']}/cheque-status",
                           base, token=token, body={"status": "Cleared"})
        check(suite, "cheque-status -> Cleared returns 200", st == 200, f"got {st} {patched}")
        check(suite, "chequeStatus reflected as Cleared",
              (patched or {}).get("chequeStatus") == "Cleared",
              f"chequeStatus = {(patched or {}).get('chequeStatus')}")
        st, err = http("PATCH", f"/api/payments/{chq['id']}/cheque-status",
                       base, token=token, body={"status": "NotAStatus"})
        check(suite, "invalid cheque status rejected (400)", st == 400, f"got {st} {err}")
    else:
        check(suite, "cheque lifecycle — skipped (receipt not created)", False, "no cheque receipt")

    # ── 14. Per-line GL account split via item-type overlay ─────────
    # Manager-style splitting: an item type mapped (per this company's overlay)
    # to a DISTINCT income account routes its line's net there, not onto the
    # default Sales lump — trial balance still balances. Runs LAST so the extra
    # invoice doesn't perturb the AR / income / receipt assertions above.
    suite = "14. Per-line account split"
    print(f"\n=== {suite} ===")
    sales_acct = find_acct(get_flat(base, token, cid), name="Sales")
    ok_group = sales_acct is not None and sales_acct.get("accountGroupId")
    check(suite, "seeded Sales income account present", bool(ok_group), f"sales={sales_acct}")
    if ok_group:
        st, exp_acct = http("POST", f"/api/accounts/company/{cid}", base, token=token, body={
            "name": "Export sales", "accountType": "Income",
            "accountGroupId": sales_acct["accountGroupId"],
        })
        ok_acct = st in (200, 201) and isinstance(exp_acct, dict) and exp_acct.get("id")
        check(suite, "created a distinct income account", bool(ok_acct), f"got {st} {exp_acct}")
        if ok_acct:
            st, it = http("POST", f"/api/itemtypes?companyId={cid}", base, token=token, body={
                "name": f"GLSplit c{cid}", "isFavorite": True,
                "writeCompanyOverlay": True, "saleAccountId": exp_acct["id"],
            })
            ok_it = (st in (200, 201) and isinstance(it, dict) and it.get("id")
                     and it.get("saleAccountId") == exp_acct["id"])
            check(suite, "item type maps to the overlay income account", bool(ok_it),
                  f"got {st} {it}")
            if ok_it:
                st, inv2 = http("POST", "/api/invoices/standalone", base, token=token, body={
                    "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 18,
                    "items": [{"description": "mapped line", "quantity": 1, "uom": "Pcs",
                               "unitPrice": 500, "itemTypeId": it["id"]}],
                })
                check(suite, "invoice with mapped item type created", st in (200, 201),
                      f"got {st} {inv2}")
                assert_balanced(base, token, cid, suite, "trial balance still balances after split")
                # Income is credit-natural → debit-positive balance == -500.
                check(suite, "net (500) posted to the mapped income account, not Sales",
                      eq(balance_of(base, token, cid, exp_acct["id"]), -500),
                      f"Export sales balance = {balance_of(base, token, cid, exp_acct['id'])}")


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
            print(f"  [{badge}] {name:60s} {status if status != PASS else ''}")
    total = len(results)
    print(f"\n=== {total - fail}/{total} checks passed ===")
    return 0 if fail == 0 else 1


# ── Main ───────────────────────────────────────────────────────────
def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", default=DEFAULT_BASE,
                   help="Backend base URL (default: MYAPP_BASE_URL or http://localhost:5199)")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw",   default="admin123")
    p.add_argument("--keep",       action="store_true",
                   help="Leave test rows in the DB after the run.")
    args = p.parse_args()

    token, company, client, supplier = setup(args.base, args.admin_user, args.admin_pw)
    try:
        run(args.base, token, company, client, supplier)
    except Fatal as e:
        print(f"\nFATAL: {e} — skipping remaining checks.")
    finally:
        teardown(args.base, token, company, args.keep)

    return print_report()


if __name__ == "__main__":
    sys.exit(main())
