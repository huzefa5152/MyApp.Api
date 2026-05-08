"""
Create a single sandbox company that qualifies for every FBR scenario
SN001-SN028 by listing every Business Activity and every Sector in its
profile. The §10 matrix in TaxScenarios.cs walks every (Activity ×
Sector) pair, so a company with all activities + all sectors hits every
applicable SN.

The company is created via the regular POST /api/companies endpoint as
the seed admin, then its applicability is verified through
GET /api/fbr/scenarios/applicable/{companyId} — must return 28 distinct
scenarios.

Re-run safe: deletes any existing company with the same name first.

Usage:
  python scripts/create_sandbox_all_scenarios_company.py
"""
from __future__ import annotations
import json, sys, urllib.request, urllib.error

BASE = "http://localhost:5134"
COMPANY_NAME = "Sandbox — All Scenarios (SN001–SN028)"

# Verbatim from TaxScenarios.cs Act* / Sec* constants. Order mirrors the
# §10 spec so the comma-separated profile reads predictably.
ACTIVITIES = [
    "Manufacturer", "Importer", "Distributor", "Wholesaler",
    "Exporter", "Retailer", "Service Provider", "Other",
]
SECTORS = [
    "All Other Sectors", "Steel", "FMCG", "Textile", "Telecom",
    "Petroleum", "Electricity Distribution", "Gas Distribution",
    "Services", "Automobile", "CNG Stations", "Pharmaceuticals",
    "Wholesale / Retails",
]


def request(method: str, path: str, token: str | None = None, body=None):
    url = BASE + path
    data = None
    headers = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
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
            payload = json.loads(raw) if raw else None
        except Exception:
            payload = raw
        return e.code, payload


def login(username: str, password: str) -> str:
    status, data = request("POST", "/api/auth/login", body={"username": username, "password": password})
    if status != 200:
        raise SystemExit(f"login failed: {status} {data}")
    return data["token"]


def main() -> int:
    print("=== Logging in as admin ===")
    admin = login("admin", "admin123")

    print("=== Removing any existing sandbox company with this name ===")
    status, all_companies = request("GET", "/api/companies", token=admin)
    if status != 200:
        print(f"  could not list companies: {status} {all_companies}")
        return 1
    for c in (all_companies or []):
        if c.get("name") == COMPANY_NAME:
            s, _ = request("DELETE", f"/api/companies/{c['id']}", token=admin)
            print(f"  removed leftover id={c['id']} ({s})")

    print(f"\n=== Creating '{COMPANY_NAME}' with all activities + all sectors ===")
    payload = {
        "name": COMPANY_NAME,
        "brandName": "Sandbox All-SN",
        "fullAddress": "FBR Sandbox HQ, Karachi",
        "phone": "+92-21-12345678",
        # Use placeholder NTN/CNIC/STRN; FBR sandbox doesn't enforce real values
        # for non-submitted companies (token still needs to be set before
        # actual Validate / Submit calls).
        "ntn": "1234567",
        "cnic": "1234567890123",
        "strn": "1234567890123",
        "startingChallanNumber": 9001,
        "startingInvoiceNumber": 9001,
        "startingPurchaseBillNumber": 9001,
        "startingGoodsReceiptNumber": 9001,
        "fbrEnvironment": "sandbox",
        "fbrProvinceCode": 8,  # Sindh
        # The profile that unlocks every scenario — the §10 matrix walks
        # every (activity × sector) pair, so listing all 8 × 13 = 104 cells
        # collectively cover every SN001–SN028.
        "fbrBusinessActivity": ",".join(ACTIVITIES),
        "fbrSector": ",".join(SECTORS),
        # Sensible defaults for line-level fallbacks during Validate / Submit
        "fbrDefaultSaleType": "Goods at Standard Rate (default)",
        "fbrDefaultUOM": "Numbers, pieces, units",
        "fbrDefaultPaymentModeRegistered": "Credit",
        "fbrDefaultPaymentModeUnregistered": "Cash",
        # Mark it isolated so it doesn't pollute open-mode listings for
        # non-admin users. Seed admin still bypasses.
        "isTenantIsolated": True,
    }
    status, created = request("POST", "/api/companies", token=admin, body=payload)
    if status not in (200, 201):
        print(f"  CREATE failed: {status} {created}")
        return 1
    company_id = created["id"]
    print(f"  + id={company_id}  {created['name']}")
    print(f"     activities: {created.get('fbrBusinessActivity')}")
    print(f"     sectors:    {created.get('fbrSector')}")

    print(f"\n=== Verifying scenario coverage via /api/fbr/scenarios/applicable/{company_id} ===")
    status, applicable = request("GET", f"/api/fbr/scenarios/applicable/{company_id}", token=admin)
    if status != 200:
        print(f"  applicability fetch failed: {status} {applicable}")
        return 1
    count = applicable.get("count", 0)
    codes = [s["code"] for s in applicable.get("scenarios", [])]
    expected = {f"SN{i:03d}" for i in range(1, 29)}
    actual = set(codes)
    missing = expected - actual
    extra = actual - expected

    print(f"  count: {count}")
    print(f"  codes: {', '.join(sorted(codes))}")
    if missing:
        print(f"  [FAIL] missing: {sorted(missing)}")
    if extra:
        print(f"  [WARN] extra:   {sorted(extra)}")

    if not missing and count == 28:
        print(f"\n[OK] Company id={company_id} covers all 28 FBR scenarios.")
        print(f"     Use it from the FBR Sandbox UI: Configuration -> FBR Sandbox -> pick this company.")
        print(f"     Then click 'Seed' to auto-create one demo bill per applicable SN.")
        return 0
    print(f"\n[FAIL] Coverage incomplete.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
