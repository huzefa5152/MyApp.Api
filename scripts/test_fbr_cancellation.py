"""
FBR cancellation + reversal releases the delivery challans.

Two ways a filed sale stops being a sale, and both must hand the goods back:

  1. A CREDIT NOTE that reverses the bill IN FULL.
  2. Recording that the filing was CANCELLED on the FBR portal (their 72-hour
     window) — no note document, the bill stays visible with its number and IRN.

Either way three things have to happen, and this suite pins all three:

  * the delivery challans go back into the billable pool, so the goods can be
    re-billed on a fresh number. This is the bug that stranded Hakimi challans
    4387, 4391 and 4393 against reversed bills 3912 and 3913.
  * the stock the bill consumed comes back — ONCE. A credit note raised with
    "affects stock" already returns it, so a later FBR cancellation must not
    return it a second time.
  * the bill drops out of the Sales Report, which lists sale invoices only and
    so cannot net a reversal off against its note.

A PARTIAL credit note must do none of this: part of the bill still stands.

Requires --db to set FbrStatus/FbrIRN on the test bill, because a filing cannot
be faked through the API and every path here is only reachable on a filed bill.

Usage:
  python scripts/test_fbr_cancellation.py --base http://localhost:5135 \
      --db "Server=CRKRL-HUSSAHUZ1;Database=db46684;Trusted_Connection=True"
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

results: list[tuple[str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, "PASS" if ok else f"FAIL — {detail}"))
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
    """Run a statement through sqlcmd. Used only to fake an FBR filing."""
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
        capture_output=True, text=True, timeout=120)
    return (out.stdout or "") + (out.stderr or "")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--db", required=True, help="connection string, to fake the FBR filing")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    api = args.base
    st, auth = http("POST", "/api/auth/login", api,
                    body={"username": args.username, "password": args.password})
    if st != 200:
        print(f"FATAL: login failed ({st})")
        return 2
    token = auth["token"]
    tag = datetime.now().strftime("%m%d%H%M%S")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

    st, company = http("POST", "/api/companies", api, token=token, body={
        "name": f"_fbr_cancel {tag}", "fullAddress": "1 Test St", "phone": "021-0",
        "ntn": "9999999", "cnic": "9999999999999", "strn": "9999999999999",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnvironment": "sandbox", "fbrProvinceCode": 8,
        "fbrBusinessActivity": "Manufacturer", "fbrSector": "All Other Sectors",
        "fbrToken": "not-used", "inventoryTrackingEnabled": True,
    })
    if st not in (200, 201):
        print(f"FATAL: create company failed ({st} {company})")
        return 2
    cid = company["id"]
    print(f"\ncompany {cid}")

    st, client = http("POST", "/api/clients", api, token=token, body={
        "name": f"Cancel Client {tag}", "address": "1 Road", "phone": "021-1",
        # STRN, registration type and a province are all required for the
        # challan to land billable rather than "Setup Required" — see
        # DeliveryChallanService.IsFbrReady.
        "companyId": cid, "registrationType": "Registered", "ntn": "1234567",
        "strn": "1234567890123", "fbrProvinceCode": 8})
    client_id = client["id"]

    # A fully classified item type so the challan lands Pending (billable).
    _, types = http("GET", "/api/itemtypes", api, token=token)
    classified = next((t for t in (types or [])
                       if t.get("hsCode") and t.get("uom") and t.get("saleType")), None)

    def make_challan(qty: float, price: float):
        st, dc = http("POST", f"/api/deliverychallans/company/{cid}", api, token=token, body={
            "deliveryDate": today, "clientId": client_id, "poNumber": f"PO-{tag}",
            "items": [{"description": f"Widget {tag}", "quantity": qty, "unit": "Pcs",
                       **({"itemTypeId": classified["id"]} if classified else {})}]})
        return dc if st in (200, 201) else None

    def bill_challan(dc, price: float):
        st, inv = http("POST", "/api/invoices", api, token=token, body={
            "date": today, "companyId": cid, "clientId": client_id, "gstRate": 18,
            "challanIds": [dc["id"]],
            "items": [{"deliveryItemId": dc["items"][0]["id"], "unitPrice": price,
                       "description": dc["items"][0]["description"]}]})
        if st not in (200, 201):
            print(f"      bill_challan -> {st} {str(inv)[:300]}")
            return None
        return inv

    def file_at_fbr(invoice_id: int, irn: str):
        """Fake the filing. Nothing here is reachable on an unfiled bill."""
        sql(args.db, f"UPDATE Invoices SET FbrStatus='Submitted', FbrIRN='{irn}', "
                     f"FbrInvoiceNumber='{irn}', FbrSubmittedAt=GETUTCDATE() WHERE Id={invoice_id}")

    def challan_state(dc_id: int):
        st, dc = http("GET", f"/api/deliverychallans/{dc_id}", api, token=token)
        return (dc or {}).get("status"), (dc or {}).get("invoiceId")

    def on_hand(item_type_id: int) -> float:
        st, body = http("GET", f"/api/stock/company/{cid}/onhand", api, token=token)
        if st != 200:
            return 0.0
        rows = body if isinstance(body, list) else (body or {}).get("items") or []
        row = next((r for r in rows if r.get("itemTypeId") == item_type_id), None)
        return float((row or {}).get("quantity") or (row or {}).get("onHand") or 0)

    try:
        # ── 1. Cancelling at FBR releases the challan and returns the stock ──
        print("\n-- 1. Cancelled at the FBR portal (no credit note) --")
        dc1 = make_challan(10, 100)
        if not check("a challan is created", dc1 is not None):
            return 1
        inv1 = bill_challan(dc1, 100)
        if not check("it is billed", inv1 is not None, f"{inv1}"):
            return 1
        status, linked = challan_state(dc1["id"])
        check("the challan is now Invoiced and linked",
              status == "Invoiced" and linked == inv1["id"], f"status={status} invoiceId={linked}")

        item_type_id = classified["id"] if classified else None
        before = on_hand(item_type_id) if item_type_id else 0.0

        file_at_fbr(inv1["id"], f"IRN-{tag}-1")
        st, out = http("POST", f"/api/invoices/{inv1['id']}/fbr-cancelled", api, token=token,
                       body={"reason": "Cancelled at FBR within 72 hours"})
        check("the cancellation is recorded", st == 200, f"got {st} {out}")

        st, after_inv = http("GET", f"/api/invoices/{inv1['id']}", api, token=token)
        check("the bill carries the FBR-cancelled marker",
              bool(after_inv.get("fbrCancelledAt")), f"fbrCancelledAt={after_inv.get('fbrCancelledAt')}")
        check("it is NOT voided — it stays visible with its number",
              after_inv.get("isCancelled") is False and after_inv.get("invoiceNumber"),
              f"isCancelled={after_inv.get('isCancelled')}")
        check("it keeps its IRN", bool(after_inv.get("fbrInvoiceNumber")),
              f"irn={after_inv.get('fbrInvoiceNumber')}")

        status, linked = challan_state(dc1["id"])
        check("the challan is billable again (Pending, unlinked)",
              status == "Pending" and not linked, f"status={status} invoiceId={linked}")

        st, pending = http("GET", f"/api/deliverychallans/company/{cid}/pending", api, token=token)
        check("and it is back in the pending list the bill form reads",
              any(c["id"] == dc1["id"] for c in (pending or [])),
              f"pending ids {[c['id'] for c in (pending or [])]}")

        if item_type_id:
            check("the stock it consumed came back",
                  on_hand(item_type_id) > before - 0.0001,
                  f"on hand {before} -> {on_hand(item_type_id)}")

        # Doing it twice is refused rather than double-returning anything.
        st, again = http("POST", f"/api/invoices/{inv1['id']}/fbr-cancelled", api, token=token,
                         body={"reason": "again"})
        check("a second cancellation is refused", st == 400, f"got {st} {again}")

        # ── 2. A FULL credit note releases the challan too ──────────────────
        print("\n-- 2. Reversed in full by a credit note --")
        dc2 = make_challan(4, 250)
        inv2 = bill_challan(dc2, 250)
        if check("a second challan is billed", inv2 is not None, f"{inv2}"):
            file_at_fbr(inv2["id"], f"IRN-{tag}-2")
            st, note = http("POST", "/api/invoices/notes", api, token=token, body={
                "originalInvoiceId": inv2["id"], "documentType": 10,
                "reason": "Return of goods", "affectsStock": True})
            check("a full credit note is created", st in (200, 201), f"got {st} {note}")

            status, linked = challan_state(dc2["id"])
            check("the challan is released by the credit note alone",
                  status == "Pending" and not linked, f"status={status} invoiceId={linked}")

            st, back = http("GET", f"/api/invoices/{inv2['id']}", api, token=token)
            check("the bill is marked fully reversed",
                  back.get("isFullyReversed") is True,
                  f"isFullyReversed={back.get('isFullyReversed')}")

            # Cancelling at FBR afterwards must NOT return the stock twice.
            if item_type_id:
                mid = on_hand(item_type_id)
                st, _ = http("POST", f"/api/invoices/{inv2['id']}/fbr-cancelled", api,
                             token=token, body={"reason": "also withdrawn at FBR"})
                check("it can still be marked cancelled at FBR after a note", st == 200, f"got {st}")
                check("and the stock is NOT returned a second time",
                      abs(on_hand(item_type_id) - mid) < 0.0001,
                      f"on hand {mid} -> {on_hand(item_type_id)} (a credit note already returned it)")

        # ── 3. A PARTIAL credit note leaves the challan billed ──────────────
        print("\n-- 3. A partial reversal changes nothing --")
        dc3 = make_challan(10, 100)
        inv3 = bill_challan(dc3, 100)
        if check("a third challan is billed", inv3 is not None, f"{inv3}"):
            file_at_fbr(inv3["id"], f"IRN-{tag}-3")
            _, full3 = http("GET", f"/api/invoices/{inv3['id']}", api, token=token)
            line = (full3.get("items") or [{}])[0]
            st, pnote = http("POST", "/api/invoices/notes", api, token=token, body={
                "originalInvoiceId": inv3["id"], "documentType": 10,
                "reason": "Return of goods", "affectsStock": True,
                "lines": [{"invoiceItemId": line.get("id"), "quantity": 3}]})
            check("a partial credit note is created", st in (200, 201), f"got {st} {pnote}")
            status, linked = challan_state(dc3["id"])
            check("the challan stays billed — part of the bill still stands",
                  status == "Invoiced" and linked == inv3["id"],
                  f"status={status} invoiceId={linked}")
            _, back3 = http("GET", f"/api/invoices/{inv3['id']}", api, token=token)
            check("and the bill is not marked fully reversed",
                  back3.get("isFullyReversed") is not True,
                  f"isFullyReversed={back3.get('isFullyReversed')}")

        # ── 4. Neither one counts as a sale any more ────────────────────────
        print("\n-- 4. The Sales Report drops both --")
        year = datetime.now(timezone.utc).year
        st, rep = http("GET", f"/api/reports/company/{cid}/sales?year={year}", api, token=token)
        if check("the sales report loads", st == 200, f"got {st}"):
            # The report identifies a bill by documentNumber (a string), not by
            # the raw invoice number.
            listed = {str(r.get("documentNumber") or "") for r in (rep.get("invoices") or [])}

            def on_report(inv) -> bool:
                return str(inv["invoiceNumber"]) in listed

            check("the FBR-cancelled bill is not in it",
                  not on_report(inv1), f"found #{inv1['invoiceNumber']} in {sorted(listed)}")
            if inv2:
                check("the fully-reversed bill is not in it",
                      not on_report(inv2), f"found #{inv2['invoiceNumber']} in {sorted(listed)}")
            if inv3:
                check("the PARTLY reversed bill is still in it",
                      on_report(inv3),
                      f"#{inv3['invoiceNumber']} missing from {sorted(listed)}")

        # ── 5. Guards ───────────────────────────────────────────────────────
        print("\n-- 5. Guards --")
        dc4 = make_challan(1, 10)
        inv4 = bill_challan(dc4, 10)
        if inv4:
            st, err = http("POST", f"/api/invoices/{inv4['id']}/fbr-cancelled", api,
                           token=token, body={"reason": "never filed"})
            check("an unfiled bill cannot be marked cancelled at FBR",
                  st == 400 and "never filed" in json.dumps(err).lower(),
                  f"got {st} {err}")
    finally:
        if args.keep:
            print(f"\nkeeping company {cid}")
        else:
            st, _ = http("DELETE", f"/api/companies/{cid}", api, token=token)
            print(f"\nteardown: delete company {cid} -> {st}")

    passed = sum(1 for _, r in results if r == "PASS")
    print("\n" + "=" * 70)
    for name, r in results:
        if r != "PASS":
            print(f"  FAIL  {name} -- {r}")
    print(f"{passed}/{len(results)} checks passed")
    print("=" * 70)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
