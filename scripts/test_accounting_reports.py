"""
Accounting Reports regression tests — Expenses, Cash & Bank,
Customers/Suppliers and the Financial Statements, with their drill-downs,
exports and RBAC scoping.

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


def report_is_gone(base: str, token: str, cid: int, path: str) -> tuple[bool, str]:
    """True when `path` no longer serves a report.

    Not simply a 404 check: this app's SPA fallback answers an unmatched /api
    path with the shell (200 text/html), so a removed endpoint stops returning
    JSON rather than starting to return 404. What matters is that no report
    comes back.
    """
    req = urllib.request.Request(
        f"{base}/api/accounting/reports/company/{cid}/{path}",
        headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode("utf-8", "replace")
            status = r.status
    except urllib.error.HTTPError as e:
        return True, f"http {e.code}"
    except Exception as e:                      # network-level failure
        return False, f"request failed: {e}"
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return True, f"http {status}, not JSON ({body[:24].strip()!r})"
    looks_like_report = isinstance(parsed, dict) and "totals" in parsed and "columns" in parsed
    return (not looks_like_report), f"http {status}, report={looks_like_report}"


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
        # Without these the create paths reject every document with
        # "Starting invoice number has not been set for this company".
        "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1,
        "startingChallanNumber": 1,
        "startingGoodsReceiptNumber": 1,
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


def first_item_type_id(base: str, token: str) -> int | None:
    """Bills require a classified line, so every document here needs an item type."""
    st, rows = http("GET", "/api/itemtypes", base, token=token)
    if st == 200 and isinstance(rows, list) and rows:
        return rows[0].get("id")
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
            "expected_subtotal": expected_subtotal, "expected_tax": expected_tax,
            "clientId": None, "supplierId": supplier_id}


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

    # A party report is the most sensitive of all: it names who owes what.
    for path in ["customer-ledger", "customer-statement", "customer-balances",
                 "supplier-ledger", "supplier-balances", "receivables-aging",
                 "customer-outstanding", "customer-sales", "general-ledger",
                 "account-balances", "trial-balance-report", "sales-register",
                 "purchase-register", "sales-summary", "credit-debit-notes",
                 "tax-summary", "output-tax", "tax-transactions", "journal-register",
                 "revenue-summary", "cash-flow"]:
        r = report(base, token, other_id, path, period="allPeriods")
        rows = r.get("rows") or []
        check(S, f"{path} on a fresh company returns no other tenant's parties",
              len(rows) == 0, f"got {len(rows)} rows")

    # Another company's client id must not pull that client's ledger.
    leak = report(base, token, other_id, "customer-ledger", period="allPeriods", clientId=ctx["clientId"])
    check(S, "a foreign clientId leaks no ledger rows", len(leak.get("rows") or []) == 0,
          f"got {len(leak.get('rows') or [])} rows")

    st, body = http("GET", "/api/accounting/reports/company/99999999/expenses", base, token=token)
    check(S, "a non-existent company -> 404, not a blank report", st == 404, f"got {st}")

    return other_id


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 10 — Customer & supplier ledgers
# ═══════════════════════════════════════════════════════════════════════════
def suite_party_ledgers(base: str, token: str, cid: int, ctx: dict,
                        client_id: int | None, supplier_id: int | None):
    S = "10. Party ledgers"
    print(f"\n=== {S} ===")

    accounts = flat_accounts(base, token, cid)
    ar = pick(accounts, control="AccountsReceivable")
    ap = pick(accounts, control="AccountsPayable")
    if not ar or not ap:
        check(S, "seeded CoA has AR and AP control accounts", False, "missing")
        return

    # This suite gets its OWN customer. Suite 4 puts a 25,000 advance on the
    # shared one, which is realistic but makes exact ledger figures depend on
    # suite order — the first version of this suite asserted a 4,000 credit and
    # legitimately saw 29,000.
    st, ledger_client = http("POST", "/api/clients", base, token=token, body={
        "name": "_test Ledger Customer", "companyId": cid, "address": "x", "phone": "1",
    })
    if st in (200, 201) and isinstance(ledger_client, dict):
        client_id = ledger_client["id"]
    else:
        check(S, "dedicated ledger customer created", False, f"got {st}")
        return

    # A sale, a receipt against it, and a bill — enough for both sides to have a
    # ledger with a debit, a credit and a running balance.
    item_type = first_item_type_id(base, token)
    st, invoice = http("POST", "/api/invoices/standalone", base, token=token, body={
        "companyId": cid, "clientId": client_id, "date": pkt_date(0), "gstRate": 0,
        "items": [{"description": "_test ledger widget", "quantity": 2, "unitPrice": 5000,
                   "uom": "Pcs", "itemTypeId": item_type}],
    })
    if st not in (200, 201) or not isinstance(invoice, dict):
        check(S, "sales invoice created for the ledger", False, f"got {st} {str(invoice)[:200]}")
        return
    check(S, "sales invoice created for the ledger", True)
    invoice_total = float(invoice.get("grandTotal") or 0)

    st, _ = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "direction": "Receipt", "date": pkt_date(0),
        "contactType": "Client", "contactId": client_id,
        "bankAccountId": ctx["bank"], "method": "Bank Transfer",
        "allocations": [{"kind": "Document", "invoiceId": invoice["id"], "amount": 4000.00}],
    })
    check(S, "receipt allocated to the invoice", st in (200, 201), f"got {st}")

    # ── Customer ledger ──
    led = report(base, token, cid, "customer-ledger", period="allPeriods", clientId=client_id)
    check(S, "customer ledger is ledger-sourced on a GL company",
          led.get("ledgerSourced") is True, f"got {led.get('ledgerSourced')} — {led.get('notice')}")
    check(S, "customer ledger names the customer", bool(led.get("partyName")),
          f"got {led.get('partyName')}")
    check(S, f"customer ledger debit == invoice total {invoice_total:,.2f}",
          eq(led["totalDebit"], invoice_total), f"got {led.get('totalDebit')}")
    check(S, "customer ledger credit == 4,000.00", eq(led["totalCredit"], 4000.00),
          f"got {led.get('totalCredit')}")
    check(S, "customer ledger: opening + debit - credit == closing",
          eq(float(led["openingBalance"]) + float(led["totalDebit"]) - float(led["totalCredit"]),
             led["closingBalance"]),
          f"open {led['openingBalance']} dr {led['totalDebit']} cr {led['totalCredit']} close {led['closingBalance']}")
    check(S, "customer owing shows as a POSITIVE balance",
          float(led["closingBalance"]) > 0, f"got {led['closingBalance']}")

    # Running balance must chain from the opening figure.
    running = float(led["openingBalance"])
    drift = None
    for row in led["rows"]:
        running += float(row["debit"]) - float(row["credit"])
        if not eq(running, row["balance"]):
            drift = f"expected {running} at {row.get('reference')}, got {row['balance']}"
            break
    check(S, "customer ledger running balance chains correctly", drift is None, drift or "")
    check(S, "ledger rows name the transaction in plain words",
          all(r.get("transaction") for r in led["rows"]),
          f"missing on {[r.get('reference') for r in led['rows'] if not r.get('transaction')]}")
    kinds = {r["transaction"] for r in led["rows"]}
    check(S, "ledger distinguishes the invoice from the receipt",
          "Sales Invoice" in kinds and "Receipt" in kinds, f"got {kinds}")

    # ── Supplier ledger: the sign flip is the thing most easily got wrong ──
    st, bill = http("POST", "/api/purchasebills", base, token=token, body={
        "companyId": cid, "supplierId": supplier_id, "date": pkt_date(0), "gstRate": 0,
        "items": [{"description": "_test ledger stock", "quantity": 1, "unitPrice": 7000,
                   "uom": "Pcs", "itemTypeId": item_type}],
    })
    if st in (200, 201) and isinstance(bill, dict):
        check(S, "purchase bill created for the supplier ledger", True)
        sled = report(base, token, cid, "supplier-ledger", period="allPeriods", supplierId=supplier_id)
        check(S, "supplier ledger credit == bill total",
              eq(sled["totalCredit"], float(bill.get("grandTotal") or 0)),
              f"got {sled.get('totalCredit')} vs {bill.get('grandTotal')}")
        check(S, "money we OWE a supplier reads POSITIVE (sign flipped for payables)",
              float(sled["closingBalance"]) > 0, f"got {sled['closingBalance']}")
        check(S, "supplier ledger: opening + debit - credit, flipped, == closing",
              eq(-(float(sled["openingBalance"]) * -1 + float(sled["totalDebit"])
                   - float(sled["totalCredit"])), sled["closingBalance"]),
              f"dr {sled['totalDebit']} cr {sled['totalCredit']} close {sled['closingBalance']}")
    else:
        check(S, "purchase bill created for the supplier ledger", False, f"got {st} {str(bill)[:180]}")

    # ── All-parties view ──
    allp = report(base, token, cid, "customer-ledger", period="allPeriods")
    check(S, "all-customers ledger adds a Customer column",
          any(c["key"] == "party" for c in allp["columns"]),
          f"columns {[c['key'] for c in allp['columns']]}")
    check(S, "all-customers ledger names the party on each row",
          all(r.get("party") for r in allp["rows"]),
          "a row came back with no party name")

    return {"invoiceId": invoice["id"], "invoiceTotal": invoice_total}


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 11 — Statements
# ═══════════════════════════════════════════════════════════════════════════
def suite_statements(base: str, token: str, cid: int, client_id: int | None,
                     supplier_id: int | None):
    S = "11. Statements"
    print(f"\n=== {S} ===")

    stmt = report(base, token, cid, "customer-statement", period="allPeriods", clientId=client_id)
    check(S, "statement carries the addressee", bool((stmt.get("party") or {}).get("name")),
          f"got {stmt.get('party')}")
    check(S, "statement carries the company letterhead",
          bool((stmt.get("companyContact") or {}).get("name")), f"got {stmt.get('companyContact')}")
    check(S, "statement states an amount due", stmt.get("closingBalance") is not None)
    check(S, "statement carries an age breakdown", stmt.get("aging") is not None,
          "no aging block — the recipient cannot see how old the debt is")

    if stmt.get("aging"):
        a = stmt["aging"]
        parts = sum(float(a.get(k) or 0) for k in
                    ["current", "days1To30", "days31To60", "days61To90", "over90"])
        check(S, "aging buckets sum to the aging total", eq(parts, a.get("total")),
              f"buckets {parts} vs total {a.get('total')}")

    # The statement must agree with the ledger it is a presentation of.
    led = report(base, token, cid, "customer-ledger", period="allPeriods", clientId=client_id)
    check(S, "statement closing == ledger closing",
          eq(stmt["closingBalance"], led["closingBalance"]),
          f"statement {stmt['closingBalance']} vs ledger {led['closingBalance']}")

    sstmt = report(base, token, cid, "supplier-statement", period="allPeriods", supplierId=supplier_id)
    check(S, "supplier statement carries the addressee",
          bool((sstmt.get("party") or {}).get("name")))
    check(S, "supplier statement is titled as a supplier statement",
          sstmt["title"] == "Supplier Statement", f"got {sstmt['title']}")


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 12 — Balance summaries reconcile
# ═══════════════════════════════════════════════════════════════════════════
def suite_party_balances(base: str, token: str, cid: int, client_id: int | None,
                         supplier_id: int | None):
    S = "12. Balance summaries"
    print(f"\n=== {S} ===")

    for side, path, ledger_path, key, party in [
        ("customer", "customer-balances", "customer-ledger", "clientId", client_id),
        ("supplier", "supplier-balances", "supplier-ledger", "supplierId", supplier_id),
    ]:
        bal = report(base, token, cid, path, period="allPeriods")
        check(S, f"{side} balance summary returns rows", len(bal["rows"]) > 0,
              f"got {len(bal['rows'])}")
        check(S, f"{side} summary total == sum of its rows",
              eq(bal["totals"].get("closing"), sum(float(r["closing"]) for r in bal["rows"])))

        # THE consistency check: a party's summary row must equal that party's
        # ledger closing balance, or the two screens contradict each other.
        row = next((r for r in bal["rows"] if r["partyId"] == party), None)
        if check(S, f"{side} appears in the summary", row is not None):
            led = report(base, token, cid, ledger_path, period="allPeriods", **{key: party})
            check(S, f"{side} summary row == that party's ledger closing",
                  eq(row["closing"], led["closingBalance"]),
                  f"summary {row['closing']} vs ledger {led['closingBalance']}")
            check(S, f"{side} row carries a status", row.get("status") in
                  ("Owing", "Settled", "In credit"), f"got {row.get('status')}")

        # Any gap against aging must be REPORTED, not silent.
        gap = float(bal.get("unattributed") or 0)
        if abs(gap) > 0.005:
            check(S, f"{side}: a gap against aging is explained in a notice",
                  bool(bal.get("notice")), f"gap {gap:,.2f} with no notice")


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 13 — Aging, outstanding, and party trade
# ═══════════════════════════════════════════════════════════════════════════
def suite_aging_outstanding(base: str, token: str, cid: int, client_id: int | None):
    S = "13. Aging & outstanding"
    print(f"\n=== {S} ===")

    for side, aging_path, out_path in [
        ("receivables", "receivables-aging", "customer-outstanding"),
        ("payables", "payables-aging", "supplier-outstanding"),
    ]:
        aging = report(base, token, cid, aging_path, period="allPeriods")
        out = report(base, token, cid, out_path, period="allPeriods", pageSize=100)

        # Aging and Outstanding are NOT the same figure, and the difference is
        # meaningful: aging includes money sitting on a party's account with no
        # document (an advance), which a list of documents cannot show. So the
        # relationship to pin is:
        #     aging total  ==  outstanding total  +  net on-account for that side
        # A receipt on account reduces a receivable; a payment on account reduces
        # a payable. Pinning equality instead would pass only by luck, on data
        # that happens to have no advances.
        unalloc = report(base, token, cid, "unallocated", period="allPeriods", pageSize=200)
        want_receipt = (side == "receivables")
        on_account = 0.0
        for r in unalloc["rows"]:
            is_receipt = r["direction"] == "Receipt"
            party_is_client = r["contactType"] == "Client"
            if party_is_client != want_receipt:
                continue
            on_account += (-float(r["amount"]) if is_receipt == want_receipt
                           else float(r["amount"]))
        expected = float(out["totals"].get("outstanding") or 0) + on_account
        check(S, f"{side}: aging == outstanding + net on-account ({on_account:,.2f})",
              eq(aging["totals"].get("total"), expected),
              f"aging {aging['totals'].get('total')} vs outstanding+advances {expected}")

        # Age buckets and the Past Due total were removed (2026-09-03): each was
        # measured against what had been ALLOCATED to a document, and receipts
        # here are taken on account, so a settled customer's whole balance
        # showed as 90+ overdue. What remains is the party's balance as at a
        # date, which does not depend on how cash was allocated.
        gone = [k for k in ("current", "days1To30", "days31To60", "days61To90",
                            "over90", "overdueAmount")
                if k in (aging.get("totals") or {})]
        check(S, f"{side}: the balances report carries no age buckets or Past Due",
              not gone, f"still present: {gone}")
        check(S, f"{side}: no bucket columns remain",
              not [c for c in aging["columns"] if c["key"] in
                   ("current", "days1To30", "days31To60", "days61To90", "over90")],
              f"columns {[c['key'] for c in aging['columns']]}")
        check(S, f"{side}: it still states an as-of date",
              "As of" in aging.get("periodLabel", ""), f"got '{aging.get('periodLabel')}'")
        check(S, f"{side}: outstanding == total - paid on every row",
              all(eq(float(r["outstanding"]),
                     float(r["grandTotal"]) - float(r["withholdingTax"]) - float(r["paid"]))
                  for r in out["rows"]),
              "a row's outstanding does not equal total - withholding - paid")

    # ── Trade reports ──
    trade = report(base, token, cid, "customer-sales", period="allPeriods", pageSize=100)
    check(S, "customer sales returns item-level rows", trade["totalCount"] > 0,
          f"got {trade['totalCount']}")
    check(S, "line totals sum to the report total",
          eq(sum(float(r["lineTotal"]) for r in trade["rows"]), trade["totals"].get("lineTotal")),
          "page sum differs from the total (only valid while all rows fit one page)")
    check(S, "tax column is labelled as apportioned, not recorded",
          any("apportioned" in c["label"].lower() for c in trade["columns"]),
          f"columns {[c['label'] for c in trade['columns']]}")
    check(S, "there is no Discount column (the model stores none)",
          not any("discount" in c["key"].lower() for c in trade["columns"]),
          "a discount column appeared — it would be invented, not reported")
    grp = next((g for g in trade["groupSummaries"] if "Item Type" in g["title"]), None)
    if check(S, "sales are broken down by item type", grp is not None):
        check(S, "item-type rows sum to that block's total",
              eq(sum(float(r["amount"]) for r in grp["rows"]), grp["total"]))

    purch = report(base, token, cid, "supplier-purchases", period="allPeriods", pageSize=100)
    check(S, "supplier purchases returns item-level rows", purch["totalCount"] > 0,
          f"got {purch['totalCount']}")

    # ── Drill-down: aging -> that party's outstanding documents ──
    aging = report(base, token, cid, "receivables-aging", period="allPeriods")
    grp = next((g for g in aging["groupSummaries"] if g.get("drillFilter") == "clientId"), None)
    if check(S, "the balances report offers a per-customer drill-down", grp is not None and grp["rows"]):
        # Pick a party whose aging balance is made of documents ONLY. A party
        # carrying an on-account advance nets that into its aging row, so its
        # aging figure legitimately differs from its list of open documents.
        advances = report(base, token, cid, "unallocated", period="allPeriods", pageSize=200)
        advance_parties = {str(r["contactId"]) for r in advances["rows"] if r.get("contactId")}
        docs_party = next((r for r in grp["rows"]
                           if r["count"] > 0 and r["drillKey"] not in advance_parties), None)
        if check(S, "at least one customer has open documents to drill into",
                 docs_party is not None):
            detail = report(base, token, cid, "customer-outstanding", period="allPeriods",
                            clientId=docs_party["drillKey"], pageSize=200)
            check(S, f"'{docs_party['label'][:24]}' aging row == their outstanding total",
                  eq(detail["totals"].get("outstanding"), docs_party["amount"]),
                  f"aging {docs_party['amount']} vs outstanding {detail['totals'].get('outstanding')}")



# ═══════════════════════════════════════════════════════════════════════════
#  Suite 14 — Financial statements
# ═══════════════════════════════════════════════════════════════════════════
def suite_statements_financial(base: str, token: str, cid: int):
    S = "14. Financial statements"
    print(f"\n=== {S} ===")

    # ── Balance sheet ──
    bs = report(base, token, cid, "balance-sheet", period="thisYear")
    check(S, "balance sheet is titled as at a date",
          bs["periodLabel"].startswith("As at"), f"got '{bs['periodLabel']}'")
    check(S, "balance sheet reports a balance check", bs.get("difference") is not None)

    # THE assertion for a balance sheet. Anything else about it is secondary.
    check(S, "ASSETS == LIABILITIES + EQUITY",
          eq(bs["totalAssets"], float(bs["totalLiabilities"]) + float(bs["totalEquity"])),
          f"assets {bs['totalAssets']} vs L+E "
          f"{float(bs['totalLiabilities']) + float(bs['totalEquity'])}")
    check(S, "isBalanced agrees with the arithmetic",
          bs["isBalanced"] == (abs(float(bs["difference"])) < 0.01),
          f"isBalanced {bs['isBalanced']} difference {bs['difference']}")

    kinds = {r["kind"] for r in bs["rows"]}
    check(S, "statement lines carry a kind (group/account/subtotal/total)",
          {"group", "subtotal", "total"} <= kinds, f"got {kinds}")
    check(S, "statement lines carry an indent level",
          all("level" in r for r in bs["rows"] if r["kind"] != "spacer"))
    check(S, "account lines are drillable, headings are not",
          all(r.get("accountId") for r in bs["rows"] if r["kind"] == "account"
              and r["label"] != "Current-Year Earnings"),
          "an account line came back with no accountId")

    # Equity must contain the synthetic earnings line, or the sheet cannot balance.
    labels = [r["label"] for r in bs["rows"]]
    pl_check = report(base, token, cid, "profit-loss", period="thisYear")
    if abs(float(pl_check["netProfit"])) > 0.01:
        check(S, "equity carries a Current-Year Earnings line",
              "Current-Year Earnings" in labels,
              "without it assets exceed liabilities + equity by the net profit")

    comp = report(base, token, cid, "balance-sheet", period="thisYear", comparative="true")
    check(S, "comparative column is labelled with its own date",
          bool(comp.get("comparativeLabel")), f"got {comp.get('comparativeLabel')}")
    check(S, "comparative figures are present on account lines",
          any(r.get("comparative") is not None for r in comp["rows"]))

    no_comp = report(base, token, cid, "balance-sheet", period="thisYear", comparative="false")
    check(S, "comparative can be turned off", no_comp.get("comparativeLabel") is None,
          f"got {no_comp.get('comparativeLabel')}")
    check(S, "without a comparative there are only 2 columns",
          len(no_comp["columns"]) == 2, f"got {[c['key'] for c in no_comp['columns']]}")

    # ── Profit & loss ──
    pl = report(base, token, cid, "profit-loss", period="thisYear")
    check(S, "P&L net profit == income - cost of sales - expenses",
          eq(pl["netProfit"], float(pl["totalIncome"]) - float(pl["totalCostOfSales"])
             - float(pl["totalExpenses"])),
          f"net {pl['netProfit']} vs computed "
          f"{float(pl['totalIncome']) - float(pl['totalCostOfSales']) - float(pl['totalExpenses'])}")
    check(S, "income is presented POSITIVE (credit-natural, flipped once)",
          float(pl["totalIncome"]) >= 0, f"got {pl['totalIncome']}")
    check(S, "gross profit is only offered when cost of sales has activity",
          (pl.get("grossProfit") is not None) == bool(pl.get("grossProfitMeaningful")),
          f"grossProfit {pl.get('grossProfit')} meaningful {pl.get('grossProfitMeaningful')}")

    # ── The cross-check that matters: statements vs the trial balance ──
    tb = report(base, token, cid, "trial-balance-report", period="thisYear")
    tb_income = -sum(float(r["debit"]) - float(r["credit"])
                     for r in tb["rows"] if r["accountType"] == "Income")
    tb_expense = sum(float(r["debit"]) - float(r["credit"])
                     for r in tb["rows"] if r["accountType"] == "Expense")
    check(S, "P&L net profit == trial balance income - expenses",
          eq(pl["netProfit"], tb_income - tb_expense),
          f"P&L {pl['netProfit']} vs trial balance {tb_income - tb_expense}")
    check(S, "trial balance: total debit == total credit",
          eq(tb["totals"].get("debit"), tb["totals"].get("credit")),
          f"dr {tb['totals'].get('debit')} cr {tb['totals'].get('credit')}")

    # ── General ledger ──
    gl = report(base, token, cid, "general-ledger", period="thisYear", pageSize=100)
    check(S, "general ledger returns postings", gl["totalCount"] > 0, f"got {gl['totalCount']}")
    check(S, "general ledger: total debit == total credit over the whole ledger",
          eq(gl["totals"].get("debit"), gl["totals"].get("credit")),
          f"dr {gl['totals'].get('debit')} cr {gl['totals'].get('credit')}")
    check(S, "general ledger agrees with the trial balance on total debit",
          eq(gl["totals"].get("debit"), tb["totals"].get("debit")),
          f"GL {gl['totals'].get('debit')} vs TB {tb['totals'].get('debit')}")
    check(S, "no running-balance column across all accounts (it would be meaningless)",
          not any(c["key"] == "balance" for c in gl["columns"]),
          "a balance column appeared on the all-accounts view")
    check(S, "GL rows name the account and the entry",
          all(r.get("account") and r.get("entryRef") for r in gl["rows"]))

    # Scoped to one account, the running balance appears and must chain.
    accounts = flat_accounts(base, token, cid)
    posted = next((a for a in accounts if abs(float(a.get("balance") or 0)) > 0.01), None)
    if check(S, "an account with activity exists to scope the GL to", posted is not None):
        one = report(base, token, cid, "general-ledger", period="allPeriods",
                     accountId=posted["id"], pageSize=200)
        check(S, "single-account GL adds the running balance column",
              any(c["key"] == "balance" for c in one["columns"]))
        if one["rows"]:
            drift = None
            prev = None
            for r in one["rows"]:
                if prev is not None:
                    expected = prev + float(r["debit"]) - float(r["credit"])
                    if not eq(expected, r["balance"]):
                        drift = f"expected {expected} at {r['entryRef']}, got {r['balance']}"
                        break
                prev = float(r["balance"])
            check(S, "single-account running balance chains row to row", drift is None, drift or "")
            check(S, "single-account GL closing == the CoA balance for that account",
                  eq(one["rows"][-1]["balance"], posted["balance"]),
                  f"GL {one['rows'][-1]['balance']} vs CoA {posted['balance']}")

    # ── Account balance summary ──
    ab = report(base, token, cid, "account-balances", period="thisYear")
    check(S, "account balances returns rows", ab["totalCount"] > 0, f"got {ab['totalCount']}")
    check(S, "account balances total debit == trial balance total debit",
          eq(ab["totals"].get("debit"), tb["totals"].get("debit")),
          f"{ab['totals'].get('debit')} vs {tb['totals'].get('debit')}")
    check(S, "every row reconciles: opening + debit - credit == closing",
          all(eq(float(r["opening"]) + float(r["debit"]) - float(r["credit"]), r["closing"])
              for r in ab["rows"]),
          "a row does not reconcile")
    check(S, "rows carry the account group, for filtering",
          any(r.get("accountGroup") for r in ab["rows"]))

    # Filter by account type via the Status control.
    exp_only = report(base, token, cid, "account-balances", period="allPeriods", status="Expense")
    check(S, "account balances can be filtered to one account type",
          all(r["accountType"] == "Expense" for r in exp_only["rows"]),
          f"got types {set(r['accountType'] for r in exp_only['rows'])}")

    # ── Exports ──
    for rid in ["balance-sheet", "profit-loss", "general-ledger", "account-balances",
                "trial-balance-report"]:
        st, blob = http("GET",
                        f"/api/accounting/reports/company/{cid}/export/{rid}?period=thisYear",
                        base, token=token, raw_bytes=True)
        ok = st == 200 and isinstance(blob, bytes) and blob[:2] == b"PK" and len(blob) > 2000
        check(S, f"export/{rid} returns a real .xlsx", ok,
              f"status {st}, {len(blob) if isinstance(blob, bytes) else '?'} bytes")


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 15 — Sales & purchase registers and summaries
# ═══════════════════════════════════════════════════════════════════════════
def suite_sales_detail(base: str, token: str, cid: int):
    """Sales Detail — one row per invoice LINE, in the operator's own shape.

    Built to be diffed against their "Sales Detail" workbook, so the column set
    and its order ARE the requirement. The cross-checks that matter:

      * the money identities hold on every row (Incl = Excl + S.Tax, and
        Total = Incl + 236-G + Further)
      * the footer adds up the WHOLE result set, not the page
      * a document's own reference is split into prefix / number / combined,
        the three columns a spreadsheet needs to rebuild the label
      * an OPENING BALANCE never appears: it is a figure brought forward from
        the old books, not something that was sold
      * sales tax comes from Helpers/FbrLineTax, the same helper that fills the
        FBR payload, so the register and the filing cannot disagree
    """
    S = "16. Sales Detail"
    print(f"\n=== {S} ===")

    rep = report(base, token, cid, "sales-detail", period="allPeriods", pageSize=200)

    # The workbook's columns, in the workbook's order.
    want = ["S. No", "Date", "Month", "DC", "DC No:-", "DC #", "R", "No", "Inv #",
            "Party Name", "Address", "Ntn", "HS CODE", "Description", "U", "Qty",
            "Rate", "Excl", "Tax Rate", "S.Tax", "Incl", "236-G Tax",
            "Further Tax", "Total Amt"]
    got = [c["label"] for c in rep["columns"]]
    check(S, "the columns match the operator's sheet, in order", got == want,
          f"got {got}")
    check(S, "it is titled Sales Detail", rep["title"] == "Sales Detail",
          f"got {rep['title']}")

    if not check(S, "the report returns lines", rep["totalCount"] > 0,
                 f"got {rep['totalCount']}"):
        return

    rows = rep["rows"]

    # Per-row money identities. These are what make the sheet add up.
    bad_incl = [r["invRef"] for r in rows
                if not eq(float(r["excl"]) + float(r["salesTax"]), r["incl"])]
    check(S, "Incl == Excl + S.Tax on every row", not bad_incl,
          f"wrong on {bad_incl[:4]}")

    bad_total = [r["invRef"] for r in rows
                 if not eq(float(r["incl"]) + float(r["advanceTax"]) + float(r["furtherTax"]),
                           r["totalAmt"])]
    check(S, "Total Amt == Incl + 236-G + Further on every row", not bad_total,
          f"wrong on {bad_total[:4]}")

    # The three reference columns must rebuild the label, which is the whole
    # reason the sheet carries all three.
    bad_ref = [r["invRef"] for r in rows
               if r["invRef"] and f"{r['invPrefix']}{r['invNo'] if r['invNo'] is not None else ''}" != r["invRef"]]
    check(S, "prefix + number rebuilds the invoice reference", not bad_ref,
          f"wrong on {bad_ref[:4]}")

    bad_dc = [r["dcRef"] for r in rows
              if r["dcRef"] and f"{r['dcPrefix']}{r['dcNo'] if r['dcNo'] is not None else ''}" != r["dcRef"]]
    check(S, "prefix + number rebuilds the challan reference", not bad_dc,
          f"wrong on {bad_dc[:4]}")

    # Month is the date's own month, spelled as the sheet spells it.
    bad_month = [r["invRef"] for r in rows[:50]
                 if r["date"] and r["month"] != _month_label(r["date"])]
    check(S, "Month is the row's own month", not bad_month,
          f"wrong on {bad_month[:4]}")

    # S. No is a running number across the whole set, not per page.
    check(S, "S. No starts at 1 on page 1",
          rows and rows[0]["sNo"] == 1, f"got {rows[0]['sNo'] if rows else None}")
    p2 = report(base, token, cid, "sales-detail", period="allPeriods", pageSize=2, page=2)
    if p2["rows"]:
        check(S, "S. No continues onto page 2 (3 with a page size of 2)",
              p2["rows"][0]["sNo"] == 3, f"got {p2['rows'][0]['sNo']}")

    # The footer sums the WHOLE set. With every row on one page the two agree,
    # which is what makes this a usable check.
    if rep["totalCount"] <= 200:
        check(S, "the Excl total is the sum of every row",
              eq(sum(float(r["excl"]) for r in rows), rep["totals"].get("excl")),
              f"rows {sum(float(r['excl']) for r in rows)} vs total {rep['totals'].get('excl')}")
        check(S, "the S.Tax total is the sum of every row",
              eq(sum(float(r["salesTax"]) for r in rows), rep["totals"].get("salesTax")),
              f"rows {sum(float(r['salesTax']) for r in rows)} vs total {rep['totals'].get('salesTax')}")
        check(S, "the footer's Incl == Excl + S.Tax",
              eq(float(rep["totals"].get("excl") or 0) + float(rep["totals"].get("salesTax") or 0),
                 rep["totals"].get("incl")),
              f"{rep['totals'].get('excl')} + {rep['totals'].get('salesTax')} vs {rep['totals'].get('incl')}")

    # An opening balance is not a sale. The ledger import marks one with an
    # ExternalRef of "ledger-open:…"; those rows must not be in a sales report.
    # Their references are numeric row indexes, so a sales register showing one
    # is easy to spot: it has no alphabetic prefix AND no line detail.
    reg = report(base, token, cid, "sales-register", period="allPeriods", pageSize=200)
    # The register is per DOCUMENT and states subtotal; Sales Detail is per LINE
    # and its Excl sums to the same money, EXCEPT that the register includes
    # opening balances (it reports every document) while Sales Detail does not.
    check(S, "Sales Detail never totals MORE than the document register",
          float(rep["totals"].get("excl") or 0) <= float(reg["totals"].get("subtotal") or 0) + 0.01,
          f"detail {rep['totals'].get('excl')} vs register {reg['totals'].get('subtotal')}")

    # A custom date window must narrow the register, and its footer must
    # re-total for that window rather than reporting the whole file.
    first = min(r["date"] for r in rows)[:10]
    windowed = report(base, token, cid, "sales-detail", period="custom",
                      **{"from": first, "to": first}, pageSize=200)
    check(S, "a custom date range narrows the register",
          windowed["totalCount"] <= rep["totalCount"],
          f"{windowed['totalCount']} rows for one day vs {rep['totalCount']} for all time")
    check(S, "and its footer re-totals for that window",
          float(windowed["totals"].get("excl") or 0) <= float(rep["totals"].get("excl") or 0) + 0.01,
          f"windowed {windowed['totals'].get('excl')} > all-time {rep['totals'].get('excl')}")
    check(S, "every row in the window is on that date",
          all(r["date"][:10] == first for r in windowed["rows"]),
          f"dates {[r['date'][:10] for r in windowed['rows'][:4]]} vs {first}")


def _month_label(iso: str) -> str:
    """"2025-07-01T00:00:00" -> "Jul 2025" — the sheet's own spelling."""
    from datetime import datetime
    d = datetime.fromisoformat(iso.replace("Z", ""))
    return f"{d.strftime('%b')} {d.year}"


def suite_documents(base: str, token: str, cid: int):
    S = "15. Sales & purchases"
    print(f"\n=== {S} ===")

    for side, reg_path, aging_path, summary_path in [
        ("sales", "sales-register", "receivables-aging", "sales-summary"),
        ("purchases", "purchase-register", "payables-aging", "purchase-summary"),
    ]:
        reg = report(base, token, cid, reg_path, period="allPeriods", pageSize=200)
        t = reg["totals"]
        check(S, f"{side} register returns documents", reg["totalCount"] > 0,
              f"got {reg['totalCount']}")

        # Document totals must be internally consistent, because they are read from
        # the documents rather than recomputed from lines.
        check(S, f"{side}: subtotal + tax == grand total",
              eq(float(t["subtotal"]) + float(t["tax"]), t["grandTotal"]),
              f"{t['subtotal']} + {t['tax']} vs {t['grandTotal']}")

        # Every row: outstanding == collectible - paid.
        bad = [r["documentNo"] for r in reg["rows"]
               if not eq(float(r["grandTotal"]) - float(r["withholdingTax"]) - float(r["paid"]),
                         r["outstanding"])]
        check(S, f"{side}: outstanding == grand - withholding - paid on every row",
              not bad, f"wrong on {bad[:4]}")
        check(S, f"{side}: no discount column (the model stores none)",
              not any("discount" in c["key"].lower() for c in reg["columns"]))

        # Reconcile to aging. Three terms, each for a real reason:
        #   register outstanding  documents, netting overpaid ones
        #   + overpaid            add back what the register netted off
        #   + net on-account      money against a party with no document, which a
        #                         register of documents cannot show at all
        #   == aging total
        aging = report(base, token, cid, aging_path, period="allPeriods")
        overpaid = float(t.get("overpaid") or 0)
        unalloc = report(base, token, cid, "unallocated", period="allPeriods", pageSize=200)
        want_receipt = (side == "sales")
        on_account = 0.0
        for r in unalloc["rows"]:
            if (r["contactType"] == "Client") != want_receipt:
                continue
            on_account += (-float(r["amount"]) if (r["direction"] == "Receipt") == want_receipt
                           else float(r["amount"]))
        expected = float(t["outstanding"]) + overpaid + on_account
        check(S, f"{side}: register outstanding + overpaid + on-account == aging total",
              eq(expected, aging["totals"].get("total")),
              f"{t['outstanding']} + {overpaid} + {on_account} = {expected} "
              f"vs aging {aging['totals'].get('total')}")
        if overpaid > 0.005:
            check(S, f"{side}: the overpayment difference is explained in a notice",
                  bool(reg.get("notice")), "overpaid total with no explanation")

        # The Payment Status report was removed (2026-09-03) -- its whole subject
        # was paid / part-paid / unpaid / overdue, and a receipt here is taken on
        # account rather than allocated to a document, so it reported the state
        # of the allocation rather than of the customer. The route must be gone,
        # not merely unlisted, or a bookmark would still reach it.
        gone_path = "sales-payment-status" if side == "sales" else "purchase-payment-status"
        gone, how = report_is_gone(base, token, cid, gone_path)
        check(S, f"{side}: the payment status report no longer returns a report",
              gone, f"GET {gone_path} still answered: {how}")

        # Every grouping must sum to the same grand figure it reports.
        for gb in ["party", "item", "itemType", "account", "date", "month", "tax"]:
            s = report(base, token, cid, summary_path, period="allPeriods", groupBy=gb)
            rowsum = sum(float(r["amount"]) for r in s["rows"])
            check(S, f"{side} by {gb}: rows sum to the report total",
                  eq(rowsum, s["totals"].get("amount")),
                  f"rows {rowsum:,.2f} vs total {s['totals'].get('amount')}")
            check(S, f"{side} by {gb}: dimension column is labelled",
                  any(c["key"] == "label" and c["label"] for c in s["columns"]))

        # Party grouping must agree with the register it is grouping.
        by_party = report(base, token, cid, summary_path, period="allPeriods", groupBy="party")
        check(S, f"{side} by party total == register subtotal",
              eq(by_party["totals"].get("amount"), t["subtotal"]),
              f"{by_party['totals'].get('amount')} vs {t['subtotal']}")

        # Date grouping must be chronological.
        by_date = report(base, token, cid, summary_path, period="allPeriods", groupBy="date")
        keys = [r["drillKey"] for r in by_date["rows"] if r.get("drillKey")]
        check(S, f"{side} by date is in date order", keys == sorted(keys))

    # ── Sales by account must agree with the P&L, since both read the ledger ──
    by_acct = report(base, token, cid, "sales-summary", period="thisYear", groupBy="account")
    pl = report(base, token, cid, "profit-loss", period="thisYear")
    check(S, "sales by account total == P&L income",
          eq(by_acct["totals"].get("amount"), pl["totalIncome"]),
          f"by-account {by_acct['totals'].get('amount')} vs P&L income {pl['totalIncome']}")

    # ── Notes ──
    notes = report(base, token, cid, "credit-debit-notes", period="allPeriods", pageSize=100)
    check(S, "credit/debit notes report is titled for notes",
          "Notes" in notes["title"], f"got {notes['title']}")
    check(S, "the notes report contains ONLY notes",
          all(r["documentNo"].startswith(("CN-", "DN-")) for r in notes["rows"]),
          f"found {[r['documentNo'] for r in notes['rows'][:4] if not r['documentNo'].startswith(('CN-','DN-'))]}")

    # ...and the plain register must EXCLUDE them, or "what we sold" is wrong.
    reg = report(base, token, cid, "sales-register", period="allPeriods", pageSize=200)
    check(S, "the sales register excludes notes",
          not any(r["documentNo"].startswith(("CN-", "DN-")) for r in reg["rows"]),
          "a note appeared in the invoice register")

    # ── Status filter ──
    unpaid = report(base, token, cid, "sales-register", period="allPeriods",
                    status="Unpaid", pageSize=100)
    check(S, "register can be filtered to one payment status",
          all(r["status"] == "Unpaid" for r in unpaid["rows"]),
          f"got {set(r['status'] for r in unpaid['rows'])}")

    # ── Exports ──
    for rid in ["sales-register", "purchase-register", "sales-summary", "purchase-summary",
                "credit-debit-notes"]:
        st, blob = http("GET",
                        f"/api/accounting/reports/company/{cid}/export/{rid}?period=allPeriods",
                        base, token=token, raw_bytes=True)
        ok = st == 200 and isinstance(blob, bytes) and blob[:2] == b"PK" and len(blob) > 2000
        check(S, f"export/{rid} returns a real .xlsx", ok,
              f"status {st}, {len(blob) if isinstance(blob, bytes) else '?'} bytes")


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 16 — Taxes, accounting control, management
# ═══════════════════════════════════════════════════════════════════════════
def suite_tax_control(base: str, token: str, cid: int):
    S = "16. Tax, control & management"
    print(f"\n=== {S} ===")

    # ── Tax summary ──
    ts = report(base, token, cid, "tax-summary", period="allPeriods")
    t = ts["totals"]
    check(S, "tax summary reports output and input sales tax separately",
          "outputTax" in t and "inputTax" in t, f"got {list(t.keys())}")
    check(S, "net sales tax == output - input",
          eq(t.get("netSalesTax"), float(t.get("outputTax") or 0) - float(t.get("inputTax") or 0)),
          f"net {t.get('netSalesTax')} vs {float(t.get('outputTax') or 0) - float(t.get('inputTax') or 0)}")
    # Withholding is income tax, not sales tax, and must not be folded in.
    check(S, "withholding tax is NOT netted into the sales-tax figure",
          "netTax" not in t,
          "a combined netTax reappeared - sales tax and withholding are different taxes")
    if "withholdingPayable" in t:
        check(S, "when withholding exists, the separation is explained",
              bool(ts.get("notice")), "withholding shown with no explanation")
    check(S, "each tax row states which tax it is",
          all(r.get("kind") for r in ts["rows"]),
          "a tax row came back with no type")

    # Output-tax detail must sum to the summary's output figure.
    od = report(base, token, cid, "output-tax", period="allPeriods", pageSize=1)
    if float(t.get("outputTax") or 0) != 0:
        check(S, "output-tax detail total == tax summary output tax",
              eq(od["totals"].get("tax"), t.get("outputTax")),
              f"detail {od['totals'].get('tax')} vs summary {t.get('outputTax')}")

    # Tax must also agree with the P&L-era ledger: output tax is a liability, so it
    # appears on the balance sheet. Cross-check against the trial balance.
    tb = report(base, token, cid, "trial-balance-report", period="allPeriods")
    check(S, "trial balance still balances (tax reports changed nothing)",
          eq(tb["totals"].get("debit"), tb["totals"].get("credit")))

    # Tax by party: either rows, or a notice explaining why not.
    for path, label in [("tax-by-customer", "customer"), ("tax-by-supplier", "supplier")]:
        r = report(base, token, cid, path, period="allPeriods")
        has_rows = len(r.get("rows") or []) > 0
        check(S, f"tax by {label}: returns rows or explains why not",
              has_rows or bool(r.get("notice")),
              "neither rows nor a notice - the operator is left guessing")
        if has_rows:
            check(S, f"tax by {label}: rows sum to the total",
                  eq(sum(float(x["amount"]) for x in r["rows"]), r["totals"].get("amount")))

    # Tax transaction detail covers both directions.
    td = report(base, token, cid, "tax-transactions", period="allPeriods", pageSize=50)
    check(S, "tax transaction detail reports output and input separately",
          "outputTax" in td["totals"] and "inputTax" in td["totals"],
          f"got {list(td['totals'].keys())}")

    # ── Journal register ──
    jr = report(base, token, cid, "journal-register", period="allPeriods", pageSize=50)
    check(S, "journal register returns entries", jr["totalCount"] > 0, f"got {jr['totalCount']}")
    check(S, "no unbalanced entries (the posting engine asserts balance)",
          eq(jr["totals"].get("unbalanced"), 0),
          f"{jr['totals'].get('unbalanced')} unbalanced entries found")
    check(S, "every entry row says whether it balances",
          all(r.get("balanced") for r in jr["rows"]))
    check(S, "every entry names its source", all(r.get("source") for r in jr["rows"]))
    check(S, "register total == general ledger total debit",
          eq(jr["totals"].get("amount"),
             report(base, token, cid, "general-ledger", period="allPeriods",
                    pageSize=1)["totals"].get("debit")),
          "journal register and general ledger disagree on what was posted")

    manual = report(base, token, cid, "journal-register", period="allPeriods", status="journal")
    check(S, "register can be filtered to manual journals only",
          all(r["source"] == "Manual journal" for r in manual["rows"]),
          f"got {set(r['source'] for r in manual['rows'])}")

    # ── Posting exceptions ──
    pe = report(base, token, cid, "posting-exceptions", period="allPeriods")
    check(S, "posting exceptions always returns at least one row",
          len(pe["rows"]) > 0, "an empty control report tells the operator nothing")
    check(S, "every exception row says what to do about it",
          all(r.get("action") for r in pe["rows"]),
          "a row reported a problem with no remedy")
    issues = int(float(pe["totals"].get("problems") or 0))
    if issues == 0:
        check(S, "with no problems it says so explicitly",
              any("No exceptions" in str(r["issue"]) for r in pe["rows"]),
              f"got {[r['issue'] for r in pe['rows']]}")

    # ── Management ──
    rs = report(base, token, cid, "revenue-summary", period="thisYear")
    pl = report(base, token, cid, "profit-loss", period="thisYear")
    check(S, "revenue summary total == P&L income",
          eq(rs["totals"].get("amount"), pl["totalIncome"]),
          f"revenue {rs['totals'].get('amount')} vs P&L income {pl['totalIncome']}")

    es = report(base, token, cid, "expense-summary-accounts", period="thisYear")
    check(S, "expense summary total == P&L cost of sales + expenses",
          eq(es["totals"].get("amount"),
             float(pl["totalCostOfSales"]) + float(pl["totalExpenses"])),
          f"expense {es['totals'].get('amount')} vs P&L "
          f"{float(pl['totalCostOfSales']) + float(pl['totalExpenses'])}")
    check(S, "revenue/expense rows carry the account group",
          all("group" in r for r in rs["rows"]) if rs["rows"] else True)

    # Cash flow must reconcile to the cash & bank summary and chain month to month.
    cf = report(base, token, cid, "cash-flow", period="allPeriods")
    cbs = report(base, token, cid, "cash-bank-summary", period="allPeriods")
    if cf["totalCount"] > 0:
        check(S, "cash flow closing == Cash & Bank Summary closing",
              eq(cf["totals"].get("closing"), cbs["totals"].get("closing")),
              f"cash flow {cf['totals'].get('closing')} vs summary {cbs['totals'].get('closing')}")
        check(S, "cash flow: net == in - out",
              eq(cf["totals"].get("net"),
                 float(cf["totals"].get("moneyIn") or 0) - float(cf["totals"].get("moneyOut") or 0)))
        drift = None
        for r in cf["rows"]:
            if not eq(float(r["opening"]) + float(r["net"]), r["closing"]):
                drift = f"{r['label']}: {r['opening']} + {r['net']} != {r['closing']}"
                break
        check(S, "each month: opening + net == closing", drift is None, drift or "")
        prev = None
        chain = None
        for r in cf["rows"]:
            if prev is not None and not eq(prev, r["opening"]):
                chain = f"{r['label']} opens at {r['opening']}, previous closed at {prev}"
                break
            prev = float(r["closing"])
        check(S, "each month opens where the previous closed", chain is None, chain or "")
        check(S, "cash flow says it is not a statutory statement of cash flows",
              "not a statutory" in (cf.get("notice") or ""),
              "no caveat - a reader could file this as an IAS-7 statement")

    me = report(base, token, cid, "expenses/summary", period="allPeriods", groupBy="month")
    check(S, "monthly expenses agrees with the expense engine",
          eq(me["totals"].get("amount"),
             report(base, token, cid, "expenses", period="allPeriods",
                    pageSize=1)["totals"].get("subtotal")),
          "monthly expenses and the Company Expense Report disagree")

    # ── Exports ──
    for rid in ["tax-summary", "output-tax", "input-tax", "tax-transactions",
                "tax-by-customer", "journal-register", "posting-exceptions",
                "revenue-summary", "cash-flow"]:
        st, blob = http("GET",
                        f"/api/accounting/reports/company/{cid}/export/{rid}?period=allPeriods",
                        base, token=token, raw_bytes=True)
        ok = st == 200 and isinstance(blob, bytes) and blob[:2] == b"PK" and len(blob) > 2000
        check(S, f"export/{rid} returns a real .xlsx", ok,
              f"status {st}, {len(blob) if isinstance(blob, bytes) else '?'} bytes")


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 16 — Taxes, accounting control, management
# ═══════════════════════════════════════════════════════════════════════════
def suite_tax_control(base: str, token: str, cid: int):
    S = "16. Tax, control & management"
    print(f"\n=== {S} ===")

    # ── Tax summary ──
    ts = report(base, token, cid, "tax-summary", period="allPeriods")
    t = ts["totals"]
    check(S, "tax summary reports output and input sales tax separately",
          "outputTax" in t and "inputTax" in t, f"got {list(t.keys())}")
    check(S, "net sales tax == output - input",
          eq(t.get("netSalesTax"), float(t.get("outputTax") or 0) - float(t.get("inputTax") or 0)),
          f"net {t.get('netSalesTax')} vs {float(t.get('outputTax') or 0) - float(t.get('inputTax') or 0)}")
    # Withholding is income tax, not sales tax, and must not be folded in.
    check(S, "withholding tax is NOT netted into the sales-tax figure",
          "netTax" not in t,
          "a combined netTax reappeared - sales tax and withholding are different taxes")
    if "withholdingPayable" in t:
        check(S, "when withholding exists, the separation is explained",
              bool(ts.get("notice")), "withholding shown with no explanation")
    check(S, "each tax row states which tax it is",
          all(r.get("kind") for r in ts["rows"]),
          "a tax row came back with no type")

    # Output-tax detail must sum to the summary's output figure.
    od = report(base, token, cid, "output-tax", period="allPeriods", pageSize=1)
    if float(t.get("outputTax") or 0) != 0:
        check(S, "output-tax detail total == tax summary output tax",
              eq(od["totals"].get("tax"), t.get("outputTax")),
              f"detail {od['totals'].get('tax')} vs summary {t.get('outputTax')}")

    # Tax must also agree with the P&L-era ledger: output tax is a liability, so it
    # appears on the balance sheet. Cross-check against the trial balance.
    tb = report(base, token, cid, "trial-balance-report", period="allPeriods")
    check(S, "trial balance still balances (tax reports changed nothing)",
          eq(tb["totals"].get("debit"), tb["totals"].get("credit")))

    # Tax by party: either rows, or a notice explaining why not.
    for path, label in [("tax-by-customer", "customer"), ("tax-by-supplier", "supplier")]:
        r = report(base, token, cid, path, period="allPeriods")
        has_rows = len(r.get("rows") or []) > 0
        check(S, f"tax by {label}: returns rows or explains why not",
              has_rows or bool(r.get("notice")),
              "neither rows nor a notice - the operator is left guessing")
        if has_rows:
            check(S, f"tax by {label}: rows sum to the total",
                  eq(sum(float(x["amount"]) for x in r["rows"]), r["totals"].get("amount")))

    # Tax transaction detail covers both directions.
    td = report(base, token, cid, "tax-transactions", period="allPeriods", pageSize=50)
    check(S, "tax transaction detail reports output and input separately",
          "outputTax" in td["totals"] and "inputTax" in td["totals"],
          f"got {list(td['totals'].keys())}")

    # ── Journal register ──
    jr = report(base, token, cid, "journal-register", period="allPeriods", pageSize=50)
    check(S, "journal register returns entries", jr["totalCount"] > 0, f"got {jr['totalCount']}")
    check(S, "no unbalanced entries (the posting engine asserts balance)",
          eq(jr["totals"].get("unbalanced"), 0),
          f"{jr['totals'].get('unbalanced')} unbalanced entries found")
    check(S, "every entry row says whether it balances",
          all(r.get("balanced") for r in jr["rows"]))
    check(S, "every entry names its source", all(r.get("source") for r in jr["rows"]))
    check(S, "register total == general ledger total debit",
          eq(jr["totals"].get("amount"),
             report(base, token, cid, "general-ledger", period="allPeriods",
                    pageSize=1)["totals"].get("debit")),
          "journal register and general ledger disagree on what was posted")

    manual = report(base, token, cid, "journal-register", period="allPeriods", status="journal")
    check(S, "register can be filtered to manual journals only",
          all(r["source"] == "Manual journal" for r in manual["rows"]),
          f"got {set(r['source'] for r in manual['rows'])}")

    # ── Posting exceptions ──
    pe = report(base, token, cid, "posting-exceptions", period="allPeriods")
    check(S, "posting exceptions always returns at least one row",
          len(pe["rows"]) > 0, "an empty control report tells the operator nothing")
    check(S, "every exception row says what to do about it",
          all(r.get("action") for r in pe["rows"]),
          "a row reported a problem with no remedy")
    issues = int(float(pe["totals"].get("problems") or 0))
    if issues == 0:
        check(S, "with no problems it says so explicitly",
              any("No exceptions" in str(r["issue"]) for r in pe["rows"]),
              f"got {[r['issue'] for r in pe['rows']]}")

    # ── Management ──
    rs = report(base, token, cid, "revenue-summary", period="thisYear")
    pl = report(base, token, cid, "profit-loss", period="thisYear")
    check(S, "revenue summary total == P&L income",
          eq(rs["totals"].get("amount"), pl["totalIncome"]),
          f"revenue {rs['totals'].get('amount')} vs P&L income {pl['totalIncome']}")

    es = report(base, token, cid, "expense-summary-accounts", period="thisYear")
    check(S, "expense summary total == P&L cost of sales + expenses",
          eq(es["totals"].get("amount"),
             float(pl["totalCostOfSales"]) + float(pl["totalExpenses"])),
          f"expense {es['totals'].get('amount')} vs P&L "
          f"{float(pl['totalCostOfSales']) + float(pl['totalExpenses'])}")
    check(S, "revenue/expense rows carry the account group",
          all("group" in r for r in rs["rows"]) if rs["rows"] else True)

    # Cash flow must reconcile to the cash & bank summary and chain month to month.
    cf = report(base, token, cid, "cash-flow", period="allPeriods")
    cbs = report(base, token, cid, "cash-bank-summary", period="allPeriods")
    if cf["totalCount"] > 0:
        check(S, "cash flow closing == Cash & Bank Summary closing",
              eq(cf["totals"].get("closing"), cbs["totals"].get("closing")),
              f"cash flow {cf['totals'].get('closing')} vs summary {cbs['totals'].get('closing')}")
        check(S, "cash flow: net == in - out",
              eq(cf["totals"].get("net"),
                 float(cf["totals"].get("moneyIn") or 0) - float(cf["totals"].get("moneyOut") or 0)))
        drift = None
        for r in cf["rows"]:
            if not eq(float(r["opening"]) + float(r["net"]), r["closing"]):
                drift = f"{r['label']}: {r['opening']} + {r['net']} != {r['closing']}"
                break
        check(S, "each month: opening + net == closing", drift is None, drift or "")
        prev = None
        chain = None
        for r in cf["rows"]:
            if prev is not None and not eq(prev, r["opening"]):
                chain = f"{r['label']} opens at {r['opening']}, previous closed at {prev}"
                break
            prev = float(r["closing"])
        check(S, "each month opens where the previous closed", chain is None, chain or "")
        check(S, "cash flow says it is not a statutory statement of cash flows",
              "not a statutory" in (cf.get("notice") or ""),
              "no caveat - a reader could file this as an IAS-7 statement")

    me = report(base, token, cid, "expenses/summary", period="allPeriods", groupBy="month")
    check(S, "monthly expenses agrees with the expense engine",
          eq(me["totals"].get("amount"),
             report(base, token, cid, "expenses", period="allPeriods",
                    pageSize=1)["totals"].get("subtotal")),
          "monthly expenses and the Company Expense Report disagree")

    # ── Exports ──
    for rid in ["tax-summary", "output-tax", "input-tax", "tax-transactions",
                "tax-by-customer", "journal-register", "posting-exceptions",
                "revenue-summary", "cash-flow"]:
        st, blob = http("GET",
                        f"/api/accounting/reports/company/{cid}/export/{rid}?period=allPeriods",
                        base, token=token, raw_bytes=True)
        ok = st == 200 and isinstance(blob, bytes) and blob[:2] == b"PK" and len(blob) > 2000
        check(S, f"export/{rid} returns a real .xlsx", ok,
              f"status {st}, {len(blob) if isinstance(blob, bytes) else '?'} bytes")


# ═══════════════════════════════════════════════════════════════════════════
#  Suite 16 — Taxes, accounting control, management
# ═══════════════════════════════════════════════════════════════════════════
def suite_tax_control(base: str, token: str, cid: int):
    S = "16. Tax, control & management"
    print(f"\n=== {S} ===")

    # ── Tax summary ──
    ts = report(base, token, cid, "tax-summary", period="allPeriods")
    t = ts["totals"]
    check(S, "tax summary reports output and input sales tax separately",
          "outputTax" in t and "inputTax" in t, f"got {list(t.keys())}")
    check(S, "net sales tax == output - input",
          eq(t.get("netSalesTax"), float(t.get("outputTax") or 0) - float(t.get("inputTax") or 0)),
          f"net {t.get('netSalesTax')} vs {float(t.get('outputTax') or 0) - float(t.get('inputTax') or 0)}")
    # Withholding is income tax, not sales tax, and must not be folded in.
    check(S, "withholding tax is NOT netted into the sales-tax figure",
          "netTax" not in t,
          "a combined netTax reappeared - sales tax and withholding are different taxes")
    if "withholdingPayable" in t:
        check(S, "when withholding exists, the separation is explained",
              bool(ts.get("notice")), "withholding shown with no explanation")
    check(S, "each tax row states which tax it is",
          all(r.get("kind") for r in ts["rows"]),
          "a tax row came back with no type")

    # Output-tax detail must sum to the summary's output figure.
    od = report(base, token, cid, "output-tax", period="allPeriods", pageSize=1)
    if float(t.get("outputTax") or 0) != 0:
        check(S, "output-tax detail total == tax summary output tax",
              eq(od["totals"].get("tax"), t.get("outputTax")),
              f"detail {od['totals'].get('tax')} vs summary {t.get('outputTax')}")

    # Tax must also agree with the P&L-era ledger: output tax is a liability, so it
    # appears on the balance sheet. Cross-check against the trial balance.
    tb = report(base, token, cid, "trial-balance-report", period="allPeriods")
    check(S, "trial balance still balances (tax reports changed nothing)",
          eq(tb["totals"].get("debit"), tb["totals"].get("credit")))

    # Tax by party: either rows, or a notice explaining why not.
    for path, label in [("tax-by-customer", "customer"), ("tax-by-supplier", "supplier")]:
        r = report(base, token, cid, path, period="allPeriods")
        has_rows = len(r.get("rows") or []) > 0
        check(S, f"tax by {label}: returns rows or explains why not",
              has_rows or bool(r.get("notice")),
              "neither rows nor a notice - the operator is left guessing")
        if has_rows:
            check(S, f"tax by {label}: rows sum to the total",
                  eq(sum(float(x["amount"]) for x in r["rows"]), r["totals"].get("amount")))

    # Tax transaction detail covers both directions.
    td = report(base, token, cid, "tax-transactions", period="allPeriods", pageSize=50)
    check(S, "tax transaction detail reports output and input separately",
          "outputTax" in td["totals"] and "inputTax" in td["totals"],
          f"got {list(td['totals'].keys())}")

    # ── Journal register ──
    jr = report(base, token, cid, "journal-register", period="allPeriods", pageSize=50)
    check(S, "journal register returns entries", jr["totalCount"] > 0, f"got {jr['totalCount']}")
    check(S, "no unbalanced entries (the posting engine asserts balance)",
          eq(jr["totals"].get("unbalanced"), 0),
          f"{jr['totals'].get('unbalanced')} unbalanced entries found")
    check(S, "every entry row says whether it balances",
          all(r.get("balanced") for r in jr["rows"]))
    check(S, "every entry names its source", all(r.get("source") for r in jr["rows"]))
    check(S, "register total == general ledger total debit",
          eq(jr["totals"].get("amount"),
             report(base, token, cid, "general-ledger", period="allPeriods",
                    pageSize=1)["totals"].get("debit")),
          "journal register and general ledger disagree on what was posted")

    manual = report(base, token, cid, "journal-register", period="allPeriods", status="journal")
    check(S, "register can be filtered to manual journals only",
          all(r["source"] == "Manual journal" for r in manual["rows"]),
          f"got {set(r['source'] for r in manual['rows'])}")

    # ── Posting exceptions ──
    pe = report(base, token, cid, "posting-exceptions", period="allPeriods")
    check(S, "posting exceptions always returns at least one row",
          len(pe["rows"]) > 0, "an empty control report tells the operator nothing")
    check(S, "every exception row says what to do about it",
          all(r.get("action") for r in pe["rows"]),
          "a row reported a problem with no remedy")
    issues = int(float(pe["totals"].get("problems") or 0))
    if issues == 0:
        check(S, "with no problems it says so explicitly",
              any("No exceptions" in str(r["issue"]) for r in pe["rows"]),
              f"got {[r['issue'] for r in pe['rows']]}")

    # ── Management ──
    rs = report(base, token, cid, "revenue-summary", period="thisYear")
    pl = report(base, token, cid, "profit-loss", period="thisYear")
    check(S, "revenue summary total == P&L income",
          eq(rs["totals"].get("amount"), pl["totalIncome"]),
          f"revenue {rs['totals'].get('amount')} vs P&L income {pl['totalIncome']}")

    es = report(base, token, cid, "expense-summary-accounts", period="thisYear")
    check(S, "expense summary total == P&L cost of sales + expenses",
          eq(es["totals"].get("amount"),
             float(pl["totalCostOfSales"]) + float(pl["totalExpenses"])),
          f"expense {es['totals'].get('amount')} vs P&L "
          f"{float(pl['totalCostOfSales']) + float(pl['totalExpenses'])}")
    check(S, "revenue/expense rows carry the account group",
          all("group" in r for r in rs["rows"]) if rs["rows"] else True)

    # Cash flow must reconcile to the cash & bank summary and chain month to month.
    cf = report(base, token, cid, "cash-flow", period="allPeriods")
    cbs = report(base, token, cid, "cash-bank-summary", period="allPeriods")
    if cf["totalCount"] > 0:
        check(S, "cash flow closing == Cash & Bank Summary closing",
              eq(cf["totals"].get("closing"), cbs["totals"].get("closing")),
              f"cash flow {cf['totals'].get('closing')} vs summary {cbs['totals'].get('closing')}")
        check(S, "cash flow: net == in - out",
              eq(cf["totals"].get("net"),
                 float(cf["totals"].get("moneyIn") or 0) - float(cf["totals"].get("moneyOut") or 0)))
        drift = None
        for r in cf["rows"]:
            if not eq(float(r["opening"]) + float(r["net"]), r["closing"]):
                drift = f"{r['label']}: {r['opening']} + {r['net']} != {r['closing']}"
                break
        check(S, "each month: opening + net == closing", drift is None, drift or "")
        prev = None
        chain = None
        for r in cf["rows"]:
            if prev is not None and not eq(prev, r["opening"]):
                chain = f"{r['label']} opens at {r['opening']}, previous closed at {prev}"
                break
            prev = float(r["closing"])
        check(S, "each month opens where the previous closed", chain is None, chain or "")
        check(S, "cash flow says it is not a statutory statement of cash flows",
              "not a statutory" in (cf.get("notice") or ""),
              "no caveat - a reader could file this as an IAS-7 statement")

    me = report(base, token, cid, "expenses/summary", period="allPeriods", groupBy="month")
    check(S, "monthly expenses agrees with the expense engine",
          eq(me["totals"].get("amount"),
             report(base, token, cid, "expenses", period="allPeriods",
                    pageSize=1)["totals"].get("subtotal")),
          "monthly expenses and the Company Expense Report disagree")

    # ── Exports ──
    for rid in ["tax-summary", "output-tax", "input-tax", "tax-transactions",
                "tax-by-customer", "journal-register", "posting-exceptions",
                "revenue-summary", "cash-flow"]:
        st, blob = http("GET",
                        f"/api/accounting/reports/company/{cid}/export/{rid}?period=allPeriods",
                        base, token=token, raw_bytes=True)
        ok = st == 200 and isinstance(blob, bytes) and blob[:2] == b"PK" and len(blob) > 2000
        check(S, f"export/{rid} returns a real .xlsx", ok,
              f"status {st}, {len(blob) if isinstance(blob, bytes) else '?'} bytes")


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
        ctx["clientId"] = client_id
        suite_groupings(args.base, token, cid, ctx)
        suite_drilldown(args.base, token, cid, ctx)
        suite_cash_bank(args.base, token, cid, ctx, client_id)
        suite_registers(args.base, token, cid)
        suite_cheques_unallocated(args.base, token, cid, ctx, supplier_id, client_id)
        suite_periods(args.base, token, cid, ctx)
        suite_paging_export(args.base, token, cid)
        suite_party_ledgers(args.base, token, cid, ctx, client_id, supplier_id)
        suite_statements(args.base, token, cid, client_id, supplier_id)
        suite_party_balances(args.base, token, cid, client_id, supplier_id)
        suite_aging_outstanding(args.base, token, cid, client_id)
        suite_statements_financial(args.base, token, cid)
        suite_documents(args.base, token, cid)
        suite_sales_detail(args.base, token, cid)
        suite_tax_control(args.base, token, cid)
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
