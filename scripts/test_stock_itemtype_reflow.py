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

# Static top-up when the live catalog has no (or too few) HS-coded items —
# e.g. a fresh branch DB whose only HS-coded rows are soft-deleted leftovers
# of this very suite (seen 2026-07-03 on DeliveryChallanDb: harvest = 0, the
# single old fallback code repeated, and the near-duplicate guard correctly
# 400'd every second item). Distinctness is what matters here; these are all
# real PRAL chapter codes.
_HS_FALLBACK = [
    "5208.1000", "5209.1100", "5210.1100", "5407.1000", "5512.1100",
    "6302.2100", "6117.8000", "7318.1500", "8471.3010", "8501.1000",
    "8536.5000", "8538.1000", "3926.9099", "4819.1000", "7210.1190",
]


def next_hs() -> str:
    """Return the next unused HS code from the harvested (or fallback) pool."""
    global _hs_idx
    pool = _hs_pool or _HS_FALLBACK
    code = pool[_hs_idx % len(pool)]
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
    # the near-duplicate guard). The bare endpoint only sees the default
    # scope — on a fresh/branch DB that scope can be HS-less while other
    # companies hold plenty, so fall through to a per-company sweep until
    # the pool is big enough (2026-07-03: DeliveryChallanDb had 38 HS-coded
    # items, all outside the default scope, and the suite failed at setup).
    seen = set()

    def _harvest(item_list):
        for it in item_list or []:
            hs = (it.get("hsCode") or "").strip()
            if hs and hs not in seen:
                seen.add(hs)
                _hs_pool.append(hs)

    st, items = http("GET", "/api/itemtypes", base, token=token)
    if st == 200 and isinstance(items, list):
        _harvest(items)
    if len(_hs_pool) < 10:
        # Item catalog is HS-less (fresh/branch DB) — pull codes straight
        # from the cached PRAL HS catalog, i.e. the SAME source
        # IsKnownHsCodeAsync validates against, so the codes always pass
        # the [0007] master-catalog check. Shared cache — any accessible
        # company id works.
        st, companies = http("GET", "/api/companies", base, token=token)
        first_cid = companies[0]["id"] if st == 200 and companies else None
        if first_cid:
            st2, codes = http("GET", f"/api/fbr/hscodes/{first_cid}", base, token=token)
            for c in (codes or []) if st2 == 200 else []:
                hs = (c.get("hS_CODE") or c.get("hsCode") or c.get("HS_CODE") or "").strip()
                if hs and hs not in seen:
                    seen.add(hs)
                    _hs_pool.append(hs)
    print(f"  harvested {len(_hs_pool)} distinct HS codes from catalog")
    if len(_hs_pool) < 10:
        # Last resort (catalog cache empty too — validation is then
        # format-only, so any well-formed code passes). Distinct codes
        # keep the near-duplicate guard quiet across test items.
        for hs in _HS_FALLBACK:
            if hs not in seen:
                seen.add(hs)
                _hs_pool.append(hs)
        print(f"  topped up with static fallback codes -> pool = {len(_hs_pool)}")

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
    finally:
        teardown(args.base, token, company, args.keep)

    return print_report()


if __name__ == "__main__":
    sys.exit(main())
