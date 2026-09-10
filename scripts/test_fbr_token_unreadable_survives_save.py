"""
An FBR token the key ring cannot read must survive an unrelated Company save.

Company.FbrToken is encrypted at rest through an EF value converter
(Helpers/FbrTokenProtector.cs). When the DataProtection key ring cannot
decrypt an `enc:v1:` payload, Unprotect returns null and the Company row is
materialised with FbrToken = null. Until 2026-09-10 any later save of that row
-- and `_context.Companies.Update(company)` marks EVERY column modified, which
is how invoice numbering saves the company -- wrote that null back and
destroyed the ciphertext for good. A key ring that merely could not read the
token turned into a token that no longer existed, silently, on the first bill.

AppDbContext.SaveChanges now drops FbrToken from a Modified Company when its
CLR value is null: null is never an explicit write (the API clears a token
with "" and treats null as "no change"), so it can only mean "unreadable" or
"was already null", and neither is a reason to touch the column.

This suite fakes an unreadable token by writing an `enc:v1:` payload no key
ring can decrypt straight into the column (which is why it needs --db), then
proves:

  * reading the company fails closed (hasFbrToken = false), no crash
  * an unrelated company edit leaves the ciphertext byte-for-byte intact
  * creating a bill (the numbering save that lost the real token) leaves it intact
  * an explicit token write through companies.manage.fbrtoken still replaces it
  * an explicit clear ("") still clears it

Usage:
  python scripts/test_fbr_token_unreadable_survives_save.py --base http://localhost:5135 \
      --db "Server=.\\MSSQLSERVER02;Database=MyApp_Importer_Local;Trusted_Connection=True"
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

# Looks like a real payload (same marker prefix, base64url alphabet) but was
# never produced by any key ring, so IDataProtector.Unprotect throws on it.
UNREADABLE = "enc:v1:CfDJ8LostKeyRing0000000000000000000000000000000000000000000000000000"

results: list[tuple[str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, "PASS" if ok else f"FAIL - {detail}"))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{'' if ok else '  <- ' + detail}")
    return ok


def http(method: str, path: str, base: str, token: str | None = None,
         body: Any = None, timeout: int = 60) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base.rstrip("/") + path, data=data,
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            return e.code, json.loads(raw) if raw else None
        except Exception:
            return e.code, raw


def sql(conn: str, query: str) -> str:
    """Run one statement through sqlcmd (Windows auth). Returns trimmed stdout."""
    server, db = "", ""
    for part in conn.split(";"):
        k, _, v = part.partition("=")
        k = k.strip().lower()
        if k in ("server", "data source"):
            server = v.strip()
        elif k in ("database", "initial catalog"):
            db = v.strip()
    out = subprocess.run(
        ["sqlcmd", "-S", server, "-d", db, "-E", "-C", "-I", "-h", "-1", "-W",
         "-Q", "SET NOCOUNT ON; " + query],
        capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise RuntimeError(f"sqlcmd failed: {out.stdout} {out.stderr}")
    return (out.stdout or "").strip()


def stored_token(conn: str, company_id: int) -> str | None:
    """The raw column value, or None for SQL NULL."""
    raw = sql(conn, f"SELECT ISNULL(FbrToken, '<NULL>') FROM Companies WHERE Id = {int(company_id)}")
    return None if raw == "<NULL>" else raw


def set_stored_token(conn: str, company_id: int, value: str) -> None:
    # The suite is the only writer of this literal and it never contains a quote.
    assert "'" not in value
    sql(conn, f"UPDATE Companies SET FbrToken = '{value}' WHERE Id = {int(company_id)}")


def update_payload(company: dict, **overrides: Any) -> dict:
    """The GET shape is a superset of UpdateCompanyDto; unknown keys are ignored
    by model binding. `hasFbrToken` is a read-only flag, never a token value.
    fbrToken is absent (null) unless an override supplies one: that is exactly
    what the company form sends when the token field is left blank."""
    body = {k: v for k, v in company.items() if k not in ("id", "hasFbrToken", "fbrToken")}
    body.update(overrides)
    return body


def first_item_type_id(base: str, token: str) -> int | None:
    _, its = http("GET", "/api/itemtypes", base, token=token)
    rows = its if isinstance(its, list) else ((its or {}).get("items") or (its or {}).get("data") or [])
    return rows[0]["id"] if rows else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--db", required=True, help="connection string, to plant the unreadable payload and read the column back")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true", help="leave the ephemeral company in place")
    args = ap.parse_args()
    base = args.base

    st, auth = http("POST", "/api/auth/login", base,
                    body={"username": args.username, "password": args.password})
    if st != 200:
        print(f"FATAL: login failed ({st} {auth})")
        return 2
    token = auth["token"]

    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    print(f"\n=== Ephemeral company _test_fbr_token {suffix} ===")
    st, company = http("POST", "/api/companies", base, token=token, body={
        "name": f"_test_fbr_token {suffix}",
        "fullAddress": "Test HQ",
        "phone": "+92-21-00000000",
        "ntn": "9999999",
        "cnic": "9999999999999",
        "strn": "9999999999999",
        "startingChallanNumber": 1,
        "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1,
        "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox",
        "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Manufacturer",
        "fbrSector": "All Other Sectors",
        "fbrToken": "plaintext-token-typed-by-the-operator",
        "fbrEnabled": True,
        "inventoryTrackingEnabled": False,
        "enableGl": False,
    })
    if st not in (200, 201):
        print(f"FATAL: create company failed ({st} {company})")
        return 2
    cid = company["id"]
    print(f"  company id={cid}")

    try:
        print("\n=== 1. Baseline: the token is encrypted at rest and readable ===")
        at_rest = stored_token(args.db, cid)
        check("stored value carries the enc:v1: marker", (at_rest or "").startswith("enc:v1:"), f"stored={at_rest!r}")
        check("stored value is not the plaintext", at_rest != "plaintext-token-typed-by-the-operator")
        st, got = http("GET", f"/api/companies/{cid}", base, token=token)
        check("GET reports hasFbrToken = true", st == 200 and got.get("hasFbrToken") is True, f"{st} {got}")

        print("\n=== 2. Plant a payload no key ring can decrypt ===")
        set_stored_token(args.db, cid, UNREADABLE)
        check("planted", stored_token(args.db, cid) == UNREADABLE)
        st, got = http("GET", f"/api/companies/{cid}", base, token=token)
        check("GET still 200 (unreadable token does not break the read)", st == 200, f"{st} {got}")
        check("GET reports hasFbrToken = false (fails closed)", st == 200 and got.get("hasFbrToken") is False,
              f"hasFbrToken={got.get('hasFbrToken') if isinstance(got, dict) else got}")

        print("\n=== 3. An unrelated company edit must not touch the column ===")
        st, upd = http("PUT", f"/api/companies/{cid}", base, token=token,
                       body=update_payload(got, phone="+92-21-11111111"))
        check("PUT /api/companies (token field left blank) returns 200", st == 200, f"{st} {upd}")
        check("edit landed (phone changed)", st == 200 and upd.get("phone") == "+92-21-11111111", f"{upd}")
        after = stored_token(args.db, cid)
        check("unreadable ciphertext survives the company edit byte-for-byte", after == UNREADABLE,
              f"stored={after!r}")

        print("\n=== 4. Creating a bill bumps the company's numbering; the column must still not move ===")
        st, client = http("POST", "/api/clients", base, token=token, body={
            "name": f"Test Client {suffix}",
            "address": "1 Test Road, Karachi",
            "phone": "021-1234567",
            "companyId": cid,
            "ntn": "1234567",
            "strn": "1234567890123",
            "fbrProvinceCode": 8,
            "registrationType": "Registered",
        })
        if check("client created", st in (200, 201), f"{st} {client}"):
            pkt_today = (datetime.now(timezone.utc) + timedelta(hours=5)).strftime("%Y-%m-%d")
            st, bill = http("POST", "/api/invoices/standalone", base, token=token, body={
                "date": pkt_today,
                "companyId": cid,
                "clientId": client["id"],
                "gstRate": 18,
                "items": [{"description": "Service Charge", "quantity": 1, "uom": "Pcs",
                           "unitPrice": 500, "itemTypeId": first_item_type_id(base, token)}],
            })
            check("standalone bill created (invoice numbering saved the company)", st in (200, 201), f"{st} {bill}")
            check("bill got a number", st in (200, 201) and (bill or {}).get("invoiceNumber", 0) > 0, f"{bill}")
        after = stored_token(args.db, cid)
        check("unreadable ciphertext survives the bill create byte-for-byte", after == UNREADABLE,
              f"stored={after!r}")

        print("\n=== 5. The operator re-enters the token: the explicit write must replace it ===")
        st, got = http("GET", f"/api/companies/{cid}", base, token=token)
        st, upd = http("PUT", f"/api/companies/{cid}", base, token=token,
                       body=update_payload(got, fbrToken="re-entered-token-after-key-loss"))
        check("PUT with a token value returns 200", st == 200, f"{st} {upd}")
        rotated = stored_token(args.db, cid)
        check("column now holds a fresh enc:v1: payload", (rotated or "").startswith("enc:v1:") and rotated != UNREADABLE,
              f"stored={rotated!r}")
        check("fresh payload is not the plaintext", rotated != "re-entered-token-after-key-loss")
        st, got = http("GET", f"/api/companies/{cid}", base, token=token)
        check("GET reports hasFbrToken = true again (this key ring can read it)",
              st == 200 and got.get("hasFbrToken") is True, f"{st} {got}")

        print("\n=== 6. An explicit clear still clears ===")
        st, upd = http("PUT", f"/api/companies/{cid}", base, token=token,
                       body=update_payload(got, fbrToken=""))
        check("PUT with fbrToken = \"\" returns 200", st == 200, f"{st} {upd}")
        cleared = stored_token(args.db, cid)
        check("column is empty after the clear (not the old ciphertext)", cleared == "", f"stored={cleared!r}")
        st, got = http("GET", f"/api/companies/{cid}", base, token=token)
        check("GET reports hasFbrToken = false after the clear", st == 200 and got.get("hasFbrToken") is False, f"{st} {got}")

        print("\n=== 7. A row that has never had a token is untouched by the guard ===")
        st, upd = http("PUT", f"/api/companies/{cid}", base, token=token,
                       body=update_payload(got, phone="+92-21-22222222"))
        check("edit with no token still saves", st == 200 and upd.get("phone") == "+92-21-22222222", f"{st} {upd}")
        check("column stays empty", stored_token(args.db, cid) == "", f"stored={stored_token(args.db, cid)!r}")
    finally:
        if args.keep:
            print(f"\n=== Keeping company {cid} ===")
        else:
            st, _ = http("DELETE", f"/api/companies/{cid}", base, token=token)
            print(f"\n=== Teardown: DELETE company {cid} -> {st} ===")

    failed = [r for r in results if r[1] != "PASS"]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    for name, res in failed:
        print(f"  FAIL: {name}: {res}")
    print("all checks passed" if not failed else "SOME CHECKS FAILED")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
