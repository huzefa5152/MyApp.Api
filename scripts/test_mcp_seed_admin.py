"""
Hosted MCP - the primary (seed) admin as an MCP user, alongside confined tenants.

Policy: the primary admin may connect an LLM that manages ALL tenants, and every tenant user
keeps their own access limited to the companies assigned to them. Proves both halves together:
the primary admin is enabled by default and can bind a token or a sign-in connection to chosen
companies or to "all companies" (read live, so a tenant created later is included); the shorter
30-day lifetime applies to it; only the primary admin can choose all companies; and none of that
loosens a tenant user, whose tokens and sign-in connections still reach only their own companies.

Needs a LOCAL Trader database with 2+ companies holding invoices and clients. Creates throwaway
users ("mcps"), one throwaway company and its tokens, and removes them on success.

Usage: python scripts/test_mcp_seed_admin.py [--base http://localhost:5137]
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--base", default=os.environ.get("MYAPP_BASE", "http://localhost:5134"))
BASE = ap.parse_args().base.rstrip("/")
PW = "mcps1234"
RUN = secrets.token_hex(3)
REDIR = "http://127.0.0.1:8976/callback"
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)[:500]))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def http(method, path, token=None, body=None, form=None):
    data, hdrs = None, {}
    if body is not None:
        data, hdrs["Content-Type"] = json.dumps(body).encode(), "application/json"
    if form is not None:
        data, hdrs["Content-Type"] = urllib.parse.urlencode(form).encode(), "application/x-www-form-urlencoded"
    if token:
        hdrs["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    try:
        with OPENER.open(req, timeout=60) as r:
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


def company_ids(token):
    err, d = tool(token, "list_companies", {})
    return None if err else {c["id"] for c in d["companies"]}


def revoke_test_tokens(admin_token):
    """The primary admin owns tokens this suite creates (and sign-in connections); a per-user cap of 10 means
    leftovers from earlier runs would eventually block new ones. Revoke only tokens whose names mark them as ours."""
    s, lst = http("GET", "/api/mcp-admin/tokens", admin_token)
    for t in lst if s == 200 else []:
        mine = t["name"].startswith(("seed-", "console-seed-", "SeedTest", "t1-probe"))
        if t["userId"] == 1 and t["status"] == "Active" and mine:
            http("POST", f"/api/mcp-admin/tokens/{t['id']}/revoke", admin_token)


print(f"MCP seed-admin test against {BASE}  (run {RUN})")
admin = login("admin", "admin123")
revoke_test_tokens(admin)
s, companies = http("GET", "/api/companies", admin)
for c in companies:
    if c["name"].startswith("McpSeed Test Co"):
        http("DELETE", f"/api/companies/{c['id']}", admin)
s, companies = http("GET", "/api/companies", admin)
ALL_IDS = {c["id"] for c in companies}
cands = []
for c in companies:
    s, pg = http("GET", f"/api/invoices/company/{c['id']}/paged?page=1&pageSize=1", admin)
    s2, cl = http("GET", f"/api/clients/company/{c['id']}", admin)
    if s == 200 and pg["items"] and s2 == 200 and cl:
        cands.append({"id": c["id"], "client": cl[0]["id"]})
if len(cands) < 3:
    print("SKIP: need 3 companies with invoices and clients.")
    sys.exit(2)
A, B, C = cands[0], cands[1], cands[2]

s, users = http("GET", "/api/users", admin)
for u in users or []:
    if u["username"].startswith("mcps_"):
        http("DELETE", f"/api/users/{u['id']}", admin)
s, roles = http("GET", "/api/roles", admin)
sysr = {r["name"]: r["id"] for r in roles if r.get("isSystemRole")}
SALES, MCPA = sysr["Sales Edition"], sysr["MCP Access"]
uids, tok = {}, {}


def make(uname, cids):
    s, u = http("POST", "/api/users", admin, {"username": uname, "password": PW, "fullName": uname, "role": "User"})
    assert s in (200, 201), f"{uname}: {s} {u}"
    uids[uname] = u["id"]
    assert http("PUT", f"/api/users/{u['id']}/roles", admin, {"roleIds": [SALES, MCPA]})[0] == 200
    assert http("PUT", f"/api/usercompanies/user/{u['id']}", admin, {"companyIds": cids})[0] == 200
    tok[uname] = login(uname, PW)


make("mcps_t1", [A["id"]])
make("mcps_t2", [B["id"]])
T1, T2 = tok["mcps_t1"], tok["mcps_t2"]


def mk(owner, name, cids=None, all_=False, scopes=("read",), days=30):
    return http("POST", "/api/mcp/me/tokens", owner, {"name": name, "companyIds": cids or [], "allCompanies": all_, "scopes": list(scopes), "expiresInDays": days})


made = []

# ── enabled by default, with the wider option ────────────────────────
print("\n== the primary admin is enabled by default ==")
s, st = http("GET", "/api/mcp/me/status", admin)
check("enabled with no role to assign, all-companies offered, 30-day cap", s == 200 and st["enabled"] and st["canUseAllCompanies"] and st["maxLifetimeDays"] == 30, st)
check("every write scope is offered to it", {"clients.write", "quotes.write", "challans.write", "bills.write"} <= set(st["scopesAvailable"]), st["scopesAvailable"])
check("it can name every company", {c["id"] for c in st["companies"]} == ALL_IDS)
s, st1 = http("GET", "/api/mcp/me/status", T1)
check("a tenant user is NOT offered all companies, and keeps the 90-day cap", st1["canUseAllCompanies"] is False and st1["maxLifetimeDays"] == 90, st1)
check("a tenant user only sees their own company to choose from", {c["id"] for c in st1["companies"]} == {A["id"]}, st1["companies"])
s, el = http("GET", f"/api/mcp-admin/eligibility/{1}", admin)
check("admin console eligibility works for the primary admin", s == 200 and el["canUseAllCompanies"] is True and el["maxLifetimeDays"] == 30, el)
s, el2 = http("GET", f"/api/mcp-admin/eligibility/{uids['mcps_t1']}", admin)
check("…and says no for a tenant user", s == 200 and el2["canUseAllCompanies"] is False and el2["maxLifetimeDays"] == 90, el2)

# ── a token for chosen companies ─────────────────────────────────────
print("\n== primary admin token for chosen companies ==")
s, d = mk(admin, f"seed-AB-{RUN}", [A["id"], B["id"]])
check("the primary admin creates a token for two companies", s == 200, f"{s} {d}")
T_AB, T_AB_ID = d["secret"], d["id"]
made.append(T_AB_ID)
check("it sees exactly those two", company_ids(T_AB) == {A["id"], B["id"]}, company_ids(T_AB))
err, m = tool(T_AB, "search_invoices", {"companyId": C["id"]})
check("a company outside the token is refused, even for the primary admin", err, m)
s, d = mk(admin, "x", [999_999_999])
check("a company that does not exist is refused", s == 400, f"{s} {d}")

# ── all companies ────────────────────────────────────────────────────
print("\n== primary admin token for ALL companies ==")
s, d = mk(admin, f"seed-ALL-{RUN}", all_=True)
check("the primary admin creates an all-companies token", s == 200, f"{s} {d}")
T_ALL, T_ALL_ID = d["secret"], d["id"]
made.append(T_ALL_ID)
check("it sees every company in the system", company_ids(T_ALL) == ALL_IDS, (len(company_ids(T_ALL) or []), len(ALL_IDS)))
for c in (A, B, C):
    err, r = tool(T_ALL, "search_invoices", {"companyId": c["id"], "pageSize": 1})
    check(f"it can read company {c['id']}'s invoices", not err and r["totalCount"] >= 1, r)
s, lst = http("GET", "/api/mcp/me/status", admin)
row = next(t for t in lst["tokens"] if t["id"] == T_ALL_ID)
check("the token list marks it as all-companies", row["allCompanies"] is True and row["companies"] == [], row)
s, lst2 = http("GET", "/api/mcp-admin/tokens", admin)
check("the admin console marks it too", next(t for t in lst2 if t["id"] == T_ALL_ID)["allCompanies"] is True)

s, co = http("POST", "/api/companies", admin, {
    "name": f"McpSeed Test Co {RUN}", "fullAddress": "x", "phone": "1", "ntn": "1234567", "cnic": "1234567890123", "strn": "1234567890123",
    "fbrSellerRegistrationNo": "1234567", "startingChallanNumber": 1, "startingInvoiceNumber": 1, "startingPurchaseBillNumber": 1,
    "startingGoodsReceiptNumber": 1, "fbrEnvironment": "sandbox", "fbrProvinceCode": 8})
new_company = co["id"] if s in (200, 201) else None
check("a company created AFTER the token", new_company is not None, f"{s} {co}")
if new_company:
    ALL_IDS.add(new_company)
    check("the all-companies token sees it at once (read live)", new_company in (company_ids(T_ALL) or set()))
    check("the two-company token does not", new_company not in (company_ids(T_AB) or set()))
    check("a tenant user's token does not", new_company not in (company_ids(mk(T1, "t1-probe", [A["id"]])[1]["secret"]) or set()))

# ── limits that still apply ──────────────────────────────────────────
print("\n== limits that still apply ==")
s, d = mk(admin, "x", all_=True, days=31)
check("31 days is refused for the primary admin (cap 30)", s == 400 and "30" in d["message"], f"{s} {d}")
s, d = mk(admin, "x", [A["id"]], days=30)
check("30 days is accepted", s == 200, f"{s} {d}")
made.append(d["id"])
s, d = mk(T1, "x", [A["id"]], days=60)
check("a tenant user keeps up to 90 days", s == 200, f"{s} {d}")
s, d = mk(T1, "x", all_=True)
check("a tenant user cannot choose all companies", s == 400 and "primary admin" in d["message"], f"{s} {d}")
s, d = http("POST", "/api/mcp-admin/tokens", admin, {"userId": uids["mcps_t1"], "name": "x", "companyIds": [], "allCompanies": True, "scopes": ["read"], "expiresInDays": 5})
check("the admin console cannot grant all companies to a tenant user either", s == 400, f"{s} {d}")
s, d = http("POST", "/api/mcp-admin/tokens", admin, {"userId": 1, "name": f"console-seed-{RUN}", "companyIds": [], "allCompanies": True, "scopes": ["read"], "expiresInDays": 31})
check("…and applies the 30-day cap when creating for the primary admin", s == 400, f"{s} {d}")
s, d = http("POST", "/api/mcp-admin/tokens", admin, {"userId": 1, "name": f"console-seed-{RUN}", "companyIds": [], "allCompanies": True, "scopes": ["read"], "expiresInDays": 7})
check("the admin console can create an all-companies token for the primary admin", s == 200, f"{s} {d}")
made.append(d["id"])

# ── tenants stay confined ────────────────────────────────────────────
print("\n== tenant users stay confined ==")
s, d = mk(T1, "t1", [A["id"]])
TT1 = d["secret"]
s, d = mk(T2, "t2", [B["id"]])
TT2 = d["secret"]
check("tenant 1's token sees only company A", company_ids(TT1) == {A["id"]}, company_ids(TT1))
check("tenant 2's token sees only company B", company_ids(TT2) == {B["id"]}, company_ids(TT2))
err, m = tool(TT1, "search_invoices", {"companyId": B["id"]})
check("tenant 1 cannot read tenant 2's company", err, m)
err, m = tool(TT2, "search_invoices", {"companyId": A["id"]})
check("tenant 2 cannot read tenant 1's company", err, m)
check("the primary admin's all-companies token did not change what tenants see", company_ids(TT1) == {A["id"]} and company_ids(TT2) == {B["id"]})
s, al = http("GET", f"/api/mcp/me/activity?pageSize=50", T1)
check("a tenant user never sees the primary admin's activity", all(r["username"] != "admin" for r in al["items"]))

# ── the login token and the endpoint ─────────────────────────────────
print("\n== the primary admin's own login on /mcp ==")
check("the primary admin's login token works on /mcp and sees every company", company_ids(admin) == ALL_IDS)
s, d = mcp(admin, "tools/list")
check("with no write tools unless an agent token carries the scope", not any(t["name"].startswith("prepare_") for t in d["result"]["tools"]))

# ── writes by the primary admin across tenants ───────────────────────
print("\n== writes across tenants (prepare only) ==")
s, d = mk(admin, f"seed-W-{RUN}", all_=True, scopes=("read", "quotes.write", "clients.write"))
check("an all-companies token with write scopes is allowed", s == 200, f"{s} {d}")
TW, TW_ID = d["secret"], d["id"]
made.append(TW_ID)
for c in (A, B):
    err, p = tool(TW, "prepare_quote", {"companyId": c["id"], "clientId": c["client"], "items": [{"description": f"seed probe {RUN}", "quantity": "1", "unit": "Pcs", "unitPrice": "10"}]})
    check(f"it can prepare a quotation in company {c['id']}", not err and p["saved"] is False, p)
    if not err:
        tool(TW, "cancel_action", {"planId": p["planId"]})
err, m = tool(TW, "prepare_quote", {"companyId": A["id"], "clientId": B["client"], "items": [{"description": "x", "quantity": "1", "unit": "Pcs", "unitPrice": "10"}]})
check("a client of another company is still refused for the primary admin", err, m)

# ── sign-in connect ──────────────────────────────────────────────────
print("\n== sign-in connect for the primary admin ==")
s, reg = http("POST", "/oauth/register", body={"client_name": f"SeedTest {RUN}", "redirect_uris": [REDIR]})
CID = reg["client_id"]


def flow(user_token, **kw):
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip("=")
    chal = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    body = {"clientId": CID, "redirectUri": REDIR, "state": "s", "codeChallenge": chal, "codeChallengeMethod": "S256", "companyIds": [], "scopes": ["read"]}
    body.update(kw)
    s, d = http("POST", "/api/oauth/authorize", user_token, body)
    if s != 200:
        return s, d, None
    code = urllib.parse.parse_qs(urllib.parse.urlparse(d["redirectUrl"]).query)["code"][0]
    s, tk = http("POST", "/oauth/token", form={"grant_type": "authorization_code", "code": code, "code_verifier": verifier, "client_id": CID, "redirect_uri": REDIR})
    return s, tk, verifier


s, tk, _ = flow(admin, allCompanies=True)
check("the primary admin approves an all-companies connection", s == 200, f"{s} {tk}")
check("the connection sees every company", company_ids(tk["access_token"]) == ALL_IDS)
s, rf = http("POST", "/oauth/token", form={"grant_type": "refresh_token", "refresh_token": tk["refresh_token"], "client_id": CID})
check("renewing it keeps the all-companies reach", s == 200 and company_ids(rf["access_token"]) == ALL_IDS, f"{s} {rf}")
s, tk2, _ = flow(admin, companyIds=[A["id"]])
check("or a connection limited to one company", s == 200 and company_ids(tk2["access_token"]) == {A["id"]}, f"{s} {tk2}")
s, tk3, _ = flow(T1, allCompanies=True)
check("a tenant user cannot approve all companies", s == 400, f"{s} {tk3}")
s, tk4, _ = flow(T1, companyIds=[A["id"]])
check("a tenant user's connection still sees only their company", s == 200 and company_ids(tk4["access_token"]) == {A["id"]}, f"{s} {tk4}")
s, tk5, _ = flow(T1, companyIds=[B["id"]])
check("a tenant user cannot name a company they do not reach", s == 400, f"{s} {tk5}")

# ── logging and revocation ───────────────────────────────────────────
print("\n== activity and revocation ==")
s, act = http("GET", f"/api/mcp-admin/activity?tokenId={T_ALL_ID}&pageSize=100", admin)
check("the all-companies token's calls are logged under the primary admin", act["total"] >= 4 and all(r["username"] == "admin" and r["userId"] == 1 for r in act["items"]), (act["total"], [r["username"] for r in act["items"]][:3]))
check("the token name identifies which assistant did it", all(r["agentName"] == f"seed-ALL-{RUN}" for r in act["items"]))
check("different companies appear in the log", len({r["companyId"] for r in act["items"] if r["companyId"]}) >= 3)
s, _ = http("POST", f"/api/mcp-admin/tokens/{T_ALL_ID}/revoke", admin)
s2, _ = mcp(T_ALL, "ping")
check("revoking the all-companies token stops it on the next call", s == 200 and s2 == 401, (s, s2))

# ── result ───────────────────────────────────────────────────────────
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
if fails:
    print("FAILED - throwaway users, tokens and company kept for inspection:")
    for n, _, dtl in fails:
        print(f"  - {n}: {dtl}")
    sys.exit(1)
for tid in made:
    http("POST", f"/api/mcp-admin/tokens/{tid}/revoke", admin)
revoke_test_tokens(admin)
if new_company:
    http("DELETE", f"/api/companies/{new_company}", admin)
for n in ("mcps_t1", "mcps_t2"):
    http("DELETE", f"/api/users/{uids[n]}", admin)
print("all checks passed")
