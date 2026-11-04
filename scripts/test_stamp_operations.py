"""
Company stamps: replacing an image without touching templates, and every stamp action over MCP.

Replacing a stamp's image keeps its id, merge field and every template's assignment, so a new
signature reaches all templates with none edited. The Stamps tab and MCP share ICompanyStampService.

Proves, over HTTP and MCP: the new image is what the stamp's URL serves; a rejected upload leaves the
old image; add, replace, rename, set default, delete and assign work and save nothing before commit;
a stale revision is refused; the image never comes back in a plan or lands in the activity log; only
a stamp upload may exceed the ordinary MCP body limit; a user without the permission is refused; and
another company's stamp or template is unreachable by id, at prepare and at commit, including after
the user loses the company. LOCAL only. Creates throwaway companies, users and stamps, and removes them.

    python scripts/test_stamp_operations.py --base http://localhost:5135
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import secrets
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
import zlib
from urllib.parse import urlparse

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5135")
ap.add_argument("--sql-server", default=r".\MSSQLSERVER02")
ap.add_argument("--sql-db", default="MyApp_Trader_Local")
ARGS = ap.parse_args()
BASE = ARGS.base.rstrip("/")
if (urlparse(BASE).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
    raise SystemExit("Local only: this suite creates companies, users and stamps.")
RUN = secrets.token_hex(3)
PW = "Stamp-" + secrets.token_hex(6)
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {str(detail)[:400]}"))


def raw_http(method, path, token=None, data=None, ctype=None):
    hdrs = {}
    if ctype:
        hdrs["Content-Type"] = ctype
    if token:
        hdrs["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read() if e.fp else b""


def http(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    status, raw = raw_http(method, path, token, data, "application/json" if data else None)
    text = raw.decode(errors="replace")
    try:
        return status, json.loads(text) if text and text[0] in "{[" else text
    except ValueError:
        return status, text


def login(user, pw):
    for _ in range(3):
        s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
        if s != 429:
            break
        time.sleep(62)
    assert s == 200, f"login {user}: {s} {d}"
    return d["token"]


def png(rgb, pad=0):
    """A real PNG (the validator sniffs magic bytes); pad grows it to test the size limits."""
    raw = b"".join(b"\x00" + bytes(rgb) * 8 for _ in range(8))

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    filler = chunk(b"tEXt", b"x\x00" + b"y" * pad) if pad else b""
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)) + filler
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffd9")
RED, BLUE, GREEN, WHITE = png((200, 0, 0)), png((0, 0, 200)), png((0, 200, 0)), png((250, 250, 250))


def form(method, path, token, file_name, content, fields=None):
    boundary = "----stamp" + uuid.uuid4().hex
    buf = io.BytesIO()
    for k, v in (fields or {}).items():
        buf.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    buf.write((f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\n'
               "Content-Type: application/octet-stream\r\n\r\n").encode())
    buf.write(content + b"\r\n" + f"--{boundary}--\r\n".encode())
    status, raw = raw_http(method, path, token, buf.getvalue(), "multipart/form-data; boundary=" + boundary)
    try:
        return status, json.loads(raw.decode())
    except ValueError:
        return status, raw


def image_at(url, token):
    return raw_http("GET", url, token)


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


def sql(query):
    out = subprocess.run(["sqlcmd", "-S", ARGS.sql_server, "-d", ARGS.sql_db, "-E", "-C", "-N", "-I", "-b",
                          "-h", "-1", "-W", "-Q", "SET NOCOUNT ON; " + query], capture_output=True, text=True)
    assert out.returncode == 0, out.stdout + out.stderr
    return out.stdout.strip()


print(f"Stamp operations against {BASE}  (run {RUN})")
admin = login("admin", "admin123")
companies, users, roles = [], [], []


def company(suffix):
    s, c = http("POST", "/api/companies", admin, {"name": f"[TEMP] Stamps {RUN} {suffix}"})
    assert s in (200, 201), (s, c)
    companies.append(c["id"])
    return c["id"]


def make_user(name, role_ids, cids, writes):
    s, u = http("POST", "/api/users", admin, {"username": f"st_{RUN}_{name}", "password": PW, "fullName": name, "role": "User"})
    assert s in (200, 201), (s, u)
    users.append(u["id"])
    # A custom role reaches a user as a copy scoped to them, as on the Roles screen.
    assigned = []
    for rid in role_ids:
        if rid in roles:
            s, copies = http("POST", f"/api/roles/{rid}/copy", admin, {"tenantAdminUserIds": [u["id"]]})
            assert s == 200 and copies, (s, copies)
            roles.append(copies[0]["id"])
            rid = copies[0]["id"]
        assigned.append(rid)
    s, r = http("PUT", f"/api/users/{u['id']}/roles", admin, {"roleIds": assigned})
    assert s == 200, (s, r)
    assert http("PUT", f"/api/usercompanies/user/{u['id']}", admin, {"companyIds": cids})[0] == 200
    s, catalog = http("GET", f"/api/mcp/catalog/{u['id']}", admin)
    assert s == 200, (s, catalog)
    tools = [t["name"] for t in catalog["tools"] if t["configurable"] and t["eligible"] and (writes or not t["write"])]
    s, r = http("PUT", f"/api/mcp/catalog/{u['id']}", admin, {
        "revision": catalog["revision"], "accessGranted": True, "accessEnabled": True,
        "writesGranted": writes, "writesEnabled": writes, "grantedTools": tools, "selectedTools": tools})
    assert s == 200, (s, r)
    return u["id"], login(f"st_{RUN}_{name}", PW)


def agent(owner, cids, scopes):
    s, d = http("POST", "/api/mcp/me/tokens", owner, {"name": "stamps", "companyIds": cids, "scopes": scopes, "expiresInDays": 5})
    assert s == 200, (s, d)
    return d["secret"]


def role_named(name, keys):
    s, r = http("POST", "/api/roles", admin, {"name": f"st-{RUN}-{name}", "description": "temp", "permissionKeys": keys})
    assert s in (200, 201), (s, r)
    roles.append(r["id"])
    return r["id"]


exit_code = 1
try:
    A, B = company("A"), company("B")
    sysr = {r["name"]: r["id"] for r in http("GET", "/api/roles", admin)[1] if r.get("isSystemRole")}
    MCPA, MCPW = sysr["MCP Access"], sysr["MCP Write"]
    FULL = ["printtemplates.manage.view", "printtemplates.manage.update", "printtemplates.stamps.view", "printtemplates.stamps.manage"]
    full = role_named("full", FULL)
    view = role_named("view", ["printtemplates.manage.view", "printtemplates.manage.update", "printtemplates.stamps.view"])

    u_a, tok_a = make_user("a", [full, MCPA, MCPW], [A], True)      # company A's stamp manager
    u_b, tok_b = make_user("b", [full, MCPA, MCPW], [B], True)      # company B's stamp manager
    u_v, tok_v = make_user("v", [view, MCPA, MCPW], [A], True)      # company A, may look but not manage

    print("\n== the Stamps tab: replace keeps the merge field and the templates ==")
    s, st = form("POST", f"/api/companies/{A}/stamps", tok_a, "sign.png", RED, {"name": f"Director {RUN}"})
    assert s == 200, (s, st)
    s, tpl = http("POST", f"/api/printtemplates/company/{A}", tok_a, {"templateType": "Challan", "name": f"T {RUN}", "htmlContent": "<p>{{stamp}}</p>", "stampId": st["id"]})
    assert s == 200, (s, tpl)
    check("the upload serves the first image", image_at(st["url"], tok_a)[1] == RED)

    s, rep = form("PUT", f"/api/companies/{A}/stamps/{st['id']}/image", tok_a, "new.png", BLUE)
    check("replace returns 200", s == 200, (s, rep))
    check("the id, merge field, name and URL stay", (rep["id"], rep["slug"], rep["name"], rep["url"]) == (st["id"], st["slug"], st["name"], st["url"]), rep)
    check("the same URL now serves the new image", image_at(st["url"], tok_a)[1] == BLUE)
    check("UpdatedAt moves, so the thumbnail reloads", rep["updatedAt"] != st["updatedAt"], rep)
    s, row = http("GET", f"/api/printtemplates/{tpl['id']}", tok_a)
    check("the template keeps its stamp, HTML untouched", s == 200 and row["stampId"] == st["id"] and row["htmlContent"] == "<p>{{stamp}}</p>", (s, row))
    s, listed = http("GET", f"/api/companies/{A}/stamps", tok_a)
    check("the list still counts the template as using it", s == 200 and listed[0]["usedByTemplates"] == 1, listed)

    s, bad = form("PUT", f"/api/companies/{A}/stamps/{st['id']}/image", tok_a, "evil.png", b"MZ not an image")
    check("a file that is not an image is refused", s == 400 and bad.get("error"), (s, bad))
    check("...and the current image stays", image_at(st["url"], tok_a)[1] == BLUE)

    s, jpg = form("PUT", f"/api/companies/{A}/stamps/{st['id']}/image", tok_a, "new.jpg", JPEG)
    check("a new file type is accepted, slug unchanged", s == 200 and jpg["slug"] == st["slug"] and jpg["url"].endswith(".jpg"), (s, jpg))
    check("the new URL serves it", image_at(jpg["url"], tok_a)[1] == JPEG)
    check("the old URL stops serving", image_at(st["url"], tok_a)[0] == 404)
    s, back = form("PUT", f"/api/companies/{A}/stamps/{st['id']}/image", tok_a, "new.png", GREEN)
    assert s == 200, (s, back)

    print("\n== the Stamps tab: who may replace ==")
    s, _ = form("PUT", f"/api/companies/{A}/stamps/{st['id']}/image", tok_v, "x.png", WHITE)
    check("a user without stamps.manage is refused", s == 403, s)
    s, _ = form("PUT", f"/api/companies/{A}/stamps/{st['id']}/image", tok_b, "x.png", WHITE)
    check("another company's manager is refused on company A's route", s == 403, s)
    s, _ = form("PUT", f"/api/companies/{B}/stamps/{st['id']}/image", tok_b, "x.png", WHITE)
    check("...and through their own company's route, by company A's stamp id", s == 404, s)
    s, _ = form("PUT", f"/api/companies/{A}/stamps/{st['id']}/image", None, "x.png", WHITE)
    check("no login is refused", s == 401, s)
    check("none of those changed the image", image_at(back["url"], tok_a)[1] == GREEN)
    check("another company's user cannot read the file", image_at(back["url"], tok_b)[0] == 404)
    check("the replace is audited under the company", sql(f"SELECT COUNT(*) FROM AuditLogs WHERE CompanyId = {A} AND ExceptionType = 'COMPANYSTAMP_REPLACE'").strip() != "0")

    print("\n== MCP: catalogue ==")
    t_a = agent(tok_a, [A], ["read", "templates.read", "templates.write"])
    t_ro = agent(tok_a, [A], ["read", "templates.read"])
    t_b = agent(tok_b, [B], ["read", "templates.read", "templates.write"])
    t_v = agent(tok_v, [A], ["read", "templates.read", "templates.write"])
    TOOLS = {"list_company_stamps", "get_company_stamp", "prepare_company_stamp"}
    check("a stamp manager's write token lists all three tools", TOOLS <= names(t_a), sorted(names(t_a)))
    n = names(t_ro)
    check("a read token lists the reads, not the write", "list_company_stamps" in n and "get_company_stamp" in n and "prepare_company_stamp" not in n, sorted(n))

    print("\n== MCP: reads ==")
    bad, d = tool(t_a, "list_company_stamps", {"companyId": A})
    check("list shows the merge field, usage and revision, no image", not bad and d["items"][0]["mergeField"] == "{{stamps.%s}}" % st["slug"] and d["items"][0]["usedByTemplates"] == 1 and len(d["items"][0]["revision"]) == 64 and "image" not in d["items"][0], d)
    check("list hands out the slot markup", not bad and "{{stamp}}" in d["slotMarkup"], d)
    rev = d["items"][0]["revision"]
    bad, d = tool(t_a, "get_company_stamp", {"companyId": A, "stampId": st["id"]})
    check("get returns the image", not bad and base64.b64decode(d["image"].split(",", 1)[1]) == GREEN, d)
    for who, tok, args in [("company B's token on company A", t_b, {"companyId": A, "stampId": st["id"]}),
                           ("company B's token, A's stamp id under B", t_b, {"companyId": B, "stampId": st["id"]})]:
        bad, d = tool(tok, "get_company_stamp", args)
        check(who + " is refused", bad, d)
    bad, d = tool(t_b, "list_company_stamps", {"companyId": A})
    check("company B's token cannot list company A", bad, d)

    print("\n== MCP: replace ==")
    img = base64.b64encode(WHITE).decode()
    args = {"companyId": A, "action": "replace", "stampId": st["id"], "revision": rev, "fileName": "w.png", "imageBase64": img}
    bad, plan = tool(t_a, "prepare_company_stamp", args)
    check("prepare returns a plan", not bad and plan.get("planId"), plan)
    check("the plan does not send the image back", "imageBase64" not in json.dumps(plan), plan)
    check("the plan names the merge field and the templates", plan["details"]["mergeField"] == "{{stamps.%s}}" % st["slug"] and plan["details"]["usedByTemplates"] == 1, plan)
    check("prepare saves nothing", image_at(back["url"], tok_a)[1] == GREEN)
    logged = sql(f"SELECT TOP 1 CAST(Arguments AS varchar(2000)) FROM McpActivities WHERE Tool = 'prepare_company_stamp' AND CompanyId = {A} ORDER BY Id DESC")
    check("the activity log does not keep the image", img not in logged and img[:40] not in logged, logged[:200])
    bad, done = tool(t_a, "commit_action", {"planId": plan["planId"]})
    check("commit succeeds", not bad and done.get("committed"), done)
    check("the merge field's URL now serves the agent's image", image_at(back["url"], tok_a)[1] == WHITE)
    bad, d = tool(t_a, "prepare_company_stamp", args)
    check("the old revision is refused now", bad and "changed" in str(d), d)
    bad, again = tool(t_a, "commit_action", {"planId": plan["planId"]})
    check("a plan commits only once", bad, again)

    print("\n== MCP: gates ==")
    rev = tool(t_a, "list_company_stamps", {"companyId": A})[1]["items"][0]["revision"]
    args = {"companyId": A, "action": "replace", "stampId": st["id"], "revision": rev, "fileName": "w.png", "imageBase64": base64.b64encode(RED).decode()}
    check("a read token cannot prepare", tool(t_ro, "prepare_company_stamp", args)[0])
    check("a user without stamps.manage cannot prepare", tool(t_v, "prepare_company_stamp", args)[0])
    check("company B's token cannot prepare on company A", tool(t_b, "prepare_company_stamp", args)[0])
    check("...nor reach A's stamp through company B", tool(t_b, "prepare_company_stamp", {**args, "companyId": B})[0])
    bad, d = tool(t_a, "prepare_company_stamp", {**args, "imageBase64": base64.b64encode(b"MZ not an image").decode()})
    check("a file that is not an image is refused at prepare", bad, d)
    bad, d = tool(t_a, "prepare_company_stamp", {**args, "fileName": "evil.svg"})
    check("a disallowed file type is refused at prepare", bad, d)

    bad, plan = tool(t_a, "prepare_company_stamp", args)
    assert not bad, plan
    bad, d = tool(t_b, "commit_action", {"planId": plan["planId"]})
    check("another user's token cannot commit the plan", bad, d)
    assert http("PUT", f"/api/usercompanies/user/{u_a}", admin, {"companyIds": [B]})[0] == 200
    tok_a2 = login(f"st_{RUN}_a", PW)
    bad, d = tool(t_a, "commit_action", {"planId": plan["planId"]})
    check("losing the company refuses the commit", bad, d)
    check("...and the image is unchanged", image_at(back["url"], admin)[1] == WHITE)
    assert http("PUT", f"/api/usercompanies/user/{u_a}", admin, {"companyIds": [A]})[0] == 200
    tool(t_a, "cancel_action", {"planId": plan["planId"]})

    print("\n== MCP: image size ==")
    big = png((1, 2, 3), pad=200 * 1024)
    assert len(big) < 256 * 1024
    bad, plan = tool(t_a, "prepare_company_stamp", {**args, "imageBase64": base64.b64encode(big).decode()})
    check("a 200 KB image is accepted past the ordinary 64 KB body limit", not bad and plan.get("planId"), str(plan)[:200])
    if not bad:
        tool(t_a, "cancel_action", {"planId": plan["planId"]})
    bad, d = tool(t_a, "prepare_company_stamp", {**args, "imageBase64": base64.b64encode(png((1, 2, 3), pad=262 * 1024)).decode()})
    check("an image over 256 KB is refused", bad, str(d)[:200])
    s, _ = mcp(t_a, "tools/call", {"name": "list_company_stamps", "arguments": {"companyId": A, "x": "y" * 70000}})
    check("every other tool keeps the ordinary limit", s == 413, s)

    print("\n== MCP: add, rename, default, assign, delete ==")
    bad, plan = tool(t_a, "prepare_company_stamp", {"companyId": A, "action": "add", "name": f"Accountant {RUN}", "fileName": "a.png", "imageBase64": base64.b64encode(BLUE).decode()})
    check("add prepares", not bad, plan)
    count = lambda: len(http("GET", f"/api/companies/{A}/stamps", tok_a)[1])
    check("add saves nothing before commit", count() == 1)
    bad, done = tool(t_a, "commit_action", {"planId": plan["planId"]})
    check("add commits", not bad and done["resultRef"].startswith("CompanyStamp:"), done)
    second = int(done["resultRef"].split(":")[1])
    s, row = http("GET", f"/api/companies/{A}/stamps", tok_a)
    new = next(x for x in row if x["id"] == second)
    check("the added stamp serves its image", image_at(new["url"], tok_a)[1] == BLUE)

    rev2 = lambda i=second: next(x for x in tool(t_a, "list_company_stamps", {"companyId": A})[1]["items"] if x["id"] == i)["revision"]
    bad, plan = tool(t_a, "prepare_company_stamp", {"companyId": A, "action": "rename", "stampId": second, "revision": rev2(), "name": f"Renamed {RUN}"})
    tool(t_a, "commit_action", {"planId": plan["planId"]})
    s, row = http("GET", f"/api/companies/{A}/stamps", tok_a)
    renamed = next(x for x in row if x["id"] == second)
    check("rename changes the name, not the merge field", renamed["name"] == f"Renamed {RUN}" and renamed["slug"] == new["slug"], renamed)

    bad, plan = tool(t_a, "prepare_company_stamp", {"companyId": A, "action": "set_default", "stampId": second, "revision": rev2()})
    tool(t_a, "commit_action", {"planId": plan["planId"]})
    s, row = http("GET", f"/api/companies/{A}/stamps", tok_a)
    check("set_default leaves one default", [x["id"] for x in row if x["isDefault"]] == [second], row)

    trev = lambda: next(x for x in tool(t_a, "list_print_templates", {"companyId": A})[1]["items"] if x["id"] == tpl["id"])["revision"]
    bad, plan = tool(t_a, "prepare_company_stamp", {"companyId": A, "action": "assign_template", "templateId": tpl["id"], "revision": trev(), "stampId": second})
    check("assign prepares", not bad, plan)
    tool(t_a, "commit_action", {"planId": plan["planId"]})
    check("assign changes the template's stamp", http("GET", f"/api/printtemplates/{tpl['id']}", tok_a)[1]["stampId"] == second)
    bad, plan = tool(t_a, "prepare_company_stamp", {"companyId": A, "action": "assign_template", "templateId": tpl["id"], "revision": trev()})
    tool(t_a, "commit_action", {"planId": plan["planId"]})
    check("assign with no stamp removes it", http("GET", f"/api/printtemplates/{tpl['id']}", tok_a)[1]["stampId"] is None)

    s, plain = http("POST", f"/api/printtemplates/company/{A}", tok_a, {"templateType": "Bill", "name": f"Plain {RUN}", "htmlContent": "<p>no signature</p>"})
    assert s == 200, (s, plain)
    prev = lambda: next(x for x in tool(t_a, "list_print_templates", {"companyId": A})[1]["items"] if x["id"] == plain["id"])["revision"]
    bad, d = tool(t_a, "prepare_company_stamp", {"companyId": A, "action": "assign_template", "templateId": plain["id"], "revision": prev(), "stampId": second})
    check("assigning to a template with no slot is refused", bad and "slot" in str(d), d)
    markup = tool(t_a, "list_company_stamps", {"companyId": A})[1]["slotMarkup"]
    bad, plan = tool(t_a, "prepare_company_stamp", {"companyId": A, "action": "assign_template", "templateId": plain["id"], "revision": prev(), "stampId": second, "htmlContent": "<p>signed</p>" + markup + "<script>bad()</script>"})
    check("sending the rewritten HTML adds the slot and assigns", not bad, plan)
    tool(t_a, "commit_action", {"planId": plan["planId"]})
    saved = http("GET", f"/api/printtemplates/{plain['id']}", tok_a)[1]
    check("...the slot is saved, the stamp assigned, script stripped", "{{stamp}}" in saved["htmlContent"] and saved["stampId"] == second and "<script" not in saved["htmlContent"], saved)

    # Another company's records through the assignment path.
    s, st_b = form("POST", f"/api/companies/{B}/stamps", tok_b, "b.png", RED, {"name": f"B {RUN}"})
    assert s == 200, (s, st_b)
    s, tpl_b = http("POST", f"/api/printtemplates/company/{B}", tok_b, {"templateType": "Challan", "name": f"TB {RUN}", "htmlContent": "<p>{{stamp}}</p>"})
    assert s == 200, (s, tpl_b)
    bad, d = tool(t_a, "prepare_company_stamp", {"companyId": A, "action": "assign_template", "templateId": tpl["id"], "revision": trev(), "stampId": st_b["id"]})
    check("another company's stamp cannot be assigned", bad, d)
    bad, d = tool(t_a, "prepare_company_stamp", {"companyId": A, "action": "assign_template", "templateId": tpl_b["id"], "revision": "a" * 64})
    check("another company's template cannot be reached", bad, d)
    bad, d = tool(t_a, "prepare_company_stamp", {"companyId": A, "action": "delete", "stampId": st_b["id"], "revision": "a" * 64})
    check("another company's stamp cannot be deleted", bad, d)
    check("company B's stamp is untouched", image_at(st_b["url"], tok_b)[1] == RED)

    bad, plan = tool(t_a, "prepare_company_stamp", {"companyId": A, "action": "delete", "stampId": second, "revision": rev2()})
    check("the delete plan says what stops being signed", not bad and plan["details"]["usedByTemplates"] == 1, plan)
    tool(t_a, "commit_action", {"planId": plan["planId"]})
    check("delete removes the stamp", all(x["id"] != second for x in http("GET", f"/api/companies/{A}/stamps", tok_a)[1]))
    check("...and stops serving the file", image_at(new["url"], tok_a)[0] == 404)
    check("...and the template survives, unsigned", http("GET", f"/api/printtemplates/{plain['id']}", tok_a)[1]["stampId"] is None)
    check("MCP changes are audited under the company", int(sql(f"SELECT COUNT(*) FROM AuditLogs WHERE CompanyId = {A} AND ExceptionType LIKE 'COMPANYSTAMP[_]%' AND RequestPath = '/mcp'")) >= 6)

    exit_code = 0 if all(results) else 1
finally:
    print("\n== cleanup ==")
    for cid in companies:
        for s_ in (http("GET", f"/api/companies/{cid}/stamps", admin)[1] or []):
            http("DELETE", f"/api/companies/{cid}/stamps/{s_['id']}", admin)
        for t_ in (http("GET", f"/api/printtemplates/company/{cid}", admin)[1] or []):
            http("DELETE", f"/api/printtemplates/{t_['id']}", admin)
    for uid in users:
        http("DELETE", f"/api/users/{uid}", admin)
    for rid in roles:
        http("DELETE", f"/api/roles/{rid}", admin)
    for cid in companies:
        http("DELETE", f"/api/companies/{cid}", admin)

passed = sum(results)
print(f"\n{passed}/{len(results)} stamp operation checks passed")
sys.exit(exit_code)
