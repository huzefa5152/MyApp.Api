"""
Seeds a Company with the FBR scenarios applicable to its
BusinessActivity × Sector profile (one bill per applicable SN).

Two ways to point it at a company:
 1. --company-id <int>    seed the existing company with that id (recommended
                          when the operator added the company via the UI and
                          will paste their PRAL token themselves)
 2. (no arg)              create / reconcile the built-in demo company
                          ("Hakimi Traders FBR Sandbox") and seed it

The set of scenarios seeded is whatever GET /api/fbr/scenarios/applicable/{id}
returns for the company. If the new endpoint isn't available, falls back to
the original 6-scenario list (Wholesaler × Wholesale/Retails).

Idempotent: re-running skips any bill already tagged with its [SNxxx] in
paymentTerms. Clients are upserted.

Usage:
    python scripts/seed_fbr_scenarios.py [--base-url http://localhost:5134]
                                         [--company-id 7]
"""
import argparse, json, sys
from datetime import datetime, timedelta
from urllib import request as urlreq, error as urlerr, parse

# ─────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────
DEMO_COMPANY_NAME = "Hakimi Traders FBR Sandbox"
SINDH_PROVINCE_CODE = 8  # from FBR reference API (Sindh)

SELLER = {
    "name":            DEMO_COMPANY_NAME,
    "brandName":       "Hakimi Traders",
    "fullAddress":     "Office # 111, 1st Floor, Industrial Tower Plaza, Sarai Road, Karachi",
    "phone":           "+92-21-36374811",
    "ntn":             "4228937-8",
    "strn":            "3277876175852",
    "startingChallanNumber": 90000,
    "startingInvoiceNumber": 90000,
    "invoiceNumberPrefix":   "HT-FBR-",
    "fbrProvinceCode":       SINDH_PROVINCE_CODE,
    "fbrBusinessActivity":   "Wholesaler",
    "fbrSector":             "Wholesale / Retails",
    "fbrEnvironment":        "sandbox",
    # Placeholder token so challan status can reach "Pending" (the app's
    # IsFbrReady check requires FbrToken non-empty). Replace with a real PRAL
    # sandbox token via Company Settings → FBR Token before actually submitting.
    "fbrToken":              "SANDBOX_PLACEHOLDER_REPLACE_ME",

    # Per-company FBR defaults applied to new bills when the operator hasn't
    # explicitly set SaleType / UOM / PaymentMode. Mirrors the pneumatic +
    # general-order-supplies business: standard-rate goods, pieces-based UOM,
    # credit terms for wholesale, cash for walk-in retail.
    "fbrDefaultSaleType":               "Goods at Standard Rate (default)",
    "fbrDefaultUOM":                    "Numbers, pieces, units",
    "fbrDefaultPaymentModeRegistered":  "Credit",
    "fbrDefaultPaymentModeUnregistered":"Cash",
}

# Real clients provisioned by the operator (verified NTN/STRN, Sindh).
# All are Registered per the IRIS data. The two Unregistered entries at the
# bottom are labelled demos because the operator's list has no unregistered
# clients and the SN002 / SN026-028 scenarios MUST use Unregistered buyers
# per FBR spec.
CLIENTS = [
    # ── Real clients (copied verbatim from operator's Companies 1/2 data) ──
    {
        "key": "lotte",
        "name": "LOTTE Kolson (Pvt.) Limited",
        "address": "L-14, Block 21 F.B.Industrial Area Karachi",
        "ntn":  "0710818-04",
        "strn": "02-03-2100-001-82",
        "registrationType": "Registered",
        "fbrProvinceCode":  SINDH_PROVINCE_CODE,
    },
    {
        "key": "soorty",
        "name": "SOORTY ENTERPRISES Pvt Ltd.",
        "address": "Circle A-2,Zone Companies V Karachi",
        "ntn":  "13-02-0676470-3",
        "strn": "02-16-6114-001-55",
        "registrationType": "Registered",
        "fbrProvinceCode":  SINDH_PROVINCE_CODE,
    },
    {
        "key": "mekofab",
        "name": "MEKO FABRICS (Pvt) Ltd.",
        "address": "WH-25 3/A K.C.I.P Korangi Crossing Karachi",
        "ntn":  "8655568-8",
        "strn": "3277876354879",
        "registrationType": "Registered",
        "fbrProvinceCode":  SINDH_PROVINCE_CODE,
    },
    {
        "key": "afroze",
        "name": "AFROZE TEXTILE INDUSTRIES Pvt Ltd",
        "address": "L-A-1/A Block-22 F.B.AREA Karachi, 754950",
        "ntn":  "0676893-8",
        "strn": "11-00-6001-010-73",
        "registrationType": "Registered",
        "fbrProvinceCode":  SINDH_PROVINCE_CODE,
    },
    {
        "key": "mekodenim",
        "name": "MEKO DENIM MILLS (Pvt) Ltd.",
        "address": "Plot F-131 Hub River Road, SITE. Karachi",
        "ntn":  "8826050-2",
        "strn": "327787622231-3",
        "registrationType": "Registered",
        "fbrProvinceCode":  SINDH_PROVINCE_CODE,
    },
    {
        "key": "aquagen",
        "name": "AQUAGEN PVT LTD.",
        "address": "2000,Square Yard,Adjacent To Masjid-E-Habib PNS Karsaz",
        "ntn":  "36066672",
        "strn": "1700360666711",
        "registrationType": "Registered",
        "fbrProvinceCode":  SINDH_PROVINCE_CODE,
    },
    # ── Labelled-demo Unregistered buyers (none exist in operator's real list,
    #    but FBR scenarios SN002 and SN026-028 REQUIRE Unregistered buyerRegType) ──
    {
        "key": "demo_unreg",
        "name": "[DEMO] Unregistered Buyer — for SN002 only",
        "address": "Karachi",
        "ntn":   "9999999-1",
        "strn":  "99-99-9999-999-99",
        "cnic":  "4220199999991",
        "registrationType": "Unregistered",
        "fbrProvinceCode":  SINDH_PROVINCE_CODE,
    },
    {
        "key": "walkin",
        "name": "[DEMO] Walk-in Retail Customer — for SN026/027/028",
        "address": "Karachi",
        "ntn":   "8888888-1",
        "strn":  "88-88-8888-888-88",
        "cnic":  "4220188888881",
        "registrationType": "Unregistered",
        "fbrProvinceCode":  SINDH_PROVINCE_CODE,
    },
]

# Each scenario: {label, clientKey, poPrefix, items, gstRate, paymentMode}
# Items carry all FBR fields so the bill is FbrReady out of the box.
SCENARIOS = [
    {
        "sn": "SN001",
        "label": "Goods at Standard Rate to Registered Buyer (Wholesale B2B)",
        "clientKey": "lotte",
        "gstRate": 18,
        "paymentMode": "Bank Transfer",
        "items": [
            {
                "desc":    "Pneumatic Solenoid Valve 220VAC 6VA",
                "qty":     10,
                "uom":     "Numbers, pieces, units",
                "unitPrice": 400,
                "hsCode":  "8481.8090",
                "saleType": "Goods at Standard Rate (default)",
            }
        ],
    },
    {
        "sn": "SN002",
        "label": "Goods at Standard Rate to Unregistered Buyer (4% Further Tax)",
        "clientKey": "demo_unreg",
        "gstRate": 18,
        "paymentMode": "Credit",
        "items": [
            {
                # Unique description for the demo — avoids unique-index collision
                # with real challan descriptions already in the catalog.
                "desc":    "[SN002-Demo] Air Cylinder 10 BAR Unregistered Buyer Sample",
                "qty":     4,
                "uom":     "Numbers, pieces, units",
                "unitPrice": 6500,
                "hsCode":  "8412.2100",
                "saleType": "Goods at Standard Rate (default)",
            }
        ],
    },
    {
        "sn": "SN008",
        "label": "Sale of 3rd Schedule Goods (Tax backed out of MRP)",
        "clientKey": "soorty",
        "gstRate": 18,
        "paymentMode": "Credit",
        "items": [
            {
                "desc":    "Branded Lubricant Bottle 1L (3rd Schedule item, MRP Rs. 1180)",
                "qty":     100,
                "uom":     "Litre",
                "unitPrice": 1000,
                "hsCode":  "3923.3090",
                "saleType": "3rd Schedule Goods",
                # MRP per unit × qty = 1180 × 100. FBR expects tax backed OUT of
                # this value — (118000 × 18% / 118%) = 18000 salesTax.
                "retailPrice": 118000,
            }
        ],
    },
    {
        "sn": "SN026",
        "label": "End Consumer Retail, Standard Rate (Walk-in POS)",
        "clientKey": "walkin",
        "gstRate": 18,
        "paymentMode": "Cash",
        "items": [
            {
                "desc":    "Brass Compression Fitting 1/4\"",
                "qty":     5,
                "uom":     "Numbers, pieces, units",
                "unitPrice": 120,
                "hsCode":  "7411.1000",
                "saleType": "Goods at Standard Rate (default)",
            }
        ],
    },
    {
        "sn": "SN027",
        "label": "End Consumer Retail, 3rd Schedule",
        "clientKey": "walkin",
        "gstRate": 18,
        "paymentMode": "Cash",
        "items": [
            {
                "desc":    "Branded Lubricant Bottle 1L (Retail, MRP Rs. 1180)",
                "qty":     2,
                "uom":     "Litre",
                "unitPrice": 1000,
                "hsCode":  "3923.3090",
                "saleType": "3rd Schedule Goods",
                # 1180 × 2 = 2360 retail; FBR salesTax = 2360 × 18% / 118% = 360
                "retailPrice": 2360,
            }
        ],
    },
    {
        "sn": "SN028",
        "label": "End Consumer Retail, Reduced Rate",
        "clientKey": "walkin",
        "gstRate": 5,
        "paymentMode": "Cash",
        "items": [
            {
                "desc":    "Industrial Valve (reduced-rate SRO 297(I)/2023 item)",
                "qty":     1,
                "uom":     "Numbers, pieces, units",
                "unitPrice": 5000,
                "hsCode":  "8481.8090",
                "saleType": "Goods at Reduced Rate",
            }
        ],
    },
]

# ─────────────────────────────────────────────────────────────────────────
# HTTP helpers
# ─────────────────────────────────────────────────────────────────────────
class Api:
    def __init__(self, base_url: str, token: str):
        self.base = base_url.rstrip("/")
        self.token = token

    def _call(self, method: str, path: str, body=None):
        url = self.base + path
        data = None
        headers = {"Authorization": f"Bearer {self.token}"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urlreq.Request(url, data=data, method=method, headers=headers)
        try:
            with urlreq.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, (json.loads(raw) if raw else None)
        except urlerr.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            return e.code, body

    def get(self, path):  return self._call("GET", path)
    def post(self, path, body): return self._call("POST", path, body)
    def put(self, path, body):  return self._call("PUT", path, body)
    def delete(self, path):     return self._call("DELETE", path)


def login(base_url: str, user: str, pw: str) -> str:
    req = urlreq.Request(
        f"{base_url.rstrip('/')}/api/auth/login",
        data=json.dumps({"username": user, "password": pw}).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urlreq.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))["token"]


# ─────────────────────────────────────────────────────────────────────────
# Seeding
# ─────────────────────────────────────────────────────────────────────────
def get_or_create_company(api: Api) -> int:
    status, companies = api.get("/api/companies")
    if status == 200 and companies:
        existing = next((c for c in companies if c.get("name") == DEMO_COMPANY_NAME), None)
        if existing:
            # Upsert: always PUT latest SELLER fields so re-runs bring the company
            # up to spec (e.g. after adding FbrToken in a later version of the script).
            print(f"[=] Company '{DEMO_COMPANY_NAME}' exists (id={existing['id']}) — reconciling fields")
            api.put(f"/api/companies/{existing['id']}", SELLER)
            return existing["id"]
    status, body = api.post("/api/companies", SELLER)
    if status not in (200, 201):
        sys.exit(f"[!] Failed to create company: HTTP {status} {body}")
    company_id = body["id"]
    print(f"[+] Created company '{DEMO_COMPANY_NAME}' (id={company_id})")
    return company_id


def cleanup_stale(api: Api, company_id: int):
    """Delete bills + challans + clients from earlier seed runs that used
    placeholder names ('Ahmed Engineering', 'ABC Distributor', 'Walk-in Customer (Retail)').
    Needed when the CLIENTS list changes between runs so the demo company ends
    up with only the intended set.
    """
    legacy_client_names = {
        "Ahmed Engineering Works",
        "ABC Distributor (Pvt) Ltd",
        "Walk-in Customer (Retail)",
    }

    # 1) Delete bills created for legacy clients (SN tag in paymentTerms)
    status, bills = api.get(f"/api/invoices/company/{company_id}")
    if status == 200 and bills:
        for b in bills:
            if (b.get("paymentTerms") or "").startswith("[SN"):
                api.delete(f"/api/invoices/{b['id']}")
        print(f"[.] Deleted {len([b for b in bills if (b.get('paymentTerms') or '').startswith('[SN')])} legacy SN-tagged bills")

    # 2) Delete challans (legacy ones now orphaned)
    status, challans = api.get(f"/api/deliverychallans/company/{company_id}")
    if status == 200 and challans:
        deleted = 0
        for ch in challans:
            po = (ch.get("poNumber") or "")
            if "SN00" in po and "-DEMO-" in po:
                r, _ = api.delete(f"/api/deliverychallans/{ch['id']}")
                if r in (200, 204): deleted += 1
        print(f"[.] Deleted {deleted} legacy demo challans")

    # 3) Delete legacy placeholder clients
    status, existing = api.get(f"/api/clients/company/{company_id}")
    if status == 200 and existing:
        for c in existing:
            if c["name"] in legacy_client_names:
                r, _ = api.delete(f"/api/clients/{c['id']}")
                if r in (200, 204):
                    print(f"[.] Deleted legacy client '{c['name']}'")


def get_or_create_clients(api: Api, company_id: int) -> dict:
    status, existing = api.get(f"/api/clients/company/{company_id}")
    existing_map = {c["name"]: c for c in (existing or [])} if status == 200 else {}
    out = {}
    for c in CLIENTS:
        key = c.pop("key")
        body = {**c, "companyId": company_id}
        if c["name"] in existing_map:
            ex = existing_map[c["name"]]
            # Upsert: PUT new STRN/CNIC/etc so challans created on re-run pass IsFbrReady
            body["id"] = ex["id"]
            api.put(f"/api/clients/{ex['id']}", body)
            print(f"[=] Client '{c['name']}' exists (id={ex['id']}) — reconciling fields")
            out[key] = ex["id"]
            continue
        status, resp = api.post("/api/clients", body)
        if status not in (200, 201):
            sys.exit(f"[!] Failed to create client '{c['name']}': HTTP {status} {resp}")
        out[key] = resp["id"]
        print(f"[+] Created client '{c['name']}' (id={resp['id']}, regType={c['registrationType']})")
    return out


def create_scenario_bill(api: Api, company_id: int, client_id: int, scenario: dict, day_offset: int):
    """Creates a challan + a bill (invoice) from it, with FBR fields populated."""
    sn = scenario["sn"]
    label = scenario["label"]

    # Idempotency: check if a bill already exists for this scenario (tagged via
    # paymentTerms field which starts with "[SN00x]"). If so, skip.
    status, existing_bills = api.get(f"/api/invoices/company/{company_id}")
    if status == 200 and existing_bills:
        for b in existing_bills:
            if (b.get("paymentTerms") or "").startswith(f"[{sn}]"):
                print(f"[=] [{sn}] Bill #{b['invoiceNumber']} already exists — skipping")
                return b

    # 1) Create challan
    challan_dto = {
        "companyId":    company_id,
        "clientId":     client_id,
        "poNumber":     f"{sn}-DEMO-{datetime.now().strftime('%y%m%d%H%M%S')}",
        "poDate":       (datetime.utcnow() - timedelta(days=day_offset)).strftime("%Y-%m-%dT00:00:00"),
        "deliveryDate": (datetime.utcnow() - timedelta(days=day_offset)).strftime("%Y-%m-%dT00:00:00"),
        "site":         None,
        "items": [
            {
                "description": it["desc"],
                "quantity":    it["qty"],
                "unit":        it["uom"],  # stored as text; FBR UOM picked at bill-time
            }
            for it in scenario["items"]
        ],
        "warnings": [],
    }
    status, challan = api.post(f"/api/deliverychallans/company/{company_id}", challan_dto)
    if status not in (200, 201):
        print(f"[!] Challan create failed for {sn}: HTTP {status} {challan}")
        return None

    print(f"[+] [{sn}] Challan #{challan['challanNumber']} created (id={challan['id']})")

    # 2) Build invoice DTO referencing the challan items
    challan_items = challan["items"]
    invoice_items = []
    for ci, si in zip(challan_items, scenario["items"]):
        item_payload = {
            "deliveryItemId": ci["id"],
            "unitPrice":      si["unitPrice"],
            "description":    si["desc"],
            "uom":             si["uom"],
            "hsCode":          si["hsCode"],
            "saleType":        si["saleType"],
        }
        # 3rd-schedule MRP × qty — required by FBR (error 0090) for SN008/SN027
        if "retailPrice" in si:
            item_payload["fixedNotifiedValueOrRetailPrice"] = si["retailPrice"]
        invoice_items.append(item_payload)

    invoice_dto = {
        "date":         datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
        "companyId":    company_id,
        "clientId":     client_id,
        "gstRate":      scenario["gstRate"],
        "paymentTerms": f"[{sn}] {label}",
        "documentType": 4,  # Sale Invoice
        "paymentMode":  scenario["paymentMode"],
        "challanIds":   [challan["id"]],
        "items":        invoice_items,
        "poDateUpdates": {},
    }
    status, invoice = api.post("/api/invoices", invoice_dto)
    if status not in (200, 201):
        print(f"[!] Invoice create failed for {sn}: HTTP {status} {invoice}")
        return None

    subtotal = invoice.get("subtotal", 0)
    gst      = invoice.get("gstAmount", 0)
    total    = invoice.get("grandTotal", 0)
    print(f"[+] [{sn}] Bill #{invoice['invoiceNumber']} created — "
          f"Subtotal={subtotal} GST@{scenario['gstRate']}%={gst} Total={total}")
    return invoice


# Default per-scenario bill recipe used when the backend's catalog has a
# scenario this script doesn't have a hand-tuned recipe for. The recipe is
# generic but FBR-valid: standard-rate goods to a registered buyer at 18 %.
# Operators can edit the resulting bill before validating to FBR.
GENERIC_RECIPE_REGISTERED = {
    "clientKey": "lotte",
    "gstRate": 18,
    "paymentMode": "Credit",
    "items": [{
        "desc":       "[Auto-seeded scenario stub] — adjust description before submitting",
        "qty":        1,
        "uom":        "Numbers, pieces, units",
        "unitPrice":  1000,
        "hsCode":     "8481.8090",
        "saleType":   "Goods at standard rate (default)",
    }],
}
GENERIC_RECIPE_UNREGISTERED = {
    "clientKey": "demo_unreg",
    "gstRate": 18,
    "paymentMode": "Cash",
    "items": [{
        "desc":       "[Auto-seeded scenario stub] — adjust description before submitting",
        "qty":        1,
        "uom":        "Numbers, pieces, units",
        "unitPrice":  1000,
        "hsCode":     "8481.8090",
        "saleType":   "Goods at standard rate (default)",
    }],
}


def get_applicable_scenarios(api: Api, company_id: int):
    """Asks the backend which SN scenarios apply to this company. Falls back
    to the hard-coded 6-scenario list if the endpoint isn't deployed yet."""
    status, body = api.get(f"/api/fbr/scenarios/applicable/{company_id}")
    if status != 200 or not isinstance(body, dict):
        print(f"[i] /scenarios/applicable not available (HTTP {status}); using built-in 6-scenario list")
        return [s["sn"] for s in SCENARIOS], None
    sns = [s["code"] for s in body.get("scenarios", [])]
    return sns, body


def synthesize_recipe(sn_code: str, scenario_meta: dict | None):
    """For an SN code we don't have a tuned recipe for, build a generic one
    from the scenario metadata. Returns the same shape the SCENARIOS list uses."""
    is_unreg = (scenario_meta or {}).get("buyerRegistrationType") == "Unregistered"
    base = GENERIC_RECIPE_UNREGISTERED if is_unreg else GENERIC_RECIPE_REGISTERED
    rate = (scenario_meta or {}).get("defaultRate", 18)
    sale_type = (scenario_meta or {}).get("saleType", "Goods at standard rate (default)")
    item = {**base["items"][0], "saleType": sale_type}
    return {
        "sn":          sn_code,
        "label":       (scenario_meta or {}).get("description", f"Generic stub for {sn_code}"),
        "clientKey":   base["clientKey"],
        "gstRate":     rate,
        "paymentMode": base["paymentMode"],
        "items":       [item],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url",   default="http://localhost:5134")
    parser.add_argument("--user",       default="admin")
    parser.add_argument("--password",   default="admin123")
    parser.add_argument("--company-id", type=int, default=None,
                        help="Seed scenarios into this existing company id "
                             "(applicability filtered by its activity × sector). "
                             "If omitted, creates / reuses 'Hakimi Traders FBR Sandbox'.")
    args = parser.parse_args()

    print(f"[*] Logging in to {args.base_url} as {args.user}")
    token = login(args.base_url, args.user, args.password)
    api = Api(args.base_url, token)

    if args.company_id:
        company_id = args.company_id
        status, body = api.get(f"/api/companies/{company_id}")
        if status != 200:
            sys.exit(f"[!] Company {company_id} not found (HTTP {status}).")
        print(f"[=] Seeding company id {company_id} ('{body.get('name')}')")
    else:
        print(f"[*] No --company-id given; creating / reconciling demo company")
        company_id = get_or_create_company(api)

    cleanup_stale(api, company_id)
    client_ids = get_or_create_clients(api, company_id)

    # Pull the applicable scenario list from the backend catalog; this gives
    # us up-to-date applicability based on the company's activity × sector.
    applicable_codes, applicable_payload = get_applicable_scenarios(api, company_id)
    if applicable_payload:
        print(f"[*] Backend says {applicable_payload.get('count')} scenarios apply to this company "
              f"(activities={applicable_payload.get('activities')}, sectors={applicable_payload.get('sectors')})")
    else:
        print(f"[*] Using fallback list: {applicable_codes}")

    # Index our hand-tuned recipes by SN so we can prefer them over generic stubs.
    by_sn = {sc["sn"]: sc for sc in SCENARIOS}
    scenario_meta = {s["code"]: s for s in (applicable_payload.get("scenarios", []) if applicable_payload else [])}

    for i, sn_code in enumerate(applicable_codes):
        sc = by_sn.get(sn_code)
        if sc is None:
            sc = synthesize_recipe(sn_code, scenario_meta.get(sn_code))
            print(f"[i] No tuned recipe for {sn_code}; using generic stub")
        client_id = client_ids.get(sc["clientKey"])
        if client_id is None:
            print(f"[!] No client for key '{sc['clientKey']}' — skipping {sc['sn']}")
            continue
        create_scenario_bill(api, company_id, client_id, sc, day_offset=i)

    print()
    print(f"[OK] Done. Open the app, pick company id {company_id}, go to Bills,")
    print(f"     and you should see one bill per applicable SN scenario tagged in")
    print(f"     paymentTerms. Each has HSCode, SaleType, and UOM populated so it")
    print(f"     is FBR-ready for sandbox submission once PRAL approves the token.")

if __name__ == "__main__":
    main()
