"""
Shared fixture for the importer MCP suites (scripts/test_mcp_*.py).

Builds, once per database, two FICTIONAL companies ("MCP Fixture Alpha" / "MCP Fixture Beta")
with a customer, a supplier, a GD (which brings in stock and items), a standalone bill, a
challan, a quotation, a sales order, a purchase bill, a customer receipt and a letter of
credit each, all through the ordinary REST screens as the seed admin. Re-running reuses them.
LOCAL databases only: every suite refuses a non-localhost base URL.

Also: a staff role carrying every business permission (no mcp.*, no administration), test users
with MCP Access / MCP Write and a granted tool catalog, and agent tokens.
"""
from __future__ import annotations

import json
import secrets
import time
import urllib.error
import urllib.request
from datetime import date
from urllib.parse import urlparse

BASE = "http://localhost:5141"
PW = "mcpfix1234"
STAFF_ROLE = "MCP Suite Staff"
COMPANY_NAMES = ("MCP Fixture Alpha", "MCP Fixture Beta")
ADMIN_PREFIXES = ("mcp.", "rbac.", "users.", "tenantaccess.", "divisionaccess.", "auditlogs.")


def set_base(base: str) -> str:
    global BASE
    BASE = base.rstrip("/")
    host = urlparse(BASE).hostname or ""
    if host not in ("localhost", "127.0.0.1", "::1"):
        raise SystemExit(f"Refusing to run against {host}: these suites create users, companies and documents. Local only.")
    return BASE


def http(method, path, token=None, body=None, form=None):
    data, hdrs = None, {}
    if body is not None:
        data, hdrs["Content-Type"] = json.dumps(body).encode(), "application/json"
    if form is not None:
        from urllib.parse import urlencode
        data, hdrs["Content-Type"] = urlencode(form).encode(), "application/x-www-form-urlencoded"
    if token:
        hdrs["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                txt = r.read().decode()
                return r.status, (json.loads(txt) if txt and txt[0] in "{[" else txt)
        except urllib.error.HTTPError as e:
            txt = e.read().decode() if e.fp else ""
            if e.code == 429 and attempt < 2:
                time.sleep(61)
                continue
            try:
                return e.code, json.loads(txt) if txt and txt[0] in "{[" else txt
            except Exception:
                return e.code, txt
    return 429, "rate limited"


def login(user, pw):
    s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    assert s == 200, f"login {user}: {s} {d}"
    return d["token"]


_rpc_id = [0]


def mcp(token, method, params=None):
    _rpc_id[0] += 1
    return http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": _rpc_id[0], "method": method, "params": params or {}})


def call(token, name, args=None):
    """(refused, text). refused is True for a JSON-RPC error, an isError result or a non-200."""
    s, d = mcp(token, "tools/call", {"name": name, "arguments": args or {}})
    if s != 200 or not isinstance(d, dict):
        return True, f"http {s}: {d}"
    if "error" in d:
        return True, d["error"]["message"]
    res = d["result"]
    return bool(res.get("isError")), res["content"][0]["text"]


def ok_json(token, name, args=None):
    refused, text = call(token, name, args)
    if refused:
        raise AssertionError(f"{name} refused: {text}")
    return json.loads(text)


def tools(token):
    s, d = mcp(token, "tools/list")
    return {t["name"]: t for t in d["result"]["tools"]} if s == 200 and "result" in d else {}


# ── roles and users ──────────────────────────────────────────────────

def system_roles(admin):
    return {r["name"]: r["id"] for r in http("GET", "/api/roles", admin)[1] if r.get("isSystemRole")}


def staff_role(admin):
    """A role with every business permission and none of the administration or MCP keys."""
    roles = http("GET", "/api/roles", admin)[1]
    for r in roles:
        if r["name"] == STAFF_ROLE:
            return r["id"]
    keys = [p["key"] for p in http("GET", "/api/permissions", admin)[1] if not p["key"].startswith(ADMIN_PREFIXES)]
    s, r = http("POST", "/api/roles", admin, {"name": STAFF_ROLE, "description": "MCP suites: business permissions only", "permissionKeys": keys})
    assert s in (200, 201), (s, r)
    return r["id"]


def role_with(admin, name, keys):
    for r in http("GET", "/api/roles", admin)[1]:
        if r["name"] == name:
            http("PUT", f"/api/roles/{r['id']}", admin, {"name": name, "permissionKeys": keys})
            return r["id"]
    s, r = http("POST", "/api/roles", admin, {"name": name, "description": "MCP suites", "permissionKeys": keys})
    assert s in (200, 201), (s, r)
    return r["id"]


def remove_users(admin, prefix):
    for u in http("GET", "/api/users", admin)[1] or []:
        if u["username"].startswith(prefix):
            http("DELETE", f"/api/users/{u['id']}", admin)


def make_user(admin, uname, company_ids, role_ids, catalog=True, writes=True):
    """A user with roles, company assignments and (optionally) every eligible MCP tool granted."""
    s, u = http("POST", "/api/users", admin, {"username": uname, "password": PW, "fullName": uname, "role": "User"})
    assert s in (200, 201), f"{uname}: {s} {u}"
    uid = u["id"]
    assert http("PUT", f"/api/users/{uid}/roles", admin, {"roleIds": role_ids})[0] == 200
    assert http("PUT", f"/api/usercompanies/user/{uid}", admin, {"companyIds": company_ids})[0] == 200
    if catalog:
        grant_catalog(admin, uid, writes)
    return uid, login(uname, PW)


def grant_catalog(admin, uid, writes=True, only=None):
    s, cat = http("GET", f"/api/mcp/catalog/{uid}", admin)
    assert s == 200, (s, cat)
    names = [t["name"] for t in cat["tools"] if t["configurable"] and t["eligible"] and (writes or not t["write"]) and (only is None or t["name"] in only)]
    s, r = http("PUT", f"/api/mcp/catalog/{uid}", admin, {"revision": cat["revision"], "accessGranted": True, "accessEnabled": True,
                "writesGranted": writes, "writesEnabled": writes, "grantedTools": names, "selectedTools": names})
    assert s == 200, (s, r)
    return names


def token_for(user_jwt, company_ids, scopes=None, name=None, all_companies=False):
    if scopes is None:
        scopes = http("GET", "/api/mcp/me/status", user_jwt)[1]["scopesAvailable"]
    s, d = http("POST", "/api/mcp/me/tokens", user_jwt, {"name": name or f"suite-{secrets.token_hex(3)}", "companyIds": company_ids,
                "allCompanies": all_companies, "scopes": scopes, "expiresInDays": 7})
    assert s == 200, f"token: {s} {d}"
    return d["secret"]


# ── the two fixture companies ────────────────────────────────────────

def _gd_line(gd, gddate, hs, desc, qty, assessed):
    return {"gdNumber": gd, "gdDate": gddate, "description": desc, "hsCode": hs, "quantity": qty, "unit": "Pcs",
            "assessedValue": assessed, "customsDuty": 0, "acd": 0, "regulatoryDuty": 0, "others": 0,
            "salesTaxRate": 18, "astRate": 3, "incomeTaxRate": 6, "addOnProfit": 0, "sellingValue": None, "confirmNewStock": True}


def _build_company(admin, name, tag):
    s, c = http("POST", "/api/companies", admin, {
        "name": name, "brandName": tag, "fullAddress": "1 Test Street", "phone": "021-0000000", "ntn": "1234567-8",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1, "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1, "fbrEnabled": False, "inventoryTrackingEnabled": True, "enableGl": False})
    assert s in (200, 201), (s, c)
    cid = c["id"]
    http("POST", f"/api/accounting/gl/company/{cid}/enable", admin)
    s, client = http("POST", "/api/clients", admin, {"companyId": cid, "name": f"{tag} Customer One", "registrationType": "Unregistered"})
    assert s == 200, (s, client)
    http("POST", "/api/clients", admin, {"companyId": cid, "name": f"{tag} Customer Two", "registrationType": "Unregistered"})
    s, supplier = http("POST", "/api/suppliers", admin, {"companyId": cid, "name": f"{tag} Supplier One", "registrationType": "Unregistered"})
    assert s == 200, (s, supplier)
    gd = f"KAPE-HC-{abs(hash(tag)) % 90000 + 10000}"
    lines = [_gd_line(gd, "2026-08-03", "7318.1510", f"{tag} BOLT", 100, 50000), _gd_line(gd, "2026-08-03", "7318.1610", f"{tag} NUT", 200, 20000)]
    s, pv = http("POST", f"/api/spreadsheet-import/gd-costing/preview-manual?companyId={cid}&mode=new-arrivals", admin, {"lines": lines})
    assert s == 200, (s, pv)
    s, r = http("POST", "/api/spreadsheet-import/gd-costing/commit", admin, {"companyId": cid, "fileSha256": pv["fileSha256"], "fileName": pv["fileName"],
                "fileSizeBytes": pv["fileSizeBytes"], "lines": pv["lines"], "createMissingStock": True, "mode": "new-arrivals"})
    assert s == 200, (s, r)
    items = {i["name"]: i["id"] for i in http("GET", f"/api/itemtypes?companyId={cid}", admin)[1]}
    bolt = next(v for k, v in items.items() if k.endswith("BOLT"))
    today = date.today().isoformat()
    s, bill = http("POST", "/api/invoices/standalone", admin, {"companyId": cid, "clientId": client["id"], "date": today, "gstRate": 18,
                   "items": [{"description": f"{tag} BOLT", "quantity": 2, "uom": "Pcs", "unitPrice": 700, "itemTypeId": bolt}]})
    assert s in (200, 201), (s, bill)
    s, ch = http("POST", f"/api/deliverychallans/company/{cid}", admin, {"companyId": cid, "clientId": client["id"], "deliveryDate": today, "poNumber": "",
                 "items": [{"description": f"{tag} BOLT", "quantity": 1, "unit": "Pcs", "itemTypeId": bolt}]})
    assert s in (200, 201), (s, ch)
    s, q = http("POST", f"/api/salesquotes/company/{cid}", admin, {"clientId": client["id"], "date": today, "gstRate": 18,
                "items": [{"description": f"{tag} BOLT", "quantity": 3, "unit": "Pcs", "unitPrice": 650, "itemTypeId": bolt}]})
    assert s in (200, 201), (s, q)
    s, so = http("POST", f"/api/salesorders/company/{cid}", admin, {"clientId": client["id"], "orderDate": today,
                 "items": [{"description": f"{tag} BOLT", "quantity": 4, "unit": "Pcs", "unitPrice": 640, "itemTypeId": bolt}]})
    assert s in (200, 201), (s, so)
    s, pb = http("POST", "/api/purchasebills", admin, {"companyId": cid, "supplierId": supplier["id"], "date": today, "gstRate": 18,
                 "items": [{"description": f"{tag} BOLT", "quantity": 5, "uom": "Pcs", "unitPrice": 400, "itemTypeId": bolt}]})
    assert s in (200, 201), (s, pb)
    s, rc = http("POST", f"/api/payments/receipts/company/{cid}", admin, {"date": today, "contactType": "Client", "contactId": client["id"], "amount": 500, "method": "Cash"})
    assert s in (200, 201), (s, rc)
    s, lc = http("POST", f"/api/import-lcs/company/{cid}", admin, {"lcNumber": f"LC-{tag}", "currency": "USD", "foreignAmount": 1000, "openedOn": "2026-07-01", "status": "open"})
    assert s == 200, (s, lc)
    return cid


def companies(admin):
    """(A, B): ids of the two fixture companies, building them on first use."""
    existing = {c["name"]: c["id"] for c in http("GET", "/api/companies", admin)[1]}
    ids = []
    for name, tag in zip(COMPANY_NAMES, ("ALPHA", "BETA")):
        ids.append(existing[name] if name in existing else _build_company(admin, name, tag))
    return ids[0], ids[1]


def first_id(admin, path, key="items"):
    s, d = http("GET", path, admin)
    rows = d.get(key, []) if isinstance(d, dict) else d
    return rows[0]["id"] if rows else None
