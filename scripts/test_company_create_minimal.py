#!/usr/bin/env python3
"""
A company saves with a name, and fills in FBR later (2026-09-22).

Two things are pinned here, one a feature and one a regression.

THE FEATURE. Creating a company asks for a name and nothing else. The FBR tab is
onboarding detail, not identity, and demanding a seller registration number up
front blocked someone who simply wanted the company on file. Nothing can be
FILED while it is blank — DeliveryChallanService.IsFbrReady returns false, so
challans sit in "Setup Required" and no invoice reaches PRAL — which is why the
pressure to complete it can come from the workflow instead of from the form.
The format is still enforced the moment a value IS entered, because a wrong one
fails at FBR rather than here.

THE REGRESSION. Retiring the tenant-isolation switch left the company form
sending `isTenantIsolated: null` on every save. UpdateCompanyDto was made
nullable for it; CreateCompanyDto was not, so an explicit null could not be
deserialized into its bool — "The JSON value could not be converted to
System.Boolean" — which failed the whole DTO and broke New Company outright.
It reached production. Both DTOs now accept the absence, and the form asserts
nothing about a setting it does not show.

Local only. Creates and deletes its own companies.

    python scripts/test_company_create_minimal.py --base http://localhost:5104
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime

PASS = 0
FAIL = 0
FAILURES: list[str] = []
NL = chr(10)


def check(name: str, ok: bool, detail: str = "") -> bool:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        FAILURES.append(f"{name} :: {detail}")
        print(f"  [FAIL] {name}  -- {detail}")
    return ok


def http(method: str, path: str, base: str, token: str | None = None,
         body: dict | None = None, timeout: int = 120):
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


def err(p) -> str:
    return str(p)[:200]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  COMPANY CREATION - NAME IS ENOUGH")
    print("=" * 78)

    s, d = http("POST", "/api/auth/login", base,
                body={"username": args.user, "password": args.password})
    if s != 200:
        print(f"[!] login failed: HTTP {s} {d}")
        return 2
    token = d["token"]

    stamp = datetime.now().strftime("%H%M%S%f")[:10]
    made: list[int] = []

    try:
        print(NL + "--- 1. a name is enough ---")
        s, only = http("POST", "/api/companies", base, token=token,
                       body={"name": f"_t_name_only_{stamp}"})
        if check("a company saves with nothing but a name", s in (200, 201),
                 f"{s} {err(only)}"):
            made.append(only["id"])
            check("no seller registration was invented",
                  not (only.get("fbrSellerRegistrationNo") or "").strip(),
                  f"got {only.get('fbrSellerRegistrationNo')!r}")
            check("tenant isolation defaults to off",
                  only.get("isTenantIsolated") is False,
                  f"got {only.get('isTenantIsolated')}")

        print(NL + "--- 2. the regression: an explicit null isolation flag ---")
        s, nulled = http("POST", "/api/companies", base, token=token,
                         body={"name": f"_t_null_flag_{stamp}", "isTenantIsolated": None})
        if check("create survives isTenantIsolated=null", s in (200, 201),
                 f"{s} {err(nulled)} - a non-nullable bool here breaks New Company"):
            made.append(nulled["id"])
        s, upd_null = http("PUT", f"/api/companies/{made[0]}", base, token=token,
                           body={"name": f"_t_name_only_{stamp}", "isTenantIsolated": None})
        check("update survives it too", upd_null is not None and s == 200, f"{s}")

        print(NL + "--- 3. a wrong seller number is still refused ---")
        s, bad = http("POST", "/api/companies", base, token=token,
                      body={"name": f"_t_bad_seller_{stamp}", "fbrSellerRegistrationNo": "12345"})
        check("a 5-digit seller registration is rejected", s == 400,
              f"got {s} - the format check must survive the field becoming optional")
        if s in (200, 201):
            made.append(bad["id"])

        print(NL + "--- 4. the FBR details go in afterwards ---")
        if made:
            s, _ = http("PUT", f"/api/companies/{made[0]}", base, token=token,
                        body={"name": f"_t_name_only_{stamp}",
                              "fbrSellerRegistrationNo": "4230193299489"})
            check("the seller registration can be added later", s == 200, f"got {s}")
            s, after = http("GET", f"/api/companies/{made[0]}", base, token=token)
            check("and it stuck",
                  (after or {}).get("fbrSellerRegistrationNo") == "4230193299489",
                  f"got {(after or {}).get('fbrSellerRegistrationNo')!r}")

    finally:
        print(NL + "--- cleanup ---")
        for cid in made:
            http("DELETE", f"/api/companies/{cid}", base, token=token)
        print(f"  {len(made)} temp compan(y/ies) removed")

    print(NL + "=" * 78)
    if FAIL == 0:
        print(f"  COMPANY CREATION SUITE PASSED - {PASS}/{PASS} checks")
    else:
        print(f"  COMPANY CREATION SUITE FAILED - {FAIL} of {PASS + FAIL} checks")
        for f in FAILURES:
            print(f"    - {f}")
    print("=" * 78)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
