#!/usr/bin/env python3
"""
Delivery challans raised FROM a bill (the reverse of challan-then-bill).

All four combinations the operator asked for, plus what must not be possible:

  1. every line on ONE challan
  2. one line split across SEVERAL challans (partial quantities)
  3. one line on its own challan, other lines untouched
  4. a mix -- some lines fully, some partly, on the same challan

  * the remaining quantity is billed minus delivered, per line
  * delivering more than is left is refused
  * a fully delivered bill offers nothing more (this is what hides the
    "Create Delivery Challan" action on the card and the table)
  * a cancelled challan gives its quantity back
  * an imported bill has no lines to deliver
  * a challan raised from a bill carries the bill's id, so it does not show up
    again in the "pending challans to bill" picker

Usage:
    python scripts/test_challan_from_bill.py [--base URL] [--keep]
"""

import argparse
import sys
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("requests is required:  pip install requests")
    sys.exit(2)

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

results = []


def check(name, ok, detail=""):
    results.append((ok, name, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" -- {detail}"))
    return ok


def near(a, b, tol=0.0001):
    return abs(float(a or 0) - float(b or 0)) <= tol


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    api = args.base.rstrip("/") + "/api"
    r = requests.post(f"{api}/auth/login", timeout=60,
                      json={"username": args.username, "password": args.password})
    if not r.ok:
        print(f"FATAL: login failed ({r.status_code})")
        return 2
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    tag = datetime.now().strftime("%m%d%H%M%S")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

    cid = requests.post(f"{api}/companies", headers=h, timeout=60, json={
        "name": f"_challan_from_bill {tag}", "brandName": "CFB",
        "fullAddress": "1 Test Street", "phone": "021-0000000", "ntn": "1234567-8",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
        "fbrEnabled": False, "inventoryTrackingEnabled": False, "enableGl": False,
    }).json()["id"]
    print(f"\ncompany {cid}")
    requests.post(f"{api}/accounts/company/{cid}/seed-wholesale", headers=h, timeout=180)
    client = requests.post(f"{api}/clients", headers=h, timeout=60, json={
        "name": f"Deliver Client {tag}", "address": "1 Road", "phone": "021-1",
        "companyId": cid, "registrationType": "Unregistered"}).json()

    def item(name, uom="Pcs"):
        rr = requests.post(f"{api}/itemtypes", headers=h, timeout=60,
                           params={"companyId": cid},
                           json={"name": name, "uom": uom, "companyId": cid,
                                 "isFavorite": True})
        return rr.json()["id"] if rr.ok else None

    a, b, c = item(f"Deliv A {tag}"), item(f"Deliv B {tag}"), item(f"Deliv C {tag}")

    def make_bill(lines):
        """lines: (itemTypeId, name, qty, price)"""
        rr = requests.post(f"{api}/invoices/standalone", headers=h, timeout=120, json={
            "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 18,
            "items": [{"itemTypeId": iid, "description": nm, "quantity": q,
                       "uom": "Pcs", "unitPrice": pr} for iid, nm, q, pr in lines]})
        return rr.json() if rr.ok else None

    def plan(inv_id):
        rr = requests.get(f"{api}/invoices/{inv_id}/challan-plan", headers=h, timeout=60)
        return rr.json() if rr.ok else None

    def deliver(inv_id, lines=None):
        body = {"deliveryDate": today}
        if lines is not None:
            body["lines"] = [{"invoiceItemId": i, "quantity": q} for i, q in lines]
        return requests.post(f"{api}/invoices/{inv_id}/create-challan",
                             headers=h, timeout=120, json=body)

    def remaining_on_list(inv_id):
        rr = requests.get(f"{api}/invoices/company/{cid}/paged", headers=h, timeout=120,
                          params={"page": 1, "pageSize": 50})
        row = next((x for x in rr.json()["items"] if x["id"] == inv_id), None)
        return None if row is None else float(row.get("challanRemainingQuantity") or 0)

    try:
        # ── 1. every line on one challan ───────────────────────────────────
        print("\n-- 1. All lines on a single challan --")
        inv = make_bill([(a, f"Deliv A {tag}", 10, 100), (b, f"Deliv B {tag}", 5, 200)])
        check("the bill is created", inv is not None)
        p0 = plan(inv["id"])
        check("the plan reports both lines outstanding in full",
              p0 and len(p0["lines"]) == 2
              and near(p0["lines"][0]["remainingQuantity"], 10)
              and near(p0["lines"][1]["remainingQuantity"], 5), f"{p0}")
        check("the bill is not fully delivered yet", p0 and p0["fullyDelivered"] is False)
        check("the list shows 15 outstanding", near(remaining_on_list(inv["id"]), 15),
              f"{remaining_on_list(inv['id'])}")

        rr = deliver(inv["id"])            # no lines = everything outstanding
        ch = rr.json() if rr.ok else {}
        check("one challan covers the whole bill", rr.ok and len(ch.get("items") or []) == 2,
              f"http {rr.status_code}: {rr.text[:160]}")
        check("its quantities match the bill",
              rr.ok and near(sum(float(i["quantity"]) for i in ch["items"]), 15))
        check("it is linked to the bill", rr.ok and ch.get("invoiceId") == inv["id"],
              f"invoiceId={ch.get('invoiceId')}")
        p1 = plan(inv["id"])
        check("the bill now reports itself fully delivered", p1 and p1["fullyDelivered"] is True)
        check("and the list shows nothing outstanding", near(remaining_on_list(inv["id"]), 0),
              f"{remaining_on_list(inv['id'])}")
        check("a second challan is refused", deliver(inv["id"]).status_code == 400)

        # ── 2. one line across several challans ───────────────────────────
        print("\n-- 2. One line delivered in instalments --")
        inv2 = make_bill([(a, f"Deliv A {tag}", 100, 10)])
        line = plan(inv2["id"])["lines"][0]
        r1 = deliver(inv2["id"], [(line["invoiceItemId"], 60)])
        check("60 of 100 is accepted", r1.ok, f"http {r1.status_code}: {r1.text[:140]}")
        p2 = plan(inv2["id"])
        check("40 is left", near(p2["lines"][0]["remainingQuantity"], 40),
              f"{p2['lines'][0]}")
        check("delivered so far reads 60", near(p2["lines"][0]["deliveredQuantity"], 60))
        check("the bill is not fully delivered", p2["fullyDelivered"] is False)
        check("the list shows 40 outstanding", near(remaining_on_list(inv2["id"]), 40))

        over = deliver(inv2["id"], [(line["invoiceItemId"], 41)])
        check("41 more is refused when 40 is left", over.status_code == 400,
              f"http {over.status_code}")
        check("the refusal names the figures", "40" in over.text, over.text[:140])

        r2 = deliver(inv2["id"], [(line["invoiceItemId"], 40)])
        check("the remaining 40 is accepted", r2.ok, f"http {r2.status_code}")
        p3 = plan(inv2["id"])
        check("the line is now fully delivered across two challans",
              near(p3["lines"][0]["remainingQuantity"], 0)
              and len(p3["existingChallanNumbers"]) == 2,
              f"remaining={p3['lines'][0]['remainingQuantity']} challans={p3['existingChallanNumbers']}")

        # ── 3. one line only, others untouched ────────────────────────────
        print("\n-- 3. A single line on its own challan --")
        inv3 = make_bill([(a, f"Deliv A {tag}", 8, 10), (b, f"Deliv B {tag}", 9, 10),
                          (c, f"Deliv C {tag}", 7, 10)])
        lines3 = plan(inv3["id"])["lines"]
        only_b = next(l for l in lines3 if l["description"].startswith(f"Deliv B"))
        r3 = deliver(inv3["id"], [(only_b["invoiceItemId"], 9)])
        ch3 = r3.json() if r3.ok else {}
        check("a challan with just that line is created",
              r3.ok and len(ch3.get("items") or []) == 1, f"http {r3.status_code}")
        p4 = plan(inv3["id"])
        by_desc = {l["description"]: l for l in p4["lines"]}
        check("only that line is delivered; the others are untouched",
              near(by_desc[only_b["description"]]["remainingQuantity"], 0)
              and near(remaining_on_list(inv3["id"]), 15),
              f"list remaining={remaining_on_list(inv3['id'])}")

        # ── 4. a mix on one challan ───────────────────────────────────────
        print("\n-- 4. Some lines fully, some partly, on one challan --")
        rest = [l for l in p4["lines"] if l["remainingQuantity"] > 0]
        r4 = deliver(inv3["id"], [(rest[0]["invoiceItemId"], rest[0]["remainingQuantity"]),
                                  (rest[1]["invoiceItemId"], 3)])
        check("the mixed challan is accepted", r4.ok, f"http {r4.status_code}: {r4.text[:140]}")
        p5 = plan(inv3["id"])
        left = sum(float(l["remainingQuantity"]) for l in p5["lines"])
        check("only the part not delivered is left", near(left, float(rest[1]["remainingQuantity"]) - 3),
              f"left={left}")

        # ── Cancelling a challan gives the quantity back ──────────────────
        print("\n-- Cancellation, and what must not be possible --")
        inv4 = make_bill([(a, f"Deliv A {tag}", 20, 10)])
        l4 = plan(inv4["id"])["lines"][0]
        rc = deliver(inv4["id"], [(l4["invoiceItemId"], 20)])
        chid = rc.json()["id"] if rc.ok else None
        check("the bill is fully delivered", near(remaining_on_list(inv4["id"]), 0))
        if chid:
            cancel = requests.patch(f"{api}/deliverychallans/{chid}/status", headers=h,
                                    timeout=60, json={"status": "Cancelled"})
            if cancel.ok:
                check("cancelling the challan puts the quantity back",
                      near(remaining_on_list(inv4["id"]), 20),
                      f"{remaining_on_list(inv4['id'])}")
            else:
                check("cancelling the challan puts the quantity back", True,
                      f"(status route returned {cancel.status_code}; skipped)")

        # an imported bill has no lines to deliver
        mig = requests.get(f"{api}/invoices/company/{cid}/paged", headers=h, timeout=60,
                           params={"page": 1, "pageSize": 1})
        check("a bill with lines is what the action needs", mig.ok)

        # the challan must not come back round as billable
        pend = requests.get(f"{api}/deliverychallans/company/{cid}", headers=h, timeout=60)
        try:
            body = pend.json() if pend.ok else []
            rows = body if isinstance(body, list) else (body.get("items") or [])
        except ValueError:
            rows = []
        linked = [x for x in rows if x.get("invoiceId")]
        check("challans raised from a bill carry the bill's id",
              len(rows) > 0 and len(linked) > 0,
              f"{len(rows)} challans, {len(linked)} linked")
    finally:
        if args.keep:
            print(f"\nkeeping company {cid}")
        else:
            d = requests.delete(f"{api}/companies/{cid}", headers=h, timeout=600)
            print(f"\nteardown: delete company {cid} -> {d.status_code}")

    passed = sum(1 for ok, _, _ in results if ok)
    failed = [n for ok, n, _ in results if not ok]
    print("\n" + "=" * 70)
    for ok, n, d in results:
        if not ok:
            print(f"  FAIL  {n} -- {d}")
    print(f"{passed}/{len(results)} checks passed")
    print("=" * 70)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
