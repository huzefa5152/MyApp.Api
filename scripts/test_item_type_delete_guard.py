#!/usr/bin/env python3
"""Deleting an item type that still holds stock must be refused.

Why this exists: the delete rule blocked only on PENDING documents, reasoning
that "StockMovements carry the qty data we need regardless". True of the ledger,
false of the dashboard — the on-hand grid joins the catalog and skips deleted
rows, so deleting a stocked item made real goods vanish from the screen while
the movements kept listing underneath. It happened on a live company: 134 units
went invisible, and the bill whose overlay pointed at the deleted row lost its
classification in the edit form at the same time.

Half of this suite is deliberately POSITIVE: an item type with no stock must
still be deletable, or the guard would just mean "nothing can ever be deleted"
and would pass equally well if it blocked everything.

Local only; builds its own throwaway company and deletes it afterwards.

    python scripts/test_item_type_delete_guard.py
"""
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import os

BASE = os.environ.get("MYAPP_BASE", "http://localhost:5134")
PASSED = FAILED = 0
FAILURES = []


def check(label, ok, detail=""):
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  PASS  {label}")
    else:
        FAILED += 1
        FAILURES.append(f"{label} — {detail}")
        print(f"  FAIL  {label}  ({detail})")


def http(method, path, jwt=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if jwt:
        h["Authorization"] = f"Bearer {jwt}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def err(p):
    return str(p.get("error") or p.get("message") or p) if isinstance(p, dict) else str(p)


def main():
    st, auth = http("POST", "/api/auth/login", body={"username": "admin", "password": "admin123"})
    jwt = auth["token"]
    suffix = datetime.now().strftime("%H%M%S")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

    st, co = http("POST", "/api/companies", jwt, {
        "name": f"_delguard {suffix}", "fullAddress": "T", "phone": "+92-21-00000000",
        "ntn": "9999999", "cnic": "9999999999999", "fbrSellerRegistrationNo": "9999999",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Manufacturer", "fbrSector": "All Other Sectors",
    })
    assert st in (200, 201), (st, co)
    company_id = co["id"]

    try:
        # Two item types: one will be given stock, the other left empty.
        made = []
        for tag in ("stocked", "empty"):
            st, t = http("POST", "/api/itemtypes", jwt, {
                "name": f"_delguard {tag} {suffix}",
                "hsCode": "8443.1700", "uom": "Pcs",
                "saleType": "Goods at Standard Rate (default)",
                "companyId": company_id,
            })
            assert st in (200, 201), (tag, st, t)
            made.append(t)
        stocked, empty = made

        # Give one of them stock via an opening balance.
        st, res = http("POST", "/api/stock/adjust", jwt, {
            "companyId": company_id, "itemTypeId": stocked["id"],
            "delta": 25, "movementDate": today, "notes": "delete-guard fixture",
        })
        print(f"  (seeded stock via adjust -> HTTP {st} {err(res) if st not in (200,201,204) else ''})")

        st, on = http("GET", f"/api/stock/company/{company_id}/onhand", jwt)
        held = next((r for r in (on or []) if r.get("itemTypeId") == stocked["id"]), None)
        check("the item type really holds stock before we try",
              held is not None and float(held.get("onHand") or 0) != 0,
              f"onhand rows={on}")

        # THE GUARD
        st, res = http("DELETE", f"/api/itemtypes/{stocked['id']}", jwt)
        check("deleting an item type that holds stock is refused",
              st == 400, f"got {st} {err(res)}")
        check("the refusal says it is about stock, and how much",
              st == 400 and "stock" in err(res).lower() and "25" in err(res),
              f"message: {err(res)[:160]}")

        st, after = http("GET", f"/api/itemtypes/{stocked['id']}", jwt)
        check("the refused item type is still there", st == 200,
              f"GET after refusal -> {st}")

        # ...and the guard must not become "nothing is deletable".
        st, res = http("DELETE", f"/api/itemtypes/{empty['id']}", jwt)
        check("an item type with NO stock is still deletable",
              st in (200, 204), f"got {st} {err(res)}")

    finally:
        http("DELETE", f"/api/companies/{company_id}", jwt)

    print("\n" + "=" * 60)
    print(f"  {PASSED} passed, {FAILED} failed")
    for f in FAILURES:
        print(f"   - {f}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
