"""Local-only MCP print reads: screen equivalence, token/company/permission boundaries.

Needs two local companies with ordinary bills. Reads existing documents; creates only
its own temporary users, roles, tokens and print templates. Missing document-type
fixtures are reported explicitly. No production host can be supplied.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--base", default=os.environ.get("MYAPP_BASE", "http://localhost:5134"))
parser.add_argument("--sql-server", default=r".\MSSQLSERVER02")
parser.add_argument("--sql-db", default="MyApp_Trader_Local")
parser.add_argument("--company-a", type=int)
parser.add_argument("--company-b", type=int)
parser.add_argument("--require-all-types", action="store_true")
args = parser.parse_args()
BASE = args.base.rstrip("/")
url = urllib.parse.urlparse(BASE)
if url.hostname not in {"localhost", "127.0.0.1", "::1"} or url.scheme not in {"http", "https"}:
    raise SystemExit("Refused: this fixture-writing suite is local-only.")
if args.sql_server.lower().split("\\")[0] not in {".", "(local)", "localhost", "127.0.0.1"}:
    raise SystemExit("Refused: SQL fixture discovery must use a local instance.")
if not args.sql_db.endswith("_Local"):
    raise SystemExit("Refused: SQL database must be explicitly local.")
if bool(args.company_a) != bool(args.company_b) or (args.company_a and (args.company_a <= 0 or args.company_b <= 0 or args.company_a == args.company_b)):
    raise SystemExit("Supply two distinct positive fixture company IDs together.")
RUN = secrets.token_hex(4)
PASSWORD = "PrintTest-" + secrets.token_hex(8)
checks = []
made_users, made_roles, made_tokens, made_templates, made_stamps = [], [], [], [], []
rpc_id = 0


def http(method, path, token=None, body=None):
    headers = {"Authorization": "Bearer " + token} if token else {}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            text = response.read().decode()
            return response.status, json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        try:
            return error.code, json.loads(text)
        except json.JSONDecodeError:
            return error.code, text


def require(status, expected, label):
    assert status in expected, f"{label}: HTTP {status}"


def check(label, ok, detail=None):
    checks.append((label, bool(ok)))
    print(("PASS " if ok else "FAIL ") + label + (f": {detail}" if not ok and detail is not None else ""))


def login(username, password):
    status, result = http("POST", "/api/auth/login", body={"username": username, "password": password})
    require(status, (200,), "login")
    return result["token"]


def mcp(token, method, params=None):
    global rpc_id
    rpc_id += 1
    return http("POST", "/mcp", token, {"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params or {}})


def tool(token, name, arguments):
    status, result = mcp(token, "tools/call", {"name": name, "arguments": arguments})
    if status != 200 or "error" in result:
        return True, result.get("error", {}).get("message", f"HTTP {status}") if isinstance(result, dict) else f"HTTP {status}"
    result = result["result"]
    return (True, result["content"][0]["text"]) if result.get("isError") else (False, json.loads(result["content"][0]["text"]))


def sql(query):
    result = subprocess.run(["sqlcmd", "-S", args.sql_server, "-d", args.sql_db, "-E", "-C", "-N", "-I", "-b", "-h", "-1", "-W", "-Q", "SET NOCOUNT ON; " + query], capture_output=True, text=True)
    assert result.returncode == 0, "Local fixture discovery failed."
    return result.stdout.strip()


def token(owner, company_ids=None, all_companies=False, scopes=("read", "templates.read", "documents.read")):
    status, result = http("POST", "/api/mcp/me/tokens", owner, {"name": "print-test-" + RUN, "companyIds": company_ids or [], "allCompanies": all_companies, "scopes": list(scopes), "expiresInDays": 1})
    require(status, (200,), "create token")
    made_tokens.append(result["id"])
    return result["secret"]


def user(role_ids, company_id, suffix, creator=None, role_string="User"):
    creator = creator or admin
    name = "mcpp_" + RUN + suffix
    status, result = http("POST", "/api/users", creator, {"username": name, "password": PASSWORD, "fullName": "Print test", "role": role_string})
    require(status, (200, 201), "create fixture user")
    uid = result["id"]
    made_users.append(uid)
    require(http("PUT", f"/api/users/{uid}/roles", creator, {"roleIds": role_ids})[0], (200,), "assign fixture roles")
    require(http("PUT", f"/api/usercompanies/user/{uid}", creator, {"companyIds": [company_id]})[0], (200,), "assign fixture company")
    return login(name, PASSWORD)


def bundle(credential, arguments):
    """Read every chunk of a render bundle; returns (error, parsed bundle or message)."""
    text, sha, offset = "", None, 0
    while offset is not None:
        error, chunk = tool(credential, "get_document_render_bundle", {**arguments, "offset": offset, "length": 4000})
        if error:
            return True, chunk
        if sha not in (None, chunk["sha256"]):
            return True, "sha changed between chunks"
        sha, offset = chunk["sha256"], chunk["nextOffset"]
        text += chunk["content"]
    if hashlib.sha256(text.encode()).hexdigest() != sha:
        return True, "sha mismatch"
    return False, json.loads(text)


def upload_stamp(company_id):
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    boundary = "----printtest" + RUN
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\nPrint test {RUN}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"sig.png\"\r\nContent-Type: image/png\r\n\r\n").encode() \
        + png + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(f"{BASE}/api/companies/{company_id}/stamps", data=body, method="POST",
                                     headers={"Authorization": "Bearer " + admin, "Content-Type": "multipart/form-data; boundary=" + boundary})
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.loads(response.read().decode())
    made_stamps.append((company_id, result["id"]))
    return result


admin = login("admin", "admin123")
try:
    company_filter = f" AND CompanyId IN ({args.company_a},{args.company_b})" if args.company_a else ""
    candidates = sql("SELECT CompanyId, MIN(Id) FROM Invoices WHERE NoteKind=0" + company_filter + " GROUP BY CompanyId ORDER BY CompanyId")
    rows = [list(map(int, line.split())) for line in candidates.splitlines() if line.strip()]
    assert len(rows) >= 2, "Need two local companies with ordinary invoices."
    if args.company_a:
        invoices = dict(rows)
        A, B = args.company_a, args.company_b
        invoice_a, invoice_b = invoices[A], invoices[B]
    else:
        (A, invoice_a), (B, invoice_b) = rows[:2]
    status, roles = http("GET", "/api/roles", admin)
    require(status, (200,), "roles")
    role_ids = {role["name"]: role["id"] for role in roles if role.get("isSystemRole")}
    owner = user([role_ids["Sales Edition"], role_ids["MCP Access"]], A, "tenant")
    tenant = token(owner, [A])
    seed_restricted = token(admin, [A])
    seed_all = token(admin, all_companies=True)
    no_scope = token(owner, [A], scopes=("read",))
    tenant_admin = user([role_ids["Sales Edition"], role_ids["MCP Access"], role_ids["Tenant Administrator"]], A, "manager", role_string="Administrator")
    role_name = "print-test-" + RUN
    # Only the seed admin may put mcp.* keys in a role (RolesController.GrantableKeysAsync), so the
    # tenant administrator's probe role carries the business keys and MCP Access comes as its own role.
    status, role = http("POST", "/api/roles", tenant_admin, {"name": role_name, "description": "Temporary MCP permission probe", "permissionKeys": ["clients.manage.view", "printtemplates.manage.view", "challans.print.view"]})
    require(status, (200, 201), "permission fixture")
    made_roles.append(role["id"])
    limited_login = user([role["id"]], A, "limited", creator=tenant_admin)
    limited_id = int(sql(f"SELECT Id FROM Users WHERE Username='mcpp_{RUN}limited'"))
    require(http("PUT", f"/api/users/{limited_id}/roles", admin, {"roleIds": [role["id"], role_ids["MCP Access"]]})[0], (200,), "seed admin adds MCP Access")
    limited = token(limited_login, [A])
    require(http("PUT", f"/api/roles/{role['id']}", tenant_admin, {"name": role_name, "description": "Temporary MCP permission probe", "permissionKeys": ["clients.manage.view"]})[0], (200,), "revoke fixture print permissions")
    query = {"companyId": A, "documentType": "Bill", "documentId": invoice_a}
    for label, credential, probe, expect_error in (
        ("tenant own print", tenant, query, False),
        ("tenant foreign company", tenant, {**query, "companyId": B, "documentId": invoice_b}, True),
        ("foreign ID inside allowed company", tenant, {**query, "documentId": invoice_b}, True),
        ("restricted seed foreign company", seed_restricted, {**query, "companyId": B, "documentId": invoice_b}, True),
        ("All seed foreign company", seed_all, {**query, "companyId": B, "documentId": invoice_b}, False),
        ("missing document scope", no_scope, query, True),
        ("missing print permission", limited, query, True),
        ("wrong note kind", tenant, {**query, "documentType": "CreditNote"}, True),
        ("negative offset", tenant, {**query, "section": "items", "offset": -1}, True),
        ("invalid section", tenant, {**query, "section": "everything"}, True),
        ("unknown argument", tenant, {**query, "extra": True}, True),
    ):
        error, result = tool(credential, "get_document_print_data", probe)
        check(label, error == expect_error, result)
    for credential, expected in ((tenant, True), (no_scope, False), (limited, False)):
        status, catalogue = mcp(credential, "tools/list")
        names = {entry["name"] for entry in catalogue.get("result", {}).get("tools", [])}
        check("document tool discovery respects access", status == 200 and ("get_document_print_data" in names) == expected)

    fixtures = {
        "Bill": ("Invoices", "NoteKind=0", "/api/invoices/{id}/print/bill"),
        "TaxInvoice": ("Invoices", "NoteKind=0", "/api/invoices/{id}/print/tax-invoice"),
        "DebitNote": ("Invoices", "NoteKind=1", "/api/invoices/{id}/print/tax-invoice"),
        "CreditNote": ("Invoices", "NoteKind=2", "/api/invoices/{id}/print/tax-invoice"),
        "Challan": ("DeliveryChallans", "1=1", "/api/deliverychallans/{id}/print"),
        "SalesQuote": ("SalesQuotes", "1=1", "/api/salesquotes/{id}/print"),
        "SalesOrder": ("SalesOrders", "1=1", "/api/salesorders/{id}/print"),
        "PurchaseBill": ("PurchaseBills", "1=1", "/api/purchasebills/{id}/print"),
        "GoodsReceipt": ("GoodsReceipts", "1=1", "/api/goodsreceipts/{id}/print"),
        "Receipt": ("Payments", "Direction=0", "/api/payments/receipts/{id}/print"),
        "Payment": ("Payments", "Direction=1", "/api/payments/payments/{id}/print"),
        "WithholdingTaxReceipt": ("WithholdingTaxReceipts", "1=1", "/api/withholdingtaxreceipts/{id}/print"),
    }
    missing = []
    for kind, (table, where, path) in fixtures.items():
        fixture_scope = f" AND CompanyId={A}" if args.company_a else ""
        fixture = sql(f"SELECT TOP 1 CompanyId, Id FROM {table} WHERE {where}{fixture_scope} ORDER BY Id")
        if not fixture:
            missing.append(kind)
            continue
        cid, did = map(int, fixture.split())
        status, rest = http("GET", path.format(id=did), admin)
        require(status, (200,), kind + " screen print")
        query = {"companyId": cid, "documentType": kind, "documentId": did}
        error, result = tool(seed_all, "get_document_print_data", query)
        scalar = {key: value for key, value in rest.items() if not isinstance(value, list) and not (isinstance(value, str) and value.lower().startswith("data:"))}
        check(kind + " header equals screen projection", not error and result["data"] == scalar)
        check(kind + " header omits inline image bytes", not error and "data:image" not in json.dumps(result))
        for key, values in rest.items():
            if not isinstance(values, list):
                continue
            error, page = tool(seed_all, "get_document_print_data", {**query, "section": key, "limit": 1})
            check(kind + " " + key + " equals screen page", not error and page["items"] == values[:1] and page["totalCount"] == len(values))
            error, page = tool(seed_all, "get_document_print_data", {**query, "section": key, "limit": 999999, "offset": 1})
            check(kind + " " + key + " capped and paged", not error and page["limit"] == 100 and page["items"] == values[1:101])
        if kind in {"Receipt", "Payment"}:
            wrong = "Payment" if kind == "Receipt" else "Receipt"
            check(kind + " wrong direction refused", tool(seed_all, "get_document_print_data", {**query, "documentType": wrong})[0])

    html = "<html><body><h1>Print test</h1><p>{{companyBrandName}}</p></body></html>" + " " * 17000
    for cid in (A, B):
        status, template = http("POST", f"/api/printtemplates/company/{cid}", admin, {"name": "Print test " + RUN, "templateType": "Challan", "htmlContent": html, "editorMode": "code", "isDefault": False})
        require(status, (200,), "template fixture")
        made_templates.append((cid, template["id"]))
    tid, foreign_tid = made_templates[0][1], made_templates[1][1]
    error, listing = tool(tenant, "list_print_templates", {"companyId": A, "limit": 1})
    check("template listing bounded metadata", not error and len(listing["items"]) <= 1 and "htmlContent" not in json.dumps(listing))
    error, metadata = tool(tenant, "get_print_template", {"companyId": A, "templateId": tid})
    check("template metadata has revision", not error and len(metadata["revision"]) == 64)
    error, chunk = tool(tenant, "get_print_template", {"companyId": A, "templateId": tid, "section": "html"})
    check("template body chunk bounded", not error and chunk["content"] == html[:16000] and chunk["nextOffset"] == 16000)
    error, tail = tool(tenant, "get_print_template", {"companyId": A, "templateId": tid, "section": "html", "offset": 16000})
    check("template chunks reconstruct original", not error and chunk["content"] + tail["content"] == html and tail["nextOffset"] is None)
    for credential in (tenant, seed_restricted):
        check("foreign template ID refused", tool(credential, "get_print_template", {"companyId": A, "templateId": foreign_tid})[0])
        check("foreign template company refused", tool(credential, "list_print_templates", {"companyId": B})[0])
    check("All seed lists other company templates", not tool(seed_all, "list_print_templates", {"companyId": B})[0])
    check("template scope required", tool(no_scope, "get_print_template", {"companyId": A, "templateId": tid})[0])
    check("template permission required", tool(limited, "list_print_templates", {"companyId": A})[0])
    error, contract = tool(tenant, "get_print_contract", {"documentType": "Challan"})
    status, fields = http("GET", "/api/mergefields/Challan", admin)
    check("print contract uses editor catalog", not error and status == 200 and {field["expression"] for field in contract["fields"]} == {field["fieldExpression"] for field in fields})
    check("print contract identifies real helpers", not error and {"richText", "fmtQty", "each"} <= set(contract["helpers"]))
    check("unknown print type refused", tool(tenant, "get_print_contract", {"documentType": "Unknown"})[0])

    # Render bundle: the same document, template and permission boundary, with images inlined.
    challan_a = sql(f"SELECT TOP 1 Id FROM DeliveryChallans WHERE CompanyId={A} ORDER BY Id")
    challan_b = sql(f"SELECT TOP 1 Id FROM DeliveryChallans WHERE CompanyId={B} ORDER BY Id")
    if challan_a and challan_b:
        challan_a, challan_b = int(challan_a), int(challan_b)
        stamp = upload_stamp(A)
        slotted = ("<html><body><p>{{companyBrandName}} {{challanNumber}}</p>"
                   '<span class="stamp-slot"><img class="stamp-img" src="{{stamp}}"></span></body></html>')
        pinned = "<html><body><p>{{challanNumber}}</p><img src=\"{{stamps." + stamp["slug"] + "}}\"></body></html>"
        ids = {}
        for label, body in (("slotted", slotted), ("pinned", pinned), ("plain", "<html><body><p>{{challanNumber}}</p></body></html>")):
            status, made = http("POST", f"/api/printtemplates/company/{A}", admin, {"name": f"Render {label} {RUN}", "templateType": "Challan", "htmlContent": body, "editorMode": "code", "isDefault": False})
            require(status, (200,), "render template fixture")
            made_templates.append((A, made["id"]))
            ids[label] = made["id"]
        require(http("PUT", f"/api/printtemplates/{ids['slotted']}/stamp", admin, {"stampId": stamp["id"]})[0], (200,), "assign stamp")
        status, screen = http("GET", f"/api/deliverychallans/{challan_a}/print", admin)
        require(status, (200,), "challan screen print")
        own = {"companyId": A, "documentType": "Challan", "documentId": challan_a}

        error, b = bundle(tenant, {**own, "templateId": ids["slotted"]})
        check("render bundle reconstructs from chunks", not error, b)
        scalar = lambda d: {k: v for k, v in d.items() if not (isinstance(v, str) and (v.startswith("data:") or v.startswith("/data/")))}
        check("render data equals screen print data", not error and scalar(b["data"]) == scalar(screen))
        check("render keeps the chosen template html", not error and b["html"] == slotted and b["template"]["id"] == ids["slotted"])
        check("assigned stamp inlined as image", not error and b["signed"] and str(b["stamp"]).startswith("data:image/png;base64,"))
        error, b = bundle(tenant, {**own, "templateId": ids["slotted"], "signed": False})
        check("unsigned drops the stamp", not error and b["stamp"] is None and not b["signed"])
        error, b = bundle(tenant, {**own, "templateId": ids["pinned"], "signed": False})
        check("unsigned strips pinned signature images", not error and "{{stamps." not in b["html"] and b["stamps"] == {})
        error, b = bundle(tenant, {**own, "templateId": ids["pinned"], "signed": True})
        check("pinned signature inlined", not error and b["stamps"].get(stamp["slug"], "").startswith("data:image/"))
        error, message = bundle(tenant, {**own, "templateId": ids["plain"], "signed": True})
        check("signed refused on a template without signature, naming signed ones", error and f"#{ids['slotted']}" in str(message), message)
        error, b = bundle(tenant, own)
        check("auto template is the default or oldest", not error and b["template"]["id"] == min(t for c, t in made_templates if c == A) or (not error and b["template"]["isDefault"]))

        for label, credential, probe in (
            ("render foreign company", tenant, {**own, "companyId": B, "documentId": challan_b}),
            ("render foreign document ID in own company", tenant, {**own, "documentId": challan_b}),
            ("render foreign template ID", tenant, {**own, "templateId": foreign_tid}),
            ("render template of another type", tenant, {**own, "documentType": "Bill", "documentId": invoice_a, "templateId": ids["plain"]}),
            ("render restricted seed foreign company", seed_restricted, {**own, "companyId": B, "documentId": challan_b}),
            ("render missing document scope", no_scope, own),
            ("render missing print permission", limited, own),
            ("render unknown argument", tenant, {**own, "extra": 1}),
        ):
            error, message = tool(credential, "get_document_render_bundle", probe)
            check(label + " refused", error, message)
        check("render All seed reaches another company", not bundle(seed_all, {**own, "companyId": B, "documentId": challan_b, "templateId": foreign_tid})[0])

        # The render tool follows the print-data grant: on by default, off when that grant is removed.
        owner_id = int(sql(f"SELECT Id FROM Users WHERE Username='mcpp_{RUN}tenant'"))
        names = lambda t: {e["name"] for e in mcp(t, "tools/list")[1].get("result", {}).get("tools", [])}
        check("render tool on by default with print data", {"get_document_print_data", "get_document_render_bundle"} <= names(tenant))
        status, policy = http("GET", f"/api/mcp/catalog/{owner_id}", admin)
        require(status, (200,), "catalog read")
        keep = [t["name"] for t in policy["tools"] if t["configurable"] and t["granted"] and t["name"] != "get_document_print_data"]
        require(http("PUT", f"/api/mcp/catalog/{owner_id}", admin, {"revision": policy["revision"], "accessGranted": policy["accessGranted"],
            "writesGranted": policy["writesGranted"], "accessEnabled": policy["accessEnabled"], "writesEnabled": policy["writesEnabled"],
            "grantedTools": keep, "selectedTools": keep})[0], (200,), "catalog save")
        listed = names(tenant)
        check("removing print data also removes render", "get_document_print_data" not in listed and "get_document_render_bundle" not in listed)
        check("render call refused once print data is removed", tool(tenant, "get_document_render_bundle", own)[0])
    else:
        print("Render bundle cases skipped: need a challan in both companies.")
    print("Uncovered fixture types: " + (", ".join(missing) if missing else "none"))
    if args.require_all_types:
        check("all twelve document-type fixtures exercised", not missing)
finally:
    for cid, sid in made_stamps:
        http("DELETE", f"/api/companies/{cid}/stamps/{sid}", admin)
    for _, tid in made_templates:
        http("DELETE", f"/api/printtemplates/{tid}", admin)
    for tid in made_tokens:
        http("POST", f"/api/mcp-admin/tokens/{tid}/revoke", admin)
    for uid in reversed(made_users):
        http("DELETE", f"/api/users/{uid}", admin)
    for rid in made_roles:
        http("DELETE", f"/api/roles/{rid}", admin)

failed = [label for label, ok in checks if not ok]
print(f"{len(checks) - len(failed)}/{len(checks)} checks passed")
sys.exit(1 if failed else 0)
