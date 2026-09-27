"""
Live test: the stock sheet's Claim Month is kept PER LINE (2026-09-27).

Importer clients write Claim Month on every line of their stock sheet, and one
customs declaration's items are routinely claimed in different returns. This
suite imports a synthetic sheet into a throwaway company and proves:

  1. the preview reads the month by its short name ("Jun 2026", "June 2026",
     "Sept 2025") and a blank line reads as not claimed;
  2. the commit stores each line's own month, and a GD whose lines disagree
     keeps both months rather than one winning;
  3. a line's month can be corrected on its own (PUT .../line-claim-month),
     and a line of ANOTHER company is 404, not written (IDOR);
  4. the Excel export names every month of a mixed GD.

  python scripts/test_line_claim_month.py --base http://localhost:5136
"""
import argparse
import io
import sys
import uuid
from datetime import date

import openpyxl
import requests

passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name} — {detail}")


def make_company(api, h, name):
    r = requests.post(f"{api}/companies", headers=h, timeout=60, json={
        "name": name, "brandName": "CLM", "fullAddress": "1 Test Street",
        "phone": "021-0000000", "ntn": "1234567-8",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
    })
    if r.status_code not in (200, 201):
        raise RuntimeError(f"company create failed: http {r.status_code} {r.text[:200]}")
    return r.json()["id"]


def sheet_bytes(tag):
    """The standard stock sheet: bands on row 2, headings on row 3, data from 4."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Aug 2026"
    ws.cell(1, 6, "Test Trader")
    ws.cell(2, 10, "Opening"); ws.cell(2, 14, "Consumed"); ws.cell(2, 18, "Balance")
    heads = ["Claimed Month", "GD Number", "GD Date", "4 Digit Hs Code", "8 Digit Hs Code",
             "Items", "Sub Category", "Price", "Unit", "Qty", "Exl", "Rate", "S.Tax",
             "Qty", "Consumed Exl", "Rate", "S.Tax", "Bal Qty", "Bal Exl", "Rate", "S.Tax"]
    for i, t in enumerate(heads, start=1):
        ws.cell(3, i, t)
    gd_a, gd_b = f"CLM-A-{tag}", f"CLM-B-{tag}"
    rows = [
        # claim,        gd,   hs4,    hs8,           item
        ("Jun 2026",    gd_a, "9616", "9616.1000:-", f"ATOMIZER {tag}"),
        ("July 2026",   gd_a, "8513", "8513.1090:-", f"LED DISPLAY {tag}"),
        (None,          gd_a, "8450", "8450.9000:-", f"WASHER PARTS {tag}"),
        ("Sept 2025",   gd_b, "8481", "8481.1000:-", f"BALL VALVE {tag}"),
    ]
    for r, (claim, gd, hs4, hs8, item) in enumerate(rows, start=4):
        values = [claim, gd, "23-07-2025", hs4, hs8, item, "Test", 100, "Pcs",
                  10, 1000, 0.18, 180, 0, 0, 0.18, 0, 10, 1000, 0.18, 180]
        for c, v in enumerate(values, start=1):
            if v is not None:
                ws.cell(r, c, v)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), gd_a, gd_b


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()
    api = args.base.rstrip("/") + "/api"

    tok = requests.post(f"{api}/auth/login", timeout=30,
                        json={"username": args.username, "password": args.password}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    tag = uuid.uuid4().hex[:6].upper()
    company = make_company(api, h, f"Claim Month Test {tag}")
    other = make_company(api, h, f"Claim Month Other {tag}")
    print(f"companies {company} / {other}")

    profs = requests.get(f"{api}/import-profiles", headers=h, timeout=60,
                         params={"kind": "OpeningStock", "companyId": company}).json()
    std = next(x for x in profs if x.get("isDefault"))
    blob, gd_a, gd_b = sheet_bytes(tag)

    print("\n  Suite 1 — the preview reads each line's month")
    r = requests.post(f"{api}/spreadsheet-import/opening-stock/preview", headers=h, timeout=120,
                      params={"companyId": company, "profileId": std["id"]},
                      files={"file": ("claims.xlsx", blob)})
    check("preview returns 200", r.ok, f"http {r.status_code} {r.text[:200]}")
    prev = r.json()
    lots = {l["itemNameOnSheet"].split(" ")[0]: l for row in prev["rows"] for l in row["lots"]}
    want = {"ATOMIZER": "2026-06", "LED": "2026-07", "WASHER": None, "BALL": "2025-09"}
    for key, month in want.items():
        got = (lots.get(key) or {}).get("claimMonth")
        check(f"{key} reads {month or 'not claimed'}", (got or "")[:7] == (month or ""), f"got {got}")
    check("the preview says how many lines carry a month",
          any("3 of 4 line" in w for w in prev.get("warnings", [])), str(prev.get("warnings")))

    print("\n  Suite 2 — the commit keeps every line's own month")
    blocked = [x for x in prev["rows"] if x.get("status") in ("hs-unknown", "error")]
    if blocked:
        print(f"  [skip] {len(blocked)} row(s) have HS codes missing from this database's tariff")
        return finish()
    body = {
        "companyId": company, "fileSha256": prev["fileSha256"], "fileName": "claims.xlsx",
        "fileSizeBytes": prev["fileSizeBytes"], "asOfDate": date(2026, 7, 1).isoformat(),
        "postInventoryValue": False, "enableInventoryTracking": True,
        "rows": [{"itemName": x["itemName"], "hsCode": x["hsCode"],
                  "isHsCodePartial": x["isHsCodePartial"], "unit": x["unit"],
                  "quantity": x["quantity"], "value": x["value"], "salesTaxRate": x["salesTaxRate"],
                  "lotRefs": x["lotRefs"], "itemTypeId": x["itemTypeId"], "lots": x["lots"]}
                 for x in prev["rows"]],
    }
    r = requests.post(f"{api}/spreadsheet-import/opening-stock/commit", headers=h, timeout=300, json=body)
    check("commit succeeds", r.ok, f"http {r.status_code} {r.text[:300]}")
    check("a GD whose lines all agree is also recorded at GD level",
          r.ok and r.json().get("claimMonthsWritten") == 1, r.text[:200])

    details = requests.get(f"{api}/stock/company/{company}/gd-details", headers=h, timeout=60).json()
    by = {d["description"].split(" ")[0]: d for d in details}
    for key, month in want.items():
        got = (by.get(key) or {}).get("claimMonth")
        check(f"stored: {key} is {month or 'not claimed'}", (got or "")[:7] == (month or ""), f"got {got}")
    check("the mixed GD keeps BOTH of its months",
          {(d.get("claimMonth") or "")[:7] for d in details if d["gdNumber"] == gd_a}
          == {"2026-06", "2026-07", ""})
    check("every opening line carries its lot id", all(d.get("lotId") for d in details))

    print("\n  Suite 3 — one line is corrected on its own; another company cannot touch it")
    washer = by["WASHER"]
    url = f"{api}/stock/company/{company}/line-claim-month"
    r = requests.put(url, headers=h, timeout=30, json={"lotId": washer["lotId"], "claimMonth": "2026-08-01"})
    check("setting one line's month returns 204", r.status_code == 204, f"http {r.status_code} {r.text}")
    details = requests.get(f"{api}/stock/company/{company}/gd-details", headers=h, timeout=60).json()
    by2 = {d["description"].split(" ")[0]: d for d in details}
    check("that line now reads Aug 2026", (by2["WASHER"].get("claimMonth") or "")[:7] == "2026-08")
    check("its GD siblings are untouched",
          (by2["ATOMIZER"].get("claimMonth") or "")[:7] == "2026-06"
          and (by2["LED"].get("claimMonth") or "")[:7] == "2026-07")
    r = requests.put(f"{api}/stock/company/{other}/line-claim-month", headers=h, timeout=30,
                     json={"lotId": washer["lotId"], "claimMonth": "2020-01-01"})
    check("a line of another company is 404 through that company's route", r.status_code == 404,
          f"http {r.status_code}")
    r = requests.put(url, headers=h, timeout=30, json={"lotId": washer["lotId"], "claimMonth": "2026-08-15"})
    check("a date that is not the 1st is refused", r.status_code == 400, f"http {r.status_code}")
    r = requests.put(url, headers=h, timeout=30, json={"claimMonth": "2026-08-01"})
    check("no line id is refused", r.status_code == 400, f"http {r.status_code}")
    r = requests.put(url, headers=h, timeout=30, json={"lotId": washer["lotId"], "claimMonth": None})
    details = requests.get(f"{api}/stock/company/{company}/gd-details", headers=h, timeout=60).json()
    check("clearing a line makes it not claimed again",
          r.status_code == 204 and not next(d for d in details if d["lotId"] == washer["lotId"]).get("claimMonth"))

    print("\n  Suite 4 — the export names every month of a mixed GD")
    r = requests.get(f"{api}/stock/company/{company}/onhand/excel", headers=h, timeout=120)
    check("export returns 200", r.ok, f"http {r.status_code}")
    ws = openpyxl.load_workbook(io.BytesIO(r.content)).worksheets[0]
    cells = {str(ws.cell(row, 4).value or ""): (ws.cell(row, 1).value, ws.cell(row, 2).value)
             for row in range(4, ws.max_row + 1)}
    atom = next((v for k, v in cells.items() if k.startswith("ATOMIZER")), None)
    check("a line's own month reaches its item row", atom and atom[0] == "Jun 2026", str(atom))
    check("and its GD", atom and atom[1] == gd_a, str(atom))
    return finish()


def finish():
    print(f"\n=== {passed}/{passed + failed} checks passed ===")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
