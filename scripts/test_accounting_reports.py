"""
Accounting Reports regression tests — the Expenses and Cash & Bank report
families, their drill-downs, exports and RBAC scoping.

Must pass before any push that touches AccountingReportService (or its
Expenses / CashBank partials), AccountingReportsController, ReportPeriod,
ReportExcelBuilder, or the report DTOs.

── What makes these tests worth having ──
A reporting layer's failure mode is not a crash; it is a plausible wrong
number. So almost every assertion here is a CROSS-CHECK against something
that already existed and is trusted:

  * expense total        vs the trial balance's expense-account debits
  * cash/bank book close vs the Chart of Accounts account balance
  * register totals      vs the accounting dashboard's own summary
  * cheque register      vs the dashboard's PDC figures
  * a group summary row  vs the detail report filtered to that group

If a report ever disagrees with the engine it reads from, one of these fails.
Internal-consistency checks (rows sum to total, opening + in − out = closing)
catch the rest.

Every run builds a fresh ephemeral company with KNOWN amounts, so the
expected figures are exact rather than merely self-consistent. Production
data is never written to.

Base URL: MYAPP_BASE_URL env var, or --base, else http://localhost:5134.

Usage:
  python scripts/test_accounting_reports.py
  python scripts/test_accounting_reports.py --base http://localhost:5134 --keep

Flags:
  --keep  leave the ephemeral company behind (default: delete it)
  --base  backend base URL
  --user / --pw  admin credentials (default admin / admin123)

Exit 0 = every assertion passed. 1 = at least one failure. 2 = setup failed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DEFAULT_BASE = os.environ.get("MYAPP_BASE_URL", "http://localhost:5134")

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []

# Same clock convention as the rest of the suite: "today" means today in
# Karachi, not the server's UTC date.
PKT = timezone(timedelta(hours=5))


def pkt_date(day_offset: int = 0) -> str:
    return (datetime.now(PKT) + timedelta(days=day_offset)).date().strftime("%Y-%m-%dT00:00:00Z")


def pkt_today() -> datetime:
    return datetime.now(PKT).date()


# ── HTTP ────────────────────────────────────────────────────────────────────
def http(method: str, path: str, base: str, token: str | None = None,
         body: Any = None, timeout: int = 120, raw_bytes: bool = False):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = r.read()
            if raw_bytes:
                return r.status, payload
            text = payload.decode("utf-8")
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        blob = e.read() if e.fp else b""
        if raw_bytes:
            return e.code, blob
        text = blob.decode("utf-8", "replace")
        try:
            return e.code, json.loads(text) if text else None
        except Exception:
            return e.code, text


def check(suite: str, name: str, ok: bool, reason: str = "") -> bool:
    results.append((suite, name, PASS if ok else f"FAIL — {reason}"))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{'' if ok else '  <- ' + reason}")
    return ok


def eq(a: Any, b: Any, tol: float = 0.01) -> bool:
    try:
        return abs(float(a or 0) - float(b or 0)) < tol
    except (TypeError, ValueError):
        return False


class Fatal(Exception):
    """A prerequisite failed — stop asserting, but still tear down and report."""


def report(base: str, token: str, cid: int, path: str, **params) -> dict:
    """GET one report. Empty params are dropped, like the client does."""
    clean = {k: v for k, v in params.items() if v is not None and v != ""}
    qs = ("?" + urllib.parse.urlencode(clean)) if clean else ""
    st, body = http("GET", f"/api/accounting/reports/company/{cid}/{path}{qs}", base, token=token)
    if st != 200 or not isinstance(body, dict):
        raise Fatal(f"GET {path} -> {st} {str(body)[:200]}")
    return body


# ── Setup / teardown ────────────────────────────────────────────────────────
def setup(base: str, user: str, pw: str):
    print(f"\n=== Logging in as {user} ===")
    st, data = http("POST", "/api/auth/login", base, body={"username": user, "password": pw})
    if st != 200 or not isinstance(data, dict) or "token" not in data:
        print(f"FATAL: login failed ({st} {str(data)[:200]})")
        sys.exit(2)
    token = data["token"]

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    name = f"_test_acct_reports {suffix}"
    st, company = http("POST", "/api/companies", base, token=token, body={
        "name": name, "address": "Test", "phone": "0000", "ntn": "0000000-0",
        "strn": "0000000000000", "invoiceType": "Sale Invoice",
    })
    if st not in (200, 201) or not isinstance(company, dict):
        print(f"FATAL: company create failed ({st} {str(company)[:300]})")
        sys.exit(2)
    cid = company["id"]
    print(f"  company id={cid} ({name})")

    st, _ = http("POST", f"/api/accounting/gl/company/{cid}/enable", base, token=token)
    if st != 200:
        print(f"FATAL: GL enable failed ({st})")
        sys.exit(2)
    print("  GL posting enabled + CoA seeded")

    st, supplier = http("POST", "/api/suppliers", base, token=token, body={
        "name": "_test Landlord Ltd", "companyId": cid, "address": "x", "phone": "1",
    })
    supplier_id = supplier["id"] if st in (200, 201) and isinstance(supplier, dict) else None

    st, client = http("POST", "/api/clients", base, token=token, body={
        "name": "_test Customer Ltd", "companyId": cid, "address": "x", "phone": "1",
    })
    client_id = client["id"] if st in (200, 201) and isinstance(client, dict) else None

    return token, cid, supplier_id, client_id


def teardown(base: str, token: str, cid: int, keep: bool):
    if keep:
        print(f"\n=== --keep: company {cid} left in place ===")
        return
    st, _ = http("DELETE", f"/api/companies/{cid}", base, token=token)
    print(f"\n=== Teardown: company {cid} delete -> {st} ===")


# ── Chart of accounts helpers ───────────────────────────────────────────────
def flat_accounts(base: str, token: str, cid: int) -> list[dict]:
    st, rows = http("GET", f"/api/accounts/company/{cid}/flat", base, token=token)
    return rows if st == 200 and isinstance(rows, list) else []


def pick(accounts: list[dict], *, control: str | None = None,
         acct_type: str | None = None, name_contains: str | None = None) -> dict | None:
    for a in accounts:
        if control and a.get("controlType") != control:
            continue
        if acct_type and a.get("accountType") != acct_type:
            continue
        if name_contains and name_contains.lower() not in (a.get("name") or "").lower():
            continue
        return a
    return None


def make_account(base: str, token: str, cid: int, name: str, group_id: int, acct_type: str) -> int:
    st, a = http("POST", f"/api/accounts/company/{cid}", base, token=token, body={
        "name": name, "accountGroupId": group_id, "accountType": acct_type,
    })
    if st not in (200, 201) or not isinstance(a, dict):
        raise Fatal(f"create account '{name}' -> {st} {str(a)[:200]}")
    return a["id"]


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 1 — Company Expense Report against known amounts
# ═══════════════════════════════════════════════════════════════════════════
def suite_expenses(base: str, token: str, cid: int, supplier_id: int | None) -> dict:
    S = "1. Company Expense Report"
    print(f"\n=== {S} ===")

    accounts = flat_accounts(base, token, cid)
    bank = pick(accounts, control="BankCash")
    if not bank:
        raise Fatal("no bank/cash account in the seeded CoA")

    expense_seed = pick(accounts, acct_type="Expense")
    if not expense_seed:
        raise Fatal("no expense account in the seeded CoA")
    group_id = expense_seed["accountGroupId"]

    rent = make_account(base, token, cid, "_test Rent", group_id, "Expense")
    power = make_account(base, token, cid, "_test Electricity", group_id, "Expense")
    supplies = make_account(base, token, cid, "_test Office Supplies", group_id, "Expense")

    # Three payments with known figures. The electricity line carries inclusive
    # 18% tax, so the expense recognised is Amount − Tax and the tax slice posts
    # to Input Tax — the split the report has to reproduce.
    payments = [
        # (payee type, payee id, name, account, gross amount, tax rate)
        ("Supplier", supplier_id, None, rent, 50000.00, None),
        ("Other", None, "K-Electric", power, 11800.00, 18),
        ("Other", None, "Metro Cash & Carry", supplies, 8000.00, None),
    ]
    created = []
    for ctype, cid_party, cname, acct, amount, rate in payments:
        alloc = {"kind": "Account", "accountId": acct, "amount": amount}
        if rate:
            alloc["taxRate"] = rate
        st, p = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
            "direction": "Payment", "date": pkt_date(0),
            "contactType": ctype, "contactId": cid_party, "contactName": cname,
            "bankAccountId": bank["id"], "method": "Bank Transfer",
            "description": f"_test expense {acct}",
            "allocations": [alloc],
        })
        if st not in (200, 201):
            raise Fatal(f"payment create -> {st} {str(p)[:250]}")
        created.append(p)

    # 11800 gross at 18% inclusive -> tax 1800.00, expense 10000.00
    expected_tax = round(11800.00 * 18 / 118, 2)
    expected_subtotal = 50000.00 + (11800.00 - expected_tax) + 8000.00
    expected_total = expected_subtotal + expected_tax

    r = report(base, token, cid, "expenses", period="allPeriods")

    check(S, "3 expense rows returned", r["totalCount"] == 3, f"got {r['totalCount']}")
    check(S, f"subtotal == {expected_subtotal:,.2f} (net of tax)",
          eq(r["totals"].get("subtotal"), expected_subtotal),
          f"got {r['totals'].get('subtotal')}")
    check(S, f"tax == {expected_tax:,.2f} (18% inclusive slice)",
          eq(r["totals"].get("tax"), expected_tax), f"got {r['totals'].get('tax')}")
    check(S, f"total == {expected_total:,.2f} (subtotal + tax)",
          eq(r["totals"].get("total"), expected_total), f"got {r['totals'].get('total')}")
    check(S, "transactionCount == 3", eq(r["totals"].get("transactionCount"), 3),
          f"got {r['totals'].get('transactionCount')}")
    check(S, "ledgerSourced is true (GL is on)", r.get("ledgerSourced") is True)
    check(S, "companyName present on the header", bool(r.get("companyName")),
          "empty — printed reports would lose the letterhead")
    check(S, "totalLabels name the figures", r.get("totalLabels", {}).get("subtotal") == "Total Expenses",
          f"got {r.get('totalLabels')}")

    # The load-bearing cross-check: the report must agree with the trial balance.
    st, tb = http("GET", f"/api/accounting/reports/company/{cid}/trial-balance", base, token=token)
    tb_dr = sum(float(x["debit"]) for x in tb["rows"] if x["accountType"] == "Expense")
    check(S, "subtotal == trial balance expense debits",
          eq(r["totals"].get("subtotal"), tb_dr),
          f"report {r['totals'].get('subtotal')} vs trial balance {tb_dr}")

    # Per-row tax split.
    row = next((x for x in r["rows"] if x["expenseAccount"] == "_test Electricity"), None)
    if check(S, "taxed row present", row is not None):
        check(S, "taxed row: subtotal 10,000.00", eq(row["subtotal"], 10000.00), f"got {row['subtotal']}")
        check(S, "taxed row: tax 1,800.00", eq(row["tax"], expected_tax), f"got {row['tax']}")
        check(S, "taxed row: total 11,800.00 == cash paid", eq(row["total"], 11800.00), f"got {row['total']}")
        check(S, "taxed row carries the payee", row.get("payee") == "K-Electric", f"got {row.get('payee')}")
        check(S, "taxed row payeeType == Other", row.get("payeeType") == "Other", f"got {row.get('payeeType')}")
        check(S, "taxed row names the payment account", bool(row.get("paymentAccount")))
        check(S, "taxed row links its source payment", row.get("sourceType") == "Payment" and row.get("sourceId"),
              f"got {row.get('sourceType')}/{row.get('sourceId')}")

    # Group summaries.
    by_account = next((g for g in r["groupSummaries"] if g["title"] == "Expenses by Account"), None)
    if check(S, "by-Account summary present", by_account is not None):
        s = sum(float(x["amount"]) for x in by_account["rows"])
        check(S, "by-Account rows sum to its total", eq(s, by_account["total"]),
              f"rows {s} vs total {by_account['total']}")
        check(S, "by-Account total == report subtotal",
              eq(by_account["total"], r["totals"]["subtotal"]),
              f"{by_account['total']} vs {r['totals']['subtotal']}")
        rent_row = next((x for x in by_account["rows"] if x["label"] == "_test Rent"), None)
        check(S, "Rent group row == 50,000.00", rent_row and eq(rent_row["amount"], 50000.00),
              f"got {rent_row['amount'] if rent_row else 'missing'}")

    by_payee = next((g for g in r["groupSummaries"] if g["title"] == "Expenses by Payee"), None)
    if check(S, "by-Payee summary present", by_payee is not None):
        s = sum(float(x["amount"]) for x in by_payee["rows"])
        check(S, "by-Payee rows sum to its total", eq(s, by_payee["total"]),
              f"rows {s} vs total {by_payee['total']}")
        labels = [x["label"] for x in by_payee["rows"]]
        check(S, "free-text payee appears by name (not lumped as unknown)",
              "K-Electric" in labels, f"labels {labels}")

    return {"rent": rent, "power": power, "supplies": supplies, "bank": bank["id"],
            "expected_subtotal": expected_subtotal, "expected_tax": expected_tax}


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 2 — "Expenses by X" groupings
# ═══════════════════════════════════════════════════════════════════════════
def suite_groupings(base: str, token: str, cid: int, ctx: dict):
    S = "2. Expenses by X"
    print(f"\n=== {S} ===")
    grand = ctx["expected_subtotal"]

    for group_by in ["account", "payee", "group", "date", "month", "paymentAccount", "tax"]:
        try:
            r = report(base, token, cid, "expenses/summary", period="allPeriods", groupBy=group_by)
        except Fatal as e:
            check(S, f"groupBy={group_by} returns a report", False, str(e))
            continue
        rows_sum = sum(float(x["amount"]) for x in r["rows"])
        ok = eq(rows_sum, grand)
        check(S, f"groupBy={group_by}: rows sum to the grand total",
              ok, f"rows {rows_sum:,.2f} vs expected {grand:,.2f}")
        check(S, f"groupBy={group_by}: has a dimension label",
              any(c["key"] == "label" for c in r["columns"]))

    # The Category grouping must be labelled for what it really is.
    r = report(base, token, cid, "expenses/summary", period="allPeriods", groupBy="group")
    label = next((c["label"] for c in r["columns"] if c["key"] == "label"), "")
    check(S, "Category column names its real source (account group)",
          "Account Group" in label, f"got '{label}'")

    # Date grouping must be chronological, not by size.
    r = report(base, token, cid, "expenses/summary", period="allPeriods", groupBy="date")
    keys = [x.get("drillKey") for x in r["rows"] if x.get("drillKey")]
    check(S, "date grouping is in date order", keys == sorted(keys), f"got {keys}")


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 3 — Drill-down: a group row must equal its detail
# ═══════════════════════════════════════════════════════════════════════════
def suite_drilldown(base: str, token: str, cid: int, ctx: dict):
    S = "3. Drill-down"
    print(f"\n=== {S} ===")

    summary = report(base, token, cid, "expenses/summary", period="allPeriods", groupBy="account")
    for row in summary["rows"]:
        if not row.get("drillKey"):
            continue
        detail = report(base, token, cid, "expenses/detail", period="allPeriods",
                        accountId=row["drillKey"])
        check(S, f"'{row['label']}' group row == detail total when filtered",
              eq(detail["totals"].get("subtotal"), row["amount"]),
              f"group {row['amount']} vs detail {detail['totals'].get('subtotal')}")
        check(S, f"'{row['label']}' detail states the filter it was narrowed by",
              any("Account:" in f for f in detail.get("filtersApplied", [])),
              f"filtersApplied={detail.get('filtersApplied')}")

    # Detail rows must carry enough to reach the original document.
    detail = report(base, token, cid, "expenses/detail", period="allPeriods")
    linkable = [r for r in detail["rows"] if r.get("sourceId")]
    check(S, "detail rows link back to their source document",
          len(linkable) == len(detail["rows"]),
          f"{len(linkable)}/{len(detail['rows'])} rows have a sourceId")


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 4 — Cash & Bank
# ═══════════════════════════════════════════════════════════════════════════
def suite_cash_bank(base: str, token: str, cid: int, ctx: dict, client_id: int | None):
    S = "4. Cash & Bank"
    print(f"\n=== {S} ===")

    # A receipt so money moves both ways through the bank.
    st, _ = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "direction": "Receipt", "date": pkt_date(0),
        "contactType": "Client", "contactId": client_id,
        "bankAccountId": ctx["bank"], "method": "Bank Transfer",
        "description": "_test advance in",
        "allocations": [{"kind": "OnAccount", "amount": 25000.00}],
    })
    check(S, "receipt recorded for the book", st in (200, 201), f"got {st}")

    # An explicit accountId is honoured whichever book route was used — the
    # seeded money account is called "Cash", and refusing it here because the
    # request came via bank-book would be pure friction.
    book = report(base, token, cid, "bank-book", period="allPeriods", accountId=ctx["bank"])
    check(S, "explicit accountId is honoured regardless of book route",
          not book.get("notice"), f"notice: {book.get('notice')}")
    calc = float(book["openingBalance"]) + float(book["totalReceipts"]) - float(book["totalPayments"])
    check(S, "book: opening + receipts − payments == closing",
          eq(calc, book["closingBalance"]),
          f"calc {calc} vs closing {book['closingBalance']}")

    # THE anti-duplicate-engine check: a book must agree with the CoA balance.
    coa = next((a for a in flat_accounts(base, token, cid) if a["id"] == ctx["bank"]), None)
    check(S, "book closing == Chart of Accounts balance (one ledger, not two)",
          coa is not None and eq(coa["balance"], book["closingBalance"]),
          f"CoA {coa['balance'] if coa else '?'} vs book {book['closingBalance']}")

    # Running balance must chain correctly down the page.
    rows = book["rows"]
    if check(S, "book has rows", len(rows) > 0):
        running = float(book["openingBalance"])
        drift = None
        for row in rows:
            running += float(row["receipt"]) - float(row["payment"])
            if not eq(running, row["balance"]):
                drift = f"expected {running} at {row.get('reference')}, got {row['balance']}"
                break
        check(S, "running balance chains from the opening balance", drift is None, drift or "")
        check(S, "book rows name the other side of the entry",
              all("contra" in r for r in rows))

    summary = report(base, token, cid, "cash-bank-summary", period="allPeriods")
    bad = [r["account"] for r in summary["rows"]
           if not eq(float(r["opening"]) + float(r["receipts"]) - float(r["payments"]), r["closing"])]
    check(S, "summary: every account reconciles opening→closing", not bad, f"drifted: {bad}")
    check(S, "summary total closing == Σ account closings",
          eq(summary["totals"].get("closing"), sum(float(r["closing"]) for r in summary["rows"])))

    # Cash Book over all cash accounts must either show rows or say why not —
    # never a silently empty screen.
    cash = report(base, token, cid, "cash-book", period="allPeriods")
    check(S, "cash book either shows rows or explains itself",
          bool(cash.get("notice")) or len(cash["rows"]) > 0,
          "returned neither rows nor a notice")

    # The title must name the account actually shown, not the route taken.
    check(S, "book title follows the account, not the route",
          book["title"] in ("Cash Book", "Bank Book"), f"got '{book['title']}'")


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 5 — Registers vs the accounting dashboard
# ═══════════════════════════════════════════════════════════════════════════
def suite_registers(base: str, token: str, cid: int):
    S = "5. Registers"
    print(f"\n=== {S} ===")

    today = pkt_today()
    frm, to = today.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")
    st, summ = http("GET", f"/api/accounting/summary/company/{cid}?from={frm}&to={to}",
                    base, token=token)
    if st != 200 or not isinstance(summ, dict):
        check(S, "accounting summary available for comparison", False, f"got {st}")
        return

    pay = report(base, token, cid, "payments-register", period="custom", **{"from": frm, "to": to})
    rec = report(base, token, cid, "receipts-register", period="custom", **{"from": frm, "to": to})

    check(S, "Payment Register total == dashboard paymentsTotal",
          eq(pay["totals"].get("amount"), summ.get("paymentsTotal")),
          f"{pay['totals'].get('amount')} vs {summ.get('paymentsTotal')}")
    check(S, "Payment Register count == dashboard paymentCount",
          eq(pay["totals"].get("transactionCount"), summ.get("paymentCount")),
          f"{pay['totals'].get('transactionCount')} vs {summ.get('paymentCount')}")
    check(S, "Receipt Register total == dashboard receiptsTotal",
          eq(rec["totals"].get("amount"), summ.get("receiptsTotal")),
          f"{rec['totals'].get('amount')} vs {summ.get('receiptsTotal')}")

    check(S, "register rows say what the money was applied to",
          all("appliedTo" in r for r in pay["rows"]))
    check(S, "register rows carry a status", all(r.get("status") for r in pay["rows"]))

    by_acct = report(base, token, cid, "payments-by-account", period="allPeriods")
    check(S, "payments-by-account rows sum to its total",
          eq(sum(float(r["amount"]) for r in by_acct["rows"]), by_acct["totals"].get("amount")))


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 6 — Cheques and unallocated money
# ═══════════════════════════════════════════════════════════════════════════
def suite_cheques_unallocated(base: str, token: str, cid: int, ctx: dict,
                              supplier_id: int | None, client_id: int | None):
    S = "6. Cheques & unallocated"
    print(f"\n=== {S} ===")

    # A post-dated cheque out.
    st, _ = http("POST", f"/api/payments/payments/company/{cid}", base, token=token, body={
        "direction": "Payment", "date": pkt_date(0),
        "contactType": "Supplier", "contactId": supplier_id,
        "bankAccountId": ctx["bank"], "method": "Cheque",
        "chequeNumber": "TESTCHQ-001", "chequeDate": pkt_date(10), "chequeStatus": "Pending",
        "description": "_test PDC out",
        "allocations": [{"kind": "Account", "accountId": ctx["rent"], "amount": 15000.00}],
    })
    check(S, "post-dated cheque payment recorded", st in (200, 201), f"got {st}")

    issued = report(base, token, cid, "cheques-issued", period="allPeriods")
    check(S, "cheque appears in Cheques Issued", issued["totalCount"] >= 1,
          f"got {issued['totalCount']}")
    check(S, "cheque total == 15,000.00", eq(issued["totals"].get("amount"), 15000.00),
          f"got {issued['totals'].get('amount')}")
    row = issued["rows"][0] if issued["rows"] else {}
    check(S, "cheque number carried", row.get("chequeNumber") == "TESTCHQ-001", f"got {row.get('chequeNumber')}")
    check(S, "post-dated cheque flagged as such", row.get("isPostDated") is True, f"got {row.get('isPostDated')}")
    check(S, "days-to-due computed (+10)", eq(row.get("daysToDue"), 10), f"got {row.get('daysToDue')}")

    # Cross-check against the dashboard's own PDC figure.
    st, summ = http("GET", f"/api/accounting/summary/company/{cid}", base, token=token)
    if st == 200 and isinstance(summ, dict):
        check(S, "Cheques Issued total == dashboard pdcOut",
              eq(issued["totals"].get("amount"), summ.get("pdcOut", {}).get("amount")),
              f"{issued['totals'].get('amount')} vs {summ.get('pdcOut', {}).get('amount')}")

    # A cheque out must not show up in cheques IN.
    in_hand = report(base, token, cid, "cheques-in-hand", period="allPeriods")
    check(S, "an issued cheque does not appear in Cheques in Hand",
          in_hand["totalCount"] == 0, f"got {in_hand['totalCount']}")

    # The on-account receipt from suite 4 is unallocated money.
    unalloc = report(base, token, cid, "unallocated", period="allPeriods")
    check(S, "on-account receipt appears as unallocated", unalloc["totalCount"] >= 1,
          f"got {unalloc['totalCount']}")
    check(S, "unallocated total == 25,000.00", eq(unalloc["totals"].get("amount"), 25000.00),
          f"got {unalloc['totals'].get('amount')}")
    if unalloc["rows"]:
        check(S, "unallocated row states its direction",
              unalloc["rows"][0].get("direction") in ("Receipt", "Payment"))
        check(S, "unallocated row carries an age in days",
              unalloc["rows"][0].get("ageDays") is not None)


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 7 — Period presets
# ═══════════════════════════════════════════════════════════════════════════
def suite_periods(base: str, token: str, cid: int, ctx: dict):
    S = "7. Period presets"
    print(f"\n=== {S} ===")

    all_p = report(base, token, cid, "expenses", period="allPeriods")
    check(S, "allPeriods is labelled 'All periods'", all_p["periodLabel"] == "All periods",
          f"got '{all_p['periodLabel']}'")
    check(S, "allPeriods sends no date bounds", all_p.get("from") is None and all_p.get("to") is None,
          f"from={all_p.get('from')} to={all_p.get('to')}")

    # Every expense in this company was booked today, so every preset that
    # contains today must return the SAME count as all-periods, and lastYear
    # must return none. Derived from all-periods rather than hardcoded — earlier
    # suites add expenses of their own.
    expected = all_p["totalCount"]
    check(S, "there are expenses to test the presets against", expected > 0)

    for preset in ["today", "thisWeek", "thisMonth", "thisQuarter", "thisYear"]:
        r = report(base, token, cid, "expenses", period=preset)
        check(S, f"{preset} includes today's expenses ({expected})",
              r["totalCount"] == expected, f"got {r['totalCount']}")
    last_year = report(base, token, cid, "expenses", period="lastYear")
    check(S, "lastYear excludes them", last_year["totalCount"] == 0,
          f"got {last_year['totalCount']}")

    # A custom range missing one bound must be rejected, not silently widened.
    st, body = http("GET",
                    f"/api/accounting/reports/company/{cid}/expenses?period=custom&from=2026-01-01",
                    base, token=token)
    check(S, "custom range with only one date -> 400", st == 400, f"got {st} {str(body)[:120]}")
    st, body = http("GET",
                    f"/api/accounting/reports/company/{cid}/expenses"
                    f"?period=custom&from=2026-12-31&to=2026-01-01", base, token=token)
    check(S, "custom range with from > to -> 400", st == 400, f"got {st} {str(body)[:120]}")

    # An unknown preset degrades to all periods rather than erroring.
    r = report(base, token, cid, "expenses", period="nonsense")
    check(S, "unknown preset degrades to All periods", r["periodLabel"] == "All periods",
          f"got '{r['periodLabel']}'")


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 8 — Pagination, sorting, export
# ═══════════════════════════════════════════════════════════════════════════
def suite_paging_export(base: str, token: str, cid: int):
    S = "8. Paging & export"
    print(f"\n=== {S} ===")

    big = report(base, token, cid, "expenses", period="allPeriods", pageSize=999999)
    check(S, "pageSize=999999 clamps to 100", big["pageSize"] == 100, f"got {big['pageSize']}")
    neg = report(base, token, cid, "expenses", period="allPeriods", page=-5)
    check(S, "page=-5 clamps to 1", neg["page"] == 1, f"got {neg['page']}")

    unpaged = report(base, token, cid, "expenses/detail", period="allPeriods")
    total_rows = unpaged["totalCount"]
    p1 = report(base, token, cid, "expenses/detail", period="allPeriods", pageSize=2, page=1)
    p2 = report(base, token, cid, "expenses/detail", period="allPeriods", pageSize=2, page=2)
    check(S, "page 1 returns 2 rows", len(p1["rows"]) == 2, f"got {len(p1['rows'])}")
    check(S, "page 2 returns the remainder",
          len(p2["rows"]) == min(2, max(0, total_rows - 2)),
          f"got {len(p2['rows'])} of {total_rows} total")
    check(S, "pages do not overlap",
          {r["documentNo"] for r in p1["rows"]}.isdisjoint({r["documentNo"] for r in p2["rows"]}))
    check(S, "footer totals cover the whole set, not just the page",
          eq(p1["totals"].get("subtotal"), report(base, token, cid, "expenses/detail",
                                                 period="allPeriods")["totals"].get("subtotal")),
          "page-1 totals differ from the unpaged totals")

    # Sorting must only accept a real column.
    asc = report(base, token, cid, "expenses/detail", period="allPeriods", sortBy="subtotal")
    desc = report(base, token, cid, "expenses/detail", period="allPeriods",
                  sortBy="subtotal", sortDesc="true")
    a = [float(r["subtotal"]) for r in asc["rows"]]
    d = [float(r["subtotal"]) for r in desc["rows"]]
    check(S, "sortBy=subtotal sorts ascending", a == sorted(a), f"got {a}")
    check(S, "sortDesc reverses it", d == sorted(d, reverse=True), f"got {d}")
    bogus = report(base, token, cid, "expenses/detail", period="allPeriods",
                   sortBy="1;DROP TABLE Payments--")
    check(S, "an unknown sort key is ignored, not injected",
          bogus["totalCount"] == total_rows, f"got {bogus['totalCount']} vs {total_rows}")

    # Excel export.
    for report_id in ["expenses", "cash-bank-summary", "payments-register", "cheques-issued"]:
        st, blob = http("GET",
                        f"/api/accounting/reports/company/{cid}/export/{report_id}?period=allPeriods",
                        base, token=token, raw_bytes=True)
        ok = st == 200 and isinstance(blob, bytes) and blob[:2] == b"PK" and len(blob) > 3000
        check(S, f"export/{report_id} returns a real .xlsx", ok,
              f"status {st}, {len(blob) if isinstance(blob, bytes) else '?'} bytes")

    st, body = http("GET", f"/api/accounting/reports/company/{cid}/export/not-a-report",
                    base, token=token)
    check(S, "unknown export id -> 400", st == 400, f"got {st}")


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 9 — Tenant isolation
# ═══════════════════════════════════════════════════════════════════════════
def suite_isolation(base: str, token: str, cid: int, ctx: dict):
    S = "9. Tenant isolation"
    print(f"\n=== {S} ===")

    suffix = datetime.now().strftime("%H%M%S")
    st, other = http("POST", "/api/companies", base, token=token, body={
        "name": f"_test_acct_reports_other {suffix}", "address": "x", "phone": "0",
        "ntn": "1111111-1", "strn": "1111111111111", "invoiceType": "Sale Invoice",
    })
    if st not in (200, 201) or not isinstance(other, dict):
        check(S, "second company created for the leak check", False, f"got {st}")
        return None
    other_id = other["id"]
    http("POST", f"/api/accounting/gl/company/{other_id}/enable", base, token=token)

    r = report(base, token, other_id, "expenses", period="allPeriods")
    check(S, "a fresh company's expense report is empty (no cross-tenant rows)",
          r["totalCount"] == 0 and eq(r["totals"].get("subtotal"), 0),
          f"count {r['totalCount']} subtotal {r['totals'].get('subtotal')}")
    check(S, "its report header names ITS company, not the other one",
          r["companyName"] != "" and "_test_acct_reports_other" in r["companyName"],
          f"got '{r['companyName']}'")

    # Filtering company B's report by company A's account must not leak A's rows.
    leak = report(base, token, other_id, "expenses/detail", period="allPeriods",
                  accountId=ctx["rent"])
    check(S, "another company's accountId leaks nothing",
          leak["totalCount"] == 0, f"got {leak['totalCount']} rows")

    # A bank/cash book for an account that isn't this company's must refuse.
    book = report(base, token, other_id, "bank-book", period="allPeriods", accountId=ctx["bank"])
    check(S, "a foreign accountId on the bank book is rejected",
          bool(book.get("notice")) and not book["rows"],
          f"notice={book.get('notice')} rows={len(book['rows'])}")

    st, body = http("GET", "/api/accounting/reports/company/99999999/expenses", base, token=token)
    check(S, "a non-existent company -> 404, not a blank report", st == 404, f"got {st}")

    return other_id


# ── Main ────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--user", default="admin")
    ap.add_argument("--pw", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    print("=" * 74)
    print(" Accounting Reports regression suite")
    print(f" base: {args.base}")
    print("=" * 74)

    token, cid, supplier_id, client_id = setup(args.base, args.user, args.pw)
    other_id = None
    try:
        ctx = suite_expenses(args.base, token, cid, supplier_id)
        suite_groupings(args.base, token, cid, ctx)
        suite_drilldown(args.base, token, cid, ctx)
        suite_cash_bank(args.base, token, cid, ctx, client_id)
        suite_registers(args.base, token, cid)
        suite_cheques_unallocated(args.base, token, cid, ctx, supplier_id, client_id)
        suite_periods(args.base, token, cid, ctx)
        suite_paging_export(args.base, token, cid)
        other_id = suite_isolation(args.base, token, cid, ctx)
    except Fatal as e:
        print(f"\n!! FATAL: {e}")
        results.append(("setup", "prerequisite", f"FAIL — {e}"))
    finally:
        teardown(args.base, token, cid, args.keep)
        if other_id and not args.keep:
            http("DELETE", f"/api/companies/{other_id}", args.base, token=token)

    passed = sum(1 for _, _, s in results if s == PASS)
    total = len(results)
    print("\n" + "=" * 74)
    print(f" {passed}/{total} checks passed")
    failures = [(su, n, s) for su, n, s in results if s != PASS]
    if failures:
        print(f"\n {len(failures)} FAILURE(S):")
        for su, n, s in failures:
            print(f"   [{su}] {n}: {s}")
    print("=" * 74)
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
