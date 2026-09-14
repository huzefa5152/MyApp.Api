"""
Seed a clean, ISOLATED demo environment on the LOCAL Trader database
(MyApp_Trader_Local, via http://localhost:5136) for software demos / videos.

What it creates (all via the real API — no raw SQL, business rules enforced):
  • one demo Administrator user (demo.admin) with the Administrator RBAC role,
    created under the seed admin.
  • 3 fictional companies, created AS the demo admin so each is auto-owned +
    auto-granted to it. The fail-closed CompanyAccessGuard then means the demo
    admin sees ONLY these 3 — never Alpha/Beta/Saify/Teknomark.
  • per company: customers, suppliers, products (global item types), opening
    stock, one purchase bill (auto Stock-IN), one challan + challan-linked bill,
    two standalone bills, and explicit Bill + TaxInvoice print templates
    (the app's own default layout, with the hardcoded real-client conditional
    stripped out).

Everything is idempotent by NAME: re-running reuses the demo admin and skips a
company (and its data) that already exists.

FICTIONAL DATA ONLY. No real NTN/CNIC/STRN/address/client is used.

Usage:  python seed_demo_environment.py
"""
from __future__ import annotations
import argparse, json, re, sys
from datetime import datetime, timedelta
from urllib import request as urlreq, error as urlerr

BASE = "http://localhost:5136"
SEED_ADMIN = {"username": "admin", "password": "admin123"}
DEMO_ADMIN = {"username": "demo.admin", "password": "DemoPass2026", "fullName": "Demo Administrator"}
DEFAULT_TEMPLATES_JS = r"D:\huzefa-portfolio\github-projects\MyApp.Api\myapp-frontend\src\utils\defaultTemplates.js"

# A clearly-fake placeholder token. It is NEVER submitted to FBR — it only
# makes IsFbrReady() pass so demo challans become billable and bills show the
# "FBR: Ready to Validate" state during a recording. Not a real secret.
DEMO_TOKEN = "DEMO-SANDBOX-TOKEN-NOT-FOR-SUBMISSION"

# Overridable at runtime (see main's argparse) so the SAME script can target a
# directed prod backend and set a real FBR token + seller registration for a
# validation-ready demo. Defaults keep the local placeholder behaviour. The
# token is passed on the command line only — never hardcoded, never logged.
FBR_TOKEN = DEMO_TOKEN
FBR_SELLER_OVERRIDE = None  # None = per-company placeholder; else applied to all

# FBR sandbox does a REAL active-taxpayer (STATL) lookup on a REGISTERED buyer,
# so a fictional NTN fails validation with [0205]. These are known-good
# sandbox-registered NTNs (they pass STATL) — paired with the fictional demo
# company names so every invoice to a demo buyer validates. All demo buyers are
# Registered (per the operator's instruction). Sandbox use only.
FBR_SANDBOX_NTNS = ["0710818-04", "13-02-0676470-3", "8655568-8",
                    "0676893-8", "8826050-2", "36066672"]

# Every demo product files under this HS code + sale type, which PRAL confirms
# is valid for "Goods at Standard Rate". The demo's original per-product HS
# codes (e.g. 8528.7211 for a TV) are 3rd-schedule at FBR and fail [0052], so a
# single proven standard-rate recipe is used for all demo items. FbrUOMId 69 =
# "Numbers, pieces, units".
DEMO_HS_CODE = "8481.8090"
DEMO_FBR_UOM_ID = 69
DEMO_SALE_TYPE = "Goods at Standard Rate (default)"

FBR_DEFAULTS = {
    "fbrBusinessActivity": "Wholesaler",
    "fbrSector": "Wholesale / Retails",
    "fbrEnvironment": "sandbox",
    "fbrDefaultSaleType": "Goods at Standard Rate (default)",
    "fbrDefaultUOM": "Numbers, pieces, units",
    "fbrDefaultPaymentModeRegistered": "Credit",
    "fbrDefaultPaymentModeUnregistered": "Cash",
}

# ── Demo dataset (all fictional) ──────────────────────────────────────────
COMPANIES = [
    {
        "name": "Orbit Distributors (Pvt) Ltd", "brandName": "ORBIT DISTRIBUTORS",
        "fullAddress": "Plot 45, Electronics Market, Saddar, Karachi", "phone": "+92-21-35210001",
        "ntn": "8200011", "strn": "3277880011", "fbrSellerRegistrationNo": "8200011",
        "province": 8, "prefix": "ORB-",
        "products": [
            {"name": "LED TV 43 inch",         "hs": "8528.7211", "uom": "Numbers, pieces, units", "cost": 62000, "sale": 72000, "open": 40},
            {"name": "Split AC 1.5 Ton",       "hs": "8415.1020", "uom": "Numbers, pieces, units", "cost": 95000, "sale": 110000, "open": 25},
            {"name": "Microwave Oven 30L",     "hs": "8516.5000", "uom": "Numbers, pieces, units", "cost": 18000, "sale": 22000, "open": 30},
            {"name": "Refrigerator 300L",      "hs": "8418.1010", "uom": "Numbers, pieces, units", "cost": 78000, "sale": 89000, "open": 20},
            {"name": "Electric Kettle 1.8L",   "hs": "8516.7100", "uom": "Numbers, pieces, units", "cost": 2200,  "sale": 3200,  "open": 120},
        ],
        "clients": [
            {"name": "Skyline Electronics",       "address": "Abdullah Haroon Rd, Karachi", "phone": "+92-21-35660011", "ntn": "3100011", "strn": "3277811011", "registrationType": "Registered", "site": "Main"},
            {"name": "Galaxy Home Appliances",    "address": "Tariq Rd, Karachi",           "phone": "+92-21-34550012", "ntn": "3100012", "strn": "3277811012", "registrationType": "Registered", "site": "Branch"},
            {"name": "Metro Retail Store",        "address": "Gulshan-e-Iqbal, Karachi",    "phone": "+92-21-34990013", "ntn": "3100013", "strn": "3277811013", "registrationType": "Registered"},
            {"name": "Walk-in Customer (Demo)",   "address": "Karachi",                      "phone": "+92-300-1000011", "cnic": "4210111111111", "registrationType": "Unregistered"},
        ],
        "suppliers": [
            {"name": "Horizon Imports",       "address": "Timber Market, Karachi", "phone": "+92-21-32550011", "ntn": "7100011", "strn": "3277871011", "registrationType": "Registered"},
            {"name": "PowerVolt Distributors","address": "SITE Area, Karachi",     "phone": "+92-21-32660012", "ntn": "7100012", "strn": "3277871012", "registrationType": "Registered"},
        ],
    },
    {
        "name": "Crescent Textile House (Pvt) Ltd", "brandName": "CRESCENT TEXTILE HOUSE",
        "fullAddress": "Plot 88, Textile Zone, Faisalabad", "phone": "+92-41-2540002",
        "ntn": "8200022", "strn": "3277880022", "fbrSellerRegistrationNo": "8200022",
        "province": 7, "prefix": "CTH-",
        "products": [
            {"name": "Cotton Fabric (per meter)", "hs": "5208.1100", "uom": "Metre",                 "cost": 320, "sale": 420,  "open": 5000},
            {"name": "Lawn Suit 3-Piece",         "hs": "5208.5100", "uom": "Numbers, pieces, units","cost": 2600,"sale": 3500, "open": 300},
            {"name": "Bed Sheet Set (Double)",    "hs": "6302.2100", "uom": "Numbers, pieces, units","cost": 3200,"sale": 4200, "open": 200},
            {"name": "Bath Towel",                "hs": "6302.6000", "uom": "Numbers, pieces, units","cost": 650, "sale": 950,  "open": 400},
            {"name": "Denim Fabric Roll",         "hs": "5209.4200", "uom": "Metre",                 "cost": 780, "sale": 1050, "open": 1500},
        ],
        "clients": [
            {"name": "Noor Garments",     "address": "Susan Rd, Faisalabad",     "phone": "+92-41-2610021", "ntn": "3100021", "strn": "3277811021", "registrationType": "Registered", "site": "Unit-1"},
            {"name": "Shalimar Fabrics",  "address": "Kotwali Rd, Faisalabad",   "phone": "+92-41-2620022", "ntn": "3100022", "strn": "3277811022", "registrationType": "Registered"},
            {"name": "Elite Tailors",     "address": "D Ground, Faisalabad",     "phone": "+92-41-2630023", "ntn": "3100023", "strn": "3277811023", "registrationType": "Registered"},
            {"name": "Walk-in Customer (Demo)", "address": "Faisalabad",          "phone": "+92-300-1000022", "cnic": "4210122222222", "registrationType": "Unregistered"},
        ],
        "suppliers": [
            {"name": "Chenab Spinning Mills", "address": "Jhang Rd, Faisalabad", "phone": "+92-41-2710021", "ntn": "7100021", "strn": "3277871021", "registrationType": "Registered"},
            {"name": "Ravi Dyeing Works",     "address": "Sargodha Rd, Faisalabad","phone": "+92-41-2720022", "ntn": "7100022", "strn": "3277871022", "registrationType": "Registered"},
        ],
    },
    {
        "name": "Sunrise Foods & Beverages (Pvt) Ltd", "brandName": "SUNRISE FOODS",
        "fullAddress": "Plot 12, Industrial Estate, Kot Lakhpat, Lahore", "phone": "+92-42-35880003",
        "ntn": "8200033", "strn": "3277880033", "fbrSellerRegistrationNo": "8200033",
        "province": 7, "prefix": "SFB-",
        "products": [
            {"name": "Mineral Water 1.5L (Pack of 6)", "hs": "2201.1010", "uom": "Numbers, pieces, units", "cost": 300,  "sale": 390,  "open": 500},
            {"name": "Cooking Oil 5L",                 "hs": "1512.1900", "uom": "Numbers, pieces, units", "cost": 2400, "sale": 2850, "open": 250},
            {"name": "Basmati Rice 5kg",               "hs": "1006.3010", "uom": "Numbers, pieces, units", "cost": 1600, "sale": 2100, "open": 300},
            {"name": "Tea Pack 950g",                  "hs": "0902.3000", "uom": "Numbers, pieces, units", "cost": 1450, "sale": 1850, "open": 200},
            {"name": "Biscuits (Carton of 24)",        "hs": "1905.3100", "uom": "Numbers, pieces, units", "cost": 1200, "sale": 1600, "open": 180},
        ],
        "clients": [
            {"name": "Daily Mart Superstore", "address": "DHA Phase 5, Lahore",   "phone": "+92-42-35110031", "ntn": "3100031", "strn": "3277811031", "registrationType": "Registered", "site": "Store-1"},
            {"name": "Fresh Basket Grocers",  "address": "Model Town, Lahore",    "phone": "+92-42-35120032", "ntn": "3100032", "strn": "3277811032", "registrationType": "Registered"},
            {"name": "Corner Store",          "address": "Johar Town, Lahore",    "phone": "+92-42-35130033", "ntn": "3100033", "strn": "3277811033", "registrationType": "Registered"},
            {"name": "Walk-in Customer (Demo)", "address": "Lahore",              "phone": "+92-300-1000033", "cnic": "4210133333333", "registrationType": "Unregistered"},
        ],
        "suppliers": [
            {"name": "Indus Beverages Ltd", "address": "Raiwind Rd, Lahore",     "phone": "+92-42-35210031", "ntn": "7100031", "strn": "3277871031", "registrationType": "Registered"},
            {"name": "Punjab Flour Mills",  "address": "Ferozepur Rd, Lahore",   "phone": "+92-42-35220032", "ntn": "7100032", "strn": "3277871032", "registrationType": "Registered"},
        ],
    },
]

# ── HTTP helpers ──────────────────────────────────────────────────────────
def _req(method, path, body=None, token=None):
    url = BASE + path
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urlreq.Request(url, method=method, data=data, headers=headers)
    try:
        with urlreq.urlopen(req, timeout=60) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else None)
    except urlerr.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw

def login(creds):
    s, b = _req("POST", "/api/auth/login", creds)
    if s != 200 or not b or "token" not in b:
        sys.exit(f"[!] login failed for {creds['username']}: {s} {b}")
    return b["token"]

def must(s, b, what):
    if s not in (200, 201):
        sys.exit(f"[!] {what} failed: HTTP {s} {b}")
    return b

# ── Templates: read the app's own defaults, strip the real-client block ────
def load_templates():
    js = open(DEFAULT_TEMPLATES_JS, encoding="utf-8").read()
    def grab(name):
        m = re.search(rf"export const {name} = `(.*?)`;", js, re.S)
        if not m:
            sys.exit(f"[!] could not extract {name} from defaultTemplates.js")
        s = m.group(1)
        # JS template-literal escapes → literal chars
        s = s.replace(r"\\u2014", "\u2014").replace(r"\u2014", "\u2014")
        return s
    bill = grab("defaultBillTemplate")
    tax = grab("defaultTaxInvoiceTemplate")
    # Remove the hardcoded "LOTTE Kolson (Pvt.) Limited" PO-NO conditional so a
    # demo company's tax invoice carries zero real-client references.
    tax_clean = re.sub(
        r"\{\{#if \(eq buyerName \"LOTTE Kolson.*?\{\{/if\}\}\s*\{\{/if\}\}",
        "", tax, flags=re.S)
    if "LOTTE Kolson" in tax_clean:
        sys.exit("[!] LOTTE Kolson reference still present after sanitising tax template")
    return bill, tax_clean

# ── Demo admin ─────────────────────────────────────────────────────────────
def ensure_demo_admin(seed_token):
    # Find existing by username (seed admin sees everyone).
    _, users = _req("GET", "/api/users", token=seed_token)
    existing = next((u for u in (users or []) if u.get("username") == DEMO_ADMIN["username"]), None)
    if existing:
        uid = existing["id"]
        print(f"[=] demo admin '{DEMO_ADMIN['username']}' exists (id={uid}) — reusing")
    else:
        s, b = _req("POST", "/api/users", {
            "username": DEMO_ADMIN["username"],
            "password": DEMO_ADMIN["password"],
            "fullName": DEMO_ADMIN["fullName"],
            "role": "Administrator",
        }, seed_token)
        must(s, b, "create demo admin")
        uid = b["id"]
        print(f"[+] created demo admin '{DEMO_ADMIN['username']}' (id={uid})")

    # Ensure the Administrator RBAC role is assigned (full-replacement PUT).
    _, roles = _req("GET", "/api/roles", token=seed_token)
    admin_role = next((r for r in (roles or []) if r.get("name") == "Administrator"), None)
    if not admin_role:
        sys.exit("[!] Administrator role not found")
    s, b = _req("PUT", f"/api/users/{uid}/roles", {"roleIds": [admin_role["id"]]}, seed_token)
    must(s, b, "assign Administrator role")
    print(f"[+] demo admin holds Administrator role (id={admin_role['id']})")
    return uid

# ── Item types (global) ────────────────────────────────────────────────────
def ensure_item_types(token, all_products):
    _, existing = _req("GET", "/api/itemtypes", token=token)
    by_name = {t["name"].lower(): t["id"] for t in (existing or [])}
    ids = {}
    for p in all_products:
        key = p["name"].lower()
        if key in by_name:
            ids[p["name"]] = by_name[key]
            continue
        s, b = _req("POST", "/api/itemtypes", {
            "name": p["name"], "hsCode": DEMO_HS_CODE, "uom": "Numbers, pieces, units",
            "fbrUOMId": DEMO_FBR_UOM_ID, "saleType": DEMO_SALE_TYPE, "isFavorite": True,
        }, token)
        must(s, b, f"create item type {p['name']}")
        ids[p["name"]] = b["id"]
        by_name[key] = b["id"]
        print(f"    + product '{p['name']}' (item type id={b['id']})")
    return ids

# ── Per-company seed ───────────────────────────────────────────────────────
def seed_company(token, cdef, type_ids, bill_tpl, tax_tpl):
    today = datetime.utcnow().date()
    iso = lambda d: d.isoformat() + "T00:00:00.000Z"

    company = {
        "name": cdef["name"], "brandName": cdef["brandName"],
        "fullAddress": cdef["fullAddress"], "phone": cdef["phone"],
        "ntn": cdef["ntn"], "strn": cdef["strn"],
        "fbrSellerRegistrationNo": FBR_SELLER_OVERRIDE or cdef["fbrSellerRegistrationNo"],
        "startingChallanNumber": 1001, "startingInvoiceNumber": 5001,
        "startingPurchaseBillNumber": 2001, "startingGoodsReceiptNumber": 3001,
        "startingSalesQuoteNumber": 4001, "startingSalesOrderNumber": 6001,
        "invoiceNumberPrefix": cdef["prefix"],
        "fbrProvinceCode": cdef["province"],
        "inventoryTrackingEnabled": True, "stockGuardHardBlock": False,
        "isTenantIsolated": True, "fbrToken": FBR_TOKEN,
        **FBR_DEFAULTS,
    }
    s, comp = _req("POST", "/api/companies", company, token)
    must(s, comp, f"create company {cdef['name']}")
    cid = comp["id"]
    print(f"[+] company '{cdef['name']}' (id={cid})")

    # Clients — ALL Registered with a known-good sandbox NTN so every invoice
    # validates. A "Walk-in" entry is promoted to a registered trading partner
    # (a registered buyer can't be a fictional NTN, see FBR_SANDBOX_NTNS).
    client_ids = []
    for idx, cl in enumerate(cdef["clients"]):
        name = cl["name"].replace("Walk-in Customer (Demo)",
                                   f"{cdef['brandName'].title()} Retail Partner")
        payload = {
            **{k: v for k, v in cl.items() if k not in ("cnic", "name", "registrationType")},
            "name": name,
            "companyId": cid, "fbrProvinceCode": cdef["province"],
            "registrationType": "Registered",
            "ntn": FBR_SANDBOX_NTNS[idx % len(FBR_SANDBOX_NTNS)],
        }
        s, b = _req("POST", "/api/clients", payload, token)
        must(s, b, f"client {name}")
        client_ids.append(b["id"])
    print(f"    {len(client_ids)} customers (all Registered)")

    # Suppliers
    supplier_ids = []
    for sp in cdef["suppliers"]:
        payload = {**sp, "companyId": cid, "fbrProvinceCode": cdef["province"]}
        s, b = _req("POST", "/api/suppliers", payload, token)
        must(s, b, f"supplier {sp['name']}")
        supplier_ids.append(b["id"])
    print(f"    {len(supplier_ids)} suppliers")

    # Opening stock
    for p in cdef["products"]:
        s, b = _req("POST", "/api/stock/opening", {
            "companyId": cid, "itemTypeId": type_ids[p["name"]],
            "quantity": p["open"], "asOfDate": iso(today - timedelta(days=30)),
            "notes": "Opening balance (demo)",
        }, token)
        must(s, b, f"opening stock {p['name']}")
    print(f"    opening stock on {len(cdef['products'])} products")

    # Purchase bill from supplier[0] (auto Stock-IN)
    # Modest restock quantities so Total Purchases stays below Total Sales and
    # the dashboard net reads positive for the demo.
    pb_items = [{
        "itemTypeId": type_ids[p["name"]], "description": p["name"],
        "quantity": 4, "uom": p["uom"], "unitPrice": p["cost"],
    } for p in cdef["products"][:2]]
    s, b = _req("POST", "/api/purchasebills", {
        "date": iso(today - timedelta(days=5)), "companyId": cid,
        "supplierId": supplier_ids[0], "supplierBillNumber": "SUP-INV-1001",
        "gstRate": 18, "items": pb_items,
    }, token)
    must(s, b, "purchase bill")
    print(f"    purchase bill #{b.get('purchaseBillNumber', '?')}")

    # Challan to client[0] + challan-linked bill
    p0, p1 = cdef["products"][0], cdef["products"][1]
    ch_items = [
        {"description": p0["name"], "quantity": 3, "unit": p0["uom"], "itemTypeId": type_ids[p0["name"]], "itemTypeName": p0["name"]},
        {"description": p1["name"], "quantity": 2, "unit": p1["uom"], "itemTypeId": type_ids[p1["name"]], "itemTypeName": p1["name"]},
    ]
    s, dc = _req("POST", f"/api/deliverychallans/company/{cid}", {
        "companyId": cid, "clientId": client_ids[0],
        "poNumber": "PO-DEMO-001", "poDate": iso(today - timedelta(days=4)),
        "indentNo": "IND-001", "site": "Main",
        "deliveryDate": iso(today - timedelta(days=2)), "items": ch_items,
    }, token)
    must(s, dc, "challan")
    price_by_name = {p["name"]: p["sale"] for p in cdef["products"]}
    linked_items = [{
        "deliveryItemId": di["id"], "unitPrice": price_by_name.get(di["description"], 1000),
        "description": di["description"], "uom": di["unit"], "itemTypeId": di.get("itemTypeId"),
    } for di in dc["items"]]
    s, b = _req("POST", "/api/invoices", {
        "date": iso(today - timedelta(days=1)), "companyId": cid, "clientId": client_ids[0],
        "gstRate": 18, "paymentTerms": "30 days credit", "documentType": 4,
        "paymentMode": "Bank Transfer", "challanIds": [dc["id"]], "items": linked_items,
        "poDateUpdates": {},
    }, token)
    must(s, b, "challan-linked bill")
    print(f"    challan #{dc['challanNumber']} + linked bill #{b['invoiceNumber']}")

    # Two standalone bills
    standalone = [
        (client_ids[1], "Credit", [(p1["name"], 4, p1["sale"]), (cdef["products"][2]["name"], 3, cdef["products"][2]["sale"])]),
        (client_ids[3], "Cash sale", [(cdef["products"][4]["name"], 6, cdef["products"][4]["sale"])]),
    ]
    for clid, terms, lines in standalone:
        items = [{
            "description": name, "quantity": qty, "uom": "Numbers, pieces, units",
            "unitPrice": price, "itemTypeId": type_ids[name],
        } for (name, qty, price) in lines]
        s, b = _req("POST", "/api/invoices/standalone", {
            "date": iso(today), "companyId": cid, "clientId": clid, "gstRate": 18,
            "paymentTerms": terms, "documentType": 4,
            "paymentMode": "Cash" if terms == "Cash sale" else "Bank Transfer",
            "items": items,
        }, token)
        must(s, b, "standalone bill")
        print(f"    standalone bill #{b['invoiceNumber']} (total Rs {b.get('grandTotal', 0):,.0f})")

    # Explicit sanitised print templates (Bill + TaxInvoice), marked default
    for ttype, html in (("Bill", bill_tpl), ("TaxInvoice", tax_tpl)):
        s, b = _req("POST", f"/api/printtemplates/company/{cid}", {
            "templateType": ttype, "name": "Demo Default", "htmlContent": html,
            "editorMode": "code", "isDefault": True,
        }, token)
        must(s, b, f"{ttype} template")
    print(f"    Bill + TaxInvoice templates assigned")
    return cid

# ── Main ───────────────────────────────────────────────────────────────────
def main():
    global BASE, SEED_ADMIN, FBR_TOKEN, FBR_SELLER_OVERRIDE
    ap = argparse.ArgumentParser(
        description="Seed the isolated demo environment on a local OR explicitly-directed prod backend.")
    ap.add_argument("--base-url", default=BASE, help="Backend base URL (default local :5136).")
    ap.add_argument("--admin-user", default=SEED_ADMIN["username"])
    ap.add_argument("--admin-pass", default=SEED_ADMIN["password"])
    ap.add_argument("--fbr-token", default=None,
                    help="Real FBR token to set on the demo companies (makes invoices validation-ready). Never logged.")
    ap.add_argument("--fbr-seller-reg", default=None,
                    help="Seller NTN/CNIC filed to FBR, applied to ALL demo companies (must match the token binding at PRAL).")
    args = ap.parse_args()
    BASE = args.base_url
    SEED_ADMIN = {"username": args.admin_user, "password": args.admin_pass}
    if args.fbr_token:
        FBR_TOKEN = args.fbr_token
    if args.fbr_seller_reg:
        FBR_SELLER_OVERRIDE = args.fbr_seller_reg

    print(f"→ target {BASE}")
    print("→ login seed admin")
    seed_token = login(SEED_ADMIN)

    print("→ ensure demo admin + role")
    ensure_demo_admin(seed_token)

    print("→ login as demo admin")
    demo_token = login({"username": DEMO_ADMIN["username"], "password": DEMO_ADMIN["password"]})

    # Skip companies that already exist (idempotent).
    _, mine = _req("GET", "/api/companies", token=demo_token)
    existing_names = {c["name"] for c in (mine or [])}

    print("→ ensure global product item types")
    all_products = [p for c in COMPANIES for p in c["products"]]
    type_ids = ensure_item_types(demo_token, all_products)

    bill_tpl, tax_tpl = load_templates()
    print("→ templates loaded + sanitised (no LOTTE Kolson)")

    created = []
    for cdef in COMPANIES:
        if cdef["name"] in existing_names:
            print(f"[=] '{cdef['name']}' already exists — skipping data seed")
            continue
        cid = seed_company(demo_token, cdef, type_ids, bill_tpl, tax_tpl)
        created.append((cdef["name"], cid))

    print("\n" + "─" * 68)
    print("DONE.  Demo login:  demo.admin  /  DemoPass2026")
    if created:
        print("Created companies:")
        for name, cid in created:
            print(f"   • {name}  (id={cid})")
    else:
        print("No new companies (all already existed).")
    print("─" * 68)
    return 0

if __name__ == "__main__":
    sys.exit(main())
