"""Supplier and actual cost on a line ARE the local purchase (Trader, 2026-10-19).

Every save of a challan, standalone bill or costing dialog keeps one automatic
supplier purchase per (document, supplier) in step with the costs while it is
unpaid and uncredited. Paid, credited and manually entered supplier bills are
fixed: the automatic purchase only covers what they leave, and nothing may
drop below them. Closed accounting periods refuse the change.

Runs against a local backend on disposable companies. --db adds the checks
that need SQL (FBR-filed state, stock and ledger rows).

    python scripts/test_cost_purchase_sync.py --base http://localhost:5135 --db "<local conn>"
"""
import argparse
from datetime import date, timedelta
from test_basic_flows import http, setup
from test_accounting_posting import sql


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--db", default=None)
    args = ap.parse_args()
    if args.db:
        parts = dict(p.strip().lower().split("=", 1) for p in args.db.split(";") if "=" in p)
        assert parts.get("server") == r".\mssqlserver02", "SQL checks require the local SQL instance"
    token, company, client = setup(args.base, "admin", "admin123")
    cid = company["id"]
    today = date.today().isoformat()
    passed = 0
    other = None
    users = []

    def call(method, path, body=None, expected=(200, 201), auth=None):
        status, data = http(method, path, args.base, token=auth or token, body=body)
        assert status in expected, f"{method} {path}: {status}: {data}"
        return data

    def check(name, condition):
        nonlocal passed
        assert condition, name
        passed += 1
        print(f"PASS {name}")

    def purchases(**where):
        rows = call("GET", f"/api/purchasebills/company/{cid}/paged?pageSize=100")["items"]
        return sorted([p for p in rows if all(p.get(k) == v for k, v in where.items())], key=lambda p: p["id"])

    def auto(challan=None, bill=None):
        rows = purchases(source="auto-cost")
        return [call("GET", f"/api/purchasebills/{p['id']}") for p in rows
                if (challan is None or p.get("sourceDeliveryChallanId") == challan) and (bill is None or p.get("sourceInvoiceId") == bill)]

    def by_supplier(rows):
        return {p["supplierId"]: p for p in rows}

    def lines(p):
        return sorted((i["description"], float(i["quantity"]), float(i["unitPrice"])) for i in p["items"])

    def challan(items, day=today, po="SYNC-PO", expected=(200, 201)):
        return call("POST", f"/api/deliverychallans/company/{cid}", {"clientId": client["id"], "poNumber": po, "deliveryDate": day,
            "items": items}, expected=expected)

    def edit(c, mutate, expected=(200,)):
        current = call("GET", f"/api/deliverychallans/{c['id']}")
        body = dict(current); body["items"] = [dict(i) for i in current["items"]]
        mutate(body)
        return call("PUT", f"/api/deliverychallans/{c['id']}", body, expected=expected)

    def costs(kind, ident):
        return call("GET", f"/api/commercial-costs/{kind}/{ident}")

    def save(kind, ident, data, expected=(200,)):
        return call("PATCH", f"/api/commercial-costs/{kind}/{ident}", {"version": data["version"],
            "items": [{k: i.get(k) for k in ("id", "supplierId", "actualUnitCost")} for i in data["items"]]}, expected=expected)

    def pay(purchase_id, supplier_id, amount=1):
        call("POST", f"/api/payments/payments/company/{cid}", {"date": today, "contactType": "Supplier", "contactId": supplier_id,
            "method": "Cash", "allocations": [{"purchaseBillId": purchase_id, "amount": amount}]})

    try:
        call("POST", f"/api/accounts/company/{cid}/seed-wholesale")
        A = call("POST", "/api/suppliers", {"companyId": cid, "name": "Sync Supplier A"})["id"]
        B = call("POST", "/api/suppliers", {"companyId": cid, "name": "Sync Supplier B"})["id"]

        # ── 1. Create: two suppliers across three lines ──────────────────
        c = challan([{"description": "Cable", "quantity": 10, "unit": "Pcs", "supplierId": A, "actualUnitCost": 5},
                     {"description": "Conduit", "quantity": 4, "unit": "Pcs", "supplierId": A, "actualUnitCost": 20},
                     {"description": "Board", "quantity": 2, "unit": "Pcs", "supplierId": B, "actualUnitCost": 300}])
        rows = by_supplier(auto(challan=c["id"]))
        check("saving a challan books one purchase per supplier", set(rows) == {A, B})
        check("supplier A's purchase holds both of its lines", lines(rows[A]) == [("Cable", 10, 5), ("Conduit", 4, 20)] and rows[A]["grandTotal"] == 130)
        check("supplier B's purchase holds its one line", lines(rows[B]) == [("Board", 2, 300)] and rows[B]["grandTotal"] == 600)
        check("automatic purchases are local, GST 0 and dated like the challan",
            all(p["purchaseCategory"] == "LocalDirect" and p["gstRate"] == 0 and p["date"][:10] == today for p in rows.values()))
        check("no purchase warning on a clean save", not c.get("purchaseWarning"))
        a_id, b_id = rows[A]["id"], rows[B]["id"]
        cc = costs("challan", c["id"])
        check("costing shows every booked line as purchased", all(i["remainingQuantity"] == 0 for i in cc["items"]) and cc["actualAmount"] == 730)

        blank = challan([{"description": "No cost", "quantity": 1, "unit": "Pcs", "supplierId": A},
                         {"description": "No supplier", "quantity": 1, "unit": "Pcs", "actualUnitCost": 9},
                         {"description": "Nothing", "quantity": 1, "unit": "Pcs"}])
        check("a line needs both a supplier and a cost to be booked", auto(challan=blank["id"]) == [])

        # ── 2. Edit: purchases follow the lines ─────────────────────────
        edit(c, lambda b: b["items"][2].update(actualUnitCost=310))
        rows = by_supplier(auto(challan=c["id"]))
        check("a cost change updates the same purchase", rows[B]["id"] == b_id and rows[B]["grandTotal"] == 620)
        edit(c, lambda b: b["items"][1].update(supplierId=B))
        rows = by_supplier(auto(challan=c["id"]))
        check("moving a line to another supplier moves it between purchases",
            lines(rows[A]) == [("Cable", 10, 5)] and lines(rows[B]) == [("Board", 2, 310), ("Conduit", 4, 20)] and rows[A]["id"] == a_id)
        edit(c, lambda b: b["items"][0].update(quantity=12))
        check("a quantity change resizes the purchase", lines(by_supplier(auto(challan=c["id"]))[A]) == [("Cable", 12, 5)])
        edit(c, lambda b: b["items"][0].update(supplierId=None))
        rows = by_supplier(auto(challan=c["id"]))
        check("clearing a supplier removes that supplier's purchase", A not in rows and purchases(id=a_id) == [])
        edit(c, lambda b: b["items"].append({"id": 0, "description": "Switch", "quantity": 3, "unit": "Pcs", "supplierId": A, "actualUnitCost": 7}))
        rows = by_supplier(auto(challan=c["id"]))
        check("a new costed line is booked on save", lines(rows[A]) == [("Switch", 3, 7)])
        before = [p["id"] for p in purchases(source="auto-cost")]
        numbers = [p["purchaseBillNumber"] for p in purchases(source="auto-cost")]
        edit(c, lambda b: None)
        check("saving with no changes books nothing new and renumbers nothing",
            [p["id"] for p in purchases(source="auto-cost")] == before and [p["purchaseBillNumber"] for p in purchases(source="auto-cost")] == numbers)
        switch_id = next(i["id"] for i in call("GET", f"/api/deliverychallans/{c['id']}")["items"] if i["description"] == "Switch")
        edit(c, lambda b: b.update(items=[i for i in b["items"] if i["id"] != switch_id]))
        check("removing a line drops it from its purchase", A not in by_supplier(auto(challan=c["id"])))
        moved = (date.today() - timedelta(days=1)).isoformat()
        edit(c, lambda b: b.update(deliveryDate=moved))
        check("a challan date change moves its purchases' date", all(p["date"][:10] == moved for p in auto(challan=c["id"])))
        edit(c, lambda b: b.update(deliveryDate=today))

        # ── 3. Header paperwork on an automatic purchase survives re-syncs ──
        pb = by_supplier(auto(challan=c["id"]))[B]
        call("PUT", f"/api/purchasebills/{pb['id']}", {"supplierId": B, "date": pb["date"], "gstRate": 10, "supplierBillNumber": "SUP-INV-1",
            "items": [{"id": i["id"], "description": "edited", "quantity": 99, "uom": i["uom"], "unitPrice": 1} for i in pb["items"]]})
        pb = call("GET", f"/api/purchasebills/{pb['id']}")
        check("an automatic purchase takes the supplier's reference and GST but keeps its lines",
            pb["supplierBillNumber"] == "SUP-INV-1" and pb["gstRate"] == 10 and lines(pb) == [("Board", 2, 310), ("Conduit", 4, 20)] and pb["grandTotal"] == 770)
        call("PUT", f"/api/purchasebills/{pb['id']}", {"supplierId": A, "date": pb["date"], "gstRate": 10, "items": []}, expected=(400,))
        check("an automatic purchase's supplier cannot be changed there", True)
        call("DELETE", f"/api/purchasebills/{pb['id']}", expected=(400,))
        check("an automatic purchase cannot be deleted directly", True)
        edit(c, lambda b: b["items"][1].update(actualUnitCost=25))
        pb = call("GET", f"/api/purchasebills/{pb['id']}")
        check("a later cost change keeps the reference and GST", pb["supplierBillNumber"] == "SUP-INV-1" and pb["gstRate"] == 10 and pb["subtotal"] == 720 and pb["grandTotal"] == 792)

        # ── 4. Lock once paid ───────────────────────────────────────────
        pay(pb["id"], B, 50)
        edit(c, lambda b: b["items"][2].update(actualUnitCost=400))
        locked = call("GET", f"/api/purchasebills/{pb['id']}")
        check("a paid purchase no longer follows the costs", locked["subtotal"] == 720)
        loaded = call("GET", f"/api/deliverychallans/{c['id']}")
        check("the challan reports the locked quantity per line",
            [i["lockedPurchaseQuantity"] for i in loaded["items"]] == [0, 4, 2])
        cc = costs("challan", c["id"])
        check("costing shows the paid line as purchased at what was booked", cc["items"][2]["purchasedAmount"] == 620 and cc["items"][2]["lockedQuantity"] == 2)
        edit(c, lambda b: b["items"][2].update(quantity=3))
        extra = [p for p in auto(challan=c["id"]) if p["id"] != pb["id"]]
        check("more quantity on a paid line is booked as a new purchase", len(extra) == 1 and lines(extra[0]) == [("Board", 1, 400)])
        edit(c, lambda b: b["items"][2].update(quantity=1), expected=(400,))
        check("a line cannot drop below the quantity on a paid purchase", True)
        edit(c, lambda b: b.update(items=b["items"][:2]), expected=(400,))
        check("a line on a paid purchase cannot be removed", True)
        call("PUT", f"/api/deliverychallans/{c['id']}/cancel", expected=(400,))
        check("a challan with a paid purchase cannot be cancelled", True)
        call("POST", "/api/purchasedebitnotes", {"companyId": cid, "supplierId": B, "purchaseBillId": extra[0]["id"], "date": today, "gstRate": 0,
            "items": [{"description": "Credit", "quantity": 1, "uom": "Pcs", "unitPrice": 1}]})
        edit(c, lambda b: b["items"][2].update(actualUnitCost=410))
        check("a credited purchase is locked too", lines(call("GET", f"/api/purchasebills/{extra[0]['id']}")) == [("Board", 1, 400)])

        # ── 5. An entered supplier bill takes precedence ───────────────
        m = challan([{"description": "Pipe", "quantity": 10, "unit": "Pcs", "supplierId": A, "actualUnitCost": 10}])
        pipe = m["items"][0]["id"]
        src = call("GET", f"/api/purchasebills/company/{cid}/local-purchase-sources/challan/{m['id']}")
        check("the picker offers the full line while only an automatic purchase holds it", src["items"][0]["remainingQuantity"] == 10)
        manual = call("POST", "/api/purchasebills", {"companyId": cid, "supplierId": B, "date": today, "purchaseCategory": "LocalDirect", "gstRate": 0,
            "items": [{"description": "Pipe from B", "quantity": 4, "uom": "Pcs", "unitPrice": 11, "localDeliveryItemId": pipe}]})
        check("an entered supplier bill shrinks the automatic purchase", lines(auto(challan=m["id"])[0]) == [("Pipe", 6, 10)])
        cc = costs("challan", m["id"])
        check("costing adds the entered bill and the automatic purchase", cc["items"][0]["purchasedAmount"] == 104 and cc["items"][0]["remainingQuantity"] == 0)
        call("POST", "/api/purchasebills", {"companyId": cid, "supplierId": B, "date": today, "purchaseCategory": "LocalDirect", "gstRate": 0,
            "items": [{"description": "Too much", "quantity": 7, "uom": "Pcs", "unitPrice": 11, "localDeliveryItemId": pipe}]}, expected=(400,))
        check("entered bills still cannot exceed the line", True)
        call("DELETE", f"/api/purchasebills/{manual['id']}")
        check("deleting the entered bill gives the quantity back to the costs", lines(auto(challan=m["id"])[0]) == [("Pipe", 10, 10)])

        # ── 6. Billed, FBR-filed and standalone bills ──────────────────
        bill = call("POST", "/api/invoices", {"companyId": cid, "clientId": client["id"], "date": today, "gstRate": 0,
            "challanIds": [m["id"]], "items": [{"deliveryItemId": pipe, "unitPrice": 20}]})
        if args.db:
            sql(args.db, f"UPDATE Invoices SET FbrStatus='Submitted', FbrSubmittedAt=GETUTCDATE(), FbrIRN='SYNC-TEST' WHERE Id={bill['id']} AND CompanyId={cid}")
        bd = costs("bill", bill["id"])
        bd["items"][0]["actualUnitCost"] = 12
        save("bill", bill["id"], bd)
        check("a billed (and filed) challan's cost still books, against its challan", lines(auto(challan=m["id"])[0]) == [("Pipe", 10, 12)])
        if args.db:
            check("filing state is untouched by costing", call("GET", f"/api/invoices/{bill['id']}")["fbrIRN"] == "SYNC-TEST")
        sb = call("POST", "/api/invoices/standalone", {"companyId": cid, "clientId": client["id"], "date": today, "gstRate": 0,
            "items": [{"description": "Service kit", "quantity": 3, "uom": "Pcs", "unitPrice": 50, "supplierId": A, "actualUnitCost": 30}]})
        check("a standalone bill's costed line is booked at creation", [lines(p) for p in auto(bill=sb["id"])] == [[("Service kit", 3, 30)]])
        inv = call("GET", f"/api/invoices/{sb['id']}")
        upd = {"gstRate": 0, "items": [{"id": i["id"], "description": i["description"], "quantity": 2, "uom": i.get("uom") or "Pcs", "unitPrice": float(i["unitPrice"])} for i in inv["items"]]}
        call("PUT", f"/api/invoices/{sb['id']}", upd)
        check("a bill quantity edit resizes its purchase", [lines(p) for p in auto(bill=sb["id"])] == [[("Service kit", 2, 30)]])
        call("POST", f"/api/invoices/{sb['id']}/cancel", {"reason": "test"})
        check("voiding a bill releases its unpaid purchase", auto(bill=sb["id"]) == [])
        sb2 = call("POST", "/api/invoices/standalone", {"companyId": cid, "clientId": client["id"], "date": today, "gstRate": 0,
            "items": [{"description": "Kit two", "quantity": 1, "uom": "Pcs", "unitPrice": 50, "supplierId": A, "actualUnitCost": 30}]})
        call("DELETE", f"/api/invoices/{sb2['id']}", expected=(200, 204))
        check("deleting a bill removes its unpaid automatic purchase", auto(bill=sb2["id"]) == [])

        # ── 7. Cancel and delete release unpaid purchases ──────────────
        r = challan([{"description": "Gone", "quantity": 1, "unit": "Pcs", "supplierId": A, "actualUnitCost": 1}])
        call("PUT", f"/api/deliverychallans/{r['id']}/cancel")
        check("cancelling a challan removes its unpaid purchases", auto(challan=r["id"]) == [])
        r = challan([{"description": "Deleted", "quantity": 1, "unit": "Pcs", "supplierId": A, "actualUnitCost": 1}])
        call("DELETE", f"/api/deliverychallans/{r['id']}", expected=(200, 204))
        check("deleting a challan removes its unpaid purchases", auto(challan=r["id"]) == [])

        # ── 8. Closed accounting period ────────────────────────────────
        old_day = (date.today() - timedelta(days=20)).isoformat()
        lock_day = (date.today() - timedelta(days=10)).isoformat()
        o = challan([{"description": "Old", "quantity": 1, "unit": "Pcs"}], day=old_day)
        call("PUT", f"/api/accounting/gl/company/{cid}/lock-date", {"lockDate": lock_day})
        count_before = len(call("GET", f"/api/deliverychallans/company/{cid}/paged?pageSize=100")["items"])
        edit(o, lambda b: b["items"][0].update(supplierId=A, actualUnitCost=5), expected=(400,))
        check("a cost change in a closed period is refused", auto(challan=o["id"]) == [])
        challan([{"description": "Backdated", "quantity": 1, "unit": "Pcs", "supplierId": A, "actualUnitCost": 5}], day=old_day, expected=(400,))
        check("a costed challan dated in a closed period is refused before it is saved",
            len(call("GET", f"/api/deliverychallans/company/{cid}/paged?pageSize=100")["items"]) == count_before)
        edit(o, lambda b: b.update(notes="Notes only"))
        check("an uncosted edit in a closed period still saves", call("GET", f"/api/deliverychallans/{o['id']}")["notes"] == "Notes only")
        call("PUT", f"/api/accounting/gl/company/{cid}/lock-date", {"lockDate": None})

        # ── 9. Ledger and stock ────────────────────────────────────────
        if args.db:
            first = auto(challan=m["id"])[0]["id"]
            gl = sql(args.db, f"SET NOCOUNT ON; SELECT COUNT(*) FROM JournalEntries WHERE CompanyId={cid} AND SourceDocType=2 AND SourceDocId={first}")
            check("an automatic purchase posts its supplier liability", int(gl.strip()) == 1)
            stock = sql(args.db, f"SET NOCOUNT ON; SELECT COUNT(*) FROM StockMovements m JOIN PurchaseBills p ON p.Id=m.SourceId AND m.SourceType=1 WHERE p.CompanyId={cid} AND p.Source='auto-cost'")
            check("automatic purchases never move stock", int(stock.strip()) == 0)
            orphans = sql(args.db, f"SET NOCOUNT ON; SELECT COUNT(*) FROM JournalEntries e WHERE e.CompanyId={cid} AND e.SourceDocType=2 AND NOT EXISTS (SELECT 1 FROM PurchaseBills p WHERE p.Id=e.SourceDocId)")
            check("removed automatic purchases leave no ledger entry behind", int(orphans.strip()) == 0)

        # ── 10. Tenant isolation ───────────────────────────────────────
        other = call("POST", "/api/companies", {"name": f"Sync other {cid}"})
        foreign = call("POST", "/api/suppliers", {"companyId": other["id"], "name": "Foreign supplier"})["id"]
        challan([{"description": "Foreign", "quantity": 1, "unit": "Pcs", "supplierId": foreign, "actualUnitCost": 1}], expected=(400,))
        check("another company's supplier cannot be booked", True)
        edit(m, lambda b: b["items"][0].update(supplierId=foreign), expected=(400,))
        check("another company's supplier cannot be set on edit", True)
        roles = call("GET", "/api/roles")
        sales = next(x["id"] for x in roles if x["name"] == "Sales Edition")
        u = call("POST", "/api/users", {"username": f"syncverify{cid}", "password": "Testsync1234", "fullName": "Sync tester", "role": "User"}); users.append(u)
        call("PUT", f"/api/users/{u['id']}/roles", {"roleIds": [sales]})
        call("PUT", f"/api/usercompanies/user/{u['id']}", {"companyIds": [other["id"]]})
        utoken = call("POST", "/api/auth/login", {"username": f"syncverify{cid}", "password": "Testsync1234"})["token"]
        md = costs("challan", m["id"])
        call("PATCH", f"/api/commercial-costs/challan/{m['id']}", {"version": md["version"], "items": []}, expected=(403,), auth=utoken)
        call("PUT", f"/api/purchasebills/{auto(challan=m['id'])[0]['id']}", {"supplierId": A, "gstRate": 5, "items": []}, expected=(403, 404), auth=utoken)
        call("DELETE", f"/api/deliverychallans/{m['id']}", expected=(403, 404), auth=utoken)
        check("a user of another company cannot touch these costs or purchases", True)

        print(f"\n{passed}/{passed} cost purchase sync checks passed")
    finally:
        for u in users: http("DELETE", f"/api/users/{u['id']}", args.base, token=token)
        if other: http("DELETE", f"/api/companies/{other['id']}", args.base, token=token)


if __name__ == "__main__":
    main()
