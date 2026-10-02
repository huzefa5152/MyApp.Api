"""
Hosted MCP - write tools (clients, quotations): prepare, approve, commit.

Proves an agent can only ever do what its owner could do by hand, and only through a
plan a person saw: nothing is saved by prepare; commit creates exactly one document, once,
with the figures that were shown; every gate (agent token, write scope, MCP Write role, the
screen's own permission, company access) is checked at prepare AND again at commit; a plan is
useless to any other token; an idempotency key prevents duplicates; and every step is logged.

Needs a LOCAL Trader database with 2+ companies holding invoices and clients. Creates
throwaway users ("mcpw"), quotations and clients, and removes what it can on success.

Usage: python scripts/test_mcp_writes.py [--base http://localhost:5137]
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
PW = "mcpw1234"
RUN = secrets.token_hex(3)
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {detail}"))


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


def sql(query, scalar=False):
    args = ["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.sql_db, "-E", "-C", "-N", "-I", "-b"]
    if scalar:
        args += ["-h", "-1", "-W", "-Q", "SET NOCOUNT ON; " + query]
    else:
        args += ["-Q", query]
    out = subprocess.run(args, capture_output=True, text=True)
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


def tool_names(token):
    s, d = mcp(token, "tools/list")
    return sorted(t["name"] for t in d["result"]["tools"])


print(f"MCP writes test against {BASE}  (run {RUN})")
admin = login("admin", "admin123")
s, companies = http("GET", "/api/companies", admin)
cands = []
for c in companies:
    s, pg = http("GET", f"/api/invoices/company/{c['id']}/paged?page=1&pageSize=1", admin)
    s2, cl = http("GET", f"/api/clients/company/{c['id']}", admin)
    if s == 200 and pg["items"] and s2 == 200 and cl:
        cands.append({"id": c["id"], "client": cl[0]["id"], "client_name": cl[0]["name"]})
if len(cands) < 2:
    print("SKIP: need 2 companies with invoices and clients.")
    sys.exit(2)
A, B = cands[0], cands[1]
B_ITEMTYPE = sql(f"SELECT TOP 1 Id FROM ItemTypes WHERE CompanyId = {B['id']} AND IsDeleted = 0", scalar=True)

s, users = http("GET", "/api/users", admin)
for u in users or []:
    if u["username"].startswith("mcpw_"):
        http("DELETE", f"/api/users/{u['id']}", admin)
s, roles = http("GET", "/api/roles", admin)
for r in roles or []:
    if r["name"].startswith("mcpw-"):
        http("DELETE", f"/api/roles/{r['id']}", admin)
s, roles = http("GET", "/api/roles", admin)
sysr = {r["name"]: r["id"] for r in roles if r.get("isSystemRole")}
SALES, MCPA, MCPW, TADMIN = sysr["Sales Edition"], sysr["MCP Access"], sysr["MCP Write"], sysr["Tenant Administrator"]
uids, tok = {}, {}


def make(creator, uname, role_ids, cids, role_string="User"):
    s, u = http("POST", "/api/users", creator, {"username": uname, "password": PW, "fullName": uname, "role": role_string})
    assert s in (200, 201), f"{uname}: {s} {u}"
    uids[uname] = u["id"]
    s, d = http("PUT", f"/api/users/{u['id']}/roles", creator, {"roleIds": role_ids})
    assert s == 200, f"roles {uname}: {s} {d}"
    s, d = http("PUT", f"/api/usercompanies/user/{u['id']}", creator, {"companyIds": cids})
    assert s == 200, f"companies {uname}: {s} {d}"
    tok[uname] = login(uname, PW)


make(admin, "mcpw_w", [SALES, MCPA, MCPW], [A["id"], B["id"]])          # may write everything implemented
make(admin, "mcpw_r", [SALES, MCPA], [A["id"]])                          # MCP Access but no MCP Write
make(admin, "mcpw_ta", [TADMIN, SALES, MCPA, MCPW], [A["id"]], "Administrator")
s, r = http("POST", "/api/roles", tok["mcpw_ta"], {"name": "mcpw-clients-only", "description": "t",
            "permissionKeys": ["mcp.access.use", "mcp.write.use", "clients.manage.view", "clients.manage.create", "clients.manage.update"]})
assert s in (200, 201), f"tenant role: {s} {r}"
make(tok["mcpw_ta"], "mcpw_c", [r["id"]], [A["id"]])                     # may create clients, not quotations
W, R, C = tok["mcpw_w"], tok["mcpw_r"], tok["mcpw_c"]


def make_token(owner_token, name, cids, scopes, days=30):
    return http("POST", "/api/mcp/me/tokens", owner_token, {"name": name, "companyIds": cids, "scopes": scopes, "expiresInDays": days})


# ── scopes are offered only to those entitled to them ────────────────
print("\n== who may be granted write scopes ==")
s, st = http("GET", "/api/mcp/me/status", W)
check("MCP Write + permissions -> every write scope offered", set(st["scopesAvailable"]) == {"read", "clients.write", "quotes.write", "challans.write", "bills.write"}, st["scopesAvailable"])
s, st = http("GET", "/api/mcp/me/status", R)
check("MCP Access without MCP Write -> read only", st["scopesAvailable"] == ["read"], st["scopesAvailable"])
s, st = http("GET", "/api/mcp/me/status", C)
check("MCP Write but no quotation permission -> clients.write, not quotes.write", "clients.write" in st["scopesAvailable"] and "quotes.write" not in st["scopesAvailable"], st["scopesAvailable"])
s, d = make_token(R, "x", [A["id"]], ["read", "quotes.write"])
check("a user without MCP Write cannot create a write token", s == 400 and "MCP Write" in d["message"], f"{s} {d}")
s, d = make_token(C, "x", [A["id"]], ["read", "quotes.write"])
check("a token cannot carry a scope its owner's permissions do not cover", s == 400, f"{s} {d}")
s, d = make_token(W, "x", [A["id"]], ["read", "invoices.write"])
check("a scope that does not exist is refused, not pre-granted", s == 400, f"{s} {d}")
s, d = make_token(W, "x", [A["id"]], ["nonsense"])
check("an unknown scope is refused", s == 400, f"{s} {d}")
s, d = http("POST", "/api/mcp-admin/tokens", admin, {"userId": uids["mcpw_r"], "name": "x", "companyIds": [A["id"]], "scopes": ["read", "clients.write"], "expiresInDays": 5})
check("the seed admin cannot grant a write scope to a user without MCP Write either", s == 400, f"{s} {d}")
s, el = http("GET", f"/api/mcp-admin/eligibility/{uids['mcpw_w']}", admin)
check("admin eligibility lists the user's companies and scopes", s == 200 and set(el["scopesAvailable"]) >= {"read", "quotes.write"} and {c["id"] for c in el["companies"]} == {A["id"], B["id"]}, el)

s, d = make_token(W, "writer-A", [A["id"]], ["read", "clients.write", "quotes.write"])
check("a user with MCP Write creates a write token for themselves", s == 200, d)
TW, TW_ID = d["secret"], d["id"]
s, d = make_token(W, "reader", [A["id"]], ["read"])
TRO = d["secret"]
s, d = make_token(W, "writer-A-2", [A["id"]], ["read", "clients.write", "quotes.write"])
TW2 = d["secret"]
s, d = make_token(C, "clients-only", [A["id"]], ["read", "clients.write"])
TC = d["secret"]

print("\n== tool catalogue follows the token ==")
READ6 = ["get_challan", "get_invoice", "get_stock", "list_companies", "search_challans", "search_clients", "search_invoices", "search_quotes"]
check("a read-only token sees only the read tools (eight)", tool_names(TRO) == READ6, tool_names(TRO))
check("a login token sees only the read tools", tool_names(W) == READ6, tool_names(W))
check("a write token also sees prepare, commit and cancel", set(tool_names(TW)) == set(READ6) | {"prepare_client", "prepare_quote", "commit_action", "cancel_action"}, tool_names(TW))
check("a clients-only token does not see prepare_quote", set(tool_names(TC)) == set(READ6) | {"prepare_client", "commit_action", "cancel_action"}, tool_names(TC))

print("\n== gates on prepare ==")
Q = {"companyId": A["id"], "clientId": A["client"], "date": "2026-10-02", "gstRate": "18",
     "items": [{"description": f"MCP test widget {RUN}", "quantity": "3.5", "unit": "Pcs", "unitPrice": "120.25"}]}
err, m = tool(TRO, "prepare_quote", Q)
check("a read-only token cannot prepare", err, m)
err, m = tool(W, "prepare_quote", Q)
check("a plain login token cannot prepare, even for a user who may write", err, m)
err, m = tool(TC, "prepare_quote", Q)
check("a clients-only token cannot prepare a quotation", err, m)
err, m = tool(TW, "prepare_quote", {**Q, "companyId": B["id"], "clientId": B["client"]})
check("a token limited to company A cannot prepare in company B", err, m)
err, m = tool(TW, "commit_action", {"planId": "plan_nonexistent"})
check("committing an unknown plan is refused", err, m)
err, m = tool(TRO, "commit_action", {"planId": "plan_nonexistent"})
check("a read-only token cannot commit anything", err, m)

# ── quotation: prepare shows, commit saves ───────────────────────────
print("\n== quotation: prepare, commit ==")


def quote_total_count():
    s, d = http("GET", f"/api/salesquotes/company/{A['id']}/paged?page=1&pageSize=1", admin)
    return d["totalCount"]


before = quote_total_count()
err, plan = tool(TW, "prepare_quote", Q)
check("prepare returns a plan with exact figures and saves nothing", not err and plan["saved"] is False and plan["planId"].startswith("plan_"), plan)
d_ = plan["details"]
check("totals use the ERP's rounding (3.5 x 120.25 = 420.88 + 18% = 75.76)", d_["subtotal"] == 420.88 and d_["gstAmount"] == 75.76 and d_["grandTotal"] == 496.64, d_)
check("no quotation exists yet", quote_total_count() == before, (before, quote_total_count()))
check("the plan names the client and says what commit will do", A["client_name"] in plan["summary"] and "Create a sales quotation" in plan["summary"], plan["summary"])

err, other = tool(TW2, "commit_action", {"planId": plan["planId"]})
check("another token of the SAME user cannot commit this plan", err and "not found" in other.lower(), other)
err, other = tool(TW2, "cancel_action", {"planId": plan["planId"]})
check("…nor cancel it", err, other)
err, r1 = tool(TW, "commit_action", {"planId": plan["planId"]})
check("commit creates the quotation", not err and r1["committed"] and r1["resultRef"].startswith("SalesQuote:"), r1)
qid = int(r1["resultRef"].split(":")[1])
check("exactly one quotation was added", quote_total_count() == before + 1, (before, quote_total_count()))
s, q = http("GET", f"/api/salesquotes/{qid}", admin)
check("the saved quotation matches the plan: company, client, status, totals",
      s == 200 and q["companyId"] == A["id"] and q["clientId"] == A["client"] and q["status"] in ("Draft", "Active")
      and q["subtotal"] == 420.88 and q["gstAmount"] == 75.76 and q["grandTotal"] == 496.64 and q["quoteNumber"] > 0, q)
check("the line was saved as shown", len(q["items"]) == 1 and q["items"][0]["quantity"] == 3.5 and q["items"][0]["unitPrice"] == 120.25 and q["items"][0]["lineTotal"] == 420.88, q["items"])
err, again = tool(TW, "commit_action", {"planId": plan["planId"]})
check("committing the same plan twice is refused", err, again)
check("…and creates no second quotation", quote_total_count() == before + 1)
made_quotes = [qid]

# ── idempotency ──────────────────────────────────────────────────────
print("\n== idempotency ==")
Qk = {**Q, "idempotencyKey": f"mail-{RUN}-1"}
err, p1 = tool(TW, "prepare_quote", Qk)
err2, p2 = tool(TW, "prepare_quote", Qk)
check("preparing twice with one key returns the same plan", not err and not err2 and p1["planId"] == p2["planId"], (p1, p2))
err, c1 = tool(TW, "commit_action", {"planId": p1["planId"]})
made_quotes.append(int(c1["resultRef"].split(":")[1]))
err, p3 = tool(TW, "prepare_quote", Qk)
check("after commit, the same key reports 'already done' and creates nothing", not err and p3.get("alreadyDone") is True and p3["resultRef"] == c1["resultRef"], p3)
check("exactly one quotation exists for the key", quote_total_count() == before + 2, (before, quote_total_count()))
err, p4 = tool(TW2, "prepare_quote", Qk)
check("a different token's key is independent", not err and p4.get("alreadyDone") is None and p4["planId"] != p1["planId"], p4)
tool(TW2, "cancel_action", {"planId": p4["planId"]})

# ── expiry, cancel ───────────────────────────────────────────────────
print("\n== expiry and cancel ==")
n0 = quote_total_count()
err, pe = tool(TW, "prepare_quote", Q)
sql(f"UPDATE McpPendingActions SET ExpiresAt = DATEADD(minute, -1, SYSUTCDATETIME()) WHERE PlanId = '{pe['planId']}'")
err, m = tool(TW, "commit_action", {"planId": pe["planId"]})
check("an expired plan cannot be committed", err and "expired" in m.lower(), m)
err, pc = tool(TW, "prepare_quote", Q)
err, cx = tool(TW, "cancel_action", {"planId": pc["planId"]})
check("a plan can be cancelled", not err and cx["cancelled"], cx)
err, m = tool(TW, "commit_action", {"planId": pc["planId"]})
check("a cancelled plan cannot be committed", err, m)
check("neither created anything", quote_total_count() == n0, (n0, quote_total_count()))

# ── validation ───────────────────────────────────────────────────────
print("\n== validation at prepare ==")


def with_item(**kw):
    it = {"description": "x", "quantity": "1", "unit": "Pcs", "unitPrice": "10"}
    it.update(kw)
    return {**Q, "items": [it]}


for label, args in (
    ("zero quantity", with_item(quantity="0")),
    ("negative price", with_item(unitPrice="-1")),
    ("five-decimal quantity (the column holds four)", with_item(quantity="1.00001")),
    ("three-decimal price (the column holds two)", with_item(unitPrice="10.005")),
    ("non-numeric price", with_item(unitPrice="ten")),
    ("blank description", with_item(description="  ")),
    ("blank unit", with_item(unit="")),
    ("gst over 100", {**Q, "gstRate": "101"}),
    ("gst with three decimals", {**Q, "gstRate": "18.123"}),
    ("no items", {**Q, "items": []}),
    ("101 items", {**Q, "items": [{"description": "x", "quantity": "1", "unit": "Pcs", "unitPrice": "1"}] * 101}),
    ("malformed date", {**Q, "date": "02/10/2026"}),
    ("a client from another company", {**Q, "clientId": B["client"]}),
    ("an item type from another company", with_item(itemTypeId=int(B_ITEMTYPE))),
    ("a missing client", {k: v for k, v in Q.items() if k != "clientId"}),
):
    err, m = tool(TW, "prepare_quote", args)
    check(f"{label} refused", err, m)
check("nothing was created by any refused prepare", quote_total_count() == n0, (n0, quote_total_count()))

# ── gates re-checked at commit ───────────────────────────────────────
print("\n== gates re-checked at commit ==")
err, pg = tool(TW, "prepare_quote", Q)
http("PUT", f"/api/users/{uids['mcpw_w']}/roles", admin, {"roleIds": [SALES, MCPA]})     # MCP Write withdrawn
err, m = tool(TW, "commit_action", {"planId": pg["planId"]})
check("MCP Write withdrawn after prepare -> commit refused", err, m)
check("…and nothing was created", quote_total_count() == n0)
http("PUT", f"/api/users/{uids['mcpw_w']}/roles", admin, {"roleIds": [SALES, MCPA, MCPW]})
err, pr = tool(TW, "prepare_quote", Q)
http("PUT", f"/api/usercompanies/user/{uids['mcpw_w']}", admin, {"companyIds": [B["id"]]})  # company A access withdrawn
err, m = tool(TW, "commit_action", {"planId": pr["planId"]})
check("company access withdrawn after prepare -> commit refused", err, m)
http("PUT", f"/api/usercompanies/user/{uids['mcpw_w']}", admin, {"companyIds": [A["id"], B["id"]]})
err, pv = tool(TW, "prepare_quote", Q)
s, rv = http("POST", f"/api/mcp/me/tokens/{TW_ID}/revoke", W)
s, _ = mcp(TW, "ping")
check("token revoked after prepare -> the next call is 401", s == 401, s)
check("…so the plan can never run", quote_total_count() == n0)
s, d = make_token(W, "writer-A-3", [A["id"]], ["read", "clients.write", "quotes.write"])
TW = d["secret"]
err, m = tool(TW, "commit_action", {"planId": pv["planId"]})
check("a plan outlives its token only as a useless row: a new token cannot use it", err, m)

# ── clients ──────────────────────────────────────────────────────────
print("\n== clients ==")
cname = f"MCP Test Client {RUN}"
s, cl0 = http("GET", f"/api/clients/company/{A['id']}", admin)
err, pc1 = tool(TW, "prepare_client", {"companyId": A["id"], "name": cname, "phone": "0300-1234567", "registrationType": "Unregistered"})
check("prepare_client returns a plan and creates nothing", not err and pc1["saved"] is False and cname in pc1["summary"], pc1)
s, cl1 = http("GET", f"/api/clients/company/{A['id']}", admin)
check("no client exists yet", len(cl1) == len(cl0), (len(cl0), len(cl1)))
err, m = tool(TC, "commit_action", {"planId": pc1["planId"]})
check("another agent cannot commit the plan", err, m)
err, cc = tool(TW, "commit_action", {"planId": pc1["planId"]})
check("commit creates the client", not err and cc["resultRef"].startswith("Client:"), cc)
cid = int(cc["resultRef"].split(":")[1])
s, cl2 = http("GET", f"/api/clients/company/{A['id']}", admin)
row = next((c for c in cl2 if c["id"] == cid), None)
check("the client exists in the right company with the given fields", row and row["name"] == cname and row["companyId"] == A["id"] and row["phone"] == "0300-1234567" and row["registrationType"] == "Unregistered", row)
err, m = tool(TW, "prepare_client", {"companyId": A["id"], "name": cname.upper()})
check("a duplicate name is refused at prepare (case-insensitively)", err and "already exists" in m, m)
err, pu = tool(TW, "prepare_client", {"companyId": A["id"], "clientId": cid, "phone": "0321-7654321"})
check("an update plan names the client", not err and f"#{cid}" in pu["summary"], pu)
err, cu = tool(TW, "commit_action", {"planId": pu["planId"]})
s, cl3 = http("GET", f"/api/clients/company/{A['id']}", admin)
row = next(c for c in cl3 if c["id"] == cid)
check("update changes only the field given", not err and row["phone"] == "0321-7654321" and row["name"] == cname and row["registrationType"] == "Unregistered", row)
err, m = tool(TW, "prepare_client", {"companyId": B["id"], "clientId": cid, "phone": "1"})
check("a client of company A cannot be edited through company B", err, m)
err, m = tool(TW, "prepare_client", {"companyId": A["id"], "clientId": B["client"], "phone": "1"})
check("a client of company B cannot be edited through company A", err, m)
for label, extra in (("bad registration type", {"registrationType": "Maybe"}), ("bad email", {"email": "nobody"}), ("overlong name", {"name": "n" * 201}), ("no name on create", {"name": None})):
    a = {"companyId": A["id"], "name": f"x{RUN}", **extra}
    if extra.get("name", 1) is None:
        a = {"companyId": A["id"]}
    err, m = tool(TW, "prepare_client", a)
    check(f"{label} refused", err, m)
err, m = tool(TC, "prepare_client", {"companyId": B["id"], "name": f"x{RUN}"})
check("a token limited to company A cannot create a client in B", err, m)
err, pcc = tool(TC, "prepare_client", {"companyId": A["id"], "name": f"MCP Clients-Only {RUN}"})
err, ccc = tool(TC, "commit_action", {"planId": pcc["planId"]})
check("the clients-only token can create a client", not err and ccc["resultRef"].startswith("Client:"), ccc)
made_clients = [cid, int(ccc["resultRef"].split(":")[1])]

# ── activity log ─────────────────────────────────────────────────────
print("\n== activity log ==")
uid_q = "&userId=" + str(uids["mcpw_w"])


def feed(extra):
    return http("GET", "/api/mcp-admin/activity?pageSize=100" + uid_q + extra, admin)[1]["items"]


commits = feed("&tool=commit_action&outcome=ok")
preps = feed("&tool=prepare_quote&outcome=ok")
denied_preps = feed("&tool=prepare_quote&outcome=denied")
everything = feed("")
blob = json.dumps(commits + preps + denied_preps + everything)
check("commit rows carry the document they produced", any(r["resultRef"] == f"SalesQuote:{qid}" for r in commits), [r["resultRef"] for r in commits])
check("commit rows describe what happened", any("Created quotation" in r["detail"] for r in commits), [r["detail"] for r in commits])
check("prepare rows are logged with their arguments", any("MCP test widget" in r["arguments"] for r in preps), len(preps))
check("refused writes are logged as denied with a reason", len(denied_preps) > 0 and all(r["detail"] for r in denied_preps), len(denied_preps))
check("a refused write has no result reference", all(r["resultRef"] == "" for r in denied_preps))
check("refused commits are logged too", len(feed("&tool=commit_action&outcome=denied")) >= 3)
check("no agent secret appears anywhere in the log", TW not in blob and TW2 not in blob and TRO not in blob)

# ── sign-in connect carries scopes too ───────────────────────────────
print("\n== sign-in connect: scopes ==")
REDIR = "http://127.0.0.1:8976/callback"
s, reg = http("POST", "/oauth/register", body={"client_name": f"WriteTest {RUN}", "redirect_uris": [REDIR]})
CID = reg["client_id"]
verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).decode().rstrip("=")
chal = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")


def consent(user_token, scopes, cids):
    return http("POST", "/api/oauth/authorize", user_token, {"clientId": CID, "redirectUri": REDIR, "state": "s", "codeChallenge": chal,
                "codeChallengeMethod": "S256", "companyIds": cids, "scopes": scopes})


s, d = consent(R, ["read", "quotes.write"], [A["id"]])
check("a user without MCP Write cannot approve a write connection", s == 400, f"{s} {d}")
s, d = consent(W, ["read", "invoices.write"], [A["id"]])
check("a scope that does not exist cannot be approved", s == 400, f"{s} {d}")
s, d = consent(W, ["read", "quotes.write"], [A["id"]])
check("an eligible user approves read + quotes.write", s == 200, f"{s} {d}")
code = urllib.parse.parse_qs(urllib.parse.urlparse(d["redirectUrl"]).query)["code"][0]
s, tk = http("POST", "/oauth/token", form={"grant_type": "authorization_code", "code": code, "code_verifier": verifier, "client_id": CID, "redirect_uri": REDIR})
check("the connection's scope is read + quotes.write", s == 200 and set(tk["scope"].split(",")) == {"read", "quotes.write"}, tk)
names = tool_names(tk["access_token"])
check("it sees prepare_quote but not prepare_client", "prepare_quote" in names and "prepare_client" not in names and "commit_action" in names, names)
err, po = tool(tk["access_token"], "prepare_quote", {**Q, "idempotencyKey": f"oauth-{RUN}"})
err, co = tool(tk["access_token"], "commit_action", {"planId": po["planId"]})
check("a sign-in connection can prepare and commit a quotation", not err and co["resultRef"].startswith("SalesQuote:"), co)
made_quotes.append(int(co["resultRef"].split(":")[1]))

# ── result ───────────────────────────────────────────────────────────
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
if fails:
    print("FAILED - throwaway users and documents kept for inspection:")
    for n, _, dtl in fails:
        print(f"  - {n}: {dtl}")
    sys.exit(1)
# Clean up what the test created: newest quotations first (only the latest is deletable), then clients, then users.
for q_id in sorted(made_quotes, reverse=True):
    http("DELETE", f"/api/salesquotes/{q_id}", admin)
for c_id in made_clients:
    http("DELETE", f"/api/clients/{c_id}", admin)
for name in ("mcpw_c", "mcpw_w", "mcpw_r", "mcpw_ta"):
    http("DELETE", f"/api/users/{uids[name]}", admin)
s, roles = http("GET", "/api/roles", admin)
for r in roles or []:
    if r["name"].startswith("mcpw-"):
        http("DELETE", f"/api/roles/{r['id']}", admin)
print("all checks passed")
