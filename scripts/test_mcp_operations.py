"""Local-only MCP operation contract checks using isolated existing fixtures.

Required environment variables: MCP_OPS_ADMIN_JWT, MCP_OPS_USER_TOKEN,
MCP_OPS_SEED_RESTRICTED_TOKEN, MCP_OPS_DENIED_TOKEN, MCP_OPS_COMPANY_A,
MCP_OPS_COMPANY_B. User and restricted seed tokens reach only A; denied token
reaches A but has only MCP access (no document/report permissions).
No users, documents, roles or grants are created or removed by this suite.
MCP calls append their ordinary activity log. Never prints credentials.
"""
from __future__ import annotations

import argparse
import json
import os
from decimal import Decimal
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:5134")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    if urlparse(base).hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise SystemExit("Refused: this suite runs only against a local backend.")
    required = ["ADMIN_JWT", "USER_TOKEN", "SEED_RESTRICTED_TOKEN", "DENIED_TOKEN", "COMPANY_A", "COMPANY_B"]
    missing = ["MCP_OPS_" + key for key in required if not os.environ.get("MCP_OPS_" + key)]
    if missing:
        raise SystemExit("Missing fixture variables: " + ", ".join(missing))
    env = {key: os.environ["MCP_OPS_" + key] for key in required}
    a, b = int(env["COMPANY_A"]), int(env["COMPANY_B"])
    if a == b:
        raise SystemExit("Fixture companies must differ.")
    results = []

    def check(label, condition):
        results.append(bool(condition))
        print(("PASS " if condition else "FAIL ") + label)

    def request(path, token, payload=None):
        body = None if payload is None else json.dumps(payload).encode()
        headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
        try:
            with urlopen(Request(base + path, body, headers), timeout=90) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, {}

    sequence = 0

    status, catalogue = request("/mcp", env["USER_TOKEN"], {"jsonrpc": "2.0", "id": "catalogue", "method": "tools/list"})
    expected_tools = {"get_daily_work_queue", "get_quote", "search_sales_orders", "get_sales_order", "search_suppliers", "search_item_types", "search_purchase_bills", "get_purchase_bill", "search_goods_receipts", "search_receipts", "search_payments", "get_trial_balance", "get_profit_and_loss", "get_balance_sheet", "get_cash_book", "get_aged_payables", "get_party_ledger"}
    offered = {row["name"] for row in catalogue.get("result", {}).get("tools", [])}
    if status != 200 or not expected_tools.issubset(offered):
        raise SystemExit("Operation catalogue preflight failed; positive authorization or deployed implementation is missing. Negative probes would prove nothing.")

    def tool(token, name, arguments):
        nonlocal sequence
        sequence += 1
        status, reply = request("/mcp", token, {"jsonrpc": "2.0", "id": sequence, "method": "tools/call", "params": {"name": name, "arguments": arguments}})
        if status != 200 or "error" in reply:
            return True, None
        result = reply["result"]
        return (True, None) if result.get("isError") else (False, json.loads(result["content"][0]["text"]))

    specs = [
        ("search_sales_orders", "salesorders"),
        ("search_purchase_bills", "purchasebills"),
        ("search_goods_receipts", "goodsreceipts"),
        ("search_receipts", "payments/receipts"),
        ("search_payments", "payments/payments"),
    ]
    for name, resource in specs:
        status, screen = request(f"/api/{resource}/company/{a}/paged?page=1&pageSize=3", env["ADMIN_JWT"])
        denied, result = tool(env["USER_TOKEN"], name, {"companyId": a, "pageSize": 3})
        check(name + " works for assigned company", status == 200 and not denied)
        if status == 200 and not denied:
            check(name + " count and IDs match screen", result["totalCount"] == screen["totalCount"] and [r["id"] for r in result["items"]] == [r["id"] for r in screen["items"]])
            check(name + " excludes sensitive payment metadata", not {"bankAccountName", "bankAccountId", "chequeNumber", "description", "notes", "allocations"}.intersection({k for row in result["items"] for k in row}))
        for key in ("USER_TOKEN", "SEED_RESTRICTED_TOKEN"):
            check(name + " rejects outside " + key, tool(env[key], name, {"companyId": b})[0])
        check(name + " rejects missing permission", tool(env["DENIED_TOKEN"], name, {"companyId": a})[0])
        denied, result = tool(env["USER_TOKEN"], name, {"companyId": a, "pageSize": 100000})
        check(name + " caps oversized output", not denied and result["pageSize"] <= 100 and len(result["items"]) <= 100)

    accounting = [
        ("get_trial_balance", "accounting/reports", "trial-balance", ["totalOpening", "totalDebit", "totalCredit", "totalClosing"]),
        ("get_profit_and_loss", "accounting/reports", "profit-and-loss", ["totalIncome", "totalExpenses", "netProfit"]),
        ("get_balance_sheet", "accounting/reports", "balance-sheet", ["totalAssets", "totalLiabilities", "totalEquity", "currentEarnings"]),
        ("get_cash_book", "accounting/reports", "cash-book", ["opening", "moneyIn", "moneyOut", "closing"]),
        ("get_aged_payables", "accounting/reports", "aged-payables", ["total", "current", "days1To30", "days31To60", "days61To90", "over90"]),
    ]
    for name, prefix, resource, totals in accounting:
        status, screen = request(f"/api/{prefix}/company/{a}/{resource}", env["ADMIN_JWT"])
        denied, result = tool(env["USER_TOKEN"], name, {"companyId": a, "limit": 2})
        check(name + " matches screen figures", status == 200 and not denied and all(Decimal(str(result[key])) == Decimal(str(screen[key])) for key in totals))
        for key in ("USER_TOKEN", "SEED_RESTRICTED_TOKEN"):
            check(name + " rejects outside " + key, tool(env[key], name, {"companyId": b})[0])
        check(name + " rejects missing permission", tool(env["DENIED_TOKEN"], name, {"companyId": a})[0])

    for name in ("search_suppliers", "search_item_types", "get_daily_work_queue"):
        denied, result = tool(env["USER_TOKEN"], name, {"companyId": a, "limit": 2})
        check(name + " runs locally", not denied)
        check(name + " restricted seed still reaches assigned company", not tool(env["SEED_RESTRICTED_TOKEN"], name, {"companyId": a, "limit": 2})[0])
        if name == "get_daily_work_queue" and not denied:
            sections = {section["section"]: section for section in result["sections"]}
            status, orders = request(f"/api/salesorders/company/{a}/open", env["ADMIN_JWT"])
            expected = [row for row in orders if row["orderDate"][:10] <= result["asOf"]] if status == 200 else []
            check("daily queue remaining-order count equals screen", status == 200 and sections["undeliveredOrders"]["available"] and sections["undeliveredOrders"]["totalCount"] == len(expected))
            check("daily queue bounds each section", all(len(section.get("items", [])) <= 2 for section in result["sections"]))
        for key in ("USER_TOKEN", "SEED_RESTRICTED_TOKEN"):
            check(name + " rejects outside " + key, tool(env[key], name, {"companyId": b})[0])
        check(name + " rejects missing permission", tool(env["DENIED_TOKEN"], name, {"companyId": a})[0])

    for name, resource, id_arg, list_path in (
        ("get_quote", "salesquotes", "quoteId", "salesquotes"),
        ("get_sales_order", "salesorders", "orderId", "salesorders"),
        ("get_purchase_bill", "purchasebills", "purchaseBillId", "purchasebills"),
    ):
        status, foreign = request(f"/api/{list_path}/company/{b}/paged?pageSize=1", env["ADMIN_JWT"])
        if status != 200 or not foreign["items"]:
            raise SystemExit("Missing cross-company record fixture for " + name)
        foreign_id = foreign["items"][0]["id"]
        check(name + " rejects foreign ID under allowed company", tool(env["USER_TOKEN"], name, {"companyId": a, id_arg: foreign_id})[0])
        check(name + " treats missing ID as unavailable", tool(env["USER_TOKEN"], name, {"companyId": a, id_arg: 2147483647})[0])
        status, own = request(f"/api/{resource}/company/{a}/paged?pageSize=1", env["ADMIN_JWT"])
        if status != 200 or not own["items"]:
            raise SystemExit("Missing own-company record fixture for " + name)
        own_id = own["items"][0]["id"]
        status, screen = request(f"/api/{resource}/{own_id}", env["ADMIN_JWT"])
        denied, result = tool(env["USER_TOKEN"], name, {"companyId": a, id_arg: own_id, "limit": 2})
        check(name + " reads own record", status == 200 and not denied)
        if not denied:
            check(name + " preserves server line values", result["lines"]["totalCount"] == len(screen["items"]) and [x["quantity"] for x in result["lines"]["items"]] == [x["quantity"] for x in screen["items"][:2]])
            if name == "get_purchase_bill":
                check("purchase GST and fractional withholding equal screen", all(result["header"][key] == screen[key] for key in ("gstRate", "gstAmount", "withholdingTaxRate", "withholdingTaxAmount", "collectible")))
            if len(screen["items"]) > 2:
                error, next_lines = tool(env["USER_TOKEN"], name, {"companyId": a, id_arg: own_id, "offset": 2, "limit": 1})
                check(name + " pages lines without repeating first page", not error and len(next_lines["lines"]["items"]) == 1 and next_lines["lines"]["items"][0]["id"] == screen["items"][2]["id"])

    status, clients = request(f"/api/clients/company/{a}", env["ADMIN_JWT"])
    if status != 200 or not clients:
        raise SystemExit("Missing client fixture for party ledger.")
    client_id = clients[0]["id"]
    status, screen = request(f"/api/accounting/reports/company/{a}/party-ledger?partyType=Client&partyId={client_id}", env["ADMIN_JWT"])
    denied, result = tool(env["USER_TOKEN"], "get_party_ledger", {"companyId": a, "partyType": "Client", "partyId": client_id, "limit": 2})
    check("party ledger balances equal screen", status == 200 and not denied and result["openingBalance"] == screen["openingBalance"] and result["closingBalance"] == screen["closingBalance"])
    if not denied:
        check("party ledger caps rows and excludes narratives", len(result["rows"]["items"]) <= 2 and all(not {"reference", "description"}.intersection(row) for row in result["rows"]["items"]))
    status, foreign_clients = request(f"/api/clients/company/{b}", env["ADMIN_JWT"])
    if status != 200 or not foreign_clients:
        raise SystemExit("Missing foreign client fixture for party ledger.")
    check("party ledger rejects foreign party under own company", tool(env["USER_TOKEN"], "get_party_ledger", {"companyId": a, "partyType": "Client", "partyId": foreign_clients[0]["id"]})[0])
    check("party ledger rejects token company escape", tool(env["SEED_RESTRICTED_TOKEN"], "get_party_ledger", {"companyId": b, "partyType": "Client", "partyId": foreign_clients[0]["id"]})[0])

    check("reversed dates rejected", tool(env["USER_TOKEN"], "search_purchase_bills", {"companyId": a, "dateFrom": "2026-10-03", "dateTo": "2026-01-01"})[0])
    check("unknown argument rejected", tool(env["USER_TOKEN"], "search_sales_orders", {"companyId": a, "unsafe": True})[0])
    print(f"{sum(results)}/{len(results)} checks passed")
    raise SystemExit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
