"""Local-only: a challan change resets the consultant's filing work and never blocks the tax invoice print.

Runs the same story for a company that groups its tax invoice and for one that prints its original
bill lines. Never submits to FBR.
"""
import argparse
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import uuid4

from test_tenant_leak_sweep import company_payload, http

parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://localhost:5134")
args = parser.parse_args()
assert urlparse(args.base).hostname in ("localhost", "127.0.0.1", "::1")
status, login = http("POST", "/api/auth/login", args.base, body={"username": "admin", "password": "admin123"})
assert status == 200, status
token = login["token"]
passed = failed = 0


def call(method, path, body=None):
    status, data = http(method, path, args.base, token, body)
    assert status in (200, 201, 204), (method, path, status, data)
    return data


def check(ok, label, detail=""):
    global passed, failed
    passed, failed = passed + bool(ok), failed + (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + ("" if ok else f"  ({detail})"), flush=True)


def story(label, original_lines):
    print(f"\n=== {label} ===")
    company = company_payload(f"[TEMP] Reset filing {uuid4().hex[:8]}")
    company.update(fbrToken="local-fixture-token", fbrBusinessActivity="Importer", fbrSector="Other")
    cid = call("POST", "/api/companies", company)["id"]
    try:
        if original_lines:
            co = call("GET", f"/api/companies/{cid}")
            call("PUT", f"/api/companies/{cid}", {**co, "taxInvoiceUseOriginalBillLines": True})
        client = call("POST", "/api/clients", {"companyId": cid, "name": "[TEMP] Reset buyer", "address": "Sample address",
                                               "ntn": "1234567", "registrationType": "Registered", "fbrProvinceCode": 8})
        plain = call("POST", "/api/itemtypes", {"companyId": cid, "name": "[TEMP] Commercial item", "uom": "Nos"})
        filing = call("POST", "/api/itemtypes", {"companyId": cid, "name": "[TEMP] Filing classification", "uom": "Nos",
                                                 "hsCode": "9403.6000", "saleType": "Goods at standard rate (default)",
                                                 "fbrUOMId": 13})
        today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

        def challan(name, qty):
            return call("POST", f"/api/deliverychallans/company/{cid}", {
                "companyId": cid, "clientId": client["id"], "poNumber": "LOCAL-" + name, "poDate": today,
                "deliveryDate": today,
                "items": [{"description": name, "quantity": qty, "unit": "Nos", "itemTypeId": plain["id"]}]})

        first, second = challan("First", 40), challan("Second", 5)
        bill = call("POST", "/api/invoices", {"companyId": cid, "clientId": client["id"], "date": today, "gstRate": 18,
                                              "challanIds": [first["id"]],
                                              "items": [{"deliveryItemId": first["items"][0]["id"], "unitPrice": 585}]})
        iid = bill["id"]
        path = f"/api/invoices/{iid}"

        def set_challan_qty(qty):
            ch = call("GET", f"/api/deliverychallans/{first['id']}")
            ch["items"][0]["quantity"] = qty
            call("PUT", f"/api/deliverychallans/{first['id']}", ch)

        def printed():
            status, data = http("GET", path + "/print/tax-invoice", args.base, token)
            return status, data

        def prints_bill(name, subtotal, qty=None):
            status, data = printed()
            ok = status == 200 and abs(sum(r["valueExclTax"] for r in data["items"]) - subtotal) < .01
            if ok and qty is not None:
                ok = abs(sum(r["quantity"] for r in data["items"]) - qty) < .001
            check(ok, name, f"{status} {data.get('items') if status == 200 else data}")

        def review(qty):
            editor = call("GET", path + "/tax-filing")
            rows = [{"sourceLineIds": [i["id"]], "itemTypeId": filing["id"], "quantity": i["quantity"] if qty is None else qty,
                     "valueExclTax": i["lineTotal"]} for i in editor["bill"]["items"]]
            return call("PUT", path + "/tax-filing", {"version": editor["version"], "rows": rows})

        # Before any consultant work, a challan change is just a bill change.
        set_challan_qty(50)
        bill = call("GET", path)
        check(bill["subtotal"] == 29250 and not bill["fbrReviewRequired"], "challan 40 to 50 before consultant work: bill follows, no review", str(bill["subtotal"]))
        prints_bill("tax invoice prints 50 before consultant work", 29250, 50)

        # The consultant classifies and adjusts the quantity.
        saved = review(45)
        check(not saved["requiresReview"] and saved["hasSavedRows"] and saved["bill"]["fbrReady"], "consultant adjustment saves and is ready")
        prints_bill("tax invoice prints after the adjustment", 29250)

        # The challan changes again: the adjustment is reset, nothing is blocked.
        set_challan_qty(60)
        state = call("GET", path + "/tax-filing")
        check(state["bill"]["subtotal"] == 35100, "challan 50 to 60 after the adjustment: bill follows", str(state["bill"]["subtotal"]))
        check(state["requiresReview"] and state["bill"]["fbrReviewRequired"] and not state["bill"]["fbrReady"],
              "the reset bill needs the consultant again and is not FBR ready")
        check("HS code choices are kept" in (state.get("reviewReason") or ""), "the consultant is told what was kept and what was reset", str(state.get("reviewReason")))
        check(state["hasSavedRows"] and [(r["quantity"], r["valueExclTax"], r["hsCode"], r["itemTypeId"]) for r in state["rows"]]
              == [(60, 35100, "9403.6000", filing["id"])],
              "the saved row keeps its item and HS code and takes the bill's 60", str(state["rows"]))
        prints_bill("tax invoice prints the latest bill (60), not the old adjustment", 35100, 60)
        status, data = printed()
        check(status == 200 and [r.get("hsCode") for r in data["items"]] == ["9403.6000"], "the kept HS code still prints", str(data.get("items") if status == 200 else status))
        status, _ = http("GET", path + "/print/bill", args.base, token)
        check(status == 200, "bill print still works", str(status))

        # The consultant adjusts again and that adjustment is kept.
        saved = review(55)
        check(not saved["requiresReview"] and saved["bill"]["fbrReady"] and saved.get("reviewReason") is None, "re-adjustment after the reset saves and clears the message")
        again = call("GET", path + "/tax-filing")
        check(again["hasSavedRows"] and [r["quantity"] for r in again["rows"]] == [55] and not again["requiresReview"],
              "the re-adjustment is kept on reload", str(again["rows"]))
        opts = call("GET", path + "/challans")
        noop = call("PUT", path + "/challans", {"version": opts["version"], "challanIds": [first["id"]],
                                                "addedChallanVersions": {}, "unitPrices": {}})
        again = call("GET", path + "/tax-filing")
        check(not noop["fbrReviewRequired"] and [r["quantity"] for r in again["rows"]] == [55],
              "a challan save that changes nothing keeps the re-adjustment", str(again["rows"]))
        set_challan_qty(60)
        again = call("GET", path + "/tax-filing")
        check(again["hasSavedRows"] and not again["requiresReview"], "saving the challan with the same quantity keeps the re-adjustment")

        # A direct bill edit leaves the rows for comparison, flags the review and still prints.
        bill = call("GET", path)
        bill["items"][0]["description"] = "Changed supply"
        call("PUT", path, bill)
        state = call("GET", path + "/tax-filing")
        check(state["requiresReview"] and state["hasSavedRows"] and "no longer match" in (state.get("reviewReason") or ""),
              "direct bill edit: rows kept, review required, reason shown", str(state.get("reviewReason")))
        prints_bill("tax invoice is not blocked by rows saved against the older bill", 35100, 60)
        review(None)

        # Adding a challan resets too, and the print covers both lines.
        opts = call("GET", path + "/challans")
        available = next(x for x in opts["available"] if x["id"] == second["id"])
        changed = call("PUT", path + "/challans", {
            "version": opts["version"], "challanIds": [first["id"], second["id"]],
            "addedChallanVersions": {str(second["id"]): available["version"]},
            "unitPrices": {str(x["id"]): 100 for x in available["items"]}})
        state = call("GET", path + "/tax-filing")
        check(changed["fbrReviewRequired"] and state["requiresReview"] and len(state["rows"]) == 2
              and state["rows"][0]["hsCode"] == "9403.6000" and state["rows"][0]["quantity"] == 60
              and not state["rows"][1].get("hsCode") and state["rows"][1]["quantity"] == 5,
              "adding a challan keeps the classified row and adds an unclassified row for the new line", str(state["rows"]))
        prints_bill("tax invoice prints both lines after the addition", 35600, 65)
        # Two lines under one HS code are one FBR item, so the consultant files them as one combined row.
        editor = call("GET", path + "/tax-filing")
        lines = editor["bill"]["items"]
        saved = call("PUT", path + "/tax-filing", {"version": editor["version"], "rows": [{
            "sourceLineIds": [i["id"] for i in lines], "itemTypeId": filing["id"],
            "quantity": sum(i["quantity"] for i in lines), "valueExclTax": sum(i["lineTotal"] for i in lines)}]})
        check(not saved["requiresReview"] and saved["bill"]["fbrReady"], "consultant classifies both lines and the bill is ready again")
        prints_bill("tax invoice prints the full bill value after the final review", 35600)
    finally:
        call("DELETE", f"/api/companies/{cid}")


def print_shape(mode):
    """The tax invoice keeps the company's layout through a reset: grouped by item type, or each original line."""
    print(f"\n=== Print layout: {mode} ===")
    company = company_payload(f"[TEMP] Layout {mode} {uuid4().hex[:8]}")
    company.update(fbrToken="local-fixture-token", fbrBusinessActivity="Importer", fbrSector="Other",
                   defaultGroupTaxInvoiceByItemType=mode == "grouped")
    cid = call("POST", "/api/companies", company)["id"]
    try:
        if mode == "original":
            co = call("GET", f"/api/companies/{cid}")
            call("PUT", f"/api/companies/{cid}", {**co, "taxInvoiceUseOriginalBillLines": True})
        client = call("POST", "/api/clients", {"companyId": cid, "name": "[TEMP] Layout buyer", "address": "Sample address",
                                               "ntn": "1234567", "registrationType": "Registered", "fbrProvinceCode": 8})
        plain = call("POST", "/api/itemtypes", {"companyId": cid, "name": "[TEMP] Commercial item", "uom": "Nos"})
        filing = call("POST", "/api/itemtypes", {"companyId": cid, "name": "[TEMP] Filing classification", "uom": "Nos",
                                                 "hsCode": "9403.6000", "saleType": "Goods at standard rate (default)",
                                                 "fbrUOMId": 13})
        today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

        def challan(name, lines):
            return call("POST", f"/api/deliverychallans/company/{cid}", {
                "companyId": cid, "clientId": client["id"], "poNumber": "LOCAL-" + name, "poDate": today, "deliveryDate": today,
                "items": [{"description": d, "quantity": q, "unit": "Nos", "itemTypeId": plain["id"]} for d, q in lines]})

        first, second = challan("One", [("Alpha", 10), ("Beta", 20)]), challan("Two", [("Gamma", 1), ("Delta", 2)])
        bill = call("POST", "/api/invoices", {"companyId": cid, "clientId": client["id"], "date": today, "gstRate": 18,
                                              "challanIds": [first["id"]],
                                              "items": [{"deliveryItemId": i["id"], "unitPrice": 100} for i in first["items"]]})
        path = f"/api/invoices/{bill['id']}"

        def shape(name, rows, qty, value, coded=None):
            status, data = http("GET", path + "/print/tax-invoice", args.base, token)
            items = data["items"] if status == 200 else []
            ok = (status == 200 and len(items) == rows and abs(sum(i["quantity"] for i in items) - qty) < .001
                  and abs(sum(i["valueExclTax"] for i in items) - value) < .01
                  and abs(data["subtotal"] - value) < .01
                  and (coded is None or sum(1 for i in items if i.get("hsCode") == "9403.6000") == coded))
            check(ok, name, f"{status} {[(i['quantity'], i['valueExclTax'], i.get('hsCode'), i.get('description')) for i in items]}")

        grouped, original = mode == "grouped", mode == "original"
        shape("before consultant work: " + ("one grouped row" if grouped else "each line"), 1 if grouped else 2, 30, 3000)

        editor = call("GET", path + "/tax-filing")
        lines = editor["bill"]["items"]
        rows = ([{"sourceLineIds": [i["id"]], "itemTypeId": filing["id"], "quantity": i["quantity"], "valueExclTax": i["lineTotal"]} for i in lines]
                if original else
                [{"sourceLineIds": [i["id"] for i in lines], "itemTypeId": filing["id"], "quantity": 30, "valueExclTax": 3000}])
        call("PUT", path + "/tax-filing", {"version": editor["version"], "rows": rows})
        shape("after classification", 2 if original else 1, 30, 3000, 2 if original else 1)

        ch = call("GET", f"/api/deliverychallans/{first['id']}")
        ch["items"][0]["quantity"] = 15
        call("PUT", f"/api/deliverychallans/{first['id']}", ch)
        shape("challan quantity change keeps the layout and the HS code", 2 if original else 1, 35, 3500, 2 if original else 1)
        if original:
            status, data = http("GET", path + "/print/tax-invoice", args.base, token)
            check(sorted((i["description"], i["quantity"]) for i in data["items"]) == [("Alpha", 15), ("Beta", 20)],
                  "original lines print their own descriptions and new quantities", str(data["items"]))

        opts = call("GET", path + "/challans")
        available = next(x for x in opts["available"] if x["id"] == second["id"])
        call("PUT", path + "/challans", {"version": opts["version"], "challanIds": [first["id"], second["id"]],
                                         "addedChallanVersions": {str(second["id"]): available["version"]},
                                         "unitPrices": {str(x["id"]): 100 for x in available["items"]}})
        expected = {"grouped": 2, "individual": 3, "original": 4}[mode]
        shape("added challan: new lines " + ("join one grouped row" if grouped else "print line by line"), expected, 38, 3800,
              2 if original else 1)
    finally:
        call("DELETE", f"/api/companies/{cid}")


story("Individual lines company", False)
story("Original bill lines company", True)
for layout in ("grouped", "individual", "original"):
    print_shape(layout)
print(f"\n=== {passed}/{passed + failed} challan reset checks passed ===")
sys.exit(1 if failed else 0)
