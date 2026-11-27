"""
Site, PO number and PO date on a standalone (no-challan) bill.

A challan-linked bill takes its site and PO from its challans. A standalone bill
has no challan, so it keeps its own, set on the bill form and changed on Edit:

  1. a standalone bill created with a site and a PO keeps them, and both prints
     (Bill and Sales Tax Invoice) show the site
  2. editing changes site, PO number and PO date; leaving them out of the edit
     leaves them alone; a blank PO number clears the PO date with it
  3. a bill billed from a challan takes the challan's site, and refuses a site or
     PO of its own

Local database only. A throwaway company, removed at the end.

Usage:
  python scripts/test_standalone_bill_site.py --base http://localhost:5135
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_custom_bill_number as b  # noqa: E402  (its helpers; its suites do not run)

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" -- {detail}"))
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://localhost:5135")
    ap.add_argument("--admin-user", default="admin")
    ap.add_argument("--admin-pw", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()
    base = args.base

    print("=== Setup ===")
    token, company, client, item_type = b.setup(base, args.admin_user, args.admin_pw, "SITE-")
    st, _ = b.http("PUT", f"/api/clients/{client['id']}", base, token=token, body={
        **client, "site": "Plant F-319 ; Head Office"})

    def get(inv_id):
        return b.http("GET", f"/api/invoices/{inv_id}", base, token=token)[1] or {}

    def prints(inv_id):
        _, bill = b.http("GET", f"/api/invoices/{inv_id}/print/bill", base, token=token)
        _, tax = b.http("GET", f"/api/invoices/{inv_id}/print/tax-invoice", base, token=token)
        return bill or {}, tax or {}

    def edit(invoice, **extra):
        body = {
            "gstRate": invoice.get("gstRate", 18),
            "items": [{
                "id": it["id"], "description": it.get("description") or "", "quantity": it["quantity"],
                "unitPrice": it["unitPrice"], "itemTypeId": it.get("itemTypeId"), "uom": it.get("uom"),
                "hsCode": it.get("hsCode"), "saleType": it.get("saleType"),
            } for it in invoice.get("items", [])],
        }
        body.update(extra)
        return b.http("PUT", f"/api/invoices/{invoice['id']}", base, token=token, body=body)

    try:
        print("\n=== 1. Created with a site and a PO ===")
        line = {"description": "Widget", "quantity": 1, "uom": (item_type or {}).get("uom") or "Pcs", "unitPrice": 100}
        st, inv = b.http("POST", "/api/invoices/standalone", base, token=token, body={
            "date": b.TODAY, "companyId": company["id"], "clientId": client["id"], "gstRate": 18,
            "items": [line], "site": "  Plant F-319 ", "poNumber": "PO-555", "poDate": "2026-08-31T00:00:00"})
        if not check("a standalone bill saves with a site and a PO", st in (200, 201), f"{st} {inv}"):
            return report()
        got = get(inv["id"])
        check("it keeps the site, trimmed", got.get("site") == "Plant F-319", f"site={got.get('site')!r}")
        check("and the PO number and date", got.get("poNumber") == "PO-555" and str(got.get("poDate", "")).startswith("2026-08-31"),
              f"po={got.get('poNumber')!r} date={got.get('poDate')!r}")
        bill, tax = prints(inv["id"])
        check("the Bill print shows the site", bill.get("site") == "Plant F-319", f"{bill.get('site')!r}")
        check("the Sales Tax Invoice print shows the site", tax.get("site") == "Plant F-319", f"{tax.get('site')!r}")

        print("\n=== 2. Edited ===")
        st, out = edit(got, site="Head Office", poNumber="PO-777", poDate="2026-09-15")
        got = get(inv["id"])
        check("site, PO number and PO date change on Edit",
              st == 200 and got.get("site") == "Head Office" and got.get("poNumber") == "PO-777"
              and str(got.get("poDate", "")).startswith("2026-09-15"), f"{st} {got.get('site')} {got.get('poNumber')} {got.get('poDate')}")
        st, out = edit(got)
        got = get(inv["id"])
        check("an edit that leaves them out leaves them alone",
              st == 200 and got.get("site") == "Head Office" and got.get("poNumber") == "PO-777", f"{st} {got.get('site')} {got.get('poNumber')}")
        st, out = edit(got, site="", poNumber="", poDate="2026-09-15")
        got = get(inv["id"])
        check("blank clears the site, the PO number and its date",
              st == 200 and not got.get("site") and not got.get("poNumber") and not got.get("poDate"),
              f"{st} {got.get('site')!r} {got.get('poNumber')!r} {got.get('poDate')!r}")

        print("\n=== 3. A challan-linked bill takes the challan's site ===")
        st, dc = b.http("POST", f"/api/deliverychallans/company/{company['id']}", base, token=token, body={
            "companyId": company["id"], "clientId": client["id"], "deliveryDate": b.TODAY, "poNumber": "PO-DC-1",
            "site": "Plant F-319",
            "items": [{"description": "Hardware Item A", "quantity": 2, "unit": "Pcs",
                       **({"itemTypeId": item_type["id"]} if item_type else {})}]})
        if check("a challan with a site is created", st in (200, 201), f"{st} {dc}"):
            st, linked = b.http("POST", "/api/invoices", base, token=token, body={
                "date": b.TODAY, "companyId": company["id"], "clientId": client["id"], "gstRate": 18,
                "challanIds": [dc["id"]], "items": [{"deliveryItemId": dc["items"][0]["id"], "unitPrice": 50,
                                                     "description": "Hardware Item A"}]})
            if check("it is billed", st in (200, 201), f"{st} {linked}"):
                got = get(linked["id"])
                check("the bill shows the challan's site", got.get("site") == "Plant F-319", f"{got.get('site')!r}")
                st, out = edit(got, site="Head Office")
                check("a site of its own is refused", st == 400 and "challan" in b.err_text(out).lower(), f"{st} {out}")
                st, out = edit(got, poNumber="PO-X")
                check("a PO of its own is refused", st == 400 and "challan" in b.err_text(out).lower(), f"{st} {out}")
    finally:
        if not args.keep:
            st, _ = b.http("DELETE", f"/api/companies/{company['id']}", base, token=token)
            print(f"\n=== Teardown: delete company {company['id']} -> {st} ===")

    return report()


def report() -> int:
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} standalone bill site checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
