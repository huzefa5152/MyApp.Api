"""Local-only onboarding MCP contracts and access isolation; creates test users/tokens.

Run against an already running local backend. Never accepts a remote host.
"""
import argparse
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:5134")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    url = urllib.parse.urlparse(base)
    if url.hostname not in {"localhost", "127.0.0.1", "::1"} or url.scheme not in {"http", "https"}:
        parser.error("This suite creates local test accounts and only permits loopback hosts.")
    checks, users, roles, token_ids = [], [], [], []
    run = secrets.token_hex(4)
    password = "LocalTest!" + secrets.token_hex(8)

    def http(method, path, token=None, body=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(base + path, headers=headers, method=method,
                                        data=None if body is None else json.dumps(body).encode())
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read() or b"null")
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw)
            except ValueError:
                return error.code, None

    def require(status, result, accepted=(200,)):
        if status not in accepted:
            raise RuntimeError("Test setup/request failed with HTTP " + str(status))
        return result

    def check(label, value):
        checks.append(bool(value))
        print(("PASS " if value else "FAIL ") + label)

    def login(name, pw):
        return require(*http("POST", "/api/auth/login", body={"username": name, "password": pw}))["token"]

    def call(token, name, company, **extra):
        status, data = http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                                   "params": {"name": name, "arguments": {"companyId": company, **extra}}})
        if status != 200 or "error" in data:
            return True, None
        result = data["result"]
        if result.get("isError"):
            return True, None
        return False, json.loads(result["content"][0]["text"])

    admin = login(os.environ.get("MYAPP_TEST_ADMIN_USER", "admin"), os.environ.get("MYAPP_TEST_ADMIN_PASSWORD", "admin123"))
    companies = require(*http("GET", "/api/companies", admin))
    if len(companies) < 2:
        print("SKIP: two local companies required")
        return 2
    own, other = companies[0]["id"], companies[1]["id"]
    system_roles = {r["name"]: r["id"] for r in require(*http("GET", "/api/roles", admin)) if r.get("isSystemRole")}

    def make_user(label, role_ids, role="User", creator=None):
        creator = creator or admin
        name = "mcpon_" + run + "_" + label
        user = require(*http("POST", "/api/users", creator, {"username": name, "password": password, "fullName": "Local onboarding test", "role": role}), accepted=(200, 201))
        users.append(user["id"])
        require(*http("PUT", f"/api/users/{user['id']}/roles", creator, {"roleIds": role_ids}))
        require(*http("PUT", f"/api/usercompanies/user/{user['id']}", creator, {"companyIds": [own]}))
        return user["id"], login(name, password)

    def make_token(owner, label, all_companies=False):
        response = require(*http("POST", "/api/mcp/me/tokens", owner, {"name": "onboarding-test-" + run + label,
                                  "companyIds": [] if all_companies else [own], "allCompanies": all_companies,
                                  "scopes": ["read"], "expiresInDays": 1}))
        token_ids.append((owner, response["id"]))
        return response["secret"]

    try:
        seed_all = make_token(admin, "all", True)
        seed_restricted = make_token(admin, "restricted")
        _, tenant = make_user("tenant", [system_roles["Tenant Administrator"], system_roles["Sales Edition"], system_roles["MCP Access"]], "Administrator")
        _, staff = make_user("staff", [system_roles["Sales Edition"], system_roles["MCP Access"]])
        custom = require(*http("POST", "/api/roles", tenant, {"name": "onboarding-test-" + run,
                         "description": "Local onboarding contract test", "permissionKeys": ["mcp.access.use", "onboarding.import.run", "itemtypes.manage.create"]}), accepted=(200, 201))
        roles.append(custom["id"])
        limited_id, limited = make_user("limited", [custom["id"]], creator=tenant)
        for tool in ("get_onboarding_schema", "get_company_onboarding_status"):
            for label, token in (("seed all", seed_all), ("seed restricted", seed_restricted), ("tenant", tenant), ("staff", staff)):
                err, data = call(token, tool, own)
                check(label + " own " + tool, not err and data["companyId"] == own)
                err, _ = call(token, tool, other)
                check(label + " other " + tool, not err if label == "seed all" else err)
        err, schema = call(seed_all, "get_onboarding_schema", own)
        check("canonical four sheets", not err and {s["key"] for s in schema["sheets"]} == {"customers", "suppliers", "items", "openingStock"})
        customers = next(s for s in schema["sheets"] if s["key"] == "customers")
        fields = {c["key"]: c for c in customers["columns"]}
        check("canonical identifier and requirement contract", fields["cnic"]["kind"] == "identifier" and fields["name"]["requirement"] == "required" and "email" not in fields)
        check("canonical row limit", schema["maxRowsPerSheet"] == 5000)
        err, full_status = call(seed_all, "get_company_onboarding_status", own)
        serialized = json.dumps(full_status).lower()
        check("status omits secrets and tax identifier values", not err and all('"' + key + '"' not in serialized for key in ("fbrtoken", "ntn", "cnic", "strn", "fbrsellerregistrationno")))
        check("unknown sheet denied", call(seed_all, "get_onboarding_schema", own, sheets="customers,unknown")[0])
        err, data = call(limited, "get_onboarding_schema", own)
        check("unrequested forbidden sheets omitted", not err and [s["key"] for s in data["sheets"]] == ["items"])
        check("explicit forbidden sheet denied", call(limited, "get_onboarding_schema", own, sheets="customers")[0])
        err, status = call(limited, "get_company_onboarding_status", own)
        check("unauthorized status sections unavailable", not err and not status["sections"] and "fbrConnection" in status["unavailableSections"])
        check("financial openings explicitly unsupported", not err and status["financialOpeningImportSupported"] is False)
        require(*http("PUT", f"/api/usercompanies/user/{limited_id}", admin, {"companyIds": []}))
        check("revoked company grant denied", call(limited, "get_onboarding_schema", own)[0])
        require(*http("PUT", f"/api/usercompanies/user/{limited_id}", admin, {"companyIds": [own]}))
        require(*http("PUT", f"/api/users/{limited_id}/roles", admin, {"roleIds": [system_roles["MCP Access"]]}))
        check("revoked import permission denied", call(limited, "get_onboarding_schema", own)[0])
    finally:
        for owner, token_id in token_ids:
            http("POST", f"/api/mcp/me/tokens/{token_id}/revoke", owner)
        for user_id in reversed(users):
            http("DELETE", f"/api/users/{user_id}", admin)
        for role_id in roles:
            http("DELETE", f"/api/roles/{role_id}", admin)
    print(f"{sum(checks)}/{len(checks)} checks passed")
    return 0 if all(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
