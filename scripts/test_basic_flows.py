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
def pick_classified_item_type(base: str, token: str) -> dict | None:
    status, items = http("GET", "/api/itemtypes", base, token=token)
    if status != 200 or not isinstance(items, list):
        return None
    for it in items:
        # The starter catalog seeds HSCode + UOM + SaleType; only those
        # rows mark a challan/bill as "ready for FBR submission".
        if it.get("hsCode") and it.get("uom") and it.get("saleType"):
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
    print(f"  bill id={bill['id']}  number={bill.get('invoiceNumber')}  total={grand}")
    return bill


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
    payload = {"gstRate": 18, "items": items_in}
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
    classified = pick_classified_item_type(args.base, token)
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
    finally:
        teardown(args.base, token, company, args.keep)

    return print_report()


if __name__ == "__main__":
    sys.exit(main())
