"""
Stock item-type reflow regression tests — must pass before any push that
touches stock movement reflow on purchase bills, invoices, or delivery
challans (StockService, PurchaseBillService, InvoiceService,
DeliveryChallanService).

The contract under test ("inventory stays settled"):

  PURCHASE BILL (Stock IN side)
    • Creating a bill with a classified (HS-coded) ItemType records IN.
    • Editing the bill to a DIFFERENT ItemType reverses the IN off the old
      item and records IN on the new one — net per item is correct.
    • Editing to an UNCLASSIFIED (no HS) ItemType records no IN.
    • Deleting the bill reverses all of its IN.
    • Classify-after-create (the phantom-reversal guard): a bill created
      while its ItemType had no HS code records no IN; if the ItemType is
      later given an HS code and the bill is edited, the edit must NOT
      fabricate a negative reversal for an IN that never happened.

  INVOICE (Stock OUT side) — narrow item-type edit, full edit, and the
  challan-driven add/remove/qty path
    • Selling a classified ItemType records OUT.
    • Changing the line's ItemType reverses OUT off the old item and
      records OUT on the new one.
    • Clearing the ItemType (or removing the line on the linked challan)
      reverses the OUT — inventory comes back.
    • Changing quantity reflows the OUT to the new quantity.
    • Deleting / cancelling the bill reverses the OUT.

Every test runs against a fresh ephemeral company + supplier + client and
its own dedicated ItemTypes. Production data is never touched.

Usage:
  python scripts/test_stock_itemtype_reflow.py
  python scripts/test_stock_itemtype_reflow.py --base http://localhost:5134 --keep

Exit code 0 = every assertion passes. 1 = at least one failure.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

PASS = "PASS"
results: list[tuple[str, str, str]] = []  # (suite, name, status)
_created_item_type_ids: list[int] = []
# Pool of real PRAL HS codes harvested from the live catalog at setup.
# Each test ItemType gets a DISTINCT code so the catalog's near-duplicate
# guard (similar name + same HS) never fires between our test items.
_hs_pool: list[str] = []
_hs_idx = 0


def next_hs() -> str:
    """Return the next unused real HS code from the harvested pool."""
    global _hs_idx
    if not _hs_pool:
        return "8538.1000"  # fallback; should never hit once pool is filled
    code = _hs_pool[_hs_idx % len(_hs_pool)]
    _hs_idx += 1
    return code


# ── HTTP helper ────────────────────────────────────────────────────
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


TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")


# ── Setup / teardown ───────────────────────────────────────────────
def setup(base: str, admin_user: str, admin_pw: str):
    print(f"\n=== Logging in as {admin_user} ===")
    status, data = http("POST", "/api/auth/login", base, body={
        "username": admin_user, "password": admin_pw})
    if status != 200:
        print(f"FATAL: admin login failed ({status} {data})")
        sys.exit(2)
    token = data["token"]

    # Harvest real HS codes from the live catalog so every test ItemType
    # gets a valid, DISTINCT code (avoids both PRAL validation rejects and
    # the near-duplicate guard).
    st, items = http("GET", "/api/itemtypes", base, token=token)
    if st == 200 and isinstance(items, list):
        seen = set()
        for it in items:
            hs = (it.get("hsCode") or "").strip()
            if hs and hs not in seen:
                seen.add(hs)
                _hs_pool.append(hs)
    print(f"  harvested {len(_hs_pool)} distinct HS codes from catalog")
    if len(_hs_pool) < 10:
        print("  WARNING: small HS pool — codes may repeat across test items")

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    company_name = f"_test_stock_reflow {suffix}"

    print(f"=== Creating ephemeral test company '{company_name}' (inventory tracking ON) ===")
    status, company = http("POST", "/api/companies", base, token=token, body={
        "name": company_name,
        "fullAddress": "Test HQ",
        "phone": "+92-21-00000000",
        "ntn": "9999999",
        "cnic": "9999999999999",
        "strn": "9999999999999",
        "startingChallanNumber": 1,
        "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1,
        "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox",
        "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Manufacturer",
        "fbrSector": "All Other Sectors",
        "fbrToken": "test-token-not-used-for-real-pral-calls",
        # The whole point of this suite — auto stock IN/OUT tracking on.
        # Hard block OFF so a sale with no on-hand still records OUT
        # (we assert on deltas, not on shortage rejection).
        "inventoryTrackingEnabled": True,
        "stockGuardHardBlock": False,
    })
    if status not in (200, 201):
        print(f"FATAL: create company failed ({status} {company})")
        sys.exit(2)
    cid = company["id"]
    print(f"  company id={cid}")

    status, client = http("POST", "/api/clients", base, token=token, body={
        "name": f"Reflow Client {suffix}",
        "address": "1 Test Road, Karachi",
        "phone": "021-1234567",
        "companyId": cid,
        "ntn": "1234567",
        "strn": "1234567890123",
        "fbrProvinceCode": 8,
        "registrationType": "Registered",
    })
    if status not in (200, 201):
        print(f"FATAL: create client failed ({status} {client})")
        sys.exit(2)

    status, supplier = http("POST", "/api/suppliers", base, token=token, body={
        "name": f"Reflow Supplier {suffix}",
        "companyId": cid,
        "ntn": "7654321",
        "registrationType": "Registered",
        "fbrProvinceCode": 8,
    })
    if status not in (200, 201):
        print(f"FATAL: create supplier failed ({status} {supplier})")
        sys.exit(2)

    print(f"  client id={client['id']}  supplier id={supplier['id']}")
    return token, company, client, supplier, suffix


def teardown(base: str, token: str, company: dict, keep: bool) -> None:
    if keep:
        print(f"\n=== Keeping company id={company['id']} (--keep) ===")
        return
    print(f"\n=== Teardown ===")
    for it_id in _created_item_type_ids:
        http("DELETE", f"/api/itemtypes/{it_id}", base, token=token)
    status, _ = http("DELETE", f"/api/companies/{company['id']}", base, token=token)
    print(f"  delete company returned {status}")


# ── Builders ───────────────────────────────────────────────────────
def make_item_type(base, token, name, hs=None, uom="Pcs",
                   sale_type="Goods at standard rate (default)") -> dict | None:
    body = {"name": name, "uom": uom, "saleType": sale_type}
    if hs:
        body["hsCode"] = hs
    status, it = http("POST", "/api/itemtypes", base, token=token, body=body)
    if status not in (200, 201):
        print(f"  ! make_item_type({name}) failed: {status} {it}")
        return None
    _created_item_type_ids.append(it["id"])
    return it


def set_item_type_hs(base, token, it, hs) -> bool:
    body = {"name": it["name"], "hsCode": hs,
            "uom": it.get("uom") or "Pcs",
            "saleType": it.get("saleType") or "Goods at standard rate (default)"}
    status, _ = http("PUT", f"/api/itemtypes/{it['id']}", base, token=token, body=body)
    return status == 200


def onhand(base, token, cid, item_id) -> float:
    status, rows = http("GET", f"/api/stock/company/{cid}/onhand", base, token=token)
    if status != 200 or not isinstance(rows, list):
        return 0.0
    for r in rows:
        if r.get("itemTypeId") == item_id:
            return float(r.get("onHand") or 0)
    return 0.0


def grid_row(base, token, cid, item_id) -> dict:
    """Full on-hand grid row for an item: onHand + totalIn + totalOut."""
    status, rows = http("GET", f"/api/stock/company/{cid}/onhand", base, token=token)
    if status == 200 and isinstance(rows, list):
        for r in rows:
            if r.get("itemTypeId") == item_id:
                return {"onHand": float(r.get("onHand") or 0),
                        "totalIn": float(r.get("totalIn") or 0),
                        "totalOut": float(r.get("totalOut") or 0)}
    return {"onHand": 0.0, "totalIn": 0.0, "totalOut": 0.0}


def move_count(base, token, cid, item_id) -> int:
    """How many stock movements exist for an item (via the audit feed)."""
    status, page = http("GET", f"/api/stock/company/{cid}/movements?itemTypeId={item_id}&pageSize=200",
                        base, token=token)
    if status == 200 and isinstance(page, dict):
        return int(page.get("totalCount") or 0)
    return -1


def in_grid(base, token, cid, item_id) -> bool:
    """True if the item type appears as a row on the on-hand grid at all."""
    status, rows = http("GET", f"/api/stock/company/{cid}/onhand", base, token=token)
    if status == 200 and isinstance(rows, list):
        return any(r.get("itemTypeId") == item_id for r in rows)
    return False


def create_pb(base, token, cid, supplier_id, items) -> tuple[int, Any]:
    return http("POST", "/api/purchasebills", base, token=token, body={
        "date": TODAY, "companyId": cid, "supplierId": supplier_id,
        "gstRate": 18, "items": items})


def update_pb(base, token, bill_id, items, gst=18) -> tuple[int, Any]:
    return http("PUT", f"/api/purchasebills/{bill_id}", base, token=token, body={
        "date": TODAY, "gstRate": gst, "items": items})


def create_standalone(base, token, cid, client_id, items) -> tuple[int, Any]:
    return http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": TODAY, "companyId": cid, "clientId": client_id,
        "gstRate": 18, "items": items})


def adjust(base, token, iid, items) -> tuple[int, Any]:
    """Tax-consultant overlay edit (dual-book): writes InvoiceItemAdjustment,
    leaves the physical InvoiceItem untouched. Each item row = {id, itemTypeId?,
    quantity?, unitPrice?}."""
    return http("PATCH", f"/api/invoices/{iid}/itemtypes-and-qty", base, token=token,
                body={"writeMode": "adjustment", "items": items})


def put_invoice(base, token, iid, items, gst=18) -> tuple[int, Any]:
    """Bill-mode full edit — mutates the physical InvoiceItem. Never touches
    the overlay, so stock resolves EffType/Qty = Adjusted?? physical."""
    return http("PUT", f"/api/invoices/{iid}", base, token=token,
                body={"gstRate": gst, "items": items})


def line_of(inv, desc):
    """InvoiceItem id for the line whose description matches (ids are stable
    across overlay/PUT/challan edits, so capture once at create)."""
    for it in inv.get("items", []):
        if it.get("description") == desc:
            return it["id"]
    return inv["items"][0]["id"]


# ── Suite 1 — Purchase bill IN + item-type reflow ──────────────────
def suite_purchase_reflow(base, token, cid, supplier, suffix):
    s = "1. Purchase bill IN reflow"
    print(f"\n=== {s} ===")
    A = make_item_type(base, token, f"PB_A_{suffix}", hs=next_hs())
    B = make_item_type(base, token, f"PB_B_{suffix}", hs=next_hs())
    C = make_item_type(base, token, f"PB_C_noHS_{suffix}", hs=None)
    if not (A and B and C):
        check(s, "item types created", False, "creation failed"); return

    # 1.1 create PB with item A qty 100 → A IN 100
    st, bill = create_pb(base, token, cid, supplier["id"], [
        {"itemTypeId": A["id"], "description": "valve", "quantity": 100, "unitPrice": 10}])
    check(s, "1.1 create PB(A,100) ok", st in (200, 201), f"{st} {bill}")
    if st not in (200, 201):
        return
    bid = bill["id"]
    check(s, "1.1 A on-hand = 100", approx(onhand(base, token, cid, A["id"]), 100),
          f"got {onhand(base, token, cid, A['id'])}")

    # 1.2 edit PB: change line item A → B  (reverse A, add B)
    line_id = bill["items"][0]["id"]
    st, upd = update_pb(base, token, bid, [
        {"id": line_id, "itemTypeId": B["id"], "description": "valve",
         "quantity": 100, "uom": "Pcs", "unitPrice": 10}])
    check(s, "1.2 edit A→B ok", st == 200, f"{st} {upd}")
    check(s, "1.2 A on-hand back to 0", approx(onhand(base, token, cid, A["id"]), 0),
          f"got {onhand(base, token, cid, A['id'])}")
    check(s, "1.2 B on-hand = 100", approx(onhand(base, token, cid, B["id"]), 100),
          f"got {onhand(base, token, cid, B['id'])}")

    # 1.3 edit PB: change qty 100 → 60
    line_id = (upd or bill)["items"][0]["id"]
    st, upd = update_pb(base, token, bid, [
        {"id": line_id, "itemTypeId": B["id"], "description": "valve",
         "quantity": 60, "uom": "Pcs", "unitPrice": 10}])
    check(s, "1.3 edit qty 100→60 ok", st == 200, f"{st} {upd}")
    check(s, "1.3 B on-hand = 60", approx(onhand(base, token, cid, B["id"]), 60),
          f"got {onhand(base, token, cid, B['id'])}")

    # 1.4 edit PB: change item B → C (no HS) → no IN recorded
    line_id = (upd)["items"][0]["id"]
    st, upd = update_pb(base, token, bid, [
        {"id": line_id, "itemTypeId": C["id"], "description": "valve",
         "quantity": 60, "uom": "Pcs", "unitPrice": 10}])
    check(s, "1.4 edit B→C(noHS) ok", st == 200, f"{st} {upd}")
    check(s, "1.4 B on-hand back to 0", approx(onhand(base, token, cid, B["id"]), 0),
          f"got {onhand(base, token, cid, B['id'])}")
    check(s, "1.4 C on-hand = 0 (unclassified, untracked)",
          approx(onhand(base, token, cid, C["id"]), 0),
          f"got {onhand(base, token, cid, C['id'])}")

    # 1.5 edit PB: change C → B again → B IN restored
    line_id = (upd)["items"][0]["id"]
    st, upd = update_pb(base, token, bid, [
        {"id": line_id, "itemTypeId": B["id"], "description": "valve",
         "quantity": 60, "uom": "Pcs", "unitPrice": 10}])
    check(s, "1.5 edit C→B ok", st == 200, f"{st} {upd}")
    check(s, "1.5 B on-hand = 60 (re-added)", approx(onhand(base, token, cid, B["id"]), 60),
          f"got {onhand(base, token, cid, B['id'])}")

    # 1.6 delete PB → B reversed to 0
    st, _ = http("DELETE", f"/api/purchasebills/{bid}", base, token=token)
    check(s, "1.6 delete PB ok", st in (200, 204), f"{st}")
    check(s, "1.6 B on-hand = 0 (reversed on delete)",
          approx(onhand(base, token, cid, B["id"]), 0),
          f"got {onhand(base, token, cid, B['id'])}")


# ── Suite 2 — classify-after-create phantom guard ──────────────────
def suite_phantom_guard(base, token, cid, supplier, suffix):
    s = "2. Purchase classify-after-create (no phantom)"
    print(f"\n=== {s} ===")
    D = make_item_type(base, token, f"PB_D_late_{suffix}", hs=None)  # starts unclassified
    if not D:
        check(s, "item type created", False, "creation failed"); return

    # 2.1 create PB while D has no HS → no IN
    st, bill = create_pb(base, token, cid, supplier["id"], [
        {"itemTypeId": D["id"], "description": "late valve", "quantity": 170, "unitPrice": 5}])
    check(s, "2.1 create PB(D,170) ok", st in (200, 201), f"{st} {bill}")
    if st not in (200, 201):
        return
    bid = bill["id"]
    check(s, "2.1 D on-hand = 0 (untracked at create)",
          approx(onhand(base, token, cid, D["id"]), 0),
          f"got {onhand(base, token, cid, D['id'])}")

    # 2.2 classify D (add HS code)
    check(s, "2.2 add HS code to D", set_item_type_hs(base, token, D, next_hs()), "PUT failed")

    # 2.3 re-save the bill unchanged → must become +170, NOT 0 (phantom) or 340 (double)
    line_id = bill["items"][0]["id"]
    st, upd = update_pb(base, token, bid, [
        {"id": line_id, "itemTypeId": D["id"], "description": "late valve",
         "quantity": 170, "uom": "Pcs", "unitPrice": 5}])
    check(s, "2.3 re-save after classify ok", st == 200, f"{st} {upd}")
    check(s, "2.3 D on-hand = 170 (no phantom reversal, no double)",
          approx(onhand(base, token, cid, D["id"]), 170),
          f"got {onhand(base, token, cid, D['id'])}")

    # 2.4 edit qty 170 → 200 → net should be exactly 200
    line_id = (upd)["items"][0]["id"]
    st, upd = update_pb(base, token, bid, [
        {"id": line_id, "itemTypeId": D["id"], "description": "late valve",
         "quantity": 200, "uom": "Pcs", "unitPrice": 5}])
    check(s, "2.4 edit qty 170→200 ok", st == 200, f"{st} {upd}")
    check(s, "2.4 D on-hand = 200 (clean reflow)",
          approx(onhand(base, token, cid, D["id"]), 200),
          f"got {onhand(base, token, cid, D['id'])}")

    http("DELETE", f"/api/purchasebills/{bid}", base, token=token)
    check(s, "2.5 D on-hand = 0 after delete",
          approx(onhand(base, token, cid, D["id"]), 0),
          f"got {onhand(base, token, cid, D['id'])}")


# ── Helper: pre-stock a set of items via one purchase bill ─────────
def prestock(base, token, cid, supplier_id, items_qty: list[tuple[dict, float]]):
    items = [{"itemTypeId": it["id"], "description": it["name"],
              "quantity": q, "unitPrice": 10} for it, q in items_qty]
    st, bill = create_pb(base, token, cid, supplier_id, items)
    return st, bill


# ── Suite 3 — Invoice OUT reflow via narrow item-type edit (PATCH) ─
def suite_invoice_narrow_reflow(base, token, cid, client, supplier, suffix):
    s = "3. Invoice OUT reflow (narrow itemtypes edit)"
    print(f"\n=== {s} ===")
    A = make_item_type(base, token, f"SN_A_{suffix}", hs=next_hs())
    B = make_item_type(base, token, f"SN_B_{suffix}", hs=next_hs())
    if not (A and B):
        check(s, "item types created", False, "creation failed"); return

    st, _ = prestock(base, token, cid, supplier["id"], [(A, 100), (B, 100)])
    check(s, "3.0 pre-stock A,B +100 ok", st in (200, 201), f"{st}")
    check(s, "3.0 A=100,B=100", approx(onhand(base, token, cid, A["id"]), 100)
          and approx(onhand(base, token, cid, B["id"]), 100),
          f"A={onhand(base, token, cid, A['id'])} B={onhand(base, token, cid, B['id'])}")

    # 3.1 sell A qty 30 → A 70
    st, inv = create_standalone(base, token, cid, client["id"], [
        {"itemTypeId": A["id"], "description": "sell valve", "quantity": 30,
         "uom": "Pcs", "unitPrice": 50}])
    check(s, "3.1 sell A×30 ok", st in (200, 201), f"{st} {inv}")
    if st not in (200, 201):
        return
    iid = inv["id"]
    check(s, "3.1 A on-hand = 70 (OUT recorded)",
          approx(onhand(base, token, cid, A["id"]), 70),
          f"got {onhand(base, token, cid, A['id'])}")

    # 3.2 narrow edit: change line item A → B → A back 100, B 70
    line_id = inv["items"][0]["id"]
    st, upd = http("PATCH", f"/api/invoices/{iid}/itemtypes", base, token=token,
                   body={"items": [{"id": line_id, "itemTypeId": B["id"]}]})
    check(s, "3.2 PATCH A→B ok", st == 200, f"{st} {upd}")
    check(s, "3.2 A on-hand back to 100", approx(onhand(base, token, cid, A["id"]), 100),
          f"got {onhand(base, token, cid, A['id'])}")
    check(s, "3.2 B on-hand = 70 (OUT moved)", approx(onhand(base, token, cid, B["id"]), 70),
          f"got {onhand(base, token, cid, B['id'])}")

    # 3.3 narrow edit: clear the item type (null) → OUT removed, B back 100
    st, upd = http("PATCH", f"/api/invoices/{iid}/itemtypes", base, token=token,
                   body={"items": [{"id": line_id, "itemTypeId": None}]})
    check(s, "3.3 PATCH clear item type ok", st == 200, f"{st} {upd}")
    check(s, "3.3 B on-hand back to 100 (OUT removed)",
          approx(onhand(base, token, cid, B["id"]), 100),
          f"got {onhand(base, token, cid, B['id'])}")

    # 3.4 narrow edit: set back to A → A 70 again
    st, upd = http("PATCH", f"/api/invoices/{iid}/itemtypes", base, token=token,
                   body={"items": [{"id": line_id, "itemTypeId": A["id"]}]})
    check(s, "3.4 PATCH none→A ok", st == 200, f"{st} {upd}")
    check(s, "3.4 A on-hand = 70 (OUT re-added)",
          approx(onhand(base, token, cid, A["id"]), 70),
          f"got {onhand(base, token, cid, A['id'])}")

    # 3.5 delete invoice → A restored to 100
    st, _ = http("DELETE", f"/api/invoices/{iid}", base, token=token)
    check(s, "3.5 delete invoice ok", st in (200, 204), f"{st}")
    check(s, "3.5 A on-hand = 100 (OUT reversed on delete)",
          approx(onhand(base, token, cid, A["id"]), 100),
          f"got {onhand(base, token, cid, A['id'])}")


# ── Suite 4 — Invoice OUT reflow via FULL edit (PUT /{id}) ─────────
def suite_invoice_full_reflow(base, token, cid, client, supplier, suffix):
    s = "4. Invoice OUT reflow (full edit PUT)"
    print(f"\n=== {s} ===")
    A = make_item_type(base, token, f"SF_A_{suffix}", hs=next_hs())
    B = make_item_type(base, token, f"SF_B_{suffix}", hs=next_hs())
    if not (A and B):
        check(s, "item types created", False, "creation failed"); return

    prestock(base, token, cid, supplier["id"], [(A, 100), (B, 100)])

    # 4.1 sell A qty 40 → A 60
    st, inv = create_standalone(base, token, cid, client["id"], [
        {"itemTypeId": A["id"], "description": "sell A", "quantity": 40,
         "uom": "Pcs", "unitPrice": 50}])
    check(s, "4.1 sell A×40 ok", st in (200, 201), f"{st} {inv}")
    if st not in (200, 201):
        return
    iid = inv["id"]
    check(s, "4.1 A on-hand = 60", approx(onhand(base, token, cid, A["id"]), 60),
          f"got {onhand(base, token, cid, A['id'])}")

    # 4.2 full edit: change line item A → B (keep qty 40)
    line_id = inv["items"][0]["id"]
    st, upd = http("PUT", f"/api/invoices/{iid}", base, token=token, body={
        "gstRate": 18, "items": [
            {"id": line_id, "itemTypeId": B["id"], "description": "sell A",
             "quantity": 40, "uom": "Pcs", "unitPrice": 50}]})
    check(s, "4.2 PUT A→B ok", st == 200, f"{st} {upd}")
    check(s, "4.2 A on-hand back to 100", approx(onhand(base, token, cid, A["id"]), 100),
          f"got {onhand(base, token, cid, A['id'])}")
    check(s, "4.2 B on-hand = 60", approx(onhand(base, token, cid, B["id"]), 60),
          f"got {onhand(base, token, cid, B['id'])}")

    # 4.3 full edit: change qty 40 → 25 (B)
    line_id = upd["items"][0]["id"]
    st, upd = http("PUT", f"/api/invoices/{iid}", base, token=token, body={
        "gstRate": 18, "items": [
            {"id": line_id, "itemTypeId": B["id"], "description": "sell A",
             "quantity": 25, "uom": "Pcs", "unitPrice": 50}]})
    check(s, "4.3 PUT qty 40→25 ok", st == 200, f"{st} {upd}")
    check(s, "4.3 B on-hand = 75 (OUT reflowed)",
          approx(onhand(base, token, cid, B["id"]), 75),
          f"got {onhand(base, token, cid, B['id'])}")

    # 4.4 delete → B restored to 100
    http("DELETE", f"/api/invoices/{iid}", base, token=token)
    check(s, "4.4 B on-hand = 100 after delete",
          approx(onhand(base, token, cid, B["id"]), 100),
          f"got {onhand(base, token, cid, B['id'])}")


# ── Suite 5 — Challan-driven invoice OUT (Bug 2: remove/qty reflow) ─
def suite_challan_reflow(base, token, cid, client, supplier, suffix):
    s = "5. Challan→Invoice OUT reflow (remove/qty)"
    print(f"\n=== {s} ===")
    A = make_item_type(base, token, f"CH_A_{suffix}", hs=next_hs())
    B = make_item_type(base, token, f"CH_B_{suffix}", hs=next_hs())
    if not (A and B):
        check(s, "item types created", False, "creation failed"); return

    prestock(base, token, cid, supplier["id"], [(A, 100), (B, 100)])

    # 5.1 create challan with A(10), B(5), then bill it → A 90, B 95
    st, ch = http("POST", f"/api/deliverychallans/company/{cid}", base, token=token, body={
        "companyId": cid, "clientId": client["id"],
        "poNumber": "PO-REFLOW-1", "poDate": TODAY, "deliveryDate": TODAY,
        "items": [
            {"itemTypeId": A["id"], "itemTypeName": A["name"], "description": "ch A", "quantity": 10, "unit": "Pcs"},
            {"itemTypeId": B["id"], "itemTypeName": B["name"], "description": "ch B", "quantity": 5, "unit": "Pcs"},
        ]})
    check(s, "5.1 create challan ok", st in (200, 201), f"{st} {ch}")
    if st not in (200, 201):
        return
    if ch.get("status") != "Pending":
        check(s, "5.1 challan billable (Pending)", False, f"status={ch.get('status')}")
        return
    st, bill = http("POST", "/api/invoices", base, token=token, body={
        "date": TODAY, "companyId": cid, "clientId": client["id"], "gstRate": 18,
        "challanIds": [ch["id"]],
        "items": [
            {"deliveryItemId": ch["items"][0]["id"], "unitPrice": 50, "description": "ch A"},
            {"deliveryItemId": ch["items"][1]["id"], "unitPrice": 50, "description": "ch B"},
        ]})
    check(s, "5.1 bill from challan ok", st in (200, 201), f"{st} {bill}")
    if st not in (200, 201):
        return
    iid = bill["id"]
    check(s, "5.1 A=90, B=95 (OUT recorded for both)",
          approx(onhand(base, token, cid, A["id"]), 90) and approx(onhand(base, token, cid, B["id"]), 95),
          f"A={onhand(base, token, cid, A['id'])} B={onhand(base, token, cid, B['id'])}")

    # 5.2 remove item B on the CHALLAN (only way to drop a billed line)
    #     → invoice B OUT reversed, B restored to 100, A unchanged.
    keep_a = ch["items"][0]
    st, upd = http("PUT", f"/api/deliverychallans/{ch['id']}/items", base, token=token, body=[
        {"id": keep_a["id"], "itemTypeId": A["id"], "description": "ch A",
         "quantity": 10, "unit": "Pcs"}])
    check(s, "5.2 challan remove B ok", st == 200, f"{st} {upd}")
    check(s, "5.2 B on-hand back to 100 (sale OUT reversed)",
          approx(onhand(base, token, cid, B["id"]), 100),
          f"got {onhand(base, token, cid, B['id'])}")
    check(s, "5.2 A on-hand still 90", approx(onhand(base, token, cid, A["id"]), 90),
          f"got {onhand(base, token, cid, A['id'])}")

    # 5.3 change A qty 10 → 4 on the challan → invoice A OUT reflows → A 96
    st, upd = http("PUT", f"/api/deliverychallans/{ch['id']}/items", base, token=token, body=[
        {"id": keep_a["id"], "itemTypeId": A["id"], "description": "ch A",
         "quantity": 4, "unit": "Pcs"}])
    check(s, "5.3 challan A qty 10→4 ok", st == 200, f"{st} {upd}")
    check(s, "5.3 A on-hand = 96 (OUT reflowed to qty 4)",
          approx(onhand(base, token, cid, A["id"]), 96),
          f"got {onhand(base, token, cid, A['id'])}")

    # 5.4 delete the bill → A fully restored to 100
    http("DELETE", f"/api/invoices/{iid}", base, token=token)
    check(s, "5.4 A on-hand = 100 after bill delete",
          approx(onhand(base, token, cid, A["id"]), 100),
          f"got {onhand(base, token, cid, A['id'])}")


# ── Suite 6 — No-op / delta edit produces no stock churn ───────────
# Regression for 2026-07-07: editing a purchase bill (or invoice) and
# saving without changing any tracked item's quantity/type must record
# NO stock movement. Previously the purchase path reversed the whole
# posted net and re-emitted it on every save, inflating Total In/Out;
# the invoice path re-inserted identical rows, churning the audit feed.
def suite_noop_delta(base, token, cid, client, supplier, suffix):
    s = "6. No-op / delta edit (no churn)"
    print(f"\n=== {s} ===")
    A = make_item_type(base, token, f"NC_A_{suffix}", hs=next_hs())
    if not A:
        check(s, "item type created", False, "creation failed"); return
    aid = A["id"]

    # 6.1 create PB(A,100) → in=100, out=0, on-hand=100, exactly 1 movement
    st, bill = create_pb(base, token, cid, supplier["id"], [
        {"itemTypeId": aid, "description": "valve", "quantity": 100, "unitPrice": 10}])
    check(s, "6.1 create PB(A,100) ok", st in (200, 201), f"{st} {bill}")
    if st not in (200, 201):
        return
    bid = bill["id"]
    lid = bill["items"][0]["id"]
    row = grid_row(base, token, cid, aid)
    check(s, "6.1 in=100 out=0 on-hand=100",
          approx(row["totalIn"], 100) and approx(row["totalOut"], 0) and approx(row["onHand"], 100), str(row))
    check(s, "6.1 exactly 1 movement", move_count(base, token, cid, aid) == 1,
          f"count={move_count(base, token, cid, aid)}")

    # 6.2 NO-OP edit — resend the identical line → NO new movement
    st, upd = update_pb(base, token, bid, [
        {"id": lid, "itemTypeId": aid, "description": "valve", "quantity": 100, "unitPrice": 10}])
    check(s, "6.2 no-op edit ok", st == 200, f"{st} {upd}")
    row = grid_row(base, token, cid, aid)
    mc = move_count(base, token, cid, aid)
    check(s, "6.2 in=100 out=0 UNCHANGED (no reversal+IN churn)",
          approx(row["totalIn"], 100) and approx(row["totalOut"], 0), str(row))
    check(s, "6.2 still exactly 1 movement", mc == 1, f"count={mc}")

    # 6.3 qty 100→150 → single IN delta of 50
    lid = upd["items"][0]["id"]
    st, upd = update_pb(base, token, bid, [
        {"id": lid, "itemTypeId": aid, "description": "valve", "quantity": 150, "unitPrice": 10}])
    check(s, "6.3 qty up edit ok", st == 200, f"{st}")
    row = grid_row(base, token, cid, aid)
    mc = move_count(base, token, cid, aid)
    check(s, "6.3 in=150 out=0 on-hand=150 (delta IN 50)",
          approx(row["totalIn"], 150) and approx(row["totalOut"], 0) and approx(row["onHand"], 150), str(row))
    check(s, "6.3 exactly 2 movements", mc == 2, f"count={mc}")

    # 6.4 qty 150→120 → single OUT delta of 30
    lid = upd["items"][0]["id"]
    st, upd = update_pb(base, token, bid, [
        {"id": lid, "itemTypeId": aid, "description": "valve", "quantity": 120, "unitPrice": 10}])
    check(s, "6.4 qty down edit ok", st == 200, f"{st}")
    row = grid_row(base, token, cid, aid)
    mc = move_count(base, token, cid, aid)
    check(s, "6.4 in=150 out=30 on-hand=120 (delta OUT 30)",
          approx(row["totalIn"], 150) and approx(row["totalOut"], 30) and approx(row["onHand"], 120), str(row))
    check(s, "6.4 exactly 3 movements", mc == 3, f"count={mc}")

    # 6.5 no-op again → still 3 movements
    lid = upd["items"][0]["id"]
    update_pb(base, token, bid, [
        {"id": lid, "itemTypeId": aid, "description": "valve", "quantity": 120, "unitPrice": 10}])
    check(s, "6.5 no-op again → still 3 movements, on-hand=120",
          move_count(base, token, cid, aid) == 3 and approx(onhand(base, token, cid, aid), 120),
          f"count={move_count(base, token, cid, aid)}")

    # ── Invoice side ──
    B = make_item_type(base, token, f"NC_B_{suffix}", hs=next_hs())
    if not B:
        check(s, "B created", False, ""); return
    bid2 = B["id"]
    prestock(base, token, cid, supplier["id"], [(B, 100)])
    st, inv = create_standalone(base, token, cid, client["id"], [
        {"itemTypeId": bid2, "description": "sell B", "quantity": 40, "uom": "Pcs", "unitPrice": 50}])
    check(s, "6.6 sell B×40 ok", st in (200, 201), f"{st} {inv}")
    if st not in (200, 201):
        return
    iid = inv["id"]
    iline = inv["items"][0]["id"]
    row = grid_row(base, token, cid, bid2)
    base_mc = move_count(base, token, cid, bid2)
    check(s, "6.6 B out=40 on-hand=60", approx(row["totalOut"], 40) and approx(row["onHand"], 60), str(row))

    # 6.7 NO-OP invoice edit → no OUT churn, movement count unchanged
    st, upd = http("PUT", f"/api/invoices/{iid}", base, token=token, body={
        "gstRate": 18, "items": [
            {"id": iline, "itemTypeId": bid2, "description": "sell B", "quantity": 40, "uom": "Pcs", "unitPrice": 50}]})
    check(s, "6.7 no-op invoice edit ok", st == 200, f"{st} {upd}")
    row = grid_row(base, token, cid, bid2)
    mc = move_count(base, token, cid, bid2)
    check(s, "6.7 B out=40 UNCHANGED, on-hand=60",
          approx(row["totalOut"], 40) and approx(row["onHand"], 60), str(row))
    check(s, "6.7 movement count unchanged (no churn)", mc == base_mc, f"before={base_mc} after={mc}")

    # 6.8 invoice qty 40→25 → OUT reflows to 25
    st, upd = http("PUT", f"/api/invoices/{iid}", base, token=token, body={
        "gstRate": 18, "items": [
            {"id": upd["items"][0]["id"], "itemTypeId": bid2, "description": "sell B", "quantity": 25, "uom": "Pcs", "unitPrice": 50}]})
    check(s, "6.8 invoice qty edit ok", st == 200, f"{st}")
    row = grid_row(base, token, cid, bid2)
    check(s, "6.8 B out=25 on-hand=75 (reflowed)",
          approx(row["totalOut"], 25) and approx(row["onHand"], 75), str(row))


# ── Suite 7 — Soft-deleted item type drops off the on-hand grid ────
# Regression for 2026-07-07: an ItemType delete is a soft-delete and does
# NOT purge its StockMovements (purchase movements don't block delete), so
# StockController.GetOnHand must filter IsDeleted or the deleted item keeps
# showing on the dashboard.
def suite_deleted_item_hidden(base, token, cid, supplier, suffix):
    s = "7. Soft-deleted item hidden from grid"
    print(f"\n=== {s} ===")
    E = make_item_type(base, token, f"DEL_E_{suffix}", hs=next_hs())
    if not E:
        check(s, "item type created", False, "creation failed"); return
    eid = E["id"]

    # 7.1 stock it via a purchase bill → shows on the grid
    st, bill = create_pb(base, token, cid, supplier["id"], [
        {"itemTypeId": eid, "description": "to delete", "quantity": 50, "unitPrice": 10}])
    check(s, "7.1 create PB(E,50) ok", st in (200, 201), f"{st} {bill}")
    if st not in (200, 201):
        return
    check(s, "7.1 E on grid, on-hand=50",
          in_grid(base, token, cid, eid) and approx(onhand(base, token, cid, eid), 50),
          f"in_grid={in_grid(base, token, cid, eid)} onHand={onhand(base, token, cid, eid)}")

    # 7.2 soft-delete the item type (allowed — only a purchase movement refs it)
    st, _ = http("DELETE", f"/api/itemtypes/{eid}", base, token=token)
    check(s, "7.2 delete item type ok", st in (200, 204), f"{st}")

    # 7.3 it must disappear from the on-hand grid even though its movement
    #     row still exists in the ledger.
    check(s, "7.3 E ABSENT from on-hand grid after delete",
          not in_grid(base, token, cid, eid), "still showing on grid")


# ── Suite 8 — Invoice OUT reflow via FBR adjustment overlay ────────
# Regression for the 2026-07-27 prod incident (HS 8467.2100 showed zero
# OUT on the stock dashboard). The tax consultant reclassifies a non-HS
# "product family" bill line to an HS-coded item type through the
# dual-book adjustment overlay:
#     PATCH /invoices/{id}/itemtypes-and-qty  {writeMode:"adjustment"}
# The bill line (InvoiceItem.ItemTypeId) is NEVER mutated — the overlay
# carries AdjustedItemTypeId. Stock OUT therefore has to key off the
# EFFECTIVE type (AdjustedItemTypeId ?? ItemTypeId).
#
# Pre-fix, SyncInvoiceStockMovementsAsync read the physical type only:
# the non-HS base was untracked (no OUT) and the adjusted HS type never
# received the OUT, so the on-hand grid showed no movement even though
# the consultant had "sold" the HS goods on the filed return.
def suite_adjustment_overlay_reflow(base, token, cid, client, supplier, suffix):
    s = "8. Invoice OUT reflow (FBR adjustment overlay type)"
    print(f"\n=== {s} ===")
    FAM = make_item_type(base, token, f"OV_FAM_{suffix}", hs=None)       # non-HS product family (bill line)
    HS  = make_item_type(base, token, f"OV_HS_{suffix}",  hs=next_hs())  # HS reclassification target
    if not (FAM and HS):
        check(s, "item types created", False, "creation failed"); return

    # 8.0 pre-stock the HS type +100 (purchases book directly on the HS type)
    st, _ = prestock(base, token, cid, supplier["id"], [(HS, 100)])
    check(s, "8.0 pre-stock HS +100 ok", st in (200, 201), f"{st}")
    check(s, "8.0 HS on-hand = 100", approx(onhand(base, token, cid, HS["id"]), 100),
          f"got {onhand(base, token, cid, HS['id'])}")

    # 8.1 sell 30 on the NON-HS family line → NO OUT anywhere (base untracked)
    st, inv = create_standalone(base, token, cid, client["id"], [
        {"itemTypeId": FAM["id"], "description": "hardware items", "quantity": 30,
         "uom": "Pcs", "unitPrice": 50}])
    check(s, "8.1 sell FAM×30 ok", st in (200, 201), f"{st} {inv}")
    if st not in (200, 201):
        return
    iid = inv["id"]
    iline = inv["items"][0]["id"]
    check(s, "8.1 HS on-hand still 100 (base non-HS, no OUT yet)",
          approx(onhand(base, token, cid, HS["id"]), 100),
          f"got {onhand(base, token, cid, HS['id'])}")
    check(s, "8.1 FAM on-hand 0 (untracked family)",
          approx(onhand(base, token, cid, FAM["id"]), 0),
          f"got {onhand(base, token, cid, FAM['id'])}")

    # 8.2 consultant reclassifies the line to the HS type via the overlay.
    #     InvoiceItem stays untouched; AdjustedItemTypeId = HS. Stock OUT
    #     must land on the ADJUSTED HS type → HS 100 − 30 = 70.
    #     THIS is the check the pre-fix code failed (HS stayed at 100).
    st, upd = http("PATCH", f"/api/invoices/{iid}/itemtypes-and-qty", base, token=token,
                   body={"writeMode": "adjustment",
                         "items": [{"id": iline, "itemTypeId": HS["id"]}]})
    check(s, "8.2 overlay reclassify FAM→HS ok", st == 200, f"{st} {upd}")
    check(s, "8.2 HS on-hand = 70 (OUT on ADJUSTED type)",
          approx(onhand(base, token, cid, HS["id"]), 70),
          f"got {onhand(base, token, cid, HS['id'])}")
    check(s, "8.2 FAM on-hand still 0 (bill line untouched)",
          approx(onhand(base, token, cid, FAM["id"]), 0),
          f"got {onhand(base, token, cid, FAM['id'])}")

    # 8.3 consultant reverts the overlay (re-picks the bill's own family type)
    #     → overlay dropped → OUT reversed → HS back to 100.
    st, upd = http("PATCH", f"/api/invoices/{iid}/itemtypes-and-qty", base, token=token,
                   body={"writeMode": "adjustment",
                         "items": [{"id": iline, "itemTypeId": FAM["id"]}]})
    check(s, "8.3 overlay revert HS→FAM ok", st == 200, f"{st} {upd}")
    check(s, "8.3 HS on-hand back to 100 (overlay OUT reversed)",
          approx(onhand(base, token, cid, HS["id"]), 100),
          f"got {onhand(base, token, cid, HS['id'])}")

    # 8.4 re-apply the overlay → HS 70 again (repeat adjust must be clean)
    st, upd = http("PATCH", f"/api/invoices/{iid}/itemtypes-and-qty", base, token=token,
                   body={"writeMode": "adjustment",
                         "items": [{"id": iline, "itemTypeId": HS["id"]}]})
    check(s, "8.4 overlay re-apply FAM→HS ok", st == 200, f"{st} {upd}")
    check(s, "8.4 HS on-hand = 70 again",
          approx(onhand(base, token, cid, HS["id"]), 70),
          f"got {onhand(base, token, cid, HS['id'])}")

    # 8.5 overlay qty override: consultant files a smaller qty (20) at a
    #     higher rate (75) so the line total stays 1500. OUT must reflow to
    #     the ADJUSTED qty on the ADJUSTED type → HS 100 − 20 = 80.
    st, upd = http("PATCH", f"/api/invoices/{iid}/itemtypes-and-qty", base, token=token,
                   body={"writeMode": "adjustment",
                         "items": [{"id": iline, "itemTypeId": HS["id"],
                                    "quantity": 20, "unitPrice": 75}]})
    check(s, "8.5 overlay qty 30→20 ok", st == 200, f"{st} {upd}")
    check(s, "8.5 HS on-hand = 80 (OUT uses adjusted qty on adjusted type)",
          approx(onhand(base, token, cid, HS["id"]), 80),
          f"got {onhand(base, token, cid, HS['id'])}")

    # 8.6 delete the invoice → overlay OUT reversed → HS restored to 100
    st, _ = http("DELETE", f"/api/invoices/{iid}", base, token=token)
    check(s, "8.6 delete invoice ok", st in (200, 204), f"{st}")
    check(s, "8.6 HS on-hand = 100 (overlay OUT reversed on delete)",
          approx(onhand(base, token, cid, HS["id"]), 100),
          f"got {onhand(base, token, cid, HS['id'])}")


# ── Suite 9 — Overlay type reclassification CHAIN (revert old, OUT new) ─
# The consultant reclassifies an HS bill line to a DIFFERENT HS type, then
# again to a third, then reverts. Each hop must reverse the OUT on the
# previous type and re-record it on the new one — "if the item type / HS
# code changes, revert the old stock OUT and record a new OUT on the new
# HS code." Base line is itself HS here (unlike Suite 8's non-HS base), so
# the bill already recorded an OUT at creation that must MOVE, not stack.
def suite_overlay_type_chain(base, token, cid, client, supplier, suffix):
    s = "9. Overlay type reclassification chain (revert old HS, OUT new HS)"
    print(f"\n=== {s} ===")
    A = make_item_type(base, token, f"CH9_A_{suffix}", hs=next_hs())
    B = make_item_type(base, token, f"CH9_B_{suffix}", hs=next_hs())
    C = make_item_type(base, token, f"CH9_C_{suffix}", hs=next_hs())
    if not (A and B and C):
        check(s, "item types created", False, "creation failed"); return
    prestock(base, token, cid, supplier["id"], [(A, 1000), (B, 1000), (C, 1000)])

    def oh(x): return onhand(base, token, cid, x["id"])

    # 9.1 bill creation on an HS line → immediate OUT on A
    st, inv = create_standalone(base, token, cid, client["id"], [
        {"itemTypeId": A["id"], "description": "hammer", "quantity": 30,
         "uom": "Pcs", "unitPrice": 100}])
    check(s, "9.1 create (HS base) ok", st in (200, 201), f"{st} {inv}")
    if st not in (200, 201):
        return
    iid, line = inv["id"], inv["items"][0]["id"]
    check(s, "9.1 A=970 (OUT on bill creation), B=1000, C=1000",
          approx(oh(A), 970) and approx(oh(B), 1000) and approx(oh(C), 1000),
          f"A={oh(A)} B={oh(B)} C={oh(C)}")

    # 9.2 overlay reclassify A → B: revert A's OUT, record OUT on B
    st, _ = adjust(base, token, iid, [{"id": line, "itemTypeId": B["id"]}])
    check(s, "9.2 overlay A→B ok", st == 200, f"{st}")
    check(s, "9.2 A=1000 (reverted), B=970 (new OUT), C=1000",
          approx(oh(A), 1000) and approx(oh(B), 970) and approx(oh(C), 1000),
          f"A={oh(A)} B={oh(B)} C={oh(C)}")

    # 9.3 re-adjust B → C: revert B, record OUT on C
    st, _ = adjust(base, token, iid, [{"id": line, "itemTypeId": C["id"]}])
    check(s, "9.3 overlay B→C ok", st == 200, f"{st}")
    check(s, "9.3 A=1000, B=1000 (reverted), C=970 (new OUT)",
          approx(oh(A), 1000) and approx(oh(B), 1000) and approx(oh(C), 970),
          f"A={oh(A)} B={oh(B)} C={oh(C)}")

    # 9.4 revert to base (pick the bill's own type A) → overlay dropped,
    #     OUT falls back onto the physical type A.
    st, _ = adjust(base, token, iid, [{"id": line, "itemTypeId": A["id"]}])
    check(s, "9.4 overlay revert →A ok", st == 200, f"{st}")
    check(s, "9.4 A=970 (OUT back on base), B=1000, C=1000",
          approx(oh(A), 970) and approx(oh(B), 1000) and approx(oh(C), 1000),
          f"A={oh(A)} B={oh(B)} C={oh(C)}")

    # 9.5 delete → all restored
    http("DELETE", f"/api/invoices/{iid}", base, token=token)
    check(s, "9.5 all restored to 1000 after delete",
          approx(oh(A), 1000) and approx(oh(B), 1000) and approx(oh(C), 1000),
          f"A={oh(A)} B={oh(B)} C={oh(C)}")


# ── Suite 10 — Bill edited underneath an active overlay ────────────
# The overlay (FBR-filed values) is authoritative for stock: EffType =
# AdjustedItemTypeId ?? physical, EffQty = AdjustedQuantity ?? physical.
# So a bill (PUT) qty change flows to stock ONLY while the overlay has no
# qty override; once the consultant fixes a filed qty, that wins over later
# physical edits. Type stays on the overlay's type throughout.
def suite_bill_edit_under_overlay(base, token, cid, client, supplier, suffix):
    s = "10. Bill edit under an active overlay"
    print(f"\n=== {s} ===")
    A = make_item_type(base, token, f"OV10_A_{suffix}", hs=next_hs())
    B = make_item_type(base, token, f"OV10_B_{suffix}", hs=next_hs())
    if not (A and B):
        check(s, "item types created", False, "creation failed"); return
    prestock(base, token, cid, supplier["id"], [(A, 1000), (B, 1000)])

    def oh(x): return onhand(base, token, cid, x["id"])

    # 10.1 create HS_A qty50 price100 → OUT50 on A (subtotal 5000)
    st, inv = create_standalone(base, token, cid, client["id"], [
        {"itemTypeId": A["id"], "description": "widget", "quantity": 50,
         "uom": "Pcs", "unitPrice": 100}])
    check(s, "10.1 create ok", st in (200, 201), f"{st} {inv}")
    if st not in (200, 201):
        return
    iid, line = inv["id"], inv["items"][0]["id"]
    check(s, "10.1 A=950 (OUT 50), B=1000", approx(oh(A), 950) and approx(oh(B), 1000),
          f"A={oh(A)} B={oh(B)}")

    # 10.2 overlay reclassify A→B (type-only): A reverts, OUT 50 on B
    st, _ = adjust(base, token, iid, [{"id": line, "itemTypeId": B["id"]}])
    check(s, "10.2 overlay A→B ok", st == 200, f"{st}")
    check(s, "10.2 A=1000, B=950 (OUT moved)", approx(oh(A), 1000) and approx(oh(B), 950),
          f"A={oh(A)} B={oh(B)}")

    # 10.3 BILL PUT qty 50→30 (physical type stays A). Overlay is type-only
    #      (no filed qty) → stock follows the new physical qty on the overlay
    #      type B → OUT 30 on B.  (subtotal now 3000)
    st, upd = put_invoice(base, token, iid, [
        {"id": line, "itemTypeId": A["id"], "description": "widget",
         "quantity": 30, "uom": "Pcs", "unitPrice": 100}])
    check(s, "10.3 bill PUT qty 50→30 ok", st == 200, f"{st} {upd}")
    check(s, "10.3 B=970 (OUT reflowed to physical qty 30), A=1000",
          approx(oh(B), 970) and approx(oh(A), 1000), f"A={oh(A)} B={oh(B)}")

    # 10.4 consultant fixes a filed qty 20 @ 150 (line total 3000 = physical) →
    #      overlay qty now authoritative → OUT 20 on B.
    st, _ = adjust(base, token, iid, [
        {"id": line, "itemTypeId": B["id"], "quantity": 20, "unitPrice": 150}])
    check(s, "10.4 overlay qty→20 ok", st == 200, f"{st}")
    check(s, "10.4 B=980 (OUT uses filed qty 20)", approx(oh(B), 980),
          f"B={oh(B)}")

    # 10.5 BILL PUT qty 30→45: overlay filed qty (20) still wins → stock does
    #      NOT follow the physical change. B stays 980.
    st, upd = put_invoice(base, token, iid, [
        {"id": line, "itemTypeId": A["id"], "description": "widget",
         "quantity": 45, "uom": "Pcs", "unitPrice": 100}])
    check(s, "10.5 bill PUT qty 30→45 ok", st == 200, f"{st} {upd}")
    check(s, "10.5 B=980 (filed qty authoritative over physical), A=1000",
          approx(oh(B), 980) and approx(oh(A), 1000), f"A={oh(A)} B={oh(B)}")

    # 10.6 delete → both restored
    http("DELETE", f"/api/invoices/{iid}", base, token=token)
    check(s, "10.6 A=1000,B=1000 after delete",
          approx(oh(A), 1000) and approx(oh(B), 1000), f"A={oh(A)} B={oh(B)}")


# ── Suite 11 — Quantity readjustment correctness (overlay qty) ─────
# The consultant repeatedly re-decomposes the SAME line total into a
# different qty×price (dual-book keeps the bill total constant). Stock OUT
# must track the latest filed qty on every re-adjust, and snap back to the
# physical qty when the overlay is reverted.
def suite_qty_readjustment(base, token, cid, client, supplier, suffix):
    s = "11. Quantity readjustment correctness (overlay qty, totals matched)"
    print(f"\n=== {s} ===")
    A = make_item_type(base, token, f"Q11_A_{suffix}", hs=next_hs())
    if not A:
        check(s, "item type created", False, "creation failed"); return
    prestock(base, token, cid, supplier["id"], [(A, 1000)])

    def oh(): return onhand(base, token, cid, A["id"])

    # 11.1 create HS_A qty60 price100 → OUT 60 (subtotal 6000)
    st, inv = create_standalone(base, token, cid, client["id"], [
        {"itemTypeId": A["id"], "description": "bolt", "quantity": 60,
         "uom": "Pcs", "unitPrice": 100}])
    check(s, "11.1 create ok", st in (200, 201), f"{st} {inv}")
    if st not in (200, 201):
        return
    iid, line = inv["id"], inv["items"][0]["id"]
    check(s, "11.1 A=940 (OUT 60)", approx(oh(), 940), f"got {oh()}")

    # 11.2 overlay qty 60→40 @150 (6000) → OUT 40
    st, _ = adjust(base, token, iid, [{"id": line, "itemTypeId": A["id"], "quantity": 40, "unitPrice": 150}])
    check(s, "11.2 overlay qty→40 ok", st == 200, f"{st}")
    check(s, "11.2 A=960 (OUT 40)", approx(oh(), 960), f"got {oh()}")

    # 11.3 re-adjust qty 40→30 @200 (6000) → OUT 30
    st, _ = adjust(base, token, iid, [{"id": line, "itemTypeId": A["id"], "quantity": 30, "unitPrice": 200}])
    check(s, "11.3 re-adjust qty→30 ok", st == 200, f"{st}")
    check(s, "11.3 A=970 (OUT 30)", approx(oh(), 970), f"got {oh()}")

    # 11.4 re-adjust qty 30→48 @125 (6000) → OUT 48
    st, _ = adjust(base, token, iid, [{"id": line, "itemTypeId": A["id"], "quantity": 48, "unitPrice": 125}])
    check(s, "11.4 re-adjust qty→48 ok", st == 200, f"{st}")
    check(s, "11.4 A=952 (OUT 48)", approx(oh(), 952), f"got {oh()}")

    # 11.5 revert (send the bill's own qty60 price100) → overlay dropped,
    #      OUT snaps back to the physical qty 60.
    st, _ = adjust(base, token, iid, [{"id": line, "itemTypeId": A["id"], "quantity": 60, "unitPrice": 100}])
    check(s, "11.5 revert to base ok", st == 200, f"{st}")
    check(s, "11.5 A=940 (OUT back to physical 60)", approx(oh(), 940), f"got {oh()}")

    # 11.6 delete → restored
    http("DELETE", f"/api/invoices/{iid}", base, token=token)
    check(s, "11.6 A=1000 after delete", approx(oh(), 1000), f"got {oh()}")


# ── Suite 12 — Multi-line invoice, mixed overlays (independence) ───
# One line is a non-HS family reclassified to HS via overlay; a second line
# is HS reclassified to a different HS. Adjusting one line must never
# disturb the other's stock.
def suite_multiline_overlays(base, token, cid, client, supplier, suffix):
    s = "12. Multi-line invoice, mixed overlays (per-line independence)"
    print(f"\n=== {s} ===")
    FAM = make_item_type(base, token, f"ML_FAM_{suffix}", hs=None)
    A = make_item_type(base, token, f"ML_A_{suffix}", hs=next_hs())
    B = make_item_type(base, token, f"ML_B_{suffix}", hs=next_hs())
    C = make_item_type(base, token, f"ML_C_{suffix}", hs=next_hs())
    if not (FAM and A and B and C):
        check(s, "item types created", False, "creation failed"); return
    prestock(base, token, cid, supplier["id"], [(A, 500), (B, 500), (C, 500)])

    def oh(x): return onhand(base, token, cid, x["id"])

    # 12.1 create 2-line invoice: L1 non-HS family (no OUT), L2 HS_B (OUT 20)
    st, inv = create_standalone(base, token, cid, client["id"], [
        {"itemTypeId": FAM["id"], "description": "L1-family", "quantity": 30, "uom": "Pcs", "unitPrice": 100},
        {"itemTypeId": B["id"],   "description": "L2-hs-b",   "quantity": 20, "uom": "Pcs", "unitPrice": 100}])
    check(s, "12.1 create 2-line ok", st in (200, 201), f"{st} {inv}")
    if st not in (200, 201):
        return
    iid = inv["id"]
    l1, l2 = line_of(inv, "L1-family"), line_of(inv, "L2-hs-b")
    check(s, "12.1 A=500, B=480 (L2 OUT), C=500, FAM=0",
          approx(oh(A), 500) and approx(oh(B), 480) and approx(oh(C), 500) and approx(oh(FAM), 0),
          f"A={oh(A)} B={oh(B)} C={oh(C)} FAM={oh(FAM)}")

    # 12.2 overlay L1 family→A → OUT 30 on A; L2 (B) untouched
    st, _ = adjust(base, token, iid, [{"id": l1, "itemTypeId": A["id"]}])
    check(s, "12.2 overlay L1→A ok", st == 200, f"{st}")
    check(s, "12.2 A=470 (L1 OUT), B=480 (unchanged)",
          approx(oh(A), 470) and approx(oh(B), 480), f"A={oh(A)} B={oh(B)}")

    # 12.3 overlay L2 B→C → revert B, OUT 20 on C; L1 (A) untouched
    st, _ = adjust(base, token, iid, [{"id": l2, "itemTypeId": C["id"]}])
    check(s, "12.3 overlay L2 B→C ok", st == 200, f"{st}")
    check(s, "12.3 B=500 (reverted), C=480 (new OUT), A=470 (unchanged)",
          approx(oh(B), 500) and approx(oh(C), 480) and approx(oh(A), 470),
          f"A={oh(A)} B={oh(B)} C={oh(C)}")

    # 12.4 revert L1 overlay (pick base family) → A restored; C untouched
    st, _ = adjust(base, token, iid, [{"id": l1, "itemTypeId": FAM["id"]}])
    check(s, "12.4 revert L1→family ok", st == 200, f"{st}")
    check(s, "12.4 A=500 (restored), C=480 (unchanged)",
          approx(oh(A), 500) and approx(oh(C), 480), f"A={oh(A)} C={oh(C)}")

    # 12.5 delete → C restored, all back to 500
    http("DELETE", f"/api/invoices/{iid}", base, token=token)
    check(s, "12.5 A=500,B=500,C=500 after delete",
          approx(oh(A), 500) and approx(oh(B), 500) and approx(oh(C), 500),
          f"A={oh(A)} B={oh(B)} C={oh(C)}")


# ── Suite 13 — Challan-driven bill + overlay reflow ────────────────
# A bill built from a delivery challan (the only add/remove-lines path) that
# then gets an FBR overlay: a later challan qty change must reflow the OUT
# onto the OVERLAY's type at the new physical qty.
def suite_challan_overlay(base, token, cid, client, supplier, suffix):
    s = "13. Challan-driven bill + overlay reflow"
    print(f"\n=== {s} ===")
    A = make_item_type(base, token, f"CO_A_{suffix}", hs=next_hs())
    B = make_item_type(base, token, f"CO_B_{suffix}", hs=next_hs())
    if not (A and B):
        check(s, "item types created", False, "creation failed"); return
    prestock(base, token, cid, supplier["id"], [(A, 500), (B, 500)])

    def oh(x): return onhand(base, token, cid, x["id"])

    # 13.1 challan A(10) → bill → base HS_A OUT 10
    st, ch = http("POST", f"/api/deliverychallans/company/{cid}", base, token=token, body={
        "companyId": cid, "clientId": client["id"],
        "poNumber": "PO-OV-13", "poDate": TODAY, "deliveryDate": TODAY,
        "items": [{"itemTypeId": A["id"], "itemTypeName": A["name"], "description": "co A", "quantity": 10, "unit": "Pcs"}]})
    check(s, "13.1 create challan ok", st in (200, 201), f"{st} {ch}")
    if st not in (200, 201) or ch.get("status") != "Pending":
        check(s, "13.1 challan billable", False, f"status={ch.get('status')}"); return
    st, bill = http("POST", "/api/invoices", base, token=token, body={
        "date": TODAY, "companyId": cid, "clientId": client["id"], "gstRate": 18,
        "challanIds": [ch["id"]],
        "items": [{"deliveryItemId": ch["items"][0]["id"], "unitPrice": 100, "description": "co A"}]})
    check(s, "13.1 bill from challan ok", st in (200, 201), f"{st} {bill}")
    if st not in (200, 201):
        return
    iid, line = bill["id"], bill["items"][0]["id"]
    check(s, "13.1 A=490 (OUT 10 on base HS)", approx(oh(A), 490), f"A={oh(A)}")

    # 13.2 overlay reclassify A→B → revert A, OUT 10 on B
    st, _ = adjust(base, token, iid, [{"id": line, "itemTypeId": B["id"]}])
    check(s, "13.2 overlay A→B ok", st == 200, f"{st}")
    check(s, "13.2 A=500 (reverted), B=490 (new OUT)",
          approx(oh(A), 500) and approx(oh(B), 490), f"A={oh(A)} B={oh(B)}")

    # 13.3 challan qty A 10→4 → physical qty changes; overlay type-only → OUT
    #      reflows to qty 4 on the OVERLAY type B.
    st, upd = http("PUT", f"/api/deliverychallans/{ch['id']}/items", base, token=token, body=[
        {"id": ch["items"][0]["id"], "itemTypeId": A["id"], "description": "co A", "quantity": 4, "unit": "Pcs"}])
    check(s, "13.3 challan qty 10→4 ok", st == 200, f"{st} {upd}")
    check(s, "13.3 B=496 (OUT reflowed to qty 4 on overlay type), A=500",
          approx(oh(B), 496) and approx(oh(A), 500), f"A={oh(A)} B={oh(B)}")

    # 13.4 delete bill → overlay OUT reversed
    http("DELETE", f"/api/invoices/{iid}", base, token=token)
    check(s, "13.4 A=500,B=500 after delete",
          approx(oh(A), 500) and approx(oh(B), 500), f"A={oh(A)} B={oh(B)}")


# ── Reporter ───────────────────────────────────────────────────────
def print_report() -> int:
    by_suite: dict[str, list[tuple[str, str]]] = {}
    fail = 0
    for suite, name, status in results:
        by_suite.setdefault(suite, []).append((name, status))
        if status != PASS:
            fail += 1
    print("\n-------------- Report --------------")
    for suite, items in by_suite.items():
        print(f"\n[{suite}]")
        for name, status in items:
            badge = "PASS" if status == PASS else "FAIL"
            print(f"  [{badge}] {name:60s} {status}")
    total = len(results)
    print(f"\n=== {total - fail}/{total} checks passed ===")
    return 0 if fail == 0 else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", default="http://localhost:5134")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw", default="admin123")
    p.add_argument("--keep", action="store_true")
    args = p.parse_args()

    # Windows consoles default to cp1252 — force UTF-8 so the arrows in
    # test names don't crash the run.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    token, company, client, supplier, suffix = setup(args.base, args.admin_user, args.admin_pw)
    cid = company["id"]
    try:
        suite_purchase_reflow(args.base, token, cid, supplier, suffix)
        suite_phantom_guard(args.base, token, cid, supplier, suffix)
        suite_invoice_narrow_reflow(args.base, token, cid, client, supplier, suffix)
        suite_invoice_full_reflow(args.base, token, cid, client, supplier, suffix)
        suite_challan_reflow(args.base, token, cid, client, supplier, suffix)
        suite_noop_delta(args.base, token, cid, client, supplier, suffix)
        suite_deleted_item_hidden(args.base, token, cid, supplier, suffix)
        suite_adjustment_overlay_reflow(args.base, token, cid, client, supplier, suffix)
        suite_overlay_type_chain(args.base, token, cid, client, supplier, suffix)
        suite_bill_edit_under_overlay(args.base, token, cid, client, supplier, suffix)
        suite_qty_readjustment(args.base, token, cid, client, supplier, suffix)
        suite_multiline_overlays(args.base, token, cid, client, supplier, suffix)
        suite_challan_overlay(args.base, token, cid, client, supplier, suffix)
    finally:
        teardown(args.base, token, company, args.keep)

    return print_report()


if __name__ == "__main__":
    sys.exit(main())
