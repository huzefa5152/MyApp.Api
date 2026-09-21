#!/usr/bin/env python3
"""
Further tax and withholding tax on documents (2026-09-16).

Two taxes with opposite shapes, and the whole risk is in mixing them up:

  • FURTHER TAX (s.3(1A)) is part of the supply. Same base as sales tax, on the
    sales-tax invoice, INSIDE the grand total:
        GrandTotal = Subtotal + GSTAmount + FurtherTaxAmount
  • WITHHOLDING (s.153) is deducted at source by whoever pays. It NEVER moves
    the grand total; it changes what is collectible:
        Collectible = GrandTotal − WithholdingTaxAmount

Both DEFAULT TO NONE. That is the property most of this suite exists to
protect: every document written before these columns existed, and every one
where the operator does not ask for the tax, must come out byte-identical to
before. A tax that arrives on a guess is worse than one that is missing.

The other thing pinned here is the narrow-edit path. The grand total is
computed in six places across three services; the Invoices-tab narrow edit was
the one that would have silently DROPPED further tax from the total on every
re-classification, because it rebuilt the total from subtotal + GST alone.

Local only. Creates its own throwaway company and deletes it at the end.

    python scripts/test_document_taxes.py --base http://localhost:5104
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal

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


def D(x) -> Decimal:
    return Decimal(str(x))


def sql(conn: str, query: str) -> str:
    """Run a statement through sqlcmd. Used only to fake an FBR filing: a credit
    note can only be raised against a bill that really was filed, and nothing in
    the API can put a bill into that state."""
    server, db = "", ""
    for part in conn.split(";"):
        k, _, v = part.partition("=")
        k = k.strip().lower()
        if k == "server":
            server = v.strip()
        elif k in ("database", "initial catalog"):
            db = v.strip()
    out = subprocess.run(
        ["sqlcmd", "-S", server, "-d", db, "-E", "-I", "-h", "-1", "-W", "-Q", query],
        capture_output=True, text=True, timeout=120)
    return (out.stdout or "") + (out.stderr or "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--db", default=None,
                    help="connection string. Optional — only the credit-note suite needs it, "
                         "because a note can only be raised against a bill that was really filed.")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  DOCUMENT TAXES - further tax and withholding")
    print("=" * 78)

    status, d = http("POST", "/api/auth/login", base,
                     body={"username": args.user, "password": args.password})
    if status != 200:
        print(f"[!] login failed: HTTP {status} {d}")
        return 2
    token = d["token"]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    company_id = type_id = supplier_id = None

    try:
        # ── 0. setup ─────────────────────────────────────────────────────────
        print("\n=== 0. Setup ===")
        status, company = http("POST", "/api/companies", base, token=token, body={
            "name": "[TEMP] Document Taxes Suite", "brandName": "[TEMP] Document Taxes Suite",
            "fullAddress": "Karachi", "cnic": "4220100000000",
            "ntn": "1234567-8", "strn": "1234567890123",
            "fbrSellerRegistrationNo": "4220100000000",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingDebitNoteNumber": 1, "startingCreditNoteNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "fbrProvinceCode": 8, "inventoryTrackingEnabled": False,
            "fbrBusinessActivity": "Wholesaler", "fbrSector": "Wholesale / Retails",
            "fbrEnvironment": "sandbox", "fbrToken": "placeholder-not-a-real-token",
        })
        if not check("0", "throwaway company created", status in (200, 201), f"{status} {err_text(company)}"):
            return 1
        company_id = company["id"]

        status, client = http("POST", "/api/clients", base, token=token, body={
            "companyId": company_id, "name": "[TEMP] Tax Buyer", "address": "Karachi",
            "ntn": "4228937-8", "strn": "9876543210987",
            "registrationType": "Registered", "fbrProvinceCode": 8,
        })
        if not check("0", "buyer created", status in (200, 201), f"{status} {err_text(client)}"):
            return 1

        status, itype = http("POST", "/api/itemtypes", base, token=token, body={
            "name": f"[TEMP] Tax Widget {stamp}", "uom": "KG", "companyId": company_id})
        if not check("0", "item type created", status in (200, 201), f"{status} {err_text(itype)}"):
            return 1
        type_id = itype["id"]

        status, supplier = http("POST", "/api/suppliers", base, token=token, body={
            "companyId": company_id, "name": "[TEMP] Tax Supplier", "address": "Karachi"})
        if check("0", "supplier created", status in (200, 201), f"{status} {err_text(supplier)}"):
            supplier_id = supplier["id"]

        # One fixture shape reused throughout: 100 x 1,000.00 = 100,000.00
        # subtotal, 18% GST = 18,000.00.
        SUBTOTAL = Decimal("100000.00")
        GST = Decimal("18000.00")

        def make_bill(extra: dict | None = None):
            s, dc = http("POST", f"/api/deliverychallans/company/{company_id}", base, token=token, body={
                "companyId": company_id, "clientId": client["id"], "poNumber": "PO-TAX",
                "poDate": today, "deliveryDate": today,
                "items": [{"description": "[TEMP] taxed line", "quantity": 100,
                           "unit": "KG", "itemTypeId": type_id}],
            })
            if s not in (200, 201):
                return s, dc
            body = {
                "date": today, "companyId": company_id, "clientId": client["id"],
                "gstRate": 18, "challanIds": [dc["id"]],
                "items": [{"deliveryItemId": dc["items"][0]["id"], "unitPrice": 1000,
                           "description": "[TEMP] taxed line", "itemTypeId": type_id}],
            }
            body.update(extra or {})
            return http("POST", "/api/invoices", base, token=token, body=body)

        # ── 1. default is none ───────────────────────────────────────────────
        print("\n=== 1. Nothing is charged or withheld unless it is asked for ===")
        status, plain = make_bill()
        if not check("1", "a bill with no tax fields saves", status in (200, 201), f"{status} {err_text(plain)}"):
            return 1
        check("1", "further tax rate is null", plain.get("furtherTaxRate") is None,
              f"got {plain.get('furtherTaxRate')}")
        check("1", "further tax amount is zero", D(plain["furtherTaxAmount"]) == 0,
              f"got {plain['furtherTaxAmount']}")
        check("1", "withholding rate is null", plain.get("withholdingTaxRate") is None,
              f"got {plain.get('withholdingTaxRate')}")
        check("1", "withholding amount is zero", D(plain["withholdingTaxAmount"]) == 0,
              f"got {plain['withholdingTaxAmount']}")
        check("1", "the grand total is the same two-term sum as before",
              D(plain["grandTotal"]) == SUBTOTAL + GST, f"got {plain['grandTotal']}")
        check("1", "collectible equals the grand total",
              D(plain["collectible"]) == D(plain["grandTotal"]), f"got {plain['collectible']}")
        check("1", "balance due equals the grand total",
              D(plain["balanceDue"]) == D(plain["grandTotal"]), f"got {plain['balanceDue']}")

        # A rate explicitly sent as null or 0 still means none.
        for label, payload in [("null", {"furtherTaxRate": None}), ("zero", {"furtherTaxRate": 0})]:
            status, b = make_bill(payload)
            if check("1", f"a further-tax rate of {label} saves", status in (200, 201), f"{status} {err_text(b)}"):
                check("1", f"a rate of {label} charges nothing",
                      b.get("furtherTaxRate") is None and D(b["furtherTaxAmount"]) == 0
                      and D(b["grandTotal"]) == SUBTOTAL + GST,
                      f"rate={b.get('furtherTaxRate')} amount={b['furtherTaxAmount']} total={b['grandTotal']}")

        # ── 2. further tax is INSIDE the grand total ─────────────────────────
        print("\n=== 2. Further tax is part of the supply ===")
        status, ft = make_bill({"furtherTaxRate": 3})
        if not check("2", "a bill with further tax saves", status in (200, 201), f"{status} {err_text(ft)}"):
            return 1
        expected_ft = Decimal("3000.00")   # 3% of the 100,000 net value of supply
        check("2", "the rate is stored", D(ft["furtherTaxRate"]) == 3, f"got {ft['furtherTaxRate']}")
        check("2", "it is charged on the NET value of supply, not the gross",
              D(ft["furtherTaxAmount"]) == expected_ft, f"got {ft['furtherTaxAmount']}")
        check("2", "the grand total carries all three terms",
              D(ft["grandTotal"]) == SUBTOTAL + GST + expected_ft, f"got {ft['grandTotal']}")
        check("2", "sales tax itself is untouched", D(ft["gstAmount"]) == GST, f"got {ft['gstAmount']}")
        check("2", "the subtotal is untouched", D(ft["subtotal"]) == SUBTOTAL, f"got {ft['subtotal']}")
        check("2", "collectible still equals the grand total (nothing withheld)",
              D(ft["collectible"]) == D(ft["grandTotal"]), f"got {ft['collectible']}")

        # ── 3. withholding never moves the grand total ───────────────────────
        print("\n=== 3. Withholding changes what is collected, not what is charged ===")
        status, wh = make_bill({"withholdingTaxRate": 0.5})
        if not check("3", "a bill with withholding saves", status in (200, 201), f"{status} {err_text(wh)}"):
            return 1
        gross = SUBTOTAL + GST
        expected_wh = Decimal("590.00")     # 0.5% of the GROSS 118,000
        check("3", "the grand total is unchanged by withholding",
              D(wh["grandTotal"]) == gross, f"got {wh['grandTotal']}")
        check("3", "it is computed on the GROSS total, not the net",
              D(wh["withholdingTaxAmount"]) == expected_wh, f"got {wh['withholdingTaxAmount']}")
        check("3", "the collectible drops by exactly the withheld amount",
              D(wh["collectible"]) == gross - expected_wh, f"got {wh['collectible']}")
        check("3", "and so does the balance due",
              D(wh["balanceDue"]) == gross - expected_wh, f"got {wh['balanceDue']}")

        # Fixed-amount mode: a null rate with an amount.
        status, whf = make_bill({"withholdingTaxRate": None, "withholdingTaxAmount": 1234.56})
        if check("3", "fixed-amount withholding saves", status in (200, 201), f"{status} {err_text(whf)}"):
            check("3", "the fixed amount is kept as given",
                  D(whf["withholdingTaxAmount"]) == Decimal("1234.56"), f"got {whf['withholdingTaxAmount']}")
            check("3", "with no rate stored", whf.get("withholdingTaxRate") is None,
                  f"got {whf.get('withholdingTaxRate')}")
            check("3", "and the grand total still unmoved",
                  D(whf["grandTotal"]) == gross, f"got {whf['grandTotal']}")

        # A mistyped rate must not produce a negative balance.
        status, whx = make_bill({"withholdingTaxRate": 500})
        if check("3", "an absurd withholding rate is accepted, not crashed", status in (200, 201),
                 f"{status} {err_text(whx)}"):
            check("3", "it is clamped to the grand total",
                  D(whx["withholdingTaxAmount"]) == D(whx["grandTotal"]), f"got {whx['withholdingTaxAmount']}")
            check("3", "so the collectible bottoms out at zero, never negative",
                  D(whx["collectible"]) == 0, f"got {whx['collectible']}")

        # ── 4. both together ─────────────────────────────────────────────────
        print("\n=== 4. Both taxes on one document ===")
        status, both = make_bill({"furtherTaxRate": 3, "withholdingTaxRate": 0.5})
        if check("4", "a bill with both saves", status in (200, 201), f"{status} {err_text(both)}"):
            total = SUBTOTAL + GST + Decimal("3000.00")
            # Withholding is on the grand total, which now INCLUDES further tax.
            check("4", "further tax is inside the total", D(both["grandTotal"]) == total,
                  f"got {both['grandTotal']}")
            check("4", "withholding is taken on the total INCLUDING further tax",
                  D(both["withholdingTaxAmount"]) == Decimal("605.00"),
                  f"got {both['withholdingTaxAmount']}")
            check("4", "the collectible nets both correctly",
                  D(both["collectible"]) == total - Decimal("605.00"), f"got {both['collectible']}")

        # ── 5. the edit paths ────────────────────────────────────────────────
        print("\n=== 5. Editing keeps the taxes straight ===")
        edit_id = ft["id"]
        status, full = http("PUT", f"/api/invoices/{edit_id}", base, token=token, body={
            "gstRate": 18, "furtherTaxRate": 3,
            "items": [{"id": ft["items"][0]["id"], "quantity": 50, "unitPrice": 1000,
                       "description": "[TEMP] taxed line", "itemTypeId": type_id}],
        })
        if check("5", "a full edit halving the quantity saves", status == 200, f"{status} {err_text(full)}"):
            check("5", "further tax is RE-DERIVED from the new subtotal, not carried over",
                  D(full["furtherTaxAmount"]) == Decimal("1500.00"), f"got {full['furtherTaxAmount']}")
            check("5", "and the grand total follows",
                  D(full["grandTotal"]) == Decimal("50000.00") + Decimal("9000.00") + Decimal("1500.00"),
                  f"got {full['grandTotal']}")

        status, cleared = http("PUT", f"/api/invoices/{edit_id}", base, token=token, body={
            "gstRate": 18, "furtherTaxRate": None,
            "items": [{"id": full["items"][0]["id"], "quantity": 50, "unitPrice": 1000,
                       "description": "[TEMP] taxed line", "itemTypeId": type_id}],
        })
        if check("5", "clearing the tax on edit saves", status == 200, f"{status} {err_text(cleared)}"):
            check("5", "the rate is genuinely cleared, not left stuck",
                  cleared.get("furtherTaxRate") is None and D(cleared["furtherTaxAmount"]) == 0,
                  f"rate={cleared.get('furtherTaxRate')} amount={cleared['furtherTaxAmount']}")
            check("5", "and the grand total drops back to two terms",
                  D(cleared["grandTotal"]) == Decimal("59000.00"), f"got {cleared['grandTotal']}")

        # THE TRAP: the narrow Invoices-tab edit rebuilds the total from the
        # subtotal, and used to rebuild it WITHOUT further tax.
        status, narrow_src = make_bill({"furtherTaxRate": 3})
        if check("5", "a bill for the narrow-edit check saves", status in (200, 201),
                 f"{status} {err_text(narrow_src)}"):
            before_total = D(narrow_src["grandTotal"])
            status, narrowed = http("PATCH", f"/api/invoices/{narrow_src['id']}/itemtypes-and-qty",
                                    base, token=token, body={
                                        "items": [{"id": narrow_src["items"][0]["id"],
                                                   "itemTypeId": type_id, "quantity": 100,
                                                   "exactLineTotal": 100000.00}],
                                        "writeMode": "bill"})
            if check("5", "the narrow edit saves", status == 200, f"{status} {err_text(narrowed)}"):
                check("5", "further tax SURVIVES a narrow edit",
                      D(narrowed["furtherTaxAmount"]) == Decimal("3000.00"),
                      f"got {narrowed['furtherTaxAmount']}")
                check("5", "so the grand total is not silently reduced",
                      D(narrowed["grandTotal"]) == before_total,
                      f"{narrowed['grandTotal']} vs {before_total}")

        # ── 6. a credit note carries the rate ────────────────────────────────
        print("\n=== 6. A note reverses what was actually charged ===")
        if not args.db:
            print("  [SKIP] needs --db: a note can only be raised against a bill that was")
            print("         really filed with FBR, and nothing in the API can fake that.")
        else:
            status, src = make_bill({"furtherTaxRate": 3})
            if check("6", "a bill to file and reverse saves", status in (200, 201), f"{status} {err_text(src)}"):
                irn = f"TEMPIRN{stamp}"
                sql(args.db,
                    "UPDATE Invoices SET FbrStatus='Submitted', FbrIRN='" + irn + "', "
                    "FbrSubmittedAt=GETUTCDATE() WHERE Id=" + str(src["id"]))
                status, note = http("POST", "/api/invoices/notes", base, token=token, body={
                    "originalInvoiceId": src["id"], "noteType": 2,
                    "reason": "Return of goods", "partial": False})
                if check("6", "a full credit note against a further-taxed bill saves",
                         status in (200, 201), f"{status} {err_text(note)}"):
                    check("6", "it carries the original's further-tax rate",
                          D(note.get("furtherTaxRate") or 0) == D(src["furtherTaxRate"]),
                          f"got {note.get('furtherTaxRate')} vs {src['furtherTaxRate']}")
                    check("6", "it reverses the same further-tax amount",
                          D(note["furtherTaxAmount"]) == D(src["furtherTaxAmount"]),
                          f"{note['furtherTaxAmount']} vs {src['furtherTaxAmount']}")
                    check("6", "and the same grand total, all three terms",
                          D(note["grandTotal"]) == D(src["grandTotal"]),
                          f"{note['grandTotal']} vs {src['grandTotal']}")

        # ── 7. purchase-side withholding ─────────────────────────────────────
        print("\n=== 7. Withholding on a purchase bill ===")
        if supplier_id:
            def make_purchase(extra: dict | None = None):
                body = {
                    "companyId": company_id, "supplierId": supplier_id, "date": today,
                    "gstRate": 18, "supplierBillNumber": f"SB-{stamp}",
                    "items": [{"itemTypeId": type_id, "description": "[TEMP] bought",
                               "quantity": 100, "uom": "KG", "unitPrice": 1000}],
                }
                body.update(extra or {})
                return http("POST", "/api/purchasebills", base, token=token, body=body)

            status, pb = make_purchase()
            if check("7", "a purchase bill with no withholding saves", status in (200, 201),
                     f"{status} {err_text(pb)}"):
                check("7", "nothing is withheld by default",
                      pb.get("withholdingTaxRate") is None and D(pb["withholdingTaxAmount"]) == 0,
                      f"rate={pb.get('withholdingTaxRate')} amount={pb['withholdingTaxAmount']}")
                check("7", "and the collectible equals the grand total",
                      D(pb["collectible"]) == D(pb["grandTotal"]), f"got {pb['collectible']}")

            status, pbw = make_purchase({"withholdingTaxRate": 4})
            if check("7", "a purchase bill with withholding saves", status in (200, 201),
                     f"{status} {err_text(pbw)}"):
                g = D(pbw["grandTotal"])
                check("7", "the grand total is unchanged", g == SUBTOTAL + GST, f"got {g}")
                check("7", "we owe the supplier less by exactly the withheld amount",
                      D(pbw["collectible"]) == g - D(pbw["withholdingTaxAmount"]),
                      f"{pbw['collectible']} vs {g} - {pbw['withholdingTaxAmount']}")
                check("7", "and the balance due follows the collectible",
                      D(pbw["balanceDue"]) == D(pbw["collectible"]), f"got {pbw['balanceDue']}")

        # ── 8. the client is not trusted ─────────────────────────────────────
        print("\n=== 8. The server works the amounts out for itself ===")
        # There is no furtherTaxAmount on the write DTO at all, so a client
        # sending one is ignored rather than believed.
        status, forged = make_bill({"furtherTaxRate": 3, "furtherTaxAmount": 999999,
                                    "grandTotal": 1, "subtotal": 1, "gstAmount": 1})
        if check("8", "a payload carrying forged totals is accepted", status in (200, 201),
                 f"{status} {err_text(forged)}"):
            check("8", "the forged further-tax amount is ignored",
                  D(forged["furtherTaxAmount"]) == Decimal("3000.00"), f"got {forged['furtherTaxAmount']}")
            check("8", "the forged subtotal is ignored",
                  D(forged["subtotal"]) == SUBTOTAL, f"got {forged['subtotal']}")
            check("8", "and the grand total is the server's own arithmetic",
                  D(forged["grandTotal"]) == SUBTOTAL + GST + Decimal("3000.00"),
                  f"got {forged['grandTotal']}")

    finally:
        print("\n=== Cleanup ===")
        if company_id:
            status, _ = http("DELETE", f"/api/companies/{company_id}", base, token=token)
            check("cleanup", "throwaway company deleted", status in (200, 204), f"got {status}")
        if type_id:
            status, _ = http("DELETE", f"/api/itemtypes/{type_id}", base, token=token)
            check("cleanup", "throwaway item type removed with company", status in (200, 204, 404), f"got {status}")

    print()
    print("=" * 78)
    if FAIL:
        print(f"  {PASS} passed, {FAIL} FAILED")
        for f in FAILURES:
            print(f"   - {f}")
        print("=" * 78)
        return 1
    print(f"  DOCUMENT TAXES SUITE PASSED - {PASS}/{PASS} checks")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
