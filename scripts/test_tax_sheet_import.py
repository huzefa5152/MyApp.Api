"""Tax Sheet: original lines for companies that print them, Excel columns, and bulk adjust.

Local only; creates and deletes its own companies.

    python scripts/test_tax_sheet_import.py --base http://localhost:5134
"""
import argparse
import io
import json
import sys
import urllib.request
import uuid
from datetime import date
from urllib.parse import urlparse

import openpyxl

from test_basic_flows import http
from test_tenant_leak_sweep import company_payload

p = argparse.ArgumentParser()
p.add_argument("--base", required=True)
a = p.parse_args()
assert urlparse(a.base).hostname in ("localhost", "127.0.0.1")
base = a.base

PASS = FAIL = 0


def check(ok, label, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print("  [PASS]", label)
    else:
        FAIL += 1
        print("  [FAIL]", label, detail)


token = http("POST", "/api/auth/login", base, body={"username": "admin", "password": "admin123"})[1]["token"]


def call(method, path, body=None, expected=(200, 201, 204)):
    s, d = http(method, path, base, token=token, body=body)
    assert s in expected, (method, path, s, d)
    return d


def raw(method, path, data=None, headers=None):
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Authorization": f"Bearer {token}", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def upload(path, blob, name="sheet.xlsx"):
    b = uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
            "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n").encode() \
        + blob + f"\r\n--{b}--\r\n".encode()
    s, d = raw("POST", path, body, {"Content-Type": f"multipart/form-data; boundary={b}"})
    try:
        return s, json.loads(d)
    except Exception:
        return s, d


stamp = uuid.uuid4().hex[:8]
made = []


def make_company(label, original):
    co = call("POST", "/api/companies", {**company_payload(f"[TEMP] {label} {stamp}"), "fbrToken": "synthetic-local-token"})
    if original:
        call("PUT", f"/api/companies/{co['id']}", {**co, "taxInvoiceUseOriginalBillLines": True})
    made.append(co["id"])
    client = call("POST", "/api/clients", {"companyId": co["id"], "name": f"Buyer {label}", "address": "Sample",
                                           "ntn": "1234567", "registrationType": "Registered", "fbrProvinceCode": 8})
    return co, client


def bill(co, client, rows):
    return call("POST", "/api/invoices/standalone", {
        "companyId": co["id"], "clientId": client["id"], "date": date.today().isoformat(), "gstRate": 18,
        "items": [{"description": d, "quantity": q, "unitPrice": pr, "uom": "Numbers, pieces, units"} for d, q, pr in rows]})


def export(co):
    y, m = date.today().year, date.today().month
    s, blob = raw("GET", f"/api/reports/company/{co['id']}/tax-sheet/excel?year={y}&month={m}")
    assert s == 200, s
    return blob


def sheet_rows(blob):
    ws = openpyxl.load_workbook(io.BytesIO(blob)).worksheets[0]
    head = next(r for r in range(1, 30) if ws.cell(r, 3).value == "Inv Number")
    cols = {str(ws.cell(head, c).value): c for c in range(1, 20) if ws.cell(head, c).value}
    return ws, head, cols


try:
    print("--- company that prints original lines")
    on, client_on = make_company("Original", True)
    b1 = bill(on, client_on, [("Wrench 14 inch", 5, 1000), ("Allen key 4mm", 6, 100), ("Allen key 5mm", 6, 120)])
    y, m = date.today().year, date.today().month
    rep = call("GET", f"/api/reports/company/{on['id']}/tax-sheet?year={y}&month={m}")
    check(rep["originalLines"] and rep["rowCount"] == 3, "screen lists every original bill line", rep["rowCount"])
    check(sorted(r["description"] for r in rep["rows"]) == ["Allen key 4mm", "Allen key 5mm", "Wrench 14 inch"], "with each bill description")

    blob = export(on)
    ws, head, cols = sheet_rows(blob)
    for need in ("Real Hscode", "Real Item Description", "Filing Qty (blank = bill qty)", "FBR Unit (only if the HS code has several)", "Invoice Id", "Line Id"):
        check(need in cols, f"excel has column {need}")

    print("--- default company keeps its grouped screen")
    off, client_off = make_company("Grouped", False)
    bill(off, client_off, [("Wrench 14 inch", 5, 1000), ("Allen key 4mm", 6, 100)])
    rep_off = call("GET", f"/api/reports/company/{off['id']}/tax-sheet?year={y}&month={m}")
    check(not rep_off["originalLines"], "off: screen is not per original line")
    check(all(r["lineId"] == 0 for r in rep_off["rows"]), "off: rows are item-type groups")

    print("--- upload: preview then commit")
    # fill: wrench 8204.1100, both allen keys 8204.1200 (-> one combined filing row)
    wb = openpyxl.load_workbook(io.BytesIO(blob)); w = wb.worksheets[0]
    hs_c, line_c = cols["Real Hscode"], cols["Line Id"]
    for r in range(head + 1, w.max_row + 1):
        desc = w.cell(r, cols["Description"]).value
        if desc == "Wrench 14 inch":
            w.cell(r, hs_c).value = "8204.1100"
        elif desc and desc.startswith("Allen key"):
            w.cell(r, hs_c).value = "8204.1200"
    out = io.BytesIO(); wb.save(out)
    s, pre = upload(f"/api/reports/company/{on['id']}/tax-sheet/import/preview", out.getvalue())
    check(s == 200 and pre["invoicesInFile"] == 1, "preview reads the sheet", f"{s} {pre}")
    saved_before = call("GET", f"/api/invoices/{b1['id']}/tax-filing")
    check(not saved_before["hasSavedRows"], "preview saved nothing")
    # the HS codes are new to this company: FBR verification may be unreachable locally
    if pre.get("issues"):
        print("  note: issues from preview ->", [i["message"] for i in pre["issues"]])

    print("--- bad files and tenant scope")
    s, bad = upload(f"/api/reports/company/{on['id']}/tax-sheet/import/preview", b"not a workbook")
    check(s == 200 and bad["issues"], "garbage file is reported, not a crash", f"{s} {bad}")
    s, _ = upload(f"/api/reports/company/{off['id']}/tax-sheet/import/commit", out.getvalue())
    s2 = call("GET", f"/api/invoices/{b1['id']}/tax-filing")
    check(not s2["hasSavedRows"], "a sheet for another company's invoice changes nothing")
    s, res = upload(f"/api/reports/company/{off['id']}/tax-sheet/import/commit", out.getvalue())
    check(s == 200 and res["invoicesReady"] == 0 and res["issues"] and "not found" in res["issues"][0]["message"],
          "foreign invoice ids are 'not found in this company'", f"{s} {res}")
    print("--- commit with HS codes the company already uses")
    for code in ("8204.1100", "8204.1200", "8204.2000"):
        call("POST", f"/api/itemtypes?companyId={on['id']}", {"companyId": on["id"], "name": f"Tool {code} {stamp}",
             "hsCode": code, "uom": "Numbers, pieces, units", "fbrUOMId": 69, "saleType": "Goods at Standard Rate (default)"})
    # 2026-10-31: an original-lines company gives each bill line its own HS code. This sheet put both
    # allen keys on 8204.1200, which used to combine them into one filing row; it is now refused.
    s, pre2 = upload(f"/api/reports/company/{on['id']}/tax-sheet/import/preview", out.getvalue())
    check(s == 200 and pre2["invoicesReady"] == 0 and pre2["issues"]
          and "8204.1200 is already in use on the line" in pre2["issues"][0]["message"],
          "preview: one HS code on two lines of an original-lines company is refused", f"{pre2}")
    s, done = upload(f"/api/reports/company/{on['id']}/tax-sheet/import/commit", out.getvalue())
    check(s == 200 and done["invoicesReady"] == 0 and not call("GET", f"/api/invoices/{b1['id']}/tax-filing")["hasSavedRows"],
          "commit of that sheet saves nothing", f"{done}")
    for r in range(head + 1, w.max_row + 1):
        if w.cell(r, cols["Description"]).value == "Allen key 5mm":
            w.cell(r, hs_c).value = "8204.2000"
    out = io.BytesIO(); wb.save(out)
    s, pre3 = upload(f"/api/reports/company/{on['id']}/tax-sheet/import/preview", out.getvalue())
    check(s == 200 and pre3["invoicesReady"] == 1 and pre3["filingRows"] == 3 and not pre3["issues"],
          "preview: one code per line -> 3 filing rows", f"{pre3}")
    s, done = upload(f"/api/reports/company/{on['id']}/tax-sheet/import/commit", out.getvalue())
    check(s == 200 and done["committed"] and done["invoicesReady"] == 1 and done["invoicesInFile"] == 1,
          "commit reports how many invoices were adjusted", f"{done}")
    ed = call("GET", f"/api/invoices/{b1['id']}/tax-filing")
    check(ed["hasSavedRows"] and len(ed["rows"]) == 3 and all(len(r["sourceLineIds"]) == 1 for r in ed["rows"]),
          "filing rows saved, one per bill line")
    check(sorted(r["description"] for r in ed["rows"]) == ["Allen key 4mm", "Allen key 5mm", "Wrench 14 inch"],
          "each row is filed under its own bill description")


    print("--- stored FBR units: a new HS code resolves with no FBR call")
    # Unit rows are installation-wide (FbrLookups, Category HsUom, Code "<hs>|<uomId>").
    code = "9999.9999"
    existing = call("GET", "/api/FbrLookup/category/HsUom")
    for row in existing:
        if row["code"].startswith(code + "|"):
            call("DELETE", f"/api/FbrLookup/{row['id']}")
    for n, (uid, name) in enumerate([(13, "KG"), (69, "Numbers, pieces, units")]):
        call("POST", "/api/FbrLookup", {"category": "HsUom", "code": f"{code}|{uid}", "label": name, "sortOrder": n, "isActive": True})
    nw, ncl = make_company("NewHs", True)
    b3 = bill(nw, ncl, [("Brand new thing", 3, 100)])
    blob3 = export(nw)
    ws3, head3, cols3 = sheet_rows(blob3)
    wb3 = openpyxl.load_workbook(io.BytesIO(blob3)); w3 = wb3.worksheets[0]
    for r in range(head3 + 1, w3.max_row + 1):
        if w3.cell(r, cols3["Description"]).value == "Brand new thing":
            w3.cell(r, cols3["Real Hscode"]).value = code
            w3.cell(r, cols3["FBR Unit (only if the HS code has several)"]).value = "kg"   # any capitals
    o3 = io.BytesIO(); wb3.save(o3)
    s, pv = upload(f"/api/reports/company/{nw['id']}/tax-sheet/import/preview", o3.getvalue())
    check(s == 200 and not any("not recognised" in i["message"] or "not an FBR unit" in i["message"] for i in pv["issues"]),
          "stored units are used, lower-case 'kg' accepted", f"{pv}")
    # a unit that is not one of the stored ones is refused with the valid list
    for r in range(head3 + 1, w3.max_row + 1):
        if w3.cell(r, cols3["Description"]).value == "Brand new thing":
            w3.cell(r, cols3["FBR Unit (only if the HS code has several)"]).value = "Parsecs"
    o4 = io.BytesIO(); wb3.save(o4)
    s, pv2 = upload(f"/api/reports/company/{nw['id']}/tax-sheet/import/preview", o4.getvalue())
    check(any("Parsecs" in i["message"] and "KG" in i["message"] for i in pv2["issues"]), "an unknown unit lists the valid ones", f"{pv2}")
    # blank unit with several stored units: the first one is used, no error
    for r in range(head3 + 1, w3.max_row + 1):
        if w3.cell(r, cols3["Description"]).value == "Brand new thing":
            w3.cell(r, cols3["FBR Unit (only if the HS code has several)"]).value = None
    o5 = io.BytesIO(); wb3.save(o5)
    s, pv3 = upload(f"/api/reports/company/{nw['id']}/tax-sheet/import/preview", o5.getvalue())
    check(s == 200 and pv3["invoicesReady"] == 1 and not pv3["issues"], "blank unit with several units picks one", f"{pv3}")
    for row in call("GET", "/api/FbrLookup/category/HsUom"):
        if row["code"].startswith(code + "|"):
            call("DELETE", f"/api/FbrLookup/{row['id']}")
finally:
    for cid in made:
        http("DELETE", f"/api/companies/{cid}", base, token=token)

print(f"\n=== {PASS}/{PASS + FAIL} checks passed ===")
sys.exit(1 if FAIL else 0)
