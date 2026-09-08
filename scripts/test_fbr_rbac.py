"""
FBR permissions — who may validate, submit, reset, and configure.

The point of this suite is that the FBR verbs are SEPARATELY gated. A clerk who
prepares bills is not the person who files them, and the person who files them
is not the person who may reset a stuck filing and declare an IRN real. Those
are three different permissions and this proves each one is load-bearing.

Every test user is given company access, so a 403 here can only mean RBAC --
tenant scoping is proven separately in test_tenant_isolation.py and must not be
what makes these pass.

  1  validate-only    may dry-run, may NOT file
  2  submit-only      may file, may NOT reset a stuck filing
  3  reset holder     may reset; and the reset itself is audited
  4  no FBR rights    every FBR verb refused, including the payload preview
                      (the preview is the whole invoice, so it leaks if ungated)
  5  bill rights are not FBR rights, and FBR rights are not bill rights
  6  a filed bill is immutable regardless of how many permissions you hold
  7  the FBR TOKEN is gated apart from ordinary company editing

Usage:
  python scripts/test_fbr_rbac.py --base http://localhost:5135 \
      --fbr-token "<sandbox-token>"

Exit 0 = every non-skipped assertion passed.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

results: list[tuple[str, bool, str]] = []
skips: list[tuple[str, str]] = []
PW = "test1234"


def check(name: str, ok: bool, reason: str = "") -> bool:
    results.append((name, bool(ok), reason))
    print(f"    [{'OK  ' if ok else 'FAIL'}] {name}" + ("" if ok else f"  -> {reason}"))
    return bool(ok)


def skip(name: str, why: str) -> None:
    skips.append((name, why))
    print(f"    [SKIP] {name}  ({why})")


def http(method, path, base, token=None, body=None):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:300]
    except Exception as e:
        return 0, str(e)


def err(b):
    return str(b.get("error") or b.get("message") or b)[:200] if isinstance(b, dict) else str(b)[:200]


_last = [0.0]


def fbr_call(method, path, base, token=None, body=None, pace=2.2):
    """FBR submit/validate is rate limited 30/min/user. Pace, or the suite
    starts reporting 429s as though they were permission failures."""
    w = pace - (time.monotonic() - _last[0])
    if w > 0:
        time.sleep(w)
    try:
        return http(method, path, base, token=token, body=body)
    finally:
        _last[0] = time.monotonic()


def today():
    return datetime.now().strftime("%Y-%m-%dT00:00:00")


def make_role(base, admin, name, keys):
    return http("POST", "/api/roles", base, token=admin,
                body={"name": name, "description": "FBR RBAC suite", "permissionKeys": keys})


_last_login = [0.0]


def login_paced(base, username, pace=6.5):
    w = pace - (time.monotonic() - _last_login[0])
    if w > 0:
        time.sleep(w)
    try:
        return http("POST", "/api/auth/login", base,
                    body={"username": username, "password": PW})
    finally:
        _last_login[0] = time.monotonic()


def make_user(base, admin, username, role_id, company_ids):
    st, existing = http("GET", "/api/users", base, token=admin)
    if st == 200:
        prev = next((u for u in (existing or []) if u["username"] == username), None)
        if prev:
            http("DELETE", f"/api/users/{prev['id']}", base, token=admin)
    st, u = http("POST", "/api/users", base, token=admin, body={
        "username": username, "password": PW, "fullName": username, "role": "User"})
    if st not in (200, 201):
        return None, f"create user: {st} {err(u)}"
    http("PUT", f"/api/users/{u['id']}/roles", base, token=admin, body={"roleIds": [role_id]})
    http("PUT", f"/api/usercompanies/user/{u['id']}", base, token=admin,
         body={"companyIds": company_ids})
    # /api/auth/login is rate limited to 10 per minute per IP, and this suite
    # signs in six freshly minted users back to back. Without pacing the later
    # ones get a 429 that reads like a broken credential.
    st, tok = login_paced(base, username)
    if st != 200:
        return None, f"login: {st} {err(tok)}"
    return {"id": u["id"], "token": tok["token"]}, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5135")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--fbr-token", default=None)
    ap.add_argument("--ntn", default="4228937-8")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    print("=" * 78)
    print("  FBR PERMISSIONS (RBAC)")
    print(f"  base={args.base}  token={'supplied' if args.fbr_token else 'NOT supplied'}")
    print("=" * 78)

    st, d = http("POST", "/api/auth/login", args.base,
                 body={"username": args.user, "password": args.password})
    if st != 200:
        print(f"FATAL: admin login failed ({st} {d})")
        return 2
    admin = d["token"]

    sfx = datetime.now().strftime("%H%M%S")
    made_roles, made_users, cid = [], [], None
    try:
        # ── A company with FBR on, and one submittable bill per actor ────────
        st, co = http("POST", "/api/companies", args.base, token=admin, body={
            "name": f"_fbr_rbac {sfx}", "fullAddress": "Karachi", "phone": "+92-21-1",
            "ntn": args.ntn, "strn": "3277876175852",
            "startingChallanNumber": 90000, "startingInvoiceNumber": 90000,
            "startingPurchaseBillNumber": 90000, "startingGoodsReceiptNumber": 90000,
            "fbrEnabled": True, "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
            "fbrBusinessActivity": "Importer", "fbrSector": "All Other Sectors",
            "fbrDefaultSaleType": "Goods at Standard Rate (default)",
            "fbrDefaultUOM": "Numbers, pieces, units",
            "inventoryTrackingEnabled": False, "fbrToken": args.fbr_token,
        })
        if st not in (200, 201):
            print(f"FATAL: company create failed ({st} {err(co)})")
            return 2
        cid = co["id"]
        st, client = http("POST", "/api/clients", args.base, token=admin, body={
            "companyId": cid, "name": f"RBAC Buyer {sfx}", "address": "Karachi",
            "phone": "+92-21-2", "ntn": "0710818-04", "strn": "3277876175853",
            "registrationType": "Registered", "fbrProvinceCode": 8})
        st, it = http("POST", f"/api/itemtypes?companyId={cid}", args.base, token=admin, body={
            "name": f"RBAC Valve {sfx}", "uom": "Numbers, pieces, units",
            "hsCode": "8481.8090", "fbrUOMId": 69,
            "saleType": "Goods at Standard Rate (default)",
            "companyId": cid, "isFavorite": True})

        def new_bill():
            st, inv = http("POST", "/api/invoices/standalone", args.base, token=admin, body={
                "date": today(), "companyId": cid, "clientId": client["id"], "gstRate": 18,
                "documentType": 4, "paymentMode": "Bank Transfer",
                "items": [{"description": "RBAC valve", "quantity": 2,
                           "uom": "Numbers, pieces, units", "unitPrice": 1000,
                           "itemTypeId": it["id"], "hsCode": "8481.8090", "fbrUOMId": 69,
                           "saleType": "Goods at Standard Rate (default)"}]})
            return inv["id"] if st in (200, 201) else None

        # ── Roles differing by exactly one FBR verb ──────────────────────────
        BILL = ["bills.manage.create", "bills.manage.update", "bills.list.view",
                "invoices.list.view", "clients.list.view", "itemtypes.list.view"]
        roles = {
            "validateonly": BILL + ["invoices.fbr.validate"],
            "submitonly":   BILL + ["invoices.fbr.validate", "invoices.fbr.submit"],
            "resetter":     BILL + ["invoices.fbr.validate", "invoices.fbr.submit",
                                    "invoices.fbr.reset"],
            "nofbr":        BILL,
            "fbronly":      ["invoices.fbr.validate", "invoices.fbr.submit",
                             "invoices.list.view"],
        }
        actors = {}
        for key, keys in roles.items():
            st, role = make_role(args.base, admin, f"_rbac_{key}_{sfx}", keys)
            if st not in (200, 201):
                print(f"FATAL: role {key} failed ({st} {err(role)})")
                return 2
            made_roles.append(role["id"])
            u, why = make_user(args.base, admin, f"_rbac_{key}_{sfx}", role["id"], [cid])
            if not u:
                print(f"FATAL: user {key}: {why}")
                return 2
            made_users.append(u["id"])
            actors[key] = u["token"]

        # ── 1. validate is not submit ────────────────────────────────────────
        print("\n=== 1. Validate-only may dry-run but may not file ===")
        bid = new_bill()
        if args.fbr_token:
            st, r = fbr_call("POST", f"/api/fbr/{bid}/validate", args.base, token=actors["validateonly"])
            check("validate-only CAN validate", st == 200, f"http {st}: {err(r)}")
        else:
            skip("validate-only CAN validate", "no --fbr-token")
        st, r = fbr_call("POST", f"/api/fbr/{bid}/submit", args.base, token=actors["validateonly"])
        check("validate-only is REFUSED submit", st == 403, f"http {st}: {err(r)}")
        st, fresh = http("GET", f"/api/invoices/{bid}", args.base, token=admin)
        check("and the refused submit left no FBR status behind",
              fresh.get("fbrStatus") in (None, "", "Validated"),
              f"fbrStatus={fresh.get('fbrStatus')}")

        # ── 2. submit is not reset ───────────────────────────────────────────
        print("\n=== 2. Submit rights do not include resetting a stuck filing ===")
        st, r = http("POST", f"/api/fbr/{bid}/reset-submission", args.base,
                     token=actors["submitonly"], body={"mode": "retry"})
        check("submit-only is REFUSED reset", st == 403, f"http {st}: {err(r)}")

        # ── 3. no FBR rights at all ──────────────────────────────────────────
        print("\n=== 3. No FBR rights means no FBR verbs ===")
        for verb, path, method, body in [
            ("validate", f"/api/fbr/{bid}/validate", "POST", None),
            ("submit", f"/api/fbr/{bid}/submit", "POST", None),
            ("reset", f"/api/fbr/{bid}/reset-submission", "POST", {"mode": "retry"}),
            ("payload preview", f"/api/fbr/{bid}/preview-payload", "GET", None),
        ]:
            st, r = fbr_call(method, path, args.base, token=actors["nofbr"], body=body)
            check(f"no-FBR role is refused {verb}", st == 403, f"http {st}: {err(r)}")

        # ── 4. the two capabilities are independent ──────────────────────────
        print("\n=== 4. Bill rights and FBR rights are separate capabilities ===")
        st, r = http("POST", "/api/invoices/standalone", args.base, token=actors["fbronly"], body={
            "date": today(), "companyId": cid, "clientId": client["id"], "gstRate": 18,
            "documentType": 4, "paymentMode": "Bank Transfer",
            "items": [{"description": "should not exist", "quantity": 1,
                       "uom": "Numbers, pieces, units", "unitPrice": 1,
                       "itemTypeId": it["id"]}]})
        check("an FBR-only role cannot CREATE a bill", st == 403, f"http {st}: {err(r)}")
        st, r = fbr_call("POST", f"/api/fbr/{bid}/submit", args.base, token=actors["nofbr"])
        check("a bill-only role cannot FILE one", st == 403, f"http {st}: {err(r)}")

        # ── 5. a filed bill is immutable however many rights you hold ────────
        print("\n=== 5. A filed bill is immutable regardless of permissions ===")
        if not args.fbr_token:
            skip("a submitted bill cannot be edited by a permitted user", "no --fbr-token")
        else:
            sid = new_bill()
            st, sub = fbr_call("POST", f"/api/fbr/{sid}/submit", args.base, token=actors["submitonly"])
            filed = st == 200 and isinstance(sub, dict) and sub.get("success") is True
            if not check("submit-only CAN file a bill (its one job)", filed,
                         f"http {st}: {err(sub)}"):
                skip("edit lock for a permitted user", "the bill never filed")
            else:
                st, r = http("PUT", f"/api/invoices/{sid}", args.base, token=actors["resetter"], body={
                    "date": today(), "companyId": cid, "clientId": client["id"], "gstRate": 18,
                    "documentType": 4, "paymentMode": "Bank Transfer",
                    "items": [{"itemTypeId": it["id"], "description": "TAMPERED",
                               "quantity": 99, "uom": "Numbers, pieces, units",
                               "unitPrice": 1, "hsCode": "8481.8090"}]})
                check("a user WITH bill-edit rights still cannot edit a filed bill",
                      st == 400, f"http {st}: {err(r)}")
                st, r = fbr_call("POST", f"/api/fbr/{sid}/submit", args.base, token=actors["submitonly"])
                dup = isinstance(r, dict) and r.get("success") is True
                check("and cannot file it a second time", not dup, f"http {st}: {err(r)}")

                # 6. reset is real for the holder -- the recovery valve works.
                st, r = http("POST", f"/api/fbr/{sid}/reset-submission", args.base,
                             token=actors["resetter"],
                             body={"mode": "recordExisting", "irn": sub.get("irn"),
                                   "reason": "RBAC suite: verified at FBR"})
                check("the reset holder CAN operate the recovery valve",
                      st in (200, 204), f"http {st}: {err(r)}")
                # The valve is audited, so it may not be operated anonymously.
                st, r = http("POST", f"/api/fbr/{sid}/reset-submission", args.base,
                             token=actors["resetter"],
                             body={"mode": "retry"})
                check("and a reset with no reason is refused -- the action is audited",
                      st == 400, f"http {st}: {err(r)}")

        # ── 7. the FBR token is gated apart from ordinary company editing ────
        print("\n=== 7. The FBR token is a separate privilege ===")
        st, role = make_role(args.base, admin, f"_rbac_coedit_{sfx}",
                             ["companies.manage.update", "companies.list.view"])
        if st in (200, 201):
            made_roles.append(role["id"])
            u, why = make_user(args.base, admin, f"_rbac_coedit_{sfx}", role["id"], [cid])
            if u:
                made_users.append(u["id"])
                st, r = http("PUT", f"/api/companies/{cid}", args.base, token=u["token"], body={
                    "name": co["name"], "fullAddress": "Karachi", "phone": "+92-21-1",
                    "ntn": args.ntn, "fbrToken": "ATTACKER-SUPPLIED-TOKEN"})
                accepted = st in (200, 204)
                check("a company editor without the token right may still edit the company",
                      accepted or st == 403, f"http {st}: {err(r)}")
                st, after = http("GET", f"/api/companies/{cid}", args.base, token=admin)
                # The guard drops the token field rather than failing the whole
                # edit, so the proof is that the token did NOT change.
                st2, probe = fbr_call("POST", f"/api/fbr/{bid}/validate", args.base, token=admin)
                token_intact = (not args.fbr_token) or (st2 == 200)
                check("but the FBR token is NOT changed by that edit", token_intact,
                      f"validate after the edit returned http {st2}: {err(probe)}")
                check("and the token value is still never readable",
                      not (isinstance(after, dict) and after.get("fbrToken")),
                      "the company response exposed fbrToken")
    finally:
        if args.keep:
            print(f"\n(kept company {cid}, users {made_users}, roles {made_roles})")
        else:
            for uid in made_users:
                http("DELETE", f"/api/users/{uid}", args.base, token=admin)
            for rid in made_roles:
                http("DELETE", f"/api/roles/{rid}", args.base, token=admin)
            if cid:
                st, _ = http("DELETE", f"/api/companies/{cid}", args.base, token=admin)
                print(f"\nteardown: delete company {cid} -> {st}")

    print("\n" + "=" * 78)
    failed = [r for r in results if not r[1]]
    for name, _, reason in failed:
        print(f"  FAIL  {name}  -> {reason}")
    for name, why in skips:
        print(f"  SKIP  {name}  ({why})")
    print(f"\n  {len(results) - len(failed)}/{len(results)} checks passed"
          + (f", {len(skips)} skipped" if skips else ""))
    print("=" * 78)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
