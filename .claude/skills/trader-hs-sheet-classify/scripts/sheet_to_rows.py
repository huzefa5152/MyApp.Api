"""Read ANY consultant's HS-code workbook into compact rows: [invoiceNo, hsCode, description, amountExclTax].

Every consultant keeps their own layout, so nothing here assumes one. Columns are found by
HEADING (fuzzy, any of the top 15 rows, any sheet that has them) unless given explicitly.
Needed: an invoice column and an HS column, plus a description and/or an amount column (used
to find the bill line each row belongs to). Prints the mapping it chose and 3 sample rows —
check them before trusting the output.

  python sheet_to_rows.py "<book.xlsx>" --out rows.json
  python sheet_to_rows.py "<book.xlsx>" --out rows.json --sheet "Sales" --inv-col B --hs-col "Tariff" \
         --desc-col D --amount-col "Value Excl"            # a letter, a 1-based number, or heading text

Invoice cell: the LAST number in it is the bill number ("INV-85" -> 85, "RNR-09-26-115" -> 115).
HS cell: digits kept and written as NNNN.NNNN ("84811000", "8481.1000:-", "8481.10.00" -> 8481.1000).
Rows with no invoice number (totals, notes) are skipped and counted.
"""
import argparse, collections, json, re, sys

import openpyxl
from openpyxl.utils import column_index_from_string

# (must contain any of, must not contain any of) — checked against the lower-cased heading.
RULES = {
    "inv": (("inv", "bill", "doc no", "document no", "voucher"), ("date", "amount", "value", "party", "excl", "incl")),
    "hs": (("hs", "tariff", "pct", "h.s"), ("description",)),
    "desc": (("desc", "item", "product", "particular", "goods"), ("code", "hs", "qty", "quantity", "rate", "amount", "value")),
    "amount": (("excl", "value", "amount", "net", "taxable"), ("incl", "gst", "g. s. t", "sales tax", "rate", "qty", "%")),
}


def norm(v):
    return re.sub(r"\s+", " ", str(v if v is not None else "")).strip().lower()


def pick(cells, key, used):
    want, avoid = RULES[key]
    for i, h in enumerate(cells):
        if i + 1 in used or not h:
            continue
        if any(w in h for w in want) and not any(a in h for a in avoid):
            return i + 1
    return None


def explicit(ws, hr, spec):
    if spec is None:
        return None
    if re.fullmatch(r"\d+", spec):
        return int(spec)
    if re.fullmatch(r"[A-Za-z]{1,3}", spec):
        return column_index_from_string(spec.upper())
    for c in range(1, ws.max_column + 1):
        if norm(ws.cell(hr, c).value) == norm(spec):
            return c
    sys.exit(f'No column headed "{spec}" on row {hr}.')


def detect(ws, a):
    for r in range(1, min(ws.max_row, 15) + 1):
        cells = [norm(ws.cell(r, c).value) for c in range(1, ws.max_column + 1)]
        cols, used = {}, set()
        for key in ("hs", "inv", "amount", "desc"):  # most specific first
            cols[key] = explicit(ws, r, getattr(a, f"{key}_col")) or pick(cells, key, used)
            if cols[key]:
                used.add(cols[key])
        if cols["inv"] and cols["hs"] and (cols["desc"] or cols["amount"]):
            return r, cols, cells
    return None


def hs_code(v):
    d = re.sub(r"\D", "", str(v if v is not None else ""))
    return f"{d[:4]}.{d[4:8]}" if len(d) >= 8 else (d if d else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workbook")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sheet")
    for k in ("inv", "hs", "desc", "amount"):
        ap.add_argument(f"--{k}-col")
    a = ap.parse_args()
    wb = openpyxl.load_workbook(a.workbook, data_only=True)
    sheets = [wb[a.sheet]] if a.sheet else wb.worksheets
    found = next(((ws, *d) for ws in sheets if (d := detect(ws, a))), None)
    if not found:
        sys.exit("No sheet has an invoice column, an HS column and a description or amount column in its top 15 rows. "
                 "Name them: --sheet, --inv-col, --hs-col, --desc-col, --amount-col. Sheets: " + ", ".join(wb.sheetnames))
    ws, hr, cols, cells = found
    print(f'sheet "{ws.title}", heading row {hr}: ' + ", ".join(
        f'{k}={openpyxl.utils.get_column_letter(c)} "{cells[c - 1]}"' if c else f"{k}=none" for k, c in cols.items()))

    rows, skipped = [], 0
    for r in range(hr + 1, ws.max_row + 1):
        nums = re.findall(r"\d+", str(ws.cell(r, cols["inv"]).value or ""))
        if not nums:
            skipped += 1
            continue
        desc = re.sub(r"\s+", " ", str(ws.cell(r, cols["desc"]).value or "")).strip() if cols["desc"] else ""
        amt = ws.cell(r, cols["amount"]).value if cols["amount"] else None
        try:
            amt = round(float(str(amt).replace(",", "")), 2) if amt not in (None, "") else None
        except ValueError:
            amt = None
        rows.append([int(nums[-1]), hs_code(ws.cell(r, cols["hs"]).value), desc, amt])

    json.dump(rows, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    invs = sorted({x[0] for x in rows})
    print(f"{len(rows)} lines, {len(invs)} invoices" + (f" ({invs[0]}-{invs[-1]})" if invs else "") + f", skipped {skipped} rows with no invoice number")
    print("sample:", rows[:3])
    print("HS codes:", dict(collections.Counter(x[1] or "(blank)" for x in rows).most_common()))
    odd = sorted({x[1] for x in rows if x[1] and not re.fullmatch(r"\d{4}\.\d{4}", x[1])})
    if odd:
        print("HS codes not in NNNN.NNNN form (check the column):", odd)
    blank = sorted({x[0] for x in rows if not x[1]})
    if blank:
        print("invoices with a blank HS code (skipped by the classifier):", blank)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
