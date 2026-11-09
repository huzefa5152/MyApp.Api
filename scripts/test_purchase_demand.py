"""Purchases for customer documents: one demand ("trail") across sales order,
challan and sale bill, bought once whatever stage it is bought at.

  python scripts/test_purchase_demand.py --base http://localhost:5136 --db MyApp_Customize_ChallanPurchase_Test

Local only. Creates [TEMP] companies and leaves them for browser checks.
--db is the local database the backend uses (sqlcmd, Windows auth, .\\MSSQLSERVER02).
"""
import argparse
import glob
import os
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from urllib.parse import urlparse

from test_basic_flows import http

p = argparse.ArgumentParser()
p.add_argument("--base", required=True)
p.add_argument("--db", required=True)
p.add_argument("--server", default=r".\MSSQLSERVER02")
a = p.parse_args()
assert urlparse(a.base).hostname in ("localhost", "127.0.0.1"), "local backends only"
assert "prod" not in a.db.lower(), "local databases only"

status, login = http("POST", "/api/auth/login", a.base, body={"username": "admin", "password": "admin123"})
assert status == 200, status
token = login["token"]
today = date.today().isoformat()
checks = 0


def check(label, ok, detail=""):
    global checks
    assert ok, f"{label} {detail}"
    checks += 1
    print("PASS " + label, flush=True)


def call(method, path, body=None, expected=(200, 201, 204), tok=None):
    status, data = http(method, path, a.base, token=tok or token, body=body)
    assert status in expected, (method, path, status, data)
    return data


def sql(query):
    out = subprocess.run(["sqlcmd", "-S", a.server, "-E", "-I", "-d", a.db, "-h", "-1", "-W", "-b", "-Q",
                          "SET NOCOUNT ON; " + query], capture_output=True, text=True, check=True).stdout
    return [l.strip() for l in out.splitlines() if l.strip()]


stamp = str(time.time_ns())[-8:]


def company(name):
    return call("POST", "/api/companies", {"name": f"[TEMP] {name} {stamp}", "inventoryTrackingEnabled": True,
                                           "inventoryFlowVersion": 2, "fbrEnabled": False,
                                           "startingPurchaseBillNumber": 1, "startingChallanNumber": 1,
                                           "startingInvoiceNumber": 1, "startingSalesOrderNumber": 1})["id"]


cid = company("Purchase demand")
client = call("POST", "/api/clients", {"name": "Demand buyer " + stamp, "companyId": cid, "registrationType": "Unregistered"})["id"]
s1 = call("POST", "/api/suppliers", {"name": "Demand supplier A " + stamp, "companyId": cid})["id"]
s2 = call("POST", "/api/suppliers", {"name": "Demand supplier B " + stamp, "companyId": cid})["id"]
itype = call("POST", f"/api/itemtypes?companyId={cid}", {"name": "Demand item " + stamp, "companyId": cid, "uom": "Pcs",
                                                         "fbrUOMId": 1, "saleType": "Goods at Standard Rate (default)"})["id"]


def order(lines, co=cid, cl=None):
    o = call("POST", f"/api/salesorders/company/{co}", {
        "clientId": cl or client, "orderDate": today,
        "items": [{"description": d, "quantity": q, "unit": "Pcs", "itemTypeId": itype if co == cid else None} for d, q in lines]})
    return o, {i["description"]: i["id"] for i in o["items"]}


def deliver(order_id, lines):
    ch = call("POST", f"/api/salesorders/{order_id}/create-challan",
              {"deliveryDate": today, "lines": [{"salesOrderItemId": i, "quantity": q} for i, q in lines]})
    return ch, {i["description"]: i["id"] for i in ch["items"]}


def challan(lines, co=cid, cl=None):
    ch = call("POST", f"/api/deliverychallans/company/{co}", {
        "clientId": cl or client, "poNumber": "", "deliveryDate": today,
        "items": [{"description": d, "quantity": q, "unit": "Pcs", "itemTypeId": itype if co == cid else None,
                   "supplierId": s, "actualUnitCost": c} for d, q, s, c in lines]})
    return ch, {i["description"]: i["id"] for i in ch["items"]}


def bill_from(ch):
    b = call("POST", "/api/invoices", {"companyId": cid, "clientId": client, "date": today, "gstRate": 18,
                                       "challanIds": [ch["id"]],
                                       "items": [{"deliveryItemId": i["id"], "unitPrice": 100} for i in ch["items"]]})
    return b, {i["description"]: i["id"] for i in b["items"]}


def standalone_bill(lines):
    b = call("POST", "/api/invoices/standalone", {"companyId": cid, "clientId": client, "date": today, "gstRate": 18,
                                                  "items": [{"description": d, "quantity": q, "uom": "Pcs", "unitPrice": 50,
                                                             "itemTypeId": itype} for d, q in lines]})
    return b, {i["description"]: i["id"] for i in b["items"]}


so1, so1l = order([("Bolt", 100), ("Nut", 10)])
dc1, dc1l = deliver(so1["id"], [(so1l["Bolt"], 60)])
b1, b1l = bill_from(dc1)
dc2, dc2l = challan([("Washer", 5, None, None)])
b2, b2l = standalone_bill([("Pin", 3)])
BOLT, NUT, WASHER, PIN = f"o:{so1l['Bolt']}", f"o:{so1l['Nut']}", f"c:{dc2l['Washer']}", f"b:{b2l['Pin']}"


def awaiting(co=cid, tok=None, expected=(200,), **params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    return call("GET", f"/api/purchasebills/company/{co}/awaiting-lines?{q}", expected=expected, tok=tok)


def trails(**params):
    return {l["trailKey"]: (c, l) for c in awaiting(**params) for l in c["lines"]}


def src(kind, line_id, qty):
    return {"kind": kind, "lineId": line_id, "quantity": qty}


def row(qty, sources, price=100, desc="x"):
    return {"itemTypeId": itype, "description": desc, "quantity": qty, "unitPrice": price, "uom": "Pcs", "sources": sources}


def purchase(rows, supplier=s1, expected=(201,), co=cid, tok=None):
    return call("POST", "/api/purchasebills", {"companyId": co, "supplierId": supplier, "date": today,
                                               "gstRate": 0, "items": rows}, expected=expected, tok=tok)


# ── 1. Legacy sale-bill links copy proportionally (the migration's own SQL) ──
mig = open(glob.glob(os.path.join(os.path.dirname(__file__), "..", "Migrations", "*_AddPurchaseItemSources.cs"))[0],
           encoding="utf-8").read()
copy_sql = re.search(r'migrationBuilder\.Sql\(@"(.*?)"\);', mig, re.S).group(1)
legacy = purchase([row(12, [])])
pi = legacy["items"][0]["id"]
b3, b3l = standalone_bill([("Grouped A", 10), ("Grouped B", 30)])
res = sql(f"""BEGIN TRAN;
INSERT INTO PurchaseItemSourceLines (PurchaseItemId, InvoiceItemId) VALUES ({pi}, {b3l['Grouped A']}), ({pi}, {b3l['Grouped B']});
{copy_sql.replace('FROM PurchaseItemSourceLines sl', 'FROM PurchaseItemSourceLines sl').replace('WHERE t.Total > 0;', f'WHERE t.Total > 0 AND sl.PurchaseItemId = {pi};')}
SELECT CAST(Quantity AS decimal(18,4)) FROM PurchaseItemSources WHERE PurchaseItemId = {pi} ORDER BY InvoiceItemId;
ROLLBACK;""")
check("legacy_copy_is_proportional", res == ["3.0000", "9.0000"], res)
call("DELETE", f"/api/purchasebills/{legacy['id']}")

# ── 2. Awaiting lines ──
for g in ("latest", "order", "challan", "bill"):
    found = [l["trailKey"] for c in awaiting(groupBy=g) for l in c["lines"]]
    check(f"trail_shown_once_per_grouping ({g})", found.count(BOLT) == 1 and len(found) == len(set(found)))
t = trails()
check("latest_card_is_newest_stage",
      t[BOLT][0]["kind"] == "bill" and t[BOLT][0]["documentId"] == b1["id"] and t[WASHER][0]["kind"] == "challan"
      and t[PIN][0]["kind"] == "bill" and t[NUT][0]["kind"] == "order")
bolt = t[BOLT][1]
check("quantities", (bolt["ordered"], bolt["delivered"], bolt["billed"], bolt["bought"], bolt["left"]) == (100, 60, 60, 0, 100), bolt)
check("trail tags name every stage", {x["kind"] for x in bolt["trail"]} == {"order", "challan", "bill"})
by_order = awaiting(groupBy="order")
none = next(c for c in by_order if c["kind"] == "none-order")
check("group_by_order_has_no_order_card", none["title"] == "No sales order"
      and {l["trailKey"] for l in none["lines"]} >= {WASHER, PIN})
by_challan = awaiting(groupBy="challan")
bolt_card = next(c for c in by_challan if any(l["trailKey"] == BOLT for l in c["lines"]))
none_ch = next(c for c in by_challan if c["kind"] == "none-challan")
check("group_by_challan", bolt_card["kind"] == "challan" and bolt_card["documentId"] == dc1["id"]
      and none_ch["title"] == "Not delivered yet" and {NUT, PIN} <= {l["trailKey"] for l in none_ch["lines"]})
check("for_filter", set(trails(forKind="order", forId=so1["id"])) == {BOLT, NUT})
nut_line = so1l["Nut"]
sql(f"UPDATE InvoiceItems SET SalesOrderItemId = {nut_line} WHERE Id = {b1l['Bolt']}")
t = trails()
check("trail_root_prefers_challan_order_link", t[BOLT][1]["billed"] == 60 and t[NUT][1]["billed"] == 0)
sql(f"UPDATE InvoiceItems SET SalesOrderItemId = {so1l['Bolt']} WHERE Id = {b1l['Bolt']}")

# ── 3. Access ──
other = company("Purchase demand other")
oc = call("POST", "/api/clients", {"name": "Other buyer " + stamp, "companyId": other, "registrationType": "Unregistered"})["id"]
osup = call("POST", "/api/suppliers", {"name": "Other supplier " + stamp, "companyId": other})["id"]
_, ol = challan([("Foreign", 3, None, None)], co=other, cl=oc)
other_bill = purchase([{"description": "o", "quantity": 1, "unitPrice": 1, "uom": "Pcs",
                        "itemTypeId": call("POST", f"/api/itemtypes?companyId={other}", {"name": "O " + stamp, "companyId": other,
                                                                                       "uom": "Pcs", "fbrUOMId": 1})["id"]}],
                      supplier=osup, co=other)
awaiting(excludeBillId=other_bill["id"], expected=(404,))
check("excludeBillId of another company refused", True)


def user_with(keys, companies):
    uname = f"demand_{len(keys)}_{stamp}"
    u = call("POST", "/api/users", {"username": uname, "password": "test1234", "fullName": "Demand", "role": "Administrator"})
    role = call("POST", "/api/roles", {"name": f"Demand role {len(keys)} {stamp}", "permissionKeys": keys,
                                       "tenantAdminUserId": u["id"]})
    call("PUT", f"/api/users/{u['id']}/roles", {"roleIds": [role["id"]]})
    call("PUT", f"/api/usercompanies/user/{u['id']}", {"companyIds": companies})
    st, lg = http("POST", "/api/auth/login", a.base, body={"username": uname, "password": "test1234"})
    assert st == 200, (st, lg)
    return lg["token"]


admin_keys = [r for r in call("GET", "/api/roles") if r["name"] == "Administrator"][0]["permissionKeys"]
iso = user_with(admin_keys, [other])
st, _ = http("GET", f"/api/purchasebills/company/{cid}/awaiting-lines", a.base, token=iso)
check("awaiting lines of an unassigned company refused", st == 403)
st, err = http("POST", "/api/purchasebills", a.base, token=iso, body={
    "companyId": other, "supplierId": osup, "date": today, "gstRate": 0, "items": [row(1, [src("challan", dc2l["Washer"], 1)])]})
check("own-company bill cannot claim another company's line", st == 400 and err["error"] == "A customer document line on this bill was not found.", err)
no_bills = user_with(["purchasebills.manage.create", "purchasebills.list.view", "salesorders.list.view", "challans.list.view"], [cid])
kinds = {c["kind"] for c in awaiting(tok=no_bills)}
check("a role without invoices.list.view sees no bill cards", "bill" not in kinds and kinds, kinds)

# ── 4. Buying consumes the trail ──
p1 = purchase([row(100, [src("order", so1l["Bolt"], 100)])])
t = trails()
check("buy_order_line_consumes_challan_and_bill", BOLT not in t and all(BOLT not in trails(groupBy=g) for g in ("order", "bill")))
check("purchase row tags its document", p1["items"][0]["tags"][0]["kind"] == "order" and p1["forDocuments"][0]["number"] == so1["salesOrderNumber"])
call("DELETE", f"/api/purchasebills/{p1['id']}")
p2 = purchase([row(40, [src("bill", b1l["Bolt"], 40)])])
check("partial_buy_leaves_rest_everywhere", all(trails(groupBy=g)[BOLT][1]["left"] == 60 for g in ("latest", "order", "bill")))
combined = purchase([row(8, [src("challan", dc2l["Washer"], 5), src("bill", b2l["Pin"], 3)])], supplier=s2)
t = trails(allSuppliers="true")
check("combined_row", WASHER not in t and PIN not in t and {x["kind"] for x in combined["items"][0]["tags"]} == {"challan", "bill"})
washer = call("GET", f"/api/deliverychallans/{dc2['id']}")["items"][0]
check("unplanned challan line takes the purchase's supplier and cost", washer["supplierId"] == s2 and washer["actualUnitCost"] == 100)
so2, so2l = order([("Spring", 50)])
dc3, dc3l = deliver(so2["id"], [(so2l["Spring"], 50)])
sql(f"UPDATE DeliveryItems SET SupplierId = {s1}, ActualUnitCost = 7 WHERE Id = {dc3l['Spring']}")
purchase([row(30, [src("order", so2l["Spring"], 30)])])
made = call("POST", f"/api/purchasebills/from-challan/{dc3['id']}")
check("create_purchase_bills_buys_only_left", made[0]["items"][0]["quantity"] == 20)
check("whole-challan preview replays the bills it made", call("GET", f"/api/purchasebills/from-challan/{dc3['id']}/preview")["alreadyCreated"])
so4, so4l = order([("Shim", 4)])
dc6, dc6l = deliver(so4["id"], [(so4l["Shim"], 4)])
sql(f"UPDATE DeliveryItems SET SupplierId = {s1}, ActualUnitCost = 2 WHERE Id = {dc6l['Shim']}")
purchase([row(4, [src("order", so4l["Shim"], 4)])])
err = call("GET", f"/api/purchasebills/from-challan/{dc6['id']}/preview", expected=(400,))
check("challan with nothing left refuses whole-challan purchase", "nothing left" in err["error"], err)

# ── 5. Refusals ──
err = purchase([row(61, [src("order", so1l["Bolt"], 61)])], expected=(400,))
check("over_buy_refused", "only 60" in err["error"] and "Order #" in err["error"] and "DC #" in err["error"], err)
err = purchase([row(1, [src("order", so1l["Bolt"], 1)]), row(1, [src("bill", b1l["Bolt"], 1)])], expected=(400,))
check("same_trail_two_rows_refused", "twice" in err["error"], err)
err = purchase([row(3, [src("order", so1l["Bolt"], 4)])], expected=(400,))
check("combined_row_sources_must_not_exceed_row", "more than" in err["error"], err)
part = purchase([row(5, [src("order", so1l["Bolt"], 4)])])
check("row may buy more than its customer line needs", trails()[BOLT][1]["left"] == 56)
call("DELETE", f"/api/purchasebills/{part['id']}")
err = purchase([row(1, [src("challan", ol["Foreign"], 1)])], expected=(400,))
check("foreign_line_refused", err["error"] == "A customer document line on this bill was not found.", err)
dc4, dc4l = challan([("Gasket", 2, None, None)])
call("PUT", f"/api/deliverychallans/{dc4['id']}/cancel")
err = purchase([row(1, [src("challan", dc4l["Gasket"], 1)])], expected=(400,))
check("cancelled_document_refused", err["error"] == "A customer document line on this bill was not found.", err)
edit = [dict(row(i["quantity"], i["sources"], i["unitPrice"], i["description"]), id=i["id"]) for i in p2["items"]]
edit[0]["quantity"] = 100
edit[0]["sources"][0]["quantity"] = 100
call("PUT", f"/api/purchasebills/{p2['id']}", {"gstRate": 0, "items": edit})
edit[0]["quantity"] = 101
edit[0]["sources"][0]["quantity"] = 101
err = call("PUT", f"/api/purchasebills/{p2['id']}", {"gstRate": 0, "items": edit}, expected=(400,))
check("edit_keeps_own_claim", "only 100" in err["error"], err)
edit[0]["quantity"] = 40
edit[0]["sources"][0]["quantity"] = 40
call("PUT", f"/api/purchasebills/{p2['id']}", {"gstRate": 0, "items": edit})
body = {"companyId": cid, "supplierId": s1, "date": today, "gstRate": 0, "items": [row(60, [src("challan", dc1l["Bolt"], 60)])]}
with ThreadPoolExecutor(2) as pool:
    codes = sorted(r[0] for r in pool.map(lambda _: http("POST", "/api/purchasebills", a.base, token=token, body=body), range(2)))
check("simultaneous_bills", codes == [201, 400], codes)
racer = [x for x in call("GET", f"/api/purchasebills/company/{cid}/paged?fromChallan=true&pageSize=50")["items"]
         if x["items"][0]["quantity"] == 60]
call("DELETE", f"/api/purchasebills/{racer[0]['id']}")

# ── 6. Lists ──
paged = call("GET", f"/api/purchasebills/company/{cid}/paged?fromChallan=true&pageSize=50")["items"]
check("source filter includes document purchases", any(x["id"] == p2["id"] for x in paged))
plain = purchase([row(1, [])])
paged = call("GET", f"/api/purchasebills/company/{cid}/paged?fromChallan=false&pageSize=50")["items"]
check("source filter false lists stock purchases", any(x["id"] == plain["id"] for x in paged)
      and not any(x["id"] == p2["id"] for x in paged))
check("challan list shows purchase status",
      {c["id"]: c["purchaseStatus"] for c in call("GET", f"/api/deliverychallans/company/{cid}")}[dc1["id"]] == "Partial")

# ── 7. Guards ──
so3, so3l = order([("Cog", 20), ("Gear", 5)])
p3 = purchase([row(15, [src("order", so3l["Cog"], 15)])])


def so_with(qty, drop_gear=False):
    full = call("GET", f"/api/salesorders/{so3['id']}")
    items = [dict(i, quantity=qty if i["id"] == so3l["Cog"] else i["quantity"]) for i in full["items"]
             if not (drop_gear and i["id"] == so3l["Gear"])]
    return http("PUT", f"/api/salesorders/{so3['id']}", a.base, token=token, body=dict(full, items=items))


st, err = so_with(10)
check("order_qty_below_bought_refused", st == 400 and "15" in str(err) and "purchased" in str(err), (st, err))
st, err = so_with(15, drop_gear=True)
check("order_qty_down_to_bought_allowed", st == 200, (st, err))
st, err = http("PUT", f"/api/salesorders/{so3['id']}/status", a.base, token=token, body={"status": "Cancelled"})
check("order_cancel_refused", st == 400 and "purchased" in str(err), (st, err))
st, err = http("DELETE", f"/api/salesorders/{so3['id']}", a.base, token=token)
check("order_delete_refused", st == 400 and "purchased" in str(err), (st, err))
err = call("PUT", f"/api/deliverychallans/{dc2['id']}/cancel", expected=(400,))
check("challan_cancel_refused", "urchase" in err["error"], err)
st, err = http("POST", f"/api/invoices/{b1['id']}/cancel", a.base, token=token, body={"reason": "test"})
check("bill_cancel_refused", st == 400 and "purchased" in str(err), (st, err))
st, err = http("DELETE", f"/api/invoices/{b1['id']}", a.base, token=token)
check("bill_delete_with_bought_line_refused", st == 400 and "purchased" in str(err), (st, err))
call("DELETE", f"/api/purchasebills/{p2['id']}")
call("DELETE", f"/api/purchasebills/{p3['id']}")
st, _ = http("POST", f"/api/invoices/{b1['id']}/cancel", a.base, token=token, body={"reason": "test"})
st2, _ = http("PUT", f"/api/salesorders/{so3['id']}/status", a.base, token=token, body={"status": "Cancelled"})
check("guards_release_after_purchase_deleted", st == 200 and st2 in (200, 204), (st, st2))

# ── 8. Review fixes ──
# Two lines of one challan on the same order line share what that line has left.
so5, so5l = order([("Rod", 10)])
dc7, dc7l = challan([("Rod A", 6, s1, 3), ("Rod B", 4, s1, 3)])
sql(f"UPDATE DeliveryItems SET SalesOrderItemId = {so5l['Rod']} WHERE Id IN ({dc7l['Rod A']}, {dc7l['Rod B']}); "
    f"UPDATE DeliveryChallans SET SalesOrderId = {so5['id']} WHERE Id = {dc7['id']}")
purchase([row(5, [src("order", so5l["Rod"], 5)])])
pv = call("GET", f"/api/purchasebills/from-challan/{dc7['id']}/preview")
check("whole-challan preview shares one trail's remainder", sum(i["quantity"] for g in pv["suppliers"] for i in g["items"]) == 5, pv)
made7 = call("POST", f"/api/purchasebills/from-challan/{dc7['id']}")
check("whole-challan create buys no more than the trail has left", sum(i["quantity"] for b in made7 for i in b["items"]) == 5)

# A repeated confirmation after part of the challan was bought elsewhere replays the same bills.
dc8, dc8l = challan([("Valve", 2, s1, 40), ("Seal", 3, s2, 6)])
purchase([row(3, [src("challan", dc8l["Seal"], 3)])], supplier=s2)
pv = call("GET", f"/api/purchasebills/from-challan/{dc8['id']}/preview")
req = {"revision": pv["revision"], "date": today,
       "suppliers": [{"supplierId": g["supplierId"], "gstRate": 0, "supplierBillNumber": None} for g in pv["suppliers"]]}
first = call("POST", f"/api/purchasebills/from-challan/{dc8['id']}", req)
again = call("POST", f"/api/purchasebills/from-challan/{dc8['id']}", req)
check("repeated whole-challan confirmation replays the same bills", sorted(b["id"] for b in first) == sorted(b["id"] for b in again))
check("replayed preview shows the bills' quantities",
      [i["quantity"] for g in call("GET", f"/api/purchasebills/from-challan/{dc8['id']}/preview")["suppliers"] for i in g["items"]] == [2])

# A bill line on a purchased challan keeps its quantity; a bought standalone bill line cannot drop below it.
dc9, dc9l = challan([("Pipe", 10, None, None)])
b9, b9l = bill_from(dc9)
purchase([row(10, [src("challan", dc9l["Pipe"], 10)])])
full9 = call("GET", f"/api/invoices/{b9['id']}")
st, err = http("PUT", f"/api/invoices/{b9['id']}", a.base, token=token, body={"gstRate": 18, "items": [
    {"id": i["id"], "description": i["description"], "quantity": 4, "uom": i.get("uom") or "Pcs", "unitPrice": i["unitPrice"]}
    for i in full9["items"]]})
check("bill quantity on a purchased challan refused", st == 400 and "purchased" in str(err), (st, err))
b10, b10l = standalone_bill([("Clamp", 3)])
purchase([row(3, [src("bill", b10l["Clamp"], 3)])])
sql(f"UPDATE Companies SET FbrEnabled = 1 WHERE Id = {cid}")  # this path is the Invoices tab's, open only with FBR on
st, err = http("PATCH", f"/api/invoices/{b10['id']}/itemtypes-and-qty", a.base, token=token, body={
    "writeMode": "bill", "items": [{"id": b10l["Clamp"], "itemTypeId": itype, "quantity": 1}]})
check("bill-mode quantity edit below bought refused", st == 400 and "purchased" in str(err), (st, err))
sql(f"UPDATE Companies SET FbrEnabled = 0 WHERE Id = {cid}")

# ── 9. Company start date: older documents count as settled ──
check("new companies offer every document", call("GET", f"/api/companies/{cid}").get("purchaseDocumentsFrom") is None)
sql(f"UPDATE Companies SET PurchaseDocumentsFrom = DATEADD(day, 1, CAST(GETDATE() AS date)) WHERE Id = {cid}")
check("documents before the start date are not offered", awaiting(groupBy="latest", allSuppliers="true") == [])
sql(f"UPDATE Companies SET PurchaseDocumentsFrom = CAST(GETDATE() AS date) WHERE Id = {cid}")
check("documents on the start date are offered", len(awaiting(groupBy="latest", allSuppliers="true")) > 0)
sql(f"UPDATE Companies SET PurchaseDocumentsFrom = NULL WHERE Id = {cid}")

print(f"{checks}/{checks} purchase demand checks passed")
print(f"Fixture company {cid} kept for browser checks.")
