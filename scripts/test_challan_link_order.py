"""
Linking a delivery challan to a Sales Order after the fact (delivered first, ordered later).

Proves:
  * GET /api/salesorders/attachable-for-challan/{challanId} offers only OPEN orders of the
    challan's customer, the order with matching lines first;
  * a challan of a company the caller was never given is refused;
  * a challan carrying its own PO is offered nothing and cannot be attached;
  * a closed order is not offered (it can still take a challan from the order's own screen);
  * attaching links the challan, adopts the order's PO and moves "No PO" to "Pending",
    after which the challan is offered nothing.

Needs a LOCAL Trader database with 2+ companies, the first having 2+ clients. Creates a
throwaway user, orders and challans, and removes them at the end.

Usage: python scripts/test_challan_link_order.py --base http://localhost:5135
"""
from __future__ import annotations

import argparse
import json
import secrets
import sys
import time
import urllib.error
import urllib.request
from datetime import date

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5134")
BASE = ap.parse_args().base.rstrip("/")
RUN = secrets.token_hex(3)
PW = "linkso1234"
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)))
    print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok else f"  -> {detail}"))


def http(method, path, token=None, body=None):
    data, hdrs = None, {}
    if body is not None:
        data, hdrs["Content-Type"] = json.dumps(body).encode(), "application/json"
    if token:
        hdrs["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt and txt[0] in "{[" else txt)
    except urllib.error.HTTPError as e:
        txt = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(txt) if txt and txt[0] in "{[" else txt
        except Exception:
            return e.code, txt


def login(user, pw):
    s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    if s == 429:
        time.sleep(62)
        s, d = http("POST", "/api/auth/login", body={"username": user, "password": pw})
    assert s == 200, f"login {user}: {s} {d}"
    return d["token"]


print(f"Challan -> sales order link test against {BASE}  (run {RUN})")
admin = login("admin", "admin123")
companies = http("GET", "/api/companies", admin)[1]
A = B_CHALLAN = None
for c in companies:
    clients = http("GET", f"/api/clients/company/{c['id']}", admin)[1]
    if A is None and isinstance(clients, list) and len(clients) >= 2:
        A, c1, c2 = c["id"], clients[0]["id"], clients[1]["id"]
for c in companies:
    if c["id"] != A and B_CHALLAN is None:
        B_CHALLAN = next((ch["id"] for ch in (http("GET", f"/api/deliverychallans/company/{c['id']}", admin)[1] or [])), None)
if A is None or B_CHALLAN is None:
    print("SKIP: need a company with 2 clients and another company with a challan.")
    sys.exit(2)
today = date.today().isoformat()
made_orders, made_challans = [], []


def order(client, po, desc):
    s, o = http("POST", f"/api/salesorders/company/{A}", admin, {
        "clientId": client, "orderDate": today, "customerPoNumber": po, "customerPoDate": today if po else None,
        "items": [{"description": desc, "quantity": 10, "unit": "Pcs"}]})
    assert s in (200, 201), f"order: {s} {o}"
    made_orders.append(o["id"])
    return o


def challan(client, po, desc):
    s, c = http("POST", f"/api/deliverychallans/company/{A}", admin, {
        "clientId": client, "deliveryDate": today, "poNumber": po,
        "items": [{"description": desc, "quantity": 4, "unit": "Pcs"}]})
    assert s in (200, 201), f"challan: {s} {c}"
    made_challans.append(c["id"])
    return c


def offered(token, challan_id):
    s, d = http("GET", f"/api/salesorders/attachable-for-challan/{challan_id}", token)
    return s, ([o["id"] for o in d] if isinstance(d, list) else d), d


DESC = f"Link widget {RUN}"
so_match = order(c1, f"PO-{RUN}", DESC)
so_other = order(c1, "", f"Something else {RUN}")
so_client2 = order(c2, f"PO2-{RUN}", DESC)
so_closed = order(c1, f"PO3-{RUN}", DESC)
http("PUT", f"/api/salesorders/{so_closed['id']}/status", admin, {"status": "Closed"})
ch = challan(c1, "", DESC)
ch_po = challan(c1, f"OWN-{RUN}", DESC)

# A user of company A only.
roles = {r["name"]: r["id"] for r in http("GET", "/api/roles", admin)[1]}
s, u = http("POST", "/api/users", admin, {"username": f"linkso_{RUN}", "password": PW, "fullName": "link so", "role": "User"})
assert s in (200, 201), f"user: {s} {u}"
assert http("PUT", f"/api/users/{u['id']}/roles", admin, {"roleIds": [roles["Sales Edition"]]})[0] == 200
assert http("PUT", f"/api/usercompanies/user/{u['id']}", admin, {"companyIds": [A]})[0] == 200
U = login(f"linkso_{RUN}", PW)

print("\n== which orders a challan is offered ==")
# "Setup Required" when the company's FBR details are incomplete; attach leaves that alone.
check("a new challan without a PO starts as No PO or Setup Required", ch["status"] in ("No PO", "Setup Required"), ch["status"])
s, ids, raw = offered(U, ch["id"])
check("the endpoint answers for the company's own user", s == 200, raw)
check("an open order of the same customer is offered", s == 200 and so_match["id"] in ids, raw)
check("…ahead of one with no matching line", s == 200 and ids.index(so_match["id"]) < ids.index(so_other["id"]), raw)
check("…and reports the matching line", s == 200 and next(o for o in raw if o["id"] == so_match["id"])["matchingLines"] == 1, raw)
check("another customer's order is not offered", s == 200 and so_client2["id"] not in ids, raw)
check("a closed order is not offered", s == 200 and so_closed["id"] not in ids, raw)
s, ids, raw = offered(U, ch_po["id"])
check("a challan with its own PO is offered nothing", s == 200 and ids == [], raw)
s, ids, raw = offered(U, B_CHALLAN)
check("another company's challan is refused", s in (403, 404), (s, raw))
s, ids, raw = offered(U, 999999999)
check("a missing challan is a 404", s == 404, (s, raw))

print("\n== attach refusals ==")
line = ch["items"][0]["id"]
s, d = http("POST", f"/api/salesorders/{so_match['id']}/attach-challan", U, {"challanId": ch_po["id"], "lineMappings": []})
check("attaching a challan that has its own PO is refused", s == 400 and "own po" in str(d).lower(), (s, d))
s, d = http("POST", f"/api/salesorders/{so_match['id']}/attach-challan", U, {"challanId": B_CHALLAN, "lineMappings": []})
check("attaching another company's challan is refused", s in (400, 403, 404), (s, d))

print("\n== attach ==")
so_line = so_match["items"][0]["id"]
s, d = http("POST", f"/api/salesorders/{so_match['id']}/attach-challan", U, {"challanId": ch["id"], "lineMappings": [{"deliveryItemId": line, "salesOrderItemId": so_line}]})
check("attaching to the matching open order succeeds", s == 200, (s, d))
s, c = http("GET", f"/api/deliverychallans/{ch['id']}", admin)
check("the challan is linked, carries the order's PO, and No PO became Pending",
      c.get("salesOrderId") == so_match["id"] and c.get("poNumber") == f"PO-{RUN}"
      and c.get("status") == ("Pending" if ch["status"] == "No PO" else ch["status"]),
      {k: c.get(k) for k in ("salesOrderId", "poNumber", "status")})
s, ids, raw = offered(U, ch["id"])
check("a linked challan is offered nothing", s == 200 and ids == [], raw)

print("\n== cleanup ==")
for cid in sorted(made_challans, reverse=True):
    http("DELETE", f"/api/deliverychallans/{cid}", admin)
for oid in reversed(made_orders):   # only the newest order number can be deleted
    http("DELETE", f"/api/salesorders/{oid}", admin)
http("DELETE", f"/api/users/{u['id']}", admin)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} challan link checks passed")
sys.exit(1 if failed else 0)
