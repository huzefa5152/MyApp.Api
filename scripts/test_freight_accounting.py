"""Local commercial freight receipts, print fields and credit-note accounting."""
import argparse
from datetime import datetime, timezone
from decimal import Decimal
from test_basic_flows import setup, teardown, http, first_item_type_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://localhost:5138")
    parser.add_argument("--db", default=r"Server=.\MSSQLSERVER02;Database=MyApp_Customize_Freight_Test_20261005;Trusted_Connection=True;TrustServerCertificate=True", help="Local scratch connection; this suite uses only the API")
    args = parser.parse_args()
    token, company, client = setup(args.base, "admin", "admin123")
    cid = company["id"]
    status, company = http("PUT", f"/api/companies/{cid}", args.base, token=token, body=dict(company, fbrEnabled=False, enableGl=True))
    if status != 200:
        raise RuntimeError(f"Cannot enable synthetic GL company: {status}")
    item_type = first_item_type_id(args.base, token)
    passed = failed = 0

    def check(name, okay, detail=""):
        nonlocal passed, failed
        passed += bool(okay)
        failed += not okay
        print(f"{'PASS' if okay else 'FAIL'} {name}" + (f": {detail}" if not okay else ""))

    def call(method, path, body=None):
        return http(method, path, args.base, token=token, body=body)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    def bill():
        return call("POST", "/api/invoices/standalone", {
            "companyId": cid, "clientId": client["id"], "date": today,
            "gstRate": 18, "freightCharges": 400,
            "items": [{"description": "Freight regression goods", "quantity": 2,
                       "uom": "Pcs", "unitPrice": 500, "itemTypeId": item_type}]})

    def entry(invoice_id):
        status, page = call("GET", f"/api/journal-entries/company/{cid}/paged?pageSize=200")
        hits = [e for e in page.get("items", []) if e.get("sourceDocType") == "Invoice"
                and e.get("sourceDocId") == invoice_id] if status == 200 else []
        check("one journal per invoice", len(hits) == 1, str(hits))
        return hits[0] if len(hits) == 1 else {"lines": []}

    try:
        status, _ = call("POST", f"/api/accounting/gl/company/{cid}/enable")
        check("GL enabled and chart seeded", status == 200)
        status, accounts = call("GET", f"/api/accounts/company/{cid}/flat")
        bank = next(a for a in accounts if a["controlType"] == "BankCash")
        status, paid = bill()
        check("freight bill created", status in (200, 201), str(paid))
        if status not in (200, 201): return 1
        status, printed = call("GET", f"/api/invoices/{paid['id']}/print/bill")
        check("commercial print merge fields retain exact components", status == 200
              and printed.get("freightCharges") == 400 and printed.get("totalBeforeFreight") == 1180
              and printed.get("commercialTotal") == 1580 and printed.get("grandTotal") == 1580)
        receipt = {"date": today, "contactType": "Client", "contactId": client["id"],
                   "bankAccountId": bank["id"], "method": "Cash",
                   "allocations": [{"invoiceId": paid["id"], "amount": 1580}]}
        status, saved = call("POST", f"/api/payments/receipts/company/{cid}", receipt)
        check("receipt accepts full commercial amount", status in (200, 201), str(saved))
        receipt["allocations"][0]["amount"] = 0.01
        status, _ = call("POST", f"/api/payments/receipts/company/{cid}", receipt)
        check("receipt above commercial balance rejected", status == 400)
        edits = {"gstRate": 18, "freightCharges": 0, "items": [
            {"id": i["id"], "description": i["description"], "quantity": i["quantity"],
             "uom": i.get("uom") or "Pcs", "unitPrice": i["unitPrice"], "itemTypeId": item_type} for i in paid["items"]]}
        status, _ = call("PUT", f"/api/invoices/{paid['id']}", edits)
        check("cannot reduce freight below received amount", status == 400)
        status, unchanged = call("GET", f"/api/invoices/{paid['id']}")
        check("rejected freight reduction rolls back", status == 200 and unchanged.get("freightCharges") == 400
              and unchanged.get("balanceDue") == 0 and unchanged.get("paymentStatus") == "Paid")
        # FBR-off synthetic companies can credit a fully paid commercial bill.
        for partial in (False, True):
            status, source = bill()
            check("credit source created", status in (200, 201))
            if status not in (200, 201): continue
            payment = dict(receipt, allocations=[{"invoiceId": source["id"], "amount": 1580}])
            st, settled = call("POST", f"/api/payments/receipts/company/{cid}", payment)
            check("credit source fully paid", st in (200, 201), str(settled))
            if st not in (200, 201): continue
            body = {"originalInvoiceId": source["id"], "documentType": 10,
                    "reason": "Change in value of supply", "affectsStock": False}
            if partial:
                body["lines"] = [{"invoiceItemId": source["items"][0]["id"], "quantity": 1}]
            status, note = call("POST", "/api/invoices/notes", body)
            check("partial credit created" if partial else "full credit created", status in (200, 201), str(note))
            if status not in (200, 201): continue
            check("partial credit excludes freight" if partial else "full credit reverses freight",
                  note.get("freightCharges") == (0 if partial else 400))
            original, reversal = entry(source["id"]), entry(note["id"])
            def signed(e):
                legs = {}
                for line in e["lines"]:
                    aid = line["accountId"]
                    legs[aid] = legs.get(aid, Decimal(0)) + Decimal(str(line["debit"])) - Decimal(str(line["credit"]))
                return legs
            check("credit journal balanced", bool(reversal["lines"]) and sum(signed(reversal).values()) == 0)
            if not partial:
                check("full credit reverses every original account", bool(original["lines"]) and signed(reversal) == {k: -v for k, v in signed(original).items()})
    finally:
        teardown(args.base, token, company, False)
    print(f"{passed}/{passed + failed} freight accounting checks passed")
    return int(failed > 0)

if __name__ == "__main__":
    raise SystemExit(main())
