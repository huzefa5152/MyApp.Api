"""
Adds 3 Registered demo clients to the demo company so SN001 (Wholesale
B2B Registered → Registered) can be demonstrated on stage.

NTNs are real (verified to validate on PRAL sandbox), but brand names
and addresses are anonymized so the recording doesn't expose the
underlying business identities. The NTN by itself is public information
(FBR exposes it via STATL), so this is a fair compromise.

Then creates one SN001 bill against the first registered buyer and
validates it against PRAL. Optionally submits it to capture a real IRN.

Run AFTER:
  • Backend up at localhost:5134
  • Demo company id=1 already wired with bound sandbox token + seller NTN

Usage:  python scripts/seed_demo_registered_clients.py
"""
from __future__ import annotations
import json, sys
from datetime import datetime
from urllib import request as urlreq, error as urlerr

BASE = "http://localhost:5134"
COMPANY_ID = 1
SINDH = 8

# Real, PRAL-verified NTNs but with anonymized branding for the demo.
# Each is the seller-facing record the operator picks when issuing an
# SN001 bill — the NTN is what PRAL checks against IRIS, the rest is
# cosmetic on the bill PDF.
REGISTERED_CLIENTS = [
    {
        "name":             "Industrial Buyer Co. (Pvt) Ltd.",
        "address":          "Industrial Trading Estate, Karachi",
        "phone":            "+92-21-44444444",
        "ntn":              "0710818-04",
        "strn":             "02-03-2100-001-82",
        "registrationType": "Registered",
        "fbrProvinceCode":  SINDH,
        "site":             "HQ",
    },
    {
        "name":             "Manufacturing Solutions (Pvt) Ltd.",
        "address":          "SITE Industrial Area, Karachi",
        "phone":            "+92-21-55555555",
        "ntn":              "8655568-8",
        "strn":             "3277876354879",
        "registrationType": "Registered",
        "fbrProvinceCode":  SINDH,
        "site":             "Plant 1",
    },
    {
        "name":             "Trading Partners (Pvt) Ltd.",
        "address":          "F.B. Industrial Area, Karachi",
        "phone":            "+92-21-66666666",
        "ntn":              "0676893-8",
        "strn":             "11-00-6001-010-73",
        "registrationType": "Registered",
        "fbrProvinceCode":  SINDH,
        "site":             "Warehouse",
    },
]

def _req(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token: headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urlreq.Request(BASE + path, method=method, data=data, headers=headers)
    try:
        with urlreq.urlopen(req, timeout=60) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else None)
    except urlerr.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw

def login():
    code, body = _req("POST", "/api/auth/login",
                      {"username": "admin", "password": "admin123"})
    if code != 200 or "token" not in (body or {}):
        sys.exit(f"Login failed: {code} {body}")
    return body["token"]

def main():
    token = login()
    today = datetime.utcnow().date()

    # Skip clients that already exist by NTN — script is idempotent.
    code, existing = _req("GET", f"/api/clients/company/{COMPANY_ID}", token=token)
    existing_ntns = {(c.get("ntn") or "").strip() for c in (existing or [])}
    print(f"Existing clients on company {COMPANY_ID}: {len(existing or [])}")

    created_ids = []
    for cl in REGISTERED_CLIENTS:
        if cl["ntn"] in existing_ntns:
            print(f"  · skip (already exists): {cl['name']} (NTN {cl['ntn']})")
            continue
        payload = {**cl, "companyId": COMPANY_ID}
        code, body = _req("POST", "/api/clients", payload, token)
        if code not in (200, 201):
            print(f"  ! failed to create {cl['name']}: {code} {body}")
            continue
        created_ids.append(body["id"])
        print(f"  + created id={body['id']}  {body['name']}  (NTN {body['ntn']})")

    # Pick the first registered client to bill against
    code, all_clients = _req("GET", f"/api/clients/company/{COMPANY_ID}", token=token)
    first_registered = next(
        (c for c in (all_clients or [])
         if (c.get("registrationType") or "").lower() == "registered"
         and c["id"] in created_ids),
        None,
    )
    if not first_registered:
        first_registered = next(
            (c for c in (all_clients or []) if (c.get("registrationType") or "").lower() == "registered"),
            None,
        )
    if not first_registered:
        sys.exit("No Registered client available — re-check the script.")
    print(f"\nBilling against: id={first_registered['id']}  {first_registered['name']}")

    # ── SN001 bill: standard B2B wholesale, 18% GST ─────────────────
    bill_payload = {
        "date": today.isoformat() + "T00:00:00.000Z",
        "companyId": COMPANY_ID,
        "clientId":  first_registered["id"],
        "gstRate":   18,
        "scenarioId": "SN001",
        "documentType": 4,
        "paymentMode":  "Bank Transfer",
        "items": [
            {
                "description": "Pneumatic Solenoid Valve 220VAC 6VA",
                "quantity":    10,
                "uom":         "Numbers, pieces, units",
                "unitPrice":   400,
                "hsCode":      "8481.8090",
                "saleType":    "Goods at Standard Rate (default)",
            }
        ],
    }
    code, b = _req("POST", "/api/invoices/standalone", bill_payload, token)
    if code not in (200, 201):
        sys.exit(f"SN001 bill create failed: {code} {b}")
    print(f"  Bill #{b['invoiceNumber']} (id={b['id']}) created — Rs. {b['grandTotal']:,.2f}")

    # ── Validate against PRAL ──
    code, vres = _req("POST", f"/api/fbr/{b['id']}/validate", token=token)
    ok = vres.get("success") if isinstance(vres, dict) else False
    if ok:
        print(f"  ✓ SN001 validation: PASSED on PRAL sandbox")
    else:
        msg = (vres.get("errorMessage") if isinstance(vres, dict) else str(vres)) or "(unknown)"
        print(f"  ✗ SN001 validation: {msg[:300]}")
        sys.exit(1)

    # Leave it Validated (not Submitted) so the operator can click Submit
    # live during the recording and watch a real IRN come back.
    print()
    print("─" * 70)
    print("Registered clients seeded. SN001 demo bill validated, ready to submit.")
    print("─" * 70)
    return 0

if __name__ == "__main__":
    sys.exit(main())
