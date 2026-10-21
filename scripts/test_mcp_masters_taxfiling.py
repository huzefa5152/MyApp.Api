"""
Hosted MCP - suppliers, catalog items, a bill's FBR classification, and FBR validation.

Proves the four tools added on 2026-10-21 behave like the rest of the write flow:
prepare saves nothing; commit runs the screen's own service exactly once; every gate (agent
token, write scope, MCP Write role, the screen permission, company access, record ownership)
holds at prepare AND at commit; another company's supplier, item or bill is unreachable by
id; and the consultant's quantity right is still required at commit for a quantity change.
validate_bill_fbr is only called on a bill that fails before any request reaches FBR.

Needs a LOCAL Trader database with 2+ companies holding invoices and clients (the first must
be able to raise a standalone bill). Creates throwaway users ("mcpm"), a supplier, an item and
a bill, and removes them on success.

Usage: python scripts/test_mcp_masters_taxfiling.py --base http://localhost:5140
         [--sql-server .\\MSSQLSERVER02] [--sql-db MyApp_Trader_Local]
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date

ap = argparse.ArgumentParser()
ap.add_argument("--base", default=os.environ.get("MYAPP_BASE", "http://localhost:5134"))
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--sql-db", default="MyApp_Trader_Local")
ARGS = ap.parse_args()
BASE = ARGS.base.rstrip("/")
PW = "mcpm1234"
RUN = secrets.token_hex(3)
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {detail}"))


def http(method, path, token=None, body=None):
    data, hdrs = None, {}
    if body is not None:
        data, hdrs["Content-Type"] = json.dumps(body).encode(), "application/json"
    if token:
        hdrs["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt and txt[0] in "{[" else txt)
    except urllib.error.HTTPError as e:
        txt = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(txt) if txt and txt[0] in "{[" else txt
        except Exception:
            return e.code, txt


def login(user, pw):
    s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    if s == 429:
        time.sleep(62)
        s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    assert s == 200, f"login {user}: {s} {d}"
    return d["token"]


def sql(query):
    out = subprocess.run(["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.sql_db, "-E", "-C", "-N", "-I", "-b",
                          "-h", "-1", "-W", "-Q", "SET NOCOUNT ON; " + query], capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr
    return out.stdout.strip()


_id = [0]


def mcp(token, method, params=None):
    _id[0] += 1
    return http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": _id[0], "method": method, "params": params or {}})


def tool(token, name, args):
    s, d = mcp(token, "tools/call", {"name": name, "arguments": args})
    if s != 200 or not isinstance(d, dict):
        return True, f"http {s}: {d}"
    if "error" in d:
        return True, d["error"]["message"]
    res = d["result"]
    text = res["content"][0]["text"]
    return (True, text) if res.get("isError") else (False, json.loads(text))


def names(token):
    return {t["name"] for t in mcp(token, "tools/list")[1]["result"]["tools"]}


print(f"MCP masters + tax filing test against {BASE}  (run {RUN})")
admin = login("admin", "admin123")
s, companies = http("GET", "/api/companies", admin)
cands = []
for c in companies:
    s, pg = http("GET", f"/api/invoices/company/{c['id']}/paged?page=1&pageSize=1", admin)
    if s == 200 and pg["items"]:
        cands.append({"id": c["id"], "client": pg["items"][0]["clientId"]})
if len(cands) < 2:
    print("SKIP: need 2 companies with invoices.")
    sys.exit(2)
HS_SQL = ("SELECT TOP 1 Id FROM ItemTypes WHERE CompanyId = {0} AND IsDeleted = 0 AND HSCode IS NOT NULL AND HSCode <> '' "
          "AND IsHsCodePartial = 0 AND UOM IS NOT NULL AND UOM <> '' AND SaleType IS NOT NULL AND SaleType <> '' ORDER BY Id")
# A: prefer a company with a fully classified catalog item, so the classification commit runs. B: any other company with an item.
cands.sort(key=lambda c: not sql(HS_SQL.format(c["id"])).isdigit())
A = cands[0]
B = next((c for c in cands[1:] if sql(f"SELECT TOP 1 Id FROM ItemTypes WHERE CompanyId = {c['id']} AND IsDeleted = 0").isdigit()), None)
if B is None:
    print("SKIP: need a second company with a catalog item.")
    sys.exit(2)
B_ITEM = int(sql(f"SELECT TOP 1 Id FROM ItemTypes WHERE CompanyId = {B['id']} AND IsDeleted = 0"))
B_BILL = int(sql(f"SELECT TOP 1 Id FROM Invoices WHERE CompanyId = {B['id']} ORDER BY Id DESC"))
B_SUPPLIER = sql(f"SELECT TOP 1 Id FROM Suppliers WHERE CompanyId = {B['id']}")
HS_ITEM = sql(HS_SQL.format(A["id"]))

for u in http("GET", "/api/users", admin)[1] or []:
    if u["username"].startswith("mcpm_"):
        http("DELETE", f"/api/users/{u['id']}", admin)
for r in http("GET", "/api/roles", admin)[1] or []:
    if r["name"].startswith("mcpm-"):
        http("DELETE", f"/api/roles/{r['id']}", admin)
sysr = {r["name"]: r["id"] for r in http("GET", "/api/roles", admin)[1] if r.get("isSystemRole")}
SALES, MCPA, MCPW, TADMIN = sysr["Sales Edition"], sysr["MCP Access"], sysr["MCP Write"], sysr["Tenant Administrator"]
uids, tok = {}, {}


def grant_test_access(user_id, writes):
    status, catalog = http("GET", f"/api/mcp/catalog/{user_id}", admin)
    assert status == 200, (status, catalog)
    tools = [t["name"] for t in catalog["tools"] if t["configurable"] and t["eligible"] and (writes or not t["write"])]
    status, result = http("PUT", f"/api/mcp/catalog/{user_id}", admin, {
        "revision": catalog["revision"], "accessGranted": True, "accessEnabled": True,
        "writesGranted": writes, "writesEnabled": writes, "grantedTools": tools, "selectedTools": tools})
    assert status == 200, (status, result)


def make(creator, uname, role_ids, cids, writes, role_string="User"):
    s, u = http("POST", "/api/users", creator, {"username": uname, "password": PW, "fullName": uname, "role": role_string})
    assert s in (200, 201), f"{uname}: {s} {u}"
    uids[uname] = u["id"]
    assert http("PUT", f"/api/users/{u['id']}/roles", creator, {"roleIds": role_ids})[0] == 200
    assert http("PUT", f"/api/usercompanies/user/{u['id']}", creator, {"companyIds": cids})[0] == 200
    grant_test_access(u["id"], writes)
    tok[uname] = login(uname, PW)


def mk(owner, cids, scopes, name="t"):
    s, d = http("POST", "/api/mcp/me/tokens", owner, {"name": name, "companyIds": cids, "scopes": scopes, "expiresInDays": 30})
    assert s == 200, f"token: {s} {d}"
    return d["secret"]


make(admin, "mcpm_w", [SALES, MCPA, MCPW], [A["id"], B["id"]], True)
make(admin, "mcpm_r", [SALES, MCPA], [A["id"]], False)
make(admin, "mcpm_ta", [TADMIN, SALES, MCPA, MCPW], [A["id"]], True, "Administrator")
s, r = http("POST", "/api/roles", tok["mcpm_ta"], {"name": "mcpm-classify-only", "description": "t", "permissionKeys":
            ["invoices.list.view", "invoices.manage.update.itemtype", "itemtypes.manage.view"]})
assert s in (200, 201), f"tenant role: {s} {r}"
make(tok["mcpm_ta"], "mcpm_k", [r["id"]], [A["id"]], True)
W, R, K = tok["mcpm_w"], tok["mcpm_r"], tok["mcpm_k"]

# ── scopes and catalogue ─────────────────────────────────────────────
print("\n== scopes and tools ==")
NEW_WRITE = {"suppliers.write", "itemtypes.write", "taxfiling.write"}
s, st = http("GET", "/api/mcp/me/status", W)
check("a writer with the screen permissions is offered the three new write scopes and fbr.validate", NEW_WRITE | {"fbr.validate"} <= set(st["scopesAvailable"]), st["scopesAvailable"])
s, st = http("GET", "/api/mcp/me/status", R)
check("MCP Access without MCP Write -> no new write scope", not NEW_WRITE & set(st["scopesAvailable"]), st["scopesAvailable"])
s, st = http("GET", "/api/mcp/me/status", K)
check("classification rights only -> taxfiling.write, not suppliers.write or itemtypes.write", "taxfiling.write" in st["scopesAvailable"] and not {"suppliers.write", "itemtypes.write"} & set(st["scopesAvailable"]), st["scopesAvailable"])
s, d = http("POST", "/api/mcp/me/tokens", K, {"name": "x", "companyIds": [A["id"]], "scopes": ["read", "suppliers.write"], "expiresInDays": 5})
check("…and a suppliers token is refused for that user", s == 400, f"{s} {d}")

TW = mk(W, [A["id"]], ["read", "suppliers.write", "itemtypes.write", "taxfiling.write", "fbr.validate", "bills.write"], "all-A")
TRO = mk(W, [A["id"]], ["read"], "reader")
TK = mk(K, [A["id"]], ["read", "taxfiling.write"], "classify")
nw, nro, nk = names(TW), names(TRO), names(TK)
check("the write token lists the four new tools", {"prepare_supplier", "prepare_item_type", "prepare_bill_tax_filing", "validate_bill_fbr", "get_bill_tax_filing"} <= nw, sorted(nw))
check("a read token lists get_bill_tax_filing but no new write tool and no FBR validation", "get_bill_tax_filing" in nro and not {"prepare_supplier", "prepare_item_type", "prepare_bill_tax_filing", "validate_bill_fbr"} & nro, sorted(nro))
check("a classification token lists only the classification write", "prepare_bill_tax_filing" in nk and not {"prepare_supplier", "prepare_item_type", "validate_bill_fbr"} & nk, sorted(nk))
nlogin = names(W)
check("login tokens never list a write tool", not {"prepare_supplier", "prepare_item_type", "prepare_bill_tax_filing"} & nlogin, sorted(nlogin))
check("…nor FBR validation, which needs an agent token with fbr.validate", "validate_bill_fbr" not in nlogin, sorted(nlogin))

# ── suppliers ────────────────────────────────────────────────────────
print("\n== prepare_supplier ==")
made_suppliers, made_items, made_bills = [], [], []


def supplier_count():
    return int(sql(f"SELECT COUNT(*) FROM Suppliers WHERE CompanyId = {A['id']}"))


SUP = {"companyId": A["id"], "name": f"MCP Supplier {RUN}", "phone": "0300-0000000", "ntn": "1234567-8"}
n0 = supplier_count()
err, m = tool(TRO, "prepare_supplier", SUP)
check("a read token cannot prepare a supplier", err, m)
err, m = tool(W, "prepare_supplier", SUP)
check("a login token cannot prepare a supplier", err, m)
err, m = tool(TW, "prepare_supplier", {**SUP, "companyId": B["id"]})
check("a token for company A cannot prepare in company B", err, m)
err, sp = tool(TW, "prepare_supplier", SUP)
check("prepare returns a plan and saves nothing", not err and sp["saved"] is False and supplier_count() == n0, sp)
err, sp2 = tool(TW, "prepare_supplier", {**SUP, "idempotencyKey": f"sup-{RUN}"})
err, sp3 = tool(TW, "prepare_supplier", {**SUP, "idempotencyKey": f"sup-{RUN}"})
check("an idempotency key returns the same supplier plan", not err and sp2["planId"] == sp3["planId"], (sp2, sp3))
tool(TW, "cancel_action", {"planId": sp2["planId"]})
err, sc = tool(TW, "commit_action", {"planId": sp["planId"]})
check("commit creates exactly one supplier", not err and sc["resultRef"].startswith("Supplier:") and supplier_count() == n0 + 1, sc)
sup_id = int(sc["resultRef"].split(":")[1]) if not err else 0
made_suppliers.append(sup_id)
s, sup = http("GET", f"/api/suppliers/{sup_id}", admin)
check("…in company A with the planned details", s == 200 and sup["companyId"] == A["id"] and sup["name"] == SUP["name"] and sup["ntn"] == "1234567-8", sup)
err, m = tool(TW, "commit_action", {"planId": sp["planId"]})
check("the same plan cannot be committed twice", err and supplier_count() == n0 + 1, m)
err, m = tool(TW, "prepare_supplier", SUP)
check("a duplicate supplier name is refused at prepare", err and "already exists" in m, m)
err, up = tool(TW, "prepare_supplier", {"companyId": A["id"], "supplierId": sup_id, "phone": "0300-1111111"})
err2, uc = tool(TW, "commit_action", {"planId": up["planId"]}) if not err else (True, up)
s, sup = http("GET", f"/api/suppliers/{sup_id}", admin)
check("an update changes only the fields passed", not err2 and sup["phone"] == "0300-1111111" and sup["name"] == SUP["name"] and sup["ntn"] == "1234567-8", sup)
if B_SUPPLIER.isdigit():
    err, m = tool(TW, "prepare_supplier", {"companyId": A["id"], "supplierId": int(B_SUPPLIER), "phone": "1"})
    check("another company's supplier id is refused, with the same answer as a missing one", err and "access denied" in m.lower(), m)
err, m = tool(TW, "prepare_supplier", {"companyId": A["id"], "supplierId": 999999999, "phone": "1"})
check("a missing supplier id is refused", err and "access denied" in m.lower(), m)

# ── catalog items ────────────────────────────────────────────────────
print("\n== prepare_item_type ==")
ITEM = {"companyId": A["id"], "name": f"MCP Item {RUN}", "uom": "Pcs"}
err, m = tool(TRO, "prepare_item_type", ITEM)
check("a read token cannot prepare an item", err, m)
err, m = tool(TK, "prepare_item_type", ITEM)
check("a classification-only token cannot prepare an item", err, m)
err, m = tool(TW, "prepare_item_type", {**ITEM, "hsCode": "84A1"})
check("an HS code with letters is refused at prepare", err, m)
err, ip = tool(TW, "prepare_item_type", ITEM)
check("prepare returns a plan and saves nothing", not err and ip["saved"] is False and sql(f"SELECT COUNT(*) FROM ItemTypes WHERE Name = 'MCP Item {RUN}'") == "0", ip)
err, ic = tool(TW, "commit_action", {"planId": ip["planId"]})
check("commit creates the item", not err and ic["resultRef"].startswith("ItemType:"), ic)
item_id = int(ic["resultRef"].split(":")[1]) if not err else 0
made_items.append(item_id)
check("…owned by company A and nobody else, as a favourite draft",
      sql(f"SELECT CAST(CompanyId AS varchar) + '|' + CAST(IsFavorite AS varchar) + '|' + ISNULL(HSCode, '-') FROM ItemTypes WHERE Id = {item_id}") == f"{A['id']}|1|-")
err, m = tool(TW, "prepare_item_type", ITEM)
check("a duplicate item (same name, same HS code) is refused at prepare", err and "already exists" in m, m)
err, iu = tool(TW, "prepare_item_type", {"companyId": A["id"], "itemTypeId": item_id, "name": f"MCP Item {RUN} renamed"})
err2, m = tool(TW, "commit_action", {"planId": iu["planId"]}) if not err else (True, iu)
check("an item update renames it", not err2 and sql(f"SELECT Name FROM ItemTypes WHERE Id = {item_id}") == f"MCP Item {RUN} renamed", m)
err, m = tool(TW, "prepare_item_type", {"companyId": A["id"], "itemTypeId": B_ITEM, "name": "x"})
check("another company's item id is refused", err and "access denied" in m.lower(), m)

# ── a bill to classify ───────────────────────────────────────────────
print("\n== bill FBR classification ==")
today = date.today().isoformat()
err, bp = tool(TW, "prepare_bill", {"companyId": A["id"], "clientId": A["client"], "date": today, "gstRate": "18",
               "items": [{"description": f"MCP filing one {RUN}", "quantity": "2", "uom": "Pcs", "unitPrice": "100"},
                         {"description": f"MCP filing two {RUN}", "quantity": "3", "uom": "Pcs", "unitPrice": "50"}]})
err2, bc = tool(TW, "commit_action", {"planId": bp["planId"]}) if not err else (True, bp)
check("a throwaway standalone bill is created to classify", not err2 and bc["resultRef"].startswith("Invoice:"), bc)
bill = int(bc["resultRef"].split(":")[1]) if not err2 else 0
made_bills.append(bill)

err, tf = tool(TRO, "get_bill_tax_filing", {"companyId": A["id"], "invoiceId": bill})
check("a read token reads the filing rows, lines and version", not err and len(tf["lines"]) == 2 and tf["version"] and tf["rows"], tf)
err, m = tool(TRO, "get_bill_tax_filing", {"companyId": A["id"], "invoiceId": B_BILL})
check("another company's bill id is refused under company A", err and "access denied" in m.lower(), m)
err, m = tool(TRO, "get_bill_tax_filing", {"companyId": B["id"], "invoiceId": B_BILL})
check("a token for company A cannot read company B's filing", err, m)

err, vr = tool(TW, "validate_bill_fbr", {"companyId": A["id"], "invoiceId": bill})
check("validate_bill_fbr on an unclassified bill answers 'not valid' before contacting FBR, and never submits",
      not err and vr["valid"] is False and vr["submitted"] is False and "adjust" in (vr["errorMessage"] or "").lower(), vr)
err, m = tool(TW, "validate_bill_fbr", {"companyId": A["id"], "invoiceId": B_BILL})
check("validate_bill_fbr refuses another company's bill", err and "access denied" in m.lower(), m)
err, m = tool(TRO, "validate_bill_fbr", {"companyId": A["id"], "invoiceId": bill})
check("a token without fbr.validate cannot validate", err, m)
s, bi = http("GET", f"/api/invoices/{bill}", admin)
check("the bill is still unsubmitted", not bi.get("fbrIRN") and bi.get("fbrSubmittedAt") in (None, ""), {k: bi.get(k) for k in ("fbrIRN", "fbrStatus")})

ver = tf["version"] if tf else ""
if not HS_ITEM.isdigit():
    print("  (no catalog item with a complete HS code in company A: classification commit checks skipped)")
else:
    hs = int(HS_ITEM)
    rows = [{"sourceLineIds": r["sourceLineIds"], "itemTypeId": hs, "quantity": str(r["quantity"]), "valueExclTax": str(r["valueExclTax"])} for r in tf["rows"]]
    base = {"companyId": A["id"], "invoiceId": bill, "version": ver, "rows": rows}
    for label, args in (
        ("a stale version", {**base, "version": "stale"}),
        ("a bill line left out", {**base, "rows": rows[:1] if len(rows) > 1 else [{**rows[0], "sourceLineIds": rows[0]["sourceLineIds"][:1]}]}),
        ("a bill line in two rows", {**base, "rows": rows + [{**rows[0]}]}),
        ("a line of another bill", {**base, "rows": [{**rows[0], "sourceLineIds": rows[0]["sourceLineIds"] + [999999999]}] + rows[1:]}),
        ("an item from another company", {**base, "rows": [{**r, "itemTypeId": B_ITEM} for r in rows]}),
        ("an item without an HS code", {**base, "rows": [{**r, "itemTypeId": item_id} for r in rows]}),
        ("another company's bill", {**base, "invoiceId": B_BILL}),
    ):
        err, m = tool(TW, "prepare_bill_tax_filing", args)
        check(f"{label} is refused at prepare", err, m)
    err, m = tool(TRO, "prepare_bill_tax_filing", base)
    check("a read token cannot prepare a classification", err, m)

    # Classification-only user: a quantity change passes prepare (the right is read at commit, as on screen) and fails at commit.
    qty_rows = [{**rows[0], "quantity": str(float(rows[0]["quantity"]) + 1)}] + rows[1:]
    err, kp = tool(TK, "prepare_bill_tax_filing", {**base, "rows": qty_rows})
    err2, m = tool(TK, "commit_action", {"planId": kp["planId"]}) if not err else (True, kp)
    err3, ks = tool(TK, "get_action_status", {"planId": kp["planId"]}) if not err else (True, {})
    check("without the consultant quantity right, a quantity change is refused at commit", err2 and not err3 and ks["status"] == "failedOrIncomplete", (m, ks))
    err, tf1 = tool(TRO, "get_bill_tax_filing", {"companyId": A["id"], "invoiceId": bill})
    check("…and the bill's filing rows are unchanged", not err and tf1["hasSavedRows"] is False and tf1["version"] == ver, tf1)

    if len(rows) > 1:
        # Two rows on one HS item are the same FBR item: the screen's duplicate guard must hold through MCP too.
        err, dp = tool(TW, "prepare_bill_tax_filing", base)
        err2, m = tool(TW, "commit_action", {"planId": dp["planId"]}) if not err else (True, dp)
        check("rows FBR would reject as a duplicate item are refused at commit", err2 and "refused" in m.lower(), m)
        merged = {"sourceLineIds": sorted(i for r in rows for i in r["sourceLineIds"]), "itemTypeId": hs,
                  "quantity": str(sum(float(r["quantity"]) for r in rows)), "valueExclTax": str(sum(float(r["valueExclTax"]) for r in rows))}
        base = {**base, "rows": [merged]}
    err, tp = tool(TW, "prepare_bill_tax_filing", base)
    check("a classification plan is produced and saves nothing", not err and tp["saved"] is False and tp["details"]["rows"][0]["hsCode"], tp)
    err, tc = tool(TW, "commit_action", {"planId": tp["planId"]})
    check("commit saves the filing rows through the Invoices screen's own save", not err and tc["resultRef"] == f"Invoice:{bill}", tc)
    err, tf2 = tool(TRO, "get_bill_tax_filing", {"companyId": A["id"], "invoiceId": bill})
    check("the bill now has saved rows on the chosen item, and a new version", not err and tf2["hasSavedRows"] and all(r["itemTypeId"] == hs for r in tf2["rows"]) and tf2["version"] != ver, tf2)
    s, bi = http("GET", f"/api/invoices/{bill}", admin)
    check("the commercial bill is unchanged and unsubmitted", bi["subtotal"] == 350 and not bi.get("fbrIRN"), {k: bi.get(k) for k in ("subtotal", "fbrIRN")})
    err, m = tool(TW, "prepare_bill_tax_filing", base)
    check("the old version is refused once the rows were saved", err and "changed" in m.lower(), m)

# ── activity log ─────────────────────────────────────────────────────
print("\n== activity log ==")
q = f"&userId={uids['mcpm_w']}&pageSize=100"
commits = http("GET", "/api/mcp-admin/activity?tool=commit_action&outcome=ok" + q, admin)[1]["items"]
refs = [r["resultRef"] for r in commits]
check("supplier and item commits are logged with their references", f"Supplier:{sup_id}" in refs and f"ItemType:{item_id}" in refs, refs)
val = http("GET", "/api/mcp-admin/activity?tool=validate_bill_fbr" + q, admin)[1]["items"]
check("FBR validation calls are logged, refused ones too", any(r["outcome"] == "ok" for r in val) and any(r["outcome"] == "denied" for r in val), len(val))
check("no agent secret in the log", TW not in json.dumps(commits + val))

# ── result ───────────────────────────────────────────────────────────
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} masters and tax filing checks passed")
if fails:
    print("FAILED - throwaway users and records kept for inspection:")
    for n, _, dtl in fails:
        print(f"  - {n}: {dtl}")
    sys.exit(1)
for b in sorted(made_bills, reverse=True):
    http("DELETE", f"/api/invoices/{b}", admin)
for i in made_items:
    http("DELETE", f"/api/itemtypes/{i}?companyId={A['id']}", admin)
for sid in made_suppliers:
    http("DELETE", f"/api/suppliers/{sid}", admin)
for n in ("mcpm_k", "mcpm_w", "mcpm_r", "mcpm_ta"):
    http("DELETE", f"/api/users/{uids[n]}", admin)
for r in http("GET", "/api/roles", admin)[1] or []:
    if r["name"].startswith("mcpm-"):
        http("DELETE", f"/api/roles/{r['id']}", admin)
print("all checks passed")
