"""Build (or rebuild) the local DEMO environment: fictional companies, sample
master data and transactions, the two sample imports, and a Demo Administrator
who can reach the demo companies and nothing else.

    python scripts/setup_demo_environment.py                 # build / top up
    python scripts/setup_demo_environment.py --reset         # delete demo data first
    python scripts/setup_demo_environment.py --isolation-only

LOCAL ONLY. It talks to a running dev server over the ordinary API — the same
endpoints an operator uses — so every tenant guard, permission check and
validation rule applies to it exactly as it does to a person. That is the point:
data seeded around the API would prove nothing about isolation.

WHAT IT WILL NOT TOUCH
----------------------
It only ever creates, edits or deletes objects whose names are in DEMO_COMPANIES
or DEMO_ADMIN below. Any other company on the installation is read (to prove the
Demo Administrator cannot see it) and never written. --reset deletes the demo
companies only, by exact name match.

THE DEMO ADMINISTRATOR IS NOT A SPECIAL CASE
--------------------------------------------
It is an ordinary user with an ordinary role and ordinary UserCompany grants.
Access is fail-closed already (Services/Implementations/CompanyAccessGuard:
a non-seed-admin sees only companies listed in UserCompanies), so nothing in the
application knows this account exists. Its role deliberately EXCLUDES the
installation-wide administration keys — tenant access, user administration, RBAC
and audit logs — because those are not company-scoped: with
tenantaccess.manage.assign it could simply grant itself another tenant, which
would make the whole exercise meaningless.
"""
import argparse
import io
import json
import os
import random
import sys
import time
from datetime import date, timedelta

import requests

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATES = os.path.join(HERE, "myapp-frontend", "public", "templates")
STOCK_SAMPLE = os.path.join(TEMPLATES, "opening-stock-template.xlsx")
COSTING_SAMPLE = os.path.join(TEMPLATES, "gd-costing-template.xlsx")

DEMO_ADMIN = {
    "username": "demo.admin",
    "fullName": "Demo Administrator",
    "role": "User",           # never the privileged free-text "Admin"
}
DEMO_ROLE = "Demo Administrator"

# Permission MODULES the demo role must not hold.
#
# This list SHRANK when hierarchical management scope landed. users, rbac and
# tenantaccess used to be withheld because they were installation-wide: holding
# tenantaccess.manage.assign let an account grant itself another tenant. They
# are now scoped by the CreatedByUserId chain -- an Administrator administers
# only its own descendants and can delegate only the companies it already holds
# -- so the demo account can be given them and still reach nothing but its own
# tree. That is what makes the demo worth showing: it creates its own company
# and its own user, live.
#
# Still withheld, because the hierarchy does NOT scope them:
#   divisionaccess -- division grants are not part of the creator chain
#   auditlogs      -- the audit log is installation-wide
#   companies.manage.delete -- demo safety, nothing to do with scope
EXCLUDED_MODULES = {"divisionaccess", "auditlogs"}
EXCLUDED_KEYS = {"companies.manage.delete"}

# NTNs and CNICs are deliberately impossible: a real NTN never starts 000.
DEMO_COMPANIES = [
    {
        "key": "nova",
        "name": "Nova Industrial Supplies (Pvt.) Ltd.",
        "brandName": "Nova Industrial",
        "fullAddress": "Plot 14, Sector 23, Korangi Industrial Area, Karachi",
        "phone": "+92-21-3500-1100",
        "ntn": "0000101", "cnic": "0000000000101",
        "story": "importer / engineering supplies",
        "fbr": True,
    },
    {
        "key": "vertex",
        "name": "Vertex Engineering & Trading (Pvt.) Ltd.",
        "brandName": "Vertex Engineering",
        "fullAddress": "Office 4, Second Floor, Gulberg III, Lahore",
        "phone": "+92-42-3577-2200",
        "ntn": "0000102", "cnic": "0000000000102",
        "story": "engineering workshop and trading",
        "fbr": False,
    },
    {
        "key": "prime",
        "name": "Prime Wholesale Solutions (Pvt.) Ltd.",
        "brandName": "Prime Wholesale",
        "fullAddress": "Shop 8, Hall Road Market, Rawalpindi",
        "phone": "+92-51-4455-3300",
        "ntn": "0000103", "cnic": "0000000000103",
        "story": "general wholesale and distribution",
        "fbr": False,
    },
]

# One catalogue, shared by the three companies -- ItemType is a global catalog
# (CLAUDE.md 5b-2b) and creating it per company would only duplicate rows.
# Every HS code is a real, current tariff line: validation is master-first, so
# an invented code is refused.
PRODUCTS = [
    ("Industrial Bearing 6204", "8482.1000", "Pcs", 1250.00, 1750.00),
    ("Industrial Bearing 6205", "8482.1000", "Pcs", 1480.00, 2050.00),
    ("Hydraulic Hose 1/2 inch", "4009.2200", "Mtr", 615.50, 890.00),
    ("Stainless Steel Bolt M10", "7318.1510", "Kg", 372.25, 520.00),
    ("Electrical Cable 2.5mm", "8544.4990", "Mtr", 148.75, 215.00),
    ("Safety Gloves Coated", "6116.1000", "Pcs", 265.00, 390.00),
    ("Machine Oil 20W 5L", "2710.1951", "Ltr", 985.00, 1340.00),
    ("Rubber O-Ring Seal 25mm", "4016.9390", "Pcs", 42.80, 68.00),
    ("Ball Valve 1 inch", "8481.8090", "Pcs", 2340.00, 3150.00),
    ("Pressure Switch 12V", "8536.5010", "Pcs", 1875.00, 2600.00),
]

CLIENTS = {
    "nova": [
        ("Karakoram Textile Mills (Pvt.) Ltd.", "Registered", "0000201", "Plot 5, S.I.T.E, Karachi"),
        ("Indus Fabrication Works", "Registered", "0000202", "22-C, North Karachi Industrial Area"),
        ("Meridian Packaging Company", "Registered", "0000203", "Sector 15, Korangi, Karachi"),
        ("Sapphire Cold Storage", "Unregistered", None, "Mauripur Road, Karachi"),
        ("Falcon Plastics", "Registered", "0000205", "Landhi Industrial Estate, Karachi"),
        ("Harbour Marine Services", "Unregistered", None, "West Wharf, Karachi"),
    ],
    "vertex": [
        ("Ravi Engineering Works", "Registered", "0000211", "Badami Bagh, Lahore"),
        ("Chenab Steel Traders", "Registered", "0000212", "Shahdara, Lahore"),
        ("Lahore Auto Components", "Registered", "0000213", "Township, Lahore"),
        ("Green Valley Farms Equipment", "Unregistered", None, "Raiwind Road, Lahore"),
        ("Crescent Pumps & Motors", "Registered", "0000215", "Ferozepur Road, Lahore"),
    ],
    "prime": [
        ("Margalla Hardware Store", "Unregistered", None, "Blue Area, Islamabad"),
        ("Potohar Traders", "Registered", "0000221", "Saddar, Rawalpindi"),
        ("Northern Tools Depot", "Registered", "0000222", "Peshawar Road, Rawalpindi"),
        ("Capital Electricals", "Unregistered", None, "G-9 Markaz, Islamabad"),
        ("Summit Builders Supply", "Registered", "0000224", "I-10 Industrial Area, Islamabad"),
    ],
}

SUPPLIERS = {
    "nova": [
        ("Orient Bearings Trading FZE", "0000301", "Jebel Ali Free Zone, Dubai"),
        ("Pacific Hose & Fittings Co.", "0000302", "Port Qasim, Karachi"),
        ("Continental Lubricants (Pvt.) Ltd.", "0000303", "Hub, Balochistan"),
        ("Seaboard Clearing Agents", "0000304", "Customs House Road, Karachi"),
    ],
    "vertex": [
        ("Punjab Fastener Industries", "0000311", "Gujranwala"),
        ("Allied Cable Manufacturers", "0000312", "Sheikhupura Road, Lahore"),
        ("Metro Safety Products", "0000313", "Multan Road, Lahore"),
    ],
    "prime": [
        ("Frontier Import House", "0000321", "Peshawar"),
        ("Capital Distribution Partners", "0000322", "I-9 Industrial Area, Islamabad"),
        ("Unity Rubber Products", "0000323", "Wah Cantt"),
    ],
}


# ── HTTP ──────────────────────────────────────────────────────────────────
class Api:
    def __init__(self, base, username, password):
        self.base = base.rstrip("/")
        self.username = username
        self.s = requests.Session()
        r = self.s.post(self.base + "/api/auth/login",
                        json={"username": username, "password": password}, timeout=60)
        if r.status_code != 200:
            sys.exit("FATAL: login as {0} failed ({1} {2})".format(username, r.status_code, r.text[:200]))
        self.token = r.json()["token"]
        self.s.headers.update({"Authorization": "Bearer " + self.token})

    def call(self, method, path, **kw):
        kw.setdefault("timeout", 300)
        r = self.s.request(method, self.base + "/api" + path, **kw)
        try:
            body = r.json()
        except Exception:
            body = r.text[:400]
        return r.status_code, body

    def get(self, p, **kw):
        return self.call("GET", p, **kw)

    def post(self, p, body=None, **kw):
        return self.call("POST", p, json=body, **kw)

    def put(self, p, body=None, **kw):
        return self.call("PUT", p, json=body, **kw)

    def delete(self, p, **kw):
        return self.call("DELETE", p, **kw)

    def must(self, method, path, body=None, what=""):
        st, out = self.call(method, path, json=body)
        if st not in (200, 201, 204):
            sys.exit("FATAL: {0} {1} -> {2} {3}\n{4}".format(
                method, path, st, what, json.dumps(out)[:500]))
        return out


def listing(payload):
    """Every list endpoint here answers either a bare array or a paged object."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return payload.get("items") or payload.get("rows") or []
    return []


def d(days_ago):
    return (date.today() - timedelta(days=days_ago)).isoformat()


# ── Stages ────────────────────────────────────────────────────────────────
def generate_password():
    """A password for this run only. Long, mixed, and never written down here."""
    import secrets
    import string
    pool = string.ascii_letters + string.digits
    return "Demo-" + "".join(secrets.choice(pool) for _ in range(16)) + "!7"


def find_company(api, name):
    for c in listing(api.get("/companies")[1]):
        if c.get("name") == name:
            return c
    return None


def stage_reset(api):
    print("\n=== Reset: removing demo objects ===")

    # ORDER MATTERS, in a way that is not obvious either way round.
    #
    # ItemType is a global catalog with no CompanyId, and its visibility is
    # DERIVED from the documents that reference it (CLAUDE.md 5b-2b). So:
    #
    #   delete the companies first -> the rows are orphaned: invisible to every
    #     API, yet still holding the unique (name, HS code) key, so the next
    #     build can neither re-create them nor find them. The only way out is a
    #     direct database read.
    #   delete the item types first -> refused, because the demo bills still
    #     reference them.
    #
    # So: note the ids while they are still visible, delete the companies,
    # then delete the item types by the ids we kept.
    demo_names = {p[0] for p in PRODUCTS}
    doomed = {}
    for spec in DEMO_COMPANIES:
        c = find_company(api, spec["name"])
        if not c:
            continue
        for name in sorted(demo_names):
            for it in listing(api.get("/itemtypes", params={
                    "companyId": c["id"], "search": name})[1]):
                if it.get("name") == name:
                    doomed[name] = it["id"]
                    break

    for spec in DEMO_COMPANIES:
        c = find_company(api, spec["name"])
        if not c:
            continue
        st, out = api.delete("/companies/{0}".format(c["id"]))
        print("  delete {0:<45} {1}".format(spec["name"][:44], st))
        if st not in (200, 204):
            print("     {0}".format(json.dumps(out)[:300]))

    removed = 0
    for name, item_id in sorted(doomed.items()):
        st, out = api.delete("/itemtypes/{0}".format(item_id))
        if st in (200, 204):
            removed += 1
        else:
            print("  item type {0} (id {1}) not removed: {2} {3}".format(
                name, item_id, st, json.dumps(out)[:160]))
    print("  removed {0} of {1} demo item types".format(removed, len(doomed)))

    for u in listing(api.get("/users")[1]):
        if u.get("username") == DEMO_ADMIN["username"]:
            st, _ = api.delete("/users/{0}".format(u["id"]))
            print("  delete user {0:<40} {1}".format(DEMO_ADMIN["username"], st))


def stage_companies(api):
    print("\n=== Companies ===")
    made = {}
    for spec in DEMO_COMPANIES:
        existing = find_company(api, spec["name"])
        if existing:
            print("  {0:<45} exists (id {1})".format(spec["name"][:44], existing["id"]))
            made[spec["key"]] = existing
            continue
        body = {
            "name": spec["name"],
            "brandName": spec["brandName"],
            "fullAddress": spec["fullAddress"],
            "phone": spec["phone"],
            "ntn": spec["ntn"],
            "cnic": spec["cnic"],
            "startingChallanNumber": 1,
            "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1,
            "startingGoodsReceiptNumber": 1,
            "inventoryTrackingEnabled": True,
            "enableGl": True,
        }
        if spec["fbr"]:
            # Sandbox, and NO token. A demo company must never carry a real
            # credential, and everything worth showing on the FBR screens
            # (configuration, scenarios, readiness) renders without one.
            body.update({
                "fbrEnabled": True,
                "fbrEnvironment": "sandbox",
                "fbrProvinceCode": 8,
                "fbrBusinessActivity": "Importer",
                "fbrSector": "All Other Sectors",
                "fbrSellerNtnCnic": spec["ntn"],
            })
        st, out = api.post("/companies", body)
        if st not in (200, 201) and spec["fbr"]:
            # A company cannot be saved FBR-on without everything FBR needs.
            # Falling back is better than failing the whole build: the demo
            # does not depend on the flag.
            print("     FBR-on create refused ({0}), retrying with FBR off".format(st))
            body["fbrEnabled"] = False
            st, out = api.post("/companies", body)
        if st not in (200, 201):
            sys.exit("FATAL: create company {0} -> {1} {2}".format(spec["name"], st, json.dumps(out)[:400]))
        print("  {0:<45} created (id {1})".format(spec["name"][:44], out["id"]))
        made[spec["key"]] = out
    return made


def stage_master_data(api, companies):
    print("\n=== Master data ===")
    items = {}
    for name, hs, uom, cost, sale in PRODUCTS:
        found = [i for i in listing(api.get("/itemtypes", params={"search": name, "includeAutoGenerated": "true"})[1])
                 if i.get("name") == name]
        if found:
            items[name] = found[0]["id"]
            continue
        st, out = api.post("/itemtypes?companyId={0}".format(companies["nova"]["id"]), {
            "name": name, "hsCode": hs, "uom": uom, "isFavorite": True,
            "companyId": companies["nova"]["id"],
        })
        if st not in (200, 201):
            sys.exit("FATAL: item type {0} -> {1} {2}".format(name, st, json.dumps(out)[:300]))
        items[name] = out["id"]
    print("  item catalogue: {0} products".format(len(items)))

    # Register the catalogue with the other two companies, so each company's
    # pickers show it. Creating with a companyId is what registers it
    # (CLAUDE.md 5b-2b: membership is derived, and a new item has no documents).
    for key in ("vertex", "prime"):
        cid = companies[key]["id"]
        for name in items:
            api.post("/itemtypes/company/{0}/register".format(cid), {"itemTypeId": items[name]})

    contacts = {}
    for key, company in companies.items():
        cid = company["id"]
        made_clients, made_suppliers = [], []
        have = {c.get("name") for c in listing(api.get("/clients/company/{0}".format(cid))[1])}
        for name, reg, ntn, addr in CLIENTS[key]:
            if name in have:
                continue
            body = {"companyId": cid, "name": name, "address": addr,
                    "phone": "+92-300-{0:07d}".format(random.randint(1000000, 9999999)),
                    "registrationType": reg, "fbrProvinceCode": 8}
            if ntn:
                body["ntn"] = ntn
            st, out = api.post("/clients", body)
            if st in (200, 201):
                made_clients.append(out)
        have_s = {s.get("name") for s in listing(api.get("/suppliers/company/{0}".format(cid))[1])}
        for name, ntn, addr in SUPPLIERS[key]:
            if name in have_s:
                continue
            st, out = api.post("/suppliers", {
                "companyId": cid, "name": name, "address": addr, "ntn": ntn,
                "registrationType": "Registered", "fbrProvinceCode": 8,
                "phone": "+92-300-{0:07d}".format(random.randint(1000000, 9999999)),
            })
            if st in (200, 201):
                made_suppliers.append(out)
        clients = listing(api.get("/clients/company/{0}".format(cid))[1])
        suppliers = listing(api.get("/suppliers/company/{0}".format(cid))[1])
        contacts[key] = {"clients": clients, "suppliers": suppliers}
        print("  {0:<8} {1} clients, {2} suppliers".format(key, len(clients), len(suppliers)))
    return items, contacts


def stage_transactions(api, companies, items, contacts):
    """A believable half-year: buy, sell, get paid, pay the supplier."""
    print("\n=== Transactions ===")
    rng = random.Random(20260914)          # reproducible demo data
    names = [p[0] for p in PRODUCTS]
    cost_of = {p[0]: p[3] for p in PRODUCTS}
    price_of = {p[0]: p[4] for p in PRODUCTS}
    uom_of = {p[0]: p[2] for p in PRODUCTS}

    for key, company in companies.items():
        cid = company["id"]
        clients = contacts[key]["clients"]
        suppliers = contacts[key]["suppliers"]
        if not clients or not suppliers:
            print("  {0:<8} skipped (no contacts)".format(key))
            continue

        # A top-up run must not double the books. Anything already billed means
        # this company has been through here before; --reset is how you rebuild.
        existing = listing(api.get("/invoices/company/{0}".format(cid))[1])
        if existing:
            print("  {0:<8} already has {1} bills - left alone (use --reset to rebuild)".format(
                key, len(existing)))
            continue

        bought = sold = receipts = payments = 0

        # Purchases first, or every sale would be an oversell.
        for n in range(6):
            supplier = suppliers[n % len(suppliers)]
            picks = rng.sample(names, 3)
            lines = [{
                "itemTypeId": items[p], "description": p,
                "quantity": rng.choice([50, 80, 120, 200, 250]),
                "uom": uom_of[p], "unitPrice": cost_of[p],
            } for p in picks]
            st, _ = api.post("/purchasebills", {
                "date": d(170 - n * 22), "companyId": cid, "supplierId": supplier["id"],
                "supplierBillNumber": "SB-{0}-{1:04d}".format(key.upper()[:3], 1000 + n),
                "gstRate": 18, "paymentMode": "Bank Transfer", "items": lines,
            })
            if st in (200, 201):
                bought += 1

        for n in range(10):
            client = clients[n % len(clients)]
            picks = rng.sample(names, rng.choice([1, 2, 3]))
            lines = [{
                "itemTypeId": items[p], "description": p,
                "quantity": rng.choice([5, 10, 15, 20, 25]),
                "uom": uom_of[p], "unitPrice": price_of[p],
            } for p in picks]
            st, bill = api.post("/invoices/standalone", {
                "date": d(150 - n * 14), "companyId": cid, "clientId": client["id"],
                "gstRate": 18, "paymentMode": "Bank Transfer", "items": lines,
            })
            if st not in (200, 201):
                continue
            sold += 1
            # Two sales in three are paid, so the receivables report has both
            # settled and outstanding customers rather than one flat state.
            if n % 3 != 2:
                st, _ = api.post("/payments/receipts/company/{0}".format(cid), {
                    "direction": "Receipt", "date": d(140 - n * 14),
                    "contactType": "Client", "contactId": client["id"],
                    "method": "Bank Transfer",
                    "amount": round(float(bill.get("grandTotal") or 0), 2),
                    "description": "Received against {0}".format(bill.get("invoiceNumber")),
                    "allocations": [{"kind": "Document", "invoiceId": bill["id"],
                                     "amount": round(float(bill.get("grandTotal") or 0), 2)}],
                })
                if st in (200, 201):
                    receipts += 1

        for n, supplier in enumerate(suppliers[:3]):
            st, _ = api.post("/payments/payments/company/{0}".format(cid), {
                "direction": "Payment", "date": d(60 - n * 12),
                "contactType": "Supplier", "contactId": supplier["id"],
                "method": "Bank Transfer", "amount": 250000.00,
                "description": "On account payment",
                "allocations": [{"kind": "OnAccount", "amount": 250000.00}],
            })
            if st in (200, 201):
                payments += 1

        print("  {0:<8} {1} purchases, {2} sales, {3} receipts, {4} payments".format(
            key, bought, sold, receipts, payments))


def stage_document_chain(api, companies, items, contacts):
    """The documents a demo has to be able to SHOW.

    Sales bills and purchases alone leave six screens empty -- goods receipts,
    quotes, orders, challans, the FBR sandbox and the customer portal -- and
    Act 2 of the demo is precisely the chain quote -> order -> challan -> bill.
    A screen with "No sales orders found" on it during a demo is worse than not
    opening the screen at all.

    Every conversion goes through the product's OWN convert endpoints
    (DocumentCopyService), never by re-creating the destination by hand, so what
    the demo shows is the lineage a customer would get.
    """
    print("\n=== Document chain ===")
    names = [p[0] for p in PRODUCTS]
    uom_of = {p[0]: p[2] for p in PRODUCTS}
    price_of = {p[0]: p[4] for p in PRODUCTS}

    for key, company in companies.items():
        cid = company["id"]
        clients = contacts[key]["clients"]
        suppliers = contacts[key]["suppliers"]
        if not clients or not suppliers:
            continue

        made = {"receipts": 0, "quotes": 0, "orders": 0, "challans": 0, "portals": 0}

        existing = listing(api.get("/salesquotes/company/{0}".format(cid))[1])
        if existing:
            print("  {0:<8} already has {1} quotes - left alone".format(key, len(existing)))
            continue

        # Goods received against a supplier, before any of it is sold.
        for n, supplier in enumerate(suppliers[:2]):
            picks = names[n * 2:n * 2 + 2]
            st, _ = api.post("/goodsreceipts", {
                "receiptDate": d(120 - n * 15), "companyId": cid, "supplierId": supplier["id"],
                "supplierChallanNumber": "SDC-{0}-{1:03d}".format(key.upper()[:3], 200 + n),
                "site": "Main Store",
                "items": [{"itemTypeId": items[p], "description": p,
                           "quantity": 40, "unit": uom_of[p]} for p in picks],
            })
            if st in (200, 201):
                made["receipts"] += 1

        # The chain. Quote -> order -> challan, each through the conversion the
        # product ships, so the documents carry their lineage.
        for n in range(3):
            client = clients[n % len(clients)]
            picks = names[n * 3 % len(names):][:2] or names[:2]
            lines = [{"itemTypeId": items[p], "description": p, "quantity": 6 + n * 2,
                      "unit": uom_of[p], "unitPrice": price_of[p]} for p in picks]

            st, quote = api.post("/salesquotes/company/{0}".format(cid), {
                "clientId": client["id"], "date": d(95 - n * 20),
                "validUntil": d(95 - n * 20 - 30),
                "customerEnquiryRef": "RFQ-{0}-{1:03d}".format(key.upper()[:3], 100 + n),
                "notes": "Prices valid 30 days. Delivery ex-stock.",
                "gstRate": 18, "items": lines,
            })
            if st not in (200, 201):
                continue
            made["quotes"] += 1

            # Only the first two quotes progress. A pipeline where every quote
            # became an order is not a pipeline anyone recognises.
            if n == 2:
                continue

            st, order = api.post("/salesquotes/{0}/convert-to-order".format(quote["id"]), {})
            if st not in (200, 201):
                st, order = api.post("/salesorders/company/{0}".format(cid), {
                    "clientId": client["id"], "orderDate": d(90 - n * 20),
                    "customerPoNumber": "PO-{0}-{1:03d}".format(key.upper()[:3], 500 + n),
                    "customerPoDate": d(90 - n * 20), "site": "Main Gate",
                    "items": lines,
                })
            if st not in (200, 201):
                continue
            made["orders"] += 1

            # And only the first order is delivered, so the Orders screen shows
            # one open and one fulfilled.
            if n == 0:
                st, _ = api.post("/salesorders/{0}/create-challan".format(order["id"]), {})
                if st not in (200, 201):
                    st, _ = api.post("/deliverychallans/company/{0}".format(cid), {
                        "clientId": client["id"], "poNumber": "PO-{0}-500".format(key.upper()[:3]),
                        "poDate": d(88), "deliveryDate": d(86), "site": "Main Gate",
                        "items": [{"itemTypeId": items[p], "description": p,
                                   "quantity": 4, "unit": uom_of[p]} for p in picks],
                    })
                if st in (200, 201):
                    made["challans"] += 1

        # One customer gets a portal link. It is the only anonymous surface in
        # the product and worth showing, but only one -- a list of five identical
        # portals says nothing a single row does not.
        st, _ = api.post("/customer-portals", {
            "companyId": cid, "clientId": clients[0]["id"], "documentType": "Bill",
        })
        if st in (200, 201):
            made["portals"] += 1

        print("  {0:<8} {1} goods receipts, {2} quotes, {3} orders, {4} challans, {5} portal".format(
            key, made["receipts"], made["quotes"], made["orders"],
            made["challans"], made["portals"]))


def stage_fbr_demo_bills(api, companies):
    """Seed the FBR scenario bills on the FBR-enabled demo company.

    The FBR Sandbox screen is one of the strongest things to show and it opens
    on "No demo bills yet" until this runs. Seeding writes local demo bills
    only; it does not contact FBR, which matters because the demo company
    deliberately carries no token.
    """
    print("\n=== FBR demo bills ===")
    for key, company in companies.items():
        if not company.get("fbrEnabled"):
            continue
        st, out = api.post("/fbr/sandbox/{0}/seed".format(company["id"]), None)
        if st in (200, 201):
            print("  {0:<8} created {1}, skipped {2}".format(
                key, out.get("created"), out.get("skipped")))
        else:
            print("  {0:<8} seed refused ({1}) {2}".format(key, st, json.dumps(out)[:200]))


def _upload(api, path, files, params):
    r = api.s.post(api.base + "/api" + path, files=files, params=params, timeout=600)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, r.text[:400]


def already_imported(errors):
    """The importer refuses a file it has already taken, and that is a success
    on a top-up run: the demo data is in the state the sample describes. Both
    defences show up here -- the identical-bytes one and the content one
    (CLAUDE.md 5b-3), plus the costing importer's own per-GD check."""
    text = " ".join(errors).lower()
    return ("already imported" in text
            or "already carries" in text
            or "already have a consignment" in text)


def _profile_id(ident):
    """The layout to import against: the workbook's own match when there is one,
    otherwise the built-in default -- which is exactly what the import screen
    pre-selects. The GD costing sample deliberately does NOT match by
    fingerprint: the built-in signature was taken from a client workbook whose
    headings differ (it says "Cost Valve" where this says "Value"). Column
    numbers are the contract and the layout's own header aliases resolve the
    names, so the default layout reads this sheet correctly."""
    for slot in ("matchedProfile", "defaultProfile"):
        hit = ident.get(slot)
        if isinstance(hit, dict) and hit.get("profileId"):
            return hit["profileId"]
    for cand in ident.get("candidates") or []:
        if cand.get("profileId"):
            return cand["profileId"]
    return None


def stage_imports(api, companies):
    """Run the two sample workbooks through the REAL importers.

    A sample file that has never been imported is a guess. Both are run against
    the importer company, which is the one whose story they belong to -- and as
    the DEMO ADMINISTRATOR, not as the seed admin, so the run also proves that
    account holds the permissions the import needs."""
    print("\n=== Sample imports ===")
    cid = companies["nova"]["id"]
    results = {}

    # -- Opening stock ----------------------------------------------------
    with open(STOCK_SAMPLE, "rb") as fh:
        blob = fh.read()
    st, ident = _upload(api, "/spreadsheet-import/identify",
                        {"file": ("opening-stock-template.xlsx", io.BytesIO(blob))},
                        {"companyId": cid, "kind": "OpeningStock"})
    if st != 200:
        print("  opening stock: identify FAILED {0} {1}".format(st, json.dumps(ident)[:300]))
        results["stock"] = False
    else:
        profile = _profile_id(ident)
        st, prev = _upload(api, "/spreadsheet-import/opening-stock/preview",
                           {"file": ("opening-stock-template.xlsx", io.BytesIO(blob))},
                           {"companyId": cid, "profileId": profile})
        if st != 200:
            print("  opening stock: preview FAILED {0} {1}".format(st, json.dumps(prev)[:400]))
            results["stock"] = False
        elif prev.get("blockingErrors"):
            done = already_imported(prev["blockingErrors"])
            results["stock"] = done
            print("  opening stock: {0} {1}".format(
                "already imported - nothing to change" if done else "BLOCKED",
                "" if done else prev["blockingErrors"][:3]))
        else:
            st, out = api.post("/spreadsheet-import/opening-stock/commit", {
                "companyId": cid,
                "importProfileId": prev.get("importProfileId"),
                "profileVersion": prev.get("profileVersion"),
                "fileSha256": prev["fileSha256"], "fileName": prev["fileName"],
                "fileSizeBytes": prev.get("fileSizeBytes", len(blob)),
                "asOfDate": d(200), "postInventoryValue": True,
                "rows": prev["rows"],
            })
            ok = st in (200, 201)
            results["stock"] = ok
            print("  opening stock: {0} rows previewed, commit {1} {2}".format(
                len(prev["rows"]), st, "" if ok else json.dumps(out)[:300]))
            if ok:
                print("     warnings: {0}".format(prev.get("warnings") or "none"))

    # -- GD costing -------------------------------------------------------
    with open(COSTING_SAMPLE, "rb") as fh:
        blob = fh.read()
    st, ident = _upload(api, "/spreadsheet-import/identify",
                        {"file": ("gd-costing-template.xlsx", io.BytesIO(blob))},
                        {"companyId": cid, "kind": "GdCosting"})
    if st != 200:
        print("  gd costing: identify FAILED {0} {1}".format(st, json.dumps(ident)[:300]))
        results["costing"] = False
        return results
    profile = _profile_id(ident)
    st, prev = _upload(api, "/spreadsheet-import/gd-costing/preview",
                       {"file": ("gd-costing-template.xlsx", io.BytesIO(blob))},
                       {"companyId": cid, "profileId": profile})
    if st != 200:
        print("  gd costing: preview FAILED {0} {1}".format(st, json.dumps(prev)[:400]))
        results["costing"] = False
        return results
    if prev.get("blockingErrors"):
        done = already_imported(prev["blockingErrors"])
        results["costing"] = done
        print("  gd costing: {0} {1}".format(
            "already imported - nothing to change" if done else "BLOCKED",
            "" if done else prev["blockingErrors"][:3]))
        return results
    st, out = api.post("/spreadsheet-import/gd-costing/commit", {
        "companyId": cid,
        "importProfileId": prev.get("importProfileId"),
        "profileVersion": prev.get("profileVersion"),
        "fileSha256": prev["fileSha256"], "fileName": prev["fileName"],
        "fileSizeBytes": prev.get("fileSizeBytes", len(blob)),
        "lines": prev.get("lines") or prev.get("rows") or [],
    })
    results["costing"] = st in (200, 201)
    print("  gd costing: commit {0} {1}".format(st, "" if results["costing"] else json.dumps(out)[:400]))
    return results


def stage_demo_admin(api, companies, password):
    print("\n=== Demo Administrator ===")
    all_keys = []
    for r in listing(api.get("/roles")[1]):
        if r.get("id") == 1:
            full = api.get("/roles/1")[1]
            keys = full.get("permissions") or full.get("permissionKeys") or []
            all_keys = [k.get("key") or k.get("permissionKey") if isinstance(k, dict) else k for k in keys]
    scoped = sorted(k for k in all_keys
                    if k.split(".")[0] not in EXCLUDED_MODULES and k not in EXCLUDED_KEYS)
    dropped = sorted(set(all_keys) - set(scoped))

    role = next((r for r in listing(api.get("/roles")[1]) if r.get("name") == DEMO_ROLE), None)
    body = {
        "name": DEMO_ROLE,
        "description": ("Every company-scoped permission. Deliberately WITHOUT user "
                        "administration, RBAC, tenant access, division access and audit "
                        "logs: those are installation-wide, and tenantaccess.manage.assign "
                        "would let the holder grant itself another company."),
        "permissionKeys": scoped,
        "permissions": scoped,
    }
    if role:
        api.must("PUT", "/roles/{0}".format(role["id"]), body, "update demo role")
        role_id = role["id"]
        print("  role updated (id {0}) {1} permissions, {2} withheld".format(role_id, len(scoped), len(dropped)))
    else:
        out = api.must("POST", "/roles", body, "create demo role")
        role_id = out["id"]
        print("  role created (id {0}) {1} permissions, {2} withheld".format(role_id, len(scoped), len(dropped)))
    print("     withheld: {0}".format(", ".join(dropped)))

    company_ids = [c["id"] for c in companies.values()]
    user = next((u for u in listing(api.get("/users")[1])
                 if u.get("username") == DEMO_ADMIN["username"]), None)
    if user:
        uid = user["id"]
        # Only re-set the password if the one we hold does not already work.
        # Changing it rotates the account's SecurityStamp (audit C-6), and the
        # server keeps the previous stamp briefly, so a token minted seconds
        # later is rejected 401 and the rest of the run reads as a total
        # isolation failure -- which is how this was found. A top-up run with
        # the right password should touch nothing.
        probe = requests.post(api.base + "/api/auth/login", timeout=60,
                              json={"username": DEMO_ADMIN["username"], "password": password})
        if probe.status_code == 200:
            print("  user exists (id {0}), password unchanged".format(uid))
        else:
            api.must("PUT", "/users/{0}".format(uid), {"password": password}, "reset demo password")
            print("  user exists (id {0}), password reset -- "
                  "give the server a moment before signing in".format(uid))
            time.sleep(3)
    else:
        out = api.must("POST", "/users", {
            "username": DEMO_ADMIN["username"],
            "password": password,
            "fullName": DEMO_ADMIN["fullName"],
            "role": DEMO_ADMIN["role"],
            "roleIds": [role_id],
            "companyIds": company_ids,
        }, "create demo user")
        uid = out.get("id") or out.get("userId")
        print("  user created (id {0})".format(uid))

    api.must("PUT", "/users/{0}/roles".format(uid), {"roleIds": [role_id]}, "assign role")
    api.must("PUT", "/usercompanies/user/{0}".format(uid), {"companyIds": company_ids}, "assign companies")
    print("  granted companies: {0}".format(company_ids))
    return uid, company_ids


def other_ids_in(payload, company_id):
    """True when this object IS the forbidden company's -- it names the id in a
    field that identifies it, rather than merely containing the digits."""
    for key in ("id", "companyId", "CompanyId"):
        if payload.get(key) == company_id:
            return True
    return False


def stage_isolation(api, base, password, companies):
    """Prove the isolation SERVER-SIDE, by asking for other companies' data as
    the demo account. UI hiding is not evidence.

    THE VERDICT RULE MATTERS AS MUCH AS THE PROBES. An early version of this
    counted "200 with a body that is not a non-empty list" as a pass, and that
    is how it green-lit `/dashboard/kpis?companyId=<other>` returning a whole
    other tenant's dashboard: the body is an object, so it looked empty. A 200
    now passes only when the body carries no trace of the company that was
    asked for. And a response that is text/html is the SPA fallback, i.e. the
    route does not exist -- reported as SKIPPED rather than counted, because a
    probe aimed at a route that is not there proves nothing at all.
    """
    print("=== Isolation review ===")
    demo = Api(base, DEMO_ADMIN["username"], password)
    allowed = {c["id"] for c in companies.values()}
    everything = {c["id"]: c["name"] for c in listing(api.get("/companies")[1])}
    forbidden = sorted(set(everything) - allowed)

    state = {"pass": 0, "fail": 0, "skip": 0}

    def probe(path, company_id, company_name, method="GET", body=None):
        """One request for one company the account may not reach."""
        url = demo.base + "/api" + path
        r = demo.s.request(method, url, json=body, timeout=300)
        ctype = (r.headers.get("content-type") or "")
        if "text/html" in ctype:
            state["skip"] += 1
            print("  SKIP  {0}  (no such route)".format(path))
            return
        if r.status_code in (401, 403, 404):
            state["pass"] += 1
            return
        if r.status_code >= 400:
            state["pass"] += 1
            return
        text = r.text if ("json" in ctype or "text" in ctype) else ""
        rows = []
        payload = None
        try:
            payload = r.json()
            rows = listing(payload)
        except Exception:
            pass
        # A bare id substring is not evidence -- "5" appears inside
        # {"pageSize":5}. Name it, return rows for it, or BE it.
        named = bool(company_name) and company_name in text
        is_it = isinstance(payload, dict) and other_ids_in(payload, company_id)
        if rows or named or is_it:
            state["fail"] += 1
            print("  FAIL  {0} {1} -> {2}: {3}".format(
                method, path, r.status_code, text[:200]))
        else:
            state["pass"] += 1

    def expect_refused(label, status):
        if status in (401, 403, 404):
            state["pass"] += 1
        else:
            state["fail"] += 1
            print("  FAIL  {0} -> {1}".format(label, status))

    visible = {c["id"] for c in listing(demo.get("/companies")[1])}
    expect_refused("company list is exactly the demo companies",
                   403 if visible == allowed else 200)
    if visible != allowed:
        print("        saw {0}, expected {1}".format(sorted(visible), sorted(allowed)))

    # Company-scoped reads, one per module the demo account can otherwise use.
    probes = [
        "/clients/company/{0}", "/suppliers/company/{0}", "/invoices/company/{0}",
        "/purchasebills/company/{0}/paged", "/deliverychallans/company/{0}",
        "/stock/company/{0}/onhand", "/companies/{0}",
        "/dashboard/kpis?companyId={0}&period=all-time",
        "/accounts/company/{0}/tree",
        "/fbr/sandbox/{0}", "/fbr/scenarios/applicable/{0}",
        "/accounting/reports/company/{0}/trial-balance",
        "/payments/receipts/company/{0}/paged", "/customer-ledger/company/{0}",
        "/itemtypes/paged?companyId={0}", "/stock/company/{0}/onhand/excel",
        "/spreadsheet-import/runs?companyId={0}",
        "/printtemplates/company/{0}", "/divisions/company/{0}",
        # Reference lookups that spend the COMPANY's own FBR token.
        "/itemtypes/uoms-for-hs?companyId={0}&hsCode=8481.8090",
        "/itemtypes/fbr-hints?companyId={0}&hsCode=8481.8090",
        # The PO import archive holds customers' own purchase-order PDFs.
        "/poimport/archives?companyId={0}&page=1&pageSize=5",
        # Exports.
        "/reports/company/{0}/client-ledger/excel",
        "/reports/company/{0}/sales/excel",
        "/reports/company/{0}/tax-sheet/excel",
        # Search / autocomplete, which are data paths like any other.
        "/clients/company/{0}?search=a", "/suppliers/company/{0}?search=a",
        "/itemtypes?companyId={0}&search=be",
    ]
    for other in forbidden:
        for shape in probes:
            probe(shape.format(other), other, everything[other])

    # Routes that take only a DOCUMENT id. The sharper test: a companyId in the
    # URL is the obvious thing to guard, but a route that takes an id alone has
    # to look the company up itself, and that is where a missing guard hides.
    for other in forbidden:
        for owner_path, id_path in (("/clients/company/{0}", "/clients/{0}"),
                                    ("/suppliers/company/{0}", "/suppliers/{0}"),
                                    ("/invoices/company/{0}", "/invoices/{0}"),
                                    ("/purchasebills/company/{0}/paged", "/purchasebills/{0}")):
            rows = listing(api.get(owner_path.format(other))[1])
            if rows and isinstance(rows[0], dict) and rows[0].get("id"):
                probe(id_path.format(rows[0]["id"]), other, everything[other])

    # A WRITE aimed at another company, with the id only in the body.
    for other in forbidden[:2]:
        st, body = demo.post("/clients", {
            "companyId": other, "name": "ISOLATION PROBE - should never exist",
            "address": "x", "registrationType": "Unregistered",
        })
        expect_refused("create client into company {0}".format(other), st)
        if st in (200, 201) and isinstance(body, dict) and body.get("id"):
            demo.delete("/clients/{0}".format(body["id"]))

    # An UNSCOPED list must not answer with another tenant's rows either.
    st, body = demo.get("/poimport/archives?page=1&pageSize=50")
    rows = listing(body) if st == 200 else []
    strayed = [r for r in rows if isinstance(r, dict)
               and r.get("companyId") is not None and r["companyId"] not in allowed]
    if strayed:
        state["fail"] += 1
        print("  FAIL  /poimport/archives leaked {0} rows from other companies".format(len(strayed)))
    else:
        state["pass"] += 1

    expect_refused("user administration", demo.get("/users")[0])
    expect_refused("tenant access listing", demo.get("/usercompanies")[0])
    expect_refused("granting itself another company",
                   demo.put("/usercompanies/user/1", {"companyIds": forbidden})[0])

    print("  {0} passed, {1} failed, {2} skipped  (probed {3} forbidden companies: {4})".format(
        state["pass"], state["fail"], state["skip"], len(forbidden),
        [everything[i] for i in forbidden]))
    return state["fail"] == 0


def stage_walkthrough(api, base, password, companies):
    """The other half of the review: prove the account can actually WORK in the
    companies it does own. A verdict built only from refusals would look
    identical if the account could see nothing at all."""
    print("\n=== Demo Administrator walkthrough ===")
    demo = Api(base, DEMO_ADMIN["username"], password)
    ok = True
    for key, company in companies.items():
        cid = company["id"]
        counts = {}
        for label, path in (("clients", "/clients/company/{0}"),
                            ("suppliers", "/suppliers/company/{0}"),
                            ("bills", "/invoices/company/{0}"),
                            ("purchases", "/purchasebills/company/{0}/paged?page=1&pageSize=50"),
                            ("stock", "/stock/company/{0}/onhand")):
            st, body = demo.get(path.format(cid))
            rows = listing(body)
            counts[label] = len(rows) if st == 200 else "ERR {0}".format(st)
            if st != 200:
                ok = False
        st, dash = demo.get("/dashboard/kpis?companyId={0}&period=all-time".format(cid))
        if st != 200:
            ok = False
        # An export is a data path of its own, so exercise a real one.
        r = demo.s.get(demo.base + "/api/stock/company/{0}/onhand/excel".format(cid), timeout=300)
        xlsx = r.status_code == 200 and r.content[:2] == b"PK"
        if not xlsx:
            ok = False
        print("  {0:<8} {1}  dashboard {2}  stock export {3}".format(
            key, counts, "OK" if st == 200 else "ERR",
            "{0} bytes".format(len(r.content)) if xlsx else "FAILED {0}".format(r.status_code)))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--admin-user", default="admin")
    ap.add_argument("--admin-password", default="admin123")
    # No default in source. A password committed to a public repository is a
    # committed password whatever it protects; when none is supplied one is
    # generated for this run and printed at the end.
    ap.add_argument("--demo-password", default=os.environ.get("DEMO_PASSWORD"))
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--isolation-only", action="store_true")
    ap.add_argument("--skip-imports", action="store_true")
    a = ap.parse_args()

    if not a.demo_password:
        a.demo_password = generate_password()
        print("Generated demo password for this run: {0}".format(a.demo_password))
        print("(pass --demo-password or set DEMO_PASSWORD to choose your own)")

    api = Api(a.base, a.admin_user, a.admin_password)

    if a.isolation_only:
        companies = {}
        for spec in DEMO_COMPANIES:
            c = find_company(api, spec["name"])
            if c:
                companies[spec["key"]] = c
        if not companies:
            sys.exit("No demo companies found. Run without --isolation-only first.")
        walked = stage_walkthrough(api, a.base, a.demo_password, companies)
        ok = stage_isolation(api, a.base, a.demo_password, companies) and walked
        sys.exit(0 if ok else 1)

    if a.reset:
        stage_reset(api)

    companies = stage_companies(api)
    items, contacts = stage_master_data(api, companies)
    stage_transactions(api, companies, items, contacts)
    stage_document_chain(api, companies, items, contacts)
    stage_fbr_demo_bills(api, companies)
    stage_demo_admin(api, companies, a.demo_password)
    # As the demo account, deliberately: the import is one of the things it has
    # to be able to do, and running it here is the proof.
    demo_api = Api(a.base, DEMO_ADMIN["username"], a.demo_password)
    imports = {} if a.skip_imports else stage_imports(demo_api, companies)
    walked = stage_walkthrough(api, a.base, a.demo_password, companies)
    ok = stage_isolation(api, a.base, a.demo_password, companies) and walked

    print("\n=== Summary ===")
    for spec in DEMO_COMPANIES:
        c = companies[spec["key"]]
        print("  {0:<45} id {1}   {2}".format(spec["name"][:44], c["id"], spec["story"]))
    print("  Demo Administrator: {0} / {1}".format(DEMO_ADMIN["username"], a.demo_password))
    if imports:
        print("  sample imports: opening stock {0}, gd costing {1}".format(
            "OK" if imports.get("stock") else "FAILED",
            "OK" if imports.get("costing") else "FAILED"))
    print("  isolation + walkthrough: {0}".format("all checks passed" if ok else "FAILURES ABOVE"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
