"""The same item on several challans of one PO prints as ONE bill row.

The bill keeps a line per challan line (stock, challan edits, notes and supplier
purchases key on it); only the Bill print data — used by print, PDF, Excel and
the customer portal — adds them up. Lines merge only when PO, description,
unit, rate, item type and HS code all match.

    python scripts/test_bill_print_merge.py --base http://localhost:5135
"""
import argparse
from datetime import date
from test_basic_flows import http, setup


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    args = ap.parse_args()
    token, company, client = setup(args.base, "admin", "admin123")
    cid = company["id"]
    today = date.today().isoformat()
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

    def challan(po, items):
        return call("POST", f"/api/deliverychallans/company/{cid}", {"clientId": client["id"], "poNumber": po, "deliveryDate": today,
            "items": [{"description": d, "quantity": q, "unit": u} for d, q, u in items]})

    def bill(challans, prices):
        lines = [i for c in challans for i in c["items"]]
        return call("POST", "/api/invoices", {"companyId": cid, "clientId": client["id"], "date": today, "gstRate": 18,
            "challanIds": [c["id"] for c in challans], "items": [{"deliveryItemId": i["id"], "unitPrice": prices[n]} for n, i in enumerate(lines)]})

    def rows(invoice):
        return [(r["sNo"], r["description"], r["quantity"], r["uom"], r["unitPrice"], r["lineTotal"])
                for r in call("GET", f"/api/invoices/{invoice['id']}/print/bill")["items"]]

    # Same PO, same item on two challans (spacing and case differ), plus a
    # same-description line at a different rate that must stay separate.
    a = challan("PO-MERGE", [("CONNECTOR FOR FLEXIBLE PIPE", 900, "EACH"), ("Threaded rod M6", 10, "Meter")])
    b = challan("PO-MERGE", [("connector for  flexible pipe ", 920, "each"), ("CONNECTOR FOR FLEXIBLE PIPE", 5, "EACH")])
    merged = bill([a, b], [389, 94.2, 389, 400])
    got = rows(merged)
    check("the same item on two challans of one PO prints once with the quantities added",
        got[0][1] == "CONNECTOR FOR FLEXIBLE PIPE" and got[0][2] == 1820 and got[0][5] == 707980)
    check("a different rate stays its own row", any(r[1] == "CONNECTOR FOR FLEXIBLE PIPE" and r[4] == 400 and r[2] == 5 for r in got))
    check("rows keep first-appearance order and are renumbered", [r[0] for r in got] == [1, 2, 3] and got[1][1] == "Threaded rod M6")
    check("the printed rows add up to the bill subtotal", round(sum(r[5] for r in got), 2) == merged["subtotal"])
    stored = call("GET", f"/api/invoices/{merged['id']}")
    check("the bill itself keeps one line per challan line", len(stored["items"]) == 4 and sorted(i["quantity"] for i in stored["items"]) == [5, 10, 900, 920])

    # Different POs never merge, even for an identical line.
    c = challan("PO-ONE", [("Hex shaft", 3, "EACH")])
    d = challan("PO-TWO", [("Hex shaft", 4, "EACH")])
    split = bill([c, d], [1500, 1500])
    got = rows(split)
    check("the same item under different POs stays on separate rows", [(r[1], r[2]) for r in got] == [("Hex shaft", 3), ("Hex shaft", 4)])

    # A bill with nothing to merge prints exactly as before.
    e = challan("PO-PLAIN", [("Pad lock", 10, "EACH"), ("Key chain", 200, "EACH")])
    plain = bill([e], [260, 11.5])
    check("a bill without repeats prints its lines unchanged", [(r[1], r[2], r[5]) for r in rows(plain)] == [("Pad lock", 10, 2600), ("Key chain", 200, 2300)])

    # Tenant guard is unchanged: another company's user cannot read the print.
    other = call("POST", "/api/companies", {"name": f"Merge other {cid}"})
    roles = call("GET", "/api/roles")
    sales = next(r["id"] for r in roles if r["name"] == "Sales Edition")
    u = call("POST", "/api/users", {"username": f"mergeverify{cid}", "password": "Testmerge1234", "fullName": "Merge tester", "role": "User"})
    try:
        call("PUT", f"/api/users/{u['id']}/roles", {"roleIds": [sales]})
        call("PUT", f"/api/usercompanies/user/{u['id']}", {"companyIds": [other["id"]]})
        utoken = call("POST", "/api/auth/login", {"username": f"mergeverify{cid}", "password": "Testmerge1234"})["token"]
        call("GET", f"/api/invoices/{merged['id']}/print/bill", expected=(403, 404), auth=utoken)
        check("another company's user cannot read the merged print", True)
    finally:
        http("DELETE", f"/api/users/{u['id']}", args.base, token=token)
        http("DELETE", f"/api/companies/{other['id']}", args.base, token=token)

    print(f"\n{passed}/{passed} bill print merge checks passed")


if __name__ == "__main__":
    main()
