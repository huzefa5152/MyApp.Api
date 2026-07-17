"""
End-to-end division-isolation test (Division RBAC).

Creates 1 fresh isolated test company with 2 divisions + 2 non-admin users,
restricts one user to a single division, then verifies the IDivisionAccessGuard
semantics on the SalesQuotes module (exemplar), Divisions dropdown source,
DeliveryChallans (spot-check), Attachments, and /permissions/me.

Test matrix (company "Test DivRBAC Co.", divisions North + South):
  dana : company access + RestrictToDivisions=true, granted North only
  erik : company access, unrestricted (flag off)

Expectations (policies D1/D2 — see the division-RBAC design §3/§10):
  dana : sees North + company-level (null-division) rows; SOUTH rows hidden
         403 on any South row by id, on ?divisionId=South filters,
         on creating in South, AND on creating company-level (D2)
         may create in North; may read company-level rows (D1)
  erik : sees everything, may create anywhere incl. company-level

Usage:
  python scripts/test_division_isolation.py

Exit code 0 = all assertions pass, 1 = at least one failure.
Cleans up its rows on success; leaves them on failure for inspection.
"""
from __future__ import annotations
import json, os, sys, uuid, urllib.request, urllib.error
from typing import Any

# Windows consoles default to cp1252 — the check labels use arrows/dashes.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.environ.get("BASE_URL", "http://localhost:5134")

PASS = "PASS"
FAIL = "FAIL"


# ── HTTP helpers (mirrors test_tenant_isolation.py) ──────────
def request(method: str, path: str, token: str | None = None, body: Any = None) -> tuple[int, Any]:
    url = BASE + path
    data = None
    headers = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode("utf-8")
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        try:
            payload = json.loads(raw) if raw else None
        except Exception:
            payload = raw
        return e.code, payload


def upload_file(path: str, token: str | None, filename: str, content: bytes,
                content_type: str, fields: dict | None = None) -> tuple[int, Any]:
    boundary = "----pyform" + uuid.uuid4().hex
    chunks: list[bytes] = []
    for k, v in (fields or {}).items():
        chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    chunks.append(
        (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
         f"Content-Type: {content_type}\r\n\r\n").encode() + content + b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    body = b"".join(chunks)
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=body, method="POST", headers=headers)
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


def request_status(method: str, path: str, token: str | None = None) -> int:
    """Status only — for downloads, whose success body is file bytes, not JSON."""
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def login(username: str, password: str) -> str:
    status, data = request("POST", "/api/auth/login", body={"username": username, "password": password})
    assert status == 200, f"login {username} failed: {status} {data}"
    return data["token"]


results: list[tuple[str, str, str]] = []


def check(suite: str, name: str, ok: bool, reason: str = "") -> None:
    results.append((suite, name, PASS if ok else f"FAIL — {reason}"))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  ({reason})"))


def status_check(suite: str, label: str, status: int, expected: int) -> None:
    check(suite, label, status == expected, f"expected {expected}, got {status}")


COMPANY_NAME = "Test DivRBAC Co."
USERS = ("dana", "erik")

# ── Setup ────────────────────────────────────────────────────
print("\n=== Logging in as admin ===")
admin = login("admin", "admin123")

print("\n=== Cleaning up leftovers from a prior run ===")
_, pre_companies = request("GET", "/api/companies", token=admin)
for c in (pre_companies or []):
    if c["name"] == COMPANY_NAME:
        s, _ = request("DELETE", f"/api/companies/{c['id']}", token=admin)
        print(f"  removed leftover company id={c['id']} ({s})")
_, pre_users = request("GET", "/api/users", token=admin)
for u in (pre_users or []):
    if u["username"] in USERS:
        s, _ = request("DELETE", f"/api/users/{u['id']}", token=admin)
        print(f"  removed leftover user id={u['id']} ({s})")

print("\n=== Creating test company (isolated) + 2 divisions + client ===")
status, company = request("POST", "/api/companies", token=admin, body={
    "name": COMPANY_NAME,
    "fullAddress": "DivRBAC HQ",
    "phone": "+92-21-00000000",
    "ntn": "1234567",
    "cnic": "1234567890123",
    "strn": "1234567890123",
    "startingChallanNumber": 1,
    "startingInvoiceNumber": 1,
    "startingPurchaseBillNumber": 1,
    "startingGoodsReceiptNumber": 1,
    "fbrEnvironment": "sandbox",
    "fbrProvinceCode": 8,
})
assert status in (200, 201), f"create company: {status} {company}"
cid = company["id"]
print(f"  company id={cid}")

status, _ = request("PUT", f"/api/companies/{cid}", token=admin, body={
    "name": COMPANY_NAME, "fullAddress": "DivRBAC HQ", "phone": "+92-21-00000000",
    "ntn": "1234567", "cnic": "1234567890123", "strn": "1234567890123",
    "startingChallanNumber": 1, "startingInvoiceNumber": 1,
    "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
    "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
    "inventoryTrackingEnabled": False, "isTenantIsolated": True,
})
assert status == 200, f"isolate company: {status}"

divisions = {}
for name in ("North", "South"):
    status, d = request("POST", f"/api/divisions/company/{cid}", token=admin, body={"name": name})
    assert status in (200, 201), f"create division {name}: {status} {d}"
    divisions[name] = d["id"]
    print(f"  division {name} id={d['id']}")
north, south = divisions["North"], divisions["South"]

status, client = request("POST", "/api/clients", token=admin, body={
    "companyId": cid,
    "name": "DivRBAC Client", "fullAddress": "Client Rd 1", "phone": "+92-21-11111111",
    "ntn": "7654321", "strn": "3213213213213", "registrationType": "Registered",
    "fbrProvinceCode": 8,
})
assert status in (200, 201), f"create client: {status} {client}"
client_id = client["id"]

print("\n=== Creating users dana (restricted->North) + erik (unrestricted) ===")
status, roles = request("GET", "/api/roles", token=admin)
assert status == 200
admin_role_id = next(r["id"] for r in roles if r["name"] == "Administrator")

user_ids = {}
for username, fullname in (("dana", "Dana Restricted"), ("erik", "Erik Unrestricted")):
    status, u = request("POST", "/api/users", token=admin, body={
        "username": username, "fullName": fullname, "password": "test1234a", "role": "User",
    })
    assert status in (200, 201), f"create user {username}: {status} {u}"
    user_ids[username] = u["id"]
    # Full RBAC permissions so only the division guard varies between the two.
    status, _ = request("PUT", f"/api/users/{u['id']}/roles", token=admin, body={"roleIds": [admin_role_id]})
    assert status in (200, 201, 204), f"assign role to {username}: {status}"
    # Company (tenant) access
    status, _ = request("PUT", f"/api/usercompanies/user/{u['id']}", token=admin, body={"companyIds": [cid]})
    assert status == 200, f"grant company to {username}: {status}"
    print(f"  user {username} id={u['id']}")

# Restrict dana to North
status, res = request("PUT", f"/api/userdivisions/user/{user_ids['dana']}/company/{cid}",
                      token=admin, body={"restrictToDivisions": True, "divisionIds": [north]})
assert status == 200, f"restrict dana: {status} {res}"
print(f"  dana restricted to North: {res}")

dana = login("dana", "test1234a")
erik = login("erik", "test1234a")


def make_quote(token, division_id, label):
    return request("POST", f"/api/salesquotes/company/{cid}", token=token, body={
        "clientId": client_id,
        "divisionId": division_id,
        "date": "2026-07-04T00:00:00",
        "items": [{"description": f"Widget {label}", "quantity": 5, "unitPrice": 100, "unit": "Pcs"}],
    })


print("\n=== Seeding quotes as erik (North / South / company-level) ===")
status, q_north = make_quote(erik, north, "N")
assert status in (200, 201), f"erik create North quote: {status} {q_north}"
status, q_south = make_quote(erik, south, "S")
assert status in (200, 201), f"erik create South quote: {status} {q_south}"
status, q_company = make_quote(erik, None, "C")
assert status in (200, 201), f"erik create company-level quote: {status} {q_company}"
print(f"  quotes: north={q_north['id']} south={q_south['id']} company={q_company['id']}")

# Challan spot-check rows
status, ch_south = request("POST", f"/api/deliverychallans/company/{cid}", token=erik, body={
    "clientId": client_id, "divisionId": south, "poNumber": "PO-S-1",
    "poDate": "2026-07-04T00:00:00", "deliveryDate": "2026-07-04T00:00:00",
    "items": [{"description": "Gadget S", "quantity": 3, "unit": "Pcs"}],
})
assert status in (200, 201), f"erik create South challan: {status} {ch_south}"

# Attachment on the South quote (uploaded by erik, inherits South)
status, att_south = upload_file(f"/api/attachments/company/{cid}", erik, "south.txt",
                                b"south secret", "text/plain",
                                fields={"entityType": "SalesQuote", "entityId": str(q_south["id"])})
assert status == 200, f"erik attach to South quote: {status} {att_south}"

# ── The matrix ───────────────────────────────────────────────
S = "divisions"
print("\n=== Divisions dropdown source ===")
status, dana_divs = request("GET", f"/api/divisions/company/{cid}", token=dana)
status_check(S, "dana GET /divisions → 200", status, 200)
names = sorted(d["name"] for d in (dana_divs or []))
check(S, "dana sees ONLY North in the divisions list", names == ["North"], f"saw {names}")
status, erik_divs = request("GET", f"/api/divisions/company/{cid}", token=erik)
check(S, "erik sees both divisions", sorted(d["name"] for d in (erik_divs or [])) == ["North", "South"],
      f"saw {[d['name'] for d in (erik_divs or [])]}")

S = "permissions/me"
print("\n=== /permissions/me restriction map ===")
status, me = request("GET", "/api/permissions/me", token=dana)
restr = (me or {}).get("divisionRestrictions") or {}
check(S, "dana divisionRestrictions has this company", str(cid) in restr, f"map={restr}")
check(S, "dana restriction lists exactly [North]", restr.get(str(cid)) == [north], f"got {restr.get(str(cid))}")
status, me_e = request("GET", "/api/permissions/me", token=erik)
restr_e = (me_e or {}).get("divisionRestrictions") or {}
check(S, "erik has NO restriction entry", str(cid) not in restr_e, f"map={restr_e}")

S = "quotes.list"
print("\n=== Sales-quote list scoping ===")
status, page = request("GET", f"/api/salesquotes/company/{cid}/paged?page=1&pageSize=50", token=dana)
status_check(S, "dana paged list → 200", status, 200)
ids = [q["id"] for q in (page or {}).get("items", [])]
check(S, "dana list includes North quote", q_north["id"] in ids, f"ids={ids}")
check(S, "dana list includes company-level quote (D1)", q_company["id"] in ids, f"ids={ids}")
check(S, "dana list EXCLUDES South quote", q_south["id"] not in ids, f"ids={ids}")
status, _ = request("GET", f"/api/salesquotes/company/{cid}/paged?divisionId={south}", token=dana)
status_check(S, "dana ?divisionId=South → 403", status, 403)
status, _ = request("GET", f"/api/salesquotes/company/{cid}/paged?divisionId={north}", token=dana)
status_check(S, "dana ?divisionId=North → 200", status, 200)
status, page_e = request("GET", f"/api/salesquotes/company/{cid}/paged?page=1&pageSize=50", token=erik)
ids_e = [q["id"] for q in (page_e or {}).get("items", [])]
check(S, "erik list includes all three", all(q["id"] in ids_e for q in (q_north, q_south, q_company)), f"ids={ids_e}")

S = "quotes.byId"
print("\n=== Sales-quote id routes ===")
status, _ = request("GET", f"/api/salesquotes/{q_south['id']}", token=dana)
status_check(S, "dana GET South quote → 403", status, 403)
status, _ = request("GET", f"/api/salesquotes/{q_north['id']}", token=dana)
status_check(S, "dana GET North quote → 200", status, 200)
status, _ = request("GET", f"/api/salesquotes/{q_company['id']}", token=dana)
status_check(S, "dana GET company-level quote → 200 (D1)", status, 200)
status, _ = request("GET", f"/api/salesquotes/{q_south['id']}/print", token=dana)
status_check(S, "dana print South quote → 403", status, 403)
status, _ = request("DELETE", f"/api/salesquotes/{q_south['id']}", token=dana)
status_check(S, "dana DELETE South quote → 403", status, 403)

S = "quotes.write"
print("\n=== Sales-quote writes ===")
status, _ = make_quote(dana, south, "dS")
status_check(S, "dana create in South → 403", status, 403)
status, _ = make_quote(dana, None, "dC")
status_check(S, "dana create company-level → 403 (D2)", status, 403)
status, q_dana = make_quote(dana, north, "dN")
check(S, "dana create in North → 200/201", status in (200, 201), f"got {status}")
# moving a North quote to South must be blocked
if status in (200, 201):
    move = dict(q_dana)
    move["divisionId"] = south
    status, _ = request("PUT", f"/api/salesquotes/{q_dana['id']}", token=dana, body={
        "clientId": client_id, "divisionId": south, "date": "2026-07-04T00:00:00",
        "items": [{"description": "Widget dN", "quantity": 5, "unitPrice": 100, "unit": "Pcs"}],
    })
    status_check(S, "dana move own quote → South → 403", status, 403)

S = "challans"
print("\n=== Delivery-challan spot checks ===")
status, _ = request("GET", f"/api/deliverychallans/{ch_south['id']}", token=dana)
status_check(S, "dana GET South challan → 403", status, 403)
status, chpage = request("GET", f"/api/deliverychallans/company/{cid}/paged?page=1&pageSize=50", token=dana)
ch_ids = [c["id"] for c in (chpage or {}).get("items", [])]
check(S, "dana challan list EXCLUDES South challan", ch_south["id"] not in ch_ids, f"ids={ch_ids}")

S = "attachments"
print("\n=== Attachment scoping ===")
status, atts = request("GET", f"/api/attachments/company/{cid}/entity/SalesQuote/{q_south['id']}", token=dana)
att_ids = [a["id"] for a in (atts or [])]
check(S, "dana can't list South quote's attachments", att_south["id"] not in att_ids, f"ids={att_ids}")
status = request_status("GET", f"/api/attachments/{att_south['id']}/download", token=dana)
status_check(S, "dana download South attachment → 403", status, 403)
status, _ = upload_file(f"/api/attachments/company/{cid}", dana, "try.txt", b"x", "text/plain",
                        fields={"entityType": "SalesQuote", "entityId": str(q_south["id"])})
status_check(S, "dana upload to South quote → 403", status, 403)
status = request_status("GET", f"/api/attachments/{att_south['id']}/download", token=erik)
status_check(S, "erik download South attachment → 200", status, 200)

S = "unrestricted"
print("\n=== erik (unrestricted) sanity ===")
status, _ = request("GET", f"/api/salesquotes/{q_south['id']}", token=erik)
status_check(S, "erik GET South quote → 200", status, 200)
status, q_e = make_quote(erik, None, "eC2")
check(S, "erik create company-level → 200/201", status in (200, 201), f"got {status}")

S = "invoices+dashboard+stock"
print("\n=== Invoice counts, dashboard KPIs, stock endpoints (Phase 4 scoping) ===")


def make_bill(token, division_id, qty, label):
    return request("POST", "/api/invoices/standalone", token=token, body={
        "date": "2026-07-04T00:00:00.000Z",
        "companyId": cid,
        "clientId": client_id,
        "divisionId": division_id,
        "gstRate": 18,
        "documentType": 4,
        "paymentMode": "Cash",
        "items": [{"description": f"Bill item {label}", "quantity": qty, "uom": "Numbers, pieces, units",
                   "unitPrice": 100}],
    })


status, b_south = make_bill(erik, south, 10, "S")   # 1000 + 18% = 1180
check(S, "erik creates South bill", status in (200, 201), f"got {status} {b_south}")
status, b_north = make_bill(erik, north, 5, "N")    # 500 + 18% = 590
check(S, "erik creates North bill", status in (200, 201), f"got {status} {b_north}")
status, _ = make_bill(dana, south, 1, "dS")
status_check(S, "dana create standalone bill in South → 403", status, 403)

status, cnt_d = request("GET", f"/api/invoices/count?companyId={cid}", token=dana)
check(S, "dana bill count == 1 (South hidden)", cnt_d == 1, f"got {cnt_d}")
status, cnt_e = request("GET", f"/api/invoices/count?companyId={cid}", token=erik)
check(S, "erik bill count == 2", cnt_e == 2, f"got {cnt_e}")

status, kpi_d = request("GET", f"/api/dashboard/kpis?companyId={cid}&period=all-time", token=dana)
status_check(S, "dana dashboard → 200", status, 200)
dana_sales = ((kpi_d or {}).get("hero") or {}).get("totalSales")
check(S, "dana TotalSales == 590 (North only)", dana_sales == 590, f"got {dana_sales}")
status, kpi_e = request("GET", f"/api/dashboard/kpis?companyId={cid}&period=all-time", token=erik)
erik_sales = ((kpi_e or {}).get("hero") or {}).get("totalSales")
check(S, "erik TotalSales == 1770 (both)", erik_sales == 1770, f"got {erik_sales}")

status, _ = request("GET", f"/api/stock/company/{cid}/onhand", token=dana)
status_check(S, "dana stock on-hand (scoped SQL) → 200", status, 200)
status, _ = request("GET", f"/api/stock/company/{cid}/movements", token=dana)
status_check(S, "dana stock movements (scoped SQL) → 200", status, 200)
status, _ = request("POST", "/api/stock/adjust", token=dana,
                    body={"companyId": cid, "itemTypeId": 1, "delta": 5, "movementDate": "2026-07-04T00:00:00"})
status_check(S, "dana stock adjustment → 403 (company-level write)", status, 403)

S = "unrestrict-flow"
print("\n=== Lifting the restriction takes effect ===")
status, _ = request("PUT", f"/api/userdivisions/user/{user_ids['dana']}/company/{cid}",
                    token=admin, body={"restrictToDivisions": False, "divisionIds": []})
status_check(S, "admin lifts dana's restriction → 200", status, 200)
status, _ = request("GET", f"/api/salesquotes/{q_south['id']}", token=dana)
status_check(S, "dana GET South quote after lift → 200", status, 200)

# ── Report + cleanup ─────────────────────────────────────────
failures = [r for r in results if r[2] != PASS]
print(f"\n{'='*60}\n{len(results) - len(failures)}/{len(results)} checks passed")
if failures:
    print("\nFAILURES:")
    for suite, name, verdict in failures:
        print(f"  [{suite}] {name}: {verdict}")
    print("\nTest rows LEFT IN PLACE for inspection.")
    sys.exit(1)

print("\n=== Cleaning up ===")
for u in USERS:
    s, _ = request("DELETE", f"/api/users/{user_ids[u]}", token=admin)
    print(f"  deleted user {u} ({s})")
s, _ = request("DELETE", f"/api/companies/{cid}", token=admin)
print(f"  deleted company {cid} ({s})")
print("\nAll division-isolation checks passed.")
sys.exit(0)
