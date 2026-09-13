"""
GD import costing suite -- the customs-consignment costing sheet, its match
against existing opening stock, and the opening-balance actual-cost contract
it writes onto.

UNRUN AS OF WRITING: MyApp_Importer_Local was down (SQL error 823) when this
suite was authored, so nothing below has executed against a live server.
Every assertion is deliberately explicit (expected vs. found in the failure
detail) because the first real run is expected to surface bugs in this
feature's own code, not just in the test.

Mirrors scripts/test_spreadsheet_import.py's shape: workbooks built in memory
with openpyxl, login/check/skip/report helpers, throwaway companies cleaned up
at the end. What it proves:

  * the costing chain (Cost/SalesTax/AST/Subtotal/IncomeTax/InputTax/Selling)
    matches a worked reference case, and three ways of writing the same rate
    (0.18 / "18%" / 18) all resolve to the same selling value
  * a totals row (GD number + summed cost, labelled "Total", no selling value)
    is skipped and named; a genuine product named "Total" WITH a selling
    value is kept
  * an inserted "PNL/FIN" column shifts the columns after it, and the shipped
    header-alias mechanism relocates them back with a note per field
  * a sheet-stated selling value that disagrees with the computed one is kept
    as stated, and the preview says so
  * matching against opening stock: an exact-quantity hit, a balance holding
    more than the sheet covers (derives unitCost x balanceQuantity, not the
    GD's own cost), a balance holding less, an unmatched line (new stock,
    deferred to a later release), several lines sharing one balance (same
    derived cost), a balance at zero quantity (derives zero), an ambiguous
    HS code (no cost written to any candidate), and a company with lots for
    some items and none for others in the same sheet
  * commit re-derives every match and every cost from server truth rather
    than trusting the client: a forged OpeningStockBalanceId that the line's
    own GD/HS does not resolve to is downgraded and writes nothing; a
    tampered cost is silently recomputed from the line's raw inputs; a line
    relabelled "cost-only" after an honest ambiguous preview is still
    refused; a cross-tenant balance id is refused and the other company's
    row is untouched
  * a division-restricted user is refused the commit (company-level write);
    a user with no access to the company at all is refused both routes
  * cost-only writes ActualCostExcludingTax and leaves ValueExcludingTax and
    the StockMovements count alone; re-submitting the same file or the same
    GD number is refused with a readable message, not a 500 or a double post
  * the opening-balance cost contract: a value clears the field, omitting it
    leaves the field alone, 0 clears it, and the POST response itself (not a
    follow-up GET) always reflects the new state; Margin is never clamped and
    MarginPercent is null (not 0) when there is no selling value
  * deleting a company that has a GD costing consignment linking to a real
    opening balance succeeds (CompanyService.DeleteAsync step 5d)

    python scripts/test_gd_import_costing.py --base http://localhost:5134

Creates its own throwaway companies (+ one throwaway user) and deletes them
at the end unless --keep.
"""

import argparse
import hashlib
import io
import json
import sys
import uuid
from decimal import Decimal, ROUND_HALF_UP

import requests

try:
    import openpyxl
except ImportError:
    print("openpyxl is required:  pip install openpyxl")
    sys.exit(2)

# Messages echoed from the API carry typographic characters (em dash, etc.);
# a Windows console defaults to cp1252 and would raise on them mid-suite.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
results = []


def check(name, ok, detail=""):
    results.append((PASS if ok else FAIL, name, detail))
    print(f"[{PASS if ok else FAIL}] {name}" + (f" -- {detail}" if detail else ""))
    return ok


def skip(name, why):
    results.append((SKIP, name, why))
    print(f"[{SKIP}] {name} -- {why}")


def close(a, b, tol=0.01):
    """Tolerant float compare for money figures coming back over JSON."""
    if a is None or b is None:
        return False
    try:
        return abs(float(a) - float(b)) < tol
    except (TypeError, ValueError):
        return False


def login(base, username, password):
    r = requests.post(f"{base}/api/auth/login",
                      json={"username": username, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


# ── The costing chain, mirrored from Helpers/ImportCostingCalculator.cs ─────
# Used to derive EXPECTED figures for rows that don't have a literal published
# worked example (the worked example itself is checked against hardcoded
# literals, not against this helper, so a bug shared by both could not hide).
# ROUND_HALF_UP on Python's Decimal is "ties away from zero" -- the same rule
# as C#'s MidpointRounding.AwayFromZero -- unlike the built-in round(), which
# rounds ties to even.
TWOPLACES = Decimal("0.01")


def d(x):
    return Decimal(str(x))


def money(x):
    return x.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def compute_costing(assessed, duty=0, acd=0, regduty=0, others=0, st=0, ast=0, it=0, addon=0):
    assessed, duty, acd, regduty, others = d(assessed), d(duty), d(acd), d(regduty), d(others)
    st, ast, it, addon = d(st), d(ast), d(it), d(addon)
    cost = money(assessed + duty + acd + regduty)
    st_c, ast_c, it_c = max(d(0), st), max(d(0), ast), max(d(0), it)
    sales_tax = money(cost * st_c / d(100))
    ast_amount = money(cost * ast_c / d(100))
    subtotal = money(cost + sales_tax + ast_amount + others)
    income_tax = money(subtotal * it_c / d(100))
    input_tax = money(sales_tax + ast_amount)
    if st_c > 0:
        selling = money(input_tax * d(100) / st_c) + money(addon)
    else:
        selling = cost + money(addon)
    return {
        "cost": cost, "salesTax": sales_tax, "ast": ast_amount, "subtotal": subtotal,
        "incomeTax": income_tax, "inputTax": input_tax, "sellingValue": selling,
    }


# ── GD costing sheet builders ───────────────────────────────────────────────
# Column numbers match Helpers/ExcelImport/GdCostingMapping.GdCostingColumns.
BASE_COLS = {
    "gdNumber": 1, "gdDate": 2, "description": 3, "hsCode": 4, "quantity": 5, "unit": 6,
    "assessedValue": 7, "customsDuty": 8, "acd": 9, "regulatoryDuty": 10, "others": 11,
    "salesTaxRate": 12, "astRate": 13, "incomeTaxRate": 14, "addOnProfit": 15,
    "sellingValue": 16,
}
BASE_HEADINGS = {
    1: "GD Number", 2: "GD Date", 3: "Description", 4: "HS Code", 5: "Quantity", 6: "Unit",
    7: "Assessed Value", 8: "Customs Duty", 9: "ACD", 10: "Regulatory Duty", 11: "Others",
    12: "Sales Tax Rate", 13: "AST Rate", 14: "Income Tax Rate", 15: "Add On Profit",
    16: "Selling Value",
}
GD_MAPPING = {
    "sheetSelect": {"mode": "byIndex", "index": 0},
    "headerRow": 1, "firstDataRow": 2,
    "columns": BASE_COLS,
}

# AY's real shape: a "PNL/FIN" column inserted right after Others, shifting
# every column from the rates rightwards by one.
SHIFTED_COLS = dict(BASE_COLS)
for _f in ("salesTaxRate", "astRate", "incomeTaxRate", "addOnProfit", "sellingValue"):
    SHIFTED_COLS[_f] += 1
SHIFTED_HEADINGS = {
    1: "GD Number", 2: "GD Date", 3: "Description", 4: "HS Code", 5: "Quantity", 6: "Unit",
    7: "Assessed Value", 8: "Customs Duty", 9: "ACD", 10: "Regulatory Duty", 11: "Others",
    12: "PNL/FIN", 13: "Sales Tax Rate", 14: "AST Rate", 15: "Income Tax Rate",
    16: "Add On Profit", 17: "Selling Value",
}
GD_MAPPING_ALIASED = dict(GD_MAPPING, columns=BASE_COLS, headerAliases={
    "salesTaxRate": ["Sales Tax Rate"],
    "astRate": ["AST Rate"],
    "incomeTaxRate": ["Income Tax Rate"],
    "addOnProfit": ["Add On Profit"],
    "sellingValue": ["Selling Value"],
})


def row_cells(cols, gd, hs, desc="Item", qty=1, unit="Pcs", assessed=0, duty=0, acd=0,
              regduty=0, others=0, st=0, ast=0, it=0, addon=0, selling=None,
              gddate="01-07-2026"):
    """One sheet row as {column_number: value}, against the given column map."""
    cells = {
        cols["gdNumber"]: gd, cols["gdDate"]: gddate, cols["description"]: desc,
        cols["hsCode"]: hs, cols["quantity"]: qty, cols["unit"]: unit,
        cols["assessedValue"]: assessed, cols["customsDuty"]: duty, cols["acd"]: acd,
        cols["regulatoryDuty"]: regduty, cols["others"]: others,
        cols["salesTaxRate"]: st, cols["astRate"]: ast, cols["incomeTaxRate"]: it,
        cols["addOnProfit"]: addon,
    }
    if selling is not None:
        cells[cols["sellingValue"]] = selling
    return cells


def build_sheet(headings, rows, header_row=1, first_data_row=2):
    wb = openpyxl.Workbook()
    ws = wb.active
    for col, text in headings.items():
        ws.cell(header_row, col, text)
    for i, cells in enumerate(rows):
        r = first_data_row + i
        for col, val in cells.items():
            ws.cell(r, col, val)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def fresh_hash():
    """A plausible, never-colliding 64-hex-char file hash for a hand-crafted
    commit body that never went through a real upload."""
    return hashlib.sha256(uuid.uuid4().bytes + uuid.uuid4().bytes).hexdigest()


def make_line(source_row, gd, hs, disposition="cost-only", opening_balance_id=None,
              item_type_id=None, description="Item", qty=1, unit="Pcs",
              assessed=0, duty=0, acd=0, regduty=0, others=0, st=0, ast=0, it=0, addon=0,
              cost_override=None, selling_override=None, sheet_selling=None,
              match_note=None, matched_balance_qty=0, derived_cost=0):
    """Builds a GdCostingLineDto-shaped dict by hand, for the commit calls
    that simulate a client request rather than echoing an honest preview.
    cost_override / selling_override let a test claim a figure that disagrees
    with the line's own raw inputs, to prove the server recomputes rather
    than trusting it."""
    c = compute_costing(assessed, duty, acd, regduty, others, st, ast, it, addon)
    return {
        "sourceRow": source_row, "gdNumber": gd, "gdDate": None, "description": description,
        "hsCode": hs, "quantity": qty, "unit": unit,
        "assessedValue": assessed, "customsDuty": duty, "acd": acd, "regulatoryDuty": regduty,
        "others": others, "salesTaxRate": st, "astRate": ast, "incomeTaxRate": it,
        "addOnProfit": addon,
        "cost": float(cost_override if cost_override is not None else c["cost"]),
        "salesTax": float(c["salesTax"]), "ast": float(c["ast"]), "subtotal": float(c["subtotal"]),
        "incomeTax": float(c["incomeTax"]), "inputTax": float(c["inputTax"]),
        "sellingValue": float(selling_override if selling_override is not None else c["sellingValue"]),
        "sheetSellingValue": sheet_selling,
        "disposition": disposition, "openingStockBalanceId": opening_balance_id,
        "itemTypeId": item_type_id, "itemTypeName": None,
        "matchedBalanceQuantity": matched_balance_qty, "derivedActualCost": derived_cost,
        "matchNote": match_note,
    }


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def upload(url, h, content, filename, data=None, params=None):
    return requests.post(
        url, params=params or {}, data=data or {},
        files={"file": (filename, io.BytesIO(content),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=h, timeout=180)


def make_company(api, h, name):
    r = requests.post(f"{api}/companies", headers=h, timeout=60, json={
        "name": name, "brandName": "GDCOST", "fullAddress": "1 Test Street",
        "phone": "021-0000000", "ntn": "1234567-8",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
    })
    if r.status_code not in (200, 201):
        raise RuntimeError(f"company create failed: http {r.status_code} {r.text[:200]}")
    return r.json()["id"]


CREATED_ITEM_TYPE_IDS = []


def make_item(api, h, company_id, name, hs=None, uom="Pcs"):
    body = {"name": name, "uom": uom, "companyId": company_id, "isFavorite": True}
    if hs:
        body["hsCode"] = hs
    r = requests.post(f"{api}/itemtypes", headers=h, timeout=60,
                      params={"companyId": company_id}, json=body)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"item type create failed for {name!r}: http {r.status_code} {r.text[:200]}")
    new_id = r.json()["id"]
    # ItemType is a GLOBAL catalog with no CompanyId (CLAUDE.md 5b-2b), so
    # deleting the throwaway company does NOT remove the item types this suite
    # made. Left behind they accumulate under real HS codes and erode other
    # suites -- test_spreadsheet_import's "every item is new on a first upload"
    # starts reporting matched-renamed instead. Track them and delete in teardown.
    CREATED_ITEM_TYPE_IDS.append(new_id)
    return new_id


def set_opening(api, h, company_id, item_id, qty, value, cost=None, rate=18, notes=None):
    body = {"companyId": company_id, "itemTypeId": item_id, "quantity": qty,
            "valueExcludingTax": value, "salesTaxRate": rate, "asOfDate": "2026-07-01"}
    if cost is not None:
        body["actualCostExcludingTax"] = cost
    if notes is not None:
        body["notes"] = notes
    r = requests.post(f"{api}/stock/opening", headers=h, timeout=60, json=body)
    return r


def get_openings(api, h, company_id):
    r = requests.get(f"{api}/stock/company/{company_id}/opening", headers=h, timeout=60)
    return r.json() if r.ok else []


def opening_of(openings, item_id):
    return next((o for o in openings if o.get("itemTypeId") == item_id), None)


def movement_count(api, h, company_id):
    r = requests.get(f"{api}/stock/company/{company_id}/movements", headers=h, timeout=60,
                     params={"pageSize": 200})
    return (r.json() or {}).get("totalCount", -1) if r.ok else -1


def gd_preview(api, h, company_id, content, mapping, mode=None):
    """mode is one of GdCostingImportModeNames ("backfill" / "new-arrivals",
    Task 19). Omitted by every pre-Task-19 call site, which is deliberate:
    it must default server-side to "backfill" so none of those calls change
    behaviour."""
    params = {"companyId": company_id}
    if mode:
        params["mode"] = mode
    return upload(f"{api}/spreadsheet-import/gd-costing/preview", h, content, "gd.xlsx",
                 {"mappingJson": json.dumps(mapping)}, params)


def gd_commit(api, h, body):
    return requests.post(f"{api}/spreadsheet-import/gd-costing/commit", headers=h, timeout=120,
                         json=body)


# ── Consignments (Task 21: view + delete what a GD costing import wrote) ────

def list_consignments(api, h, company_id, page=1, page_size=50):
    return requests.get(f"{api}/import-consignments", headers=h, timeout=30,
                        params={"companyId": company_id, "page": page, "pageSize": page_size})


def get_consignment(api, h, cid):
    return requests.get(f"{api}/import-consignments/{cid}", headers=h, timeout=30)


def delete_consignment(api, h, cid):
    return requests.delete(f"{api}/import-consignments/{cid}", headers=h, timeout=30)


def find_consignment_id(api, h, company_id, gd_number):
    r = list_consignments(api, h, company_id, page_size=200)
    r.raise_for_status()
    row = next((x for x in r.json().get("items", []) if x.get("gdNumber") == gd_number), None)
    return row["id"] if row else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    api = f"{base}/api"
    h = {"Authorization": f"Bearer {login(base, args.username, args.password)}"}

    tag = uuid.uuid4().hex[:6].upper()
    company = make_company(api, h, f"GD Costing Co {tag}")
    mixed_co = make_company(api, h, f"GD Costing Mixed {tag}")
    other_co = make_company(api, h, f"GD Costing Other {tag}")
    del_co = make_company(api, h, f"GD Costing DelTrap {tag}")
    twomonth_co = make_company(api, h, f"GD Costing TwoMonth {tag}")
    restricted_user_id = None

    try:
        # ══════════════════════════════════════════════════════════════════
        # SECTION 1 -- Costing chain (worked reference case)
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 1. Costing chain (worked reference case) --")

        # This exact row is also item "A" of the big disposition workbook in
        # Section 6/8 -- one preview does double duty as the worked example
        # AND as an exact-quantity match case.
        item_a = make_item(api, h, company, f"GD Item A {tag}", hs="8481.1000")
        set_opening(api, h, company, item_a, qty=100, value=250000)

        WORKED = dict(gd="GD-A-1", hs="8481.1000", desc=f"Worked Example {tag}",
                      qty=100, assessed=62490, duty=0, acd=0, regduty=0, others=0,
                      st=18, ast=3, it=6, addon=0)

        big_rows_ordered = []  # (label, cells) -- filled in as sections build the sheet
        big_rows_ordered.append(("A", row_cells(BASE_COLS, WORKED["gd"], WORKED["hs"],
            desc=WORKED["desc"], qty=WORKED["qty"], assessed=WORKED["assessed"],
            duty=WORKED["duty"], acd=WORKED["acd"], regduty=WORKED["regduty"],
            others=WORKED["others"], st=WORKED["st"], ast=WORKED["ast"], it=WORKED["it"],
            addon=WORKED["addon"])))

        r = gd_preview(api, h, company, build_sheet(BASE_HEADINGS, [big_rows_ordered[0][1]]),
                       GD_MAPPING)
        wp = r.json() if r.ok else {}
        check("the worked-example sheet previews", r.ok, f"http {r.status_code}: {r.text[:200]}")
        wline = (wp.get("lines") or [{}])[0]
        check("worked example: Cost = AssessedValue (no duties)",
              close(wline.get("cost"), 62490), f"cost={wline.get('cost')}")
        check("worked example: SalesTax = Cost x 18%",
              close(wline.get("salesTax"), 11248.20), f"salesTax={wline.get('salesTax')}")
        check("worked example: AST = Cost x 3%",
              close(wline.get("ast"), 1874.70), f"ast={wline.get('ast')}")
        check("worked example: Subtotal = Cost + SalesTax + AST + Others",
              close(wline.get("subtotal"), 75612.90), f"subtotal={wline.get('subtotal')}")
        check("worked example: IncomeTax = Subtotal x 6%",
              close(wline.get("incomeTax"), 4536.77), f"incomeTax={wline.get('incomeTax')}")
        check("worked example: InputTax = SalesTax + AST",
              close(wline.get("inputTax"), 13122.90), f"inputTax={wline.get('inputTax')}")
        check("worked example: Selling = InputTax / STRate x 100 + AddOnProfit",
              close(wline.get("sellingValue"), 72905.00), f"sellingValue={wline.get('sellingValue')}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 2 -- Rate variants (0.18 / "18%" / 18)
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 2. Rate variants --")

        expected = compute_costing(assessed=40000, st=18, ast=3, it=6)
        variant_selling = []
        for label, st_cell in (("numeric fraction 0.18", 0.18), ("text \"18%\"", "18%"),
                                ("whole number 18", 18)):
            cells = row_cells(BASE_COLS, "GD-RATE-1", "8484.1029", desc="Rate Variant",
                              qty=10, assessed=40000, st=st_cell, ast=3, it=6)
            r = gd_preview(api, h, company, build_sheet(BASE_HEADINGS, [cells]), GD_MAPPING)
            rp = r.json() if r.ok else {}
            rline = (rp.get("lines") or [{}])[0]
            variant_selling.append(rline.get("sellingValue"))
            check(f"rate written as {label} is read as 18%",
                  close(rline.get("salesTaxRate"), 18), f"salesTaxRate={rline.get('salesTaxRate')}")
            check(f"rate written as {label} gives the reference selling value",
                  close(rline.get("sellingValue"), float(expected["sellingValue"])),
                  f"sellingValue={rline.get('sellingValue')} expected={expected['sellingValue']}")

        check("all three rate spellings agree with each other",
              all(close(variant_selling[0], v) for v in variant_selling[1:]),
              f"selling values: {variant_selling}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 3 -- Totals row
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 3. Totals row --")

        totals_rows = [
            row_cells(BASE_COLS, "GD-TOT-1", "8470.3000", desc=f"Real Product {tag}",
                      qty=5, assessed=1000, st=18, ast=3, it=6),
            # A totals row: same GD, a summed cost, labelled "Total", NO
            # selling value stated -- must be skipped, not imported as a line.
            row_cells(BASE_COLS, "GD-TOT-1", "8470.3000", desc="Total",
                      qty=5, assessed=1000, st=18, ast=3, it=6),
            # A genuine product named "Total" that DOES carry its own stated
            # selling value must still be kept.
            row_cells(BASE_COLS, "GD-TOT-2", "8471.7030", desc="Total",
                      qty=2, assessed=500, st=18, ast=3, it=6, selling=5000),
        ]
        r = gd_preview(api, h, company, build_sheet(BASE_HEADINGS, totals_rows), GD_MAPPING)
        tp = r.json() if r.ok else {}
        check("the totals-row sheet previews", r.ok, f"http {r.status_code}: {r.text[:200]}")
        check("3 physical rows become 2 kept lines (the totals row is dropped)",
              tp.get("sourceRowCount") == 2 and len(tp.get("lines", [])) == 2,
              f"sourceRowCount={tp.get('sourceRowCount')} lines={len(tp.get('lines', []))}")
        check("the skipped totals row is named in the warnings",
              any("totals row for GD-TOT-1" in w and "Total" in w for w in tp.get("warnings", [])),
              f"warnings={tp.get('warnings')}")
        kept_total = next((x for x in tp.get("lines", []) if x.get("gdNumber") == "GD-TOT-2"), None)
        check("a genuine product literally named \"Total\" WITH a selling value is kept",
              kept_total is not None and kept_total.get("description") == "Total",
              f"kept_total={kept_total}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 4 -- Header aliases (the "PNL/FIN" inserted column)
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 4. Header aliases --")

        alias_input = dict(gd="GD-ALIAS-1", hs="8549.1400", desc="Alias Probe",
                           qty=10, assessed=20000, duty=0, acd=0, regduty=0, others=0,
                           st=18, ast=3, it=6, addon=0)

        baseline_cells = row_cells(BASE_COLS, alias_input["gd"], alias_input["hs"],
            desc=alias_input["desc"], qty=alias_input["qty"], assessed=alias_input["assessed"],
            st=alias_input["st"], ast=alias_input["ast"], it=alias_input["it"])
        r = gd_preview(api, h, company, build_sheet(BASE_HEADINGS, [baseline_cells]), GD_MAPPING)
        bp = r.json() if r.ok else {}
        bline = (bp.get("lines") or [{}])[0]
        check("the baseline (unshifted) alias-probe sheet previews",
              r.ok and bool(bp.get("lines")), f"http {r.status_code}: {r.text[:160]}")
        check("the baseline sheet has no relocation warnings",
              not any("was read from column" in w for w in bp.get("warnings", [])),
              f"warnings={bp.get('warnings')}")

        shifted_cells = row_cells(SHIFTED_COLS, alias_input["gd"], alias_input["hs"],
            desc=alias_input["desc"], qty=alias_input["qty"], assessed=alias_input["assessed"],
            st=alias_input["st"], ast=alias_input["ast"], it=alias_input["it"])
        r = gd_preview(api, h, company, build_sheet(SHIFTED_HEADINGS, [shifted_cells]),
                       GD_MAPPING_ALIASED)
        sp = r.json() if r.ok else {}
        sline = (sp.get("lines") or [{}])[0]
        check("the PNL/FIN-shifted sheet previews with the SAME mapping (aliases resolve it)",
              r.ok and bool(sp.get("lines")), f"http {r.status_code}: {r.text[:160]}")

        for field in ("cost", "salesTax", "ast", "subtotal", "incomeTax", "inputTax", "sellingValue"):
            check(f"shifted sheet's {field} matches the unshifted sheet",
                  close(bline.get(field), sline.get(field)),
                  f"unshifted={bline.get(field)} shifted={sline.get(field)}")

        relocations = [w for w in sp.get("warnings", []) if "was read from column" in w]
        check("every one of the 5 shifted fields gets its own relocation note",
              len(relocations) == 5, f"{len(relocations)} relocation notes: {relocations}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 5 -- Stated selling-value override
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 5. Stated override wins --")

        ov_computed = compute_costing(assessed=10000, st=18, ast=3, it=6)
        ov_stated = float(d(10000) * d("1.39"))  # 13,900.00 -- ~1.39x cost, per the brief
        ov_cells = row_cells(BASE_COLS, "GD-OVERRIDE-1", "8525.8920", desc="Override Probe",
                             qty=5, assessed=10000, st=18, ast=3, it=6, selling=ov_stated)
        r = gd_preview(api, h, company, build_sheet(BASE_HEADINGS, [ov_cells]), GD_MAPPING)
        op = r.json() if r.ok else {}
        oline = (op.get("lines") or [{}])[0]
        check("the override sheet previews", r.ok, f"http {r.status_code}: {r.text[:160]}")
        check("the computed selling value is still reported (~1.1667x cost)",
              close(oline.get("sellingValue"), float(ov_computed["sellingValue"])),
              f"computed sellingValue={oline.get('sellingValue')} expected~={ov_computed['sellingValue']}")
        check("the sheet's own stated 1.39x figure is carried separately",
              close(oline.get("sheetSellingValue"), ov_stated),
              f"sheetSellingValue={oline.get('sheetSellingValue')} expected={ov_stated}")
        check("the override is reported, not silently accepted or silently dropped",
              any("sheet states a selling value" in w and "figure was kept" in w
                  for w in op.get("warnings", [])),
              f"warnings={op.get('warnings')}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 6 -- Disposition (the "Alpha-shaped" big workbook)
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 6. Disposition against opening stock --")

        # B: the balance holds MORE than this GD covers.
        item_b = make_item(api, h, company, f"GD Item B {tag}", hs="8513.1090")
        set_opening(api, h, company, item_b, qty=50, value=80000)
        # C: the balance holds LESS than this GD covers.
        item_c = make_item(api, h, company, f"GD Item C {tag}", hs="8450.9000")
        set_opening(api, h, company, item_c, qty=10, value=15000)
        # D: no opening balance anywhere under this HS -- deliberately absent.
        # F: two GD lines, one balance -- must share the derived cost + note.
        item_f = make_item(api, h, company, f"GD Item F {tag}", hs="8414.5110")
        set_opening(api, h, company, item_f, qty=100, value=40000)
        # G: a balance at zero quantity, pre-seeded with a NON-zero sentinel
        # cost so a later "became exactly 0.00" assertion proves a write
        # happened rather than merely finding an untouched zero.
        item_g = make_item(api, h, company, f"GD Item G {tag}", hs="8511.8020")
        set_opening(api, h, company, item_g, qty=0, value=0, cost=999)
        # E1/E2 share one HS code with NO lots -- an ambiguous match. Both
        # pre-seeded with distinct sentinels to later prove neither moves.
        item_e1 = make_item(api, h, company, f"GD Ambig Item One {tag}", hs="8479.8990")
        set_opening(api, h, company, item_e1, qty=5, value=5000, cost=777)
        item_e2 = make_item(api, h, company, f"GD Ambig Item Two {tag}", hs="8479.8990")
        set_opening(api, h, company, item_e2, qty=8, value=8000, cost=888)
        # H: for the cost-forgery test in Section 10 -- created here so all
        # item/balance setup for `company` lives in one place.
        item_h = make_item(api, h, company, f"GD Item H {tag}", hs="8536.9090")
        set_opening(api, h, company, item_h, qty=10, value=5000)

        openings_before = get_openings(api, h, company)
        setup_items = {"A": item_a, "B": item_b, "C": item_c, "F": item_f, "G": item_g,
                       "E1": item_e1, "E2": item_e2, "H": item_h}
        missing_setup = [label for label, iid in setup_items.items()
                         if opening_of(openings_before, iid) is None]
        # Fail loudly and specifically here rather than letting a silent setup
        # problem (a bad HS code, a rejected create) cascade into confusing
        # AttributeErrors/None-lookups dozens of checks downstream.
        if not check("setup: every disposition-test item has an opening balance",
                    not missing_setup,
                    f"missing balances for: {missing_setup} (found {len(openings_before)} rows total)"):
            raise RuntimeError(
                f"Section 6/8 setup failed -- opening balances missing for {missing_setup}. "
                "Aborting rather than cascading into unrelated failures.")
        check("setup: G's pre-seeded sentinel cost (999) took",
              close(opening_of(openings_before, item_g).get("actualCostExcludingTax"), 999),
              f"G cost={opening_of(openings_before, item_g).get('actualCostExcludingTax')}")
        check("setup: E1/E2's pre-seeded sentinel costs (777/888) took",
              close(opening_of(openings_before, item_e1).get("actualCostExcludingTax"), 777)
              and close(opening_of(openings_before, item_e2).get("actualCostExcludingTax"), 888),
              f"E1={opening_of(openings_before, item_e1).get('actualCostExcludingTax')} "
              f"E2={opening_of(openings_before, item_e2).get('actualCostExcludingTax')}")

        values_before = {iid: opening_of(openings_before, iid).get("valueExcludingTax")
                         for iid in (item_a, item_b, item_c, item_f, item_g, item_e1, item_e2)}
        movements_before = movement_count(api, h, company)

        b_row = row_cells(BASE_COLS, "GD-B-1", "8513.1090", desc="Item B", qty=20, assessed=30000,
                          st=18, ast=3, it=6)
        c_row = row_cells(BASE_COLS, "GD-C-1", "8450.9000", desc="Item C", qty=30, assessed=9000,
                          st=18, ast=3, it=6)
        d_row = row_cells(BASE_COLS, "GD-D-1", "9999.0000", desc="Item D (unmatched)", qty=5,
                          assessed=1000, st=18, ast=3, it=6)
        f1_row = row_cells(BASE_COLS, "GD-F-1", "8414.5110", desc="Item F line 1", qty=40,
                           assessed=20000, st=18, ast=3, it=6)
        f2_row = row_cells(BASE_COLS, "GD-F-2", "8414.5110", desc="Item F line 2", qty=70,
                           assessed=35000, st=18, ast=3, it=6)
        g_row = row_cells(BASE_COLS, "GD-G-1", "8511.8020", desc="Item G (zero balance)", qty=10,
                          assessed=50000, st=18, ast=3, it=6)
        e_row = row_cells(BASE_COLS, "GD-E-1", "8479.8990", desc="Item E (ambiguous)", qty=3,
                          assessed=1000, st=18, ast=3, it=6)

        big_rows = [big_rows_ordered[0][1], b_row, c_row, d_row, f1_row, f2_row, g_row, e_row]
        big_sheet = build_sheet(BASE_HEADINGS, big_rows)

        r = gd_preview(api, h, company, big_sheet, GD_MAPPING)
        big_prev = r.json() if r.ok else {}
        check("the big disposition sheet previews", r.ok, f"http {r.status_code}: {r.text[:200]}")
        big_lines = big_prev.get("lines", [])
        check("8 rows become 8 lines", len(big_lines) == 8, f"{len(big_lines)} lines")

        by_gd = {}
        for ln in big_lines:
            by_gd.setdefault(ln.get("gdNumber"), []).append(ln)

        a_line = by_gd.get("GD-A-1", [{}])[0]
        check("A (exact quantity match): disposition is cost-only",
              a_line.get("disposition") == "cost-only", f"disposition={a_line.get('disposition')}")
        check("A: derivedActualCost equals Cost (quantities match 1:1)",
              close(a_line.get("derivedActualCost"), 62490.00),
              f"derivedActualCost={a_line.get('derivedActualCost')}")
        check("A: no quantity-mismatch note on an exact match",
              not a_line.get("matchNote"), f"matchNote={a_line.get('matchNote')}")

        b_line = by_gd.get("GD-B-1", [{}])[0]
        b_cost = compute_costing(assessed=30000, st=18, ast=3, it=6)["cost"]
        b_unit_cost = b_cost / d(20)
        b_expected_derived = float(money(b_unit_cost * d(50)))
        check("B (balance holds MORE than the sheet covers): disposition is cost-only",
              b_line.get("disposition") == "cost-only", f"disposition={b_line.get('disposition')}")
        check("B: derivedActualCost = unitCost x balanceQuantity, NOT the GD's own cost",
              close(b_line.get("derivedActualCost"), b_expected_derived)
              and not close(b_line.get("derivedActualCost"), float(b_cost)),
              f"derivedActualCost={b_line.get('derivedActualCost')} expected={b_expected_derived} "
              f"(GD's raw cost was {b_cost}, must NOT equal that)")
        check("B: the quantity mismatch is named in the match note",
              bool(b_line.get("matchNote")) and "20" in b_line["matchNote"] and "50" in b_line["matchNote"],
              f"matchNote={b_line.get('matchNote')}")

        c_line = by_gd.get("GD-C-1", [{}])[0]
        c_cost = compute_costing(assessed=9000, st=18, ast=3, it=6)["cost"]
        c_unit_cost = c_cost / d(30)
        c_expected_derived = float(money(c_unit_cost * d(10)))
        check("C (balance holds LESS than the sheet covers): disposition is cost-only",
              c_line.get("disposition") == "cost-only", f"disposition={c_line.get('disposition')}")
        check("C: derivedActualCost = unitCost x balanceQuantity, NOT the GD's own cost",
              close(c_line.get("derivedActualCost"), c_expected_derived)
              and not close(c_line.get("derivedActualCost"), float(c_cost)),
              f"derivedActualCost={c_line.get('derivedActualCost')} expected={c_expected_derived} "
              f"(GD's raw cost was {c_cost}, must NOT equal that)")

        d_line = by_gd.get("GD-D-1", [{}])[0]
        check("D (no balance under this HS anywhere): disposition is stock-posted at preview time",
              d_line.get("disposition") == "stock-posted", f"disposition={d_line.get('disposition')}")
        check("D: no balance or item type is attached",
              d_line.get("openingStockBalanceId") is None and d_line.get("itemTypeId") is None,
              f"openingStockBalanceId={d_line.get('openingStockBalanceId')} itemTypeId={d_line.get('itemTypeId')}")

        f1_line = by_gd.get("GD-F-1", [{}])[0]
        f2_line = by_gd.get("GD-F-2", [{}])[0]
        check("F1 and F2 (two GD lines, one balance): both are cost-only",
              f1_line.get("disposition") == "cost-only" and f2_line.get("disposition") == "cost-only",
              f"F1={f1_line.get('disposition')} F2={f2_line.get('disposition')}")
        check("F1 and F2 share the same OpeningStockBalanceId",
              f1_line.get("openingStockBalanceId") is not None
              and f1_line.get("openingStockBalanceId") == f2_line.get("openingStockBalanceId"),
              f"F1 balance={f1_line.get('openingStockBalanceId')} F2 balance={f2_line.get('openingStockBalanceId')}")
        check("F1 and F2 share the same derivedActualCost",
              close(f1_line.get("derivedActualCost"), f2_line.get("derivedActualCost")),
              f"F1={f1_line.get('derivedActualCost')} F2={f2_line.get('derivedActualCost')}")
        check("F1 and F2 share the same match note",
              bool(f1_line.get("matchNote")) and f1_line.get("matchNote") == f2_line.get("matchNote"),
              f"F1 note={f1_line.get('matchNote')!r} F2 note={f2_line.get('matchNote')!r}")

        g_line = by_gd.get("GD-G-1", [{}])[0]
        check("G (balance at zero quantity): disposition is cost-only",
              g_line.get("disposition") == "cost-only", f"disposition={g_line.get('disposition')}")
        check("G: derivedActualCost is zero regardless of the GD's own (large) cost",
              close(g_line.get("derivedActualCost"), 0.0), f"derivedActualCost={g_line.get('derivedActualCost')}")

        e_line = by_gd.get("GD-E-1", [{}])[0]
        check("E (HS shared by two balances, no lots): disposition is ambiguous",
              e_line.get("disposition") == "ambiguous", f"disposition={e_line.get('disposition')}")
        check("E: no balance or item type is attached",
              e_line.get("openingStockBalanceId") is None and e_line.get("itemTypeId") is None,
              f"openingStockBalanceId={e_line.get('openingStockBalanceId')} itemTypeId={e_line.get('itemTypeId')}")
        check("E: the ambiguity note names more than one opening balance",
              bool(e_line.get("matchNote")) and "more than one opening balance" in e_line["matchNote"],
              f"matchNote={e_line.get('matchNote')}")

        check("disposition counts: 6 cost-only, 1 stock-posted, 1 ambiguous",
              big_prev.get("dispositionCounts") == {"cost-only": 6, "stock-posted": 1, "ambiguous": 1},
              f"dispositionCounts={big_prev.get('dispositionCounts')}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 7 -- A company with lots for some items, none for others
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 7. Mixed company: rule (a) [lot] and rule (b) [HS fallback] --")

        # X: matched through a REAL OpeningStockLot (rule a), via the ordinary
        # opening-stock spreadsheet importer -- the same machinery
        # test_spreadsheet_import.py exercises, built minimally here.
        lot_mapping = {
            "sheetSelect": {"mode": "byIndex", "index": 0},
            "headerRow": 1, "firstDataRow": 2,
            "columns": {"lotRef": 1, "lotDate": 2, "hsCodeFull": 3, "itemName": 4,
                       "unit": 5, "balanceQty": 6, "balanceValue": 7},
        }

        def one_lot_workbook(lot_ref, hs, name, unit, qty, value):
            wb = openpyxl.Workbook()
            ws = wb.active
            for col, txt in {1: "Lot", 2: "Lot Date", 3: "HS Code", 4: "Item",
                             5: "Unit", 6: "Qty", 7: "Value"}.items():
                ws.cell(1, col, txt)
            ws.cell(2, 1, lot_ref); ws.cell(2, 2, "01-07-2026"); ws.cell(2, 3, hs)
            ws.cell(2, 4, name); ws.cell(2, 5, unit); ws.cell(2, 6, qty); ws.cell(2, 7, value)
            buf = io.BytesIO(); wb.save(buf)
            return buf.getvalue()

        x_book = one_lot_workbook("MIXLOT-X", "8536.5010", f"Mixed Lot Item X {tag}", "Pcs", 40, 40000)
        r = upload(f"{api}/spreadsheet-import/opening-stock/preview", h, x_book, "lot.xlsx",
                  {"mappingJson": json.dumps(lot_mapping)}, {"companyId": mixed_co})
        xp = r.json() if r.ok else {}
        check("mixed_co: the lot-backed stock sheet previews", r.ok, f"http {r.status_code}: {r.text[:200]}")
        r = requests.post(f"{api}/spreadsheet-import/opening-stock/commit", headers=h, timeout=120, json={
            "companyId": mixed_co, "fileSha256": xp.get("fileSha256"), "fileName": "lot.xlsx",
            "fileSizeBytes": xp.get("fileSizeBytes"), "asOfDate": "2026-07-01",
            "postInventoryValue": False, "enableInventoryTracking": True,
            "rows": [{"itemName": x["itemName"], "hsCode": x["hsCode"],
                     "isHsCodePartial": x["isHsCodePartial"], "unit": x["unit"],
                     "quantity": x["quantity"], "value": x["value"],
                     "lotRefs": x["lotRefs"], "lots": x.get("lots", []), "itemTypeId": x["itemTypeId"]}
                     for x in xp.get("rows", [])],
        })
        xc = r.json() if r.ok else {}
        check("mixed_co: the lot-backed balance commits",
              r.ok and (xc.get("openingBalancesWritten") or 0) >= 1,
              f"http {r.status_code}: {r.text[:200]}")

        # Y: matched only through ItemType.HSCode (rule b) -- created and
        # opening-balanced directly, no lots anywhere.
        item_y = make_item(api, h, mixed_co, f"Mixed Item Y {tag}", hs="8523.8050")
        set_opening(api, h, mixed_co, item_y, qty=25, value=25000)

        # Z1 has a lot; Z2 shares Z1's HS code but has none. Z1 alone must
        # resolve -- proving rule (a) is checked, and narrows what would
        # otherwise (via rule b alone) be an ambiguous HS code shared by two
        # balances.
        # 8712.0000 (not 8479.8100) -- a real Pakistan tariff line already
        # proven to import cleanly via this same opening-stock path in
        # test_spreadsheet_import.py ("CHILDREN BICYCLE"); the opening-stock
        # importer blocks a code the HS master doesn't recognise (CLAUDE.md
        # 5b-2), unlike a direct POST /api/itemtypes create.
        z_book = one_lot_workbook("MIXLOT-Z", "8712.0000", f"Mixed Lot Item Z1 {tag}", "Pcs", 15, 15000)
        r = upload(f"{api}/spreadsheet-import/opening-stock/preview", h, z_book, "lotz.xlsx",
                  {"mappingJson": json.dumps(lot_mapping)}, {"companyId": mixed_co})
        zp = r.json() if r.ok else {}
        r = requests.post(f"{api}/spreadsheet-import/opening-stock/commit", headers=h, timeout=120, json={
            "companyId": mixed_co, "fileSha256": zp.get("fileSha256"), "fileName": "lotz.xlsx",
            "fileSizeBytes": zp.get("fileSizeBytes"), "asOfDate": "2026-07-01",
            "postInventoryValue": False, "enableInventoryTracking": True,
            "rows": [{"itemName": x["itemName"], "hsCode": x["hsCode"],
                     "isHsCodePartial": x["isHsCodePartial"], "unit": x["unit"],
                     "quantity": x["quantity"], "value": x["value"],
                     "lotRefs": x["lotRefs"], "lots": x.get("lots", []), "itemTypeId": x["itemTypeId"]}
                     for x in zp.get("rows", [])],
        })
        zc = r.json() if r.ok else {}
        check("mixed_co: the second lot-backed balance (Z1) commits",
              r.ok and (zc.get("openingBalancesWritten") or 0) >= 1,
              f"http {r.status_code}: {r.text[:200]}")
        item_z2 = make_item(api, h, mixed_co, f"Mixed Item Z2 {tag}", hs="8712.0000")
        set_opening(api, h, mixed_co, item_z2, qty=9, value=9000)

        mixed_rows = [
            row_cells(BASE_COLS, "MIXLOT-X", "8536.5010", desc="Item X", qty=40, assessed=20000,
                     st=18, ast=3, it=6),
            row_cells(BASE_COLS, "GD-MIXED-Y", "8523.8050", desc="Item Y", qty=25, assessed=12500,
                     st=18, ast=3, it=6),
            row_cells(BASE_COLS, "MIXLOT-Z", "8712.0000", desc="Item Z", qty=15, assessed=7500,
                     st=18, ast=3, it=6),
        ]
        r = gd_preview(api, h, mixed_co, build_sheet(BASE_HEADINGS, mixed_rows), GD_MAPPING)
        mp = r.json() if r.ok else {}
        check("mixed_co: the mixed GD sheet previews", r.ok, f"http {r.status_code}: {r.text[:200]}")
        mlines = {ln.get("gdNumber"): ln for ln in mp.get("lines", [])}

        x_line = mlines.get("MIXLOT-X", {})
        check("X: matched via the LOT (rule a), cost-only",
              x_line.get("disposition") == "cost-only", f"disposition={x_line.get('disposition')}")

        y_line = mlines.get("GD-MIXED-Y", {})
        check("Y: matched via ItemType.HSCode only (rule b), cost-only",
              y_line.get("disposition") == "cost-only", f"disposition={y_line.get('disposition')}")

        z_line = mlines.get("MIXLOT-Z", {})
        check("Z: matched via ITS OWN lot to Z1 specifically, cost-only (not ambiguous)",
              z_line.get("disposition") == "cost-only", f"disposition={z_line.get('disposition')}")
        z1_bal = next((o for o in get_openings(api, h, mixed_co)
                      if o.get("itemTypeName", "").startswith("Mixed Lot Item Z1")), None)
        check("Z: resolved balance is Z1 (the one WITH the lot), not Z2",
              z1_bal is not None and z_line.get("openingStockBalanceId") == z1_bal.get("id"),
              f"resolved={z_line.get('openingStockBalanceId')} Z1 id={z1_bal.get('id') if z1_bal else None}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 8 -- Commit the big workbook; write behaviour
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 8. Commit + write behaviour --")

        big_commit_body = {
            "companyId": company,
            "importProfileId": big_prev.get("importProfileId"),
            "profileVersion": big_prev.get("profileVersion"),
            "fileSha256": big_prev["fileSha256"], "fileName": "gd-big.xlsx",
            "fileSizeBytes": big_prev["fileSizeBytes"],
            "lines": big_lines,
        }
        r = gd_commit(api, h, big_commit_body)
        big_res = r.json() if r.ok else {}
        check("the big workbook commits", r.ok, f"http {r.status_code}: {r.text[:300]}")
        check("8 consignments written (one per distinct GD number)",
              big_res.get("consignmentsWritten") == 8, f"consignmentsWritten={big_res.get('consignmentsWritten')}")
        check("8 lines written",
              big_res.get("linesWritten") == 8, f"linesWritten={big_res.get('linesWritten')}")
        check("5 balances costed (A, B, C, F-shared, G -- D skipped, E ambiguous)",
              big_res.get("balancesCosted") == 5, f"balancesCosted={big_res.get('balancesCosted')}")
        check("1 line skipped (D)",
              big_res.get("linesSkipped") == 1, f"linesSkipped={big_res.get('linesSkipped')}")
        check("1 line ambiguous (E)",
              big_res.get("linesAmbiguous") == 1, f"linesAmbiguous={big_res.get('linesAmbiguous')}")

        expected_total_cost = sum((
            compute_costing(assessed=62490, st=18, ast=3, it=6)["cost"],
            compute_costing(assessed=30000, st=18, ast=3, it=6)["cost"],
            compute_costing(assessed=9000, st=18, ast=3, it=6)["cost"],
            compute_costing(assessed=20000, st=18, ast=3, it=6)["cost"],
            compute_costing(assessed=35000, st=18, ast=3, it=6)["cost"],
            compute_costing(assessed=50000, st=18, ast=3, it=6)["cost"],
        ), d(0))
        check("TotalCostExcludingTax sums the recomputed cost of every cost-only line",
              close(big_res.get("totalCostExcludingTax"), float(expected_total_cost)),
              f"totalCostExcludingTax={big_res.get('totalCostExcludingTax')} expected={expected_total_cost}")

        check("Item D's exact skip reason is in the response messages",
              any("posting new stock arrives in a later release" in m.lower() for m in big_res.get("messages", [])),
              f"messages={big_res.get('messages')}")
        check("the ambiguous count is surfaced in the response messages",
              any("matched more than one opening balance" in m for m in big_res.get("messages", [])),
              f"messages={big_res.get('messages')}")

        openings_after = get_openings(api, h, company)
        a_bal = opening_of(openings_after, item_a)
        b_bal = opening_of(openings_after, item_b)
        c_bal = opening_of(openings_after, item_c)
        f_bal = opening_of(openings_after, item_f)
        g_bal = opening_of(openings_after, item_g)
        e1_bal = opening_of(openings_after, item_e1)
        e2_bal = opening_of(openings_after, item_e2)

        check("A's ActualCostExcludingTax landed at the exact-match cost",
              a_bal is not None and close(a_bal.get("actualCostExcludingTax"), 62490.00),
              f"A cost={a_bal.get('actualCostExcludingTax') if a_bal else None}")
        check("B's ActualCostExcludingTax landed at unitCost x balanceQuantity",
              b_bal is not None and close(b_bal.get("actualCostExcludingTax"), b_expected_derived),
              f"B cost={b_bal.get('actualCostExcludingTax') if b_bal else None} expected={b_expected_derived}")
        check("C's ActualCostExcludingTax landed at unitCost x balanceQuantity",
              c_bal is not None and close(c_bal.get("actualCostExcludingTax"), c_expected_derived),
              f"C cost={c_bal.get('actualCostExcludingTax') if c_bal else None} expected={c_expected_derived}")
        f_unit_cost = (compute_costing(assessed=20000, st=18, ast=3, it=6)["cost"]
                      + compute_costing(assessed=35000, st=18, ast=3, it=6)["cost"]) / d(110)
        f_expected = float(money(f_unit_cost * d(100)))
        check("F's ActualCostExcludingTax is the AGGREGATE over both its lines, not one line alone",
              f_bal is not None and close(f_bal.get("actualCostExcludingTax"), f_expected),
              f"F cost={f_bal.get('actualCostExcludingTax') if f_bal else None} expected={f_expected}")
        check("G's ActualCostExcludingTax became exactly 0.00 (overwriting the 999 sentinel)",
              g_bal is not None and close(g_bal.get("actualCostExcludingTax"), 0.0),
              f"G cost={g_bal.get('actualCostExcludingTax') if g_bal else None} (sentinel was 999)")
        check("E1's sentinel cost (777) is untouched by the ambiguous line",
              e1_bal is not None and close(e1_bal.get("actualCostExcludingTax"), 777.0),
              f"E1 cost={e1_bal.get('actualCostExcludingTax') if e1_bal else None}")
        check("E2's sentinel cost (888) is untouched by the ambiguous line",
              e2_bal is not None and close(e2_bal.get("actualCostExcludingTax"), 888.0),
              f"E2 cost={e2_bal.get('actualCostExcludingTax') if e2_bal else None}")

        unchanged_values = all(
            close(opening_of(openings_after, iid).get("valueExcludingTax"), values_before[iid])
            for iid in (item_a, item_b, item_c, item_f, item_g, item_e1, item_e2)
        )
        check("ValueExcludingTax is unchanged on every balance the commit touched",
              unchanged_values,
              f"before={values_before} after={[opening_of(openings_after, i).get('valueExcludingTax') for i in (item_a, item_b, item_c, item_f, item_g)]}")

        movements_after = movement_count(api, h, company)
        check("StockMovements count is identical across the commit (GD costing posts none)",
              movements_before == movements_after,
              f"before={movements_before} after={movements_after}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 9 -- Idempotence and duplicate protection
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 9. Idempotence and duplicate protection --")

        # Re-preview the identical bytes: refused as an already-imported file.
        r = gd_preview(api, h, company, big_sheet, GD_MAPPING)
        rp2 = r.json() if r.ok else {}
        check("re-previewing the identical file is refused",
              any("already imported" in e for e in rp2.get("blockingErrors", [])),
              f"blockingErrors={rp2.get('blockingErrors')}")

        # Same FileSha256, a fresh GD number -- isolates the file-hash guard
        # from the GD-number guard.
        resubmit_body = dict(big_commit_body, lines=[
            make_line(1, "GD-RESUBMIT-1", "8481.1000", assessed=1, st=18, ast=3, it=6,
                     opening_balance_id=a_bal["id"] if a_bal else None),
        ])
        r = gd_commit(api, h, resubmit_body)
        check("committing with an already-imported FileSha256 is refused (400, not 500)",
              r.status_code == 400 and "already imported" in (r.json() or {}).get("message", ""),
              f"http {r.status_code}: {r.text[:200]}")
        openings_check = get_openings(api, h, company)
        check("the refused duplicate-file resubmit left A's cost unchanged",
              close(opening_of(openings_check, item_a).get("actualCostExcludingTax"), 62490.00),
              f"A cost={opening_of(openings_check, item_a).get('actualCostExcludingTax')}")

        # Same GD number as an already-committed consignment, but a FRESH
        # file hash -- isolates the GD-number guard from the file-hash guard.
        dup_gd_body = {
            "companyId": company, "fileSha256": fresh_hash(), "fileName": "dup-gd.xlsx",
            "fileSizeBytes": 111,
            "lines": [make_line(1, "GD-A-1", "8481.1000", assessed=1, st=18, ast=3, it=6)],
        }
        r = gd_commit(api, h, dup_gd_body)
        try:
            dup_msg = (r.json() or {}).get("message", "")
        except ValueError:
            dup_msg = ""  # a non-JSON body here would itself prove the "not a 500" claim false
        check("a duplicate GD number (fresh file hash) is refused as a friendly 400, not a 500",
              r.status_code == 400 and "already" in dup_msg and "consignment" in dup_msg,
              f"http {r.status_code}: {r.text[:200]}")
        openings_check2 = get_openings(api, h, company)
        check("the refused duplicate-GD resubmit left A's cost unchanged (not doubled)",
              close(opening_of(openings_check2, item_a).get("actualCostExcludingTax"), 62490.00),
              f"A cost={opening_of(openings_check2, item_a).get('actualCostExcludingTax')}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 10 -- Security: forged / tampered / cross-tenant commits
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 10. Security: server re-derives, never trusts the client --")

        # #11 Match forgery: HS resolves uniquely to A, but the line claims
        # C's (a real, company-owned, but WRONG) balance id.
        forge_match_body = {
            "companyId": company, "fileSha256": fresh_hash(), "fileName": "forge-match.xlsx",
            "fileSizeBytes": 111,
            "lines": [make_line(1, "GD-FORGE-MATCH", "8481.1000", disposition="cost-only",
                               opening_balance_id=c_bal["id"] if c_bal else None,
                               assessed=999999, st=18, ast=3, it=6)],
        }
        r = gd_commit(api, h, forge_match_body)
        fm_res = r.json() if r.ok else {}
        check("a claimed balance the line's own HS does NOT resolve to: commit still succeeds (line downgraded)",
              r.ok, f"http {r.status_code}: {r.text[:200]}")
        check("match forgery: the forged line writes NO cost (0 balances costed)",
              fm_res.get("balancesCosted") == 0, f"balancesCosted={fm_res.get('balancesCosted')}")
        check("match forgery: the forged line is recorded as skipped",
              fm_res.get("linesSkipped") == 1, f"linesSkipped={fm_res.get('linesSkipped')}")
        openings_fm = get_openings(api, h, company)
        check("match forgery: A (the line's real match) is untouched",
              close(opening_of(openings_fm, item_a).get("actualCostExcludingTax"), 62490.00),
              f"A cost={opening_of(openings_fm, item_a).get('actualCostExcludingTax')}")
        check("match forgery: C (the falsely claimed balance) is untouched",
              close(opening_of(openings_fm, item_c).get("actualCostExcludingTax"), c_expected_derived),
              f"C cost={opening_of(openings_fm, item_c).get('actualCostExcludingTax')}")

        # #12 Cost forgery: honest raw inputs resolve to a real cost of 100.00
        # on H (qty 10, matching H's balance exactly); the submitted Cost and
        # SellingValue are tampered to 999999. The claimed OpeningStockBalanceId
        # is H's BALANCE id (not its ItemType id), resolved from the opening
        # list -- an honest match, so only the COST half is under test here.
        h_bal_before = opening_of(get_openings(api, h, company), item_h)
        forge_cost_body = {
            "companyId": company, "fileSha256": fresh_hash(), "fileName": "forge-cost.xlsx",
            "fileSizeBytes": 111,
            "lines": [make_line(1, "GD-FORGE-COST", "8536.9090", disposition="cost-only",
                               opening_balance_id=h_bal_before["id"] if h_bal_before else None,
                               assessed=100, st=0, ast=0, it=0,
                               qty=10, cost_override=999999, selling_override=999999)],
        }
        r = gd_commit(api, h, forge_cost_body)
        fc_res = r.json() if r.ok else {}
        check("cost forgery: the honestly-matched line still commits", r.ok, f"http {r.status_code}: {r.text[:200]}")
        check("cost forgery: 1 balance costed (the match itself was honest)",
              fc_res.get("balancesCosted") == 1, f"balancesCosted={fc_res.get('balancesCosted')}")
        check("cost forgery: TotalCostExcludingTax is the RECOMPUTED 100.00, not the tampered 999999",
              close(fc_res.get("totalCostExcludingTax"), 100.00),
              f"totalCostExcludingTax={fc_res.get('totalCostExcludingTax')}")
        openings_fc = get_openings(api, h, company)
        h_bal_after = opening_of(openings_fc, item_h)
        check("cost forgery: H's ActualCostExcludingTax reflects the honest recomputed cost (10.00/unit x 10)",
              h_bal_after is not None and close(h_bal_after.get("actualCostExcludingTax"), 100.00),
              f"H cost={h_bal_after.get('actualCostExcludingTax') if h_bal_after else None} (must not be near 999999)")

        # #13 Ambiguous relabelled: E1/E2's shared HS, a FRESH GD number
        # (GD-E-1 is already used), relabelled "cost-only" with a candidate.
        forge_ambig_body = {
            "companyId": company, "fileSha256": fresh_hash(), "fileName": "forge-ambig.xlsx",
            "fileSizeBytes": 111,
            "lines": [make_line(1, "GD-FORGE-AMBIG", "8479.8990", disposition="cost-only",
                               opening_balance_id=e1_bal["id"] if e1_bal else None,
                               assessed=1000, st=18, ast=3, it=6)],
        }
        r = gd_commit(api, h, forge_ambig_body)
        fa_res = r.json() if r.ok else {}
        check("relabelled-ambiguous line: commit still succeeds (line forced back to ambiguous)",
              r.ok, f"http {r.status_code}: {r.text[:200]}")
        check("relabelled-ambiguous line: 0 balances costed, 1 line ambiguous",
              fa_res.get("balancesCosted") == 0 and fa_res.get("linesAmbiguous") == 1,
              f"balancesCosted={fa_res.get('balancesCosted')} linesAmbiguous={fa_res.get('linesAmbiguous')}")
        openings_fa = get_openings(api, h, company)
        check("relabelling ambiguous as cost-only still leaves E1/E2 untouched",
              close(opening_of(openings_fa, item_e1).get("actualCostExcludingTax"), 777.0)
              and close(opening_of(openings_fa, item_e2).get("actualCostExcludingTax"), 888.0),
              f"E1={opening_of(openings_fa, item_e1).get('actualCostExcludingTax')} "
              f"E2={opening_of(openings_fa, item_e2).get('actualCostExcludingTax')}")

        # #14 Cross-tenant: a real balance that belongs to a DIFFERENT company.
        cross_item = make_item(api, h, other_co, f"Cross Target {tag}", hs="8538.9010")
        set_opening(api, h, other_co, cross_item, qty=5, value=5000, cost=555)
        cross_bal = opening_of(get_openings(api, h, other_co), cross_item)

        forge_cross_body = {
            "companyId": company, "fileSha256": fresh_hash(), "fileName": "forge-cross.xlsx",
            "fileSizeBytes": 111,
            # HS resolves uniquely to A within `company`'s own index; the
            # claimed id belongs to `other_co` entirely.
            "lines": [make_line(1, "GD-FORGE-CROSS", "8481.1000", disposition="cost-only",
                               opening_balance_id=cross_bal["id"] if cross_bal else None,
                               assessed=1, st=18, ast=3, it=6)],
        }
        r = gd_commit(api, h, forge_cross_body)
        fx_res = r.json() if r.ok else {}
        check("cross-tenant balance id: commit still succeeds (line downgraded)",
              r.ok, f"http {r.status_code}: {r.text[:200]}")
        check("cross-tenant balance id: 0 balances costed",
              fx_res.get("balancesCosted") == 0, f"balancesCosted={fx_res.get('balancesCosted')}")
        check("cross-tenant: A (this company's real match) is untouched",
              close(opening_of(get_openings(api, h, company), item_a).get("actualCostExcludingTax"), 62490.00),
              "A's cost moved")
        check("cross-tenant: the OTHER company's balance is untouched",
              close(opening_of(get_openings(api, h, other_co), cross_item).get("actualCostExcludingTax"), 555.0),
              f"cross_target cost={opening_of(get_openings(api, h, other_co), cross_item).get('actualCostExcludingTax')}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 11 -- Access control: division-restricted, and no access
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 11. Access control --")

        rtag = uuid.uuid4().hex[:8]
        r = requests.post(f"{api}/users", headers=h, timeout=30, json={
            "username": f"gdcost_{rtag}", "password": "test1234",
            "fullName": "GD Costing Restricted Tester", "role": "Administrator",
        })
        check("restricted test user created", r.status_code in (200, 201), f"http {r.status_code}: {r.text[:160]}")
        restricted_user = r.json() if r.ok else {}
        restricted_user_id = restricted_user.get("id")

        roles = requests.get(f"{api}/roles", headers=h, timeout=30).json()
        admin_role_id = next((x["id"] for x in roles if x["name"] == "Administrator"), None)
        requests.put(f"{api}/users/{restricted_user_id}/roles", headers=h, timeout=30,
                    json={"roleIds": [admin_role_id]})
        requests.put(f"{api}/usercompanies/user/{restricted_user_id}", headers=h, timeout=30,
                    json={"companyIds": [company]})
        r = requests.put(f"{api}/userdivisions/user/{restricted_user_id}/company/{company}",
                        headers=h, timeout=30, json={"restrictToDivisions": True, "divisionIds": []})
        check("division-restriction set on the restricted user",
              r.ok and r.json().get("restrictToDivisions") is True, f"http {r.status_code}: {r.text[:160]}")

        restricted_token = login(base, f"gdcost_{rtag}", "test1234")
        hr = {"Authorization": f"Bearer {restricted_token}"}

        r = gd_commit(api, hr, {"companyId": company, "lines": []})
        check("a division-restricted user is refused the commit (company-level write, policy D2)",
              r.status_code == 403, f"http {r.status_code}: {r.text[:160]}")

        r = gd_preview(api, hr, mixed_co, build_sheet(BASE_HEADINGS, [d_row]), GD_MAPPING)
        check("a user with NO access to the company is refused preview",
              r.status_code == 403, f"http {r.status_code}: {r.text[:160]}")

        r = gd_commit(api, hr, {"companyId": mixed_co, "lines": []})
        check("a user with NO access to the company is refused commit",
              r.status_code == 403, f"http {r.status_code}: {r.text[:160]}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 12 -- Opening-balance cost contract (nullable, three steps)
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 12. Opening-balance cost contract --")

        contract_item = make_item(api, h, company, f"Contract Item {tag}", hs="8536.1010")

        r = set_opening(api, h, company, contract_item, qty=10, value=1000, cost=700)
        rc = r.json() if r.ok else {}
        check("with a cost: the POST response itself carries it (create)",
              r.ok and close(rc.get("actualCostExcludingTax"), 700),
              f"http {r.status_code}: actualCostExcludingTax={rc.get('actualCostExcludingTax')}")
        check("Margin = ValueExcludingTax - ActualCostExcludingTax",
              close(rc.get("margin"), 300), f"margin={rc.get('margin')}")
        check("MarginPercent = Margin / ValueExcludingTax x 100",
              close(rc.get("marginPercent"), 30.0), f"marginPercent={rc.get('marginPercent')}")

        r = set_opening(api, h, company, contract_item, qty=10, value=1000, cost=None)
        rc2 = r.json() if r.ok else {}
        check("omitting the cost field leaves it UNCHANGED, and the response says so",
              r.ok and close(rc2.get("actualCostExcludingTax"), 700),
              f"http {r.status_code}: actualCostExcludingTax={rc2.get('actualCostExcludingTax')}")

        r = set_opening(api, h, company, contract_item, qty=10, value=1000, cost=0)
        rc3 = r.json() if r.ok else {}
        check("a cost of 0 CLEARS it, and the response reflects the clear immediately",
              r.ok and close(rc3.get("actualCostExcludingTax"), 0),
              f"http {r.status_code}: actualCostExcludingTax={rc3.get('actualCostExcludingTax')}")
        check("after clearing, Margin is the full ValueExcludingTax",
              close(rc3.get("margin"), 1000), f"margin={rc3.get('margin')}")

        r = set_opening(api, h, company, contract_item, qty=10, value=1000, cost=1500)
        rc4 = r.json() if r.ok else {}
        check("Margin is NOT clamped: a cost above the selling value is a negative margin",
              r.ok and close(rc4.get("margin"), -500),
              f"http {r.status_code}: margin={rc4.get('margin')}")
        check("MarginPercent is negative, not zero, when cost exceeds value",
              close(rc4.get("marginPercent"), -50.0), f"marginPercent={rc4.get('marginPercent')}")

        r = set_opening(api, h, company, contract_item, qty=10, value=0, cost=200)
        rc5 = r.json() if r.ok else {}
        check("MarginPercent is NULL (not 0) when there is no selling value to measure against",
              r.ok and rc5.get("marginPercent") is None,
              f"http {r.status_code}: marginPercent={rc5.get('marginPercent')}")
        check("Margin still reports the full negative even with no selling value",
              close(rc5.get("margin"), -200), f"margin={rc5.get('margin')}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 13 -- Company-delete trap
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 13. Deleting a company with a GD costing consignment --")

        del_item = make_item(api, h, del_co, f"Del Trap Item {tag}", hs="8481.9000")
        set_opening(api, h, del_co, del_item, qty=3, value=3000)
        del_row = row_cells(BASE_COLS, "GD-DEL-1", "8481.9000", desc="Del Trap Item", qty=3,
                            assessed=900, st=18, ast=3, it=6)
        r = gd_preview(api, h, del_co, build_sheet(BASE_HEADINGS, [del_row]), GD_MAPPING)
        dp = r.json() if r.ok else {}
        check("delete-trap: the small workbook previews", r.ok, f"http {r.status_code}: {r.text[:160]}")
        r = gd_commit(api, h, {
            "companyId": del_co, "fileSha256": dp.get("fileSha256"), "fileName": "del-trap.xlsx",
            "fileSizeBytes": dp.get("fileSizeBytes"), "lines": dp.get("lines", []),
        })
        dcres = r.json() if r.ok else {}
        check("delete-trap: the commit succeeds, linking a real consignment to a real balance",
              r.ok and dcres.get("balancesCosted") == 1, f"http {r.status_code}: {r.text[:200]}")

        r = requests.delete(f"{api}/companies/{del_co}", headers=h, timeout=120)
        check("deleting a company with a GD costing consignment (-> a real OpeningStockBalance) succeeds",
              r.status_code in (200, 204), f"http {r.status_code}: {r.text[:200]}")
        del_co = None  # already deleted -- skip it in the cleanup finally block

        # ══════════════════════════════════════════════════════════════════
        # SECTION 14 -- Task 19: Backfill (SET) vs New Arrivals (ADD)
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 14. Two-month scenario: Backfill vs New Arrivals --")

        # ---- 14a: NEW ARRIVALS ---------------------------------------------
        # Month 1 (GD-NA-A) creates a brand-new item via createMissingStock
        # (no balance exists yet, so the line is unmatched at preview time).
        # Month 2 (GD-NA-B), the SAME item under the SAME HS code, resolves
        # to that balance and, committed in new-arrivals mode, must ADD to
        # quantity/cost/selling value rather than overwrite them.
        na_hs = "8517.6990"
        na_desc = f"Two-Month Item NA {tag}"
        gd_na_a = row_cells(BASE_COLS, "GD-NA-A", na_hs, desc=na_desc, qty=310,
                            assessed=100000, st=18, ast=3, it=6)
        r = gd_preview(api, h, twomonth_co, build_sheet(BASE_HEADINGS, [gd_na_a]), GD_MAPPING)
        naA_prev = r.json() if r.ok else {}
        check("14a: month-1 GD-NA-A previews", r.ok, f"http {r.status_code}: {r.text[:200]}")
        naA_line = (naA_prev.get("lines") or [{}])[0]
        check("14a: month-1 line is unmatched (stock-posted) -- no balance exists yet",
              naA_line.get("disposition") == "stock-posted", f"disposition={naA_line.get('disposition')}")

        r = gd_commit(api, h, {
            "companyId": twomonth_co, "fileSha256": naA_prev.get("fileSha256"),
            "fileName": "gd-na-a.xlsx", "fileSizeBytes": naA_prev.get("fileSizeBytes"),
            "lines": naA_prev.get("lines", []), "createMissingStock": True,
        })
        naA_res = r.json() if r.ok else {}
        if not check("14a: month-1 GD-NA-A commits, creating the item and its opening balance",
                     r.ok and naA_res.get("openingBalancesCreated") == 1,
                     f"http {r.status_code}: {r.text[:200]}"):
            raise RuntimeError("Section 14a setup failed -- month-1 balance was not created. "
                              "Aborting rather than cascading into unrelated failures.")

        na_item = next((o for o in get_openings(api, h, twomonth_co)
                       if o.get("itemTypeName", "").startswith(na_desc)), None)
        if not check("14a: the newly-created item has an opening balance", na_item is not None,
                     "no balance found under the new item's name"):
            raise RuntimeError("Section 14a setup failed -- could not find the month-1 balance.")

        na_item_id = na_item.get("itemTypeId")
        na_cost_a = compute_costing(assessed=100000, st=18, ast=3, it=6)
        check("14a: month-1 balance holds exactly what GD-NA-A brought (qty 310, cost 100000.00)",
              close(na_item.get("quantity"), 310) and close(na_item.get("actualCostExcludingTax"), 100000.00),
              f"na_item={na_item}")
        check("14a: month-1 balance's selling value is GD-NA-A's own computed selling value",
              close(na_item.get("valueExcludingTax"), float(na_cost_a["sellingValue"])),
              f"valueExcludingTax={na_item.get('valueExcludingTax')} expected={na_cost_a['sellingValue']}")

        # Month 2: GD-NA-B brings 200 MORE of the same item. Same HS code, no
        # lots anywhere for this company, so it resolves via rule (b) to the
        # balance GD-NA-A just created.
        gd_na_b = row_cells(BASE_COLS, "GD-NA-B", na_hs, desc=na_desc, qty=200,
                            assessed=80000, st=18, ast=3, it=6)
        r = gd_preview(api, h, twomonth_co, build_sheet(BASE_HEADINGS, [gd_na_b]), GD_MAPPING,
                       mode="new-arrivals")
        naB_prev = r.json() if r.ok else {}
        check("14a: month-2 GD-NA-B previews (new-arrivals mode)", r.ok, f"http {r.status_code}: {r.text[:200]}")
        naB_line = (naB_prev.get("lines") or [{}])[0]
        check("14a: month-2 line now matches the balance GD-NA-A created (cost-only)",
              naB_line.get("disposition") == "cost-only", f"disposition={naB_line.get('disposition')}")
        check("14a: month-2 preview's match note (new-arrivals) describes an ADD, naming both quantities",
              bool(naB_line.get("matchNote")) and "310" in naB_line["matchNote"]
              and "200" in naB_line["matchNote"] and "add" in naB_line["matchNote"].lower(),
              f"matchNote={naB_line.get('matchNote')!r}")

        na_cost_b = compute_costing(assessed=80000, st=18, ast=3, it=6)

        r = gd_commit(api, h, {
            "companyId": twomonth_co, "fileSha256": naB_prev.get("fileSha256"),
            "fileName": "gd-na-b.xlsx", "fileSizeBytes": naB_prev.get("fileSizeBytes"),
            "lines": naB_prev.get("lines", []), "mode": "new-arrivals",
        })
        naB_res = r.json() if r.ok else {}
        check("14a: month-2 GD-NA-B commits in new-arrivals mode",
              r.ok and naB_res.get("balancesCosted") == 1, f"http {r.status_code}: {r.text[:200]}")

        na_item_after = opening_of(get_openings(api, h, twomonth_co), na_item_id)
        expected_na_qty = d(310) + d(200)
        expected_na_cost = money(d(100000) + na_cost_b["cost"])
        expected_na_value = money(na_cost_a["sellingValue"] + na_cost_b["sellingValue"])
        check("14a: quantity is the SUM of both months (310 + 200 = 510)",
              na_item_after is not None and close(na_item_after.get("quantity"), float(expected_na_qty)),
              f"quantity={na_item_after.get('quantity') if na_item_after else None} expected={expected_na_qty}")
        check("14a: ActualCostExcludingTax is the SUM of both months' cost",
              na_item_after is not None and close(na_item_after.get("actualCostExcludingTax"), float(expected_na_cost)),
              f"actualCostExcludingTax={na_item_after.get('actualCostExcludingTax') if na_item_after else None} expected={expected_na_cost}")
        check("14a: ValueExcludingTax (selling value) is the SUM of both months",
              na_item_after is not None and close(na_item_after.get("valueExcludingTax"), float(expected_na_value)),
              f"valueExcludingTax={na_item_after.get('valueExcludingTax') if na_item_after else None} expected={expected_na_value}")

        if na_item_after is not None:
            actual_unit_cost = d(str(na_item_after.get("actualCostExcludingTax"))) / d(str(na_item_after.get("quantity")))
            expected_unit_cost = expected_na_cost / expected_na_qty
            check("14a: the per-unit cost is a genuine weighted average across both consignments",
                  abs(actual_unit_cost - expected_unit_cost) < d("0.01"),
                  f"actual_unit_cost={actual_unit_cost} expected={expected_unit_cost}")
        else:
            check("14a: the per-unit cost is a genuine weighted average across both consignments",
                  False, "no balance found to compute a unit cost from")

        # Idempotence still holds in new-arrivals mode -- neither duplicate
        # guard is mode-specific (brief, Task 19).
        r = gd_commit(api, h, {
            "companyId": twomonth_co, "fileSha256": naB_prev.get("fileSha256"),
            "fileName": "gd-na-b.xlsx", "fileSizeBytes": naB_prev.get("fileSizeBytes"),
            "lines": naB_prev.get("lines", []), "mode": "new-arrivals",
        })
        check("14a: re-submitting GD-NA-B's exact file (new-arrivals) is refused as already imported",
              r.status_code == 400 and "already imported" in (r.json() or {}).get("message", ""),
              f"http {r.status_code}: {r.text[:200]}")
        na_item_dup1 = opening_of(get_openings(api, h, twomonth_co), na_item_id)
        check("14a: the refused duplicate-file resubmit left the balance unchanged",
              na_item_dup1 is not None and close(na_item_dup1.get("quantity"), float(expected_na_qty))
              and close(na_item_dup1.get("actualCostExcludingTax"), float(expected_na_cost)),
              f"na_item_dup1={na_item_dup1}")

        r = gd_commit(api, h, {
            "companyId": twomonth_co, "fileSha256": fresh_hash(), "fileName": "gd-na-b-again.xlsx",
            "fileSizeBytes": 111,
            "lines": [make_line(1, "GD-NA-B", na_hs, assessed=1, st=18, ast=3, it=6)],
            "mode": "new-arrivals",
        })
        try:
            na_dup_msg = (r.json() or {}).get("message", "")
        except ValueError:
            na_dup_msg = ""  # a non-JSON body would itself disprove the "not a 500" claim
        check("14a: a duplicate GD number (fresh file hash, new-arrivals) is refused as a friendly 400, not a 500",
              r.status_code == 400 and "already" in na_dup_msg and "consignment" in na_dup_msg,
              f"http {r.status_code}: {r.text[:200]}")
        na_item_dup2 = opening_of(get_openings(api, h, twomonth_co), na_item_id)
        check("14a: the refused duplicate-GD resubmit left the balance unchanged (not added again)",
              na_item_dup2 is not None and close(na_item_dup2.get("quantity"), float(expected_na_qty))
              and close(na_item_dup2.get("actualCostExcludingTax"), float(expected_na_cost)),
              f"na_item_dup2={na_item_dup2}")

        # ---- 14b: BACKFILL (default) -- same shape, must NOT add -----------
        # A fresh item under its OWN HS code, with its own month-1/month-2
        # pair, this time committed in (default) backfill mode: quantity must
        # stay exactly what month 1 alone brought in.
        bf_hs = "8517.6991"
        bf_desc = f"Two-Month Item BF {tag}"
        gd_bf_a = row_cells(BASE_COLS, "GD-BF-A", bf_hs, desc=bf_desc, qty=310,
                            assessed=100000, st=18, ast=3, it=6)
        r = gd_preview(api, h, twomonth_co, build_sheet(BASE_HEADINGS, [gd_bf_a]), GD_MAPPING)
        bfA_prev = r.json() if r.ok else {}
        r = gd_commit(api, h, {
            "companyId": twomonth_co, "fileSha256": bfA_prev.get("fileSha256"),
            "fileName": "gd-bf-a.xlsx", "fileSizeBytes": bfA_prev.get("fileSizeBytes"),
            "lines": bfA_prev.get("lines", []), "createMissingStock": True,
        })
        bfA_res = r.json() if r.ok else {}
        if not check("14b: month-1 GD-BF-A commits, creating a fresh item and balance",
                     r.ok and bfA_res.get("openingBalancesCreated") == 1,
                     f"http {r.status_code}: {r.text[:200]}"):
            raise RuntimeError("Section 14b setup failed -- month-1 balance was not created. "
                              "Aborting rather than cascading into unrelated failures.")

        bf_item = next((o for o in get_openings(api, h, twomonth_co)
                       if o.get("itemTypeName", "").startswith(bf_desc)), None)
        if not check("14b: the newly-created item has an opening balance", bf_item is not None,
                     "no balance found under the new item's name"):
            raise RuntimeError("Section 14b setup failed -- could not find the month-1 balance.")

        bf_item_id = bf_item.get("itemTypeId")
        bf_value_a = bf_item.get("valueExcludingTax")

        gd_bf_b = row_cells(BASE_COLS, "GD-BF-B", bf_hs, desc=bf_desc, qty=200,
                            assessed=80000, st=18, ast=3, it=6)
        r = gd_preview(api, h, twomonth_co, build_sheet(BASE_HEADINGS, [gd_bf_b]), GD_MAPPING)
        bfB_prev = r.json() if r.ok else {}
        check("14b: month-2 GD-BF-B previews (mode omitted -- defaults to backfill)",
              r.ok, f"http {r.status_code}: {r.text[:200]}")
        bfB_line = (bfB_prev.get("lines") or [{}])[0]
        check("14b: month-2 line matches the existing balance (cost-only)",
              bfB_line.get("disposition") == "cost-only", f"disposition={bfB_line.get('disposition')}")
        check("14b: preview's match note (default/backfill mode) keeps the SET wording, not an ADD",
              bool(bfB_line.get("matchNote")) and "applied to the whole balance" in bfB_line["matchNote"]
              and "adds" not in bfB_line["matchNote"].lower(),
              f"matchNote={bfB_line.get('matchNote')!r}")

        bf_cost_b = compute_costing(assessed=80000, st=18, ast=3, it=6)

        # mode omitted entirely from the commit body too -- must default to
        # Backfill, exactly as it did before Task 19 existed.
        r = gd_commit(api, h, {
            "companyId": twomonth_co, "fileSha256": bfB_prev.get("fileSha256"),
            "fileName": "gd-bf-b.xlsx", "fileSizeBytes": bfB_prev.get("fileSizeBytes"),
            "lines": bfB_prev.get("lines", []),
        })
        bfB_res = r.json() if r.ok else {}
        check("14b: month-2 GD-BF-B commits with mode omitted (defaults to backfill)",
              r.ok and bfB_res.get("balancesCosted") == 1, f"http {r.status_code}: {r.text[:200]}")

        bf_item_after = opening_of(get_openings(api, h, twomonth_co), bf_item_id)
        expected_bf_unit_cost = bf_cost_b["cost"] / d(200)
        expected_bf_cost = money(expected_bf_unit_cost * d(310))
        check("14b: quantity is UNCHANGED by backfill (still 310, NOT 510)",
              bf_item_after is not None and close(bf_item_after.get("quantity"), 310.0),
              f"quantity={bf_item_after.get('quantity') if bf_item_after else None}")
        check("14b: ActualCostExcludingTax is SET (month-2's own unit cost x the existing 310 qty), not summed",
              bf_item_after is not None and close(bf_item_after.get("actualCostExcludingTax"), float(expected_bf_cost)),
              f"actualCostExcludingTax={bf_item_after.get('actualCostExcludingTax') if bf_item_after else None} expected={expected_bf_cost}")
        check("14b: ValueExcludingTax is UNTOUCHED by backfill mode",
              bf_item_after is not None and close(bf_item_after.get("valueExcludingTax"), bf_value_a),
              f"valueExcludingTax={bf_item_after.get('valueExcludingTax') if bf_item_after else None} expected(unchanged)={bf_value_a}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 15 -- GL posting (Task 20): New Arrivals posts a balanced
        # entry dated the GD's own date; Backfill and a GL-disabled company
        # post nothing; a cost-only line contributes no inventory debit;
        # re-posting the same GD does not duplicate the entry.
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 15. GL posting (Task 20) --")

        gl_co = make_company(api, h, f"GD Costing GL {tag}")
        try:
            en = requests.post(f"{api}/accounting/gl/company/{gl_co}/enable", headers=h, timeout=180)
            if not check("15: GL can be switched on for a fresh company", en.ok,
                         f"http {en.status_code}: {en.text[:200]}"):
                raise RuntimeError("Section 15 setup failed -- could not enable GL posting.")

            # An item the sheet's FIRST line will cost-only-match, so this one
            # GD carries both a cost-only line and a brand-new-stock line in
            # a single consignment.
            gl_existing_item = make_item(api, h, gl_co, f"GL Existing Item {tag}", hs="8481.1000")
            set_opening(api, h, gl_co, gl_existing_item, qty=20, value=50000)

            gl_a_gd = f"GD-GL-A-{tag}"
            gl_new_name = f"GL New Item {tag}"
            gl_a_row1 = row_cells(BASE_COLS, gl_a_gd, "8481.1000", desc=f"GL Existing Item {tag}",
                                  qty=30, assessed=100000, others=1000, st=18, ast=3, it=6,
                                  gddate="15-02-2026")
            gl_a_row2 = row_cells(BASE_COLS, gl_a_gd, "8484.1029", desc=gl_new_name,
                                  qty=20, assessed=50000, duty=2000, st=18, ast=3, it=6,
                                  gddate="15-02-2026")
            r = gd_preview(api, h, gl_co, build_sheet(BASE_HEADINGS, [gl_a_row1, gl_a_row2]),
                           GD_MAPPING, mode="new-arrivals")
            glA_prev = r.json() if r.ok else {}
            if not check("15: the mixed cost-only + new-stock sheet previews", r.ok,
                         f"http {r.status_code}: {r.text[:200]}"):
                raise RuntimeError("Section 15 setup failed -- the mixed sheet did not preview.")

            glA_lines = glA_prev.get("lines", [])
            check("15: line 1 (existing HS code) previews as cost-only",
                  len(glA_lines) == 2 and glA_lines[0].get("disposition") == "cost-only",
                  f"dispositions={[l.get('disposition') for l in glA_lines]}")
            check("15: line 2 (brand-new HS code) previews as stock-posted",
                  len(glA_lines) == 2 and glA_lines[1].get("disposition") == "stock-posted",
                  f"dispositions={[l.get('disposition') for l in glA_lines]}")

            r = gd_commit(api, h, {
                "companyId": gl_co, "fileSha256": glA_prev.get("fileSha256"),
                "fileName": "gd-gl-a.xlsx", "fileSizeBytes": glA_prev.get("fileSizeBytes"),
                "lines": glA_lines, "createMissingStock": True, "mode": "new-arrivals",
            })
            glA_res = r.json() if r.ok else {}
            if not check("15: the mixed GD (new arrivals) commits", r.ok,
                         f"http {r.status_code}: {r.text[:200]}"):
                raise RuntimeError("Section 15 setup failed -- the mixed GD did not commit. "
                                  "Aborting rather than cascading into unrelated failures.")

            # Track the server-created item type for cleanup -- it is a GLOBAL
            # catalog row (CLAUDE.md 5b-2) that make_item() never touched.
            glA_new_opening = next((o for o in get_openings(api, h, gl_co)
                                    if o.get("itemTypeName", "").startswith(gl_new_name)), None)
            if glA_new_opening and glA_new_opening.get("itemTypeId"):
                CREATED_ITEM_TYPE_IDS.append(glA_new_opening["itemTypeId"])

            # Expected figures, computed the same way ImportCostingCalculator
            # does (mirrored by compute_costing) -- Input Tax and Advance
            # Income Tax sum BOTH lines; Inventory sums the stock-posted line
            # ONLY.
            c1 = compute_costing(assessed=100000, others=1000, st=18, ast=3, it=6)
            c2 = compute_costing(assessed=50000, duty=2000, st=18, ast=3, it=6)
            expected_inventory = money(c2["cost"])
            expected_input_tax = money(c1["salesTax"] + c1["ast"] + d(1000)
                                       + c2["salesTax"] + c2["ast"] + d(0))
            expected_income_tax = money(c1["incomeTax"] + c2["incomeTax"])
            expected_clearing = money(expected_inventory + expected_input_tax + expected_income_tax)

            check("15: exactly one journal entry is reported, for the one GD",
                  len(glA_res.get("journalEntries") or []) == 1,
                  f"journalEntries={glA_res.get('journalEntries')}")
            check("15: the commit response's totalPosted matches the balancing (Import Clearing) figure",
                  close(glA_res.get("totalPosted"), float(expected_clearing)),
                  f"totalPosted={glA_res.get('totalPosted')} expected={expected_clearing}")

            je_id = (glA_res.get("journalEntries") or [{}])[0].get("journalEntryId")
            je_r = requests.get(f"{api}/journal-entries/{je_id}", headers=h, timeout=60) if je_id else None
            je = je_r.json() if je_r is not None and je_r.ok else {}
            check("15: the entry is dated the GD's own date (15 Feb 2026), not today",
                  (je.get("date") or "")[:10] == "2026-02-15", f"date={je.get('date')}")
            check("15: the entry balances",
                  je and close(je.get("totalDebit"), je.get("totalCredit")),
                  f"totalDebit={je.get('totalDebit')} totalCredit={je.get('totalCredit')}")
            check("15: the entry's source document type is ImportConsignment",
                  je.get("sourceDocType") == "ImportConsignment",
                  f"sourceDocType={je.get('sourceDocType')}")

            by = {}
            for l in je.get("lines", []):
                nm = (l.get("accountName") or "").lower()
                by[nm] = by.get(nm, 0) + (l.get("debit") or 0) - (l.get("credit") or 0)

            inv = next((v for k, v in by.items() if "inventory on hand" in k), None)
            check("15: Inventory is debited for the NEW-STOCK line's cost ONLY, not the cost-only line's",
                  inv is not None and close(inv, float(expected_inventory)),
                  f"inventory net-debit={inv} expected={expected_inventory} "
                  f"(would be {c1['cost'] + c2['cost']} if the cost-only line were wrongly included)")
            inp = next((v for k, v in by.items() if "input sales tax" in k), None)
            check("15: Input Tax is SalesTax + AST + Others, summed across BOTH lines",
                  inp is not None and close(inp, float(expected_input_tax)),
                  f"input tax net-debit={inp} expected={expected_input_tax}")
            ait = next((v for k, v in by.items() if "advance income tax" in k), None)
            check("15: Advance Income Tax on Imports is IncomeTax, summed across both lines",
                  ait is not None and close(ait, float(expected_income_tax)),
                  f"advance income tax net-debit={ait} expected={expected_income_tax}")
            clr = next((v for k, v in by.items() if "import clearing" in k), None)
            check("15: Import Clearing carries the balancing credit",
                  clr is not None and close(-clr, float(expected_clearing)),
                  f"import clearing net-debit={clr} expected credit={expected_clearing}")

            # ---- Backfill posts NO journal entry at all -------------------
            gl_bf_gd = f"GD-GL-BF-{tag}"
            gl_bf_name = f"GL Backfill Item {tag}"
            gl_bf_row = row_cells(BASE_COLS, gl_bf_gd, "8517.6991", desc=gl_bf_name,
                                  qty=10, assessed=40000, st=18, ast=3, it=6, gddate="20-02-2026")
            r = gd_preview(api, h, gl_co, build_sheet(BASE_HEADINGS, [gl_bf_row]), GD_MAPPING,
                           mode="backfill")
            glBf_prev = r.json() if r.ok else {}
            r = gd_commit(api, h, {
                "companyId": gl_co, "fileSha256": glBf_prev.get("fileSha256"),
                "fileName": "gd-gl-bf.xlsx", "fileSizeBytes": glBf_prev.get("fileSizeBytes"),
                "lines": glBf_prev.get("lines", []), "createMissingStock": True,
                "mode": "backfill",
            })
            glBf_res = r.json() if r.ok else {}
            check("15: a backfill commit (new stock, GL-enabled company) still succeeds",
                  r.ok, f"http {r.status_code}: {r.text[:200]}")
            check("15: ...but backfill posts NO journal entry at all",
                  r.ok and len(glBf_res.get("journalEntries") or []) == 0
                  and (glBf_res.get("totalPosted") or 0) == 0,
                  f"journalEntries={glBf_res.get('journalEntries')} totalPosted={glBf_res.get('totalPosted')}")

            glBf_opening = next((o for o in get_openings(api, h, gl_co)
                                 if o.get("itemTypeName", "").startswith(gl_bf_name)), None)
            if glBf_opening and glBf_opening.get("itemTypeId"):
                CREATED_ITEM_TYPE_IDS.append(glBf_opening["itemTypeId"])

            # ---- Re-submitting the identical GD is refused, and the entry
            #      already posted is neither duplicated nor changed ----------
            r = gd_commit(api, h, {
                "companyId": gl_co, "fileSha256": glA_prev.get("fileSha256"),
                "fileName": "gd-gl-a.xlsx", "fileSizeBytes": glA_prev.get("fileSizeBytes"),
                "lines": glA_lines, "createMissingStock": True, "mode": "new-arrivals",
            })
            dup_msg = (r.json().get("message") or "").lower() if r.text else ""
            check("15: re-submitting the exact same file is refused (already imported)",
                  r.status_code == 400 and "already" in dup_msg, f"http {r.status_code}: {r.text[:200]}")

            je_again = requests.get(f"{api}/journal-entries/{je_id}", headers=h, timeout=60) if je_id else None
            check("15: re-posting is idempotent -- the SAME entry still carries the SAME total, not doubled",
                  je_again is not None and je_again.ok
                  and close(je_again.json().get("totalCredit"), float(expected_clearing)),
                  f"http {je_again.status_code if je_again is not None else 'n/a'}: "
                  f"totalCredit={je_again.json().get('totalCredit') if je_again is not None and je_again.ok else None}")
        finally:
            if not args.keep:
                requests.delete(f"{api}/companies/{gl_co}", headers=h, timeout=300)

        # ---- A GL-DISABLED company posts nothing either --------------------
        # make_company() doesn't expose enableGl, and CreateCompanyDto.EnableGl
        # defaults to true (a new company gets GL from day one) -- so this one
        # company in the whole suite must be created by hand, with it OFF.
        r = requests.post(f"{api}/companies", headers=h, timeout=60, json={
            "name": f"GD Costing GL Off {tag}", "brandName": "GDCOST",
            "fullAddress": "1 Test Street", "phone": "021-0000000", "ntn": "1234567-8",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
            "enableGl": False,
        })
        if r.status_code not in (200, 201):
            raise RuntimeError(f"GL-off company create failed: http {r.status_code} {r.text[:200]}")
        gl_off_co = r.json()["id"]
        gl_status = requests.get(f"{api}/accounting/gl/company/{gl_off_co}/status", headers=h, timeout=30)
        check("15: the GL-off company genuinely has GL posting off",
              gl_status.ok and gl_status.json().get("enabled") is False,
              f"http {gl_status.status_code}: {gl_status.text[:200]}")
        try:
            gl_off_gd = f"GD-GL-OFF-{tag}"
            gl_off_name = f"GL Off Item {tag}"
            off_row = row_cells(BASE_COLS, gl_off_gd, "8481.1000", desc=gl_off_name,
                                qty=15, assessed=30000, st=18, ast=3, it=6, gddate="10-02-2026")
            r = gd_preview(api, h, gl_off_co, build_sheet(BASE_HEADINGS, [off_row]), GD_MAPPING,
                           mode="new-arrivals")
            off_prev = r.json() if r.ok else {}
            r = gd_commit(api, h, {
                "companyId": gl_off_co, "fileSha256": off_prev.get("fileSha256"),
                "fileName": "gd-gl-off.xlsx", "fileSizeBytes": off_prev.get("fileSizeBytes"),
                "lines": off_prev.get("lines", []), "createMissingStock": True,
                "mode": "new-arrivals",
            })
            off_res = r.json() if r.ok else {}
            check("15: a new-arrivals commit on a GL-DISABLED company still succeeds",
                  r.ok, f"http {r.status_code}: {r.text[:200]}")
            check("15: ...but posts no journal entry at all, GL being off for this company",
                  r.ok and len(off_res.get("journalEntries") or []) == 0
                  and (off_res.get("totalPosted") or 0) == 0,
                  f"journalEntries={off_res.get('journalEntries')} totalPosted={off_res.get('totalPosted')}")

            off_opening = next((o for o in get_openings(api, h, gl_off_co)
                               if o.get("itemTypeName", "").startswith(gl_off_name)), None)
            if off_opening and off_opening.get("itemTypeId"):
                CREATED_ITEM_TYPE_IDS.append(off_opening["itemTypeId"])
        finally:
            if not args.keep:
                requests.delete(f"{api}/companies/{gl_off_co}", headers=h, timeout=300)

        # ══════════════════════════════════════════════════════════════════
        # SECTION 16 -- Consignments: view + delete (Task 21)
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 16. Consignments: list/detail, and the delete/undo path --")

        # 16a: list/detail/delete 403 for a user with no access to the company
        # at all -- hr (Section 11) was granted ONLY `company`, so twomonth_co
        # (which Section 14 committed real backfill/new-arrivals GDs into) is
        # completely out of reach for them.
        r = list_consignments(api, h, twomonth_co, page_size=200)
        r.raise_for_status()
        some_twomonth_cid = (r.json().get("items") or [{}])[0].get("id")
        check("16a: setup -- twomonth_co has a real consignment to test against",
              some_twomonth_cid is not None, f"items={r.json().get('items')}")

        r = list_consignments(api, hr, twomonth_co)
        check("16a: a user with no access to the company is refused the list",
              r.status_code == 403, f"http {r.status_code}: {r.text[:160]}")
        if some_twomonth_cid is not None:
            r = get_consignment(api, hr, some_twomonth_cid)
            check("16a: a user with no access to the company is refused the detail",
                  r.status_code == 403, f"http {r.status_code}: {r.text[:160]}")
            r = delete_consignment(api, hr, some_twomonth_cid)
            check("16a: a user with no access to the company is refused the delete",
                  r.status_code == 403, f"http {r.status_code}: {r.text[:160]}")

            r = get_consignment(api, h, some_twomonth_cid)
            check("16a: admin (has access) reads the very same consignment fine",
                  r.ok and r.json().get("id") == some_twomonth_cid, f"http {r.status_code}: {r.text[:200]}")

        # 16a2: an unknown consignment id 404s on every route -- never a 403
        # or a 500, the same "don't confirm what exists" shape every other
        # id-based route in this codebase follows.
        r = get_consignment(api, h, 999999999)
        check("16a2: an unknown consignment id 404s on GET", r.status_code == 404, f"http {r.status_code}")
        r = delete_consignment(api, h, 999999999)
        check("16a2: an unknown consignment id 404s on DELETE", r.status_code == 404, f"http {r.status_code}")

        # 16b: Backfill delete zeroes the cost it set (there is no prior value
        # anywhere to restore), leaves quantity/value untouched, and the SAME
        # GD number can be imported again afterwards -- while a duplicate GD
        # that was NOT deleted is still refused, with an updated message.
        bf_co = make_company(api, h, f"GD Costing Del Backfill {tag}")
        try:
            bf_item = make_item(api, h, bf_co, f"Del Backfill Item {tag}", hs="8481.1000")
            set_opening(api, h, bf_co, bf_item, qty=100, value=250000)
            bf_gd = f"GD-DEL-BF-{tag}"
            bf_row = row_cells(BASE_COLS, bf_gd, "8481.1000", desc=f"Del Backfill Item {tag}",
                               qty=100, assessed=62490, st=18, ast=3, it=6)
            r = gd_preview(api, h, bf_co, build_sheet(BASE_HEADINGS, [bf_row]), GD_MAPPING)
            bf_prev = r.json() if r.ok else {}
            check("16b: the backfill delete-target sheet previews", r.ok, f"http {r.status_code}: {r.text[:200]}")
            r = gd_commit(api, h, {
                "companyId": bf_co, "fileSha256": bf_prev.get("fileSha256"), "fileName": "bf-del.xlsx",
                "fileSizeBytes": bf_prev.get("fileSizeBytes"), "lines": bf_prev.get("lines", []),
                "mode": "backfill",
            })
            check("16b: it commits (backfill)", r.ok, f"http {r.status_code}: {r.text[:200]}")

            bf_before = opening_of(get_openings(api, h, bf_co), bf_item)
            check("16b: cost was set by the commit",
                  bf_before is not None and close(bf_before.get("actualCostExcludingTax"), 62490.0),
                  f"balance={bf_before}")

            bf_cid = find_consignment_id(api, h, bf_co, bf_gd)
            check("16b: the consignment is findable via the new list endpoint",
                  bf_cid is not None, f"cid={bf_cid}")

            r = delete_consignment(api, h, bf_cid)
            bf_del_res = r.json() if r.ok else {}
            check("16b: delete succeeds", r.ok, f"http {r.status_code}: {r.text[:300]}")
            check("16b: delete reports one balance cost-reversed, none deleted, no journal entry",
                  bf_del_res.get("balancesCostReversed") == 1
                  and bf_del_res.get("balancesDeleted") == 0
                  and bf_del_res.get("journalEntryWithdrawn") is False,
                  f"result={bf_del_res}")

            bf_after = opening_of(get_openings(api, h, bf_co), bf_item)
            check("16b: cost is reset to EXACTLY 0.00 (Backfill SET it -- no prior value to restore)",
                  bf_after is not None and close(bf_after.get("actualCostExcludingTax"), 0.0),
                  f"balance={bf_after}")
            check("16b: quantity is UNTOUCHED by the reversal",
                  bf_after is not None and close(bf_after.get("quantity"), 100.0), f"balance={bf_after}")
            check("16b: value is UNTOUCHED by the reversal",
                  bf_after is not None and close(bf_after.get("valueExcludingTax"), 250000.0),
                  f"balance={bf_after}")

            r = get_consignment(api, h, bf_cid)
            check("16b: the deleted consignment's detail now 404s",
                  r.status_code == 404, f"http {r.status_code}")

            # Gap D: re-importing the SAME GD number (genuinely different
            # bytes) now succeeds once the old consignment is gone.
            bf_row2 = row_cells(BASE_COLS, bf_gd, "8481.1000", desc=f"Del Backfill Item {tag}",
                                qty=100, assessed=62490, others=1, st=18, ast=3, it=6)
            r = gd_preview(api, h, bf_co, build_sheet(BASE_HEADINGS, [bf_row2]), GD_MAPPING)
            bf_prev2 = r.json() if r.ok else {}
            check("16b: the re-import sheet has a genuinely different hash from the original",
                  bf_prev2.get("fileSha256") != bf_prev.get("fileSha256"),
                  f"{bf_prev2.get('fileSha256')} vs {bf_prev.get('fileSha256')}")
            r = gd_commit(api, h, {
                "companyId": bf_co, "fileSha256": bf_prev2.get("fileSha256"), "fileName": "bf-del2.xlsx",
                "fileSizeBytes": bf_prev2.get("fileSizeBytes"), "lines": bf_prev2.get("lines", []),
                "mode": "backfill",
            })
            check("16b: the SAME GD number imports again once the old consignment is deleted",
                  r.ok, f"http {r.status_code}: {r.text[:300]}")

            # WITHOUT deleting, a duplicate GD number is still refused -- the
            # guard is not weakened -- but the message now says what to do.
            dup_row = row_cells(BASE_COLS, bf_gd, "8481.1000", desc=f"Del Backfill Item {tag}",
                                qty=100, assessed=62490, others=2, st=18, ast=3, it=6)
            r = gd_preview(api, h, bf_co, build_sheet(BASE_HEADINGS, [dup_row]), GD_MAPPING)
            dup_prev = r.json() if r.ok else {}
            check("16b: the duplicate-GD guard still fires in PREVIEW (guard not weakened)",
                  any("already" in e.lower() for e in dup_prev.get("blockingErrors", [])),
                  f"blockingErrors={dup_prev.get('blockingErrors')}")
            r = gd_commit(api, h, {
                "companyId": bf_co, "fileSha256": dup_prev.get("fileSha256"), "fileName": "bf-dup.xlsx",
                "fileSizeBytes": dup_prev.get("fileSizeBytes"), "lines": dup_prev.get("lines", []),
                "mode": "backfill",
            })
            dup_msg = (r.json().get("message") or "") if r.text else ""
            check("16b: the duplicate-GD guard still refuses the COMMIT too",
                  r.status_code == 400 and "already" in dup_msg.lower(), f"http {r.status_code}: {dup_msg}")
            check("16b: the guard's message now tells the operator to delete the existing one first",
                  "consignments" in dup_msg.lower() and "delete" in dup_msg.lower(), f"message={dup_msg}")
        finally:
            if not args.keep:
                requests.delete(f"{api}/companies/{bf_co}", headers=h, timeout=300)

        # 16c: New Arrivals delete subtracts EXACTLY what it added -- quantity,
        # cost and value all land back on the pre-commit figures -- and its
        # posted journal entry is withdrawn.
        na_co = make_company(api, h, f"GD Costing Del NewArr {tag}")
        try:
            en = requests.post(f"{api}/accounting/gl/company/{na_co}/enable", headers=h, timeout=180)
            check("16c: GL can be switched on", en.ok, f"http {en.status_code}: {en.text[:200]}")

            na_item = make_item(api, h, na_co, f"Del NewArr Item {tag}", hs="8481.1000")
            set_opening(api, h, na_co, na_item, qty=200, value=500000, cost=100000)
            na_before = opening_of(get_openings(api, h, na_co), na_item)

            na_gd = f"GD-DEL-NA-{tag}"
            na_row = row_cells(BASE_COLS, na_gd, "8481.1000", desc=f"Del NewArr Item {tag}",
                               qty=50, assessed=31245, st=18, ast=3, it=6, gddate="12-03-2026")
            r = gd_preview(api, h, na_co, build_sheet(BASE_HEADINGS, [na_row]), GD_MAPPING,
                          mode="new-arrivals")
            na_prev = r.json() if r.ok else {}
            check("16c: the new-arrivals delete-target sheet previews",
                  r.ok, f"http {r.status_code}: {r.text[:200]}")
            r = gd_commit(api, h, {
                "companyId": na_co, "fileSha256": na_prev.get("fileSha256"), "fileName": "na-del.xlsx",
                "fileSizeBytes": na_prev.get("fileSizeBytes"), "lines": na_prev.get("lines", []),
                "mode": "new-arrivals",
            })
            na_commit_res = r.json() if r.ok else {}
            check("16c: it commits (new arrivals) and posts one journal entry",
                  r.ok and len(na_commit_res.get("journalEntries") or []) == 1,
                  f"http {r.status_code}: {r.text[:300]}")
            na_je_id = (na_commit_res.get("journalEntries") or [{}])[0].get("journalEntryId")

            na_cid = find_consignment_id(api, h, na_co, na_gd)
            check("16c: the consignment is findable via the list endpoint",
                  na_cid is not None, f"cid={na_cid}")
            row16c = next((x for x in list_consignments(api, h, na_co, page_size=50).json().get("items", [])
                          if x["id"] == na_cid), {})
            check("16c: the list row reports hasJournalEntry",
                  row16c.get("hasJournalEntry") is True, f"row={row16c}")

            r = delete_consignment(api, h, na_cid)
            na_del_res = r.json() if r.ok else {}
            check("16c: delete succeeds", r.ok, f"http {r.status_code}: {r.text[:300]}")
            check("16c: delete reports the journal entry withdrawn",
                  na_del_res.get("journalEntryWithdrawn") is True, f"result={na_del_res}")

            na_after = opening_of(get_openings(api, h, na_co), na_item)
            check("16c: quantity is back to EXACTLY the pre-commit figure",
                  na_after is not None and close(na_after.get("quantity"), na_before.get("quantity")),
                  f"before={na_before} after={na_after}")
            check("16c: actual cost is back to EXACTLY the pre-commit figure",
                  na_after is not None and close(na_after.get("actualCostExcludingTax"),
                                                 na_before.get("actualCostExcludingTax")),
                  f"before={na_before} after={na_after}")
            check("16c: value is back to EXACTLY the pre-commit figure",
                  na_after is not None and close(na_after.get("valueExcludingTax"),
                                                 na_before.get("valueExcludingTax")),
                  f"before={na_before} after={na_after}")

            je_after = requests.get(f"{api}/journal-entries/{na_je_id}", headers=h, timeout=30) if na_je_id else None
            check("16c: the withdrawn journal entry now 404s",
                  je_after is not None and je_after.status_code == 404,
                  f"http {je_after.status_code if je_after is not None else 'n/a'}")
        finally:
            if not args.keep:
                requests.delete(f"{api}/companies/{na_co}", headers=h, timeout=300)

        # 16d: a StockPosted-created balance is refused once anything has
        # moved against it -- and NOTHING is undone by a refused delete.
        blk_co = make_company(api, h, f"GD Costing Del Blocked {tag}")
        try:
            blk_gd = f"GD-DEL-BLK-{tag}"
            blk_desc = f"Del Blocked Item {tag}"
            # A wholly new HS code -- no existing balance for it anywhere.
            blk_row = row_cells(BASE_COLS, blk_gd, "9991.0000", desc=blk_desc,
                                qty=10, assessed=8000, st=18, ast=3, it=6)
            r = gd_preview(api, h, blk_co, build_sheet(BASE_HEADINGS, [blk_row]), GD_MAPPING)
            blk_prev = r.json() if r.ok else {}
            check("16d: the unmatched-line sheet previews as stock-posted",
                  r.ok and blk_prev.get("lines", [{}])[0].get("disposition") == "stock-posted",
                  f"http {r.status_code}: {r.text[:200]}")
            r = gd_commit(api, h, {
                "companyId": blk_co, "fileSha256": blk_prev.get("fileSha256"), "fileName": "blk-del.xlsx",
                "fileSizeBytes": blk_prev.get("fileSizeBytes"), "lines": blk_prev.get("lines", []),
                "createMissingStock": True, "mode": "backfill",
            })
            blk_commit_res = r.json() if r.ok else {}
            check("16d: it commits and creates one opening balance",
                  r.ok and blk_commit_res.get("openingBalancesCreated") == 1,
                  f"http {r.status_code}: {r.text[:300]}")

            blk_openings = get_openings(api, h, blk_co)
            blk_balance = next((o for o in blk_openings
                               if o.get("itemTypeName", "").startswith(blk_desc)), None)
            check("16d: the new balance exists", blk_balance is not None, f"openings={blk_openings}")
            blk_item_id = blk_balance["itemTypeId"] if blk_balance else None
            if blk_item_id:
                CREATED_ITEM_TYPE_IDS.append(blk_item_id)

            blk_cid = find_consignment_id(api, h, blk_co, blk_gd)
            check("16d: the consignment is findable", blk_cid is not None, f"cid={blk_cid}")

            # Simulate "moved since" with a stock adjustment (Revaluation --
            # CLAUDE.md 5b-4) rather than a sale, so no client/tracking setup
            # is needed: quantity/value untouched, actual cost nudged by 1.
            adj = requests.post(f"{api}/stock/adjust", headers=h, timeout=30, json={
                "companyId": blk_co, "itemTypeId": blk_item_id, "mode": "set",
                "targetActualCostExcludingTax": (blk_balance.get("actualCostExcludingTax") or 0) + 1,
            })
            check("16d: the stock adjustment itself succeeds", adj.ok, f"http {adj.status_code}: {adj.text[:200]}")

            r = delete_consignment(api, h, blk_cid)
            check("16d: the delete is REFUSED once the item has moved",
                  r.status_code == 400, f"http {r.status_code}: {r.text[:300]}")
            blk_msg = (r.json().get("message") or "") if r.text else ""
            check("16d: the refusal names the item and says it has moved",
                  "moved" in blk_msg.lower() or "movement" in blk_msg.lower(), f"message={blk_msg}")

            # Nothing was undone: the consignment and the balance both survive.
            r = get_consignment(api, h, blk_cid)
            check("16d: the consignment still exists after the refusal", r.ok, f"http {r.status_code}")
            blk_after = opening_of(get_openings(api, h, blk_co), blk_item_id)
            check("16d: the balance still exists after the refusal", blk_after is not None,
                  f"openings={get_openings(api, h, blk_co)}")
        finally:
            if not args.keep:
                requests.delete(f"{api}/companies/{blk_co}", headers=h, timeout=300)

        # 16e: a balance one consignment created is later relied on
        # (CostOnly) by a SECOND consignment -- the first cannot be deleted
        # until the second is gone, or is itself gone.
        shr_co = make_company(api, h, f"GD Costing Del Shared {tag}")
        try:
            shr_desc = f"Del Shared Item {tag}"
            shr_gd1 = f"GD-DEL-SHR1-{tag}"
            shr_row1 = row_cells(BASE_COLS, shr_gd1, "9992.0000", desc=shr_desc,
                                 qty=20, assessed=10000, st=18, ast=3, it=6)
            r = gd_preview(api, h, shr_co, build_sheet(BASE_HEADINGS, [shr_row1]), GD_MAPPING)
            shr_prev1 = r.json() if r.ok else {}
            r = gd_commit(api, h, {
                "companyId": shr_co, "fileSha256": shr_prev1.get("fileSha256"), "fileName": "shr1.xlsx",
                "fileSizeBytes": shr_prev1.get("fileSizeBytes"), "lines": shr_prev1.get("lines", []),
                "createMissingStock": True, "mode": "backfill",
            })
            check("16e: the first (creating) consignment commits", r.ok, f"http {r.status_code}: {r.text[:200]}")
            shr_cid1 = find_consignment_id(api, h, shr_co, shr_gd1)

            shr_openings = get_openings(api, h, shr_co)
            shr_balance = next((o for o in shr_openings if o.get("itemTypeName", "").startswith(shr_desc)), None)
            if shr_balance:
                CREATED_ITEM_TYPE_IDS.append(shr_balance["itemTypeId"])

            shr_gd2 = f"GD-DEL-SHR2-{tag}"
            shr_row2 = row_cells(BASE_COLS, shr_gd2, "9992.0000", desc=shr_desc,
                                 qty=5, assessed=3000, st=18, ast=3, it=6)
            r = gd_preview(api, h, shr_co, build_sheet(BASE_HEADINGS, [shr_row2]), GD_MAPPING)
            shr_prev2 = r.json() if r.ok else {}
            check("16e: the second sheet matches the balance the first one created (cost-only)",
                  r.ok and shr_prev2.get("lines", [{}])[0].get("disposition") == "cost-only",
                  f"http {r.status_code}: {r.text[:200]}")
            r = gd_commit(api, h, {
                "companyId": shr_co, "fileSha256": shr_prev2.get("fileSha256"), "fileName": "shr2.xlsx",
                "fileSizeBytes": shr_prev2.get("fileSizeBytes"), "lines": shr_prev2.get("lines", []),
                "mode": "backfill",
            })
            check("16e: the second (dependent) consignment commits", r.ok, f"http {r.status_code}: {r.text[:200]}")
            shr_cid2 = find_consignment_id(api, h, shr_co, shr_gd2)

            r = delete_consignment(api, h, shr_cid1)
            check("16e: deleting the CREATOR is refused while the dependent consignment exists",
                  r.status_code == 400, f"http {r.status_code}: {r.text[:300]}")
            shr_msg = (r.json().get("message") or "") if r.text else ""
            check("16e: the refusal names another consignment as the reason",
                  "another consignment" in shr_msg.lower(), f"message={shr_msg}")

            r = delete_consignment(api, h, shr_cid2)
            check("16e: deleting the DEPENDENT (cost-only) consignment succeeds",
                  r.ok, f"http {r.status_code}: {r.text[:200]}")

            r = delete_consignment(api, h, shr_cid1)
            check("16e: the creator is now deletable once nothing depends on it",
                  r.ok, f"http {r.status_code}: {r.text[:200]}")
        finally:
            if not args.keep:
                requests.delete(f"{api}/companies/{shr_co}", headers=h, timeout=300)

    finally:
        if not args.keep:
            if restricted_user_id:
                requests.delete(f"{api}/users/{restricted_user_id}", headers=h, timeout=30)
            for cid in (company, mixed_co, other_co, del_co, twomonth_co):
                if cid:
                    requests.delete(f"{api}/companies/{cid}", headers=h, timeout=300)
            # Companies first -- they hold the documents that reference an item
            # type. Only then can the global catalog rows go. A delete that is
            # refused (something else adopted the row) is ignored on purpose:
            # teardown must never fail the run.
            for iid in CREATED_ITEM_TYPE_IDS:
                try:
                    requests.delete(f"{api}/itemtypes/{iid}", headers=h, timeout=60)
                except Exception:
                    pass

    return report()


def report():
    failed = [r for r in results if r[0] == FAIL]
    skipped = [r for r in results if r[0] == SKIP]
    passed = [r for r in results if r[0] == PASS]
    print(f"\n{len(passed)} passed, {len(failed)} failed, {len(skipped)} skipped")
    if failed:
        print("FAILURES:")
        for _, name, detail in failed:
            print(f"  - {name}: {detail}")
        return 1
    print("all PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
