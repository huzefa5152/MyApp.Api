#!/usr/bin/env python3
"""Customer Ledger — grouped-customer drill-down.

The Customer Ledger screen lists one row per CUSTOMER, and
CustomerLedgerService.GetAllCustomersAsync rolls those rows up by
`ClientGroupId ?? -ClientId`. Client.ClientGroupId carries a plain, NON-unique
index (AppDbContext:257), so one company really can hold two client records in
one group — that is exactly what groups are for, and ClientService assigns them
automatically from the NTN.

Before the fix the row showed GROUP totals while the panel expanded directly
underneath it called GetForClientAsync, which covers ONE client record. Two
different closing balances on one card, with the sibling's entries missing.

This pins the fix:
  • the aggregate row and the /customer/ drill-down agree, figure for figure;
  • both siblings' entries appear in the trail;
  • /client/ (the OLD route) still reports the single record, because
    ClientService.GetStatementAsync and the Client Ledger report depend on it;
  • group membership is scoped to the company — a same-NTN client belonging to
    another company never leaks in;
  • type and method are applied server-side and hide rows WITHOUT re-basing the
    opening/closing balance.

Usage:
    python scripts/test_customer_ledger_groups.py [--base URL] [--keep]
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

results: list[tuple[str, bool, str]] = []

# Fixed calendar dates so a run on the 1st reads like a run on the 28th.
D_INV_A, D_RCP_A = "2025-09-10", "2025-09-20"
D_INV_B, D_RCP_B = "2025-09-15", "2025-09-25"
D_OLD = "2025-06-30"                       # before the window → Opening
WINDOW_FROM, WINDOW_TO = "2025-09-01", "2025-09-30"


def iso(d: str) -> str:
    return f"{d}T00:00:00Z"


def http(method, path, base, token=None, body=None, timeout=120):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            text = r.read().decode("utf-8")
            return r.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as e:
        text = (e.read() if e.fp else b"").decode("utf-8", "replace")
        try:
            return e.code, (json.loads(text) if text else None)
        except Exception:
            return e.code, text


def check(name, ok, reason=""):
    results.append((name, ok, reason))
    print(("PASS" if ok else "FAIL") + f" - {name}" + ("" if ok else f"   [{reason}]"))
    return ok


def eq(a, b, tol=0.01):
    try:
        return abs(float(a) - float(b)) < tol
    except (TypeError, ValueError):
        return False


# ── builders ───────────────────────────────────────────────────────
def make_company(base, token, name):
    st, c = http("POST", "/api/companies", base, token=token, body={
        "name": name, "startingInvoiceNumber": 1, "startingPurchaseBillNumber": 1,
        "startingChallanNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnabled": False, "inventoryTrackingEnabled": False, "enableGl": True})
    if st not in (200, 201):
        print(f"FATAL: company create failed ({st} {c})")
        sys.exit(2)
    return c["id"]


def make_client(base, token, cid, name, ntn=None):
    body = {"name": name, "companyId": cid, "registrationType": "Unregistered"}
    if ntn:
        body["ntn"] = ntn
    st, c = http("POST", "/api/clients", base, token=token, body=body)
    if st not in (200, 201):
        print(f"FATAL: client create failed for {name!r} ({st} {c})")
        sys.exit(2)
    return c


def make_invoice(base, token, cid, client_id, item_type_id, total, date):
    st, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": iso(date), "companyId": cid, "clientId": client_id, "gstRate": 0,
        "items": [{"description": "Group ledger good", "quantity": 1, "uom": "Pcs",
                   "unitPrice": total, "itemTypeId": item_type_id}]})
    if st not in (200, 201):
        print(f"FATAL: invoice create failed ({st} {inv})")
        sys.exit(2)
    return inv


def make_receipt(base, token, cid, client_id, amount, date, method="Cash"):
    st, r = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "direction": "Receipt", "date": iso(date), "contactType": "Client",
        "contactId": client_id, "method": method, "amount": amount, "allocations": []})
    if st not in (200, 201):
        print(f"FATAL: receipt create failed ({st} {r})")
        sys.exit(2)
    return r


def first_item_type(base, token):
    _, its = http("GET", "/api/itemtypes", base, token=token)
    rows = its if isinstance(its, list) else ((its or {}).get("items") or [])
    return rows[0]["id"] if rows else None


def qs(params):
    return urllib.parse.urlencode({k: v for k, v in params.items() if v})


def summary(base, token, cid, **params):
    q = qs(params)
    return http("GET", f"/api/customer-ledger/company/{cid}" + (f"?{q}" if q else ""),
                base, token=token)


def trail(base, token, cid, client_id, route="customer", **params):
    q = qs(params)
    return http("GET", f"/api/customer-ledger/company/{cid}/{route}/{client_id}"
                + (f"?{q}" if q else ""), base, token=token)


# ── suites ─────────────────────────────────────────────────────────
def suite_1_grouping(base, token, ctx):
    """The two records really did land in one group — otherwise nothing below
    is testing what it claims to."""
    a, b = ctx["a"], ctx["b"]
    check("two client records created with distinct ids", a["id"] != b["id"],
          f"a={a['id']} b={b['id']}")
    check("both records share one ClientGroupId (auto-assigned from NTN)",
          a.get("clientGroupId") and a.get("clientGroupId") == b.get("clientGroupId"),
          f"a={a.get('clientGroupId')} b={b.get('clientGroupId')}")
    check("the foreign company's same-NTN record joined the SAME group",
          ctx["foreign_client"].get("clientGroupId") == a.get("clientGroupId"),
          f"foreign={ctx['foreign_client'].get('clientGroupId')} group={a.get('clientGroupId')}")


def suite_2_row_matches_drilldown(base, token, ctx):
    """THE REGRESSION: the panel under a row must not contradict the row."""
    cid, anchor = ctx["cid"], ctx["anchor"]
    st, rows = summary(base, token, cid)
    if not check("summary loads", st == 200 and isinstance(rows, list), f"{st} {rows}"):
        return
    ours = [r for r in rows if r["clientId"] in (ctx["a"]["id"], ctx["b"]["id"])]
    check("the two records collapse to ONE aggregate row", len(ours) == 1,
          f"got {len(ours)}: {[r['clientId'] for r in ours]}")
    if not ours:
        return
    row = ours[0]
    check("aggregate row is anchored on the lowest member id",
          row["clientId"] == anchor, f"{row['clientId']} != {anchor}")
    # No window: every document counts, including B's 80,000 dated before the
    # window used by suite 6. 400,000 + 250,000 + 80,000 credit - 150,000 debit.
    check("aggregate row carries BOTH members' figures",
          eq(row["invoiced"], 730000) and eq(row["received"], 150000)
          and eq(row["closing"], 580000),
          f"invoiced={row['invoiced']} received={row['received']} closing={row['closing']}")

    st, d = trail(base, token, cid, anchor)
    if not check("group drill-down loads", st == 200 and isinstance(d, dict), f"{st} {d}"):
        return
    check("drill-down Closing EQUALS the aggregate row's Closing",
          eq(d["closingBalance"], row["closing"]),
          f"panel={d['closingBalance']} row={row['closing']}")
    check("drill-down Opening EQUALS the aggregate row's Opening",
          eq(d["openingBalance"], row["opening"]),
          f"panel={d['openingBalance']} row={row['opening']}")
    check("drill-down totals EQUAL the row's Invoiced / Received",
          eq(d["totalCredit"], row["invoiced"]) and eq(d["totalDebit"], row["received"]),
          f"credit={d['totalCredit']}/{row['invoiced']} debit={d['totalDebit']}/{row['received']}")
    check("drill-down Outstanding / Advance EQUAL the row's",
          eq(d["outstanding"], row["outstanding"]) and eq(d["advance"], row["advance"]),
          f"{d['outstanding']}/{row['outstanding']} {d['advance']}/{row['advance']}")
    check("drill-down reports the anchor id/name, matching the row",
          d["clientId"] == row["clientId"] and d["clientName"] == row["clientName"],
          f"{d['clientId']}/{d['clientName']} vs {row['clientId']}/{row['clientName']}")

    refs = {e["reference"] for e in d["entries"]}
    check("BOTH siblings' invoices appear in the trail",
          ctx["inv_a_ref"] in refs and ctx["inv_b_ref"] in refs,
          f"want {ctx['inv_a_ref']} + {ctx['inv_b_ref']}, got {sorted(refs)}")
    check("BOTH siblings' receipts appear in the trail",
          ctx["rcp_a_ref"] in refs and ctx["rcp_b_ref"] in refs,
          f"want {ctx['rcp_a_ref']} + {ctx['rcp_b_ref']}, got {sorted(refs)}")
    check("trail holds exactly the 5 group entries (3 docs + 2 receipts)",
          d["total"] == 5, f"total={d['total']}")
    check("the newest row's running balance is the closing balance",
          eq(d["entries"][0]["balance"], 580000) if d["entries"] else False,
          f"newest-first head = {d['entries'][0]['balance'] if d['entries'] else None}")


def suite_3_old_route_unchanged(base, token, ctx):
    """GetForClientAsync is consumed by ClientService.GetStatementAsync and by
    the Client Ledger report; its single-record semantics must not shift."""
    cid, anchor = ctx["cid"], ctx["anchor"]
    st, d = trail(base, token, cid, anchor, route="client")
    if not check("/client/ route still responds", st == 200 and isinstance(d, dict), f"{st} {d}"):
        return
    check("/client/ reports ONLY the anchor record (400,000 / 100,000)",
          eq(d["totalCredit"], 400000) and eq(d["totalDebit"], 100000),
          f"credit={d['totalCredit']} debit={d['totalDebit']}")
    check("/client/ closing is the single record's, NOT the group's",
          eq(d["closingBalance"], 300000), f"closing={d['closingBalance']}")
    check("/client/ excludes the sibling's entries",
          all(e["reference"] not in (ctx["inv_b_ref"], ctx["rcp_b_ref"]) for e in d["entries"]),
          f"{[e['reference'] for e in d['entries']]}")

    # Compare the two routes against EACH OTHER, not against a constant neither
    # of them returns. The gap must be exactly member B's contribution
    # (250,000 + 80,000 credit - 50,000 debit = 280,000) — which is the size of
    # the discrepancy the old screen put on one card.
    st_g, g = trail(base, token, cid, anchor)
    if not check("/customer/ loads for the comparison", st_g == 200, f"{st_g} {g}"):
        return
    check("/client/ and /customer/ genuinely differ for a grouped customer",
          not eq(d["closingBalance"], g["closingBalance"]),
          f"both routes returned {d['closingBalance']}")
    check("the gap between the routes is exactly the sibling's contribution",
          eq(g["closingBalance"] - d["closingBalance"], 280000),
          f"group={g['closingBalance']} single={d['closingBalance']} "
          f"gap={g['closingBalance'] - d['closingBalance']} want 280000")
    check("the group trail carries more entries than the single record",
          g["total"] > d["total"], f"group={g['total']} single={d['total']}")


def suite_4_company_scope(base, token, ctx):
    """The group spans companies; the ledger must not."""
    cid, anchor = ctx["cid"], ctx["anchor"]
    st, d = trail(base, token, cid, anchor)
    if st != 200:
        return
    check("a same-NTN client in ANOTHER company does not leak into the trail",
          all(not eq(e.get("credit") or 0, 999999) for e in d["entries"]),
          f"{[(e['reference'], e['credit']) for e in d['entries']]}")
    check("group closing excludes the other company's invoice",
          eq(d["closingBalance"], 580000), f"closing={d['closingBalance']}")
    st, body = trail(base, token, cid, ctx["foreign_client"]["id"])
    check("a foreign client id 404s on the group route (no enumeration oracle)",
          st == 404, f"status={st} body={body}")


def suite_5_filters_server_side(base, token, ctx):
    """type and method hide rows; neither may re-base a balance."""
    cid, anchor = ctx["cid"], ctx["anchor"]

    st, d = trail(base, token, cid, anchor, type="Invoice")
    if check("type filter responds", st == 200, f"{st} {d}"):
        check("type=Invoice returns BOTH siblings' invoices (3 docs)", d["total"] == 3,
              f"total={d['total']}")
        check("type filter did not re-base Opening/Closing",
              eq(d["closingBalance"], 580000) and eq(d["openingBalance"], 0),
              f"closing={d['closingBalance']} opening={d['openingBalance']}")

    st, d = trail(base, token, cid, anchor, method="Cheque")
    if check("method filter responds (server-side)", st == 200, f"{st} {d}"):
        check("method=Cheque returns only the cheque receipt", d["total"] == 1,
              f"total={d['total']}")
        check("every returned entry really is a Cheque",
              all((e.get("method") or "") == "Cheque" for e in d["entries"]),
              f"{[e.get('method') for e in d['entries']]}")
        check("method filter reached the SIBLING's receipt, not just the anchor's",
              any(e["reference"] == ctx["rcp_b_ref"] for e in d["entries"]),
              f"{[e['reference'] for e in d['entries']]}")
        check("method filter did not re-base Opening/Closing",
              eq(d["closingBalance"], 580000) and eq(d["totalCredit"], 730000),
              f"closing={d['closingBalance']} credit={d['totalCredit']}")
        check("paging total matches the rows actually returned",
              d["total"] == len(d["entries"]), f"{d['total']} vs {len(d['entries'])}")

    st, d = trail(base, token, cid, anchor, method="Bank Transfer")
    check("a method with no rows returns an empty page, not an error",
          st == 200 and d["total"] == 0 and d["entries"] == []
          and eq(d["closingBalance"], 580000), f"{st} {d}")


def suite_6_window(base, token, ctx):
    """An out-of-window document must land in Opening on BOTH surfaces, and the
    two must still agree."""
    cid, anchor = ctx["cid"], ctx["anchor"]
    st, rows = summary(base, token, cid, **{"from": WINDOW_FROM, "to": WINDOW_TO})
    if not check("windowed summary loads", st == 200, f"{st} {rows}"):
        return
    ours = [r for r in rows if r["clientId"] == anchor]
    if not check("windowed summary still has the group row", len(ours) == 1, f"{ours}"):
        return
    row = ours[0]
    check("the pre-window invoice landed in the row's Opening",
          eq(row["opening"], 80000), f"opening={row['opening']}")
    st, d = trail(base, token, cid, anchor, **{"from": WINDOW_FROM, "to": WINDOW_TO})
    if not check("windowed drill-down loads", st == 200, f"{st} {d}"):
        return
    check("windowed drill-down Opening EQUALS the row's Opening",
          eq(d["openingBalance"], row["opening"]),
          f"panel={d['openingBalance']} row={row['opening']}")
    check("windowed drill-down Closing EQUALS the row's Closing",
          eq(d["closingBalance"], row["closing"]),
          f"panel={d['closingBalance']} row={row['closing']}")
    check("the pre-window entry is excluded from the windowed trail",
          all(e["reference"] != ctx["inv_old_ref"] for e in d["entries"]),
          f"{[e['reference'] for e in d['entries']]}")


def suite_7_solo_client(base, token, ctx):
    """A group of one must behave identically on both routes — proof the new
    path is a superset, not a different calculation."""
    cid, solo = ctx["cid"], ctx["solo"]["id"]
    st1, g = trail(base, token, cid, solo)
    st2, c = trail(base, token, cid, solo, route="client")
    if not check("solo client loads on both routes", st1 == 200 and st2 == 200, f"{st1}/{st2}"):
        return
    same = (eq(g["openingBalance"], c["openingBalance"])
            and eq(g["closingBalance"], c["closingBalance"])
            and eq(g["totalCredit"], c["totalCredit"])
            and eq(g["totalDebit"], c["totalDebit"])
            and g["total"] == c["total"])
    check("solo client: /customer/ == /client/, figure for figure", same,
          f"group={g['closingBalance']}/{g['total']} client={c['closingBalance']}/{c['total']}")


# ── setup ──────────────────────────────────────────────────────────
def setup(base, user, pw):
    st, data = http("POST", "/api/auth/login", base, body={"username": user, "password": pw})
    if st != 200:
        print(f"FATAL: login failed ({st} {data})")
        sys.exit(2)
    token = data["token"]
    item_type_id = first_item_type(base, token)
    if item_type_id is None:
        print("FATAL: no item type available")
        sys.exit(2)

    sfx = datetime.now().strftime("%Y%m%d%H%M%S")
    # A run-unique NTN, so each run gets its own ClientGroup and runs never
    # interfere. >= 7 digits or ClientGroupService falls back to name keying.
    ntn = sfx[-9:]

    cid = make_company(base, token, f"_test_cl_group {sfx}")
    other = make_company(base, token, f"_test_cl_group_other {sfx}")

    # Two records for ONE legal entity, differently spelled — the real reason a
    # company ends up with two rows in a group. Same NTN ⇒ same GroupKey.
    a = make_client(base, token, cid, f"Meko Fabrics Ltd {sfx}", ntn=ntn)
    b = make_client(base, token, cid, f"Meko Fabrics Limited {sfx}", ntn=ntn)
    solo = make_client(base, token, cid, f"Solo Trader {sfx}")
    foreign_client = make_client(base, token, other, f"Meko Fabrics Overseas {sfx}", ntn=ntn)

    inv_a = make_invoice(base, token, cid, a["id"], item_type_id, 400000, D_INV_A)
    inv_b = make_invoice(base, token, cid, b["id"], item_type_id, 250000, D_INV_B)
    inv_old = make_invoice(base, token, cid, b["id"], item_type_id, 80000, D_OLD)
    make_invoice(base, token, cid, solo["id"], item_type_id, 70000, D_INV_A)
    # The other company's same-NTN client — must never reach this company's row.
    make_invoice(base, token, other, foreign_client["id"], item_type_id, 999999, D_INV_A)

    rcp_a = make_receipt(base, token, cid, a["id"], 100000, D_RCP_A, method="Cash")
    rcp_b = make_receipt(base, token, cid, b["id"], 50000, D_RCP_B, method="Cheque")
    make_receipt(base, token, cid, solo["id"], 20000, D_RCP_A, method="Cash")

    return token, {
        "cid": cid, "other": other, "a": a, "b": b, "solo": solo,
        "foreign_client": foreign_client,
        "anchor": min(a["id"], b["id"]),
        "inv_a_ref": "INV-" + str(inv_a["invoiceNumber"]),
        "inv_b_ref": "INV-" + str(inv_b["invoiceNumber"]),
        "inv_old_ref": "INV-" + str(inv_old["invoiceNumber"]),
        "rcp_a_ref": "RCP-" + str(rcp_a["number"]),
        "rcp_b_ref": "RCP-" + str(rcp_b["number"]),
    }


def teardown(base, token, ctx, keep):
    if keep:
        print(f"\n(kept companies {ctx['cid']}, {ctx['other']})")
        return
    for cid in (ctx["cid"], ctx["other"]):
        http("DELETE", f"/api/companies/{cid}", base, token=token)
    print(f"\n(cleaned up companies {ctx['cid']}, {ctx['other']})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    print(f"Customer Ledger — grouped customer drill-down   ({args.base})\n")
    token, ctx = setup(args.base, args.user, args.password)
    print(f"company {ctx['cid']}: clients A={ctx['a']['id']} B={ctx['b']['id']} "
          f"(group {ctx['a'].get('clientGroupId')}), anchor={ctx['anchor']}\n")

    for name, fn in [
        ("1. group wiring", suite_1_grouping),
        ("2. row vs drill-down", suite_2_row_matches_drilldown),
        ("3. /client/ route unchanged", suite_3_old_route_unchanged),
        ("4. company scope", suite_4_company_scope),
        ("5. server-side filters", suite_5_filters_server_side),
        ("6. date window", suite_6_window),
        ("7. solo client parity", suite_7_solo_client),
    ]:
        print(f"-- {name} " + "-" * max(0, 48 - len(name)))
        fn(args.base, token, ctx)
        print()

    teardown(args.base, token, ctx, args.keep)

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print("\n" + "=" * 62)
    print(f"{passed}/{total} checks passed")
    if passed != total:
        print("\nFAILURES:")
        for n, ok, why in results:
            if not ok:
                print(f"  - {n}: {why}")
        return 1
    print("all PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
