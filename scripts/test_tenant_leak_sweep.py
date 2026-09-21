#!/usr/bin/env python3
"""
Cross-tenant leak sweep (2026-09-21) - run BOTH editions against a company they
were never given.

`test_tenant_isolation.py` proves the rule on the endpoints it knows about.
This asks a blunter question, of the product as it is actually sold: put a real
user on Sales Edition and another on Complete Edition, give each access to
company A and nothing else, then point every company-scoped read at company B
and see what comes back. Anything other than 403 is a leak, whatever the screen
was meant to do.

It also probes the OTHER shape of the same bug - an id in the path. An endpoint
that resolves a row by id and returns it without checking whose company that row
belongs to leaks just as completely, and no amount of companyId guarding on the
list endpoint helps.

What this caught the day it was written:

  * GET /api/itemtypes?companyId=B returned company B's ON-HAND STOCK per item.
    No [HasPermission] at all, so any authenticated user of any tenant could
    read it. The branch beside it scoped correctly to the caller's own set,
    which is what made it survive review.
  * GET /api/poformats with no companyId listed EVERY tenant's PO formats, and
    the row carries CompanyName and ClientName - so the cheapest possible
    request handed over other tenants' company and customer names.
  * GET /api/poformats/{id} resolved any id for anyone.
  * ItemTypes create/update took a companyId that chooses whose FBR token calls
    PRAL, unchecked - one tenant's bearer spending another's quota.

Local only. Creates two throwaway companies and two users, and deletes them.

    python scripts/test_tenant_leak_sweep.py --base http://localhost:5104
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
PW = "Passw0rd!23"
NL = chr(10)

SALES_EDITION = "Sales Edition"
COMPLETE_EDITION = "Complete Edition"


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
    return str(payload)[:160]


def company_payload(name: str) -> dict:
    return {
        "name": name, "brandName": name, "fullAddress": f"{name} HQ",
        "phone": "+92-21-00000000", "ntn": "1234567", "cnic": "1234567890123",
        "strn": "1234567890123", "fbrSellerRegistrationNo": "1234567",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
    }


# Company-scoped reads, by the id they take. {cid} is substituted.
COMPANY_SCOPED_READS = [
    ("item types (carries on-hand stock)", "/api/itemtypes?companyId={cid}"),
    ("clients", "/api/clients/company/{cid}"),
    ("suppliers", "/api/suppliers/company/{cid}"),
    ("invoices", "/api/invoices/company/{cid}/paged?page=1&pageSize=5"),
    ("challans", "/api/deliverychallans/company/{cid}/paged?page=1&pageSize=5"),
    ("purchase bills", "/api/purchasebills/company/{cid}/paged?page=1&pageSize=5"),
    ("goods receipts", "/api/goodsreceipts/company/{cid}/paged?page=1&pageSize=5"),
    ("sales quotes", "/api/salesquotes/company/{cid}"),
    ("sales orders", "/api/salesorders/company/{cid}"),
    ("receipts", "/api/payments/receipts/company/{cid}/paged?page=1&pageSize=5"),
    ("payments", "/api/payments/payments/company/{cid}/paged?page=1&pageSize=5"),
    ("stock on hand", "/api/stock/company/{cid}/onhand"),
    ("dashboard KPIs", "/api/dashboard/kpis?companyId={cid}"),
    ("sales report", "/api/reports/company/{cid}/sales?year=2026&month=9"),
    ("tax sheet", "/api/reports/company/{cid}/tax-sheet?year=2026&month=9"),
    ("outstanding ledger", "/api/reports/company/{cid}/outstanding?year=2026&month=9"),
    ("PO formats", "/api/poformats?companyId={cid}"),
    ("print templates", "/api/printtemplates/company/{cid}"),
    ("chart of accounts", "/api/accounts/company/{cid}/tree"),
    ("GL account picker", "/api/accounts/company/{cid}/flat"),
    ("bank/cash picker", "/api/accounts/company/{cid}/bank-cash"),
    ("journal entries", "/api/journal-entries/company/{cid}/paged?page=1&pageSize=5"),
    ("balance sheet", "/api/accounting/reports/company/{cid}/balance-sheet"),
    ("company record", "/api/companies/{cid}"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  CROSS-TENANT LEAK SWEEP")
    print("=" * 78)

    s, d = http("POST", "/api/auth/login", base,
                body={"username": args.user, "password": args.password})
    if s != 200:
        print(f"[!] login failed: HTTP {s} {d}")
        return 2
    seed = d["token"]

    made_users: list[dict] = []
    made_roles: list[dict] = []
    co_a = co_b = None

    try:
        print("\n--- setup: two companies, two users, access to A only ---")
        s, roles = http("GET", "/api/roles", base, token=seed)
        if not check("0", "roles listed", s == 200, f"{s} {err(roles)}"):
            return 1
        by_name = {r["name"]: r for r in roles}
        sales = by_name.get(SALES_EDITION)
        complete = by_name.get(COMPLETE_EDITION)
        if not check("0", "both editions are seeded", sales and complete):
            return 1

        s, co_a = http("POST", "/api/companies", base, token=seed,
                       body=company_payload("_test_leak_A"))
        if not check("0", "company A created", s in (200, 201), f"{s} {err(co_a)}"):
            return 1
        s, co_b = http("POST", "/api/companies", base, token=seed,
                       body=company_payload("_test_leak_B"))
        if not check("0", "company B created", s in (200, 201), f"{s} {err(co_b)}"):
            return 1
        a_id, b_id = co_a["id"], co_b["id"]

        # Set for tidiness, not for the test to mean anything: under the
        # fail-closed rule in CompanyAccessGuard, access comes from explicit
        # UserCompanies rows and IsTenantIsolated is informational. A user with
        # no grant for company B is refused whatever the flag says.
        for co in (co_a, co_b):
            s, _ = http("PUT", f"/api/companies/{co['id']}", base, token=seed,
                        body={**company_payload(co["name"]), "isTenantIsolated": True})
            check("0", f"{co['name']} marked tenant-isolated", s == 200, f"got {s}")

        # Something of B's worth leaking, so a 200 would be visibly wrong.
        s, b_client = http("POST", "/api/clients", base, token=seed, body={
            "name": "_leak_probe_buyer_B", "companyId": b_id,
            "address": "B street", "ntn": "7654321"})
        check("0", "company B has a buyer to leak", s in (200, 201), f"{s} {err(b_client)}")

        def make_user(username: str, role: dict) -> str | None:
            s, u = http("POST", "/api/users", base, token=seed, body={
                "username": username, "fullName": username,
                "password": PW, "role": "User"})
            if not check("0", f"{username} created", s in (200, 201), f"{s} {err(u)}"):
                return None
            made_users.append(u)
            http("PUT", f"/api/users/{u['id']}/roles", base, token=seed,
                 body={"roleIds": [role["id"]]})
            # Company A ONLY. That is the whole point.
            http("PUT", f"/api/usercompanies/user/{u['id']}", base, token=seed,
                 body={"companyIds": [a_id]})
            s, t = http("POST", "/api/auth/login", base,
                        body={"username": username, "password": PW})
            if not check("0", f"{username} signed in", s == 200, f"{s} {err(t)}"):
                return None
            return t["token"]

        tok_sales = make_user("leakSales", sales)
        tok_complete = make_user("leakComplete", complete)
        if not tok_sales or not tok_complete:
            return 1

        editions = (("Sales", tok_sales), ("Complete", tok_complete))

        # -- 1. every company-scoped read, pointed at company B ---------------
        # A probe that 404s because the URL is wrong would "pass" while testing
        # nothing, which is worse than no test. So every path is first proven
        # live against company B as the seed admin, who may read everything;
        # only paths that really answer are then used as leak probes.
        print(NL + "--- 1a. proving each probe path is real ---")
        live_probes = []
        for label, tmpl in COMPANY_SCOPED_READS:
            st, _ = http("GET", tmpl.format(cid=b_id), base, token=seed)
            if st == 200:
                live_probes.append((label, tmpl))
            else:
                check("1a", f"{label} answers for the seed admin", False,
                      f"got {st} - the probe path is wrong or the route is gone")
        check("1a", "the probe set is substantial", len(live_probes) >= 18,
              f"only {len(live_probes)} live probes")

        # -- 1. every company-scoped read, pointed at company B ---------------
        print(NL + "--- 1. reads aimed at a company the user was never given ---")
        for who, tok in editions:
            for label, tmpl in live_probes:
                st, body = http("GET", tmpl.format(cid=b_id), base, token=tok)
                # The path is known to answer 200 for someone who may read it,
                # so anything but a refusal here is a leak.
                # 403 or 404 both refuse. 404 only counts because step 1a
                # proved this exact path answers 200 for someone entitled to
                # it, so "not found" here means "not found FOR YOU" rather
                # than a probe aimed at a route that does not exist.
                check("1", f"{who}: {label} refused for company B",
                      st in (403, 404), f"got {st} {err(body)}")

        # -- 2. the same reads for the user's OWN company still work ----------
        print("\n--- 2. the same reads still serve the company they DO have ---")
        own_ok = [
            ("item types", "/api/itemtypes?companyId={cid}"),
            ("clients", "/api/clients/company/{cid}"),
            ("suppliers", "/api/suppliers/company/{cid}"),
            ("invoices", "/api/invoices/company/{cid}/paged?page=1&pageSize=5"),
            ("challans", "/api/deliverychallans/company/{cid}/paged?page=1&pageSize=5"),
            ("receipts", "/api/payments/receipts/company/{cid}/paged?page=1&pageSize=5"),
            ("PO formats", "/api/poformats?companyId={cid}"),
        ]
        for who, tok in editions:
            for label, tmpl in own_ok:
                st, body = http("GET", tmpl.format(cid=a_id), base, token=tok)
                check("2", f"{who}: {label} works for their own company",
                      st == 200, f"got {st} {err(body)}")

        # -- 3. id-in-the-path IDOR -------------------------------------------
        print("\n--- 3. rows of company B fetched by their own id ---")
        probes = []
        if isinstance(b_client, dict) and b_client.get("id"):
            probes.append(("client by id", f"/api/clients/{b_client['id']}"))
        s, b_accounts = http("GET", f"/api/accounts/company/{b_id}/flat", base, token=seed)
        if s == 200 and isinstance(b_accounts, list) and b_accounts:
            probes.append(("account ledger by id",
                           f"/api/accounts/{b_accounts[0]['id']}/ledger"))
        s, b_formats = http("GET", f"/api/poformats?companyId={b_id}", base, token=seed)
        if s == 200 and isinstance(b_formats, list) and b_formats:
            probes.append(("PO format by id", f"/api/poformats/{b_formats[0]['id']}"))

        check("3", "there is something of B's to try for", len(probes) > 0,
              "no probe rows could be created")
        for who, tok in editions:
            for label, path in probes:
                st, body = http("GET", path, base, token=tok)
                check("3", f"{who}: {label} refused", st in (403, 404),
                      f"got {st} {err(body)}")

        # -- 4. the listing endpoints that take no company at all --------------
        print("\n--- 4. cross-company listings stay inside the caller's set ---")
        for who, tok in editions:
            st, body = http("GET", "/api/poformats", base, token=tok)
            if st == 200 and isinstance(body, list):
                foreign = [f for f in body
                           if f.get("companyId") not in (None, a_id)]
                check("4", f"{who}: unfiltered PO format list holds no other tenant",
                      not foreign,
                      f"{len(foreign)} foreign row(s), e.g. {foreign[:1]}")
            else:
                check("4", f"{who}: unfiltered PO format list is refused or empty",
                      st in (403, 404, 200), f"got {st}")

            st, body = http("GET", "/api/companies", base, token=tok)
            if st == 200 and isinstance(body, list):
                ids = {c.get("id") for c in body}
                check("4", f"{who}: company list is only what they were granted",
                      b_id not in ids, f"company B present in {sorted(ids)[:8]}")
            else:
                check("4", f"{who}: company list refused", st in (403, 404), f"got {st}")

            st, body = http("GET", "/api/itemtypes", base, token=tok)
            check("4", f"{who}: the global item catalog still loads", st == 200,
                  f"got {st} {err(body)}")

            # Portals take no companyId at all - the endpoint derives the set.
            # The row carries the PUBLIC LINK, so a foreign row here would hand
            # over a live bearer token, not just a name.
            st, body = http("GET", "/api/customer-portals", base, token=tok)
            if st == 200 and isinstance(body, list):
                foreign = [x for x in body if x.get("companyId") != a_id]
                check("4", f"{who}: portal list holds no other tenant's link",
                      not foreign, f"{len(foreign)} foreign portal(s)")
            else:
                check("4", f"{who}: portal list refused", st in (403, 404), f"got {st}")

        # -- 5. a narrow role can still fill the pickers ----------------------
        # The complaint this answers: a role built to raise bills, holding
        # none of the *.manage.view keys that open the Clients, Suppliers or
        # Chart of Accounts SCREENS, hit 403 on the dropdowns those forms
        # cannot be used without. Opening a screen and filling a field on a
        # form you are entitled to use are different questions.
        print(NL + "--- 5. a bills-only role can still fill the pickers ---")
        s, narrow = http("POST", "/api/roles", base, token=seed, body={
            "name": "_leak_narrow_biller", "description": "temp - bills only",
            "permissionKeys": ["bills.list.view", "bills.manage.create",
                               "bills.manage.create.standalone", "bills.manage.update",
                               "purchasebills.manage.create"]})
        if check("5", "a bills-only role was created", s in (200, 201), f"{s} {err(narrow)}"):
            tok_narrow = make_user("leakNarrow", narrow)
            if tok_narrow:
                for label, path in (
                        ("the buyer picker", f"/api/clients/company/{a_id}"),
                        ("the supplier picker", f"/api/suppliers/company/{a_id}"),
                        ("the item picker", f"/api/itemtypes?companyId={a_id}"),
                        ("the GL account picker", f"/api/accounts/company/{a_id}/flat"),
                        ("the unit lookup", "/api/lookup/units?query=p"),
                ):
                    st, body = http("GET", path, base, token=tok_narrow)
                    check("5", f"bills-only role fills {label}", st == 200,
                          f"got {st} {err(body)}")
                # ...and the widening did not become a way round the tenant line.
                for label, path in (
                        ("buyers", f"/api/clients/company/{b_id}"),
                        ("suppliers", f"/api/suppliers/company/{b_id}"),
                        ("item stock", f"/api/itemtypes?companyId={b_id}"),
                ):
                    st, body = http("GET", path, base, token=tok_narrow)
                    check("5", f"bills-only role is still refused company B {label}",
                          st in (403, 404), f"got {st} {err(body)}")
            # The screens it was NOT given stay shut.
            if tok_narrow:
                st, body = http("GET", "/api/clients", base, token=tok_narrow)
                check("5", "bills-only role cannot open the Clients screen list",
                      st == 403, f"got {st} {err(body)}")
            made_roles.append(narrow)

    finally:
        print("\n--- cleanup ---")
        for u in made_users:
            http("DELETE", f"/api/users/{u['id']}", base, token=seed)
        for r in made_roles:
            http("DELETE", f"/api/roles/{r['id']}", base, token=seed)
        for co in (co_a, co_b):
            if co:
                http("DELETE", f"/api/companies/{co['id']}", base, token=seed)
        print("  temp users and companies removed")

    print("\n" + "=" * 78)
    if FAIL == 0:
        print(f"  TENANT LEAK SWEEP PASSED - {PASS}/{PASS} checks")
    else:
        print(f"  TENANT LEAK SWEEP FAILED - {FAIL} of {PASS + FAIL} checks")
        for f in FAILURES:
            print(f"    - {f}")
    print("=" * 78)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
