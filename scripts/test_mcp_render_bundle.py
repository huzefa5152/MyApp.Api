"""
MCP get_document_render_bundle on the Customize line (2026-10-29, ported from Trader).

One document ready to print with its company's own template: the chunks rebuild to the
advertised sha256, the data equals the screen's print data, the template is the one chosen
(explicit, else default, else oldest), signed / unsigned behave and the company's own stamp is
inlined. Refused: another company's document or template, a token without documents.read. The
tool rides on the get_document_print_data grant.

Needs a LOCAL Customize database with 2+ companies holding challans. Creates a throwaway user,
templates and a stamp, and removes them.
    python scripts/test_mcp_render_bundle.py --base http://localhost:5197 --sql-db MyApp_Customize_Local
"""
from __future__ import annotations

import argparse
import base64
import hashlib
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
ap.add_argument("--sql-db", default="MyApp_Customize_Local")
ARGS = ap.parse_args()
BASE = ARGS.base.rstrip("/")
if (urlparse(BASE).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
    raise SystemExit("Local only: this suite creates users, templates and stamps.")
RUN = secrets.token_hex(3)
PW = "Render-" + secrets.token_hex(6)
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


def call(token, name, args):
    rpc[0] += 1
    s, d = http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": rpc[0], "method": "tools/call", "params": {"name": name, "arguments": args}})
    if s != 200 or not isinstance(d, dict):
        return True, f"http {s}: {d}"
    if "error" in d:
        return True, d["error"]["message"]
    return bool(d["result"].get("isError")), d["result"]["content"][0]["text"]


def tool_names(token):
    rpc[0] += 1
    s, d = http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": rpc[0], "method": "tools/list", "params": {}})
    return {t["name"] for t in d.get("result", {}).get("tools", [])} if s == 200 else set()


def bundle(token, args):
    text, sha, offset = "", None, 0
    while offset is not None:
        refused, raw = call(token, "get_document_render_bundle", {**args, "offset": offset, "length": 4000})
        if refused:
            return True, raw
        chunk = json.loads(raw)
        if sha not in (None, chunk["sha256"]):
            return True, "sha changed between chunks"
        sha, offset = chunk["sha256"], chunk["nextOffset"]
        text += chunk["content"]
    if hashlib.sha256(text.encode()).hexdigest() != sha:
        return True, "sha mismatch"
    return False, json.loads(text)


def upload_stamp(admin, company_id):
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    boundary = "----render" + RUN
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\nRender test {RUN}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"sig.png\"\r\nContent-Type: image/png\r\n\r\n").encode() \
        + png + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{BASE}/api/companies/{company_id}/stamps", data=body, method="POST",
                                 headers={"Authorization": "Bearer " + admin, "Content-Type": "multipart/form-data; boundary=" + boundary})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


admin = login("admin", "admin123")
rows = [list(map(int, r.split())) for r in sql("SELECT TOP 2 CompanyId, MIN(Id) FROM DeliveryChallans GROUP BY CompanyId ORDER BY CompanyId")]
assert len(rows) == 2, "Need two local companies with challans."
(A, challan_a), (B, challan_b) = rows
templates, stamps, uid = [], [], None
try:
    sysr = {r["name"]: r["id"] for r in http("GET", "/api/roles", admin)[1] if r.get("isSystemRole")}
    edition = sysr.get("Complete Edition") or sysr["Sales Edition"]
    s, u = http("POST", "/api/users", admin, {"username": f"render_{RUN}", "password": PW, "fullName": "Render test", "role": "User"})
    assert s in (200, 201), (s, u)
    uid = u["id"]
    assert http("PUT", f"/api/users/{uid}/roles", admin, {"roleIds": [edition]})[0] == 200
    assert http("PUT", f"/api/usercompanies/user/{uid}", admin, {"companyIds": [A]})[0] == 200

    def grant(names):
        s, cat = http("GET", f"/api/mcp/catalog/{uid}", admin)
        assert s == 200, (s, cat)
        s, r = http("PUT", f"/api/mcp/catalog/{uid}", admin, {"revision": cat["revision"], "accessGranted": True, "accessEnabled": True,
                    "writesGranted": False, "writesEnabled": False, "grantedTools": names, "selectedTools": names})
        assert s == 200, (s, r)
        return cat

    cat = grant([])
    eligible = [t["name"] for t in cat["tools"] if t["configurable"] and t["eligible"] and not t.get("write")]
    grant(eligible)
    jwt = login(f"render_{RUN}", PW)
    s, st = http("GET", "/api/mcp/me/status", jwt)
    s, t1 = http("POST", "/api/mcp/me/tokens", jwt, {"name": f"render-{RUN}", "companyIds": [A], "scopes": st["scopesAvailable"], "expiresInDays": 1})
    assert s == 200, (s, t1)
    s, t2 = http("POST", "/api/mcp/me/tokens", jwt, {"name": f"render-nodocs-{RUN}", "companyIds": [A], "scopes": ["read"], "expiresInDays": 1})
    assert s == 200, (s, t2)
    tok, no_docs = t1["secret"], t2["secret"]

    stamp = upload_stamp(admin, A)
    stamps.append((A, stamp["id"]))
    slotted = '<html><body><p>{{challanNumber}}</p><span class="stamp-slot"><img class="stamp-img" src="{{stamp}}"></span></body></html>'
    pinned = '<html><body><p>{{challanNumber}}</p><img src="{{stamps.' + stamp["slug"] + '}}"></body></html>'
    ids = {}
    for label, html, cid in (("slotted", slotted, A), ("pinned", pinned, A), ("plain", "<html><body><p>{{challanNumber}}</p></body></html>", A),
                             ("foreign", "<html><body>{{challanNumber}}</body></html>", B)):
        s, t = http("POST", f"/api/printtemplates/company/{cid}", admin, {"name": f"Render {label} {RUN}", "templateType": "Challan",
                    "htmlContent": html, "editorMode": "code", "isDefault": False})
        assert s in (200, 201), (label, s, t)
        templates.append(t["id"])
        ids[label] = t["id"]
    assert http("PUT", f"/api/printtemplates/{ids['slotted']}/stamp", admin, {"stampId": stamp["id"]})[0] == 200
    s, screen = http("GET", f"/api/deliverychallans/{challan_a}/print", admin)
    assert s == 200, (s, screen)
    own = {"companyId": A, "documentType": "Challan", "documentId": challan_a}

    print("\n=== Render bundle ===")
    err, b = bundle(tok, {**own, "templateId": ids["slotted"]})
    check("chunks rebuild to the advertised sha256", not err, b)
    scalar = lambda d: {k: v for k, v in d.items() if not isinstance(v, (list, dict)) and not (isinstance(v, str) and (v.startswith("data:") or v.startswith("/data/")))}
    check("data equals the screen's print data", not err and scalar(b["data"]) == scalar(screen), "differs")
    check("the chosen template's html", not err and b["html"] == slotted and b["template"]["id"] == ids["slotted"])
    check("the assigned stamp is inlined", not err and b["signed"] and str(b["stamp"]).startswith("data:image/png;base64,"), not err and b.get("stamp"))
    err, b = bundle(tok, {**own, "templateId": ids["slotted"], "signed": False})
    check("unsigned drops the stamp", not err and b["stamp"] is None and not b["signed"])
    err, b = bundle(tok, {**own, "templateId": ids["pinned"], "signed": False})
    check("unsigned strips pinned signature images", not err and "{{stamps." not in b["html"] and b["stamps"] == {})
    err, b = bundle(tok, {**own, "templateId": ids["pinned"], "signed": True})
    check("a pinned signature is inlined", not err and b["stamps"].get(stamp["slug"], "").startswith("data:image/"))
    err, msg = bundle(tok, {**own, "templateId": ids["plain"], "signed": True})
    check("signed refused on a template without one, naming the signed ones", err and f"#{ids['slotted']}" in str(msg), msg)
    err, b = bundle(tok, own)
    check("no templateId: the default, else the oldest", not err and (b["template"]["isDefault"] or b["template"]["id"] <= min(ids["slotted"], ids["pinned"], ids["plain"])), b if err else b["template"])

    print("\n=== Refusals ===")
    for label, token, args in (
        ("another company's document", tok, {**own, "companyId": B, "documentId": challan_b}),
        ("another company's document id in my company", tok, {**own, "documentId": challan_b}),
        ("another company's template", tok, {**own, "templateId": ids["foreign"]}),
        ("a token without documents.read", no_docs, own),
    ):
        refused, text = call(token, "get_document_render_bundle", args)
        check(label + " refused", refused, text)

    print("\n=== Rides on the print-data grant ===")
    listed = tool_names(tok)
    check("on by default with print data", {"get_document_print_data", "get_document_render_bundle"} <= listed, sorted(listed)[:5])
    grant([n for n in eligible if n != "get_document_print_data"])
    listed = tool_names(tok)
    check("removing print data removes render too", "get_document_print_data" not in listed and "get_document_render_bundle" not in listed)
    check("and a render call is refused", call(tok, "get_document_render_bundle", own)[0])
finally:
    for tid in templates:
        http("DELETE", f"/api/printtemplates/{tid}", admin)
    for cid, sid in stamps:
        http("DELETE", f"/api/companies/{cid}/stamps/{sid}", admin)
    if uid:
        http("DELETE", f"/api/users/{uid}", admin)

print(f"\n{sum(results)}/{len(results)} render bundle checks passed")
sys.exit(0 if all(results) else 1)
