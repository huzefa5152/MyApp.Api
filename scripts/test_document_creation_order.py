"""Local regression: creation order, historical challans and stable pagination."""
import argparse
from urllib.parse import urlparse
import pyodbc
from test_basic_flows import http, setup, teardown

p = argparse.ArgumentParser()
p.add_argument("--base", required=True)
p.add_argument("--db", required=True, help="Isolated local SQL connection string")
p.add_argument("--admin-user", default="admin")
p.add_argument("--admin-pass", default="admin123")
a = p.parse_args()
assert urlparse(a.base).hostname in ("localhost", "127.0.0.1"), "Local API only"
connection = pyodbc.connect(a.db)
server = connection.cursor().execute("SELECT CONVERT(nvarchar(128), SERVERPROPERTY('MachineName'))").fetchone()[0]
import os
assert server.lower() == os.environ["COMPUTERNAME"].lower(), "Local database only"
token, company, client = setup(a.base, a.admin_user, a.admin_pass)
cid = company["id"]
from test_basic_flows import first_item_type_id
item_type_id = first_item_type_id(a.base, token)
checks = 0
def check(ok):
    global checks
    assert ok
    checks += 1

def call(method, path, body=None):
    status, data = http(method, path, a.base, token=token, body=body)
    assert status in (200, 201), (path, status, data)
    return data

def challan(number):
    return call("POST", f"/api/deliverychallans/company/{cid}", {
        "companyId": cid, "clientId": client["id"], "customNumber": number,
        "deliveryDate": "2020-01-01", "items": [{"description": "Order check", "quantity": 1, "unit": "Pcs"}]})

def invoice(number):
    return call("POST", "/api/invoices/standalone", {
        "companyId": cid, "clientId": client["id"], "invoiceNumber": number,
        "date": "2020-01-01", "gstRate": 18,
        "items": [{"description": "Order check", "quantity": 1, "uom": "Pcs", "unitPrice": 10, "itemTypeId": item_type_id}]})

try:
    old = challan(900)
    old2 = challan(800)
    cursor = connection.cursor()
    cursor.execute("UPDATE DeliveryChallans SET CreatedAt=NULL WHERE CompanyId=?", cid)
    connection.commit()
    fresh = challan(1)
    check(fresh["challanNumber"] == 1)
    stamp = cursor.execute("SELECT CreatedAt FROM DeliveryChallans WHERE Id=?", fresh["id"]).fetchone()[0]
    check(stamp is not None)
    check(cursor.execute("SELECT COUNT(*) FROM DeliveryChallans WHERE CompanyId=? AND CreatedAt IS NULL", cid).fetchone()[0] == 2)
    expected = [fresh["id"], old2["id"], old["id"]]
    rows = call("GET", f"/api/deliverychallans/company/{cid}")
    check([r["id"] for r in rows] == expected)
    for page, ident in enumerate(expected, 1):
        rows = call("GET", f"/api/deliverychallans/company/{cid}/paged?page={page}&pageSize=1")
        check([r["id"] for r in rows["items"]] == [ident])
    # Ordinary changes never reset the creation timestamp or reorder an old row.
    loaded = call("GET", f"/api/deliverychallans/{fresh['id']}")
    loaded["site"] = "Edited"
    call("PUT", f"/api/deliverychallans/{fresh['id']}", loaded)
    check(cursor.execute("SELECT CreatedAt FROM DeliveryChallans WHERE Id=?", fresh["id"]).fetchone()[0] == stamp)
    first = invoice(900)
    second = invoice(1)
    check(second["invoiceNumber"] == 1)
    for page, ident in enumerate((second["id"], first["id"]), 1):
        rows = call("GET", f"/api/invoices/company/{cid}/paged?page={page}&pageSize=1")
        check([r["id"] for r in rows["items"]] == [ident])
    cursor.execute("UPDATE Invoices SET CreatedAt=? WHERE CompanyId=?", "2020-01-01", cid)
    connection.commit()
    rows = call("GET", f"/api/invoices/company/{cid}/paged?page=1&pageSize=1")
    check([r["id"] for r in rows["items"]] == [second["id"]])
    rows = call("GET", f"/api/invoices/company/{cid}")
    check([r["id"] for r in rows] == [second["id"], first["id"]])
    print(f"{checks} newest-created ordering checks passed")
finally:
    connection.close()
    teardown(a.base, token, company, False)
