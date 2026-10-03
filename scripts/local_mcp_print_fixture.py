"""Create private local print fixtures, prove all 12 MCP projections, clean on success.

All documents use application create services. Only note-kind fixture shaping uses
SQL, limited to generated invoice IDs in the generated company; no FBR operation.
On failure, prints exact owned IDs and preserves the fixture for investigation.
"""
from __future__ import annotations

import argparse
import json
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://localhost:5134")
parser.add_argument("--sql-server", default=r".\MSSQLSERVER02")
parser.add_argument("--sql-db", default="MyApp_Trader_Local")
args = parser.parse_args()
base = args.base.rstrip("/")
url = urllib.parse.urlparse(base)
if url.hostname not in {"localhost", "127.0.0.1", "::1"} or url.scheme not in {"http", "https"}:
    raise SystemExit("Refused: fixture runner is loopback-only.")
if args.sql_server.lower().split("\\")[0] not in {".", "(local)", "localhost", "127.0.0.1"} or not args.sql_db.endswith("_Local"):
    raise SystemExit("Refused: fixture database must be local.")
run = secrets.token_hex(5)
owned = []
companies = []
date = "2026-10-03"
admin = None


def http(method, path, body=None):
    headers = {"Content-Type": "application/json"}
    if admin:
        headers["Authorization"] = "Bearer " + admin
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
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


def create(path, body, delete_prefix, kind, company=None):
    status, result = http("POST", path, body)
    if status not in {200, 201} or not isinstance(result, dict) or "id" not in result:
        raise RuntimeError(f"Create {kind} failed HTTP {status}: {result}")
    record_id = int(result["id"])
    assert record_id > 0
    owned.append({"kind": kind, "id": record_id, "companyId": company, "deletePath": f"{delete_prefix}/{record_id}"})
    print(f"Created {kind} id={record_id} companyId={company}", flush=True)
    return result


def sql(query):
    result = subprocess.run(["sqlcmd", "-S", args.sql_server, "-d", args.sql_db, "-E", "-C", "-N", "-I", "-b", "-h", "-1", "-W", "-Q", "SET NOCOUNT ON; " + query], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Local generated-note fixture shaping failed.")


def invoice(company, client, kind="Bill"):
    return create("/api/invoices/standalone", {
        "companyId": company, "clientId": client, "date": date, "gstRate": 17,
        "paymentTerms": "Local print fixture", "withholdingTaxRate": 5.5,
        "items": [{"description": "First print fixture line", "quantity": 2, "uom": "Pcs", "unitPrice": 100},
                  {"description": "Second print fixture line", "quantity": 3, "uom": "Pcs", "unitPrice": 70}]
    }, "/api/invoices", kind, company)


try:
    status, login = http("POST", "/api/auth/login", {"username": "admin", "password": "admin123"})
    if status != 200:
        raise RuntimeError(f"Local login failed HTTP {status}")
    admin = login["token"]
    for suffix in ("A", "B"):
        company = create("/api/companies", {
            "name": f"MCP Print Fixture {run} {suffix}", "brandName": "Sample Print Company",
            "startingInvoiceNumber": 1, "startingChallanNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "startingDebitNoteNumber": 1, "startingCreditNoteNumber": 1,
            "inventoryTrackingEnabled": False
        }, "/api/companies", "Company")
        cid = company["id"]
        companies.append(cid)
        client = create("/api/clients", {"companyId": cid, "name": f"Sample Print Buyer {run} {suffix}", "registrationType": "Unregistered", "fbrProvinceCode": 8}, "/api/clients", "Client", cid)
        bill = invoice(cid, client["id"])
        if suffix == "B":
            continue
        supplier = create("/api/suppliers", {"companyId": cid, "name": f"Sample Print Supplier {run}", "registrationType": "Unregistered", "fbrProvinceCode": 8}, "/api/suppliers", "Supplier", cid)
        for kind, doc_type in (("DebitNote", 9), ("CreditNote", 10)):
            note = invoice(cid, client["id"], kind)
            # These are local print fixtures, not submitted or operational notes.
            # No company or invoice supplied by a caller can enter this statement.
            sql(f"UPDATE Invoices SET DocumentType={doc_type}, OriginalInvoiceId={bill['id']}, NoteReason='Others', NoteReasonRemarks='Local print fixture' WHERE Id={note['id']} AND CompanyId={cid} AND FbrSubmittedAt IS NULL; IF @@ROWCOUNT<>1 THROW 50001,'Generated note fixture not found',1;")
        lines = [{"description": "First print fixture line", "quantity": 2, "unit": "Pcs", "unitPrice": 100},
                 {"description": "Second print fixture line", "quantity": 3, "unit": "Pcs", "unitPrice": 70}]
        create(f"/api/salesquotes/company/{cid}", {"companyId": cid, "clientId": client["id"], "date": date, "gstRate": 17, "items": lines}, "/api/salesquotes", "SalesQuote", cid)
        create(f"/api/salesorders/company/{cid}", {"companyId": cid, "clientId": client["id"], "orderDate": date, "items": lines}, "/api/salesorders", "SalesOrder", cid)
        create(f"/api/deliverychallans/company/{cid}", {"companyId": cid, "clientId": client["id"], "deliveryDate": date, "poNumber": "FIXTURE-PO", "items": lines}, "/api/deliverychallans", "Challan", cid)
        purchase = create("/api/purchasebills", {"companyId": cid, "supplierId": supplier["id"], "date": date, "gstRate": 17,
            "items": [{"description": line["description"], "quantity": line["quantity"], "uom": "Pcs", "unitPrice": line["unitPrice"]} for line in lines]}, "/api/purchasebills", "PurchaseBill", cid)
        create("/api/goodsreceipts", {"companyId": cid, "supplierId": supplier["id"], "receiptDate": date, "items": lines}, "/api/goodsreceipts", "GoodsReceipt", cid)
        create(f"/api/payments/receipts/company/{cid}", {"contactType": "Client", "contactId": client["id"], "date": date, "method": "Cash", "allocations": [{"invoiceId": bill["id"], "amount": 50}]}, "/api/payments/receipts", "Receipt", cid)
        create(f"/api/payments/payments/company/{cid}", {"contactType": "Supplier", "contactId": supplier["id"], "date": date, "method": "Cash", "allocations": [{"purchaseBillId": purchase["id"], "amount": 50}]}, "/api/payments/payments", "Payment", cid)
        create(f"/api/withholdingtaxreceipts/company/{cid}", {"companyId": cid, "clientId": client["id"], "date": date, "amount": 5, "description": "Local print fixture"}, "/api/withholdingtaxreceipts", "WithholdingTaxReceipt", cid)
    suite = Path(__file__).with_name("test_mcp_print_reads.py")
    result = subprocess.run([sys.executable, "-u", str(suite), "--base", base, "--sql-server", args.sql_server,
        "--sql-db", args.sql_db, "--company-a", str(companies[0]), "--company-b", str(companies[1]), "--require-all-types"])
    if result.returncode:
        raise RuntimeError(f"Print suite failed exit {result.returncode}")
    # Reverse dependencies; suppliers were created after the base bill, so
    # remove all documents first, then parties, then the two owned companies.
    for group in ({"WithholdingTaxReceipt", "Receipt", "Payment", "GoodsReceipt", "PurchaseBill", "Challan", "SalesOrder", "SalesQuote", "CreditNote", "DebitNote", "Bill"}, {"Supplier", "Client"}, {"Company"}):
        for record in list(reversed(owned)):
            if record["kind"] not in group:
                continue
            status, body = http("DELETE", record["deletePath"])
            if status not in {200, 204}:
                raise RuntimeError(f"Cleanup {record['kind']} id={record['id']} failed HTTP {status}: {body}")
            owned.remove(record)
    print("All 12 print types verified; private fixture records removed.")
except Exception as error:
    print(str(error), file=sys.stderr)
    print("Retained exact private fixture IDs: " + json.dumps(owned), file=sys.stderr)
    sys.exit(1)
