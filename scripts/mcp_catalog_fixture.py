"""Loopback-only fixtures for dedicated MCP catalog integration tests."""
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request


class LocalCatalogFixture:
    def __init__(self, base):
        url = urllib.parse.urlparse(base)
        if url.scheme not in {"http", "https"} or url.hostname not in {"localhost", "127.0.0.1", "::1"} or url.username or url.password:
            raise ValueError("Catalog tests require a loopback backend.")
        self.base, self.run = base.rstrip("/"), secrets.token_hex(4)
        self.password = "LocalCatalog!" + secrets.token_hex(8)
        self.users, self.tokens, self.plans, self.quotes, self.restore = [], [], [], [], {}
        self.admin = self.login(os.environ.get("MYAPP_TEST_ADMIN_USER", "admin"), os.environ.get("MYAPP_TEST_ADMIN_PASSWORD", "admin123"))

    def http(self, method, path, token=None, body=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(self.base + path, method=method, headers=headers,
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

    @staticmethod
    def require(status, data, accepted=(200,)):
        if status not in accepted:
            raise RuntimeError("Local fixture/request failed: HTTP " + str(status))
        return data

    def login(self, user, password):
        for attempt in range(4):
            status, data = self.http("POST", "/api/auth/login", body={"username": user, "password": password})
            if status != 429 or attempt == 3:
                return self.require(status, data)["token"]
            print("Local login throttled; waiting 30 seconds", flush=True)
            time.sleep(30)

    def user(self, creator, suffix, roles, companies, administrator=False):
        name = "mcpcatalog_" + self.run + suffix
        data = self.require(*self.http("POST", "/api/users", creator, {"username": name, "password": self.password,
                             "fullName": "Local MCP catalog fixture", "role": "Administrator" if administrator else "User"}), accepted=(200, 201))
        uid = data["id"]
        self.users.append(uid)
        self.require(*self.http("PUT", f"/api/users/{uid}/roles", creator, {"roleIds": roles}))
        self.require(*self.http("PUT", f"/api/usercompanies/user/{uid}", creator, {"companyIds": companies}))
        return uid, self.login(name, self.password)

    def token(self, owner, companies, scopes=("read",), all_companies=False):
        data = self.require(*self.http("POST", "/api/mcp/me/tokens", owner, {"name": "Local catalog " + self.run,
                            "companyIds": [] if all_companies else companies, "allCompanies": all_companies,
                            "scopes": list(scopes), "expiresInDays": 1}))
        self.tokens.append((owner, data["id"]))
        return data["secret"]

    def rpc(self, token, method, params):
        return self.http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})

    def call(self, token, tool_name, **arguments):
        status, data = self.rpc(token, "tools/call", {"name": tool_name, "arguments": arguments})
        if status != 200 or not isinstance(data, dict) or "error" in data:
            return True, None
        result = data["result"]
        text = result["content"][0]["text"]
        return (True, text) if result.get("isError") else (False, json.loads(text))

    def ok(self, token, tool_name, **arguments):
        error, data = self.call(token, tool_name, **arguments)
        if error:
            raise RuntimeError("Expected successful tool: " + tool_name)
        return data

    def tool_names(self, token):
        data = self.require(*self.rpc(token, "tools/list", {}))
        return {tool["name"] for tool in data["result"]["tools"]}

    def profile(self, actor, uid):
        return self.require(*self.http("GET", f"/api/mcp/catalog/{uid}", actor))

    @staticmethod
    def body(profile, **changes):
        body = {key: profile[key] for key in ("revision", "accessGranted", "writesGranted", "accessEnabled", "writesEnabled")}
        body["grantedTools"] = [t["name"] for t in profile["tools"] if t["configurable"] and t["granted"]]
        body["selectedTools"] = [t["name"] for t in profile["tools"] if t["configurable"] and t["selected"]]
        body.update(changes)
        return body

    def save(self, actor, uid, **changes):
        return self.require(*self.http("PUT", f"/api/mcp/catalog/{uid}", actor, self.body(self.profile(actor, uid), **changes)))

    def cleanup(self):
        failures = []
        for uid, body in self.restore.items():
            try:
                profile = self.profile(self.admin, uid)
                self.require(*self.http("PUT", f"/api/mcp/catalog/{uid}", self.admin, {**body, "revision": profile["revision"]}))
            except Exception:
                failures.append("profile restoration")
        for token, plan in self.plans:
            self.call(token, "cancel_action", planId=plan)
        for quote in reversed(self.quotes):
            if self.http("DELETE", f"/api/salesquotes/{quote}", self.admin)[0] not in (200, 204):
                failures.append("quotation cleanup")
        for owner, tid in self.tokens:
            if self.http("POST", f"/api/mcp/me/tokens/{tid}/revoke", owner)[0] not in (200, 404):
                failures.append("token revocation")
        for uid in reversed(self.users):
            if self.http("DELETE", f"/api/users/{uid}", self.admin)[0] not in (200, 204):
                failures.append("user cleanup")
        if failures:
            raise RuntimeError("Local fixture cleanup needs inspection: " + ", ".join(failures))
