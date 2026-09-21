#!/usr/bin/env python3
"""
HS code on both printed documents, and readiness without a quantity adjustment
(2026-09-21).

The flow this pins is the one the tax consultant actually works:

    A bill is raised against an un-classified item — the Bills tab has no
    item-type picker, so the bill row carries no HS code at all. On the
    Invoices tab the consultant picks an HS-coded item type. They may stop
    there: if the declared quantities are already right, nothing needs
    adjusting.

Two things have to be true at that point, and both are easy to break:

  1. THE INVOICE IS READY TO FILE. Readiness is judged on the EFFECTIVE line
     (overlay ?? bill row) and asks only for HS code, sale type, UOM and a
     positive unit price. It must NOT require a quantity adjustment to exist —
     "the consultant looked and decided nothing needed changing" is a complete
     answer, and the original quantity is what gets filed.

  2. BOTH PRINTS CARRY THE CODE. The Sales Tax Invoice groups by the effective
     item type and shows its HS code. The Bill shows the same code — and
     nothing else from the overlay: quantity, rate and line total stay the
     commercial bill's, because that is the document the buyer signs for goods
     received.

The Bill's HSCode is deliberately the only overlay-fed field on that DTO. If a
later change starts pulling the adjusted QUANTITY onto the Bill, suite 3 fails.

Local only. Creates its own throwaway company, client, item types and bill.

    python scripts/test_hscode_on_prints.py --base http://localhost:5104
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
import urllib.error
import urllib.request
from decimal import Decimal

PASS = 0
FAIL = 0
FAILURES: list[str] = []
NL = chr(10)

HS_CODE = "8481.8090"
SALE_TYPE = "Goods at standard rate (default)"


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


def err(payload) -> str:
    if isinstance(payload, dict):
        return str(payload.get("error") or payload.get("message") or payload)
    return str(payload)[:180]


def D(x) -> Decimal:
    return Decimal(str(x or 0))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  HS CODE ON PRINTS, AND READINESS WITHOUT A QUANTITY ADJUSTMENT")
    print("=" * 78)

    s, d = http("POST", "/api/auth/login", base,
                body={"username": args.user, "password": args.password})
    if s != 200:
        print(f"[!] login failed: HTTP {s} {d}")
        return 2
    token = d["token"]

    company = None
    made_types: list[dict] = []
    # Item types are an INSTALL-WIDE catalog with a unique-name rule, so a
    # fixed name collides with the previous run. Stamp them and delete them.
    stamp = datetime.now().strftime("%H%M%S%f")[:10]
    try:
        print(NL + "--- 0. a bill raised against an UN-CLASSIFIED item ---")
        name = "_test_hscode_prints"
        s, company = http("POST", "/api/companies", base, token=token, body={
            "name": name, "brandName": name, "fullAddress": f"{name} HQ",
            "phone": "+92-21-00000000", "ntn": "1234567", "cnic": "1234567890123",
            "strn": "1234567890123", "fbrSellerRegistrationNo": "1234567",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        })
        if not check("0", "company created", s in (200, 201), f"{s} {err(company)}"):
            return 1
        cid = company["id"]

        s, client = http("POST", "/api/clients", base, token=token, body={
            "name": "_hscode_buyer", "companyId": cid, "address": "Karachi",
            "ntn": "7654321", "registrationType": "Registered"})
        if not check("0", "buyer created", s in (200, 201), f"{s} {err(client)}"):
            return 1

        # The un-classified type the bill is raised against: no HS code, which
        # is exactly what the Bills tab produces.
        # Catalogs are company-private (2026-09-21, [CatalogCompany]), so the
        # company has to be named on the catalog calls.
        s, plain = http("POST", f"/api/itemtypes?companyId={cid}", base, token=token,
                        body={"name": f"_hscode_plain_{stamp}", "companyId": cid})
        if not check("0", "un-classified item type created", s in (200, 201),
                     f"{s} {err(plain)}"):
            return 1
        # The classified type the consultant will pick on the Invoices tab.
        s, classified = http("POST", f"/api/itemtypes?companyId={cid}", base, token=token, body={
            "name": f"_hscode_classified_{stamp}", "companyId": cid, "hsCode": HS_CODE,
            "uom": "Numbers, pieces, units", "saleType": SALE_TYPE})
        if not check("0", "HS-coded item type created", s in (200, 201),
                     f"{s} {err(classified)}"):
            return 1
        made_types = [t for t in (plain, classified) if isinstance(t, dict) and t.get("id")]

        s, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
            "companyId": cid, "clientId": client["id"],
            "date": "2026-09-21T00:00:00Z", "gstRate": 18,
            "documentType": 4,
            "items": [{
                "description": "Ball valve 1 inch", "quantity": 10,
                "uom": "Pcs", "unitPrice": 1000, "itemTypeId": plain["id"],
            }],
        })
        if not check("0", "bill created", s in (200, 201), f"{s} {err(inv)}"):
            return 1
        inv_id = inv["id"]
        check("0", "the bill row starts with NO HS code",
              not (inv["items"][0].get("hsCode") or "").strip(),
              f"got {inv['items'][0].get('hsCode')!r}")

        # -- 1. before classification it is NOT ready -------------------------
        print(NL + "--- 1. before classification, FBR is missing the HS code ---")
        s, before = http("GET", f"/api/invoices/{inv_id}", base, token=token)
        missing = before.get("fbrMissing") or []
        check("1", "it is not FBR-ready yet", len(missing) > 0, "nothing reported missing")
        check("1", "and it says the HS Code is what is missing",
              any("HS Code" in m for m in missing), str(missing))

        # -- 2. classify only - no quantity touched ---------------------------
        print(NL + "--- 2. the consultant picks the item type and changes nothing else ---")
        line_id = before["items"][0]["id"]
        s, patched = http("PATCH", f"/api/invoices/{inv_id}/itemtypes", base, token=token,
                          body={"items": [{"id": line_id,
                                           "itemTypeId": classified["id"]}]})
        if not check("2", "the item type is accepted on its own", s == 200,
                     f"{s} {err(patched)}"):
            return 1

        s, after = http("GET", f"/api/invoices/{inv_id}", base, token=token)
        line = after["items"][0]
        check("2", "the quantity is untouched", D(line["quantity"]) == D(10),
              f"got {line['quantity']}")
        check("2", "the unit price is untouched", D(line["unitPrice"]) == D(1000),
              f"got {line['unitPrice']}")
        check("2", "no filed quantity was invented",
              (line.get("adjustment") or {}).get("adjustedQuantity") in (None, ""),
              f"got {(line.get('adjustment') or {}).get('adjustedQuantity')}")

        # THE POINT OF THIS SUITE.
        missing_after = after.get("fbrMissing") or []
        check("2", "classifying ALONE makes it ready to file",
              len(missing_after) == 0,
              f"still missing: {missing_after} - readiness must not require a"
              " quantity adjustment")

        # -- 3. both prints carry the code ------------------------------------
        print(NL + "--- 3. the HS code reaches both printed documents ---")
        s, bill = http("GET", f"/api/invoices/{inv_id}/print/bill", base, token=token)
        if check("3", "the Bill print renders", s == 200, f"{s} {err(bill)}"):
            b0 = (bill.get("items") or [{}])[0]
            check("3", "the Bill carries the consultant's HS code",
                  (b0.get("hsCode") or "") == HS_CODE, f"got {b0.get('hsCode')!r}")
            # The Bill is the delivery document: only the code comes from the
            # overlay. If this ever fails, something started pulling filing
            # numbers onto the document the buyer signs for goods received.
            check("3", "the Bill still shows the SHIPPED quantity",
                  D(b0.get("quantity")) == D(10), f"got {b0.get('quantity')}")
            check("3", "the Bill still shows the commercial rate",
                  D(b0.get("unitPrice")) == D(1000), f"got {b0.get('unitPrice')}")

        s, tax = http("GET", f"/api/invoices/{inv_id}/print/tax-invoice", base, token=token)
        if check("3", "the Sales Tax Invoice renders", s == 200, f"{s} {err(tax)}"):
            t0 = (tax.get("items") or [{}])[0]
            check("3", "the Tax Invoice carries the same HS code",
                  (t0.get("hsCode") or "") == HS_CODE, f"got {t0.get('hsCode')!r}")
            check("3", "and files the ORIGINAL quantity, nothing having been adjusted",
                  D(t0.get("quantity")) == D(10), f"got {t0.get('quantity')}")
            check("3", "grouped under the classified item type",
                  (t0.get("itemTypeName") or "") == f"_hscode_classified_{stamp}",
                  f"got {t0.get('itemTypeName')!r}")

    finally:
        print(NL + "--- cleanup ---")
        if company:
            http("DELETE", f"/api/companies/{company['id']}", base, token=token)
        for t in made_types:
            http("DELETE", f"/api/itemtypes/{t['id']}?companyId={company['id']}", base, token=token)
        print("  temp company and item types removed")

    print(NL + "=" * 78)
    if FAIL == 0:
        print(f"  HS CODE ON PRINTS SUITE PASSED - {PASS}/{PASS} checks")
    else:
        print(f"  HS CODE ON PRINTS SUITE FAILED - {FAIL} of {PASS + FAIL} checks")
        for f in FAILURES:
            print(f"    - {f}")
    print("=" * 78)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
