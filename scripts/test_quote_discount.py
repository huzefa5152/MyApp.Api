"""Discounts on a sales quote: per line and on the whole quote, before GST.

A line discount is part of the line's price, so a bill made from the quote
(through its sales order) takes the NET unit price. The whole-quote discount
stays on the quote; the bill prefill only carries a reminder of it.

    python scripts/test_quote_discount.py --base http://localhost:5137
"""
import argparse
from test_basic_flows import http, setup


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    args = ap.parse_args()
    token, company, client = setup(args.base, "admin", "admin123")
    cid = company["id"]
    passed = 0

    def call(method, path, body=None, expected=(200, 201), auth=None):
        status, data = http(method, path, args.base, token=auth or token, body=body)
        assert status in expected, f"{method} {path}: {status}: {data}"
        return data

    def check(name, condition):
        nonlocal passed
        assert condition, name
        passed += 1
        print(f"PASS {name}")

    def quote(items, value=0, percent=False, reason=None, gst=18):
        return {"clientId": client["id"], "gstRate": gst, "discountValue": value, "discountIsPercent": percent,
                "discountReason": reason, "items": items}

    def line(desc, qty, price, value=0, percent=False, reason=None, **extra):
        return {"description": desc, "quantity": qty, "unit": "Pcs", "unitPrice": price,
                "discountValue": value, "discountIsPercent": percent, "discountReason": reason, **extra}

    # 1. Quote #512's shape: one battery 10% off for an exchange, then 5,000 off the whole quote.
    q = call("POST", f"/api/salesquotes/company/{cid}", quote([
        line("Solar inverter 1.6 kW", 1, 88000),
        line("Battery N240 27 plate", 1, 41000, 10, True, "Old battery taken in exchange"),
        line("Solar plate 585 W", 2, 27500, 2500, False),
    ], 5000, False, "Bulk order"))
    items = {i["description"]: i for i in q["items"]}
    bat = items["Battery N240 27 plate"]
    check("a percent line discount comes off the line", bat["discountAmount"] == 4100 and bat["lineTotal"] == 36900)
    check("a rupee line discount comes off the line", items["Solar plate 585 W"]["lineTotal"] == 52500)
    check("a line without a discount is untouched", items["Solar inverter 1.6 kW"]["lineTotal"] == 88000 and items["Solar inverter 1.6 kW"]["discountAmount"] == 0)
    check("subtotal is the sum of the net lines", q["subtotal"] == 177400)
    check("the whole-quote discount is stored with its reason", q["discountAmount"] == 5000 and q["discountReason"] == "Bulk order")
    check("GST is on the amount after both discounts", q["gstAmount"] == round((177400 - 5000) * 0.18, 2))
    check("grand total adds GST to the discounted amount", q["grandTotal"] == 172400 + q["gstAmount"])
    check("the line reason is kept", bat["discountReason"] == "Old battery taken in exchange")

    # 2. Print data carries what every template needs.
    pr = call("GET", f"/api/salesquotes/{q['id']}/print")
    pbat = next(i for i in pr["items"] if i["description"].startswith("Battery"))
    check("print: the line note reads like the quote", pbat["discountNote"] == "Less 10% (Rs 4,100): Old battery taken in exchange")
    check("print: gross and net amounts", pbat["grossAmount"] == 41000 and pbat["lineTotal"] == 36900)
    check("print: no note on an undiscounted line", next(i for i in pr["items"] if i["description"].startswith("Solar inverter"))["discountNote"] is None)
    check("print: whole-quote discount fields", pr["discountAmount"] == 5000 and pr["amountAfterDiscount"] == 172400 and pr["discountPercentLabel"] == "")

    # 3. Edit: percent on the whole quote, clear a line discount, reason dropped without a value.
    body = quote([dict(line(i["description"], i["quantity"], i["unitPrice"], i["discountValue"], i["discountIsPercent"], i["discountReason"]), id=i["id"]) for i in q["items"]], 10, True, "Eid offer")
    for b in body["items"]:
        if b["description"].startswith("Solar plate"):
            b.update(discountValue=0, discountReason="should be dropped")
    q2 = call("PUT", f"/api/salesquotes/{q['id']}", body)
    plate = next(i for i in q2["items"] if i["description"].startswith("Solar plate"))
    check("a cleared line discount restores the full amount", plate["lineTotal"] == 55000 and plate["discountAmount"] == 0)
    check("a reason without a discount is not kept", plate["discountReason"] is None)
    check("a percent whole-quote discount", q2["subtotal"] == 179900 and q2["discountAmount"] == 17990)
    check("print shows the whole-quote percent", call("GET", f"/api/salesquotes/{q['id']}/print")["discountPercentLabel"] == "10%")

    # 4. Refusals: nothing negative, nothing over 100%, nothing bigger than what it discounts.
    bad = [
        ("a negative line discount", quote([line("A", 1, 100, -5)])),
        ("a line discount over 100%", quote([line("A", 1, 100, 101, True)])),
        ("a line discount larger than the line", quote([line("A", 1, 100, 150)])),
        ("a whole-quote discount larger than the subtotal", quote([line("A", 1, 100)], 101)),
        ("a whole-quote discount over 100%", quote([line("A", 1, 100)], 150, True)),
        ("a reason longer than 200 characters", quote([line("A", 1, 100, 5, False, "x" * 201)])),
    ]
    for name, b in bad:
        status, data = http("POST", f"/api/salesquotes/company/{cid}", args.base, token=token, body=b)
        check(f"refused: {name}", status == 400)
    full = call("POST", f"/api/salesquotes/company/{cid}", quote([line("Free sample", 1, 500, 100, True)], gst=0))
    check("a 100% line discount is a free line", full["items"][0]["lineTotal"] == 0 and full["grandTotal"] == 0)

    # 5. To the bill: the order's prefill takes the NET price and reminds about the whole-quote discount.
    order = call("POST", f"/api/salesquotes/{q['id']}/convert-to-order")
    pre = call("GET", f"/api/salesorders/{order['id']}/invoice-prefill")
    pl = {l["description"]: l for l in pre["lines"]}
    check("bill prefill: the discounted line comes at its net price", abs(pl["Battery N240 27 plate"]["unitPrice"] - 36900) < 0.0001)
    check("bill prefill: the line says which discount is in its price", pl["Battery N240 27 plate"]["quoteDiscountNote"].startswith("Less 10% (Rs 4,100)"))
    check("bill prefill: an undiscounted line keeps the quote price", pl["Solar inverter 1.6 kW"]["unitPrice"] == 88000 and pl["Solar inverter 1.6 kW"]["quoteDiscountNote"] is None)
    check("bill prefill: the whole-quote discount is a reminder, not a price", "Less 10% (Rs 17,990): Eid offer" in (pre["quoteDiscountReminder"] or ""))

    # 6. Quote with no discount at all: nothing changes, no reminder.
    plain = call("POST", f"/api/salesquotes/company/{cid}", {"clientId": client["id"], "gstRate": 18, "items": [{"description": "Plain", "quantity": 2, "unit": "Pcs", "unitPrice": 1000}]})
    check("a quote without discounts totals as before", plain["subtotal"] == 2000 and plain["gstAmount"] == 360 and plain["grandTotal"] == 2360 and plain["discountAmount"] == 0)
    o2 = call("POST", f"/api/salesquotes/{plain['id']}/convert-to-order")
    check("no reminder without a whole-quote discount", call("GET", f"/api/salesorders/{o2['id']}/invoice-prefill")["quoteDiscountReminder"] is None)

    # 7. Another company's user cannot read the quote, its print or the order prefill.
    other = call("POST", "/api/companies", {"name": f"Discount other {cid}"})
    roles = call("GET", "/api/roles")
    sales = next(r["id"] for r in roles if r["name"] == "Sales Edition")
    u = call("POST", "/api/users", {"username": f"discverify{cid}", "password": "Testdisc12345", "fullName": "Discount tester", "role": "User"})
    try:
        call("PUT", f"/api/users/{u['id']}/roles", {"roleIds": [sales]})
        call("PUT", f"/api/usercompanies/user/{u['id']}", {"companyIds": [other["id"]]})
        ut = call("POST", "/api/auth/login", {"username": f"discverify{cid}", "password": "Testdisc12345"})["token"]
        for path in (f"/api/salesquotes/{q['id']}", f"/api/salesquotes/{q['id']}/print", f"/api/salesorders/{order['id']}/invoice-prefill"):
            status, _ = http("GET", path, args.base, token=ut)
            check(f"another company's user is refused {path.split('/api/')[1]}", status in (403, 404))
        status, _ = http("PUT", f"/api/salesquotes/{q['id']}", args.base, token=ut, body=body)
        check("another company's user cannot edit the discount", status in (403, 404))
    finally:
        http("DELETE", f"/api/users/{u['id']}", args.base, token=token)
        http("DELETE", f"/api/companies/{other['id']}", args.base, token=token)

    print(f"\n{passed}/{passed} quote discount checks passed")


if __name__ == "__main__":
    main()
