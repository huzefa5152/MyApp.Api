#!/usr/bin/env python3
"""
Exact Line Total on the Invoices-tab narrow edit (2026-09-16).

The Invoices tab lets a restricted role re-classify lines and adjust quantity
and unit price, under a server guard that the bill's subtotal must not move.
Hitting the original subtotal EXACTLY used to be impossible on this branch for
two reasons, and this suite pins both fixes:

  * the grouped row shows ONE unit price for several lines, so a price rounded
    for display and then applied to every line drifts the subtotal (the
    reported case: 6,301 units at a displayed 219.5 makes 1,383,069.50 against
    a bill of 1,383,048.00 - out by 21.50); and
  * InvoiceItem.UnitPrice was decimal(18,2), so even a correctly derived rate
    could not be stored. It is now decimal(28,12)
    (Migrations/*_WidenInvoiceUnitPriceTo12Decimals).

The operator now states the exact line total and the SERVER derives the rate.
What this suite proves:

  1. the reported figures reproduce exactly - 1,383,048.00 subtotal, 248,948.64
     GST at 18 %, 1,631,996.64 grand total;
  2. a grouped target splits across the underlying lines and re-sums to the
     target to the paisa, with no per-line rounding leak;
  3. the saved values survive a reload with no drift (this is what the widened
     column buys - assert it, because a 2dp column fails here and nowhere else);
  4. the validation refuses what it cannot honour instead of silently booking a
     different amount; and
  5. the narrow endpoint still cannot touch the buyer, the date or the terms.

Local only. Creates its own throwaway company and deletes it at the end.

    python scripts/test_invoice_exact_line_total.py --base http://localhost:5104
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

PASS = 0
FAIL = 0
FAILURES: list[str] = []


def check(suite: str, name: str, ok: bool, detail: str = "") -> bool:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        FAILURES.append(f"{suite} :: {name} :: {detail}")
        print(f"  [FAIL] {name}  -- {detail}")
    return ok


def http(method: str, path: str, base: str, token: str | None = None,
         body: dict | list | None = None, timeout: int = 120):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base.rstrip("/") + path, data=data,
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
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


# ── The allocation the grouped UI performs, mirrored here ────────────────────
# Integers (paisa) throughout, proportional to quantity, with the remainder
# handed to the largest line. The largest line's share is "target minus what has
# already been handed out" rather than a rounded figure of its own - that is
# precisely what stops four independently-rounded lines leaking a few paisa.
def allocate(target: Decimal, qtys: list[int]) -> list[Decimal]:
    target_paisa = int((target * 100).to_integral_value(rounding=ROUND_HALF_UP))
    qty_total = sum(qtys)
    biggest = max(range(len(qtys)), key=lambda k: (qtys[k], -k))
    shares: list[int | None] = [None] * len(qtys)
    handed = 0
    for k, q in enumerate(qtys):
        if k == biggest:
            continue
        share = (target_paisa * q) // qty_total
        shares[k] = share
        handed += share
    shares[biggest] = target_paisa - handed
    return [Decimal(s) / 100 for s in shares]  # type: ignore[arg-type]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  EXACT LINE TOTAL - Invoices-tab narrow edit")
    print("=" * 78)

    status, d = http("POST", "/api/auth/login", base,
                     body={"username": args.user, "password": args.password})
    if status != 200:
        print(f"[!] login failed: HTTP {status} {d}")
        return 2
    token = d["token"]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    company = client = None
    company_id = None
    type_id = None
    # ItemType is a GLOBAL catalog (no CompanyId), so it is neither scoped to
    # the throwaway company nor removed with it. Unique per run, and deleted in
    # the cleanup, or a second run collides with the first.
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    try:
        # ── setup ────────────────────────────────────────────────────────────
        print("\n=== 0. Setup ===")
        status, company = http("POST", "/api/companies", base, token=token, body={
            "name": "[TEMP] Exact Line Total Suite",
            "brandName": "[TEMP] Exact Line Total Suite",
            "fullAddress": "Karachi", "cnic": "4220100000000",
            # Deliberately supplies the union of what the production lines ask
            # for, so ONE fixture is billable on any of them: master gates
            # FBR-readiness on the company's NTN + STRN, while the trader line
            # replaced that with a dedicated seller registration number and
            # dropped STRN entirely. A field a branch does not have simply has
            # nowhere to bind.
            "ntn": "1234567-8", "strn": "1234567890123",
            "fbrSellerRegistrationNo": "4220100000000",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingDebitNoteNumber": 1, "startingCreditNoteNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "fbrProvinceCode": 8, "inventoryTrackingEnabled": False,
            # A challan is only billable once its seller is FBR-ready
            # (DeliveryChallanService.IsFbrReady), so the profile has to be
            # complete or the bill this suite needs cannot be raised. The token
            # is a placeholder: nothing here ever calls FBR.
            "fbrBusinessActivity": "Wholesaler", "fbrSector": "Wholesale / Retails",
            "fbrEnvironment": "sandbox", "fbrToken": "placeholder-not-a-real-token",
        })
        if not check("0", "throwaway company created", status in (200, 201), f"{status} {err_text(company)}"):
            return 1
        company_id = company["id"]

        status, client = http("POST", "/api/clients", base, token=token, body={
            "companyId": company_id, "name": "[TEMP] Exact Total Buyer",
            "address": "Karachi", "ntn": "4228937-8",
            # STRN for the same reason as the company above — master requires a
            # buyer STRN, the trader line does not.
            "strn": "9876543210987",
            "registrationType": "Registered", "fbrProvinceCode": 8,
        })
        if not check("0", "buyer created", status in (200, 201), f"{status} {err_text(client)}"):
            return 1

        # One Item Type on all four lines, so the grouped view shows ONE row
        # "grouped from 4 lines" - the shape the report came from.
        status, itype = http("POST", "/api/itemtypes", base, token=token, body={
            "name": f"[TEMP] Exact Total Pipe Fitting {stamp}", "uom": "KG",
            "companyId": company_id,
        })
        if not check("0", "item type created", status in (200, 201), f"{status} {err_text(itype)}"):
            return 1
        type_id = itype["id"]

        # 2097 x3 + 10 = 6301, the reported quantity. The prices below make the
        # bill's ORIGINAL subtotal exactly 1,383,048.00, which is the situation
        # being reproduced: the operator has to land back on that figure. No
        # single 2dp price can do it (1,383,048 / 6301 = 219.4965878...), which
        # is the whole reason this feature exists.
        QTYS = [2097, 2097, 2097, 10]
        PRICES = [219.50, 219.50, 219.50, 217.35]
        ch_items = [{"description": f"[TEMP] line {k+1}", "quantity": q,
                     "unit": "KG", "itemTypeId": type_id}
                    for k, q in enumerate(QTYS)]
        status, dc = http("POST", f"/api/deliverychallans/company/{company_id}", base, token=token, body={
            "companyId": company_id, "clientId": client["id"], "poNumber": "PO-EXACT",
            "poDate": today, "deliveryDate": today, "items": ch_items,
        })
        if not check("0", "challan with 4 lines created", status in (200, 201), f"{status} {err_text(dc)}"):
            return 1

        bill_items = [{"deliveryItemId": it["id"], "unitPrice": PRICES[k],
                       "description": it["description"], "itemTypeId": type_id}
                      for k, it in enumerate(dc["items"])]
        status, bill = http("POST", "/api/invoices", base, token=token, body={
            "date": today, "companyId": company_id, "clientId": client["id"],
            "gstRate": 18, "challanIds": [dc["id"]], "items": bill_items,
        })
        if not check("0", "bill created", status in (200, 201), f"{status} {err_text(bill)}"):
            return 1
        bill_id = bill["id"]
        lines = bill["items"]
        check("0", "bill has 4 lines", len(lines) == 4, f"got {len(lines)}")
        check("0", "total qty is 6301",
              sum(int(float(l["quantity"])) for l in lines) == 6301,
              f"got {sum(float(l['quantity']) for l in lines)}")
        check("0", "original subtotal is exactly 1,383,048.00",
              Decimal(str(bill["subtotal"])) == Decimal("1383048.00"),
              f"got {bill['subtotal']}")

        # ── 1. the reported figures ──────────────────────────────────────────
        print("\n=== 1. The reported case reproduces exactly ===")
        TARGET = Decimal("1383048.00")
        shares = allocate(TARGET, QTYS)
        check("1", "allocation re-sums to the target",
              sum(shares) == TARGET, f"got {sum(shares)}")

        rows = [{"id": l["id"], "itemTypeId": type_id,
                 "quantity": int(float(l["quantity"])),
                 "exactLineTotal": float(shares[k])}
                for k, l in enumerate(lines)]
        status, saved = http("PATCH", f"/api/invoices/{bill_id}/itemtypes-and-qty",
                             base, token=token, body={"items": rows, "writeMode": "bill"})
        if not check("1", "save accepted", status == 200, f"{status} {err_text(saved)}"):
            return 1

        sub = Decimal(str(saved["subtotal"]))
        gst = Decimal(str(saved["gstAmount"]))
        grand = Decimal(str(saved["grandTotal"]))
        check("1", "subtotal == 1,383,048.00", sub == TARGET, f"got {sub}")
        check("1", "GST 18% == 248,948.64", gst == Decimal("248948.64"), f"got {gst}")
        check("1", "grand total == 1,631,996.64",
              grand == Decimal("1631996.64"), f"got {grand}")

        # ── 2. grouped lines re-sum with no rounding leak ────────────────────
        print("\n=== 2. Grouped lines re-sum to the target ===")
        saved_lines = saved["items"]
        line_sum = sum(Decimal(str(l["lineTotal"])) for l in saved_lines)
        check("2", "SUM(line totals) == target to the paisa",
              line_sum == TARGET, f"got {line_sum}")
        check("2", "every line keeps a whole quantity",
              all(Decimal(str(l["quantity"])) == Decimal(str(l["quantity"])).to_integral_value()
                  for l in saved_lines),
              f"qtys={[l['quantity'] for l in saved_lines]}")
        # The rate itself has to carry the precision, or the sum above could
        # only have been reached by storing a line total that contradicts it.
        check("2", "at least one line stores a rate beyond 2dp",
              any(Decimal(str(l["unitPrice"])) != Decimal(str(l["unitPrice"])).quantize(Decimal("0.01"))
                  for l in saved_lines),
              f"prices={[l['unitPrice'] for l in saved_lines]}")
        for l in saved_lines:
            q = Decimal(str(l["quantity"]))
            p = Decimal(str(l["unitPrice"]))
            lt = Decimal(str(l["lineTotal"]))
            check("2", f"line {l['id']}: qty x rate reproduces its line total",
                  (q * p).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) == lt,
                  f"{q} x {p} -> {(q*p).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)} vs {lt}")

        # ── 3. reload shows no drift ─────────────────────────────────────────
        print("\n=== 3. Reload shows the saved values, no drift ===")
        status, again = http("GET", f"/api/invoices/{bill_id}", base, token=token)
        check("3", "reload 200", status == 200, f"got {status}")
        if status == 200:
            check("3", "subtotal still exactly 1,383,048.00",
                  Decimal(str(again["subtotal"])) == TARGET, f"got {again['subtotal']}")
            check("3", "grand total still exactly 1,631,996.64",
                  Decimal(str(again["grandTotal"])) == Decimal("1631996.64"),
                  f"got {again['grandTotal']}")
            reloaded_sum = sum(Decimal(str(l["lineTotal"])) for l in again["items"])
            check("3", "line totals still re-sum to the target",
                  reloaded_sum == TARGET, f"got {reloaded_sum}")
            by_id = {l["id"]: l for l in saved_lines}
            check("3", "every stored rate round-trips unchanged",
                  all(Decimal(str(l["unitPrice"])) == Decimal(str(by_id[l["id"]]["unitPrice"]))
                      for l in again["items"] if l["id"] in by_id),
                  "a rate changed across the reload")

        # ── 4. validation refuses what it cannot honour ──────────────────────
        print("\n=== 4. Validation ===")
        first = saved_lines[0]
        rest = [{"id": l["id"], "quantity": int(float(l["quantity"])),
                 "exactLineTotal": float(Decimal(str(l["lineTotal"])))}
                for l in saved_lines[1:]]

        def patch_first(extra: dict):
            row = {"id": first["id"], "quantity": int(float(first["quantity"]))}
            row.update(extra)
            return http("PATCH", f"/api/invoices/{bill_id}/itemtypes-and-qty", base, token=token,
                        body={"items": [row] + rest, "writeMode": "bill"})

        status, resp = patch_first({"exactLineTotal": 0})
        check("4", "zero exact total refused", status >= 400, f"got {status}")
        check("4", "  ... and says why", "greater than zero" in err_text(resp).lower(),
              err_text(resp)[:120])

        status, resp = patch_first({"exactLineTotal": -5})
        check("4", "negative exact total refused", status >= 400, f"got {status}")

        status, resp = patch_first({"exactLineTotal": 1000.555})
        check("4", "sub-paisa exact total refused", status >= 400, f"got {status}")
        check("4", "  ... and names the 2dp rule", "2 decimal" in err_text(resp).lower(),
              err_text(resp)[:120])

        status, resp = patch_first({"quantity": 3.5, "exactLineTotal": 1000})
        check("4", "fractional quantity refused under an exact total", status >= 400, f"got {status}")
        check("4", "  ... and says whole-number", "whole" in err_text(resp).lower(),
              err_text(resp)[:120])

        status, resp = patch_first({"unitPrice": 219.4965878431991234})
        check("4", "rate beyond 12dp refused", status >= 400, f"got {status}")
        check("4", "  ... and names the 12dp limit", "12 decimal" in err_text(resp).lower(),
              err_text(resp)[:120])

        # A target that a whole quantity genuinely cannot reproduce must be
        # REFUSED, not quietly booked at the nearest figure it can reach.
        status, resp = patch_first({"quantity": 3, "exactLineTotal": 0.01})
        check("4", "unreproducible target refused rather than silently changed",
              status >= 400, f"got {status} {err_text(resp)[:100]}")

        # ── 5. the narrow endpoint stays narrow ──────────────────────────────
        print("\n=== 5. The narrow endpoint still cannot widen itself ===")
        status, before = http("GET", f"/api/invoices/{bill_id}", base, token=token)
        status, resp = http("PATCH", f"/api/invoices/{bill_id}/itemtypes-and-qty", base, token=token, body={
            "items": [{"id": l["id"], "quantity": int(float(l["quantity"])),
                       "exactLineTotal": float(Decimal(str(l["lineTotal"])))}
                      for l in saved_lines],
            "writeMode": "bill",
            # None of these are on the DTO, so they have nowhere to land.
            "clientId": 999999, "date": "1999-01-01T00:00:00Z",
            "paymentTerms": "HACKED", "paymentMode": "HACKED", "documentType": 9,
        })
        check("5", "save still accepted", status == 200, f"{status} {err_text(resp)}")
        status, after = http("GET", f"/api/invoices/{bill_id}", base, token=token)
        if status == 200 and before:
            check("5", "buyer unchanged", after.get("clientId") == before.get("clientId"),
                  f"{before.get('clientId')} -> {after.get('clientId')}")
            check("5", "bill date unchanged", after.get("date") == before.get("date"),
                  f"{before.get('date')} -> {after.get('date')}")
            check("5", "payment terms unchanged",
                  after.get("paymentTerms") == before.get("paymentTerms"),
                  f"{before.get('paymentTerms')} -> {after.get('paymentTerms')}")
            check("5", "document type unchanged",
                  after.get("documentType") == before.get("documentType"),
                  f"{before.get('documentType')} -> {after.get('documentType')}")
            check("5", "subtotal still the target",
                  Decimal(str(after["subtotal"])) == TARGET, f"got {after['subtotal']}")

        # ── 7. Tax Invoice: filed view vs billed view ────────────────────────
        # The Sales Tax Invoice can now render EITHER decomposition. Prove they
        # are genuinely different once an overlay exists - a template binding
        # the wrong one would otherwise look correct on an unadjusted bill and
        # be wrong on every adjusted one.
        print("\n=== 7. Tax Invoice carries both item views ===")
        status, fields = http("GET", "/api/mergefields/TaxInvoice", base, token=token)
        exprs = {f.get("fieldExpression") for f in (fields or [])} if status == 200 else set()
        check("7", "merge field {{#each billItems}} is offered",
              "{{#each billItems}}" in exprs, f"{len(exprs)} TaxInvoice fields")
        # The money fields are fmtDec (2dp), not fmt (whole rupees): a unit price
        # of 219.50 must not print as "220". {{fmtDec this.unitPrice}} is a single
        # row serving BOTH loops - the picker is keyed on the expression, so the
        # same string cannot appear twice.
        for expr in ("{{fmtQty this.quantity}}", "{{fmtDec this.unitPrice}}",
                     "{{fmtDec this.valueExclTax}}", "{{fmtDec this.totalInclTax}}"):
            check("7", f"merge field {expr} is offered", expr in exprs, "missing")
        check("7", "no whole-rupee fmt left on a TaxInvoice money field",
              not [e for e in exprs if e.startswith("{{fmt this.")],
              f"{[e for e in exprs if e.startswith('{{fmt this.')]}")

        # Re-classify + restate the filing on ONE line, leaving the bill alone.
        status, alt = http("POST", "/api/itemtypes", base, token=token, body={
            "name": f"[TEMP] Exact Total Filed Type {stamp}", "uom": "KG",
            "hsCode": "8481.8090", "companyId": company_id,
        })
        alt_id = alt["id"] if status in (200, 201) else None
        check("7", "second item type created", alt_id is not None, f"{status} {err_text(alt)}")

        if alt_id:
            status, before_bill = http("GET", f"/api/invoices/{bill_id}", base, token=token)
            bill_sub = Decimal(str(before_bill["subtotal"]))
            rows = [{"id": l["id"], "quantity": int(float(l["quantity"])),
                     "exactLineTotal": float(Decimal(str(l["lineTotal"])))}
                    for l in before_bill["items"]]
            rows[0]["itemTypeId"] = alt_id          # filed under a different type
            status, _ = http("PATCH", f"/api/invoices/{bill_id}/itemtypes-and-qty", base, token=token,
                             body={"items": rows, "writeMode": "adjustment"})
            check("7", "overlay save accepted", status == 200, f"got {status}")

            status, tax = http("GET", f"/api/invoices/{bill_id}/print/tax-invoice", base, token=token)
            if check("7", "tax-invoice print 200", status == 200, f"got {status}"):
                filed = tax.get("items") or []
                billed = tax.get("billItems") or []
                check("7", "billItems is populated", len(billed) > 0, f"got {len(billed)}")
                filed_val = sum(Decimal(str(i["valueExclTax"])) for i in filed)
                billed_val = sum(Decimal(str(i["valueExclTax"])) for i in billed)
                check("7", "billItems value ties to the bill subtotal",
                      billed_val == bill_sub, f"{billed_val} vs {bill_sub}")
                check("7", "filed items value ties to the same money",
                      filed_val == bill_sub, f"{filed_val} vs {bill_sub}")
                check("7", "billItems groups by the BILL's item type (no filed type)",
                      all(i.get("itemTypeName") != alt["name"] for i in billed),
                      f"names={[i.get('itemTypeName') for i in billed]}")
                check("7", "filed items DO show the re-classified type",
                      any(i.get("itemTypeName") == alt["name"] for i in filed),
                      f"names={[i.get('itemTypeName') for i in filed]}")
                check("7", "billItems quantity ties to the bill",
                      sum(Decimal(str(i["quantity"])) for i in billed) == Decimal(6301),
                      f"got {sum(Decimal(str(i['quantity'])) for i in billed)}")
                check("7", "every billItems unit price is a 2dp money figure",
                      all(Decimal(str(i["unitPrice"])) ==
                          Decimal(str(i["unitPrice"])).quantize(Decimal("0.01")) for i in billed),
                      f"prices={[i['unitPrice'] for i in billed]}")

            status, _ = http("DELETE", f"/api/itemtypes/{alt_id}", base, token=token)

        # ── 6. the allocator itself ──────────────────────────────────────────
        print("\n=== 6. Allocation never leaks a paisa ===")
        cases = [
            (Decimal("1383048.00"), [2000, 1800, 1500, 1001]),
            (Decimal("100.00"), [3, 3, 3]),          # 33.33 x3 leaves 1 paisa
            (Decimal("0.03"), [1, 1, 1]),
            (Decimal("1000.01"), [7, 11, 13]),
            (Decimal("999999.99"), [1]),
        ]
        for target, qtys in cases:
            got = allocate(target, qtys)
            check("6", f"{target} over {qtys} re-sums exactly",
                  sum(got) == target, f"got {sum(got)}")
            check("6", f"{target} over {qtys} has no negative share",
                  all(x >= 0 for x in got), f"got {got}")

    finally:
        if company_id or type_id:
            print("\n=== Cleanup ===")
        if company_id:
            status, _ = http("DELETE", f"/api/companies/{company_id}", base, token=token)
            check("cleanup", "throwaway company deleted", status in (200, 204), f"got {status}")
        if type_id:
            status, _ = http("DELETE", f"/api/itemtypes/{type_id}", base, token=token)
            check("cleanup", "throwaway item type deleted", status in (200, 204), f"got {status}")

    print()
    print("=" * 78)
    if FAIL:
        print(f"  {PASS} passed, {FAIL} FAILED")
        for f in FAILURES:
            print(f"   - {f}")
        print("=" * 78)
        return 1
    print(f"  EXACT LINE TOTAL SUITE PASSED - {PASS}/{PASS} checks")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
