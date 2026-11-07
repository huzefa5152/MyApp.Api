"""The seed admin can stop an account creating or editing companies.

- A locked account loses the company create, edit, delete and FBR token keys,
  and the API refuses those calls.
- An account it creates is locked too.
- Only the seed admin can set or read the lock.
- Unlocking restores the keys.

    python scripts/test_company_lock.py --base http://localhost:5134
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5134")
ap.add_argument("--admin-user", default="admin")
ap.add_argument("--admin-pw", default="admin123")
args = ap.parse_args()
BASE = args.base.rstrip("/")
PASSWORD = "Lock-Test-" + uuid.uuid4().hex[:8] + "!"
KEYS = {"companies.manage.create", "companies.manage.update",
        "companies.manage.delete", "companies.manage.fbrtoken"}
results: list[tuple[str, bool, str]] = []


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else None
        except ValueError:
            return e.code, raw


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)[:200]))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  {str(detail)[:200]}" if not ok else ""))


def login(username, password):
    st, data = call("POST", "/api/auth/login", body={"username": username, "password": password})
    assert st == 200, f"login {username}: {st} {data}"
    return data["token"]


def keys(token):
    st, data = call("GET", "/api/permissions/me", token)
    assert st == 200, f"permissions/me: {st} {data}"
    items = data.get("permissions", data.get("keys", [])) if isinstance(data, dict) else data
    return set(items)


seed = login(args.admin_user, args.admin_pw)
st, roles = call("GET", "/api/roles", seed)
role = next(r for r in roles if r["name"].lower() == "administrator")
st, companies = call("GET", "/api/companies", seed)
company_id = companies[0]["id"]
created = []


def new_user(token, prefix, role_ids=None):
    name = f"{prefix}_{uuid.uuid4().hex[:8]}"
    body = {"username": name, "password": PASSWORD, "fullName": name, "role": role["name"],
            "companyIds": [company_id]}
    if role_ids:
        body["roleIds"] = role_ids
    st, data = call("POST", "/api/users", token, body)
    if st in (200, 201):
        created.append(data["id"])
    return st, data, name


try:
    st, user, name = new_user(seed, "locktest", [role["id"]])
    assert st in (200, 201), f"create user: {st} {user}"
    uid = user["id"]
    token = login(name, PASSWORD)

    check("administrator starts with the company keys", KEYS <= keys(token))
    st, _ = call("POST", "/api/companies", token, {})
    check("unlocked create is not refused by permission", st != 403, st)

    st, child, child_name = new_user(token, "locktest2")
    other = child["id"] if st in (200, 201) else None
    if other:
        # An administrator cannot grant this role itself: the seed admin gives it,
        # so the check below proves the lock and not a missing role.
        st, _ = call("PUT", f"/api/users/{other}/roles", seed, {"roleIds": [role["id"]]})
        check("seed admin gives the created account the role", st in (200, 204), st)
        check("created account starts with the company keys", KEYS <= keys(login(child_name, PASSWORD)))
        st, body = call("PUT", f"/api/users/{other}", token, {"companyChangesLocked": True})
        check("administrator cannot set the lock", st == 403, st)
        st, rows = call("GET", "/api/users", token)
        row = next((r for r in rows if r["id"] == other), {})
        check("administrator cannot read the lock", row.get("companyChangesLocked") is None, row)
    else:
        check("administrator can create a user for the lock checks", False, st)

    st, _ = call("PUT", f"/api/users/{uid}", seed, {"companyChangesLocked": True})
    check("seed admin sets the lock", st == 200, st)
    st, rows = call("GET", "/api/users", seed)
    row = next(r for r in rows if r["id"] == uid)
    check("seed admin reads the lock", row.get("companyChangesLocked") is True, row)

    mine = keys(token)
    check("locked account loses all four keys", not (KEYS & mine), KEYS & mine)
    check("locked account keeps the company list", "companies.manage.view" in mine)
    st, _ = call("POST", "/api/companies", token, {})
    check("locked create refused", st == 403, st)
    st, _ = call("PUT", f"/api/companies/{company_id}", token, {})
    check("locked edit refused", st == 403, st)
    st, _ = call("DELETE", "/api/companies/999999", token)
    check("locked delete refused", st == 403, st)
    boundary = "lockboundary"
    form = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\n'
            f"Content-Type: image/png\r\n\r\nx\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(f"{BASE}/api/companies/{company_id}/logo", data=form, method="POST", headers={
        "Authorization": "Bearer " + token, "Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        st = urllib.request.urlopen(req, timeout=60).status
    except urllib.error.HTTPError as e:
        st = e.code
    check("locked logo upload refused", st == 403, st)
    st, ok = call("GET", "/api/companies", token)
    check("locked account can still read companies", st == 200, st)

    if other:
        child_token = login(child_name, PASSWORD)
        check("account it created earlier is locked too", not (KEYS & keys(child_token)))
        st, _ = call("POST", "/api/companies", child_token, {})
        check("that account's create refused", st == 403, st)

    st, _ = call("PUT", f"/api/users/{uid}", token, {"companyChangesLocked": False})
    check("locked account cannot unlock itself", st == 403, st)
    check("seed admin keeps the company keys", KEYS <= keys(seed))

    st, _ = call("PUT", f"/api/users/{uid}", seed, {"fullName": name + " x"})
    st, rows = call("GET", "/api/users", seed)
    row = next(r for r in rows if r["id"] == uid)
    check("an edit that omits the lock leaves it set", row.get("companyChangesLocked") is True, row)

    st, _ = call("PUT", f"/api/users/{uid}", seed, {"companyChangesLocked": False})
    check("seed admin clears the lock", st == 200, st)
    check("keys return after unlock", KEYS <= keys(token))
    st, _ = call("POST", "/api/companies", token, {})
    check("create no longer refused by permission", st != 403, st)
finally:
    for user_id in reversed(created):
        call("DELETE", f"/api/users/{user_id}", seed)

passed = sum(1 for _, ok, _ in results if ok)
print(f"\n=== {passed}/{len(results)} company lock checks passed ===")
sys.exit(0 if passed == len(results) else 1)
