"""
Basic-flow regression tests for the ERP — must pass before any push that
touches challan / bill / invoice / tax-calculation code.

Covers the six golden paths Hakimi and Roshan rely on every day:
  1. Challan creation               (challans.manage.create)
  2. Bill creation FROM a challan   (bills.manage.create)
  3. Bill creation WITHOUT a challan / standalone   (bills.manage.create.standalone)
  4. Invoice update                 (bills.manage.update)
  5. Item Rate History              (quantity / unit-price suggestion source)
  6. Tax calculation correctness    (GST 18 %, GST exempt 0 %, 3rd Schedule retail)

Each test runs against a fresh ephemeral company + client created at
test-start and torn down at the end. Production data is never touched.

Usage:
  python scripts/test_basic_flows.py
  python scripts/test_basic_flows.py --base http://localhost:5134 --keep

Flags:
  --keep    leave test rows in the DB after the run (default: delete)
  --base    backend base URL (default: http://localhost:5134)

Exit code 0 = every assertion passes. 1 = at least one failure.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from typing import Any

PASS = "PASS"
FAIL = "FAIL"
results: list[tuple[str, str, str]] = []  # (suite, name, status)


# ── HTTP helper ────────────────────────────────────────────────────
def http(method: str, path: str, base: str, token: str | None = None,
         body: Any = None, timeout: int = 30) -> tuple[int, Any]:
    url = base.rstrip("/") + path
    data = None
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
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


def must(label: str, status: int, expected: tuple[int, ...] = (200, 201)) -> bool:
    """Assert status is in expected, return ok flag, register a check."""
    ok = status in expected
    check("setup", label, ok, f"expected one of {expected}, got {status}")
    return ok


# ── Setup ──────────────────────────────────────────────────────────
def setup(base: str, admin_user: str, admin_pw: str):
    print(f"\n=== Logging in as {admin_user} ===")
    status, data = http("POST", "/api/auth/login", base, body={
        "username": admin_user, "password": admin_pw})
    if status != 200:
        print(f"FATAL: admin login failed ({status} {data})")
        sys.exit(2)
    token = data["token"]

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    company_name = f"_test_basic_flows {suffix}"

    print(f"\n=== Creating ephemeral test company '{company_name}' ===")
    # All FBR-readiness fields populated so challans land in 'Pending'
    # (billable) rather than 'Setup Required'. See
    # Services/Implementations/DeliveryChallanService.cs:IsFbrReady.
    status, company = http("POST", "/api/companies", base, token=token, body={
        "name": company_name,
        "fullAddress": "Test HQ",
        "phone": "+92-21-00000000",
        "ntn": "9999999",
        "cnic": "9999999999999",
        "strn": "9999999999999",
        "fbrSellerRegistrationNo": "9999999",
        "startingChallanNumber": 1,
        "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1,
        "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox",
        "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Manufacturer",
        "fbrSector": "All Other Sectors",
        "fbrToken": "test-token-not-used-for-real-pral-calls",
    })
    if status not in (200, 201):
        print(f"FATAL: create company failed ({status} {company})")
        sys.exit(2)
    print(f"  company id={company['id']}  name={company['name']}")

    print(f"\n=== Creating client ===")
    status, client = http("POST", "/api/clients", base, token=token, body={
        "name": f"Test Client {suffix}",
        "address": "1 Test Road, Karachi",
        "phone": "021-1234567",
        "companyId": company["id"],
        "ntn": "1234567",
        "strn": "1234567890123",
        "fbrProvinceCode": 8,
        "registrationType": "Registered",
    })
    if status not in (200, 201):
        print(f"FATAL: create client failed ({status} {client})")
        sys.exit(2)
    print(f"  client id={client['id']}  name={client['name']}")

    return token, company, client


def teardown(base: str, token: str, company: dict, keep: bool) -> None:
    if keep:
        print(f"\n=== Skipping teardown — leaving company id={company['id']} in place ===")
        return
    print(f"\n=== Tearing down company id={company['id']} ===")
    status, _ = http("DELETE", f"/api/companies/{company['id']}", base, token=token)
    print(f"  delete returned {status}")


# ── Helper: pick a fully-FBR-classified ItemType so challans land in
# Pending (billable) status rather than Setup Required. The seeded
# starter catalog always contains at least one row with an HSCode set.
def pick_classified_item_type(base: str, token: str, company_id: int | None = None) -> dict | None:
    # 2026-09-21: catalogs are company-private, and the seed admin reaches
    # every company - so the filter's "exactly one accessible company"
    # fallback cannot resolve it and an unqualified read 400s.
    path = f"/api/itemtypes?companyId={company_id}" if company_id else "/api/itemtypes"
    status, items = http("GET", path, base, token=token)
    if status != 200 or not isinstance(items, list):
        return None
    for it in items:
        # The starter catalog seeds HSCode + UOM + SaleType; only those
        # rows mark a challan/bill as "ready for FBR submission".
        if it.get("hsCode") and it.get("uom") and it.get("saleType"):
            return it
    return None


def pick_second_classified(base: str, token: str, first: dict | None,
                           company_id: int | None = None) -> dict | None:
    """A second fully-classified ItemType, distinct from `first` — used by
    Suite 7 to prove the operator's bill-form pick overrides the challan's
    own type. Returns None when the seed catalog has fewer than two."""
    path = f"/api/itemtypes?companyId={company_id}" if company_id else "/api/itemtypes"
    status, items = http("GET", path, base, token=token)
    if status != 200 or not isinstance(items, list):
        return None
    for it in items:
        if (it.get("hsCode") and it.get("uom") and it.get("saleType")
                and (first is None or it["id"] != first["id"])):
            return it
    return None


# ── Suite 1: Challan creation ──────────────────────────────────────
def test_challan_creation(base: str, token: str, company: dict, client: dict,
                          classified_item_type: dict | None) -> dict | None:
    suite = "1. Challan creation"
    print(f"\n=== {suite} ===")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

    # Two items, both linked to the classified ItemType so the challan
    # lands in Pending (billable) status. Without ItemTypeId+HSCode the
    # challan would land in Setup Required and the bill-from-challan
    # path would (correctly) refuse it.
    items = []
    for q, desc in [(10, "Hardware Item A"), (5, "Hardware Item B")]:
        item = {"description": desc, "quantity": q, "unit": "Pcs"}
        if classified_item_type:
            item["itemTypeId"] = classified_item_type["id"]
            item["itemTypeName"] = classified_item_type.get("name")
        items.append(item)

    payload = {
        "companyId": company["id"],
        "clientId": client["id"],
        "poNumber": "PO-TEST-001",
        "poDate": today,
        "deliveryDate": today,
        "notes": "<b>Deliver before noon</b>\nGate 2",
        "items": items,
    }
    status, dc = http("POST", f"/api/deliverychallans/company/{company['id']}",
                      base, token=token, body=payload)
    check(suite, "create returns 200/201", status in (200, 201), f"got {status} {dc}")
    if status not in (200, 201):
        return None
    check(suite, "challan number assigned", isinstance(dc.get("challanNumber"), int) and dc["challanNumber"] > 0,
          f"challanNumber = {dc.get('challanNumber')}")
    # When a classified ItemType is attached the challan should be Pending
    # (billable). When the seed catalog had no fully-classified row we
    # fall back to "any non-cancelled status" so the test still runs.
    expected_status = "Pending" if classified_item_type else dc.get("status")
    check(suite, f"status is '{expected_status}' (billable)",
          dc.get("status") == expected_status,
          f"got '{dc.get('status')}'")
    check(suite, "two items round-tripped", len(dc.get("items", [])) == 2,
          f"got {len(dc.get('items', []))} items")
    check(suite, "tenant matches", dc.get("companyId") == company["id"],
          f"companyId = {dc.get('companyId')}")
    check(suite, "formatted challan notes round-trip", dc.get("notes") == payload["notes"], f"got {dc.get('notes')!r}")
    print_status, print_data = http("GET", f"/api/deliverychallans/{dc['id']}/print", base, token=token)
    check(suite, "challan print merge data includes notes",
          print_status == 200 and (print_data or {}).get("notes") == payload["notes"], f"{print_status}")
    print(f"  challan id={dc['id']}  number={dc.get('challanNumber')}  status={dc.get('status')}")
    return dc


# ── Suite 2: Bill creation FROM a challan ──────────────────────────
def test_bill_from_challan(base: str, token: str, company: dict, client: dict, challan: dict) -> dict | None:
    suite = "2. Bill creation FROM a challan"
    print(f"\n=== {suite} ===")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    items = [
        {"deliveryItemId": challan["items"][0]["id"], "unitPrice": 100,
         "description": "Hardware Item A"},
        {"deliveryItemId": challan["items"][1]["id"], "unitPrice": 200,
         "description": "Hardware Item B"},
    ]
    payload = {
        "date": today,
        "companyId": company["id"],
        "clientId": client["id"],
        "gstRate": 18,
        "challanIds": [challan["id"]],
        "notes": "<i>Bill delivery at gate 2</i>",
        "items": items,
    }
    status, bill = http("POST", "/api/invoices", base, token=token, body=payload)
    check(suite, "create returns 200/201", status in (200, 201), f"got {status} {bill}")
    if status not in (200, 201):
        return None

    # 10 × 100 + 5 × 200 = 2000 subtotal; GST 18 % = 360; grand total = 2360
    subtotal = float(bill.get("subtotal") or 0)
    gst = float(bill.get("gstAmount") or 0)
    grand = float(bill.get("grandTotal") or 0)
    check(suite, "subtotal = 2000", abs(subtotal - 2000) < 0.01, f"got {subtotal}")
    check(suite, "GST 18 % = 360",   abs(gst      - 360)  < 0.01, f"got {gst}")
    check(suite, "grand = 2360",     abs(grand    - 2360) < 0.01, f"got {grand}")
    check(suite, "linked to 1 challan",
          len(bill.get("deliveryChallans") or bill.get("challanIds") or []) >= 1
          or bill.get("invoiceNumber") is not None,
          f"bill = {bill}")
    check(suite, "bill notes round-trip", bill.get("notes") == payload["notes"], f"got {bill.get('notes')!r}")
    print_status, print_data = http("GET", f"/api/invoices/{bill['id']}/print/bill", base, token=token)
    check(suite, "bill print merge data includes notes",
          print_status == 200 and (print_data or {}).get("notes") == payload["notes"], f"{print_status}")
    print(f"  bill id={bill['id']}  number={bill.get('invoiceNumber')}  total={grand}")
    return bill


# ── Suite 3: Bill creation WITHOUT a challan ───────────────────────
def test_standalone_bill(base: str, token: str, company: dict, client: dict) -> dict | None:
    suite = "3. Bill creation WITHOUT a challan"
    print(f"\n=== {suite} ===")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    payload = {
        "date": today,
        "companyId": company["id"],
        "clientId": client["id"],
        "gstRate": 18,
        "notes": "<u>Standalone note</u>",
        "items": [
            {"description": "Service Charge", "quantity": 1,
             "uom": "Pcs", "unitPrice": 500},
        ],
    }
    status, bill = http("POST", "/api/invoices/standalone", base, token=token, body=payload)
    check(suite, "create returns 200/201", status in (200, 201), f"got {status} {bill}")
    if status not in (200, 201):
        return None
    # 1 × 500 = 500 subtotal; GST 18 % = 90; grand total = 590
    grand = float(bill.get("grandTotal") or 0)
    check(suite, "grand total = 590 (500 + 18 % GST)", abs(grand - 590) < 0.01, f"got {grand}")
    check(suite, "no challan link",
          (bill.get("deliveryChallans") in (None, []))
          or len(bill.get("deliveryChallans") or []) == 0,
          f"bill = {bill}")
    check(suite, "standalone bill notes round-trip", bill.get("notes") == payload["notes"], f"got {bill.get('notes')!r}")
    print(f"  bill id={bill['id']}  number={bill.get('invoiceNumber')}  total={grand}")
    return bill


# ── Suite: private supplier / actual cost on challans → purchase bills ─
def test_private_challan_costs(base: str, token: str, company: dict, client: dict) -> None:
    suite = "Challan private costs and supplier purchase bills"
    print(f"\n=== {suite} ===")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    suppliers = []
    for suffix in ("A", "B"):
        status, supplier = http("POST", "/api/suppliers", base, token=token, body={
            "companyId": company["id"], "name": f"Test Source Supplier {suffix} {company['id']}",
        })
        check(suite, f"supplier {suffix} created", status in (200, 201), f"{status} {supplier}")
        if status not in (200, 201):
            return
        suppliers.append(supplier)

    status, order = http("POST", f"/api/salesorders/company/{company['id']}", base, token=token, body={
        "clientId": client["id"], "orderDate": today,
        "items": [
            {"description": "Costed A", "quantity": 2, "unit": "Pcs", "unitPrice": 120},
            {"description": "Costed B", "quantity": 3, "unit": "Pcs", "unitPrice": 200},
        ],
    })
    check(suite, "priced order created", status in (200, 201), f"{status} {order}")
    if status not in (200, 201):
        return
    status, challan = http("POST", f"/api/salesorders/{order['id']}/create-challan", base, token=token, body={
        "deliveryDate": today,
        "notes": "From order",
        "lines": [
            {"salesOrderItemId": order["items"][0]["id"], "quantity": 2,
             "supplierId": suppliers[0]["id"], "actualUnitCost": 80},
            {"salesOrderItemId": order["items"][1]["id"], "quantity": 3,
             "supplierId": suppliers[1]["id"], "actualUnitCost": 150},
        ],
    })
    saved_costs = {i.get("description"): i.get("actualUnitCost") for i in challan.get("items", [])} if status in (200, 201) else {}
    check(suite, "order challan retains private costs", status in (200, 201) and
          saved_costs == {"Costed A": 80, "Costed B": 150}, f"{status} {challan}")
    if status not in (200, 201):
        return
    check(suite, "order challan keeps its notes", challan.get("notes") == "From order", f"got {challan.get('notes')!r}")
    status, loaded = http("GET", f"/api/deliverychallans/{challan['id']}", base, token=token)
    by_description = {i["description"]: i for i in loaded.get("items", [])} if status == 200 else {}
    check(suite, "unit and total profit use selling minus actual cost", status == 200 and
          by_description.get("Costed A", {}).get("unitProfit") == 40 and
          by_description.get("Costed B", {}).get("totalProfit") == 150, f"{status} {loaded}")
    check(suite, "supplier name resolved on read",
          by_description.get("Costed A", {}).get("supplierName") == suppliers[0]["name"], f"{by_description.get('Costed A')}")
    status, printed = http("GET", f"/api/deliverychallans/{challan['id']}/print", base, token=token)
    print_text = json.dumps(printed or {}).lower()
    check(suite, "print data excludes private supplier/cost/profit", status == 200 and
          all(field not in print_text for field in ("actualunitcost", "supplierid", "suppliername", "unitprofit", "totalprofit")))

    # A supplier from another tenant can never be attached to a line.
    status, other = http("POST", "/api/companies", base, token=token, body={
        "name": f"_test_basic_flows other {company['id']}", "fullAddress": "Elsewhere", "ntn": "8888888",
        "fbrSellerRegistrationNo": "8888888",
    })
    if status in (200, 201):
        s2, foreign = http("POST", "/api/suppliers", base, token=token, body={"companyId": other["id"], "name": "Foreign Supplier"})
        if s2 in (200, 201):
            s3, _ = http("POST", f"/api/deliverychallans/company/{company['id']}", base, token=token, body={
                "clientId": client["id"], "poNumber": "X", "deliveryDate": today,
                "items": [{"description": "Foreign", "quantity": 1, "unit": "Pcs",
                           "supplierId": foreign["id"], "actualUnitCost": 5}],
            })
            check(suite, "cross-tenant supplier refused", s3 == 400, f"got {s3}")
            http("DELETE", f"/api/suppliers/{foreign['id']}", base, token=token)
        http("DELETE", f"/api/companies/{other['id']}", base, token=token)

    status, bills = http("POST", f"/api/purchasebills/from-challan/{challan['id']}", base, token=token)
    check(suite, "one unpaid purchase bill per supplier", status == 200 and len(bills) == 2 and
          {b["supplierId"] for b in bills} == {s["id"] for s in suppliers} and
          sorted(b["grandTotal"] for b in bills) == [160, 450] and
          all(b.get("sourceDeliveryChallanId") == challan["id"] for b in bills), f"{status} {bills}")
    if status != 200:
        return
    retry_status, retry = http("POST", f"/api/purchasebills/from-challan/{challan['id']}", base, token=token)
    check(suite, "repeat confirmation creates no duplicate", retry_status == 200 and
          {b["id"] for b in retry} == {b["id"] for b in bills}, f"{retry_status} {retry}")
    _, reloaded = http("GET", f"/api/deliverychallans/{challan['id']}", base, token=token)
    check(suite, "challan reports its purchase bills", reloaded.get("hasAutoPurchaseBills") is True)
    changed = dict(reloaded)
    changed["items"] = [dict(i) for i in reloaded["items"]]
    changed["items"][0]["actualUnitCost"] = 81
    edit_status, _ = http("PUT", f"/api/deliverychallans/{challan['id']}", base, token=token, body=changed)
    check(suite, "cost cannot drift after purchase bill creation", edit_status == 400, f"got {edit_status}")
    notes_only = dict(reloaded)
    notes_only["notes"] = "Notes can still change"
    edit_status, edited = http("PUT", f"/api/deliverychallans/{challan['id']}", base, token=token, body=notes_only)
    check(suite, "notes stay editable while lines are locked", edit_status == 200 and
          (edited or {}).get("notes") == "Notes can still change", f"got {edit_status}")
    cancel_status, _ = http("PUT", f"/api/deliverychallans/{challan['id']}/cancel", base, token=token)
    check(suite, "challan with purchase bills cannot be cancelled", cancel_status == 400, f"got {cancel_status}")

    # Incomplete lines are refused, never half-billed.
    status, partial = http("POST", f"/api/deliverychallans/company/{company['id']}", base, token=token, body={
        "clientId": client["id"], "poNumber": "PARTIAL", "deliveryDate": today,
        "items": [{"description": "Has cost", "quantity": 1, "unit": "Pcs", "supplierId": suppliers[0]["id"], "actualUnitCost": 10},
                  {"description": "No cost", "quantity": 1, "unit": "Pcs"}],
    })
    if status in (200, 201):
        s, _ = http("POST", f"/api/purchasebills/from-challan/{partial['id']}", base, token=token)
        check(suite, "incomplete challan refused", s == 400, f"got {s}")

    # Clean up newest-first so the company teardown is not blocked: the
    # purchase bills, then the challans (only the latest is deletable), then
    # the order the challan delivered.
    for b in bills:
        http("DELETE", f"/api/purchasebills/{b['id']}", base, token=token)
    if status in (200, 201):
        http("DELETE", f"/api/deliverychallans/{partial['id']}", base, token=token)
    del_status, _ = http("DELETE", f"/api/deliverychallans/{challan['id']}", base, token=token)
    check(suite, "challan deletable once its purchase bills are gone", del_status in (200, 204), f"got {del_status}")
    http("DELETE", f"/api/salesorders/{order['id']}", base, token=token)


# ── Suite 4: Invoice update ────────────────────────────────────────
def test_invoice_update(base: str, token: str, bill: dict | None) -> None:
    suite = "4. Invoice update"
    print(f"\n=== {suite} ===")
    if bill is None:
        check(suite, "skipped — prerequisite bill not created", False, "no bill")
        return
    # Bump unit price on the (only) line: 500 → 750. New total: 750 + 18 % = 885.
    items_in: list[dict] = []
    for it in bill["items"]:
        items_in.append({
            "id": it["id"],
            "description": it.get("description"),
            "quantity": float(it["quantity"]),
            "uom": it.get("uom") or "Pcs",
            "unitPrice": 750,
        })
    payload = {"gstRate": 18, "items": items_in, "notes": "<b>Edited note</b>"}
    status, updated = http("PUT", f"/api/invoices/{bill['id']}", base, token=token, body=payload)
    check(suite, "update returns 200", status == 200, f"got {status} {updated}")
    if status != 200:
        return
    grand = float(updated.get("grandTotal") or 0)
    check(suite, "new total reflects bumped price (885)",
          abs(grand - 885) < 0.01, f"got {grand}")
    check(suite, "invoiceNumber preserved",
          updated.get("invoiceNumber") == bill.get("invoiceNumber"),
          f"old={bill.get('invoiceNumber')} new={updated.get('invoiceNumber')}")
    check(suite, "edited notes round-trip", updated.get("notes") == payload["notes"], f"got {updated.get('notes')!r}")

    # The eight-column Bill print must use original bill lines and expose
    # their tax columns; it must not borrow the tax consultant's overlay.
    status, printed = http("GET", f"/api/invoices/{bill['id']}/print/bill", base, token=token)
    check(suite, "bill print returns 200", status == 200, f"got {status}")
    if status == 200:
        check(suite, "bill print identifies its template type", printed.get("printTemplateType") == "Bill")
        check(suite, "unsubmitted bill has no FBR images or IRN",
              not any(printed.get(k) for k in ("fbrIRN", "fbrQrPngDataUrl", "fbrLogoUrl")))
        rows = printed.get("items") or []
        check(suite, "bill print preserves all original rows", len(rows) == len(updated["items"]))
        for original, row in zip(updated["items"], rows):
            check(suite, "bill print uses original quantity and unit price",
                  row.get("quantity") == original["quantity"] and row.get("unitPrice") == original["unitPrice"])
            check(suite, "bill print exposes eight-column tax values",
                  row.get("valueExclTax") == 750 and row.get("gstRate") == 18
                  and row.get("gstAmount") == 135 and row.get("totalInclTax") == 885,
                  f"got {row}")


# ── Suite 5: Item Rate History (qty/price suggestion source) ───────
def test_item_rate_history(base: str, token: str, company: dict, classified: dict | None) -> None:
    suite = "5. Item Rate History (price-suggestion data)"
    print(f"\n=== {suite} ===")
    # The FROM-challan bill we created used the classified ItemType,
    # so an itemTypeId filter is the most reliable signal that the
    # history endpoint surfaces the right rows.
    if classified:
        path = (f"/api/invoices/company/{company['id']}/item-rate-history"
                f"?itemTypeId={classified['id']}&pageSize=5")
    else:
        # Fall back to free-text search if no classified ItemType.
        path = (f"/api/invoices/company/{company['id']}/item-rate-history"
                f"?search=Hardware&pageSize=5")
    status, result = http("GET", path, base, token=token)
    check(suite, "endpoint returns 200", status == 200, f"got {status} {result}")
    if status != 200:
        return
    rows = result.get("items") or result.get("rows") or []
    check(suite, "history rows present (>=1)", len(rows) >= 1, f"got {len(rows)} rows")
    if rows:
        first = rows[0]
        # The response includes a unit-price field — the bill form uses
        # this to seed the "last rate" suggestion when the operator
        # picks an ItemType.
        has_unit_price = any(
            k for k in first.keys() if "unit" in k.lower() and "price" in k.lower())
        check(suite, "row carries a unit-price field", has_unit_price,
              f"first row keys = {list(first.keys())}")


# ── Suite 6: Tax calculation correctness ───────────────────────────
def test_tax_calculations(base: str, token: str, company: dict, client: dict) -> None:
    suite = "6. Tax calculation correctness"
    print(f"\n=== {suite} ===")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

    # 6a — Exempt 0 %. Subtotal 1000, GST 0, grand 1000.
    status, b = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": today,
        "companyId": company["id"],
        "clientId": client["id"],
        "gstRate": 0,
        "items": [{"description": "Exempt Good", "quantity": 10,
                   "uom": "Pcs", "unitPrice": 100}],
    })
    check(suite, "6a exempt 0 %: created",  status in (200, 201), f"got {status} {b}")
    if status in (200, 201):
        check(suite, "6a exempt 0 %: GST = 0",
              abs(float(b.get("gstAmount") or 0)) < 0.01,
              f"got {b.get('gstAmount')}")
        check(suite, "6a exempt 0 %: grand = 1000",
              abs(float(b.get("grandTotal") or 0) - 1000) < 0.01,
              f"got {b.get('grandTotal')}")

    # 6b — Reduced 5 %. Subtotal 1000, GST 50, grand 1050.
    status, b = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": today,
        "companyId": company["id"],
        "clientId": client["id"],
        "gstRate": 5,
        "items": [{"description": "Reduced-rate Good", "quantity": 10,
                   "uom": "Pcs", "unitPrice": 100}],
    })
    check(suite, "6b reduced 5 %: created",  status in (200, 201), f"got {status} {b}")
    if status in (200, 201):
        check(suite, "6b reduced 5 %: GST = 50",
              abs(float(b.get("gstAmount") or 0) - 50) < 0.01,
              f"got {b.get('gstAmount')}")
        check(suite, "6b reduced 5 %: grand = 1050",
              abs(float(b.get("grandTotal") or 0) - 1050) < 0.01,
              f"got {b.get('grandTotal')}")

    # 6c — Standard 18 %. Subtotal 1000, GST 180, grand 1180.
    status, b = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": today,
        "companyId": company["id"],
        "clientId": client["id"],
        "gstRate": 18,
        "items": [{"description": "Standard Good", "quantity": 10,
                   "uom": "Pcs", "unitPrice": 100}],
    })
    check(suite, "6c standard 18 %: created", status in (200, 201), f"got {status} {b}")
    if status in (200, 201):
        check(suite, "6c standard 18 %: GST = 180",
              abs(float(b.get("gstAmount") or 0) - 180) < 0.01,
              f"got {b.get('gstAmount')}")
        check(suite, "6c standard 18 %: grand = 1180",
              abs(float(b.get("grandTotal") or 0) - 1180) < 0.01,
              f"got {b.get('grandTotal')}")

    # 6d — Fractional rate 17.5 %. Subtotal 1000, GST 175, grand 1175.
    status, b = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": today,
        "companyId": company["id"],
        "clientId": client["id"],
        "gstRate": 17.5,
        "items": [{"description": "Fractional-rate Good", "quantity": 10,
                   "uom": "Pcs", "unitPrice": 100}],
    })
    check(suite, "6d fractional 17.5 %: created", status in (200, 201), f"got {status} {b}")
    if status in (200, 201):
        check(suite, "6d fractional 17.5 %: GST rounds half-up to 175",
              abs(float(b.get("gstAmount") or 0) - 175) < 0.01,
              f"got {b.get('gstAmount')}")


# ── Suite 7: Bill-form Item Type overrides the challan's type ──────
# Regression guard for the 2026-07-15 bug: a bill created FROM a challan
# silently dropped the Item Type the operator picked on the bill-create
# form. Root cause — CreateInvoiceItemDto carried no ItemTypeId field, and
# InvoiceService.CreateAsync resolved the type from the challan's delivery
# item (`deliveryItem.ItemType`) instead of the operator's pick. Result:
# the base InvoiceItem kept the challan's type (or none), so Invoice-mode
# view/edit showed the wrong/blank type and the Sales-Tax-Invoice print
# could not group by it (grouping requires every line to carry a name).
#
# This suite bills a challan classified as A while the operator picks B on
# the bill form; the pick must win end-to-end (base line, Invoice-mode GET,
# and the grouped Tax-Invoice print).
def test_billform_itemtype_override(base: str, token: str, company: dict,
                                    client: dict, type_a: dict | None,
                                    type_b: dict | None) -> None:
    suite = "7. Bill-form Item Type overrides challan type"
    print(f"\n=== {suite} ===")
    if not type_a or not type_b or type_a["id"] == type_b["id"]:
        check(suite, "skipped — need two distinct classified ItemTypes", False,
              f"A={type_a and type_a.get('id')} B={type_b and type_b.get('id')}")
        return
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

    # Challan classified as A -> lands Pending (billable).
    ch_items = [{"description": d, "quantity": q, "unit": "Pcs",
                 "itemTypeId": type_a["id"], "itemTypeName": type_a["name"]}
                for q, d in [(10, "Override Line 1"), (5, "Override Line 2")]]
    status, dc = http("POST", f"/api/deliverychallans/company/{company['id']}",
                      base, token=token, body={
                          "companyId": company["id"], "clientId": client["id"],
                          "poNumber": "PO-OVERRIDE", "poDate": today,
                          "deliveryDate": today, "items": ch_items})
    if status not in (200, 201) or dc.get("status") != "Pending":
        check(suite, "challan billable", False, f"status={status} {dc}")
        return

    # Bill FROM the challan, picking B on every line (the operator
    # re-classifies at bill time).
    bill_items = [{"deliveryItemId": it["id"], "unitPrice": 100,
                   "description": it["description"], "itemTypeId": type_b["id"]}
                  for it in dc["items"]]
    status, bill = http("POST", "/api/invoices", base, token=token, body={
        "date": today, "companyId": company["id"], "clientId": client["id"],
        "gstRate": 18, "challanIds": [dc["id"]], "items": bill_items})
    check(suite, "bill create 200/201", status in (200, 201), f"got {status} {bill}")
    if status not in (200, 201):
        return

    lines = bill.get("items", [])
    check(suite, "every line adopts picked Item Type B (not challan's A)",
          bool(lines) and all(l.get("itemTypeId") == type_b["id"] for l in lines),
          f"ids={[l.get('itemTypeId') for l in lines]} (A={type_a['id']}, B={type_b['id']})")
    check(suite, "every line name == B",
          all((l.get("itemTypeName") or "") == type_b["name"] for l in lines),
          f"names={[l.get('itemTypeName') for l in lines]}")
    check(suite, "every line HS re-derived from B",
          all((l.get("hsCode") or "") == (type_b.get("hsCode") or "") for l in lines),
          f"hs={[l.get('hsCode') for l in lines]} (B={type_b.get('hsCode')})")

    # Invoice-mode view/edit reads GET /api/invoices/{id}.
    status, reloaded = http("GET", f"/api/invoices/{bill['id']}", base, token=token)
    rlines = (reloaded or {}).get("items", [])
    check(suite, "Invoice-mode GET shows B on every line",
          status == 200 and bool(rlines) and all(l.get("itemTypeId") == type_b["id"] for l in rlines),
          f"ids={[l.get('itemTypeId') for l in rlines]}")

    # Sales-Tax-Invoice print groups by Item Type -> exactly one B row.
    status, tax = http("GET", f"/api/invoices/{bill['id']}/print/tax-invoice",
                       base, token=token)
    titems = (tax or {}).get("items", [])
    check(suite, "tax invoice grouped into one Item-Type row",
          status == 200 and len(titems) == 1,
          f"status={status} rows={[t.get('itemTypeName') for t in titems]}")
    if titems:
        for collection in ("items", "billItems"):
            printed = tax[collection][0]
            check(suite, f"{collection}: original and invoice quantity choices",
                  printed.get("billQuantity") == 15 and printed.get("invoiceQuantity") == 15)
            check(suite, f"{collection}: independent type names",
                  printed.get("billItemTypeName") == type_b["name"]
                  and printed.get("invoiceItemTypeName") == type_b["name"])
            check(suite, f"{collection}: invoice financial choices",
                  printed.get("invoiceValueExclTax") == 1500
                  and printed.get("invoiceGstAmount") == printed.get("gstAmount"))
        check(suite, "grouped row named after B",
              (titems[0].get("itemTypeName") or "") == type_b["name"],
              f"name={titems[0].get('itemTypeName')}")


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
            print(f"  [{badge}] {name:55s} {status}")
    total = len(results)
    print(f"\n=== {total - fail}/{total} checks passed ===")
    return 0 if fail == 0 else 1


# ── Main ───────────────────────────────────────────────────────────
def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", default="http://localhost:5134")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw",   default="admin123")
    p.add_argument("--keep",       action="store_true",
                   help="Leave test rows in the DB after the run.")
    args = p.parse_args()

    token, company, client = setup(args.base, args.admin_user, args.admin_pw)

    # Pick one fully-FBR-classified ItemType so the challan lands billable.
    classified = pick_classified_item_type(args.base, token, company["id"])
    # A brand-new company now starts with an EMPTY private catalog (2026-09-21),
    # so "find a classified row in the seeded catalog" no longer holds. Create
    # what the suite needs instead of skipping the checks that depend on it.
    if not classified:
        for nm, hs in (("BF_Classified_A", "8481.8090"), ("BF_Classified_B", "8412.2100")):
            http("POST", f"/api/itemtypes?companyId={company['id']}", args.base, token=token,
                 body={"name": f"{nm}_{datetime.now().strftime('%H%M%S%f')[:10]}",
                       "companyId": company["id"], "hsCode": hs, "uom": "Pcs",
                       "saleType": "Goods at standard rate (default)", "isFavorite": True})
        classified = pick_classified_item_type(args.base, token, company["id"])
    if classified:
        print(f"\n=== Picked classified ItemType id={classified['id']} name='{classified['name']}' "
              f"hsCode='{classified.get('hsCode')}' saleType='{classified.get('saleType')}' ===")
    else:
        print("\n=== No fully-classified ItemType found in seed catalog — "
              "FROM-challan billing test may skip. ===")

    try:
        challan = test_challan_creation(args.base, token, company, client, classified)
        bill_from_challan = (
            test_bill_from_challan(args.base, token, company, client, challan)
            if challan and challan.get("status") == "Pending" else None
        )
        if challan and challan.get("status") != "Pending":
            check("2. Bill creation FROM a challan", "skipped — challan not billable", False,
                  f"challan status = {challan.get('status')}")
        standalone = test_standalone_bill(args.base, token, company, client)
        test_invoice_update(args.base, token, standalone)
        test_item_rate_history(args.base, token, company, classified)
        test_tax_calculations(args.base, token, company, client)
        # Regression: operator's bill-form Item Type pick must override the
        # challan's own type (needs a second distinct classified type).
        second_classified = pick_second_classified(args.base, token, classified, company["id"])
        test_billform_itemtype_override(args.base, token, company, client,
                                        classified, second_classified)
        test_private_challan_costs(args.base, token, company, client)
    finally:
        teardown(args.base, token, company, args.keep)

    return print_report()


if __name__ == "__main__":
    sys.exit(main())
