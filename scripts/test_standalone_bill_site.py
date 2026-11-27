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
  4. a new site typed on a standalone bill joins the customer's site list (create
     and edit), a known one is not added twice, and a user who may not edit
     customers keeps the site on the bill but leaves the customer alone
  5. the same on every other document that takes a customer site: challan
     (create and edit), sales order (create and edit), challan from an order

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

        print("\n=== 4. A new site joins the customer's sites ===")

        def client_sites():
            _, c = b.http("GET", f"/api/clients/{client['id']}", base, token=token)
            return [s.strip() for s in ((c or {}).get("site") or "").split(";") if s.strip()]

        def standalone(tok, site):
            return b.http("POST", "/api/invoices/standalone", base, token=tok, body={
                "date": b.TODAY, "companyId": company["id"], "clientId": client["id"], "gstRate": 18,
                "items": [line], "site": site})

        st, nb = standalone(token, "Warehouse 9")
        check("a bill with a new site saves", st in (200, 201), f"{st} {nb}")
        check("the new site is added to the customer's sites",
              client_sites() == ["Plant F-319", "Head Office", "Warehouse 9"], f"{client_sites()}")
        st, _ = standalone(token, "  warehouse 9 ")
        check("a site the customer already has is not added again",
              st in (200, 201) and client_sites() == ["Plant F-319", "Head Office", "Warehouse 9"], f"{st} {client_sites()}")
        st, _ = edit(get(nb["id"]), site="Gate 2")
        check("a new site typed on Edit is added too",
              st == 200 and client_sites()[-1] == "Gate 2", f"{st} {client_sites()}")

        print("\n=== 5. Challans and sales orders remember a new site too ===")
        item = {"description": "Site item", "quantity": 1, "unit": "Pcs",
                **({"itemTypeId": item_type["id"]} if item_type else {})}
        st, dc2 = b.http("POST", f"/api/deliverychallans/company/{company['id']}", base, token=token, body={
            "companyId": company["id"], "clientId": client["id"], "deliveryDate": b.TODAY, "poNumber": "PO-S5",
            "site": "Challan Site A", "items": [item]})
        check("a challan with a new site saves", st in (200, 201), f"{st} {dc2}")
        check("the challan's new site joins the customer's sites", "Challan Site A" in client_sites(), f"{client_sites()}")
        if st in (200, 201):
            _, full = b.http("GET", f"/api/deliverychallans/{dc2['id']}", base, token=token)
            st, _ = b.http("PUT", f"/api/deliverychallans/{dc2['id']}", base, token=token, body={**full, "site": "Challan Site B"})
            check("a new site typed on challan Edit joins too", st == 200 and "Challan Site B" in client_sites(), f"{st} {client_sites()}")
        st, so = b.http("POST", f"/api/salesorders/company/{company['id']}", base, token=token, body={
            "clientId": client["id"], "orderDate": b.TODAY, "site": "Order Site A",
            "items": [{"description": "Order item", "quantity": 2, "unit": "Pcs", "unitPrice": 100}]})
        check("a sales order with a new site saves", st in (200, 201), f"{st} {so}")
        check("the order's new site joins the customer's sites", "Order Site A" in client_sites(), f"{client_sites()}")
        if st in (200, 201):
            _, full = b.http("GET", f"/api/salesorders/{so['id']}", base, token=token)
            st, _ = b.http("PUT", f"/api/salesorders/{so['id']}", base, token=token, body={**full, "site": "Order Site B"})
            check("a new site typed on sales order Edit joins too", st == 200 and "Order Site B" in client_sites(), f"{st} {client_sites()}")
            st, ch = b.http("POST", f"/api/salesorders/{so['id']}/create-challan", base, token=token, body={
                "deliveryDate": b.TODAY, "site": "From Order Site",
                "lines": [{"salesOrderItemId": full["items"][0]["id"], "quantity": 1}]})
            check("a challan made from the order with a new site joins too",
                  st == 200 and "From Order Site" in client_sites(), f"{st} {ch} {client_sites()}")

        # A user who may raise and edit bills but not edit customers.
        before = client_sites()
        st, role = b.http("POST", "/api/roles", base, token=token, body={
            "name": f"_site_biller_{company['id']}", "description": "temp - bills only",
            "permissionKeys": ["bills.list.view", "bills.manage.create.standalone", "bills.manage.update"]})
        uname = f"sitebiller{company['id']}"
        st_u, user = b.http("POST", "/api/users", base, token=token, body={
            "username": uname, "fullName": uname, "password": "Passw0rd!23", "role": "User"})
        try:
            sc, copies = b.http("POST", f"/api/roles/{role['id']}/copy", base, token=token,
                                body={"tenantAdminUserIds": [user["id"]]})
            use_role = copies[0] if sc == 200 and copies else role
            b.http("PUT", f"/api/users/{user['id']}/roles", base, token=token, body={"roleIds": [use_role["id"]]})
            b.http("PUT", f"/api/usercompanies/user/{user['id']}", base, token=token, body={"companyIds": [company["id"]]})
            _, login = b.http("POST", "/api/auth/login", base, body={"username": uname, "password": "Passw0rd!23"})
            st, own = standalone((login or {}).get("token"), "Dock 4")
            check("a bills-only user saves a bill with a new site", st in (200, 201), f"{st} {own}")
            check("the bill keeps it", st in (200, 201) and get(own["id"]).get("site") == "Dock 4", f"{own}")
            check("but the customer's sites are left alone", client_sites() == before, f"{before} -> {client_sites()}")
        finally:
            if isinstance(user, dict) and user.get("id"):
                b.http("DELETE", f"/api/users/{user['id']}", base, token=token)
            for r in [role] + (copies if 'copies' in dir() and isinstance(copies, list) else []):
                if isinstance(r, dict) and r.get("id"):
                    b.http("DELETE", f"/api/roles/{r['id']}", base, token=token)
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
