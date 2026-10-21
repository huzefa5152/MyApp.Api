"""
Hosted MCP - tenant sweep: every tool the server lists, tried against a company and records
the caller was never given.

The other MCP suites prove each tool's own rules. This one is generic on purpose: it reads
tools/list from a token that holds every scope and permission, so a tool added later is swept
without editing this file.

  1. Every tool that takes a companyId refuses company B for a user assigned only A.
  2. Every id argument a tool accepts (invoiceId, challanId, clientId, itemTypeId, ...) is tried
     with a record of company B while companyId says A. A get_* or prepare_* tool must refuse;
     a search may answer, but never with B's data.
  3. Every read tool's normal answer for A is scanned for B's company, client and supplier names.
  4. Another user's plan id is useless: status, commit and cancel are refused, and the same
     idempotency key yields a separate plan.
  5. Removing the user's company assignment closes every company tool on the next call.

Needs a LOCAL importer backend and database (the shared fixture, scripts/mcp_importer_fixture.py,
builds two fictional companies on first use). Creates throwaway users ("mcpsw") and removes them
on success; company data is read, never written (every plan made here is cancelled).

Usage: python scripts/test_mcp_tenant_sweep.py --base http://localhost:5141
         [--sql-server .\\MSSQLSERVER02] [--sql-db MyApp_Importer_Local]
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date

ap = argparse.ArgumentParser()
ap.add_argument("--base", default=os.environ.get("MYAPP_BASE", "http://localhost:5141"))
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--sql-db", default="MyApp_Importer_Local")
ARGS = ap.parse_args()
import mcp_importer_fixture as fx
BASE = fx.set_base(ARGS.base)
PW = "mcpsw1234"
RUN = secrets.token_hex(3)
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {str(detail)[:400]}"))


def http(method, path, token=None, body=None):
    data, hdrs = None, {}
    if body is not None:
        data, hdrs["Content-Type"] = json.dumps(body).encode(), "application/json"
    if token:
        hdrs["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                txt = r.read().decode()
                return r.status, (json.loads(txt) if txt and txt[0] in "{[" else txt)
        except urllib.error.HTTPError as e:
            txt = e.read().decode() if e.fp else ""
            if e.code == 429 and attempt < 2:
                time.sleep(61)
                continue
            try:
                return e.code, json.loads(txt) if txt and txt[0] in "{[" else txt
            except Exception:
                return e.code, txt
    return 429, "rate limited"


def login(user, pw):
    s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    assert s == 200, f"login {user}: {s} {d}"
    return d["token"]


def sql(query):
    out = subprocess.run(["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.sql_db, "-E", "-C", "-N", "-I", "-b",
                          "-h", "-1", "-W", "-Q", "SET NOCOUNT ON; " + query], capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr
    return [line.strip() for line in out.stdout.splitlines() if line.strip()]


def one(query):
    rows = sql(query)
    return int(rows[0]) if rows and rows[0].isdigit() else None


_id = [0]


def mcp(token, method, params=None):
    _id[0] += 1
    return http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": _id[0], "method": method, "params": params or {}})


def call(token, name, args):
    """(refused, text). refused is True for a JSON-RPC error, an isError result or a non-200."""
    s, d = mcp(token, "tools/call", {"name": name, "arguments": args})
    if s != 200 or not isinstance(d, dict):
        return True, f"http {s}: {d}"
    if "error" in d:
        return True, d["error"]["message"]
    res = d["result"]
    return bool(res.get("isError")), res["content"][0]["text"]


print(f"MCP tenant sweep against {BASE}  (run {RUN})")
admin = login("admin", "admin123")
A_ID, B_ID = fx.companies(admin)
A, B = {"id": A_ID}, {"id": B_ID}
print(f"  A = company {A['id']}, B = company {B['id']}")

B_IDS = {
    "invoiceId": one(f"SELECT TOP 1 Id FROM Invoices WHERE CompanyId = {B['id']} ORDER BY Id DESC"),
    "challanId": one(f"SELECT TOP 1 Id FROM DeliveryChallans WHERE CompanyId = {B['id']} ORDER BY Id DESC"),
    "quoteId": one(f"SELECT TOP 1 Id FROM SalesQuotes WHERE CompanyId = {B['id']} ORDER BY Id DESC"),
    "orderId": one(f"SELECT TOP 1 Id FROM SalesOrders WHERE CompanyId = {B['id']} ORDER BY Id DESC"),
    "salesOrderId": one(f"SELECT TOP 1 Id FROM SalesOrders WHERE CompanyId = {B['id']} ORDER BY Id DESC"),
    "purchaseBillId": one(f"SELECT TOP 1 Id FROM PurchaseBills WHERE CompanyId = {B['id']} ORDER BY Id DESC"),
    "clientId": one(f"SELECT TOP 1 Id FROM Clients WHERE CompanyId = {B['id']} ORDER BY Id DESC"),
    "supplierId": one(f"SELECT TOP 1 Id FROM Suppliers WHERE CompanyId = {B['id']} ORDER BY Id DESC"),
    # The catalog is shared, so B's item is one only B holds (CLAUDE.md 5b-2b).
    "itemTypeId": one(f"SELECT TOP 1 b.ItemTypeId FROM OpeningStockBalances b WHERE b.CompanyId = {B['id']} AND NOT EXISTS (SELECT 1 FROM OpeningStockBalances a WHERE a.CompanyId = {A['id']} AND a.ItemTypeId = b.ItemTypeId)"),
    "templateId": one(f"SELECT TOP 1 Id FROM PrintTemplates WHERE CompanyId = {B['id']} ORDER BY Id DESC"),
    "gdId": one(f"SELECT TOP 1 Id FROM ImportConsignments WHERE CompanyId = {B['id']} ORDER BY Id DESC"),
    "lcId": one(f"SELECT TOP 1 Id FROM ImportLetterOfCredits WHERE CompanyId = {B['id']} ORDER BY Id DESC"),
    "lineId": one(f"SELECT TOP 1 l.Id FROM ImportConsignmentLines l JOIN ImportConsignments c ON c.Id = l.ImportConsignmentId WHERE c.CompanyId = {B['id']}"),
    "lotId": one(f"SELECT TOP 1 l.Id FROM OpeningStockLots l JOIN OpeningStockBalances b ON b.Id = l.OpeningStockBalanceId WHERE b.CompanyId = {B['id']}"),
    "bankAccountId": one(f"SELECT TOP 1 Id FROM Accounts WHERE CompanyId = {B['id']} ORDER BY Id"),
}
B_IDS["partyId"] = B_IDS["clientId"]
B_IDS["documentId"] = B_IDS["invoiceId"]
B_IDS = {k: v for k, v in B_IDS.items() if v is not None}

# Names that exist in B and nowhere in A: any of them in an answer about A is a leak.
a_names = {n.lower() for n in sql(f"SELECT Name FROM Clients WHERE CompanyId = {A['id']} UNION SELECT Name FROM Suppliers WHERE CompanyId = {A['id']} UNION SELECT Name FROM Companies WHERE Id = {A['id']}")}
b_names = [n for n in sql(f"SELECT TOP 40 Name FROM (SELECT Name FROM Clients WHERE CompanyId = {B['id']} UNION SELECT Name FROM Suppliers WHERE CompanyId = {B['id']} UNION SELECT Name FROM Companies WHERE Id = {B['id']}) x WHERE LEN(Name) >= 6")
           if n.lower() not in a_names]


def leaks(text):
    low = text.lower()
    return [n for n in b_names if n.lower() in low]


for u in http("GET", "/api/users", admin)[1] or []:
    if u["username"].startswith("mcpsw_"):
        http("DELETE", f"/api/users/{u['id']}", admin)
sysr = fx.system_roles(admin)
EDITION = fx.staff_role(admin)
MCPA, MCPW = sysr["MCP Access"], sysr["MCP Write"]
uids, tok = {}, {}


def make(uname, cids):
    s, u = http("POST", "/api/users", admin, {"username": uname, "password": PW, "fullName": uname, "role": "User"})
    assert s in (200, 201), f"{uname}: {s} {u}"
    uids[uname] = u["id"]
    assert http("PUT", f"/api/users/{u['id']}/roles", admin, {"roleIds": [EDITION, MCPA, MCPW]})[0] == 200
    assert http("PUT", f"/api/usercompanies/user/{u['id']}", admin, {"companyIds": cids})[0] == 200
    s, catalog = http("GET", f"/api/mcp/catalog/{u['id']}", admin)
    tools = [t["name"] for t in catalog["tools"] if t["configurable"] and t["eligible"]]
    s, r = http("PUT", f"/api/mcp/catalog/{u['id']}", admin, {"revision": catalog["revision"], "accessGranted": True, "accessEnabled": True,
                "writesGranted": True, "writesEnabled": True, "grantedTools": tools, "selectedTools": tools})
    assert s == 200, (s, r)
    tok[uname] = login(uname, PW)


make("mcpsw_a", [A["id"]])
make("mcpsw_b", [B["id"]])
s, st = http("GET", "/api/mcp/me/status", tok["mcpsw_a"])
scopes = st["scopesAvailable"]


def mk(owner, cids):
    s, d = http("POST", "/api/mcp/me/tokens", owner, {"name": f"sweep-{RUN}", "companyIds": cids, "scopes": scopes, "expiresInDays": 7})
    assert s == 200, f"token: {s} {d}"
    return d["secret"]


TA = mk(tok["mcpsw_a"], [A["id"]])
TB = mk(tok["mcpsw_b"], [B["id"]])
s, d = mcp(TA, "tools/list")
TOOLS = {t["name"]: t for t in d["result"]["tools"]}
print(f"  sweeping {len(TOOLS)} tools with scopes {scopes}")
check("the sweep token lists the full catalogue (reads and writes)", len(TOOLS) >= 60 and any(n.startswith("prepare_") for n in TOOLS), sorted(TOOLS))


def filler(name, schema, cid):
    t = schema.get("type")
    if name == "companyId":
        return cid
    if "enum" in schema:
        return schema["enum"][0]
    if t == "integer":
        return 1
    if t == "string":
        return date.today().isoformat() if schema.get("format") == "date" else ("x" * max(1, schema.get("minLength", 1)))
    if t == "array":
        return []
    if t == "object":
        return {}
    return "x"


def base_args(tool, cid):
    props = tool["inputSchema"].get("properties", {})
    return {k: filler(k, props[k], cid) for k in tool["inputSchema"].get("required", []) if k in props}


# ── 1. company B is refused everywhere ───────────────────────────────
print("\n== 1. every company tool refuses company B ==")
bad = []
for name, tool in sorted(TOOLS.items()):
    if "companyId" not in tool["inputSchema"].get("properties", {}):
        continue
    refused, text = call(TA, name, {**base_args(tool, B["id"]), "companyId": B["id"]})
    if not refused or leaks(text):
        bad.append((name, text[:200]))
check(f"no tool answers for a company outside the token and the user's assignment ({sum(1 for t in TOOLS.values() if 'companyId' in t['inputSchema'].get('properties', {}))} tools)", not bad, bad)

# ── 2. records of B, named by id under company A ─────────────────────
print("\n== 2. B's records by id under company A ==")
swept, bad = 0, []
for name, tool in sorted(TOOLS.items()):
    props = tool["inputSchema"].get("properties", {})
    if "companyId" not in props:
        continue
    for arg, bid in B_IDS.items():
        if arg not in props:
            continue
        swept += 1
        extra = {"documentType": "Bill"} if arg == "documentId" else {}   # the id is B's bill, so ask for a bill
        refused, text = call(TA, name, {**base_args(tool, A["id"]), **extra, arg: bid})
        if not refused and text.startswith("{") and "planId" in text:
            call(TA, "cancel_action", {"planId": json.loads(text)["planId"]})
        strict = name.startswith(("get_", "prepare_", "validate_"))
        if (strict and not refused) or leaks(text):
            bad.append((name, arg, text[:200]))
check(f"no record of B is reachable by id under company A ({swept} tool/argument pairs)", swept > 0 and not bad, bad)

# ── 3. normal answers for A never carry B's names ────────────────────
print("\n== 3. leak scan of every read answer for A ==")
bad, answered = [], 0
for name, tool in sorted(TOOLS.items()):
    if name.startswith(("prepare_", "commit_", "cancel_", "validate_")) or "companyId" not in tool["inputSchema"].get("properties", {}):
        continue
    refused, text = call(TA, name, base_args(tool, A["id"]))
    answered += 0 if refused else 1
    if leaks(text):
        bad.append((name, leaks(text)[:3]))
refused, text = call(TA, "list_companies", {})
check("list_companies names only company A", not refused and f'"id":{B["id"]},' not in text.replace(" ", "") and not leaks(text), text[:300])
check(f"no read answer about A mentions B's company, clients or suppliers ({answered} answers, {len(b_names)} B names)", answered > 5 and not bad, bad)

# ── 4. another user's plan is useless ────────────────────────────────
print("\n== 4. plans belong to their own token ==")
key = f"sweep-{RUN}"
refused, text = call(TB, "prepare_client", {"companyId": B["id"], "name": f"MCP sweep client {RUN}", "idempotencyKey": key})
check("user B prepares a client plan in company B", not refused, text)
b_plan = json.loads(text)["planId"] if not refused else "plan_x"
for t in ("get_action_status", "commit_action", "cancel_action"):
    refused2, text2 = call(TA, t, {"planId": b_plan})
    check(f"{t} with another user's plan id is refused, like a missing one", refused2 and "not found" in text2.lower(), text2)
refused, text = call(TA, "prepare_client", {"companyId": A["id"], "name": f"MCP sweep client {RUN}", "idempotencyKey": key})
check("the same idempotency key on another token yields its own plan, never B's", not refused and json.loads(text)["planId"] != b_plan and json.loads(text)["companyId"] == A["id"], text)
if not refused:
    call(TA, "cancel_action", {"planId": json.loads(text)["planId"]})
call(TB, "cancel_action", {"planId": b_plan})
check("nothing was created in B", one(f"SELECT COUNT(*) FROM Clients WHERE Name = 'MCP sweep client {RUN}'") == 0)

# ── 5. revoking the assignment closes everything at once ─────────────
print("\n== 5. revocation takes effect on the next call ==")
assert http("PUT", f"/api/usercompanies/user/{uids['mcpsw_a']}", admin, {"companyIds": []})[0] == 200
bad = []
for name, tool in sorted(TOOLS.items()):
    if "companyId" not in tool["inputSchema"].get("properties", {}):
        continue
    refused, text = call(TA, name, base_args(tool, A["id"]))
    if not refused:
        bad.append(name)
refused, text = call(TA, "list_companies", {})
check("after the company is unassigned, every company tool refuses it", not bad, bad)
check("…and list_companies is empty", not refused and json.loads(text)["companies"] == [], text)
s, act = http("GET", "/api/mcp/me/activity?pageSize=100", tok["mcpsw_a"])
check("…and the user's own MCP history no longer shows that company's rows", s == 200 and act["items"] and all(r["companyId"] != A["id"] for r in act["items"])
      and not any(f"MCP sweep client {RUN}" in (r.get("detail") or "") for r in act["items"]),
      [r for r in act.get("items", []) if r["companyId"] == A["id"]][:3] if isinstance(act, dict) else act)
http("PUT", f"/api/usercompanies/user/{uids['mcpsw_a']}", admin, {"companyIds": [A["id"]]})

# ── result ───────────────────────────────────────────────────────────
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} tenant sweep checks passed")
if fails:
    print("FAILED - throwaway users kept for inspection:")
    for n, _, dtl in fails:
        print(f"  - {n}: {dtl[:600]}")
    sys.exit(1)
for n in ("mcpsw_a", "mcpsw_b"):
    http("DELETE", f"/api/users/{uids[n]}", admin)
print("all checks passed")
