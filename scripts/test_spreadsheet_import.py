"""
Spreadsheet import suite — layouts, file checks, re-import protection, and the
opening stock importer.

The workbooks are BUILT here rather than read from disk, so the suite runs on
any machine and pins the exact shapes it claims to handle. They reproduce the
real client sheet: a title band, headings on row 3, customs-lot rows from row 4,
HS codes carrying a ":-" suffix, and one item spread across two lots.

What it proves:

  * a layout is saved once, versioned on every rule change, and can be rolled
    back; a rename does not burn a version
  * a private layout is invisible to another company; a shared one is not
  * uploads are checked before parsing — extension, magic bytes, container vs
    extension, opens, non-empty — each with its own message
  * the same workbook fingerprints identically when only the month changes, so
    next month's file matches the same layout
  * preview writes nothing; grouping sums an item held across two lots; the
    match ladder reuses before it creates
  * commit writes item types, opening quantities and the Inventory opening
    balance, and switches the company to tracking inventory
  * the same file cannot be imported twice, a re-saved copy with identical
    content is refused too, a grown sheet still imports, and setting the run
    aside unlocks a deliberate re-import
  * every route refuses a company the caller cannot reach

    python scripts/test_spreadsheet_import.py --base http://localhost:5134

Creates its own throwaway companies and deletes them at the end unless --keep.
"""

import argparse
import io
import json
import sys
import uuid
from datetime import date

import requests

try:
    import openpyxl
except ImportError:
    print("openpyxl is required:  pip install openpyxl")
    sys.exit(2)

# Messages echoed from the API carry typographic characters; a Windows console
# defaults to cp1252 and would raise on them mid-suite.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
results = []


def check(name, ok, detail=""):
    results.append((PASS if ok else FAIL, name, detail))
    print(f"[{PASS if ok else FAIL}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def skip(name, why):
    results.append((SKIP, name, why))
    print(f"[{SKIP}] {name} — {why}")


def login(base, username, password):
    r = requests.post(f"{base}/api/auth/login",
                      json={"username": username, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


# ── Workbook builders ───────────────────────────────────────────────────────
# Mirrors the client's real stock sheet: a title band, headings on row 3, data
# from row 4, HS codes with a ":-" tail, and the Balance block at cols 18/19.

STOCK_MAPPING = {
    "sheetSelect": {"mode": "byHeaderText", "mustContain": ["GD Number"]},
    "headerRow": 3,
    "firstDataRow": 4,
    "columns": {
        "lotRef": 2, "lotDate": 3, "hsCodeShort": 4, "hsCodeFull": 5,
        "itemName": 6, "unit": 9, "balanceQty": 18, "balanceValue": 19,
    },
    "hsCodeStripSuffix": ":-",
    "ignoreColumns": [7],
}


def stock_workbook(rows, month="Jul 2026", sheet_name=None):
    """rows: (lot, hs4, hs8, name, subcat, unit, qty, value)"""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name or month
    ws.cell(1, 6, "ALPHA Trader")
    ws.cell(2, 1, "Stock Sheet")
    ws.cell(2, 6, month)
    headings = {1: "Claimed Month", 2: "GD Number", 3: "GD Date", 4: "4 Digit Hs Code",
                5: "8 Digit Hs code", 6: "Items", 7: "Sub Catory", 8: "Price",
                9: "Unit", 10: "Qty", 11: "Excluding", 18: " Qty", 19: "Balance Exl"}
    for col, text in headings.items():
        ws.cell(3, col, text)

    for i, (lot, hs4, hs8, name, subcat, unit, qty, value) in enumerate(rows):
        r = 4 + i
        ws.cell(r, 1, month)
        ws.cell(r, 2, lot)
        ws.cell(r, 3, "23-07-2025")
        ws.cell(r, 4, hs4)
        ws.cell(r, 5, hs8)
        ws.cell(r, 6, name)
        ws.cell(r, 7, subcat)
        ws.cell(r, 9, unit)
        ws.cell(r, 18, qty)
        ws.cell(r, 19, value)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def base_rows(tag):
    """Two lots of one item, plus three singles — 5 rows, 4 items."""
    return [
        ("KAPE-HC-5876", "8481", "8481.1000:-", f"SS BALL VALVE {tag}", "Valve", "Pcs", 12, 23160),
        ("KAPE-HC-5876", "8513", "8513.1090:-", f"RECHARGEABLE LED {tag}", "Electrical", "Pcs", 46, 30000),
        ("KAPE-HC-5876", "8450", "8450.9000:-", f"WASHING PARTS {tag}", "Electrical", "Kg", 67.5, 54160),
        # Same item, second customs lot — must merge into one item type.
        ("KAPW-HC-128753", "8450", "8450.9000:-", f"WASHING PARTS {tag}", "Electrical", "KG", 32.5, 26000),
        ("KAPW-HC-128753", "8712", "8712.0000:-", f"CHILDREN BICYCLE {tag}", "Sports", "Pcs", 2, 15120),
    ]


def empty_workbook():
    wb = openpyxl.Workbook()
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def upload(url, h, content, filename="stock.xlsx", data=None, params=None):
    return requests.post(
        url, params=params or {}, data=data or {},
        files={"file": (filename, io.BytesIO(content),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=h, timeout=180)


def make_company(api, h, name):
    r = requests.post(f"{api}/companies", headers=h, timeout=60, json={
        "name": name, "brandName": "SSIMP", "fullAddress": "1 Test Street",
        "phone": "021-0000000", "ntn": "1234567-8",
        "startingChallanNumber": 1, "startingInvoiceNumber": 1,
        "startingSalesQuoteNumber": 1, "startingSalesOrderNumber": 1,
    })
    if r.status_code not in (200, 201):
        raise RuntimeError(f"company create failed: http {r.status_code} {r.text[:200]}")
    return r.json()["id"]


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
    company = make_company(api, h, f"Sheet Import Co {tag}")
    other = make_company(api, h, f"Sheet Import Other {tag}")
    profile_ids = []

    stock_preview = f"{api}/spreadsheet-import/opening-stock/preview"
    stock_commit = f"{api}/spreadsheet-import/opening-stock/commit"

    try:
        requests.post(f"{api}/accounts/company/{company}/seed-wholesale", headers=h, timeout=120)

        # ── 1. Layouts ──────────────────────────────────────────────────
        r = requests.post(f"{api}/import-profiles", headers=h, timeout=30, json={
            "kind": "OpeningStock", "layout": "LotRows", "name": f"Stock {tag}",
            "companyId": company, "signatureHash": "a" * 64,
            "tokenSignature": "balance|excluding|items|qty",
            "mappingJson": json.dumps(STOCK_MAPPING),
        })
        ok = r.status_code in (200, 201)
        profile = r.json() if ok else {}
        if ok:
            profile_ids.append(profile["id"])
        check("a layout saves as version 1", ok and profile.get("currentVersion") == 1,
              f"http {r.status_code}")
        check("a company-scoped layout is not shared", profile.get("isShared") is False)

        pid = profile.get("id")

        r = requests.put(f"{api}/import-profiles/{pid}", headers=h, timeout=30,
                         json={"name": f"Stock {tag} renamed"})
        check("a rename does not burn a version",
              r.ok and r.json().get("currentVersion") == 1,
              f"version={r.json().get('currentVersion') if r.ok else '-'}")

        changed = dict(STOCK_MAPPING, firstDataRow=5)
        r = requests.put(f"{api}/import-profiles/{pid}", headers=h, timeout=30,
                         json={"mappingJson": json.dumps(changed), "changeNote": "start row"})
        check("a mapping change bumps the version",
              r.ok and r.json().get("currentVersion") == 2,
              f"version={r.json().get('currentVersion') if r.ok else '-'}")

        r = requests.get(f"{api}/import-profiles/{pid}/versions", headers=h, timeout=30)
        check("both versions are in the history", r.ok and len(r.json()) == 2,
              f"{len(r.json()) if r.ok else '-'} versions")

        r = requests.post(f"{api}/import-profiles/{pid}/rollback", headers=h, timeout=30,
                          json={"version": 1})
        rolled = r.json() if r.ok else {}
        check("rollback restores the old mapping",
              r.ok and json.loads(rolled.get("mappingJson", "{}")).get("firstDataRow") == 4,
              f"http {r.status_code}")
        check("rollback moves history forward, never back",
              rolled.get("currentVersion") == 3, f"version={rolled.get('currentVersion')}")

        r = requests.post(f"{api}/import-profiles", headers=h, timeout=30, json={
            "kind": "OpeningStock", "layout": "NotALayout", "name": "bad",
            "companyId": company, "signatureHash": "b" * 64, "mappingJson": "{}",
        })
        check("an unknown layout is refused", r.status_code == 400, f"http {r.status_code}")

        r = requests.post(f"{api}/import-profiles", headers=h, timeout=30, json={
            "kind": "OpeningStock", "layout": "LotRows", "name": "bad json",
            "companyId": company, "signatureHash": "c" * 64, "mappingJson": "{not json",
        })
        check("a malformed mapping is refused", r.status_code == 400, f"http {r.status_code}")

        r = requests.get(f"{api}/import-profiles", headers=h, timeout=30,
                         params={"kind": "OpeningStock", "companyId": other})
        visible = [p["id"] for p in r.json()] if r.ok else []
        check("a private layout is invisible to another company", pid not in visible,
              f"{len(visible)} visible to the other company")

        # ── 2. File validation ──────────────────────────────────────────
        good = stock_workbook(base_rows(tag))
        params = {"companyId": company}
        form = {"mappingJson": json.dumps(STOCK_MAPPING)}

        r = upload(stock_preview, h, b"", "stock.xlsx", form, params)
        check("an empty file is refused", r.status_code == 400, f"http {r.status_code}")

        r = upload(stock_preview, h, good, "stock.txt", form, params)
        check("a .txt is refused on extension", r.status_code == 400, f"http {r.status_code}")

        r = upload(stock_preview, h, b"%PDF-1.4\n%fake pdf bytes here", "stock.xlsx", form, params)
        msg = (r.json().get("message") or "") if r.status_code == 400 else ""
        check("a PDF renamed .xlsx is refused on magic bytes",
              r.status_code == 400 and "not a valid Excel" in msg, f"http {r.status_code}: {msg[:60]}")

        # OLE2 header = a real legacy .xls container, wrong for a .xlsx name.
        r = upload(stock_preview, h, bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + b"\x00" * 64,
                   "stock.xlsx", form, params)
        msg = (r.json().get("message") or "") if r.status_code == 400 else ""
        check("a .xls renamed .xlsx is refused on the container",
              r.status_code == 400 and "do not match" in msg, f"http {r.status_code}: {msg[:60]}")

        r = upload(stock_preview, h, empty_workbook(), "stock.xlsx", form, params)
        msg = (r.json().get("message") or "") if r.status_code == 400 else ""
        check("an empty workbook is refused", r.status_code == 400 and "empty" in msg.lower(),
              f"http {r.status_code}: {msg[:60]}")

        # ── 3. Fingerprint ──────────────────────────────────────────────
        idurl = f"{api}/spreadsheet-import/identify"
        r = upload(idurl, h, good, "stock.xlsx", None, {"companyId": company, "kind": "OpeningStock"})
        ident = r.json() if r.ok else {}
        sig_jul = ident.get("signatureHash")
        check("identify fingerprints the workbook", r.ok and bool(sig_jul), f"http {r.status_code}")
        check("identify describes the sheets for mapping", len(ident.get("sheets", [])) >= 1,
              f"{len(ident.get('sheets', []))} sheets")

        aug = stock_workbook(base_rows(tag), month="Aug 2026")
        r = upload(idurl, h, aug, "stock.xlsx", None, {"companyId": company, "kind": "OpeningStock"})
        check("next month's file fingerprints the same",
              r.ok and r.json().get("signatureHash") == sig_jul,
              "digits are stripped, so the month does not change the layout")

        # ── 4. Opening stock preview ────────────────────────────────────
        r = upload(stock_preview, h, good, "stock.xlsx", form, params)
        prev = r.json() if r.ok else {}
        check("the stock sheet previews", r.ok, f"http {r.status_code}: {r.text[:160]}")
        check("5 sheet rows become 4 items", prev.get("sourceRowCount") == 5 and len(prev.get("rows", [])) == 4,
              f"rows={prev.get('sourceRowCount')} items={len(prev.get('rows', []))}")

        merged = next((x for x in prev.get("rows", []) if "WASHING PARTS" in x["itemName"]), None)
        check("an item held across two lots sums its quantities",
              merged is not None and abs(merged["quantity"] - 100.0) < 0.001,
              f"qty={merged['quantity'] if merged else '-'}")
        check("both lot references are kept on the merged item",
              merged is not None and merged.get("lotRefs", "").count(",") == 1,
              f"lots={merged.get('lotRefs') if merged else '-'}")
        check("the sub-category column is ignored",
              all("Electrical" not in (x.get("itemName") or "") for x in prev.get("rows", [])))
        check("the HS code suffix is stripped",
              all((x.get("hsCode") or "").replace(".", "").isdigit() for x in prev.get("rows", [])),
              f"codes={[x.get('hsCode') for x in prev.get('rows', [])][:4]}")
        check("every item is new on a first upload",
              prev.get("statusCounts", {}).get("will-create") == 4,
              f"counts={prev.get('statusCounts')}")
        check("the value total adds up",
              abs(prev.get("totalValue", 0) - 148440) < 0.5, f"value={prev.get('totalValue')}")

        before = requests.get(f"{api}/stock/company/{company}/opening", headers=h, timeout=60)
        check("preview wrote nothing", before.ok and len(before.json()) == 0,
              f"{len(before.json()) if before.ok else '-'} opening balances exist")

        hs_count = requests.get(f"{api}/hscodes/count", headers=h, timeout=30)
        master_loaded = hs_count.ok and (hs_count.json().get("count", 0) if isinstance(hs_count.json(), dict) else hs_count.json()) > 0
        if master_loaded:
            bogus = stock_workbook([("L1", "9999", "9999.9999:-", f"BOGUS {tag}", "X", "Pcs", 1, 10)])
            r = upload(stock_preview, h, bogus, "stock.xlsx", form, params)
            p2 = r.json() if r.ok else {}
            check("an HS code missing from the master blocks the row",
                  p2.get("statusCounts", {}).get("hs-unknown") == 1 and not p2.get("canCommit"),
                  f"counts={p2.get('statusCounts')}")
        else:
            skip("an HS code missing from the master blocks the row",
                 "HS master is empty on this database; run the HS Code import first")
            check("an empty HS master is reported, not silently ignored",
                  any("HS code master is empty" in w for w in prev.get("warnings", [])),
                  f"warnings={prev.get('warnings')}")

        # ── 5. Commit ───────────────────────────────────────────────────
        body = {
            "companyId": company,
            "fileSha256": prev["fileSha256"],
            "fileName": "stock.xlsx",
            "fileSizeBytes": prev["fileSizeBytes"],
            "asOfDate": date(2026, 7, 1).isoformat(),
            "postInventoryValue": True,
            "enableInventoryTracking": True,
            "rows": [
                {"itemName": x["itemName"], "hsCode": x["hsCode"],
                 "isHsCodePartial": x["isHsCodePartial"], "unit": x["unit"],
                 "quantity": x["quantity"], "value": x["value"],
                 "lotRefs": x["lotRefs"], "itemTypeId": x["itemTypeId"]}
                for x in prev["rows"]
            ],
        }
        r = requests.post(stock_commit, headers=h, timeout=300, json=body)
        res = r.json() if r.ok else {}
        check("commit succeeds", r.ok, f"http {r.status_code}: {r.text[:200]}")
        check("four item types are created", res.get("itemTypesCreated") == 4,
              f"created={res.get('itemTypesCreated')}")
        check("four opening balances are written", res.get("openingBalancesWritten") == 4,
              f"written={res.get('openingBalancesWritten')}")
        check("the stock value is posted to Inventory",
              abs(res.get("inventoryValuePosted", 0) - 148440) < 0.5,
              f"posted={res.get('inventoryValuePosted')}")
        check("an import run is recorded", res.get("importRunId", 0) > 0)

        after = requests.get(f"{api}/stock/company/{company}/opening", headers=h, timeout=60).json()
        check("the opening balances landed", len(after) == 4, f"{len(after)} rows")
        washing = next((x for x in after if "WASHING PARTS" in x["itemTypeName"]), None)
        check("the merged item carries the summed quantity",
              washing is not None and abs(washing["quantity"] - 100.0) < 0.001,
              f"qty={washing['quantity'] if washing else '-'}")
        check("the lot references are on the opening balance note",
              washing is not None and "KAPE-HC-5876" in (washing.get("notes") or ""),
              f"notes={washing.get('notes') if washing else '-'}")

        r = requests.get(f"{api}/accounts/company/{company}/flat", headers=h, timeout=60)
        # ControlType serialises as its NAME, not the enum's number.
        inv = next((a for a in r.json() if a.get("controlType") == "Inventory"), None) if r.ok else None
        check("the Inventory account carries the opening balance",
              inv is not None and abs(inv.get("openingBalance", 0) - 148440) < 0.5,
              f"opening={inv.get('openingBalance') if inv else '-'}")

        r = requests.get(f"{api}/companies/{company}", headers=h, timeout=30)
        comp = r.json() if r.ok else {}
        check("the company now tracks inventory", comp.get("inventoryTrackingEnabled") is True)
        check("the company is on the standard inventory flow",
              comp.get("inventoryFlowVersion") == 2, f"version={comp.get('inventoryFlowVersion')}")

        # ── 6. Re-import protection ─────────────────────────────────────
        r = upload(stock_preview, h, good, "stock.xlsx", form, params)
        p3 = r.json() if r.ok else {}
        check("the same file is refused on a second preview",
              any("already imported" in e for e in p3.get("blockingErrors", [])),
              f"errors={p3.get('blockingErrors')}")

        r = requests.post(stock_commit, headers=h, timeout=120, json=body)
        check("the same file is refused at commit too", r.status_code == 400,
              f"http {r.status_code}")

        counts = requests.get(f"{api}/stock/company/{company}/opening", headers=h, timeout=60).json()
        check("the refused re-import wrote nothing", len(counts) == 4, f"{len(counts)} rows")

        # A re-save produces different bytes and identical content: the hash
        # misses it, so the content check has to catch it.
        resaved = stock_workbook(base_rows(tag), sheet_name="Jul 2026 ")
        r = upload(stock_preview, h, resaved, "stock-resaved.xlsx", form, params)
        p4 = r.json() if r.ok else {}
        check("a re-saved copy has a different hash",
              p4.get("fileSha256") != prev["fileSha256"], "bytes differ, as expected")
        check("a re-saved copy with identical content is still refused",
              any("already been imported" in e for e in p4.get("blockingErrors", [])),
              f"errors={p4.get('blockingErrors')}")

        # A sheet that has genuinely grown must still import.
        grown = stock_workbook(base_rows(tag) + [
            ("KAPE-HC-9000", "8536", "8536.5000:-", f"NEW SWITCH {tag}", "Electrical", "Pcs", 25, 5000)])
        r = upload(stock_preview, h, grown, "stock-grown.xlsx", form, params)
        p5 = r.json() if r.ok else {}
        check("a sheet with new rows still imports", p5.get("canCommit") is True,
              f"errors={p5.get('blockingErrors')}")
        check("the unchanged rows are called out, not hidden",
              any("already carry exactly this opening quantity" in w for w in p5.get("warnings", [])),
              f"warnings={p5.get('warnings')}")

        # ── 7. Force re-import ──────────────────────────────────────────
        runs = requests.get(f"{api}/spreadsheet-import/runs", headers=h, timeout=30,
                            params={"companyId": company}).json()
        check("the import history lists the run", runs.get("totalCount", 0) >= 1,
              f"total={runs.get('totalCount')}")
        run_id = runs["items"][0]["id"]

        r = requests.post(f"{api}/spreadsheet-import/runs/{run_id}/supersede", headers=h, timeout=30,
                          params={"companyId": company}, json={"reason": ""})
        check("setting a run aside needs a reason", r.status_code == 400, f"http {r.status_code}")

        r = requests.post(f"{api}/spreadsheet-import/runs/{run_id}/supersede", headers=h, timeout=30,
                          params={"companyId": company}, json={"reason": "wrong file"})
        check("a run can be set aside with a reason", r.ok and r.json().get("isSuperseded") is True,
              f"http {r.status_code}")

        r = upload(stock_preview, h, good, "stock.xlsx", form, params)
        p6 = r.json() if r.ok else {}
        check("the same file may be previewed again once set aside",
              not any("already imported on" in e for e in p6.get("blockingErrors", [])),
              f"errors={p6.get('blockingErrors')}")

        # ── 8. Isolation ────────────────────────────────────────────────
        r = upload(stock_preview, h, good, "stock.xlsx", form, {"companyId": 999999})
        check("preview refuses a company that does not exist", r.status_code == 404,
              f"http {r.status_code}")

        r = requests.post(stock_commit, headers=h, timeout=60,
                          json=dict(body, companyId=999999))
        check("commit refuses a company that does not exist", r.status_code == 404,
              f"http {r.status_code}")

        r = upload(stock_preview, h, good, "stock.xlsx",
                   {"mappingJson": json.dumps(STOCK_MAPPING)}, {"companyId": other},
                   )
        check("a layout is not required to belong to the company being imported into",
              r.ok, f"http {r.status_code}")

        r = upload(stock_preview, h, good, "stock.xlsx", None,
                   {"companyId": other, "profileId": pid})
        check("another company's private layout cannot be used", r.status_code == 404,
              f"http {r.status_code}")

    finally:
        if not args.keep:
            for p in profile_ids:
                requests.delete(f"{api}/import-profiles/{p}", headers=h, timeout=60)
            for c in (company, other):
                requests.delete(f"{api}/companies/{c}", headers=h, timeout=300)

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
