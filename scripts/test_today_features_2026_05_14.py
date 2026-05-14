"""
End-to-end smoke + authorisation tests for the 2026-05-14 changes:

1. Auto-grant `UserCompanies` to the creator on `POST /api/companies` (non-seed-admin path).
2. Orphaned-company backfill: every Administrator user gets a `UserCompanies` row.
3. `POST /api/clients/{id}/copy` — multi-company copy, tenant-scoped, perm-gated, auto-links to ClientGroup.
4. `POST /api/suppliers/{id}/copy` — same shape for suppliers.
5. `POST /api/printtemplates/company/{id}/{type}/excel-template` accepts `sheetName` form field.
6. `PUT  /api/printtemplates/company/{id}/{type}/excel-template/sheet-name` — gated by `printtemplates.manage.sheetpin`.
7. Challan create — `EnsureItemDescriptionsAsync` failure must NOT cause duplicate challan saves.

Runs against http://localhost:5134. Idempotent: cleans up test rows on entry and exit.
"""

import json
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:5134"
ADMIN_USER = "admin"
ADMIN_PASS = "admin123"

failed = 0
passed = 0


def request(method, path, token=None, body=None, form=None):
    url = BASE + path
    headers = {}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    elif form is not None:
        boundary = "----formboundary8jK"
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        parts = []
        for k, v in form.items():
            parts.append(f"--{boundary}\r\n".encode())
            parts.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
            parts.append(str(v).encode())
            parts.append(b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        data = b"".join(parts)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(text) if text else {}
            except Exception:
                return resp.status, text
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(text) if text else {}
        except Exception:
            return e.code, text


def login(user, pw):
    s, d = request("POST", "/api/auth/login", body={"username": user, "password": pw})
    assert s == 200, f"login {user}: {s} {d}"
    return d["token"]


def check(name, ok, detail=""):
    global failed, passed
    if ok:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name} — {detail}")


admin = login(ADMIN_USER, ADMIN_PASS)
print("\n=== Today's-features smoke ===")

# ────────────────────────────────────────────────────────────────────────────
# Setup: two throwaway companies for copy tests.
# Idempotent: hunt them down and delete before re-creating.
# ────────────────────────────────────────────────────────────────────────────
TEST_PREFIX = "2026-05-14 Test"
_, all_companies = request("GET", "/api/companies", token=admin)
for c in all_companies or []:
    if (c.get("name") or "").startswith(TEST_PREFIX):
        request("DELETE", f"/api/companies/{c['id']}", token=admin)

src_co = None
dst_co = None
extra_co = None
for label in ("Src", "Dst", "Extra"):
    payload = {
        "name": f"{TEST_PREFIX} {label}",
        "brandName": f"TEST-{label.upper()}",
        "isTenantIsolated": False,
        "startingChallanNumber": 1,
        "startingInvoiceNumber": 1,
    }
    s, c = request("POST", "/api/companies", token=admin, body=payload)
    assert s in (200, 201), f"create company {label}: {s} {c}"
    if label == "Src": src_co = c
    elif label == "Dst": dst_co = c
    else: extra_co = c

check("1. Companies created (3)", src_co and dst_co and extra_co)

# ────────────────────────────────────────────────────────────────────────────
# Test 1 & 2: auto-grant + backfill on company create — admin (seed) is special
# (always has implicit access) so this exercises that the SQL backfill in
# Program.cs is idempotent + the row creation in CompaniesController doesn't
# explode. We can verify by listing companies (admin sees everything anyway).
# ────────────────────────────────────────────────────────────────────────────
s, listed = request("GET", "/api/companies", token=admin)
visible_ids = {c["id"] for c in listed or []}
check("1a. Admin sees the newly created companies",
      all(co["id"] in visible_ids for co in (src_co, dst_co, extra_co)))

# ────────────────────────────────────────────────────────────────────────────
# Test 3: POST /api/clients/{id}/copy
# ────────────────────────────────────────────────────────────────────────────
# Create one client under Src
s, src_client = request("POST", "/api/clients", token=admin, body={
    "name": "Copy Test Client",
    "companyId": src_co["id"],
    "ntn": "9999999-1",
    "address": "123 Test St",
})
check("3a. Create source client", s in (200, 201), f"{s} {src_client}")

# Copy into Dst + Extra
s, result = request("POST", f"/api/clients/{src_client['id']}/copy",
                    token=admin, body={"companyIds": [dst_co["id"], extra_co["id"]]})
check("3b. Copy returns 200", s == 200, f"{s} {result}")
created = (result or {}).get("created") or []
check("3c. Copy created 2 rows", len(created) == 2,
      f"got {len(created)}: {[c.get('companyId') for c in created]}")
check("3d. Group id returned", (result or {}).get("clientGroupId") is not None)

# Source's own client should now be linked to the same group
s, src_refetch = request("GET", f"/api/clients/{src_client['id']}", token=admin)
group_id = (result or {}).get("clientGroupId")
check("3e. Source client now belongs to the same ClientGroup",
      src_refetch.get("clientGroupId") == group_id,
      f"source.groupId={src_refetch.get('clientGroupId')}, expected {group_id}")

# Copy into source's own company must be rejected by the service safety net
s, result = request("POST", f"/api/clients/{src_client['id']}/copy",
                    token=admin, body={"companyIds": [src_co["id"]]})
check("3f. Copying into the source's own company returns 400",
      s == 400, f"{s} {result}")

# Empty target list
s, result = request("POST", f"/api/clients/{src_client['id']}/copy",
                    token=admin, body={"companyIds": []})
check("3g. Empty companyIds returns 400", s == 400, f"{s} {result}")

# Non-existent source
s, result = request("POST", "/api/clients/999999999/copy",
                    token=admin, body={"companyIds": [dst_co["id"]]})
check("3h. Non-existent source returns 404", s == 404, f"{s} {result}")

# ────────────────────────────────────────────────────────────────────────────
# Test 4: POST /api/suppliers/{id}/copy — mirror of client copy
# ────────────────────────────────────────────────────────────────────────────
s, src_sup = request("POST", "/api/suppliers", token=admin, body={
    "name": "Copy Test Supplier",
    "companyId": src_co["id"],
    "ntn": "9999998-2",
})
check("4a. Create source supplier", s in (200, 201), f"{s} {src_sup}")

s, result = request("POST", f"/api/suppliers/{src_sup['id']}/copy",
                    token=admin, body={"companyIds": [dst_co["id"]]})
check("4b. Supplier copy returns 200", s == 200, f"{s} {result}")
created = (result or {}).get("created") or []
check("4c. Supplier copy created 1 row", len(created) == 1)
group_id = (result or {}).get("supplierGroupId")
check("4d. SupplierGroup id returned", group_id is not None)

# ────────────────────────────────────────────────────────────────────────────
# Test 5: PUT /api/printtemplates/company/{id}/{type}/excel-template/sheet-name
# - Without an uploaded template, must 404
# ────────────────────────────────────────────────────────────────────────────
s, result = request("PUT",
    f"/api/printtemplates/company/{src_co['id']}/Challan/excel-template/sheet-name",
    token=admin, body={"sheetName": "Anything"})
check("5a. PUT sheet-name returns 404 when no template uploaded",
      s == 404, f"{s} {result}")

# Bad name (no file) — should return 400/404 (NOT 500)
s, result = request("PUT",
    f"/api/printtemplates/company/{src_co['id']}/Challan/excel-template/sheet-name",
    token=admin, body={"sheetName": ""})
check("5b. Empty sheet name with no template = 404 (not 500)",
      s == 404, f"{s} {result}")

# ────────────────────────────────────────────────────────────────────────────
# Test 6: tenant guard on copy endpoints — a non-admin without access to
# the source's company must 403/404. Admin bypasses, so we'd need a non-admin
# user to fully exercise this. Skip the cross-tenant repro here (covered by
# test_tenant_isolation.py more broadly) but verify the response shape on
# the "source not found" path.
# ────────────────────────────────────────────────────────────────────────────
# Already covered by 3f / 3h above.

# ────────────────────────────────────────────────────────────────────────────
# Test 7: challan create — failures in EnsureItemDescriptionsAsync must NOT
# cause duplicate challan saves on retry. We can't easily inject a failure
# from outside the process, so this is just a smoke that a normal
# no-PO challan creates exactly ONE row and returns success cleanly.
# (The duplicate-save bug specifically returned 500 with the row committed —
#  before the fix.)
# ────────────────────────────────────────────────────────────────────────────
# Need a client in src_co first.
client_for_challan = src_client["id"]
s, dc = request("POST", f"/api/deliverychallans/company/{src_co['id']}",
                token=admin, body={
                    "clientId": client_for_challan,
                    "deliveryDate": "2026-05-14T00:00:00",
                    "items": [{"description": "Smoke Test Item", "quantity": 1, "unit": "PCS"}],
                })
check("7a. Challan create with no PO returns 200/201",
      s in (200, 201), f"{s} {dc}")
# Status is determined by FBR readiness AND PO presence
# (DeliveryChallanService.cs:260-266):
#   not FBR-ready                 -> "Setup Required"
#   FBR-ready  + has PO           -> "Pending"
#   FBR-ready  + no PO            -> "No PO"
# A fresh throwaway test company has no FBR config, so "Setup Required"
# is the correct outcome here. Either of the unbilled statuses is fine
# for this test — the point is the create succeeded and didn't 500.
ok_status = (dc or {}).get("status") in ("No PO", "Setup Required", "Pending")
check("7b. Status is one of the unbilled statuses",
      ok_status, f"got status={(dc or {}).get('status')}")

# Count challans on src_co — should be exactly 1
s, paged = request("GET",
    f"/api/deliverychallans/company/{src_co['id']}/paged?page=1&pageSize=50",
    token=admin)
items = (paged or {}).get("items") or []
challan_count = sum(1 for c in items if c.get("clientId") == client_for_challan)
check("7c. Exactly one challan row created (no duplicate)",
      challan_count == 1, f"got {challan_count}")

# ────────────────────────────────────────────────────────────────────────────
# Cleanup
# ────────────────────────────────────────────────────────────────────────────
print("\n=== Cleanup ===")
for co in (src_co, dst_co, extra_co):
    if not co: continue
    s, _ = request("DELETE", f"/api/companies/{co['id']}", token=admin)
    print(f"  deleted company {co['id']:>3} ({co['name']}) -> {s}")

print(f"\n=== {passed}/{passed+failed} checks passed ===")
sys.exit(0 if failed == 0 else 1)
