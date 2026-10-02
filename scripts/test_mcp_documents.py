"""
Hosted MCP - challans and bills: find, prepare, approve, commit.

An agent may raise a delivery challan and bill it (or raise a standalone bill) only through a
plan a person saw, and only with the same numbering, stock and readiness rules as the
screens. Proves: scopes follow the owner's permissions; the read tools stay inside the
token's companies; prepare saves nothing and uses no number; commit creates exactly one
document with the shown figures, once; a challan is billed in full or not at all; a bill is
never dated in the future and never submitted to FBR; an hourly ceiling stops a runaway
agent from burning invoice numbers; every step is logged.

Needs a LOCAL Trader database with 2+ companies holding invoices (with FBR-ready clients).
Creates throwaway users ("mcpd"), challans and bills, and removes them on success.

Usage: python scripts/test_mcp_documents.py [--base http://localhost:5137]
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
import urllib.parse
import urllib.request
from datetime import date, timedelta

ap = argparse.ArgumentParser()
ap.add_argument("--base", default=os.environ.get("MYAPP_BASE", "http://localhost:5134"))
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--sql-db", default="MyApp_Trader_Local")
ARGS = ap.parse_args()
BASE = ARGS.base.rstrip("/")
PW = "mcpd1234"
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
        with urllib.request.urlopen(req, timeout=90) as r:
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


def sql(query, scalar=False):
    args = ["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.sql_db, "-E", "-C", "-N", "-I", "-b"]
    args += (["-h", "-1", "-W", "-Q", "SET NOCOUNT ON; " + query] if scalar else ["-Q", query])
    out = subprocess.run(args, capture_output=True, text=True)
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


print(f"MCP documents test against {BASE}  (run {RUN})")
admin = login("admin", "admin123")
s, companies = http("GET", "/api/companies", admin)
cands = []
for c in companies:
    s, pg = http("GET", f"/api/invoices/company/{c['id']}/paged?page=1&pageSize=1", admin)
    if s == 200 and pg["items"]:
        cands.append({"id": c["id"], "client": pg["items"][0]["clientId"], "client_name": pg["items"][0]["clientName"]})
if len(cands) < 2:
    print("SKIP: need 2 companies with invoices.")
    sys.exit(2)
# Prefer a company whose client has already been through a challan -> bill cycle: that client is
# FBR-ready, so a new challan lands as Pending and can be billed.
for c in cands:
    ready = sql(f"SELECT TOP 1 ClientId FROM DeliveryChallans WHERE CompanyId = {c['id']} AND Status IN ('Pending','Invoiced','Imported') ORDER BY Id DESC", scalar=True)
    if ready.isdigit():
        c["client"] = int(ready)
        cands.remove(c)
        cands.insert(0, c)
        break
A, B = cands[0], next(c for c in cands[1:])
INT_UNIT = sql("SELECT TOP 1 Name FROM Units WHERE AllowsDecimalQuantity = 0", scalar=True)
B_ITEMTYPE = sql(f"SELECT TOP 1 Id FROM ItemTypes WHERE CompanyId = {B['id']} AND IsDeleted = 0", scalar=True)

s, users = http("GET", "/api/users", admin)
for u in users or []:
    if u["username"].startswith("mcpd_"):
        http("DELETE", f"/api/users/{u['id']}", admin)
s, roles = http("GET", "/api/roles", admin)
for r in roles or []:
    if r["name"].startswith("mcpd-"):
        http("DELETE", f"/api/roles/{r['id']}", admin)
s, roles = http("GET", "/api/roles", admin)
sysr = {r["name"]: r["id"] for r in roles if r.get("isSystemRole")}
SALES, MCPA, MCPW, TADMIN = sysr["Sales Edition"], sysr["MCP Access"], sysr["MCP Write"], sysr["Tenant Administrator"]
uids, tok = {}, {}


def make(creator, uname, role_ids, cids, role_string="User"):
    s, u = http("POST", "/api/users", creator, {"username": uname, "password": PW, "fullName": uname, "role": role_string})
    assert s in (200, 201), f"{uname}: {s} {u}"
    uids[uname] = u["id"]
    assert http("PUT", f"/api/users/{u['id']}/roles", creator, {"roleIds": role_ids})[0] == 200
    assert http("PUT", f"/api/usercompanies/user/{u['id']}", creator, {"companyIds": cids})[0] == 200
    tok[uname] = login(uname, PW)


make(admin, "mcpd_w", [SALES, MCPA, MCPW], [A["id"], B["id"]])
make(admin, "mcpd_ta", [TADMIN, SALES, MCPA, MCPW], [A["id"]], "Administrator")
s, r = http("POST", "/api/roles", tok["mcpd_ta"], {"name": "mcpd-challans-only", "description": "t", "permissionKeys":
            ["mcp.access.use", "mcp.write.use", "clients.manage.view", "challans.list.view", "challans.manage.create"]})
assert s in (200, 201), f"tenant role: {s} {r}"
make(tok["mcpd_ta"], "mcpd_c", [r["id"]], [A["id"]])
W, C = tok["mcpd_w"], tok["mcpd_c"]


def mk(owner, cids, scopes, name="t"):
    s, d = http("POST", "/api/mcp/me/tokens", owner, {"name": name, "companyIds": cids, "scopes": scopes, "expiresInDays": 30})
    assert s == 200, f"token: {s} {d}"
    return d["secret"], d["id"]


# ── scopes ───────────────────────────────────────────────────────────
print("\n== scopes ==")
s, st = http("GET", "/api/mcp/me/status", W)
check("a full-permission writer is offered challans.write and bills.write", {"challans.write", "bills.write"} <= set(st["scopesAvailable"]), st["scopesAvailable"])
s, st = http("GET", "/api/mcp/me/status", C)
check("challan permission without bill permission -> challans.write only", "challans.write" in st["scopesAvailable"] and "bills.write" not in st["scopesAvailable"], st["scopesAvailable"])
s, d = http("POST", "/api/mcp/me/tokens", C, {"name": "x", "companyIds": [A["id"]], "scopes": ["read", "bills.write"], "expiresInDays": 5})
check("…and a bills token is refused for that user", s == 400, f"{s} {d}")

TW, TW_ID = mk(W, [A["id"]], ["read", "challans.write", "bills.write", "quotes.write"], "all-A")
TC, _ = mk(C, [A["id"]], ["read", "challans.write"], "challans-only")
TRO, _ = mk(W, [A["id"]], ["read"], "reader")
TW2, _ = mk(W, [A["id"]], ["read", "challans.write", "bills.write"], "other")
READ8 = {"get_invoice", "get_stock", "list_companies", "search_clients", "search_invoices", "search_quotes", "search_challans", "get_challan"}
check("every token and login sees the two challan read tools", names(TRO) == READ8 and names(W) == READ8, (names(TRO) ^ READ8, names(W) ^ READ8))
check("a challans token sees prepare_challan but not prepare_bill", {"prepare_challan", "commit_action"} <= names(TC) and "prepare_bill" not in names(TC), names(TC))
check("a bills token sees prepare_bill", "prepare_bill" in names(TW) and "prepare_challan" in names(TW), names(TW))

# ── read tools ───────────────────────────────────────────────────────
print("\n== finding challans ==")
err, d = tool(TRO, "search_challans", {"companyId": A["id"], "pageSize": 5})
check("search_challans works for a read token and stays in its company", not err and all(c["companyId"] == A["id"] for c in d["items"]), d)
err, m = tool(TRO, "search_challans", {"companyId": B["id"]})
check("a token limited to A cannot search B's challans", err, m)
err, m = tool(TRO, "search_challans", {"companyId": A["id"], "status": "Bogus"})
check("a bad status is refused", err, m)
s, pg = http("GET", f"/api/deliverychallans/company/{B['id']}/paged?page=1&pageSize=1", admin)
if pg["items"]:
    err, m = tool(TRO, "get_challan", {"companyId": A["id"], "challanId": pg["items"][0]["id"]})
    check("a challan of company B cannot be read through company A", err, m)
    err, m = tool(TRO, "get_challan", {"companyId": B["id"], "challanId": pg["items"][0]["id"]})
    check("…nor through company B (outside the token)", err, m)
err, m1 = tool(TRO, "get_challan", {"companyId": A["id"], "challanId": 2_000_000_000})
check("a missing challan is refused without detail", err, m1)

# ── challan ──────────────────────────────────────────────────────────
print("\n== challan: prepare, commit ==")
today = date.today().isoformat()
CH = {"companyId": A["id"], "clientId": A["client"], "deliveryDate": today, "poNumber": f"PO-{RUN}", "poDate": today,
      "items": [{"description": f"MCP challan item {RUN} one", "quantity": "5", "unit": "Pcs"},
                {"description": f"MCP challan item {RUN} two", "quantity": "2.5", "unit": "Kg"}]}


def challan_count(cid=A["id"]):
    return http("GET", f"/api/deliverychallans/company/{cid}/paged?page=1&pageSize=1", admin)[1]["totalCount"]


err, m = tool(TRO, "prepare_challan", CH)
check("a read-only token cannot prepare a challan", err, m)
err, m = tool(W, "prepare_challan", CH)
check("a login token cannot prepare a challan", err, m)
err, m = tool(TW, "prepare_challan", {**CH, "companyId": B["id"], "clientId": B["client"]})
check("a token limited to A cannot prepare in B", err, m)

n0 = challan_count()
err, plan = tool(TW, "prepare_challan", CH)
check("prepare_challan returns a plan and saves nothing", not err and plan["saved"] is False and f"PO {CH['poNumber']}" in plan["summary"], plan)
check("no challan exists yet", challan_count() == n0)
err, m = tool(TW2, "commit_action", {"planId": plan["planId"]})
check("another token cannot commit it", err, m)
err, r1 = tool(TW, "commit_action", {"planId": plan["planId"]})
check("commit creates the challan", not err and r1["committed"] and r1["resultRef"].startswith("DeliveryChallan:"), r1)
chid = int(r1["resultRef"].split(":")[1])
check("exactly one challan was added", challan_count() == n0 + 1, (n0, challan_count()))
s, ch = http("GET", f"/api/deliverychallans/{chid}", admin)
check("the saved challan matches: company, client, PO, delivery date, lines",
      s == 200 and ch["companyId"] == A["id"] and ch["clientId"] == A["client"] and ch["poNumber"] == CH["poNumber"]
      and (ch["deliveryDate"] or "").startswith(today) and len(ch["items"]) == 2 and ch["challanNumber"] > 0, ch)
check("its status is reported honestly", ch["status"] in ("Pending", "Setup Required") and ch["status"] in r1["summary"], (ch["status"], r1["summary"]))
err, m = tool(TW, "commit_action", {"planId": plan["planId"]})
check("the same plan cannot be committed twice", err, m)
check("…and creates no second challan", challan_count() == n0 + 1)
made_challans = [chid]

err, g = tool(TRO, "get_challan", {"companyId": A["id"], "challanId": chid})
check("get_challan shows lines with the deliveryItemId a bill needs", not err and len(g["items"]) == 2 and all(i["deliveryItemId"] > 0 for i in g["items"]), g)
check("get_challan never returns cost or supplier fields", not err and not any(k.lower() in json.dumps(g).lower() for k in ("actualUnitCost", "supplier", "profit")), list(g["items"][0]))
err, sc = tool(TRO, "search_challans", {"companyId": A["id"], "search": CH["poNumber"]})
check("search finds it", not err and any(c["id"] == chid for c in sc["items"]), sc)

# idempotency + validation
print("\n== challan: idempotency and validation ==")
CHk = {**CH, "poNumber": f"PO-{RUN}-k", "idempotencyKey": f"mail-{RUN}-c"}
err, p1 = tool(TW, "prepare_challan", CHk)
err2, p2 = tool(TW, "prepare_challan", CHk)
check("one idempotency key returns one plan", p1["planId"] == p2["planId"])
err, c1 = tool(TW, "commit_action", {"planId": p1["planId"]})
made_challans.append(int(c1["resultRef"].split(":")[1]))
err, p3 = tool(TW, "prepare_challan", CHk)
check("after commit, the key reports 'already done'", p3.get("alreadyDone") is True and p3["resultRef"] == c1["resultRef"], p3)
check("only one challan was made for the key", challan_count() == n0 + 2, (n0, challan_count()))


def item(**kw):
    it = {"description": "x", "quantity": "1", "unit": "Pcs"}
    it.update(kw)
    return {**CH, "items": [it]}


cases = [
    ("no delivery date", {k: v for k, v in CH.items() if k != "deliveryDate"}),
    ("malformed delivery date", {**CH, "deliveryDate": "02-10-2026"}),
    ("zero quantity", item(quantity="0")), ("negative quantity", item(quantity="-2")),
    ("five-decimal quantity", item(quantity="1.00001")), ("non-numeric quantity", item(quantity="lots")),
    ("blank description", item(description=" ")), ("blank unit", item(unit="")),
    ("no items", {**CH, "items": []}), ("101 items", {**CH, "items": [{"description": "x", "quantity": "1", "unit": "Pcs"}] * 101}),
    ("a client from another company", {**CH, "clientId": B["client"]}),
    ("an item type from another company", item(itemTypeId=int(B_ITEMTYPE))),
    ("overlong PO number", {**CH, "poNumber": "p" * 101}),
]
if INT_UNIT:
    cases.append((f"a fractional quantity on the whole-number unit '{INT_UNIT}'", item(unit=INT_UNIT, quantity="1.5")))
for label, args in cases:
    err, m = tool(TW, "prepare_challan", args)
    check(f"{label} refused", err, m)
check("no refused prepare created a challan", challan_count() == n0 + 2)

err, pn = tool(TW, "prepare_challan", {**CH, "poNumber": "", "poDate": None} if False else {k: v for k, v in CH.items() if k not in ("poNumber", "poDate")})
check("without a PO number the plan warns the challan will be 'No PO'", not err and "No PO" in pn["details"]["expectedStatus"], pn)
err, cn = tool(TW, "commit_action", {"planId": pn["planId"]})
nopo_id = int(cn["resultRef"].split(":")[1])
made_challans.append(nopo_id)
s, nopo = http("GET", f"/api/deliverychallans/{nopo_id}", admin)
check("…and it is saved as No PO (or Setup Required)", nopo["status"] in ("No PO", "Setup Required"), nopo["status"])

# ── bills from challans ──────────────────────────────────────────────
print("\n== bill from a challan ==")
if ch["status"] == "Setup Required":
    # Locally the stored FBR tokens cannot be decrypted (a different key ring), so a new challan always lands as
    # Setup Required. Mark this throwaway challan Pending so the billing path itself can be exercised.
    sql(f"UPDATE DeliveryChallans SET Status = 'Pending' WHERE Id = {chid}")
    s, ch = http("GET", f"/api/deliverychallans/{chid}", admin)
    print(f"  (local FBR token unreadable: challan {chid} marked Pending to exercise billing; status now {ch['status']})")
items_ = g["items"]
PR = [{"deliveryItemId": items_[0]["deliveryItemId"], "unitPrice": "100"}, {"deliveryItemId": items_[1]["deliveryItemId"], "unitPrice": "40.5"}]
BL = {"companyId": A["id"], "clientId": A["client"], "date": today, "gstRate": "18", "challanIds": [chid], "prices": PR, "paymentMode": "Credit"}


def invoice_count(cid=A["id"]):
    return http("GET", f"/api/invoices/company/{cid}/paged?page=1&pageSize=1", admin)[1]["totalCount"]


err, m = tool(TC, "prepare_bill", BL)
check("a challans-only token cannot prepare a bill", err, m)
err, m = tool(TRO, "prepare_bill", BL)
check("a read-only token cannot prepare a bill", err, m)

if ch["status"] == "Pending":
    for label, args in (
        ("a missing price for a challan line", {**BL, "prices": PR[:1]}),
        ("a price for a line not on the challan", {**BL, "prices": PR + [{"deliveryItemId": 2_000_000_000, "unitPrice": "1"}]}),
        ("the same line priced twice", {**BL, "prices": PR + [PR[0]]}),
        ("a zero price", {**BL, "prices": [{**PR[0], "unitPrice": "0"}, PR[1]]}),
        ("a five-decimal price", {**BL, "prices": [{**PR[0], "unitPrice": "1.00001"}, PR[1]]}),
        ("items mixed in with challanIds", {**BL, "items": [{"description": "x", "quantity": "1", "unitPrice": "1"}]}),
        ("a bill dated tomorrow", {**BL, "date": (date.today() + timedelta(days=2)).isoformat()}),
        ("gst over 100", {**BL, "gstRate": "150"}),
        ("a bad payment mode", {**BL, "paymentMode": "Barter"}),
        ("a challan that does not exist", {**BL, "challanIds": [2_000_000_000]}),
        ("a challan with no PO (not billable)", {**BL, "challanIds": [nopo_id]}),
        ("a client other than the challan's", {**BL, "clientId": B["client"]}),
        ("no prices at all", {k: v for k, v in BL.items() if k != "prices"}),
    ):
        err, m = tool(TW, "prepare_bill", args)
        check(f"{label} refused", err, m)

    b0 = invoice_count()
    err, bp = tool(TW, "prepare_bill", BL)
    check("prepare_bill shows the lines and totals and saves nothing", not err and bp["saved"] is False and bp["details"]["subtotal"] == 601.25, bp)
    d_ = bp["details"]
    check("figures: 5x100 + 2.5x40.5 = 601.25; GST 18% = 108.225 -> 108.22 (half-to-even, as the ERP does); total 709.47", d_["gstAmount"] == 108.22 and d_["grandTotal"] == 709.47, d_)
    check("the challan is still unbilled and no bill exists", invoice_count() == b0)
    err, bc = tool(TW, "commit_action", {"planId": bp["planId"]})
    check("commit creates the bill", not err and bc["resultRef"].startswith("Invoice:") and "Not submitted to FBR" in bc["summary"], bc)
    inv_id = int(bc["resultRef"].split(":")[1])
    check("exactly one bill was added", invoice_count() == b0 + 1, (b0, invoice_count()))
    s, inv = http("GET", f"/api/invoices/{inv_id}", admin)
    check("the saved bill matches the plan: company, client, totals", s == 200 and inv["companyId"] == A["id"] and inv["clientId"] == A["client"]
          and inv["subtotal"] == 601.25 and inv["gstAmount"] == 108.22 and inv["grandTotal"] == 709.47 and inv["invoiceNumber"] > 0, inv)
    check("it was NOT submitted to FBR (no IRN, no submit time, status not Submitted)",
          not inv.get("fbrIRN") and inv.get("fbrSubmittedAt") in (None, "") and inv.get("fbrStatus") != "Submitted",
          {k: inv.get(k) for k in ("fbrIRN", "fbrStatus", "fbrSubmittedAt")})
    s, ch2 = http("GET", f"/api/deliverychallans/{chid}", admin)
    check("the challan is now Invoiced and linked to the bill", ch2["status"] == "Invoiced" and ch2["invoiceId"] == inv_id, (ch2["status"], ch2["invoiceId"]))
    err, m = tool(TW, "commit_action", {"planId": bp["planId"]})
    check("the same bill plan cannot be committed twice", err, m)
    check("…and no second bill exists", invoice_count() == b0 + 1)
    err, m = tool(TW, "prepare_bill", BL)
    check("an already-billed challan cannot be billed again", err, m)
    made_bills = [inv_id]
else:
    print(f"  (challan status was {ch['status']}: bill-from-challan path skipped; the client is not FBR-ready locally)")
    made_bills = []

# ── standalone bills ─────────────────────────────────────────────────
print("\n== standalone bill ==")
SB = {"companyId": A["id"], "clientId": A["client"], "date": today, "gstRate": "18",
      "items": [{"description": f"MCP service {RUN}", "quantity": "3", "uom": "Pcs", "unitPrice": "33.335"}]}
b0 = invoice_count()
err, sp = tool(TW, "prepare_bill", SB)
check("a standalone bill plan is produced", not err and sp["saved"] is False, sp)
d_ = sp["details"]
check("rounding matches the ERP (100.005 -> subtotal 100.01, GST 18.00, total 118.01)", d_["subtotal"] == 100.01 and d_["gstAmount"] == 18.0 and d_["grandTotal"] == 118.01, d_)
for label, args in (
    ("prices on a standalone bill", {**SB, "prices": [{"deliveryItemId": 1, "unitPrice": "1"}]}),
    ("no items", {k: v for k, v in SB.items() if k != "items"}),
    ("a zero unit price", {**SB, "items": [{"description": "x", "quantity": "1", "unitPrice": "0"}]}),
    ("a future date", {**SB, "date": (date.today() + timedelta(days=3)).isoformat()}),
    ("a client from another company", {**SB, "clientId": B["client"]}),
    ("an item type from another company", {**SB, "items": [{"description": "x", "quantity": "1", "unitPrice": "1", "itemTypeId": int(B_ITEMTYPE)}]}),
):
    err, m = tool(TW, "prepare_bill", args)
    check(f"{label} refused", err, m)
check("nothing was billed by the refused prepares", invoice_count() == b0)
err, sc_ = tool(TW, "commit_action", {"planId": sp["planId"]})
check("commit creates the standalone bill", not err and sc_["resultRef"].startswith("Invoice:"), sc_)
sinv = int(sc_["resultRef"].split(":")[1])
made_bills.append(sinv)
s, si = http("GET", f"/api/invoices/{sinv}", admin)
check("the saved bill matches the rounding the plan showed", si["subtotal"] == 100.01 and si["gstAmount"] == 18.0 and si["grandTotal"] == 118.01, si)
check("…and was not submitted to FBR", not si.get("fbrIRN") and si.get("fbrSubmittedAt") in (None, "") and si.get("fbrStatus") != "Submitted",
      {k: si.get(k) for k in ("fbrIRN", "fbrStatus", "fbrSubmittedAt")})
err, sk = tool(TW, "prepare_bill", {**SB, "idempotencyKey": f"mail-{RUN}-b"})
err, sk2 = tool(TW, "prepare_bill", {**SB, "idempotencyKey": f"mail-{RUN}-b"})
check("a bill idempotency key returns the same plan", sk["planId"] == sk2["planId"])
tool(TW, "cancel_action", {"planId": sk["planId"]})

# ── ceilings and gates ───────────────────────────────────────────────
print("\n== hourly ceiling and gates at commit ==")
for i in range(10):
    sql("INSERT INTO McpPendingActions (PlanId, AgentTokenId, UserId, CompanyId, Kind, Payload, Summary, CreatedAt, ExpiresAt, CommittedAt, ResultRef) "
        f"VALUES ('plan_fake{RUN}{i}', {TW_ID}, {uids['mcpd_w']}, {A['id']}, 'bill.standalone', '{{}}', 'fake', SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), 'Invoice:0')")
err, cp = tool(TW, "prepare_bill", SB)
b1 = invoice_count()
err, m = tool(TW, "commit_action", {"planId": cp["planId"]})
check("ten bills in an hour is the ceiling: the eleventh is refused", err and "last hour" in m, m)
check("…and no bill was created", invoice_count() == b1)
tool(TW, "cancel_action", {"planId": cp["planId"]})
sql(f"DELETE FROM McpPendingActions WHERE PlanId LIKE 'plan_fake{RUN}%'")

err, pw = tool(TW, "prepare_challan", {**CH, "poNumber": f"PO-{RUN}-g"})
http("PUT", f"/api/users/{uids['mcpd_w']}/roles", admin, {"roleIds": [SALES, MCPA]})
err, m = tool(TW, "commit_action", {"planId": pw["planId"]})
check("MCP Write withdrawn after prepare -> the challan commit is refused", err, m)
http("PUT", f"/api/users/{uids['mcpd_w']}/roles", admin, {"roleIds": [SALES, MCPA, MCPW]})
check("…and no extra challan appeared", challan_count() == n0 + 3, (n0, challan_count()))

# ── activity ─────────────────────────────────────────────────────────
print("\n== activity log ==")
q = f"&userId={uids['mcpd_w']}&pageSize=100"
commits = http("GET", "/api/mcp-admin/activity?tool=commit_action&outcome=ok" + q, admin)[1]["items"]
refs = [r["resultRef"] for r in commits]
check("commits are logged with their document references", f"DeliveryChallan:{chid}" in refs and any(r.startswith("Invoice:") for r in refs), refs)
check("…and what was done", any("Created challan" in r["detail"] for r in commits) and any("Created bill" in r["detail"] for r in commits))
prep = http("GET", "/api/mcp-admin/activity?tool=prepare_bill" + q, admin)[1]["items"]
check("prepare_bill calls are logged, refused ones too", any(r["outcome"] == "ok" for r in prep) and any(r["outcome"] == "denied" for r in prep), len(prep))
blob = json.dumps(commits + prep)
check("no agent secret in the log", TW not in blob and TRO not in blob and TC not in blob)

# ── result ───────────────────────────────────────────────────────────
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
if fails:
    print("FAILED - throwaway users and documents kept for inspection:")
    for n, _, dtl in fails:
        print(f"  - {n}: {dtl}")
    sys.exit(1)
# Clean up: newest bills first (only the latest bill is deletable), then challans, then users.
for b in sorted(made_bills, reverse=True):
    http("DELETE", f"/api/invoices/{b}", admin)
for c in sorted(set(made_challans + [int(x) for x in sql(f"SELECT Id FROM DeliveryChallans WHERE CompanyId = {A['id']} AND PoNumber LIKE 'PO-{RUN}%'", scalar=True).split() if x.isdigit()]), reverse=True):
    http("DELETE", f"/api/deliverychallans/{c}", admin)
for n in ("mcpd_c", "mcpd_w", "mcpd_ta"):
    http("DELETE", f"/api/users/{uids[n]}", admin)
s, roles = http("GET", "/api/roles", admin)
for r in roles or []:
    if r["name"].startswith("mcpd-"):
        http("DELETE", f"/api/roles/{r['id']}", admin)
print("all checks passed")
