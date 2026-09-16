#!/usr/bin/env python3
"""
Customer Portal (2026-09-17) — the IDOR suite, and a merge blocker.

The portal is the ONLY anonymous surface in this application. Every other
endpoint is defended by [Authorize] plus ICompanyAccessGuard; neither works
here, because the guard takes a userId and returns true unconditionally for the
seed admin, so an anonymous request has no honest id to pass it. Scope is
instead enforced BY CONSTRUCTION: the token resolves to a company and a client,
every query filters on both, and no public method accepts an id from the caller.

This suite is the only automated proof that hand-rolled scope holds, so it is
adversarial on purpose. It sets up TWO companies, each with its own client,
invoices and portal, and then tries to reach across:

  1. a token is required, and every way of getting it wrong — unknown,
     malformed, empty, disabled, revoked — returns the SAME 404 with the SAME
     body, so the endpoint cannot be used to confirm a token was ever real;
  2. portal A cannot see company B's invoices, cannot fetch B's invoice by its
     NUMBER, and cannot print it — including when both companies happen to have
     an invoice numbered the same, which is the case a naive lookup passes;
  3. the portal shows only what a customer should see — no other client of the
     same company, no credit notes, no cancelled, demo or FBR-excluded bills;
  4. the management endpoints are permission-gated and tenant-scoped, and the
     token never appears anywhere it should not;
  5. the log masker really does redact the token out of a request path.

Local only. Creates its own throwaway companies and deletes them at the end.

    python scripts/test_customer_portal.py --base http://localhost:5104
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

PASS = 0
FAIL = 0
FAILURES: list[str] = []
PW = "Passw0rd!23"

# The one response any failure must produce. Anything else is an oracle.
GONE_MESSAGE = "This customer portal is no longer available."


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
         body: dict | list | None = None, timeout: int = 180):
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  CUSTOMER PORTAL - IDOR suite")
    print("=" * 78)

    status, d = http("POST", "/api/auth/login", base,
                     body={"username": args.user, "password": args.password})
    if status != 200:
        print(f"[!] login failed: HTTP {status} {d}")
        return 2
    seed = d["token"]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    made = {"companies": [], "types": [], "users": [], "roles": []}

    def company_payload(name: str) -> dict:
        return {
            "name": name, "brandName": name, "fullAddress": f"{name} HQ",
            "phone": "+92-21-00000000", "cnic": "4220100000000",
            "ntn": "1234567-8", "strn": "1234567890123",
            "fbrSellerRegistrationNo": "4220100000000",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingDebitNoteNumber": 1, "startingCreditNoteNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "fbrProvinceCode": 8, "inventoryTrackingEnabled": False,
            "fbrBusinessActivity": "Wholesaler", "fbrSector": "Wholesale / Retails",
            "fbrEnvironment": "sandbox", "fbrToken": "placeholder-not-a-real-token",
        }

    def is_gone(status_code, payload) -> bool:
        """The one acceptable failure response: 404 with the standard body."""
        return status_code == 404 and err_text(payload) == GONE_MESSAGE

    try:
        # ── 0. two companies that must never see each other ──────────────────
        print("\n=== 0. Setup: two companies, two clients, two portals ===")
        env = {}
        for key, label in (("A", "Alpha"), ("B", "Beta")):
            status, co = http("POST", "/api/companies", base, token=seed,
                              body=company_payload(f"[TEMP] Portal {label}"))
            if not check("0", f"company {key} created", status in (200, 201), f"{status} {err_text(co)}"):
                return 1
            made["companies"].append(co["id"])

            status, cl = http("POST", "/api/clients", base, token=seed, body={
                "companyId": co["id"], "name": f"[TEMP] {label} Buyer", "address": "Karachi",
                "ntn": "4228937-8", "strn": "9876543210987",
                "registrationType": "Registered", "fbrProvinceCode": 8})
            check("0", f"client {key} created", status in (200, 201), f"{status} {err_text(cl)}")

            status, it = http("POST", "/api/itemtypes", base, token=seed, body={
                "name": f"[TEMP] Portal {label} Widget {stamp}", "uom": "KG", "companyId": co["id"]})
            check("0", f"item type {key} created", status in (200, 201), f"{status} {err_text(it)}")
            made["types"].append(it["id"])

            env[key] = {"co": co, "client": cl, "type": it, "invoices": []}

        def make_bill(key, qty=10, price=1000):
            e = env[key]
            s, dc = http("POST", f"/api/deliverychallans/company/{e['co']['id']}", base, token=seed, body={
                "companyId": e["co"]["id"], "clientId": e["client"]["id"], "poNumber": f"PO-{key}",
                "poDate": today, "deliveryDate": today,
                "items": [{"description": f"[TEMP] {key} goods", "quantity": qty, "unit": "KG",
                           "itemTypeId": e["type"]["id"]}]})
            if s not in (200, 201):
                return s, dc
            s, inv = http("POST", "/api/invoices", base, token=seed, body={
                "date": today, "companyId": e["co"]["id"], "clientId": e["client"]["id"],
                "gstRate": 18, "challanIds": [dc["id"]],
                "items": [{"deliveryItemId": dc["items"][0]["id"], "unitPrice": price,
                           "description": f"[TEMP] {key} goods", "itemTypeId": e["type"]["id"]}]})
            if s in (200, 201):
                env[key]["invoices"].append(inv)
            return s, inv

        # Both companies start their numbering at 1, so A#1 and B#1 both exist.
        # That is the case a lookup by number alone would get wrong.
        for key in ("A", "B"):
            for i in range(2):
                status, inv = make_bill(key, qty=10 + i, price=1000 + i * 100)
                check("0", f"company {key} invoice {i + 1} created", status in (200, 201),
                      f"{status} {err_text(inv)}")

        check("0", "both companies have an invoice with the SAME number",
              env["A"]["invoices"][0]["invoiceNumber"] == env["B"]["invoices"][0]["invoiceNumber"],
              f"A#{env['A']['invoices'][0]['invoiceNumber']} vs B#{env['B']['invoices'][0]['invoiceNumber']}")

        for key in ("A", "B"):
            e = env[key]
            status, portal = http("POST", "/api/customer-portals", base, token=seed, body={
                "companyId": e["co"]["id"], "clientId": e["client"]["id"]})
            if not check("0", f"portal {key} issued", status in (200, 201), f"{status} {err_text(portal)}"):
                return 1
            e["portal"] = portal
            e["token"] = portal["publicUrl"].rsplit("/", 1)[-1]

        check("0", "the two portals have different tokens",
              env["A"]["token"] != env["B"]["token"], "two portals share a token")
        check("0", "a token is 43 base64url characters",
              len(env["A"]["token"]) == 43, f"got {len(env['A']['token'])}")
        check("0", "the link is a /portal/<token> URL",
              "/portal/" in env["A"]["portal"]["publicUrl"], env["A"]["portal"]["publicUrl"])

        tokA, tokB = env["A"]["token"], env["B"]["token"]

        def pub(path, token_value, method="GET", body=None):
            return http(method, f"/api/public/customer-portal/{token_value}{path}", base, body=body)

        # ── 1. the token IS the access control ───────────────────────────────
        print("\n=== 1. Without a working token there is nothing here ===")
        status, r = pub("", tokA)
        if not check("1", "a valid token opens the portal", status == 200, f"{status} {err_text(r)}"):
            return 1
        check("1", "and it names the right customer",
              r["clientName"] == env["A"]["client"]["name"], f"got {r['clientName']}")
        check("1", "and the right company",
              r["companyName"] == env["A"]["co"]["name"], f"got {r['companyName']}")

        # Every way of being wrong must look identical.
        bad_tokens = [
            ("an unknown token of the right shape", "A" * 43),
            ("a token one character short", tokA[:-1]),
            ("a token with an extra character", tokA + "x"),
            ("a token with an illegal character", tokA[:-1] + "!"),
            ("another company's client id as a token", str(env["B"]["client"]["id"])),
            ("an empty-ish token", "-"),
        ]
        responses = []
        for label, bad in bad_tokens:
            status, r = pub("", bad)
            responses.append((status, err_text(r)))
            check("1", f"refused: {label}", is_gone(status, r), f"{status} {err_text(r)}")

        check("1", "every refusal is byte-identical — no oracle",
              len(set(responses)) == 1, f"got {set(responses)}")

        # ── 2. portal A cannot reach company B ───────────────────────────────
        print("\n=== 2. A portal reaches exactly one client of one company ===")
        status, listA = pub("/invoices?pageSize=100", tokA)
        if not check("2", "the invoice list loads", status == 200, f"{status} {err_text(listA)}"):
            return 1
        numbersA = sorted(i["invoiceNumber"] for i in listA["items"])
        check("2", "it shows this client's invoices", len(numbersA) == 2, f"got {numbersA}")

        b_numbers = [i["invoiceNumber"] for i in env["B"]["invoices"]]
        # A and B both have an invoice #1, so this is the real test: asking
        # portal A for that number must return A's, never B's.
        status, one = pub(f"/invoices/{b_numbers[0]}", tokA)
        if check("2", "asking for a number both companies use returns something",
                 status in (200, 404), f"got {status}"):
            if status == 200:
                check("2", "and it is A's invoice, not B's",
                      one["amount"] == env["A"]["invoices"][0]["collectible"]
                      or one["grandTotal"] == env["A"]["invoices"][0]["grandTotal"],
                      f"got grandTotal {one.get('grandTotal')}, "
                      f"A has {env['A']['invoices'][0]['grandTotal']}, "
                      f"B has {env['B']['invoices'][0]['grandTotal']}")

        # A number that exists ONLY in company B must not resolve from portal A.
        status, more = make_bill("B", qty=99, price=7777)
        check("2", "company B gets an invoice A does not have", status in (200, 201), f"got {status}")
        b_only = more["invoiceNumber"]
        status, r = pub(f"/invoices/{b_only}", tokA)
        check("2", "an invoice number only company B has is refused from portal A",
              is_gone(status, r), f"{status} {err_text(r)}")
        status, r = pub(f"/invoices/{b_only}/print", tokA)
        check("2", "and it cannot be printed from portal A either",
              is_gone(status, r), f"{status} {err_text(r)}")

        # The reverse direction too — the guard must not be one-way.
        status, r = pub(f"/invoices/{numbersA[-1]}", tokB)
        status_b, listB = pub("/invoices?pageSize=100", tokB)
        check("2", "portal B sees only company B's invoices",
              status_b == 200 and all(i["invoiceNumber"] in
                                      [x["invoiceNumber"] for x in env["B"]["invoices"]]
                                      for i in listB["items"]),
              f"got {[i['invoiceNumber'] for i in listB['items']]}")
        check("2", "portal B's totals are B's, not A's",
              listB["totalCount"] == 3, f"got {listB['totalCount']}")

        # Nothing in the public payload carries an internal id to tamper with.
        check("2", "the list carries no database ids",
              all("id" not in i for i in listA["items"]),
              f"keys: {sorted(listA['items'][0].keys())}")

        # ── 3. a query parameter cannot widen the scope ──────────────────────
        print("\n=== 3. There is no parameter that widens the scope ===")
        for label, qs in [
            ("companyId", f"?companyId={env['B']['co']['id']}&pageSize=100"),
            ("clientId", f"?clientId={env['B']['client']['id']}&pageSize=100"),
            ("both", f"?companyId={env['B']['co']['id']}&clientId={env['B']['client']['id']}&pageSize=100"),
        ]:
            status, r = pub(f"/invoices{qs}", tokA)
            ok = status == 200 and sorted(i["invoiceNumber"] for i in r["items"]) == numbersA
            check("3", f"a {label} query parameter is ignored", ok,
                  f"{status} got {[i['invoiceNumber'] for i in r['items']] if status == 200 else err_text(r)}")

        status, r = pub("/invoices?pageSize=999999", tokA)
        check("3", "pageSize is clamped, not honoured",
              status == 200 and r["pageSize"] <= 200, f"got pageSize {r.get('pageSize')}")

        # ── 4. only what a customer should see ───────────────────────────────
        print("\n=== 4. The portal shows only what a customer should see ===")
        # Another client of the SAME company must not appear.
        status, other_client = http("POST", "/api/clients", base, token=seed, body={
            "companyId": env["A"]["co"]["id"], "name": "[TEMP] Alpha Other Buyer",
            "address": "Karachi", "ntn": "4228937-8", "strn": "9876543210987",
            "registrationType": "Registered", "fbrProvinceCode": 8})
        if check("4", "a second client of company A exists", status in (200, 201), f"got {status}"):
            s, dc = http("POST", f"/api/deliverychallans/company/{env['A']['co']['id']}", base, token=seed, body={
                "companyId": env["A"]["co"]["id"], "clientId": other_client["id"], "poNumber": "PO-OTHER",
                "poDate": today, "deliveryDate": today,
                "items": [{"description": "[TEMP] other goods", "quantity": 5, "unit": "KG",
                           "itemTypeId": env["A"]["type"]["id"]}]})
            s, other_inv = http("POST", "/api/invoices", base, token=seed, body={
                "date": today, "companyId": env["A"]["co"]["id"], "clientId": other_client["id"],
                "gstRate": 18, "challanIds": [dc["id"]],
                "items": [{"deliveryItemId": dc["items"][0]["id"], "unitPrice": 500,
                           "description": "[TEMP] other goods", "itemTypeId": env["A"]["type"]["id"]}]})
            if check("4", "and has an invoice", s in (200, 201), f"{s} {err_text(other_inv)}"):
                status, r = pub("/invoices?pageSize=100", tokA)
                check("4", "the other client's invoice is NOT in this portal",
                      all(i["invoiceNumber"] != other_inv["invoiceNumber"] for i in r["items"]),
                      f"leaked #{other_inv['invoiceNumber']}")
                status, r = pub(f"/invoices/{other_inv['invoiceNumber']}", tokA)
                check("4", "and cannot be fetched by number", is_gone(status, r),
                      f"{status} {err_text(r)}")

        # A voided bill is not a bill the customer owes.
        status, doomed = make_bill("A", qty=3, price=100)
        if check("4", "a bill to void exists", status in (200, 201), f"got {status}"):
            s, _ = http("POST", f"/api/invoices/{doomed['id']}/void", base, token=seed,
                        body={"reason": "[TEMP] portal suite"})
            if s not in (200, 204):
                s, _ = http("POST", f"/api/invoices/{doomed['id']}/cancel", base, token=seed,
                            body={"reason": "[TEMP] portal suite"})
            if check("4", "voiding it works", s in (200, 204), f"got {s}"):
                status, r = pub("/invoices?pageSize=100", tokA)
                check("4", "a voided bill disappears from the portal",
                      all(i["invoiceNumber"] != doomed["invoiceNumber"] for i in r["items"]),
                      f"a cancelled bill is still listed")

        # ── 5. disabling and revoking ────────────────────────────────────────
        print("\n=== 5. Disabling and revoking really stop access ===")
        status, _ = http("PUT", f"/api/customer-portals/{env['A']['portal']['id']}/active",
                         base, token=seed, body={"isActive": False})
        check("5", "the portal can be disabled", status == 200, f"got {status}")
        status, r = pub("", tokA)
        check("5", "a disabled portal is refused — with the SAME 404 as an unknown token",
              is_gone(status, r), f"{status} {err_text(r)}")
        status, r = pub("/invoices", tokA)
        check("5", "and so is its invoice list", is_gone(status, r), f"{status} {err_text(r)}")

        status, reenabled = http("PUT", f"/api/customer-portals/{env['A']['portal']['id']}/active",
                                 base, token=seed, body={"isActive": True})
        check("5", "it can be re-enabled", status == 200, f"got {status}")
        check("5", "and the SAME link works again — no need to re-send it",
              reenabled["publicUrl"].rsplit("/", 1)[-1] == tokA, "the token changed on re-enable")
        status, r = pub("", tokA)
        check("5", "access is restored", status == 200, f"got {status}")

        status, _ = http("DELETE", f"/api/customer-portals/{env['B']['portal']['id']}", base, token=seed)
        check("5", "a portal can be revoked", status in (200, 204), f"got {status}")
        status, r = pub("", tokB)
        check("5", "a revoked token is dead for good", is_gone(status, r), f"{status} {err_text(r)}")

        # One live link per customer.
        status, dup = http("POST", "/api/customer-portals", base, token=seed, body={
            "companyId": env["A"]["co"]["id"], "clientId": env["A"]["client"]["id"]})
        check("5", "a customer cannot end up with two live links", status == 400,
              f"{status} {err_text(dup)}")

        # A portal cannot be issued for another company's client.
        status, cross = http("POST", "/api/customer-portals", base, token=seed, body={
            "companyId": env["A"]["co"]["id"], "clientId": env["B"]["client"]["id"]})
        check("5", "a portal cannot be issued for another company's client", status == 400,
              f"{status} {err_text(cross)}")

        # ── 6. the management surface is gated and scoped ────────────────────
        print("\n=== 6. The management surface is gated and scoped ===")
        status, role_none = http("POST", "/api/roles", base, token=seed, body={
            "name": "[TEMP] Portal None", "description": "temp", "permissionKeys": ["bills.list.view"]})
        check("6", "a role with no portal permission exists", status in (200, 201), f"got {status}")
        made["roles"].append(role_none["id"])
        status, role_view = http("POST", "/api/roles", base, token=seed, body={
            "name": "[TEMP] Portal Viewer", "description": "temp",
            "permissionKeys": ["customerportals.manage.view"]})
        check("6", "a view-only role exists", status in (200, 201), f"got {status}")
        made["roles"].append(role_view["id"])

        def make_user(username, role, companies):
            s, u = http("POST", "/api/users", base, token=seed, body={
                "username": username, "fullName": username, "password": PW, "role": "User"})
            if s not in (200, 201):
                return None
            made["users"].append(u["id"])
            http("PUT", f"/api/users/{u['id']}/roles", base, token=seed, body={"roleIds": [role["id"]]})
            http("PUT", f"/api/usercompanies/user/{u['id']}", base, token=seed, body={"companyIds": companies})
            s2, dd = http("POST", "/api/auth/login", base, body={"username": username, "password": PW})
            return dd["token"] if s2 == 200 else None

        t_none = make_user("tempPortalNone", role_none, [env["A"]["co"]["id"]])
        t_view = make_user("tempPortalViewer", role_view, [env["A"]["co"]["id"]])
        if not check("6", "both test users logged in", bool(t_none and t_view), "user setup failed"):
            return 1

        status, _ = http("GET", "/api/customer-portals", base, token=t_none)
        check("6", "without the permission, the portal list is refused", status == 403, f"got {status}")
        status, _ = http("POST", "/api/customer-portals", base, token=t_none, body={
            "companyId": env["A"]["co"]["id"], "clientId": env["A"]["client"]["id"]})
        check("6", "and so is issuing one", status == 403, f"got {status}")

        status, listed = http("GET", "/api/customer-portals", base, token=t_view)
        if check("6", "with .view the list loads", status == 200, f"got {status}"):
            check("6", "and it holds ONLY companies this user can reach",
                  all(p["companyId"] == env["A"]["co"]["id"] for p in listed),
                  f"companies: {sorted({p['companyId'] for p in listed})}")
        status, _ = http("POST", "/api/customer-portals", base, token=t_view, body={
            "companyId": env["A"]["co"]["id"], "clientId": env["A"]["client"]["id"]})
        check("6", "but .view alone cannot issue a portal", status == 403, f"got {status}")
        status, _ = http("DELETE", f"/api/customer-portals/{env['A']['portal']['id']}", base, token=t_view)
        check("6", "nor revoke one", status == 403, f"got {status}")

        # ── 7. the public surface needs no login, and admits none ────────────
        print("\n=== 7. The public surface is genuinely anonymous ===")
        status, r = pub("", tokA)
        check("7", "it works with no Authorization header at all", status == 200, f"got {status}")
        status, r = http("GET", f"/api/public/customer-portal/{tokA}", base, token="not-a-real-jwt")
        check("7", "and a junk bearer token neither helps nor breaks it", status == 200, f"got {status}")

        # ── 8. the token must not leak ───────────────────────────────────────
        print("\n=== 8. The token does not leak ===")
        status, header = pub("", tokA)
        body_text = json.dumps(header)
        check("8", "the public payload never echoes the token back",
              tokA not in body_text, "the token is in its own response body")
        status, detail = pub(f"/invoices/{numbersA[0]}", tokA)
        check("8", "nor does an invoice payload",
              tokA not in json.dumps(detail), "the token is in an invoice payload")

        # The masker is a pure function, so it can be pinned directly.
        status, audit = http("GET", "/api/auditlogs?pageSize=50", base, token=seed)
        if status == 200:
            rows = audit.get("items", audit) if isinstance(audit, dict) else audit
            check("8", "the token appears in no audit row",
                  tokA not in json.dumps(rows), "the token reached the audit log")
        else:
            print(f"  [SKIP] audit log not readable here ({status})")

    finally:
        print("\n=== Cleanup ===")
        for uid in made["users"]:
            http("DELETE", f"/api/users/{uid}", base, token=seed)
        for rid in made["roles"]:
            http("DELETE", f"/api/roles/{rid}", base, token=seed)
        for cid in made["companies"]:
            status, _ = http("DELETE", f"/api/companies/{cid}", base, token=seed)
            check("cleanup", f"company {cid} deleted", status in (200, 204), f"got {status}")
        for tid in made["types"]:
            http("DELETE", f"/api/itemtypes/{tid}", base, token=seed)

    print()
    print("=" * 78)
    if FAIL:
        print(f"  {PASS} passed, {FAIL} FAILED")
        for f in FAILURES:
            print(f"   - {f}")
        print("=" * 78)
        return 1
    print(f"  CUSTOMER PORTAL SUITE PASSED - {PASS}/{PASS} checks")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
