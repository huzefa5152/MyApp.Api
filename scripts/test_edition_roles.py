#!/usr/bin/env python3
"""
Product editions (2026-09-19) - the Trader build is sold two ways.

"Sales Edition" is the whole sales, purchase, inventory and FBR product,
including receipts and payments. "Complete Edition" adds the accounting module:
chart of accounts, general ledger, manual journals, accounting reports and
customer portals. Both are seeded as SYSTEM roles, so a tenant is put on an
edition by assigning one role.

An edition is only worth the name if it holds under pressure, so this pins the
things that would quietly turn it back into a suggestion:

  1. both editions exist, are system roles, and carry their description;
  2. their key sets are exactly what the live catalog implies - derived here
     from GET /api/permissions and the same two rules the server uses, so this
     is a cross-check and not a restatement of a constant;
  3. receipts, payments and payment status are in the SALES edition. They share
     the accounting.* namespace but predate the module and need no ledger; a
     split by catalog Module instead of key prefix would strand them in
     Complete and a Sales tenant could not take a payment;
  4. neither edition carries user / role / tenant-access / audit administration.
     This is the load-bearing one: RolesController accepts any catalog key on a
     role edit, so a tenant holding rbac.roles.update could add the accounting
     keys to their own role and walk straight through the boundary;
  5. an edition cannot be edited or deleted through the API;
  6. a real user on Sales Edition is REFUSED the accounting endpoints and still
     served the sales ones - the boundary proven end to end, not just in the
     role table; and
  7. a real user on Complete Edition reaches the accounting endpoints.

Local only. Creates its own throwaway company and users and deletes them.

    python scripts/test_edition_roles.py --base http://localhost:5104
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

PASS = 0
FAIL = 0
FAILURES: list[str] = []

SALES_EDITION = "Sales Edition"
COMPLETE_EDITION = "Complete Edition"

# Administration of the software itself - excluded from BOTH editions.
VENDOR_ONLY_MODULES = {"RBAC", "Users", "AuditLogs", "Tenant Access"}

# The keys the accounting module added. Receipts / payments / payment status are
# deliberately NOT here - see the docstring.
ACCOUNTING_PREFIXES = (
    "accounting.coa.", "accounting.gl.", "accounting.journal.",
    "accounting.reports.", "customerportals.",
)

PW = "Passw0rd!23"
NL = chr(10)


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


def is_accounting(key: str) -> bool:
    return any(key.startswith(p) for p in ACCOUNTING_PREFIXES)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  PRODUCT EDITIONS")
    print("=" * 78)

    status, d = http("POST", "/api/auth/login", base,
                     body={"username": args.user, "password": args.password})
    if status != 200:
        print(f"[!] login failed: HTTP {status} {d}")
        return 2
    seed = d["token"]

    company = None
    made_users: list[dict] = []
    made_roles: list[dict] = []

    try:
        # -- 1. the editions exist and are system roles ----------------------
        print("\n--- 1. the editions are seeded as system roles ---")
        status, roles = http("GET", "/api/roles", base, token=seed)
        if not check("1", "roles listed", status == 200, f"{status} {err_text(roles)}"):
            return 1
        by_name = {r["name"]: r for r in roles}

        sales = by_name.get(SALES_EDITION)
        complete = by_name.get(COMPLETE_EDITION)
        if not check("1", "Sales Edition is seeded", sales is not None):
            return 1
        if not check("1", "Complete Edition is seeded", complete is not None):
            return 1

        check("1", "Sales Edition is a system role", sales.get("isSystemRole") is True,
              str(sales.get("isSystemRole")))
        check("1", "Complete Edition is a system role", complete.get("isSystemRole") is True,
              str(complete.get("isSystemRole")))
        check("1", "Sales Edition says what it is", bool((sales.get("description") or "").strip()))
        check("1", "Complete Edition says what it is", bool((complete.get("description") or "").strip()))

        # -- 2. the key sets match what the live catalog implies -------------
        print("\n--- 2. the key sets are what the catalog implies ---")
        status, catalog = http("GET", "/api/permissions", base, token=seed)
        if not check("2", "permission catalog read", status == 200, f"{status} {err_text(catalog)}"):
            return 1
        rows = catalog if isinstance(catalog, list) else (catalog or {}).get("items") or []
        check("2", "catalog is populated", len(rows) > 100, f"{len(rows)} rows")

        all_keys = {r["key"] for r in rows}
        module_of = {r["key"]: r.get("module") for r in rows}
        vendor_keys = {k for k in all_keys if module_of.get(k) in VENDOR_ONLY_MODULES}
        accounting_keys = {k for k in all_keys if is_accounting(k)}

        expect_sales = all_keys - vendor_keys - accounting_keys
        expect_complete = all_keys - vendor_keys

        got_sales = set(sales.get("permissionKeys") or [])
        got_complete = set(complete.get("permissionKeys") or [])

        check("2", "Sales Edition holds exactly the non-accounting tenant keys",
              got_sales == expect_sales,
              f"missing={sorted(expect_sales - got_sales)[:6]} extra={sorted(got_sales - expect_sales)[:6]}")
        check("2", "Complete Edition holds exactly the tenant keys",
              got_complete == expect_complete,
              f"missing={sorted(expect_complete - got_complete)[:6]} extra={sorted(got_complete - expect_complete)[:6]}")
        check("2", "Complete is a superset of Sales", got_sales <= got_complete,
              f"sales-only={sorted(got_sales - got_complete)[:6]}")
        check("2", "the difference between the editions IS the accounting module",
              (got_complete - got_sales) == accounting_keys,
              f"diff={sorted(got_complete - got_sales)[:8]}")
        check("2", "the accounting module is a real set, not empty",
              len(accounting_keys) >= 9, f"{len(accounting_keys)} keys")

        # -- 3. receipts and payments stayed in Sales ------------------------
        print("\n--- 3. money in / money out belongs to the Sales edition ---")
        for key in ("accounting.receipts.view", "accounting.receipts.create",
                    "accounting.payments.view", "accounting.payments.create",
                    "accounting.paymentstatus.view"):
            if key in all_keys:
                check("3", f"Sales Edition has {key}", key in got_sales, "missing")
        for key in ("accounting.coa.view", "accounting.gl.view", "accounting.journal.view",
                    "accounting.reports.view", "customerportals.manage.view"):
            if key in all_keys:
                check("3", f"Sales Edition does NOT have {key}", key not in got_sales, "present")

        # -- 4. neither edition administers the software ---------------------
        print("\n--- 4. no edition carries software administration ---")
        for prefix in ("rbac.", "users.", "auditlogs.", "tenantaccess."):
            bad_s = sorted(k for k in got_sales if k.startswith(prefix))
            bad_c = sorted(k for k in got_complete if k.startswith(prefix))
            check("4", f"Sales Edition has no {prefix}* key", not bad_s, str(bad_s[:4]))
            check("4", f"Complete Edition has no {prefix}* key", not bad_c, str(bad_c[:4]))

        # -- 5. an edition cannot be edited or deleted -----------------------
        print("\n--- 5. an edition is not editable ---")
        status, d5 = http("PUT", f"/api/roles/{sales['id']}", base, token=seed,
                          body={"name": SALES_EDITION, "description": "tampered",
                                "permissionKeys": sorted(got_complete)})
        check("5", "editing Sales Edition is refused", status in (400, 403),
              f"got {status} {err_text(d5)}")
        status, d5b = http("DELETE", f"/api/roles/{complete['id']}", base, token=seed)
        check("5", "deleting Complete Edition is refused", status in (400, 403),
              f"got {status} {err_text(d5b)}")

        status, roles_after = http("GET", "/api/roles", base, token=seed)
        after = {r["name"]: r for r in (roles_after or [])}
        check("5", "Sales Edition survived the edit attempt unchanged",
              set(after.get(SALES_EDITION, {}).get("permissionKeys") or []) == got_sales)
        check("5", "Complete Edition survived the delete attempt",
              COMPLETE_EDITION in after)

        # -- 6 & 7. the boundary end to end ----------------------------------
        print("\n--- 6. a Sales tenant is refused the accounting module ---")
        name = "_test_editions"
        status, company = http("POST", "/api/companies", base, token=seed, body={
            "name": name, "brandName": name, "fullAddress": f"{name} HQ",
            "phone": "+92-21-00000000", "ntn": "1234567", "cnic": "1234567890123",
            "strn": "1234567890123", "fbrSellerRegistrationNo": "1234567",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        })
        if not check("6", "throwaway company created", status in (200, 201),
                     f"{status} {err_text(company)}"):
            return 1
        cid = company["id"]

        def make_user(username: str, role: dict) -> str | None:
            s, u = http("POST", "/api/users", base, token=seed, body={
                "username": username, "fullName": username, "password": PW, "role": "User"})
            if not check("6", f"{username} created", s in (200, 201), f"{s} {err_text(u)}"):
                return None
            made_users.append(u)
            s2, d2 = http("PUT", f"/api/users/{u['id']}/roles", base, token=seed,
                          body={"roleIds": [role["id"]]})
            check("6", f"{username} put on {role['name']}", s2 == 200, f"{s2} {err_text(d2)}")
            s3, d3 = http("PUT", f"/api/usercompanies/user/{u['id']}", base, token=seed,
                          body={"companyIds": [cid]})
            check("6", f"{username} granted company access", s3 == 200, f"{s3} {err_text(d3)}")
            s4, d4 = http("POST", "/api/auth/login", base,
                          body={"username": username, "password": PW})
            if not check("6", f"{username} signed in", s4 == 200, f"{s4} {err_text(d4)}"):
                return None
            return d4["token"]

        sales_token = make_user("tempEditionSales", sales)
        complete_token = make_user("tempEditionComplete", complete)
        if not sales_token or not complete_token:
            return 1

        # The accounting module, one endpoint per screen the edition gates.
        accounting_probes = [
            ("chart of accounts", f"/api/accounts/company/{cid}/tree"),
            ("journal entries", f"/api/journal-entries/company/{cid}/paged?page=1&pageSize=5"),
            ("balance sheet", f"/api/accounting/reports/company/{cid}/balance-sheet"),
            ("accounting dashboard", f"/api/accounting/reports/company/{cid}/dashboard"),
            ("customer portals", f"/api/customer-portals?companyId={cid}"),
        ]
        for label, path in accounting_probes:
            s, d6 = http("GET", path, base, token=sales_token)
            check("6", f"Sales tenant is refused {label}", s == 403, f"got {s} {err_text(d6)}")

        # ...and still has the product they bought.
        sales_probes = [
            ("invoices", f"/api/invoices/company/{cid}/paged?page=1&pageSize=5"),
            ("challans", f"/api/deliverychallans/company/{cid}/paged?page=1&pageSize=5"),
            ("receipts", f"/api/payments/receipts/company/{cid}/paged?page=1&pageSize=5"),
            ("payments", f"/api/payments/payments/company/{cid}/paged?page=1&pageSize=5"),
        ]
        for label, path in sales_probes:
            s, d6 = http("GET", path, base, token=sales_token)
            check("6", f"Sales tenant still reaches {label}", s == 200, f"got {s} {err_text(d6)}")

        print("\n--- 7. a Complete tenant reaches the accounting module ---")
        for label, path in accounting_probes:
            s, d7 = http("GET", path, base, token=complete_token)
            check("7", f"Complete tenant reaches {label}", s == 200, f"got {s} {err_text(d7)}")

        print("\n--- 8. no edition can administer users or roles ---")
        for who, tok in (("Sales", sales_token), ("Complete", complete_token)):
            for label, path in (("roles", "/api/roles"), ("users", "/api/users"),
                                ("audit logs", "/api/auditlogs?page=1&pageSize=5")):
                s, d8 = http("GET", path, base, token=tok)
                check("8", f"{who} tenant is refused {label}", s == 403, f"got {s} {err_text(d8)}")

        # -- 9. an administrator cannot grant past their own edition ----------
        # The reason this exists: every SYSTEM role is visible to everyone, so
        # "visible" was never the same as "grantable". An Administrator put on
        # Sales Edition could see Complete Edition in the picker and assign it
        # - to their staff or, via a role of their own making, to themselves.
        # The rule now is that you may only delegate what you hold.
        print(NL + "--- 9. an admin cannot grant beyond the edition they are on ---")
        tenant_admin = by_name.get("Tenant Administrator")
        if check("9", "Tenant Administrator is seeded", tenant_admin is not None):
            check("9", "it carries no product features of its own",
                  not (set(tenant_admin.get("permissionKeys") or []) & accounting_keys),
                  "it holds accounting keys")

            s9, admin_u = http("POST", "/api/users", base, token=seed, body={
                "username": "tempSalesAdmin", "fullName": "Sales edition admin",
                "password": PW, "role": "User"})
            if check("9", "a Sales-edition administrator was created",
                     s9 in (200, 201), f"{s9} {err_text(admin_u)}"):
                made_users.append(admin_u)
                http("PUT", f"/api/users/{admin_u['id']}/roles", base, token=seed,
                     body={"roleIds": [sales["id"], tenant_admin["id"]]})
                http("PUT", f"/api/usercompanies/user/{admin_u['id']}", base, token=seed,
                     body={"companyIds": [cid]})
                s9, t9 = http("POST", "/api/auth/login", base,
                              body={"username": "tempSalesAdmin", "password": PW})
                if check("9", "the administrator signed in", s9 == 200, f"{s9}"):
                    atok = t9["token"]

                    # It can do its job: build a role out of its own keys.
                    s9, ok_role = http("POST", "/api/roles", base, token=atok, body={
                        "name": "_temp_admin_made_role", "description": "temp",
                        "permissionKeys": ["bills.list.view", "accounting.receipts.view"]})
                    if check("9", "it can build a role from keys it holds",
                             s9 in (200, 201), f"{s9} {err_text(ok_role)}"):
                        made_roles.append(ok_role)

                    # It cannot write a key it does not hold into a role.
                    s9, bad = http("POST", "/api/roles", base, token=atok, body={
                        "name": "_temp_escalation", "description": "temp",
                        "permissionKeys": ["bills.list.view", "accounting.coa.view"]})
                    check("9", "it cannot put an accounting key in a role",
                          s9 == 400, f"got {s9} {err_text(bad)}")
                    if s9 in (200, 201) and isinstance(bad, dict) and bad.get("id"):
                        made_roles.append(bad)

                    # Nor grant itself the audit log, which is not tenant-scoped.
                    s9, bad2 = http("POST", "/api/roles", base, token=atok, body={
                        "name": "_temp_escalation2", "description": "temp",
                        "permissionKeys": ["auditlogs.view"]})
                    check("9", "it cannot grant the cross-tenant audit log",
                          s9 == 400, f"got {s9} {err_text(bad2)}")
                    if s9 in (200, 201) and isinstance(bad2, dict) and bad2.get("id"):
                        made_roles.append(bad2)

                    # And cannot assign the other edition to anyone.
                    s9, staff = http("POST", "/api/users", base, token=atok, body={
                        "username": "tempAdminStaff", "fullName": "staff",
                        "password": PW, "role": "User"})
                    if check("9", "it can create a staff account",
                             s9 in (200, 201), f"{s9} {err_text(staff)}"):
                        made_users.append(staff)
                        s9, d9 = http("PUT", f"/api/users/{staff['id']}/roles", base,
                                      token=atok, body={"roleIds": [complete["id"]]})
                        check("9", "it cannot assign Complete Edition to staff",
                              s9 == 400, f"got {s9} {err_text(d9)}")
                        s9, d9 = http("PUT", f"/api/users/{staff['id']}/roles", base,
                                      token=atok, body={"roleIds": [sales["id"]]})
                        check("9", "it CAN assign its own edition to staff",
                              s9 == 200, f"got {s9} {err_text(d9)}")

    finally:
        print("\n--- cleanup ---")
        for u in made_users:
            http("DELETE", f"/api/users/{u['id']}", base, token=seed)
        for r in made_roles:
            http("DELETE", f"/api/roles/{r['id']}", base, token=seed)
        if company:
            http("DELETE", f"/api/companies/{company['id']}", base, token=seed)
        print("  temp users and company removed")

    print("\n" + "=" * 78)
    if FAIL == 0:
        print(f"  EDITION ROLES SUITE PASSED - {PASS}/{PASS} checks")
    else:
        print(f"  EDITION ROLES SUITE FAILED - {FAIL} of {PASS + FAIL} checks")
        for f in FAILURES:
            print(f"    - {f}")
    print("=" * 78)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
