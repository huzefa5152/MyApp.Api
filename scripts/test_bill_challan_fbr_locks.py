"""Exercise FBR locks using throwaway rows on the local Trader database only.

python scripts/test_bill_challan_fbr_locks.py --base http://localhost:5148
No request is sent to FBR. SQL only installs otherwise unreachable test states.
"""
import argparse
from urllib.parse import urlparse

import pyodbc
import test_basic_flows as flows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://localhost:5148")
    parser.add_argument("--local-db", default="MyApp_Trader_Local")
    args = parser.parse_args()
    if urlparse(args.base).hostname not in ("localhost", "127.0.0.1") or not args.local_db.endswith("_Local") or not all(c.isalnum() or c == "_" for c in args.local_db):
        parser.error("This test requires a loopback API and a local database ending in _Local.")
    token, company, client = flows.setup(args.base, "admin", "admin123")
    db = pyodbc.connect(f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER=.\\MSSQLSERVER02;DATABASE={args.local_db};Trusted_Connection=yes;TrustServerCertificate=yes", autocommit=True)
    assert db.execute("SELECT Name FROM Companies WHERE Id=?", company["id"]).fetchone()[0] == company["name"], "API and local SQL must target the same database"
    failures = 0

    def call(method, path, body=None):
        return flows.http(method, path, args.base, token=token, body=body)

    def check(name, ok, detail=""):
        nonlocal failures
        failures += not ok
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f": {detail}" if not ok else ""))

    try:
        status, bill = call("POST", "/api/invoices/standalone", {
            "companyId": company["id"], "clientId": client["id"], "date": "2026-10-08",
            "gstRate": 18, "items": [{"description": "Local lock probe", "quantity": 1, "uom": "Pcs", "unitPrice": 100}]})
        assert status == 201, (status, bill)
        iid, line = bill["id"], bill["items"][0]
        path = f"/api/invoices/{iid}/challans"
        status, snapshot = call("GET", path)
        assert status == 200, snapshot
        body = {"version": snapshot["version"], "challanIds": [], "addedChallanVersions": {}, "unitPrices": {}}
        for state, irn, submitted in (("Submitting", None, None), ("Uncertain", None, None),
                                      ("Submitted", None, None), (None, "LOCAL-TEST-IRN", None),
                                      (None, None, "2026-10-08")):
            db.execute("UPDATE Invoices SET FbrStatus=?, FbrIRN=?, FbrSubmittedAt=? WHERE Id=? AND CompanyId=?",
                       state, irn, submitted, iid, company["id"])
            label = state or ("IRN present" if irn else "submission timestamp present")
            for method, endpoint, payload in (
                ("GET", path, None), ("PUT", path, body),
                ("PUT", f"/api/invoices/{iid}", {"gstRate": 18, "items": [{"id": line["id"], "description": line["description"], "quantity": 1, "uom": "Pcs", "unitPrice": 100}]}),
                ("PATCH", f"/api/invoices/{iid}/itemtypes-and-qty", {"writeMode": "adjustment", "items": [{"id": line["id"], "quantity": 1, "unitPrice": 100}]}),
            ):
                status, result = call(method, endpoint, payload)
                check(f"{label}: {method} {endpoint.rsplit('/', 1)[-1]} locked", status == 400, str((status, result)))
        for state in (None, "Validated", "Failed"):
            db.execute("UPDATE Invoices SET FbrStatus=?, FbrIRN=NULL, FbrSubmittedAt=NULL WHERE Id=? AND CompanyId=?", state, iid, company["id"])
            status, snapshot = call("GET", path)
            check(f"{state or 'Draft'} remains editable", status == 200, str(snapshot))
            if status == 200:
                status, result = call("PUT", path, {**body, "version": snapshot["version"]})
                check(f"{state or 'Draft'} can save selection", status == 200, str(result))
        db.execute("UPDATE Invoices SET FbrStatus=NULL, FbrIRN=NULL, FbrSubmittedAt=NULL WHERE Id=? AND CompanyId=?", iid, company["id"])
        for column, value in (("IsDemo", 1), ("DocumentType", 9), ("SupplementsInvoiceId", iid)):
            db.execute(f"UPDATE Invoices SET {column}=? WHERE Id=? AND CompanyId=?", value, iid, company["id"])
            status, result = call("GET", path)
            check(f"{column}: ordinary challan selector unavailable", status == 400, str(result))
            db.execute(f"UPDATE Invoices SET {column}=? WHERE Id=? AND CompanyId=?", None if column == "SupplementsInvoiceId" else (4 if column == "DocumentType" else 0), iid, company["id"])
        status, item_type = call("POST", f"/api/itemtypes?companyId={company['id']}", {
            "companyId": company["id"], "name": f"Local unavailable type {company['id']}", "uom": "Pcs"})
        assert status in (200, 201), item_type
        status, source = call("POST", f"/api/deliverychallans/company/{company['id']}", {
            "companyId": company["id"], "clientId": client["id"], "poNumber": "LOCAL-PROBE",
            "deliveryDate": "2026-10-08", "items": [{"itemTypeId": item_type["id"],
            "description": "Unavailable source type", "quantity": 1, "unit": "Pcs"}]})
        assert status == 201, source
        status, snapshot = call("GET", path)
        assert status == 200, snapshot
        selected = next(c for c in snapshot["available"] if c["id"] == source["id"])
        db.execute("UPDATE ItemTypes SET IsDeleted=1 WHERE Id=? AND CompanyId=?", item_type["id"], company["id"])
        status, result = call("PUT", path, {"version": snapshot["version"], "challanIds": [source["id"]],
            "addedChallanVersions": {str(source["id"]): selected["version"]},
            "unitPrices": {str(source["items"][0]["id"]): 100}})
        check("deleted source classification rejected", status == 400 and "item type" in str(result), str(result))
        db.execute("UPDATE ItemTypes SET IsDeleted=0 WHERE Id=? AND CompanyId=?", item_type["id"], company["id"])
        status, child = call("POST", "/api/invoices/standalone", {
            "companyId": company["id"], "clientId": client["id"], "date": "2026-10-08",
            "gstRate": 18, "items": [{"description": "Local note probe", "quantity": 1, "uom": "Pcs", "unitPrice": 100}]})
        assert status == 201, child
        db.execute("UPDATE Invoices SET OriginalInvoiceId=?, DocumentType=10 WHERE Id=? AND CompanyId=?", iid, child["id"], company["id"])
        status, snapshot = call("GET", path)
        assert status == 200, snapshot
        status, result = call("PUT", path, {**body, "version": snapshot["version"]})
        check("live note blocks structural bill edits", status == 400, str(result))
        db.execute("UPDATE Invoices SET OriginalInvoiceId=NULL, DocumentType=4 WHERE Id=? AND CompanyId=?", child["id"], company["id"])
    finally:
        db.execute("UPDATE Invoices SET FbrStatus=NULL, FbrIRN=NULL, FbrSubmittedAt=NULL WHERE CompanyId=?", company["id"])
        db.close()
        flows.teardown(args.base, token, company, False)
    print(f"FBR lock checks: {failures} failures")
    return int(failures > 0)


if __name__ == "__main__":
    raise SystemExit(main())
