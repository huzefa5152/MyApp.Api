"""Regenerate the two downloadable sample import workbooks.

    python scripts/build_sample_import_sheets.py

Writes:
    myapp-frontend/public/templates/opening-stock-template.xlsx
    myapp-frontend/public/templates/gd-costing-template.xlsx

WHY THIS EXISTS
---------------
These files are handed to prospective clients and are served publicly out of
`wwwroot/`, so they must contain NO real business's data. The opening-stock
template shipped for a while with three rows lifted from a live client sheet --
their GD numbers, their product names, their landed costs. Everything below is
fictional, and this script is the only way the files are produced, so nobody has
to remember to sanitise by hand again.

WHAT MUST NOT CHANGE
--------------------
The opening-stock workbook's HEADING ROWS are its fingerprint: the import
identifies the layout by them (CLAUDE.md 5b-3b, "the shipped template recognises
itself"), so this script rewrites data rows only and leaves rows 1-3, the column
widths and the instruction sheet exactly as they are.

The HS codes are real, current Pakistan tariff lines -- checked against the
tariff master. They have to be: validation is master-first, so an invented code
is refused and the sample would fail the very import it demonstrates.
"""
import os
from copy import copy

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATES = os.path.join(HERE, "myapp-frontend", "public", "templates")
STOCK = os.path.join(TEMPLATES, "opening-stock-template.xlsx")
COSTING = os.path.join(TEMPLATES, "gd-costing-template.xlsx")

# -- The fictional consignments both samples describe ---------------------
# One story told twice: the costing sheet prices the goods as they clear
# customs, the opening-stock sheet is what sits on the shelf afterwards.
# Sharing the products between the two files is deliberate -- someone working
# through both sees the same goods.
#
# (name, sub category, hs code, unit, gd, gd date, qty, value excl tax, rate)
STOCK_ROWS = [
    ("Industrial Bearing 6204", "Bearings", "8482.1000", "Pcs",
     "DEMO-HC-100245", "12-03-2026", 480, 600000.00, 0.18),
    # Same HS code as the row above ON PURPOSE: the importer groups on the CODE,
    # so these two become one stock line of 800 and the preview says it merged
    # them. It is the behaviour most likely to surprise a first-time user.
    ("Industrial Bearing 6205", "Bearings", "8482.1000", "Pcs",
     "DEMO-HC-100245", "12-03-2026", 320, 473600.00, 0.18),
    ("Hydraulic Hose 1/2 inch", "Hydraulics", "4009.2200", "Mtr",
     "DEMO-HC-100245", "12-03-2026", 900, 553950.00, 0.18),
    ("Stainless Steel Bolt M10", "Fasteners", "7318.1510", "Kg",
     "DEMO-HC-100311", "04-05-2026", 1250, 465312.50, 0.18),
    ("Electrical Cable 2.5mm", "Cables", "8544.4990", "Mtr",
     "DEMO-HC-100311", "04-05-2026", 4000, 595000.00, 0.18),
    ("Safety Gloves Coated", "Safety", "6116.1000", "Pcs",
     "DEMO-HC-100311", "04-05-2026", 1500, 397500.00, 0.18),
    # A different rate, because a sheet where every row is 18% teaches nobody
    # that the rate column is read per row.
    ("Machine Oil 20W 5L", "Lubricants", "2710.1951", "Ltr",
     "DEMO-HC-100388", "21-06-2026", 600, 591000.00, 0.25),
    ("Rubber O-Ring Seal 25mm", "Seals", "4016.9390", "Pcs",
     "DEMO-HC-100388", "21-06-2026", 2500, 107000.00, 0.18),
]

FIRST_DATA_ROW = 4


def build_stock():
    wb = openpyxl.load_workbook(STOCK)
    ws = wb.worksheets[0]

    # Style every new row from the template's own first data row, so the
    # shading on the three balance columns and the number formats survive.
    proto = {c: ws.cell(FIRST_DATA_ROW, c) for c in range(1, 22)}

    for r in range(FIRST_DATA_ROW, ws.max_row + 1):
        for c in range(1, 34):
            ws.cell(r, c).value = None

    r = FIRST_DATA_ROW
    for name, sub, hs, unit, gd, gd_date, qty, excl, rate in STOCK_ROWS:
        tax = round(excl * rate, 2)
        price = round(excl / qty, 6)
        values = {
            1: "Aug 2026", 2: gd, 3: gd_date, 4: hs.split(".")[0], 5: hs,
            6: name, 7: sub, 8: price, 9: unit,
            # Opening block = what arrived.
            10: qty, 11: excl, 12: rate, 13: tax,
            # Consumed block = nothing sold yet, which is what an OPENING
            # position means.
            14: 0, 15: 0, 16: rate, 17: 0,
            # Balance block = the three columns the import actually reads.
            18: qty, 19: excl, 20: rate, 21: tax,
        }
        for c, v in values.items():
            cell = ws.cell(r, c, v)
            src = proto[c]
            cell.number_format = src.number_format
            cell.font = copy(src.font)
            cell.fill = copy(src.fill)
            cell.alignment = copy(src.alignment)
            cell.border = copy(src.border)
        # 0% would paint a 12.5% rate as 13% -- the silent-wrong-rate failure
        # CLAUDE.md 5b-9 warns about. Show what is actually in the cell.
        for c in (12, 16, 20):
            ws.cell(r, c).number_format = "0.##%"
        r += 1

    total_row = r + 1
    ws.cell(total_row, 9, "TOTAL").font = Font(bold=True)
    for col, kind in ((10, "qty"), (11, "money"), (13, "money"),
                      (18, "qty"), (19, "money"), (21, "money")):
        letter = get_column_letter(col)
        cell = ws.cell(total_row, col, "=SUM({0}{1}:{0}{2})".format(
            letter, FIRST_DATA_ROW, r - 1))
        cell.number_format = "#,##0.000" if kind == "qty" else "#,##0.00"
        cell.font = Font(bold=True)

    wb.save(STOCK)
    return len(STOCK_ROWS), total_row


# -- GD costing sample ----------------------------------------------------
# Column numbers are Helpers/ExcelImport/GdCostingLayout.MappingJson. The
# headings are that layout's own aliases spelled exactly, so the importer needs
# no mapping and reports no relocation.
COSTING_HEADINGS = {
    1: "GD Number", 2: "GD Date", 3: "Description", 4: "Qty", 5: "Unit",
    6: "HS Code", 7: "Assessed Value", 8: "C.Duty", 9: "ACD", 10: "RD",
    11: "Total Duty", 12: "S.T Rate", 13: "Sales Tax", 14: "AST Rate",
    15: "AST Amount", 16: "Others", 17: "Subtotal", 18: "Input Tax",
    19: "I.tax Rate", 20: "Income Tax", 21: "Landed Cost",
    22: "Add On Profit if Need", 23: "Selling Value",
}

# (gd, date, description, qty, unit, hs,
#  assessed, duty, acd, rd, others, st, ast, itax, addon)
COSTING_ROWS = [
    ("DEMO-HC-100245", "12-03-2026", "Industrial Bearing 6204", 480, "Pcs",
     "8482.1000", 420000.00, 42000.00, 8400.00, 0.00, 6500.00, 18, 3, 6, 0.00),
    ("DEMO-HC-100245", "12-03-2026", "Industrial Bearing 6205", 320, "Pcs",
     "8482.1000", 331500.00, 33150.00, 6630.00, 0.00, 5100.00, 18, 3, 6, 0.00),
    ("DEMO-HC-100245", "12-03-2026", "Hydraulic Hose 1/2 inch", 900, "Mtr",
     "4009.2200", 388000.00, 38800.00, 7760.00, 19400.00, 7250.00, 18, 3, 6, 0.00),
    ("DEMO-HC-100311", "04-05-2026", "Stainless Steel Bolt M10", 1250, "Kg",
     "7318.1510", 326000.00, 65200.00, 6520.00, 0.00, 4900.00, 18, 3, 6, 0.00),
    ("DEMO-HC-100311", "04-05-2026", "Electrical Cable 2.5mm", 4000, "Mtr",
     "8544.4990", 417000.00, 41700.00, 8340.00, 0.00, 8100.00, 18, 3, 6, 0.00),
    # An add-on profit, because the column exists and a sheet where it is
    # always zero never shows what it does.
    ("DEMO-HC-100311", "04-05-2026", "Safety Gloves Coated", 1500, "Pcs",
     "6116.1000", 278000.00, 27800.00, 5560.00, 0.00, 3800.00, 18, 3, 6, 25000.00),
    ("DEMO-HC-100388", "21-06-2026", "Machine Oil 20W 5L", 600, "Ltr",
     "2710.1951", 402000.00, 80400.00, 8040.00, 20100.00, 9400.00, 25, 3, 6, 0.00),
    ("DEMO-HC-100388", "21-06-2026", "Rubber O-Ring Seal 25mm", 2500, "Pcs",
     "4016.9390", 75000.00, 7500.00, 1500.00, 0.00, 2100.00, 18, 3, 6, 0.00),
]

COSTING_GUIDE = [
    "GD costing sheet - how to fill this in",
    "",
    "One row per line on the customs declaration. Repeat the GD Number on every row",
    "of the same consignment - that is what groups them.",
    "",
    "Columns you type:",
    "  A  GD Number        the declaration number. Required on every row.",
    "  B  GD Date          the declaration date.",
    "  C  Description      the goods, as you want them named in stock.",
    "  D  Qty              quantity cleared.",
    "  E  Unit             Pcs, Kg, Mtr, Ltr - whatever the goods are counted in.",
    "  F  HS Code          8 digits, from the CURRENT Pakistan tariff.",
    "  G  Assessed Value   the customs assessed value.",
    "  H  C.Duty           customs duty.",
    "  I  ACD              additional customs duty.",
    "  J  RD               regulatory duty. Leave 0 where none applies.",
    "  L  S.T Rate         sales tax rate. Type 0.18, or format the cell as 18%.",
    "  N  AST Rate         additional sales tax (value addition) rate.",
    "  P  Others           any other landed charge - freight, clearing, port.",
    "  S  I.tax Rate       income tax rate at import.",
    "  V  Add On Profit    an amount to add to the selling value. Usually 0.",
    "",
    "Columns the system works out:",
    "  Total Duty, Sales Tax, AST Amount, Subtotal, Input Tax, Income Tax and",
    "  Landed Cost are shown so the sheet reads as a costing, but they are NOT",
    "  imported - the system recomputes them from what you typed.",
    "",
    "Selling Value (column W):",
    "  Normally leave the sheet's answer alone. It is Input Tax / S.T Rate plus any",
    "  add-on profit, which is the value at which the output tax on the eventual",
    "  sale exactly absorbs the input tax paid at import.",
    "  If you TYPE a different figure, yours is kept and the preview says so. That",
    "  is the point of the column: a hand-priced line survives the import.",
    "",
    "Rules:",
    "  1. Type rates as numbers. A cell typed over as text is not a number.",
    "  2. A row with no GD Number is skipped.",
    "  3. A totals row (labelled Total, with no selling value) is skipped and",
    "     reported in the preview.",
    "  4. A row with no HS code still imports - it is just not classified.",
    "  5. Headings live on row 1 and data starts on row 3. Do not delete row 2.",
]


def money(v):
    return round(v + 0.0000001, 2)


def build_costing():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "GD Costing"

    head_fill = PatternFill("solid", fgColor="1F3864")
    head_font = Font(bold=True, color="FFFFFF", size=10)
    band_fill = PatternFill("solid", fgColor="D9E2F3")
    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for c, text in COSTING_HEADINGS.items():
        cell = ws.cell(1, c, text)
        cell.fill, cell.font, cell.border = head_fill, head_font, border
        cell.alignment = Alignment(horizontal="center", vertical="center",
                                   wrap_text=True)

    # Row 2 is the layout's band row (firstDataRow is 3). It is never read, so
    # it carries the note a human needs: which columns are typed, and which the
    # system works out.
    for c in range(1, 24):
        cell = ws.cell(2, c, None)
        cell.fill, cell.border = band_fill, border
    ws.cell(2, 1, "Type these").font = Font(bold=True, size=9, italic=True)
    ws.cell(2, 11, "Worked out for you - not imported").font = Font(
        bold=True, size=9, italic=True)

    r = 3
    for (gd, date, desc, qty, unit, hs, assessed, duty, acd, rd,
         others, st, ast, itax, addon) in COSTING_ROWS:
        # Helpers/ImportCostingCalculator is the spec; these are its formulas,
        # so the sheet a human reads agrees with what the importer computes.
        cost = money(assessed + duty + acd + rd)
        sales_tax = money(cost * st / 100)
        ast_amount = money(cost * ast / 100)
        subtotal = money(cost + sales_tax + ast_amount + others)
        income_tax = money(subtotal * itax / 100)
        input_tax = money(sales_tax + ast_amount)
        selling = money(input_tax * 100 / st) + money(addon)

        row = {
            1: gd, 2: date, 3: desc, 4: qty, 5: unit, 6: hs,
            7: assessed, 8: duty, 9: acd, 10: rd, 11: money(duty + acd + rd),
            12: st / 100, 13: sales_tax, 14: ast / 100, 15: ast_amount,
            16: others, 17: subtotal, 18: input_tax,
            19: itax / 100, 20: income_tax, 21: cost, 22: addon, 23: selling,
        }
        for c, v in row.items():
            cell = ws.cell(r, c, v)
            cell.border = border
            if c == 4:
                cell.number_format = "#,##0.###"
            elif c in (12, 14, 19):
                cell.number_format = "0.##%"
            elif isinstance(v, float):
                cell.number_format = "#,##0.00"
        r += 1

    widths = {1: 18, 2: 12, 3: 30, 4: 10, 5: 8, 6: 13, 7: 15, 8: 13, 9: 12,
              10: 12, 11: 13, 12: 10, 13: 14, 14: 10, 15: 13, 16: 12, 17: 15,
              18: 14, 19: 10, 20: 13, 21: 15, 22: 16, 23: 15}
    for c, w in widths.items():
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "A3"

    guide = wb.create_sheet("How to fill this in")
    for i, line in enumerate(COSTING_GUIDE, start=1):
        cell = guide.cell(i, 1, line)
        if line.endswith(":") and not line.startswith(" "):
            cell.font = Font(bold=True)
    guide.cell(1, 1).font = Font(bold=True, size=13)
    guide.column_dimensions["A"].width = 100

    wb.save(COSTING)
    return len(COSTING_ROWS)


if __name__ == "__main__":
    rows, total = build_stock()
    print("opening-stock-template.xlsx: {0} sample rows, total on row {1}".format(rows, total))
    n = build_costing()
    print("gd-costing-template.xlsx:    {0} sample rows".format(n))
