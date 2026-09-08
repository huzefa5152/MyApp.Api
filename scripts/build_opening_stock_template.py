"""Regenerates the opening-stock template handed to a new client.

    python scripts/build_opening_stock_template.py

Writes myapp-frontend/public/templates/opening-stock-template.xlsx. After
changing any HEADING here, re-upload the file through Spreadsheet Import and
copy the reported signature into DefaultImportLayouts.StockSignature /
StockTokens -- otherwise the template stops recognising its own layout, and the
suite case "the shipped template recognises itself" fails.

Deliberately built from the two real sheets: same bands, same headings, same
column positions, so the shipped layout reads it with no mapping. Two example
rows use REAL tariff lines, because validation is master-first and an invented
code is refused.
"""
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

import os as _os
OUT = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                    "myapp-frontend", "public", "templates", "opening-stock-template.xlsx")

HEAD = [
    ("A", "Claim Month", 14), ("B", "GD Number", 18), ("C", "GD Date", 12),
    ("D", "4 Digit Hs Code", 15), ("E", "8 Digit Hs Code", 16),
    ("F", "Description", 38), ("G", "Sub Category", 20),
    ("H", "Price", 14), ("I", "Unit", 8),
    ("J", "Qty", 12), ("K", "Exl", 15), ("L", "Rate", 9), ("M", "S.Tax", 14),
    ("N", "Qty", 12), ("O", "Consumed Exl", 15), ("P", "Rate", 9), ("Q", "S.Tax", 14),
    ("R", "Bal Qty", 12), ("S", "Bal Exl", 15), ("T", "Rate", 9), ("U", "S.Tax", 14),
]

ROWS = [
    # month, gd, date, hs4, hs8, name, subcat, price, unit, openQty, openExl, rate
    ("Aug 2026", "KAPE-HC-64239", "13-04-2026", "8423", "8423.9000",
     "WEIGHT SCALE PARTS, PLASTIC", "Weight Scale", 498.777888, "Kg", 4037, 2013566.33, 0.18),
    ("Aug 2026", "KAPE-HC-64239", "13-04-2026", "9616", "9616.1000",
     "PLASTIC ATOMIZER", "Automizer", 2438.7608, "Kg", 400, 975504.32, 0.25),
    ("Aug 2026", "KAPW-HC-173918", "25-03-2026", "8482", "8482.9990",
     "ADAPTER SLEEVE", "Machines & Electronics", 765.476723, "Kg", 1253, 959142.33, 0.18),
]

BAND = PatternFill("solid", fgColor="DCE6F1")
HDR = PatternFill("solid", fgColor="1F4E79")
KEY = PatternFill("solid", fgColor="FFF2CC")
thin = Side(style="thin", color="BFBFBF")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Aug 2026"

ws["F1"] = "Opening Stock"
ws["F1"].font = Font(bold=True, size=13)
ws["W1"] = "Cost of Good Sold"
ws["W1"].font = Font(italic=True, color="808080")

# The cost-of-goods-sold block, headings only. It is not imported, but the real
# sheets carry it and the layout is recognised by its heading vocabulary — a
# template missing these words scores as a different shape from the workbooks it
# is meant to standardise.
for cell, text in (("W2", "Opening"), ("AA2", "Consumed"), ("AE2", "Balance")):
    ws[cell] = text
    ws[cell].font = Font(bold=True)
    ws[cell].fill = BAND
for col, text in (("W", "Excl"), ("X", "S.Tax"), ("Y", "Vat"),
                  ("AA", "Excl"), ("AB", "S.Tax"), ("AC", "Vat"),
                  ("AE", "Excl"), ("AF", "S.Tax"), ("AG", "Vat")):
    c = ws[f"{col}3"]
    c.value = text
    c.font = Font(bold=True, color="FFFFFF", size=10)
    c.fill = HDR
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.column_dimensions[col].width = 13

# Band labels on row 2, over the first column of each block.
for cell, text in (("J2", "Opening"), ("N2", "Consumed"), ("R2", "Balance")):
    ws[cell] = text
    ws[cell].font = Font(bold=True)
    ws[cell].fill = BAND

# The three columns the import actually reads.
DRIVES = {"R", "S", "T"}

for col, text, width in HEAD:
    c = ws[f"{col}3"]
    c.value = text
    c.font = Font(bold=True, color="FFFFFF", size=10)
    c.fill = HDR
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BOX
    ws.column_dimensions[col].width = width
ws.row_dimensions[3].height = 30

for i, r in enumerate(ROWS):
    row = 4 + i
    (month, gd, date, hs4, hs8, name, subcat, price, unit, qty, exl, rate) = r
    vals = {
        "A": month, "B": gd, "C": date, "D": hs4, "E": hs8, "F": name, "G": subcat,
        "H": price, "I": unit,
        "J": qty, "K": exl, "L": rate, "M": round(exl * rate, 2),
        "N": 0, "O": 0, "P": rate, "Q": 0,
        "R": qty, "S": exl, "T": rate, "U": round(exl * rate, 2),
    }
    for col, v in vals.items():
        c = ws[f"{col}{row}"]
        c.value = v
        c.border = BOX
        if col in ("H", "K", "M", "O", "Q", "S", "U"):
            c.number_format = "#,##0.00"
        if col in ("J", "N", "R"):
            c.number_format = "#,##0.000"
        if col in ("L", "P", "T"):
            c.number_format = "0%"
        if col in DRIVES:
            c.fill = KEY

total = 4 + len(ROWS) + 1
ws[f"I{total}"] = "TOTAL"
ws[f"I{total}"].font = Font(bold=True)
COLI = {"J": 9, "K": 10, "M": None, "R": 9, "S": 10, "U": None}
for col in ("J", "K", "M", "R", "S", "U"):
    c = ws[f"{col}{total}"]
    if col in ("J", "R"):
        c.value = sum(r[9] for r in ROWS)
    elif col in ("K", "S"):
        c.value = round(sum(r[10] for r in ROWS), 2)
    else:
        c.value = round(sum(r[10] * r[11] for r in ROWS), 2)
    c.font = Font(bold=True)
    c.number_format = "#,##0.00" if col not in ("J", "R") else "#,##0.000"

ws.freeze_panes = "A4"

# ── Instructions sheet ───────────────────────────────────────────────────────
gd = wb.create_sheet("How to fill this in")
gd.column_dimensions["A"].width = 4
gd.column_dimensions["B"].width = 104

LINES = [
    ("h", "Opening stock sheet — how to fill this in"),
    ("b", "Put the business name in cell F1 of the data sheet."),
    ("", ""),
    ("b", "One row per customs declaration (GD). Do not merge lots — the system adds them up"),
    ("b", "and keeps each declaration, so you can trace any figure back to the GD behind it."),
    ("", ""),
    ("h", "The three columns that decide your stock"),
    ("b", "R  Bal Qty   — the CLOSING quantity you are holding (not Opening)."),
    ("b", "S  Bal Exl   — what that quantity is worth, EXCLUDING sales tax."),
    ("b", "T  Rate      — the sales-tax rate on it. Type 0.18, or format the cell as 18%."),
    ("b", "These three are shaded. Everything else is either kept as history or ignored."),
    ("", ""),
    ("h", "Five rules"),
    ("b", "1. Every row needs an 8-digit HS code from the CURRENT Pakistan tariff. A retired"),
    ("b", "   code is refused — e.g. 9405.9010 and 8513.6019 no longer exist; use 9405.9110"),
    ("b", "   and 8513.1090."),
    ("b", "2. Type rates as NUMBERS. A cell typed over as the text \"18%\" is not a number."),
    ("b", "3. One row per GD. Keep the GD Number and GD Date — they are stored."),
    ("b", "4. Balance columns must be the closing position, not the opening one."),
    ("b", "5. No blank rows inside the data. A totals row at the bottom is fine."),
    ("", ""),
    ("h", "Column order"),
    ("b", "Keep this order if you can. If your sheet runs Items / Sub cat / 4 Digit Hs Code /"),
    ("b", "8 Digit Hs Code instead, that is read correctly too — those columns are found by"),
    ("b", "their heading. Columns J onward must stay where they are: Qty, Rate and S.Tax each"),
    ("b", "appear three times and only their position says which block they belong to."),
    ("", ""),
    ("h", "What happens to the rest"),
    ("b", "Products sharing one HS code become ONE stock line and their quantities add up."),
    ("b", "Every original row is still stored against it with its own name, GD, landed price"),
    ("b", "and opening/consumed figures. Sub Category, the S.Tax amounts and the cost-of-goods-"),
    ("b", "sold block are not imported — they are your working."),
]
r = 9
for kind, text in LINES:
    c = gd.cell(r, 2, text)
    if kind == "h":
        c.font = Font(bold=True, size=12, color="1F4E79")
    r += 1

import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
wb.save(OUT)
print("wrote", OUT)
