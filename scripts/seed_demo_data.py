"""
Seeds the fresh DigitalInvoicingDemoDb with screen-recording-friendly demo
data: one demo company, four demo clients (3 Registered + 1 Unregistered),
two delivery challans, two challan-linked bills, and one standalone bill.

NTNs / STRNs use placeholder digits — NOT real Hakimi/Roshan / client tax IDs.

Run AFTER the backend is up on http://localhost:5134 and points at the
fresh DigitalInvoicingDemoDb (admin user must be auto-seeded by EF).

Usage:  python scripts/seed_demo_data.py
"""
from __future__ import annotations
import json, sys
from datetime import datetime, timedelta
from urllib import request as urlreq, error as urlerr

BASE = "http://localhost:5134"

# ── Demo seller (replace FbrToken via Company Settings UI before recording) ──
COMPANY = {
    "name":            "Demo Trading Company (Pvt) Ltd.",
    "brandName":       "Demo Trading Co.",
    "fullAddress":     "Plot 100, Industrial Area, Karachi",
    "phone":           "+92-21-99999999",
    "ntn":             "1234567-8",          # placeholder
    "strn":            "9999999999990",      # placeholder
    "startingChallanNumber": 1001,
    "startingInvoiceNumber": 5001,
    "invoiceNumberPrefix":   "DEMO-",
    "fbrProvinceCode":       8,                       # Sindh
    "fbrBusinessActivity":   "Wholesaler",
    "fbrSector":             "Wholesale / Retails",
    "fbrEnvironment":        "sandbox",
    "fbrToken":              "SANDBOX_PLACEHOLDER_REPLACE_ME",
    "fbrDefaultSaleType":               "Goods at Standard Rate (default)",
    "fbrDefaultUOM":                    "Numbers, pieces, units",
    "fbrDefaultPaymentModeRegistered":  "Credit",
    "fbrDefaultPaymentModeUnregistered":"Cash",
    "inventoryTrackingEnabled": False,
    "startingPurchaseBillNumber": 2001,
    "startingGoodsReceiptNumber": 3001,
}

# ── Demo buyers — placeholder NTNs / STRNs only ──
CLIENTS = [
    {
        "key": "alpha",
        "name": "Alpha Industries (Pvt) Ltd.",
        "address": "Korangi Industrial Area, Karachi",
        "phone": "+92-21-11111111",
        "ntn":  "2345678-9",
        "strn": "1111111111110",
        "registrationType": "Registered",
        "fbrProvinceCode":  8,
        "site": "Plant A",
    },
    {
        "key": "bravo",
        "name": "Bravo Textiles Ltd.",
        "address": "SITE Area, Karachi",
        "phone": "+92-21-22222222",
        "ntn":  "3456789-0",
        "strn": "2222222222220",
        "registrationType": "Registered",
        "fbrProvinceCode":  8,
        "site": "Mill B",
    },
    {
        "key": "charlie",
        "name": "Charlie Foods Pvt Ltd.",
        "address": "F.B. Industrial Area, Karachi",
        "phone": "+92-21-33333333",
        "ntn":  "4567890-1",
        "strn": "3333333333330",
        "registrationType": "Registered",
        "fbrProvinceCode":  8,
        "site": "Unit-1",
    },
    {
        "key": "walkin",
        "name": "Walk-in Retail Customer (Demo)",
        "address": "Karachi",
        "phone": "+92-300-0000000",
        "cnic": "4220100000001",
        "registrationType": "Unregistered",
        "fbrProvinceCode":  8,
    },
]

# ──────────────────────────────────────────────────────────────────────
# Tiny HTTP helpers (urllib only — no extra deps)
# ──────────────────────────────────────────────────────────────────────
def _req(method: str, path: str, body=None, token: str | None = None):
    url = BASE + path
    data = None
    headers = {"Content-Type": "application/json"}
    if token: headers["Authorization"] = f"Bearer {token}"
    if body is not None: data = json.dumps(body).encode("utf-8")
    req = urlreq.Request(url, method=method, data=data, headers=headers)
    try:
        with urlreq.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else None)
    except urlerr.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try: payload = json.loads(raw)
        except Exception: payload = raw
        return e.code, payload

def login() -> str:
    code, body = _req("POST", "/api/auth/login",
                      {"username": "admin", "password": "admin123"})
    if code != 200 or not body or "token" not in body:
        sys.exit(f"Login failed: {code} {body}")
    return body["token"]

# ──────────────────────────────────────────────────────────────────────
# Seed
# ──────────────────────────────────────────────────────────────────────
def main() -> int:
    print("→ Logging in as admin")
    token = login()

    print("→ Creating demo company")
    code, comp = _req("POST", "/api/companies", COMPANY, token)
    if code not in (200, 201):
        sys.exit(f"Company create failed: {code} {comp}")
    company_id = comp["id"]
    print(f"  company id = {company_id}, brand = {comp.get('brandName')}")

    # Clients
    client_ids: dict[str, int] = {}
    for cl in CLIENTS:
        payload = {**{k: v for k, v in cl.items() if k != "key"}, "companyId": company_id}
        code, body = _req("POST", "/api/clients", payload, token)
        if code not in (200, 201):
            sys.exit(f"Client {cl['key']} create failed: {code} {body}")
        client_ids[cl["key"]] = body["id"]
        print(f"  client {cl['key']} id = {body['id']}, name = {body['name']}")

    # Pull the seeded ItemTypes — we'll reuse a couple for FBR mapping
    code, types = _req("GET", "/api/itemtypes", token=token)
    types_by_name = {t["name"].lower(): t for t in (types or [])}

    def find_type(*candidates):
        for c in candidates:
            t = types_by_name.get(c.lower())
            if t: return t
        return None

    bearings = find_type("Bearings")
    bolts    = find_type("Bolts, Nuts & Screws", "Bolts", "Bolts, Nuts and Screws")
    cables   = find_type("Cables & Wires", "Cables")

    # ── Two demo challans ─────────────────────────────────────────────
    today = datetime.utcnow().date()

    challan_payloads = [
        {
            "label": "DC for Alpha Industries",
            "clientKey": "alpha",
            "poNumber": "PO-A-2026-001",
            "indentNo": "IND-A-77",
            "site": "Plant A",
            "items": [
                {"desc": "Deep groove ball bearing 6204",      "qty": 25, "unit": "Numbers, pieces, units", "type": bearings},
                {"desc": "Hex bolt M10 x 40 grade 8.8",        "qty": 200, "unit": "Numbers, pieces, units", "type": bolts},
            ],
        },
        {
            "label": "DC for Bravo Textiles",
            "clientKey": "bravo",
            "poNumber": "PO-B-2026-014",
            "indentNo": "IND-B-22",
            "site": "Mill B",
            "items": [
                {"desc": "Multi-core flexible cable 4 mm",    "qty": 150, "unit": "Numbers, pieces, units", "type": cables},
                {"desc": "Hex bolt M8 x 25 grade 8.8",        "qty": 500, "unit": "Numbers, pieces, units", "type": bolts},
                {"desc": "Deep groove ball bearing 6203",     "qty": 40,  "unit": "Numbers, pieces, units", "type": bearings},
            ],
        },
    ]

    challan_records = []
    for p in challan_payloads:
        items = []
        for it in p["items"]:
            items.append({
                "description": it["desc"],
                "quantity": it["qty"],
                "unit": it["unit"],
                "itemTypeId": (it["type"]["id"] if it["type"] else None),
                "itemTypeName": (it["type"]["name"] if it["type"] else ""),
            })
        body = {
            "companyId": company_id,
            "clientId":  client_ids[p["clientKey"]],
            "poNumber":  p["poNumber"],
            "poDate":    (today - timedelta(days=3)).isoformat() + "T00:00:00.000Z",
            "indentNo":  p["indentNo"],
            "site":      p["site"],
            "deliveryDate": today.isoformat() + "T00:00:00.000Z",
            "items": items,
        }
        code, dc = _req("POST", f"/api/deliverychallans/company/{company_id}", body, token)
        if code not in (200, 201):
            sys.exit(f"Challan create failed for {p['label']}: {code} {dc}")
        challan_records.append(dc)
        print(f"  {p['label']} → DC #{dc['challanNumber']}, items={len(dc['items'])}, status={dc['status']}")

    # ── Two challan-linked bills ──────────────────────────────────────
    # Bill 1 — Alpha (uses challan 1 with auto-fill prices)
    dc1 = challan_records[0]
    bill1_items = []
    for di in dc1["items"]:
        # Pricing: bearings @ 350, bolts @ 25
        price = 350 if "bearing" in di["description"].lower() else 25
        bill1_items.append({
            "deliveryItemId": di["id"],
            "unitPrice": price,
            "description": di["description"],
            "uom": di["unit"],
            "itemTypeId": di.get("itemTypeId"),
        })
    bill1 = {
        "date": today.isoformat() + "T00:00:00.000Z",
        "companyId": company_id,
        "clientId":  client_ids["alpha"],
        "gstRate":   18,
        "paymentTerms": "30 days credit",
        "documentType": 4,
        "paymentMode":  "Bank Transfer",
        "challanIds":   [dc1["id"]],
        "items":        bill1_items,
        "poDateUpdates": {},
    }
    code, b1 = _req("POST", "/api/invoices", bill1, token)
    if code not in (200, 201):
        sys.exit(f"Bill 1 create failed: {code} {b1}")
    print(f"  Bill #{b1['invoiceNumber']} created (challan-linked) — total Rs. {b1['grandTotal']:,.2f}")

    # Bill 2 — Bravo (challan 2 lines)
    dc2 = challan_records[1]
    pricing = {"cable": 110, "bolt": 18, "bearing": 290}
    bill2_items = []
    for di in dc2["items"]:
        d = di["description"].lower()
        if "cable" in d:
            p = pricing["cable"]
        elif "bolt" in d:
            p = pricing["bolt"]
        else:
            p = pricing["bearing"]
        bill2_items.append({
            "deliveryItemId": di["id"],
            "unitPrice": p,
            "description": di["description"],
            "uom": di["unit"],
            "itemTypeId": di.get("itemTypeId"),
        })
    bill2 = {
        "date": today.isoformat() + "T00:00:00.000Z",
        "companyId": company_id,
        "clientId":  client_ids["bravo"],
        "gstRate":   18,
        "paymentTerms": "Credit",
        "documentType": 4,
        "paymentMode":  "Bank Transfer",
        "challanIds":   [dc2["id"]],
        "items":        bill2_items,
        "poDateUpdates": {},
    }
    code, b2 = _req("POST", "/api/invoices", bill2, token)
    if code not in (200, 201):
        sys.exit(f"Bill 2 create failed: {code} {b2}")
    print(f"  Bill #{b2['invoiceNumber']} created (challan-linked) — total Rs. {b2['grandTotal']:,.2f}")

    # ── One standalone bill (no challan) ──────────────────────────────
    bill3 = {
        "date": today.isoformat() + "T00:00:00.000Z",
        "companyId": company_id,
        "clientId":  client_ids["walkin"],
        "gstRate":   18,
        "paymentTerms": "Cash sale",
        "documentType": 4,
        "paymentMode":  "Cash",
        "items": [
            {
                "description": "Walk-in retail purchase — assorted hardware",
                "quantity": 1,
                "uom":      "Numbers, pieces, units",
                "unitPrice": 4500,
                "itemTypeId": (bolts["id"] if bolts else None),
            },
            {
                "description": "Bearings 6204 (loose pcs)",
                "quantity": 4,
                "uom":      "Numbers, pieces, units",
                "unitPrice": 360,
                "itemTypeId": (bearings["id"] if bearings else None),
            },
        ],
    }
    code, b3 = _req("POST", "/api/invoices/standalone", bill3, token)
    if code not in (200, 201):
        sys.exit(f"Standalone bill create failed: {code} {b3}")
    print(f"  Bill #{b3['invoiceNumber']} created (STANDALONE, no challan) — total Rs. {b3['grandTotal']:,.2f}")

    print()
    print("─" * 70)
    print(f"Done. Company id = {company_id} ({COMPANY['brandName']}). Login: admin / admin123")
    print("─" * 70)
    print()
    print("NEXT STEP for screen recording:")
    print("  • Open Companies → 'Demo Trading Co.' → Edit")
    print("  • Paste your Hakimi sandbox FBR token into the FBR Token field")
    print("  • Save → bills will become 'FBR: Ready to Validate'")
    return 0

if __name__ == "__main__":
    sys.exit(main())
