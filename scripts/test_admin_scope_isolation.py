"""
Hierarchical admin-scope isolation test (2026-09-11).

Model under test: ONE seed admin at the root; every other account carries
Users.CreatedByUserId. An Administrator manages exactly the accounts
beneath it in that chain and may delegate only the companies it holds
itself. See IManagementScopeService.

Scenario built by this script (all rows are created fresh and removed on
success):

  seed (admin)
  ├── scopeAdminA            Administrator role
  │   ├── Scope Test Co A1   created by A  (grant: A, userA1)
  │   ├── Scope Test Co A2   created by A  (grant: A)
  │   └── scopeUserA1        created by A
  └── scopeAdminB            Administrator role
      ├── Scope Test Co B1   created by B  (grant: B)
      └── scopeUserB1        created by B

Assertions:
  seed        sees A, B, A1, B1 in /users and /usercompanies; can assign
              and revoke company access for any of them; /administrators
              returns the two trees.
  A           /users shows only A + userA1 (no seed, no B, no userB1)
              GET/PUT/DELETE on B, userB1, seed -> 404 / 400 (seed guard)
              /usercompanies grid lists only userA1 x {A1, A2}
              cannot grant B1 to userA1 (403), cannot read/modify userB1's
              grants (404), cannot assign roles to userB1 (404)
              /companies shows only A1, A2
              /administrators -> 403
  B           mirror of A
  revocation  seed removes A2 from A -> A's /companies drops A2 at once,
              A2 endpoints 403 for A; seed removes everything from userA1
              -> /companies returns [] (No Company Configured state).
  delete      seed deletes A -> userA1 and A's companies re-parent to seed
              (visible in /administrators as legacy/top-level rows).

Usage:
  python scripts/test_admin_scope_isolation.py [--base http://localhost:5134]

Exit code 0 = all checks pass, 1 = at least one failure (rows are left in
place on failure so they can be inspected).
"""
from __future__ import annotations
import argparse, json, sys, urllib.request, urllib.error
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5134")
ap.add_argument("--admin-user", default="admin")
ap.add_argument("--admin-pass", default="admin123")
args = ap.parse_args()
BASE = args.base.rstrip("/")


def request(method: str, path: str, token: str | None = None, body: Any = None) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            return e.code, (json.loads(raw) if raw else None)
        except Exception:
            return e.code, raw


def login(u: str, p: str) -> str:
    s, d = request("POST", "/api/auth/login", body={"username": u, "password": p})
    assert s == 200, f"login {u}: {s} {d}"
    return d["token"]


results: list[tuple[str, str, bool, str]] = []


def check(suite: str, name: str, ok: bool, detail: str = "") -> None:
    results.append((suite, name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {suite}: {name}" + ("" if ok else f"  -- {detail}"))


def ids(rows) -> set[int]:
    return {r["id"] for r in (rows or [])}


PW = "Scope#Test2026"
USERS = ["scopeAdminA", "scopeAdminB", "scopeUserA1", "scopeUserB1"]
COMPANIES = ["Scope Test Co A1", "Scope Test Co A2", "Scope Test Co B1"]

print(f"\n=== base {BASE} - logging in as seed admin ===")
seed = login(args.admin_user, args.admin_pass)
s, me = request("GET", "/api/auth/me", token=seed)
assert me and me.get("isSeedAdmin"), f"{args.admin_user} is not the seed admin: {me}"
SEED_ID = me["id"]

print("=== cleaning leftovers from a previous run ===")
s, comps = request("GET", "/api/companies", token=seed)
for c in comps or []:
    if c["name"] in COMPANIES:
        request("DELETE", f"/api/companies/{c['id']}", token=seed)
s, users = request("GET", "/api/users", token=seed)
# delete leaf users first so re-parenting has less to do
for name in ["scopeUserA1", "scopeUserB1", "scopeAdminA", "scopeAdminB"]:
    for u in users or []:
        if u["username"] == name:
            request("DELETE", f"/api/users/{u['id']}", token=seed)

s, roles = request("GET", "/api/roles", token=seed)
admin_role = next(r for r in roles if r["name"] == "Administrator")


def create_user(token: str, username: str, full: str, role_name: str | None = None) -> dict:
    s, d = request("POST", "/api/users", token=token,
                   body={"username": username, "fullName": full, "password": PW, "role": "User"})
    assert s == 201, f"create {username}: {s} {d}"
    if role_name:
        rid = next(r["id"] for r in roles if r["name"] == role_name)
        s2, d2 = request("PUT", f"/api/users/{d['id']}/roles", token=token, body={"roleIds": [rid]})
        assert s2 == 200, f"assign role to {username}: {s2} {d2}"
    return d


def create_company(token: str, name: str) -> dict:
    s, d = request("POST", "/api/companies", token=token, body={
        "name": name, "fullAddress": f"{name} HQ", "phone": "+92-21-0000000",
        "ntn": "1234567", "cnic": "1234567890123", "strn": "1234567890123",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
    })
    assert s in (200, 201), f"create company {name}: {s} {d}"
    return d


print("\n=== SETUP: seed creates Administrator A and B ===")
A = create_user(seed, "scopeAdminA", "Scope Admin A", "Administrator")
B = create_user(seed, "scopeAdminB", "Scope Admin B", "Administrator")
tA = login("scopeAdminA", PW)
tB = login("scopeAdminB", PW)

print("=== SETUP: A and B each create their companies and one user ===")
coA1 = create_company(tA, "Scope Test Co A1")
coA2 = create_company(tA, "Scope Test Co A2")
coB1 = create_company(tB, "Scope Test Co B1")
uA1 = create_user(tA, "scopeUserA1", "Scope User A1")
uB1 = create_user(tB, "scopeUserB1", "Scope User B1")
# A gives userA1 access to A1 only
s, d = request("PUT", f"/api/usercompanies/user/{uA1['id']}", token=tA, body={"companyIds": [coA1["id"]]})
assert s == 200, f"A grants A1 to userA1: {s} {d}"
tUA1 = login("scopeUserA1", PW)

# ─────────────────────────────────────────────────────────────────────
print("\n=== SEED: sees and manages everything ===")
s, rows = request("GET", "/api/users", token=seed)
check("seed", "users list contains A, B, userA1, userB1", {A["id"], B["id"], uA1["id"], uB1["id"]} <= ids(rows))
s, grid = request("GET", "/api/usercompanies", token=seed)
grid_users = {r["userId"] for r in grid}
grid_cos = {c["companyId"] for r in grid for c in r["companies"]}
check("seed", "tenant-access grid lists all four accounts", {A["id"], B["id"], uA1["id"], uB1["id"]} <= grid_users)
check("seed", "tenant-access grid lists A1, A2, B1", {coA1["id"], coA2["id"], coB1["id"]} <= grid_cos)
s, tree = request("GET", "/api/administrators", token=seed)
check("seed", "/administrators 200", s == 200, f"{s} {tree}")
byid = {t["userId"]: t for t in (tree or [])}
check("seed", "tree has A and B as top-level", A["id"] in byid and B["id"] in byid)
if A["id"] in byid:
    check("seed", "A's tree lists userA1", {u["userId"] for u in byid[A["id"]]["users"]} == {uA1["id"]})
    check("seed", "A's tree lists A1 and A2 only",
          {c["companyId"] for c in byid[A["id"]]["companies"]} == {coA1["id"], coA2["id"]})
    check("seed", "A's tree does not list B1", coB1["id"] not in {c["companyId"] for c in byid[A["id"]]["companies"]})
if B["id"] in byid:
    check("seed", "B's tree lists userB1 and B1",
          {u["userId"] for u in byid[B["id"]]["users"]} == {uB1["id"]}
          and {c["companyId"] for c in byid[B["id"]]["companies"]} == {coB1["id"]})
s, d = request("PUT", f"/api/usercompanies/user/{uB1['id']}", token=seed, body={"companyIds": [coB1["id"]]})
check("seed", "can grant B1 to userB1", s == 200 and d["added"] == 1, f"{s} {d}")
s, d = request("GET", f"/api/users/{B['id']}", token=seed)
check("seed", "can GET B", s == 200)

# ─────────────────────────────────────────────────────────────────────
def isolation_suite(tag: str, tok: str, me_id: int, my_user: dict, my_cos: list, other: dict, other_user: dict, other_co: dict):
    print(f"\n=== ADMIN {tag}: isolated inside own tree ===")
    s, rows = request("GET", "/api/users", token=tok)
    got = ids(rows)
    check(tag, "users list = self + own user only", got == {me_id, my_user["id"]}, f"got {sorted(got)}")
    check(tag, "seed admin not in users list", SEED_ID not in got)
    check(tag, "other admin not in users list", other["id"] not in got)
    check(tag, "other admin's user not in users list", other_user["id"] not in got)

    s, _ = request("GET", f"/api/users/{other['id']}", token=tok)
    check(tag, "GET other admin -> 404", s == 404, str(s))
    s, _ = request("GET", f"/api/users/{other_user['id']}", token=tok)
    check(tag, "GET other admin's user -> 404", s == 404, str(s))
    s, _ = request("GET", f"/api/users/{SEED_ID}", token=tok)
    check(tag, "GET seed admin -> 404", s == 404, str(s))
    s, _ = request("PUT", f"/api/users/{other_user['id']}", token=tok, body={"fullName": "hacked"})
    check(tag, "PUT other admin's user -> 404", s == 404, str(s))
    s, _ = request("PUT", f"/api/users/{other['id']}", token=tok, body={"fullName": "hacked"})
    check(tag, "PUT other admin -> 404", s == 404, str(s))
    s, _ = request("PUT", f"/api/users/{SEED_ID}", token=tok, body={"fullName": "hacked"})
    check(tag, "PUT seed admin -> rejected (400 guard)", s in (400, 404), str(s))
    s, _ = request("DELETE", f"/api/users/{other_user['id']}", token=tok)
    check(tag, "DELETE other admin's user -> 404", s == 404, str(s))
    s, _ = request("DELETE", f"/api/users/{other['id']}", token=tok)
    check(tag, "DELETE other admin -> 404", s == 404, str(s))
    s, _ = request("DELETE", f"/api/users/{SEED_ID}", token=tok)
    check(tag, "DELETE seed admin -> rejected", s in (400, 404), str(s))
    s, _ = request("GET", f"/api/users/{other_user['id']}/roles", token=tok)
    check(tag, "GET other's user roles -> 404", s == 404, str(s))
    s, _ = request("PUT", f"/api/users/{other_user['id']}/roles", token=tok, body={"roleIds": [admin_role["id"]]})
    check(tag, "PUT other's user roles -> 404", s == 404, str(s))
    s, _ = request("PUT", f"/api/users/{me_id}/roles", token=tok, body={"roleIds": [admin_role["id"]]})
    check(tag, "PUT own roles -> 404 (cannot self-elevate)", s == 404, str(s))
    s, d = request("PUT", f"/api/users/{my_user['id']}", token=tok, body={"fullName": f"Scope User {tag}1 edited"})
    check(tag, "PUT own user -> 200", s == 200, f"{s} {d}")
    s, d = request("PUT", f"/api/users/{me_id}", token=tok, body={"fullName": f"Scope Admin {tag}"})
    check(tag, "PUT self (own card Edit) -> 200", s == 200, f"{s} {d}")
    s, d = request("PUT", f"/api/users/{me_id}", token=tok, body={"role": "Admin"})
    check(tag, "PUT self role=Admin -> 403 (seed-only legacy role)", s == 403, f"{s} {d}")

    s, rows = request("GET", "/api/companies", token=tok)
    check(tag, "companies list = own companies only", ids(rows) == {c["id"] for c in my_cos}, f"got {sorted(ids(rows))}")
    s, _ = request("GET", f"/api/companies/{other_co['id']}", token=tok)
    check(tag, "GET other's company -> 404", s == 404, str(s))
    s, _ = request("GET", f"/api/clients/company/{other_co['id']}", token=tok)
    check(tag, "other's company-scoped endpoint -> 403/404", s in (403, 404), str(s))

    s, grid = request("GET", "/api/usercompanies", token=tok)
    check(tag, "tenant-access grid 200", s == 200, str(s))
    gu = {r["userId"] for r in (grid or [])}
    gc = {c["companyId"] for r in (grid or []) for c in r["companies"]}
    check(tag, "grid users = own user only", gu == {my_user["id"]}, f"got {sorted(gu)}")
    check(tag, "grid companies = own companies only", gc == {c["id"] for c in my_cos}, f"got {sorted(gc)}")
    s, _ = request("GET", f"/api/usercompanies/user/{other_user['id']}", token=tok)
    check(tag, "GET other's user grants -> 404", s == 404, str(s))
    s, d = request("PUT", f"/api/usercompanies/user/{other_user['id']}", token=tok, body={"companyIds": []})
    check(tag, "PUT other's user grants -> 404", s == 404, str(s))
    s, d = request("PUT", f"/api/usercompanies/user/{my_user['id']}", token=tok, body={"companyIds": [other_co["id"]]})
    check(tag, "grant other's company to own user -> 403", s == 403, f"{s} {d}")
    s, d = request("PUT", f"/api/usercompanies/user/{my_user['id']}", token=tok,
                   body={"companyIds": [c["id"] for c in my_cos]})
    check(tag, "grant own companies to own user -> 200", s == 200, f"{s} {d}")
    s, _ = request("GET", "/api/administrators", token=tok)
    check(tag, "/administrators -> 403", s == 403, str(s))


isolation_suite("A", tA, A["id"], uA1, [coA1, coA2], B, uB1, coB1)
isolation_suite("B", tB, B["id"], uB1, [coB1], A, uA1, coA1)

# A's user cannot see anything beyond itself
print("\n=== USER A1: plain user, no admin perms ===")
s, _ = request("GET", "/api/users", token=tUA1)
check("userA1", "users list -> 403 (no permission)", s == 403, str(s))
s, rows = request("GET", "/api/companies", token=tUA1)
check("userA1", "companies = A1 + A2 (granted by A)", ids(rows) == {coA1["id"], coA2["id"]}, f"got {sorted(ids(rows))}")

# ─────────────────────────────────────────────────────────────────────
print("\n=== SEED protects out-of-scope grants from A ===")
# seed grants B1 directly to userA1; A must neither see nor be able to remove it
s, d = request("PUT", f"/api/usercompanies/user/{uA1['id']}", token=seed,
               body={"companyIds": [coA1["id"], coA2["id"], coB1["id"]]})
check("seed", "seed grants B1 to userA1", s == 200 and d["added"] == 1, f"{s} {d}")
s, d = request("GET", f"/api/usercompanies/user/{uA1['id']}", token=tA)
check("A", "A's view of userA1 hides B1", coB1["id"] not in {c["companyId"] for c in d["companies"]})
s, d = request("PUT", f"/api/usercompanies/user/{uA1['id']}", token=tA, body={"companyIds": [coA1["id"]]})
check("A", "A revokes A2 from userA1 -> 200, removed=1 only", s == 200 and d["removed"] == 1, f"{s} {d}")
s, rows = request("GET", "/api/companies", token=tUA1)
check("userA1", "still holds B1 (seed grant untouched by A) and A1", ids(rows) == {coA1["id"], coB1["id"]}, f"got {sorted(ids(rows))}")

# ─────────────────────────────────────────────────────────────────────
print("\n=== REVOCATION: seed removes access and it bites immediately ===")
s, d = request("PUT", f"/api/usercompanies/user/{A['id']}", token=seed, body={"companyIds": [coA1["id"]]})
check("revoke", "seed strips A2 from A", s == 200 and d["removed"] == 1, f"{s} {d}")
s, rows = request("GET", "/api/companies", token=tA)
check("revoke", "A's companies drop A2 at once", ids(rows) == {coA1["id"]}, f"got {sorted(ids(rows))}")
s, _ = request("GET", f"/api/companies/{coA2['id']}", token=tA)
check("revoke", "A GET A2 -> 404", s == 404, str(s))
s, _ = request("GET", f"/api/clients/company/{coA2['id']}", token=tA)
check("revoke", "A company-scoped call on A2 -> 403", s == 403, str(s))
s, d = request("PUT", f"/api/usercompanies/user/{uA1['id']}", token=tA, body={"companyIds": [coA2["id"]]})
check("revoke", "A cannot re-delegate A2 -> 403", s == 403, f"{s} {d}")
s, grid = request("GET", "/api/usercompanies", token=tA)
check("revoke", "A's grid no longer offers A2", coA2["id"] not in {c["companyId"] for r in grid for c in r["companies"]})

s, d = request("PUT", f"/api/usercompanies/user/{uA1['id']}", token=seed, body={"companyIds": []})
check("revoke", "seed strips every company from userA1", s == 200, f"{s} {d}")
s, rows = request("GET", "/api/companies", token=tUA1)
check("revoke", "userA1 /companies -> [] (No Company Configured)", s == 200 and rows == [], f"{s} {rows}")
s, _ = request("GET", f"/api/clients/company/{coA1['id']}", token=tUA1)
check("revoke", "userA1 stale company id -> 403", s == 403, str(s))
s, d = request("GET", "/api/auth/me", token=tUA1)
check("revoke", "userA1 still authenticated (/auth/me 200)", s == 200, str(s))

# ─────────────────────────────────────────────────────────────────────
print("\n=== DELETE: removing Administrator A re-parents its tree to seed ===")
s, d = request("DELETE", f"/api/users/{A['id']}", token=seed)
check("delete", "seed deletes A -> 200", s == 200, f"{s} {d}")
s, tree = request("GET", "/api/administrators", token=seed)
top = {t["userId"] for t in tree}
check("delete", "userA1 is now a top-level row", uA1["id"] in top)
s, rows = request("GET", "/api/companies", token=seed)
check("delete", "A1 and A2 still exist", {coA1["id"], coA2["id"]} <= ids(rows))
s, _ = request("GET", f"/api/users/{uA1['id']}", token=tB)
check("delete", "B still cannot see userA1", s == 404, str(s))

# ─────────────────────────────────────────────────────────────────────
failed = [r for r in results if not r[2]]
print(f"\n=== {len(results) - len(failed)}/{len(results)} checks passed ===")
if failed:
    print("FAILED:")
    for suite, name, _, detail in failed:
        print(f"  - {suite}: {name}  -- {detail}")
    print("Test rows left in place for inspection.")
    sys.exit(1)

print("=== cleanup ===")
for c in (coA1, coA2, coB1):
    request("DELETE", f"/api/companies/{c['id']}", token=seed)
for u in (uA1, uB1, B):
    request("DELETE", f"/api/users/{u['id']}", token=seed)
print("all checks passed")
