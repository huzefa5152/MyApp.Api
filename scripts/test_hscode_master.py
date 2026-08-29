"""
HS Code master + FBR-independence suite.

Proves the property the feature exists for: HS code reference data, item-type
classification and UOM selection all work for a company whose FBR integration
is OFF, and the import is a safe-to-repeat upsert rather than a blind insert.

    python scripts/test_hscode_master.py --base http://localhost:5134

The import case needs an FBR reference token. Provide one with --fbr-token (or
the FBR_REFERENCE_TOKEN environment variable) to exercise the live PRAL fetch;
without it, the import cases are reported as SKIPPED and the local-master cases
still run against whatever the master already holds.

Nothing here writes to an existing tenant: it creates its own throwaway company
(FBR off) and its own item types, and it never enables FBR anywhere.
"""

import argparse
import os
import sys
import time
import uuid

import requests

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
results = []


def check(name, ok, detail=""):
    results.append((PASS if ok else FAIL, name, detail))
    print(f"[{PASS if ok else FAIL}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def skip(name, why):
    results.append((SKIP, name, why))
    print(f"[{SKIP}] {name} — {why}")


def login(base, username, password):
    r = requests.post(f"{base}/api/auth/login",
                      json={"username": username, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--fbr-token", default=os.environ.get("FBR_REFERENCE_TOKEN"),
                    help="FBR token used ONLY to read the tariff catalog.")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    token = login(base, args.username, args.password)
    h = {"Authorization": f"Bearer {token}"}
    api = f"{base}/api"

    # ── 1. A brand-new company starts with FBR integration OFF ──────────
    suffix = uuid.uuid4().hex[:8]
    company_payload = {
        "name": f"HS Suite Co {suffix}",
        "brandName": "HSSUITE",
        "fullAddress": "1 Test Street, Karachi",
        "phone": "021-0000000",
        "ntn": "1234567-8",
        "startingChallanNumber": 1,
        "startingInvoiceNumber": 1,
        "startingSalesQuoteNumber": 1,
        "startingSalesOrderNumber": 1,
        # fbrEnabled deliberately omitted — the default is what we are testing.
    }
    r = requests.post(f"{api}/companies", json=company_payload, headers=h, timeout=60)
    if r.status_code not in (200, 201):
        check("create throwaway company", False, f"http {r.status_code}: {r.text[:200]}")
        return report()
    company = r.json()
    company_id = company["id"]
    check("new company defaults to FBR integration OFF",
          company.get("fbrEnabled") is False,
          f"fbrEnabled={company.get('fbrEnabled')}")
    check("new company has no FBR token",
          not company.get("fbrToken"), f"token={company.get('fbrToken')!r}")

    # ── 2. Import: needs a token, is an upsert, is repeatable ───────────
    before = requests.get(f"{api}/hscodes/count", headers=h, timeout=30).json()["count"]

    if args.fbr_token:
        r = requests.put(f"{api}/hscodes/reference-token",
                         json={"token": args.fbr_token, "environment": "sandbox"},
                         headers=h, timeout=60)
        status = r.json() if r.ok else {}
        check("reference token saves and reads back masked",
              r.ok and status.get("isConfigured") is True
              and args.fbr_token not in r.text,
              f"preview={status.get('preview')}")

        t0 = time.time()
        r = requests.post(f"{api}/hscodes/import",
                          json={"createItemTypes": True}, headers=h, timeout=900)
        first = r.json() if r.ok else {}
        check("import returns a summary", r.ok and "totalReceived" in first,
              f"http {r.status_code}")
        check("import received codes from FBR", first.get("totalReceived", 0) > 0,
              f"received={first.get('totalReceived')} in {time.time() - t0:.1f}s")

        r = requests.post(f"{api}/hscodes/import",
                          json={"createItemTypes": True}, headers=h, timeout=900)
        second = r.json() if r.ok else {}
        # THE idempotency guarantee: a second run must add nothing and must
        # report every code as already existing.
        check("second import adds no duplicate HS codes",
              second.get("added") == 0,
              f"added={second.get('added')}")
        check("second import reports the codes as already existing",
              second.get("alreadyExisting", 0) == second.get("totalReceived", -1),
              f"existing={second.get('alreadyExisting')} of {second.get('totalReceived')}")
        check("second import creates no duplicate item types",
              second.get("itemTypesCreated") == 0,
              f"created={second.get('itemTypesCreated')}")

        after = requests.get(f"{api}/hscodes/count", headers=h, timeout=30).json()["count"]
        check("master row count is stable across repeated imports",
              after == before + first.get("added", 0),
              f"{before} + {first.get('added')} = {after}")
    else:
        skip("import cases", "no --fbr-token / FBR_REFERENCE_TOKEN supplied")

    # ── 3. Master search — no FBR involvement ──────────────────────────
    total = requests.get(f"{api}/hscodes/count", headers=h, timeout=30).json()["count"]
    if total == 0:
        skip("master search cases", "HS master is empty (run the import first)")
        return report()

    sample = requests.get(f"{api}/hscodes", params={"take": 1}, headers=h, timeout=30).json()
    code = sample[0]["code"]
    word = (sample[0].get("description") or "").split()[0][:8]

    r = requests.get(f"{api}/hscodes", params={"search": code, "take": 5}, headers=h, timeout=30)
    check("search by HS code returns the code",
          r.ok and any(x["code"] == code for x in r.json()), f"code={code}")

    if word:
        r = requests.get(f"{api}/hscodes", params={"search": word, "take": 5}, headers=h, timeout=30)
        check("search by description returns matches", r.ok and len(r.json()) > 0,
              f"term={word!r} hits={len(r.json()) if r.ok else 0}")

    # ── 4. Classify an item type on the FBR-OFF company ────────────────
    name = f"HS Suite Item {suffix}"
    r = requests.post(f"{api}/itemtypes", params={"companyId": company_id},
                      json={"name": name, "hsCode": code, "isFavorite": True},
                      headers=h, timeout=120)
    created = r.json() if r.ok else {}
    check("item type with an HS code saves for an FBR-OFF company",
          r.ok and created.get("hsCode") == code,
          f"http {r.status_code}: {str(r.text)[:160]}")

    if created.get("id"):
        r = requests.get(f"{api}/hscodes/{code}/uoms", headers=h, timeout=120)
        check("UOMs for a code are served without company FBR credentials", r.ok,
              f"http {r.status_code}, {len(r.json()) if r.ok else 0} uom(s)")

        # Renaming a placeholder keeps its HS code — the flow requirement 4
        # promises: "HS Code 6109.1000" → "Cotton T-Shirt", code unchanged.
        renamed = f"Renamed {suffix}"
        r = requests.put(f"{api}/itemtypes/{created['id']}", params={"companyId": company_id},
                         json={"id": created["id"], "name": renamed, "hsCode": code,
                               "uom": created.get("uom"), "isFavorite": True},
                         headers=h, timeout=120)
        after_rename = r.json() if r.ok else {}
        check("renaming an item type keeps its HS code",
              r.ok and after_rename.get("name") == renamed and after_rename.get("hsCode") == code,
              f"name={after_rename.get('name')} hs={after_rename.get('hsCode')}")

        requests.delete(f"{api}/itemtypes/{created['id']}", headers=h, timeout=60)

    # ── 5. A code outside the master is rejected ───────────────────────
    r = requests.post(f"{api}/itemtypes", params={"companyId": company_id},
                      json={"name": f"Bogus {suffix}", "hsCode": "0000.0001", "isFavorite": True},
                      headers=h, timeout=60)
    check("an HS code missing from the master is rejected", r.status_code == 400,
          f"http {r.status_code}")

    return report()


def report():
    failed = [r for r in results if r[0] == FAIL]
    passed = [r for r in results if r[0] == PASS]
    skipped = [r for r in results if r[0] == SKIP]
    print(f"\n{len(passed)} passed, {len(failed)} failed, {len(skipped)} skipped")
    if failed:
        print("FAILURES:")
        for _, name, detail in failed:
            print(f"  - {name}: {detail}")
        return 1
    print("all PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
