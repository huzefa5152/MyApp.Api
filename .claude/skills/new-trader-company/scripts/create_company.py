"""
Create (or reconcile) a company on the LOCAL Trader database with the standard
FBR sandbox profile used for scenario testing:

    Business Activity = Wholesaler
    Sector            = Wholesale / Retails
    Environment       = sandbox

That Activity × Sector pair maps to FBR's six wholesaler scenarios
(SN001, SN002, SN008, SN026, SN027, SN028), which is exactly what
scripts/seed_fbr_scenarios.py + scripts/verify_fbr_scenarios.py already cover.

Re-run safe: if a company with the same name already exists it is reused (and,
if --token is given, its FBR token is refreshed) rather than duplicated.

Usage:
    python create_company.py --base-url http://localhost:5136 \
        --name "Saify Enterprises" --cnic 4230111225139 [--ntn 1234567] \
        [--token <fbr-sandbox-token>] [--province 8]
"""
import argparse, json, sys
from urllib import request as urlreq, error as urlerr

ACTIVITY = "Wholesaler"
SECTOR = "Wholesale / Retails"


def call(base, method, path, token=None, body=None, timeout=60):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urlreq.Request(url, data=data, method=method, headers=headers)
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
    s, d = call(base, "POST", "/api/auth/login", body={"username": user, "password": pw})
    if s != 200:
        sys.exit(f"[!] login failed: HTTP {s} {d}")
    return d["token"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:5136")
    ap.add_argument("--name", required=True)
    ap.add_argument("--cnic", default=None)
    ap.add_argument("--ntn", default=None)
    ap.add_argument("--strn", default=None)
    ap.add_argument("--address", default="Karachi")
    ap.add_argument("--phone", default=None)
    ap.add_argument("--province", type=int, default=8, help="FBR province code; 8 = Sindh")
    ap.add_argument("--token", default=None, help="FBR sandbox token (bound to this company's NTN/CNIC at PRAL)")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()

    token = login(args.base_url, args.user, args.password)

    # Reuse an existing company of the same name (idempotent).
    _, companies = call(args.base_url, "GET", "/api/companies", token)
    existing = next((c for c in (companies or []) if c.get("name") == args.name), None)

    if existing:
        cid = existing["id"]
        print(f"[=] Company '{args.name}' already exists (id={cid}) — reusing.")
        if args.token or args.ntn or args.strn:
            # Refresh the FBR profile via a faithful echo update (only the fields
            # we intend to set are changed). NTN + STRN + token are what make the
            # company FBR-ready, so a challan can be billed instead of parking in
            # "Setup Required".
            payload = dict(existing)
            if args.token:
                payload["fbrToken"] = args.token
            if args.ntn:
                payload["ntn"] = args.ntn
            if args.strn:
                payload["strn"] = args.strn
            payload["fbrEnvironment"] = "sandbox"
            payload["fbrBusinessActivity"] = ACTIVITY
            payload["fbrSector"] = SECTOR
            payload.pop("logoPath", None)
            s, _ = call(args.base_url, "PUT", f"/api/companies/{cid}", token, payload)
            print(f"[+] FBR profile refresh (ntn/strn/token) -> HTTP {s}")
    else:
        body = {
            "name": args.name,
            "brandName": args.name,
            "fullAddress": args.address,
            "phone": args.phone,
            "ntn": args.ntn,
            "cnic": args.cnic,
            "strn": args.strn,
            # Numbering must start at a positive value or bill creation refuses.
            "startingChallanNumber": 1,
            "startingInvoiceNumber": 1,
            "startingDebitNoteNumber": 1,
            "startingCreditNoteNumber": 1,
            "startingPurchaseBillNumber": 1,
            "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1,
            "startingSalesOrderNumber": 1,
            "fbrProvinceCode": args.province,
            "fbrBusinessActivity": ACTIVITY,
            "fbrSector": SECTOR,
            "fbrEnvironment": "sandbox",
            "fbrToken": args.token,       # nulled server-side if the caller lacks companies.manage.fbrtoken
            "inventoryTrackingEnabled": False,
        }
        s, d = call(args.base_url, "POST", "/api/companies", token, body)
        if s not in (200, 201):
            sys.exit(f"[!] create failed: HTTP {s} {d}")
        cid = d["id"]
        print(f"[+] Created '{args.name}' (id={cid}) — {ACTIVITY} / {SECTOR} / sandbox"
              + (", token set" if args.token else ", NO token yet"))

    # Show the scenarios FBR considers applicable to this profile.
    s, appl = call(args.base_url, "GET", f"/api/fbr/scenarios/applicable/{cid}", token)
    codes = [x.get("code") for x in (appl if isinstance(appl, list) else (appl or {}).get("scenarios", []))]
    print(f"[i] Applicable FBR scenarios ({len(codes)}): {', '.join(codes)}")
    # Emit the id on the last line so a wrapper can capture it.
    print(f"COMPANY_ID={cid}")
    return cid


if __name__ == "__main__":
    main()
