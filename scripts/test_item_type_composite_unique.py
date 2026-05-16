"""
Item Type composite-uniqueness + soft-delete regression test.

Verifies the 2026-05-16 rule change:
  • (Name, HSCode) is the catalog identity. Same Name with two different
    HS codes are two valid rows. Same Name + no HS code may coexist with
    same Name + a real HS code.
  • Exact (Name, HSCode) duplicates are blocked at create / update.
  • DELETE soft-deletes (sets IsDeleted=true) when no pending FBR-bound
    work references the row, and re-creating the same pair afterwards
    succeeds (the unique index is filtered to IsDeleted=0).

Production data is never touched — every row is created on a fresh
ephemeral company and torn down on success.

Usage:
  python scripts/test_item_type_composite_unique.py
"""
from __future__ import annotations
import json, sys, urllib.request, urllib.error
from datetime import datetime, timezone
from typing import Any

BASE = "http://localhost:5134"
PASS = "PASS"
results: list[tuple[str, str, str]] = []


def http(method: str, path: str, token: str | None = None, body: Any = None) -> tuple[int, Any]:
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8")
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        try:
            return e.code, json.loads(raw) if raw else None
        except Exception:
            return e.code, raw


def check(name: str, ok: bool, reason: str = "") -> None:
    results.append(("composite-unique", name, PASS if ok else f"FAIL — {reason}"))


def must_status(label: str, status: int, expected: tuple[int, ...]) -> bool:
    ok = status in expected
    check(label, ok, f"expected one of {expected}, got {status}")
    return ok


# ── Setup ─────────────────────────────────────────────────────────
print("\n=== Logging in as admin ===")
status, login = http("POST", "/api/auth/login", body={"username": "admin", "password": "admin123"})
assert status == 200, f"login failed: {status} {login}"
token = login["token"]

print("\n=== Creating ephemeral test company ===")
status, company = http("POST", "/api/companies", token=token, body={
    "name": "Composite-Unique-Test Co",
    "fullAddress": "Test", "phone": "+92-21-00000000",
    "ntn": "0000099", "cnic": "0000099000099", "strn": "0000099000099",
    "startingChallanNumber": 1, "startingInvoiceNumber": 1,
    "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
    "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
})
assert status in (200, 201), f"create company: {status} {company}"
company_id = company["id"]
print(f"  + company id={company_id}")

# Re-usable HS codes from the FBR catalog seeded on first run. These
# are real codes the validator will accept — picking from the seeded
# Defaults guarantees we don't hit the PRAL "unknown code" reject.
hs_a = "9018.9090"
hs_b = "9019.1000"
created_ids: list[int] = []


def create_item(name: str, hs: str | None, *, favorite: bool = False) -> tuple[int, Any]:
    body = {
        "name": name,
        "hsCode": hs,
        "uom": "Numbers, pieces, units",
        "saleType": "Goods at standard rate (default)",
        "isFavorite": favorite,
    }
    return http("POST", f"/api/itemtypes?companyId={company_id}", token=token, body=body)


# ── Tests ─────────────────────────────────────────────────────────
print("\n=== Suite — composite (Name, HSCode) uniqueness ===")

# 1. Create "Hardware Items" + HS A — first instance, must succeed.
status, row1 = create_item("Composite-HW-Items", hs_a)
ok = must_status("create (HW Items, HS_A) — first", status, (200, 201))
if ok:
    created_ids.append(row1["id"])

# 2. Same Name + different HS — composite allows.
status, row2 = create_item("Composite-HW-Items", hs_b)
ok = must_status("create (HW Items, HS_B) — different HS allows duplicate name", status, (200, 201))
if ok:
    created_ids.append(row2["id"])

# 3. Same Name + no HS — distinct (NULL ≠ value), composite allows.
status, row3 = create_item("Composite-HW-Items", None)
ok = must_status("create (HW Items, NULL) — first no-HS row", status, (200, 201))
if ok:
    created_ids.append(row3["id"])

# 4. Same Name + same HS as row1 — composite must reject.
status, _ = create_item("Composite-HW-Items", hs_a)
must_status("create (HW Items, HS_A) — duplicate composite rejected", status, (400,))

# 5. Same Name + no HS again — NULL=NULL for unique, must reject.
status, _ = create_item("Composite-HW-Items", None)
must_status("create (HW Items, NULL) — duplicate no-HS row rejected", status, (400,))

# 6. Different Name + HS_A — composite allows because Name differs.
status, row6 = create_item("Composite-Tools", hs_a)
ok = must_status("create (Tools, HS_A) — different name shares HS allowed", status, (200, 201))
if ok:
    created_ids.append(row6["id"])

# ── Delete + re-create round-trip ──
print("\n=== Suite — delete soft-removes + permits re-create ===")

if row2 is not None and "id" in row2:
    status, _ = http("DELETE", f"/api/itemtypes/{row2['id']}", token=token)
    # No bills / challans reference it → must succeed.
    must_status("DELETE (HW Items, HS_B) with no pending refs", status, (200, 204))

    # Re-create the same pair — filtered unique index permits because the
    # original row is now IsDeleted=1.
    status, recreated = create_item("Composite-HW-Items", hs_b)
    ok = must_status("re-create (HW Items, HS_B) after soft delete", status, (200, 201))
    if ok:
        created_ids.append(recreated["id"])

    # List endpoint must hide the soft-deleted row but show the re-created one.
    status, listing = http("GET", f"/api/itemtypes?companyId={company_id}", token=token)
    ids_in_list = {it["id"] for it in (listing or [])}
    check("list hides soft-deleted row", row2["id"] not in ids_in_list,
          f"soft-deleted id {row2['id']} surfaced in list")
    if ok:
        check("list shows re-created row", recreated["id"] in ids_in_list,
              f"re-created id {recreated['id']} missing from list")

# ── Cleanup ───────────────────────────────────────────────────────
print("\n=== Cleanup ===")
for iid in created_ids:
    http("DELETE", f"/api/itemtypes/{iid}", token=token)
http("DELETE", f"/api/companies/{company_id}", token=token)

# ── Report ────────────────────────────────────────────────────────
print("\n=== Results ===")
fails = [r for r in results if not r[2].startswith(PASS)]
total = len(results)
passed = total - len(fails)
print(f"  {passed}/{total} checks passed")
if fails:
    for _, name, reason in fails:
        print(f"    - {name}: {reason}")
    sys.exit(1)
print("\n[OK]  All composite-unique checks passed.")
