#!/usr/bin/env python3
"""
Monthly stock relief (cost of goods sold) — end-to-end.

Until 2026-09-17 nothing credited the Inventory control account: it was an
opening balance plus purchases, so a stock-tracking company reported revenue
with no matched cost and its balance sheet overstated stock by everything it
had ever sold. PostingService.PostInventoryPeriodsAsync now writes one relief
entry per company per month.

THE LOAD-BEARING ASSERTION, repeated after every step:

    Inventory control account balance == the stock walk's closing value

That is the invariant the defect broke, and the one a future change is most
likely to break again. Every other check here exists to make a failure of it
diagnosable.

    python scripts/test_cogs_periodic.py --base http://localhost:5134
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta
from typing import Any

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((PASS if ok else FAIL, name, detail))
    print(f"  [{PASS if ok else FAIL}] {name}" + (f" — {detail}" if detail and not ok else ""))
    return ok


def http(method: str, path: str, base: str, token: str | None = None,
         body: Any = None, timeout: int = 60) -> tuple[int, Any]:
    url = base.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") if e.fp else ""
        try:
            return e.code, json.loads(raw) if raw else None
        except Exception:
            return e.code, raw
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def approx(a: float, b: float, tol: float = 0.02) -> bool:
    return abs(float(a) - float(b)) <= tol


# ── the invariant ────────────────────────────────────────────────────────────

def inventory_account_balance(base, token, cid) -> float:
    """Inventory control account's real balance.

    The trial balance's CLOSING column, which is opening + movement. Reading
    `debit - credit` instead gives journal movement only and silently drops the
    opening stock -- it made this suite report a 100,000 gap against working
    code.
    """
    st, rows = http("GET", f"/api/accounts/company/{cid}/flat", base, token=token)
    if st != 200 or not isinstance(rows, list):
        return 0.0
    inv = next((a for a in rows
                if a.get("controlType") == "Inventory" and a.get("isActive")), None)
    if not inv:
        return 0.0

    st, tb = http("GET", f"/api/accounting/reports/company/{cid}/trial-balance",
                  base, token=token)
    if st == 200 and tb:
        for r in (tb.get("rows") if isinstance(tb, dict) else tb) or []:
            if r.get("accountId") == inv["id"]:
                return float(r.get("closing") or 0)

    opening = float(inv.get("openingBalance") or 0)
    return opening if inv.get("openingBalanceIsDebit", True) else -opening


def stock_walk_value(base, token, cid) -> float:
    """What the stock dashboard says the goods are worth."""
    st, rows = http("GET", f"/api/stock/company/{cid}/onhand", base, token=token)
    if st != 200 or not isinstance(rows, list):
        return 0.0
    return sum(float(r.get("valueExcludingTax") or 0) for r in rows)


def assert_invariant(base, token, cid, label) -> bool:
    acct = inventory_account_balance(base, token, cid)
    walk = stock_walk_value(base, token, cid)
    return check(
        f"{label}: Inventory account == stock walk",
        approx(acct, walk, 0.05),
        f"account={acct:,.2f} walk={walk:,.2f} diff={acct - walk:,.2f}")


def relief_entries(base, token, cid) -> list[dict]:
    """The monthly stock-relief entries, found by their narration."""
    st, rep = http("GET",
                   f"/api/accounting/reports/company/{cid}/journal-register",
                   base, token=token)
    if st != 200 or not rep:
        return []
    rows = rep.get("rows") if isinstance(rep, dict) else rep
    seen, out = set(), []
    for r in rows or []:
        blob = json.dumps(r).lower()
        if "stock relief" in blob:
            key = r.get("entryNo") or r.get("journalEntryId") or json.dumps(r)[:60]
            if key not in seen:
                seen.add(key)
                out.append(r)
    return out


# ── setup ────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()
    base = args.base

    st, auth = http("POST", "/api/auth/login", base,
                    body={"username": args.username, "password": args.password})
    if st != 200 or not auth:
        print(f"login failed: {st} {auth}")
        return 1
    token = auth.get("token") or auth.get("accessToken")
    tag = date.today().strftime("%H%M%S") + str(abs(hash(str(date.today()))) % 997)

    cid = None
    try:
        st, co = http("POST", "/api/companies", base, token=token, body={
            "name": f"COGS Periodic {tag}",
            "fullAddress": "Test HQ", "phone": "+92-21-00000000",
            "ntn": "9999999", "cnic": "9999999999999", "strn": "9999999999999",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
        })
        if not check("setup: company created", st in (200, 201), f"{st} {co}"):
            return report()
        cid = co["id"]

        http("POST", f"/api/accounts/company/{cid}/seed-wholesale", base, token=token)
        st, _ = http("POST", f"/api/accounting/gl/company/{cid}/enable", base, token=token)
        check("setup: ledger enabled", st in (200, 204), f"{st}")

        st, client = http("POST", "/api/clients", base, token=token, body={
            "name": f"COGS Client {tag}", "address": "1 Test Road, Karachi",
            "phone": "021-1234567", "companyId": cid, "ntn": "1234567",
            "strn": "1234567890123", "fbrProvinceCode": 8,
            "registrationType": "Registered",
        })
        if not check("setup: client created", st in (200, 201), f"{st} {client}"):
            return report()

        st, item = http("POST", "/api/itemtypes", base, token=token, body={
            "name": f"COGS Item {tag}", "hsCode": "8481.1000", "uom": "Pcs",
            "companyId": cid,
        })
        if not check("setup: item created", st in (200, 201), f"{st} {item}"):
            return report()
        item_id = item["id"]

        # 100 units worth 100,000 → unit cost 1,000.
        st, _ = http("POST", "/api/stock/opening", base, token=token, body={
            "companyId": cid, "itemTypeId": item_id, "quantity": 100,
            "valueExcludingTax": 100000, "salesTaxRate": 18,
            "asOfDate": (date.today().replace(day=1) - timedelta(days=40)).isoformat(),
        })
        if not check("setup: opening stock 100 @ 100,000", st in (200, 201, 204), f"{st}"):
            return report()

        assert_invariant(base, token, cid, "1: opening only")
        check("1: no relief entry before anything sells",
              len(relief_entries(base, token, cid)) == 0,
              f"entries={len(relief_entries(base, token, cid))}")

        # ── 2: a sale relieves stock at weighted average ──────────────────
        today = date.today().isoformat()
        # Standalone: this line's bill flow otherwise insists on a challan.
        st, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
            "date": today, "companyId": cid, "clientId": client["id"], "gstRate": 18,
            "items": [{"itemTypeId": item_id, "description": "sale",
                       "quantity": 40, "uom": "Pcs", "unitPrice": 1500}],
        })
        if not check("2: invoice for 40 units created", st in (200, 201), f"{st} {inv}"):
            return report()
        inv_id = inv["id"]

        assert_invariant(base, token, cid, "2: after a sale")
        check("2: stock walk fell by cost, not by sale price",
              approx(stock_walk_value(base, token, cid), 60000),
              f"walk={stock_walk_value(base, token, cid):,.2f} expected 60,000 "
              f"(100,000 − 40 × 1,000 cost; the 60,000 of REVENUE is irrelevant here)")

        entries = relief_entries(base, token, cid)
        check("2: exactly one relief entry exists", len(entries) == 1,
              f"entries={len(entries)}")

        # ── 3: editing the sale reflows the month ─────────────────────────
        st, _ = http("PUT", f"/api/invoices/{inv_id}", base, token=token, body={
            "id": inv_id, "date": today, "companyId": cid, "clientId": client["id"],
            "gstRate": 18,
            "items": [{"itemTypeId": item_id, "description": "sale",
                       "quantity": 25, "uom": "Pcs", "unitPrice": 1500}],
        })
        check("3: invoice edited to 25 units", st in (200, 204), f"{st}")
        assert_invariant(base, token, cid, "3: after editing the sale")
        check("3: walk back up to 75,000", approx(stock_walk_value(base, token, cid), 75000),
              f"walk={stock_walk_value(base, token, cid):,.2f}")

        # ── 4: an adjustment is NOT cost of goods sold ────────────────────
        st, adj = http("POST", "/api/stock/adjust", base, token=token, body={
            "companyId": cid, "itemTypeId": item_id,
            "mode": "delta", "delta": -5,
            "movementDate": today, "note": "breakage",
        })
        check("4: stock adjustment recorded", st in (200, 201), f"{st} {adj}")
        assert_invariant(base, token, cid, "4: after an adjustment")

        st, flat = http("GET", f"/api/accounts/company/{cid}/flat", base, token=token)
        names = [a.get("name", "") for a in (flat or [])] if st == 200 else []
        check("4: an Inventory adjustments account exists, separate from COGS",
              any("inventory adjustment" in n.lower() for n in names),
              f"accounts={[n for n in names if 'inventor' in n.lower() or 'cost of goods' in n.lower()]}")

        # ── 5: cancelling the sale removes its cost ───────────────────────
        st, _ = http("POST", f"/api/invoices/{inv_id}/cancel", base, token=token,
                     body={"reason": "test"})
        if st in (200, 204):
            assert_invariant(base, token, cid, "5: after cancelling the sale")
            walk = stock_walk_value(base, token, cid)
            check("5: the sale's cost came back, breakage stayed gone",
                  approx(walk, 95000, 0.05),
                  f"walk={walk:,.2f} expected ~95,000 "
                  f"(100,000 opening − 5 units × 1,000 breakage)")
        else:
            check("5: invoice cancel accepted", False, f"{st}")

        # ── 6: reposting is idempotent ────────────────────────────────────
        before = inventory_account_balance(base, token, cid)
        http("POST", "/api/stock/adjust", base, token=token, body={
            "companyId": cid, "itemTypeId": item_id,
            "mode": "delta", "delta": 0, "valueDelta": 0,
            "movementDate": today, "note": "no-op re-trigger",
        })
        after = inventory_account_balance(base, token, cid)
        check("6: a no-op repost changes nothing", approx(before, after),
              f"before={before:,.2f} after={after:,.2f}")
        assert_invariant(base, token, cid, "6: after a repost")

    finally:
        if cid and not args.keep:
            http("DELETE", f"/api/companies/{cid}", base, token=token)
            # Item types are GLOBAL, so one left behind outlives its company and
            # becomes whatever `first_item_type_id` hands the next suite — which
            # is how a --keep run here broke test_basic_flows. Company first: it
            # holds the documents that reference the row.
            st, its = http("GET", "/api/itemtypes", base, token=token)
            for r in (its if isinstance(its, list) else []):
                if str(r.get("name", "")).startswith(f"COGS Item {tag}"):
                    http("DELETE", f"/api/itemtypes/{r['id']}", base, token=token)

    return report()


def report() -> int:
    failed = [r for r in results if r[0] == FAIL]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    if failed:
        print("FAILURES:")
        for _, name, detail in failed:
            print(f"  - {name}: {detail}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
