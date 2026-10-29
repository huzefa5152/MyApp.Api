"""
Shared starter templates (2026-10-29): installation-wide print designs the seed admin adds -- over
HTTP or through MCP -- and every company sees in its Starter Gallery.

Proves: only the seed admin writes (a tenant Administrator holding every key is refused, over HTTP
and MCP); every rule refuses what it should (unknown type, active content, oversize, tenant data,
stale revision) and nothing is saved; unknown merge fields need an explicit accept; any company's
users read it, a user without either print key cannot; hide / show / delete; applying it to a
company template works like a code starter; no company data in the response; one audit row per
write with no company. Creates throwaway users, roles and starters, and removes them. LOCAL only.

    python scripts/test_shared_starters.py --base http://localhost:5197 [--sql-db MyApp_Importer_Local]
"""
from __future__ import annotations

import argparse
import json
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5197")
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--sql-db", default="MyApp_Importer_Local")
ARGS = ap.parse_args()
BASE = ARGS.base.rstrip("/")
if (urlparse(BASE).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
    raise SystemExit("Local only: this suite creates users, roles and starters.")
RUN = secrets.token_hex(3)
PW = "Starter-" + secrets.token_hex(6)
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -- {str(detail)[:300]}"))


def http(method, path, token=None, body=None):
    data, hdrs = None, {}
    if body is not None:
        data, hdrs["Content-Type"] = json.dumps(body).encode(), "application/json"
    if token:
        hdrs["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
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


def sql(query):
    out = subprocess.run(["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.sql_db, "-E", "-C", "-N", "-I", "-b", "-h", "-1", "-W",
                          "-Q", "SET NOCOUNT ON; " + query], capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert out.returncode == 0, out.stdout + out.stderr
    return [line.strip() for line in out.stdout.splitlines() if line.strip()]


rpc = [0]


def mcp(token, method, params=None):
    rpc[0] += 1
    return http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": rpc[0], "method": method, "params": params or {}})


def call(token, name, args):
    s, d = mcp(token, "tools/call", {"name": name, "arguments": args})
    if s != 200 or not isinstance(d, dict):
        return True, f"http {s}: {d}"
    if "error" in d:
        return True, d["error"]["message"]
    return bool(d["result"].get("isError")), d["result"]["content"][0]["text"]


def tools(token):
    s, d = mcp(token, "tools/list")
    return {t["name"] for t in d.get("result", {}).get("tools", [])} if s == 200 else set()


GOOD = "<html><body><h1>{{companyBrandName}}</h1><p>Challan {{challanNumber}}</p></body></html>"
# The importer prints sales as one Invoice (TaxInvoice); companies here carry that template.
GOOD_INV = "<html><body><h1>Invoice {{invoiceNumber}}</h1><p>PO {{poNumber}}</p></body></html>"
admin = login("admin", "admin123")
companies = http("GET", "/api/companies", admin)[1]
A = companies[0]["id"]
made_users, made_roles, made_starters, made_tokens = [], [], [], []
seed_restore = []


def grant_mcp(user_id):
    s, cat = http("GET", f"/api/mcp/catalog/{user_id}", admin)
    assert s == 200, (s, cat)
    names = [t["name"] for t in cat["tools"] if t["configurable"] and t["eligible"]]
    s, r = http("PUT", f"/api/mcp/catalog/{user_id}", admin, {"revision": cat["revision"], "accessGranted": True, "accessEnabled": True,
                "writesGranted": True, "writesEnabled": True, "grantedTools": names, "selectedTools": names})
    assert s == 200, (s, r)


def restore_catalog(user_id, before):
    cur = http("GET", f"/api/mcp/catalog/{user_id}", admin)[1]
    granted = [t["name"] for t in before["tools"] if t["configurable"] and t["granted"]]
    selected = [t["name"] for t in before["tools"] if t["configurable"] and t["selected"]]
    s, r = http("PUT", f"/api/mcp/catalog/{user_id}", admin, {"revision": cur["revision"], "accessGranted": before["accessGranted"],
                "accessEnabled": before["accessEnabled"], "writesGranted": before["writesGranted"], "writesEnabled": before["writesEnabled"],
                "grantedTools": granted, "selectedTools": selected})
    assert s == 200, (s, r)


def make_user(uname, role_ids, role_string="User", mcp_on=False, creator=None):
    creator = creator or admin
    s, u = http("POST", "/api/users", creator, {"username": uname, "password": PW, "fullName": uname, "role": role_string})
    assert s in (200, 201), (uname, s, u)
    made_users.append(u["id"])
    rs = http("PUT", f"/api/users/{u['id']}/roles", creator, {"roleIds": role_ids})
    assert rs[0] == 200, (uname, rs)
    assert http("PUT", f"/api/usercompanies/user/{u['id']}", creator, {"companyIds": [A]})[0] == 200
    if mcp_on:
        grant_mcp(u["id"])
    return u["id"], login(uname, PW)


def token(owner, scopes):
    s, d = http("POST", "/api/mcp/me/tokens", owner, {"name": f"starters-{RUN}", "companyIds": [A], "scopes": scopes, "expiresInDays": 1})
    assert s == 200, (s, d)
    made_tokens.append((owner, d["id"]))  # revoked at the end: the seed admin may hold only 10
    return d["secret"]


def body(**kw):
    d = {"templateType": "Challan", "name": f"Shared {RUN}", "description": "Test design", "htmlContent": GOOD, "sortOrder": 0}
    d.update(kw)
    return d


try:
    sysr = {r["name"]: r["id"] for r in http("GET", "/api/roles", admin)[1] if r.get("isSystemRole")}
    # The importer's system roles are Administrator / MCP Access / MCP Write; an ordinary user gets
    # a role holding just the two print keys.
    _, tadmin = make_user(f"sst_ta_{RUN}", [sysr["Administrator"], sysr["MCP Access"], sysr["MCP Write"]], "Administrator", mcp_on=True)
    s, prole = http("POST", "/api/roles", admin, {"name": f"sst-print-{RUN}", "description": "t",
                    "permissionKeys": ["printtemplates.manage.view", "printtemplates.starter.apply"]})
    assert s in (200, 201), (s, prole)
    made_roles.append(prole["id"])
    _, staff = make_user(f"sst_u_{RUN}", [prole["id"]])
    # A private role belongs to the tenant that made it, so the tenant administrator makes both.
    s, role = http("POST", "/api/roles", tadmin, {"name": f"sst-noprint-{RUN}", "description": "t", "permissionKeys": ["clients.manage.view"]})
    assert s in (200, 201), (s, role)
    made_roles.append(role["id"])
    _, noprint = make_user(f"sst_np_{RUN}", [role["id"]], creator=tadmin)

    print("\n=== HTTP: the seed admin writes, nobody else ===")
    s, st = http("POST", "/api/starter-templates", admin, body())
    check("seed admin adds a shared starter", s == 200 and st.get("id"), f"{s} {st}")
    sid = st["id"]; made_starters.append(sid)
    check("its response carries no company", "companyId" not in json.dumps(st).lower(), st)
    s, lst = http("GET", "/api/starter-templates?type=Challan", staff)
    check("an ordinary user of a company sees it", s == 200 and any(x["id"] == sid for x in lst), f"{s}")
    s, lst = http("GET", "/api/starter-templates", tadmin)
    check("a tenant administrator sees it", s == 200 and any(x["id"] == sid for x in lst), f"{s}")
    s, d = http("GET", "/api/starter-templates", noprint)
    check("a user without either print key may not read starters (403)", s == 403, f"{s} {d}")
    n0 = len(http("GET", "/api/starter-templates?includeInactive=true", admin)[1])
    s, d = http("POST", "/api/starter-templates", tadmin, body(name=f"Tenant {RUN}"))
    check("a tenant administrator holding every key is refused (403)", s == 403, f"{s} {d}")
    s, d = http("PUT", f"/api/starter-templates/{sid}", tadmin, body(revision=st["revision"], name="x"))
    check("...and may not change one (403)", s == 403, f"{s} {d}")
    s, d = http("DELETE", f"/api/starter-templates/{sid}?revision={st['revision']}", tadmin)
    check("...or delete one (403)", s == 403, f"{s} {d}")
    check("nothing was written by those refusals", len(http("GET", "/api/starter-templates?includeInactive=true", admin)[1]) == n0)

    print("\n=== Validation (nothing saved) ===")
    cases = [
        ("an unknown template type", body(templateType="Nonsense"), "Allowed"),
        ("the retired Bill type", body(templateType="Bill"), "TaxInvoice"),
        ("a <script> tag", body(htmlContent=GOOD.replace("</body>", "<script>alert(1)</script></body>")), "Active content"),
        ("an onload handler", body(htmlContent=GOOD.replace("<body>", '<body onload="x()">')), "Active content"),
        ("a javascript: link", body(htmlContent=GOOD.replace("</body>", '<a href="javascript:x()">x</a></body>')), "Active content"),
        ("an iframe", body(htmlContent=GOOD.replace("</body>", "<iframe src=x></iframe></body>")), "Active content"),
        ("a srcdoc attribute", body(htmlContent=GOOD.replace("<p>", '<p srcdoc="x">')), "Active content"),
        ("a data:text/html link", body(htmlContent=GOOD.replace("</body>", '<a href="data:text/html,x">x</a></body>')), "Active content"),
        ("an oversize design", body(htmlContent="<p>" + "x" * 200_100 + "</p>"), "larger than"),
        ("an NTN number", body(htmlContent=GOOD.replace("</body>", "<p>NTN 1234567-8</p></body>")), "NTN"),
        ("a CNIC number", body(htmlContent=GOOD.replace("</body>", "<p>42101-1234567-1</p></body>")), "CNIC"),
        ("a phone number", body(htmlContent=GOOD.replace("</body>", "<p>Call 0321-1234567</p></body>")), "phone"),
        ("an e-mail address", body(htmlContent=GOOD.replace("</body>", "<p>sales@example.com</p></body>")), "e-mail"),
        ("a large inline logo", body(htmlContent=GOOD.replace("</body>", '<img src="data:image/png;base64,' + "A" * 9000 + '"></body>')), "logo"),
        ("an unknown merge field without accept", body(htmlContent=GOOD.replace("</body>", "<p>{{noSuchFieldHere}}</p></body>")), "noSuchFieldHere"),
    ]
    for label, payload, word in cases:
        before = len(http("GET", "/api/starter-templates?includeInactive=true", admin)[1])
        s, d = http("POST", "/api/starter-templates", admin, payload)
        msg = d.get("message", "") if isinstance(d, dict) else str(d)
        check(f"refused: {label}", s == 400 and word.lower() in msg.lower(), f"{s} {msg}")
        check(f"  ...and nothing saved ({label})", len(http("GET", "/api/starter-templates?includeInactive=true", admin)[1]) == before)
    s, d = http("POST", "/api/starter-templates", admin, body(name=f"Accepted {RUN}", htmlContent=GOOD.replace("</body>", "<p>{{noSuchFieldHere}}</p></body>"), acceptUnknownFields=True))
    check("an unknown merge field is saved once explicitly accepted", s == 200, f"{s} {d}")
    if s == 200: made_starters.append(d["id"])
    s, d = http("PUT", f"/api/starter-templates/{sid}", admin, body(revision="0" * 64, name="x"))
    check("an update from a stale revision is refused (409)", s == 409, f"{s} {d}")

    print("\n=== Hide, show, apply, delete ===")
    st = next(x for x in http("GET", "/api/starter-templates?includeInactive=true", admin)[1] if x["id"] == sid)
    s, st2 = http("PUT", f"/api/starter-templates/{sid}/active", admin, {"revision": st["revision"], "active": False})
    check("hide it", s == 200 and not st2["isActive"], f"{s} {st2}")
    check("a hidden starter is gone for everyone", all(x["id"] != sid for x in http("GET", "/api/starter-templates", staff)[1]))
    s, st3 = http("PUT", f"/api/starter-templates/{sid}/active", admin, {"revision": st2["revision"], "active": True})
    check("show it again", s == 200 and st3["isActive"] and any(x["id"] == sid for x in http("GET", "/api/starter-templates", staff)[1]), f"{s}")
    s, inv = http("POST", "/api/starter-templates", admin, body(templateType="TaxInvoice", name=f"Invoice {RUN}", htmlContent=GOOD_INV))
    check("seed admin adds a shared Invoice (TaxInvoice) starter", s == 200, f"{s} {inv}")
    if s == 200: made_starters.append(inv["id"])
    tpls = http("GET", f"/api/printtemplates/company/{A}", admin)[1]
    inv_tpl = next((t for t in tpls if t["templateType"] == "TaxInvoice"), None)
    if inv_tpl and s == 200:
        before_html = inv_tpl.get("htmlContent")
        shared = next(x for x in http("GET", "/api/starter-templates?type=TaxInvoice", staff)[1] if x["id"] == inv["id"])
        s, applied = http("POST", f"/api/printtemplates/{inv_tpl['id']}/apply-starter", staff, {"htmlContent": shared["htmlContent"], "mode": "all", "starterName": shared["name"]})
        check("a shared starter applies to a company template like a code starter", s == 200 and "{{invoiceNumber}}" in applied.get("htmlContent", ""), f"{s} {applied}")
        s, back = http("POST", f"/api/printtemplates/{inv_tpl['id']}/apply-starter", admin, {"htmlContent": before_html, "mode": "all", "starterName": "restore"})
        check("  ...and the company template is restored", s == 200 and back.get("htmlContent") == before_html, f"{s}")
    else:
        check("a company Invoice (TaxInvoice) template exists to apply onto", False, "none")

    print("\n=== MCP ===")
    seed_id = int(sql("SELECT Id FROM Users WHERE Username='admin'")[0])
    # The seed admin's own MCP settings are put back afterwards: other suites expect them as they were.
    seed_restore.append((seed_id, http("GET", f"/api/mcp/catalog/{seed_id}", admin)[1]))
    grant_mcp(seed_id)
    seed_tok = token(admin, ["read", "templates.read", "templates.write"])
    ta_tok = token(tadmin, ["read", "templates.read", "templates.write"])
    check("seed admin's tools include prepare_starter_template", "prepare_starter_template" in tools(seed_tok))
    check("a tenant administrator's tools do not", "prepare_starter_template" not in tools(ta_tok) and "list_starter_templates" in tools(ta_tok))
    refused, text = call(ta_tok, "prepare_starter_template", {"companyId": A, "action": "create", "documentType": "Challan", "name": "x", "htmlContent": GOOD})
    check("a tenant administrator's prepare is refused", refused, text)
    args = {"companyId": A, "action": "create", "documentType": "Challan", "name": f"MCP {RUN}", "htmlContent": GOOD, "idempotencyKey": f"sst-{RUN}"}
    refused, text = call(seed_tok, "prepare_starter_template", args)
    check("seed admin prepares a starter", not refused, text)
    plan = json.loads(text) if not refused else {}
    refused2, text2 = call(seed_tok, "prepare_starter_template", args)
    check("the same idempotency key returns the same plan", not refused2 and json.loads(text2).get("planId") == plan.get("planId"), text2)
    n1 = len(http("GET", "/api/starter-templates?includeInactive=true", admin)[1])
    check("prepare saves nothing", all(x["name"] != f"MCP {RUN}" for x in http("GET", "/api/starter-templates?includeInactive=true", admin)[1]))
    refused, text = call(seed_tok, "commit_action", {"planId": plan.get("planId", "")})
    check("commit adds it", not refused and "StarterTemplate:" in text, text)
    rows = http("GET", "/api/starter-templates?includeInactive=true", admin)[1]
    mcp_row = next((x for x in rows if x["name"] == f"MCP {RUN}"), None)
    check("exactly one starter from the plan", mcp_row is not None and len(rows) == n1 + 1, len(rows))
    if mcp_row:
        made_starters.append(mcp_row["id"])
        refused, text = call(ta_tok, "list_starter_templates", {"documentType": "Challan"})
        check("list_starter_templates shows it to a tenant administrator", not refused and f"MCP {RUN}" in text, text[:200])
        refused, text = call(seed_tok, "prepare_starter_template", {"companyId": A, "action": "update", "starterId": mcp_row["id"], "revision": mcp_row["revision"], "name": f"MCP2 {RUN}"})
        upd = json.loads(text) if not refused else {}
        http("PUT", f"/api/starter-templates/{mcp_row['id']}", admin, body(revision=mcp_row["revision"], name=f"Moved {RUN}"))
        refused, text = call(seed_tok, "commit_action", {"planId": upd.get("planId", "")})
        check("a plan made from a revision that changed is refused at commit", refused and "changed" in text.lower(), text)
        refused, text = call(seed_tok, "prepare_starter_template", {"companyId": A, "action": "create", "documentType": "Challan", "name": "bad", "htmlContent": GOOD.replace("</body>", "<script>x</script></body>")})
        check("MCP refuses active content at prepare", refused and "Active content" in text, text)
        refused, text = call(seed_tok, "prepare_starter_template", {"companyId": A, "action": "create", "documentType": "Bill", "name": "bad", "htmlContent": GOOD})
        check("MCP refuses the retired Bill type, naming TaxInvoice", refused and "TaxInvoice" in text, text)

    print("\n=== Audit ===")
    rows = sql(f"SELECT COUNT(*) FROM AuditLogs WHERE ExceptionType LIKE 'STARTER_TEMPLATE_%' AND CompanyId IS NULL AND Message LIKE '%{RUN}%'")
    check("each write left an audit row with no company", int(rows[0]) >= 4, rows)
finally:
    for owner, tid in made_tokens:
        http("POST", f"/api/mcp/me/tokens/{tid}/revoke", owner)
    for uid, before in seed_restore:
        restore_catalog(uid, before)
    for sid in made_starters:
        cur = next((x for x in http("GET", "/api/starter-templates?includeInactive=true", admin)[1] if x["id"] == sid), None)
        if cur:
            http("DELETE", f"/api/starter-templates/{sid}?revision={cur['revision']}", admin)
    for uid in made_users:
        http("DELETE", f"/api/users/{uid}", admin)
    for rid in made_roles:
        http("DELETE", f"/api/roles/{rid}", admin)

if seed_restore:
    after = http("GET", f"/api/mcp/catalog/{seed_restore[0][0]}", admin)[1]
    check("the seed admin's MCP settings are back as they were", after["accessGranted"] == seed_restore[0][1]["accessGranted"]
          and after["writesGranted"] == seed_restore[0][1]["writesGranted"], after.get("accessGranted"))
left = [x for x in http("GET", "/api/starter-templates?includeInactive=true", admin)[1] if RUN in x["name"]]
check("delete removes every test starter", not left, left)
print(f"\n{sum(results)}/{len(results)} shared starter checks passed")
sys.exit(0 if all(results) else 1)
