"""
End-to-end tenant-isolation test.

Creates 3 fresh test companies + 3 non-admin users + assignments, then
hits every tenant-scoped endpoint as each user and verifies the access
guard responds correctly.

Test matrix:
  Test Alpha Co.   IsTenantIsolated=True   alice + carol have access
  Test Beta Co.    IsTenantIsolated=True   bob + carol have access
  Test Gamma Co.   IsTenantIsolated=False  every authenticated user

Expectations per user:
  alice  : sees Alpha, Gamma + every other open company
           is BLOCKED (403) on Beta routes
  bob    : sees Beta, Gamma + every other open company
           is BLOCKED (403) on Alpha routes
  carol  : sees Alpha, Beta, Gamma + every other open company
           is NOT blocked
  admin  : sees everything; tenant guard always bypassed (seed admin id)

Usage:
  python scripts/test_tenant_isolation.py

Exit code 0 = all assertions pass, 1 = at least one failure.
Cleans up the test rows it created on success; leaves them on failure
so you can inspect.
"""
from __future__ import annotations
import json, sys, urllib.request, urllib.error
from typing import Any

BASE = "http://localhost:5134"

PASS = "PASS"
FAIL = "FAIL"


# ── HTTP helper ──────────────────────────────────────────────
def request(method: str, path: str, token: str | None = None, body: Any = None) -> tuple[int, Any]:
    url = BASE + path
    data = None
    headers = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode("utf-8")
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        try:
            payload = json.loads(raw) if raw else None
        except Exception:
            payload = raw
        return e.code, payload


def login(username: str, password: str) -> str:
    status, data = request("POST", "/api/auth/login", body={"username": username, "password": password})
    assert status == 200, f"login {username} failed: {status} {data}"
    return data["token"]


# ── Test scaffolding ─────────────────────────────────────────
results: list[tuple[str, str, str]] = []  # (suite, name, PASS/FAIL_with_reason)


def check(suite: str, name: str, ok: bool, reason: str = "") -> None:
    results.append((suite, name, PASS if ok else f"FAIL — {reason}"))


def status_check(suite: str, label: str, status: int, expected: int) -> None:
    check(suite, label, status == expected, f"expected {expected}, got {status}")


# ── Setup ────────────────────────────────────────────────────
print(f"\n=== Logging in as admin ===")
admin = login("admin", "admin123")

print(f"\n=== Cleaning up any leftover test rows from a prior run ===")
status, all_companies_pre = request("GET", "/api/companies", token=admin)
for c in (all_companies_pre or []):
    if c["name"] in ("Test Alpha Co.", "Test Beta Co.", "Test Gamma Co."):
        s, _ = request("DELETE", f"/api/companies/{c['id']}", token=admin)
        print(f"  removed leftover company id={c['id']} ({s})")
status, all_users_pre = request("GET", "/api/users", token=admin)
for u in (all_users_pre or []):
    if u["username"] in ("alice", "bob", "carol"):
        s, _ = request("DELETE", f"/api/users/{u['id']}", token=admin)
        print(f"  removed leftover user id={u['id']} ({s})")

print(f"\n=== Creating 3 test companies ===")
test_companies = []
for name in ["Test Alpha Co.", "Test Beta Co.", "Test Gamma Co."]:
    payload = {
        "name": name,
        "fullAddress": f"{name} HQ",
        "phone": "+92-21-00000000",
        "ntn": "1234567",
        "cnic": "1234567890123",
        "strn": "1234567890123",
        "startingChallanNumber": 1,
        "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1,
        "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox",
        "fbrProvinceCode": 8,
    }
    status, data = request("POST", "/api/companies", token=admin, body=payload)
    assert status == 201 or status == 200, f"create company {name}: {status} {data}"
    test_companies.append(data)
    print(f"  + {data['id']:4d}  {data['name']}")
alpha, beta, gamma = test_companies

print(f"\n=== Marking Alpha + Beta as IsTenantIsolated=true ===")
for c in (alpha, beta):
    update_dto = {
        "name": c["name"],
        "fullAddress": c.get("fullAddress"),
        "phone": c.get("phone"),
        "ntn": c.get("ntn"),
        "cnic": c.get("cnic"),
        "strn": c.get("strn"),
        "startingChallanNumber": c["startingChallanNumber"],
        "startingInvoiceNumber": c["startingInvoiceNumber"],
        "startingPurchaseBillNumber": c["startingPurchaseBillNumber"],
        "startingGoodsReceiptNumber": c["startingGoodsReceiptNumber"],
        "fbrEnvironment": c.get("fbrEnvironment"),
        "fbrProvinceCode": c.get("fbrProvinceCode"),
        "inventoryTrackingEnabled": False,
        "isTenantIsolated": True,
    }
    status, data = request("PUT", f"/api/companies/{c['id']}", token=admin, body=update_dto)
    assert status == 200, f"isolate company {c['name']}: {status} {data}"
    print(f"  isolated  id={c['id']}  {c['name']}")

print(f"\n=== Creating 3 test users + Administrator role ===")
# Look up Administrator role id
status, roles = request("GET", "/api/roles", token=admin)
assert status == 200, f"list roles: {status}"
admin_role_id = next(r["id"] for r in roles if r["name"] == "Administrator")
print(f"  Administrator role id: {admin_role_id}")

test_users = []
for username, fullname in [("alice", "Alice Tester"), ("bob", "Bob Tester"), ("carol", "Carol Tester")]:
    # Idempotent: delete first if exists
    status, ulist = request("GET", "/api/users", token=admin)
    existing = next((u for u in (ulist or []) if u["username"] == username), None)
    if existing:
        request("DELETE", f"/api/users/{existing['id']}", token=admin)

    status, u = request("POST", "/api/users", token=admin, body={
        "username": username,
        # Password policy requires 8+ chars (tightened after this test was
        # first written). Keep this in sync with the live rule.
        "password": "test1234",
        "fullName": fullname,
        "role": "Administrator",
    })
    assert status in (200, 201), f"create user {username}: {status} {u}"
    # Assign Administrator RBAC role so RBAC isn't what blocks them — only tenant
    status, _ = request("PUT", f"/api/users/{u['id']}/roles", token=admin, body={"roleIds": [admin_role_id]})
    assert status == 200, f"assign role to {username}: {status}"
    test_users.append(u)
    print(f"  + {u['id']:4d}  {username}")
alice, bob, carol = test_users

print(f"\n=== Setting tenant-access assignments ===")
mappings = {
    alice["id"]: ([alpha["id"]],            "Alpha only"),
    bob["id"]:   ([beta["id"]],             "Beta only"),
    carol["id"]: ([alpha["id"], beta["id"]], "Alpha + Beta"),
}
for uid, (cids, label) in mappings.items():
    status, data = request("PUT", f"/api/usercompanies/user/{uid}", token=admin, body={"companyIds": cids})
    assert status == 200, f"assign user {uid}: {status} {data}"
    print(f"  user={uid:4d}  {label:18s}  added={data['added']}, removed={data['removed']}, total={data['total']}")


# ── Verification ─────────────────────────────────────────────
print("\n=== Logging in as test users + verifying tenant filter ===")
tokens = {
    "alice": login("alice", "test1234"),
    "bob":   login("bob",   "test1234"),
    "carol": login("carol", "test1234"),
    "admin": admin,
}

# What each user must see in /api/companies
isolated_ids = {alpha["id"], beta["id"]}
# Semantics: explicit UserCompanies grants OVERRIDE open companies. So a
# non-admin user with any rows in UserCompanies sees ONLY those rows, not
# also the IsTenantIsolated=false fleet. (Operators rejected the earlier
# union semantics — "if I assigned them to A only, they shouldn't see
# open B by accident.")
expected_visible = {
    "alice": {alpha["id"]},                          # alice -> Alpha only
    "bob":   {beta["id"]},                           # bob   -> Beta only
    "carol": {alpha["id"], beta["id"]},              # carol -> Alpha + Beta
}
# Admin always sees everything (seed-admin bypass)
status, all_companies = request("GET", "/api/companies", token=admin)
all_company_ids = {c["id"] for c in all_companies}
expected_visible["admin"] = all_company_ids
# Every other open company in the DB now becomes a forbidden ID for
# non-admins — they have explicit grants so opens stop falling through.
open_ids = {c["id"] for c in all_companies if not c["isTenantIsolated"]}

# Suite 1: GET /api/companies returns the right set
print("\n  Suite 1 — GET /api/companies filtering")
for username, tok in tokens.items():
    status, data = request("GET", "/api/companies", token=tok)
    visible = {c["id"] for c in data}
    suite = "GET /api/companies"
    check(suite, f"[{username}] status 200", status == 200, f"got {status}")
    check(suite, f"[{username}] visible == expected", visible == expected_visible[username],
          f"expected {sorted(expected_visible[username])}, got {sorted(visible)}")

# Suite 2: tenant-scoped endpoints — 403 on isolated companies the user can't reach
print("\n  Suite 2 — 403 on forbidden isolated companies")
forbidden_for = {
    # Each non-admin sees ONLY their assigned companies; every other
    # company (whether isolated or not) must 403. Specifically, alice
    # is blocked on Beta + every open company; bob on Alpha + every
    # open company; carol only on the open companies (she has both
    # isolated ones).
    "alice": ({beta["id"]} | open_ids) - {alpha["id"]},
    "bob":   ({alpha["id"]} | open_ids) - {beta["id"]},
    "carol": open_ids,
    "admin": set(),       # seed admin bypasses
}
endpoints_to_test = [
    ("GET",  "/api/companies/{cid}"),
    ("GET",  "/api/companies/{cid}".replace("{cid}", "{cid}")),  # same — kept for clarity
    ("GET",  "/api/clients/company/{cid}"),
    ("GET",  "/api/clients/count?companyId={cid}"),
    ("GET",  "/api/clients/common?companyId={cid}"),
    ("GET",  "/api/suppliers/company/{cid}"),
    ("GET",  "/api/suppliers/count?companyId={cid}"),
    ("GET",  "/api/suppliers/common?companyId={cid}"),
    ("GET",  "/api/invoices/company/{cid}"),
    ("GET",  "/api/invoices/company/{cid}/paged"),
    ("GET",  "/api/invoices/count?companyId={cid}"),
    ("GET",  "/api/deliverychallans/company/{cid}"),
    ("GET",  "/api/deliverychallans/company/{cid}/paged"),
    ("GET",  "/api/deliverychallans/company/{cid}/pending"),
    ("GET",  "/api/deliverychallans/count?companyId={cid}"),
    ("GET",  "/api/purchasebills/count?companyId={cid}"),
    ("GET",  "/api/purchasebills/company/{cid}/paged"),
    ("GET",  "/api/goodsreceipts/company/{cid}/paged"),
    ("GET",  "/api/stock/company/{cid}/onhand"),
    ("GET",  "/api/stock/company/{cid}/movements"),
    ("GET",  "/api/stock/company/{cid}/opening"),
    ("GET",  "/api/fbr/sandbox/{cid}"),
    ("GET",  "/api/fbr/scenarios/applicable/{cid}"),
    ("GET",  "/api/fbr/uom/{cid}"),
    ("GET",  "/api/printtemplates/company/{cid}"),
]
for username, forbidden in forbidden_for.items():
    if not forbidden:
        continue
    tok = tokens[username]
    for method, path_tpl in endpoints_to_test:
        for cid in forbidden:
            path = path_tpl.replace("{cid}", str(cid))
            status, _ = request(method, path, token=tok)
            suite = f"403/404 on forbidden isolated company"
            # GET /api/companies/{id} returns 404 (not 403) by design — see
            # audit M-5 (2026-05-13): the response status / timing must not
            # leak "this company exists in another tenant". Every other
            # tenant-scoped endpoint still returns 403 via [AuthorizeCompany].
            is_company_get = (method == "GET" and path_tpl.startswith("/api/companies/{cid}"))
            expected_ok = (status == 404) if is_company_get else (status == 403)
            expected_text = "404" if is_company_get else "403"
            check(suite, f"[{username}] {method} {path}", expected_ok,
                  f"expected {expected_text}, got {status}")

# Suite 3: tenant-scoped endpoints — 200 on allowed companies
print("\n  Suite 3 — 200 on allowed companies (lightweight)")
allowed_for = {
    "alice": {alpha["id"]},
    "bob":   {beta["id"]},
    "carol": {alpha["id"], beta["id"]},
}
for username, allowed in allowed_for.items():
    tok = tokens[username]
    for cid in allowed:
        path = f"/api/companies/{cid}"
        status, _ = request("GET", path, token=tok)
        suite = "200 on allowed company"
        check(suite, f"[{username}] GET {path}", status == 200,
              f"expected 200, got {status}")
        path = f"/api/clients/company/{cid}"
        status, _ = request("GET", path, token=tok)
        check(suite, f"[{username}] GET {path}", status == 200,
              f"expected 200, got {status}")

# Suite 4: write endpoints with body-side companyId — 403 if forbidden
print("\n  Suite 4 — 403 on body-side companyId")
# alice tries to create a supplier under Beta
fake_supplier = {
    "name": "Bogus Supplier", "companyId": beta["id"],
    "phone": "0", "ntn": "0", "strn": "0",
}
status, _ = request("POST", "/api/suppliers", token=tokens["alice"], body=fake_supplier)
check("POST body companyId guard", "alice -> POST /api/suppliers (companyId=beta)",
      status == 403, f"expected 403, got {status}")
# bob tries to upsert opening stock against Alpha
opening_payload = {
    "companyId": alpha["id"], "itemTypeId": 1, "quantity": 10,
    "asOfDate": "2026-01-01T00:00:00",
}
status, _ = request("POST", "/api/stock/opening", token=tokens["bob"], body=opening_payload)
check("POST body companyId guard", "bob -> POST /api/stock/opening (companyId=alpha)",
      status == 403, f"expected 403, got {status}")

# Suite 5: UserCompanies endpoint requires the new permission
print("\n  Suite 5 — Tenant Access page perm gating")
# alice has Administrator role → has tenantaccess.manage.* → can hit /api/usercompanies
status, _ = request("GET", "/api/usercompanies", token=tokens["alice"])
check("Tenant Access RBAC", "alice (Administrator) GET /api/usercompanies",
      status == 200, f"expected 200, got {status}")


# ── Cleanup (test fails → keep rows for inspection) ──────────
print("\n=== Results ===")
fails = [r for r in results if not r[2].startswith(PASS)]
by_suite: dict[str, list] = {}
for s, n, r in results:
    by_suite.setdefault(s, []).append((n, r))
for suite, items in by_suite.items():
    p = sum(1 for _, r in items if r.startswith(PASS))
    f = len(items) - p
    icon = "[OK]" if f == 0 else "[FAIL]"
    print(f"  {icon} {suite}: {p}/{len(items)} passed")
    if f:
        for n, r in items:
            if not r.startswith(PASS):
                print(f"      - {n}: {r}")

if fails:
    print(f"\n[FAIL]  {len(fails)} failure(s). Test rows kept for inspection.")
    sys.exit(1)

print("\n[OK]  All checks passed. Cleaning up test rows...")
for u in test_users:
    request("DELETE", f"/api/users/{u['id']}", token=admin)
for c in test_companies:
    request("DELETE", f"/api/companies/{c['id']}", token=admin)
print("Done.")
