"""Email Workspace module opt-in, immediate revocation and company HTTP boundaries.
Run only against an approved disposable local database: --base http://localhost:<port>.
Creates and removes synthetic companies/users; never contacts Google.
"""
import argparse
import json
import urllib.request
import urllib.error
import uuid

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--base", required=True)
args = p.parse_args()
base = args.base.rstrip("/")
if not base.startswith(("http://localhost:", "http://127.0.0.1:")):
    raise SystemExit("Disposable local host required")
checks = 0

def http(method, path, token=None, body=None):
    headers = {"Content-Type": "application/json"}
    if token: headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(base + "/api" + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read(); return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: data = json.loads(raw) if raw else None
        except ValueError: data = None
        return e.code, data

def check(ok, label):
    global checks
    assert ok, label
    checks += 1
    print("PASS", label, flush=True)

def login(name, password):
    status, data = http("POST", "/auth/login", body={"username": name, "password": password})
    check(status == 200, "test account login")
    return data["token"]

seed = login("admin", "admin123")
status, roles = http("GET", "/roles", seed)
check(status == 200, "load assignable system roles")
by_name = {r["name"]: r for r in roles if r["isSystemRole"]}
module = by_name["Email Workspace"]
check(set(module["permissionKeys"]) == {"email.workspace.use", "email.inbox.view", "email.inbox.manage", "email.enquiries.manage", "email.connections.manage"}, "optional role carries only module permissions")
for name in ["Administrator", "Sales Edition", "Complete Edition", "Tenant Administrator"]:
    check(not any(k.startswith("email.") for k in by_name[name]["permissionKeys"]), name + " excludes optional email")
users, companies = [], []
suffix = uuid.uuid4().hex[:10]
try:
    for label in ["Own", "Foreign"]:
        status, company = http("POST", "/companies", seed, {"name": "Email module " + label + " " + suffix})
        check(status == 201, "create disposable company")
        companies.append(company)
    own, foreign = [c["id"] for c in companies]
    for label, role_name in [("staff", "Sales Edition"), ("administrator", "Administrator")]:
        username = "email-module-" + label + "-" + suffix
        status, user = http("POST", "/users", seed, {"username": username, "fullName": "Sample email user", "password": "TestOnly123!", "role": "User"})
        check(status == 201, "create existing " + label)
        users.append(user)
        base_roles = [by_name[role_name]["id"]]
        status, _ = http("PUT", f"/users/{user['id']}/roles", seed, {"roleIds": base_roles})
        check(status == 200, "assign core role")
        status, _ = http("PUT", f"/usercompanies/user/{user['id']}", seed, {"companyIds": [own]})
        check(status == 200, "assign only own company")
        token = login(username, "TestOnly123!")
        root = f"/email-workspace/company/{own}"
        for path in ["messages", "connections", "customers"]:
            status, _ = http("GET", root + "/" + path, token)
            check(status == 403, label + " cannot use unassigned module " + path)
        status, _ = http("POST", root + "/oauth/start", token)
        check(status == 403, "unassigned module blocks Gmail authorization")
        status, _ = http("PUT", f"/users/{user['id']}/roles", seed, {"roleIds": base_roles + [module["id"]]})
        check(status == 200, "enable module for existing " + label)
        for path in ["messages", "connections", "customers"]:
            status, _ = http("GET", root + "/" + path, token)
            check(status == 200, "same JWT reaches assigned company " + path)
        foreign_root = f"/email-workspace/company/{foreign}"
        for method, path, body in [("GET", "messages", None), ("GET", "connections", None), ("GET", "customers", None),
            ("POST", "oauth/start", None), ("POST", "connections", {"connectionId": 0}),
            ("POST", "sync/0", None), ("PUT", "connections/0", {"rules": []}), ("DELETE", "connections/0", None),
            ("GET", "messages/0", None), ("PUT", "messages/0/decision", {"decision": "Kept"}),
            ("POST", "messages/0/prepare", {}), ("PUT", "messages/0/draft", {"items": []}),
            ("POST", "messages/0/convert", {"items": []}), ("GET", "messages/0/attachment?attachmentId=x", None)]:
            status, _ = http(method, foreign_root + "/" + path, token, body)
            check(status == 403, "foreign company refuses " + method + " " + path)
        status, _ = http("PUT", f"/users/{user['id']}/roles", seed, {"roleIds": base_roles})
        check(status == 200, "revoke optional module only")
        for method, path in [("GET", "messages"), ("POST", "oauth/start")]:
            status, _ = http(method, root + "/" + path, token)
            check(status == 403, "same JWT immediately loses module access " + path)
    print(f"{checks}/{checks} email module HTTP checks passed")
finally:
    for user in users:
        status, _ = http("DELETE", f"/users/{user['id']}", seed)
        if status != 200: raise RuntimeError("test user cleanup failed")
    for company in companies:
        status, _ = http("DELETE", f"/companies/{company['id']}", seed)
        if status != 204: raise RuntimeError("test company cleanup failed")
