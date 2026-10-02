"""
Hosted MCP - "sign in to connect" (OAuth 2.1 authorization code + PKCE + dynamic
client registration), as used by claude.ai, ChatGPT and Codex.

Plays both parts: the AI client (discovers the server, registers, sends the user to
authorize, exchanges the code, refreshes) and the user (signs in and approves with their
normal ERP login). Proves the connection is exactly as safe as a pasted token: bound to
the approving user, limited to the companies they ticked, short-lived, refreshed with a
secret that works once, replay-proof, revocable, and gone when the user loses MCP Access.

Needs a LOCAL Trader database with 2+ companies holding invoices. Creates throwaway
users ("mcpoa") and OAuth clients. Expiry is simulated through sqlcmd (local only).

Usage: python scripts/test_mcp_oauth.py [--base http://localhost:5137]
         [--sql-server .\\MSSQLSERVER02] [--sql-db MyApp_Trader_Local]
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--base", default=os.environ.get("MYAPP_BASE", "http://localhost:5134"))
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--sql-db", default="MyApp_Trader_Local")
ARGS = ap.parse_args()
BASE = ARGS.base.rstrip("/")
PW = "mcpoa1234"
REDIRECT = "http://127.0.0.1:8976/callback"
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {detail}"))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def raw(method, path, token=None, body=None, form=None, headers=None):
    """-> (status, parsed-or-text, response headers). Never follows redirects."""
    data, hdrs = None, {}
    if body is not None:
        data, hdrs["Content-Type"] = json.dumps(body).encode(), "application/json"
    if form is not None:
        data, hdrs["Content-Type"] = urllib.parse.urlencode(form).encode(), "application/x-www-form-urlencoded"
    if token:
        hdrs["Authorization"] = "Bearer " + token
    hdrs.update(headers or {})
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    try:
        with OPENER.open(req, timeout=30) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt and txt[0] in "{[" else txt), r.headers
    except urllib.error.HTTPError as e:
        txt = e.read().decode() if e.fp else ""
        try:
            parsed = json.loads(txt) if txt and txt[0] in "{[" else txt
        except Exception:
            parsed = txt
        return e.code, parsed, e.headers


def http(method, path, token=None, body=None):
    s, d, _ = raw(method, path, token, body)
    return s, d


def login(user, pw):
    s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    if s == 429:
        time.sleep(62)
        s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    assert s == 200, f"login {user}: {s} {d}"
    return d["token"]


def sql(query):
    out = subprocess.run(["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.sql_db, "-E", "-C", "-N", "-I", "-b", "-Q", query],
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr


_id = [0]


def mcp(token, method, params=None):
    _id[0] += 1
    return http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": _id[0], "method": method, "params": params or {}})


def tool(token, name, args):
    s, d = mcp(token, "tools/call", {"name": name, "arguments": args})
    if s != 200 or not isinstance(d, dict) or "error" in d:
        return True, d
    res = d["result"]
    text = res["content"][0]["text"]
    return (True, text) if res.get("isError") else (False, json.loads(text))


def pkce():
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip("=")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


print(f"MCP OAuth test against {BASE}")
admin = login("admin", "admin123")
s, companies = http("GET", "/api/companies", admin)
cands = []
for c in companies:
    s, pg = http("GET", f"/api/invoices/company/{c['id']}/paged?page=1&pageSize=1", admin)
    if s == 200 and pg["items"]:
        cands.append({"id": c["id"], "name": c["name"]})
if len(cands) < 2:
    print("SKIP: need 2 companies with invoices.")
    sys.exit(2)
A, B = cands[0], cands[1]

s, users = http("GET", "/api/users", admin)
for u in users or []:
    if u["username"].startswith("mcpoa_"):
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


make("mcpoa_a", [SALES, MCP], [A["id"], B["id"]])
make("mcpoa_off", [SALES], [A["id"]])
user, off = tok["mcpoa_a"], tok["mcpoa_off"]

# ── discovery ────────────────────────────────────────────────────────
print("\n== discovery ==")
s, prm, _ = raw("GET", "/.well-known/oauth-protected-resource")
check("protected-resource metadata names the MCP endpoint", s == 200 and prm["resource"].endswith("/mcp") and prm["authorization_servers"], prm)
s, asm, _ = raw("GET", "/.well-known/oauth-authorization-server")
check("authorization-server metadata publishes the endpoints",
      s == 200 and all(asm.get(k, "").startswith("http") for k in ("authorization_endpoint", "token_endpoint", "registration_endpoint")), asm)
check("PKCE S256 only, public clients only",
      asm["code_challenge_methods_supported"] == ["S256"] and asm["token_endpoint_auth_methods_supported"] == ["none"], asm)
s, _, h = raw("POST", "/mcp", body={"jsonrpc": "2.0", "id": 1, "method": "ping"})
www = h.get("WWW-Authenticate", "")
check("an anonymous /mcp call is answered 401 pointing at the metadata", s == 401 and "resource_metadata=" in www and "/.well-known/oauth-protected-resource" in www, (s, www))
s, _, h = raw("POST", "/mcp", "tmcp_" + "z" * 43, body={"jsonrpc": "2.0", "id": 1, "method": "ping"})
check("a bad token adds error=invalid_token", s == 401 and 'error="invalid_token"' in h.get("WWW-Authenticate", ""), h.get("WWW-Authenticate"))

# ── registration ─────────────────────────────────────────────────────
print("\n== dynamic client registration ==")
s, reg, _ = raw("POST", "/oauth/register", body={"client_name": "Test AI", "redirect_uris": [REDIRECT]})
check("a client registers and gets a public client id", s == 201 and reg["client_id"].startswith("mcpc_") and reg["token_endpoint_auth_method"] == "none", reg)
CID = reg["client_id"]
for label, b in (
    ("http redirect to a real host refused", {"client_name": "x", "redirect_uris": ["http://evil.example/cb"]}),
    ("javascript: redirect refused", {"client_name": "x", "redirect_uris": ["javascript:alert(1)"]}),
    ("redirect with a fragment refused", {"client_name": "x", "redirect_uris": ["https://ok.example/cb#frag"]}),
    ("redirect with credentials refused", {"client_name": "x", "redirect_uris": ["https://u:p@ok.example/cb"]}),
    ("no redirect_uris refused", {"client_name": "x"}),
    ("eleven redirect_uris refused", {"client_name": "x", "redirect_uris": [f"https://ok.example/{i}" for i in range(11)]}),
):
    s, d, _ = raw("POST", "/oauth/register", body=b)
    check(label, s == 400 and d.get("error") == "invalid_redirect_uri", f"{s} {d}")
s, d, _ = raw("POST", "/oauth/register", body={"client_name": "Web AI", "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"]})
check("an https redirect is accepted", s == 201, d)

# ── authorize entry point ────────────────────────────────────────────
print("\n== authorize ==")
ver, chal = pkce()
q = urllib.parse.urlencode({"response_type": "code", "client_id": CID, "redirect_uri": REDIRECT, "code_challenge": chal,
                            "code_challenge_method": "S256", "state": "st-1"})
s, _, h = raw("GET", "/oauth/authorize?" + q)
check("a valid request is handed to the app's sign-in and consent screen", s in (301, 302) and h["Location"].startswith("/admin/connect?") and CID in h["Location"], (s, h.get("Location")))
s, d, h = raw("GET", "/oauth/authorize?" + q.replace(CID, "mcpc_unknown"))
check("an unknown client is an error page, never a redirect", s == 400 and "Location" not in h, (s, h.get("Location")))
s, d, h = raw("GET", "/oauth/authorize?" + q.replace(urllib.parse.quote(REDIRECT, safe=""), urllib.parse.quote("http://127.0.0.1:1/other", safe="")))
check("an unregistered redirect address is an error page, never a redirect", s == 400 and "Location" not in h, (s, h.get("Location")))
s, _, h = raw("GET", "/oauth/authorize?" + q.replace("S256", "plain"))
loc = h.get("Location", "")
check("PKCE method other than S256 bounces back with invalid_request and the state",
      s in (301, 302) and loc.startswith(REDIRECT) and "error=invalid_request" in loc and "state=st-1" in loc, loc)

# ── consent (the signed-in user) ─────────────────────────────────────
print("\n== consent ==")
s, d, _ = raw("GET", f"/api/oauth/authorize-info?client_id={CID}&redirect_uri={urllib.parse.quote(REDIRECT, safe='')}")
check("consent info needs a signed-in user", s == 401, s)
s, info, _ = raw("GET", f"/api/oauth/authorize-info?client_id={CID}&redirect_uri={urllib.parse.quote(REDIRECT, safe='')}", user)
check("consent info names the app, where it returns, and the user's companies",
      s == 200 and info["clientName"] == "Test AI" and info["enabled"] and {c["id"] for c in info["companies"]} == {A["id"], B["id"]}, info)
s, d, _ = raw("GET", f"/api/oauth/authorize-info?client_id={CID}&redirect_uri={urllib.parse.quote('http://127.0.0.1:1/x', safe='')}", user)
check("consent info for a foreign redirect is 404", s == 404, s)
s, info_off, _ = raw("GET", f"/api/oauth/authorize-info?client_id={CID}&redirect_uri={urllib.parse.quote(REDIRECT, safe='')}", off)
check("a user without MCP Access is told so", s == 200 and info_off["enabled"] is False and info_off["reason"] == "not-enabled", info_off)
s, info_admin, _ = raw("GET", f"/api/oauth/authorize-info?client_id={CID}&redirect_uri={urllib.parse.quote(REDIRECT, safe='')}", admin)
check("the primary admin is enabled and offered the all-companies choice (policy: allowed, tenants stay confined)", s == 200 and info_admin["enabled"] is True and info_admin["canUseAllCompanies"] is True, info_admin)
check("a tenant user is NOT offered the all-companies choice", info["canUseAllCompanies"] is False, info)


def approve(token, cids, challenge=None, client=CID, redirect=REDIRECT, state="st-xyz", method="S256"):
    return raw("POST", "/api/oauth/authorize", token, {"clientId": client, "redirectUri": redirect, "state": state,
               "codeChallenge": challenge or chal, "codeChallengeMethod": method, "companyIds": cids})


s, d, _ = approve(off, [A["id"]])
check("user without MCP Access cannot approve (403)", s == 403, f"{s} {d}")
s, d, _ = approve(admin, [A["id"]])
check("the primary admin may approve a connection for specific companies", s == 200, f"{s} {d}")
s, d, _ = raw("POST", "/api/oauth/authorize", user, {"clientId": CID, "redirectUri": REDIRECT, "state": "s", "codeChallenge": chal, "codeChallengeMethod": "S256", "companyIds": [], "allCompanies": True})
check("a tenant user cannot approve all companies", s == 400, f"{s} {d}")
s, d, _ = approve(user, [999999])
check("a company the user cannot reach is refused", s == 400, f"{s} {d}")
s, d, _ = approve(user, [])
check("choosing no company is refused", s == 400, f"{s} {d}")
s, d, _ = approve(user, [A["id"]], challenge="short")
check("a malformed PKCE challenge is refused", s == 400, f"{s} {d}")
s, d, _ = approve(user, [A["id"]], method="plain")
check("PKCE method plain is refused", s == 400, f"{s} {d}")
s, d, _ = approve(user, [A["id"]], redirect="http://127.0.0.1:1/other")
check("approving for an unregistered redirect is refused", s == 400, f"{s} {d}")
s, d, _ = approve(user, [A["id"]], client="mcpc_unknown")
check("approving for an unknown client is refused", s == 400, f"{s} {d}")


def get_code(cids, verifier=None, state="st-xyz"):
    v, c = (verifier, base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")) if verifier else pkce()
    s, d, _ = approve(user, cids, challenge=c, state=state)
    assert s == 200, f"approve: {s} {d}"
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(d["redirectUrl"]).query)
    return v, qs["code"][0], qs.get("state", [None])[0], d["redirectUrl"]


def exchange(code, verifier, client=CID, redirect=REDIRECT):
    return raw("POST", "/oauth/token", form={"grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                                              "client_id": client, "redirect_uri": redirect})


ver, code, state, url = get_code([A["id"]])
check("approval returns to the registered address with the code and the state", url.startswith(REDIRECT + "?") and state == "st-xyz", url)
s, d, _ = raw("POST", "/api/oauth/deny", user, {"clientId": CID, "redirectUri": REDIRECT, "state": "st-d", "codeChallenge": chal, "codeChallengeMethod": "S256", "companyIds": []})
check("denying returns access_denied to the registered address", s == 200 and "error=access_denied" in d["redirectUrl"] and "state=st-d" in d["redirectUrl"], d)

# ── token exchange ───────────────────────────────────────────────────
print("\n== token exchange ==")
for label, kw in (("wrong PKCE verifier", {"verifier": "w" * 50}), ("wrong redirect_uri", {"redirect": "http://127.0.0.1:1/other"}), ("wrong client_id", {"client": "mcpc_unknown"})):
    s, d, _ = exchange(code, kw.get("verifier", ver), kw.get("client", CID), kw.get("redirect", REDIRECT))
    check(f"{label} -> invalid_grant", s == 400 and d.get("error") == "invalid_grant", f"{s} {d}")
s, tk, h = exchange(code, ver)
check("the right code and verifier are exchanged for tokens", s == 200 and tk["token_type"] == "Bearer" and tk["expires_in"] == 3600
      and tk["access_token"].startswith("tmcp_") and tk["refresh_token"].startswith("tmcr_") and tk["scope"] == "read", f"{s} {tk}")
check("token responses are not cacheable", "no-store" in h.get("Cache-Control", ""), h.get("Cache-Control"))
ACCESS, REFRESH = tk["access_token"], tk["refresh_token"]

err, d = tool(ACCESS, "list_companies", {})
check("the access token acts as the user, limited to the ticked company", not err and [c["id"] for c in d["companies"]] == [A["id"]], d)
err, m = tool(ACCESS, "search_invoices", {"companyId": B["id"]})
check("the user can reach B but the connection cannot", err, m)
s, st, _ = raw("GET", "/api/mcp/me/status", user)
row = next((t for t in st["tokens"] if t["name"] == "Test AI (sign-in)"), None)
check("the connection appears in the user's token list as a sign-in connection", row and row["signIn"] and row["status"] == "Active", st["tokens"])
s, act, _ = raw("GET", "/api/mcp/me/activity?pageSize=20", user)
check("its calls are in the user's activity log under the app's name", any(a["agentName"] == "Test AI (sign-in)" for a in act["items"]), act["items"][:2])

s, d, _ = exchange(code, ver)
check("replaying the code fails", s == 400 and d.get("error") == "invalid_grant", f"{s} {d}")
s, _ = mcp(ACCESS, "ping")
check("…and a replayed code revokes the token it produced", s == 401, s)

s, d, _ = raw("POST", "/oauth/token", form={"grant_type": "password", "username": "x"})
check("unsupported grant type refused", s == 400 and d["error"] == "unsupported_grant_type", d)
s, d, _ = raw("POST", "/oauth/token", body={"grant_type": "authorization_code"})
check("a JSON body to the token endpoint is refused", s == 400 and d["error"] == "invalid_request", d)
s, d, _ = raw("POST", "/oauth/token", form={"grant_type": "authorization_code", "client_id": CID})
check("missing parameters refused", s == 400 and d["error"] == "invalid_request", d)

# ── refresh ──────────────────────────────────────────────────────────
print("\n== refresh ==")
ver, code, _, _ = get_code([A["id"], B["id"]])
s, tk, _ = exchange(code, ver)
ACCESS, REFRESH = tk["access_token"], tk["refresh_token"]
err, d = tool(ACCESS, "list_companies", {})
check("a connection can be approved for both companies", not err and {c["id"] for c in d["companies"]} == {A["id"], B["id"]}, d)


def refresh(rt, client=CID):
    return raw("POST", "/oauth/token", form={"grant_type": "refresh_token", "refresh_token": rt, "client_id": client})


s, d, _ = refresh(REFRESH, "mcpc_unknown")
check("refresh for the wrong client is refused", s == 400 and d["error"] == "invalid_grant", d)
s, tk2, _ = refresh(REFRESH)
check("a refresh secret is exchanged for a fresh pair", s == 200 and tk2["access_token"] != ACCESS and tk2["refresh_token"] != REFRESH, f"{s} {tk2}")
s, _ = mcp(ACCESS, "ping")
check("the old access secret stops working at once", s == 401, s)
s, d, _ = refresh(REFRESH)
check("the old refresh secret works exactly once", s == 400 and d["error"] == "invalid_grant", d)
err, d = tool(tk2["access_token"], "list_companies", {})
check("the renewed access token works", not err, d)
ACCESS, REFRESH = tk2["access_token"], tk2["refresh_token"]

# ── lifetime ─────────────────────────────────────────────────────────
print("\n== lifetime ==")
sql(f"UPDATE McpAgentTokens SET ExpiresAt = DATEADD(minute, -5, SYSUTCDATETIME()) WHERE UserId = {uids['mcpoa_a']} AND OAuthClientId = '{CID}' AND RevokedAt IS NULL")
s, _ = mcp(ACCESS, "ping")
check("an expired access token is refused", s == 401, s)
s, st, _ = raw("GET", "/api/mcp/me/status", user)
check("…yet the connection still shows Active while it can be renewed", next(t for t in st["tokens"] if t["name"] == "Test AI (sign-in)")["status"] == "Active")
s, tk3, _ = refresh(REFRESH)
check("an expired access token is renewed with the refresh secret", s == 200, f"{s} {tk3}")
ACCESS, REFRESH = tk3["access_token"], tk3["refresh_token"]
err, d = tool(ACCESS, "list_companies", {})
check("…and the renewed one works", not err, d)

sql(f"UPDATE McpAgentTokens SET ExpiresAt = DATEADD(minute, -5, SYSUTCDATETIME()), RefreshExpiresAt = DATEADD(minute, -5, SYSUTCDATETIME()) WHERE UserId = {uids['mcpoa_a']} AND OAuthClientId = '{CID}' AND RevokedAt IS NULL")
s, d, _ = refresh(REFRESH)
check("an expired refresh secret is refused", s == 400 and d["error"] == "invalid_grant", d)
s, st, _ = raw("GET", "/api/mcp/me/status", user)
check("…and the connection shows Expired", next(t for t in st["tokens"] if t["name"] == "Test AI (sign-in)")["status"] == "Expired")

ver, code, _, _ = get_code([A["id"]])
sql(f"UPDATE McpOAuthCodes SET ExpiresAt = DATEADD(minute, -1, SYSUTCDATETIME()) WHERE UserId = {uids['mcpoa_a']} AND UsedAt IS NULL")
s, d, _ = exchange(code, ver)
check("an expired authorization code is refused", s == 400 and d["error"] == "invalid_grant", d)

# ── ending a connection ──────────────────────────────────────────────
print("\n== ending a connection ==")
ver, code, _, _ = get_code([A["id"]])
s, first, _ = exchange(code, ver)
ver, code, _, _ = get_code([B["id"]])
s, second, _ = exchange(code, ver)
s, _ = mcp(first["access_token"], "ping")
check("signing in again replaces the previous connection of the same app", s == 401, s)
err, d = tool(second["access_token"], "list_companies", {})
check("…and the new one carries the newly approved company", not err and [c["id"] for c in d["companies"]] == [B["id"]], d)

s, st, _ = raw("GET", "/api/mcp/me/status", user)
mine = next(t for t in st["tokens"] if t["status"] == "Active" and t["signIn"])
s, _, _ = raw("POST", f"/api/mcp/me/tokens/{mine['id']}/revoke", user)
check("the user disconnects the app from their profile", s == 200, s)
s, _ = mcp(second["access_token"], "ping")
check("the access token dies at once", s == 401, s)
s, d, _ = refresh(second["refresh_token"])
check("…and so does its refresh secret", s == 400 and d["error"] == "invalid_grant", d)

ver, code, _, _ = get_code([A["id"]])
s, third, _ = exchange(code, ver)
http("PUT", f"/api/users/{uids['mcpoa_a']}/roles", admin, {"roleIds": [SALES]})
s, d, _ = refresh(third["refresh_token"])
check("a user who loses MCP Access cannot renew the connection", s == 400 and d["error"] == "invalid_grant", d)
s, _ = mcp(third["access_token"], "ping")
check("…and the live access token is refused too (403)", s == 403, s)
http("PUT", f"/api/users/{uids['mcpoa_a']}/roles", admin, {"roleIds": [SALES, MCP]})

s, d, _ = raw("POST", "/api/oauth/authorize", third["access_token"], {"clientId": CID, "redirectUri": REDIRECT, "codeChallenge": chal, "codeChallengeMethod": "S256", "companyIds": [A["id"]]})
check("a connection cannot approve further connections", s == 401, s)

# ── result ───────────────────────────────────────────────────────────
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
