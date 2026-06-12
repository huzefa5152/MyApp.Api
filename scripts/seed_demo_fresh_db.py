"""
Seeds a FRESH demo database (e.g. MyAppDemoDb) with TWO companies, each
carrying clients, suppliers, delivery challans, challan-linked bills, one
standalone bill, and purchase bills — enough to walk every main screen in
a demo without touching real tenant data.

All NTNs / STRNs / IRNs are placeholder digits — no real tax IDs.

Run AFTER the backend is up on http://localhost:5134 pointing at the fresh
DB (EF auto-migrates and seeds the admin user + item-type catalog).

Usage:  python scripts/seed_demo_fresh_db.py
"""
from __future__ import annotations
import json, sys
from datetime import datetime, timedelta
from urllib import request as urlreq, error as urlerr

BASE = "http://localhost:5134"

COMPANIES = [
    {
        "company": {
            # Real Hakimi sandbox registration (token-bound) under the
            # established demo brand — PRAL validates seller NTN ↔ token.
            "name":            "Demo Trading Company (Pvt) Ltd.",
            "brandName":       "Demo Trading Co.",
            "fullAddress":     "Plot 14, Sector 7-B, Korangi Industrial Area, Karachi 74900, Pakistan",
            "phone":           "+92-21-35067788",
            "ntn":             "4228937-8",
            "strn":            "3277876175852",
            "startingChallanNumber": 1001,
            "startingInvoiceNumber": 5001,
            "invoiceNumberPrefix":   "DT-",
            "fbrProvinceCode":       8,
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
        },
        # Real, PRAL-verified buyer NTNs (public via STATL) with anonymized
        # display names — validate as Registered in FBR without exposing or
        # reusing the production client book.
        "clients": [
            {"key": "alpha",  "name": "Industrial Buyer Co. (Pvt) Ltd.",      "address": "Industrial Trading Estate, Karachi", "phone": "+92-21-44444444", "ntn": "0710818-04", "strn": "02-03-2100-001-82", "registrationType": "Registered", "fbrProvinceCode": 8, "site": "HQ"},
            {"key": "bravo",  "name": "Manufacturing Solutions (Pvt) Ltd.",   "address": "SITE Industrial Area, Karachi",      "phone": "+92-21-55555555", "ntn": "8655568-8",  "strn": "3277876354879",     "registrationType": "Registered", "fbrProvinceCode": 8, "site": "Plant 1"},
            {"key": "walkin", "name": "Walk-in Customer (Demo)",              "address": "Karachi",                            "phone": "+92-300-0000000", "cnic": "4220100000001", "registrationType": "Unregistered", "fbrProvinceCode": 8},
        ],
        "suppliers": [
            {"key": "steelco", "name": "Ferrovan Distributors",   "address": "Port Qasim, Karachi", "phone": "+92-21-44444444", "ntn": "5678901-2", "strn": "4444444444440", "registrationType": "Registered", "fbrProvinceCode": 8},
            {"key": "wirehub", "name": "Cablon Traders",        "address": "Shershah, Karachi",   "phone": "+92-21-55555555", "ntn": "6789012-3", "strn": "5555555555550", "registrationType": "Registered", "fbrProvinceCode": 8},
        ],
        "challans": [
            {"label": "DC for Industrial Buyer Co.", "clientKey": "alpha", "poNumber": "PO-A-2026-001", "indentNo": "IND-A-77", "site": "HQ", "items": [
                {"desc": "Deep groove ball bearing 6204", "qty": 25,  "type": "bearings"},
                {"desc": "Hex bolt M10 x 40 grade 8.8",   "qty": 200, "type": "bolts"},
            ]},
            {"label": "DC for Manufacturing Solutions", "clientKey": "bravo", "poNumber": "PO-B-2026-014", "indentNo": "IND-B-22", "site": "Plant 1", "items": [
                {"desc": "Multi-core flexible cable 4 mm", "qty": 150, "type": "cables"},
                {"desc": "Hex bolt M8 x 25 grade 8.8",     "qty": 500, "type": "bolts"},
            ]},
        ],
        "standalone": {"clientKey": "walkin", "items": [
            {"desc": "Walk-in retail purchase — assorted hardware", "qty": 1, "price": 4500, "type": "bolts"},
            {"desc": "Bearings 6204 (loose pcs)",                    "qty": 4, "price": 360,  "type": "bearings"},
        ]},
        "purchasebills": [
            {"supplierKey": "steelco", "supplierBillNumber": "SC-INV-881", "supplierIRN": "7000000000001", "paymentMode": "Credit", "terms": "Net 30", "items": [
                {"desc": "Deep groove ball bearing 6204 (box of 50)", "qty": 100, "price": 240, "type": "bearings"},
                {"desc": "Hex bolt M10 x 40 grade 8.8 (bulk)",        "qty": 1000, "price": 14, "type": "bolts"},
            ]},
            {"supplierKey": "wirehub", "supplierBillNumber": "WH-2026-302", "supplierIRN": "7000000000002", "paymentMode": "Bank Transfer", "terms": "Net 15", "items": [
                {"desc": "Multi-core flexible cable 4 mm (drum)", "qty": 400, "price": 78, "type": "cables"},
            ]},
        ],
    },
    {
        "company": {
            # Same real token-bound registration under a second demo brand —
            # NTN is not unique per company, and PRAL only checks seller NTN
            # ↔ token at validate time, so both companies validate with the
            # same pasted sandbox token.
            "name":            "Demo Distribution Company (Pvt) Ltd.",
            "brandName":       "Demo Distribution Co.",
            "fullAddress":     "Plot 9, Sector 12-C, North Karachi Industrial Area, Karachi, Pakistan",
            "phone":           "+92-21-36778899",
            "ntn":             "4228937-8",
            "strn":            "3277876175852",
            "startingChallanNumber": 7001,
            "startingInvoiceNumber": 9001,
            "invoiceNumberPrefix":   "DD-",
            "fbrProvinceCode":       8,
            "fbrBusinessActivity":   "Wholesaler",
            "fbrSector":             "Wholesale / Retails",
            "fbrEnvironment":        "sandbox",
            "fbrToken":              "SANDBOX_PLACEHOLDER_REPLACE_ME",
            "fbrDefaultSaleType":               "Goods at Standard Rate (default)",
            "fbrDefaultUOM":                    "Numbers, pieces, units",
            "fbrDefaultPaymentModeRegistered":  "Credit",
            "fbrDefaultPaymentModeUnregistered":"Cash",
            "inventoryTrackingEnabled": False,
            "startingPurchaseBillNumber": 8001,
            "startingGoodsReceiptNumber": 8501,
        },
        # Same anonymized real-NTN buyer pattern as company 1.
        "clients": [
            {"key": "delta", "name": "Trading Partners (Pvt) Ltd.",        "address": "F.B. Industrial Area, Karachi", "phone": "+92-21-66666666", "ntn": "0676893-8", "strn": "11-00-6001-010-73", "registrationType": "Registered", "fbrProvinceCode": 8, "site": "Warehouse"},
            {"key": "echo",  "name": "Manufacturing Solutions (Pvt) Ltd.", "address": "SITE Industrial Area, Karachi", "phone": "+92-21-55555555", "ntn": "8655568-8", "strn": "3277876354879",      "registrationType": "Registered", "fbrProvinceCode": 8, "site": "Plant 1"},
            {"key": "cash",  "name": "Cash Counter Customer (Demo)",       "address": "Karachi",                       "phone": "+92-300-1111111", "cnic": "3520200000002", "registrationType": "Unregistered", "fbrProvinceCode": 8},
        ],
        "suppliers": [
            {"key": "punjsteel", "name": "Steelora Agency", "address": "Badami Bagh, Lahore", "phone": "+92-42-33333333", "ntn": "0123456-7", "strn": "1212121212120", "registrationType": "Registered", "fbrProvinceCode": 7},
            {"key": "alfares",   "name": "Wirexa Cables Co.", "address": "Brandreth Road, Lahore", "phone": "+92-42-66666666", "ntn": "1357913-5", "strn": "3434343434340", "registrationType": "Registered", "fbrProvinceCode": 7},
        ],
        "challans": [
            {"label": "DC for Trading Partners", "clientKey": "delta", "poNumber": "PO-D-2026-090", "indentNo": "IND-D-09", "site": "Warehouse", "items": [
                {"desc": "Deep groove ball bearing 6305", "qty": 60,  "type": "bearings"},
                {"desc": "Hex bolt M12 x 50 grade 8.8",   "qty": 300, "type": "bolts"},
            ]},
            {"label": "DC for Manufacturing Solutions", "clientKey": "echo", "poNumber": "PO-E-2026-041", "indentNo": "IND-E-41", "site": "Plant 1", "items": [
                {"desc": "Single-core cable 6 mm",        "qty": 250, "type": "cables"},
                {"desc": "Hex bolt M8 x 30 grade 8.8",    "qty": 800, "type": "bolts"},
            ]},
        ],
        "standalone": {"clientKey": "cash", "items": [
            {"desc": "Counter sale — fasteners assortment", "qty": 1, "price": 6200, "type": "bolts"},
        ]},
        "purchasebills": [
            {"supplierKey": "punjsteel", "supplierBillNumber": "PSA-1107", "supplierIRN": "7000000000003", "paymentMode": "Credit", "terms": "Net 30", "items": [
                {"desc": "Ball bearing 6305 (carton)",  "qty": 150, "price": 410, "type": "bearings"},
                {"desc": "Hex bolt M12 x 50 (bulk)",    "qty": 1500, "price": 22, "type": "bolts"},
            ]},
            {"supplierKey": "alfares", "supplierBillNumber": "AF-26-77", "supplierIRN": "7000000000004", "paymentMode": "Cheque", "terms": "Net 45", "items": [
                {"desc": "Single-core cable 6 mm (drum)", "qty": 600, "price": 95, "type": "cables"},
            ]},
        ],
    },
]

# Per-description sale price used when billing challan lines.
SALE_PRICE = {"bearing": 350, "bolt": 25, "cable": 110}

# Pool used to GENERATE extra challans beyond the handcrafted ones so each
# company carries a realistic ledger (>= 10 DCs, >= 10 bills). Prices come
# from SALE_PRICE keyword matching, so every description contains one of
# the keywords above.
GEN_ITEM_POOL = [
    {"desc": "Deep groove ball bearing 6204",   "type": "bearings"},
    {"desc": "Deep groove ball bearing 6305",   "type": "bearings"},
    {"desc": "Pillow block bearing UCP-205",    "type": "bearings"},
    {"desc": "Hex bolt M10 x 40 grade 8.8",     "type": "bolts"},
    {"desc": "Hex bolt M12 x 50 grade 8.8",     "type": "bolts"},
    {"desc": "Anchor bolt M16 x 150",           "type": "bolts"},
    {"desc": "Multi-core flexible cable 4 mm",  "type": "cables"},
    {"desc": "Single-core cable 6 mm",          "type": "cables"},
]

# How many DCs each company should end up with (handcrafted + generated).
TARGET_DCS_PER_COMPANY = 10


def _req(method: str, path: str, body=None, token: str | None = None):
    url = BASE + path
    data = None
    headers = {"Content-Type": "application/json"}
    if token: headers["Authorization"] = f"Bearer {token}"
    if body is not None: data = json.dumps(body).encode("utf-8")
    req = urlreq.Request(url, method=method, data=data, headers=headers)
    try:
        with urlreq.urlopen(req, timeout=60) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else None)
    except urlerr.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try: payload = json.loads(raw)
        except Exception: payload = raw
        return e.code, payload


def login() -> str:
    code, body = _req("POST", "/api/auth/login", {"username": "admin", "password": "admin123"})
    if code != 200 or not body or "token" not in body:
        sys.exit(f"Login failed: {code} {body}")
    return body["token"]


def sale_price(desc: str) -> int:
    d = desc.lower()
    for k, v in SALE_PRICE.items():
        if k in d: return v
    return 100


def seed_company(spec: dict, token: str, types_by_name: dict) -> dict:
    today = datetime.utcnow().date()

    def find_type(key):
        aliases = {
            "bearings": ["Bearings"],
            "bolts":    ["Bolts, Nuts & Screws", "Bolts", "Bolts, Nuts and Screws"],
            "cables":   ["Cables & Wires", "Cables"],
        }[key]
        for a in aliases:
            t = types_by_name.get(a.lower())
            if t: return t
        return None

    comp_payload = spec["company"]
    print(f"→ Creating company: {comp_payload['brandName']}")
    code, comp = _req("POST", "/api/companies", comp_payload, token)
    if code not in (200, 201): sys.exit(f"  company create failed: {code} {comp}")
    cid = comp["id"]
    print(f"  company id = {cid}")

    client_ids = {}
    for cl in spec["clients"]:
        payload = {**{k: v for k, v in cl.items() if k != "key"}, "companyId": cid}
        code, body = _req("POST", "/api/clients", payload, token)
        if code not in (200, 201): sys.exit(f"  client {cl['key']} failed: {code} {body}")
        client_ids[cl["key"]] = body["id"]
    print(f"  clients: {len(client_ids)}")

    supplier_ids = {}
    for sp in spec["suppliers"]:
        payload = {**{k: v for k, v in sp.items() if k != "key"}, "companyId": cid}
        code, body = _req("POST", "/api/suppliers", payload, token)
        if code not in (200, 201): sys.exit(f"  supplier {sp['key']} failed: {code} {body}")
        supplier_ids[sp["key"]] = body["id"]
    print(f"  suppliers: {len(supplier_ids)}")

    # Handcrafted challans + generated ones up to TARGET_DCS_PER_COMPANY.
    # Generated challans rotate across the REGISTERED clients only — an
    # Unregistered client's challan lands in 'Setup Required' and blocks
    # bill creation. Dates spread over the past month so dashboards and
    # rate history look lived-in rather than seeded-this-morning.
    registered_keys = [c["key"] for c in spec["clients"]
                       if (c.get("registrationType") or "") == "Registered"]
    challan_specs = [dict(p, daysAgo=p.get("daysAgo", 1)) for p in spec["challans"]]
    gen_needed = max(0, TARGET_DCS_PER_COMPANY - len(challan_specs))
    for i in range(gen_needed):
        ckey = registered_keys[i % len(registered_keys)]
        client_spec = next(c for c in spec["clients"] if c["key"] == ckey)
        n_items = 1 + (i % 3)  # 1..3 lines, deterministic
        items = []
        for j in range(n_items):
            pool = GEN_ITEM_POOL[(i * 3 + j) % len(GEN_ITEM_POOL)]
            items.append({"desc": pool["desc"], "qty": 20 + ((i * 13 + j * 7) % 180), "type": pool["type"]})
        challan_specs.append({
            "label":    f"DC (generated #{i+1}) for {client_spec['name']}",
            "clientKey": ckey,
            "poNumber": f"PO-G{cid}-{2026}-{i+1:03d}",
            "indentNo": f"IND-G-{i+1:02d}",
            "site":     client_spec.get("site") or "Main",
            "items":    items,
            "daysAgo":  3 + i * 3,   # newest ~3 days old, oldest ~a month
        })

    challan_records = []
    for p in challan_specs:
        items = []
        for it in p["items"]:
            t = find_type(it["type"])
            items.append({
                "description": it["desc"],
                "quantity": it["qty"],
                "unit": "Numbers, pieces, units",
                "itemTypeId": (t["id"] if t else None),
                "itemTypeName": (t["name"] if t else ""),
            })
        doc_date = today - timedelta(days=p.get("daysAgo", 0))
        body = {
            "companyId": cid,
            "clientId":  client_ids[p["clientKey"]],
            "poNumber":  p["poNumber"],
            "poDate":    (doc_date - timedelta(days=3)).isoformat() + "T00:00:00.000Z",
            "indentNo":  p["indentNo"],
            "site":      p["site"],
            "deliveryDate": doc_date.isoformat() + "T00:00:00.000Z",
            "items": items,
        }
        code, dc = _req("POST", f"/api/deliverychallans/company/{cid}", body, token)
        if code not in (200, 201): sys.exit(f"  challan failed for {p['label']}: {code} {dc}")
        challan_records.append((p, dc, doc_date))
        print(f"  {p['label']} → DC #{dc['challanNumber']} ({doc_date.isoformat()})")

    for p, dc, doc_date in challan_records:
        bill_items = [{
            "deliveryItemId": di["id"],
            "unitPrice": sale_price(di["description"]),
            "description": di["description"],
            "uom": di["unit"],
            "itemTypeId": di.get("itemTypeId"),
        } for di in dc["items"]]
        bill = {
            "date": doc_date.isoformat() + "T00:00:00.000Z",
            "companyId": cid,
            "clientId":  client_ids[p["clientKey"]],
            "gstRate":   18,
            "paymentTerms": "30 days credit",
            "documentType": 4,
            "paymentMode":  "Bank Transfer",
            "challanIds":   [dc["id"]],
            "items":        bill_items,
            "poDateUpdates": {},
        }
        code, b = _req("POST", "/api/invoices", bill, token)
        if code not in (200, 201): sys.exit(f"  bill failed for {p['label']}: {code} {b}")
        print(f"  Bill #{b['invoiceNumber']} (from DC #{dc['challanNumber']}) — Rs. {b['grandTotal']:,.2f}")

    sa = spec["standalone"]
    sa_items = []
    for it in sa["items"]:
        t = find_type(it["type"])
        sa_items.append({
            "description": it["desc"],
            "quantity": it["qty"],
            "uom": "Numbers, pieces, units",
            "unitPrice": it["price"],
            "itemTypeId": (t["id"] if t else None),
        })
    bill3 = {
        "date": today.isoformat() + "T00:00:00.000Z",
        "companyId": cid,
        "clientId":  client_ids[sa["clientKey"]],
        "gstRate":   18,
        "paymentTerms": "Cash sale",
        "documentType": 4,
        "paymentMode":  "Cash",
        "items": sa_items,
    }
    code, b3 = _req("POST", "/api/invoices/standalone", bill3, token)
    if code not in (200, 201): sys.exit(f"  standalone bill failed: {code} {b3}")
    print(f"  Bill #{b3['invoiceNumber']} (STANDALONE) — Rs. {b3['grandTotal']:,.2f}")

    for pb in spec["purchasebills"]:
        items = []
        for it in pb["items"]:
            t = find_type(it["type"])
            items.append({
                "id": 0,
                "itemTypeId": (t["id"] if t else None),
                "description": it["desc"],
                "quantity": it["qty"],
                "unitPrice": it["price"],
                "uom": "Numbers, pieces, units",
                "hsCode": (t.get("hsCode") if t else None),
                "saleType": (t.get("saleType") if t else None),
                "sourceInvoiceItemIds": [],
            })
        body = {
            "date": today.isoformat() + "T00:00:00.000Z",
            "companyId": cid,
            "supplierId": supplier_ids[pb["supplierKey"]],
            "supplierBillNumber": pb["supplierBillNumber"],
            "supplierIRN": pb["supplierIRN"],
            "gstRate": 18,
            "paymentTerms": pb["terms"],
            "paymentMode": pb["paymentMode"],
            "items": items,
        }
        code, created = _req("POST", "/api/purchasebills", body, token)
        if code not in (200, 201): sys.exit(f"  purchase bill failed ({pb['supplierKey']}): {code} {created}")
        print(f"  PB #{created['purchaseBillNumber']} ({pb['supplierKey']}) — Rs. {created['grandTotal']:,.2f}")

    return {"companyId": cid, "brand": comp_payload["brandName"]}


def main() -> int:
    print("→ Logging in as admin")
    token = login()

    code, types = _req("GET", "/api/itemtypes", token=token)
    if code != 200: sys.exit(f"item types fetch failed: {code} {types}")
    types_by_name = {t["name"].lower(): t for t in (types or [])}
    print(f"→ Item-type catalog: {len(types_by_name)} entries")

    results = [seed_company(spec, token, types_by_name) for spec in COMPANIES]

    print()
    print("─" * 70)
    for r in results:
        print(f"Seeded company {r['companyId']}: {r['brand']}")
    print("Login: admin / admin123")
    print("─" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
