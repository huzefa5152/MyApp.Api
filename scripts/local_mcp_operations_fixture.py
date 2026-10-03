"""Create uniquely owned local fixtures, run operation contracts, clean own IDs.

Loopback only. No SQL, FBR calls, production access, or broad prefix cleanup.
Credentials remain in memory and are never printed. Failed runs retain fixtures
and print only their nonsecret IDs for inspection.
"""
import argparse
import json
import os
import secrets
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:5134")
    parser.add_argument("--cleanup-companies", default="")
    parser.add_argument("--cleanup-users", default="")
    parser.add_argument("--cleanup-roles", default="")
    parser.add_argument("--cleanup-tokens", default="")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    if urlparse(base).hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise SystemExit("Refused: local fixtures require loopback.")
    tag = "mcpops_" + secrets.token_hex(5)
    password = secrets.token_urlsafe(18)
    users, companies, tokens, roles = [], [], [], []

    def http(method, path, token=None, body=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        try:
            with urlopen(Request(base + path, None if body is None else json.dumps(body).encode(), headers, method=method), timeout=90) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except HTTPError as error:
            return error.code, None

    def must(method, path, token=None, body=None):
        status, result = http(method, path, token, body)
        if status not in (200, 201, 204):
            raise RuntimeError(f"Fixture request failed: {method} {path}: HTTP {status}")
        return result

    def login(name, pw):
        return must("POST", "/api/auth/login", body={"username": name, "password": pw})["token"]

    admin = login(os.environ.get("MYAPP_TEST_ADMIN_USER", "admin"), os.environ.get("MYAPP_TEST_ADMIN_PASSWORD", "admin123"))
    if any((args.cleanup_companies, args.cleanup_users, args.cleanup_roles, args.cleanup_tokens)):
        requests = [
            (args.cleanup_tokens, "/api/mcp-admin/tokens", "name", lambda ident: ("POST", f"/api/mcp-admin/tokens/{ident}/revoke")),
            (args.cleanup_users, "/api/users", "username", lambda ident: ("DELETE", f"/api/users/{ident}")),
            (args.cleanup_roles, "/api/roles", "name", lambda ident: ("DELETE", f"/api/roles/{ident}")),
            (args.cleanup_companies, "/api/companies", "name", lambda ident: ("DELETE", f"/api/companies/{ident}")),
        ]
        approved = []
        for selected, route, key, action in requests:
            ids = [int(value) for value in selected.split(",") if value]
            rows = {row["id"]: row for row in must("GET", route, admin)} if ids else {}
            for ident in ids:
                if ident not in rows or not rows[ident].get(key, "").startswith("mcpops_"):
                    raise SystemExit("Refused cleanup: recorded ID does not identify an operation fixture.")
                approved.append(action(ident))
        for method, route in approved:
            must(method, route, admin)
        print("Selected recorded local fixture IDs cleaned.")
        return
    system_roles = {r["name"]: r["id"] for r in must("GET", "/api/roles", admin) if r.get("isSystemRole")}

    def user(creator, suffix, role_ids, cids, role="User"):
        name = tag + "_" + suffix
        row = must("POST", "/api/users", creator, {"username": name, "password": password, "fullName": name, "role": role})
        users.append(row["id"])
        # Seed assigns edition system roles; ordinary management remains in the tenant tree.
        must("PUT", f"/api/users/{row['id']}/roles", admin, {"roleIds": role_ids})
        must("PUT", f"/api/usercompanies/user/{row['id']}", creator, {"companyIds": cids})
        return login(name, password), row["id"]

    def token(owner, suffix, cid):
        result = must("POST", "/api/mcp/me/tokens", owner, {"name": tag + "_" + suffix, "companyIds": [cid], "scopes": ["read"], "expiresInDays": 1})
        tokens.append(result["id"])
        return result["secret"]

    success = False
    try:
        today = (datetime.now(timezone.utc) + timedelta(hours=5)).date().isoformat()
        for suffix in ("A", "B"):
            company = must("POST", "/api/companies", admin, {"name": tag + "_" + suffix})
            cid = company["id"]
            companies.append(cid)
            client = must("POST", "/api/clients", admin, {"companyId": cid, "name": tag + "_client_" + suffix, "registrationType": "Unregistered"})
            supplier = must("POST", "/api/suppliers", admin, {"companyId": cid, "name": tag + "_supplier_" + suffix})
            lines = [{"description": "Sample line " + str(qty), "quantity": qty, "unit": "Pcs", "unitPrice": 10} for qty in (2, 3, 4)]
            must("POST", f"/api/salesquotes/company/{cid}", admin, {"companyId": cid, "clientId": client["id"], "date": today, "gstRate": 17, "items": lines})
            must("POST", f"/api/salesorders/company/{cid}", admin, {"companyId": cid, "clientId": client["id"], "orderDate": today, "items": lines})
            must("POST", "/api/purchasebills", admin, {"companyId": cid, "supplierId": supplier["id"], "date": today, "gstRate": 17, "withholdingTaxRate": 5.5, "items": [{"description": "Sample purchase", "quantity": 2, "uom": "Pcs", "unitPrice": 10}]})

        tenant, tenant_id = user(admin, "tenant", [system_roles["Tenant Administrator"], system_roles["Complete Edition"], system_roles["MCP Access"]], [companies[0]], "Administrator")
        worker, _ = user(tenant, "worker", [system_roles["Complete Edition"], system_roles["MCP Access"]], [companies[0]])
        limited_role = must("POST", "/api/roles", tenant, {"name": tag + "_denied", "description": "Local MCP negative fixture", "permissionKeys": ["mcp.access.use"]})
        roles.append(limited_role["id"])
        name = tag + "_denied"
        denied_row = must("POST", "/api/users", tenant, {"username": name, "password": password, "fullName": name, "role": "User"})
        users.append(denied_row["id"])
        # Custom role belongs to the tenant administrator, not the seed admin.
        must("PUT", f"/api/users/{denied_row['id']}/roles", tenant, {"roleIds": [limited_role["id"]]})
        must("PUT", f"/api/usercompanies/user/{denied_row['id']}", tenant, {"companyIds": [companies[0]]})
        denied = login(name, password)
        variables = {"ADMIN_JWT": admin, "USER_TOKEN": token(worker, "worker_token", companies[0]), "DENIED_TOKEN": token(denied, "denied_token", companies[0]), "SEED_RESTRICTED_TOKEN": token(admin, "seed_token", companies[0]), "COMPANY_A": str(companies[0]), "COMPANY_B": str(companies[1])}
        env = os.environ.copy()
        env.update({"MCP_OPS_" + key: value for key, value in variables.items()})
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("test_mcp_operations.py")), "--base", base], env=env)
        success = result.returncode == 0
        if not success:
            raise SystemExit(result.returncode)
    finally:
        if success:
            for tid in tokens:
                must("POST", f"/api/mcp-admin/tokens/{tid}/revoke", admin)
            for uid in reversed(users):
                must("DELETE", f"/api/users/{uid}", admin)
            for rid in roles:
                must("DELETE", f"/api/roles/{rid}", admin)
            for cid in reversed(companies):
                must("DELETE", f"/api/companies/{cid}", admin)
            print("Owned local operation fixtures cleaned.")
        else:
            print("Local operation fixtures retained:", {"companies": companies, "users": users, "roles": roles, "tokenIds": tokens})


if __name__ == "__main__":
    main()
