#!/usr/bin/env python3
"""
Auto vs custom bill / invoice numbering, on BOTH bill-create paths.

A bill and a tax invoice are the same row printed through two templates, so
there is ONE number: the Bills list heads the column "Bill #", the Invoices
list heads it "Invoice #". Both create forms may now either take the next
number in the company's sequence ("Auto", the default and the old behaviour)
or carry a number the operator typed.

What this pins:
  • Auto still lands MAX + 1 — unchanged for every existing caller.
  • A custom number is issued VERBATIM, on the standalone path and the
    from-challan path alike, and carries the company's prefix into
    FbrInvoiceNumber exactly as an auto number does.
  • A duplicate is REFUSED with a message naming the number — never silently
    swapped for a different one, which is the one failure this feature must
    not have.
  • The demo band (900000+, FBR Sandbox) and non-positive numbers are refused,
    so a custom number can't poison the automatic sequence.
  • A custom number ABOVE the current max moves the sequence: the next auto
    bill continues from it.
  • The next-number endpoint answers what the forms need, honours the two
    separately-grantable create permissions, and is company-scoped.
  • An existing bill can be RENUMBERED from the edit screen, under the same
    rules — and a bill that has gone to FBR cannot be, because its number was
    filed under an IRN.

Runs against a THROWAWAY company it creates and deletes. Never touches
existing data.

    python scripts/test_custom_bill_number.py --base http://localhost:5135
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

PASSED = 0
FAILED = 0
FAILURES: list[str] = []


def check(suite: str, label: str, ok: bool, detail: str = "") -> bool:
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  PASS  {label}")
    else:
        FAILED += 1
        FAILURES.append(f"{suite} :: {label} — {detail}")
        print(f"  FAIL  {label}  ({detail})")
    return ok


def http(method: str, path: str, base: str, token: str | None = None,
         body=None, timeout: int = 60):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def err_text(payload) -> str:
    if isinstance(payload, dict):
        return str(payload.get("error") or payload.get("message") or payload)
    return str(payload)


TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")


# ── Setup ───────────────────────────────────────────────────────────────────
def setup(base: str, user: str, pw: str, prefix: str):
    status, data = http("POST", "/api/auth/login", base, body={"username": user, "password": pw})
    if status != 200:
        sys.exit(f"FATAL: login failed ({status} {data})")
    token = data["token"]

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    # Every FBR-readiness field filled so a challan lands Pending (billable)
    # rather than Setup Required — the from-challan suite needs that.
    status, company = http("POST", "/api/companies", base, token=token, body={
        "name": f"_test_billnum {suffix}",
        "fullAddress": "Test HQ",
        "phone": "+92-21-00000000",
        "ntn": "9999999",
        "cnic": "9999999999999",
        "strn": "9999999999999",
        "fbrSellerRegistrationNo": "9999999",
        "startingChallanNumber": 1,
        "startingInvoiceNumber": 1000,
        "startingPurchaseBillNumber": 1,
        "startingGoodsReceiptNumber": 1,
        "invoiceNumberPrefix": prefix,
        "fbrEnvironment": "sandbox",
        "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Manufacturer",
        "fbrSector": "All Other Sectors",
        # Never sent to PRAL by this suite — it exists because IsFbrReady
        # requires a token before a challan may leave "Setup Required".
        "fbrToken": "test-token-not-used-for-real-pral-calls",
    })
    if status not in (200, 201):
        sys.exit(f"FATAL: create company failed ({status} {company})")

    status, client = http("POST", "/api/clients", base, token=token, body={
        "name": f"Test Buyer {suffix}",
        "address": "1 Test Road, Karachi",
        "phone": "021-1234567",
        "companyId": company["id"],
        "ntn": "1234567",
        "strn": "1234567890123",
        "fbrProvinceCode": 8,
        "registrationType": "Registered",
    })
    if status not in (200, 201):
        sys.exit(f"FATAL: create client failed ({status} {client})")

    status, items = http("GET", "/api/itemtypes", base, token=token)
    item_type = None
    if status == 200 and isinstance(items, list):
        item_type = next((i for i in items
                          if i.get("hsCode") and i.get("uom") and i.get("saleType")), None)

    print(f"  company id={company['id']} prefix='{prefix}' startingInvoiceNumber=1000")
    print(f"  client  id={client['id']}")
    print(f"  itemType {item_type['id'] if item_type else '(none classified)'}")
    return token, company, client, item_type


def make_standalone(base, token, company, client, item_type, number=None, qty=1, price=100):
    line = {
        "description": "Widget",
        "quantity": qty,
        "uom": (item_type or {}).get("uom") or "Pcs",
        "unitPrice": price,
    }
    if item_type:
        line["itemTypeId"] = item_type["id"]
        line["hsCode"] = item_type.get("hsCode")
        line["saleType"] = item_type.get("saleType")
    body = {
        "date": TODAY,
        "companyId": company["id"],
        "clientId": client["id"],
        "gstRate": 18,
        "items": [line],
    }
    if number is not None:
        body["invoiceNumber"] = number
    return http("POST", "/api/invoices/standalone", base, token=token, body=body)


def make_challan(base, token, company, client, item_type):
    item = {"description": "Hardware Item A", "quantity": 4, "unit": "Pcs"}
    if item_type:
        item["itemTypeId"] = item_type["id"]
        item["itemTypeName"] = item_type.get("name")
    return http("POST", f"/api/deliverychallans/company/{company['id']}", base, token=token, body={
        "companyId": company["id"],
        "clientId": client["id"],
        "poNumber": "PO-BILLNUM-001",
        "poDate": TODAY,
        "deliveryDate": TODAY,
        "items": [item],
    })


def make_from_challan(base, token, company, client, challan, item_type, number=None):
    lines = []
    for di in challan.get("items", []):
        line = {"deliveryItemId": di["id"], "unitPrice": 250, "description": di.get("description")}
        if item_type:
            line["itemTypeId"] = item_type["id"]
            line["hsCode"] = item_type.get("hsCode")
            line["saleType"] = item_type.get("saleType")
            line["uom"] = di.get("unit") or item_type.get("uom")
        lines.append(line)
    body = {
        "date": TODAY,
        "companyId": company["id"],
        "clientId": client["id"],
        "gstRate": 18,
        "challanIds": [challan["id"]],
        "items": lines,
    }
    if number is not None:
        body["invoiceNumber"] = number
    return http("POST", "/api/invoices", base, token=token, body=body)


def next_number(base, token, company_id, check_value=None):
    q = "" if check_value is None else f"?check={check_value}"
    return http("GET", f"/api/invoices/company/{company_id}/next-number{q}", base, token=token)


# ── Suite 1: the next-number endpoint ───────────────────────────────────────
def suite_next_number(base, token, company, prefix):
    s = "1. next-number endpoint"
    print(f"\n=== {s} ===")
    cid = company["id"]

    status, d = next_number(base, token, cid)
    if not check(s, "endpoint answers 200", status == 200, f"got {status} {d}"):
        return None
    # No bills yet, so Auto must offer the company's STARTING number, not 1.
    check(s, "first bill offers the starting number", d.get("nextNumber") == 1000,
          f"nextNumber={d.get('nextNumber')}")
    check(s, "prefix echoed", d.get("prefix") == prefix, f"prefix={d.get('prefix')!r}")
    check(s, "formatted number carries the prefix", d.get("formattedNext") == f"{prefix}1000",
          f"formattedNext={d.get('formattedNext')!r}")
    check(s, "starting number reported as set", d.get("startingNumberSet") is True,
          f"startingNumberSet={d.get('startingNumberSet')}")
    check(s, "ceiling sits just under the demo band", d.get("maxAllowed") == 899999,
          f"maxAllowed={d.get('maxAllowed')}")

    status, d = next_number(base, token, cid, 4242)
    check(s, "a free number reads available",
          status == 200 and d.get("checkedAvailable") is True and not d.get("checkedError"),
          f"{status} {d}")
    check(s, "a checked number is formatted with the prefix too",
          d.get("formattedChecked") == f"{prefix}4242", f"{d.get('formattedChecked')!r}")

    status, d = next_number(base, token, cid, 0)
    check(s, "zero is refused", status == 200 and d.get("checkedAvailable") is False,
          f"{status} {d}")
    status, d = next_number(base, token, cid, -5)
    check(s, "a negative number is refused", status == 200 and d.get("checkedAvailable") is False,
          f"{status} {d}")
    status, d = next_number(base, token, cid, 900000)
    check(s, "the demo band (900000) is refused",
          status == 200 and d.get("checkedAvailable") is False
          and "sandbox" in (d.get("checkedError") or "").lower(),
          f"{status} {d}")
    status, d = next_number(base, token, cid, 899999)
    check(s, "the number just below the demo band is allowed",
          status == 200 and d.get("checkedAvailable") is True, f"{status} {d}")
    return True


# ── Suite 2: standalone bill (no challan) ───────────────────────────────────
def suite_standalone(base, token, company, client, item_type, prefix):
    s = "2. Standalone bill"
    print(f"\n=== {s} ===")
    cid = company["id"]
    created = []

    # Auto — omitting invoiceNumber entirely is what every pre-existing caller
    # does, so this is also the backwards-compatibility case.
    status, inv = make_standalone(base, token, company, client, item_type)
    if not check(s, "auto create succeeds", status in (200, 201), f"{status} {err_text(inv)}"):
        return created
    created.append(inv["id"])
    check(s, "auto lands the company's starting number", inv.get("invoiceNumber") == 1000,
          f"invoiceNumber={inv.get('invoiceNumber')}")
    check(s, "auto number carries the prefix on the document number",
          inv.get("fbrInvoiceNumber") == f"{prefix}1000", f"{inv.get('fbrInvoiceNumber')!r}")

    # Explicit null means Auto too — that is what the form sends in Auto mode.
    status, inv = make_standalone(base, token, company, client, item_type, number=None)
    check(s, "auto continues MAX + 1", status in (200, 201) and inv.get("invoiceNumber") == 1001,
          f"{status} {err_text(inv)}")
    if status in (200, 201):
        created.append(inv["id"])

    # Custom, free, and ABOVE the current max.
    status, inv = make_standalone(base, token, company, client, item_type, number=7777)
    if check(s, "custom number is issued verbatim",
             status in (200, 201) and inv.get("invoiceNumber") == 7777,
             f"{status} {err_text(inv)}"):
        created.append(inv["id"])
        check(s, "custom number carries the prefix too",
              inv.get("fbrInvoiceNumber") == f"{prefix}7777", f"{inv.get('fbrInvoiceNumber')!r}")

    # A custom number above the max MOVES the sequence.
    status, d = next_number(base, token, cid)
    check(s, "auto continues from the custom number", status == 200 and d.get("nextNumber") == 7778,
          f"nextNumber={d.get('nextNumber')}")

    # Custom, free, and BELOW the max — back-filling a gap must work.
    status, inv = make_standalone(base, token, company, client, item_type, number=1002)
    if check(s, "a number below the max is accepted (gap back-fill)",
             status in (200, 201) and inv.get("invoiceNumber") == 1002,
             f"{status} {err_text(inv)}"):
        created.append(inv["id"])
    status, d = next_number(base, token, cid)
    check(s, "back-filling does not rewind the sequence",
          status == 200 and d.get("nextNumber") == 7778, f"nextNumber={d.get('nextNumber')}")

    # Duplicate — refused, named, and NOT silently renumbered.
    status, inv = make_standalone(base, token, company, client, item_type, number=7777)
    ok = status == 400 and "7777" in err_text(inv)
    check(s, "a duplicate is refused with the number in the message", ok, f"{status} {err_text(inv)}")
    if status in (200, 201):
        created.append(inv["id"])
        check(s, "a duplicate was NOT silently renumbered", False,
              f"created #{inv.get('invoiceNumber')} instead of failing")

    status, d = next_number(base, token, cid, 7777)
    check(s, "the taken number now reads unavailable",
          status == 200 and d.get("checkedAvailable") is False and "7777" in (d.get("checkedError") or ""),
          f"{status} {d}")

    # Out-of-range custom numbers are refused by the create path, not only the probe.
    status, inv = make_standalone(base, token, company, client, item_type, number=900001)
    check(s, "create refuses the demo band", status == 400, f"{status} {err_text(inv)}")
    if status in (200, 201):
        created.append(inv["id"])
    status, inv = make_standalone(base, token, company, client, item_type, number=-1)
    check(s, "create refuses a negative number", status == 400, f"{status} {err_text(inv)}")
    if status in (200, 201):
        created.append(inv["id"])

    return created


# ── Suite 3: bill from a challan ────────────────────────────────────────────
def suite_from_challan(base, token, company, client, item_type, prefix):
    s = "3. Bill from a challan"
    print(f"\n=== {s} ===")
    cid = company["id"]
    created = []

    status, dc1 = make_challan(base, token, company, client, item_type)
    if not check(s, "challan created", status in (200, 201), f"{status} {err_text(dc1)}"):
        return created
    if dc1.get("status") not in ("Pending", "Imported"):
        check(s, "challan is billable", False, f"status={dc1.get('status')}")
        return created

    status, inv = make_from_challan(base, token, company, client, dc1, item_type, number=8888)
    if check(s, "custom number is issued verbatim on the challan path",
             status in (200, 201) and inv.get("invoiceNumber") == 8888,
             f"{status} {err_text(inv)}"):
        created.append(inv["id"])
        check(s, "prefix applied on the challan path too",
              inv.get("fbrInvoiceNumber") == f"{prefix}8888", f"{inv.get('fbrInvoiceNumber')!r}")

    status, dc2 = make_challan(base, token, company, client, item_type)
    if status in (200, 201) and dc2.get("status") in ("Pending", "Imported"):
        status, inv = make_from_challan(base, token, company, client, dc2, item_type)
        if check(s, "auto on the challan path continues the shared sequence",
                 status in (200, 201) and inv.get("invoiceNumber") == 8889,
                 f"{status} {err_text(inv)}"):
            created.append(inv["id"])

    # A duplicate across the two paths: the standalone bill at 7777 must block
    # a challan bill asking for 7777. One sequence, two doors.
    status, dc3 = make_challan(base, token, company, client, item_type)
    if status in (200, 201) and dc3.get("status") in ("Pending", "Imported"):
        status, inv = make_from_challan(base, token, company, client, dc3, item_type, number=7777)
        check(s, "a number taken by a standalone bill blocks the challan path",
              status == 400 and "7777" in err_text(inv), f"{status} {err_text(inv)}")
        if status in (200, 201):
            created.append(inv["id"])
        # The refused attempt must not have consumed the challan.
        status, dc3b = http("GET", f"/api/deliverychallans/{dc3['id']}", base, token=token)
        check(s, "a refused bill leaves the challan billable",
              status == 200 and dc3b.get("status") in ("Pending", "Imported"),
              f"{status} status={dc3b.get('status') if isinstance(dc3b, dict) else dc3b}")

    return created


# ── Suite 4: scope ──────────────────────────────────────────────────────────
def suite_scope(base, token, company):
    s = "4. Scope"
    print(f"\n=== {s} ===")
    # A company id that cannot exist — the route must not answer with another
    # tenant's sequence or a 200 full of zeros.
    status, d = next_number(base, token, 999_999_999)
    check(s, "an unknown company is not answered with a number",
          status in (400, 403, 404), f"got {status} {d}")


# ── Suite 5: renumbering an existing bill ───────────────────────────────────
def suite_edit(base, token, company, client, item_type, prefix):
    s = "5. Renumbering on edit"
    print(f"\n=== {s} ===")
    cid = company["id"]
    created = []

    status, inv = make_standalone(base, token, company, client, item_type, number=2100)
    if not check(s, "a bill to renumber", status in (200, 201), f"{status} {err_text(inv)}"):
        return created
    created.append(inv["id"])

    def edit(invoice, **extra):
        body = {
            "gstRate": invoice.get("gstRate", 18),
            "items": [{
                "id": it["id"],
                "description": it.get("description") or "",
                "quantity": it["quantity"],
                "unitPrice": it["unitPrice"],
                "itemTypeId": it.get("itemTypeId"),
                "uom": it.get("uom"),
                "hsCode": it.get("hsCode"),
                "saleType": it.get("saleType"),
            } for it in invoice.get("items", [])],
        }
        body.update(extra)
        return http("PUT", f"/api/invoices/{invoice['id']}", base, token=token, body=body)

    # Omitting the field entirely must leave the number alone — an API client
    # editing only line data must not have to restate it.
    status, back = edit(inv)
    check(s, "an edit that does not mention the number keeps it",
          status == 200 and back.get("invoiceNumber") == 2100,
          f"{status} {err_text(back)}")

    # Sending the SAME number is a no-op, not a clash with itself.
    status, back = edit(inv, invoiceNumber=2100)
    check(s, "re-sending the current number is not a self-clash",
          status == 200 and back.get("invoiceNumber") == 2100,
          f"{status} {err_text(back)}")

    # A free number is taken, and the document number follows it.
    status, back = edit(inv, invoiceNumber=2101)
    ok = status == 200 and back.get("invoiceNumber") == 2101
    check(s, "the number can be changed", ok, f"{status} {err_text(back)}")
    if ok:
        check(s, "the document number follows the new number",
              back.get("fbrInvoiceNumber") == f"{prefix}2101",
              f"{back.get('fbrInvoiceNumber')!r}")
        inv = back

    # A number another bill holds is refused, and the bill keeps the one it had.
    status, other = make_standalone(base, token, company, client, item_type, number=2200)
    if status in (200, 201):
        created.append(other["id"])
        status, back = edit(inv, invoiceNumber=2200)
        check(s, "renumbering onto a taken number is refused",
              status == 400 and "2200" in err_text(back), f"{status} {err_text(back)}")
        status, again = http("GET", f"/api/invoices/{inv['id']}", base, token=token)
        check(s, "a refused renumber leaves the bill on its own number",
              status == 200 and again.get("invoiceNumber") == 2101,
              f"invoiceNumber={again.get('invoiceNumber') if isinstance(again, dict) else again}")

    # The reserved band and non-positive numbers are refused here too.
    status, back = edit(inv, invoiceNumber=900000)
    check(s, "the demo band is refused on edit", status == 400, f"{status} {err_text(back)}")
    status, back = edit(inv, invoiceNumber=-4)
    check(s, "a negative number is refused on edit", status == 400, f"{status} {err_text(back)}")

    # Renumbering must free the number the bill used to hold.
    status, d = next_number(base, token, cid, 2100)
    check(s, "the vacated number reads free again",
          status == 200 and d.get("checkedAvailable") is True, f"{status} {d}")

    return created


def suite_edit_fbr_lock(base, token, company, client, item_type, db):
    """A bill FBR holds may not be renumbered. The status is set directly in the
    database because reaching it legitimately means a live PRAL submission, which
    this suite has no business making."""
    s = "6. A filed bill cannot be renumbered"
    print(f"\n=== {s} ===")
    created = []
    if not db:
        print("  SKIP (needs --db to set an FBR status without calling PRAL)")
        return created

    try:
        import pyodbc  # noqa: F401
    except ImportError:
        print("  SKIP (pyodbc not installed)")
        return created
    import pyodbc

    status, inv = make_standalone(base, token, company, client, item_type, number=3100)
    if not check(s, "a bill to file", status in (200, 201), f"{status} {err_text(inv)}"):
        return created
    created.append(inv["id"])

    def set_status(fbr_status, irn):
        conn = pyodbc.connect(db, autocommit=True)
        cur = conn.cursor()
        cur.execute("UPDATE Invoices SET FbrStatus = ?, FbrIRN = ? WHERE Id = ?",
                    fbr_status, irn, inv["id"])
        conn.close()

    def try_renumber(n):
        body = {
            "gstRate": inv.get("gstRate", 18),
            "invoiceNumber": n,
            "items": [{
                "id": it["id"], "description": it.get("description") or "",
                "quantity": it["quantity"], "unitPrice": it["unitPrice"],
                "itemTypeId": it.get("itemTypeId"), "uom": it.get("uom"),
                "hsCode": it.get("hsCode"), "saleType": it.get("saleType"),
            } for it in inv.get("items", [])],
        }
        return http("PUT", f"/api/invoices/{inv['id']}", base, token=token, body=body)

    for label, st, irn in [
        ("Submitting (a POST is on the wire)", "Submitting", None),
        ("Uncertain (FBR may already hold it)", "Uncertain", None),
        ("Validated but already carrying an IRN", "Validated", "IRN-TEST-0001"),
    ]:
        set_status(st, irn)
        status, back = try_renumber(3999)
        check(s, f"refused: {label}", status == 400 and "FBR" in err_text(back),
              f"{status} {err_text(back)}")

    # Validated with no IRN is still a bill FBR has not accepted, so it may move.
    set_status("Validated", None)
    status, back = try_renumber(3101)
    check(s, "allowed: Validated with no IRN (nothing filed yet)",
          status == 200 and back.get("invoiceNumber") == 3101, f"{status} {err_text(back)}")

    return created


# ── Main ────────────────────────────────────────────────────────────────────
def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", default="http://localhost:5135")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw", default="admin123")
    p.add_argument("--prefix", default="TST-")
    p.add_argument("--keep", action="store_true")
    p.add_argument("--db", default=None,
                   help="ODBC connection string; enables the FBR-filed lock suite, "
                        "which has to set a submission status without calling PRAL.")
    args = p.parse_args()

    print("=== Setup ===")
    token, company, client, item_type = setup(args.base, args.admin_user, args.admin_pw, args.prefix)

    try:
        suite_next_number(args.base, token, company, args.prefix)
        suite_standalone(args.base, token, company, client, item_type, args.prefix)
        suite_from_challan(args.base, token, company, client, item_type, args.prefix)
        suite_scope(args.base, token, company)
        suite_edit(args.base, token, company, client, item_type, args.prefix)
        suite_edit_fbr_lock(args.base, token, company, client, item_type, args.db)
    finally:
        if args.keep:
            print(f"\n=== Keeping company id={company['id']} ===")
        else:
            st, _ = http("DELETE", f"/api/companies/{company['id']}", args.base, token=token)
            print(f"\n=== Teardown: delete company {company['id']} -> {st} ===")

    print("\n" + "=" * 66)
    print(f"  {PASSED} passed, {FAILED} failed")
    if FAILURES:
        print("\n  Failures:")
        for f in FAILURES:
            print(f"   - {f}")
        print("=" * 66)
        return 1
    print("  CUSTOM BILL NUMBER SUITE PASSED")
    print("=" * 66)
    return 0


if __name__ == "__main__":
    sys.exit(main())
