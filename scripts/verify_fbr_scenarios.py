"""
Full FBR scenario verification — run this AFTER PRAL approves the token/NTN
binding and IP whitelisting.

What it does:
  1. Logs into the local app as admin
  2. Finds the Hakimi Traders FBR Sandbox company (by name)
  3. For each SN-tagged bill in that company:
       a. Validates against FBR (POST /api/fbr/{id}/validate?scenarioId=SNxxx)
       b. If validation passes → submits (POST /api/fbr/{id}/submit?scenarioId=SNxxx)
       c. Records the IRN, status, and any FBR error
  4. Prints a per-scenario pass/fail summary table
  5. Exits non-zero if any scenario didn't reach the expected terminal state

Expected FBR outcomes when token + NTN binding are correct:
  SN001  →  Valid (IRN issued)
  SN002  →  Valid (IRN issued)
  SN008  →  Valid (IRN issued)
  SN026  →  Valid (IRN issued)
  SN027  →  Valid (IRN issued)
  SN028  →  Valid (IRN issued)   [or "Goods at Reduced Rate" SRO-specific rejection]

PRAL promotes your sandbox to production once each of SN001/002/008/026/027/028
has at least one successful submission logged against your NTN.

Usage:
  python scripts/verify_fbr_scenarios.py
  python scripts/verify_fbr_scenarios.py --base-url https://hakimitraders.runasp.net
  python scripts/verify_fbr_scenarios.py --dry-run          # validate only, no submit
  python scripts/verify_fbr_scenarios.py --submit-only      # skip validate, go straight to submit
"""
import argparse, json, sys, time
from urllib import request as urlreq, error as urlerr

DEMO_COMPANY_NAME = "Hakimi Traders FBR Sandbox"

# Scenarios we expect to see on the Sandbox company, in the order they map to
# the Wholesaler + Wholesale/Retails row of Section 10 of the FBR tech doc.
EXPECTED_SCENARIOS = ["SN001", "SN002", "SN008", "SN026", "SN027", "SN028"]


def api_call(base_url, method, path, token=None, body=None, timeout=60):
    url = base_url.rstrip("/") + path
    headers = {}
    data = None
    if token: headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urlreq.Request(url, data=data, method=method, headers=headers)
    try:
        with urlreq.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else None)
    except urlerr.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:5134")
    ap.add_argument("--user",     default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--dry-run",    action="store_true", help="validate only, don't submit")
    ap.add_argument("--submit-only",action="store_true", help="skip validate, go straight to submit")
    ap.add_argument("--company-name", default=DEMO_COMPANY_NAME)
    args = ap.parse_args()

    print(f"[*] Logging in to {args.base_url}")
    status, body = api_call(args.base_url, "POST", "/api/auth/login",
                            body={"username": args.user, "password": args.password})
    if status != 200:
        sys.exit(f"[!] Login failed: HTTP {status} {body}")
    token = body["token"]

    print(f"[*] Resolving company '{args.company_name}'")
    status, companies = api_call(args.base_url, "GET", "/api/companies", token=token)
    if status != 200:
        sys.exit(f"[!] Could not list companies: HTTP {status} {companies}")
    demo = next((c for c in companies if c.get("name") == args.company_name), None)
    if not demo:
        sys.exit(f"[!] Company '{args.company_name}' not found. "
                 f"Run scripts/seed_fbr_scenarios.py first.")
    company_id = demo["id"]
    has_token = demo.get("hasFbrToken")
    if not has_token:
        sys.exit(f"[!] Company {company_id} has no FBR token set. "
                 f"Configure via Company Settings first.")

    print(f"[*] Fetching bills for company {company_id}")
    status, bills = api_call(args.base_url, "GET", f"/api/invoices/company/{company_id}", token=token)
    if status != 200:
        sys.exit(f"[!] Could not list bills: HTTP {status} {bills}")

    # Map each bill tagged with an SN to its invoice id
    sn_to_bill = {}
    for b in bills:
        pt = (b.get("paymentTerms") or "")
        if pt.startswith("[SN") and "]" in pt:
            sn = pt.split("]")[0].lstrip("[")
            sn_to_bill[sn] = b

    missing = [sn for sn in EXPECTED_SCENARIOS if sn not in sn_to_bill]
    if missing:
        print(f"[!] Missing scenarios: {', '.join(missing)}. Run seed_fbr_scenarios.py first.")

    print()
    print("=" * 90)
    print(f"  FBR SCENARIO VERIFICATION — Company '{args.company_name}' (id={company_id})")
    print(f"  Mode: " + ("submit-only" if args.submit_only else "dry-run (validate only)" if args.dry_run else "full (validate + submit)"))
    print("=" * 90)
    print()
    print(f"{'SN':<6}  {'Bill #':<8}  {'VALIDATE':<10}  {'SUBMIT':<10}  {'IRN':<28}  ERROR")
    print("-" * 130)

    results = []
    for sn in EXPECTED_SCENARIOS:
        bill = sn_to_bill.get(sn)
        if not bill:
            print(f"{sn:<6}  {'—':<8}  {'MISSING':<10}  {'—':<10}  {'':<28}  (no bill for this scenario)")
            results.append((sn, "missing", "missing", None, "no bill"))
            continue

        iid = bill["id"]
        num = str(bill["invoiceNumber"])

        # 1) Validate
        v_outcome, v_irn, v_error = "skipped", None, ""
        if not args.submit_only:
            s, r = api_call(args.base_url, "POST", f"/api/fbr/{iid}/validate?scenarioId={sn}", token=token)
            if s == 200 and isinstance(r, dict):
                if r.get("success"): v_outcome = "PASS"
                else:
                    v_outcome = "FAIL"
                    v_error = (r.get("errorMessage") or "")[:70]
            else:
                v_outcome = f"HTTP{s}"
                v_error = str(r)[:70]

        # 2) Submit (only if validate passed or in submit-only mode)
        sub_outcome, sub_irn, sub_error = "skipped", None, ""
        should_submit = (args.submit_only) or (not args.dry_run and v_outcome == "PASS")
        if should_submit:
            s, r = api_call(args.base_url, "POST", f"/api/fbr/{iid}/submit?scenarioId={sn}", token=token)
            if s == 200 and isinstance(r, dict):
                if r.get("success"):
                    sub_outcome = "PASS"; sub_irn = r.get("irn") or ""
                else:
                    sub_outcome = "FAIL"
                    sub_error = (r.get("errorMessage") or "")[:70]
            else:
                sub_outcome = f"HTTP{s}"
                sub_error = str(r)[:70]

        err = sub_error or v_error
        irn_display = sub_irn or v_irn or ""
        print(f"{sn:<6}  {num:<8}  {v_outcome:<10}  {sub_outcome:<10}  {irn_display:<28}  {err}")
        results.append((sn, v_outcome, sub_outcome, sub_irn, err))

        # Gentle pace — FBR rate-limits per-token
        time.sleep(0.5)

    print()
    print("=" * 90)
    # Summary counts
    if args.submit_only:
        ok = sum(1 for _,_,sub,_,_ in results if sub == "PASS")
    else:
        ok = sum(1 for _,v,_,_,_ in results if v == "PASS")
    fail = len(results) - ok
    print(f"  Summary: {ok}/{len(results)} scenarios passed, {fail} failed")
    print("=" * 90)
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
