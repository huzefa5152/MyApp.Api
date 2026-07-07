"""
Inventory V2 lifecycle regression — the benchmark for the 2026-07 inventory
redesign. Must pass before any push that touches the V2 inventory engine
(StockService gate, InventoryReadService, SalesOrderService reservation guard,
InvoiceService lineage/oversell guard, StockController summary/flow-version).

It pins the NEW polarity + lifecycle on a V2 company (the old
test_stock_itemtype_reflow.py stays byte-identical and pins V1). Contract:

  V2 POLARITY (inverts V1)
    • A NO-HS item type IS inventory: a purchase bill records IN, a bill
      records OUT. (Under V1 a no-HS item records nothing.)

  RESERVATION LIFECYCLE (derived read model — nothing persisted)
    • Sales Order created  → Qty To Deliver ↑, Committed ↑, Available ↓,
                             physical On Hand UNCHANGED.
    • Delivery Challan      → Delivered ↑, To Deliver ↓, Committed unchanged,
                             physical On Hand STILL UNCHANGED.
    • Invoice / Bill        → physical On Hand ↓ (stock finally leaves),
                             the billed challan drops out of Delivered.
    • Purchase Bill         → physical On Hand ↑.

  ENFORCEMENT (Q4 hard block)
    • Over-committing a Sales Order beyond Available is refused with 409.
    • Two concurrent bills for the last N units → exactly one succeeds, the
      other gets 409 (proves the availability guard is race-free, not TOCTOU).

  INVARIANTS (asserted after every read)
    • Committed == To Deliver + Delivered
    • Available == On Hand − Committed

Every test runs against a fresh ephemeral V2 company. Production is never
touched.

Usage:
  python scripts/test_stock_v2_lifecycle.py
  python scripts/test_stock_v2_lifecycle.py --base http://localhost:5134 --keep

Exit code 0 = every assertion passes. 1 = at least one failure.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

PASS = "PASS"
results: list[tuple[str, str, str]] = []
_created_item_type_ids: list[int] = []
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")


def http(method: str, path: str, base: str, token: str | None = None,
         body: Any = None, timeout: int = 30) -> tuple[int, Any]:
    url = base.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        try:
            return e.code, json.loads(raw) if raw else None
        except Exception:
            return e.code, raw


def check(suite: str, name: str, ok: bool, reason: str = "") -> None:
    results.append((suite, name, PASS if ok else f"FAIL — {reason}"))
    badge = "PASS" if ok else "FAIL"
    print(f"  [{badge}] {name}" + ("" if ok else f"  ({reason})"))


def approx(a: float, b: float, tol: float = 0.001) -> bool:
    return abs(float(a) - float(b)) <= tol


# ── Setup / teardown ───────────────────────────────────────────────
def setup(base: str, admin_user: str, admin_pw: str):
    print(f"\n=== Logging in as {admin_user} ===")
    status, data = http("POST", "/api/auth/login", base, body={
        "username": admin_user, "password": admin_pw})
    if status != 200:
        print(f"FATAL: admin login failed ({status} {data})")
        sys.exit(2)
    token = data["token"]

    suffix = datetime.now(timezone.utc).strftime("%H%M%S")
    status, company = http("POST", "/api/companies", base, token=token, body={
        "name": f"_v2_lifecycle {suffix}",
        "startingChallanNumber": 1,
        "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1,
        "startingGoodsReceiptNumber": 1,
        "startingSalesOrderNumber": 1,
        # FBR OFF: V2 non-HS items are billable without HS/UOM/SaleType,
        # so a challan lands "Pending" (billable) without FBR setup.
        "fbrEnabled": False,
        # V2 engine on, with the hard block so over-commit / oversell are refused.
        "inventoryTrackingEnabled": True,
        "stockGuardHardBlock": True,
    })
    if status not in (200, 201):
        print(f"FATAL: create company failed ({status} {company})")
        sys.exit(2)
    cid = company["id"]

    # Flip to V2 (all item types are inventory; HS is FBR metadata only).
    status, r = http("POST", f"/api/stock/company/{cid}/flow-version", base, token=token,
                     body={"version": 2})
    if status != 200:
        print(f"FATAL: flip to V2 failed ({status} {r})")
        sys.exit(2)

    status, client = http("POST", "/api/clients", base, token=token, body={
        "name": f"V2 Client {suffix}", "address": "1 Test Road, Karachi",
        "phone": "021-1234567", "companyId": cid,
        "registrationType": "Unregistered"})
    status2, supplier = http("POST", "/api/suppliers", base, token=token, body={
        "name": f"V2 Supplier {suffix}", "companyId": cid,
        "registrationType": "Unregistered"})
    if status not in (200, 201) or status2 not in (200, 201):
        print(f"FATAL: create client/supplier failed ({status} {client} / {status2} {supplier})")
        sys.exit(2)

    print(f"  company id={cid} (V2)  client id={client['id']}  supplier id={supplier['id']}")
    return token, company, client, supplier, suffix


def teardown(base: str, token: str, company: dict, keep: bool) -> None:
    if keep:
        print(f"\n=== Keeping company id={company['id']} (--keep) ===")
        return
    print("\n=== Teardown ===")
    for it_id in _created_item_type_ids:
        http("DELETE", f"/api/itemtypes/{it_id}", base, token=token)
    status, _ = http("DELETE", f"/api/companies/{company['id']}", base, token=token)
    print(f"  delete company returned {status}")


# ── Builders / readers ─────────────────────────────────────────────
def make_item(base, token, cid, name, uom="Pcs", hs=None) -> dict | None:
    body = {"name": name, "uom": uom, "companyId": cid}
    if hs:
        body["hsCode"] = hs
    status, it = http("POST", "/api/itemtypes", base, token=token, body=body)
    if status not in (200, 201):
        print(f"  ! make_item({name}) failed: {status} {it}")
        return None
    _created_item_type_ids.append(it["id"])
    return it


def buckets(suite, base, token, cid, item_id) -> dict:
    """Fetch the V2 summary row for an item and assert the internal invariants."""
    status, rows = http("GET", f"/api/stock/company/{cid}/summary", base, token=token)
    row = None
    if status == 200 and isinstance(rows, list):
        row = next((r for r in rows if r.get("itemTypeId") == item_id), None)
    if row is None:
        return {"onHand": 0.0, "committed": 0.0, "toDeliver": 0.0,
                "delivered": 0.0, "available": 0.0, "incoming": 0.0, "tracked": False}
    b = {k: float(row.get(k) or 0) for k in
         ("onHand", "committed", "toDeliver", "delivered", "available", "incoming")}
    b["tracked"] = bool(row.get("tracked"))
    # Invariants hold on every read.
    check(suite, f"invariant Committed=ToDeliver+Delivered ({item_id})",
          approx(b["committed"], b["toDeliver"] + b["delivered"]),
          f"committed={b['committed']} td={b['toDeliver']} del={b['delivered']}")
    check(suite, f"invariant Available=OnHand-Committed ({item_id})",
          approx(b["available"], b["onHand"] - b["committed"]),
          f"avail={b['available']} onhand={b['onHand']} committed={b['committed']}")
    return b


def create_po_bill(base, token, cid, supplier_id, item, qty) -> tuple[int, Any]:
    return http("POST", "/api/purchasebills", base, token=token, body={
        "date": TODAY, "companyId": cid, "supplierId": supplier_id, "gstRate": 18,
        "items": [{"itemTypeId": item["id"], "description": item["name"],
                   "quantity": qty, "unit": item.get("uom") or "Pcs", "unitPrice": 10}]})


def create_so(base, token, cid, client_id, lines, po="PO-V2") -> tuple[int, Any]:
    # A customer PO number flows onto the fulfilment challan so it lands
    # "Pending" (billable) on an FBR-off company.
    return http("POST", f"/api/salesorders/company/{cid}", base, token=token, body={
        "clientId": client_id, "orderDate": TODAY, "customerPoNumber": po,
        "items": [{"itemTypeId": it["id"], "description": it["name"],
                   "quantity": qty, "unit": it.get("uom") or "Pcs"} for it, qty in lines]})


# ── Suites ──────────────────────────────────────────────────────────
def suite_v2_polarity(base, token, cid, supplier, suffix):
    s = "1. V2 polarity - no-HS item is inventory"
    print(f"\n=== {s} ===")
    W = make_item(base, token, cid, f"V2_WIDGET_{suffix}")  # NO hs code
    if not W:
        check(s, "item created", False, "creation failed"); return None
    st, pb = create_po_bill(base, token, cid, supplier["id"], W, 100)
    check(s, "1.1 purchase bill created", st in (200, 201), f"{st} {pb}")
    b = buckets(s, base, token, cid, W["id"])
    # Under V1 a no-HS item records nothing and stays untracked; under V2 it
    # is real inventory (this is the inversion).
    check(s, "1.2 no-HS item is Tracked under V2 (V1 would be untracked)",
          b["tracked"], "expected tracked=true")
    check(s, "1.3 purchase records IN -> OnHand 100 (V1 would be 0)",
          approx(b["onHand"], 100), f"onHand={b['onHand']}")
    check(s, "1.4 Available 100, nothing committed",
          approx(b["available"], 100) and approx(b["committed"], 0), f"{b}")
    return W


def suite_reserve_deliver_bill(base, token, cid, client, W, suffix):
    s = "2. Reserve → Deliver → Bill lifecycle"
    print(f"\n=== {s} ===")
    # 2.1 Sales Order reserves 30 → ToDeliver 30, Available 70, physical unchanged.
    st, so = create_so(base, token, cid, client["id"], [(W, 30)])
    check(s, "2.1 sales order created", st in (200, 201), f"{st} {so}")
    if st not in (200, 201):
        return
    so_item_id = so["items"][0]["id"]
    b = buckets(s, base, token, cid, W["id"])
    check(s, "2.1 SO reserves: ToDeliver 30, Committed 30, Available 70, OnHand 100",
          approx(b["toDeliver"], 30) and approx(b["committed"], 30)
          and approx(b["available"], 70) and approx(b["onHand"], 100), f"{b}")

    # 2.2 Delivery challan for 30 → Delivered 30, ToDeliver 0, physical STILL 100.
    st, ch = http("POST", f"/api/salesorders/{so['id']}/create-challan", base, token=token, body={
        "deliveryDate": TODAY, "lines": [{"salesOrderItemId": so_item_id, "quantity": 30}]})
    check(s, "2.2 challan from order created", st in (200, 201), f"{st} {ch}")
    if st not in (200, 201):
        return
    b = buckets(s, base, token, cid, W["id"])
    check(s, "2.2 challan delivers: Delivered 30, ToDeliver 0, OnHand STILL 100",
          approx(b["delivered"], 30) and approx(b["toDeliver"], 0)
          and approx(b["onHand"], 100) and approx(b["available"], 70), f"{b}")

    # 2.3 Bill the challan → physical OnHand 70, Delivered drops out.
    ch_billable = ch.get("status") == "Pending"
    check(s, "2.3 challan is billable (Pending)", ch_billable, f"status={ch.get('status')}")
    if not ch_billable:
        return
    st, bill = http("POST", "/api/invoices", base, token=token, body={
        "date": TODAY, "companyId": cid, "clientId": client["id"], "gstRate": 0,
        "challanIds": [ch["id"]],
        "items": [{"deliveryItemId": ch["items"][0]["id"], "unitPrice": 50,
                   "description": W["name"]}]})
    check(s, "2.3 bill from challan created", st in (200, 201), f"{st} {bill}")
    if st not in (200, 201):
        return
    b = buckets(s, base, token, cid, W["id"])
    check(s, "2.3 bill leaves stock: OnHand 70, Delivered 0, Committed 0, Available 70",
          approx(b["onHand"], 70) and approx(b["delivered"], 0)
          and approx(b["committed"], 0) and approx(b["available"], 70), f"{b}")


def suite_overcommit_block(base, token, cid, client, suffix):
    s = "3. Over-commit hard block (409)"
    print(f"\n=== {s} ===")
    X = make_item(base, token, cid, f"V2_OC_{suffix}")
    if not X:
        check(s, "item created", False, "creation failed"); return
    # nothing purchased → OnHand 0, Available 0.
    st, so = create_so(base, token, cid, client["id"], [(X, 5)])
    check(s, "3.1 SO beyond Available refused with 409", st == 409, f"got {st} {so}")
    b = buckets(s, base, token, cid, X["id"])
    check(s, "3.1 rejected order did not reserve (ToDeliver 0)",
          approx(b["toDeliver"], 0), f"{b}")

    # V2 requires an item type on every SO line.
    st, r = http("POST", f"/api/salesorders/company/{cid}", base, token=token, body={
        "clientId": client["id"], "orderDate": TODAY,
        "items": [{"description": "no type", "quantity": 1, "unit": "Pcs"}]})
    check(s, "3.2 V2 SO line without item type rejected (400)", st == 400, f"got {st} {r}")


def suite_concurrency(base, token, cid, client, supplier, suffix):
    s = "4. Concurrent over-commit - exactly one wins"
    print(f"\n=== {s} ===")
    Y = make_item(base, token, cid, f"V2_RACE_{suffix}")
    if not Y:
        check(s, "item created", False, "creation failed"); return
    st, _ = create_po_bill(base, token, cid, supplier["id"], Y, 5)  # only 5 on hand
    check(s, "4.1 seeded OnHand 5", approx(buckets(s, base, token, cid, Y["id"])["onHand"], 5))

    # Two Sales Orders each try to reserve all 5 units at the same time. The
    # per-company stock lock serialises the check-then-reserve, so exactly one
    # commits and the other re-checks under the lock and gets a 409 — the proof
    # that the guard is race-free rather than TOCTOU.
    def reserve5(po):
        return create_so(base, token, cid, client["id"], [(Y, 5)], po=po)

    with ThreadPoolExecutor(max_workers=2) as ex:
        r1, r2 = [f.result() for f in [ex.submit(reserve5, "PO-R1"), ex.submit(reserve5, "PO-R2")]]
    codes = sorted([r1[0], r2[0]])
    wins = sum(1 for c in codes if c in (200, 201))
    blocks = sum(1 for c in codes if c == 409)
    check(s, "4.2 exactly one order reserved, one 409", wins == 1 and blocks == 1,
          f"codes={codes} r1={r1[0]} r2={r2[0]}")
    b = buckets(s, base, token, cid, Y["id"])
    check(s, "4.3 Available not driven negative (committed <= 5)",
          b["committed"] <= 5.0 + 0.001 and b["available"] >= -0.001, f"{b}")


# ── Report / main ───────────────────────────────────────────────────
def print_report() -> int:
    print("\n" + "=" * 60)
    failures = [r for r in results if r[2] != PASS]
    total = len(results)
    passed = total - len(failures)
    if failures:
        print(f"\n{len(failures)} FAILURE(S):")
        for suite, name, status in failures:
            print(f"  [{suite}] {name}: {status}")
    print(f"\n=== {passed}/{total} checks passed ===")
    return 0 if not failures else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--pw", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    # Windows consoles default to cp1252; force UTF-8 so the arrows in check
    # names don't crash the run.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    token, company, client, supplier, suffix = setup(args.base, args.user, args.pw)
    try:
        W = suite_v2_polarity(args.base, token, company["id"], supplier, suffix)
        if W:
            suite_reserve_deliver_bill(args.base, token, company["id"], client, W, suffix)
        suite_overcommit_block(args.base, token, company["id"], client, suffix)
        suite_concurrency(args.base, token, company["id"], client, supplier, suffix)
    finally:
        teardown(args.base, token, company, args.keep)
    return print_report()


if __name__ == "__main__":
    sys.exit(main())
