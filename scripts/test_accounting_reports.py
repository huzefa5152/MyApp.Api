#!/usr/bin/env python3
"""
Accounting reports (2026-09-16) — built entirely out of CROSS-CHECKS.

A reporting bug does not crash. It produces a plausible wrong number, which an
operator files a return on. Asserting a report against a figure this same suite
computed the same way would only prove the code is consistent with itself, so
every check here compares a report against a figure the system derives A
DIFFERENT WAY:

  • the expense report's total against the trial balance's expense movement;
  • the cash book's closing against the Chart of Accounts' balance for the same
    account;
  • aged receivables against the A/R control account;
  • the profit & loss net against the balance sheet's current-year earnings;
  • the dashboard against each of the reports it summarises; and
  • the tax control report against the documents themselves — the one place the
    ledger is deliberately checked against something outside it.

The fixture is a small but complete set of books: sales with and without each
tax, a purchase, a receipt, and a manual journal, so every report has something
real to disagree about.

Local only. Creates its own throwaway company and deletes it at the end.

    python scripts/test_accounting_reports.py --base http://localhost:5104
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal

PASS = 0
FAIL = 0
FAILURES: list[str] = []


def check(suite: str, name: str, ok: bool, detail: str = "") -> bool:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        FAILURES.append(f"{suite} :: {name} :: {detail}")
        print(f"  [FAIL] {name}  -- {detail}")
    return ok


def http(method: str, path: str, base: str, token: str | None = None,
         body: dict | list | None = None, timeout: int = 180):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base.rstrip("/") + path, data=data,
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def err_text(payload) -> str:
    if isinstance(payload, dict):
        return str(payload.get("error") or payload.get("message") or payload)
    return str(payload)


def D(x) -> Decimal:
    return Decimal(str(x))


def walk(nodes):
    for n in nodes or []:
        for a in n.get("accounts") or []:
            yield a
        yield from walk(n.get("children"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  ACCOUNTING REPORTS - cross-checks")
    print("=" * 78)

    status, d = http("POST", "/api/auth/login", base,
                     body={"username": args.user, "password": args.password})
    if status != 200:
        print(f"[!] login failed: HTTP {status} {d}")
        return 2
    token = d["token"]

    day = datetime.now(timezone.utc).date()
    today = day.strftime("%Y-%m-%dT00:00:00Z")
    d_from = (day - timedelta(days=365)).isoformat()
    d_to = day.isoformat()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    company_id = type_id = None

    try:
        # ── 0. a small but complete set of books ─────────────────────────────
        print("\n=== 0. Setup ===")
        status, company = http("POST", "/api/companies", base, token=token, body={
            "name": "[TEMP] Reports Suite", "brandName": "[TEMP] Reports Suite",
            "fullAddress": "Karachi", "cnic": "4220100000000",
            "ntn": "1234567-8", "strn": "1234567890123",
            "fbrSellerRegistrationNo": "4220100000000",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingDebitNoteNumber": 1, "startingCreditNoteNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "fbrProvinceCode": 8, "inventoryTrackingEnabled": False,
            "fbrBusinessActivity": "Wholesaler", "fbrSector": "Wholesale / Retails",
            "fbrEnvironment": "sandbox", "fbrToken": "placeholder-not-a-real-token",
        })
        if not check("0", "throwaway company created", status in (200, 201), f"{status} {err_text(company)}"):
            return 1
        company_id = company["id"]

        status, _ = http("POST", f"/api/accounts/company/{company_id}/seed-wholesale", base, token=token)
        check("0", "chart seeded", status == 200, f"got {status}")

        status, flat = http("GET", f"/api/accounts/company/{company_id}/flat", base, token=token)
        by_control = {a["controlType"]: a for a in flat if a["controlType"] != "None"}
        by_name = {a["name"]: a for a in flat}
        AR, AP, BANK = by_control["AccountsReceivable"], by_control["AccountsPayable"], by_control["BankCash"]
        RENT, SALARIES = by_name["Rent"], by_name["Salaries"]

        status, client = http("POST", "/api/clients", base, token=token, body={
            "companyId": company_id, "name": "[TEMP] Reports Buyer", "address": "Karachi",
            "ntn": "4228937-8", "strn": "9876543210987",
            "registrationType": "Registered", "fbrProvinceCode": 8})
        status, supplier = http("POST", "/api/suppliers", base, token=token, body={
            "companyId": company_id, "name": "[TEMP] Reports Supplier", "address": "Karachi"})
        status, itype = http("POST", "/api/itemtypes", base, token=token, body={
            "name": f"[TEMP] Reports Widget {stamp}", "uom": "KG", "companyId": company_id})
        if not check("0", "buyer, supplier and item type created",
                     client and supplier and itype and "id" in itype, "setup failed"):
            return 1
        type_id = itype["id"]

        def make_bill(extra=None, qty=100, price=1000):
            s, dc = http("POST", f"/api/deliverychallans/company/{company_id}", base, token=token, body={
                "companyId": company_id, "clientId": client["id"], "poNumber": "PO-RPT",
                "poDate": today, "deliveryDate": today,
                "items": [{"description": "[TEMP] sold", "quantity": qty, "unit": "KG",
                           "itemTypeId": type_id}]})
            if s not in (200, 201):
                return s, dc
            body = {"date": today, "companyId": company_id, "clientId": client["id"],
                    "gstRate": 18, "challanIds": [dc["id"]],
                    "items": [{"deliveryItemId": dc["items"][0]["id"], "unitPrice": price,
                               "description": "[TEMP] sold", "itemTypeId": type_id}]}
            body.update(extra or {})
            return http("POST", "/api/invoices", base, token=token, body=body)

        status, inv_plain = make_bill()
        check("0", "a plain sale exists", status in (200, 201), f"{status} {err_text(inv_plain)}")
        status, inv_ft = make_bill({"furtherTaxRate": 3}, qty=50)
        check("0", "a further-taxed sale exists", status in (200, 201), f"{status} {err_text(inv_ft)}")
        status, inv_wh = make_bill({"withholdingTaxRate": 0.5}, qty=25)
        check("0", "a withheld sale exists", status in (200, 201), f"{status} {err_text(inv_wh)}")

        status, pb = http("POST", "/api/purchasebills", base, token=token, body={
            "companyId": company_id, "supplierId": supplier["id"], "date": today,
            "gstRate": 18, "supplierBillNumber": f"SB-{stamp}",
            "items": [{"itemTypeId": type_id, "description": "[TEMP] bought",
                       "quantity": 40, "uom": "KG", "unitPrice": 1000}]})
        check("0", "a purchase exists", status in (200, 201), f"{status} {err_text(pb)}")

        status, rcp = http("POST", f"/api/payments/receipts/company/{company_id}", base, token=token, body={
            "date": today, "contactType": "Client", "contactId": client["id"],
            "bankAccountId": BANK["id"], "method": "Cash",
            "allocations": [{"invoiceId": inv_plain["id"], "amount": 40000}]})
        check("0", "a receipt exists", status in (200, 201), f"{status} {err_text(rcp)}")

        # A manual journal, so the expense figures are not purely document-driven.
        status, je = http("POST", f"/api/journal-entries/company/{company_id}", base, token=token, body={
            "date": today, "narration": "[TEMP] rent accrual",
            "lines": [{"accountId": RENT["id"], "debit": 25000, "credit": 0},
                      {"accountId": SALARIES["id"], "debit": 0, "credit": 25000}]})
        check("0", "a manual journal exists", status == 200, f"{status} {err_text(je)}")

        # ── the reports, read once ───────────────────────────────────────────
        def rpt(name, **params):
            qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
            s, r = http("GET", f"/api/accounting/reports/company/{company_id}/{name}"
                        + (f"?{qs}" if qs else ""), base, token=token)
            return s, r

        status, bs = rpt("balance-sheet", asOf=d_to)
        if not check("1", "the balance sheet loads", status == 200, f"{status} {err_text(bs)}"):
            return 1
        status, pl = rpt("profit-and-loss", **{"from": d_from, "to": d_to})
        check("1", "profit and loss loads", status == 200, f"got {status}")
        status, cash = rpt("cash-book", **{"from": d_from, "to": d_to})
        check("1", "the cash book loads", status == 200, f"got {status}")
        status, exp = rpt("expenses", **{"from": d_from, "to": d_to})
        check("1", "the expense report loads", status == 200, f"got {status}")
        status, ar = rpt("aged-receivables", asOf=d_to)
        check("1", "aged receivables loads", status == 200, f"got {status}")
        status, ap = rpt("aged-payables", asOf=d_to)
        check("1", "aged payables loads", status == 200, f"got {status}")
        status, tax = rpt("tax-control", **{"from": d_from, "to": d_to})
        check("1", "tax control loads", status == 200, f"got {status}")
        status, dash = rpt("dashboard", **{"from": d_from, "to": d_to})
        check("1", "the dashboard loads", status == 200, f"got {status}")

        # The trial balance belongs to the ledger, not to this reports suite —
        # it is the ledger's own primitive, and it is what several checks below
        # measure the reports against.
        status_tb, tb = http("GET", f"/api/accounting/reports/company/{company_id}/trial-balance",
                             base, token=token)
        if not check("1", "the trial balance loads", status_tb == 200, f"{status_tb} {err_text(tb)}"):
            return 1

        status, tree = http("GET", f"/api/accounts/company/{company_id}/tree", base, token=token)
        chart = {a["id"]: a for a in list(walk(tree["balanceSheet"])) + list(walk(tree["profitAndLoss"]))}

        # ── 2. the balance sheet foots ───────────────────────────────────────
        print("\n=== 2. The balance sheet foots, and its earnings are the P&L's ===")
        check("2", "assets equal liabilities plus equity",
              bs["isBalanced"] is True,
              f"{bs['totalAssets']} vs {D(bs['totalLiabilities']) + D(bs['totalEquity'])}")
        # Two reports, one number: the earnings rolled into the sheet must be the
        # net the P&L reports for the same window.
        check("2", "current-year earnings equal the P&L's net profit",
              D(bs["currentEarnings"]) == D(pl["netProfit"]),
              f"{bs['currentEarnings']} vs {pl['netProfit']}")

        # ── 3. expenses vs the trial balance ─────────────────────────────────
        print("\n=== 3. The expense report agrees with the trial balance ===")
        tb_expense = sum(D(r["debit"]) - D(r["credit"]) for r in tb["rows"]
                         if r["accountType"] == "Expense")
        check("3", "the expense total equals the trial balance's expense movement",
              D(exp["total"]) == tb_expense, f"{exp['total']} vs {tb_expense}")
        check("3", "and equals the P&L's total expenses",
              D(exp["total"]) == D(pl["totalExpenses"]), f"{exp['total']} vs {pl['totalExpenses']}")
        check("3", "the rows sum to the total",
              sum(D(r["amount"]) for r in exp["rows"]) == D(exp["total"]), "rows do not sum")
        check("3", "the manual journal's rent is in it",
              any(r["accountId"] == RENT["id"] and D(r["amount"]) >= 25000 for r in exp["rows"]),
              "a manual journal's expense is missing from the expense report")

        # ── 4. cash book vs the chart ────────────────────────────────────────
        print("\n=== 4. The cash book agrees with the Chart of Accounts ===")
        for a in cash["accounts"]:
            check("4", f"{a['name']} closing equals its chart balance",
                  D(a["closing"]) == D(chart[a["accountId"]]["balance"]),
                  f"{a['closing']} vs {chart[a['accountId']]['balance']}")
            check("4", f"{a['name']} opening plus movement equals its closing",
                  D(a["opening"]) + D(a["moneyIn"]) - D(a["moneyOut"]) == D(a["closing"]),
                  f"{a['opening']} + {a['moneyIn']} - {a['moneyOut']} != {a['closing']}")
        check("4", "the receipt is visible as money in",
              D(cash["moneyIn"]) >= Decimal("40000"), f"got {cash['moneyIn']}")

        # ── 5. aging vs the control accounts ─────────────────────────────────
        print("\n=== 5. Aging agrees with the control accounts ===")
        check("5", "aged receivables equal the A/R control account",
              D(ar["total"]) == D(chart[AR["id"]]["balance"]),
              f"{ar['total']} vs {chart[AR['id']]['balance']}")
        check("5", "aged payables equal the A/P control account",
              D(ap["total"]) == -D(chart[AP["id"]]["balance"]),
              f"{ap['total']} vs {-D(chart[AP['id']]['balance'])}")
        check("5", "the receivable buckets sum to the total",
              D(ar["current"]) + D(ar["days1To30"]) + D(ar["days31To60"])
              + D(ar["days61To90"]) + D(ar["over90"]) == D(ar["total"]), "buckets do not sum")
        check("5", "today's invoices are Current, not overdue",
              D(ar["current"]) == D(ar["total"]), f"{ar['current']} vs {ar['total']}")

        # ── 6. tax control vs the documents ──────────────────────────────────
        print("\n=== 6. Tax control: the ledger against the documents ===")
        check("6", "every tax account reconciles to the documents behind it",
              tax["allReconcile"] is True,
              "; ".join(f"{r['role']} ledger {r['perLedger']} vs docs {r['perDocuments']}"
                        for r in tax["rows"] if not r["reconciles"]))
        rows = {r["role"]: r for r in tax["rows"]}
        # The figures re-derived from the documents, checked against the
        # documents this suite itself created — a third route to the same number.
        expected_output = (D(inv_plain["gstAmount"]) + D(inv_ft["gstAmount"]) + D(inv_wh["gstAmount"]))
        check("6", "output tax matches the sales this suite raised",
              D(rows["OutputTax"]["perDocuments"]) == expected_output,
              f"{rows['OutputTax']['perDocuments']} vs {expected_output}")
        check("6", "further tax is reported separately from output tax",
              D(rows["FurtherTaxPayable"]["perDocuments"]) == D(inv_ft["furtherTaxAmount"])
              and rows["FurtherTaxPayable"]["accountId"] != rows["OutputTax"]["accountId"],
              f"{rows['FurtherTaxPayable']['perDocuments']} vs {inv_ft['furtherTaxAmount']}")
        check("6", "input tax matches the purchase",
              D(rows["InputTax"]["perDocuments"]) == D(pb["gstAmount"]),
              f"{rows['InputTax']['perDocuments']} vs {pb['gstAmount']}")
        check("6", "withholding receivable matches the withheld sale",
              D(rows["WithholdingReceivable"]["perDocuments"]) == D(inv_wh["withholdingTaxAmount"]),
              f"{rows['WithholdingReceivable']['perDocuments']} vs {inv_wh['withholdingTaxAmount']}")

        # ── 7. the dashboard is the reports ──────────────────────────────────
        print("\n=== 7. The dashboard is the reports, not a fourth opinion ===")
        check("7", "income matches the P&L", D(dash["income"]) == D(pl["totalIncome"]),
              f"{dash['income']} vs {pl['totalIncome']}")
        check("7", "expenses match the P&L", D(dash["expenses"]) == D(pl["totalExpenses"]),
              f"{dash['expenses']} vs {pl['totalExpenses']}")
        check("7", "net profit matches the P&L", D(dash["netProfit"]) == D(pl["netProfit"]),
              f"{dash['netProfit']} vs {pl['netProfit']}")
        check("7", "cash matches the cash book", D(dash["cashAndBank"]) == D(cash["closing"]),
              f"{dash['cashAndBank']} vs {cash['closing']}")
        check("7", "receivables match the aging", D(dash["receivables"]) == D(ar["total"]),
              f"{dash['receivables']} vs {ar['total']}")
        check("7", "payables match the aging", D(dash["payables"]) == D(ap["total"]),
              f"{dash['payables']} vs {ap['total']}")
        check("7", "output tax matches the tax control report",
              D(dash["outputTax"]) == D(rows["OutputTax"]["perLedger"]),
              f"{dash['outputTax']} vs {rows['OutputTax']['perLedger']}")
        check("7", "and it says the ledger balances", dash["ledgerBalances"] is True, "it does not")

        # ── 8. the period window is respected ────────────────────────────────
        print("\n=== 8. A window is a window ===")
        long_ago = (day - timedelta(days=400)).isoformat()
        status, empty_pl = rpt("profit-and-loss", **{"from": long_ago, "to": (day - timedelta(days=380)).isoformat()})
        if check("8", "a P&L for a period with no trading loads", status == 200, f"got {status}"):
            check("8", "and reports nothing", D(empty_pl["totalIncome"]) == 0
                  and D(empty_pl["totalExpenses"]) == 0,
                  f"income {empty_pl['totalIncome']} expenses {empty_pl['totalExpenses']}")
        status, empty_exp = rpt("expenses", **{"from": long_ago, "to": (day - timedelta(days=380)).isoformat()})
        check("8", "so does the expense report", status == 200 and D(empty_exp["total"]) == 0,
              f"{status} total {empty_exp.get('total') if isinstance(empty_exp, dict) else empty_exp}")

        # ── 9. party ledger vs the control account ───────────────────────────
        print("\n=== 9. A party ledger agrees with its control account ===")
        status, ledger = rpt("party-ledger", partyType="Client", partyId=client["id"])
        if check("9", "the client's ledger loads", status == 200, f"{status} {err_text(ledger)}"):
            check("9", "its closing equals this client's share of A/R",
                  D(ledger["closingBalance"]) == D(chart[AR["id"]]["balance"]),
                  f"{ledger['closingBalance']} vs {chart[AR['id']]['balance']}")
            check("9", "the running balance ends at the closing balance",
                  not ledger["rows"] or D(ledger["rows"][-1]["runningBalance"]) == D(ledger["closingBalance"]),
                  "the running balance does not land on the closing")
            check("9", "it shows every document that touched the client",
                  len(ledger["rows"]) >= 4, f"got {len(ledger['rows'])} rows")

        status, other = rpt("party-ledger", partyType="Client", partyId=999999)
        check("9", "a party that isn't this company's is refused with a plain 404",
              status == 404, f"got {status}")
        status, bad = rpt("party-ledger", partyType="Nonsense", partyId=client["id"])
        check("9", "so is a party type that doesn't exist", status == 404, f"got {status}")

    finally:
        print("\n=== Cleanup ===")
        if company_id:
            status, _ = http("DELETE", f"/api/companies/{company_id}", base, token=token)
            check("cleanup", "throwaway company deleted", status in (200, 204), f"got {status}")
        if type_id:
            status, _ = http("DELETE", f"/api/itemtypes/{type_id}", base, token=token)
            check("cleanup", "throwaway item type removed with company", status in (200, 204, 404), f"got {status}")

    print()
    print("=" * 78)
    if FAIL:
        print(f"  {PASS} passed, {FAIL} FAILED")
        for f in FAILURES:
            print(f"   - {f}")
        print("=" * 78)
        return 1
    print(f"  ACCOUNTING REPORTS SUITE PASSED - {PASS}/{PASS} checks")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
