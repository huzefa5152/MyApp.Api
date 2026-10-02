"""
Hosted MCP endpoint (POST /mcp) — company / tenant isolation test.

The endpoint is read-only and acts as the signed-in user. This suite proves an
agent connected as one user can never read another company's data, another
user's permissions, or anything the user could not open in the web app.

It needs a LOCAL Trader database with at least three companies that each hold
invoices and one of them stock (the restored MyApp_Trader_Local copy does). It
creates only users and roles (tagged "mcpiso") and removes them on success; the
real companies are read, never modified, apart from the user-company links of
the throwaway users.

Matrix (A, B, C = three companies with invoices; A and B also hold stock):
  mcp_a       full read role,  assigned A only
  mcp_b       full read role,  assigned B only
  mcp_none    full read role,  assigned NO company
  mcp_nomcp   read keys WITHOUT mcp.access.use, assigned A
  mcp_partial mcp.access.use + clients.manage.view only, assigned A

Usage:
  python scripts/test_mcp_isolation.py [--base http://localhost:5137]

Exit 0 = every check passed. Rows are left in place on failure for inspection.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--base", default=os.environ.get("MYAPP_BASE", "http://localhost:5134"))
BASE = ap.parse_args().base.rstrip("/")
PW = "mcpiso1234"
TAG = "mcpiso"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
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
    if s == 429:  # login is limited to 10 per minute per address; wait the window out
        time.sleep(62)
        s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    assert s == 200, f"login {user}: {s} {d}"
    return d["token"]


_rpc_id = [0]


def rpc(token, method, params=None):
    _rpc_id[0] += 1
    return http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": _rpc_id[0], "method": method, "params": params or {}})


def tool(token, name, args):
    """Returns (isError, parsed-or-text). Protocol-level errors count as isError."""
    s, d = rpc(token, "tools/call", {"name": name, "arguments": args})
    if s != 200 or not isinstance(d, dict):
        return True, f"http {s}: {d}"
    if "error" in d:
        return True, d["error"]["message"]
    res = d["result"]
    text = res["content"][0]["text"]
    if res.get("isError"):
        return True, text
    return False, json.loads(text)


# ── setup ────────────────────────────────────────────────────────────
print(f"MCP isolation test against {BASE}")
admin = login("admin", "admin123")

s, companies = http("GET", "/api/companies", admin)
assert s == 200 and companies, "cannot list companies as admin"
cands = []
for c in companies:
    s, pg = http("GET", f"/api/invoices/company/{c['id']}/paged?page=1&pageSize=1", admin)
    if s != 200 or not pg["items"]:
        continue
    s, st = http("GET", f"/api/stock/company/{c['id']}/onhand", admin)
    cands.append({"id": c["id"], "name": c["name"], "inv_total": pg["totalCount"], "inv_id": pg["items"][0]["id"],
                  "stock": len(st) if s == 200 else 0})
cands.sort(key=lambda x: -x["stock"])
if len(cands) < 3 or sum(1 for c in cands if c["stock"] > 0) < 2:
    print("SKIP: need 3 companies with invoices and 2 with stock in the local database.")
    sys.exit(2)
A, B = [c for c in cands if c["stock"] > 0][:2]
C = next(c for c in cands if c["id"] not in (A["id"], B["id"]))
print(f"A={A['id']} B={B['id']} C={C['id']}")

# leftovers from a failed earlier run
s, users = http("GET", "/api/users", admin)
for u in users or []:
    if u["username"].startswith("mcp_iso_"):
        http("DELETE", f"/api/users/{u['id']}", admin)
s, roles = http("GET", "/api/roles", admin)
for r in roles or []:
    if r["name"].startswith(TAG):
        http("DELETE", f"/api/roles/{r['id']}", admin)

sys_role = {r["name"]: r["id"] for r in roles if r.get("isSystemRole")}
for need in ("Sales Edition", "Tenant Administrator", "MCP Access"):
    assert need in sys_role, f"system role '{need}' missing - is the new build running?"
SALES, TADMIN, MCP = sys_role["Sales Edition"], sys_role["Tenant Administrator"], sys_role["MCP Access"]

user_ids: dict[str, int] = {}
tok: dict[str, str] = {}


def make_user(creator_token, uname, role_ids, company_ids, role_string="User"):
    s, u = http("POST", "/api/users", creator_token,
                {"username": uname, "password": PW, "fullName": uname, "role": role_string})
    assert s in (200, 201), f"create user {uname}: {s} {u}"
    user_ids[uname] = u["id"]
    s, d = http("PUT", f"/api/users/{u['id']}/roles", creator_token, {"roleIds": role_ids})
    assert s == 200, f"roles {uname}: {s} {d}"
    s, d = http("PUT", f"/api/usercompanies/user/{u['id']}", creator_token, {"companyIds": company_ids})
    assert s == 200, f"companies {uname}: {s} {d}"
    tok[uname] = login(uname, PW)
    return u["id"]


# Platform owner (seed admin) opts tenants in: a tenant administrator gets
# MCP Access only if the owner assigns it. "mcp_iso_ta_off" never does.
make_user(admin, "mcp_iso_ta", [TADMIN, SALES, MCP], [A["id"]], "Administrator")
make_user(admin, "mcp_iso_ta_off", [TADMIN, SALES], [A["id"]], "Administrator")
ta, ta_off = tok["mcp_iso_ta"], tok["mcp_iso_ta_off"]

# Tenant 1 staff, created by the tenant administrator itself (real delegation path).
make_user(ta, "mcp_iso_a", [SALES, MCP], [A["id"]])
make_user(ta, "mcp_iso_none", [SALES, MCP], [])
make_user(ta, "mcp_iso_nomcp", [SALES], [A["id"]])
s, r = http("POST", "/api/roles", ta, {"name": f"{TAG}-partial", "description": "test",
                                       "permissionKeys": ["mcp.access.use", "clients.manage.view"]})
assert s in (200, 201), f"tenant admin builds a restricted role: {s} {r}"
partial_role = r["id"]
make_user(ta, "mcp_iso_partial", [partial_role], [A["id"]])
s, r = http("POST", "/api/roles", ta, {"name": f"{TAG}-nopay", "description": "test",
                                       "permissionKeys": ["mcp.access.use", "bills.list.view"]})
assert s in (200, 201), f"tenant admin builds a no-payment role: {s} {r}"
make_user(ta, "mcp_iso_nopay", [r["id"]], [A["id"]])

# A second, unrelated tenant: its administrator is assigned B only.
make_user(admin, "mcp_iso_tb", [TADMIN, SALES, MCP], [B["id"]], "Administrator")
make_user(tok["mcp_iso_tb"], "mcp_iso_b", [SALES, MCP], [B["id"]])

a, b, none, nomcp, partial = (tok[k] for k in ("mcp_iso_a", "mcp_iso_b", "mcp_iso_none", "mcp_iso_nomcp", "mcp_iso_partial"))

print("\n== opt-in: MCP Access is controlled by the platform owner ==")
s, d = http("POST", "/api/users", ta_off, {"username": "mcp_iso_try", "password": PW, "fullName": "x", "role": "User"})
if s in (200, 201):
    user_ids["mcp_iso_try"] = d["id"]
    s2, d2 = http("PUT", f"/api/users/{d['id']}/roles", ta_off, {"roleIds": [SALES, MCP]})
    check("tenant admin without MCP Access cannot assign it to staff", s2 == 400, f"{s2} {d2}")
else:
    check("tenant admin without MCP Access cannot assign it to staff", False, f"setup user create {s} {d}")
s, d = http("POST", "/api/roles", ta_off, {"name": f"{TAG}-sneak", "description": "x", "permissionKeys": ["mcp.access.use"]})
check("tenant admin without MCP Access cannot mint a role that grants it", s == 400, f"{s} {d}")
s, d = http("GET", "/api/roles", admin)
by = {r["name"]: r for r in d}
check("neither edition carries mcp.access.use",
      all("mcp.access.use" not in by[n]["permissionKeys"] for n in ("Sales Edition", "Complete Edition")))
check("MCP Access role holds exactly mcp.access.use", by["MCP Access"]["permissionKeys"] == ["mcp.access.use"], by["MCP Access"]["permissionKeys"])
s, _ = rpc(tok["mcp_iso_ta_off"], "initialize", {"protocolVersion": "2025-06-18"})
check("tenant admin without MCP Access cannot connect", s == 403, s)

# ── transport and authentication ─────────────────────────────────────
print("\n== authentication ==")
s, _ = http("POST", "/mcp", None, {"jsonrpc": "2.0", "id": 1, "method": "ping"})
check("no token -> 401", s == 401, s)
s, _ = http("POST", "/mcp", "not.a.jwt", {"jsonrpc": "2.0", "id": 1, "method": "ping"})
check("garbage token -> 401", s == 401, s)
s, _ = http("GET", "/mcp", a)
check("GET /mcp -> 405 (no server stream)", s == 405, s)
s, d = rpc(nomcp, "initialize", {"protocolVersion": "2025-06-18"})
check("user without mcp.access.use -> 403", s == 403, f"{s} {d}")
s, d = rpc(partial, "initialize", {"protocolVersion": "2025-06-18"})
check("user with mcp.access.use may connect", s == 200 and d["result"]["protocolVersion"] == "2025-06-18", f"{s} {d}")
s, d = rpc(a, "initialize", {"protocolVersion": "1999-01-01"})
check("unknown protocol version negotiates down", s == 200 and d["result"]["protocolVersion"] == "2025-06-18", d)
s, d = http("POST", "/mcp", a, [{"jsonrpc": "2.0", "id": 1, "method": "ping"}])
check("JSON-RPC batch refused", s == 200 and d.get("error", {}).get("code") == -32600, d)
s, _ = http("POST", "/mcp", a, raw=b"x" * 70000)
check("oversize body refused with 413", s == 413, s)
s, d = http("POST", "/mcp", a, raw=b"{not json")
check("malformed JSON -> JSON-RPC parse error", s == 200 and d.get("error", {}).get("code") == -32700, f"{s} {d}")

# ── tool catalogue is read-only ──────────────────────────────────────
print("\n== catalogue ==")
s, d = rpc(a, "tools/list")
names = sorted(t["name"] for t in d["result"]["tools"])
check("exactly the eight read tools (no write tool for a login token)", names == ["get_challan", "get_invoice", "get_stock", "list_companies", "search_challans", "search_clients", "search_invoices", "search_quotes"], names)
check("every tool is annotated read-only", all(t["annotations"]["readOnlyHint"] and not t["annotations"]["destructiveHint"] for t in d["result"]["tools"]))
for bad in ("create_quote", "execute_sql", "submit_invoice", "http_get"):
    err, msg = tool(a, bad, {})
    check(f"no '{bad}' tool", err, msg)

# ── company scoping ──────────────────────────────────────────────────
print("\n== company scope ==")
err, d = tool(a, "list_companies", {})
check("a sees only A", not err and [c["id"] for c in d["companies"]] == [A["id"]], d)
check("list_companies leaks no tax/address/token fields", not err and set(d["companies"][0]) == {"id", "name"}, d)
err, d = tool(b, "list_companies", {})
check("b sees only B", not err and [c["id"] for c in d["companies"]] == [B["id"]], d)
err, d = tool(none, "list_companies", {})
check("user with no assignment sees nothing", not err and d["companies"] == [], d)

for label, token, own, foreign in (("a", a, A, (B, C)), ("b", b, B, (A, C))):
    # Own company works and matches the REST API.
    err, d = tool(token, "search_invoices", {"companyId": own["id"], "pageSize": 100})
    check(f"{label}: own invoices, count matches REST", not err and d["totalCount"] == own["inv_total"], d if err else d["totalCount"])
    check(f"{label}: every row belongs to the company", not err and all(r["companyId"] == own["id"] for r in d["items"]))
    s, rest = http("GET", f"/api/invoices/company/{own['id']}/paged?page=1&pageSize=100", token)
    rest_pay = {r["id"]: (r["amountPaid"], r["balanceDue"], r["paymentStatus"]) for r in rest["items"]}
    check(f"{label}: payment fields identical to the REST API for the same token",
          not err and s == 200 and all(rest_pay[r["id"]] == (r["amountPaid"], r["balanceDue"], r["paymentStatus"]) for r in d["items"]))
    err, d = tool(token, "get_stock", {"companyId": own["id"], "limit": 100})
    check(f"{label}: own stock readable", not err and d["totalCount"] == own["stock"], d if err else d["totalCount"])
    err, d = tool(token, "search_clients", {"companyId": own["id"], "limit": 100})
    check(f"{label}: own clients all in company", not err and d["items"] and all(r["companyId"] == own["id"] for r in d["items"]), d)
    err, d = tool(token, "get_invoice", {"companyId": own["id"], "invoiceId": own["inv_id"]})
    check(f"{label}: own invoice readable", not err and d["id"] == own["inv_id"] and d["companyId"] == own["id"], d)
    err, d = tool(token, "search_quotes", {"companyId": own["id"]})
    check(f"{label}: own quotes readable", not err, d)

    for f in foreign:
        for tname, targs in (("search_invoices", {}), ("get_stock", {}), ("search_clients", {}), ("search_quotes", {}),
                             ("get_invoice", {"invoiceId": f["inv_id"]})):
            err, msg = tool(token, tname, {"companyId": f["id"], **targs})
            check(f"{label}: {tname} on foreign company {f['id']} refused", err, msg)
        # Own company id paired with a foreign document id.
        err, msg = tool(token, "get_invoice", {"companyId": own["id"], "invoiceId": f["inv_id"]})
        check(f"{label}: foreign invoice {f['inv_id']} via own company id refused", err, msg)

err1, m1 = tool(a, "get_invoice", {"companyId": A["id"], "invoiceId": B["inv_id"]})
err2, m2 = tool(a, "get_invoice", {"companyId": A["id"], "invoiceId": 2_000_000_000})
check("foreign and non-existent invoice are indistinguishable", err1 and err2 and m1 == m2, f"{m1!r} vs {m2!r}")
err1, m1 = tool(a, "search_invoices", {"companyId": B["id"]})
err2, m2 = tool(a, "search_invoices", {"companyId": 2_000_000_000})
check("foreign and non-existent company are indistinguishable", err1 and err2 and m1 == m2, f"{m1!r} vs {m2!r}")

err, d = tool(tok["mcp_iso_nopay"], "search_invoices", {"companyId": A["id"], "pageSize": 100})
check("user without payment permission gets amount/balance/status nulled (server-side)",
      not err and d["items"] and all(r["amountPaid"] is None and r["balanceDue"] is None and r["paymentStatus"] is None for r in d["items"]), d if err else "")
err, d = tool(tok["mcp_iso_nopay"], "get_invoice", {"companyId": A["id"], "invoiceId": A["inv_id"]})
check("same for get_invoice", not err and d["balanceDue"] is None and d["paymentStatus"] is None, d)

print("\n== unassigned user / argument tampering ==")
for tname in ("search_invoices", "get_stock", "search_clients", "search_quotes"):
    err, msg = tool(none, tname, {"companyId": A["id"]})
    check(f"no-assignment user: {tname} refused", err, msg)
for bad in ("37", 0, -1, 1.5, None, [A["id"]], {"id": A["id"]}):
    err, msg = tool(a, "search_invoices", {"companyId": bad})
    check(f"companyId={bad!r} refused", err, msg)
err, msg = tool(a, "search_invoices", {})
check("missing companyId refused", err, msg)
err, d = tool(a, "search_invoices", {"companyId": A["id"], "pageSize": 999999})
check("pageSize is clamped, not honoured", not err and len(d["items"]) <= 100 and d["pageSize"] <= 100, d if err else d["pageSize"])
err, d = tool(a, "search_invoices", {"companyId": A["id"], "search": "' OR 1=1 --"})
check("search text is data, not SQL", not err and d["totalCount"] == 0, d)
err, msg = tool(a, "search_invoices", {"companyId": A["id"], "dateFrom": "not-a-date"})
check("bad date refused", err, msg)

# ── per-tool permission ──────────────────────────────────────────────
print("\n== per-tool permission ==")
err, d = tool(partial, "search_clients", {"companyId": A["id"]})
check("partial: permitted tool works", not err, d)
for tname, targs in (("search_invoices", {}), ("get_stock", {}), ("search_quotes", {}), ("get_invoice", {"invoiceId": A["inv_id"]})):
    err, msg = tool(partial, tname, {"companyId": A["id"], **targs})
    check(f"partial: {tname} refused without its permission key", err and "Permission denied" in str(msg), msg)

# ── revocation takes effect immediately ──────────────────────────────
print("\n== revocation ==")
err, _ = tool(a, "search_invoices", {"companyId": A["id"]})
http("PUT", f"/api/usercompanies/user/{user_ids['mcp_iso_a']}", admin, {"companyIds": []})
err2, msg = tool(a, "search_invoices", {"companyId": A["id"]})
check("company access removed -> next call refused (no cache)", not err and err2, msg)
http("PUT", f"/api/usercompanies/user/{user_ids['mcp_iso_a']}", admin, {"companyIds": [A["id"]]})
err3, _ = tool(a, "search_invoices", {"companyId": A["id"]})
check("access restored -> works again", not err3)

s, _ = http("POST", "/api/auth/logout", b)
s2, _ = rpc(b, "ping")
check("logged-out token rejected by /mcp", s in (200, 204) and s2 == 401, f"logout {s}, ping {s2}")
http("PUT", f"/api/users/{user_ids['mcp_iso_partial']}/roles", admin, {"roleIds": []})
s, _ = rpc(partial, "initialize", {"protocolVersion": "2025-06-18"})
check("role removed -> mcp.access.use lost immediately", s == 403, s)

# ── result ───────────────────────────────────────────────────────────
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
if fails:
    print("FAILED — throwaway users/roles kept for inspection:")
    for n, _, dtl in fails:
        print(f"  - {n}: {dtl}")
    sys.exit(1)

children = [n for n in user_ids if not n.startswith(("mcp_iso_ta",))]
for n in children + [n for n in user_ids if n.startswith("mcp_iso_ta")]:
    http("DELETE", f"/api/users/{user_ids[n]}", admin)
s, roles = http("GET", "/api/roles", admin)
for r in roles or []:
    if r["name"].startswith(TAG):
        http("DELETE", f"/api/roles/{r['id']}", admin)
print("all checks passed")
