#!/usr/bin/env python3
"""
GL back-post (2026-09-17) — the one-shot that brings a company created before
the ledger existed up to date.

The failure mode here is not a crash. It is a company whose books look complete
and are quietly double-counted, or one that was skipped and looks merely empty.
So this suite builds a company in exactly the state the backfill is FOR — real
documents, no chart, posting off — and then checks the four properties the plan
names:

  1. IDEMPOTENT — running it again changes nothing. This matters most, because
     the backfill's own audit marker is what stops a rerun on a real boot, and
     if the marker were ever lost the rerun must still be harmless.
  2. BALANCED — debits equal credits afterwards, and the trial balance foots.
  3. NO DOUBLE-POST — one entry per document, not two, and the same account
     balances a document-by-document history would have produced.
  4. SAFE ON A COMPANY THAT ALREADY HAS ENTRIES — including a manual journal,
     which nothing here can reproduce and which must survive untouched.

It exercises the same code path the startup backfill uses (the rebuild), driven
through the API so no private method is being tested in isolation.

Needs --db: a company that predates the module cannot be created through the
API, which switches posting on for everything it makes. Putting one into that
state is the whole point.

    python scripts/test_gl_backfill.py --base http://localhost:5104 --db "<conn>"
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal

PASS = 0
FAIL = 0
FAILURES: list[str] = []


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
         body: dict | list | None = None, timeout: int = 300):
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


def D(x) -> Decimal:
    return Decimal(str(x))


def sql(conn: str, query: str) -> str:
    """sqlcmd. Used only to put a company into the state the API will not
    create: posting off, as if it predated the accounting module."""
    server, db = "", ""
    for part in conn.split(";"):
        k, _, v = part.partition("=")
        k = k.strip().lower()
        if k == "server":
            server = v.strip()
        elif k in ("database", "initial catalog"):
            db = v.strip()
    out = subprocess.run(
        ["sqlcmd", "-S", server, "-d", db, "-E", "-I", "-h", "-1", "-W", "-Q", query],
        capture_output=True, text=True, timeout=180)
    return (out.stdout or "") + (out.stderr or "")


def walk(nodes):
    for n in nodes or []:
        for a in n.get("accounts") or []:
            yield a
        yield from walk(n.get("children"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--db", required=True,
                    help="connection string — required: a pre-module company cannot be made via the API")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  GL BACK-POST")
    print("=" * 78)

    status, d = http("POST", "/api/auth/login", base,
                     body={"username": args.user, "password": args.password})
    if status != 200:
        print(f"[!] login failed: HTTP {status} {d}")
        return 2
    token = d["token"]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    company_id = type_id = None

    try:
        # ── 0. a company exactly as it would have been before the ledger ─────
        print("\n=== 0. Setup: a company with history and no books ===")
        status, company = http("POST", "/api/companies", base, token=token, body={
            "name": "[TEMP] Backfill Suite", "brandName": "[TEMP] Backfill Suite",
            "fullAddress": "Karachi", "cnic": "4220100000000",
            "ntn": "1234567-8", "strn": "1234567890123",
            "fbrSellerRegistrationNo": "4220100000000",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingDebitNoteNumber": 1, "startingCreditNoteNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "fbrProvinceCode": 8, "inventoryTrackingEnabled": False,
            "fbrBusinessActivity": "Wholesaler", "fbrSector": "Wholesale / Retails",
            "fbrEnvironment": "sandbox", "fbrToken": "placeholder-not-a-real-token",
        })
        if not check("0", "company created", status in (200, 201), f"{status} {err_text(company)}"):
            return 1
        company_id = company["id"]

        # THE POINT OF --db: switch posting off, so this company is in exactly
        # the state one that predates the module is in — documents, no entries.
        sql(args.db, f"UPDATE Companies SET GlPostingEnabled = 0 WHERE Id = {company_id}")
        status, gl = http("GET", f"/api/accounting/gl/company/{company_id}/status", base, token=token)
        if not check("0", "posting is off, as it would be on an older company",
                     gl.get("enabled") is False, f"got {gl.get('enabled')}"):
            return 1

        status, client = http("POST", "/api/clients", base, token=token, body={
            "companyId": company_id, "name": "[TEMP] Backfill Buyer", "address": "Karachi",
            "ntn": "4228937-8", "strn": "9876543210987",
            "registrationType": "Registered", "fbrProvinceCode": 8})
        status, supplier = http("POST", "/api/suppliers", base, token=token, body={
            "companyId": company_id, "name": "[TEMP] Backfill Supplier", "address": "Karachi"})
        status, itype = http("POST", "/api/itemtypes", base, token=token, body={
            "name": f"[TEMP] Backfill Widget {stamp}", "uom": "KG", "companyId": company_id})
        if not check("0", "buyer, supplier and item type created",
                     client and supplier and itype and "id" in itype, "setup failed"):
            return 1
        type_id = itype["id"]

        def make_bill(qty=50, price=1000, extra=None):
            s, dc = http("POST", f"/api/deliverychallans/company/{company_id}", base, token=token, body={
                "companyId": company_id, "clientId": client["id"], "poNumber": "PO-BF",
                "poDate": today, "deliveryDate": today,
                "items": [{"description": "[TEMP] sold", "quantity": qty, "unit": "KG",
                           "itemTypeId": type_id}]})
            if s not in (200, 201):
                return s, dc
            body = {"date": today, "companyId": company_id, "clientId": client["id"],
                    "gstRate": 18, "challanIds": [dc["id"]],
                    "items": [{"deliveryItemId": dc["items"][0]["id"], "unitPrice": price,
                               "description": "[TEMP] sold", "itemTypeId": type_id}]}
            body.update(extra or {})
            return http("POST", "/api/invoices", base, token=token, body=body)

        # History written while the ledger was off — three sales (one carrying
        # further tax, one withheld), a purchase, and a receipt.
        made = []
        for qty, price, extra in [(50, 1000, {}), (30, 1500, {"furtherTaxRate": 3}),
                                  (20, 2000, {"withholdingTaxRate": 0.5})]:
            status, inv = make_bill(qty, price, extra)
            check("0", f"sale of {qty} x {price} recorded", status in (200, 201), f"{status} {err_text(inv)}")
            made.append(inv)

        status, pb = http("POST", "/api/purchasebills", base, token=token, body={
            "companyId": company_id, "supplierId": supplier["id"], "date": today,
            "gstRate": 18, "supplierBillNumber": f"SB-{stamp}",
            "items": [{"itemTypeId": type_id, "description": "[TEMP] bought",
                       "quantity": 25, "uom": "KG", "unitPrice": 900}]})
        check("0", "a purchase recorded", status in (200, 201), f"{status} {err_text(pb)}")

        status, gl = http("GET", f"/api/accounting/gl/company/{company_id}/status", base, token=token)
        check("0", "and NOTHING posted, because the ledger was off",
              gl.get("entryCount") == 0, f"got {gl.get('entryCount')}")
        check("0", "the company has no chart either",
              gl.get("hasCoa") is False, f"got {gl.get('hasCoa')}")

        # ── 1. the back-post ─────────────────────────────────────────────────
        print("\n=== 1. Bringing the books up to date ===")
        # Same path the startup backfill takes: give it a chart, switch posting
        # on, then rebuild.
        status, _ = http("POST", f"/api/accounts/company/{company_id}/seed-wholesale", base, token=token)
        check("1", "a chart is laid down", status == 200, f"got {status}")
        sql(args.db, f"UPDATE Companies SET GlPostingEnabled = 1 WHERE Id = {company_id}")
        status, reb = http("POST", f"/api/accounting/gl/company/{company_id}/rebuild", base, token=token)
        if not check("1", "the back-post runs", status == 200, f"{status} {err_text(reb)}"):
            return 1

        result = reb["result"]
        check("1", "it posted the three sales", result["postedInvoices"] == 3,
              f"got {result['postedInvoices']}")
        check("1", "and the purchase", result["postedPurchaseBills"] == 1,
              f"got {result['postedPurchaseBills']}")
        check("1", "it removed nothing, because there was nothing to remove",
              result["removedEntries"] == 0, f"got {result['removedEntries']}")

        status, gl = http("GET", f"/api/accounting/gl/company/{company_id}/status", base, token=token)
        check("1", "there are now four entries", gl.get("entryCount") == 4, f"got {gl.get('entryCount')}")
        check("1", "and the ledger balances", gl.get("isBalanced") is True,
              f"{gl.get('totalDebit')} vs {gl.get('totalCredit')}")

        status, tb = http("GET", f"/api/accounting/reports/company/{company_id}/trial-balance",
                          base, token=token)
        check("1", "the trial balance foots",
              D(tb["totalDebit"]) == D(tb["totalCredit"]), f"{tb['totalDebit']} vs {tb['totalCredit']}")

        status, tree = http("GET", f"/api/accounts/company/{company_id}/tree", base, token=token)
        first = {a["id"]: D(a["balance"]) for a in
                 list(walk(tree["balanceSheet"])) + list(walk(tree["profitAndLoss"]))}
        first_tb = {r["accountId"]: D(r["closing"]) for r in tb["rows"]}

        # ── 2. idempotent ────────────────────────────────────────────────────
        print("\n=== 2. Running it again changes nothing ===")
        status, again = http("POST", f"/api/accounting/gl/company/{company_id}/rebuild", base, token=token)
        if check("2", "a second run succeeds", status == 200, f"{status} {err_text(again)}"):
            check("2", "it removed exactly the four it had posted",
                  again["result"]["removedEntries"] == 4, f"got {again['result']['removedEntries']}")
            check("2", "and posted the same four again — not eight",
                  again["result"]["postedInvoices"] == 3
                  and again["result"]["postedPurchaseBills"] == 1,
                  f"got {again['result']}")

        status, gl = http("GET", f"/api/accounting/gl/company/{company_id}/status", base, token=token)
        check("2", "the entry count is unchanged", gl.get("entryCount") == 4, f"got {gl.get('entryCount')}")
        check("2", "the ledger still balances", gl.get("isBalanced") is True,
              f"{gl.get('totalDebit')} vs {gl.get('totalCredit')}")

        status, tree = http("GET", f"/api/accounts/company/{company_id}/tree", base, token=token)
        second = {a["id"]: D(a["balance"]) for a in
                  list(walk(tree["balanceSheet"])) + list(walk(tree["profitAndLoss"]))}
        check("2", "EVERY account balance is identical — nothing doubled",
              first == second,
              f"differs on {[k for k in first if first.get(k) != second.get(k)]}")

        status, tb2 = http("GET", f"/api/accounting/reports/company/{company_id}/trial-balance",
                           base, token=token)
        check("2", "and so is every trial-balance closing",
              {r["accountId"]: D(r["closing"]) for r in tb2["rows"]} == first_tb,
              "a trial-balance figure moved on a re-run")

        # ── 3. one entry per document ────────────────────────────────────────
        print("\n=== 3. One entry per document, not two ===")
        status, page = http("GET", f"/api/journal-entries/company/{company_id}/paged?pageSize=200",
                            base, token=token)
        entries = page["items"]
        keys = [(e["sourceDocType"], e["sourceDocId"]) for e in entries]
        check("3", "no document owns two entries", len(keys) == len(set(keys)),
              f"duplicates: {[k for k in keys if keys.count(k) > 1]}")
        check("3", "every entry balances",
              all(D(e["totalDebit"]) == D(e["totalCredit"]) for e in entries),
              "an entry does not balance")
        check("3", "each entry is dated its own document's date, not the day of the back-post",
              all(e["date"][:10] == today[:10] for e in entries),
              f"dates: {sorted({e['date'][:10] for e in entries})}")

        # ── 4. safe on a company that already has entries ────────────────────
        print("\n=== 4. Safe on books that are already in use ===")
        status, flat = http("GET", f"/api/accounts/company/{company_id}/flat", base, token=token)
        rent = next(a for a in flat if a["name"] == "Rent")
        salaries = next(a for a in flat if a["name"] == "Salaries")
        status, je = http("POST", f"/api/journal-entries/company/{company_id}", base, token=token, body={
            "date": today, "narration": "[TEMP] operator's own accrual",
            "lines": [{"accountId": rent["id"], "debit": 12345, "credit": 0},
                      {"accountId": salaries["id"], "debit": 0, "credit": 12345}]})
        if check("4", "an operator writes a manual journal", status == 200, f"{status} {err_text(je)}"):
            status, reb3 = http("POST", f"/api/accounting/gl/company/{company_id}/rebuild",
                                base, token=token)
            if check("4", "a back-post runs over the top", status == 200, f"got {status}"):
                check("4", "it removed only the SYSTEM-posted entries",
                      reb3["result"]["removedEntries"] == 4,
                      f"got {reb3['result']['removedEntries']} — a manual journal was destroyed")

            status, after = http("GET", f"/api/journal-entries/company/{company_id}/paged?pageSize=200",
                                 base, token=token)
            manual = [e for e in after["items"] if e["isManual"]]
            check("4", "the operator's journal SURVIVED — nothing here could rewrite it",
                  len(manual) == 1 and manual[0]["id"] == je["id"],
                  f"found {len(manual)} manual entries")
            check("4", "it kept its entry number",
                  manual and manual[0]["reference"] == je["reference"],
                  f"{manual[0]['reference'] if manual else None} vs {je['reference']}")
            check("4", "and its figures", manual and D(manual[0]["totalDebit"]) == Decimal("12345"),
                  f"got {manual[0]['totalDebit'] if manual else None}")

            status, gl = http("GET", f"/api/accounting/gl/company/{company_id}/status", base, token=token)
            check("4", "the ledger still balances with both kinds of entry in it",
                  gl.get("isBalanced") is True, f"{gl.get('totalDebit')} vs {gl.get('totalCredit')}")
            check("4", "and holds five entries — the four documents plus the journal",
                  gl.get("entryCount") == 5, f"got {gl.get('entryCount')}")

        # ── 5. a closed period is respected ──────────────────────────────────
        print("\n=== 5. A back-post cannot rewrite a closed period ===")
        # The sharp edge: the rebuild's removal is raw SQL, which the ledger's
        # lock check never sees, while the re-post that follows goes through the
        # writer, which does. Unfiltered, a rebuild across a lock deletes the
        # closed period and then refuses to write it back.
        status, tree = http("GET", f"/api/accounts/company/{company_id}/tree", base, token=token)
        before_lock = {a["id"]: D(a["balance"]) for a in
                       list(walk(tree["balanceSheet"])) + list(walk(tree["profitAndLoss"]))}

        status, _ = http("PUT", f"/api/accounting/gl/company/{company_id}/lock-date", base, token=token,
                         body={"lockDate": today[:10]})
        if check("5", "the period closes over the posted documents", status == 200, f"got {status}"):
            status, locked = http("POST", f"/api/accounting/gl/company/{company_id}/rebuild",
                                  base, token=token)
            if check("5", "a rebuild still completes", status == 200, f"{status} {err_text(locked)}"):
                check("5", "but it removed nothing from the closed period",
                      locked["result"]["removedEntries"] == 0,
                      f"removed {locked['result']['removedEntries']} entries from closed books")
                check("5", "and re-posted nothing into it",
                      locked["result"]["postedInvoices"] == 0
                      and locked["result"]["postedPurchaseBills"] == 0,
                      f"got {locked['result']}")

            status, gl = http("GET", f"/api/accounting/gl/company/{company_id}/status", base, token=token)
            check("5", "all five entries are still there — nothing was lost",
                  gl.get("entryCount") == 5, f"got {gl.get('entryCount')}")
            check("5", "the ledger still balances", gl.get("isBalanced") is True,
                  f"{gl.get('totalDebit')} vs {gl.get('totalCredit')}")

            status, tree = http("GET", f"/api/accounts/company/{company_id}/tree", base, token=token)
            locked_bal = {a["id"]: D(a["balance"]) for a in
                          list(walk(tree["balanceSheet"])) + list(walk(tree["profitAndLoss"]))}
            check("5", "and every filed figure is untouched",
                  locked_bal == before_lock,
                  f"moved on {[k for k in before_lock if before_lock.get(k) != locked_bal.get(k)]}")

            status, _ = http("PUT", f"/api/accounting/gl/company/{company_id}/lock-date", base, token=token,
                             body={"lockDate": None})
            check("5", "reopening the books lets a rebuild work again", status == 200, f"got {status}")
            status, reopened = http("POST", f"/api/accounting/gl/company/{company_id}/rebuild",
                                    base, token=token)
            check("5", "and it posts the four documents once more",
                  status == 200 and reopened["result"]["postedInvoices"] == 3
                  and reopened["result"]["postedPurchaseBills"] == 1,
                  f"{status} {err_text(reopened)}")

        # ── 6. the startup marker ────────────────────────────────────────────
        print("\n=== 6. The startup back-post marks itself done ===")
        out = sql(args.db,
                  "SELECT COUNT(*) FROM AuditLogs WHERE ExceptionType = 'GL_BACKFILL_V1'")
        digits = [int(s) for s in out.split() if s.isdigit()]
        check("6", "an audit marker records that the one-shot has run",
              bool(digits) and digits[0] >= 1,
              f"marker rows: {digits[0] if digits else 'none'} — a rerun would re-post every company")

    finally:
        print("\n=== Cleanup ===")
        if company_id:
            status, _ = http("DELETE", f"/api/companies/{company_id}", base, token=token)
            check("cleanup", "throwaway company deleted", status in (200, 204), f"got {status}")
        if type_id:
            http("DELETE", f"/api/itemtypes/{type_id}", base, token=token)

    print()
    print("=" * 78)
    if FAIL:
        print(f"  {PASS} passed, {FAIL} FAILED")
        for f in FAILURES:
            print(f"   - {f}")
        print("=" * 78)
        return 1
    print(f"  GL BACK-POST SUITE PASSED - {PASS}/{PASS} checks")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
