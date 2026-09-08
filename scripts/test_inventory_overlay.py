"""
Inventory Overlay Behaviour — two books, one total.

An overlay company keeps a sale in two forms that share a subtotal:

    the BILL     what the customer ordered and signed for. Item types with NO
                 HS code, quantity and unit price typed by hand.
    the INVOICE  the same money decomposed for FBR. HS-coded item types,
                 quantity and unit price adjusted for the filing, stored on
                 InvoiceItemAdjustment.

The single rule everything else serves: ADJUSTING THE INVOICE MUST NEVER CHANGE
THE BILL. A customer who signed for 10 at 1,000 must still see 10 at 1,000 on
every bill surface after the tax consultant has refiled it as 5 at 2,000.

Suites
  1  the flag itself, and that it defaults off
  2  a NORMAL company is untouched -- the same walk, unchanged (this is the
     suite that would catch a regression in the existing customers' behaviour,
     so it runs first and is not conditional on anything)
  3  bill in overlay mode: manual qty x price, no stock pricing
  4  the two books diverge, and the BILL keeps its own values
  5  the bill's print payload still shows the ORIGINAL values
  6  the invoice's print payload shows the ADJUSTED values
  7  guards: the total must still reconcile

Usage:
  python scripts/test_inventory_overlay.py --base http://localhost:5135
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, reason: str = "") -> bool:
    results.append((name, bool(ok), reason))
    print(f"    [{'OK  ' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -> {reason}"))
    return bool(ok)


def http(method, path, base, token=None, body=None):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:300]
    except Exception as e:
        return 0, str(e)


def err(b):
    return str(b.get("error") or b.get("message") or b)[:200] if isinstance(b, dict) else str(b)[:200]


def today():
    return datetime.now().strftime("%Y-%m-%dT00:00:00")


def near(a, b, tol=0.01):
    try:
        return abs(float(a) - float(b)) <= tol
    except Exception:
        return False


def make_company(base, tok, name, overlay):
    return http("POST", "/api/companies", base, token=tok, body={
        "name": name, "fullAddress": "Karachi", "phone": "+92-21-1",
        "ntn": "4228937-8", "strn": "3277876175852",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
        "fbrEnabled": False, "inventoryTrackingEnabled": False,
        "inventoryOverlayEnabled": overlay,
    })


def make_item(base, tok, cid, name, hs=None):
    body = {"name": name, "uom": "Numbers, pieces, units", "companyId": cid, "isFavorite": True}
    if hs:
        body.update({"hsCode": hs, "fbrUOMId": 69,
                     "saleType": "Goods at Standard Rate (default)"})
    return http("POST", f"/api/itemtypes?companyId={cid}", base, token=tok, body=body)


def make_bill(base, tok, cid, client_id, item_id, qty, price):
    return http("POST", "/api/invoices/standalone", base, token=tok, body={
        "date": today(), "companyId": cid, "clientId": client_id, "gstRate": 18,
        "documentType": 4, "paymentMode": "Cash",
        "items": [{"description": "Overlay line", "quantity": qty,
                   "uom": "Numbers, pieces, units", "unitPrice": price,
                   "itemTypeId": item_id}]})


def adjust(base, tok, invoice_id, rows):
    """The Invoices-tab adjustment: item type + qty + unit price."""
    return http("PATCH", f"/api/invoices/{invoice_id}/itemtypes-and-qty", base,
                token=tok, body={"items": rows})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5135")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    print("=" * 78)
    print("  INVENTORY OVERLAY BEHAVIOUR — two books, one total")
    print("=" * 78)

    st, d = http("POST", "/api/auth/login", args.base,
                 body={"username": args.user, "password": args.password})
    if st != 200:
        print(f"FATAL: login failed ({st} {d})")
        return 2
    tok = d["token"]
    sfx = datetime.now().strftime("%H%M%S")
    made = []

    try:
        # ── 1. The flag ─────────────────────────────────────────────────────
        print("\n=== 1. The company setting ===")
        st, normal = make_company(args.base, tok, f"_ovl_normal {sfx}", overlay=False)
        st2, overlay = make_company(args.base, tok, f"_ovl_overlay {sfx}", overlay=True)
        if not check("both companies are created", st in (200, 201) and st2 in (200, 201),
                     f"{st}/{st2}"):
            return 2
        made += [normal["id"], overlay["id"]]
        check("a company created without the flag has it OFF",
              normal.get("inventoryOverlayEnabled") is False,
              f"got {normal.get('inventoryOverlayEnabled')}")
        check("a company created with the flag has it ON",
              overlay.get("inventoryOverlayEnabled") is True,
              f"got {overlay.get('inventoryOverlayEnabled')}")

        def setup(cid, tag):
            st, cl = http("POST", "/api/clients", args.base, token=tok, body={
                "companyId": cid, "name": f"Buyer {tag} {sfx}", "address": "Karachi",
                "phone": "+92-21-2", "registrationType": "Unregistered"})
            st, no_hs = make_item(args.base, tok, cid, f"Carton {tag} {sfx}")
            st, hs = make_item(args.base, tok, cid, f"Valve {tag} {sfx}", "8481.8090")
            return cl["id"], no_hs["id"], hs["id"]

        n_client, n_nohs, n_hs = setup(normal["id"], "N")
        o_client, o_nohs, o_hs = setup(overlay["id"], "O")

        # ── 2. A normal company is untouched ────────────────────────────────
        # Runs FIRST and unconditionally: this is the suite that catches a
        # regression in the behaviour every existing customer relies on.
        print("\n=== 2. A NORMAL company behaves exactly as before ===")
        st, nbill = make_bill(args.base, tok, normal["id"], n_client, n_nohs, 10, 1000)
        if check("a normal bill is created", st in (200, 201), f"{st}: {err(nbill)}"):
            check("its line is 10 x 1,000 = 10,000",
                  near(nbill["items"][0]["quantity"], 10)
                  and near(nbill["items"][0]["unitPrice"], 1000)
                  and near(nbill["subtotal"], 10000),
                  f"qty={nbill['items'][0]['quantity']} price={nbill['items'][0]['unitPrice']}")
            iid = nbill["items"][0]["id"]
            st, adj = adjust(args.base, tok, nbill["id"],
                             [{"id": iid, "itemTypeId": n_hs, "quantity": 5, "unitPrice": 2000}])
            check("an item-type change is accepted", st == 200, f"{st}: {err(adj)}")
            if st == 200:
                line = adj["items"][0]
                # The pre-existing rule: on a normal company the classification
                # goes onto the BILL line itself, and only the numbers overlay.
                check("the classification still lands on the bill line (unchanged rule)",
                      line.get("itemTypeId") == n_hs,
                      f"itemTypeId={line.get('itemTypeId')}")
                check("and the overlay stays numeric-only",
                      (line.get("adjustment") or {}).get("adjustedItemTypeId") in (None, 0),
                      f"adjustedItemTypeId={(line.get('adjustment') or {}).get('adjustedItemTypeId')}")

        # ── 3. Bill in overlay mode ─────────────────────────────────────────
        print("\n=== 3. Overlay bill: the commercial book ===")
        st, obill = make_bill(args.base, tok, overlay["id"], o_client, o_nohs, 10, 1000)
        if not check("an overlay bill is created from a no-HS item",
                     st in (200, 201), f"{st}: {err(obill)}"):
            return 1
        bill_line = obill["items"][0]
        check("it stores exactly what was typed: 10 x 1,000 = 10,000",
              near(bill_line["quantity"], 10) and near(bill_line["unitPrice"], 1000)
              and near(obill["subtotal"], 10000),
              f"qty={bill_line['quantity']} price={bill_line['unitPrice']} sub={obill['subtotal']}")
        check("the bill line carries no HS code — it is the commercial book",
              not (bill_line.get("hsCode") or "").strip(),
              f"hsCode={bill_line.get('hsCode')}")

        # ── 4. The two books diverge ────────────────────────────────────────
        print("\n=== 4. The invoice is adjusted; the bill does not move ===")
        st, adj = adjust(args.base, tok, obill["id"],
                         [{"id": bill_line["id"], "itemTypeId": o_hs,
                           "quantity": 5, "unitPrice": 2000}])
        if check("the adjustment is accepted (5 x 2,000 = the same 10,000)",
                 st == 200, f"{st}: {err(adj)}"):
            line = adj["items"][0]
            a = line.get("adjustment") or {}
            check("THE BILL STILL READS 10 x 1,000",
                  near(line["quantity"], 10) and near(line["unitPrice"], 1000),
                  f"bill line is now qty={line['quantity']} price={line['unitPrice']}")
            check("the bill keeps its commercial item type",
                  line.get("itemTypeId") == o_nohs,
                  f"itemTypeId={line.get('itemTypeId')} (expected the no-HS {o_nohs})")
            check("the overlay holds the filed quantity and price",
                  near(a.get("adjustedQuantity"), 5) and near(a.get("adjustedUnitPrice"), 2000),
                  f"overlay qty={a.get('adjustedQuantity')} price={a.get('adjustedUnitPrice')}")
            check("and the overlay holds the HS-coded item type",
                  a.get("adjustedItemTypeId") == o_hs,
                  f"adjustedItemTypeId={a.get('adjustedItemTypeId')} (expected {o_hs})")
            check("the bill subtotal is unchanged at 10,000",
                  near(adj.get("subtotal"), 10000), f"subtotal={adj.get('subtotal')}")

        # ── 5 & 6. What each document prints ────────────────────────────────
        print("\n=== 5. The BILL print shows the original values ===")
        st, pb = http("GET", f"/api/invoices/{obill['id']}/print/bill", args.base, token=tok)
        if check("the bill print payload loads", st == 200, f"{st}: {err(pb)}"):
            it = (pb.get("items") or [{}])[0]
            check("bill print: 10 x 1,000",
                  near(it.get("quantity"), 10) and near(it.get("unitPrice"), 1000),
                  f"qty={it.get('quantity')} price={it.get('unitPrice')}")

        print("\n=== 6. The INVOICE print shows the adjusted values ===")
        st, pt = http("GET", f"/api/invoices/{obill['id']}/print/tax-invoice", args.base, token=tok)
        if check("the tax invoice print payload loads", st == 200, f"{st}: {err(pt)}"):
            it = (pt.get("items") or [{}])[0]
            check("invoice print: 5 x 2,000",
                  near(it.get("quantity"), 5) and near(it.get("unitPrice"), 2000),
                  f"qty={it.get('quantity')} price={it.get('unitPrice')}")
            check("invoice print carries the HS code the filing needs",
                  (it.get("hsCode") or "").strip() == "8481.8090",
                  f"hsCode={it.get('hsCode')}")
            check("both books still total the same money",
                  near(pt.get("subtotal"), 10000), f"invoice subtotal={pt.get('subtotal')}")

        # ── 7. The total still has to reconcile ─────────────────────────────
        print("\n=== 7. An adjustment may redistribute, not invent ===")
        st, bad = adjust(args.base, tok, obill["id"],
                         [{"id": bill_line["id"], "itemTypeId": o_hs,
                           "quantity": 5, "unitPrice": 9999}])
        check("an adjustment that changes the total is refused",
              st == 400, f"got {st}: {err(bad)}")
        st, after = http("GET", f"/api/invoices/{obill['id']}", args.base, token=tok)
        check("and the refusal left both books intact",
              near(after["items"][0]["quantity"], 10)
              and near(after.get("subtotal"), 10000),
              f"qty={after['items'][0]['quantity']} sub={after.get('subtotal')}")
    finally:
        if args.keep:
            print(f"\n(kept companies {made})")
        else:
            for cid in made:
                st, _ = http("DELETE", f"/api/companies/{cid}", args.base, token=tok)
                print(f"teardown: delete company {cid} -> {st}")

    print("\n" + "=" * 78)
    failed = [r for r in results if not r[1]]
    for name, _, reason in failed:
        print(f"  FAIL  {name}  -> {reason}")
    print(f"\n  {len(results) - len(failed)}/{len(results)} checks passed")
    print("=" * 78)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
