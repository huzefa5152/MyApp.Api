"""Local-only MCP print reads: screen equivalence, token/company/permission boundaries.

Needs two local companies with ordinary bills. Reads existing documents; creates only
its own temporary users, roles, tokens and print templates. Missing document-type
fixtures are reported explicitly. No production host can be supplied.
"""
from __future__ import annotations

import argparse
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
made_users, made_roles, made_tokens, made_templates = [], [], [], []
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
    status, role = http("POST", "/api/roles", tenant_admin, {"name": role_name, "description": "Temporary MCP permission probe", "permissionKeys": ["mcp.access.use", "clients.manage.view", "printtemplates.manage.view", "challans.print.view"]})
    require(status, (200, 201), "permission fixture")
    made_roles.append(role["id"])
    limited = token(user([role["id"]], A, "limited", creator=tenant_admin), [A])
    require(http("PUT", f"/api/roles/{role['id']}", tenant_admin, {"name": role_name, "description": "Temporary MCP permission probe", "permissionKeys": ["mcp.access.use", "clients.manage.view"]})[0], (200,), "revoke fixture print permissions")
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
    print("Uncovered fixture types: " + (", ".join(missing) if missing else "none"))
    if args.require_all_types:
        check("all twelve document-type fixtures exercised", not missing)
finally:
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
