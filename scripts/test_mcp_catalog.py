"""Dedicated MCP grant ceiling, self preferences, management isolation and live revocation."""
import argparse
import sys
from mcp_catalog_fixture import LocalCatalogFixture


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:5134")
    args = parser.parse_args()
    f = LocalCatalogFixture(args.base)
    checks = []

    def check(label, passed):
        checks.append(bool(passed))
        print(("PASS " if passed else "FAIL ") + label, flush=True)

    try:
        companies = f.require(*f.http("GET", "/api/companies", f.admin))
        if len(companies) < 2:
            print("SKIP: two local companies and one customer required")
            return 2
        selected = None
        for company in companies:
            clients = f.ok(f.admin, "search_clients", companyId=company["id"], limit=1)["items"]
            if clients:
                selected = company["id"], clients[0]["id"]
                break
        if selected is None:
            print("SKIP: one existing local customer required")
            return 2
        own, client_id = selected
        other = next(c["id"] for c in companies if c["id"] != own)
        system = {r["name"]: r["id"] for r in f.require(*f.http("GET", "/api/roles", f.admin)) if r.get("isSystemRole")}
        base_roles = [system[n] for n in ("Complete Edition", "MCP Access", "MCP Write")]
        admin_roles = base_roles + [system["Tenant Administrator"]]
        aid, admin_a = f.user(f.admin, "admina", admin_roles, [own], True)
        _, admin_b = f.user(f.admin, "adminb", admin_roles, [other], True)
        uid, worker = f.user(admin_a, "worker", base_roles, [own])
        allowed = ["search_clients", "search_quotes", "get_quote", "prepare_quote"]
        f.save(f.admin, aid, accessGranted=True, writesGranted=True, grantedTools=allowed, selectedTools=allowed)
        f.restore[aid] = f.body(f.profile(f.admin, aid))
        f.save(f.admin, uid, accessGranted=False, writesGranted=False, grantedTools=[], selectedTools=[])
        denied_profile = f.profile(worker, uid)
        check("regular user cannot self-grant MCP access", f.http("PUT", f"/api/mcp/catalog/{uid}", worker,
              f.body(denied_profile, accessGranted=True, grantedTools=["search_clients"], selectedTools=["search_clients"]))[0] == 403)
        granted = f.save(admin_a, uid, accessGranted=True, writesGranted=True, grantedTools=allowed, selectedTools=allowed)
        f.restore[uid] = f.body(granted)
        check("administrator grants own effective tools to descendant", granted["accessGranted"] and granted["canManageGrants"])
        check("sibling administrator cannot read worker catalog", f.http("GET", f"/api/mcp/catalog/{uid}", admin_b)[0] == 404)
        check("sibling administrator cannot change worker catalog", f.http("PUT", f"/api/mcp/catalog/{uid}", admin_b, f.body(granted))[0] == 404)
        check("administrator cannot grant outside own MCP ceiling", f.http("PUT", f"/api/mcp/catalog/{uid}", admin_a,
              f.body(granted, grantedTools=allowed + ["get_stock"], selectedTools=allowed + ["get_stock"]))[0] == 403)
        check("regular user cannot expand administrator grants", f.http("PUT", f"/api/mcp/catalog/{uid}", worker,
              f.body(f.profile(worker, uid), grantedTools=allowed + ["get_stock"]))[0] == 403)
        writer = f.token(worker, [own], ["read", "quotes.write"])
        check("agent credential cannot read catalog administration", f.http("GET", f"/api/mcp/catalog/{uid}", writer)[0] == 401)
        check("agent credential cannot edit catalog", f.http("PUT", f"/api/mcp/catalog/{uid}", writer, f.body(granted))[0] == 401)
        check("dedicated grant filters discovered tools", "get_stock" not in f.tool_names(writer) and "prepare_quote" in f.tool_names(writer))
        check("direct ungranted tool denied", f.call(writer, "get_stock", companyId=own)[0])
        stale = f.body(f.profile(worker, uid))
        narrowed = f.save(worker, uid, selectedTools=[n for n in allowed if n != "search_clients"])
        check("self can narrow selected tools", not next(t for t in narrowed["tools"] if t["name"] == "search_clients")["effective"])
        check("selected-tool change revokes discovery immediately", "search_clients" not in f.tool_names(writer))
        check("selected-tool change revokes direct call immediately", f.call(writer, "search_clients", companyId=own)[0])
        check("stale revision refused", f.http("PUT", f"/api/mcp/catalog/{uid}", worker, stale)[0] == 409)
        f.save(worker, uid, selectedTools=allowed)
        request = dict(companyId=own, clientId=client_id, gstRate=17,
                       items=[{"description": "Local catalog fixture", "unit": "Pcs", "quantity": 2, "unitPrice": 100}],
                       idempotencyKey="catalog-quote-" + f.run)
        plan = f.ok(writer, "prepare_quote", **request)["planId"]
        f.plans.append((writer, plan))
        f.save(worker, uid, selectedTools=[n for n in allowed if n != "prepare_quote"])
        check("disabled prepare tool disappears", "prepare_quote" not in f.tool_names(writer))
        check("prior prepare replay denied after disabling tool", f.call(writer, "prepare_quote", **request)[0])
        check("prepared commit denied after disabling original tool", f.call(writer, "commit_action", planId=plan)[0])
        status = f.require(*f.http("GET", "/api/mcp/me/status", worker))
        check("token scopes follow effective selected tools", "quotes.write" not in status["scopesAvailable"])
        check("new quote write token refused after narrowing", f.http("POST", "/api/mcp/me/tokens", worker,
              {"name": "Local refused", "companyIds": [own], "scopes": ["read", "quotes.write"], "expiresInDays": 1})[0] == 400)
        f.save(worker, uid, selectedTools=allowed)
        replay = f.ok(writer, "prepare_quote", **request)
        check("restored tool returns same prepared plan", replay["planId"] == plan)
        committed = f.ok(writer, "commit_action", planId=plan)
        if not committed["resultRef"].startswith("SalesQuote:"):
            raise RuntimeError("Unexpected quotation result reference")
        f.quotes.append(int(committed["resultRef"].split(":")[1]))
        check("restored tool permits original approved commit", committed["committed"] and f.ok(writer, "get_action_status", planId=plan)["status"] == "succeeded")
        role_state = f.require(*f.http("GET", f"/api/users/{uid}/roles", admin_a))
        role_ids = [r["id"] for r in role_state["roles"]]
        before_role_save = f.profile(worker, uid)
        f.save(admin_a, aid, accessEnabled=False)
        role_save_status, role_save_response = f.http("PUT", f"/api/users/{uid}/roles", admin_a, {"roleIds": role_ids})
        if role_save_status != 200:
            print("Role save refused: " + str(role_save_response.get("message", "No message")), flush=True)
        f.require(role_save_status, role_save_response)
        updated_roles = f.require(*f.http("GET", f"/api/users/{uid}/roles", admin_a))
        check("paused administrator preserves hidden MCP roles on ordinary role save", {r["id"] for r in updated_roles["roles"]} == set(role_ids))
        f.save(admin_a, aid, accessEnabled=True)
        check("ordinary role save preserves dedicated MCP profile", f.profile(worker, uid)["revision"] == before_role_save["revision"])
        hidden_ids = [system["MCP Access"], system["MCP Write"]]
        f.require(*f.http("PUT", f"/api/users/{uid}/roles", admin_a, {"roleIds": hidden_ids}))
        check("normal business permissions remain a ceiling", f.call(writer, "get_quote", companyId=own, quoteId=f.quotes[-1])[0])
        check("product role removal keeps dedicated grants unchanged", f.profile(worker, uid)["revision"] == before_role_save["revision"])
        f.require(*f.http("PUT", f"/api/users/{uid}/roles", admin_a, {"roleIds": role_ids}))
        revoke_while_disabled = f.token(worker, [own])
        revoke_id = f.tokens[-1][1]
        f.save(worker, uid, accessEnabled=False)
        check("self can disable MCP while retaining profile access", f.profile(worker, uid)["accessEnabled"] is False)
        check("disabled MCP rejects existing agent immediately", f.call(writer, "get_mcp_capabilities")[0])
        check("disabled user may revoke own existing token", f.http("POST", f"/api/mcp/me/tokens/{revoke_id}/revoke", worker)[0] == 200)
        f.save(worker, uid, accessEnabled=True)
        check("self can restore existing grant without escalation", not f.call(writer, "get_mcp_capabilities")[0])
        seed_all = f.token(f.admin, [], all_companies=True)
        seed_one = f.token(f.admin, [own])
        check("seed All companies preserved", set(f.ok(seed_all, "get_mcp_capabilities")["companyIds"]) == {c["id"] for c in companies})
        check("restricted seed token stays restricted", f.ok(seed_one, "get_mcp_capabilities")["companyIds"] == [own])
    finally:
        f.cleanup()
    print(f"{sum(checks)}/{len(checks)} checks passed")
    return 0 if all(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
