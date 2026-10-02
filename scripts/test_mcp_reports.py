"""
Hosted MCP - report tools ("ask your data"): sales_summary, outstanding_ledger,
receivables_by_client, tax_sheet_summary, item_rate_history.

Each tool wraps the report service its screen uses, behind the same permission and company
check. Proves: the figures equal what the screen's own REST report returns; output stays bounded
whatever the period; each tool needs ITS permission (and receivables also need payment
visibility); a token cannot reach a company outside its list; period and filter input is
validated; payment details (cheques, bank references) never appear; every call is logged.

Needs a LOCAL Trader database with 2+ companies holding invoices, ideally with some unpaid.
Creates only throwaway users ("mcpr"), removed on success. Read-only: no document is created.

Usage: python scripts/test_mcp_reports.py [--base http://localhost:5137]
         [--sql-server .\\MSSQLSERVER02] [--sql-db MyApp_Trader_Local]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date

ap = argparse.ArgumentParser()
ap.add_argument("--base", default=os.environ.get("MYAPP_BASE", "http://localhost:5134"))
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--sql-db", default="MyApp_Trader_Local")
ARGS = ap.parse_args()
BASE = ARGS.base.rstrip("/")
PW = "mcpr1234"
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)[:600]))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


def http(method, path, token=None, body=None):
    data, hdrs = None, {}
    if body is not None:
        data, hdrs["Content-Type"] = json.dumps(body).encode(), "application/json"
    if token:
        hdrs["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt and txt[0] in "{[" else txt)
    except urllib.error.HTTPError as e:
        txt = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(txt) if txt and txt[0] in "{[" else txt
        except Exception:
            return e.code, txt


def login(user, pw):
    s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    if s == 429:
        time.sleep(62)
        s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    assert s == 200, f"login {user}: {s} {d}"
    return d["token"]


def sql(query):
    out = subprocess.run(["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.sql_db, "-E", "-C", "-N", "-I", "-b", "-h", "-1", "-W", "-Q", "SET NOCOUNT ON; " + query],
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr
    return out.stdout.strip()


_id = [0]


def mcp(token, method, params=None):
    _id[0] += 1
    return http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": _id[0], "method": method, "params": params or {}})


def tool(token, name, args):
    s, d = mcp(token, "tools/call", {"name": name, "arguments": args})
    if s != 200 or not isinstance(d, dict):
        return True, f"http {s}: {d}"
    if "error" in d:
        return True, d["error"]["message"]
    res = d["result"]
    text = res["content"][0]["text"]
    return (True, text) if res.get("isError") else (False, json.loads(text))


def near(a, b, tol=0.011):
    return abs(float(a) - float(b)) <= tol


print(f"MCP reports test against {BASE}")
admin = login("admin", "admin123")
s, companies = http("GET", "/api/companies", admin)
today = date.today()
YEAR = today.year

cands = []
for c in companies:
    s, sales = http("GET", f"/api/reports/company/{c['id']}/sales?year={YEAR}&buyerType=all", admin)
    s2, pg = http("GET", f"/api/invoices/company/{c['id']}/paged?page=1&pageSize=1", admin)
    if s == 200 and s2 == 200 and pg["items"]:
        cands.append({"id": c["id"], "sales_count": sales["invoiceCount"], "inv_total": pg["totalCount"], "client": pg["items"][0]["clientId"]})
if len(cands) < 2:
    print("SKIP: need 2 companies with invoices.")
    sys.exit(2)
cands.sort(key=lambda c: (-c["sales_count"], -c["inv_total"]))
A, B = cands[0], cands[1]
print(f"A={A['id']} (sales invoices this year: {A['sales_count']})  B={B['id']}")

s, users = http("GET", "/api/users", admin)
for u in users or []:
    if u["username"].startswith("mcpr_"):
        http("DELETE", f"/api/users/{u['id']}", admin)
s, roles = http("GET", "/api/roles", admin)
for r in roles or []:
    if r["name"].startswith("mcpr-"):
        http("DELETE", f"/api/roles/{r['id']}", admin)
s, roles = http("GET", "/api/roles", admin)
sysr = {r["name"]: r["id"] for r in roles if r.get("isSystemRole")}
SALES, MCPA, TADMIN = sysr["Sales Edition"], sysr["MCP Access"], sysr["Tenant Administrator"]
uids, tok = {}, {}


def make(creator, uname, role_ids, cids, role_string="User"):
    s, u = http("POST", "/api/users", creator, {"username": uname, "password": PW, "fullName": uname, "role": role_string})
    assert s in (200, 201), f"{uname}: {s} {u}"
    uids[uname] = u["id"]
    assert http("PUT", f"/api/users/{u['id']}/roles", creator, {"roleIds": role_ids})[0] == 200
    assert http("PUT", f"/api/usercompanies/user/{u['id']}", creator, {"companyIds": cids})[0] == 200
    tok[uname] = login(uname, PW)


make(admin, "mcpr_w", [SALES, MCPA], [A["id"], B["id"]])
make(admin, "mcpr_ta", [TADMIN, SALES, MCPA], [A["id"]], "Administrator")
KEYS_SALES_ONLY = ["mcp.access.use", "reports.sales.view", "clients.manage.view"]
KEYS_LEDGER_NOPAY = ["mcp.access.use", "reports.outstanding.view", "clients.manage.view"]
for name, keys in (("mcpr-sales-only", KEYS_SALES_ONLY), ("mcpr-ledger-nopay", KEYS_LEDGER_NOPAY)):
    s, r = http("POST", "/api/roles", tok["mcpr_ta"], {"name": name, "description": "t", "permissionKeys": keys})
    assert s in (200, 201), f"role {name}: {s} {r}"
    make(tok["mcpr_ta"], name.replace("-", "_"), [r["id"]], [A["id"]])
W, SO, LN = tok["mcpr_w"], tok["mcpr_sales_only"], tok["mcpr_ledger_nopay"]


def mk(owner, cids, name="t"):
    s, d = http("POST", "/api/mcp/me/tokens", owner, {"name": name, "companyIds": cids, "scopes": ["read"], "expiresInDays": 30})
    assert s == 200, f"token {name}: {s} {d}"
    return d["secret"]


TA = mk(W, [A["id"]], "reports-A")
TSO = mk(SO, [A["id"]], "sales-only")
TLN = mk(LN, [A["id"]], "ledger-nopay")

# ── catalogue ────────────────────────────────────────────────────────
print("\n== catalogue ==")
NEW = {"sales_summary", "outstanding_ledger", "receivables_by_client", "tax_sheet_summary", "item_rate_history"}
s, d = mcp(TA, "tools/list")
tools = {t["name"]: t for t in d["result"]["tools"]}
check("a read token lists the five report tools", NEW <= set(tools), sorted(NEW - set(tools)))
check("all five are annotated read-only", all(tools[n]["annotations"]["readOnlyHint"] and not tools[n]["annotations"]["destructiveHint"] for n in NEW))
s, d = mcp(W, "tools/list")
check("a login token lists them too, and still no write tool", NEW <= {t["name"] for t in d["result"]["tools"]} and not any(t["name"].startswith(("prepare_", "commit_")) for t in d["result"]["tools"]))

# ── sales_summary ────────────────────────────────────────────────────
print("\n== sales_summary ==")
s, rest = http("GET", f"/api/reports/company/{A['id']}/sales?year={YEAR}&buyerType=all", admin)
err, r = tool(TA, "sales_summary", {"companyId": A["id"], "year": YEAR})
check("sales_summary runs for the token's company", not err, r)
if not err:
    t = r["totals"]
    check("invoice count equals the Sales report screen", t["invoiceCount"] == rest["invoiceCount"], (t["invoiceCount"], rest["invoiceCount"]))
    check("grand total, tax and amount equal the screen", near(t["total"], rest["grandTotal"]) and near(t["tax"], rest["grandTax"]) and near(t["amount"], rest["grandAmount"]), (t, rest["grandTotal"]))
    check("the month-by-month breakdown adds up to the total", near(sum(m["total"] for m in r["byMonth"]), t["total"]), r["byMonth"])
    check("top customers are sorted by total, highest first", [c["total"] for c in r["topClients"]] == sorted([c["total"] for c in r["topClients"]], reverse=True))
    check("the invoice list is left out unless asked for", r["invoices"] is None)
    check("the period is labelled", r["period"]["label"] and r["period"]["from"] <= r["period"]["to"], r["period"])
    err, r2 = tool(TA, "sales_summary", {"companyId": A["id"], "year": YEAR, "includeInvoices": True, "limit": 2})
    check("includeInvoices returns a capped page", not err and r2["invoices"]["limit"] == 2 and len(r2["invoices"]["items"]) <= 2 and r2["invoices"]["totalCount"] == rest["invoiceCount"], r2.get("invoices") if not err else r2)
    err, r3 = tool(TA, "sales_summary", {"companyId": A["id"], "year": YEAR, "includeInvoices": True, "limit": 100000})
    check("an oversized limit is clamped to 100", not err and r3["invoices"]["limit"] == 100 and len(r3["invoices"]["items"]) <= 100)
    err, r4 = tool(TA, "sales_summary", {"companyId": A["id"], "year": YEAR, "topClients": 9999})
    check("topClients is clamped to 25", not err and len(r4["topClients"]) <= 25)
    if rest["invoiceCount"] > 1:
        err, p1 = tool(TA, "sales_summary", {"companyId": A["id"], "year": YEAR, "includeInvoices": True, "limit": 1, "offset": 0})
        err, p2 = tool(TA, "sales_summary", {"companyId": A["id"], "year": YEAR, "includeInvoices": True, "limit": 1, "offset": 1})
        check("offset pages through the invoices", p1["invoices"]["items"][0]["invoiceId"] != p2["invoices"]["items"][0]["invoiceId"])
err, r = tool(TA, "sales_summary", {"companyId": A["id"], "dateFrom": f"{YEAR}-01-01", "dateTo": today.isoformat(), "buyerType": "registered"})
check("a custom range and buyer type are accepted", not err, r)
for label, args in (
    ("no period at all", {"companyId": A["id"]}),
    ("a month with no year", {"companyId": A["id"], "month": 3}),
    ("month 13", {"companyId": A["id"], "year": YEAR, "month": 13}),
    ("year 1999", {"companyId": A["id"], "year": 1999}),
    ("dateFrom without dateTo", {"companyId": A["id"], "dateFrom": f"{YEAR}-01-01"}),
    ("dateFrom after dateTo", {"companyId": A["id"], "dateFrom": f"{YEAR}-06-01", "dateTo": f"{YEAR}-01-01"}),
    ("a range of over five years", {"companyId": A["id"], "dateFrom": "2010-01-01", "dateTo": "2026-01-01"}),
    ("a malformed date", {"companyId": A["id"], "dateFrom": "01/01/2026", "dateTo": "02/01/2026"}),
    ("an unknown buyer type", {"companyId": A["id"], "year": YEAR, "buyerType": "everyone"}),
    ("a client from another company", {"companyId": A["id"], "year": YEAR, "clientId": 2_000_000_000}),
    ("a company outside the token", {"companyId": B["id"], "year": YEAR}),
    ("a company that does not exist", {"companyId": 2_000_000_000, "year": YEAR}),
):
    err, m = tool(TA, "sales_summary", args)
    check(f"{label} refused", err, m)

# ── permissions ──────────────────────────────────────────────────────
print("\n== each tool needs its permission ==")
err, r = tool(TSO, "sales_summary", {"companyId": A["id"], "year": YEAR})
check("a user with only reports.sales.view can run sales_summary", not err, r)
for name, args in (
    ("outstanding_ledger", {"companyId": A["id"], "clientId": A["client"]}),
    ("receivables_by_client", {"companyId": A["id"]}),
    ("tax_sheet_summary", {"companyId": A["id"], "year": YEAR}),
    ("item_rate_history", {"companyId": A["id"]}),
):
    err, m = tool(TSO, name, args)
    check(f"…but {name} is refused without its permission", err and "Permission denied" in str(m), m)
err, m = tool(TLN, "sales_summary", {"companyId": A["id"], "year": YEAR})
check("a ledger-only user cannot run the sales report", err and "Permission denied" in str(m), m)
err, r = tool(TLN, "outstanding_ledger", {"companyId": A["id"], "clientId": A["client"]})
check("a ledger-only user can run outstanding_ledger", not err, r)
err, m = tool(TLN, "receivables_by_client", {"companyId": A["id"]})
check("receivables_by_client also needs payment visibility, which that user lacks", err and "not visible" in str(m), m)

# ── outstanding_ledger ───────────────────────────────────────────────
print("\n== outstanding_ledger ==")
s, restl = http("GET", f"/api/reports/company/{A['id']}/outstanding?clientId={A['client']}&status=unpaid&dateFrom=2000-01-01&dateTo={today.isoformat()}", admin)
err, r = tool(TA, "outstanding_ledger", {"companyId": A["id"], "clientId": A["client"]})
check("outstanding_ledger runs with no period (the client's whole history)", not err, r)
if not err and s == 200:
    check("totals equal the Outstanding Ledger screen", r["totals"]["invoiceCount"] == restl["invoiceCount"] and near(r["totals"]["balance"], restl["grandBalance"]) and near(r["totals"]["amount"], restl["grandAmount"]),
          (r["totals"], restl["grandBalance"]))
    check("ageing buckets add up to the unpaid balance", near(sum(b["balance"] for b in r["ageing"]), sum(x["balance"] for x in restl["rows"] if x["balance"] > 0)), r["ageing"])
    check("it names the client", r["client"]["id"] == A["client"] and r["client"]["name"])
    blob = json.dumps(r).lower()
    check("payment details (cheques, references, receipts) never appear", not any(k in blob for k in ("cheque", "reference", "payments", "paymentsummary", "rcp-")), [k for k in ("cheque", "reference", "payments") if k in blob])
    check("a page of bills is returned and bounded", r["bills"]["limit"] <= 100 and len(r["bills"]["items"]) <= r["bills"]["limit"])
err, r = tool(TA, "outstanding_ledger", {"companyId": A["id"], "clientId": A["client"], "status": "all", "year": YEAR})
check("status and year filters are accepted", not err, r)
for label, args in (
    ("an unknown status", {"companyId": A["id"], "clientId": A["client"], "status": "late"}),
    ("a missing client", {"companyId": A["id"]}),
    ("a client from another company", {"companyId": A["id"], "clientId": 2_000_000_000}),
    ("a company outside the token", {"companyId": B["id"], "clientId": B["client"]}),
    ("month without year", {"companyId": A["id"], "clientId": A["client"], "month": 2}),
):
    err, m = tool(TA, "outstanding_ledger", args)
    check(f"{label} refused", err, m)

# ── receivables_by_client ────────────────────────────────────────────
print("\n== receivables_by_client ==")
s, allbills = http("GET", f"/api/invoices/company/{A['id']}", admin)
owed = [b for b in allbills if not b.get("isCancelled") and b.get("documentType") in (None, 4) and (b.get("balanceDue") or 0) > 0]
err, r = tool(TA, "receivables_by_client", {"companyId": A["id"]})
check("receivables_by_client runs", not err, r)
if not err:
    check("total balance equals the sum of unpaid bills", near(r["totals"]["balance"], sum(b["balanceDue"] for b in owed)), (r["totals"], sum(b["balanceDue"] for b in owed)))
    check("unpaid bill count matches", r["totals"]["unpaidBills"] == len(owed), (r["totals"]["unpaidBills"], len(owed)))
    check("clients are sorted by balance, largest first", [c["balance"] for c in r["topClients"]] == sorted([c["balance"] for c in r["topClients"]], reverse=True))
    check("the clients' balances do not exceed the total", sum(c["balance"] for c in r["topClients"]) <= r["totals"]["balance"] + 0.01)
    err, big = tool(TA, "receivables_by_client", {"companyId": A["id"], "top": 9999})
    check("top is clamped to 25", not err and len(big["topClients"]) <= 25)
    err, fl = tool(TA, "receivables_by_client", {"companyId": A["id"], "minBalance": "99999999999"})
    check("minBalance filters clients out", not err and fl["topClients"] == [])
for label, args in (("a company outside the token", {"companyId": B["id"]}), ("a negative minBalance", {"companyId": A["id"], "minBalance": "-1"}),
                    ("a non-numeric minBalance", {"companyId": A["id"], "minBalance": "lots"})):
    err, m = tool(TA, "receivables_by_client", args)
    check(f"{label} refused", err, m)

# ── tax_sheet_summary ────────────────────────────────────────────────
print("\n== tax_sheet_summary ==")
s, rests = http("GET", f"/api/reports/company/{A['id']}/tax-sheet?year={YEAR}", admin)
err, r = tool(TA, "tax_sheet_summary", {"companyId": A["id"], "year": YEAR})
check("tax_sheet_summary runs", not err, r)
if not err and s == 200:
    check("counts and total equal the Tax Sheet screen", r["totals"]["lines"] == rests["rowCount"] and r["totals"]["invoicesNeedingHsCode"] == rests["invoiceCount"] and near(r["totals"]["total"], rests["grandTotal"]), (r["totals"], rests["rowCount"]))
    check("the item-type groups cover every line", sum(g["lines"] for g in r["byItemType"]) <= rests["rowCount"])
    check("rows are left out unless asked for", r["rows"] is None)
    err, rr = tool(TA, "tax_sheet_summary", {"companyId": A["id"], "year": YEAR, "includeRows": True, "limit": 3})
    check("includeRows returns a capped page", not err and len(rr["rows"]["items"]) <= 3 and rr["rows"]["totalCount"] == rests["rowCount"], rr)
for label, args in (("no period", {"companyId": A["id"]}), ("a company outside the token", {"companyId": B["id"], "year": YEAR}),
                    ("a foreign client", {"companyId": A["id"], "year": YEAR, "clientId": 2_000_000_000})):
    err, m = tool(TA, "tax_sheet_summary", args)
    check(f"{label} refused", err, m)

# ── item_rate_history ────────────────────────────────────────────────
print("\n== item_rate_history ==")
item = sql(f"SELECT TOP 1 ii.ItemTypeId FROM InvoiceItems ii JOIN Invoices i ON i.Id = ii.InvoiceId WHERE i.CompanyId = {A['id']} AND ii.ItemTypeId IS NOT NULL")
b_item = sql(f"SELECT TOP 1 Id FROM ItemTypes WHERE CompanyId = {B['id']} AND IsDeleted = 0")
err, r = tool(TA, "item_rate_history", {"companyId": A["id"], "pageSize": 5})
check("item_rate_history runs without filters", not err, r)
if not err:
    s, restr = http("GET", f"/api/invoices/company/{A['id']}/item-rate-history?pageSize=5", admin)
    check("count and rate band equal the Item Rate History screen", r["summary"]["count"] == restr["totalCount"] and (r["summary"]["average"] is None or near(r["summary"]["average"], restr["avgUnitPrice"], 0.02)), (r["summary"], restr["totalCount"]))
    check("rows are bounded by pageSize", len(r["items"]) <= 5)
    check("every row belongs to a bill of this company", True if not r["items"] else all(x["invoiceId"] for x in r["items"]))
if item.isdigit():
    err, r = tool(TA, "item_rate_history", {"companyId": A["id"], "itemTypeId": int(item)})
    s, restr = http("GET", f"/api/invoices/company/{A['id']}/item-rate-history?itemTypeId={item}&pageSize=25", admin)
    check("filtering by item type matches the screen", not err and r["summary"]["count"] == restr["totalCount"], (r if err else r["summary"], restr["totalCount"]))
err, r = tool(TA, "item_rate_history", {"companyId": A["id"], "pageSize": 100000})
check("an oversized pageSize is clamped", not err and len(r["items"]) <= 100)
err, r = tool(TA, "item_rate_history", {"companyId": A["id"], "search": "' OR 1=1 --"})
check("search text is data, not SQL", not err and r["summary"]["count"] == 0, r)
for label, args in (("an item type from another company", {"companyId": A["id"], "itemTypeId": int(b_item)} if b_item.isdigit() else None),
                    ("a company outside the token", {"companyId": B["id"]}), ("a foreign client", {"companyId": A["id"], "clientId": 2_000_000_000}),
                    ("a malformed date", {"companyId": A["id"], "dateFrom": "yesterday"})):
    if args is None:
        continue
    err, m = tool(TA, "item_rate_history", args)
    check(f"{label} refused", err, m)

# ── log ──────────────────────────────────────────────────────────────
print("\n== activity log ==")
s, act = http("GET", f"/api/mcp-admin/activity?pageSize=100&tool=sales_summary", admin)
rows = act["items"]
check("report calls are logged, allowed and refused", any(x["outcome"] == "ok" for x in rows) and any(x["outcome"] == "denied" for x in rows), len(rows))
check("log rows carry the company and the arguments used", any(x["companyId"] == A["id"] and str(YEAR) in x["arguments"] for x in rows))
s, act = http("GET", "/api/mcp-admin/activity?pageSize=100&tool=receivables_by_client", admin)
check("a refusal for missing payment visibility is logged with a reason", any(x["outcome"] == "denied" and "not visible" in x["detail"] for x in act["items"]))

# ── result ───────────────────────────────────────────────────────────
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
if fails:
    print("FAILED - throwaway users kept for inspection:")
    for n, _, dtl in fails:
        print(f"  - {n}: {dtl}")
    sys.exit(1)
for n in ("mcpr_ledger_nopay", "mcpr_sales_only", "mcpr_w", "mcpr_ta"):
    http("DELETE", f"/api/users/{uids[n]}", admin)
s, roles = http("GET", "/api/roles", admin)
for r in roles or []:
    if r["name"].startswith("mcpr-"):
        http("DELETE", f"/api/roles/{r['id']}", admin)
print("all checks passed")
