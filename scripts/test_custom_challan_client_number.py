"""Custom challan numbers are scoped to the client; run only against a local test server."""
import sys
from test_custom_bill_number import http, setup, TODAY

base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5136"
if not base.startswith("http://localhost:"):
    raise SystemExit("Use a local test server.")
token, company, a, _ = setup(base, "admin", "admin123", "TEST")
cid = company["id"]
passed = 0

def check(label, ok, detail=None):
    global passed
    assert ok, f"{label}: {detail}"
    passed += 1
    print("PASS", label)

def create(client, number):
    return http("POST", f"/api/deliverychallans/company/{cid}", base, token, {
        "companyId": cid, "clientId": client, "customNumber": number,
        "deliveryDate": TODAY, "poNumber": "TEST", "items": [
            {"description": "Sample item", "quantity": 1, "unit": "Pcs"}]})

def preview(client, number, exclude=None):
    path = f"/api/companies/{cid}/document-numbers/challan?check={number}&clientId={client}"
    if exclude: path += f"&excludeId={exclude}"
    return http("GET", path, base, token)

try:
    st, b = http("POST", "/api/clients", base, token,
                 {"name": "Sample second buyer", "companyId": cid, "address": "Sample address"})
    check("second client created", st in (200,201), b)
    st, first = create(a["id"], 212)
    check("first client gets 212", st in (200,201) and first["challanNumber"] == 212, first)
    st, p = preview(b["id"], 212)
    check("212 available for other client", st == 200 and p["checkedAvailable"], p)
    st, second = create(b["id"], 212)
    check("other client gets 212", st in (200,201) and second["challanNumber"] == 212, second)
    st, p = preview(a["id"], 212)
    check("212 unavailable for same client", st == 200 and not p["checkedAvailable"], p)
    st, p = create(a["id"], 212)
    check("same client duplicate refused", st == 400, p)
    st, auto = create(a["id"], None)
    check("auto cursor unaffected by custom", st in (200,201) and auto["challanNumber"] == 1, auto)
    st, p = preview(b["id"], 1, second["id"])
    check("renumber preview uses target client", st == 200 and p["checkedAvailable"], p)
    st, p = http("PUT", f"/api/deliverychallans/{second['id']}", base, token,
                 {"clientId": b["id"], "customNumber": 1, "poNumber": "TEST", "deliveryDate": TODAY, "items": second["items"]})
    check("renumber to another client's number allowed", st == 200, p)
    st, p = http("PUT", f"/api/deliverychallans/{second['id']}", base, token,
                 {"clientId": a["id"], "customNumber": 1, "poNumber": "TEST", "deliveryDate": TODAY, "items": second["items"]})
    check("client change cannot introduce collision", st == 400, p)
    st, p = preview(a["id"], 0)
    check("invalid number refused", st == 200 and not p["checkedAvailable"], p)
finally:
    http("DELETE", f"/api/companies/{cid}", base, token)
print(f"{passed}/{passed} checks passed")
