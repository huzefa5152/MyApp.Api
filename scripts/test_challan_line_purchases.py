"""Purchase bills that pick challan lines (Purchase Bills -> Against Delivery Challans).

One bill buys lines from several challans; a line's purchases never exceed its
delivered quantity; a fully bought line leaves the picker; purchased challans
lock; foreign, cancelled and duplicate lines are refused.

  python scripts/test_challan_line_purchases.py --base http://localhost:5136

Local only: creates a [TEMP] company and leaves it for browser checks.
"""
import argparse
import time
from urllib.parse import urlparse

from test_basic_flows import http

p = argparse.ArgumentParser()
p.add_argument("--base", required=True)
a = p.parse_args()
assert urlparse(a.base).hostname in ("localhost", "127.0.0.1"), "local backends only"

status, login = http("POST", "/api/auth/login", a.base, body={"username": "admin", "password": "admin123"})
assert status == 200, status
token = login["token"]
checks = 0


def check(label, ok):
    global checks
    assert ok, label
    checks += 1
    print("PASS " + label, flush=True)


def call(method, path, body=None, expected=(200, 201, 204)):
    status, data = http(method, path, a.base, token=token, body=body)
    assert status in expected, (method, path, status, data)
    return data


stamp = str(time.time_ns())[-8:]


def company(name):
    c = call("POST", "/api/companies", {"name": f"[TEMP] {name} {stamp}", "inventoryTrackingEnabled": True,
                                        "inventoryFlowVersion": 2, "fbrEnabled": False,
                                        "startingPurchaseBillNumber": 1, "startingChallanNumber": 1})
    return c["id"]


cid = company("Challan line purchases")
client = call("POST", "/api/clients", {"name": "Line buyer " + stamp, "companyId": cid, "registrationType": "Unregistered"})
s1 = call("POST", "/api/suppliers", {"name": "Line supplier A " + stamp, "companyId": cid})["id"]
s2 = call("POST", "/api/suppliers", {"name": "Line supplier B " + stamp, "companyId": cid})["id"]
itype = call("POST", f"/api/itemtypes?companyId={cid}", {"name": "Line item " + stamp, "companyId": cid, "uom": "Pcs",
                                                         "fbrUOMId": 1, "saleType": "Goods at Standard Rate (default)"})["id"]


def challan(lines, co=cid, cl=None):
    body = {"clientId": cl or client["id"], "poNumber": "", "deliveryDate": "2026-01-15T00:00:00Z",
            "items": [{"description": d, "quantity": q, "unit": "Pcs", "itemTypeId": itype if co == cid else None,
                       "supplierId": s, "actualUnitCost": c} for d, q, s, c in lines]}
    ch = call("POST", f"/api/deliverychallans/company/{co}", body)
    return ch, {i["description"]: i["id"] for i in ch["items"]}


c1, l1 = challan([("Bolt", 10, s1, 100), ("Nut", 5, s2, 50)])
c2, l2 = challan([("Washer", 4, None, None)])
c3, l3 = challan([("Gasket", 6, s1, 80)])


def open_lines(**params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    data = call("GET", f"/api/purchasebills/company/{cid}/open-challan-lines?{q}")
    return {l["deliveryItemId"]: (c["challanNumber"], l) for c in data for l in c["lines"]}


ol = open_lines(supplierId=s1)
check("supplier filter lists its own and unplanned lines", {l1["Bolt"], l2["Washer"], l3["Gasket"]} <= set(ol))
check("supplier filter hides another supplier's lines", l1["Nut"] not in ol)
check("all suppliers lists every open line", l1["Nut"] in open_lines(supplierId=s1, allSuppliers="true"))
check("open line carries remaining and planned cost", ol[l1["Bolt"]][1]["remaining"] == 10 and ol[l1["Bolt"]][1]["actualUnitCost"] == 100)


def line(src, qty, price, desc="x"):
    return {"itemTypeId": itype, "description": desc, "quantity": qty, "unitPrice": price, "uom": "Pcs",
            "sourceDeliveryItemId": src}


def bill(items, supplier=s1, expected=(201,), co=cid):
    return call("POST", "/api/purchasebills", {"companyId": co, "supplierId": supplier, "date": "2026-01-20",
                                               "gstRate": 0, "items": items}, expected=expected)


b = bill([line(l1["Bolt"], 6, 100, "Bolt"), line(l2["Washer"], 4, 30, "Washer"), line(l3["Gasket"], 6, 80, "Gasket")])
check("one bill buys lines from three challans", sorted(c["challanNumber"] for c in b["linkedChallans"]) ==
      sorted([c1["challanNumber"], c2["challanNumber"], c3["challanNumber"]]))
check("each bill line names its challan", {i["sourceChallanNumber"] for i in b["items"]} ==
      {c1["challanNumber"], c2["challanNumber"], c3["challanNumber"]})

ol = open_lines(supplierId=s1)
check("partly bought line shows what is left", ol[l1["Bolt"]][1]["remaining"] == 4 and ol[l1["Bolt"]][1]["purchased"] == 6)
check("fully bought lines leave the picker", l2["Washer"] not in ol and l3["Gasket"] not in ol)

washer = call("GET", f"/api/deliverychallans/{c2['id']}")["items"][0]
check("unplanned line takes the purchase's supplier and cost", washer["supplierId"] == s1 and washer["actualUnitCost"] == 30)

err = bill([line(l1["Bolt"], 5, 100)], expected=(400,))
check("over-purchase refused with what is left", "only 4" in err["error"] and f"#{c1['challanNumber']}" in err["error"])
err = bill([line(l1["Bolt"], 1, 100), line(l1["Bolt"], 1, 100)], expected=(400,))
check("same challan line twice on one bill refused", "twice" in err["error"])
check("refused saves create nothing", len(open_lines(supplierId=s1)) == len(ol))

# Another company's challan line, named in this company's bill.
other = company("Line purchases other")
oc = call("POST", "/api/clients", {"name": "Other buyer " + stamp, "companyId": other, "registrationType": "Unregistered"})
_, ol_other = challan([("Foreign", 3, None, None)], co=other, cl=oc["id"])
err = bill([line(ol_other["Foreign"], 1, 10)], expected=(400,))
check("another company's challan line refused", "not found" in err["error"])
call("GET", f"/api/purchasebills/company/{other}/open-challan-lines?excludeBillId={b['id']}", expected=(404,))
check("excludeBillId from another company refused", True)

# A user given only the other company, with every permission (Administrator role).
uname = "line_iso_" + stamp
admin_role = next(r["id"] for r in call("GET", "/api/roles") if r["name"] == "Administrator")
u = call("POST", "/api/users", {"username": uname, "password": "test1234", "fullName": "Line Iso", "role": "Administrator"})
call("PUT", f"/api/users/{u['id']}/roles", {"roleIds": [admin_role]})
call("PUT", f"/api/usercompanies/user/{u['id']}", {"companyIds": [other]})
st, iso = http("POST", "/api/auth/login", a.base, body={"username": uname, "password": "test1234"})
assert st == 200, st
iso_token = iso["token"]
st, _ = http("GET", f"/api/purchasebills/company/{cid}/open-challan-lines", a.base, token=iso_token)
check("open lines of an unassigned company refused", st == 403)
st, _ = http("GET", f"/api/purchasebills/company/{other}/open-challan-lines", a.base, token=iso_token)
check("open lines of the assigned company allowed", st == 200)
st, err = http("POST", "/api/purchasebills", a.base, token=iso_token, body={
    "companyId": other, "supplierId": call("POST", "/api/suppliers", {"name": "Iso supplier " + stamp, "companyId": other})["id"],
    "date": "2026-01-20", "gstRate": 0, "items": [line(l1["Bolt"], 1, 1)]})
check("own-company bill cannot claim another company's challan line", st == 400 and "not found" in err["error"])

# Edit: the bill's own claim counts as open while it is edited.
edit_items = [dict(line(i["sourceDeliveryItemId"], i["quantity"], i["unitPrice"], i["description"]), id=i["id"]) for i in b["items"]]
edit_items[0]["quantity"] = 10
upd = call("PUT", f"/api/purchasebills/{b['id']}", {"gstRate": 0, "items": edit_items})
check("edit may take the rest of a line", next(i for i in upd["items"] if i["sourceDeliveryItemId"] == l1["Bolt"])["quantity"] == 10)
edit_items[0]["quantity"] = 11
err = call("PUT", f"/api/purchasebills/{b['id']}", {"gstRate": 0, "items": edit_items}, expected=(400,))
check("edit cannot exceed the delivered quantity", "only 10" in err["error"])

lst = {c["id"]: c for c in call("GET", f"/api/deliverychallans/company/{cid}")}
check("challan fully bought reads Purchased", lst[c3["id"]]["purchaseStatus"] == "Purchased")
check("challan partly bought reads Partial", lst[c1["id"]]["purchaseStatus"] == "Partial")

err = call("PUT", f"/api/deliverychallans/{c1['id']}/cancel", expected=(400,))
check("challan with purchased lines cannot be cancelled", "urchase" in err["error"])
call("DELETE", f"/api/deliverychallans/items/{l1['Nut']}", expected=(400,))
check("challan with purchased lines keeps its lines", True)
err = call("GET", f"/api/purchasebills/from-challan/{c1['id']}/preview", expected=(400,))
check("whole-challan purchase refused once lines are bought", "already on a purchase bill" in err["error"])

c4, l4 = challan([("Spring", 2, None, None)])
call("PUT", f"/api/deliverychallans/{c4['id']}/cancel")
err = bill([line(l4["Spring"], 1, 10)], expected=(400,))
check("cancelled challan's line refused", "cancelled" in err["error"])

# Whole-challan purchase links lines, so the picker never offers them again.
c5, l5 = challan([("Pin", 3, s2, 20)])
made = call("POST", f"/api/purchasebills/from-challan/{c5['id']}")
check("whole-challan purchase links its lines", made[0]["items"][0]["sourceDeliveryItemId"] == l5["Pin"])
check("whole-challan purchase hides the challan from the picker", l5["Pin"] not in open_lines(allSuppliers="true"))
err = bill([line(l5["Pin"], 1, 20)], supplier=s2, expected=(400,))
check("line bought by the challan's own purchase refused", "fully purchased" in err["error"])

paged = call("GET", f"/api/purchasebills/company/{cid}/paged?fromChallan=true&pageSize=50")
check("challan source filter includes line-picked bills", any(x["id"] == b["id"] for x in paged["items"]))

call("DELETE", f"/api/purchasebills/{b['id']}")
ol = open_lines(supplierId=s1)
check("deleting the bill frees its lines", {l1["Bolt"], l2["Washer"], l3["Gasket"]} <= set(ol) and ol[l1["Bolt"]][1]["remaining"] == 10)
check("challan with no purchases has no status", call("GET", f"/api/deliverychallans/{c3['id']}")["purchaseStatus"] == "")

# Two bills saved at once for 6 of the 10 left: the row lock lets one through.
from concurrent.futures import ThreadPoolExecutor
body = {"companyId": cid, "supplierId": s1, "date": "2026-01-21", "gstRate": 0, "items": [line(l1["Bolt"], 6, 100)]}
with ThreadPoolExecutor(2) as pool:
    codes = sorted(r[0] for r in pool.map(lambda _: http("POST", "/api/purchasebills", a.base, token=token, body=body), range(2)))
check("simultaneous bills cannot both take the same remainder", codes == [201, 400])
race = call("GET", f"/api/purchasebills/company/{cid}/paged?fromChallan=true&pageSize=50")["items"]
for x in race:
    if any(i["sourceDeliveryItemId"] == l1["Bolt"] for i in x["items"]):
        call("DELETE", f"/api/purchasebills/{x['id']}")
call("PUT", f"/api/deliverychallans/{c1['id']}/cancel")
check("challan cancels once its purchases are gone", True)

print(f"{checks}/{checks} challan line purchase checks passed")
print(f"Fixture company {cid} kept for browser checks.")
