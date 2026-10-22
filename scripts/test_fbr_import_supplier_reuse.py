"""FBR purchase import must never create the same supplier twice in a company.

The preview matches sellers against the suppliers that exist BEFORE the commit,
so two invoices from one new seller in the same file both arrive unmatched.
The committer re-checks by NTN, then name, before creating; without that, the
second invoice created a second supplier (seen on production, 2026-05-19).

Uses the import's own sample workbook, rewritten so every invoice comes from
one brand-new seller, against a throwaway company.

    python scripts/test_fbr_import_supplier_reuse.py --base http://localhost:5134
"""
import argparse
import io
import json
import random
import sys
import urllib.error
import urllib.request
import uuid

import openpyxl

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5134")
ap.add_argument("--admin-user", default="admin")
ap.add_argument("--admin-pw", default="admin123")
args = ap.parse_args()
BASE = args.base.rstrip("/")
results: list[tuple[str, bool, str]] = []


def call(method, path, token=None, body=None, raw=False, headers=None):
    h = dict(headers or {})
    data = None
    if body is not None and not isinstance(body, bytes):
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    elif isinstance(body, bytes):
        data = body
    if token:
        h["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = r.read()
            return r.status, payload if raw else (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload)
        except Exception:
            return e.code, payload


def upload(path, token, company_id, file_bytes):
    boundary = uuid.uuid4().hex
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"companyId\"\r\n\r\n{company_id}\r\n".encode(),
        (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"reuse.xlsx\"\r\n"
         "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n").encode()
        + file_bytes + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    return call("POST", path, token, b"".join(parts), headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -- {detail}"))


s, d = call("POST", "/api/auth/login", body={"username": args.admin_user, "password": args.admin_pw})
assert s == 200, f"login: {s} {d}"
tok = d["token"]

tag = uuid.uuid4().hex[:6].upper()
s, co = call("POST", "/api/companies", tok, {
    "name": f"FBR Import Reuse Test {tag}", "fullAddress": "Test HQ", "phone": "+92-21-0000000",
    "ntn": "1234567", "cnic": "1234567890123", "strn": "1234567890123", "fbrSellerRegistrationNo": "1234567",
    "startingChallanNumber": 1, "startingInvoiceNumber": 1, "startingPurchaseBillNumber": 1,
    "startingGoodsReceiptNumber": 1, "fbrEnvironment": "sandbox", "fbrProvinceCode": 8})
assert s in (200, 201), f"create company: {s} {co}"
cid = co["id"]

# The sample, with every row from one new seller and at least two invoice numbers.
HEADERS = ["Fixed assets / Capital goods", "InAdmissible/ Non Creditable", "Status", "Seller Return Status",
           "Source Authority", "Claimed Authority", "Buyer Registration No.", "Buyer Name",
           "Seller Registration No.", "Seller Name", "Supplier Type", "Sale Origination Province",
           "Destination of Supply", "Invoice Type", "Invoice No", "Invoice Date", "Product Description",
           "HS Code", "Purchase Type", "Rate", "Uom", "Quantity", "Value", "Sales Tax/ FED in ST Mode",
           "Fixed / notified value or Retail Price", "ST Withheld as WH Agent", "Extra Tax", "Further Tax",
           "Input Credit not allowed", "FED Changed"]
s, sample = call("GET", "/api/fbr-purchase-import/sample", tok, raw=True)
if s == 200 and sample[:2] == b"PK":
    wb = openpyxl.load_workbook(io.BytesIO(sample))
else:  # this line has no sample download: build a fictional Annexure-A file
    wb = openpyxl.Workbook()
    wb.active.append(HEADERS)
    for i, (hs, desc) in enumerate((("7306.9000", "MS STEEL PIPE 2 INCH"), ("4819.1000", "CORRUGATED CARTON BOX"),
                                     ("8544.4990", "COPPER CABLE 4MM"))):
        wb.active.append(["False", "FALSE", "Claimed", "Unsubmitted", "FBR", "FBR", "3520100000009", "Demo Trading Company",
                          "0", "x", "Registered", "SINDH", "SINDH", "Purchase Invoice", f"RT{tag}{i + 1}00", "05-Aug-2026",
                          desc, hs, "Goods at standard rate (default)", "18%", "PCS", "10", "1000", "180",
                          "0", "0", "0", "0", "", "0"])
ws = wb.active
head = [c.value for c in ws[1]]
ntn_col, name_col, inv_col = head.index("Seller Registration No.") + 1, head.index("Seller Name") + 1, head.index("Invoice No") + 1
ntn = f"{random.randint(1000000, 9999999)}-{random.randint(0, 9)}"
seller = f"Reuse Test Seller {tag}"
invoices = set()
for r in range(2, ws.max_row + 1):
    if ws.cell(r, inv_col).value:
        ws.cell(r, ntn_col).value = ntn
        ws.cell(r, name_col).value = seller
        invoices.add(ws.cell(r, inv_col).value)
buf = io.BytesIO()
wb.save(buf)
file_bytes = buf.getvalue()
check("the file holds two or more invoices from the one seller", len(invoices) >= 2, str(invoices))

s, preview = upload("/api/fbr-purchase-import/preview", tok, cid, file_bytes)
check("preview succeeds", s == 200, f"{s} {preview}")
unmatched = [i for i in (preview or {}).get("invoices", []) if not i.get("matchedSupplierId")]
check("every invoice arrives without a supplier match (seller is new)", len(unmatched) >= 2, str(len(unmatched)))

s, commit = upload("/api/fbr-purchase-import/commit", tok, cid, file_bytes)
check("commit succeeds", s == 200, f"{s} {commit}")
counts = (commit or {}).get("counts", {})
check("two or more invoices imported", counts.get("invoicesImported", 0) >= 2, str(counts))
check("exactly one supplier created for the seller", counts.get("suppliersCreated") == 1, str(counts))

s, sups = call("GET", f"/api/suppliers/company/{cid}", tok)
same = [x for x in (sups or []) if (x.get("ntn") or "").strip() == ntn]
check("the company holds that NTN on one supplier only", len(same) == 1, str(same))
check("…under the seller's name", len(same) == 1 and same[0].get("name") == seller, str(same))

# Same seller again in a second file: no new supplier, nothing re-imported.
s, again = upload("/api/fbr-purchase-import/commit", tok, cid, file_bytes)
check("re-committing the file creates no supplier",
      s == 200 and (again or {}).get("counts", {}).get("suppliersCreated") == 0, f"{s} {again and again.get('counts')}")
s, sups = call("GET", f"/api/suppliers/company/{cid}", tok)
check("still one supplier for that NTN", len([x for x in (sups or []) if (x.get("ntn") or "").strip() == ntn]) == 1)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} FBR import supplier reuse checks passed")
if failed:
    print(f"Test company {cid} kept for inspection.")
    sys.exit(1)
print("all checks passed")
