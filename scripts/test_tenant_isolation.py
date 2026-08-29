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
import json, os, sys, uuid, urllib.request, urllib.error
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


def request_bytes(method: str, path: str, token: str | None = None) -> tuple[int, bytes]:
    """Like request() but returns raw bytes — for binary downloads and the
    static-file 404 probe (which must not be JSON-decoded)."""
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, (e.read() if e.fp else b"")


def upload_file(path: str, token: str | None, filename: str, content: bytes,
                content_type: str, fields: dict | None = None) -> tuple[int, Any]:
    """multipart/form-data POST of a single 'file' field plus optional form
    fields (folderId / entityType / entityId)."""
    boundary = "----pyform" + uuid.uuid4().hex
    chunks: list[bytes] = []
    for k, v in (fields or {}).items():
        chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    chunks.append(
        (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
         f"Content-Type: {content_type}\r\n\r\n").encode() + content + b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    body = b"".join(chunks)
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
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
admin = login(os.environ.get("MYAPP_ADMIN_USER", "admin"), os.environ.get("MYAPP_ADMIN_PW", "admin123"))

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
        # Pin the legacy company config so this tenant-isolation suite is
        # unaffected by the new-company create defaults (FBR-off, inventory-on
        # V2, GL-on): it seeds unclassified sales-order/bill lines to probe
        # access control, which a V2 company would reject on classification.
        "fbrEnabled": True,
        "inventoryTrackingEnabled": False,
        "inventoryFlowVersion": 1,
        "enableGl": False,
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
    ("GET",  "/api/salesquotes/company/{cid}/paged"),
    ("GET",  "/api/salesorders/company/{cid}/paged"),
    ("GET",  "/api/salesorders/company/{cid}/open"),
    ("GET",  "/api/stock/company/{cid}/onhand"),
    ("GET",  "/api/stock/company/{cid}/movements"),
    ("GET",  "/api/stock/company/{cid}/opening"),
    ("GET",  "/api/fbr/sandbox/{cid}"),
    ("GET",  "/api/fbr/scenarios/applicable/{cid}"),
    ("GET",  "/api/fbr/uom/{cid}"),
    ("GET",  "/api/printtemplates/company/{cid}"),
    ("GET",  "/api/folders/company/{cid}"),
    ("GET",  "/api/folders/company/{cid}/paged"),
    ("GET",  "/api/attachments/company/{cid}/entity/SalesQuote/1"),
    ("GET",  "/api/attachments/company/{cid}/folder/1"),
    # Payments / Receipts (AR/AP subledger — design §11.5).
    ("GET",  "/api/payments/receipts/company/{cid}/paged"),
    ("GET",  "/api/payments/payments/company/{cid}/paged"),
    ("GET",  "/api/payments/company/{cid}/by-invoice/1"),
    ("GET",  "/api/payments/company/{cid}/by-bill/1"),
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

# Cleanup the seed Beta client
request("DELETE", f"/api/clients/{beta_client['id']}", token=admin)

# Suite 7: id-based print-template endpoints — a user cannot touch another
# tenant's template by id. [AuthorizeCompany] only guards the {companyId}
# routes; the {id} routes load the row and assert via ICompanyAccessGuard,
# which throws -> 403. Also covers the cross-tenant DivisionId link guard.
# Added 2026-06-14 with the multiple-templates-per-company/division feature.
print("\n  Suite 7 — id-based print-template tenant guard")
suite = "id-based print-template guard"
# admin seeds a Beta-scoped (company-level) Challan template
status, beta_tpl = request("POST", f"/api/printtemplates/company/{beta['id']}", token=admin, body={
    "templateType": "Challan",
    "name": "Beta DC",
    "htmlContent": "<p>{{challanNumber}}</p>",
    "isDefault": True,
})
assert status in (200, 201), f"seed beta template: {status} {beta_tpl}"
btid = beta_tpl["id"]
# alice (Alpha only) is blocked on every id-based verb against Beta's template
s, _ = request("GET", f"/api/printtemplates/{btid}", token=tokens["alice"])
status_check(suite, "alice GET /printtemplates/{betaId}", s, 403)
s, _ = request("PUT", f"/api/printtemplates/{btid}", token=tokens["alice"], body={"name": "hacked", "htmlContent": "x"})
status_check(suite, "alice PUT /printtemplates/{betaId}", s, 403)
s, _ = request("PUT", f"/api/printtemplates/{btid}/default", token=tokens["alice"])
status_check(suite, "alice PUT /printtemplates/{betaId}/default", s, 403)
s, _ = request("DELETE", f"/api/printtemplates/{btid}", token=tokens["alice"])
status_check(suite, "alice DELETE /printtemplates/{betaId}", s, 403)

# Cross-tenant DivisionId link guard: alice (Alpha) tries to create a template
# under Alpha but scoped to a Beta-owned division -> 400.
status, beta_div = request("POST", f"/api/divisions/company/{beta['id']}", token=admin, body={"name": "Beta Div"})
assert status in (200, 201), f"seed beta division: {status} {beta_div}"
s, _ = request("POST", f"/api/printtemplates/company/{alpha['id']}", token=tokens["alice"], body={
    "templateType": "Challan",
    "divisionId": beta_div["id"],
    "name": "cross-tenant",
    "htmlContent": "<p>x</p>",
})
status_check(suite, "alice POST /printtemplates (alpha + beta-owned division)", s, 400)

# Seed template is cascade-cleaned when Beta is deleted, but remove it now too.
request("DELETE", f"/api/printtemplates/{btid}", token=admin)


# Suite 8: Folders + Attachments — id-based tenant guard + upload validation +
# the security rule that stored bytes are NOT publicly served. Added with the
# unified attachment/folder feature (2026-06-16). admin (seed) performs the
# allowed writes; alice (Alpha only, Administrator RBAC) proves the tenant
# guard on Beta-owned rows.
print("\n  Suite 8 — folders + attachments tenant guard + validation")
suite8 = "folders + attachments"

status, beta_folder = request("POST", f"/api/folders/company/{beta['id']}", token=admin,
                              body={"name": "Beta Docs", "description": "iso test"})
status_check(suite8, "admin create Beta folder", status, 201)
bfid = beta_folder["id"] if isinstance(beta_folder, dict) else None

# alice (Alpha only) is blocked on Beta's folder by id (load-then-assert path)
s, _ = request("GET", f"/api/folders/{bfid}", token=tokens["alice"]); status_check(suite8, "alice GET /folders/{betaId}", s, 403)
s, _ = request("PUT", f"/api/folders/{bfid}", token=tokens["alice"], body={"name": "hacked"}); status_check(suite8, "alice PUT /folders/{betaId}", s, 403)
s, _ = request("DELETE", f"/api/folders/{bfid}", token=tokens["alice"]); status_check(suite8, "alice DELETE /folders/{betaId}", s, 403)

# alice cannot upload into Beta (companyId-route guard)
s, _ = upload_file(f"/api/attachments/company/{beta['id']}", tokens["alice"], "x.pdf", b"%PDF-1.4 x", "application/pdf", {"folderId": bfid})
status_check(suite8, "alice upload into Beta", s, 403)

# admin uploads a valid PDF into the Beta folder
s, att = upload_file(f"/api/attachments/company/{beta['id']}", admin, "spec.pdf", b"%PDF-1.4\n% minimal pdf\n", "application/pdf", {"folderId": bfid})
status_check(suite8, "admin upload valid PDF", s, 200)
aid = att["id"] if isinstance(att, dict) else None

# Validator: blocked extension + magic-byte mismatch must 400
s, _ = upload_file(f"/api/attachments/company/{beta['id']}", admin, "evil.exe", b"MZ\x90\x00", "application/octet-stream")
status_check(suite8, "reject .exe (extension)", s, 400)
s, _ = upload_file(f"/api/attachments/company/{beta['id']}", admin, "page.html", b"<html></html>", "text/html")
status_check(suite8, "reject .html (extension)", s, 400)
s, _ = upload_file(f"/api/attachments/company/{beta['id']}", admin, "fake.pdf", b"NOT-A-PDF-AT-ALL", "application/pdf")
status_check(suite8, "reject .pdf with wrong magic bytes", s, 400)

# Listing returns exactly the one valid upload
s, lst = request("GET", f"/api/attachments/company/{beta['id']}/folder/{bfid}", token=admin)
check(suite8, "admin list folder attachments == 1", s == 200 and isinstance(lst, list) and len(lst) == 1, f"status {s}, body {lst}")

if aid:
    # id-based guards: alice 403 on download + delete of Beta's attachment
    s, _ = request("GET", f"/api/attachments/{aid}/download", token=tokens["alice"]); status_check(suite8, "alice download Beta attachment", s, 403)
    s, _ = request("DELETE", f"/api/attachments/{aid}", token=tokens["alice"]); status_check(suite8, "alice delete Beta attachment", s, 403)
    # admin downloads it: 200 + real PDF bytes
    s, raw = request_bytes("GET", f"/api/attachments/{aid}/download", admin)
    check(suite8, "admin download (200 + %PDF bytes)", s == 200 and raw[:4] == b"%PDF", f"status {s}, head {raw[:8]!r}")

# Security: stored bytes must NOT be reachable via the public /data static provider
s, _ = request_bytes("GET", "/data/attachments/1/2026/06/whatever.pdf")
status_check(suite8, "/data/attachments static path blocked", s, 404)

# Cleanup (Attachment->Company is Restrict, so remove the attachment + folder
# before the company-cleanup loop below can delete Beta).
if aid:
    request("DELETE", f"/api/attachments/{aid}", token=admin)
if bfid:
    request("DELETE", f"/api/folders/{bfid}", token=admin)


# Suite 9: sales-order invoice-prefill — id-based tenant guard. Added
# 2026-07-03 with the "bill from sales order" prefill feature. The route
# loads the order, then asserts access against its stored CompanyId, so a
# user must not be able to read another tenant's order header + price
# history by guessing ids.
print("\n  Suite 9 — sales-order invoice-prefill tenant guard")
suite9 = "salesorder invoice-prefill guard"
status, so_client = request("POST", "/api/clients", token=admin, body={
    "companyId": beta["id"], "name": "Beta SO Client", "phone": "+92-00-0000000",
    "site": "Karachi", "ntn": "0000002", "cnic": "0000002000002",
    "strn": "0000002000002", "registrationType": "Registered",
})
assert status in (200, 201), f"seed beta so client: {status} {so_client}"
status, beta_so = request("POST", f"/api/salesorders/company/{beta['id']}", token=admin, body={
    "clientId": so_client["id"],
    "orderDate": "2026-07-03",
    "items": [{"id": 0, "description": "Prefill Bait", "quantity": 5, "unit": "Numbers, pieces, units"}],
})
assert status in (200, 201), f"seed beta sales order: {status} {beta_so}"
# alice (Alpha only, Administrator RBAC) — RBAC passes, tenant guard must 403
s, _ = request("GET", f"/api/salesorders/{beta_so['id']}/invoice-prefill", token=tokens["alice"])
status_check(suite9, "alice GET /salesorders/{betaId}/invoice-prefill", s, 403)
# admin sees the prefill with the order's line (unit price resolves to 0 —
# no quote, no billing history on a fresh company)
s, prefill = request("GET", f"/api/salesorders/{beta_so['id']}/invoice-prefill", token=admin)
check(suite9, "admin prefill 200 + 1 line",
      s == 200 and isinstance(prefill, dict) and len(prefill.get("lines") or []) == 1,
      f"status {s}, body {prefill}")
# cleanup: order first (client delete would otherwise be restricted)
request("DELETE", f"/api/salesorders/{beta_so['id']}", token=admin)
request("DELETE", f"/api/clients/{so_client['id']}", token=admin)


# Suite 9b: Copy Document — id-based tenant guard (2026-08-28). The copy
# endpoints take no companyId: they load the SOURCE document and assert access
# against its stored CompanyId, so guessing an id must not let a user read
# another tenant's copy options or clone their document into their own books.
print("\n  Suite 9b — Copy Document tenant guard")
suite9b = "document-copy tenant guard"
status, copy_client = request("POST", "/api/clients", token=admin, body={
    "companyId": beta["id"], "name": "Beta Copy Client", "phone": "+92-00-0000000",
    "site": "Karachi", "ntn": "0000003", "cnic": "0000003000003",
    "strn": "0000003000003", "registrationType": "Registered",
})
assert status in (200, 201), f"seed beta copy client: {status} {copy_client}"
status, beta_copy_so = request("POST", f"/api/salesorders/company/{beta['id']}", token=admin, body={
    "clientId": copy_client["id"],
    "orderDate": "2026-08-28",
    "items": [{"id": 0, "description": "Copy Bait", "quantity": 3, "unit": "Numbers, pieces, units"}],
})
assert status in (200, 201), f"seed beta copy order: {status} {beta_copy_so}"

# alice holds Administrator RBAC on Alpha only — every permission check passes,
# so a 403 here can only come from the tenant guard.
s, _ = request("GET", f"/api/documents/SalesOrder/{beta_copy_so['id']}/copy-targets", token=tokens["alice"])
status_check(suite9b, "alice GET copy-targets on beta order", s, 403)
s, _ = request("POST", "/api/documents/copy", token=tokens["alice"], body={
    "sourceType": "SalesOrder", "sourceId": beta_copy_so["id"],
    "destinationType": "SalesOrder", "copyLineItems": True,
    "copyDocumentDetails": True, "copyAttachments": False,
})
status_check(suite9b, "alice POST copy of beta order", s, 403)

# admin (both tenants) sees the options and can copy.
s, targets = request("GET", f"/api/documents/SalesOrder/{beta_copy_so['id']}/copy-targets", token=admin)
check(suite9b, "admin copy-targets 200 + destinations listed",
      s == 200 and isinstance(targets, dict) and len(targets.get("targets") or []) >= 1,
      f"status {s}, body {targets}")
s, copied = request("POST", "/api/documents/copy", token=admin, body={
    "sourceType": "SalesOrder", "sourceId": beta_copy_so["id"],
    "destinationType": "SalesOrder", "copyLineItems": True,
    "copyDocumentDetails": True, "copyAttachments": False,
})
check(suite9b, "admin copy 200 + new number allocated",
      s == 200 and isinstance(copied, dict) and copied.get("number") not in (None, beta_copy_so["salesOrderNumber"]),
      f"status {s}, body {copied}")
if isinstance(copied, dict) and copied.get("id"):
    request("DELETE", f"/api/salesorders/{copied['id']}", token=admin)
request("DELETE", f"/api/salesorders/{beta_copy_so['id']}", token=admin)
request("DELETE", f"/api/clients/{copy_client['id']}", token=admin)


# Suite 10: RBAC access-smoothing (2026-08-10). Proves (a) L1 reference-feed
# co-authorization — a narrow doc-create role reads the lookup PICKERS its
# forms need WITHOUT the module's *.view key; (b) tenant isolation is NOT
# weakened by that relaxation; (c) full read surfaces stay gated; (d) L3
# starter roles were seeded; (e) L4 one-step provisioning works; (f) the L4
# escalation guard blocks smuggled role/company grants.
print("\n  Suite 10 — reference co-authorization + starter roles + provisioning")
s10 = "reference co-authorization"

# Idempotent pre-clean (users first — a role with assigned users can't delete).
status, _ulist = request("GET", "/api/users", token=admin)
for u in (_ulist or []):
    if u["username"] in ("dave_iso", "erin_iso", "frank_iso", "frank_plain_iso", "frank_esc_iso", "frank_esc2_iso"):
        request("DELETE", f"/api/users/{u['id']}", token=admin)
status, _rlist = request("GET", "/api/roles", token=admin)
for r in (_rlist or []):
    if r["name"] in ("IsoTest Doc Creator", "IsoTest User Admin"):
        request("DELETE", f"/api/roles/{r['id']}", token=admin)

# A narrow role: can CREATE sales/purchase docs but holds NONE of the
# *.view / *.list.view keys the lookup pickers were historically gated on.
status, doc_role = request("POST", "/api/roles", token=admin, body={
    "name": "IsoTest Doc Creator",
    "description": "Narrow doc-create role for the co-authorization test",
    "permissionKeys": [
        "salesquotes.manage.create", "challans.manage.create",
        "bills.manage.create", "purchasebills.manage.create",
        "salesquotes.print.view",
    ],
})
assert status in (200, 201), f"create doc role: {status} {doc_role}"

# dave: the narrow role + tenant access to Alpha only (via one-step create).
status, dave = request("POST", "/api/users", token=admin, body={
    "username": "dave_iso", "password": "test1234", "fullName": "Dave Iso",
    "role": "IsoTest Doc Creator", "roleIds": [doc_role["id"]], "companyIds": [alpha["id"]],
})
assert status in (200, 201), f"create dave: {status} {dave}"
dave_tok = login("dave_iso", "test1234")
acid = alpha["id"]

# (a) Co-authorized picker feeds on Alpha — dave has NO *.view keys → 200.
for label, path in [
    ("clients picker",       f"/api/clients/company/{acid}"),
    ("suppliers picker",     f"/api/suppliers/company/{acid}"),
    ("divisions picker",     f"/api/divisions/company/{acid}"),
    ("non-inventory picker", f"/api/noninventoryitems/company/{acid}?activeOnly=true"),
    ("open sales orders",    f"/api/salesorders/company/{acid}/open"),
    ("accounts flat (GL)",   f"/api/accounts/company/{acid}/flat"),
    ("pending challans",     f"/api/deliverychallans/company/{acid}/pending"),
    ("print templates",      f"/api/printtemplates/company/{acid}"),
]:
    s, _ = request("GET", path, token=dave_tok)
    check(s10, f"dave 200 on {label} (co-authorized)", s == 200, f"expected 200, got {s}")

# (c) Full read surfaces still gated on the module's own *.view key → 403.
for label, path in [
    ("clients full list",  "/api/clients"),
    ("clients summary",    f"/api/clients/company/{acid}/summary"),
    ("suppliers full list", "/api/suppliers"),
    ("sales orders paged", f"/api/salesorders/company/{acid}/paged"),
    ("folders list",       f"/api/folders/company/{acid}"),
]:
    s, _ = request("GET", path, token=dave_tok)
    check(s10, f"dave 403 on {label} (view key still required)", s == 403, f"expected 403, got {s}")

# (b) Tenant isolation preserved — co-authorization does NOT let dave read
# another tenant's picker feed (Beta has no UserCompany row for dave → 403).
for label, path in [
    ("clients picker (Beta)",   f"/api/clients/company/{beta['id']}"),
    ("divisions picker (Beta)", f"/api/divisions/company/{beta['id']}"),
    ("pending challans (Beta)", f"/api/deliverychallans/company/{beta['id']}/pending"),
]:
    s, _ = request("GET", path, token=dave_tok)
    check(s10, f"dave 403 on {label} (tenant isolation intact)", s == 403, f"expected 403, got {s}")

# (d) Starter roles seeded (L3): present, non-system, non-empty.
status, all_roles = request("GET", "/api/roles", token=admin)
role_by_name = {r["name"]: r for r in (all_roles or [])}
for name in ["Sales Operator", "FBR Officer", "Bookkeeper", "Inventory Manager", "Accountant", "Read-Only Auditor"]:
    r = role_by_name.get(name)
    check("starter roles", f"'{name}' seeded", r is not None, "role missing")
    if r:
        check("starter roles", f"'{name}' non-system + has perms",
              r.get("isSystemRole") is False and len(r.get("permissionKeys") or []) > 0,
              f"isSystemRole={r.get('isSystemRole')}, perms={len(r.get('permissionKeys') or [])}")

# (e) One-step provisioning (L4): erin gets a starter role + Alpha access in ONE
# call, then works on first login (non-empty perms + non-empty company list).
so_role = role_by_name.get("Sales Operator")
if so_role:
    status, erin = request("POST", "/api/users", token=admin, body={
        "username": "erin_iso", "password": "test1234", "fullName": "Erin Iso",
        "role": "Sales Operator", "roleIds": [so_role["id"]], "companyIds": [alpha["id"]],
    })
    check("one-step provisioning", "create erin (role+company in one call)", status in (200, 201), f"got {status}: {erin}")
    if status in (200, 201):
        erin_tok = login("erin_iso", "test1234")
        s, me = request("GET", "/api/permissions/me", token=erin_tok)
        perms = (me or {}).get("permissions") or []
        check("one-step provisioning", "erin has permissions on first login", s == 200 and len(perms) > 0, f"status {s}, {len(perms)} perms")
        s, cos = request("GET", "/api/companies", token=erin_tok)
        vis = {c["id"] for c in (cos or [])}
        check("one-step provisioning", "erin sees Alpha on first login", s == 200 and acid in vis, f"status {s}, visible {sorted(vis)}")

# (f) Escalation guard (L4): a user-admin WITHOUT tenantaccess.manage.assign /
# rbac.userroles.assign cannot smuggle those grants through the create call.
status, ua_role = request("POST", "/api/roles", token=admin, body={
    "name": "IsoTest User Admin",
    "description": "users.manage.create only — no assign rights",
    "permissionKeys": ["users.manage.create", "users.manage.view"],
})
assert status in (200, 201), f"create ua role: {status} {ua_role}"
status, frank = request("POST", "/api/users", token=admin, body={
    "username": "frank_iso", "password": "test1234", "fullName": "Frank Iso",
    "role": "IsoTest User Admin", "roleIds": [ua_role["id"]], "companyIds": [alpha["id"]],
})
assert status in (200, 201), f"create frank: {status} {frank}"
frank_tok = login("frank_iso", "test1234")
# frank CAN create a plain user (has users.manage.create, no grants attached)…
status, _ = request("POST", "/api/users", token=frank_tok, body={
    "username": "frank_plain_iso", "password": "test1234", "fullName": "Plain", "role": "User",
})
check("provisioning escalation guard", "frank can create a plain user", status in (200, 201), f"got {status}")
# …but NOT one carrying companyIds (needs tenantaccess.manage.assign) → 403…
status, _ = request("POST", "/api/users", token=frank_tok, body={
    "username": "frank_esc_iso", "password": "test1234", "fullName": "Esc", "role": "User",
    "companyIds": [acid],
})
check("provisioning escalation guard", "frank blocked from granting companyIds", status == 403, f"expected 403, got {status}")
# …nor roleIds (needs rbac.userroles.assign) → 403.
status, _ = request("POST", "/api/users", token=frank_tok, body={
    "username": "frank_esc2_iso", "password": "test1234", "fullName": "Esc2", "role": "User",
    "roleIds": [so_role["id"] if so_role else doc_role["id"]],
})
check("provisioning escalation guard", "frank blocked from granting roleIds", status == 403, f"expected 403, got {status}")

# Suite 10 cleanup (users first, then the custom roles).
for uname in ("dave_iso", "erin_iso", "frank_iso", "frank_plain_iso", "frank_esc_iso", "frank_esc2_iso"):
    s__, _u = request("GET", "/api/users", token=admin)
    uu = next((u for u in (_u or []) if u["username"] == uname), None)
    if uu:
        request("DELETE", f"/api/users/{uu['id']}", token=admin)
for rname in ("IsoTest Doc Creator", "IsoTest User Admin"):
    s__, _r = request("GET", "/api/roles", token=admin)
    rr = next((r for r in (_r or []) if r["name"] == rname), None)
    if rr:
        request("DELETE", f"/api/roles/{rr['id']}", token=admin)


# Suite 11: Sales Quote per-line product images (2026-08-11). The upload is
# company-scoped (the photo is picked before the quote exists), so the route
# guard is the only thing standing between tenants — and because the client
# sends the stored path back on save, the quote write must reject any path that
# isn't inside its OWN company's folder. Without that second check a forged
# body could point a line at another tenant's photo, or at an external URL that
# phones home when the customer opens the printed quote.
print("\n  Suite 11 — quote line images: upload guard + stored-path validation")
suite11 = "quote line images"
PNG = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)   # valid magic bytes, junk payload

# alice (Alpha only) must not upload into Beta
s, _ = upload_file(f"/api/companies/{beta['id']}/quote-images", tokens["alice"], "p.png", PNG, "image/png")
status_check(suite11, "alice upload quote image into Beta", s, 403)

# admin uploads into both companies — Alpha's URL becomes the forgery payload
s, alpha_img = upload_file(f"/api/companies/{alpha['id']}/quote-images", admin, "a.png", PNG, "image/png")
status_check(suite11, "admin upload into Alpha", s, 200)
s, beta_img = upload_file(f"/api/companies/{beta['id']}/quote-images", admin, "b.png", PNG, "image/png")
status_check(suite11, "admin upload into Beta", s, 200)
alpha_url = alpha_img.get("url") if isinstance(alpha_img, dict) else None
beta_url = beta_img.get("url") if isinstance(beta_img, dict) else None
check(suite11, "upload returns own-company path",
      bool(beta_url) and f"/company_{beta['id']}/" in beta_url, f"url {beta_url}")

# Validator still applies (renamed non-image → 400)
s, _ = upload_file(f"/api/companies/{beta['id']}/quote-images", admin, "fake.png", b"NOT-AN-IMAGE", "image/png")
status_check(suite11, "reject .png with wrong magic bytes", s, 400)

# Seed a Beta client, then try to save a Beta quote whose line points elsewhere.
status, qi_client = request("POST", "/api/clients", token=admin, body={
    "companyId": beta["id"], "name": "Beta QuoteImage Client", "phone": "+92-00-0000000",
    "site": "Karachi", "ntn": "0000003", "cnic": "0000003000003",
    "strn": "0000003000003", "registrationType": "Registered",
})
assert status in (200, 201), f"seed beta quote-image client: {status} {qi_client}"


def beta_quote_body(image_path):
    return {
        "clientId": qi_client["id"], "date": "2026-08-11", "gstRate": 18,
        "items": [{"id": 0, "description": "Photo line", "quantity": 1,
                   "unit": "Numbers, pieces, units", "unitPrice": 100,
                   "imagePath": image_path}],
    }


for label, forged in (
    ("other tenant's folder", alpha_url),
    ("external URL", "https://evil.example.com/track.png"),
    ("path traversal", f"/data/uploads/quoteitems/company_{beta['id']}/../../../appsettings.json"),
    ("non-image extension", f"/data/uploads/quoteitems/company_{beta['id']}/x.svg"),
):
    s, _ = request("POST", f"/api/salesquotes/company/{beta['id']}", token=admin, body=beta_quote_body(forged))
    status_check(suite11, f"reject quote line image — {label}", s, 400)

# The company's own upload path is accepted and round-trips
s, good_quote = request("POST", f"/api/salesquotes/company/{beta['id']}", token=admin, body=beta_quote_body(beta_url))
check(suite11, "accept own-company image path", s in (200, 201), f"status {s}, body {good_quote}")
if isinstance(good_quote, dict) and good_quote.get("items"):
    check(suite11, "image path round-trips on the saved line",
          good_quote["items"][0].get("imagePath") == beta_url,
          f"got {good_quote['items'][0].get('imagePath')}")
    # …and reaches the print payload with the hasLineImages flag set
    s, pr = request("GET", f"/api/salesquotes/{good_quote['id']}/print", token=admin)
    check(suite11, "print payload exposes imagePath + hasLineImages",
          s == 200 and pr.get("hasLineImages") is True
          and pr["items"][0].get("imagePath") == beta_url,
          f"status {s}, hasLineImages {pr.get('hasLineImages') if isinstance(pr, dict) else pr}")
    # alice must not read Beta's quote print data (id-based guard)
    s, _ = request("GET", f"/api/salesquotes/{good_quote['id']}/print", token=tokens["alice"])
    status_check(suite11, "alice GET /salesquotes/{betaId}/print", s, 403)
    request("DELETE", f"/api/salesquotes/{good_quote['id']}", token=admin)


# ── Suite 12: HS code master (reference data, but companyId-bearing) ──
# The HS master itself is installation-wide and carries no tenant data, so its
# reads take no companyId. The two endpoints that DO accept one — import (which
# may fall back to that company's FBR token) and the per-code UOM lookup — must
# still refuse a company the caller cannot reach, otherwise passing an arbitrary
# id would let a user drive another tenant's FBR credentials.
suite12 = "hs code master"

s, _ = request("POST", "/api/hscodes/import", token=tokens["alice"],
               body={"companyId": beta["id"], "createItemTypes": False})
status_check(suite12, "alice POST /hscodes/import (companyId=Beta)", s, 403)

s, _ = request("GET", f"/api/hscodes/6109.1000/uoms?companyId={beta['id']}", token=tokens["alice"])
status_check(suite12, "alice GET /hscodes/{code}/uoms (companyId=Beta)", s, 403)

# Alice's own company is fine — the guard is about whose token may be used,
# not about locking the tariff away from her.
s, _ = request("GET", f"/api/hscodes/6109.1000/uoms?companyId={alpha['id']}", token=tokens["alice"])
check(suite12, "alice GET uoms for her own company", s in (200, 404), f"got {s}")

# And the plain reads need no company context at all — that is the whole point
# of a shared master: a company with FBR off still searches the tariff.
s, _ = request("GET", "/api/hscodes?search=6109&take=5", token=tokens["alice"])
check(suite12, "alice searches the HS master with no companyId", s == 200, f"got {s}")


# ── Suite 13: receipt-allocate tenant guard (2026-08-30) ──────
# POST /api/receipts/{id}/allocate is id-based, like the print-template and
# copy-document guards above: it loads the payment then asserts access against
# its STORED CompanyId, never a companyId in the body. alice holds Administrator
# RBAC (so accounting.receipts.create passes) but has no UserCompany row for
# Beta, so only the tenant guard can produce the 403 here.
print("\n  Suite 13 — receipt-allocate tenant guard")
suite13a = "receipt-allocate tenant guard"
status, alloc_client = request("POST", "/api/clients", token=admin, body={
    "companyId": beta["id"], "name": "Beta Allocate Client", "phone": "+92-00-0000000",
    "site": "Karachi", "ntn": "0000004", "cnic": "0000004000004",
    "strn": "0000004000004", "registrationType": "Registered",
})
assert status in (200, 201), f"seed beta allocate client: {status} {alloc_client}"

status, beta_receipt = request("POST", f"/api/payments/receipts/company/{beta['id']}", token=admin, body={
    "direction": "Receipt", "date": "2026-08-30", "contactType": "Client",
    "contactId": alloc_client["id"], "method": "Cash", "amount": 500000, "allocations": [],
})
assert status in (200, 201), f"seed beta receipt: {status} {beta_receipt}"

status, its13 = request("GET", "/api/itemtypes", token=admin)
its13_rows = its13 if isinstance(its13, list) else ((its13 or {}).get("items") or (its13 or {}).get("data") or [])
alloc_item_type_id = its13_rows[0]["id"] if its13_rows else None
status, beta_invoice = request("POST", "/api/invoices/standalone", token=admin, body={
    "companyId": beta["id"], "clientId": alloc_client["id"], "date": "2026-08-30", "gstRate": 18,
    "items": [{"description": "Allocate Bait", "quantity": 1, "uom": "Numbers, pieces, units",
               "unitPrice": 100000, "itemTypeId": alloc_item_type_id}],
})
assert status in (200, 201), f"seed beta invoice: {status} {beta_invoice}"

# alice (Alpha only) tries to allocate Beta's own advance to Beta's own invoice —
# both documents are entirely within Beta; only the tenant guard stands between
# her and them.
s, _ = request("POST", f"/api/receipts/{beta_receipt['id']}/allocate", token=tokens["alice"],
               body=[{"invoiceId": beta_invoice["id"], "amount": 50000}])
status_check(suite13a, "alice POST /receipts/{betaReceiptId}/allocate", s, 403)

# admin (both tenants) can allocate it for real — sanity check the guard isn't
# just failing every request outright.
s, allocated = request("POST", f"/api/receipts/{beta_receipt['id']}/allocate", token=admin,
                        body=[{"invoiceId": beta_invoice["id"], "amount": 50000}])
check(suite13a, "admin allocate 200 + unallocatedAmount drops to 450000",
      s == 200 and isinstance(allocated, dict)
      and abs(float(allocated.get("unallocatedAmount", -1)) - 450000) < 0.01,
      f"status {s}, body {allocated}")

# Cleanup (invoice/payment before the client — Restrict FKs).
request("DELETE", f"/api/invoices/{beta_invoice['id']}", token=admin)
request("DELETE", f"/api/payments/receipts/{beta_receipt['id']}", token=admin)
request("DELETE", f"/api/clients/{alloc_client['id']}", token=admin)


# ── Suite 13: bulk client import ─────────────────────────────────────
# The uploaded sheet never carries a company id — it comes from the request —
# so the only thing between a user and another tenant's customer list is the
# guard on that id. Both steps are checked: previewing another tenant's company
# would already leak its client names back through the duplicate verdict.
suite13 = "client import"

csv_bytes = "Name,Address,Phone\r\nIsolation Probe,Addr,021-1\r\n".encode()

s, _ = upload_file(f"/api/clients/import/preview?companyId={beta['id']}", tokens["alice"],
                   "clients.csv", csv_bytes, "text/csv")
status_check(suite13, "alice POST /clients/import/preview (Beta)", s, 403)

s, _ = request("POST", "/api/clients/import/commit", token=tokens["alice"],
               body={"companyId": beta["id"],
                     "rows": [{"rowNumber": 1, "name": "Isolation Probe", "status": "New"}]})
status_check(suite13, "alice POST /clients/import/commit (Beta)", s, 403)

# Her own company is fine — the guard is on whose customer list is touched.
s, _ = upload_file(f"/api/clients/import/preview?companyId={alpha['id']}", tokens["alice"],
                   "clients.csv", csv_bytes, "text/csv")
check(suite13, "alice previews her own company", s == 200, f"got {s}")


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
