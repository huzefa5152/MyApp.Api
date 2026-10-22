"""
Hosted MCP read tools on the importer line: the figures are the screens' own.

Each read tool is compared with the REST endpoint its screen uses, for the same company and
period, so an MCP answer can never drift from what the operator sees:
  stock on hand, opening balances, GDs and a GD's lines, letters of credit, the GD register,
  the input-tax worksheet, sales report, tax sheet, customer and supplier balances, trial
  balance, profit and loss, balance sheet, party ledger, item names (the company's own), bills
  (with advance / further tax and the demo flag), receipts, purchase bills.
Output stays bounded (a 100-row cap and offset/limit) and carries no payment status,
bank or cheque fields.

LOCAL only. Usage: python scripts/test_mcp_reads.py --base http://localhost:5141
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date

import mcp_importer_fixture as fx
from mcp_importer_fixture import call, http, login

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5141")
ARGS = ap.parse_args()
fx.set_base(ARGS.base)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {str(detail)[:500]}"))


def near(a, b):
    return abs(float(a or 0) - float(b or 0)) < 0.011


def j(tok, name, args):
    refused, text = call(tok, name, args)
    if refused:
        raise AssertionError(f"{name}: {text}")
    return json.loads(text)


print(f"Importer MCP reads against {fx.BASE}")
admin = login("admin", "admin123")
A, B = fx.companies(admin)
fx.remove_users(admin, "mcpr_")
sysr = fx.system_roles(admin)
_, jr = fx.make_user(admin, "mcpr_reader", [A], [fx.staff_role(admin), sysr["MCP Access"]], writes=False)
T = fx.token_for(jr, [A])
YEAR = date.today().year
FROM, TO = f"{YEAR}-01-01", f"{YEAR}-12-31"

print("\n== stock and import costing ==")
rest = {r["itemTypeId"]: r for r in http("GET", f"/api/stock/company/{A}/onhand", admin)[1]}
mcp = {r["itemTypeId"]: r for r in j(T, "get_stock", {"companyId": A, "limit": 100})["items"]}
check("get_stock quantities equal the Stock screen's on-hand", rest and all(near(mcp[i]["onHand"], r["onHand"]) for i, r in rest.items() if i in mcp) and set(mcp) <= set(rest),
      [(i, r["onHand"], mcp.get(i, {}).get("onHand")) for i, r in rest.items()][:5])
ob_rest = {o["itemTypeId"]: o for o in http("GET", f"/api/stock/company/{A}/opening", admin)[1]}
ob_mcp = {o["itemTypeId"]: o for o in j(T, "get_opening_stock", {"companyId": A, "limit": 100})["items"]}
check("get_opening_stock equals the Opening Balances tab, with the company's names", set(ob_rest) == set(ob_mcp)
      and all(near(ob_mcp[i]["valueExcludingTax"], o["valueExcludingTax"]) and ob_mcp[i]["displayName"] == o["itemTypeName"] for i, o in ob_rest.items()), (ob_rest, ob_mcp))
gds_rest = http("GET", f"/api/import-consignments?companyId={A}&pageSize=100", admin)[1]
gds_mcp = j(T, "search_gds", {"companyId": A, "pageSize": 100})
check("search_gds equals the Consignments screen", gds_mcp["totalCount"] == gds_rest["totalCount"]
      and {g["gdId"] for g in gds_mcp["items"]} == {g["id"] for g in gds_rest["items"]}, (gds_mcp["totalCount"], gds_rest["totalCount"]))
gid = gds_rest["items"][0]["id"]
d_rest = http("GET", f"/api/import-consignments/{gid}", admin)[1]
d_mcp = j(T, "get_gd", {"companyId": A, "gdId": gid})
check("get_gd lines equal the GD's detail (cost, claim month, disposition)", d_mcp["lines"]["totalCount"] == len(d_rest["lines"])
      and all(near(m["costExcludingTax"], r["costExcludingTax"]) and m["disposition"] == r["disposition"] for m, r in zip(d_mcp["lines"]["items"], d_rest["lines"])), d_mcp["lines"]["items"][:1])
lcs_rest = http("GET", f"/api/import-lcs/company/{A}", admin)[1]
check("search_lcs equals the Letters of Credit screen", j(T, "search_lcs", {"companyId": A})["totalCount"] == len(lcs_rest))
reg = j(T, "get_gd_register", {"companyId": A, "limit": 100})
check("get_gd_register lists the GD lines with claim status", reg["totalCount"] >= len(d_rest["lines"]) and all("claimStatus" in r for r in reg["items"]), reg["totalCount"])
s, it_rest = http("GET", f"/api/import-tax/company/{A}/input-tax", admin)
it_mcp = j(T, "get_input_tax_worksheet", {"companyId": A})
check("get_input_tax_worksheet equals the Import Tax Desk", s == 200 and len(it_mcp["months"]) == len(it_rest["months"])
      and all(near(m["payable"], r["payable"]) for m, r in zip(it_mcp["months"], it_rest["months"])), (s, str(it_rest)[:200]))

print("\n== reports ==")
s, sr = http("GET", f"/api/reports/company/{A}/sales?year={YEAR}", admin)
sm = j(T, "sales_summary", {"companyId": A, "year": YEAR})
check("sales_summary totals equal the Sales report", s == 200 and sm["totals"]["invoiceCount"] == sr["invoiceCount"] and near(sm["totals"]["total"], sr["grandTotal"]), (sm["totals"], s))
s, ts = http("GET", f"/api/reports/company/{A}/tax-sheet?year={YEAR}", admin)
tm = j(T, "tax_sheet_summary", {"companyId": A, "year": YEAR})
check("tax_sheet_summary totals equal the Tax Sheet", s == 200 and tm["totals"]["lines"] == ts["rowCount"] and near(tm["totals"]["total"], ts["grandTotal"]), (tm["totals"], s))
for tool, path, key in (("get_customer_balances", "customer-balances", "controlAccountBalance"), ("get_supplier_balances", "supplier-balances", "controlAccountBalance"),
                        ("get_profit_and_loss", "profit-loss?comparative=false", "netProfit"), ("get_balance_sheet", "balance-sheet?comparative=false", "totalAssets")):
    sep = "&" if "?" in path else "?"
    s, r = http("GET", f"/api/accounting/reports/company/{A}/{path}{sep}from={FROM}&to={TO}", admin)
    m = j(T, tool, {"companyId": A, "dateFrom": FROM, "dateTo": TO})
    check(f"{tool} equals its accounting report ({key})", s == 200 and near(m.get(key), r.get(key)), (m.get(key), r.get(key) if isinstance(r, dict) else r))
s, tb = http("GET", f"/api/accounting/reports/company/{A}/trial-balance-report?from={FROM}&to={TO}", admin)
mtb = j(T, "get_trial_balance", {"companyId": A, "dateFrom": FROM, "dateTo": TO, "limit": 100})
check("get_trial_balance equals the Trial Balance report", s == 200 and mtb["rows"]["totalCount"] == len(tb["rows"]) and mtb["totals"] == {k: v for k, v in tb["totals"].items()}, (mtb.get("totals"), tb.get("totals")))
client = http("GET", f"/api/clients/company/{A}", admin)[1][0]["id"]
s, pl = http("GET", f"/api/accounting/reports/company/{A}/customer-ledger?from={FROM}&to={TO}&clientId={client}", admin)
mpl = j(T, "get_party_ledger", {"companyId": A, "partyType": "Client", "partyId": client, "dateFrom": FROM, "dateTo": TO})
check("get_party_ledger equals the Customer Ledger", s == 200 and near(mpl["closingBalance"], pl["closingBalance"]), (mpl.get("closingBalance"), pl.get("closingBalance") if isinstance(pl, dict) else pl))
check("…without the letterhead contact blocks", "companyContact" not in mpl and "party" not in mpl)

print("\n== documents ==")
bills = j(T, "search_invoices", {"companyId": A, "pageSize": 100})
rest_bills = http("GET", f"/api/invoices/company/{A}/paged?page=1&pageSize=100", admin)[1]
check("search_invoices lists the sale bills the Bills screen lists", bills["totalCount"] == rest_bills["totalCount"], (bills["totalCount"], rest_bills["totalCount"]))
row = bills["items"][0]
check("…with FBR status, advance and further tax and the demo flag", all(k in row for k in ("fbrStatus", "advanceTaxAmount", "furtherTaxAmount", "isDemo")), row)
blob = json.dumps(bills) + json.dumps(j(T, "search_receipts", {"companyId": A})) + json.dumps(j(T, "search_purchase_bills", {"companyId": A}))
check("no payment status, balance due, cheque or bank names anywhere", not any(k in blob for k in ("paymentStatus", "balanceDue", "chequeNumber", "bankAccountName")), blob[:300])
items = j(T, "search_item_types", {"companyId": A, "pageSize": 100})
check("search_item_types returns this company's items with displayName and catalogName", items["items"] and all("displayName" in i and "catalogName" in i for i in items["items"]), items["items"][:2])
check("…and only this company's (the fixture's other company items are absent)", not any("BETA" in i["catalogName"] for i in items["items"]), [i["catalogName"] for i in items["items"]])
page = j(T, "search_clients", {"companyId": A, "limit": 1})
check("lists are bounded by limit", len(page["items"]) <= 1)
refused, text = call(T, "search_clients", {"companyId": A, "limit": 101})
check("a limit over 100 is capped, not honoured", refused or len(json.loads(text)["items"]) <= 100)
refused, text = call(T, "search_clients", {"companyId": A, "bogus": 1})
check("an unknown argument is refused", refused and "Unknown argument" in text, text)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} MCP read checks passed")
if fails:
    sys.exit(1)
fx.remove_users(admin, "mcpr_")
print("all checks passed")
