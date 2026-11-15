"""Reads a consultant's monthly GD stock sheet, whatever order its identity columns are in.

The layout is the one the software's own stock export uses: identity columns up to
Unit, then three blocks of four columns (Qty, Value excluding tax, Rate, Sales tax)
for Opening, Consumed and Balance. The identity columns are found by heading; the
three blocks are found by position after Unit, because their headings repeat.

Used by read_sheet.py, compare.py and make_copy.py. Needs openpyxl.
"""
import re

import openpyxl

IDENTITY = {
    "claim": ("claim",),
    "gd": ("gd number", "gds no", "gd no"),
    "date": ("gd date",),
    "hs": ("8 digit",),
    "item": ("items", "item", "description"),
    "unit": ("unit",),
}
# Offsets from the Unit column.
BLOCKS = {"oq": 1, "ov": 2, "orate": 3, "otax": 4, "cq": 5, "cv": 6, "crate": 7, "ctax": 8,
          "bq": 9, "bv": 10, "rate": 11, "btax": 12}


def hs8(value):
    m = re.search(r"(\d{4})\.?(\d{4})", str(value or ""))
    return m.group(1) + "." + m.group(2) if m else "?"


def gd_key(value):
    return re.sub(r"\s+", "", str(value or "-")).upper()


def num(value):
    return value if isinstance(value, (int, float)) else 0


class Sheet:
    """The first worksheet of a stock sheet, with its columns located."""

    def __init__(self, path, data_only=True):
        self.wb = openpyxl.load_workbook(path, data_only=data_only)
        self.ws = self.wb.worksheets[0]
        self.header_row, self.col = self._locate()
        self.first = self.header_row + 1

    def _locate(self):
        for r in range(1, 9):
            heads = {c: str(self.ws.cell(r, c).value or "").strip().lower()
                     for c in range(1, self.ws.max_column + 1)}
            found = {}
            for key, names in IDENTITY.items():
                for c, text in heads.items():
                    if text and any(text == n or text.startswith(n) for n in names) and key not in found:
                        found[key] = c
            if {"gd", "hs", "item", "unit"} <= set(found):
                for key, off in BLOCKS.items():
                    found[key] = found["unit"] + off
                return r, found
        raise SystemExit("No heading row with GD number, 8-digit HS code, item and Unit was found in the first 8 rows.")

    def cell(self, row, key):
        return self.ws.cell(row, self.col[key])

    def data_rows(self):
        """Row numbers that carry a GD number (the sheet's own totals and notes do not)."""
        return [r for r in range(self.first, self.ws.max_row + 1) if self.cell(r, "gd").value]

    def record(self, r):
        v = lambda k: self.cell(r, k).value if k in self.col else None
        f = lambda x: round(float(x), 6) if isinstance(x, (int, float)) else x
        return {"row": r, "claim": str(v("claim") or ""), "gd": str(v("gd")).strip(), "date": str(v("date") or "")[:10],
                "hs": hs8(v("hs")), "item": str(v("item") or "").strip(), "unit": str(v("unit") or "").strip(),
                "oq": f(v("oq")), "ov": f(v("ov")), "cq": f(v("cq")), "cv": f(v("cv")),
                "bq": f(v("bq")), "bv": f(v("bv")), "rate": f(v("rate")), "btax": f(v("btax"))}

    def records(self):
        return [self.record(r) for r in self.data_rows()]
