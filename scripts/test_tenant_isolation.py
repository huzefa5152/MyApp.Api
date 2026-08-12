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
    # Accounting — Receipts (money in) + Payments (money out). All four are
    # [AuthorizeCompany]-gated companyId routes; a forbidden company 403s
    # before the action runs (the by-invoice/by-bill dummy id is never read).
    ("GET",  "/api/payments/receipts/company/{cid}/paged"),
    ("GET",  "/api/payments/payments/company/{cid}/paged"),
    ("GET",  "/api/payments/company/{cid}/by-invoice/1"),
    ("GET",  "/api/payments/company/{cid}/by-bill/1"),
    # Document folders + unified attachments — [AuthorizeCompany]-gated
    # companyId routes; a forbidden company 403s before the action runs.
    ("GET",  "/api/folders/company/{cid}"),
    ("GET",  "/api/folders/company/{cid}/paged"),
    ("GET",  "/api/attachments/company/{cid}/uncategorized"),
    ("GET",  "/api/attachments/company/{cid}/folder/1"),
    ("GET",  "/api/attachments/company/{cid}/entity/Invoice/1"),
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
            # Exact match, NOT startswith: sub-routes like
            # /api/companies/{cid}/stamps are ordinary [AuthorizeCompany]
            # endpoints and correctly 403. A prefix test swept them into the
            # 404 rule and failed them for behaving properly.
            is_company_get = (method == "GET" and path_tpl == "/api/companies/{cid}")
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

# Suite 6: cross-tenant ClientId forge — operator with legit access to
# their own tenant cannot smuggle in a Client from another tenant on a
# challan / invoice create call. Added 2026-05-16 after discovering the
# challan + invoice create paths only checked the *tenant* guard on
# companyId, not the cross-tenant link on dto.ClientId.
print("\n  Suite 6 — cross-tenant ClientId forge guard")
# Seed a Beta-side Client as admin (alice doesn't have direct access to Beta).
beta_client_payload = {
    "companyId": beta["id"],
    "name": "Beta-Forge-Bait",
    "phone": "+92-00-0000000",
    "site": "Karachi",
    "ntn": "0000001",
    "cnic": "0000001000001",
    "strn": "0000001000001",
    "registrationType": "Registered",
}
status, beta_client = request("POST", "/api/clients", token=admin, body=beta_client_payload)
assert status in (200, 201), f"seed beta client: {status} {beta_client}"

# alice belongs to Alpha. She tries to create a challan in Alpha
# referencing the Beta client by id — must 400 (InvalidOperationException
# bubbles up as "Client does not belong to this company").
# NOTE: challan creation is route-scoped (POST /api/deliverychallans/
# company/{companyId}); the old bare-collection POST 405s, so the
# forgery vector is the clientId in the body, not companyId.
forged_challan = {
    "clientId": beta_client["id"],
    "site": "Karachi",
    "poNumber": "PO/FORGE",
    "deliveryDate": "2026-05-16",
    "items": [
        {"description": "Bogus", "quantity": 1, "unit": "Numbers, pieces, units"}
    ],
}
status, _ = request("POST", f"/api/deliverychallans/company/{alpha['id']}",
                    token=tokens["alice"], body=forged_challan)
check("Cross-tenant ClientId guard",
      "alice -> POST /api/deliverychallans/company/{alpha} (clientId=beta-owned)",
      status == 400, f"expected 400, got {status}")

# Standalone bill path already had this check; we re-verify it still
# fires from the same forgery vector for completeness.
forged_bill = {
    "companyId": alpha["id"],
    "clientId": beta_client["id"],
    "date": "2026-05-16",
    "gstRate": 18,
    "items": [
        {"description": "Bogus", "quantity": 1, "uom": "Numbers, pieces, units", "unitPrice": 100}
    ],
}
status, _ = request("POST", "/api/invoices/standalone", token=tokens["alice"], body=forged_bill)
check("Cross-tenant ClientId guard",
      "alice -> POST /api/invoices/standalone (companyId=alpha, clientId=beta-owned)",
      status == 400, f"expected 400, got {status}")

# Suite 7: customer document handover — tenant guard on the 3 handover
# endpoints (2026-08). A user without access to the invoice's company gets
# 403 on the single mark/revert (tenant assert fires on the STORED invoice's
# CompanyId, before any eligibility check); the bulk endpoint silently skips
# cross-tenant ids (filtered by the caller's accessible-company set) and never
# mutates a bill outside it.
print("\n  Suite 7 — customer document handover tenant guard")
beta_bill_payload = {
    "companyId": beta["id"],
    "clientId": beta_client["id"],
    "date": "2026-05-16",
    "gstRate": 18,
    "items": [{"description": "Handover-guard bait", "quantity": 1, "uom": "Numbers, pieces, units", "unitPrice": 100}],
}
status, beta_bill = request("POST", "/api/invoices/standalone", token=admin, body=beta_bill_payload)
assert status in (200, 201), f"seed beta bill: {status} {beta_bill}"

# alice (Alpha only) is blocked on Beta's invoice on both single endpoints.
status, _ = request("POST", f"/api/invoices/{beta_bill['id']}/handover", token=tokens["alice"], body={})
status_check("Handover tenant guard", "alice -> POST /invoices/{beta}/handover", status, 403)
status, _ = request("POST", f"/api/invoices/{beta_bill['id']}/handover/revert", token=tokens["alice"])
status_check("Handover tenant guard", "alice -> POST /invoices/{beta}/handover/revert", status, 403)

# Bulk cross-tenant forge: alice submits a Beta id. The service filters by her
# accessible set (Alpha only), so it skips it — delivered 0, skipped 1 — and
# the bill is NOT marked delivered.
status, bulk = request("POST", "/api/invoices/handover/bulk", token=tokens["alice"], body={"ids": [beta_bill["id"]]})
check("Handover tenant guard", "alice -> bulk handover (beta id) returns 200",
      status == 200, f"expected 200, got {status}")
check("Handover tenant guard", "alice -> bulk handover skips cross-tenant id",
      bool(bulk) and bulk.get("delivered") == 0 and bulk.get("skipped") == 1,
      f"expected delivered=0 skipped=1, got {bulk}")
status, check_bill = request("GET", f"/api/invoices/{beta_bill['id']}", token=admin)
check("Handover tenant guard", "beta bill NOT delivered after cross-tenant bulk",
      status == 200 and (check_bill or {}).get("handoverAt") is None,
      f"expected handoverAt null, got {(check_bill or {}).get('handoverAt')}")

# Suite 8: Sales report batch Tax Invoice print — the id list is client-supplied
# so every distinct CompanyId behind it must be asserted. Unlike bulk handover
# (which silently skips), this endpoint is all-or-nothing: one forbidden id 403s
# the whole request rather than returning the rows the caller CAN see.
print("\n  Suite 8 — batch Tax Invoice print tenant guard")

status, _ = request("POST", "/api/invoices/print/tax-invoice/batch",
                    token=tokens["alice"], body={"invoiceIds": [beta_bill["id"]]})
status_check("Batch print tenant guard", "alice -> POST /invoices/print/tax-invoice/batch (beta id)",
             status, 403)

# admin owns both tenants, so the same id is fine for them — proves the 403 above
# came from the tenant guard and not from the route being broken outright.
status, rows = request("POST", "/api/invoices/print/tax-invoice/batch",
                       token=admin, body={"invoiceIds": [beta_bill["id"]]})
check("Batch print tenant guard", "admin -> batch print (beta id) returns the row",
      status == 200 and isinstance(rows, list) and len(rows) == 1,
      f"expected 200 with 1 row, got {status} {rows}")

# An empty list is a 400, not an empty 200 — a caller sending nothing is a bug.
status, _ = request("POST", "/api/invoices/print/tax-invoice/batch",
                    token=admin, body={"invoiceIds": []})
status_check("Batch print tenant guard", "admin -> batch print (empty list)", status, 400)

# Over the per-request cap (100) is rejected rather than silently truncated.
status, _ = request("POST", "/api/invoices/print/tax-invoice/batch",
                    token=admin, body={"invoiceIds": list(range(1, 202))})
status_check("Batch print tenant guard", "admin -> batch print (201 ids, over cap)", status, 400)

# Cleanup the seed bill (latest in a fresh company → deletable).
request("DELETE", f"/api/invoices/{beta_bill['id']}", token=admin)

# Suite 9: Common Clients / Common Suppliers must respect tenant access.
# These group endpoints aggregate the SAME legal entity across companies. The
# group list was previously computed over every Client/Supplier row in the
# database — [AuthorizeCompany] validated the companyId query param but never
# scoped the rows — so an operator holding one company could read the names of
# every other tenant sharing that entity, and the detail route handed back each
# sibling's full contact record (address / phone / email / NTN / STRN / CNIC).
#
# Rule: a group is "common" only across companies the CALLER can reach. alice
# holds Alpha alone, so an entity shared by Alpha + Beta is not common to her.
print("\n  Suite 9 — Common Clients / Suppliers tenant scoping")

shared_ntn = "7788991"
shared_name = "Shared Legal Entity Ltd"

# Same NTN in both tenants → EnsureGroup links them into one group.
status, alpha_shared = request("POST", "/api/clients", token=admin, body={
    "companyId": alpha["id"], "name": shared_name, "phone": "+92-00-0000000",
    "site": "Karachi", "ntn": shared_ntn, "cnic": "0000002000002",
    "strn": "0000002000002", "registrationType": "Registered",
})
assert status in (200, 201), f"seed alpha shared client: {status} {alpha_shared}"
status, beta_shared = request("POST", "/api/clients", token=admin, body={
    "companyId": beta["id"], "name": shared_name, "phone": "+92-11-1111111",
    "site": "Lahore", "ntn": shared_ntn, "cnic": "0000002000002",
    "strn": "0000002000002", "registrationType": "Registered",
})
assert status in (200, 201), f"seed beta shared client: {status} {beta_shared}"

# admin reaches both tenants, so the entity IS common to them — this also
# proves the group actually formed, so alice's empty result below means
# "scoped out", not "never grouped".
status, admin_common = request("GET", f"/api/clients/common?companyId={alpha['id']}", token=admin)
admin_group = next((g for g in (admin_common or []) if g.get("ntn") == shared_ntn), None)
check("Common tenant scoping", "admin sees the shared entity as a Common Client",
      status == 200 and admin_group is not None and admin_group.get("companyCount") == 2,
      f"expected companyCount=2, got {status} {admin_group}")

group_id = (admin_group or {}).get("groupId")

# alice holds Alpha only → the entity is NOT common to her.
status, alice_common = request("GET", f"/api/clients/common?companyId={alpha['id']}", token=tokens["alice"])
leaked = [g for g in (alice_common or []) if g.get("ntn") == shared_ntn]
check("Common tenant scoping", "alice does NOT see the shared entity in Common Clients",
      status == 200 and not leaked, f"expected no match, got {status} {leaked}")

# No group card may ever name a company alice cannot reach.
alice_named = {n for g in (alice_common or []) for n in (g.get("companyNames") or [])}
check("Common tenant scoping", "alice sees no foreign company names in Common Clients",
      beta["name"] not in alice_named, f"leaked company names: {sorted(alice_named)}")

# /groups has no companyId at all — previously wide open.
status, alice_groups = request("GET", "/api/clients/groups", token=tokens["alice"])
group_named = {n for g in (alice_groups or []) for n in (g.get("companyNames") or [])}
check("Common tenant scoping", "alice /clients/groups excludes foreign company names",
      status == 200 and beta["name"] not in group_named,
      f"leaked company names: {sorted(group_named)}")

# Detail route: alice may see her own Alpha member, never Beta's record.
if group_id:
    status, detail = request("GET", f"/api/clients/common/{group_id}", token=tokens["alice"])
    member_cids = {m.get("companyId") for m in ((detail or {}).get("members") or [])}
    check("Common tenant scoping", "alice group detail excludes the Beta member",
          status in (200, 403, 404) and beta["id"] not in member_cids,
          f"expected no Beta member, got {status} members={sorted(c for c in member_cids if c)}")

# Same story on the supplier side.
status, alpha_sup = request("POST", "/api/suppliers", token=admin, body={
    "companyId": alpha["id"], "name": shared_name, "phone": "+92-00-0000000",
    "ntn": shared_ntn, "strn": "0000002000002",
})
assert status in (200, 201), f"seed alpha shared supplier: {status} {alpha_sup}"
status, beta_sup = request("POST", "/api/suppliers", token=admin, body={
    "companyId": beta["id"], "name": shared_name, "phone": "+92-11-1111111",
    "ntn": shared_ntn, "strn": "0000002000002",
})
assert status in (200, 201), f"seed beta shared supplier: {status} {beta_sup}"

status, admin_sup_common = request("GET", f"/api/suppliers/common?companyId={alpha['id']}", token=admin)
admin_sup_group = next((g for g in (admin_sup_common or []) if g.get("ntn") == shared_ntn), None)
check("Common tenant scoping", "admin sees the shared entity as a Common Supplier",
      status == 200 and admin_sup_group is not None and admin_sup_group.get("companyCount") == 2,
      f"expected companyCount=2, got {status} {admin_sup_group}")

status, alice_sup_common = request("GET", f"/api/suppliers/common?companyId={alpha['id']}", token=tokens["alice"])
sup_leaked = [g for g in (alice_sup_common or []) if g.get("ntn") == shared_ntn]
check("Common tenant scoping", "alice does NOT see the shared entity in Common Suppliers",
      status == 200 and not sup_leaked, f"expected no match, got {status} {sup_leaked}")

alice_sup_named = {n for g in (alice_sup_common or []) for n in (g.get("companyNames") or [])}
check("Common tenant scoping", "alice sees no foreign company names in Common Suppliers",
      beta["name"] not in alice_sup_named, f"leaked company names: {sorted(alice_sup_named)}")

status, alice_sup_groups = request("GET", "/api/suppliers/groups", token=tokens["alice"])
sup_group_named = {n for g in (alice_sup_groups or []) for n in (g.get("companyNames") or [])}
check("Common tenant scoping", "alice /suppliers/groups excludes foreign company names",
      status == 200 and beta["name"] not in sup_group_named,
      f"leaked company names: {sorted(sup_group_named)}")

# carol reaches BOTH member companies, so the entity IS common to her — with
# both names on the card. This is the case that fails if the scoping is too
# aggressive and quietly kills the feature for multi-company operators.
status, carol_common = request("GET", f"/api/clients/common?companyId={alpha['id']}", token=tokens["carol"])
carol_group = next((g for g in (carol_common or []) if g.get("ntn") == shared_ntn), None)
check("Common tenant scoping", "carol (Alpha+Beta) DOES see the shared entity as a Common Client",
      status == 200 and carol_group is not None and carol_group.get("companyCount") == 2,
      f"expected companyCount=2, got {status} {carol_group}")
check("Common tenant scoping", "carol's card names both her companies",
      carol_group is not None
      and {alpha["name"], beta["name"]} <= set(carol_group.get("companyNames") or []),
      f"expected both names, got {(carol_group or {}).get('companyNames')}")

status, carol_sup_common = request("GET", f"/api/suppliers/common?companyId={beta['id']}", token=tokens["carol"])
carol_sup_group = next((g for g in (carol_sup_common or []) if g.get("ntn") == shared_ntn), None)
check("Common tenant scoping", "carol DOES see the shared entity as a Common Supplier",
      status == 200 and carol_sup_group is not None and carol_sup_group.get("companyCount") == 2,
      f"expected companyCount=2, got {status} {carol_sup_group}")

# bob mirrors alice from the other side — confirms the rule is "reachable
# member count", not something accidentally keyed to Alpha.
status, bob_common = request("GET", f"/api/clients/common?companyId={beta['id']}", token=tokens["bob"])
bob_leaked = [g for g in (bob_common or []) if g.get("ntn") == shared_ntn]
check("Common tenant scoping", "bob (Beta only) does NOT see the shared entity",
      status == 200 and not bob_leaked, f"expected no match, got {status} {bob_leaked}")
bob_named = {n for g in (bob_common or []) for n in (g.get("companyNames") or [])}
check("Common tenant scoping", "bob sees no Alpha company name",
      alpha["name"] not in bob_named, f"leaked company names: {sorted(bob_named)}")

# A group living ENTIRELY outside the caller's access must 404 — not 200 with
# an empty member list, and not 403. A foreign group has to be
# indistinguishable from one that never existed.
foreign_ntn = "5566771"
status, beta_only_client = request("POST", "/api/clients", token=admin, body={
    "companyId": beta["id"], "name": "Beta Only Entity", "phone": "+92-22-2222222",
    "site": "Multan", "ntn": foreign_ntn, "cnic": "0000003000003",
    "strn": "0000003000003", "registrationType": "Registered",
})
assert status in (200, 201), f"seed beta-only client: {status} {beta_only_client}"
status, beta_only_sup = request("POST", "/api/suppliers", token=admin, body={
    "companyId": beta["id"], "name": "Beta Only Entity", "phone": "+92-22-2222222",
    "ntn": foreign_ntn, "strn": "0000003000003",
})
assert status in (200, 201), f"seed beta-only supplier: {status} {beta_only_sup}"

# admin can enumerate every group, so use that to learn the foreign group id.
status, all_client_groups = request("GET", "/api/clients/groups", token=admin)
foreign_cgroup = next((g for g in (all_client_groups or []) if g.get("ntn") == foreign_ntn), None)
status, all_sup_groups = request("GET", "/api/suppliers/groups", token=admin)
foreign_sgroup = next((g for g in (all_sup_groups or []) if g.get("ntn") == foreign_ntn), None)

check("Common tenant scoping", "admin can resolve the Beta-only group ids",
      foreign_cgroup is not None and foreign_sgroup is not None,
      f"client={foreign_cgroup} supplier={foreign_sgroup}")

if foreign_cgroup:
    status, _ = request("GET", f"/api/clients/common/{foreign_cgroup['groupId']}", token=tokens["alice"])
    status_check("Common tenant scoping",
                 "alice -> GET /clients/common/{beta-only group} is 404", status, 404)
if foreign_sgroup:
    status, _ = request("GET", f"/api/suppliers/common/{foreign_sgroup['groupId']}", token=tokens["alice"])
    status_check("Common tenant scoping",
                 "alice -> GET /suppliers/common/{beta-only group} is 404", status, 404)

# ...and the Beta-only group must not surface in alice's group list at all.
status, alice_groups2 = request("GET", "/api/clients/groups", token=tokens["alice"])
check("Common tenant scoping", "alice /clients/groups omits the Beta-only group",
      status == 200 and not any(g.get("ntn") == foreign_ntn for g in (alice_groups2 or [])),
      "Beta-only group leaked into alice's group list")

request("DELETE", f"/api/suppliers/{beta_only_sup['id']}", token=admin)
request("DELETE", f"/api/clients/{beta_only_client['id']}", token=admin)
for sid in (alpha_sup, beta_sup):
    request("DELETE", f"/api/suppliers/{sid['id']}", token=admin)
for cid in (alpha_shared, beta_shared):
    request("DELETE", f"/api/clients/{cid['id']}", token=admin)

# Cleanup the seed Beta client
request("DELETE", f"/api/clients/{beta_client['id']}", token=admin)


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
