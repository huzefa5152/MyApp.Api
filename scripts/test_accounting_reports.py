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
    ledger is deliberately checked against something outside it;
  • Gross Profit, Monthly Profit and Customer Profitability against the P&L
    (whole range and month by month) and against the journal entry each sale,
    credit note and withdrawn bill posted.

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


# ═════════════════════════════════════════════════════════════════════════════
#  Profit reports (2026-10-10) — Gross Profit, Monthly Profit, Customer
#  Profitability. Every check measures a profit report against the Profit &
#  Loss, against the journal entries of the documents behind it, or against
#  the documents this suite raised — never against itself.
# ═════════════════════════════════════════════════════════════════════════════

COST_NOTE = "recorded only for stock-tracked items"
UNATTRIBUTED = "Not attributed to a customer"
# Real tariff codes, tried in order: the catalog validates an HS code, and a
# fixture that invents one fails for a reason that has nothing to do with this
# suite.
HS_CANDIDATES = ["8538.1000", "8481.8090", "8536.5010", "8414.5110", "8413.7010",
                 "8504.4090", "8544.4990", "3926.9099", "7318.1510", "8471.3020"]


def catalog(base, token, company_id, name, **params):
    """One accounting catalog report (/api/accounting/catalog/...)."""
    qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
    return http("GET", f"/api/accounting/catalog/company/{company_id}/{name}"
                + (f"?{qs}" if qs else ""), base, token=token)


def custom(d_from, d_to):
    return {"period": "custom", "from": d_from, "to": d_to}


def row_named(rows, name):
    return next((r for r in rows or [] if r.get("customer") == name), None)


def profit_ties_to_pl(suite, base, token, company_id, window, label):
    """The three profit reports against the P&L for one window. Returns
    (pl, gross, monthly, customers) for the caller's own checks."""
    # Both statements with their comparative column, so the prior period is
    # tied out line for line as well.
    s, pl = catalog(base, token, company_id, "profit-loss", **window)
    if not check(suite, f"{label}: the P&L loads", s == 200, f"{s} {err_text(pl)}"):
        return None
    s, gp = catalog(base, token, company_id, "gross-profit", **window)
    check(suite, f"{label}: Gross Profit loads", s == 200, f"{s} {err_text(gp)}")
    s, mp = catalog(base, token, company_id, "monthly-profit", **window)
    check(suite, f"{label}: Monthly Profit loads", s == 200, f"{s} {err_text(mp)}")
    s, cp = catalog(base, token, company_id, "customer-profitability", **window)
    check(suite, f"{label}: Customer Profitability loads", s == 200, f"{s} {err_text(cp)}")
    if not all(isinstance(x, dict) for x in (gp, mp, cp)):
        return None

    income, cost = D(pl["totalIncome"]), D(pl["totalCostOfSales"])
    expenses, net = D(pl["totalExpenses"]), D(pl["netProfit"])

    # Gross Profit is the top of the P&L.
    check(suite, f"{label}: gross profit revenue is the P&L's income",
          D(gp["totals"]["revenue"]) == income, f"{gp['totals']['revenue']} vs {income}")
    check(suite, f"{label}: gross profit cost of sales is the P&L's",
          D(gp["totals"]["costOfSales"]) == cost, f"{gp['totals']['costOfSales']} vs {cost}")
    check(suite, f"{label}: gross profit is revenue less cost of sales",
          D(gp["totals"]["grossProfit"]) == income - cost,
          f"{gp['totals']['grossProfit']} vs {income - cost}")
    if income:
        expected_margin = (((income - cost) / income) * 100).quantize(Decimal("0.1"), rounding="ROUND_HALF_UP")
        check(suite, f"{label}: the gross margin is gross profit over revenue",
              D(gp["totals"].get("grossMarginPercent", "nan")) == expected_margin,
              f"{gp['totals'].get('grossMarginPercent')} vs {expected_margin}")
    # Line for line: every income / cost-of-sales account on the P&L appears on
    # Gross Profit at the same figure, and nothing else does.
    def lines(st):
        return {l["accountId"]: (D(l["amount"]), None if l.get("comparative") is None else D(l["comparative"]))
                for l in st["rows"] if l.get("kind") == "account" and l.get("accountId")}
    pl_lines, gp_lines = lines(pl), lines(gp)
    check(suite, f"{label}: every Gross Profit account line is the P&L's own line, both periods",
          all(pl_lines.get(k) == v for k, v in gp_lines.items()),
          f"gp={ {k: str(v) for k, v in gp_lines.items()} } pl={ {k: str(v) for k, v in pl_lines.items()} }")
    check(suite, f"{label}: and the lines add up to revenue plus cost (both read positive)",
          sum((v[0] for v in gp_lines.values()), Decimal(0)) == income + cost,
          "income lines + cost lines do not match the section totals")
    check(suite, f"{label}: the comparative period is the P&L's comparative",
          gp.get("comparativeLabel") == pl.get("comparativeLabel"),
          f"{gp.get('comparativeLabel')} vs {pl.get('comparativeLabel')}")

    # Monthly Profit: totals are the P&L for the range ...
    for key, want in (("revenue", income), ("costOfSales", cost),
                      ("grossProfit", income - cost), ("otherExpenses", expenses),
                      ("netProfit", net)):
        check(suite, f"{label}: monthly {key} total is the P&L's",
              D(mp["totals"].get(key, 0)) == want, f"{mp['totals'].get(key)} vs {want}")
    # ... and each month is the P&L run for that month alone.
    for row in mp["rows"]:
        s, one = catalog(base, token, company_id, "profit-loss", comparative="false",
                         **custom(row["from"][:10], row["to"][:10]))
        ok = s == 200 and D(row["revenue"]) == D(one["totalIncome"]) \
            and D(row["costOfSales"]) == D(one["totalCostOfSales"]) \
            and D(row["otherExpenses"]) == D(one["totalExpenses"]) \
            and D(row["netProfit"]) == D(one["netProfit"]) \
            and D(row["grossProfit"]) == D(row["revenue"]) - D(row["costOfSales"])
        check(suite, f"{label}: {row['label']} equals the P&L for that month", ok,
              f"row={row} pl={ {k: one.get(k) for k in ('totalIncome', 'totalCostOfSales', 'totalExpenses', 'netProfit')} if isinstance(one, dict) else one}")

    # Customer Profitability: customers + the unattributed row = the P&L.
    rows = cp["rows"]
    check(suite, f"{label}: customer revenue plus the unattributed row is the P&L's income",
          sum((D(r["revenue"]) for r in rows), Decimal(0)) == income,
          f"{sum((D(r['revenue']) for r in rows), Decimal(0))} vs {income}")
    check(suite, f"{label}: customer cost plus the unattributed row is the P&L's cost of sales",
          sum((D(r["costOfSales"]) for r in rows), Decimal(0)) == cost,
          f"{sum((D(r['costOfSales']) for r in rows), Decimal(0))} vs {cost}")
    check(suite, f"{label}: the report totals are the P&L's",
          D(cp["totals"]["revenue"]) == income and D(cp["totals"]["costOfSales"]) == cost
          and D(cp["totals"]["grossProfit"]) == income - cost, f"{cp['totals']}")
    customers = [r for r in rows if not r.get("isUnattributed")]
    gps = [D(r["grossProfit"]) for r in customers]
    check(suite, f"{label}: customers are sorted by gross profit, largest first",
          gps == sorted(gps, reverse=True), f"{gps}")
    check(suite, f"{label}: the unattributed row, when present, is last and not drillable",
          all(not r.get("drillKey") for r in rows if r.get("isUnattributed"))
          and (not any(r.get("isUnattributed") for r in rows) or rows[-1].get("isUnattributed")),
          "unattributed row misplaced or drillable")
    check(suite, f"{label}: every customer row drills to its own client",
          all(r.get("drillKey") == str(r.get("clientId")) for r in customers)
          and cp.get("rowDrillFilter") == "clientId", "drill keys do not name the client")
    return pl, gp, mp, cp


def non_stock_profit_checks(base, token, company_id, d_from, d_to, purchase_net, client_id):
    """The suite's main company does not track stock: purchases are charged to
    cost of sales when bought, and no sale carries a cost."""
    print("\n=== 10. Profit reports on a company that does not track stock ===")
    got = profit_ties_to_pl("10", base, token, company_id, custom(d_from, d_to), "non-stock")
    if not got:
        return
    pl, gp, mp, cp = got
    customers = [r for r in cp["rows"] if not r.get("isUnattributed")]
    check("10", "the customer is listed", any(r.get("clientId") == client_id for r in customers),
          f"rows {cp['rows']}")
    check("10", "no customer carries a cost — none was posted against a sale",
          all(D(r["costOfSales"]) == 0 for r in customers), f"{customers}")
    rest = row_named(cp["rows"], UNATTRIBUTED)
    check("10", "the purchase sits on the unattributed row as cost of sales",
          rest is not None and D(rest["costOfSales"]) == D(pl["totalCostOfSales"]) == purchase_net,
          f"rest={rest} pl cost={pl['totalCostOfSales']} purchase={purchase_net}")
    for name, rep in (("Gross Profit", gp), ("Monthly Profit", mp), ("Customer Profitability", cp)):
        check("10", f"{name} says cost of goods sold is recorded only for stock-tracked items",
              COST_NOTE in (rep.get("notice") or ""), f"notice: {rep.get('notice')}")


def stock_profit_suite(base, token, day, stamp):
    """A stock-tracked company with a purchase, sales to two customers, a
    credit note, a bill withdrawn at FBR, manual journals in two months and a
    demo bill — then every profit figure is tied to the P&L and to the journal
    entries of the documents behind it."""
    print("\n=== 11. Profit reports on a stock-tracked company ===")
    S = "11"
    today = day.strftime("%Y-%m-%dT00:00:00Z")
    month_start = day.replace(day=1)
    prev_month_start = (month_start - timedelta(days=1)).replace(day=1)
    next_month = (month_start + timedelta(days=32)).replace(day=1)
    month_end = next_month - timedelta(days=1)
    window = custom(prev_month_start.isoformat(), month_end.isoformat())
    this_month = custom(month_start.isoformat(), month_end.isoformat())

    company_id = None
    try:
        s, company = http("POST", "/api/companies", base, token=token, body={
            "name": f"[TEMP] Profit Suite {stamp}", "brandName": "[TEMP] Profit Suite",
            "fullAddress": "Karachi", "ntn": "1234567", "cnic": "4220100000000",
            "strn": "1234567890123", "fbrSellerRegistrationNo": "1234567",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingDebitNoteNumber": 1, "startingCreditNoteNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "fbrProvinceCode": 8, "fbrBusinessActivity": "Wholesaler",
            "fbrSector": "Wholesale / Retails", "fbrEnvironment": "sandbox",
            "fbrToken": "placeholder-not-a-real-token",
            "inventoryTrackingEnabled": True, "stockGuardHardBlock": False,
        })
        if not check(S, "stock-tracked company created", s in (200, 201), f"{s} {err_text(company)}"):
            return
        company_id = company["id"]
        # The chart first: without it the sales would post to Suspense and there
        # would be no Cost of goods sold to relieve into.
        s, _ = http("POST", f"/api/accounts/company/{company_id}/seed-wholesale", base, token=token)
        check(S, "chart seeded before any document", s == 200, f"got {s}")
        s, flat = http("GET", f"/api/accounts/company/{company_id}/flat", base, token=token)
        by_control = {a["controlType"]: a for a in flat if a["controlType"] != "None"}
        by_name = {a["name"]: a for a in flat}
        SALES, COGS = by_name["Sales"], by_name["Cost of goods sold"]
        OTHER_INCOME, RENT = by_name["Other income"], by_name["Rent"]
        # Bank and cash cannot take a manual journal, so the contra legs are a
        # plain equity and a plain liability account.
        DRAWINGS, LOANS = by_name["Owner drawings"], by_name["Loans payable"]

        def party(path, name, **extra):
            return http("POST", path, base, token=token, body={
                "companyId": company_id, "name": name, "address": "Karachi", **extra})
        _, c1 = party("/api/clients", f"[TEMP] Profit Buyer One {stamp}", ntn="4228937",
                      strn="9876543210987", registrationType="Registered", fbrProvinceCode=8)
        _, c2 = party("/api/clients", f"[TEMP] Profit Buyer Two {stamp}", ntn="4228938",
                      strn="9876543210988", registrationType="Registered", fbrProvinceCode=8)
        _, sup = party("/api/suppliers", f"[TEMP] Profit Supplier {stamp}")
        if not check(S, "two customers and a supplier created",
                     all(isinstance(x, dict) and "id" in x for x in (c1, c2, sup)), f"{c1} {c2} {sup}"):
            return

        items = []
        for hs in HS_CANDIDATES:
            if len(items) == 2:
                break
            s, it = http("POST", f"/api/itemtypes?companyId={company_id}", base, token=token, body={
                "name": f"[TEMP] Profit Item {len(items) + 1} {stamp}", "hsCode": hs, "uom": "Pcs",
                "saleType": "Goods at standard rate (default)", "isFavorite": True,
                "companyId": company_id})
            if s in (200, 201) and isinstance(it, dict) and it.get("id"):
                items.append(it)
        if not check(S, "two classified (HS) item types created — only those move stock",
                     len(items) == 2, f"created {len(items)}"):
            return
        A, B = items

        # Bought: 100 of A at 50 and 40 of B at 200 — weighted-average costs 50 / 200.
        s, pb = http("POST", "/api/purchasebills", base, token=token, body={
            "companyId": company_id, "supplierId": sup["id"], "date": today, "gstRate": 18,
            "supplierBillNumber": f"PS-{stamp}",
            "items": [{"itemTypeId": A["id"], "description": A["name"], "quantity": 100,
                       "uom": "Pcs", "unitPrice": 50},
                      {"itemTypeId": B["id"], "description": B["name"], "quantity": 40,
                       "uom": "Pcs", "unitPrice": 200}]})
        check(S, "the purchase is on file", s in (200, 201), f"{s} {err_text(pb)}")

        def sell(client, lines):
            return http("POST", "/api/invoices/standalone", base, token=token, body={
                "date": today, "companyId": company_id, "clientId": client["id"], "gstRate": 18,
                "items": [{"itemTypeId": it["id"], "description": it["name"], "quantity": q,
                           "uom": "Pcs", "unitPrice": p} for it, q, p in lines]})

        s, inv1 = sell(c1, [(A, 10, 120)])            # revenue 1,200, cost 500
        check(S, "sale 1 to customer one", s in (200, 201), f"{s} {err_text(inv1)}")
        s, inv2 = sell(c2, [(B, 5, 300)])             # revenue 1,500, cost 1,000
        check(S, "sale to customer two", s in (200, 201), f"{s} {err_text(inv2)}")
        s, inv3 = sell(c1, [(B, 4, 250), (A, 2, 90)])  # revenue 1,180, cost 900
        check(S, "sale 2 to customer one", s in (200, 201), f"{s} {err_text(inv3)}")
        s, inv4 = sell(c2, [(A, 3, 100)])             # withdrawn at FBR below
        check(S, "a sale that will be withdrawn at FBR", s in (200, 201), f"{s} {err_text(inv4)}")
        if not all(isinstance(x, dict) and "id" in x for x in (inv1, inv2, inv3, inv4)):
            return

        # A note and a withdrawal need a FILED bill. Record the filing through the
        # application's own audited recovery route — it never contacts FBR.
        def record_filed(inv):
            return http("POST", f"/api/fbr/{inv['id']}/reset-submission", base, token=token, body={
                "mode": "recordExisting", "irn": f"LOCALTEST{stamp}{inv['id']}",
                "reason": "Accounting reports suite: local fixture, never sent to FBR"})
        s1, _ = record_filed(inv1)
        s4, _ = record_filed(inv4)
        check(S, "two bills recorded as filed (locally, no FBR call)",
              s1 == 200 and s4 == 200, f"{s1} {s4}")

        # Customer one returns 3 of the 10 A: revenue -360, cost -150.
        s, note = http("POST", "/api/invoices/notes", base, token=token, body={
            "originalInvoiceId": inv1["id"], "documentType": 10, "reason": "Return of goods",
            "affectsStock": True,
            "lines": [{"invoiceItemId": inv1["items"][0]["id"], "quantity": 3}]})
        if not check(S, "a partial credit note returns goods", s in (200, 201), f"{s} {err_text(note)}"):
            return
        s, _ = http("POST", f"/api/invoices/{inv4['id']}/fbr-cancelled", base, token=token,
                    body={"reason": "Accounting reports suite"})
        check(S, "a bill is recorded as withdrawn at FBR", s == 200, f"got {s}")

        # Manual journals: other income LAST month, rent THIS month — two months
        # with activity, and revenue no customer's document carries.
        s, je1 = http("POST", f"/api/journal-entries/company/{company_id}", base, token=token, body={
            "date": prev_month_start.strftime("%Y-%m-%dT00:00:00Z"), "narration": "[TEMP] other income",
            "lines": [{"accountId": DRAWINGS["id"], "debit": 777, "credit": 0},
                      {"accountId": OTHER_INCOME["id"], "debit": 0, "credit": 777}]})
        check(S, "a manual journal to other income, last month", s == 200, f"{s} {err_text(je1)}")
        s, je2 = http("POST", f"/api/journal-entries/company/{company_id}", base, token=token, body={
            "date": today, "narration": "[TEMP] rent",
            "lines": [{"accountId": RENT["id"], "debit": 2000, "credit": 0},
                      {"accountId": LOANS["id"], "debit": 0, "credit": 2000}]})
        check(S, "a manual journal to rent, this month", s == 200, f"{s} {err_text(je2)}")

        # The journal entry each document owns, read straight from the ledger.
        s, page = http("GET", f"/api/journal-entries/company/{company_id}/paged?pageSize=200",
                       base, token=token)
        entries = {(e["sourceDocType"], e["sourceDocId"]): e for e in (page or {}).get("items", [])}

        def legs(doc_id):
            e = entries.get(("Invoice", doc_id))
            out = {}
            for l in (e or {}).get("lines", []):
                out[l["accountId"]] = out.get(l["accountId"], Decimal(0)) + D(l["debit"]) - D(l["credit"])
            return out

        def revenue_of(doc_id):
            return -legs(doc_id).get(SALES["id"], Decimal(0))

        def cogs_of(doc_id):
            return legs(doc_id).get(COGS["id"], Decimal(0))

        check(S, "each sale's own entry carries its cost (the inventory relief)",
              cogs_of(inv1["id"]) == Decimal("500") and cogs_of(inv2["id"]) == Decimal("1000")
              and cogs_of(inv3["id"]) == Decimal("900"),
              f"{cogs_of(inv1['id'])} {cogs_of(inv2['id'])} {cogs_of(inv3['id'])}")
        check(S, "and the credit note's entry hands cost back",
              cogs_of(note["id"]) == Decimal("-150") and revenue_of(note["id"]) == Decimal("-360"),
              f"cost {cogs_of(note['id'])} revenue {revenue_of(note['id'])}")

        got = profit_ties_to_pl(S, base, token, company_id, window, "stock, two months")
        if not got:
            return
        pl, gp, mp, cp = got
        profit_ties_to_pl(S, base, token, company_id, this_month, "stock, this month")

        # Independent of the P&L: the figures the documents themselves say.
        sales_net = sum((D(i["subtotal"]) for i in (inv1, inv2, inv3, inv4)), Decimal(0)) - D(note["subtotal"])
        check(S, "revenue is what the documents sold, net of the credit note, plus other income",
              D(gp["totals"]["revenue"]) == sales_net + Decimal("777"),
              f"{gp['totals']['revenue']} vs {sales_net} + 777")
        check(S, "gross profit cost of sales is the COGS each document posted",
              D(gp["totals"]["costOfSales"]) == sum((cogs_of(i) for i in
                  (inv1["id"], inv2["id"], inv3["id"], inv4["id"], note["id"])), Decimal(0)),
              f"{gp['totals']['costOfSales']}")
        months = [r for r in mp["rows"] if D(r["revenue"]) or D(r["otherExpenses"])]
        check(S, "two months carry activity — last month's other income, this month's trading",
              len(mp["rows"]) == 2 and len(months) == 2
              and D(mp["rows"][0]["revenue"]) == Decimal("777")
              and D(mp["rows"][0]["costOfSales"]) == 0
              and D(mp["rows"][1]["otherExpenses"]) == Decimal("2000"),
              f"{mp['rows']}")

        one = next((r for r in cp["rows"] if r.get("clientId") == c1["id"]), None)
        two = next((r for r in cp["rows"] if r.get("clientId") == c2["id"]), None)
        rest = row_named(cp["rows"], UNATTRIBUTED)
        if check(S, "both customers are listed", one is not None and two is not None, f"{cp['rows']}"):
            check(S, "customer one's revenue is their invoices less their credit note",
                  D(one["revenue"]) == revenue_of(inv1["id"]) + revenue_of(inv3["id"]) + revenue_of(note["id"])
                  == D(inv1["subtotal"]) + D(inv3["subtotal"]) - D(note["subtotal"]),
                  f"{one['revenue']}")
            check(S, "customer one's cost is their invoices' relief less the return",
                  D(one["costOfSales"]) == cogs_of(inv1["id"]) + cogs_of(inv3["id"]) + cogs_of(note["id"])
                  == Decimal("1250"), f"{one['costOfSales']}")
            check(S, "the credit note lowered both — not just revenue",
                  D(one["revenue"]) == Decimal("2020") and D(one["costOfSales"]) == Decimal("1250"),
                  f"revenue {one['revenue']} cost {one['costOfSales']}")
            check(S, "customer one counts two invoices and not the note",
                  one["invoices"] == 2 and one["notes"] == 1, f"{one['invoices']} / {one['notes']}")
            check(S, "customer two is only the bill still standing",
                  D(two["revenue"]) == revenue_of(inv2["id"]) and D(two["costOfSales"]) == cogs_of(inv2["id"])
                  and two["invoices"] == 1, f"{two}")
            check(S, "margin is gross profit over revenue",
                  D(one["marginPercent"]) == ((D(one["grossProfit"]) / D(one["revenue"])) * 100)
                  .quantize(Decimal("0.1"), rounding="ROUND_HALF_UP"), f"{one}")
        check(S, "the unattributed row is the other income and the bill withdrawn at FBR",
              rest is not None
              and D(rest["revenue"]) == Decimal("777") + revenue_of(inv4["id"])
              and D(rest["costOfSales"]) == cogs_of(inv4["id"]),
              f"{rest}")

        # A demo bill is not a sale: seeding them must not move a single figure.
        s, seeded = http("POST", f"/api/fbr/sandbox/{company_id}/seed", base, token=token)
        s_list, demos = http("GET", f"/api/fbr/sandbox/{company_id}", base, token=token)
        demo_count = len(demos) if isinstance(demos, list) else len((demos or {}).get("bills") or (demos or {}).get("items") or [])
        if check(S, "demo bills seeded", s == 200 and demo_count > 0, f"{s} {err_text(seeded)} list={s_list}"):
            s, cp2 = catalog(base, token, company_id, "customer-profitability", **window)
            s_pl, pl2 = catalog(base, token, company_id, "profit-loss", comparative="false", **window)
            check(S, "demo bills change neither customer profitability nor the P&L",
                  s == 200 and s_pl == 200 and cp2["totals"] == cp["totals"]
                  and [(r["customer"], r["revenue"], r["invoices"]) for r in cp2["rows"]]
                  == [(r["customer"], r["revenue"], r["invoices"]) for r in cp["rows"]]
                  and D(pl2["totalIncome"]) == D(pl["totalIncome"]),
                  f"before {cp['totals']} after {cp2.get('totals') if isinstance(cp2, dict) else cp2}")

        check(S, "a stock-tracked company's notice says what cost of goods sold covers",
              COST_NOTE in (cp.get("notice") or "") and "stock it moves" in (gp.get("notice") or ""),
              f"{cp.get('notice')} | {gp.get('notice')}")

        # Excel: the three export, and each is a real workbook.
        for rid in ("gross-profit", "monthly-profit", "customer-profitability"):
            qs = "&".join(f"{k}={v}" for k, v in window.items())
            req = urllib.request.Request(
                f"{base.rstrip('/')}/api/accounting/catalog/company/{company_id}/export/{rid}?{qs}",
                headers={"Authorization": f"Bearer {token}"})
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    body, st = r.read(), r.status
            except urllib.error.HTTPError as e:
                body, st = b"", e.code
            check(S, f"{rid} exports to Excel", st == 200 and body[:2] == b"PK", f"got {st}")

        # A company that does not exist is a 404, not an empty report.
        s, _ = catalog(base, token, 99999999, "customer-profitability", **window)
        check(S, "an unknown company is a plain 404", s == 404, f"got {s}")
    finally:
        if company_id:
            s, _ = http("DELETE", f"/api/companies/{company_id}", base, token=token)
            check("cleanup", "stock-tracked profit company deleted", s in (200, 204), f"got {s}")


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

        # Freight is commercial revenue and a customer receivable, with no tax change.
        status, inv_freight = make_bill({"freightCharges": 325.50}, qty=1, price=1000)
        check("Freight", "commercial freight invoice created", status in (200, 201), f"{status} {err_text(inv_freight)}")
        if status in (200, 201):
            check("Freight", "freight leaves supply tax unchanged",
                  D(inv_freight["grandTotal"]) == Decimal("1180") and D(inv_freight["gstAmount"]) == Decimal("180"))
            fs, far = rpt("aged-receivables", asOf=d_to)
            check("Freight", "aging increases by commercial amount",
                  fs == 200 and D(far["total"]) - D(ar["total"]) == Decimal("1505.50"))
            fs, fpl = rpt("profit-and-loss", **{"from": d_from, "to": d_to})
            check("Freight", "revenue includes untaxed freight",
                  fs == 200 and D(fpl["totalIncome"]) - D(pl["totalIncome"]) == Decimal("1325.50"))
            fs, ftb = http("GET", f"/api/accounting/reports/company/{company_id}/trial-balance", base, token=token)
            check("Freight", "freight journal balances", fs == 200 and
                  sum(D(r["debit"]) for r in ftb["rows"]) == sum(D(r["credit"]) for r in ftb["rows"]))
            # Remove this isolated fixture before the existing snapshot cross-checks continue.
            ds, _ = http("DELETE", f"/api/invoices/{inv_freight['id']}", base, token=token)
            check("Freight", "isolated freight fixture removed", ds in (200, 204), f"got {ds}")

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

        # ── 10. profit reports, no stock tracking ────────────────────────────
        non_stock_profit_checks(base, token, company_id, d_from, d_to,
                                D(pb["subtotal"]), client["id"])

    finally:
        print("\n=== Cleanup ===")
        if company_id:
            status, _ = http("DELETE", f"/api/companies/{company_id}", base, token=token)
            check("cleanup", "throwaway company deleted", status in (200, 204), f"got {status}")
        if type_id:
            status, _ = http("DELETE", f"/api/itemtypes/{type_id}", base, token=token)
            check("cleanup", "throwaway item type removed with company", status in (200, 204, 404), f"got {status}")

    # ── 11. profit reports, stock tracked (its own company) ──────────────────
    stock_profit_suite(base, token, day, stamp)

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
