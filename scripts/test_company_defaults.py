#!/usr/bin/env python3
"""New-company default settings — regression test.

Proves Task 1: whenever a company is created through the normal
POST /api/companies path, three defaults are applied automatically and stay
consistent between the API/DB and the create form:

  * FBR Integration   -> OFF   (FbrEnabled = false)
  * Inventory Tracking-> ON, V2 (InventoryTrackingEnabled = true, InventoryFlowVersion = 2)
  * General Ledger    -> ON    (GL enabled + Chart of Accounts seeded)

and that every one of those defaults is still OVERRIDABLE on the create
payload (so existing programmatic callers/tests can pin what they need).

Existing companies are untouched by design: the change lives only on the
create path (CompanyService.CreateAsync + CreateCompanyDto defaults); there is
no migration or backfill, and UpdateAsync is unchanged.

Read-only against existing data — it only creates two throwaway companies and
deletes them again. Run against a local backend (never production).

Usage:
  python scripts/test_company_defaults.py [--base URL] [--user U] [--pass P]
"""
from __future__ import annotations
import argparse, json, sys, urllib.request, urllib.error


def http(method: str, path: str, base: str, token: str | None = None, body=None):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except urllib.error.URLError as e:
        return 0, str(e)


PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((PASS if ok else FAIL, name, detail))
    print(f"  [{PASS if ok else FAIL}] {name}" + (f"  ({detail})" if detail else ""))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--pass", dest="pw", default="admin123")
    args = ap.parse_args()
    base = args.base

    st, data = http("POST", "/api/auth/login", base, body={"username": args.user, "password": args.pw})
    if st != 200 or not isinstance(data, dict) or "token" not in data:
        print(f"FATAL: admin login failed ({st} {data})")
        return 2
    token = data["token"]
    print("logged in\n")

    created_ids: list[int] = []
    import time
    suffix = time.strftime("%Y%m%d%H%M%S")

    try:
        # ── 1. Create OMITTING the three flags -> backend defaults apply ──
        print("=== Company A: created with NO inventory/FBR/GL fields (defaults) ===")
        st, a = http("POST", "/api/companies", base, token=token, body={
            "name": f"_defaults_A {suffix}",
            "fullAddress": "Test HQ",
            "startingInvoiceNumber": 1,
        })
        if st not in (200, 201) or not isinstance(a, dict):
            print(f"FATAL: create A failed ({st} {a})")
            return 2
        created_ids.append(a["id"])
        print(f"  company id={a['id']}")

        check("A: FBR integration OFF by default", a.get("fbrEnabled") is False,
              f"fbrEnabled={a.get('fbrEnabled')}")
        check("A: Inventory tracking ON by default", a.get("inventoryTrackingEnabled") is True,
              f"inventoryTrackingEnabled={a.get('inventoryTrackingEnabled')}")
        check("A: Inventory uses V2 by default", a.get("inventoryFlowVersion") == 2,
              f"inventoryFlowVersion={a.get('inventoryFlowVersion')}")
        check("A: GL enabled by default (default sales account pinned)",
              a.get("defaultSalesAccountId") is not None,
              f"defaultSalesAccountId={a.get('defaultSalesAccountId')}")

        # Persisted values match (GET back)
        st, ag = http("GET", f"/api/companies/{a['id']}", base, token=token)
        check("A: persisted GET matches (FBR off / inv on / V2)",
              st == 200 and ag.get("fbrEnabled") is False
              and ag.get("inventoryTrackingEnabled") is True
              and ag.get("inventoryFlowVersion") == 2,
              f"status={st}")

        # GL status endpoint confirms posting on + Chart of Accounts seeded
        st, gl = http("GET", f"/api/accounting/gl/company/{a['id']}/status", base, token=token)
        if st == 200 and isinstance(gl, dict):
            check("A: GL posting enabled", gl.get("enabled") is True, f"enabled={gl.get('enabled')}")
            check("A: Chart of Accounts seeded", bool(gl.get("hasCoa")) and (gl.get("accountCount") or 0) > 0,
                  f"hasCoa={gl.get('hasCoa')} accountCount={gl.get('accountCount')}")
        else:
            check("A: GL status endpoint reachable", False, f"status={st} {gl}")

        # ── 2. Create WITH explicit overrides -> defaults are overridable ──
        print("\n=== Company B: created with explicit overrides (FBR on, inv off/V1, GL off) ===")
        st, b = http("POST", "/api/companies", base, token=token, body={
            "name": f"_defaults_B {suffix}",
            "fullAddress": "Test HQ",
            "startingInvoiceNumber": 1,
            "fbrEnabled": True,
            "inventoryTrackingEnabled": False,
            "inventoryFlowVersion": 1,
            "stockGuardHardBlock": False,
            "enableGl": False,
        })
        if st not in (200, 201) or not isinstance(b, dict):
            print(f"FATAL: create B failed ({st} {b})")
            return 2
        created_ids.append(b["id"])
        print(f"  company id={b['id']}")

        check("B: FBR override honored (ON)", b.get("fbrEnabled") is True,
              f"fbrEnabled={b.get('fbrEnabled')}")
        check("B: Inventory override honored (OFF)", b.get("inventoryTrackingEnabled") is False,
              f"inventoryTrackingEnabled={b.get('inventoryTrackingEnabled')}")
        check("B: Flow-version override honored (V1)", b.get("inventoryFlowVersion") == 1,
              f"inventoryFlowVersion={b.get('inventoryFlowVersion')}")
        check("B: GL-off override honored (no default sales account)",
              b.get("defaultSalesAccountId") is None,
              f"defaultSalesAccountId={b.get('defaultSalesAccountId')}")
        st, glb = http("GET", f"/api/accounting/gl/company/{b['id']}/status", base, token=token)
        if st == 200 and isinstance(glb, dict):
            check("B: GL posting stays OFF", glb.get("enabled") is False, f"enabled={glb.get('enabled')}")

    finally:
        print("\n=== Cleanup ===")
        for cid in created_ids:
            st, _ = http("DELETE", f"/api/companies/{cid}", base, token=token)
            print(f"  delete company {cid} -> {st}")

    fails = [r for r in results if r[0] == FAIL]
    print(f"\n{'='*48}\n{len(results) - len(fails)}/{len(results)} checks passed")
    if fails:
        print("FAILURES:")
        for _, name, detail in fails:
            print(f"  - {name}  {detail}")
        print("\nRESULT: FAIL")
        return 1
    print("RESULT: all PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
