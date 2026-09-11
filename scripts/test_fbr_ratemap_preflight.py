"""
Regression test for two FBR payload fixes (2026-09-11):

  1. Exempt goods must be filed with rate "Exempt", NOT "0%".
     FBR rejects "0%" for an exempt sale type with [0046]. Asserted against the
     built payload via GET /api/fbr/{id}/preview-payload (no FBR round-trip).

  2. The "Rate != 18% requires SRO Schedule reference" pre-flight (0077) must
     NOT fire for Processing/Conversion (SN016) or Goods-FED-in-ST-Mode (SN017):
     FBR's own sample payloads for those scenarios carry no SRO. Asserted by
     calling POST /api/fbr/{id}/validate and confirming the response does not
     contain the local SRO pre-flight message (whatever FBR then says is fine —
     [0052] on SN017 is an FBR-side reference issue, not this pre-flight).

Setup: the target company must have been seeded with the applicable scenario
bills (scripts/seed_fbr_scenarios.py --company-id N) and its items set to the
scenario data, and must carry a sandbox FBR token (same prerequisites as
scripts/verify_fbr_scenarios.py). This test does not itself call FBR for fix 1.

Usage:
    python scripts/test_fbr_ratemap_preflight.py --base-url http://localhost:5135 --company-id 3
"""
import argparse, json, sys
from urllib import request as urlreq, error as urlerr

SRO_PREFLIGHT_MARKER = "requires SRO Schedule reference"


def call(base, method, path, token=None, timeout=90):
    req = urlreq.Request(base.rstrip("/") + path, method=method,
                         headers={"Authorization": f"Bearer {token}"} if token else {})
    try:
        with urlreq.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urlerr.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def login(base, user, pw):
    import urllib.request as U
    data = json.dumps({"username": user, "password": pw}).encode()
    req = U.Request(base.rstrip("/") + "/api/auth/login", data=data, method="POST",
                    headers={"Content-Type": "application/json"})
    return json.loads(U.urlopen(req).read())["token"]


def find_bills_by_sn(base, token, company_id):
    _, bills = call(base, "GET", f"/api/invoices/company/{company_id}", token)
    out = {}
    for b in bills or []:
        pt = (b.get("paymentTerms") or "")
        if pt.startswith("[SN") and "]" in pt:
            out[pt.split("]")[0].lstrip("[")] = b
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:5135")
    ap.add_argument("--company-id", type=int, default=3)
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()

    token = login(args.base_url, args.user, args.password)
    sn = find_bills_by_sn(args.base_url, token, args.company_id)

    passed, failed = 0, 0

    def check(name, ok, detail=""):
        nonlocal passed, failed
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}{('  -> ' + detail) if detail and not ok else ''}")
        if ok:
            passed += 1
        else:
            failed += 1

    print("FBR rate-map + SRO pre-flight regression")
    print("-" * 60)

    # Fix 1 — exempt goods carry rate "Exempt" in the built payload.
    ex = sn.get("SN006")
    if not ex:
        check("SN006 exempt bill present (seed first)", False, "no [SN006] bill")
    else:
        _, prev = call(args.base_url, "GET",
                       f"/api/fbr/{ex['id']}/preview-payload?scenarioId=SN006", token)
        rate = None
        try:
            payload = json.loads(prev["preview"]["json"])
            rate = (payload["items"][0].get("rate") or "")
        except Exception as e:
            check("SN006 preview payload readable", False, str(e))
        if rate is not None:
            check("SN006 exempt payload rate == 'Exempt' (not '0%')",
                  rate.strip().lower() == "exempt", f"rate was '{rate}'")

    # Fix 3 — FED-in-ST carries the compound ratE_DESC from SaleTypeToRate
    # (e.g. "18% and Rs. 80 per Liter"), never a plain "18%", and the per-unit
    # FED is folded into salesTaxApplicable. Requires the SN017 bill set to a
    # Second-Schedule petroleum HS (2710.1942) at 18%.
    fed = sn.get("SN017")
    if not fed:
        check("SN017 bill present (seed first)", False, "no [SN017] bill")
    else:
        _, prev = call(args.base_url, "GET",
                       f"/api/fbr/{fed['id']}/preview-payload?scenarioId=SN017", token)
        try:
            it = json.loads(prev["preview"]["json"])["items"][0]
            rate = it.get("rate") or ""
            stax = float(it.get("salesTaxApplicable") or 0)
            val = float(it.get("valueSalesExcludingST") or 0)
        except Exception as e:
            check("SN017 preview payload readable", False, str(e))
            rate = None
        if rate is not None:
            check("SN017 FED rate is the compound ratE_DESC, not a plain '%'",
                  ("rs." in rate.lower()) or ("per" in rate.lower()), f"rate was '{rate}'")
            # salesTaxApplicable must exceed the plain 18% ad-valorem (the
            # per-litre FED is added on top).
            check("SN017 salesTaxApplicable includes the per-unit FED",
                  stax > round(val * 0.18, 2) + 0.001, f"stax={stax} val={val}")

    # Fix 2 — SRO pre-flight must not block Processing (SN016) / FED (SN017).
    for code in ("SN016", "SN017"):
        b = sn.get(code)
        if not b:
            check(f"{code} bill present (seed first)", False, f"no [{code}] bill")
            continue
        _, res = call(args.base_url, "POST", f"/api/fbr/{b['id']}/validate?scenarioId={code}", token)
        msg = (res.get("errorMessage") or "") if isinstance(res, dict) else str(res)
        check(f"{code} not blocked by the local SRO pre-flight",
              SRO_PREFLIGHT_MARKER not in msg, f"got: {msg[:80]}")

    print("-" * 60)
    print(f"{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
