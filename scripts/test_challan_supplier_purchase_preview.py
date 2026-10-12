"""Local-only supplier-purchase preview, GST, stock and payment regression."""
import argparse
import json
import time
from urllib.parse import urlparse
import pyodbc
from test_basic_flows import http

p = argparse.ArgumentParser()
p.add_argument("--base", required=True)
p.add_argument("--database", required=True)
p.add_argument("--customize", action="store_true")
a = p.parse_args()
assert urlparse(a.base).hostname in ("localhost", "127.0.0.1")
assert a.database.endswith("_ChallanPurchase_Test")
sql = pyodbc.connect("DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost\\MSSQLSERVER02;DATABASE=" + a.database + ";Trusted_Connection=yes;TrustServerCertificate=yes;", autocommit=True)
status, login = http("POST", "/api/auth/login", a.base, body={"username": "admin", "password": "admin123"})
assert status == 200, status
token = login["token"]
checks = 0

def check(label, ok):
    global checks
    assert ok, label
    checks += 1
    print("PASS " + label, flush=True)

def call(method, path, body=None, expected=(200, 201), auth=None):
    status, data = http(method, path, a.base, token=auth or token, body=body)
    assert status in expected, (path, status, data)
    return data

stamp = str(time.time_ns())
company = call("POST", "/api/companies", {"name": "[TEMP] Supplier preview " + stamp, "inventoryTrackingEnabled": True, "inventoryFlowVersion": 2, "fbrEnabled": False, "startingPurchaseBillNumber": 1, "startingChallanNumber": 1})
cid = company["id"]
client = call("POST", "/api/clients", {"name": "Preview buyer", "companyId": cid, "registrationType": "Unregistered"})
suppliers = [call("POST", "/api/suppliers", {"name": "Preview supplier " + str(i), "companyId": cid}) for i in range(2)]
type_body = {"name": "Preview inventory " + stamp, "companyId": cid, "hsCode": "8412.9020" if not a.customize else None, "uom": "Pcs", "fbrUOMId": 1, "saleType": "Goods at Standard Rate (default)"}
item_type = call("POST", "/api/itemtypes?companyId=" + str(cid), type_body)
# V2 item types remain inventory without an HS code.
sql.execute("UPDATE Companies SET InventoryTrackingEnabled=1 WHERE Id=?", cid)
if a.customize: sql.execute("UPDATE Companies SET InventoryFlowVersion=2 WHERE Id=?", cid)
lines = [{"description": "Supplier line " + str(i), "quantity": qty, "unit": "Pcs", "itemTypeId": item_type["id"], "supplierId": suppliers[i]["id"], "actualUnitCost": price} for i, (qty, price) in enumerate([(2, 100), (3, 50)])]
today = "2026-01-15T00:00:00Z"
def create_challan():
    return call("POST", f"/api/deliverychallans/company/{cid}", {"clientId": client["id"], "poNumber": "", "deliveryDate": today, "items": lines})
challan = create_challan()
id = challan["id"]
preview = call("GET", f"/api/purchasebills/from-challan/{id}/preview")
check("preview groups two suppliers", len(preview["suppliers"]) == 2)
check("preview defaults GST to zero", all(s["gstRate"] == 0 for s in preview["suppliers"]))
check("preview labels branch stock policy", preview["tracksStock"] == a.customize)
check("preview does not create purchase bills", sql.execute("SELECT COUNT(*) FROM PurchaseBills WHERE SourceDeliveryChallanId=?", id).fetchone()[0] == 0)
settings = {"revision": preview["revision"], "date": "2026-01-16", "suppliers": [{"supplierId": suppliers[0]["id"], "gstRate": 0, "supplierBillNumber": "SAMPLE-ZERO"}, {"supplierId": suppliers[1]["id"], "gstRate": 18, "supplierBillNumber": "SAMPLE-GST"}]}
invalid = dict(settings, revision="stale")
call("POST", f"/api/purchasebills/from-challan/{id}", invalid, expected=(400,))
check("stale preview creates nothing", sql.execute("SELECT COUNT(*) FROM PurchaseBills WHERE SourceDeliveryChallanId=?", id).fetchone()[0] == 0)
malformed = dict(settings, suppliers=[None, None])
call("POST", f"/api/purchasebills/from-challan/{id}", malformed, expected=(400,))
check("malformed supplier rows rejected without server error", True)
for rate in (-1, 101, 18.123):
    bad = json.loads(json.dumps(settings)); bad["suppliers"][0]["gstRate"] = rate
    call("POST", f"/api/purchasebills/from-challan/{id}", bad, expected=(400,))
    check("invalid GST rejected: " + str(rate), True)
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(max_workers=2) as pool:
    outcomes = list(pool.map(lambda _: call("POST", f"/api/purchasebills/from-challan/{id}", settings), range(2)))
bills = outcomes[0]
check("concurrent confirmations return the same bills", {b["id"] for b in outcomes[0]} == {b["id"] for b in outcomes[1]})
check("one bill per supplier", len(bills) == 2)
bill_map = {b["supplierId"]: b for b in bills}
zero, taxed = [bill_map[s["id"]] for s in suppliers]
check("zero GST bill owes 200", zero["gstAmount"] == 0 and zero["grandTotal"] == 200)
check("18 percent GST bill owes 177", taxed["gstAmount"] == 27 and taxed["grandTotal"] == 177)
check("supplier references preserved", zero["supplierBillNumber"] == "SAMPLE-ZERO" and taxed["supplierBillNumber"] == "SAMPLE-GST")
check("chosen bill date preserved", all(b["date"].startswith("2026-01-16") for b in bills))
check("amount owed follows total", all(b["balanceDue"] == b["grandTotal"] for b in bills))
check("challan costs preserved", call("GET", f"/api/deliverychallans/{id}")["items"][0]["actualUnitCost"] == 100)
if a.customize:
    check("Customize reuses inventory types", all(i["itemTypeId"] == item_type["id"] for b in bills for i in b["items"]))
else:
    check("Trader purchase lines have no item type or HS code", all(i["itemTypeId"] is None and not i["hsCode"] for b in bills for i in b["items"]))
source_ids = [b["id"] for b in bills]
stock = sql.execute("SELECT COUNT(*),COALESCE(SUM(Quantity),0) FROM StockMovements WHERE SourceType=1 AND SourceId IN (?,?) AND CompanyId=?", *source_ids, cid).fetchone()
check("purchase stock policy enforced", (stock[0] == 2 and stock[1] == 5) if a.customize else stock[0] == 0)
retry = call("POST", f"/api/purchasebills/from-challan/{id}", settings)
check("repeat creates no duplicate bills", {b["id"] for b in retry} == set(source_ids))
check("existing preview reports already created", call("GET", f"/api/purchasebills/from-challan/{id}/preview")["alreadyCreated"])
listed = call("GET", f"/api/purchasebills/company/{cid}/paged?fromChallan=true")
check("challan purchase source filter", listed["totalCount"] == 2)
check("other source filter excludes challan bills", call("GET", f"/api/purchasebills/company/{cid}/paged?fromChallan=false")["totalCount"] == 0)
# Different challans share a company number sequence without duplicate bills or deadlock.
pending = [create_challan() for _ in range(2)]
requests = []
for source in pending:
    plan = call("GET", f"/api/purchasebills/from-challan/{source['id']}/preview")
    requests.append((source["id"], {"revision": plan["revision"], "date": plan["date"], "suppliers": [{"supplierId": s["supplierId"], "gstRate": 0} for s in plan["suppliers"]]}))
with ThreadPoolExecutor(max_workers=2) as pool:
    created = list(pool.map(lambda request: call("POST", f"/api/purchasebills/from-challan/{request[0]}", request[1]), requests))
check("different challans create concurrently without number collision", len({bill["purchaseBillNumber"] for batch in created for bill in batch}) == 4)
# The payment allocation is against the same purchase bill, not a separate payable.
call("POST", f"/api/accounts/company/{cid}/seed-wholesale")
accounts = call("GET", f"/api/accounts/company/{cid}/flat")
bank = next(account["id"] for account in accounts if account["controlType"] == "BankCash")
payment = call("POST", f"/api/payments/payments/company/{cid}", {"date": today, "contactType": "Supplier", "contactId": suppliers[1]["id"], "bankAccountId": bank, "method": "Cash", "allocations": [{"purchaseBillId": taxed["id"], "amount": 77}]})
paid = call("GET", f"/api/purchasebills/{taxed['id']}")
check("supplier payment settles generated purchase bill", paid["amountPaid"] == 77 and paid["balanceDue"] == 100)
# A non-seed administrator with no company assignment cannot preview or create.
user = call("POST", "/api/users", {"username": "preview_scope_" + stamp, "password": "SampleTestPass2026!", "fullName": "Preview scope test", "role": "Administrator"})
roles = call("GET", "/api/roles")
role = next(r["id"] for r in roles if r["name"] == "Administrator")
call("PUT", f"/api/users/{user['id']}/roles", {"roleIds": [role]})
call("PUT", f"/api/usercompanies/user/{user['id']}", {"companyIds": []})
foreign = call("POST", "/api/auth/login", {"username": "preview_scope_" + stamp, "password": "SampleTestPass2026!"})["token"]
call("GET", f"/api/purchasebills/from-challan/{id}/preview", expected=(403,), auth=foreign)
call("POST", f"/api/purchasebills/from-challan/{id}", settings, expected=(403,), auth=foreign)
check("cross-company preview and creation blocked", True)
call("PUT", f"/api/usercompanies/user/{user['id']}", {"companyIds": [cid]})
call("PUT", f"/api/users/{user['id']}/roles", {"roleIds": []})
call("GET", f"/api/purchasebills/from-challan/{id}/preview", expected=(403,), auth=foreign)
call("POST", f"/api/purchasebills/from-challan/{id}", settings, expected=(403,), auth=foreign)
check("purchase permission required despite company access", True)
fixture = {"companyId": cid, "challanId": id, "purchaseIds": source_ids, "paymentId": payment["id"], "userId": user["id"], "suppliers": suppliers, "clientId": client["id"]}
print(str(checks) + " supplier-purchase checks passed")
print("Local fixture retained for browser verification: " + json.dumps(fixture))
sql.close()
