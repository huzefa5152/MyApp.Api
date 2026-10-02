"""
Hosted MCP — per-agent tokens and the activity log.

Proves: a token is only ever shown once and stored as a hash; it narrows its user's
access (never widens it); it works on /mcp and nowhere else; revoke, expiry, user
deletion and loss of MCP Access each end it on the very next call; and every
tools/call leaves an append-only activity row, refused calls included, with
arguments redacted and the secret nowhere in the log.

Needs a LOCAL Trader database with 2+ companies holding invoices (the restored
MyApp_Trader_Local copy does). Creates only throwaway users/tokens ("mcptok").

Usage:
  python scripts/test_mcp_agent_tokens.py [--base http://localhost:5137]
         [--sql-server .\\MSSQLSERVER02] [--sql-db MyApp_Trader_Local]
Expiry is checked by moving ExpiresAt back through sqlcmd (local database only).
Exit 0 = every check passed.
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

ap = argparse.ArgumentParser()
ap.add_argument("--base", default=os.environ.get("MYAPP_BASE", "http://localhost:5134"))
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--sql-db", default="MyApp_Trader_Local")
ARGS = ap.parse_args()
BASE = ARGS.base.rstrip("/")
PW = "mcptok1234"

results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {detail}"))


def http(method, path, token=None, body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(txt) if txt else None
        except Exception:
            return e.code, txt


def login(user, pw):
    s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    if s == 429:
        time.sleep(62)
        s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    assert s == 200, f"login {user}: {s} {d}"
    return d["token"]


_id = [0]


def rpc(token, method, params=None):
    _id[0] += 1
    return http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": _id[0], "method": method, "params": params or {}})


def tool(token, name, args):
    s, d = rpc(token, "tools/call", {"name": name, "arguments": args})
    if s != 200 or not isinstance(d, dict):
        return True, f"http {s}: {d}"
    if "error" in d:
        return True, d["error"]["message"]
    res = d["result"]
    text = res["content"][0]["text"]
    return (True, text) if res.get("isError") else (False, json.loads(text))


def sql(query):
    out = subprocess.run(["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.sql_db, "-E", "-C", "-N", "-I", "-b", "-Q", query],
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr


print(f"MCP agent-token test against {BASE}")
admin = login("admin", "admin123")

s, companies = http("GET", "/api/companies", admin)
cands = []
for c in companies:
    s, pg = http("GET", f"/api/invoices/company/{c['id']}/paged?page=1&pageSize=1", admin)
    if s == 200 and pg["items"]:
        cands.append({"id": c["id"], "inv_id": pg["items"][0]["id"]})
if len(cands) < 2:
    print("SKIP: need 2 companies with invoices.")
    sys.exit(2)
A, B = cands[0], cands[1]

s, users = http("GET", "/api/users", admin)
for u in users or []:
    if u["username"].startswith("mcptok_"):
        http("DELETE", f"/api/users/{u['id']}", admin)
s, roles = http("GET", "/api/roles", admin)
sys_role = {r["name"]: r["id"] for r in roles if r.get("isSystemRole")}
SALES, MCP = sys_role["Sales Edition"], sys_role["MCP Access"]

user_ids, tok = {}, {}


def make_user(uname, role_ids, company_ids):
    s, u = http("POST", "/api/users", admin, {"username": uname, "password": PW, "fullName": uname, "role": "User"})
    assert s in (200, 201), f"create {uname}: {s} {u}"
    user_ids[uname] = u["id"]
    s, d = http("PUT", f"/api/users/{u['id']}/roles", admin, {"roleIds": role_ids})
    assert s == 200, f"roles {uname}: {s} {d}"
    s, d = http("PUT", f"/api/usercompanies/user/{u['id']}", admin, {"companyIds": company_ids})
    assert s == 200, f"companies {uname}: {s} {d}"
    tok[uname] = login(uname, PW)


make_user("mcptok_both", [SALES, MCP], [A["id"], B["id"]])   # reaches A and B
make_user("mcptok_nomcp", [SALES], [A["id"]])                 # no MCP Access
make_user("mcptok_plain", [SALES, MCP], [A["id"]])            # not the token owner; non-seed caller
uid = user_ids["mcptok_both"]


def create(body):
    return http("POST", "/api/mcp-admin/tokens", admin, body)


# ── creation rules ───────────────────────────────────────────────────
print("\n== creating tokens ==")
s, d = create({"userId": uid, "name": "mcptok-a-only", "companyIds": [A["id"]], "scopes": ["read"], "expiresInDays": 30})
check("seed admin creates a token", s == 200 and d["secret"].startswith("tmcp_") and len(d["secret"]) > 40, f"{s} {d}")
T1, T1_ID, T1_SECRET = d["secret"], d["id"], d["secret"]
check("hint shows only the start of the secret", T1_SECRET.startswith(d["hint"]) and len(d["hint"]) < len(T1_SECRET) - 20, d["hint"])

for label, body in (
    ("seed admin as owner refused", {"userId": 1, "name": "x", "companyIds": [A["id"]], "scopes": ["read"], "expiresInDays": 5}),
    ("owner without MCP Access refused", {"userId": user_ids["mcptok_nomcp"], "name": "x", "companyIds": [A["id"]], "scopes": ["read"], "expiresInDays": 5}),
    ("company the user cannot reach refused", {"userId": user_ids["mcptok_plain"], "name": "x", "companyIds": [B["id"]], "scopes": ["read"], "expiresInDays": 5}),
    ("write scope refused (read-only phase)", {"userId": uid, "name": "x", "companyIds": [A["id"]], "scopes": ["read", "quotes.write"], "expiresInDays": 5}),
    ("empty company list refused", {"userId": uid, "name": "x", "companyIds": [], "scopes": ["read"], "expiresInDays": 5}),
    ("lifetime over 90 days refused", {"userId": uid, "name": "x", "companyIds": [A["id"]], "scopes": ["read"], "expiresInDays": 91}),
    ("zero-day lifetime refused", {"userId": uid, "name": "x", "companyIds": [A["id"]], "scopes": ["read"], "expiresInDays": 0}),
    ("blank name refused", {"userId": uid, "name": "  ", "companyIds": [A["id"]], "scopes": ["read"], "expiresInDays": 5}),
    ("unknown user refused", {"userId": 99999999, "name": "x", "companyIds": [A["id"]], "scopes": ["read"], "expiresInDays": 5}),
):
    s, d = create(body)
    check(label, s == 400, f"{s} {d}")

s, lst = http("GET", "/api/mcp-admin/tokens", admin)
txt = json.dumps(lst)
check("token list never contains the secret or its hash", T1_SECRET not in txt and "tokenHash" not in txt.lower() and "secret" not in txt.lower(), txt[:200])
row = next(t for t in lst if t["id"] == T1_ID)
check("list shows owner, companies, status", row["username"] == "mcptok_both" and [c["id"] for c in row["companies"]] == [A["id"]] and row["status"] == "Active", row)

print("\n== only the seed admin manages tokens ==")
for label, method, path, body in (
    ("non-seed cannot list tokens", "GET", "/api/mcp-admin/tokens", None),
    ("non-seed cannot create a token", "POST", "/api/mcp-admin/tokens", {"userId": uid, "name": "x", "companyIds": [A["id"]], "scopes": ["read"], "expiresInDays": 5}),
    ("non-seed cannot revoke", "POST", f"/api/mcp-admin/tokens/{T1_ID}/revoke", None),
    ("non-seed cannot read activity", "GET", "/api/mcp-admin/activity", None),
):
    s, _ = http(method, path, tok["mcptok_plain"], body)
    check(label, s == 403, s)
s, _ = http("GET", "/api/mcp-admin/tokens")
check("anonymous cannot list tokens", s == 401, s)

# ── what a token can do ──────────────────────────────────────────────
print("\n== token narrows its user ==")
s, d = rpc(T1, "initialize", {"protocolVersion": "2025-06-18"})
check("agent token connects to /mcp", s == 200 and "result" in d, f"{s} {d}")
err, d = tool(T1, "list_companies", {})
check("token lists only its company, though the user has two", not err and [c["id"] for c in d["companies"]] == [A["id"]], d)
err, d = tool(tok["mcptok_both"], "list_companies", {})
check("control: the same user's login token still sees both", not err and {c["id"] for c in d["companies"]} == {A["id"], B["id"]}, d)
err, d = tool(T1, "search_invoices", {"companyId": A["id"]})
check("token reads its own company", not err and d["totalCount"] >= 1, d)
err, msg = tool(T1, "search_invoices", {"companyId": B["id"]})
check("token refused on a company outside its list (the user can reach it)", err, msg)
err, msg = tool(T1, "get_invoice", {"companyId": B["id"], "invoiceId": B["inv_id"]})
check("token cannot read another company's invoice", err, msg)
err, msg = tool(T1, "get_invoice", {"companyId": A["id"], "invoiceId": B["inv_id"]})
check("own company id + foreign invoice id refused", err, msg)

s, d = http("GET", "/api/companies", T1)
check("agent token is rejected on ordinary REST routes", s == 401, s)
s, d = http("POST", "/mcp", "tmcp_" + "x" * 43, {"jsonrpc": "2.0", "id": 1, "method": "ping"})
check("forged tmcp_ token rejected", s == 401, s)

# A second token for the same user has its own, independent limits.
s, d = create({"userId": uid, "name": "mcptok-b-only", "companyIds": [B["id"]], "scopes": ["read"], "expiresInDays": 30})
T2, T2_ID = d["secret"], d["id"]
err, d = tool(T2, "list_companies", {})
check("a second token for the same user is limited to its own company", not err and [c["id"] for c in d["companies"]] == [B["id"]], d)
err, msg = tool(T2, "search_invoices", {"companyId": A["id"]})
check("…and cannot reach the first token's company", err, msg)

# ── activity log ─────────────────────────────────────────────────────
print("\n== activity log ==")
err, _ = tool(T1, "search_clients", {"companyId": A["id"], "search": "x", "password": "hunter2-secret"})
s, act = http("GET", f"/api/mcp-admin/activity?tokenId={T1_ID}&pageSize=100", admin)
rows = act["items"]
tools_seen = [(r["tool"], r["outcome"], r["companyId"]) for r in rows]
# list_companies, search_invoices x2, get_invoice x2, search_clients. initialize/ping are protocol, not tool calls.
check("every tool call on the token is recorded, exactly once", act["total"] == 6, act["total"])
check("a refused call is recorded as denied with its reason",
      any(r["tool"] == "search_invoices" and r["companyId"] == B["id"] and r["outcome"] == "denied" and r["detail"] for r in rows), tools_seen)
check("an allowed call is recorded as ok with company and duration",
      any(r["tool"] == "search_invoices" and r["companyId"] == A["id"] and r["outcome"] == "ok" and r["durationMs"] >= 0 for r in rows))
check("rows say agent, token name and owner",
      all(r["authKind"] == "agent" and r["agentName"] == "mcptok-a-only" and r["username"] == "mcptok_both" and r["userId"] == uid for r in rows))
blob = json.dumps(act)
check("the secret appears nowhere in the activity feed", T1_SECRET not in blob)
check("sensitive argument values are redacted", "hunter2-secret" not in blob and any("***" in r["arguments"] for r in rows), [r["arguments"] for r in rows if "password" in r["arguments"]])
check("unknown tool names are recorded too", (tool(T1, "execute_sql", {"q": "drop table x"})[0]) and
      any(r["tool"] == "execute_sql" and r["outcome"] == "denied"
          for r in http("GET", f"/api/mcp-admin/activity?tokenId={T1_ID}&tool=execute_sql", admin)[1]["items"]))

err, _ = tool(tok["mcptok_both"], "list_companies", {})
s, act2 = http("GET", f"/api/mcp-admin/activity?userId={uid}&pageSize=100", admin)
check("a call on an ordinary login token is logged as 'login'", any(r["authKind"] == "login" and r["tool"] == "list_companies" for r in act2["items"]))
s, act3 = http("GET", f"/api/mcp-admin/activity?outcome=denied&pageSize=100", admin)
check("the feed can be filtered by outcome", s == 200 and act3["items"] and all(r["outcome"] == "denied" for r in act3["items"]), s)
s, _ = http("GET", "/api/mcp-admin/activity?outcome=bogus", admin)
check("bad filter value refused", s == 400, s)
for method in ("PUT", "DELETE", "PATCH", "POST"):
    s, _ = http(method, f"/api/mcp-admin/activity/{rows[0]['id']}", admin, {} if method != "DELETE" else None)
    check(f"{method} on an activity row is not offered", s in (404, 405), s)

# ── end of life ──────────────────────────────────────────────────────
print("\n== revoke, expiry, deletion, loss of access ==")
before = http("GET", f"/api/mcp-admin/activity?tokenId={T1_ID}&pageSize=1", admin)[1]["total"]
s, _ = http("POST", f"/api/mcp-admin/tokens/{T1_ID}/revoke", admin)
check("seed admin revokes a token", s == 200, s)
s, _ = rpc(T1, "ping")
check("revoked token fails on the very next call", s == 401, s)
s, _ = http("POST", f"/api/mcp-admin/tokens/{T1_ID}/revoke", admin)
check("revoking twice is a 404", s == 404, s)
after = http("GET", f"/api/mcp-admin/activity?tokenId={T1_ID}&pageSize=1", admin)[1]["total"]
check("revoking does not remove its history", after == before and after > 0, (before, after))
s, lst = http("GET", "/api/mcp-admin/tokens", admin)
check("revoked token shows as Revoked", next(t for t in lst if t["id"] == T1_ID)["status"] == "Revoked")

s, d = create({"userId": uid, "name": "mcptok-expiring", "companyIds": [A["id"]], "scopes": ["read"], "expiresInDays": 1})
T3, T3_ID = d["secret"], d["id"]
s, _ = rpc(T3, "ping")
check("a fresh token works", s == 200, s)
sql(f"UPDATE McpAgentTokens SET ExpiresAt = DATEADD(day, -1, SYSUTCDATETIME()) WHERE Id = {T3_ID}")
s, _ = rpc(T3, "ping")
check("an expired token fails on the very next call", s == 401, s)
s, lst = http("GET", "/api/mcp-admin/tokens", admin)
check("expired token shows as Expired", next(t for t in lst if t["id"] == T3_ID)["status"] == "Expired")

# Losing MCP Access ends use even though the token itself is fine.
http("PUT", f"/api/users/{uid}/roles", admin, {"roleIds": [SALES]})
s, _ = rpc(T2, "initialize", {"protocolVersion": "2025-06-18"})
check("token whose user lost MCP Access is refused (403)", s == 403, s)
http("PUT", f"/api/users/{uid}/roles", admin, {"roleIds": [SALES, MCP]})
s, _ = rpc(T2, "ping")
check("…and works again once access is restored", s == 200, s)

# Removing a company from the user narrows the token further.
http("PUT", f"/api/usercompanies/user/{uid}", admin, {"companyIds": [A["id"]]})
err, msg = tool(T2, "search_invoices", {"companyId": B["id"]})
check("company removed from the user -> the token loses it too", err, msg)

# Deleting the user removes the token but never the history.
t2_rows = http("GET", f"/api/mcp-admin/activity?tokenId={T2_ID}&pageSize=1", admin)[1]["total"]
http("DELETE", f"/api/users/{uid}", admin)
s, _ = rpc(T2, "ping")
check("deleting the user kills its tokens", s == 401, s)
t2_after = http("GET", f"/api/mcp-admin/activity?tokenId={T2_ID}&pageSize=1", admin)[1]["total"]
check("…but its activity history survives", t2_after == t2_rows and t2_after > 0, (t2_rows, t2_after))

# ── result ───────────────────────────────────────────────────────────
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
if fails:
    print("FAILED - throwaway users kept for inspection:")
    for n, _, dtl in fails:
        print(f"  - {n}: {dtl}")
    sys.exit(1)
for name, i in list(user_ids.items()):
    http("DELETE", f"/api/users/{i}", admin)
print("all checks passed")
