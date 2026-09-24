#!/usr/bin/env python3
"""Billing at the sales tax rate the goods came IN at — regression test.

An importer pays sales tax at the port and customs states the rate on the GD:
18% for ordinary goods, 25% for goods listed in SRO 297(I)/2023, which are also
25% on every later supply. The bill forms opened on the standard-rate scenario,
so goods imported at 25% were billed — and filed — at 18% with nothing on screen
to say otherwise. Helpers/ImportedTaxRate is the rule that now stops it.

What this proves, end to end against a live backend:

  1. The verdict for each item comes from the COMPANY'S OWN records of THAT
     item — opening stock, purchases, GD lines — and nothing else.
  2. Unambiguous evidence ENFORCES: a bill charging another rate is refused on
     create (both paths) and on edit (full and narrow), unless a reason is
     written — and the reason is kept on the bill and audited.
  3. Enforcement is limited to the question the import rate settles —
     standard rate (18%) or SRO 297 (25%). Contradictory evidence (two rates, a
     GD line under another HS code) only ADVISES, and so does a bill under a
     special regime (exempt / zero-rated at 0%, a reduced rate), which the rate
     the goods came in at cannot contradict.
  4. A credit note's return never counts as intake, so a wrong sale cannot
     disarm the check on its own item.
  5. The picker's "imported at this rate" list holds exactly the unambiguous
     items, so a 25% scenario is not left with nothing to bill.
  6. Tenant isolation: another company's records are never evidence. The same
     global item type, in a company that holds no record of it, is simply
     unconstrained — and the endpoints refuse a user without the company.
  7. The bill list carries the same findings the guard enforces.

GD lines have no small API (the GD costing import takes a workbook), so suite 3
seeds them straight into the LOCAL database when --db is given and is skipped
otherwise. Everything else runs through the API.

Creates its own throwaway companies and deletes them again. Local only — never
production.

Usage:
  python scripts/test_imported_tax_rate.py [--base URL] [--db "<local conn>"]
"""
from __future__ import annotations
import argparse, json, sys, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timezone


def http(method, path, base, token=None, body=None, params=None):
    url = base.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except urllib.error.URLError as e:
        return 0, str(e)


PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
results: list[tuple[str, str, str]] = []


def check(name, ok, detail=""):
    results.append((PASS if ok else FAIL, name, detail))
    print(f"  [{PASS if ok else FAIL}] {name}" + (f"  ({detail})" if detail else ""))
    return ok


def skip(name, why):
    results.append((SKIP, name, why))
    print(f"  [{SKIP}] {name}  ({why})")


def err_of(resp):
    if isinstance(resp, dict):
        return str(resp.get("error") or resp.get("message") or resp)
    return str(resp)


def today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")


# Real tariff codes: HS validation is master-first, so an invented code is
# refused and the failure would look like a bug in this feature.
HS_A = "8518.2990"   # opening stock at 25%
HS_B = "8414.5130"   # GD line at 25%, same code on the item
HS_C = "7013.9900"   # purchased at 18%
HS_D = "8509.4010"   # opening at 25% AND purchased at 18% -> mixed
HS_E = "8509.9000"   # GD line under a DIFFERENT code than the item's
HS_E_GD = "8509.8000"
HS_F = "2710.1951"   # no record at all


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--pass", dest="pw", default="admin123")
    ap.add_argument("--db", default=None,
                    help="LOCAL connection string, for the GD-line suite")
    args = ap.parse_args()
    base = args.base

    st, data = http("POST", "/api/auth/login", base, body={"username": args.user, "password": args.pw})
    if st != 200 or not isinstance(data, dict) or "token" not in data:
        print(f"FATAL: admin login failed ({st} {data})")
        return 2
    tok = data["token"]

    def api(method, path, body=None, params=None, token=None):
        return http(method, path, base, token or tok, body, params)

    stamp = datetime.now().strftime("%m%d%H%M%S")
    companies: list[int] = []

    def mk_company(label):
        s, co = api("POST", "/api/companies", {
            "name": f"ZZ Rate {label} {stamp}",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingCreditNoteNumber": 1, "startingDebitNoteNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "fbrEnabled": False, "inventoryTrackingEnabled": True, "enableGl": False,
        })
        assert s in (200, 201), f"company create failed {s} {co}"
        companies.append(co["id"])
        return co["id"]

    try:
        cid = mk_company("A")
        cid_b = mk_company("B")

        s, client = api("POST", "/api/clients", {"companyId": cid, "name": f"ZZ Buyer {stamp}",
                                                 "registrationType": "Unregistered"})
        assert s in (200, 201), f"client {s} {client}"
        s, client_b = api("POST", "/api/clients", {"companyId": cid_b, "name": f"ZZ Buyer B {stamp}",
                                                   "registrationType": "Unregistered"})
        assert s in (200, 201), f"client b {s} {client_b}"
        s, supplier = api("POST", "/api/suppliers", {"companyId": cid, "name": f"ZZ Supplier {stamp}",
                                                     "registrationType": "Unregistered"})
        assert s in (200, 201), f"supplier {s} {supplier}"

        def mk_item(label, hs):
            s, it = api("POST", "/api/itemtypes", {
                "name": f"ZZ {label} {stamp}", "hsCode": hs, "uom": "Pcs",
                "companyId": cid, "isFavorite": True,
            }, params={"companyId": cid})
            assert s in (200, 201), f"item {label} {s} {it}"
            return it["id"]

        A, B, C = mk_item("A-opening25", HS_A), mk_item("B-gd25", HS_B), mk_item("C-bought18", HS_C)
        D, E, F = mk_item("D-mixed", HS_D), mk_item("E-hsconflict", HS_E), mk_item("F-norecord", HS_F)
        names = {A: "A", B: "B", C: "C", D: "D", E: "E", F: "F"}

        def opening(item, rate, qty=100, value=100000):
            s, r = api("POST", "/api/stock/opening", {
                "companyId": cid, "itemTypeId": item, "quantity": qty,
                "valueExcludingTax": value, "salesTaxRate": rate,
                "asOfDate": "2026-07-01", "notes": "rate test"})
            assert s in (200, 201), f"opening {s} {r}"

        def purchase(item, rate, qty=50, price=900):
            s, r = api("POST", "/api/purchasebills", {
                "date": today(), "companyId": cid, "supplierId": supplier["id"], "gstRate": rate,
                "items": [{"itemTypeId": item, "description": f"ZZ {names[item]}",
                           "quantity": qty, "unit": "Pcs", "unitPrice": price}]})
            assert s in (200, 201), f"purchase {s} {r}"

        opening(A, 25)
        opening(D, 25)
        purchase(C, 18)
        purchase(D, 18)

        gd_ok = False
        if args.db:
            try:
                import pyodbc
                cn = pyodbc.connect(args.db, timeout=30, autocommit=True)
                cur = cn.cursor()
                cur.execute("""
                    INSERT INTO ImportConsignments
                      (CompanyId, GdNumber, GdDate, TotalCostExcludingTax, TotalInputTax, TotalIncomeTax,
                       TotalSellingValue, Mode, Notes, CreatedAt, ImportClearingCredited, AmountSettled)
                    OUTPUT INSERTED.Id
                    VALUES (?, ?, ?, 0, 0, 0, 0, 'backfill', 'rate test', SYSUTCDATETIME(), 0, 0)""",
                            cid, f"ZZ-GD-{stamp}", "2026-08-11")
                gd_id = cur.fetchone()[0]
                for row, hs, rate, item in ((1, HS_B, 25, B), (2, HS_E_GD, 25, E)):
                    cur.execute("""
                        INSERT INTO ImportConsignmentLines
                          (ImportConsignmentId, SourceRow, DescriptionOnSheet, HsCode, Quantity, Unit,
                           AssessedValue, CustomsDuty, Acd, RegulatoryDuty, Others, SalesTaxRate, AstRate,
                           IncomeTaxRate, AddOnProfit, CostExcludingTax, SellingValueExcludingTax,
                           Disposition, ItemTypeId, CreatedAt)
                        VALUES (?, ?, ?, ?, 10, 'Pcs', 0, 0, 0, 0, 0, ?, 0, 0, 0, 0, 0, 0, ?, SYSUTCDATETIME())""",
                                gd_id, row, f"ZZ line {row}", hs, rate, item)
                gd_ok = True
            except Exception as e:
                print(f"  (GD fixture could not be written: {str(e)[:160]})")

        # ══ Suite 1 — each item's verdict ════════════════════════════════════
        print("\n-- Suite 1: what the company's own records say --")
        ids = ",".join(str(x) for x in (A, B, C, D, E, F))
        s, rows = api("GET", f"/api/invoices/company/{cid}/imported-tax-rates",
                      params={"itemTypeIds": ids, "billRate": 18})
        check("the endpoint answers", s == 200, str(s))
        v = {r["itemTypeId"]: r for r in (rows or [])} if s == 200 else {}

        check("A: opening stock at 25% -> 25%", v.get(A, {}).get("rate") == 25, str(v.get(A)))
        check("A: cites the opening stock", "opening" in (v.get(A, {}).get("source") or ""), str(v.get(A, {}).get("source")))
        check("C: purchased at 18% -> 18%", v.get(C, {}).get("rate") == 18, str(v.get(C)))
        check("D: 25% opening + 18% purchase is mixed",
              v.get(D, {}).get("mixed") is True and sorted(v.get(D, {}).get("rates") or []) == [18, 25],
              str(v.get(D)))
        check("F: no record -> no rate", v.get(F, {}).get("rate") is None and not v.get(F, {}).get("mixed"),
              str(v.get(F)))
        if gd_ok:
            check("B: GD line at 25% under the item's own code -> 25%", v.get(B, {}).get("rate") == 25, str(v.get(B)))
            check("B: cites the GD by number and date",
                  f"ZZ-GD-{stamp}" in (v.get(B, {}).get("source") or "") and "11-08-2026" in (v.get(B, {}).get("source") or ""),
                  str(v.get(B, {}).get("source")))
            check("E: a GD line under ANOTHER code is set aside", v.get(E, {}).get("rate") is None, str(v.get(E)))
            check("E: ...and named as an HS conflict", HS_E_GD in (v.get(E, {}).get("hsConflict") or ""),
                  str(v.get(E, {}).get("hsConflict")))
        else:
            for n in ("B: GD line -> 25%", "B: cites the GD", "E: other code set aside", "E: named as HS conflict"):
                skip(n, "needs --db")

        # ══ Suite 2 — findings against the bill's rate ═══════════════════════
        print("\n-- Suite 2: findings against the rate the bill charges --")
        def warning(rate, item):
            s, rr = api("GET", f"/api/invoices/company/{cid}/imported-tax-rates",
                        params={"itemTypeIds": str(item), "billRate": rate})
            row = (rr or [{}])[0] if s == 200 and rr else {}
            return row.get("warning")

        w = warning(18, A)
        check("A at 18% is ENFORCED", bool(w) and w.get("enforce") is True, str(w))
        check("...and names 25%, the source and SN024",
              bool(w) and "25%" in w["message"] and "SN024" in w["message"], w["message"] if w else "")
        check("A at 25% has nothing to say", warning(25, A) is None)
        check("C at 18% has nothing to say", warning(18, C) is None)
        w = warning(25, C)
        check("C at 25% is ENFORCED (18% goods on a 25% bill)", bool(w) and w.get("enforce") is True, str(w))
        w = warning(18, D)
        check("D (mixed) at 18% only ADVISES", bool(w) and w.get("enforce") is False, str(w))
        w = warning(25, D)
        check("D (mixed) at 25% only ADVISES", bool(w) and w.get("enforce") is False, str(w))
        w = warning(5, D)
        check("D (mixed) at 5% only ADVISES — mixed records never refuse",
              bool(w) and w.get("enforce") is False, str(w))
        # A special regime is chosen for the TRANSACTION (goods imported at 18%
        # are zero-rated when exported); the import rate cannot contradict it.
        w = warning(0, A)
        check("A (25%) on an exempt / zero-rated 0% bill only ADVISES", bool(w) and w.get("enforce") is False, str(w))
        w = warning(0, C)
        check("C (18%) on a 0% bill only ADVISES", bool(w) and w.get("enforce") is False, str(w))
        w = warning(5, C)
        check("C (18%) on a 5% reduced-rate bill only ADVISES", bool(w) and w.get("enforce") is False, str(w))
        check("F has nothing to say at any rate", warning(18, F) is None and warning(25, F) is None)
        if gd_ok:
            w = warning(18, E)
            check("E (HS conflict) never enforces", w is None or w.get("enforce") is False, str(w))

        # ══ Suite 3 — the save guard ═════════════════════════════════════════
        print("\n-- Suite 3: create and edit refuse without a reason --")
        def standalone(item, rate, reason=None, company=None, buyer=None):
            body = {"companyId": company or cid, "clientId": (buyer or client)["id"], "date": today(),
                    "gstRate": rate,
                    "items": [{"description": f"ZZ {names.get(item, item)}", "quantity": 1, "unitPrice": 1000,
                               "UOM": "Pcs", "itemTypeId": item}]}
            if reason is not None:
                body["taxRateOverrideReason"] = reason
            return api("POST", "/api/invoices/standalone", body)

        s, r = standalone(A, 18)
        check("a standalone bill at 18% with 25% goods is refused", s == 400, f"{s} {err_of(r)[:90]}")
        check("...naming the rate the goods came in at", "25%" in err_of(r), err_of(r)[:140])

        s, ok_bill = standalone(A, 18, reason="Tax adviser confirmed this lot is parts")
        check("with a reason it saves", s in (200, 201), f"{s} {err_of(ok_bill)[:90]}")
        if s in (200, 201):
            check("the reason is kept on the bill",
                  ok_bill.get("taxRateOverrideReason") == "Tax adviser confirmed this lot is parts",
                  str(ok_bill.get("taxRateOverrideReason")))
            check("the bill reports the finding it overrode",
                  any(x.get("enforce") for x in ok_bill.get("taxRateWarnings") or []),
                  str(ok_bill.get("taxRateWarnings")))

        s, clean = standalone(A, 25)
        check("the same goods at 25% save with no reason", s in (200, 201), f"{s} {err_of(clean)[:90]}")
        if s in (200, 201):
            check("...carry no warning", not clean.get("taxRateWarnings"), str(clean.get("taxRateWarnings")))
            check("...and no reason", clean.get("taxRateOverrideReason") is None)

        s, r = standalone(D, 18)
        check("mixed goods at 18% save without a reason (advisory)", s in (200, 201), f"{s} {err_of(r)[:90]}")
        s, r = standalone(D, 5)
        check("mixed goods at 5% save (advisory)", s in (200, 201), f"{s} {err_of(r)[:90]}")
        s, r = standalone(A, 0)
        check("25% goods on a 0% (exempt / zero-rated) bill save without a reason",
              s in (200, 201), f"{s} {err_of(r)[:90]}")
        if s in (200, 201):
            check("...and carry the advisory for review",
                  any(not x.get("enforce") for x in r.get("taxRateWarnings") or []),
                  str(r.get("taxRateWarnings")))
        s, r = standalone(C, 18)
        check("18% goods at 18% save", s in (200, 201), f"{s} {err_of(r)[:90]}")
        c_bill = r if s in (200, 201) else None
        s, r = standalone(F, 25)
        check("goods with no record save at any rate", s in (200, 201), f"{s} {err_of(r)[:90]}")

        # The challan path.
        s, dc = api("POST", f"/api/deliverychallans/company/{cid}", {
            "companyId": cid, "clientId": client["id"], "deliveryDate": today(), "poNumber": f"PO-{stamp}",
            "items": [{"description": "ZZ A", "quantity": 1, "unit": "Pcs", "itemTypeId": A}]})
        if check("a challan carrying 25% goods is raised", s in (200, 201), f"{s} {err_of(dc)[:90]}"):
            s, r = api("POST", "/api/invoices", {
                "companyId": cid, "clientId": client["id"], "date": today(), "gstRate": 18,
                "challanIds": [dc["id"]],
                "items": [{"deliveryItemId": dc["items"][0]["id"], "unitPrice": 1000,
                           "description": "ZZ A", "itemTypeId": A}]})
            check("a bill from that challan at 18% is refused too", s == 400, f"{s} {err_of(r)[:90]}")

        # Edits.
        if ok_bill and isinstance(ok_bill, dict) and ok_bill.get("id"):
            bid = ok_bill["id"]
            def full_edit(rate, reason="__absent__"):
                body = {"gstRate": rate, "items": [
                    {"id": it["id"], "description": it["description"], "quantity": it["quantity"],
                     "unitPrice": it["unitPrice"], "uom": it.get("uom") or "Pcs",
                     "itemTypeId": it.get("itemTypeId")} for it in ok_bill["items"]]}
                if reason != "__absent__":
                    body["taxRateOverrideReason"] = reason
                return api("PUT", f"/api/invoices/{bid}", body)

            s, r = full_edit(18)
            check("re-saving an overridden bill without mentioning the reason keeps it",
                  s == 200 and r.get("taxRateOverrideReason") == "Tax adviser confirmed this lot is parts",
                  f"{s} {err_of(r)[:90] if s != 200 else r.get('taxRateOverrideReason')}")
            s, r = full_edit(18, "")
            check("clearing the reason while the rates still disagree is refused", s == 400, f"{s} {err_of(r)[:90]}")
            s, r = full_edit(25)
            check("moving the bill to 25% saves", s == 200, f"{s} {err_of(r)[:90]}")
            if s == 200:
                check("...and the reason, no longer needed, is cleared",
                      r.get("taxRateOverrideReason") is None, str(r.get("taxRateOverrideReason")))

        if c_bill:
            # The narrow Invoices-tab edit reclassifying an 18% line onto 25% goods.
            s, r = api("PATCH", f"/api/invoices/{c_bill['id']}/itemtypes", {
                "items": [{"id": c_bill["items"][0]["id"], "itemTypeId": A}]})
            check("reclassifying an 18% line onto 25% goods is refused", s == 400, f"{s} {err_of(r)[:90]}")
            s, r = api("PATCH", f"/api/invoices/{c_bill['id']}/itemtypes", {
                "items": [{"id": c_bill["items"][0]["id"], "itemTypeId": A}],
                "taxRateOverrideReason": "Reclassified on the adviser's instruction"})
            check("...and allowed with a reason", s == 200, f"{s} {err_of(r)[:90]}")

        # The audit trail.
        # The audit search covers path, message and user name (not the audit code),
        # and the message carries the reason the operator wrote — so search for it.
        s, logs = api("GET", "/api/auditlogs",
                      params={"page": 1, "pageSize": 50, "search": "Tax adviser confirmed this lot is parts"})
        rows_ = (logs or {}).get("items") if isinstance(logs, dict) else logs
        found = any("TAX_RATE_OVERRIDE_V1" in json.dumps(x) and "Tax adviser confirmed" in json.dumps(x)
                    for x in (rows_ or []))
        check("an override is written to the audit log with its reason", found,
              f"{s}, {len(rows_ or [])} rows")

        # ══ Suite 4 — a credit note never counts as intake ═══════════════════
        print("\n-- Suite 4: returns do not become evidence --")
        s, before = api("GET", f"/api/invoices/company/{cid}/imported-tax-rates",
                        params={"itemTypeIds": str(A), "billRate": 18})
        rates_before = (before or [{}])[0].get("rates") if s == 200 and before else None
        # An overridden 18% sale of A, then credited in full: its stock comes back
        # IN on the sale side, and must not add 18% to A's record.
        s, sale = standalone(A, 18, reason="Credit-note test sale")
        if s in (200, 201):
            s2, note = api("POST", f"/api/invoices/{sale['id']}/reverse",
                           {"reason": "Return", "documentType": 10})
            if s2 in (200, 201):
                s3, after = api("GET", f"/api/invoices/company/{cid}/imported-tax-rates",
                                params={"itemTypeIds": str(A), "billRate": 18})
                rates_after = (after or [{}])[0].get("rates") if s3 == 200 and after else None
                check("A's record is unchanged by a sale and its return",
                      rates_before == rates_after == [25], f"before={rates_before} after={rates_after}")
            else:
                # A skip, not a pass: a check that could not run proves nothing.
                skip("A's record is unchanged by a sale and its return",
                     f"could not raise the credit note: {s2} {err_of(note)[:80]}")
        else:
            skip("A's record is unchanged by a sale and its return", f"could not raise the sale: {s}")

        # ══ Suite 5 — the picker's list ══════════════════════════════════════
        print("\n-- Suite 5: items imported at a rate --")
        s, at25 = api("GET", f"/api/invoices/company/{cid}/imported-tax-rates/items", params={"rate": 25})
        at25 = set(at25 or []) if s == 200 else set()
        check("A is listed at 25%", A in at25, str(sorted(at25)))
        check("mixed D is not", D not in at25)
        check("C (18%) and F (none) are not", C not in at25 and F not in at25)
        if gd_ok:
            check("B (GD 25%) is listed", B in at25)
            check("E (HS conflict) is not", E not in at25)
        s, at18 = api("GET", f"/api/invoices/company/{cid}/imported-tax-rates/items", params={"rate": 18})
        check("C is listed at 18%", s == 200 and C in (at18 or []), str(at18))

        # ══ Suite 6 — tenant isolation ═══════════════════════════════════════
        print("\n-- Suite 6: another company's records are never evidence --")
        s, rows_b = api("GET", f"/api/invoices/company/{cid_b}/imported-tax-rates",
                        params={"itemTypeIds": f"{A},{B}", "billRate": 18})
        vb = {r["itemTypeId"]: r for r in (rows_b or [])} if s == 200 else {}
        check("company B holds no record of A, whatever company A says",
              s == 200 and vb.get(A, {}).get("rate") is None and not vb.get(A, {}).get("warning"), str(vb.get(A)))
        s, r = standalone(A, 18, company=cid_b, buyer=client_b)
        check("company B bills the same item at 18% unhindered", s in (200, 201), f"{s} {err_of(r)[:90]}")
        s, at25_b = api("GET", f"/api/invoices/company/{cid_b}/imported-tax-rates/items", params={"rate": 25})
        check("company B's 25% list does not include company A's goods",
              s == 200 and A not in (at25_b or []), str(at25_b))

        # A user who can reach company B only. They hold the Administrator ROLE,
        # so no permission is what refuses them — only the tenant guard can.
        uname = f"zzrate{stamp}"
        s, roles = api("GET", "/api/roles")
        role_id = next((r["id"] for r in (roles or []) if r.get("name") == "Administrator"), None)
        s, user = api("POST", "/api/users", {"username": uname, "password": "Rate-test-123!",
                                             "fullName": "ZZ Rate User", "role": "Administrator"})
        user_id = user.get("id") if isinstance(user, dict) else None
        if role_id and user_id:
            api("PUT", f"/api/users/{user_id}/roles", {"roleIds": [role_id]})
            api("PUT", f"/api/usercompanies/user/{user_id}", {"companyIds": [cid_b]})
            s, ud = http("POST", "/api/auth/login", base, body={"username": uname, "password": "Rate-test-123!"})
            utok = ud.get("token") if isinstance(ud, dict) else None
            if utok:
                s1, _ = http("GET", f"/api/invoices/company/{cid}/imported-tax-rates", base, utok,
                             params={"itemTypeIds": str(A), "billRate": 18})
                s2, _ = http("GET", f"/api/invoices/company/{cid}/imported-tax-rates/items", base, utok,
                             params={"rate": 25})
                s3, _ = http("GET", f"/api/invoices/company/{cid_b}/imported-tax-rates", base, utok,
                             params={"itemTypeIds": str(A), "billRate": 18})
                check("a user without company A cannot read its rates", s1 == 403, str(s1))
                check("...nor its imported-at list", s2 == 403, str(s2))
                check("...but reads their own company's", s3 == 200, str(s3))
            else:
                skip("cross-company 403", f"test user could not log in: {s}")
            api("DELETE", f"/api/users/{user_id}")
        else:
            skip("cross-company 403", f"could not create the test user ({role_id} / {user})")

        # ══ Suite 7 — the bill list ══════════════════════════════════════════
        print("\n-- Suite 7: the bill list shows what the guard enforces --")
        s, page = api("GET", f"/api/invoices/company/{cid}/paged", params={"page": 1, "pageSize": 50})
        items = (page or {}).get("items", []) if isinstance(page, dict) else []
        flagged = [i for i in items if any(w.get("enforce") for w in i.get("taxRateWarnings") or [])]
        check("overridden bills are flagged in the list", len(flagged) >= 1, f"{len(flagged)} of {len(items)}")
        check("every flagged bill carries its reason",
              all((i.get("taxRateOverrideReason") or "").strip() for i in flagged), "")

    finally:
        for c in companies:
            http("DELETE", f"/api/companies/{c}", base, tok)

    failed = [r for r in results if r[0] == FAIL]
    skipped = [r for r in results if r[0] == SKIP]
    passed = len(results) - len(failed) - len(skipped)
    print(f"\n=== {passed}/{passed + len(failed)} checks passed"
          + (f" ({len(skipped)} skipped)" if skipped else "") + " ===")
    if failed:
        print("\nFAILURES:")
        for _, n, d in failed:
            print(f"  - {n}  ({d})")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
