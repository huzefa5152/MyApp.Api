"""
Seeds the Demo company with FBR-VALIDATABLE bills designed to pass PRAL
sandbox validation/submission against the bound seller NTN.

Each bill uses known-good HS code × sale-type combinations from the
proven SN002 / SN026 / SN027 scenarios, so the operator can demonstrate
Validate → Submit on stage and get a real IRN.

Buyer is the Unregistered Walk-in Retail customer — PRAL doesn't validate
buyer NTN for these scenarios, only the CNIC format. Real registered-buyer
scenarios (SN001) would need a buyer NTN that exists in PRAL's IRIS, which
would reveal a real client.

Run AFTER:
  • Backend up at localhost:5134
  • Demo company id=1 has the real sandbox FBR token + bound seller NTN
  • Existing demo bills + challans wiped

Creates:
  • 1 challan + challan-linked bill   →  SN002, validatable
  • 1 standalone bill (no challan)    →  SN026, validatable
  • 1 standalone bill 3rd Schedule    →  SN027, validatable

Auto-validates each bill against PRAL. Reports per-bill outcome.
"""
from __future__ import annotations
import json, sys, os
from datetime import datetime, timedelta
from urllib import request as urlreq, error as urlerr

BASE = "http://localhost:5134"
COMPANY_ID = 1

# ──────────────────────────────────────────────────────────────────────
# HTTP helpers
# ──────────────────────────────────────────────────────────────────────
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

# ──────────────────────────────────────────────────────────────────────
# Seed
# ──────────────────────────────────────────────────────────────────────
def main():
    token = login()
    today = datetime.utcnow().date()

    # Find Walk-in client (Unregistered, has CNIC) — already seeded by earlier script
    code, clients = _req("GET", f"/api/clients/company/{COMPANY_ID}", token=token)
    walkin = next((c for c in (clients or []) if c.get("registrationType") == "Unregistered"), None)
    if not walkin:
        sys.exit("Walk-in (Unregistered) client not found. Re-run seed_demo_data.py first.")
    print(f"Walk-in buyer: id={walkin['id']} cnic={walkin.get('cnic')}")

    # We'll need the bills to use SPECIFIC HS codes / sale types regardless
    # of any ItemType catalog row. The CreateInvoice / CreateStandaloneInvoice
    # DTOs accept hsCode/saleType directly on each item, overriding catalog.

    # ── Bill A: standalone, scenario SN002 ──────────────────────────
    # Originally tried challan-linked here, but the Walk-in client is
    # Unregistered (no NTN) → challans land in 'Setup Required' which
    # blocks bill creation. Standalone bypasses the challan readiness
    # check and PRAL accepts SN002 without a registered buyer NTN.
    print()
    print("─── Bill A: standalone (no challan), scenario SN002 ───")
    bill_a_payload = {
        "date": today.isoformat() + "T00:00:00.000Z",
        "companyId": COMPANY_ID,
        "clientId":  walkin["id"],
        "gstRate":   18,
        "paymentTerms": "[SN002] Goods at Standard Rate to Unregistered Buyer",
        "documentType": 4,
        "paymentMode":  "Cash",
        "items": [
            {
                "description": "Air Cylinder 10 BAR Pneumatic",
                "quantity":    4,
                "uom":         "Numbers, pieces, units",
                "unitPrice":   6500,
                "hsCode":      "8412.2100",
                "saleType":    "Goods at Standard Rate (default)",
            }
        ],
    }
    code, ba = _req("POST", "/api/invoices/standalone", bill_a_payload, token)
    if code not in (200, 201): sys.exit(f"Bill A create failed: {code} {ba}")
    print(f"  Bill #{ba['invoiceNumber']} (id={ba['id']}) created — Rs. {ba['grandTotal']:,.2f}")

    # ── Bill B: standalone, SN026 (Walk-in Retail Standard Rate) ─────
    # SN026 uses the same HS-code × sale-type pairing as SN002 — using
    # 8412.2100 (Air Cylinder) instead of 7411.1000 (Brass Fitting)
    # because PRAL's current HS×SaleType matrix rejects 7411.x for
    # SN026 (error 0052).
    print()
    print("─── Bill B: standalone (no challan), scenario SN026 ───")
    bill_b_payload = {
        "date": today.isoformat() + "T00:00:00.000Z",
        "companyId": COMPANY_ID,
        "clientId":  walkin["id"],
        "gstRate":   18,
        "paymentTerms": "[SN026] End Consumer Retail, Standard Rate",
        "documentType": 4,
        "paymentMode":  "Cash",
        "items": [
            {
                "description": "Pneumatic Solenoid Valve 220VAC",
                "quantity":    2,
                "uom":         "Numbers, pieces, units",
                "unitPrice":   1800,
                "hsCode":      "8481.8090",
                "saleType":    "Goods at Standard Rate (default)",
            }
        ],
    }
    code, bb = _req("POST", "/api/invoices/standalone", bill_b_payload, token)
    if code not in (200, 201): sys.exit(f"Bill B create failed: {code} {bb}")
    print(f"  Bill #{bb['invoiceNumber']} (id={bb['id']}) created — Rs. {bb['grandTotal']:,.2f}")

    # ── Bill C: standalone, SN027 (Walk-in 3rd Schedule MRP) ─────────
    print()
    print("─── Bill C: standalone (no challan), scenario SN027 (3rd Schedule) ───")
    bill_c_payload = {
        "date": today.isoformat() + "T00:00:00.000Z",
        "companyId": COMPANY_ID,
        "clientId":  walkin["id"],
        "gstRate":   18,
        "paymentTerms": "[SN027] End Consumer Retail, 3rd Schedule (MRP × Qty)",
        "documentType": 4,
        "paymentMode":  "Cash",
        "items": [
            {
                # PRAL's HS×UoM map for 3923.3090 currently allows KG only —
                # the lubricant pack is sold by net weight, not volume, so
                # we use KG. Quantity is per-bottle weight × pack count.
                "description": "Branded Lubricant 1KG Pack (3rd Schedule, MRP Rs. 1180)",
                "quantity":    2,
                "uom":         "KG",
                "unitPrice":   1000,
                "hsCode":      "3923.3090",
                "saleType":    "3rd Schedule Goods",
                "fixedNotifiedValueOrRetailPrice": 2360,  # 1180 × 2
            }
        ],
    }
    code, bc = _req("POST", "/api/invoices/standalone", bill_c_payload, token)
    if code not in (200, 201): sys.exit(f"Bill C create failed: {code} {bc}")
    print(f"  Bill #{bc['invoiceNumber']} (id={bc['id']}) created — Rs. {bc['grandTotal']:,.2f}")

    # ── Validate each against PRAL sandbox ──────────────────────────
    print()
    print("══════════════ PRAL Sandbox Validation ══════════════")
    for label, invoice, scen in [
        ("Bill A — SN002", ba, "SN002"),
        ("Bill B — SN026", bb, "SN026"),
        ("Bill C — SN027", bc, "SN027"),
    ]:
        code, res = _req("POST", f"/api/fbr/{invoice['id']}/validate?scenarioId={scen}", token=token)
        ok = res.get("success") if isinstance(res, dict) else False
        if ok:
            print(f"  ✓ {label} (#{invoice['invoiceNumber']}): PASSED FBR validation")
        else:
            err = (res.get("errorMessage") if isinstance(res, dict) else str(res)) or "(unknown)"
            print(f"  ✗ {label} (#{invoice['invoiceNumber']}): {err[:200]}")

    print()
    print("─" * 70)
    print("Demo data ready. Login: admin / admin123")
    print("─" * 70)
    print()
    print("On the Bills page, the bills above will show 'FBR: Ready to Validate'.")
    print("During the demo:")
    print("  • Click 'Validate' on a bill — PRAL replies success")
    print("  • Click 'Submit FBR' — PRAL issues a real sandbox IRN")
    print()
    print("Note: each scenario tag (e.g. [SN002]) is in PaymentTerms — the")
    print("FbrService picks it up automatically so no scenario picker is needed")
    print("when clicking the per-bill Validate / Submit buttons.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
