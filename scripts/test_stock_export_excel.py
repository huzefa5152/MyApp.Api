"""
Live end-to-end test for the Stock dashboard Excel export.

  GET /api/stock/company/{id}/onhand/excel?search=

The export reproduces the customs-lot stock sheet the importer clients keep by
hand (Helpers/StockExcelBuilder.cs). The offline harness
(scripts/stock_export_harness) already pins that LAYOUT against synthetic rows.
This suite pins the things only a running server can answer:

  1. the workbook's figures equal what GET .../onhand returns, row for row —
     the export and the grid come out of one valuation walk, and the whole
     point of that is that they cannot disagree;
  2. the derived columns are derived the way the builder says: Opening is
     opening + total in, Consumed is total out, and Balance is the LIVE
     position rather than Opening minus Consumed;
  3. the totals row sums the right range, and the rows it covers tie to the
     API's own sum;
  4. the customs-declaration columns name a GD only where the item's lots
     agree on one, and never invent one for an item bought on bills;
  5. stock.dashboard.export alone yields the complete workbook (the old
     movement-detail split is gone with the drill-down), and a user without
     that permission gets 403;
  6. the search term reaches the workbook and is named on its Summary sheet.

Any user or role this suite creates is deleted in a finally block — the local
branch database is meant to stay at one company.

Usage:
  python scripts/test_stock_export_excel.py                        # localhost:5134, first company
  python scripts/test_stock_export_excel.py --base http://localhost:5136 --company 451

Exit code 0 = every assertion passed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required: pip install openpyxl")

BASE = "http://localhost:5134"
OUT = tempfile.mkdtemp(prefix="stock-export-")

# Column layout — must match Helpers/StockExcelBuilder.cs.
C_CLAIM, C_GDNO, C_GDDATE, C_ITEM, C_SUBCAT = 1, 2, 3, 4, 5
C_HS4, C_HS8, C_PRICE, C_UNIT = 6, 7, 8, 9
C_OPEN_QTY, C_OPEN_EXL, C_OPEN_RATE, C_OPEN_TAX = 10, 11, 12, 13
C_CONS_QTY, C_CONS_EXL, C_CONS_RATE, C_CONS_TAX = 14, 15, 16, 17
C_BAL_QTY, C_BAL_EXL, C_BAL_RATE, C_BAL_TAX = 18, 19, 20, 21
C_STRIPE = 22
C_COGS_OPEN_EXL, C_COGS_OPEN_TAX, C_COGS_OPEN_VAT = 24, 25, 26
C_COGS_CONS_EXL, C_COGS_CONS_TAX, C_COGS_CONS_VAT = 27, 28, 29
C_COGS_BAL_EXL, C_COGS_BAL_TAX, C_COGS_BAL_VAT = 30, 31, 32

BAND_ROW, HEADER_ROW, FIRST_DATA_ROW = 2, 3, 4

# Columns the totals row sums, in the builder's own order.
TOTALLED = [
    C_OPEN_QTY, C_OPEN_EXL, C_OPEN_TAX,
    C_CONS_QTY, C_CONS_EXL, C_CONS_TAX,
    C_BAL_QTY, C_BAL_EXL, C_BAL_TAX,
    C_COGS_OPEN_EXL, C_COGS_OPEN_TAX, C_COGS_OPEN_VAT,
    C_COGS_CONS_EXL, C_COGS_CONS_TAX, C_COGS_CONS_VAT,
    C_COGS_BAL_EXL, C_COGS_BAL_TAX, C_COGS_BAL_VAT,
]

passed = 0
failed = 0


def check(suite: str, name: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name}" + (f"   — {detail}" if detail else ""))


def request(method: str, path: str, token: str | None = None,
            body=None, binary: bool = False):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            blob = r.read()
            if binary:
                return r.status, blob, dict(r.headers)
            text = blob.decode("utf-8") if blob else ""
            return r.status, (json.loads(text) if text else None), dict(r.headers)
    except urllib.error.HTTPError as e:
        blob = e.read() if e.fp else b""
        try:
            return e.code, json.loads(blob.decode("utf-8")), dict(e.headers or {})
        except Exception:
            return e.code, blob[:300], dict(e.headers or {})


def login(username: str, password: str) -> str:
    status, data, _ = request("POST", "/api/auth/login",
                              body={"username": username, "password": password})
    if status != 200:
        sys.exit(f"login failed for {username}: {status} {data}")
    return data["token"]


def save(blob: bytes, name: str) -> str:
    path = os.path.join(OUT, name)
    with open(path, "wb") as fh:
        fh.write(blob)
    return path


def dec(value) -> Decimal:
    return Decimal(str(value if value is not None else 0))


# Excel stores every number as an IEEE-754 double, and a workbook serialises
# roughly 15 significant digits. A stock quantity out of the weighted-average
# walk is a C# decimal that can carry more than that — the opening-stock import
# produces figures like 1266.702219595555 — so the sheet legitimately holds
# 1266.70221959556 and NO writer could do better. That is a storage limit, not a
# disagreement: the column renders at 0dp, so both paint "1,267".
#
# The tolerance is therefore the loss of one decimal -> double round trip and
# nothing more. At 1e-12 relative it is still four orders of magnitude tighter
# than a paisa on any figure these books hold, so a wrong column, a wrong
# derivation or a dropped sign still fails.
ROUND_TRIP_TOLERANCE = Decimal("1e-12")


def same(got: Decimal, want: Decimal) -> bool:
    if got == want:
        return True
    scale = max(abs(got), abs(want))
    if scale == 0:
        return False
    return abs(got - want) / scale < ROUND_TRIP_TOLERANCE


def book(path: str):
    """(data sheet, summary sheet). The data sheet is named for the month, so
    it is taken by position — its name moves with the calendar."""
    wb = openpyxl.load_workbook(path)
    return wb.worksheets[0], wb["Summary"]


def anatomy(ws):
    """(item rows, totals row) of a stock workbook. Data starts at a fixed row
    and every data row is an item row — there is no drill-down to skip."""
    last = FIRST_DATA_ROW - 1
    for r in range(FIRST_DATA_ROW, ws.max_row + 1):
        if ws.cell(r, C_ITEM).value in (None, ""):
            break
        last = r
    items = list(range(FIRST_DATA_ROW, last + 1))
    totals = last + 3 if items else None
    return items, totals


def sheet_text(ws) -> str:
    return " ".join(
        str(ws.cell(r, c).value or "")
        for r in range(1, ws.max_row + 1)
        for c in range(1, ws.max_column + 1))


def clipped_cells(ws) -> list[str]:
    """Values that will not fit their column. Formula cells are skipped — what
    Excel paints is the RESULT, which openpyxl has not computed."""
    widths = {letter: dim.width for letter, dim in ws.column_dimensions.items()}
    merged = {c.coordinate for rng in ws.merged_cells.ranges
              for row in ws[str(rng)] for c in row}
    out = []
    for row in ws.iter_rows():
        for cell in row:
            if cell.coordinate in merged:
                continue
            if cell.alignment and cell.alignment.wrap_text:
                continue
            value = cell.value
            if value is None:
                continue
            if isinstance(value, str) and value.startswith("="):
                continue
            if hasattr(value, "year"):
                text = "00-00-0000"
            elif isinstance(value, (int, float)):
                fmt = cell.number_format or ""
                text = f"{abs(value):,.2f}"
                if value < 0:
                    text = "-" + text
                if "%" in fmt:
                    text = f"{abs(value) * 100:,.2f}%"
            else:
                text = str(value)
            width = widths.get(cell.column_letter)
            if width is None:
                continue
            if len(text) > width:
                out.append(f"{cell.coordinate} needs {len(text)} has {width:.1f}: {text[:40]}")
    return out


def main() -> int:
    global BASE

    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--company", type=int, default=None,
                    help="company id to export (default: the first accessible one)")
    args = ap.parse_args()
    BASE = args.base.rstrip("/")

    admin = login("admin", "admin123")

    status, companies, _ = request("GET", "/api/companies", token=admin)
    if status != 200 or not companies:
        sys.exit(f"could not list companies: {status} {companies}")
    cid = args.company or companies[0]["id"]
    company = next((c for c in companies if c["id"] == cid), None)
    if company is None:
        sys.exit(f"company {cid} is not accessible to admin")
    expected_name = company.get("brandName") or company["name"]
    print(f"\nBase {BASE}  ·  company {cid} ({expected_name})")

    made_users: list[int] = []
    made_roles: list[int] = []

    def provision(username: str, role_name: str, keys: list[str]) -> str:
        """A throwaway user holding exactly `keys`, with access to `cid`."""
        # Clear leftovers from an interrupted run — the names are unique.
        _, users, _ = request("GET", "/api/users", token=admin)
        for u in users if isinstance(users, list) else []:
            if u["username"] == username:
                request("DELETE", f"/api/users/{u['id']}", token=admin)
        _, roles, _ = request("GET", "/api/roles", token=admin)
        for r in roles if isinstance(roles, list) else []:
            if r["name"] == role_name:
                request("DELETE", f"/api/roles/{r['id']}", token=admin)

        st, role, _ = request("POST", "/api/roles", token=admin, body={
            "name": role_name,
            "description": "stock export permission probe (test)",
            "permissionKeys": keys,
        })
        assert st in (200, 201), f"create role {role_name}: {st} {role}"
        made_roles.append(role["id"])

        st, user, _ = request("POST", "/api/users", token=admin, body={
            "username": username, "password": "test1234", "fullName": username,
            "role": role_name, "roleIds": [role["id"]], "companyIds": [cid],
        })
        assert st in (200, 201), f"create user {username}: {st} {user}"
        made_users.append(user["id"])
        return login(username, "test1234")

    try:
        # ── Suite 1: the sheet is the client's layout ────────────────────────
        print("\n  Suite 1 — the customs-lot stock sheet layout")
        _, grid, _ = request("GET", f"/api/stock/company/{cid}/onhand", token=admin)
        status, blob, headers = request(
            "GET", f"/api/stock/company/{cid}/onhand/excel", token=admin, binary=True)
        check("s1", "export returns 200", status == 200, f"got {status}")
        if status != 200:
            return 1
        check("s1", "served as an .xlsx attachment",
              "spreadsheetml" in headers.get("Content-Type", "")
              and ".xlsx" in headers.get("Content-Disposition", ""),
              f"{headers.get('Content-Type')} / {headers.get('Content-Disposition')}")

        path = save(blob, "onhand.xlsx")
        ws, summary = book(path)
        items, totals = anatomy(ws)
        print(f"    {len(grid)} items on the grid; workbook has {len(items)} item rows")

        check("s1", "row 1 carries the Cost of Good Sold banner",
              ws.cell(1, C_COGS_OPEN_EXL).value == "Cost of Good Sold",
              str(ws.cell(1, C_COGS_OPEN_EXL).value))
        for col, label in [(C_OPEN_QTY, "Opening"), (C_CONS_QTY, "Consumed"),
                           (C_BAL_QTY, "Balance")]:
            check("s1", f"band label over column {col} is {label!r}",
                  ws.cell(BAND_ROW, col).value == label,
                  str(ws.cell(BAND_ROW, col).value))
        expected_header = {
            C_CLAIM: "Claim Month", C_GDNO: "GDs No", C_GDDATE: "GD Date",
            C_ITEM: "Items", C_SUBCAT: "Sub cat",
            C_HS4: "4 Digit Hs Code", C_HS8: "8 Digit Hs Code",
            C_PRICE: "Price", C_UNIT: "Unit",
            C_OPEN_QTY: "Qty", C_OPEN_EXL: "Exl", C_OPEN_RATE: "Rate", C_OPEN_TAX: "S.Tax",
            C_CONS_QTY: "Qty", C_CONS_EXL: "Consumed Exl",
            C_BAL_QTY: "Qty", C_BAL_EXL: "Bal Exl",
            C_COGS_OPEN_EXL: "Exl", C_COGS_BAL_VAT: "Vat",
        }
        wrong = [f"col {c}: {ws.cell(HEADER_ROW, c).value!r} != {want!r}"
                 for c, want in expected_header.items()
                 if ws.cell(HEADER_ROW, c).value != want]
        check("s1", "every header sits in its client-sheet column", not wrong,
              " | ".join(wrong[:4]))

        check("s1", "one workbook row per on-hand item", len(items) == len(grid),
              f"{len(items)} vs {len(grid)}")
        check("s1", "the data starts on row 4", len(items) == 0 or items[0] == FIRST_DATA_ROW)
        check("s1", "the Summary sheet names the company",
              expected_name in sheet_text(summary), expected_name)

        # ── Suite 2: the figures, and how they are derived ───────────────────
        print("\n  Suite 2 — the workbook cannot disagree with the grid")
        by_name = {r["itemTypeName"]: r for r in grid}
        drift = []
        for row in items:
            name = ws.cell(row, C_ITEM).value
            s = by_name.get(name)
            if s is None:
                drift.append(f"r{row}: {name!r} absent from the grid")
                continue
            # Opening is EVERYTHING RECEIVED: the client's sheet has no
            # "received" block, so purchases fold into Opening — which is what
            # keeps Balance = Opening - Consumed true on a company that buys.
            for col, want, label in [
                (C_OPEN_QTY, dec(s["openingBalance"]) + dec(s["totalIn"]), "opening qty"),
                (C_OPEN_EXL, dec(s["openingValueExcludingTax"]) + dec(s["valueIn"]), "opening exl"),
                (C_CONS_QTY, dec(s["totalOut"]), "consumed qty"),
                (C_CONS_EXL, dec(s["valueOut"]), "consumed exl"),
                # Balance is the LIVE position, never =J-N: StockValuation
                # clamps value to zero on an emptied bin, so the subtraction can
                # legitimately differ from the walk.
                (C_BAL_QTY, dec(s["onHand"]), "balance qty"),
                (C_BAL_EXL, dec(s["valueExcludingTax"]), "balance exl"),
                (C_BAL_TAX, dec(s["salesTax"]), "balance s.tax"),
                (C_OPEN_RATE, dec(s["salesTaxRate"]) / 100, "rate"),
                (C_BAL_RATE, dec(s["salesTaxRate"]) / 100, "balance rate"),
            ]:
                got = ws.cell(row, col).value
                if isinstance(got, str) and got.startswith("="):
                    drift.append(f"r{row} {name!r}.{label} is a formula: {got}")
                elif not same(dec(got), want):
                    drift.append(f"r{row} {name!r}.{label}: sheet {dec(got)} vs grid {want}")
            check_hs = ws.cell(row, C_HS8).value
            if (s["hsCode"] or "") != (check_hs or ""):
                drift.append(f"r{row} {name!r}.hsCode: sheet {check_hs!r} vs grid {s['hsCode']!r}")
        check("s2", "every figure matches the grid exactly", not drift,
              " | ".join(drift[:4]))

        # The columns the dashboard does NOT report stay the client's formulas,
        # so the sheet recomputes as an accountant edits it.
        bad_formulas = []
        for row in items:
            for col, want in [
                (C_HS4, f"=LEFT(G{row},4)"),
                (C_PRICE, f'=IFERROR(K{row}/J{row},"")'),
                (C_OPEN_TAX, f"=L{row}*K{row}"),
                (C_CONS_RATE, f"=L{row}"),
                (C_CONS_TAX, f"=O{row}*P{row}"),
                (C_COGS_OPEN_TAX, f"=X{row}*L{row}"),
                (C_COGS_CONS_EXL, f"=Q{row}/(L{row}+3%)"),
                (C_COGS_BAL_EXL, f"=X{row}-AA{row}"),
            ]:
                got = ws.cell(row, col).value
                if got != want:
                    bad_formulas.append(f"r{row} col {col}: {got!r} != {want!r}")
        check("s2", "the derived columns carry the client's formulas", not bad_formulas,
              " | ".join(bad_formulas[:3]))
        check("s2", "Cost of Good Sold Opening Exl is left for the accountant",
              all(ws.cell(r, C_COGS_OPEN_EXL).value is None for r in items))
        check("s2", "Claim Month and Sub cat are left blank",
              all(ws.cell(r, C_CLAIM).value is None and ws.cell(r, C_SUBCAT).value is None
                  for r in items))
        check("s2", "the workbook carries no movement drill-down",
              all((ws.row_dimensions[r].outlineLevel if r in ws.row_dimensions else 0) == 0
                  for r in range(1, ws.max_row + 1)))

        # ── Suite 3: totals ─────────────────────────────────────────────────
        print("\n  Suite 3 — totals sum the right range and tie to the API")
        if not items:
            print("    [skip] no items on this company — no totals row is written")
        else:
            last = totals - 1
            letters = {c: openpyxl.utils.get_column_letter(c) for c in TOTALLED}
            wrong = [f"col {letters[c]}: {ws.cell(totals, c).value!r}"
                     for c in TOTALLED
                     if ws.cell(totals, c).value
                        != f"=SUM({letters[c]}{FIRST_DATA_ROW}:{letters[c]}{last})"]
            check("s3", "every totalled column sums the data range", not wrong,
                  " | ".join(wrong[:3]))
            check("s3", "the SUM reaches past the blank rows so an appended row counts",
                  last == items[-1] + 2, f"last row in range {last}, data ends {items[-1]}")
            for col, what in [(C_OPEN_RATE, "Opening Rate"), (C_CONS_RATE, "Consumed Rate"),
                              (C_BAL_RATE, "Balance Rate"), (C_PRICE, "Price")]:
                check("s3", f"TOTAL leaves {what} blank",
                      ws.cell(totals, col).value is None, str(ws.cell(totals, col).value))

            # The rows the SUM covers must themselves tie to the API, which is
            # what makes the formula's answer right rather than merely present.
            for col, want, label in [
                (C_BAL_QTY, sum(dec(r["onHand"]) for r in grid), "on hand"),
                (C_BAL_EXL, sum(dec(r["valueExcludingTax"]) for r in grid), "excluding tax"),
                (C_BAL_TAX, sum(dec(r["salesTax"]) for r in grid), "sales tax"),
                (C_CONS_QTY, sum(dec(r["totalOut"]) for r in grid), "consumed qty"),
            ]:
                got = sum(dec(ws.cell(r, col).value) for r in items)
                check("s3", f"the summed rows tie to the API's {label}", same(got, want),
                      f"rows {got} vs api {want}")

        # ── Suite 4: the customs declaration columns ────────────────────────
        print("\n  Suite 4 — GDs No / GD Date")
        named = [r for r in items if ws.cell(r, C_GDNO).value]
        print(f"    {len(named)} of {len(items)} items name a declaration")
        check("s4", "a GD date never appears without its GD number",
              all(ws.cell(r, C_GDDATE).value is None
                  for r in items if not ws.cell(r, C_GDNO).value))
        check("s4", "a named declaration is a non-empty string",
              all(isinstance(ws.cell(r, C_GDNO).value, str)
                  and ws.cell(r, C_GDNO).value.strip() for r in named))
        check("s4", "the 8-digit code matches the grid's HS code",
              all((ws.cell(r, C_HS8).value or "")
                  == (by_name[ws.cell(r, C_ITEM).value]["hsCode"] or "")
                  for r in items if ws.cell(r, C_ITEM).value in by_name))

        # ── Suite 5: nothing clipped, on real data ──────────────────────────
        print("\n  Suite 5 — nothing is cut off")
        clipped = clipped_cells(ws)
        check("s5", "no clipped cell in the full export", not clipped,
              " | ".join(clipped[:4]))

        # ── Suite 6: permissions ────────────────────────────────────────────
        # The old stock.dashboard.export / stock.movements.view split went with
        # the drill-down: the sheet has no movement detail for a second
        # permission to gate, so the export permission alone is the whole gate.
        print("\n  Suite 6 — export permission is the whole gate")
        tok = provision("stkexp_only", "StkExport Only (test)",
                        ["stock.dashboard.view", "stock.dashboard.export"])
        status, blob, _ = request("GET", f"/api/stock/company/{cid}/onhand/excel",
                                  token=tok, binary=True)
        check("s6", "stock.dashboard.export alone returns 200", status == 200, f"got {status}")
        if status == 200:
            ws_e, sum_e = book(save(blob, "export-only.xlsx"))
            e_items, e_totals = anatomy(ws_e)
            check("s6", "and yields the COMPLETE workbook, not a reduced one",
                  len(e_items) == len(items), f"{len(e_items)} vs {len(items)}")
            check("s6", "it carries the same layout",
                  ws_e.cell(HEADER_ROW, C_ITEM).value == "Items"
                  and ws_e.cell(1, C_COGS_OPEN_EXL).value == "Cost of Good Sold")
            check("s6", "no clipped cell for that user either", not clipped_cells(ws_e))

        tok = provision("stkexp_none", "StkExport ViewOnly (test)",
                        ["stock.dashboard.view"])
        status, body, _ = request("GET", f"/api/stock/company/{cid}/onhand/excel", token=tok)
        check("s6", "403 without stock.dashboard.export", status == 403, f"got {status} {body}")
        status, _, _ = request("GET", f"/api/stock/company/{cid}/onhand", token=tok)
        check("s6", "the grid itself still works for that user", status == 200, f"got {status}")

        # ── Suite 7: the search term ────────────────────────────────────────
        print("\n  Suite 7 — the search reaches the workbook")
        if not grid:
            print("    [skip] no items to search for")
        else:
            term = grid[0]["itemTypeName"][:6]
            expected = [r for r in grid
                        if term.lower() in r["itemTypeName"].lower()
                        or term.lower() in (r["hsCode"] or "").lower()]
            status, blob, _ = request(
                "GET", f"/api/stock/company/{cid}/onhand/excel"
                       f"?search={urllib.parse.quote(term)}", token=admin, binary=True)
            check("s7", "export with a search term returns 200", status == 200, f"got {status}")
            if status == 200:
                ws_s, sum_s = book(save(blob, "searched.xlsx"))
                s_items, s_totals = anatomy(ws_s)
                check("s7", f"narrowed to the {len(expected)} matching item(s)",
                      len(s_items) == len(expected),
                      f"{len(s_items)} rows vs {len(expected)} expected")
                check("s7", "the search is named on the Summary sheet",
                      f'Search: "{term}"' in sheet_text(sum_s), sheet_text(sum_s)[:140])
                if s_items:
                    check("s7", "the narrowed total sums only the narrowed rows",
                          ws_s.cell(s_totals, C_BAL_EXL).value
                          == f"=SUM(S{FIRST_DATA_ROW}:S{s_totals - 1})",
                          str(ws_s.cell(s_totals, C_BAL_EXL).value))

    finally:
        print("\n  Cleanup")
        for uid in made_users:
            st, _, _ = request("DELETE", f"/api/users/{uid}", token=admin)
            print(f"    user {uid}: {st}")
        for rid in made_roles:
            st, _, _ = request("DELETE", f"/api/roles/{rid}", token=admin)
            print(f"    role {rid}: {st}")

    print(f"\n=== {passed}/{passed + failed} checks passed ===")
    if failed:
        print(f"{failed} FAILING CHECK(S). Workbooks kept in {OUT}")
        return 1
    print("STOCK EXPORT LIVE SUITE PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
