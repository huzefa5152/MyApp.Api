"""
Hosted MCP on the importer line: the door, the gates and company / division isolation.

  1. Transport and discovery: GET is 405, an anonymous POST is a 401 that names the OAuth
     resource metadata, the well-known documents answer.
  2. Premium keys: MCP Access is off for everyone until granted (the Administrator role does not
     carry it, the seed admin included); a non-seed administrator can neither put an mcp.* key
     into a role nor assign an MCP role.
  3. A login token is read-only: no prepare_* or commit tools, and FBR validation needs an agent.
  4. Company isolation on reads: every company tool refuses a company the user was not given,
     and a record of that company reached by id answers exactly like a missing one.
  5. Token narrowing: a token bound to company A cannot reach company B even when its user can;
     a read-only token lists no writes; a deselected catalog tool is gone and refused.
  6. Division scope: a user restricted to one division must tag writes with it, cannot write
     company-level state (GD costing, opening stock, claim months), and reads only that division.
  7. The seed admin: all-companies token, list_companies names every company.
  8. Every call leaves an activity row; planId-only calls are filed under the plan's company.

Needs a LOCAL backend (refuses anything but localhost) and sqlcmd. Builds the shared fixture
(scripts/mcp_importer_fixture.py) on first use, creates throwaway users "mcpiso_*".

Usage: python scripts/test_mcp_isolation.py --base http://localhost:5141 --db MyApp_Importer_Local
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys

import mcp_importer_fixture as fx
from mcp_importer_fixture import call, http, login, mcp, tools

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5141")
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--db", default="MyApp_Importer_Local")
ARGS = ap.parse_args()
fx.set_base(ARGS.base)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {str(detail)[:400]}"))


def sql(q):
    out = subprocess.run(["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.db, "-E", "-C", "-I", "-b", "-h", "-1", "-W", "-Q", "SET NOCOUNT ON; " + q],
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr
    return [l.strip() for l in out.stdout.splitlines() if l.strip()]


def one(q):
    r = sql(q)
    return int(r[0]) if r and r[0].lstrip("-").isdigit() else None


DENIED = "Resource unavailable or access denied."
print(f"Importer MCP isolation against {fx.BASE}")
admin = login("admin", "admin123")
A, B = fx.companies(admin)
fx.remove_users(admin, "mcpiso_")
sysr = fx.system_roles(admin)
STAFF, MCPA, MCPW = fx.staff_role(admin), sysr["MCP Access"], sysr["MCP Write"]

# ── 1. transport ─────────────────────────────────────────────────────
print("\n== 1. transport and discovery ==")
s, _ = http("GET", "/mcp")
check("GET /mcp is 405 (stateless transport)", s == 405, s)
import urllib.request, urllib.error
try:
    urllib.request.urlopen(urllib.request.Request(fx.BASE + "/mcp", data=b"{}", method="POST", headers={"Content-Type": "application/json"}))
    check("anonymous POST /mcp is 401", False)
except urllib.error.HTTPError as e:
    check("anonymous POST /mcp is 401 naming the resource metadata", e.code == 401 and "resource_metadata" in (e.headers.get("WWW-Authenticate") or ""), e.headers.get("WWW-Authenticate"))
s, prm = http("GET", "/.well-known/oauth-protected-resource")
check("protected-resource metadata names /mcp", s == 200 and prm["resource"].endswith("/mcp"), prm)
s, asm = http("GET", "/.well-known/oauth-authorization-server")
check("authorization-server metadata offers PKCE S256 and the importer scopes",
      s == 200 and asm["code_challenge_methods_supported"] == ["S256"] and "gds.write" in asm["scopes_supported"], asm)

# ── 2. premium keys ──────────────────────────────────────────────────
print("\n== 2. MCP is a premium grant ==")
admin_role = next(r for r in http("GET", "/api/roles", admin)[1] if r["name"] == "Administrator")
check("the Administrator role carries no mcp.* key", not any(k.startswith("mcp.") for k in admin_role["permissionKeys"]), [k for k in admin_role["permissionKeys"] if k.startswith("mcp.")])
s, cat = http("GET", "/api/mcp/catalog/1", admin)
http("PUT", "/api/mcp/catalog/1", admin, {"revision": cat["revision"], "accessGranted": False, "accessEnabled": True, "writesGranted": False,
     "writesEnabled": True, "grantedTools": [], "selectedTools": []})
s, d = mcp(admin, "tools/list")
check("the seed admin is not short-circuited: no MCP until granted", s == 403, (s, d))
uid_adm, adm2 = fx.make_user(admin, "mcpiso_admin", [A], [sysr["Administrator"]], catalog=False)
s, d = http("POST", "/api/roles", adm2, {"name": "mcpiso sneak", "description": "x", "permissionKeys": ["mcp.access.use"]})
check("a non-seed administrator cannot put an mcp key into a role", s == 400, (s, d))
s, d = http("PUT", f"/api/users/{uid_adm}/roles", adm2, {"roleIds": [sysr["Administrator"], MCPA]})
check("…nor assign the MCP Access role (not even to themselves)", s in (400, 403, 404), (s, d))
uid_plain, plain = fx.make_user(admin, "mcpiso_plain", [A], [STAFF], catalog=False)
s, d = http("PUT", f"/api/users/{uid_plain}/roles", adm2, {"roleIds": [STAFF, MCPA]})
check("…nor to a staff user", s in (400, 403, 404), (s, d))
s, _ = mcp(plain, "tools/list")
check("a user without MCP Access gets 403 on /mcp", s == 403, s)

# ── 3. login token is read-only ──────────────────────────────────────
print("\n== 3. a login token reads only ==")
uid_a, ja = fx.make_user(admin, "mcpiso_a", [A], [STAFF, MCPA, MCPW])
listed = tools(ja)
check("a login token lists read tools", "search_invoices" in listed and "get_gd" in listed, sorted(listed)[:10])
check("…but no prepare_*, commit or FBR validation", not any(n.startswith("prepare_") or n in ("commit_action", "validate_bill_fbr") for n in listed),
      [n for n in listed if n.startswith("prepare_")])
refused, text = call(ja, "prepare_client", {"companyId": A, "name": "x"})
check("…and a prepare called anyway is refused", refused, text)

# ── 4. company isolation on reads ────────────────────────────────────
print("\n== 4. company isolation ==")
companies = json.loads(call(ja, "list_companies")[1])["companies"]
check("list_companies names exactly the assigned company", [c["id"] for c in companies] == [A], companies)
company_tools = [n for n, t in listed.items() if "companyId" in t["inputSchema"].get("properties", {})]
leaky = []
for n in company_tools:
    req = {k: (B if k == "companyId" else 1) for k in listed[n]["inputSchema"].get("required", [])}
    if "documentType" in req: req["documentType"] = "Bill"
    if "partyType" in req: req["partyType"] = "Client"
    refused, text = call(ja, n, req)
    if not refused or DENIED not in text:
        leaky.append((n, text[:120]))
check(f"every company tool refuses company B with one answer ({len(company_tools)} tools)", not leaky, leaky)
b_inv = one(f"SELECT TOP 1 Id FROM Invoices WHERE CompanyId = {B} ORDER BY Id DESC")
missing = one("SELECT ISNULL(MAX(Id),0) + 1000 FROM Invoices")
r1 = call(ja, "get_invoice", {"companyId": A, "invoiceId": b_inv})
r2 = call(ja, "get_invoice", {"companyId": A, "invoiceId": missing})
check("B's bill under company A answers exactly like a bill that does not exist", r1[0] and r1 == r2, (r1, r2))
b_gd = one(f"SELECT TOP 1 Id FROM ImportConsignments WHERE CompanyId = {B}")
r1 = call(ja, "get_gd", {"companyId": A, "gdId": b_gd})
r2 = call(ja, "get_gd", {"companyId": A, "gdId": 999999})
check("B's GD under company A answers exactly like a GD that does not exist", r1[0] and r1 == r2, (r1, r2))
a_inv = one(f"SELECT TOP 1 Id FROM Invoices WHERE CompanyId = {A} ORDER BY Id DESC")
refused, text = call(ja, "get_invoice", {"companyId": A, "invoiceId": a_inv})
check("A's own bill reads", not refused and json.loads(text)["header"]["id"] == a_inv, text[:200])
check("…and carries no payment status or balance (CLAUDE.md 5b-8)", "balanceDue" not in text and "paymentStatus" not in text, text[:300])

# ── 5. token narrowing and the catalog ───────────────────────────────
print("\n== 5. tokens and the catalog narrow access ==")
uid_ab, jab = fx.make_user(admin, "mcpiso_ab", [A, B], [STAFF, MCPA, MCPW])
ta = fx.token_for(jab, [A])
refused, text = call(ta, "search_clients", {"companyId": B})
check("a token bound to A cannot reach B although its user can", refused and DENIED in text, text)
check("…and list_companies for that token names only A", [c["id"] for c in json.loads(call(ta, "list_companies")[1])["companies"]] == [A])
tr = fx.token_for(jab, [A, B], scopes=["read"])
lt = tools(tr)
check("a read-only token lists no write tool", lt and not any(n.startswith("prepare_") or n == "commit_action" for n in lt), [n for n in lt if n.startswith("prepare_")])
refused, text = call(tr, "prepare_client", {"companyId": A, "name": "x"})
check("…and its prepare_client is refused", refused, text)
s, st = http("GET", "/api/mcp/me/status", jab)
check("scopes offered include the importer write scopes", all(x in st["scopesAvailable"] for x in ("gds.write", "receipts.write", "journal.write", "fbr.validate")), st["scopesAvailable"])
fx.grant_catalog(admin, uid_ab, writes=True, only={n for n in fx.grant_catalog(admin, uid_ab) if n != "get_gd"})
refused, text = call(ta, "get_gd", {"companyId": A, "gdId": 1})
check("a tool taken out of the user's catalog is refused", refused and DENIED in text, text)
check("…and no longer listed", "get_gd" not in tools(ta))
fx.grant_catalog(admin, uid_ab)
s, d = http("POST", "/api/mcp/me/tokens", jab, {"name": "x", "companyIds": [999999], "scopes": ["read"], "expiresInDays": 5})
check("a token cannot name a company its user does not reach", s == 400, (s, d))
s, d = http("POST", "/api/mcp/me/tokens", jab, {"name": "x", "companyIds": [A], "allCompanies": True, "scopes": ["read"], "expiresInDays": 5})
check("only the seed admin may choose all companies", s == 400, (s, d))
s, d = http("GET", "/api/clients/company/" + str(A), ta)
check("an agent token is refused on the REST API", s == 401, s)

# ── 6. division scope ────────────────────────────────────────────────
print("\n== 6. divisions ==")
divs = http("GET", f"/api/divisions/company/{A}", admin)[1]
d1 = next((d["id"] for d in divs if d["name"] == "MCP North"), None)
if d1 is None:
    d1 = http("POST", f"/api/divisions/company/{A}", admin, {"name": "MCP North"})[1]["id"]
d2 = next((d["id"] for d in divs if d["name"] == "MCP South"), None) or http("POST", f"/api/divisions/company/{A}", admin, {"name": "MCP South"})[1]["id"]
uid_div, jdiv = fx.make_user(admin, "mcpiso_div", [A], [STAFF, MCPA, MCPW])
s, d = http("PUT", f"/api/userdivisions/user/{uid_div}/company/{A}", admin, {"restrictToDivisions": True, "divisionIds": [d1]})
check("setup: a user restricted to one division", s == 200, (s, d))
tdiv = fx.token_for(jdiv, [A])
client_a = one(f"SELECT TOP 1 Id FROM Clients WHERE CompanyId = {A} ORDER BY Id")
item_a = one(f"SELECT TOP 1 ItemTypeId FROM OpeningStockBalances WHERE CompanyId = {A}")
base_challan = {"companyId": A, "clientId": client_a, "deliveryDate": "2026-10-01", "items": [{"description": "Div test", "quantity": "1", "unit": "Pcs"}]}
refused, text = call(tdiv, "prepare_challan", base_challan)
check("a restricted user's challan with no division is refused", refused and "division" in text.lower(), text)
refused, text = call(tdiv, "prepare_challan", {**base_challan, "divisionId": d2})
check("…with a division they do not hold is refused", refused and "division" in text.lower(), text)
refused, text = call(tdiv, "prepare_challan", {**base_challan, "divisionId": d1})
check("…with their own division it prepares", not refused, text)
if not refused:
    call(tdiv, "cancel_action", {"planId": json.loads(text)["planId"]})
refused, text = call(tdiv, "prepare_opening_stock", {"companyId": A, "itemTypeId": item_a, "quantity": "1", "valueExcludingTax": "1", "salesTaxRate": "18", "asOfDate": "2026-01-01"})
check("a restricted user cannot write company-level stock (opening balance)", refused, text)
refused, text = call(tdiv, "prepare_gd_claim_month", {"companyId": A, "gdNumber": "X", "claimMonth": "2026-08"})
check("…nor a claim month", refused, text)
refused, text = call(tdiv, "get_gd_register", {"companyId": A})
check("…and the company-wide GD register is refused", refused and "every division" in text, text)
other_div_inv = None
s, d = http("POST", "/api/invoices/standalone", admin, {"companyId": A, "divisionId": d2, "clientId": client_a, "date": "2026-10-01", "gstRate": 18,
            "items": [{"description": "South only", "quantity": 1, "uom": "Pcs", "unitPrice": 10, "itemTypeId": item_a}]})
other_div_inv = d.get("id") if isinstance(d, dict) else None
check("setup: a bill in the other division", s in (200, 201) and other_div_inv, (s, d))
refused, text = call(tdiv, "get_invoice", {"companyId": A, "invoiceId": other_div_inv})
check("a bill of a division the user does not hold answers like a missing one", refused and DENIED in text, text)
listed_ids = [r["id"] for r in json.loads(call(tdiv, "search_invoices", {"companyId": A, "pageSize": 100})[1])["items"]]
check("…and is not in their search", other_div_inv not in listed_ids, listed_ids[:10])

# ── 7. seed admin ────────────────────────────────────────────────────
print("\n== 7. the seed admin ==")
fx.grant_catalog(admin, 1)
s, st = http("GET", "/api/mcp/me/status", admin)
check("once granted, the seed admin may choose all companies", s == 200 and st["canUseAllCompanies"], st)
tall = fx.token_for(admin, [], scopes=["read"], all_companies=True)
ids = {c["id"] for c in json.loads(call(tall, "list_companies")[1])["companies"]}
check("an all-companies token lists every company", {A, B} <= ids, ids)
refused, text = call(tall, "search_clients", {"companyId": B})
check("…and reads any of them", not refused, text[:200])

# ── 8. activity ──────────────────────────────────────────────────────
print("\n== 8. activity log ==")
tw = fx.token_for(jab, [A])
refused, text = call(tw, "prepare_client", {"companyId": A, "name": "MCP iso activity client"})
plan = json.loads(text)["planId"] if not refused else "plan_x"
call(tw, "cancel_action", {"planId": plan})
s, act = http("GET", "/api/mcp/me/activity?pageSize=50", jab)
rows = act["items"] if s == 200 else []
check("refused calls are logged too", any(r["outcome"] == "denied" for r in rows), [r["tool"] for r in rows][:10])
check("a planId-only call is filed under the plan's company", any(r["tool"] == "cancel_action" and r["companyId"] == A for r in rows), [(r["tool"], r["companyId"]) for r in rows][:10])
check("arguments are stored without the token", all("tmcp_" not in (r.get("arguments") or "") for r in rows))

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} isolation checks passed")
if fails:
    sys.exit(1)
fx.remove_users(admin, "mcpiso_")
print("all checks passed")
