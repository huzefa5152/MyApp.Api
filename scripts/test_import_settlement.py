#!/usr/bin/env python3
"""
Imported settlement survives receipts, and every receivables figure agrees.

A bill imported from Manager carries AmountPaid = total - Manager's balance due,
and part of that is not backed by any receipt allocation here (Manager settled
it before the migration). Invoice.ImportSettlementAdjustment records that part,
and the invariant is AmountPaid = sum(allocations) + ImportSettlementAdjustment.

This suite proves, on an ephemeral company:
  1. the dashboard, the accounting summary and the Receivable Aging report (an
     as-of read, which sums allocations) show the same outstanding figure;
  2. recording a receipt keeps the imported settlement (before the fix the
     recompute set AmountPaid to the receipt alone and the bill "owed" again);
  3. deleting the receipt returns the bill to the imported settlement.

The import itself is simulated with one UPDATE on the LOCAL test database (no
API writes ExternalRef), so the suite needs sqlcmd and refuses a non-local
server.

Usage:
  python scripts/test_import_settlement.py --base http://localhost:5134
      [--server .\\MSSQLSERVER02] [--database MyApp_Customize_Local]
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any

PASS = "PASS"
results: list[tuple[str, str]] = []


def http(method: str, path: str, base: str, token: str | None = None, body: Any = None) -> tuple[int, Any]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base.rstrip("/") + path, method=method, headers=headers,
                                 data=json.dumps(body).encode("utf-8") if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def check(name: str, ok: bool, reason: str = "") -> None:
    results.append((name, PASS if ok else f"FAIL - {reason}"))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{'' if ok else '  <- ' + reason}")


def eq(a: Any, b: float) -> bool:
    try:
        return abs(float(a) - float(b)) < 0.01
    except (TypeError, ValueError):
        return False


def sql(server: str, database: str, statement: str) -> None:
    # -I: QUOTED_IDENTIFIER on, which an UPDATE needs on a table with a
    # filtered index (Invoices has one).
    r = subprocess.run(["sqlcmd", "-S", server, "-E", "-b", "-I", "-d", database, "-Q", statement],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"sqlcmd failed: {(r.stdout + r.stderr).strip()}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base", default=os.environ.get("MYAPP_BASE", "http://localhost:5134"))
    p.add_argument("--server", default=r".\MSSQLSERVER02")
    p.add_argument("--database", default="MyApp_Customize_Local")
    a = p.parse_args()
    if not (a.server.startswith(".") or a.server.lower().startswith(("localhost", "(local)", "127.0.0.1"))):
        print(f"FATAL: refusing a non-local SQL server ({a.server})")
        return 2
    base = a.base

    st, data = http("POST", "/api/auth/login", base,
                    body={"username": os.environ.get("MYAPP_ADMIN_USER", "admin"),
                          "password": os.environ.get("MYAPP_ADMIN_PW", "admin123")})
    if st != 200:
        print(f"FATAL: admin login failed ({st})")
        return 2
    token = data["token"]
    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    today = datetime.now().strftime("%Y-%m-%d")

    print("\n=== Ephemeral company, client, bill ===")
    st, company = http("POST", "/api/companies", base, token=token, body={
        "name": f"_test_import_settlement {suffix}", "fullAddress": "Test HQ",
        "ntn": "9999999", "strn": "9999999999999",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
    })
    if st not in (200, 201):
        print(f"FATAL: create company failed ({st} {company})")
        return 2
    cid = company["id"]
    st, client = http("POST", "/api/clients", base, token=token, body={
        "name": f"Settlement Client {suffix}", "address": "1 Test Road", "companyId": cid,
        "ntn": "1234567", "fbrProvinceCode": 8, "registrationType": "Registered",
    })
    st2, item = http("POST", f"/api/itemtypes?companyId={cid}", base, token=token,
                     body={"name": f"Settlement item c{cid}", "isFavorite": True})
    st3, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 18,
        "items": [{"description": "Settlement test", "quantity": 1, "uom": "Pcs",
                   "unitPrice": 1000, "itemTypeId": item["id"]}],
    })
    check("bill created (grand 1180)", st3 in (200, 201) and eq((inv or {}).get("grandTotal"), 1180), f"{st3} {inv}")
    if st3 not in (200, 201):
        return 1
    inv_id = inv["id"]

    # A receipt needs a bank / cash account, which the ledger seeds.
    http("POST", f"/api/accounting/gl/company/{cid}/enable", base, token=token)
    st, banks = http("GET", f"/api/accounts/company/{cid}/bank-cash", base, token=token)
    bank_id = (banks or [{}])[0].get("id") if st == 200 and banks else None
    check("a bank / cash account exists", bank_id is not None, f"{st} {banks}")
    if bank_id is None:
        return 1

    # Simulate the Manager import: 700 settled there, with no receipt here.
    sql(a.server, a.database,
        f"UPDATE Invoices SET ExternalRef = 'mgr-sinv:test-{suffix}', AmountPaid = 700, "
        f"ImportSettlementAdjustment = 700 WHERE Id = {inv_id} AND CompanyId = {cid};")

    def figures() -> tuple[Any, Any, Any, Any]:
        _, k = http("GET", f"/api/dashboard/kpis?companyId={cid}&period=all-time", base, token=token)
        _, s = http("GET", f"/api/accounting/summary/company/{cid}", base, token=token)
        _, r = http("GET", f"/api/accounting/reports/company/{cid}/receivables-aging?period=today", base, token=token)
        _, i = http("GET", f"/api/invoices/{inv_id}", base, token=token)
        return (((k or {}).get("receivables") or {}).get("total"), ((s or {}).get("receivables") or {}).get("total"),
                ((r or {}).get("totals") or {}).get("total"), (i or {}).get("amountPaid"))

    print("\n=== Imported settlement only ===")
    dash, summ, rep, paid = figures()
    check("AmountPaid == 700", eq(paid, 700), f"got {paid}")
    check("dashboard receivables == 480", eq(dash, 480), f"got {dash}")
    check("summary receivables == 480", eq(summ, 480), f"got {summ}")
    check("aging report (as of today) == 480 — counts the imported settlement", eq(rep, 480), f"got {rep}")

    print("\n=== A receipt of 200 keeps the imported settlement ===")
    st, receipt = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "date": today, "contactType": "Client", "contactId": client["id"], "method": "Cash",
        "bankAccountId": bank_id, "allocations": [{"invoiceId": inv_id, "amount": 200}],
    })
    check("receipt created", st in (200, 201), f"{st} {receipt}")
    dash, summ, rep, paid = figures()
    check("AmountPaid == 900 (700 imported + 200 received; was 200 before the fix)", eq(paid, 900), f"got {paid}")
    check("dashboard receivables == 280", eq(dash, 280), f"got {dash}")
    check("summary receivables == 280", eq(summ, 280), f"got {summ}")
    check("aging report == 280", eq(rep, 280), f"got {rep}")

    print("\n=== Deleting the receipt returns the bill to the imported settlement ===")
    if st in (200, 201):
        st, _ = http("DELETE", f"/api/payments/receipts/{receipt['id']}", base, token=token)
        check("receipt deleted", st in (200, 204), f"got {st}")
    dash, summ, rep, paid = figures()
    check("AmountPaid == 700", eq(paid, 700), f"got {paid}")
    check("all three receivables == 480", eq(dash, 480) and eq(summ, 480) and eq(rep, 480),
          f"dashboard {dash}, summary {summ}, report {rep}")

    failed = [r for r in results if r[1] != PASS]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} import settlement checks passed ===")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
