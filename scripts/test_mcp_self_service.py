"""
Hosted MCP - self-service for the signed-in user ("MCP & AI" tab on My Profile).

Proves a user can switch on and manage MCP for THEMSELVES and no one else: status says
honestly whether MCP is enabled; they create and revoke only their own tokens, capped by
the companies they reach; an agent token can never mint more tokens; one user can never
see, revoke or read the activity of another's; and a user without MCP Access, or the
primary admin, cannot create a token at all.

Needs a LOCAL Trader database with 2+ companies holding invoices. Creates only throwaway
users ("mcpself"), removed on success.

Usage: python scripts/test_mcp_self_service.py [--base http://localhost:5137]
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
PW = "mcpself1234"
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {detail}"))


def http(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
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
    if s != 200 or not isinstance(d, dict) or "error" in d:
        return True, d
    res = d["result"]
    text = res["content"][0]["text"]
    return (True, text) if res.get("isError") else (False, json.loads(text))


print(f"MCP self-service test against {BASE}")
admin = login("admin", "admin123")
s, companies = http("GET", "/api/companies", admin)
cands = []
for c in companies:
    s, pg = http("GET", f"/api/invoices/company/{c['id']}/paged?page=1&pageSize=1", admin)
    if s == 200 and pg["items"]:
        cands.append({"id": c["id"], "name": c["name"], "inv": pg["items"][0]["id"]})
if len(cands) < 2:
    print("SKIP: need 2 companies with invoices.")
    sys.exit(2)
A, B = cands[0], cands[1]

s, users = http("GET", "/api/users", admin)
for u in users or []:
    if u["username"].startswith("mcpself_"):
        http("DELETE", f"/api/users/{u['id']}", admin)
s, roles = http("GET", "/api/roles", admin)
sysr = {r["name"]: r["id"] for r in roles if r.get("isSystemRole")}
SALES, MCP = sysr["Sales Edition"], sysr["MCP Access"]
uids, tok = {}, {}


def make(uname, role_ids, cids):
    s, u = http("POST", "/api/users", admin, {"username": uname, "password": PW, "fullName": uname, "role": "User"})
    assert s in (200, 201), f"{uname}: {s} {u}"
    uids[uname] = u["id"]
    assert http("PUT", f"/api/users/{u['id']}/roles", admin, {"roleIds": role_ids})[0] == 200
    assert http("PUT", f"/api/usercompanies/user/{u['id']}", admin, {"companyIds": cids})[0] == 200
    tok[uname] = login(uname, PW)


make("mcpself_a", [SALES, MCP], [A["id"], B["id"]])
make("mcpself_b", [SALES, MCP], [A["id"]])
make("mcpself_off", [SALES], [A["id"]])
a, b, off = tok["mcpself_a"], tok["mcpself_b"], tok["mcpself_off"]


def body(name="t", cids=None, scopes=None, days=30):
    return {"name": name, "companyIds": cids if cids is not None else [A["id"]], "scopes": scopes or ["read"], "expiresInDays": days}


print("\n== status ==")
s, d = http("GET", "/api/mcp/me/status", a)
check("user with MCP Access sees enabled", s == 200 and d["enabled"] is True and d["reason"] == "", d)
check("status lists only the user's own companies", {c["id"] for c in d["companies"]} == {A["id"], B["id"]}, d["companies"])
check("status offers read scope only for now", d["scopesAvailable"] == ["read"], d["scopesAvailable"])
s, d = http("GET", "/api/mcp/me/status", off)
check("user without MCP Access sees not-enabled, with the reason", s == 200 and d["enabled"] is False and d["reason"] == "not-enabled", d)
s, d = http("GET", "/api/mcp/me/status", admin)
check("primary admin sees seed-admin, not enabled", s == 200 and d["enabled"] is False and d["reason"] == "seed-admin", d)
s, _ = http("GET", "/api/mcp/me/status")
check("anonymous refused", s == 401, s)

print("\n== creating my own token ==")
s, d = http("POST", "/api/mcp/me/tokens", a, body("laptop", [A["id"]]))
check("user creates a token for themselves", s == 200 and d["secret"].startswith("tmcp_"), f"{s} {d}")
SEC, TID = d["secret"], d["id"]
err, r = tool(SEC, "list_companies", {})
check("the token works on /mcp and is limited to the chosen company", not err and [c["id"] for c in r["companies"]] == [A["id"]], r)
err, m = tool(SEC, "search_invoices", {"companyId": B["id"]})
check("the user can reach B, the token cannot", err, m)
s, d = http("GET", "/api/mcp/me/status", a)
check("token listed, secret and hash never returned", any(t["id"] == TID for t in d["tokens"]) and SEC not in json.dumps(d) and "hash" not in json.dumps(d).lower(), d["tokens"])

for label, user, req in (
    ("company the user cannot reach refused", b, body("x", [B["id"]])),
    ("write scope refused (read-only phase)", a, body("x", [A["id"]], ["read", "bills.write"])),
    ("empty company list refused", a, body("x", [])),
    ("lifetime over the maximum refused", a, body("x", [A["id"]], days=91)),
    ("blank name refused", a, body("  ")),
):
    s, d = http("POST", "/api/mcp/me/tokens", user, req)
    check(label, s == 400, f"{s} {d}")
s, d = http("POST", "/api/mcp/me/tokens", off, body())
check("user without MCP Access cannot create a token (403)", s == 403, f"{s} {d}")
s, d = http("POST", "/api/mcp/me/tokens", admin, body())
check("primary admin cannot create a token", s == 400, f"{s} {d}")

print("\n== an agent cannot mint tokens ==")
s, _ = http("GET", "/api/mcp/me/status", SEC)
check("agent token refused on the self-service status route", s == 401, s)
s, _ = http("POST", "/api/mcp/me/tokens", SEC, body())
check("agent token cannot create another token", s == 401, s)

print("\n== users only see and touch their own ==")
s, d = http("GET", "/api/mcp/me/status", b)
check("another user's status does not list my token", all(t["id"] != TID for t in d["tokens"]), d["tokens"])
s, _ = http("POST", f"/api/mcp/me/tokens/{TID}/revoke", b)
check("revoking someone else's token answers 404", s == 404, s)
s, _ = rpc(SEC, "ping")
check("…and that token is untouched", s == 200, s)
s, act_a = http("GET", "/api/mcp/me/activity?pageSize=50", a)
s, act_b = http("GET", "/api/mcp/me/activity?pageSize=50", b)
check("my activity shows my token's calls", act_a["total"] >= 2 and all(r["username"] == "mcpself_a" for r in act_a["items"]), act_a["total"])
check("another user's activity is empty of mine", act_b["total"] == 0, act_b["total"])
check("my activity feed never carries the secret", SEC not in json.dumps(act_a))
s, _ = http("GET", "/api/mcp/me/activity?outcome=bogus", a)
check("bad outcome filter refused", s == 400, s)
s, _ = http("GET", "/api/mcp/me/activity", off)
check("user without MCP Access cannot read the activity feed", s == 403, s)

print("\n== limits and revocation ==")
made = [TID]
for i in range(9):
    s, d = http("POST", "/api/mcp/me/tokens", a, body(f"extra{i}"))
    if s == 200:
        made.append(d["id"])
check("up to ten active tokens", len(made) == 10, len(made))
s, d = http("POST", "/api/mcp/me/tokens", a, body("eleventh"))
check("the eleventh is refused until one is revoked", s == 400, f"{s} {d}")
s, _ = http("POST", f"/api/mcp/me/tokens/{TID}/revoke", a)
check("user revokes their own token", s == 200, s)
s, _ = rpc(SEC, "ping")
check("revoked token fails on the very next call", s == 401, s)
s, d = http("POST", "/api/mcp/me/tokens", a, body("replacement"))
check("a slot is free again after revoking", s == 200, f"{s} {d}")
s, _ = http("POST", f"/api/mcp/me/tokens/{TID}/revoke", a)
check("revoking twice is a 404", s == 404, s)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
if fails:
    print("FAILED - throwaway users kept for inspection:")
    for n, _, dtl in fails:
        print(f"  - {n}: {dtl}")
    sys.exit(1)
for i in uids.values():
    http("DELETE", f"/api/users/{i}", admin)
print("all checks passed")
