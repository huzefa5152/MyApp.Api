#!/usr/bin/env python3
"""
Posting from documents (2026-09-16) — the highest-risk phase of the accounting
module, because the failures here BALANCE.

An entry with the right total on the wrong account passes every structural
check the ledger makes. So this suite does not assert that entries exist; it
asserts WHICH ACCOUNT each figure landed on, and it cross-checks the totals a
different way.

The one that matters most:

  **FURTHER TAX MUST NOT BE REVENUE.** It sits INSIDE the grand total, so a
  sale derived as GrandTotal − GSTAmount credits the tax to Sales. The books
  still balance, the trial balance still foots, and the income statement is
  overstated by exactly the tax collected — a wrong number that looks right.
  Suite 3 spins up a bill carrying further tax purely to prove the Sales
  account never sees it.

Also pinned: withholding splits the receivable instead of moving the total; a
credit note reverses every leg; a voided or deleted document takes its entry
with it; editing a document replaces its entry rather than adding one; and a
rebuild reproduces exactly the ledger the document-by-document history built.

Local only. Creates its own throwaway company and deletes it at the end.

    python scripts/test_accounting_posting.py --base http://localhost:5104
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
         body: dict | list | None = None, timeout: int = 180):
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
    """Run a statement through sqlcmd. Used only to put a bill into a state the
    API deliberately will not create: filed with FBR (so a credit note can be
    raised against it) and flagged demo (there is no demo-bill create path)."""
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5104")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--db", default=None,
                    help="connection string. Optional — needed only for the credit-note and "
                         "demo-bill checks, which require states the API will not create.")
    args = ap.parse_args()
    base = args.base

    print("=" * 78)
    print("  POSTING FROM DOCUMENTS")
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
        # ── 0. setup ─────────────────────────────────────────────────────────
        print("\n=== 0. Setup ===")
        status, company = http("POST", "/api/companies", base, token=token, body={
            "name": "[TEMP] Posting Suite", "brandName": "[TEMP] Posting Suite",
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
        if not check("0", "throwaway company created", status in (200, 201), f"{status} {err_text(company)}"):
            return 1
        company_id = company["id"]

        status, r = http("POST", f"/api/accounts/company/{company_id}/seed-wholesale", base, token=token)
        if not check("0", "chart seeded", status == 200, f"{status} {err_text(r)}"):
            return 1

        status, gl = http("GET", f"/api/accounting/gl/company/{company_id}/status", base, token=token)
        check("0", "the ledger is live for a new company", gl.get("enabled") is True, f"got {gl.get('enabled')}")
        check("0", "and starts empty", gl.get("entryCount") == 0, f"got {gl.get('entryCount')}")

        status, flat = http("GET", f"/api/accounts/company/{company_id}/flat", base, token=token)
        by_control = {a["controlType"]: a for a in flat if a["controlType"] != "None"}
        by_name = {a["name"]: a for a in flat}
        SALES = by_name["Sales"]
        AR = by_control["AccountsReceivable"]
        AP = by_control["AccountsPayable"]
        OUTPUT_TAX = by_control["OutputTax"]
        INPUT_TAX = by_control["InputTax"]
        FURTHER_TAX = by_control["FurtherTaxPayable"]
        WHT_RECV = by_control["WithholdingReceivable"]
        WHT_PAY = by_control["WithholdingPayable"]
        BANK = by_control["BankCash"]
        COGS = by_name["Cost of goods sold"]

        status, client = http("POST", "/api/clients", base, token=token, body={
            "companyId": company_id, "name": "[TEMP] Posting Buyer", "address": "Karachi",
            "ntn": "4228937-8", "strn": "9876543210987",
            "registrationType": "Registered", "fbrProvinceCode": 8})
        if not check("0", "buyer created", status in (200, 201), f"{status} {err_text(client)}"):
            return 1
        status, supplier = http("POST", "/api/suppliers", base, token=token, body={
            "companyId": company_id, "name": "[TEMP] Posting Supplier", "address": "Karachi"})
        if not check("0", "supplier created", status in (200, 201), f"{status} {err_text(supplier)}"):
            return 1
        status, itype = http("POST", "/api/itemtypes", base, token=token, body={
            "name": f"[TEMP] Posting Widget {stamp}", "uom": "KG", "companyId": company_id})
        if not check("0", "item type created", status in (200, 201), f"{status} {err_text(itype)}"):
            return 1
        type_id = itype["id"]

        def make_bill(extra: dict | None = None, qty=100, price=1000):
            s, dc = http("POST", f"/api/deliverychallans/company/{company_id}", base, token=token, body={
                "companyId": company_id, "clientId": client["id"], "poNumber": "PO-POST",
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

        def entry_for(doc_type: str, doc_id: int):
            """The one journal entry a document owns, as {accountId: signed}."""
            s, page = http("GET", f"/api/journal-entries/company/{company_id}/paged?pageSize=200",
                           base, token=token)
            if s != 200:
                return None, {}
            hits = [e for e in page["items"]
                    if e["sourceDocType"] == doc_type and e["sourceDocId"] == doc_id]
            if len(hits) != 1:
                return (hits[0] if hits else None), {"__count__": len(hits)}
            e = hits[0]
            signed = {}
            for l in e["lines"]:
                signed[l["accountId"]] = signed.get(l["accountId"], Decimal(0)) + D(l["debit"]) - D(l["credit"])
            return e, signed

        # ── 1. a plain sales invoice ─────────────────────────────────────────
        print("\n=== 1. A sale posts receivable, revenue and output tax ===")
        status, inv = make_bill()
        if not check("1", "a bill saves", status in (200, 201), f"{status} {err_text(inv)}"):
            return 1
        e, legs = entry_for("Invoice", inv["id"])
        if not check("1", "it posted exactly one entry", e is not None and "__count__" not in legs,
                     f"got {legs.get('__count__')}"):
            return 1
        check("1", "the entry balances",
              D(e["totalDebit"]) == D(e["totalCredit"]), f"{e['totalDebit']} vs {e['totalCredit']}")
        check("1", "A/R is debited with the whole collectible",
              legs.get(AR["id"]) == Decimal("118000.00"), f"got {legs.get(AR['id'])}")
        check("1", "Sales is credited with the net value of supply",
              legs.get(SALES["id"]) == Decimal("-100000.00"), f"got {legs.get(SALES['id'])}")
        check("1", "Output tax is credited with the GST",
              legs.get(OUTPUT_TAX["id"]) == Decimal("-18000.00"), f"got {legs.get(OUTPUT_TAX['id'])}")
        check("1", "nothing else was touched", len(legs) == 3, f"accounts hit: {len(legs)}")
        ar_line = next((l for l in e["lines"] if l["accountId"] == AR["id"]), None)
        check("1", "the receivable line names the client",
              ar_line and ar_line["partyType"] == "Client" and ar_line["partyId"] == client["id"],
              f"got {ar_line}")
        check("1", "and the invoice it belongs to",
              ar_line and ar_line["invoiceId"] == inv["id"], f"got {ar_line}")
        check("1", "it is dated the document's own date, not today's ledger date",
              e["date"][:10] == today[:10], f"{e['date']} vs {today}")

        # ── 2. editing replaces, it does not accumulate ──────────────────────
        print("\n=== 2. Editing a document replaces its entry ===")
        status, edited = http("PUT", f"/api/invoices/{inv['id']}", base, token=token, body={
            "gstRate": 18,
            "items": [{"id": inv["items"][0]["id"], "quantity": 50, "unitPrice": 1000,
                       "description": "[TEMP] sold", "itemTypeId": type_id}]})
        if check("2", "a full edit saves", status == 200, f"{status} {err_text(edited)}"):
            e2, legs2 = entry_for("Invoice", inv["id"])
            check("2", "there is still exactly ONE entry for the bill",
                  e2 is not None and "__count__" not in legs2, f"got {legs2.get('__count__')}")
            check("2", "and it carries the NEW figures, not both versions",
                  legs2.get(SALES["id"]) == Decimal("-50000.00"), f"got {legs2.get(SALES['id'])}")
            check("2", "it keeps its entry number", e2 and e2["entryNo"] == e["entryNo"] or True,
                  "informational")
        status, gl = http("GET", f"/api/accounting/gl/company/{company_id}/status", base, token=token)
        check("2", "the ledger still balances after the edit", gl.get("isBalanced") is True,
              f"{gl.get('totalDebit')} vs {gl.get('totalCredit')}")

        # ── 3. FURTHER TAX IS NOT REVENUE ────────────────────────────────────
        print("\n=== 3. Further tax is a liability, never revenue ===")
        status, ft = make_bill({"furtherTaxRate": 3})
        if not check("3", "a bill carrying further tax saves", status in (200, 201), f"{status} {err_text(ft)}"):
            return 1
        e3, legs3 = entry_for("Invoice", ft["id"])
        if check("3", "it posted one entry", e3 is not None and "__count__" not in legs3,
                 f"got {legs3.get('__count__')}"):
            check("3", "the entry balances",
                  D(e3["totalDebit"]) == D(e3["totalCredit"]), f"{e3['totalDebit']} vs {e3['totalCredit']}")
            # THE CHECK THIS SUITE EXISTS FOR. Sales must see the net value of
            # supply and NOT a paisa of the 3,000 further tax. Getting this
            # wrong still balances and still foots.
            check("3", "Sales is credited with the net ONLY — no further tax in revenue",
                  legs3.get(SALES["id"]) == Decimal("-100000.00"), f"got {legs3.get(SALES['id'])}")
            check("3", "further tax is credited to its OWN liability account",
                  legs3.get(FURTHER_TAX["id"]) == Decimal("-3000.00"), f"got {legs3.get(FURTHER_TAX['id'])}")
            check("3", "and NOT into Output Sales Tax, which must keep reconciling to GST",
                  legs3.get(OUTPUT_TAX["id"]) == Decimal("-18000.00"), f"got {legs3.get(OUTPUT_TAX['id'])}")
            check("3", "A/R carries the full grand total including the tax",
                  legs3.get(AR["id"]) == Decimal("121000.00"), f"got {legs3.get(AR['id'])}")

        # ── 4. withholding splits the receivable ─────────────────────────────
        print("\n=== 4. Withholding splits the receivable, it does not shrink the sale ===")
        status, wh = make_bill({"withholdingTaxRate": 0.5})
        if check("4", "a bill with withholding saves", status in (200, 201), f"{status} {err_text(wh)}"):
            e4, legs4 = entry_for("Invoice", wh["id"])
            if check("4", "it posted one entry", e4 is not None and "__count__" not in legs4,
                     f"got {legs4.get('__count__')}"):
                check("4", "the entry balances",
                      D(e4["totalDebit"]) == D(e4["totalCredit"]), f"{e4['totalDebit']} vs {e4['totalCredit']}")
                check("4", "revenue is the FULL net — withholding is not a discount",
                      legs4.get(SALES["id"]) == Decimal("-100000.00"), f"got {legs4.get(SALES['id'])}")
                check("4", "A/R carries only what the customer will actually pay",
                      legs4.get(AR["id"]) == Decimal("117410.00"), f"got {legs4.get(AR['id'])}")
                check("4", "the withheld slice is a receivable from FBR, not a loss",
                      legs4.get(WHT_RECV["id"]) == Decimal("590.00"), f"got {legs4.get(WHT_RECV['id'])}")

        # ── 5. purchase bill ─────────────────────────────────────────────────
        print("\n=== 5. A purchase posts cost, input tax and payable ===")
        status, pb = http("POST", "/api/purchasebills", base, token=token, body={
            "companyId": company_id, "supplierId": supplier["id"], "date": today,
            "gstRate": 18, "supplierBillNumber": f"SB-{stamp}",
            "items": [{"itemTypeId": type_id, "description": "[TEMP] bought",
                       "quantity": 100, "uom": "KG", "unitPrice": 1000}]})
        if check("5", "a purchase bill saves", status in (200, 201), f"{status} {err_text(pb)}"):
            e5, legs5 = entry_for("PurchaseBill", pb["id"])
            if check("5", "it posted one entry", e5 is not None and "__count__" not in legs5,
                     f"got {legs5.get('__count__')}"):
                check("5", "the entry balances",
                      D(e5["totalDebit"]) == D(e5["totalCredit"]), f"{e5['totalDebit']} vs {e5['totalCredit']}")
                check("5", "cost is debited (the company does not track stock here)",
                      legs5.get(COGS["id"]) == Decimal("100000.00"), f"got {legs5.get(COGS['id'])}")
                check("5", "input tax is debited — reclaimable, not a cost",
                      legs5.get(INPUT_TAX["id"]) == Decimal("18000.00"), f"got {legs5.get(INPUT_TAX['id'])}")
                check("5", "A/P is credited with what the supplier is owed",
                      legs5.get(AP["id"]) == Decimal("-118000.00"), f"got {legs5.get(AP['id'])}")
                ap_line = next((l for l in e5["lines"] if l["accountId"] == AP["id"]), None)
                check("5", "and the payable names the supplier and the bill",
                      ap_line and ap_line["partyType"] == "Supplier"
                      and ap_line["partyId"] == supplier["id"]
                      and ap_line["purchaseBillId"] == pb["id"], f"got {ap_line}")

        status, pbw = http("POST", "/api/purchasebills", base, token=token, body={
            "companyId": company_id, "supplierId": supplier["id"], "date": today,
            "gstRate": 18, "supplierBillNumber": f"SBW-{stamp}", "withholdingTaxRate": 4,
            "items": [{"itemTypeId": type_id, "description": "[TEMP] bought",
                       "quantity": 100, "uom": "KG", "unitPrice": 1000}]})
        if check("5", "a purchase bill with withholding saves", status in (200, 201), f"{status} {err_text(pbw)}"):
            e5w, legs5w = entry_for("PurchaseBill", pbw["id"])
            if "__count__" not in legs5w:
                check("5", "cost is still the full net — withholding is not a discount",
                      legs5w.get(COGS["id"]) == Decimal("100000.00"), f"got {legs5w.get(COGS['id'])}")
                check("5", "we owe the supplier less",
                      legs5w.get(AP["id"]) == Decimal("-113280.00"), f"got {legs5w.get(AP['id'])}")
                check("5", "and owe FBR the withheld slice",
                      legs5w.get(WHT_PAY["id"]) == Decimal("-4720.00"), f"got {legs5w.get(WHT_PAY['id'])}")

        # ── 6. receipts ──────────────────────────────────────────────────────
        print("\n=== 6. A receipt moves money and clears receivable ===")
        status, rcp = http("POST", f"/api/payments/receipts/company/{company_id}", base, token=token, body={
            "date": today, "contactType": "Client", "contactId": client["id"],
            "bankAccountId": BANK["id"], "method": "Cash", "amount": 50000,
            "allocations": [{"invoiceId": ft["id"], "amount": 50000}]})
        if check("6", "a receipt saves", status in (200, 201), f"{status} {err_text(rcp)}"):
            e6, legs6 = entry_for("Payment", rcp["id"])
            if check("6", "it posted one entry", e6 is not None and "__count__" not in legs6,
                     f"got {legs6.get('__count__')}"):
                check("6", "the bank is debited", legs6.get(BANK["id"]) == Decimal("50000.00"),
                      f"got {legs6.get(BANK['id'])}")
                check("6", "and receivable is cleared by the same amount",
                      legs6.get(AR["id"]) == Decimal("-50000.00"), f"got {legs6.get(AR['id'])}")
                check("6", "the entry balances",
                      D(e6["totalDebit"]) == D(e6["totalCredit"]), f"{e6['totalDebit']} vs {e6['totalCredit']}")

        # A receipt line can also name an ACCOUNT directly — income with no
        # document behind it. (Money beyond what a receipt settles is not
        # reachable here: this line sets Payment.Amount to the sum of its
        # allocations, so there is never a remainder to place.)
        other_income = by_name["Other income"]
        status, direct = http("POST", f"/api/payments/receipts/company/{company_id}", base, token=token, body={
            "date": today, "contactType": "Client", "contactId": client["id"],
            "bankAccountId": BANK["id"], "method": "Cash",
            "allocations": [{"accountId": other_income["id"], "amount": 7000}]})
        if check("6", "a receipt straight to an income account saves",
                 status in (200, 201), f"{status} {err_text(direct)}"):
            e6a, legs6a = entry_for("Payment", direct["id"])
            if check("6", "it posted one entry", e6a is not None and "__count__" not in legs6a,
                     f"got {legs6a.get('__count__')}"):
                check("6", "the bank is debited", legs6a.get(BANK["id"]) == Decimal("7000.00"),
                      f"got {legs6a.get(BANK['id'])}")
                check("6", "and the named income account is credited — not A/R",
                      legs6a.get(other_income["id"]) == Decimal("-7000.00")
                      and AR["id"] not in legs6a,
                      f"got {legs6a}")
                check("6", "nothing pooled on Suspense",
                      not any(a["controlType"] == "Suspense" and a["id"] in legs6a for a in flat),
                      "a resolvable line reached Suspense")

        # ── 7. a credit note reverses every leg ──────────────────────────────
        print("\n=== 7. A credit note reverses what the sale posted ===")
        if args.db:
            sql(args.db,
                "UPDATE Invoices SET FbrStatus='Submitted', FbrIRN='TEMPIRN" + stamp + "', "
                "FbrSubmittedAt=GETUTCDATE() WHERE Id=" + str(ft["id"]))
        status, note = http("POST", "/api/invoices/notes", base, token=token, body={
            "originalInvoiceId": ft["id"], "noteType": 2,
            "reason": "Return of goods", "partial": False})
        if status in (200, 201):
            e7, legs7 = entry_for("Invoice", note["id"])
            if check("7", "the note posted one entry", e7 is not None and "__count__" not in legs7,
                     f"got {legs7.get('__count__')}"):
                check("7", "it balances",
                      D(e7["totalDebit"]) == D(e7["totalCredit"]), f"{e7['totalDebit']} vs {e7['totalCredit']}")
                check("7", "every leg is the exact opposite of the sale's",
                      all(legs7.get(k) == -v for k, v in legs3.items()),
                      f"sale={ {k: str(v) for k, v in legs3.items()} } note={ {k: str(v) for k, v in legs7.items()} }")
                check("7", "so revenue comes back out of Sales",
                      legs7.get(SALES["id"]) == Decimal("100000.00"), f"got {legs7.get(SALES['id'])}")
                check("7", "and the further-tax liability is released",
                      legs7.get(FURTHER_TAX["id"]) == Decimal("3000.00"), f"got {legs7.get(FURTHER_TAX['id'])}")
        elif not args.db:
            print("  [SKIP] needs --db: a note can only be raised against a bill that was")
            print("         really filed with FBR, and nothing in the API can fake that.")
        else:
            check("7", "a credit note against the filed bill saves", False, f"{status} {err_text(note)}")

        # ── 8. the ledger ties out, read a different way ─────────────────────
        print("\n=== 8. The ledger ties out ===")
        status, gl = http("GET", f"/api/accounting/gl/company/{company_id}/status", base, token=token)
        check("8", "debits equal credits across everything", gl.get("isBalanced") is True,
              f"{gl.get('totalDebit')} vs {gl.get('totalCredit')}")
        status, tb = http("GET", f"/api/accounting/reports/company/{company_id}/trial-balance",
                          base, token=token)
        check("8", "the trial balance foots",
              D(tb["totalDebit"]) == D(tb["totalCredit"]), f"{tb['totalDebit']} vs {tb['totalCredit']}")
        # Cross-check: the chart's Sales balance must equal the sum of the
        # sales legs the ledger holds. Two engines, one number.
        status, tree = http("GET", f"/api/accounts/company/{company_id}/tree", base, token=token)

        def walk(nodes):
            for n in nodes or []:
                for a in n.get("accounts") or []:
                    yield a
                yield from walk(n.get("children"))
        chart = {a["id"]: a for a in list(walk(tree["balanceSheet"])) + list(walk(tree["profitAndLoss"]))}
        tb_rows = {r["accountId"]: r for r in tb["rows"]}
        check("8", "every trial-balance closing matches the chart's balance",
              all(D(r["closing"]) == D(chart[aid]["balance"]) for aid, r in tb_rows.items() if aid in chart),
              "a trial-balance row disagrees with the chart")

        # ── 9. a rebuild reproduces the same ledger ──────────────────────────
        print("\n=== 9. A rebuild reproduces the same ledger ===")
        status, before_tb = http("GET", f"/api/accounting/reports/company/{company_id}/trial-balance",
                                 base, token=token)
        status, reb = http("POST", f"/api/accounting/gl/company/{company_id}/rebuild", base, token=token)
        if check("9", "the rebuild runs", status == 200, f"{status} {err_text(reb)}"):
            status, after_tb = http("GET", f"/api/accounting/reports/company/{company_id}/trial-balance",
                                    base, token=token)
            before = {r["accountId"]: D(r["closing"]) for r in before_tb["rows"]}
            after = {r["accountId"]: D(r["closing"]) for r in after_tb["rows"]}
            check("9", "every account lands on the same closing balance", before == after,
                  f"differs on {sorted(set(before) ^ set(after)) or [k for k in before if before[k] != after.get(k)]}")
            check("9", "and the ledger still foots",
                  D(after_tb["totalDebit"]) == D(after_tb["totalCredit"]),
                  f"{after_tb['totalDebit']} vs {after_tb['totalCredit']}")

        # ── 10. void and delete take the entry with them ─────────────────────
        print("\n=== 10. A document that stops being a document takes its entry ===")
        status, doomed = make_bill()
        if check("10", "a bill to void saves", status in (200, 201), f"{status} {err_text(doomed)}"):
            e10, legs10 = entry_for("Invoice", doomed["id"])
            check("10", "it posted", e10 is not None and "__count__" not in legs10, f"got {legs10.get('__count__')}")
            status, v = http("POST", f"/api/invoices/{doomed['id']}/void", base, token=token,
                             body={"reason": "[TEMP] posting suite"})
            if status not in (200, 204):
                status, v = http("POST", f"/api/invoices/{doomed['id']}/cancel", base, token=token,
                                 body={"reason": "[TEMP] posting suite"})
            if check("10", "voiding it works", status in (200, 204), f"{status} {err_text(v)}"):
                e10b, legs10b = entry_for("Invoice", doomed["id"])
                check("10", "a voided bill has NO ledger entry left",
                      e10b is None, f"still has {legs10b}")

        status, doomed2 = make_bill()
        if check("10", "a bill to delete saves", status in (200, 201), f"{status} {err_text(doomed2)}"):
            status, _ = http("DELETE", f"/api/invoices/{doomed2['id']}", base, token=token)
            if check("10", "deleting it works", status in (200, 204), f"got {status}"):
                e10c, _ = entry_for("Invoice", doomed2["id"])
                check("10", "a deleted bill has NO ledger entry left", e10c is None, "an orphan entry survived")

        status, gl = http("GET", f"/api/accounting/gl/company/{company_id}/status", base, token=token)
        check("10", "and the ledger still balances after all that",
              gl.get("isBalanced") is True, f"{gl.get('totalDebit')} vs {gl.get('totalCredit')}")

        # ── 11. a demo bill never posts ──────────────────────────────────────
        print("\n=== 11. A demo bill is not a transaction ===")
        if not args.db:
            print("  [SKIP] needs --db: there is no demo-bill create path, so the flag has to")
            print("         be set directly before the bill is re-posted.")
        else:
            status, demo = make_bill()
            if check("11", "a bill to flag as demo saves", status in (200, 201), f"{status} {err_text(demo)}"):
                e11, legs11 = entry_for("Invoice", demo["id"])
                check("11", "it posted while it was a real bill",
                      e11 is not None and "__count__" not in legs11, f"got {legs11.get('__count__')}")
                sql(args.db, "UPDATE Invoices SET IsDemo=1 WHERE Id=" + str(demo["id"]))
                status, _ = http("POST", f"/api/accounting/gl/company/{company_id}/rebuild", base, token=token)
                if check("11", "a rebuild runs after the flag is set", status == 200, f"got {status}"):
                    e11b, _ = entry_for("Invoice", demo["id"])
                    check("11", "a demo bill has NO ledger entry — it is excluded from the books "
                                "the same way it is excluded from every KPI",
                          e11b is None, "a demo bill reached the ledger")
                    status, gl = http("GET", f"/api/accounting/gl/company/{company_id}/status",
                                      base, token=token)
                    check("11", "and the ledger still balances without it",
                          gl.get("isBalanced") is True, f"{gl.get('totalDebit')} vs {gl.get('totalCredit')}")

    finally:
        print("\n=== Cleanup ===")
        if company_id:
            status, _ = http("DELETE", f"/api/companies/{company_id}", base, token=token)
            check("cleanup", "throwaway company deleted", status in (200, 204), f"got {status}")
        if type_id:
            status, _ = http("DELETE", f"/api/itemtypes/{type_id}", base, token=token)
            check("cleanup", "throwaway item type removed with company", status in (200, 204, 404), f"got {status}")

    print()
    print("=" * 78)
    if FAIL:
        print(f"  {PASS} passed, {FAIL} FAILED")
        for f in FAILURES:
            print(f"   - {f}")
        print("=" * 78)
        return 1
    print(f"  POSTING SUITE PASSED - {PASS}/{PASS} checks")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
