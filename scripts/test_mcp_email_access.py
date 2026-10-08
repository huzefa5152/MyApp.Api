"""Real HTTP MCP email authorization checks. Run only against an approved disposable local host.

Creates synthetic companies, users, roles and tokens; no Gmail requests or real email access.
SQL-backed MCP email conversion, prices and revision tests live in McpEmailTests.cs.
Usage: python scripts/test_mcp_email_access.py --base http://localhost:5161
"""
import argparse
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--base", required=True)
base = parser.parse_args().base.rstrip("/")
assert urllib.parse.urlparse(base).hostname in {"localhost", "127.0.0.1", "::1"}, "Use an approved disposable local host."
tag = "mcp-email-" + secrets.token_hex(4)
checks = []
companies, users, roles = [], [], []


def http(method, path, token=None, body=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        text = response.read().decode()
        return response.code, json.loads(text) if text.startswith(("{", "[")) else text


def ok(name, condition):
    checks.append(bool(condition))
    print(("PASS " if condition else "FAIL ") + name, flush=True)


def login(name, password):
    status, data = http("POST", "/api/auth/login", body={"username": name, "password": password})
    assert status == 200, "Login failed; use a disposable local host and respect its login limit."
    return data["token"]


def rpc(token, method, parameters=None):
    return http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": 1, "method": method, "params": parameters or {}})


def tool(token, name, arguments):
    status, data = rpc(token, "tools/call", {"name": name, "arguments": arguments})
    if status != 200 or "error" in data:
        return True, None
    result = data["result"]
    return result.get("isError", False), result["content"][0]["text"]


def names(token):
    status, data = rpc(token, "tools/list")
    assert status == 200
    return {t["name"] for t in data["result"]["tools"]}


admin = login("admin", "admin123")
try:
    for suffix in ("A", "B"):
        status, company = http("POST", "/api/companies", admin, {"name": tag + suffix})
        assert status in (200, 201)
        companies.append(company["id"])
    status, definitions = http("GET", "/api/roles", admin)
    system = {r["name"]: r["id"] for r in definitions if r.get("isSystemRole")}
    password = "SampleMcp123!"
    status, user = http("POST", "/api/users", admin, {"username": tag, "password": password, "fullName": "Sample MCP Operator", "role": "User"})
    assert status in (200, 201)
    uid = user["id"]; users.append(uid)
    business_roles = [system["Sales Edition"], system["MCP Access"], system["MCP Write"]]
    assert http("PUT", f"/api/users/{uid}/roles", admin, {"roleIds": business_roles})[0] == 200
    assert http("PUT", f"/api/usercompanies/user/{uid}", admin, {"companyIds": companies})[0] == 200
    jwt = login(tag, password)
    email_tools = {"search_email_enquiries", "get_email_enquiry", "prepare_email_decision", "prepare_email_quotation"}
    ok("no Email Workspace assignment hides email tools", not names(jwt).intersection(email_tools))
    status, eligibility = http("GET", "/api/mcp/me/status", jwt)
    ok("email decision scope absent without module", "email.enquiries.write" not in eligibility["scopesAvailable"])
    all_roles = business_roles + [system["Email Workspace"]]
    assert http("PUT", f"/api/users/{uid}/roles", admin, {"roleIds": all_roles})[0] == 200
    status, eligibility = http("GET", "/api/mcp/me/status", jwt)
    ok("module plus actions offers email scope", "email.enquiries.write" in eligibility["scopesAvailable"])
    status, issued = http("POST", "/api/mcp/me/tokens", jwt, {"name": tag, "companyIds": [companies[0]], "scopes": ["read", "quotes.write", "email.enquiries.write"], "expiresInDays": 1})
    assert status == 200
    token, tid = issued["secret"], issued["id"]
    ok("assigned tools discovered by scoped agent", email_tools <= names(token))
    ok("ordinary login remains read-only", not {"prepare_email_decision", "prepare_email_quotation"}.intersection(names(jwt)))
    error, text = tool(token, "search_email_enquiries", {"companyId": companies[0]})
    ok("own inbox readable with module", not error and json.loads(text)["totalCount"] == 0)
    for name in sorted(email_tools):
        args = {"companyId": companies[1], "messageId": 1, "revision": None, "decision": "Kept", "prices": []}
        allowed = {"search_email_enquiries": ["companyId"], "get_email_enquiry": ["companyId", "messageId"],
                   "prepare_email_decision": ["companyId", "messageId", "revision", "decision"], "prepare_email_quotation": ["companyId", "messageId", "revision", "prices"]}[name]
        ok(name + " rejects company beyond token", tool(token, name, {k: args[k] for k in allowed})[0])
    assert http("PUT", f"/api/usercompanies/user/{uid}", admin, {"companyIds": [companies[1]]})[0] == 200
    ok("removing owner company access takes effect next request", tool(token, "search_email_enquiries", {"companyId": companies[0]})[0])
    assert http("PUT", f"/api/usercompanies/user/{uid}", admin, {"companyIds": companies})[0] == 200
    status, catalog = http("GET", f"/api/mcp/catalog/{uid}", admin)
    granted = [t["name"] for t in catalog["tools"] if t["configurable"] and t["eligible"]]
    assert http("PUT", f"/api/mcp/catalog/{uid}", admin, {"revision": catalog["revision"], "accessGranted": True, "writesGranted": True,
        "accessEnabled": True, "writesEnabled": True, "grantedTools": granted, "selectedTools": [n for n in granted if n != "search_email_enquiries"]})[0] == 200
    ok("individual tool deselection immediately hides and denies", "search_email_enquiries" not in names(token) and tool(token, "search_email_enquiries", {"companyId": companies[0]})[0])
    assert http("PUT", f"/api/users/{uid}/roles", admin, {"roleIds": business_roles})[0] == 200
    ok("module revocation hides all email tools on existing token", not names(token).intersection(email_tools))
    ok("module revocation denies direct read", tool(token, "get_email_enquiry", {"companyId": companies[0], "messageId": 1})[0])
    assert http("POST", f"/api/mcp/me/tokens/{tid}/revoke", jwt)[0] == 200
    ok("revoked token cannot authenticate", rpc(token, "ping")[0] == 401)
    status, metadata = http("GET", "/.well-known/oauth-authorization-server")
    ok("OAuth discovery advertises separate email scope", status == 200 and "email.enquiries.write" in metadata["scopes_supported"])
    ok("anonymous MCP needs OAuth authentication", rpc(None, "ping")[0] == 401)
finally:
    for uid in users:
        http("DELETE", f"/api/users/{uid}", admin)
    for cid in companies:
        http("DELETE", f"/api/companies/{cid}", admin)
print(f"{sum(checks)}/{len(checks)} checks passed")
raise SystemExit(0 if all(checks) else 1)
