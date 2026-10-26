"""
Hosted MCP - keeping bills out of FBR (prepare_fbr_exclusion), and the server rule behind it.

Proves:
  * an excluded bill is refused by FBR validate on the screen's own endpoint and through MCP,
    before any request reaches FBR;
  * prepare saves nothing; commit flips exactly the planned bills through the Bills screen's toggle;
  * bulk by date range picks every bill in the range and skips submitted ones, listing why;
  * a bill submitted between prepare and commit is left alone at commit;
  * another company's bill is unreachable by id, alone or mixed in, and a token for company A
    cannot act in company B; read and login tokens never see the tool;
  * including the bills again restores them.

Needs a LOCAL Trader database with 2+ companies holding invoices. Creates throwaway users
("mcpx") and bills on an otherwise empty past date, and removes them on success.

Usage: python scripts/test_mcp_fbr_exclusion.py --base http://localhost:5135
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
from datetime import date, timedelta

ap = argparse.ArgumentParser()
ap.add_argument("--base", default=os.environ.get("MYAPP_BASE", "http://localhost:5134"))
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--sql-db", default="MyApp_Trader_Local")
ARGS = ap.parse_args()
BASE = ARGS.base.rstrip("/")
PW = "mcpx1234"
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
        with urllib.request.urlopen(req, timeout=120) as r:
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


def excluded(bill_id):
    return sql(f"SELECT CAST(IsFbrExcluded AS varchar) FROM Invoices WHERE Id = {bill_id}") == "1"


print(f"MCP FBR exclusion test against {BASE}  (run {RUN})")
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
A, B = cands[0], cands[1]
B_BILL = int(sql(f"SELECT TOP 1 Id FROM Invoices WHERE CompanyId = {B['id']} AND NoteKind = 0 ORDER BY Id DESC"))
B_EXCL0 = excluded(B_BILL)

# A past date with no bill in company A, so a bulk range touches only this run's bills.
DAY = date(2019, 1, 1)
while sql(f"SELECT COUNT(*) FROM Invoices WHERE CompanyId = {A['id']} AND CAST([Date] AS date) = '{DAY.isoformat()}'") != "0":
    DAY += timedelta(days=1)
D = DAY.isoformat()

for u in http("GET", "/api/users", admin)[1] or []:
    if u["username"].startswith("mcpx_"):
        http("DELETE", f"/api/users/{u['id']}", admin)
sysr = {r["name"]: r["id"] for r in http("GET", "/api/roles", admin)[1] if r.get("isSystemRole")}
SALES, MCPA, MCPW = sysr["Sales Edition"], sysr["MCP Access"], sysr["MCP Write"]
uids, tok = {}, {}


def grant_test_access(user_id, writes):
    status, catalog = http("GET", f"/api/mcp/catalog/{user_id}", admin)
    assert status == 200, (status, catalog)
    tools = [t["name"] for t in catalog["tools"] if t["configurable"] and t["eligible"] and (writes or not t["write"])]
    status, result = http("PUT", f"/api/mcp/catalog/{user_id}", admin, {
        "revision": catalog["revision"], "accessGranted": True, "accessEnabled": True,
        "writesGranted": writes, "writesEnabled": writes, "grantedTools": tools, "selectedTools": tools})
    assert status == 200, (status, result)


def make(uname, role_ids, cids, writes):
    s, u = http("POST", "/api/users", admin, {"username": uname, "password": PW, "fullName": uname, "role": "User"})
    assert s in (200, 201), f"{uname}: {s} {u}"
    uids[uname] = u["id"]
    assert http("PUT", f"/api/users/{u['id']}/roles", admin, {"roleIds": role_ids})[0] == 200
    assert http("PUT", f"/api/usercompanies/user/{u['id']}", admin, {"companyIds": cids})[0] == 200
    grant_test_access(u["id"], writes)
    tok[uname] = login(uname, PW)


def mk(owner, cids, scopes, name="t"):
    s, d = http("POST", "/api/mcp/me/tokens", owner, {"name": name, "companyIds": cids, "scopes": scopes, "expiresInDays": 30})
    assert s == 200, f"token: {s} {d}"
    return d["secret"]


make("mcpx_w", [SALES, MCPA, MCPW], [A["id"], B["id"]], True)
make("mcpx_r", [SALES, MCPA], [A["id"]], False)
W, R = tok["mcpx_w"], tok["mcpx_r"]

print("\n== scopes and tools ==")
s, st = http("GET", "/api/mcp/me/status", W)
check("a writer holding the exclusion permission is offered fbrexclusion.write", "fbrexclusion.write" in st["scopesAvailable"], st["scopesAvailable"])
s, st = http("GET", "/api/mcp/me/status", R)
check("MCP Access without MCP Write is not offered it", "fbrexclusion.write" not in st["scopesAvailable"], st["scopesAvailable"])
TX = mk(W, [A["id"]], ["read", "fbrexclusion.write", "bills.write", "fbr.validate"], "exclude-A")
TRO = mk(W, [A["id"]], ["read"], "reader")
check("the exclusion token lists prepare_fbr_exclusion", "prepare_fbr_exclusion" in names(TX))
check("a read token does not", "prepare_fbr_exclusion" not in names(TRO))
check("a login token does not", "prepare_fbr_exclusion" not in names(W))

print("\n== throwaway bills ==")
bills = []
for n in range(3):
    err, bp = tool(TX, "prepare_bill", {"companyId": A["id"], "clientId": A["client"], "date": D, "gstRate": "18",
                   "items": [{"description": f"MCP exclusion {RUN} #{n}", "quantity": "1", "uom": "Pcs", "unitPrice": "100"}]})
    err2, bc = tool(TX, "commit_action", {"planId": bp["planId"]}) if not err else (True, bp)
    if err2:
        print(f"SKIP: could not create a bill dated {D}: {bc}")
        sys.exit(2)
    bills.append(int(bc["resultRef"].split(":")[1]))
b1, b2, b3 = bills
check(f"three bills dated {D} exist, none excluded", not any(excluded(b) for b in bills))

print("\n== one bill ==")
err, m = tool(TRO, "prepare_fbr_exclusion", {"companyId": A["id"], "invoiceIds": [b1]})
check("a read token cannot prepare an exclusion", err, m)
err, p1 = tool(TX, "prepare_fbr_exclusion", {"companyId": A["id"], "invoiceIds": [b1]})
check("prepare returns a plan for one bill and saves nothing", not err and p1["saved"] is False and p1["details"]["billsToChange"] == 1 and not excluded(b1), p1)
err, c1 = tool(TX, "commit_action", {"planId": p1["planId"]})
check("commit excludes the bill", not err and excluded(b1), c1)
err, gi = tool(TRO, "get_invoice", {"companyId": A["id"], "invoiceId": b1})
check("get_invoice reports isFbrExcluded", not err and gi.get("isFbrExcluded") is True, gi)
err, m = tool(TX, "prepare_fbr_exclusion", {"companyId": A["id"], "invoiceIds": [b1]})
check("excluding it again is refused as already excluded", err and "already excluded" in m, m)

print("\n== FBR refuses an excluded bill ==")
s, v = http("POST", f"/api/fbr/{b1}/validate", admin)
check("the screen's validate endpoint refuses it before contacting FBR", s == 200 and v.get("success") is False and "excluded" in (v.get("errorMessage") or "").lower(), v)
s, v = http("POST", f"/api/fbr/{b1}/submit", admin)
check("…and so does submit", s == 200 and v.get("success") is False and "excluded" in (v.get("errorMessage") or "").lower(), v)
err, vr = tool(TX, "validate_bill_fbr", {"companyId": A["id"], "invoiceId": b1})
check("MCP validate_bill_fbr refuses it too", not err and vr["valid"] is False and "excluded" in (vr["errorMessage"] or "").lower(), vr)
check("the bill is still not submitted", sql(f"SELECT ISNULL(FbrStatus, '-') FROM Invoices WHERE Id = {b1}") != "Submitted")

print("\n== tenant isolation ==")
err, m = tool(TX, "prepare_fbr_exclusion", {"companyId": A["id"], "invoiceIds": [B_BILL]})
check("another company's bill under company A is refused", err and "access denied" in m.lower(), m)
err, m = tool(TX, "prepare_fbr_exclusion", {"companyId": A["id"], "invoiceIds": [b2, B_BILL]})
check("…also when mixed in with company A's own bills", err and "access denied" in m.lower(), m)
err, m = tool(TX, "prepare_fbr_exclusion", {"companyId": B["id"], "invoiceIds": [B_BILL]})
check("a token for company A cannot act in company B", err, m)
err, m = tool(TX, "prepare_fbr_exclusion", {"companyId": B["id"], "dateTo": date.today().isoformat()})
check("…not even by date range", err, m)
check("company B's bill is unchanged", excluded(B_BILL) == B_EXCL0)
err, m = tool(TX, "prepare_fbr_exclusion", {"companyId": A["id"]})
check("neither invoiceIds nor dateTo is refused, never 'everything'", err and "dateTo" in m, m)
err, m = tool(TX, "prepare_fbr_exclusion", {"companyId": A["id"], "invoiceIds": [b2], "dateTo": D})
check("ids and a date range together are refused", err, m)

print("\n== bulk by date range ==")
sql(f"UPDATE Invoices SET FbrStatus = 'Submitted' WHERE Id = {b3}")
err, pb = tool(TX, "prepare_fbr_exclusion", {"companyId": A["id"], "dateFrom": D, "dateTo": D, "idempotencyKey": f"bulk-{RUN}"})
reasons = {s["reason"]: s["count"] for s in pb["details"]["skipped"]} if not err else {}
check("the range plans the one remaining bill and lists the excluded and submitted ones as skipped",
      not err and pb["details"]["invoiceIds"] == [b2] and reasons.get("already excluded") == 1 and reasons.get("already submitted to FBR") == 1, pb)
err, pb2 = tool(TX, "prepare_fbr_exclusion", {"companyId": A["id"], "dateFrom": D, "dateTo": D, "idempotencyKey": f"bulk-{RUN}"})
check("the same idempotency key returns the same plan", not err and pb2["planId"] == pb["planId"], pb2)
err, cb = tool(TX, "commit_action", {"planId": pb["planId"]})
check("commit excludes it; the submitted bill is untouched", not err and excluded(b2) and not excluded(b3), cb)
sql(f"UPDATE Invoices SET FbrStatus = NULL WHERE Id = {b3}")

print("\n== a bill submitted after the plan ==")
err, pi = tool(TX, "prepare_fbr_exclusion", {"companyId": A["id"], "invoiceIds": [b3]})
sql(f"UPDATE Invoices SET FbrStatus = 'Submitted' WHERE Id = {b3}")
err2, ci = tool(TX, "commit_action", {"planId": pi["planId"]}) if not err else (True, pi)
check("commit re-reads the bill and leaves a now-submitted one alone", not err2 and not excluded(b3) and "skipped" in ci["summary"], ci)
sql(f"UPDATE Invoices SET FbrStatus = NULL WHERE Id = {b3}")

print("\n== include again ==")
err, pin = tool(TX, "prepare_fbr_exclusion", {"companyId": A["id"], "excluded": False, "invoiceIds": [b1, b2]})
err2, cin = tool(TX, "commit_action", {"planId": pin["planId"]}) if not err else (True, pin)
check("including the bills again clears the flag", not err2 and not excluded(b1) and not excluded(b2), cin)
s, v = http("POST", f"/api/fbr/{b1}/validate", admin)
check("an included bill is no longer refused as excluded", s == 200 and "excluded" not in (v.get("errorMessage") or "").lower(), v)

print("\n== cleanup ==")
for b in reversed(bills):   # only the newest bill number can be deleted
    http("DELETE", f"/api/invoices/{b}", admin)
for u, i in uids.items():
    http("DELETE", f"/api/users/{i}", admin)
check("throwaway bills removed", sql(f"SELECT COUNT(*) FROM Invoices WHERE Id IN ({b1},{b2},{b3})") == "0")

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} FBR exclusion checks passed")
if not failed:
    print("all FBR exclusion checks passed")
sys.exit(1 if failed else 0)
