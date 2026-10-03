"""Local-only MCP discovery and exact action status integration contracts."""
import argparse
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
    ap.add_argument("--sql-db", default="MyApp_Trader_Local")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    if urllib.parse.urlparse(base).hostname not in {"localhost", "127.0.0.1", "::1"}:
        ap.error("Only loopback application hosts are allowed.")
    if args.sql_server.split("\\")[0].lower() not in {".", "localhost", "(local)"} or not args.sql_db.endswith("_Local"):
        ap.error("Expiry fixture requires a local SQL instance and a _Local database.")
    run, pw = secrets.token_hex(4), "LocalTest!" + secrets.token_hex(8)
    users, roles, tokens, plans, checks = [], [], [], [], []

    def http(method, path, token=None, body=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(base + path, method=method, headers=headers,
                                     data=None if body is None else json.dumps(body).encode())
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return response.status, json.loads(response.read() or b"null")
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw)
            except ValueError:
                return error.code, None

    def require(status, result, accepted=(200,)):
        if status not in accepted:
            raise RuntimeError("Local fixture/request failed: HTTP " + str(status))
        return result

    def login(name, password):
        for attempt in range(4):
            status, result = http("POST", "/api/auth/login", body={"username": name, "password": password})
            if status != 429 or attempt == 3:
                return require(status, result)["token"]
            print("Local login throttled; waiting 30 seconds", flush=True)
            time.sleep(30)

    def call(token, tool_name, **arguments):
        status, data = http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                                   "params": {"name": tool_name, "arguments": arguments}})
        if status != 200 or not isinstance(data, dict) or "error" in data:
            return True, None
        result = data["result"]
        return (True, result["content"][0]["text"]) if result.get("isError") else (False, json.loads(result["content"][0]["text"]))

    def ok(token, tool_name, **arguments):
        error, data = call(token, tool_name, **arguments)
        if error:
            raise RuntimeError("Expected successful tool: " + tool_name)
        return data

    def check(label, value):
        checks.append(bool(value))
        print(("PASS " if value else "FAIL ") + label, flush=True)

    admin = login(os.environ.get("MYAPP_TEST_ADMIN_USER", "admin"), os.environ.get("MYAPP_TEST_ADMIN_PASSWORD", "admin123"))
    companies = require(*http("GET", "/api/companies", admin))
    if len(companies) < 2:
        print("SKIP: need two local companies")
        return 2
    own, other = companies[0]["id"], companies[1]["id"]
    system = {r["name"]: r["id"] for r in require(*http("GET", "/api/roles", admin)) if r.get("isSystemRole")}

    def user(owner, suffix, role_ids, company_ids, legacy="User"):
        name = "mcpcap_" + run + suffix
        data = require(*http("POST", "/api/users", owner, {"username": name, "password": pw, "fullName": "Local MCP test", "role": legacy}), accepted=(200, 201))
        users.append(data["id"])
        require(*http("PUT", f"/api/users/{data['id']}/roles", owner, {"roleIds": role_ids}))
        require(*http("PUT", f"/api/usercompanies/user/{data['id']}", owner, {"companyIds": company_ids}))
        return data["id"], login(name, pw)

    def token(owner, suffix, scopes, all_companies=False, company_ids=None):
        data = require(*http("POST", "/api/mcp/me/tokens", owner, {"name": "cap-test-" + run + suffix,
                            "companyIds": [] if all_companies else (company_ids or [own]), "allCompanies": all_companies,
                            "scopes": scopes, "expiresInDays": 1}))
        tokens.append((owner, data["id"]))
        return data["secret"]

    def prepare(writer, suffix):
        data = ok(writer, "prepare_client", companyId=own, name="Local status " + run + suffix,
                  phone="00000000000", address="Local fixture address", email="fixture@example.invalid")
        plans.append((writer, data["planId"]))
        return data["planId"]

    try:
        seed_all = token(admin, "all", ["read"], True)
        seed_only = token(admin, "restricted", ["read"])
        all_caps = ok(seed_all, "get_mcp_capabilities")
        restricted = ok(seed_only, "get_mcp_capabilities")
        check("seed all effective company set", all_caps["seedAdmin"] and all_caps["allCompanies"] and set(all_caps["companyIds"]) == {c["id"] for c in companies})
        check("restricted seed preserves company boundary", restricted["seedAdmin"] and not restricted["allCompanies"] and restricted["companyIds"] == [own])
        _, tenant = user(admin, "tenant", [system["Tenant Administrator"], system["Sales Edition"], system["MCP Access"], system["MCP Write"]], [own, other], "Administrator")
        role = require(*http("POST", "/api/roles", tenant, {"name": "cap-test-" + run, "description": "Local fixture",
                       "permissionKeys": ["mcp.access.use", "mcp.write.use", "clients.manage.view", "clients.manage.create", "clients.manage.update"]}), accepted=(200, 201))
        roles.append(role["id"])
        uid, staff = user(tenant, "staff", [role["id"]], [own, other])
        writer = token(staff, "writer", ["read", "clients.write"])
        reader = token(staff, "reader", ["read"])
        foreign = token(staff, "foreign", ["read", "clients.write"])
        multi = token(staff, "multi", ["read", "clients.write"], company_ids=[own, other])
        caps = ok(writer, "get_mcp_capabilities")
        check("tenant effective scope intersects token", not caps["seedAdmin"] and caps["companyIds"] == [own])
        check("writer scope and opt-in exposed", caps["writesEnabled"] and "clients.write" in caps["scopes"] and "prepare_client" in caps["tools"])
        read_caps = ok(reader, "get_mcp_capabilities")
        check("read token cannot discover writes", not read_caps["writesEnabled"] and "prepare_client" not in read_caps["tools"])
        check("plain login remains read-only", not ok(staff, "get_mcp_capabilities")["writesEnabled"])
        status, _ = http("POST", "/api/mcp/me/tokens", staff, {"name": "forbidden", "companyIds": [own], "scopes": ["read", "quotes.write"], "expiresInDays": 1})
        check("unauthorized scope opt-in rejected", status == 400)
        replay_key = "local-company-replay-" + run
        replay_name = "Local guarded replay " + run
        replay_plan = ok(multi, "prepare_client", companyId=own, name=replay_name, idempotencyKey=replay_key)["planId"]
        plans.append((multi, replay_plan))
        error, data = call(multi, "prepare_client", companyId=other, name="Other local fixture " + run, idempotencyKey=replay_key)
        check("idempotency key cannot cross permitted companies", error and replay_name not in str(data) and replay_plan not in str(data))
        require(*http("PUT", f"/api/usercompanies/user/{uid}", tenant, {"companyIds": [other]}))
        error, data = call(multi, "prepare_client", companyId=other, name="Other local fixture " + run, idempotencyKey=replay_key)
        check("revoked original company cannot leak prior plan", error and replay_name not in str(data) and replay_plan not in str(data))
        require(*http("PUT", f"/api/usercompanies/user/{uid}", tenant, {"companyIds": [own, other]}))
        ok(multi, "cancel_action", planId=replay_plan)
        plan = prepare(writer, "prepared")
        state = ok(writer, "get_action_status", planId=plan)
        check("prepared status reflects server", state["status"] == "prepared" and state["companyId"] == own and state["retrySafe"] is False)
        text = json.dumps(state)
        check("status excludes sensitive payload", all(x not in text for x in ("00000000000", "Local fixture address", "fixture@example.invalid", '"payload"')))
        check("foreign token cannot read plan", call(foreign, "get_action_status", planId=plan)[0])
        check("login cannot read agent plan", call(staff, "get_action_status", planId=plan)[0])
        check("unknown plan unavailable", call(writer, "get_action_status", planId="not-a-plan")[0])
        ok(writer, "cancel_action", planId=plan)
        check("cancelled plan unavailable", call(writer, "get_action_status", planId=plan)[0])
        expired = prepare(writer, "expired")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", expired):
            raise RuntimeError("Unexpected plan identifier shape")
        sql = subprocess.run(["sqlcmd", "-S", args.sql_server, "-d", args.sql_db, "-E", "-C", "-N", "-I", "-b", "-Q",
                              "UPDATE McpPendingActions SET ExpiresAt=DATEADD(minute,-1,SYSUTCDATETIME()) WHERE PlanId='" + expired + "' AND CommittedAt IS NULL;"], capture_output=True, text=True)
        if sql.returncode != 0:
            raise RuntimeError("Local expiry fixture SQL failed: " + (sql.stderr or sql.stdout)[:500])
        check("expired status reflects server", ok(writer, "get_action_status", planId=expired)["status"] == "expired")
        check("expired commit refused", call(writer, "commit_action", planId=expired)[0])
        ok(writer, "cancel_action", planId=expired)
        require(*http("PUT", f"/api/users/{uid}/roles", tenant, {"roleIds": [system["MCP Access"]]}))
        revoked = ok(writer, "get_mcp_capabilities")
        check("revoked permissions filter discovery immediately", not revoked["writesEnabled"] and "prepare_client" not in revoked["tools"] and "search_clients" not in revoked["tools"])
        check("revoked write opt-in blocks prepare", call(writer, "prepare_client", companyId=own, name="Local refused " + run)[0])
    finally:
        for writer, plan in plans:
            call(writer, "cancel_action", planId=plan)
        for owner, token_id in tokens:
            http("POST", f"/api/mcp/me/tokens/{token_id}/revoke", owner)
        for uid in reversed(users):
            http("DELETE", f"/api/users/{uid}", admin)
        for rid in roles:
            http("DELETE", f"/api/roles/{rid}", admin)
    print(f"{sum(checks)}/{len(checks)} checks passed")
    return 0 if all(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
