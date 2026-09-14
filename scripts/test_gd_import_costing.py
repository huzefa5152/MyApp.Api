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

def list_consignments(api, h, company_id, page=1, page_size=50, only_outstanding=None):
    params = {"companyId": company_id, "page": page, "pageSize": page_size}
    if only_outstanding is not None:
        params["onlyOutstanding"] = "true" if only_outstanding else "false"
    return requests.get(f"{api}/import-consignments", headers=h, timeout=30, params=params)


def get_consignment(api, h, cid):
    return requests.get(f"{api}/import-consignments/{cid}", headers=h, timeout=30)


def delete_consignment(api, h, cid):
    return requests.delete(f"{api}/import-consignments/{cid}", headers=h, timeout=30)


def find_consignment_id(api, h, company_id, gd_number):
    r = list_consignments(api, h, company_id, page_size=200)
    r.raise_for_status()
    row = next((x for x in r.json().get("items", []) if x.get("gdNumber") == gd_number), None)
    return row["id"] if row else None


# ── Payments (Task 23: settling a consignment's Import Clearing liability) ──
# Money-out only -- an ImportConsignment allocation is refused on a receipt.

def create_payment(api, h, company_id, body):
    return requests.post(f"{api}/payments/payments/company/{company_id}", headers=h,
                         timeout=30, json=body)


def delete_payment(api, h, payment_id):
    return requests.delete(f"{api}/payments/payments/{payment_id}", headers=h, timeout=30)


def settle_consignment_payload(consignment_id, amount, date="2026-02-20", description=None):
    """A minimal money-out payment settling one consignment -- the shape
    SettleConsignmentDialog.jsx sends."""
    return {
        "direction": "Payment", "date": date, "contactType": "Other",
        "method": "Bank Transfer", "description": description,
        "allocations": [{
            "kind": "ImportConsignment", "importConsignmentId": consignment_id, "amount": amount,
        }],
    }


# ── Cost audit trail (2026-09-13) + line correction ─────────────────────────

def cost_changes(api, h, company_id, item_type_id=None, page_size=100):
    params = {"page": 1, "pageSize": page_size}
    if item_type_id is not None:
        params["itemTypeId"] = item_type_id
    return requests.get(f"{api}/stock/company/{company_id}/cost-changes",
                        headers=h, timeout=30, params=params)


def cost_rows(api, h, company_id, item_type_id=None):
    r = cost_changes(api, h, company_id, item_type_id)
    return (r.json() or {}).get("items", []) if r.ok else []


def correct_line(api, h, consignment_id, line_id, body):
    return requests.put(f"{api}/import-consignments/{consignment_id}/lines/{line_id}",
                        headers=h, timeout=60, json=body)


def line_body(qty, assessed, duty=0, acd=0, regduty=0, others=0, st=18, ast=3, it=6,
              addon=0, selling=None, reason=None):
    """The costing INPUTS a correction sends. The server recomputes cost and
    selling value from these itself -- see UpdateImportConsignmentLineDto."""
    return {
        "quantity": qty, "assessedValue": assessed, "customsDuty": duty, "acd": acd,
        "regulatoryDuty": regduty, "others": others, "salesTaxRate": st, "astRate": ast,
        "incomeTaxRate": it, "addOnProfit": addon,
        "sellingValueExcludingTax": selling, "reason": reason,
    }


def settle_with_writeoff(consignment_id, cash, adjustment, adjustment_account_id,
                         date="2026-02-20"):
    """A money-out settlement that clears cash + a written-back remainder --
    the shape SettleConsignmentDialog sends once "Write back the rest" is used."""
    return {
        "direction": "Payment", "date": date, "contactType": "Other",
        "method": "Bank Transfer", "description": "GD settlement with write-off",
        "allocations": [{
            "kind": "ImportConsignment", "importConsignmentId": consignment_id,
            "amount": cash, "adjustmentAmount": adjustment,
            "adjustmentAccountId": adjustment_account_id,
        }],
    }


def account_by_control(api, h, company_id, control_type):
    r = requests.get(f"{api}/accounts/company/{company_id}/flat", headers=h, timeout=30)
    if not r.ok:
        return None
    rows = [a for a in (r.json() or []) if a.get("controlType") == control_type]
    return next((a for a in rows if a.get("isActive")), rows[0] if rows else None)


def gd_preview_manual(api, h, company_id, lines, mode=None):
    """Hand entry (Task 18, multi-line since 2026-09-14). ALL lines in ONE
    call -- matching and per-balance pooling reason over the set."""
    params = {"companyId": company_id}
    if mode:
        params["mode"] = mode
    return requests.post(f"{api}/spreadsheet-import/gd-costing/preview-manual",
                         headers=h, timeout=60, params=params, json={"lines": lines})


def manual_line(gd, hs, desc, qty=1, assessed=0, duty=0, acd=0, regduty=0, others=0,
                st=18, ast=3, it=6, addon=0, selling=None, unit="Pcs", gddate="2026-07-01"):
    return {
        "gdNumber": gd, "gdDate": gddate, "description": desc, "hsCode": hs,
        "quantity": qty, "unit": unit, "assessedValue": assessed, "customsDuty": duty,
        "acd": acd, "regulatoryDuty": regduty, "others": others, "salesTaxRate": st,
        "astRate": ast, "incomeTaxRate": it, "addOnProfit": addon, "sellingValue": selling,
    }


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
    # Sections 21-25 make their own companies/users/roles; collected here so
    # the one teardown at the bottom clears them whatever fails in between.
    created_companies = []
    created_user_ids = []
    created_role_ids = []

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
            # Income Tax sum BOTH lines; Inventory ALSO sums both (Finding 1,
            # 2026-09-13 architecture review): under New Arrivals, line 1's
            # cost-only match is exactly where new quantity/cost/selling value
            # are ADDED onto gl_existing_item's balance -- genuinely new goods
            # against an already-known product -- so its landed cost belongs
            # in Inventory the same as line 2's brand-new stock does. An
            # earlier build excluded the cost-only line here, which understated
            # Inventory while crediting Import Clearing for the full amount.
            c1 = compute_costing(assessed=100000, others=1000, st=18, ast=3, it=6)
            c2 = compute_costing(assessed=50000, duty=2000, st=18, ast=3, it=6)
            expected_inventory = money(c1["cost"] + c2["cost"])
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
            check("15: Inventory is debited for BOTH lines' cost under New Arrivals -- the "
                  "cost-only line's cost counts too, not the new-stock line's alone",
                  inv is not None and close(inv, float(expected_inventory)),
                  f"inventory net-debit={inv} expected={expected_inventory} "
                  f"(would be only {c2['cost']} if the cost-only line were wrongly excluded, "
                  f"Finding 1 -- understating Inventory while Import Clearing still carried the full cost)")
            check("15: the entry still balances once the cost-only line's cost is included",
                  je and close(je.get("totalDebit"), je.get("totalCredit")),
                  f"totalDebit={je.get('totalDebit')} totalCredit={je.get('totalCredit')}")
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

        # ══════════════════════════════════════════════════════════════════
        # SECTION 17 -- stock.actualcost.view gates actual cost / margin
        # across the on-hand grid, the Excel export and the movements
        # drill-down (Finding 2, 2026-09-13 architecture review). Nothing
        # here touches the GD costing endpoints -- it proves the STOCK side
        # of the fix, which is what actually leaked (the permission existed
        # and the frontend gated on it, but no controller action checked it).
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 17. stock.actualcost.view: redaction across three surfaces --")

        ac_co = make_company(api, h, f"GD Costing ActualCost {tag}")
        ac_made_users, ac_made_roles = [], []
        try:
            ac_item = make_item(api, h, ac_co, f"ActualCost Item {tag}", hs="8481.2000")
            r = set_opening(api, h, ac_co, ac_item, qty=40, value=200000, cost=80000)
            check("17: opening balance with a real actual cost is created",
                  r.ok and close(r.json().get("actualCostExcludingTax"), 80000),
                  f"http {r.status_code}: {r.text[:200]}")

            def provision(username, role_name, keys):
                """A throwaway user holding exactly `keys`, scoped to ac_co --
                mirrors scripts/test_stock_export_excel.py's own helper."""
                users = requests.get(f"{api}/users", headers=h, timeout=30).json()
                for u in users if isinstance(users, list) else []:
                    if u["username"] == username:
                        requests.delete(f"{api}/users/{u['id']}", headers=h, timeout=30)
                roles = requests.get(f"{api}/roles", headers=h, timeout=30).json()
                for ro in roles if isinstance(roles, list) else []:
                    if ro["name"] == role_name:
                        requests.delete(f"{api}/roles/{ro['id']}", headers=h, timeout=30)

                rr = requests.post(f"{api}/roles", headers=h, timeout=30, json={
                    "name": role_name, "description": "actual-cost permission probe (test)",
                    "permissionKeys": keys,
                })
                assert rr.status_code in (200, 201), f"create role {role_name}: {rr.status_code} {rr.text[:200]}"
                role_id = rr.json()["id"]
                ac_made_roles.append(role_id)

                ur = requests.post(f"{api}/users", headers=h, timeout=30, json={
                    "username": username, "password": "test1234", "fullName": username,
                    "role": role_name, "roleIds": [role_id], "companyIds": [ac_co],
                })
                assert ur.status_code in (200, 201), f"create user {username}: {ur.status_code} {ur.text[:200]}"
                ac_made_users.append(ur.json()["id"])
                return login(base, username, "test1234")

            full_token = provision(f"gdcost_ac_full_{tag}", f"GDCost ActualCost Full {tag}",
                ["stock.dashboard.view", "stock.dashboard.export", "stock.movements.view",
                 "stock.actualcost.view"])
            none_token = provision(f"gdcost_ac_none_{tag}", f"GDCost ActualCost None {tag}",
                ["stock.dashboard.view", "stock.dashboard.export", "stock.movements.view"])
            hf = {"Authorization": f"Bearer {full_token}"}
            hn = {"Authorization": f"Bearer {none_token}"}

            # ---- on-hand grid + Excel export (checked BEFORE any movement,
            # so the actual-cost pool has not yet depleted and the opening
            # cost is exactly what was just set) -----------------------------
            grid_full = requests.get(f"{api}/stock/company/{ac_co}/onhand", headers=hf, timeout=30).json()
            row_full = next((x for x in grid_full if x.get("itemTypeId") == ac_item), None)
            check("17: WITH the permission, the grid shows the real actual cost",
                  row_full is not None and close(row_full.get("actualCostExcludingTax"), 80000),
                  f"row={row_full}")
            check("17: WITH the permission, opening actual cost and margin are real numbers",
                  row_full is not None and row_full.get("openingActualCostExcludingTax") is not None
                  and row_full.get("margin") is not None,
                  f"row={row_full}")

            grid_none = requests.get(f"{api}/stock/company/{ac_co}/onhand", headers=hn, timeout=30).json()
            row_none = next((x for x in grid_none if x.get("itemTypeId") == ac_item), None)
            check("17: WITHOUT the permission, actualCostExcludingTax is null (not zero -- "
                  "zero already means 'no cost imported', so redaction must not overload it)",
                  row_none is not None and row_none.get("actualCostExcludingTax") is None,
                  f"row={row_none}")
            check("17: WITHOUT the permission, openingActualCostExcludingTax is null",
                  row_none is not None and row_none.get("openingActualCostExcludingTax") is None,
                  f"row={row_none}")
            check("17: WITHOUT the permission, actualUnitCost is null",
                  row_none is not None and row_none.get("actualUnitCost") is None,
                  f"row={row_none}")
            check("17: WITHOUT the permission, margin and marginPercent are null -- never a "
                  "misleading 100% margin from a redacted-to-zero cost",
                  row_none is not None and row_none.get("margin") is None
                  and row_none.get("marginPercent") is None,
                  f"row={row_none}")
            check("17: the grid itself still works without the permission (on-hand qty intact)",
                  row_none is not None and row_full is not None
                  and close(row_none.get("onHand"), row_full.get("onHand")),
                  f"none={row_none} full={row_full}")

            # Column layout mirrors scripts/test_stock_export_excel.py (must
            # match Helpers/StockExcelBuilder.cs).
            EXP_C_ITEM, EXP_FIRST_DATA_ROW = 4, 4
            EXP_C_COGS_OPEN_EXL, EXP_C_COGS_BAL_EXL = 24, 30

            def find_export_row(ws, item_name):
                for rowi in range(EXP_FIRST_DATA_ROW, ws.max_row + 1):
                    if ws.cell(rowi, EXP_C_ITEM).value == item_name:
                        return rowi
                return None

            item_name = row_full.get("itemTypeName") if row_full else None

            xf = requests.get(f"{api}/stock/company/{ac_co}/onhand/excel", headers=hf, timeout=60)
            check("17: export 200 WITH the permission", xf.status_code == 200, f"http {xf.status_code}")
            xn = requests.get(f"{api}/stock/company/{ac_co}/onhand/excel", headers=hn, timeout=60)
            check("17: export 200 WITHOUT the permission (still exports -- redacted, not refused)",
                  xn.status_code == 200, f"http {xn.status_code}")

            if xf.status_code == 200 and xn.status_code == 200 and item_name:
                wsf = openpyxl.load_workbook(io.BytesIO(xf.content)).worksheets[0]
                wsn = openpyxl.load_workbook(io.BytesIO(xn.content)).worksheets[0]
                erf, ern = find_export_row(wsf, item_name), find_export_row(wsn, item_name)
                check("17: the item's row is found in both workbooks",
                      erf is not None and ern is not None, f"erf={erf} ern={ern}")
                if erf and ern:
                    check("17: WITH the permission, the CoGS Balance-Exl cell is a REAL NUMBER "
                          "matching the actual cost",
                          isinstance(wsf.cell(erf, EXP_C_COGS_BAL_EXL).value, (int, float))
                          and close(wsf.cell(erf, EXP_C_COGS_BAL_EXL).value, 80000),
                          f"value={wsf.cell(erf, EXP_C_COGS_BAL_EXL).value!r}")
                    check("17: WITHOUT the permission, the SAME cell falls back to the client's own "
                          "FORMULA -- redacted reads as merely un-costed, never as a real landed "
                          "cost with a hole punched in it",
                          isinstance(wsn.cell(ern, EXP_C_COGS_BAL_EXL).value, str)
                          and wsn.cell(ern, EXP_C_COGS_BAL_EXL).value.startswith("="),
                          f"value={wsn.cell(ern, EXP_C_COGS_BAL_EXL).value!r}")
                    check("17: WITHOUT the permission, the CoGS Opening-Exl cell is also a formula",
                          isinstance(wsn.cell(ern, EXP_C_COGS_OPEN_EXL).value, str)
                          and wsn.cell(ern, EXP_C_COGS_OPEN_EXL).value.startswith("="),
                          f"value={wsn.cell(ern, EXP_C_COGS_OPEN_EXL).value!r}")

            # ---- Movements drill-down (a movement is recorded now, AFTER the
            # grid/export checks above, so those checks stay exact) ----------
            adj = requests.post(f"{api}/stock/adjust", headers=h, timeout=30, json={
                "companyId": ac_co, "itemTypeId": ac_item, "mode": "delta", "delta": -5,
            })
            check("17: a stock movement is recorded for the drill-down to redact",
                  adj.ok, f"http {adj.status_code}: {adj.text[:200]}")

            mv_full = requests.get(f"{api}/stock/company/{ac_co}/movements",
                                    headers=hf, params={"itemTypeId": ac_item}, timeout=30)
            mvf_items = (mv_full.json() or {}).get("items", []) if mv_full.ok else []
            check("17: WITH the permission, movement rows carry a real actualUnitCost",
                  len(mvf_items) > 0 and all(m.get("actualUnitCost") is not None for m in mvf_items),
                  f"items={mvf_items}")

            mv_none = requests.get(f"{api}/stock/company/{ac_co}/movements",
                                    headers=hn, params={"itemTypeId": ac_item}, timeout=30)
            mvn_items = (mv_none.json() or {}).get("items", []) if mv_none.ok else []
            check("17: WITHOUT the permission, movement actualUnitCost is null",
                  len(mvn_items) > 0 and all(m.get("actualUnitCost") is None for m in mvn_items),
                  f"items={mvn_items}")
            check("17: WITHOUT the permission, movement runningActualValue is null",
                  len(mvn_items) > 0 and all(m.get("runningActualValue") is None for m in mvn_items),
                  f"items={mvn_items}")
            check("17: the movements list itself still works without the permission (same row count)",
                  len(mvn_items) == len(mvf_items) and len(mvf_items) > 0,
                  f"none={len(mvn_items)} full={len(mvf_items)}")
        finally:
            if not args.keep:
                for uid in ac_made_users:
                    requests.delete(f"{api}/users/{uid}", headers=h, timeout=30)
                for rid in ac_made_roles:
                    requests.delete(f"{api}/roles/{rid}", headers=h, timeout=30)
                requests.delete(f"{api}/companies/{ac_co}", headers=h, timeout=300)

        # ══════════════════════════════════════════════════════════════════
        # SECTION 18 -- Backfill preview warns before overwriting an
        # already-costed balance (Finding 3, 2026-09-13 architecture review).
        # Never blocks -- a deliberate re-backfill after a correction is
        # legitimate -- only warns, and counts the warning in the summary.
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 18. Backfill overwrite warning --")

        ow_co = make_company(api, h, f"GD Costing Overwrite {tag}")
        try:
            ow_hs = "8544.4990"
            ow_item = make_item(api, h, ow_co, f"Overwrite Item {tag}", hs=ow_hs)
            r = set_opening(api, h, ow_co, ow_item, qty=50, value=100000, cost=70000)
            check("18: an opening balance already costed by an earlier import is created",
                  r.ok and close(r.json().get("actualCostExcludingTax"), 70000),
                  f"http {r.status_code}: {r.text[:200]}")

            ow_row = row_cells(BASE_COLS, f"GD-OW-{tag}", ow_hs, desc=f"Overwrite Item {tag}",
                               qty=50, assessed=42000, st=18, ast=3, it=6)

            r = gd_preview(api, h, ow_co, build_sheet(BASE_HEADINGS, [ow_row]), GD_MAPPING,
                           mode="backfill")
            bf_ow_prev = r.json() if r.ok else {}
            check("18: the backfill preview succeeds", r.ok, f"http {r.status_code}: {r.text[:200]}")
            bf_ow_lines = bf_ow_prev.get("lines", [])
            bf_ow_warning = bf_ow_lines[0].get("overwriteWarning") if bf_ow_lines else None
            check("18: Backfill emits a per-line overwrite warning naming the existing figure",
                  bf_ow_warning is not None and "70,000.00" in bf_ow_warning and "REPLACE" in bf_ow_warning,
                  f"overwriteWarning={bf_ow_warning!r}")
            check("18: the preview counts exactly one overwrite warning",
                  bf_ow_prev.get("overwriteWarningCount") == 1,
                  f"overwriteWarningCount={bf_ow_prev.get('overwriteWarningCount')}")
            check("18: the warning does NOT block commit -- a deliberate re-backfill is legitimate",
                  bf_ow_prev.get("canCommit") is True, f"canCommit={bf_ow_prev.get('canCommit')}")

            # The SAME balance under New Arrivals carries no such warning -- an
            # ADD is never mistaken for an overwrite.
            r = gd_preview(api, h, ow_co, build_sheet(BASE_HEADINGS, [ow_row]), GD_MAPPING,
                           mode="new-arrivals")
            na_ow_prev = r.json() if r.ok else {}
            na_ow_lines = na_ow_prev.get("lines", [])
            check("18: New Arrivals carries NO overwrite warning for the same balance",
                  r.ok and bool(na_ow_lines) and na_ow_lines[0].get("overwriteWarning") is None,
                  f"lines={na_ow_lines}")
            check("18: New Arrivals' preview counts zero overwrite warnings",
                  na_ow_prev.get("overwriteWarningCount") == 0,
                  f"overwriteWarningCount={na_ow_prev.get('overwriteWarningCount')}")

            # A balance with NO prior cost (a genuinely first-time backfill)
            # gets no warning either -- this is about REPLACING a real figure,
            # not about matching at all. Reuses "8481.9000" (already proven a
            # real tariff code earlier in this suite, Section 13's del_item) --
            # HS validation is master-first (CLAUDE.md 5b-2) and a made-up code
            # is refused, so fixtures here must be real codes, not invented ones.
            fresh_item = make_item(api, h, ow_co, f"Overwrite Fresh Item {tag}", hs="8481.9000")
            set_opening(api, h, ow_co, fresh_item, qty=10, value=20000)  # no cost
            fresh_row = row_cells(BASE_COLS, f"GD-OW-FRESH-{tag}", "8481.9000",
                                   desc=f"Overwrite Fresh Item {tag}", qty=10, assessed=8000,
                                   st=18, ast=3, it=6)
            r = gd_preview(api, h, ow_co, build_sheet(BASE_HEADINGS, [fresh_row]), GD_MAPPING,
                           mode="backfill")
            fresh_prev = r.json() if r.ok else {}
            fresh_lines = fresh_prev.get("lines", [])
            check("18: a balance with NO prior actual cost gets no overwrite warning",
                  r.ok and bool(fresh_lines) and fresh_lines[0].get("overwriteWarning") is None,
                  f"lines={fresh_lines}")
        finally:
            if not args.keep:
                requests.delete(f"{api}/companies/{ow_co}", headers=h, timeout=300)

        # ══════════════════════════════════════════════════════════════════
        # SECTION 19 -- Import Clearing subledger: settling a GD consignment
        # (Task 23). PaymentAllocation.Kind "ImportConsignment" is a fourth
        # allocation shape reusing the SAME Payment/PostingService machinery
        # every purchase-bill payment already goes through -- these checks
        # mirror the shape of Section 15/16 rather than inventing new ones.
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 19. Import Clearing subledger: settling a consignment --")

        stl_co = make_company(api, h, f"GD Costing Settlement {tag}")
        try:
            en = requests.post(f"{api}/accounting/gl/company/{stl_co}/enable", headers=h, timeout=180)
            check("19: GL can be switched on", en.ok, f"http {en.status_code}: {en.text[:200]}")

            # ---- A New Arrivals consignment that posts a real liability ----
            stl_gd = f"GD-STL-{tag}"
            stl_name = f"Settlement Item {tag}"
            stl_row = row_cells(BASE_COLS, stl_gd, "8481.1000", desc=stl_name,
                                 qty=10, assessed=100000, st=18, ast=3, it=6, gddate="20-02-2026")
            r = gd_preview(api, h, stl_co, build_sheet(BASE_HEADINGS, [stl_row]), GD_MAPPING, mode="new-arrivals")
            stl_prev = r.json() if r.ok else {}
            check("19: the settlement-target sheet previews", r.ok, f"http {r.status_code}: {r.text[:200]}")
            r = gd_commit(api, h, {
                "companyId": stl_co, "fileSha256": stl_prev.get("fileSha256"), "fileName": "stl.xlsx",
                "fileSizeBytes": stl_prev.get("fileSizeBytes"), "lines": stl_prev.get("lines", []),
                "createMissingStock": True, "mode": "new-arrivals",
            })
            stl_commit_res = r.json() if r.ok else {}
            check("19: it commits (new arrivals) and posts a journal entry",
                  r.ok and len(stl_commit_res.get("journalEntries") or []) == 1,
                  f"http {r.status_code}: {r.text[:300]}")

            stl_opening = next((o for o in get_openings(api, h, stl_co)
                                if o.get("itemTypeName", "").startswith(stl_name)), None)
            if stl_opening and stl_opening.get("itemTypeId"):
                CREATED_ITEM_TYPE_IDS.append(stl_opening["itemTypeId"])

            stl_cid = find_consignment_id(api, h, stl_co, stl_gd)
            check("19: the consignment is findable", stl_cid is not None, f"cid={stl_cid}")

            c = compute_costing(assessed=100000, st=18, ast=3, it=6)
            expected_credited = money(c["cost"] + c["salesTax"] + c["ast"] + c["incomeTax"])  # 128260.00

            detail = get_consignment(api, h, stl_cid)
            dj = detail.json() if detail.ok else {}
            check("19: Credited equals what this New Arrivals GD actually posted to Import Clearing",
                  detail.ok and close(dj.get("importClearingCredited"), float(expected_credited)),
                  f"http {detail.status_code}: importClearingCredited={dj.get('importClearingCredited')} expected={expected_credited}")
            check("19: before any settlement, Outstanding equals Credited and status is unpaid",
                  detail.ok and close(dj.get("outstanding"), float(expected_credited))
                  and dj.get("amountSettled") == 0 and dj.get("settlementStatus") == "unpaid",
                  f"detail={dj}")
            check("19: no settlements are listed yet",
                  detail.ok and dj.get("settlements") == [], f"settlements={dj.get('settlements')}")

            row19 = next((it for it in list_consignments(api, h, stl_co, page_size=50).json().get("items", [])
                          if it["id"] == stl_cid), {})
            check("19: the LIST row agrees with the detail (credited/outstanding/status)",
                  close(row19.get("importClearingCredited"), float(expected_credited))
                  and close(row19.get("outstanding"), float(expected_credited))
                  and row19.get("settlementStatus") == "unpaid",
                  f"row={row19}")

            # ---- Partial payment ----
            r = create_payment(api, h, stl_co,
                                settle_consignment_payload(stl_cid, 50000, date="2026-02-25", description="Partial settlement"))
            pay_a = r.json() if r.ok else {}
            check("19: a partial payment against the consignment is accepted", r.ok, f"http {r.status_code}: {r.text[:300]}")
            pay_a_id = pay_a.get("id")
            check("19: the saved allocation echoes the GD number as its document label",
                  r.ok and (pay_a.get("allocations") or [{}])[0].get("importConsignmentGdNumber") == stl_gd,
                  f"allocations={pay_a.get('allocations')}")

            dj = get_consignment(api, h, stl_cid).json()
            remaining = expected_credited - d(50000)  # 78260.00
            check("19: after a 50,000 partial payment, Settled=50000, Outstanding=remaining, status part-paid",
                  close(dj.get("amountSettled"), 50000) and close(dj.get("outstanding"), float(remaining))
                  and dj.get("settlementStatus") == "part-paid",
                  f"detail={dj}")
            check("19: the settlement is listed against the payment just made",
                  len(dj.get("settlements") or []) == 1 and dj["settlements"][0].get("paymentId") == pay_a_id
                  and close(dj["settlements"][0].get("amount"), 50000),
                  f"settlements={dj.get('settlements')}")

            # ---- Over-settlement is refused, and changes nothing ----
            r = create_payment(api, h, stl_co,
                                settle_consignment_payload(stl_cid, float(remaining) + 1000, date="2026-02-26"))
            over_msg = (r.json().get("error") or r.json().get("message") or "") if r.text else ""
            check("19: a payment exceeding the remaining Outstanding is refused",
                  r.status_code == 400 and "over-settle" in over_msg.lower(),
                  f"http {r.status_code}: {r.text[:300]}")
            check("19: the refusal names the GD number", stl_gd in over_msg, f"message={over_msg}")
            dj = get_consignment(api, h, stl_cid).json()
            check("19: the refused over-settlement changed nothing",
                  close(dj.get("amountSettled"), 50000), f"detail={dj}")

            # ---- Settle the exact remainder -> Settled ----
            r = create_payment(api, h, stl_co,
                                settle_consignment_payload(stl_cid, float(remaining), date="2026-02-27", description="Final settlement"))
            pay_c = r.json() if r.ok else {}
            check("19: settling the exact remainder is accepted", r.ok, f"http {r.status_code}: {r.text[:300]}")
            pay_c_id = pay_c.get("id")

            dj = get_consignment(api, h, stl_cid).json()
            check("19: fully settled -- Outstanding is 0 and status is settled",
                  close(dj.get("outstanding"), 0) and dj.get("settlementStatus") == "settled",
                  f"detail={dj}")
            check("19: two settlements are now listed", len(dj.get("settlements") or []) == 2,
                  f"settlements={dj.get('settlements')}")

            # ---- A settled consignment cannot be deleted ----
            r = delete_consignment(api, h, stl_cid)
            del_msg = (r.json().get("message") or "") if r.text else ""
            check("19: deleting a consignment settled against is refused",
                  r.status_code == 400, f"http {r.status_code}: {r.text[:300]}")
            check("19: the refusal names the settling payment(s)", "PMT-" in del_msg, f"message={del_msg}")

            # ---- Deleting the settling payment restores Outstanding ----
            r = delete_payment(api, h, pay_c_id)
            check("19: the final settlement payment can be deleted",
                  r.status_code in (200, 204), f"http {r.status_code}: {r.text[:200]}")
            dj = get_consignment(api, h, stl_cid).json()
            check("19: deleting that payment restores Outstanding to what it was right before it",
                  close(dj.get("amountSettled"), 50000) and close(dj.get("outstanding"), float(remaining))
                  and dj.get("settlementStatus") == "part-paid",
                  f"detail={dj}")

            r = delete_consignment(api, h, stl_cid)
            check("19: still refused while payment A remains settled against it",
                  r.status_code == 400, f"http {r.status_code}: {r.text[:200]}")

            r = delete_payment(api, h, pay_a_id)
            check("19: deleting the remaining settling payment succeeds",
                  r.status_code in (200, 204), f"http {r.status_code}")
            dj = get_consignment(api, h, stl_cid).json()
            check("19: with every settlement gone, it reads unpaid again at the full credited amount",
                  close(dj.get("amountSettled"), 0) and close(dj.get("outstanding"), float(expected_credited))
                  and dj.get("settlementStatus") == "unpaid",
                  f"detail={dj}")

            # ---- A Backfill consignment (no liability) cannot be settled ----
            # Reuses the SAME HS code as the New Arrivals item above -- a
            # cost-only match against the balance it already created in this
            # company -- so no new item type needs creating (a fresh
            # make_item() call would hit HS master-first validation, CLAUDE.md
            # 5b-2 -- "8481.1000" is already proven valid, right here).
            stl_bf_gd = f"GD-STL-BF-{tag}"
            stl_bf_row = row_cells(BASE_COLS, stl_bf_gd, "8481.1000", desc=stl_name,
                                    qty=10, assessed=50000, st=18, ast=3, it=6, gddate="20-02-2026")
            r = gd_preview(api, h, stl_co, build_sheet(BASE_HEADINGS, [stl_bf_row]), GD_MAPPING, mode="backfill")
            stl_bf_prev = r.json() if r.ok else {}
            check("19: the backfill sheet previews as a cost-only match against the same item",
                  r.ok and stl_bf_prev.get("lines", [{}])[0].get("disposition") == "cost-only",
                  f"http {r.status_code}: {r.text[:200]}")
            r = gd_commit(api, h, {
                "companyId": stl_co, "fileSha256": stl_bf_prev.get("fileSha256"), "fileName": "stl-bf.xlsx",
                "fileSizeBytes": stl_bf_prev.get("fileSizeBytes"), "lines": stl_bf_prev.get("lines", []),
                "mode": "backfill",
            })
            check("19: the backfill consignment (setup) commits", r.ok, f"http {r.status_code}: {r.text[:200]}")
            stl_bf_cid = find_consignment_id(api, h, stl_co, stl_bf_gd)
            bf_detail = get_consignment(api, h, stl_bf_cid).json()
            check("19: a Backfill consignment credits nothing to Import Clearing",
                  bf_detail.get("importClearingCredited") == 0, f"detail={bf_detail}")
            check("19: its settlement status is 'not-posted', not 'unpaid'",
                  bf_detail.get("settlementStatus") == "not-posted", f"detail={bf_detail}")

            r = create_payment(api, h, stl_co, settle_consignment_payload(stl_bf_cid, 100, date="2026-02-28"))
            bf_msg = (r.json().get("error") or r.json().get("message") or "") if r.text else ""
            check("19: settling a Backfill consignment is refused", r.status_code == 400,
                  f"http {r.status_code}: {r.text[:300]}")
            check("19: the refusal names the mode (backfill)", "backfill" in bf_msg.lower(), f"message={bf_msg}")

            # ---- Cross-tenant: another company cannot settle THIS company's consignment ----
            r = create_payment(api, h, company, settle_consignment_payload(stl_cid, 100, date="2026-03-01"))
            check("19: a payment from a DIFFERENT company cannot target this consignment",
                  r.status_code == 400, f"http {r.status_code}: {r.text[:300]}")

            # ---- A receipt cannot settle a consignment -- money-out only ----
            receipt_body = dict(settle_consignment_payload(stl_cid, 100, date="2026-03-01"))
            receipt_body["direction"] = "Receipt"
            r = requests.post(f"{api}/payments/receipts/company/{stl_co}", headers=h, timeout=30, json=receipt_body)
            check("19: a receipt cannot settle a GD consignment (money-out only)",
                  r.status_code == 400, f"http {r.status_code}: {r.text[:300]}")

            # ---- List: default sort surfaces what is owed; the filter narrows to it; the total ties ----
            lst = list_consignments(api, h, stl_co, page_size=50).json()
            ids_in_order = [it["id"] for it in lst.get("items", [])]
            check("19: default order puts the unpaid consignment ahead of the not-posted one",
                  stl_cid in ids_in_order and stl_bf_cid in ids_in_order
                  and ids_in_order.index(stl_cid) < ids_in_order.index(stl_bf_cid),
                  f"order={ids_in_order} stl_cid={stl_cid} stl_bf_cid={stl_bf_cid}")
            check("19: the list's totalOutstanding ties to Sum(Credited-Settled) across the company",
                  close(lst.get("totalOutstanding"), float(expected_credited)),
                  f"totalOutstanding={lst.get('totalOutstanding')} expected={expected_credited}")

            only = list_consignments(api, h, stl_co, page_size=50, only_outstanding=True).json()
            only_ids = [it["id"] for it in only.get("items", [])]
            check("19: onlyOutstanding narrows the page to the one consignment that still owes",
                  only_ids == [stl_cid], f"items={only_ids}")
        finally:
            if not args.keep:
                requests.delete(f"{api}/companies/{stl_co}", headers=h, timeout=300)

        # ══════════════════════════════════════════════════════════════════
        # SECTION 20 -- GL rebuild re-posts GD consignments (Task 24).
        # GeneralLedgerService.RebuildAsync wipes every system-posted entry
        # (SourceDocType != ManualJournal, which already included
        # ImportConsignment) and re-derives it from live documents -- but
        # before this task it never re-posted a consignment at all. Two
        # symptoms: a New Arrivals GD committed while GL was off stayed
        # permanently unposted (no rebuild ever picked it up), and a rebuild
        # on an ALREADY-posted one silently destroyed its entry without
        # recreating it (the sharper bug -- the wipe ran, the re-post did
        # not). Both are exercised here.
        # ══════════════════════════════════════════════════════════════════
        print("\n-- 20. GL rebuild re-posts GD consignments (Task 24) --")

        rb_co = make_company(api, h, f"GD Costing Rebuild {tag}")
        try:
            en = requests.post(f"{api}/accounting/gl/company/{rb_co}/enable", headers=h, timeout=180)
            check("20: GL can be switched on", en.ok, f"http {en.status_code}: {en.text[:200]}")

            # ---- (a) THE REPORTED BUG: New Arrivals committed while GL is
            #      off, then GL is enabled (which rebuilds) -- the consignment
            #      must come out posted, not stay stranded forever. A GL-off
            #      company can only be made by hand (no "disable" endpoint),
            #      same as Section 15's gl_off_co. ------------------------
            r = requests.post(f"{api}/companies", headers=h, timeout=60, json={
                "name": f"GD Costing Rebuild Off {tag}", "brandName": "GDCOST",
                "fullAddress": "1 Test Street", "phone": "021-0000000", "ntn": "1234567-8",
                "startingChallanNumber": 1, "startingInvoiceNumber": 1,
                "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
                "enableGl": False,
            })
            if r.status_code not in (200, 201):
                raise RuntimeError(f"GL-off rebuild company create failed: http {r.status_code} {r.text[:200]}")
            rb_off_co = r.json()["id"]
            try:
                rb_off_gd = f"GD-RB-OFF-{tag}"
                rb_off_name = f"Rebuild Off Item {tag}"
                off_row = row_cells(BASE_COLS, rb_off_gd, "8481.1000", desc=rb_off_name,
                                    qty=10, assessed=60000, st=18, ast=3, it=6, gddate="12-02-2026")
                r = gd_preview(api, h, rb_off_co, build_sheet(BASE_HEADINGS, [off_row]), GD_MAPPING,
                               mode="new-arrivals")
                rb_off_prev = r.json() if r.ok else {}
                r = gd_commit(api, h, {
                    "companyId": rb_off_co, "fileSha256": rb_off_prev.get("fileSha256"),
                    "fileName": "gd-rb-off.xlsx", "fileSizeBytes": rb_off_prev.get("fileSizeBytes"),
                    "lines": rb_off_prev.get("lines", []), "createMissingStock": True,
                    "mode": "new-arrivals",
                })
                rb_off_res = r.json() if r.ok else {}
                check("20a: a new-arrivals commit on a GL-off company still succeeds",
                      r.ok, f"http {r.status_code}: {r.text[:200]}")
                check("20a: ...and posts no journal entry yet, GL being off",
                      r.ok and len(rb_off_res.get("journalEntries") or []) == 0,
                      f"journalEntries={rb_off_res.get('journalEntries')}")

                rb_off_opening = next((o for o in get_openings(api, h, rb_off_co)
                                       if o.get("itemTypeName", "").startswith(rb_off_name)), None)
                if rb_off_opening and rb_off_opening.get("itemTypeId"):
                    CREATED_ITEM_TYPE_IDS.append(rb_off_opening["itemTypeId"])

                rb_off_cid = find_consignment_id(api, h, rb_off_co, rb_off_gd)
                check("20a: the consignment is findable", rb_off_cid is not None, f"cid={rb_off_cid}")
                dj = get_consignment(api, h, rb_off_cid).json()
                check("20a: before GL is enabled, ImportClearingCredited is 0 and status is not-posted",
                      dj.get("importClearingCredited") == 0 and dj.get("settlementStatus") == "not-posted",
                      f"detail={dj}")

                c_off = compute_costing(assessed=60000, st=18, ast=3, it=6)
                expected_off_credited = money(c_off["cost"] + c_off["salesTax"] + c_off["ast"] + c_off["incomeTax"])

                en_off = requests.post(f"{api}/accounting/gl/company/{rb_off_co}/enable", headers=h, timeout=180)
                check("20a: GL can be switched on for the formerly GL-off company",
                      en_off.ok, f"http {en_off.status_code}: {en_off.text[:200]}")
                check("20a: enabling reports exactly one posted consignment",
                      en_off.ok and en_off.json().get("postedConsignments") == 1,
                      f"result={en_off.json() if en_off.ok else en_off.text[:200]}")

                dj = get_consignment(api, h, rb_off_cid).json()
                check("20a: THE BUG -- ImportClearingCredited is now the real posted figure, not 0",
                      close(dj.get("importClearingCredited"), float(expected_off_credited)),
                      f"detail={dj} expected={expected_off_credited}")
                check("20a: Outstanding now equals Credited (nothing settled yet) and status is unpaid",
                      close(dj.get("outstanding"), float(expected_off_credited))
                      and dj.get("amountSettled") == 0 and dj.get("settlementStatus") == "unpaid",
                      f"detail={dj}")

                je_list = requests.get(f"{api}/journal-entries/company/{rb_off_co}/paged", headers=h,
                                       timeout=30, params={"search": rb_off_gd, "pageSize": 50})
                check("20a: exactly one journal entry now exists for this GD",
                      je_list.ok and je_list.json().get("totalCount") == 1,
                      f"http {je_list.status_code}: {je_list.text[:300]}")
            finally:
                if not args.keep:
                    requests.delete(f"{api}/companies/{rb_off_co}", headers=h, timeout=300)

            # ---- (b)/(c) Idempotent rebuild: an already-posted, part-settled
            #      consignment keeps exactly one entry and its settlement
            #      after an explicit rebuild ------------------------------
            rb_gd = f"GD-RB-{tag}"
            rb_name = f"Rebuild Item {tag}"
            rb_row = row_cells(BASE_COLS, rb_gd, "8481.1000", desc=rb_name,
                               qty=12, assessed=90000, st=18, ast=3, it=6, gddate="14-02-2026")
            r = gd_preview(api, h, rb_co, build_sheet(BASE_HEADINGS, [rb_row]), GD_MAPPING, mode="new-arrivals")
            rb_prev = r.json() if r.ok else {}
            r = gd_commit(api, h, {
                "companyId": rb_co, "fileSha256": rb_prev.get("fileSha256"), "fileName": "gd-rb.xlsx",
                "fileSizeBytes": rb_prev.get("fileSizeBytes"), "lines": rb_prev.get("lines", []),
                "createMissingStock": True, "mode": "new-arrivals",
            })
            rb_res = r.json() if r.ok else {}
            check("20b: the rebuild-target GD commits and posts one entry",
                  r.ok and len(rb_res.get("journalEntries") or []) == 1,
                  f"http {r.status_code}: {r.text[:200]}")

            rb_opening = next((o for o in get_openings(api, h, rb_co)
                               if o.get("itemTypeName", "").startswith(rb_name)), None)
            if rb_opening and rb_opening.get("itemTypeId"):
                CREATED_ITEM_TYPE_IDS.append(rb_opening["itemTypeId"])

            rb_cid = find_consignment_id(api, h, rb_co, rb_gd)
            c_rb = compute_costing(assessed=90000, st=18, ast=3, it=6)
            expected_rb_credited = money(c_rb["cost"] + c_rb["salesTax"] + c_rb["ast"] + c_rb["incomeTax"])

            r = create_payment(api, h, rb_co,
                                settle_consignment_payload(rb_cid, 40000, date="2026-02-18", description="Partial"))
            check("20c: a partial payment against the rebuild-target consignment is accepted",
                  r.ok, f"http {r.status_code}: {r.text[:300]}")

            dj_before = get_consignment(api, h, rb_cid).json()
            expected_rb_outstanding_before = expected_rb_credited - d(40000)
            check("20c: before rebuild, Settled=40000 and Outstanding reflects it",
                  close(dj_before.get("amountSettled"), 40000)
                  and close(dj_before.get("outstanding"), float(expected_rb_outstanding_before)),
                  f"detail={dj_before}")

            # ---- (d) A Backfill consignment in the SAME company, to prove
            #      the rebuild's mode filter leaves it untouched -----------
            rb_bf_gd = f"GD-RB-BF-{tag}"
            rb_bf_row = row_cells(BASE_COLS, rb_bf_gd, "8481.1000", desc=rb_name,
                                  qty=12, assessed=45000, st=18, ast=3, it=6, gddate="14-02-2026")
            r = gd_preview(api, h, rb_co, build_sheet(BASE_HEADINGS, [rb_bf_row]), GD_MAPPING, mode="backfill")
            rb_bf_prev = r.json() if r.ok else {}
            r = gd_commit(api, h, {
                "companyId": rb_co, "fileSha256": rb_bf_prev.get("fileSha256"), "fileName": "gd-rb-bf.xlsx",
                "fileSizeBytes": rb_bf_prev.get("fileSizeBytes"), "lines": rb_bf_prev.get("lines", []),
                "mode": "backfill",
            })
            check("20d: the backfill consignment (setup) commits", r.ok, f"http {r.status_code}: {r.text[:200]}")
            rb_bf_cid = find_consignment_id(api, h, rb_co, rb_bf_gd)
            check("20d: before rebuild, the backfill consignment posts nothing",
                  get_consignment(api, h, rb_bf_cid).json().get("importClearingCredited") == 0,
                  f"detail={get_consignment(api, h, rb_bf_cid).json()}")

            # ---- Now rebuild, and check everything at once ----------------
            rebuild_res = requests.post(f"{api}/accounting/gl/company/{rb_co}/rebuild", headers=h, timeout=180)
            check("20: rebuild succeeds", rebuild_res.ok, f"http {rebuild_res.status_code}: {rebuild_res.text[:200]}")
            rb_result = rebuild_res.json() if rebuild_res.ok else {}
            check("20e: PostedConsignments counts the New Arrivals GD but not the Backfill one (== 1)",
                  rb_result.get("postedConsignments") == 1, f"result={rb_result}")

            je_list = requests.get(f"{api}/journal-entries/company/{rb_co}/paged", headers=h,
                                   timeout=30, params={"search": rb_gd, "pageSize": 50})
            check("20b: after rebuild, exactly ONE journal entry exists for the GD (not duplicated)",
                  je_list.ok and je_list.json().get("totalCount") == 1,
                  f"http {je_list.status_code}: {je_list.text[:300]}")

            dj_after = get_consignment(api, h, rb_cid).json()
            check("20b: ImportClearingCredited is unchanged by the rebuild",
                  close(dj_after.get("importClearingCredited"), float(expected_rb_credited)),
                  f"detail={dj_after} expected={expected_rb_credited}")
            check("20c: AmountSettled is NOT reset by the rebuild -- still 40000",
                  close(dj_after.get("amountSettled"), 40000), f"detail={dj_after}")
            check("20c: Outstanding after rebuild is unchanged from before it",
                  close(dj_after.get("outstanding"), float(expected_rb_outstanding_before)),
                  f"detail={dj_after} before={expected_rb_outstanding_before}")
            check("20c: settlementStatus is still part-paid, not reset to unpaid",
                  dj_after.get("settlementStatus") == "part-paid", f"detail={dj_after}")

            dj_bf_after = get_consignment(api, h, rb_bf_cid).json()
            check("20d: the Backfill consignment is STILL not posted after the rebuild",
                  dj_bf_after.get("importClearingCredited") == 0
                  and dj_bf_after.get("settlementStatus") == "not-posted",
                  f"detail={dj_bf_after}")
        finally:
            if not args.keep:
                requests.delete(f"{api}/companies/{rb_co}", headers=h, timeout=300)

        # ══════════════════════════════════════════════════════════════════
        # SECTION 21 -- The cost audit trail
        # ══════════════════════════════════════════════════════════════════
        # The actual-cost pool is SET, not accumulated: Backfill overwrites it,
        # New Arrivals adds to it, a hand edit replaces it. Until this table
        # there was no record of what a figure had been, so "the margin looks
        # wrong" could only be answered by re-deriving it from the sheets --
        # which is what the person asking no longer trusts.
        print("\n-- 21. Cost audit trail --")

        audit_co = make_company(api, h, f"GD Costing Audit {tag}")
        created_companies.append(audit_co)
        requests.post(f"{api}/accounts/company/{audit_co}/seed-wholesale", headers=h, timeout=120)

        aud_item = make_item(api, h, audit_co, f"GD Audit Item {tag}", hs="8481.1000")

        r = cost_changes(api, h, audit_co)
        check("21: a company with no history reads an empty cost log",
              r.ok and (r.json() or {}).get("totalCount") == 0,
              f"http {r.status_code}: {r.text[:200]}")

        set_opening(api, h, audit_co, aud_item, qty=100, value=250000)
        rows = cost_rows(api, h, audit_co, aud_item)
        check("21: creating an opening balance is recorded", len(rows) == 1, f"rows={len(rows)}")
        first = rows[0] if rows else {}
        check("21: it records the source screen",
              first.get("source") == "OpeningBalanceEdit" and first.get("sourceRef") == "Created",
              f"source={first.get('source')} ref={first.get('sourceRef')}")
        check("21: a first entry reads as 0 -> the figures entered, not a jump from nowhere",
              close(first.get("oldQuantity"), 0) and close(first.get("oldValueExcludingTax"), 0)
              and close(first.get("newQuantity"), 100) and close(first.get("newValueExcludingTax"), 250000),
              f"row={first}")
        check("21: it names who made the change",
              bool(first.get("changedByUserName")), f"user={first.get('changedByUserName')!r}")

        set_opening(api, h, audit_co, aud_item, qty=100, value=250000, cost=180000)
        rows = cost_rows(api, h, audit_co, aud_item)
        check("21: editing the actual cost is recorded", len(rows) == 2, f"rows={len(rows)}")
        check("21: newest first",
              rows and close(rows[0].get("newActualCostExcludingTax"), 180000)
              and close(rows[0].get("oldActualCostExcludingTax"), 0),
              f"row={rows[0] if rows else None}")
        check("21: the delta is derived, never stored twice",
              rows and close(rows[0].get("actualCostDelta"), 180000)
              and close(rows[0].get("quantityDelta"), 0),
              f"row={rows[0] if rows else None}")

        # The one check that proves the no-op guard does anything.
        set_opening(api, h, audit_co, aud_item, qty=100, value=250000, cost=180000)
        check("21: re-saving the identical figures records NOTHING",
              len(cost_rows(api, h, audit_co, aud_item)) == 2,
              f"rows={len(cost_rows(api, h, audit_co, aud_item))}")

        # A Backfill import overwrites the cost -- the case with no other record.
        aud_gd = f"GD-AUD-{tag}"
        aud_cells = row_cells(BASE_COLS, aud_gd, "8481.1000", desc=f"GD Audit Item {tag}",
                              qty=100, assessed=90000, st=18, ast=3, it=6)
        r = gd_preview(api, h, audit_co, build_sheet(BASE_HEADINGS, [aud_cells]), GD_MAPPING,
                       mode="backfill")
        aud_prev = r.json() if r.ok else {}
        r = gd_commit(api, h, {
            "companyId": audit_co, "fileSha256": aud_prev.get("fileSha256"),
            "fileName": "gd-audit.xlsx", "fileSizeBytes": aud_prev.get("fileSizeBytes"),
            "lines": aud_prev.get("lines", []), "mode": "backfill",
        })
        check("21: the backfill import commits", r.ok, f"http {r.status_code}: {r.text[:200]}")
        aud_cost = compute_costing(assessed=90000, st=18, ast=3, it=6)["cost"]

        rows = cost_rows(api, h, audit_co, aud_item)
        check("21: the import that overwrote the cost is recorded", len(rows) == 3, f"rows={len(rows)}")
        imp = rows[0] if rows else {}
        check("21: it is attributed to the GD, not to a screen",
              imp.get("source") == "GdCostingImport" and imp.get("sourceRef") == aud_gd,
              f"source={imp.get('source')} ref={imp.get('sourceRef')}")
        check("21: it keeps the cost the import overwrote",
              close(imp.get("oldActualCostExcludingTax"), 180000)
              and close(imp.get("newActualCostExcludingTax"), float(aud_cost)),
              f"row={imp} expected new={aud_cost}")
        check("21: it points back at the consignment",
              imp.get("importConsignmentId") == find_consignment_id(api, h, audit_co, aud_gd),
              f"row={imp}")
        check("21: the note says which mode and what it did",
              "Backfill" in (imp.get("note") or ""), f"note={imp.get('note')!r}")

        # A hand adjustment is a cost change too.
        r = requests.post(f"{api}/stock/adjust", headers=h, timeout=60, json={
            "companyId": audit_co, "itemTypeId": aud_item, "mode": "set",
            "targetActualCostExcludingTax": 111111, "movementDate": "2026-08-01",
            "notes": "counted the landed cost again",
        })
        check("21: the adjustment is accepted", r.ok, f"http {r.status_code}: {r.text[:200]}")
        rows = cost_rows(api, h, audit_co, aud_item)
        check("21: a stock adjustment is recorded too", len(rows) == 4, f"rows={len(rows)}")
        adj = rows[0] if rows else {}
        check("21: it records the position the walk actually reached, not a prediction",
              adj.get("source") == "StockAdjustment"
              and close(adj.get("newActualCostExcludingTax"), 111111),
              f"row={adj}")
        check("21: the operator's own note is carried into the history",
              "counted the landed cost again" in (adj.get("note") or ""), f"note={adj.get('note')!r}")

        # A second item, to prove the filter narrows rather than decorates.
        aud_item2 = make_item(api, h, audit_co, f"GD Audit Item Two {tag}", hs="8484.1029")
        set_opening(api, h, audit_co, aud_item2, qty=5, value=500)
        check("21: the company-wide log holds both items",
              len(cost_rows(api, h, audit_co)) == 5, f"rows={len(cost_rows(api, h, audit_co))}")
        check("21: filtering by item narrows to that item",
              len(cost_rows(api, h, audit_co, aud_item2)) == 1,
              f"rows={len(cost_rows(api, h, audit_co, aud_item2))}")

        # Gate: these rows ARE landed cost and margin, so they sit behind the
        # same key that redacts the grid's cost columns (b1cb30d).
        ptag = uuid.uuid4().hex[:6]
        r = requests.post(f"{api}/roles", headers=h, timeout=30, json={
            "name": f"GDCost NoActual {ptag}", "description": "no stock.actualcost.view"})
        nocost_role = r.json() if r.ok else {}
        nocost_role_id = nocost_role.get("id")
        if nocost_role_id:
            requests.put(f"{api}/roles/{nocost_role_id}/permissions", headers=h, timeout=30,
                        json={"permissionKeys": ["stock.dashboard.view", "stock.opening.manage"]})
            r = requests.post(f"{api}/users", headers=h, timeout=30, json={
                "username": f"gdnocost_{ptag}", "password": "test1234",
                "fullName": "No Actual Cost", "role": "User"})
            nocost_user_id = (r.json() or {}).get("id") if r.ok else None
            if nocost_user_id:
                created_user_ids.append(nocost_user_id)
                requests.put(f"{api}/users/{nocost_user_id}/roles", headers=h, timeout=30,
                            json={"roleIds": [nocost_role_id]})
                requests.put(f"{api}/usercompanies/user/{nocost_user_id}", headers=h, timeout=30,
                            json={"companyIds": [audit_co]})
                hn = {"Authorization": f"Bearer {login(base, f'gdnocost_{ptag}', 'test1234')}"}
                r = cost_changes(api, hn, audit_co)
                check("21: a user without stock.actualcost.view is refused the cost log",
                      r.status_code == 403, f"http {r.status_code}: {r.text[:160]}")
            created_role_ids.append(nocost_role_id)

        # Cross-tenant: the restricted user can reach `company`, never mixed_co.
        r = cost_changes(api, hr, mixed_co)
        check("21: the cost log refuses a company the caller cannot reach",
              r.status_code == 403, f"http {r.status_code}: {r.text[:160]}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 22 -- Correcting ONE line of a recorded GD
        # ══════════════════════════════════════════════════════════════════
        # The alternative was deleting the whole consignment and re-importing,
        # which a SETTLED consignment cannot do at all.
        print("\n-- 22. Correcting one GD line --")

        corr_co = make_company(api, h, f"GD Costing Correct {tag}")
        created_companies.append(corr_co)
        requests.post(f"{api}/accounts/company/{corr_co}/seed-wholesale", headers=h, timeout=120)

        corr_item = make_item(api, h, corr_co, f"GD Correct Item {tag}", hs="8481.1000")
        set_opening(api, h, corr_co, corr_item, qty=200, value=500000)

        corr_gd = f"GD-COR-{tag}"
        corr_cells = row_cells(BASE_COLS, corr_gd, "8481.1000", desc=f"GD Correct Item {tag}",
                               qty=100, assessed=60000, regduty=34000, st=18, ast=3, it=6)
        r = gd_preview(api, h, corr_co, build_sheet(BASE_HEADINGS, [corr_cells]), GD_MAPPING,
                       mode="backfill")
        corr_prev = r.json() if r.ok else {}
        r = gd_commit(api, h, {
            "companyId": corr_co, "fileSha256": corr_prev.get("fileSha256"),
            "fileName": "gd-correct.xlsx", "fileSizeBytes": corr_prev.get("fileSizeBytes"),
            "lines": corr_prev.get("lines", []), "mode": "backfill",
        })
        check("22: the consignment to correct commits", r.ok, f"http {r.status_code}: {r.text[:200]}")
        corr_cid = find_consignment_id(api, h, corr_co, corr_gd)
        corr_detail = get_consignment(api, h, corr_cid).json()
        corr_line_id = (corr_detail.get("lines") or [{}])[0].get("id")

        wrong_cost = compute_costing(assessed=60000, regduty=34000, st=18, ast=3, it=6)["cost"]
        bal = opening_of(get_openings(api, h, corr_co), corr_item)
        check("22: the mistyped duty is on the books",
              close(bal.get("actualCostExcludingTax"),
                    float(money(d(wrong_cost) / d(100) * d(200)))),
              f"cost={bal.get('actualCostExcludingTax')} expected={wrong_cost}/100*200")

        # ---- Validation refuses nonsense before anything moves --------------
        r = correct_line(api, h, corr_cid, corr_line_id, line_body(qty=0, assessed=60000))
        check("22: a costed line cannot be corrected to zero quantity",
              r.status_code == 400, f"http {r.status_code}: {r.text[:160]}")
        r = correct_line(api, h, corr_cid, corr_line_id, line_body(qty=100, assessed=-1))
        check("22: a negative assessed value is refused",
              r.status_code == 400, f"http {r.status_code}: {r.text[:160]}")
        r = correct_line(api, h, corr_cid, corr_line_id, line_body(qty=100, assessed=60000, st=180))
        check("22: a rate outside 0-100 is refused",
              r.status_code == 400, f"http {r.status_code}: {r.text[:160]}")
        r = correct_line(api, h, corr_cid, 999999, line_body(qty=100, assessed=60000))
        check("22: a line id from another consignment is refused",
              r.status_code == 400, f"http {r.status_code}: {r.text[:160]}")
        bal = opening_of(get_openings(api, h, corr_co), corr_item)
        check("22: none of those refusals moved the balance",
              close(bal.get("actualCostExcludingTax"),
                    float(money(d(wrong_cost) / d(100) * d(200)))),
              f"cost={bal.get('actualCostExcludingTax')}")

        # ---- The correction itself ------------------------------------------
        r = correct_line(api, h, corr_cid, corr_line_id, line_body(
            qty=100, assessed=60000, regduty=3400, st=18, ast=3, it=6,
            reason="regulatory duty was typed as 34,000 instead of 3,400"))
        check("22: the correction is accepted", r.ok, f"http {r.status_code}: {r.text[:200]}")
        corr_res = r.json() if r.ok else {}
        right_cost = compute_costing(assessed=60000, regduty=3400, st=18, ast=3, it=6)["cost"]
        check("22: the cost is recomputed SERVER-side from the inputs",
              close(corr_res.get("newCostExcludingTax"), float(right_cost))
              and close(corr_res.get("oldCostExcludingTax"), float(wrong_cost)),
              f"result={corr_res} expected={right_cost}")
        check("22: one balance was re-derived",
              corr_res.get("balancesUpdated") == 1, f"result={corr_res}")

        bal = opening_of(get_openings(api, h, corr_co), corr_item)
        check("22: Backfill re-derives the cost from the corrected unit cost x the WHOLE balance",
              close(bal.get("actualCostExcludingTax"),
                    float(money(d(right_cost) / d(100) * d(200)))),
              f"cost={bal.get('actualCostExcludingTax')} expected={right_cost}/100*200")
        check("22: Backfill still leaves quantity and selling value alone",
              close(bal.get("quantity"), 200) and close(bal.get("valueExcludingTax"), 500000),
              f"balance={bal}")

        rows = cost_rows(api, h, corr_co, corr_item)
        corr_audit = rows[0] if rows else {}
        check("22: the correction is in the cost history",
              corr_audit.get("source") == "GdLineCorrection"
              and corr_audit.get("sourceRef") == corr_gd,
              f"row={corr_audit}")
        check("22: the operator's reason is kept with it",
              "34,000 instead of 3,400" in (corr_audit.get("note") or ""),
              f"note={corr_audit.get('note')!r}")

        cd = get_consignment(api, h, corr_cid).json()
        check("22: the consignment header total moves with its lines",
              close(cd.get("totalCostExcludingTax"), float(right_cost)),
              f"total={cd.get('totalCostExcludingTax')} expected={right_cost}")

        r = correct_line(api, hr, corr_cid, corr_line_id, line_body(qty=100, assessed=60000))
        check("22: a caller who cannot reach the company is refused the correction",
              r.status_code == 403, f"http {r.status_code}: {r.text[:160]}")

        # ---- New Arrivals: the delta path, the GL re-post, and the settled cap
        na_co = make_company(api, h, f"GD Costing CorrectNA {tag}")
        created_companies.append(na_co)
        requests.post(f"{api}/accounts/company/{na_co}/seed-wholesale", headers=h, timeout=120)
        r = requests.post(f"{api}/accounting/gl/company/{na_co}/enable", headers=h, timeout=120)
        na_gl_on = r.ok
        check("22: the ledger is enabled for the New Arrivals correction case", na_gl_on,
              f"http {r.status_code}: {r.text[:200]}")

        na_item = make_item(api, h, na_co, f"GD NA Correct Item {tag}", hs="8481.1000")
        set_opening(api, h, na_co, na_item, qty=50, value=100000, cost=60000)

        na_gd = f"GD-NAC-{tag}"
        na_cells = row_cells(BASE_COLS, na_gd, "8481.1000", desc=f"GD NA Correct Item {tag}",
                             qty=20, assessed=40000, st=18, ast=3, it=6)
        r = gd_preview(api, h, na_co, build_sheet(BASE_HEADINGS, [na_cells]), GD_MAPPING,
                       mode="new-arrivals")
        na_prev = r.json() if r.ok else {}
        r = gd_commit(api, h, {
            "companyId": na_co, "fileSha256": na_prev.get("fileSha256"),
            "fileName": "gd-na-correct.xlsx", "fileSizeBytes": na_prev.get("fileSizeBytes"),
            "lines": na_prev.get("lines", []), "mode": "new-arrivals",
        })
        check("22: the New Arrivals consignment commits", r.ok, f"http {r.status_code}: {r.text[:200]}")
        na_cid = find_consignment_id(api, h, na_co, na_gd)
        na_line_id = (get_consignment(api, h, na_cid).json().get("lines") or [{}])[0].get("id")
        na_credited_before = get_consignment(api, h, na_cid).json().get("importClearingCredited")
        check("22: it posted a liability to Import Clearing",
              (na_credited_before or 0) > 0, f"credited={na_credited_before}")

        r = correct_line(api, h, na_cid, na_line_id, line_body(qty=20, assessed=50000,
                                                               st=18, ast=3, it=6))
        check("22: the New Arrivals correction is accepted", r.ok, f"http {r.status_code}: {r.text[:200]}")
        na_res = r.json() if r.ok else {}
        na_old = compute_costing(assessed=40000, st=18, ast=3, it=6)
        na_new = compute_costing(assessed=50000, st=18, ast=3, it=6)
        bal = opening_of(get_openings(api, h, na_co), na_item)
        check("22: New Arrivals applies the DIFFERENCE to the balance, not a re-derivation",
              close(bal.get("actualCostExcludingTax"),
                    float(money(d(60000) + d(na_new["cost"])))),
              f"cost={bal.get('actualCostExcludingTax')} expected=60000+{na_new['cost']}")
        check("22: the quantity it added is unchanged when only the money moved",
              close(bal.get("quantity"), 70), f"qty={bal.get('quantity')}")
        check("22: the selling pool moves in step",
              close(bal.get("valueExcludingTax"),
                    float(money(d(100000) + d(na_new["sellingValue"])))),
              f"value={bal.get('valueExcludingTax')}")

        check("22: the journal entry was re-posted", na_res.get("journalEntryReposted") is True,
              f"result={na_res}")
        na_credited_after = get_consignment(api, h, na_cid).json().get("importClearingCredited")
        check("22: Import Clearing carries the corrected liability, not the old one",
              (na_credited_after or 0) > (na_credited_before or 0)
              and close(na_res.get("importClearingCredited"), float(na_credited_after)),
              f"before={na_credited_before} after={na_credited_after}")
        je = requests.get(f"{api}/journal-entries/company/{na_co}/paged", headers=h, timeout=30,
                          params={"search": na_gd, "pageSize": 50})
        check("22: re-posting leaves exactly ONE entry for the GD, not two",
              je.ok and je.json().get("totalCount") == 1,
              f"http {je.status_code}: {je.text[:200]}")

        # Settle it, then try to correct the liability down below what was paid.
        r = create_payment(api, h, na_co,
                           settle_consignment_payload(na_cid, float(na_credited_after)))
        check("22: the corrected GD can be settled in full", r.ok,
              f"http {r.status_code}: {r.text[:200]}")
        na_payment_id = (r.json() or {}).get("id") if r.ok else None

        r = correct_line(api, h, na_cid, na_line_id, line_body(qty=20, assessed=1000,
                                                               st=18, ast=3, it=6))
        check("22: a correction that drops the liability below what is settled is refused",
              r.status_code == 400 and "already been settled" in (r.text or ""),
              f"http {r.status_code}: {r.text[:220]}")
        after = get_consignment(api, h, na_cid).json()
        check("22: the refusal rolled the WHOLE thing back -- liability unchanged",
              close(after.get("importClearingCredited"), float(na_credited_after)),
              f"detail={after}")
        bal = opening_of(get_openings(api, h, na_co), na_item)
        check("22: and the balance is unchanged too",
              close(bal.get("actualCostExcludingTax"),
                    float(money(d(60000) + d(na_new["cost"])))),
              f"cost={bal.get('actualCostExcludingTax')}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 23 -- Settling a GD short: cash + write-off
        # ══════════════════════════════════════════════════════════════════
        # A GD's Import Clearing liability is an estimate until the clearing
        # agent's final bill arrives. Before this, the only way to close one
        # that came in under was to overstate the cash actually paid.
        print("\n-- 23. Settling a GD short (cash + write-off) --")

        wo_co = make_company(api, h, f"GD Costing WriteOff {tag}")
        created_companies.append(wo_co)
        requests.post(f"{api}/accounts/company/{wo_co}/seed-wholesale", headers=h, timeout=120)
        r = requests.post(f"{api}/accounting/gl/company/{wo_co}/enable", headers=h, timeout=120)
        check("23: the ledger is enabled", r.ok, f"http {r.status_code}: {r.text[:200]}")

        wo_item = make_item(api, h, wo_co, f"GD WriteOff Item {tag}", hs="8481.1000")
        set_opening(api, h, wo_co, wo_item, qty=10, value=20000, cost=12000)

        wo_gd = f"GD-WO-{tag}"
        wo_cells = row_cells(BASE_COLS, wo_gd, "8481.1000", desc=f"GD WriteOff Item {tag}",
                             qty=10, assessed=100000, st=18, ast=3, it=6)
        r = gd_preview(api, h, wo_co, build_sheet(BASE_HEADINGS, [wo_cells]), GD_MAPPING,
                       mode="new-arrivals")
        wo_prev = r.json() if r.ok else {}
        r = gd_commit(api, h, {
            "companyId": wo_co, "fileSha256": wo_prev.get("fileSha256"),
            "fileName": "gd-writeoff.xlsx", "fileSizeBytes": wo_prev.get("fileSizeBytes"),
            "lines": wo_prev.get("lines", []), "mode": "new-arrivals",
        })
        check("23: the consignment commits and posts", r.ok, f"http {r.status_code}: {r.text[:200]}")
        wo_cid = find_consignment_id(api, h, wo_co, wo_gd)
        wo_credited = get_consignment(api, h, wo_cid).json().get("importClearingCredited")
        check("23: it credited Import Clearing", (wo_credited or 0) > 0, f"credited={wo_credited}")

        writeback = account_by_control(api, h, wo_co, "WriteBackIncome")
        check("23: the chart carries a write-back income account to route the gap to",
              writeback is not None, "no WriteBackIncome account on the seeded chart")
        wb_id = (writeback or {}).get("id")

        # The adjustment account must belong to THIS company -- never trust a
        # body id (CLAUDE.md 1).
        foreign = account_by_control(api, h, audit_co, "WriteBackIncome")
        if foreign:
            r = create_payment(api, h, wo_co,
                               settle_with_writeoff(wo_cid, 100, 100, foreign["id"]))
            check("23: an adjustment account from another company is refused",
                  r.status_code == 400, f"http {r.status_code}: {r.text[:200]}")

        cash = float(money(d(wo_credited) - d(500)))
        r = create_payment(api, h, wo_co, settle_with_writeoff(wo_cid, cash, 500, wb_id))
        check("23: cash plus a written-back remainder is accepted", r.ok,
              f"http {r.status_code}: {r.text[:220]}")
        wo_payment = r.json() if r.ok else {}
        wo_payment_id = wo_payment.get("id")

        wo_after = get_consignment(api, h, wo_cid).json()
        check("23: AmountSettled counts cash AND the adjustment -- the GD is settled",
              close(wo_after.get("amountSettled"), float(wo_credited))
              and close(wo_after.get("outstanding"), 0),
              f"detail={wo_after}")
        check("23: and the badge says settled, not part-paid",
              wo_after.get("settlementStatus") == "settled", f"detail={wo_after}")
        check("23: the payment document itself carries only the CASH",
              close(wo_payment.get("amount"), cash), f"payment amount={wo_payment.get('amount')}")

        # The over-settle guard has to read the same sum, or a GD could be
        # settled twice -- once in cash and once as a write-off.
        r = create_payment(api, h, wo_co, settle_with_writeoff(wo_cid, 1, 1, wb_id))
        check("23: a further settlement on a fully-settled GD is refused",
              r.status_code == 400 and "over-settle" in (r.text or "").lower(),
              f"http {r.status_code}: {r.text[:220]}")

        # GL: the gap lands on the chosen account, and the bank leg is cash only.
        if wo_payment_id:
            je = requests.get(f"{api}/journal-entries/company/{wo_co}/paged", headers=h, timeout=30,
                              params={"search": "GD settlement with write-off", "pageSize": 20})
            entries = (je.json() or {}).get("items", []) if je.ok else []
            check("23: the settlement posted a journal entry", len(entries) >= 1,
                  f"http {je.status_code}: {je.text[:200]}")
            if entries:
                d1 = requests.get(f"{api}/journal-entries/{entries[0]['id']}", headers=h, timeout=30)
                lines = (d1.json() or {}).get("lines", []) if d1.ok else []
                clearing = next((l for l in lines
                                 if (l.get("accountName") or "").lower().startswith("import clearing")), None)
                wbline = next((l for l in lines if l.get("accountId") == wb_id), None)
                check("23: Import Clearing is DEBITED the full settled amount",
                      clearing is not None and close(clearing.get("debit"), float(wo_credited)),
                      f"clearing={clearing}")
                check("23: the written-back remainder is credited to the chosen account",
                      wbline is not None and close(wbline.get("credit"), 500),
                      f"writeback={wbline}")
                check("23: the entry balances",
                      close(sum(float(l.get("debit") or 0) for l in lines),
                            sum(float(l.get("credit") or 0) for l in lines)),
                      f"lines={[(l.get('accountName'), l.get('debit'), l.get('credit')) for l in lines]}")

        # ---- Editing a GD settlement through the same shared path -----------
        # PaymentsPage now routes Edit on a GD settlement to
        # SettleConsignmentDialog rather than hiding the action; the SERVER
        # path it uses is the ordinary payment update, and the over-settle
        # guard has to exclude this payment's own prior lines or an unchanged
        # re-save would read as an over-settle of its own amount.
        if wo_payment_id:
            r = requests.put(f"{api}/payments/payments/{wo_payment_id}", headers=h, timeout=30,
                             json=settle_with_writeoff(wo_cid, cash, 500, wb_id))
            check("23: re-saving a GD settlement unchanged is accepted", r.ok,
                  f"http {r.status_code}: {r.text[:220]}")
            new_cash = float(money(d(cash) - d(1000)))
            r = requests.put(f"{api}/payments/payments/{wo_payment_id}", headers=h, timeout=30,
                             json=settle_with_writeoff(wo_cid, new_cash, 500, wb_id))
            check("23: editing it down to less cash is accepted", r.ok,
                  f"http {r.status_code}: {r.text[:220]}")
            wo_after = get_consignment(api, h, wo_cid).json()
            check("23: the GD reads part-paid again, by exactly the amount removed",
                  close(wo_after.get("outstanding"), 1000)
                  and wo_after.get("settlementStatus") == "part-paid",
                  f"detail={wo_after}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 24 -- ControlType 19 is FurtherTaxPayable alone
        # ══════════════════════════════════════════════════════════════════
        # FurtherTaxPayable and the superseded CustomerAdvances were declared
        # as the SAME enum value, so on a chart carrying the legacy account
        # PostingService could credit further tax (owed to FBR) to a customer
        # advances liability -- balanced books, wrong balance sheet -- and
        # FurtherTaxAccountSeeder read that row as proof the company already
        # had a further-tax account and skipped it.
        print("\n-- 24. Control accounts for import and further tax --")

        flat = requests.get(f"{api}/accounts/company/{wo_co}/flat", headers=h, timeout=30)
        accts = flat.json() if flat.ok else []
        by_ct = {}
        for a in accts:
            by_ct.setdefault(a.get("controlType"), []).append(a)

        check("24: a seeded chart has exactly one Further Tax Payable account",
              len(by_ct.get("FurtherTaxPayable", [])) == 1,
              f"rows={[a.get('name') for a in by_ct.get('FurtherTaxPayable', [])]}")
        check("24: no account is stamped with the superseded CustomerAdvances role",
              len(by_ct.get("CustomerAdvances", [])) == 0,
              f"rows={[a.get('name') for a in by_ct.get('CustomerAdvances', [])]}")
        check("24: Further Tax Payable is not the advances account wearing its number",
              all("advance" not in (a.get("name") or "").lower()
                  for a in by_ct.get("FurtherTaxPayable", [])),
              f"rows={[a.get('name') for a in by_ct.get('FurtherTaxPayable', [])]}")
        for role, label in (("ImportClearing", "Import Clearing"),
                            ("AdvanceIncomeTaxOnImports", "Advance Income Tax on Imports")):
            check(f"24: the chart carries a {label} control account",
                  len(by_ct.get(role, [])) == 1,
                  f"rows={[a.get('name') for a in by_ct.get(role, [])]}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 25 -- Deleting a company takes its cost history with it
        # ══════════════════════════════════════════════════════════════════
        # StockCostChange.CompanyId is Restrict, like the balance it records,
        # so CompanyService.DeleteAsync has to clear the rows explicitly. The
        # same trap CompanyItemTypeSettings and DeliveryItems.InvoiceItemId
        # have each sprung once -- a 500 on the delete, found by a customer.
        print("\n-- 25. Company delete clears the cost history --")

        hist_co = make_company(api, h, f"GD Costing HistTrap {tag}")
        hist_item = make_item(api, h, hist_co, f"GD Hist Item {tag}", hs="8481.1000")
        set_opening(api, h, hist_co, hist_item, qty=10, value=1000, cost=800)
        check("25: the throwaway company has cost history to block the delete",
              len(cost_rows(api, h, hist_co)) >= 1, f"rows={len(cost_rows(api, h, hist_co))}")
        r = requests.delete(f"{api}/companies/{hist_co}", headers=h, timeout=300)
        check("25: deleting a company with cost history succeeds",
              r.status_code in (200, 204), f"http {r.status_code}: {r.text[:200]}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 26 -- Warning before a Backfill writes a cost that does not fit
        # ══════════════════════════════════════════════════════════════════
        # Backfill spreads one GD's unit cost across a balance's WHOLE quantity.
        # Sound while the priced goods represent the goods on the books; on the
        # first real production import it was not: one balance merged four
        # products under one HS code, the GDs priced two of them, and the higher
        # rate was extrapolated over all 2,970 units -- a -85% margin.
        print("\n-- 26. Cost-plausibility and rate warnings --")

        warn_co = make_company(api, h, f"GD Costing Warn {tag}")
        created_companies.append(warn_co)

        # (a) The production shape: a balance far bigger than the GD prices,
        #     at a unit value far below the GD's.
        warn_item = make_item(api, h, warn_co, f"GD Warn Merged {tag}", hs="8513.1090")
        # 2,970 units selling for 999,924.33 -> expected cost 857,078 at 18/3.
        set_opening(api, h, warn_co, warn_item, qty=2970, value=999924.33, rate=18)
        bad_cells = row_cells(BASE_COLS, f"GD-WARN-{tag}", "8513.1090",
                              desc=f"GD Warn Merged {tag}", qty=565, assessed=351989,
                              st=18, ast=3, it=6)
        r = gd_preview(api, h, warn_co, build_sheet(BASE_HEADINGS, [bad_cells]), GD_MAPPING,
                       mode="backfill")
        wp = r.json() if r.ok else {}
        check("26: the sheet previews", r.ok, f"http {r.status_code}: {r.text[:200]}")
        wline = (wp.get("lines") or [{}])[0]
        check("26: extrapolating 565 units' cost over 2,970 is flagged",
              bool(wline.get("costPlausibilityWarning")),
              f"warning={wline.get('costPlausibilityWarning')!r} derived={wline.get('derivedActualCost')}")
        check("26: the warning names the projected figure and why",
              "1,850,278" in (wline.get("costPlausibilityWarning") or "")
              and "565" in (wline.get("costPlausibilityWarning") or ""),
              f"warning={wline.get('costPlausibilityWarning')!r}")
        check("26: and it is counted on the preview",
              wp.get("costPlausibilityWarningCount") == 1,
              f"count={wp.get('costPlausibilityWarningCount')}")
        check("26: it does NOT block the import -- a genuine outlier must still commit",
              wp.get("canCommit") is True, f"canCommit={wp.get('canCommit')} errors={wp.get('blockingErrors')}")

        # (b) An ordinary, representative line must stay silent, or the warning
        #     becomes noise and gets ignored -- the only way this check fails.
        ok_item = make_item(api, h, warn_co, f"GD Warn Normal {tag}", hs="8481.1000")
        ok_cost = compute_costing(assessed=60000, st=18, ast=3, it=6)
        set_opening(api, h, warn_co, ok_item, qty=100,
                    value=float(ok_cost["sellingValue"]), rate=18)
        ok_cells = row_cells(BASE_COLS, f"GD-OK-{tag}", "8481.1000",
                             desc=f"GD Warn Normal {tag}", qty=100, assessed=60000,
                             st=18, ast=3, it=6)
        r = gd_preview(api, h, warn_co, build_sheet(BASE_HEADINGS, [ok_cells]), GD_MAPPING,
                       mode="backfill")
        okp = r.json() if r.ok else {}
        okline = (okp.get("lines") or [{}])[0]
        check("26: a representative line is NOT flagged",
              okline.get("costPlausibilityWarning") is None
              and okp.get("costPlausibilityWarningCount") == 0,
              f"warning={okline.get('costPlausibilityWarning')!r}")

        # (c) New Arrivals ADDS for the quantity it brings, so there is no
        #     extrapolation to be wrong about.
        r = gd_preview(api, h, warn_co, build_sheet(BASE_HEADINGS, [bad_cells]), GD_MAPPING,
                       mode="new-arrivals")
        nap = r.json() if r.ok else {}
        check("26: New Arrivals never raises it -- it does not extrapolate",
              nap.get("costPlausibilityWarningCount") == 0,
              f"count={nap.get('costPlausibilityWarningCount')}")

        # (d) A rate no GD carries. Two lines of a real AY sheet held 100%.
        rate_cells = row_cells(BASE_COLS, f"GD-RATE-{tag}", "8481.1000",
                               desc=f"GD Warn Normal {tag}", qty=10, assessed=5000,
                               st=18, ast=3, it=1)   # a bare 1 reads as 100%
        r = gd_preview(api, h, warn_co, build_sheet(BASE_HEADINGS, [rate_cells]), GD_MAPPING,
                       mode="backfill")
        rp = r.json() if r.ok else {}
        rline = (rp.get("lines") or [{}])[0]
        check("26: an income-tax rate of 1 reads as 100% and is flagged",
              close(rline.get("incomeTaxRate"), 100) and bool(rline.get("rateWarning")),
              f"rate={rline.get('incomeTaxRate')} warning={rline.get('rateWarning')!r}")
        check("26: the rate warning is counted", rp.get("rateWarningCount") == 1,
              f"count={rp.get('rateWarningCount')}")
        check("26: and it says cost/selling are unaffected",
              "Cost and selling value are unaffected" in (rline.get("rateWarning") or ""),
              f"warning={rline.get('rateWarning')!r}")
        check("26: an ordinary 6% rate raises nothing",
              okline.get("rateWarning") is None, f"warning={okline.get('rateWarning')!r}")

        # ══════════════════════════════════════════════════════════════════
        # SECTION 27 -- Hand entry takes a whole GD, not one line
        # ══════════════════════════════════════════════════════════════════
        # A real GD carries several HS codes (Alpha's one declaration has 26
        # lines). One line at a time could only record the rare single-line
        # consignment: committing line 1 then line 2 under the same GD number
        # is refused, because GdNumber is unique per company.
        print("\n-- 27. Multi-line hand entry --")

        man_co = make_company(api, h, f"GD Costing Manual {tag}")
        created_companies.append(man_co)
        man_a = make_item(api, h, man_co, f"GD Manual A {tag}", hs="8481.1000")
        man_b = make_item(api, h, man_co, f"GD Manual B {tag}", hs="8484.1029")
        set_opening(api, h, man_co, man_a, qty=100, value=250000)
        set_opening(api, h, man_co, man_b, qty=50, value=90000)

        man_gd = f"GD-MAN-{tag}"
        lines = [
            manual_line(man_gd, "8481.1000", f"GD Manual A {tag}", qty=100, assessed=60000),
            manual_line(man_gd, "8484.1029", f"GD Manual B {tag}", qty=50, assessed=30000),
        ]

        r = gd_preview_manual(api, h, man_co, [], mode="backfill")
        check("27: previewing with no lines is refused", r.status_code == 400,
              f"http {r.status_code}: {r.text[:160]}")

        r = gd_preview_manual(api, h, man_co, lines, mode="backfill")
        mp = r.json() if r.ok else {}
        check("27: one GD with two HS codes previews in a single call", r.ok,
              f"http {r.status_code}: {r.text[:220]}")
        check("27: both lines come back", len(mp.get("lines", [])) == 2,
              f"lines={len(mp.get('lines', []))}")
        check("27: they group into ONE consignment, not two",
              len(mp.get("consignments", [])) == 1,
              f"consignments={[c.get('gdNumber') for c in mp.get('consignments', [])]}")
        check("27: each line matched its own item",
              sorted(l.get("itemTypeId") for l in mp.get("lines", [])) == sorted([man_a, man_b]),
              f"matched={[(l.get('hsCode'), l.get('itemTypeId')) for l in mp.get('lines', [])]}")

        r = gd_commit(api, h, {
            "companyId": man_co, "fileSha256": mp.get("fileSha256"),
            "fileName": mp.get("fileName"), "fileSizeBytes": mp.get("fileSizeBytes"),
            "lines": mp.get("lines", []), "mode": "backfill",
        })
        mres = r.json() if r.ok else {}
        check("27: it commits as one consignment carrying two lines",
              r.ok and mres.get("consignmentsWritten") == 1 and mres.get("linesWritten") == 2,
              f"http {r.status_code}: {r.text[:220]}")

        man_cid = find_consignment_id(api, h, man_co, man_gd)
        detail = get_consignment(api, h, man_cid).json()
        check("27: and the recorded consignment really holds both HS codes",
              sorted((l.get("hsCode") or "") for l in detail.get("lines", []))
              == ["8481.1000", "8484.1029"],
              f"lines={[l.get('hsCode') for l in detail.get('lines', [])]}")

        # Two lines landing on the SAME balance must pool into one unit cost --
        # the property a line-at-a-time preview cannot have, and the exact
        # arithmetic behind the production mispricing.
        pool_co = make_company(api, h, f"GD Costing Pool {tag}")
        created_companies.append(pool_co)
        pool_item = make_item(api, h, pool_co, f"GD Pool Item {tag}", hs="8481.1000")
        set_opening(api, h, pool_co, pool_item, qty=200, value=500000)
        pool_gd = f"GD-POOL-{tag}"
        pool_lines = [
            manual_line(pool_gd, "8481.1000", f"GD Pool Item {tag}", qty=60, assessed=30000),
            manual_line(pool_gd, "8481.1000", f"GD Pool Item {tag}", qty=40, assessed=50000),
        ]
        r = gd_preview_manual(api, h, pool_co, pool_lines, mode="backfill")
        pp = r.json() if r.ok else {}
        check("27: two lines on one item preview together", r.ok and len(pp.get("lines", [])) == 2,
              f"http {r.status_code}: {r.text[:200]}")
        # pooled unit cost = (30,000 + 50,000) / (60 + 40) = 800; x 200 = 160,000
        derived = {l.get("derivedActualCost") for l in pp.get("lines", [])}
        check("27: they POOL into one unit cost applied to the whole balance",
              derived == {160000.0},
              f"derived={derived} (expected 160000 = (30000+50000)/(60+40) x 200)")
        check("27: and both lines report the SAME balance figure, not their own",
              len(derived) == 1, f"derived={derived}")

        # Re-submitting the identical set collides, exactly as a re-uploaded
        # workbook does; changing any line makes a different consignment.
        r = gd_preview_manual(api, h, man_co, lines, mode="backfill")
        again = r.json() if r.ok else {}
        check("27: re-submitting the same lines is caught as already imported",
              r.ok and not again.get("canCommit") and len(again.get("blockingErrors", [])) > 0,
              f"canCommit={again.get('canCommit')} errors={again.get('blockingErrors')}")
        check("27: the fingerprint spans the whole set, so an edited line differs",
              gd_preview_manual(api, h, man_co,
                                [lines[0], dict(lines[1], assessedValue=31000)],
                                mode="backfill").json().get("fileSha256") != mp.get("fileSha256"),
              "an edited second line produced the same fingerprint")

        r = gd_preview_manual(api, hr, mixed_co, lines, mode="backfill")
        check("27: hand entry refuses a company the caller cannot reach",
              r.status_code == 403, f"http {r.status_code}: {r.text[:160]}")

    finally:
        if not args.keep:
            if restricted_user_id:
                requests.delete(f"{api}/users/{restricted_user_id}", headers=h, timeout=30)
            for uid in created_user_ids:
                requests.delete(f"{api}/users/{uid}", headers=h, timeout=30)
            for rid in created_role_ids:
                requests.delete(f"{api}/roles/{rid}", headers=h, timeout=30)
            for cid in [company, mixed_co, other_co, del_co, twomonth_co] + created_companies:
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
