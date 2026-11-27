"""
GD revision suite -- revise a recorded GD from one sheet.

A GD whose goods arrived is recorded; later the declaration changes. Instead of
correcting it one line at a time, the operator downloads the GD as a sheet,
edits it and uploads it back:

  1. the downloaded sheet reads back as "nothing to change"
  2. a changed line, a new line and a removed line apply in one go, and stock,
     the GD's totals and its lines all follow
  3. a quantity already sold cannot be revised away, by lowering it or by
     removing the line; nothing is written when it is refused
  4. rows for another GD are ignored; a sheet with none for this GD is refused
  5. a Backfill GD is not revised from a sheet
  6. a user of another company is refused all three routes

Local database only. Throwaway companies, removed at the end.

Usage:
  python scripts/test_gd_revision.py --base http://localhost:5135
"""
import argparse
import io
import os
import sys
import uuid

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_gd_import_costing as g  # noqa: E402  (its helpers; its own sections do not run)

try:
    import openpyxl
except ImportError:
    print("openpyxl is required:  pip install openpyxl")
    sys.exit(2)

check, close = g.check, g.close

# The built-in layout (Helpers/ExcelImport/GdCostingLayout.cs), which the
# downloaded sheet is written in.
COL = {"gd": 1, "date": 2, "desc": 3, "qty": 4, "unit": 5, "hs": 6, "assessed": 7, "duty": 8,
       "st": 12, "ast": 14, "others": 16, "it": 19, "addon": 22, "selling": 23}


def sheet_bytes(wb):
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def rows_of(ws):
    """Data rows of a downloaded GD sheet: {description: row number}."""
    return {str(ws.cell(r, COL["desc"]).value): r for r in range(3, ws.max_row + 1)
            if ws.cell(r, COL["desc"]).value}


def add_row(ws, gd, desc, hs, qty, assessed, unit="Pcs", date="01-07-2026"):
    r = ws.max_row + 1
    for key, val in (("gd", gd), ("date", date), ("desc", desc), ("qty", qty), ("unit", unit), ("hs", hs),
                     ("assessed", assessed), ("duty", 0), ("st", 18), ("ast", 3), ("others", 0), ("it", 6),
                     ("addon", 0)):
        ws.cell(r, COL[key], val)
    return r


def download(api, h, cid):
    r = requests.get(f"{api}/import-consignments/{cid}/sheet", headers=h, timeout=60)
    return r, (openpyxl.load_workbook(io.BytesIO(r.content)) if r.ok else None)


def preview(api, h, cid, content):
    return g.upload(f"{api}/import-consignments/{cid}/revise/preview", h, content, f"rev-{uuid.uuid4().hex[:6]}.xlsx")


def commit(api, h, cid, pv, reason="GD revised by customs"):
    sheet = pv.get("sheet") or {}
    return requests.post(f"{api}/import-consignments/{cid}/revise/commit", headers=h, timeout=180, json={
        "lines": sheet.get("lines", []), "fileSha256": sheet.get("fileSha256"), "fileName": sheet.get("fileName"),
        "fileSizeBytes": sheet.get("fileSizeBytes"), "reason": reason})


def on_hand(api, h, company, name):
    rows = requests.get(f"{api}/stock/company/{company}/onhand", headers=h, timeout=60).json()
    row = next((x for x in rows if x.get("itemTypeName") == name), None)
    if row:
        g.CREATED_ITEM_TYPE_IDS.append(row["itemTypeId"])
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    api = f"{base}/api"
    h = {"Authorization": f"Bearer {g.login(base, args.username, args.password)}"}
    tag = uuid.uuid4().hex[:6].upper()
    company = g.make_company(api, h, f"GD Revision Co {tag}")
    other_co = g.make_company(api, h, f"GD Revision Other {tag}")
    outsider_id = None
    gd = f"REV-{tag}"
    A, B, C, D, E = (f"Rev Valve {tag}", f"Rev Breaker {tag}", f"Rev Valve Part {tag}",
                     f"Rev Machine {tag}", f"Rev Torch {tag}")

    try:
        print("\n-- 0. A GD arrives --")
        rows = [g.row_cells(g.BASE_COLS, gd, hs, desc=name, qty=qty, assessed=assessed, st=18, ast=3, it=6)
                for name, hs, qty, assessed in ((A, "8481.1000", 100, 50000), (B, "8536.1010", 50, 20000),
                                                (C, "8481.9000", 20, 8000), (D, "8479.8990", 10, 90000))]
        pv = g.gd_preview(api, h, company, g.build_sheet(g.BASE_HEADINGS, rows), g.GD_MAPPING, mode="new-arrivals")
        r = g.commit_preview(api, h, company, pv.json(), "new-arrivals") if pv.ok else pv
        if not check("the GD is imported as new arrivals", r.ok, f"http {r.status_code}: {r.text[:300]}"):
            return g.report()
        cid = g.find_consignment_id(api, h, company, gd)
        for name, qty in ((A, 100), (B, 50), (C, 20), (D, 10)):
            row = on_hand(api, h, company, name)
            check(f"{name.split()[1]} is on hand ({qty})", row is not None and close(row.get("onHand"), qty), f"{row}")
        before = g.get_consignment(api, h, cid).json()

        print("\n-- 1. The GD as a sheet reads back unchanged --")
        r, wb = download(api, h, cid)
        if not check("the GD downloads as a workbook", r.ok and wb is not None, f"http {r.status_code}"):
            return g.report()
        ws = wb.worksheets[0]
        check("it has one row per line", len(rows_of(ws)) == 4, f"{sorted(rows_of(ws))}")
        r = preview(api, h, cid, sheet_bytes(wb))
        p = r.json() if r.ok else {}
        check("the unedited sheet previews", r.ok, f"http {r.status_code}: {r.text[:300]}")
        check("with nothing changed, added or removed",
              (p.get("changed"), p.get("added"), p.get("removed"), p.get("unchanged")) == (0, 0, 0, 4),
              f"changed={p.get('changed')} added={p.get('added')} removed={p.get('removed')} unchanged={p.get('unchanged')} "
              f"errors={p.get('blockingErrors')}")
        check("and no blocking error", not p.get("blockingErrors"), f"{p.get('blockingErrors')}")
        r = commit(api, h, cid, p)
        check("applying it is refused: nothing to change", r.status_code == 400, f"http {r.status_code}: {r.text[:200]}")

        print("\n-- 2. A changed, a new and a removed line in one go --")
        r, wb = download(api, h, cid)
        ws = wb.worksheets[0]
        at = rows_of(ws)
        ws.cell(at[A], COL["qty"], 120)
        ws.cell(at[A], COL["assessed"], 66000)
        ws.delete_rows(at[C])
        add_row(ws, gd, E, "8513.1090", 30, 15000)
        r = preview(api, h, cid, sheet_bytes(wb))
        p = r.json() if r.ok else {}
        check("the edited sheet previews", r.ok, f"http {r.status_code}: {r.text[:300]}")
        check("one changed, one added, one removed, two unchanged",
              (p.get("changed"), p.get("added"), p.get("removed"), p.get("unchanged")) == (1, 1, 1, 2),
              f"changed={p.get('changed')} added={p.get('added')} removed={p.get('removed')} unchanged={p.get('unchanged')}")
        check("nothing blocks it", not p.get("blockingErrors"), f"{p.get('blockingErrors')}")
        by_action = {x["action"]: x for x in p.get("rows", []) if x["action"] != "unchanged"}
        check("its selling value follows the edited costing",
              close((by_action.get("changed") or {}).get("newSellingValue"), 77000), f"{by_action.get('changed')}")
        check("the changed row shows the quantity before and after",
              close((by_action.get("changed") or {}).get("oldQuantity"), 100)
              and close((by_action.get("changed") or {}).get("newQuantity"), 120), f"{by_action.get('changed')}")
        check("the removed row is the line the sheet no longer has",
              (by_action.get("removed") or {}).get("description") == C, f"{by_action.get('removed')}")
        cost_a = float(g.compute_costing(66000, st=18, ast=3, it=6)["cost"])
        cost_e = float(g.compute_costing(15000, st=18, ast=3, it=6)["cost"])
        kept = sum(float(l["costExcludingTax"]) for l in before["lines"]
                   if l["descriptionOnSheet"] in (B, D))
        check("the new total is the lines' own costs", close(p.get("newTotalCost"), kept + cost_a + cost_e, 0.05),
              f"newTotalCost={p.get('newTotalCost')} expected={kept + cost_a + cost_e}")
        check("nothing is written by a preview",
              close(on_hand(api, h, company, A).get("onHand"), 100) and on_hand(api, h, company, E) is None, "stock moved")

        r = commit(api, h, cid, p)
        res = r.json() if r.ok else {}
        check("the revision applies", r.ok, f"http {r.status_code}: {r.text[:400]}")
        check("it reports 1 changed, 1 added, 1 removed",
              (res.get("linesChanged"), res.get("linesAdded"), res.get("linesRemoved")) == (1, 1, 1), f"{res}")
        after = g.get_consignment(api, h, cid).json()
        names = sorted(l["descriptionOnSheet"] for l in after["lines"])
        check("the GD now has the sheet's four lines", names == sorted([A, B, D, E]), f"{names}")
        check("the GD total follows the lines",
              close(after.get("totalCostExcludingTax"), sum(float(l["costExcludingTax"]) for l in after["lines"]), 0.05)
              and close(after.get("totalCostExcludingTax"), kept + cost_a + cost_e, 0.05),
              f"total={after.get('totalCostExcludingTax')}")
        check("the changed item holds the new quantity", close(on_hand(api, h, company, A).get("onHand"), 120),
              f"{on_hand(api, h, company, A)}")
        check("the new item is in stock", close((on_hand(api, h, company, E) or {}).get("onHand"), 30),
              f"{on_hand(api, h, company, E)}")
        gone = on_hand(api, h, company, C)
        check("the removed line's stock is gone", gone is None or close(gone.get("onHand"), 0), f"{gone}")
        check("an untouched item is untouched", close(on_hand(api, h, company, D).get("onHand"), 10),
              f"{on_hand(api, h, company, D)}")
        r = preview(api, h, cid, sheet_bytes(wb))
        again = r.json() if r.ok else {}
        check("the same sheet now reads as nothing to change",
              (again.get("changed"), again.get("added"), again.get("removed")) == (0, 0, 0),
              f"http {r.status_code} {again.get('changed')}/{again.get('added')}/{again.get('removed')} {again.get('blockingErrors')}")

        print("\n-- 3. A quantity already sold cannot be revised away --")
        b_item = on_hand(api, h, company, B)["itemTypeId"]
        adj = requests.post(f"{api}/stock/adjust", headers=h, timeout=60, json={
            "companyId": company, "itemTypeId": b_item, "mode": "delta", "delta": -40,
            "movementDate": "2026-07-20", "notes": "left the store"})
        check("40 of the 50 leave stock", adj.ok and close(on_hand(api, h, company, B).get("onHand"), 10),
              f"http {adj.status_code}: {adj.text[:200]}")
        r, wb = download(api, h, cid)
        ws = wb.worksheets[0]
        ws.cell(rows_of(ws)[B], COL["qty"], 30)
        r = preview(api, h, cid, sheet_bytes(wb))
        p = r.json() if r.ok else {}
        check("revising it to 30 is blocked, and the message names the item",
              r.ok and any(B in e for e in p.get("blockingErrors", [])), f"{p.get('blockingErrors')}")
        r = commit(api, h, cid, p)
        check("applying it is refused", r.status_code == 400, f"http {r.status_code}: {r.text[:200]}")
        check("and nothing moved", close(on_hand(api, h, company, B).get("onHand"), 10), f"{on_hand(api, h, company, B)}")

        r, wb = download(api, h, cid)
        ws = wb.worksheets[0]
        ws.delete_rows(rows_of(ws)[B])
        r = preview(api, h, cid, sheet_bytes(wb))
        p = r.json() if r.ok else {}
        check("removing the line is blocked too",
              r.ok and any(B in e for e in p.get("blockingErrors", [])), f"{p.get('blockingErrors')}")
        check("and refused on apply", commit(api, h, cid, p).status_code == 400, "applied")
        check("the GD still has the line",
              B in [l["descriptionOnSheet"] for l in g.get_consignment(api, h, cid).json()["lines"]], "line gone")

        r, wb = download(api, h, cid)
        ws = wb.worksheets[0]
        ws.cell(rows_of(ws)[B], COL["qty"], 45)
        r = preview(api, h, cid, sheet_bytes(wb))
        p = r.json() if r.ok else {}
        check("revising it to 45 (above the 40 sold) is allowed", r.ok and not p.get("blockingErrors"),
              f"{p.get('blockingErrors')}")
        r = commit(api, h, cid, p)
        check("and applies, leaving 5 on hand", r.ok and close(on_hand(api, h, company, B).get("onHand"), 5),
              f"http {r.status_code}: {r.text[:200]} {on_hand(api, h, company, B)}")

        print("\n-- 4. Rows for another GD, and a sheet with none for this one --")
        r, wb = download(api, h, cid)
        ws = wb.worksheets[0]
        add_row(ws, f"OTHER-{tag}", f"Rev Stranger {tag}", "8481.2000", 5, 1000)
        r = preview(api, h, cid, sheet_bytes(wb))
        p = r.json() if r.ok else {}
        check("a row for another GD is ignored with a warning",
              r.ok and p.get("added") == 0 and any("ignored" in w for w in p.get("warnings", [])),
              f"added={p.get('added')} warnings={p.get('warnings')}")
        for row in list(rows_of(ws).values()):
            ws.cell(row, COL["gd"], f"OTHER-{tag}")
        r = preview(api, h, cid, sheet_bytes(wb))
        p = r.json() if r.ok else {}
        check("a sheet with no row for this GD is blocked",
              r.ok and any("no rows" in e for e in p.get("blockingErrors", [])), f"{p.get('blockingErrors')}")

        print("\n-- 5. A Backfill GD is corrected line by line --")
        bf_name = f"Rev Backfill {tag}"
        bf_item = g.make_item(api, h, company, bf_name, hs="8484.1029")
        g.set_opening(api, h, company, bf_item, qty=40, value=40000)
        bf_gd = f"REVBF-{tag}"
        pv = g.gd_preview(api, h, company, g.build_sheet(g.BASE_HEADINGS, [
            g.row_cells(g.BASE_COLS, bf_gd, "8484.1029", desc=bf_name, qty=40, assessed=30000, st=18, ast=3, it=6)]),
            g.GD_MAPPING, mode="backfill")
        r = g.commit_preview(api, h, company, pv.json(), "backfill", create=False) if pv.ok else pv
        bf_cid = g.find_consignment_id(api, h, company, bf_gd) if r.ok else None
        if check("a Backfill GD is recorded", bf_cid is not None, f"http {r.status_code}: {r.text[:200]}"):
            r, wb = download(api, h, bf_cid)
            r = preview(api, h, bf_cid, sheet_bytes(wb)) if wb is not None else r
            p = r.json() if r.ok else {}
            check("revising it from a sheet is blocked",
                  r.ok and any("Backfill" in e for e in p.get("blockingErrors", [])), f"{p.get('blockingErrors')}")

        print("\n-- 6. Another company's user --")
        utag = uuid.uuid4().hex[:8]
        r = requests.post(f"{api}/users", headers=h, timeout=30, json={
            "username": f"gdrev_{utag}", "password": "test1234", "fullName": "GD Revision Outsider",
            "role": "Administrator"})
        outsider_id = (r.json() if r.ok else {}).get("id")
        roles = requests.get(f"{api}/roles", headers=h, timeout=30).json()
        admin_role = next((x["id"] for x in roles if x["name"] == "Administrator"), None)
        requests.put(f"{api}/users/{outsider_id}/roles", headers=h, timeout=30, json={"roleIds": [admin_role]})
        requests.put(f"{api}/usercompanies/user/{outsider_id}", headers=h, timeout=30, json={"companyIds": [other_co]})
        ho = {"Authorization": f"Bearer {g.login(base, f'gdrev_{utag}', 'test1234')}"}
        r = requests.get(f"{api}/import-consignments?companyId={other_co}", headers=ho, timeout=30)
        check("the outsider can use the screen for their own company", r.status_code == 200, f"http {r.status_code}")
        _, wb = download(api, h, cid)
        content = sheet_bytes(wb)
        r = requests.get(f"{api}/import-consignments/{cid}/sheet", headers=ho, timeout=30)
        check("they are refused the GD sheet", r.status_code in (403, 404), f"http {r.status_code}")
        r = preview(api, ho, cid, content)
        check("they are refused the revision preview", r.status_code in (403, 404), f"http {r.status_code}")
        r = commit(api, ho, cid, preview(api, h, cid, content).json())
        check("they are refused the revision itself", r.status_code in (403, 404), f"http {r.status_code}: {r.text[:200]}")

    finally:
        if not args.keep:
            if outsider_id:
                requests.delete(f"{api}/users/{outsider_id}", headers=h, timeout=30)
            for co in (company, other_co):
                requests.delete(f"{api}/companies/{co}", headers=h, timeout=300)
            for iid in set(g.CREATED_ITEM_TYPE_IDS):
                try:
                    requests.delete(f"{api}/itemtypes/{iid}", headers=h, timeout=60)
                except Exception:
                    pass

    return g.report()


if __name__ == "__main__":
    sys.exit(main())
