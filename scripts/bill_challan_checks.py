"""Shared HTTP regression checks for changing an unfiled bill's challans."""
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor


def run(http, check, base, token, company_id, client_id, item_type_id=None, stock=None):
    suite = "Bill challan selection"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

    def call(method, path, body=None):
        return http(method, path, base, token=token, body=body)

    def expect(name, status, value, expected=200):
        check(suite, name, status == expected, f"{status} {value}")
        return status == expected

    def source(label, qty, customer=client_id):
        st, row = call("POST", f"/api/deliverychallans/company/{company_id}", {
            "companyId": company_id, "clientId": customer, "poNumber": f"PO-SELECT-{label}",
            "poDate": today, "deliveryDate": today, "items": [{"description": f"Selection {label}",
            "quantity": qty, "unit": "Pcs", "itemTypeId": item_type_id}]})
        check(suite, f"source {label} created", st in (200, 201), f"{st} {row}")
        if st not in (200, 201):
            raise AssertionError(f"Source creation failed: {row}")
        return row

    st, value = call("POST", f"/api/accounts/company/{company_id}/seed-wholesale")
    expect("accounting chart seeded", st, value)
    a, b, c = source("A", 10), source("B", 2), source("C", 1)
    if c["status"] in ("Pending", "Imported"):
        st, duplicate = call("POST", f"/api/deliverychallans/{c['id']}/duplicate")
        check(suite, "duplicate number keeps distinct record", st == 201 and duplicate["id"] != c["id"]
              and duplicate["challanNumber"] == c["challanNumber"], str((st, duplicate)))
        if st == 201:
            c = duplicate
    st, bill = call("POST", "/api/invoices", {
        "date": today, "companyId": company_id, "clientId": client_id, "gstRate": 18,
        "furtherTaxRate": 2, "withholdingTaxRate": 5.5, "freightCharges": 50,
        "challanIds": [a["id"]], "items": [{"deliveryItemId": a["items"][0]["id"], "unitPrice": 100}]})
    if not expect("bill created", st, bill, 201):
        return
    iid = bill["id"]
    path = f"/api/invoices/{iid}/challans"
    line = bill["items"][0]
    st, adjusted = call("PATCH", f"/api/invoices/{iid}/itemtypes-and-qty", {
        "writeMode": "adjustment", "items": [{"id": line["id"], "quantity": 5, "unitPrice": 200}]})
    expect("filing overlay created", st, adjusted)

    def options():
        st, value = call("GET", path)
        if not expect("selection loads", st, value):
            raise AssertionError(value)
        return value

    def payload(snap, ids, prices=None):
        added = [r for r in snap["available"] if r["id"] in ids]
        return {"version": snap["version"], "challanIds": ids,
                "addedChallanVersions": {str(r["id"]): r["version"] for r in added},
                "unitPrices": prices or {str(i["id"]): 3940 for r in added for i in r["items"]}}

    st, other_client = call("POST", "/api/clients", {"companyId": company_id, "name": "Selection other buyer"})
    if expect("other buyer created", st, other_client):
        foreign = source("OTHER", 1, other_client["id"])
        snap = options()
        bad = payload(snap, [a["id"], foreign["id"]])
        bad["addedChallanVersions"] = {str(foreign["id"]): "unused"}
        st, value = call("PUT", path, bad)
        expect("other customer's challan rejected", st, value, 400)
    snap = options()
    check(suite, "linked and available kept separate", [r["id"] for r in snap["linked"]] == [a["id"]]
          and {b["id"], c["id"]}.issubset({r["id"] for r in snap["available"]}))
    st, found = call("GET", path + "?search=PO-SELECT-B")
    check(suite, "search returns matching source", st == 200 and [r["id"] for r in found["available"]] == [b["id"]])
    good = payload(snap, [a["id"], b["id"]])
    for name, change in [
        ("duplicate selection rejected", {"challanIds": [a["id"], a["id"]]}),
        ("unknown challan rejected", {"challanIds": [a["id"], 2147483647]}),
        ("missing rate rejected", {"unitPrices": {}}),
        ("negative rate rejected", {"unitPrices": {str(b["items"][0]["id"]): -1}}),
        ("excess rate precision rejected", {"unitPrices": {str(b["items"][0]["id"]): 0.1234567890123}}),
        ("stale bill rejected", {"version": "stale"}),
        ("stale source rejected", {"addedChallanVersions": {str(b["id"]): "stale"}}),
    ]:
        st, value = call("PUT", path, {**good, **change})
        expect(name, st, value, 400)
    st, unchanged = call("GET", f"/api/invoices/{iid}")
    check(suite, "rejected changes leave bill untouched", st == 200 and unchanged["subtotal"] == 1000
          and len(unchanged["items"]) == 1)
    st, saved = call("PUT", path, good)
    if not expect("additional challan saves", st, saved):
        return
    check(suite, "addition requires consultant review", saved["fbrReviewRequired"] and not saved["fbrReady"])
    retained = next(r for r in saved["items"] if r["id"] == line["id"])
    check(suite, "retained line and rate preserved", retained["unitPrice"] == 100 and retained["quantity"] == 10)
    check(suite, "retained overlay preserved", (retained.get("adjustment") or {}).get("adjustedQuantity") == 5)
    check(suite, "new rate and taxes recalculated", saved["subtotal"] == 8880 and saved["gstAmount"] == 1598.4
          and saved["furtherTaxAmount"] == 177.6 and saved["grandTotal"] == 10656
          and saved["withholdingTaxAmount"] == 586.08 and saved["freightCharges"] == 50, str(saved))
    if stock:
        check(suite, "addition reflows stock with retained overlay", abs(stock() - 93) < .001, str(stock()))
    st, value = call("PUT", path, good)
    expect("replayed selection rejected", st, value, 400)
    st, chart = call("GET", f"/api/accounts/company/{company_id}/flat")
    bank = next((r for r in chart if r.get("controlType") == "BankCash"), None) if st == 200 else None
    check(suite, "receipt account available", bank is not None)
    if bank:
        st, receipt = call("POST", f"/api/payments/receipts/company/{company_id}", {
            "date": today, "contactType": "Client", "contactId": client_id,
            "bankAccountId": bank["id"], "method": "Cash", "amount": 10000,
            "allocations": [{"invoiceId": iid, "amount": 10000}]})
        if expect("receipt allocated", st, receipt, 201):
            snap = options()
            st, value = call("PUT", path, payload(snap, [b["id"]]))
            expect("cannot reduce below allocated receipts", st, value, 400)
            st, value = call("DELETE", f"/api/payments/receipts/{receipt['id']}")
            expect("receipt removed for further tests", st, value, 204)
    st, value = call("PUT", f"/api/accounting/gl/company/{company_id}/lock-date", {"lockDate": today})
    if expect("period locked", st, value):
        snap = options()
        st, value = call("PUT", path, payload(snap, [b["id"]]))
        expect("locked period rejects challan changes", st, value, 400)
        st, value = call("PUT", f"/api/accounting/gl/company/{company_id}/lock-date", {"lockDate": None})
        expect("period reopened", st, value)
    st, page = call("GET", f"/api/journal-entries/company/{company_id}/paged?pageSize=200")
    entries = [e for e in page.get("items", []) if e.get("sourceDocType") == "Invoice" and e.get("sourceDocId") == iid] if st == 200 else []
    check(suite, "bill keeps one balanced journal entry", len(entries) == 1 and entries[0]["totalDebit"] == entries[0]["totalCredit"], str(entries))
    if entries:
        sales = next((r for r in chart if r.get("name") == "Sales"), None)
        check(suite, "journal revenue equals subtotal plus freight", sales is not None and
              sum(r["credit"] - r["debit"] for r in entries[0]["lines"] if r["accountId"] == sales["id"]) == 8930)
    snap = options()
    st, value = call("PUT", path, payload(snap, []))
    expect("cannot remove final item", st, value, 400)
    st, removed = call("PUT", path, payload(snap, [b["id"]]))
    if not expect("remove original challan saves", st, removed):
        return
    check(suite, "removing last adjusted line still requires review", removed["fbrReviewRequired"] and not removed["fbrReady"])
    check(suite, "only removed lines disappear", len(removed["items"]) == 1
          and removed["items"][0]["deliveryItemId"] == b["items"][0]["id"] and removed["subtotal"] == 7880)
    st, released = call("GET", f"/api/deliverychallans/{a['id']}")
    check(suite, "released source and items preserved", st == 200 and released.get("invoiceId") is None
          and released["status"] != "Invoiced" and released["items"][0]["id"] == a["items"][0]["id"])
    if stock:
        check(suite, "removal restores overlaid stock", abs(stock() - 98) < .001, str(stock()))
    snap = options()
    st, replaced = call("PUT", path, payload(snap, [c["id"]]))
    if not expect("last challan can be replaced atomically", st, replaced):
        return
    check(suite, "replacement requires consultant review", replaced["fbrReviewRequired"])
    check(suite, "replacement total and membership correct", replaced["subtotal"] == 3940
          and len(replaced["items"]) == 1 and replaced["items"][0]["deliveryItemId"] == c["items"][0]["id"])
    snap = options()
    st, noop = call("PUT", path, payload(snap, [c["id"]]))
    check(suite, "no-op preserves review timestamp", noop["fbrReviewRequiredAt"].rstrip("Z") == replaced["fbrReviewRequiredAt"].rstrip("Z"))
    check(suite, "no-op keeps item identity", st == 200 and noop["items"][0]["id"] == replaced["items"][0]["id"])
    if stock:
        check(suite, "replacement records correct net stock", abs(stock() - 99) < .001, str(stock()))
    snap = options()
    concurrent_change = payload(snap, [c["id"], a["id"]])
    with ThreadPoolExecutor(max_workers=2) as workers:
        responses = list(workers.map(lambda _: call("PUT", path, concurrent_change), range(2)))
    check(suite, "concurrent same-version saves have one winner", sorted(r[0] for r in responses) == [200, 400], str(responses))
    snap = options()
    st, restored = call("PUT", path, payload(snap, [c["id"]]))
    expect("concurrent test source released", st, restored)
    st, competitor = call("POST", "/api/invoices/standalone", {
        "companyId": company_id, "clientId": client_id, "date": today, "gstRate": 18,
        "items": [{"description": "Competing standalone service", "quantity": 1, "uom": "Pcs", "unitPrice": 100}]})
    if expect("competing bill created", st, competitor, 201):
        competing_path = f"/api/invoices/{competitor['id']}/challans"
        st, competing_snapshot = call("GET", competing_path)
        if expect("competing selector loads", st, competing_snapshot):
            snap = options()
            requests = [(path, payload(snap, [c["id"], a["id"]])),
                        (competing_path, payload(competing_snapshot, [a["id"]]))]
            with ThreadPoolExecutor(max_workers=2) as workers:
                responses = list(workers.map(lambda r: call("PUT", r[0], r[1]), requests))
            check(suite, "two bills cannot acquire the same challan", sorted(r[0] for r in responses) == [200, 400], str(responses))
        st, value = call("DELETE", f"/api/invoices/{competitor['id']}")
        expect("competing bill removed", st, value)
        snap = options()
        st, value = call("PUT", path, payload(snap, [c["id"]]))
        expect("original selection restored after race", st, value)
    st, deleted = call("DELETE", f"/api/invoices/{iid}")
    expect("test bill deletes cleanly", st, deleted)
    if stock:
        check(suite, "deletion restores all stock", abs(stock() - 100) < .001, str(stock()))
