# Invoice Sales Detail Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Reports ▸ Invoice Sales Detail on the shared report pieces, with period presets, three filters and a professional bill-grouped grid, while the Excel workbook keeps its exact format.

**Architecture:** The server takes one query (period preset / custom range / legacy month + search, FBR status, customer) for both the JSON and the Excel route, resolved on Pakistan time by `ReportPeriod`; the Excel builder is not touched. The screen reuses `ReportFilterBar` and the header / tiles / print builder extracted from `ReportShell`, plus a dedicated grid whose decisions live in a pure util pinned offline.

**Tech Stack:** .NET 9 / EF Core 9, React 19 + Vite, ClosedXML, Python live suites (urllib + openpyxl), node offline suites.

Spec: `docs/superpowers/specs/2026-09-25-invoice-sales-detail-redesign-design.md`

## Global Constraints

- The Excel workbook's format does not change: sheet "Sales Detail", the same 27 headers, number formats, fills, widths, freeze and autofilter, and the "Total listed bills" row. `GetInvoiceSalesDetailExcelAsync`'s workbook code is not edited.
- The figures do not change: per-line GST apportioning, advance / further tax on the first line, cancelled bills listed AND counted in the totals.
- Tenant: every route keeps `[AuthorizeCompany]` and its `[HasPermission]` key; no new permission keys.
- Mobile-first: 44px tap targets, no page-level horizontal scroll, `-webkit-line-clamp` for names (never nowrap + ellipsis), test at 375 / 768 / 1280.
- Shared components change only through OPTIONAL props; every existing report renders exactly as before.
- Commits: author huzefa5152 (repo-local config), short imperative subject, no AI attribution, explicit paths (`git commit -F <msg> -- <paths>`), read `git diff --stat` first. Never push.
- Never restart the user's backend; the 5134 server in this session (task btcl0y6v9) is ours and may be restarted.
- README changelog entry is part of the work.

---

### Task 1: The server takes a period and filters

**Files:**
- Create: `Helpers/InvoiceSalesDetailFilter.cs`
- Modify: `DTOs/InvoiceSalesDetailDtos.cs`
- Modify: `Services/Interfaces/IReportService.cs:7-10`
- Modify: `Services/Implementations/ReportService.cs:56-143`
- Modify: `Controllers/ReportsController.cs:38-62`
- Test: `scripts/test_invoice_sales_detail.py`
- Scratch (not committed): `<scratchpad>/isd_compare.py`

**Interfaces:**
- Produces: `InvoiceSalesDetailQueryDto { string? Period; DateTime? From; DateTime? To; int? Year; int? Month; string? Search; string? FbrStatus; int? ClientId }`
- Produces: `InvoiceSalesDetailFilter.Validate(q) -> string?`, `.ResolveWindow(q) -> ReportWindow`, `.TryParseFbrStatus(raw, out string? status) -> bool`, `.RowMatches(row, term) -> bool`, `.ExcelFileName(from, to) -> string`
- Produces (JSON, camelCase): report gains `from`, `to`, `generatedAt`, `cancelledCount`, `buyers: [{ clientId, name, ntn }]`; `periodLabel` is `ReportPeriod.DescribeRange`.
- Produces (API): `GET .../invoice-sales-detail?period=&from=&to=&search=&fbrStatus=&clientId=` (legacy `year`+`month` still honoured); same on `/excel`.

- [ ] **Step 1: Write the failing live suite**

Create `scripts/test_invoice_sales_detail.py`:

```python
#!/usr/bin/env python3
"""
Invoice Sales Detail -- the period presets, the three filters, and the Excel
that must keep its shape.

Builds two throwaway companies. Company A gets bills this month (one of them
two lines long), last month (then cancelled), earlier this year and last year,
for two buyers; company B gets one bill. Then:

  1. periods   no period = This Month; every preset and a custom range select
               exactly the bills dated inside them; old year+month links work
  2. refusals  All Periods, an unknown preset, a half or backwards range, a bad
               month, an unknown FBR status, an over-long search
  3. filters   customer, FBR status and a BILL-level search, alone and
               together; the buyer list is the whole period's; counts and
               totals are the listed rows'
  4. Excel     the same rows as the screen for the same query, today's 27
               headers, today's file name for a whole month and the dates for
               any other range; one month asked two ways is the same workbook
  5. access    view without export cannot download; another company is 403

Usage:
  python scripts/test_invoice_sales_detail.py [--base URL] [--db "<LOCAL conn>"]

--db marks one bill Submitted to FBR in the LOCAL database, so the FBR status
filter is tested on both sides; without it those checks are skipped.
Everything the suite creates is deleted at the end.
"""
from __future__ import annotations

import argparse
import calendar
import io
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

import openpyxl

PKT = timezone(timedelta(hours=5))

# The workbook's header row exactly as the export writes it. The redesign
# changed the screen only; this pins that the sheet did not move.
EXCEL_HEADERS = [
    "S. No", "Date", "Month", "DC", "DC No", "DC #", "Inv Series",
    "Inv No", "Inv #", "Party Name", "Address", "Ntn", "Hs Code", "Description",
    "Unit", "Qty", "Rate", "Excl", "Tax Rate", "G. S. T", "Incl",
    "236-G / 236-H Tax", "Further Tax", "Total", "FBR Status", "FBR Invoice No", "Bill Status",
]

# Real tariff codes: HS validation is master-first, so an invented code is refused.
HS_VALVE = "8518.2990"
HS_GLASS = "7013.9900"

results: list[tuple[str, str, str]] = []


def http(method, path, base, token=None, body=None, params=None, binary=False):
    url = base.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            if binary:
                return r.status, raw, dict(r.headers)
            text = raw.decode() if raw else ""
            return r.status, (json.loads(text) if text else None), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read() if e.fp else b""
        try:
            return e.code, json.loads(raw.decode()), dict(e.headers or {})
        except Exception:
            return e.code, raw[:300], dict(e.headers or {})


def check(name, ok, detail=""):
    results.append(("PASS" if ok else "FAIL", name, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not ok else ""))
    return ok


def skip(name, why):
    results.append(("SKIP", name, why))
    print(f"  [SKIP] {name}  ({why})")


def month_bounds(d: date) -> tuple[date, date]:
    return d.replace(day=1), d.replace(day=calendar.monthrange(d.year, d.month)[1])


def message(data) -> str:
    return str(data.get("message") if isinstance(data, dict) else data)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5134")
    ap.add_argument("--db", default=None, help="LOCAL connection string, to mark one bill Submitted")
    args = ap.parse_args()
    base = args.base

    st, data, _ = http("POST", "/api/auth/login", base, body={"username": "admin", "password": "admin123"})
    if st != 200:
        print(f"FATAL: admin login failed ({st} {data})")
        return 2
    admin = data["token"]

    def api(method, path, body=None, params=None, token=None, binary=False):
        return http(method, path, base, token or admin, body, params, binary)

    stamp = datetime.now().strftime("%m%d%H%M%S")
    today = datetime.now(PKT).date()
    made_companies: list[int] = []
    made_users: list[int] = []
    made_roles: list[int] = []

    def mk_company(label):
        s, co, _ = api("POST", "/api/companies", {
            "name": f"ZZ ISD {label} {stamp}",
            "startingChallanNumber": 1, "startingInvoiceNumber": 1,
            "startingCreditNoteNumber": 1, "startingDebitNoteNumber": 1,
            "startingPurchaseBillNumber": 1, "startingGoodsReceiptNumber": 1,
            "fbrEnabled": False, "inventoryTrackingEnabled": False, "enableGl": False,
        })
        assert s in (200, 201), f"company {label}: {s} {co}"
        made_companies.append(co["id"])
        return co["id"]

    def mk_client(company, name, ntn=None):
        body = {"companyId": company, "name": name, "registrationType": "Unregistered"}
        if ntn:
            body["ntn"] = ntn
        s, c, _ = api("POST", "/api/clients", body)
        assert s in (200, 201), f"client {name}: {s} {c}"
        return c

    def mk_item(company, label, hs):
        s, it, _ = api("POST", "/api/itemtypes", {
            "name": f"ZZ ISD {label} {stamp}", "hsCode": hs, "uom": "Pcs",
            "companyId": company, "isFavorite": True}, params={"companyId": company})
        assert s in (200, 201), f"item {label}: {s} {it}"
        return it["id"]

    def mk_bill(company, client, when: date, lines):
        s, b, _ = api("POST", "/api/invoices/standalone", {
            "companyId": company, "clientId": client["id"], "date": f"{when.isoformat()}T00:00:00Z",
            "gstRate": 18,
            "items": [{"description": d, "quantity": q, "unitPrice": p, "uom": "Pcs", "itemTypeId": it}
                      for d, q, p, it in lines]})
        assert s in (200, 201), f"bill {when}: {s} {b}"
        return b

    try:
        cid, cid_b = mk_company("A"), mk_company("B")
        alpha = mk_client(cid, f"ZZ ISD Alpha {stamp}", ntn="1234567")
        beta = mk_client(cid, f"ZZ ISD Beta {stamp}")
        other = mk_client(cid_b, f"ZZ ISD Other {stamp}")
        valve, glass = mk_item(cid, "Valve", HS_VALVE), mk_item(cid, "Glass", HS_GLASS)
        other_item = mk_item(cid_b, "Other", HS_GLASS)

        this_first, this_last = month_bounds(today)
        last_month = (this_first - timedelta(days=1)).replace(day=15)
        early_year = min(date(today.year, 1, 10), today)
        last_year = date(today.year - 1, 12, 20)

        b1 = mk_bill(cid, alpha, this_first, [(f"ZZ Valve one {stamp}", 10, 500, valve),
                                              (f"ZZ Valve two {stamp}", 4, 200, valve)])
        b2 = mk_bill(cid, beta, today, [(f"ZZ Glass bowl {stamp}", 2, 1500, glass)])
        b3 = mk_bill(cid, alpha, last_month, [(f"ZZ Valve three {stamp}", 1, 1000, valve)])
        b4 = mk_bill(cid, beta, early_year, [(f"ZZ Glass jug {stamp}", 3, 700, glass)])
        b5 = mk_bill(cid, alpha, last_year, [(f"ZZ Valve four {stamp}", 5, 300, valve)])
        mk_bill(cid_b, other, today, [(f"ZZ Other bill {stamp}", 1, 999, other_item)])
        s, r, _ = api("POST", f"/api/invoices/{b3['id']}/cancel", {"reason": "ZZ ISD test"})
        assert s == 200, f"cancel b3: {s} {r}"

        dated = {"b1": (b1, this_first), "b2": (b2, today), "b3": (b3, last_month),
                 "b4": (b4, early_year), "b5": (b5, last_year)}
        key_of = {b["id"]: k for k, (b, _) in dated.items()}

        submitted = False
        if args.db:
            try:
                import pyodbc
                cn = pyodbc.connect(args.db, timeout=30, autocommit=True)
                cn.cursor().execute(
                    "UPDATE Invoices SET FbrStatus = 'Submitted', FbrIRN = ? WHERE Id = ? AND CompanyId = ?",
                    f"ZZISD{stamp}", b2["id"], cid)
                submitted = True
            except Exception as e:
                print(f"  (could not mark a bill Submitted: {str(e)[:160]})")

        def expect(frm: date, to: date) -> list[str]:
            return sorted(k for k, (_, d) in dated.items() if frm <= d <= to)

        def keys(rep) -> list[str]:
            return sorted({key_of.get(r["invoiceId"], "?") for r in (rep or {}).get("rows", [])})

        def report(params, company=None, token=None):
            s, d, _ = api("GET", f"/api/reports/company/{company or cid}/invoice-sales-detail",
                          params=params, token=token)
            return s, d

        def workbook(params):
            s, blob, headers = api("GET", f"/api/reports/company/{cid}/invoice-sales-detail/excel",
                                   params=params, binary=True)
            return s, (openpyxl.load_workbook(io.BytesIO(blob)) if s == 200 else None), headers

        ALL = {"period": "custom", "from": last_year.isoformat(), "to": today.isoformat()}

        # ══ 1. periods ═══════════════════════════════════════════════════════
        print("\n-- 1. periods --")
        s, d = report({})
        check("no period asked is This Month", s == 200 and keys(d) == expect(this_first, this_last),
              f"{s} {keys(d) if s == 200 else message(d)}")
        check("...and the answer names its dates",
              s == 200 and d["from"][:10] == this_first.isoformat() and d["to"][:10] == this_last.isoformat(),
              f"{(d or {}).get('from')} {(d or {}).get('to')}")
        label = f"{this_first.day} {this_first:%b} {this_first.year} – {this_last.day} {this_last:%b} {this_last.year}"
        check("...labelled the way every report labels a period",
              s == 200 and d["periodLabel"] == label, f"{(d or {}).get('periodLabel')} vs {label}")
        check("...with when it was generated", s == 200 and bool(d.get("generatedAt")))

        q_start = date(today.year, ((today.month - 1) // 3) * 3 + 1, 1)
        q_end = month_bounds(date(q_start.year, q_start.month + 2, 1))[1]
        week_start = today - timedelta(days=today.weekday())
        presets = {
            "thisMonth": (this_first, this_last),
            "lastMonth": month_bounds(this_first - timedelta(days=1)),
            "thisQuarter": (q_start, q_end),
            "thisYear": (date(today.year, 1, 1), date(today.year, 12, 31)),
            "lastYear": (date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)),
            "today": (today, today),
            "thisWeek": (week_start, week_start + timedelta(days=6)),
        }
        for name, (frm, to) in presets.items():
            s, d = report({"period": name})
            check(f"{name} lists the bills dated {frm} to {to}",
                  s == 200 and keys(d) == expect(frm, to), f"{s} {keys(d) if s == 200 else message(d)}")

        s, d = report(ALL)
        check("a custom range lists the bills inside it, both ends included",
              s == 200 and keys(d) == ["b1", "b2", "b3", "b4", "b5"], f"{keys(d) if s == 200 else message(d)}")

        s1, legacy = report({"year": today.year, "month": today.month})
        s2, preset = report({"period": "thisMonth"})
        lines = lambda rep: [(r["invoiceId"], r["lineNumber"], r["total"]) for r in rep["rows"]]
        check("an old year + month link still opens that month",
              s1 == 200 and s2 == 200 and lines(legacy) == lines(preset), f"{s1} {s2}")

        day = {"period": "custom", "from": last_month.isoformat(), "to": last_month.isoformat()}
        s, d = report(day)
        rows = d.get("rows", []) if s == 200 else []
        check("a one-day range lists that day's bill", keys(d) == ["b3"], str(keys(d)))
        check("a cancelled bill stays listed and says so",
              len(rows) == 1 and rows[0]["billStatus"] == "Cancelled", str(rows[:1]))
        check("...and still counts in the bills and the totals, as before",
              s == 200 and d["invoiceCount"] == 1 and d["cancelledCount"] == 1
              and abs(d["total"] - float(b3["grandTotal"])) < 0.005,
              f"{d.get('invoiceCount')} {d.get('cancelledCount')} {d.get('total')} vs {b3.get('grandTotal')}")

        # ══ 2. refusals ══════════════════════════════════════════════════════
        print("\n-- 2. refusals --")
        bad = [
            ({"period": "allPeriods"}, "period"),
            ({"period": "sometime"}, "period"),
            ({"period": "custom", "from": today.isoformat()}, "start and end date"),
            ({"period": "custom", "from": today.isoformat(), "to": last_year.isoformat()}, "on or before"),
            ({"year": today.year, "month": 13}, "valid month"),
            ({"period": "thisMonth", "fbrStatus": "maybe"}, "FBR status"),
            ({"period": "thisMonth", "search": "x" * 101}, "100 characters"),
        ]
        for params, words in bad:
            s, d = report(params)
            check(f"refused: {json.dumps(params)[:60]}",
                  s == 400 and words.lower() in message(d).lower(), f"{s} {message(d)[:90]}")
        s, _, _ = workbook({"period": "allPeriods"})
        check("the Excel route refuses the same", s == 400, str(s))

        # ══ 3. filters ═══════════════════════════════════════════════════════
        print("\n-- 3. filters --")
        s, d = report({**ALL, "clientId": alpha["id"]})
        check("a customer lists only that buyer's bills", s == 200 and keys(d) == ["b1", "b3", "b5"], str(keys(d)))
        buyers = d.get("buyers", []) if s == 200 else []
        check("...while the buyer list still offers every buyer in the period",
              sorted(b["name"] for b in buyers) == sorted([alpha["name"], beta["name"]]), str(buyers))
        check("...each with its id and NTN",
              any(b["clientId"] == alpha["id"] and b.get("ntn") == "1234567" for b in buyers), str(buyers))
        s, d = report({**ALL, "clientId": other["id"]})
        check("another company's buyer matches nothing here",
              s == 200 and d["rows"] == [] and d["invoiceCount"] == 0, f"{s} {keys(d)}")
        s, d = report({**ALL, "search": beta["name"]})
        check("search finds a buyer's bills", s == 200 and keys(d) == ["b2", "b4"], str(keys(d)))
        s, d = report({**ALL, "search": f"valve two {stamp}".upper()})
        check("search is case-blind and BILL-level: a second line brings its whole bill",
              s == 200 and keys(d) == ["b1"] and len(d["rows"]) == 2, f"{keys(d)} {len(d.get('rows', []))}")
        s, d = report({**ALL, "search": HS_GLASS})
        check("search finds an HS code", s == 200 and keys(d) == ["b2", "b4"], str(keys(d)))
        s, d = report({**ALL, "search": "1234567"})
        check("search finds an NTN", s == 200 and keys(d) == ["b1", "b3", "b5"], str(keys(d)))
        s, d = report({**ALL, "search": f"no such thing {stamp}"})
        check("a search that matches nothing lists nothing", s == 200 and d["rows"] == [], str(keys(d)))
        s, d = report({**ALL, "clientId": alpha["id"], "search": f"valve three {stamp}"})
        check("filters combine", s == 200 and keys(d) == ["b3"], str(keys(d)))

        s, d = report({**ALL, "fbrStatus": "notSubmitted"})
        want = ["b1", "b3", "b4", "b5"] if submitted else ["b1", "b2", "b3", "b4", "b5"]
        check("FBR status: not submitted", s == 200 and keys(d) == want, str(keys(d)))
        if submitted:
            s, d = report({**ALL, "fbrStatus": "submitted"})
            check("FBR status: submitted", s == 200 and keys(d) == ["b2"], str(keys(d)))
            check("...showing its FBR invoice number",
                  s == 200 and d["rows"] and d["rows"][0]["fbrInvoiceNumber"] == f"ZZISD{stamp}", str(d.get("rows", [])[:1]))
            s, d = report({**ALL, "search": f"zzisd{stamp}"})
            check("search finds an FBR invoice number", s == 200 and keys(d) == ["b2"], str(keys(d)))
        else:
            for n in ("FBR status: submitted", "...showing its FBR invoice number", "search finds an FBR invoice number"):
                skip(n, "needs --db")

        s, d = report(ALL)
        rows = d["rows"]
        check("counts are the listed bills",
              d["invoiceCount"] == 5 and d["submittedCount"] + d["notSubmittedCount"] == 5
              and d["cancelledCount"] == 1 and d["submittedCount"] == (1 if submitted else 0),
              f"{d['invoiceCount']} {d['submittedCount']} {d['notSubmittedCount']} {d['cancelledCount']}")
        for k in ("excludingTax", "salesTax", "advanceTax", "furtherTax", "total"):
            check(f"the {k} total is the sum of its rows", abs(d[k] - sum(r[k] for r in rows)) < 0.005,
                  f"{d[k]} vs {sum(r[k] for r in rows)}")
        b1_rows = [r for r in rows if r["invoiceId"] == b1["id"]]
        check("a two-line bill is two rows in line order", [r["lineNumber"] for r in b1_rows] == [1, 2], str(b1_rows))
        check("every line's value is its quantity times its rate",
              all(abs(r["excludingTax"] - r["quantity"] * r["rate"]) < 0.005 for r in rows))

        # ══ 4. Excel ═════════════════════════════════════════════════════════
        print("\n-- 4. Excel --")
        for label_, params in [("the whole range", ALL), ("one customer", {**ALL, "clientId": alpha["id"]}),
                               ("a search", {**ALL, "search": beta["name"]}), ("This Month", {"period": "thisMonth"})]:
            _, d = report(params)
            s, wb, _ = workbook(params)
            ws = wb.worksheets[0] if wb else None
            inv = [ws.cell(r, 8).value for r in range(2, ws.max_row)] if ws else None
            check(f"Excel ({label_}) holds the screen's lines in the screen's order",
                  s == 200 and inv == [r["invoiceNumber"] for r in d["rows"]],
                  f"{s} {inv} vs {[r['invoiceNumber'] for r in d.get('rows', [])]}")
            check(f"Excel ({label_}) totals row is the screen's total",
                  ws is not None and ws.cell(ws.max_row, 14).value == "Total listed bills"
                  and abs((ws.cell(ws.max_row, 24).value or 0) - d["total"]) < 0.005,
                  f"{ws.cell(ws.max_row, 14).value if ws else None} {ws.cell(ws.max_row, 24).value if ws else None}")

        s, wb, headers = workbook({"period": "thisMonth"})
        ws = wb.worksheets[0]
        check("the sheet is still called Sales Detail", ws.title == "Sales Detail", ws.title)
        check("the header row is still the same 27 columns",
              [ws.cell(1, c).value for c in range(1, 28)] == EXCEL_HEADERS and ws.max_column == 27,
              str([ws.cell(1, c).value for c in range(1, ws.max_column + 1)]))
        check("the header row is still frozen and filtered", ws.freeze_panes == "A2" and bool(ws.auto_filter.ref),
              f"{ws.freeze_panes} {ws.auto_filter.ref}")
        cd = headers.get("Content-Disposition", "")
        check("a whole month keeps today's file name", f"Invoice-Sales-Detail-{today:%Y-%m}.xlsx" in cd, cd)
        _, _, headers = workbook(ALL)
        cd = headers.get("Content-Disposition", "")
        check("any other range names its dates",
              f"Invoice-Sales-Detail-{last_year.isoformat()}_to_{today.isoformat()}.xlsx" in cd, cd)
        lm = month_bounds(this_first - timedelta(days=1))
        _, _, headers = workbook({"period": "custom", "from": lm[0].isoformat(), "to": lm[1].isoformat()})
        cd = headers.get("Content-Disposition", "")
        check("a custom range that is exactly a month is named for the month",
              f"Invoice-Sales-Detail-{lm[0]:%Y-%m}.xlsx" in cd, cd)
        _, w1, _ = workbook({"year": today.year, "month": today.month})
        _, w2, _ = workbook({"period": "custom", "from": this_first.isoformat(), "to": this_last.isoformat()})
        cells = lambda w: [[c.value for c in row] for row in w.worksheets[0].iter_rows()]
        check("one month asked as year + month or as a range is the same workbook",
              w1 is not None and w2 is not None and cells(w1) == cells(w2))

        # ══ 5. access ════════════════════════════════════════════════════════
        print("\n-- 5. access --")
        role_name, username = f"ZZ ISD viewer {stamp}", f"zzisd{stamp}"
        s, role, _ = api("POST", "/api/roles", {"name": role_name, "description": "invoice sales detail probe (test)",
                                                 "permissionKeys": ["reports.invoicedetail.view"]})
        assert s in (200, 201), f"role {s} {role}"
        made_roles.append(role["id"])
        s, user, _ = api("POST", "/api/users", {"username": username, "password": "test1234", "fullName": username,
                                                 "role": role_name, "roleIds": [role["id"]], "companyIds": [cid]})
        assert s in (200, 201), f"user {s} {user}"
        made_users.append(user["id"])
        s, lg, _ = http("POST", "/api/auth/login", base, body={"username": username, "password": "test1234"})
        assert s == 200, f"viewer login {s} {lg}"
        viewer = lg["token"]
        s, _ = report({"period": "thisMonth"}, token=viewer)
        check("a viewer opens their company's report", s == 200, str(s))
        s, _, _ = api("GET", f"/api/reports/company/{cid}/invoice-sales-detail/excel",
                      params={"period": "thisMonth"}, token=viewer, binary=True)
        check("...cannot download it without the export permission", s == 403, str(s))
        s, _ = report({"period": "thisMonth"}, company=cid_b, token=viewer)
        check("...and cannot open another company's", s == 403, str(s))
    finally:
        for uid in made_users:
            api("DELETE", f"/api/users/{uid}")
        for rid in made_roles:
            api("DELETE", f"/api/roles/{rid}")
        for c in made_companies:
            api("DELETE", f"/api/companies/{c}")

    passed = sum(1 for r in results if r[0] == "PASS")
    failed = [r for r in results if r[0] == "FAIL"]
    skipped = sum(1 for r in results if r[0] == "SKIP")
    print(f"\n{passed}/{passed + len(failed)} checks passed" + (f" ({skipped} skipped)" if skipped else ""))
    for _, name, detail in failed:
        print(f"  FAILED: {name}  {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it against the current build to watch it fail**

Run: `python scripts/test_invoice_sales_detail.py`
Expected: FAIL — "no period asked is This Month" (current route 400s without year/month) and the preset checks.

- [ ] **Step 3: Add the query and response fields**

In `DTOs/InvoiceSalesDetailDtos.cs`, add to `InvoiceSalesDetailReportDto` after `PeriodLabel`:

```csharp
        /// <summary>The first and last day the report covers, both included.</summary>
        public DateTime From { get; set; }
        public DateTime To { get; set; }
        public DateTime GeneratedAt { get; set; }
```

after `NotSubmittedCount`:

```csharp
        public int CancelledCount { get; set; }
```

after `Total`:

```csharp
        /// <summary>
        /// Every buyer with a bill in the PERIOD, before the customer, FBR status
        /// and search filters, so the customer picker never shrinks to the one
        /// customer chosen. Name and NTN only: the rows already show both.
        /// </summary>
        public List<InvoiceSalesDetailBuyerDto> Buyers { get; set; } = new();
```

and two new classes in the namespace:

```csharp
    public class InvoiceSalesDetailBuyerDto
    {
        public int ClientId { get; set; }
        public string Name { get; set; } = "";
        public string Ntn { get; set; } = "";
    }

    /// <summary>
    /// What the Invoice Sales Detail report is asked for. One shape for the
    /// screen and the Excel export, so the two always select the same bills.
    /// </summary>
    public class InvoiceSalesDetailQueryDto
    {
        /// <summary>A <see cref="Helpers.ReportPeriod"/> preset name. Absent: the
        /// legacy <see cref="Year"/> + <see cref="Month"/> when given, else this month.</summary>
        public string? Period { get; set; }
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
        /// <summary>Legacy month selection, honoured only when Period is absent.</summary>
        public int? Year { get; set; }
        public int? Month { get; set; }
        public string? Search { get; set; }
        /// <summary>"submitted" or "notSubmitted"; empty or "all" = no filter.</summary>
        public string? FbrStatus { get; set; }
        public int? ClientId { get; set; }
    }
```

- [ ] **Step 4: Write the filter helper**

Create `Helpers/InvoiceSalesDetailFilter.cs`:

```csharp
using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The period and filters of the Invoice Sales Detail report, resolved ONCE
    /// for the screen and the Excel export, so the two always select the same
    /// bills.
    ///
    /// The period is the shared <see cref="ReportPeriod"/> preset set, resolved on
    /// Pakistan time like every Accounting report, except All Periods: this report
    /// returns every line in one response, so it needs a bounded window. An unknown
    /// preset parses to All Periods and is refused with it. The old Year + Month
    /// pair still works when no preset is given, so a link written before the
    /// presets keeps opening the month it named.
    /// </summary>
    public static class InvoiceSalesDetailFilter
    {
        public const int MaxSearchLength = 100;
        public const string Submitted = "submitted";
        public const string NotSubmitted = "notSubmitted";

        /// <summary>An operator-worded reason the query cannot run, or null.</summary>
        public static string? Validate(InvoiceSalesDetailQueryDto q)
        {
            if (string.IsNullOrWhiteSpace(q.Period))
            {
                if ((q.Year.HasValue || q.Month.HasValue)
                    && (q.Year is not (>= 2000 and <= 2100) || q.Month is not (>= 1 and <= 12)))
                    return "Choose a valid month and year.";
            }
            else
            {
                var preset = ReportPeriod.ParsePreset(q.Period);
                if (preset == ReportDatePreset.AllPeriods)
                    return "Choose a period for this report: this month, this year or a custom range.";
                if (ReportPeriod.Validate(preset, q.From, q.To) is { } err) return err;
            }
            if (!TryParseFbrStatus(q.FbrStatus, out _))
                return "Choose an FBR status of submitted or not submitted.";
            if ((q.Search?.Trim().Length ?? 0) > MaxSearchLength)
                return $"Search is limited to {MaxSearchLength} characters.";
            return null;
        }

        /// <summary>The dates the query covers, both ends included. Call after <see cref="Validate"/>.</summary>
        public static ReportWindow ResolveWindow(InvoiceSalesDetailQueryDto q)
        {
            if (string.IsNullOrWhiteSpace(q.Period) && q.Year.HasValue && q.Month.HasValue)
            {
                var from = new DateTime(q.Year.Value, q.Month.Value, 1);
                var to = from.AddMonths(1).AddDays(-1);
                return new ReportWindow(from, to, ReportPeriod.DescribeRange(from, to));
            }
            var preset = string.IsNullOrWhiteSpace(q.Period)
                ? ReportDatePreset.ThisMonth
                : ReportPeriod.ParsePreset(q.Period);
            return ReportPeriod.Resolve(preset, q.From, q.To);
        }

        /// <summary>"submitted" / "notSubmitted"; empty or "all" = no filter. False = not a status.</summary>
        public static bool TryParseFbrStatus(string? raw, out string? status)
        {
            status = null;
            var v = (raw ?? "").Trim();
            if (v.Length == 0 || v.Equals("all", StringComparison.OrdinalIgnoreCase)) return true;
            if (v.Equals(Submitted, StringComparison.OrdinalIgnoreCase)) { status = Submitted; return true; }
            if (v.Equals(NotSubmitted, StringComparison.OrdinalIgnoreCase)) { status = NotSubmitted; return true; }
            return false;
        }

        /// <summary>
        /// Search is BILL-level: a bill is listed when any of its lines shows the
        /// text in a field the grid displays, so a search never splits a bill.
        /// </summary>
        public static bool RowMatches(InvoiceSalesDetailRowDto r, string term) =>
            Has(r.InvoiceNumber, term) || Has(r.InvoiceSeries + r.InvoiceNumber, term)
            || Has(r.DeliveryChallanNumbers, term) || Has(r.Buyer, term) || Has(r.BuyerNtn, term)
            || Has(r.FbrInvoiceNumber, term) || Has(r.HsCode, term) || Has(r.Description, term);

        /// <summary>
        /// The workbook's file name: a window that is exactly one calendar month
        /// keeps the name the export has always had; any other range names its dates.
        /// </summary>
        public static string ExcelFileName(DateTime from, DateTime to)
        {
            var f = from.Date;
            var wholeMonth = f.Day == 1 && to.Date == f.AddMonths(1).AddDays(-1);
            return wholeMonth
                ? $"Invoice-Sales-Detail-{f:yyyy-MM}.xlsx"
                : $"Invoice-Sales-Detail-{f:yyyy-MM-dd}_to_{to:yyyy-MM-dd}.xlsx";
        }

        private static bool Has(string? field, string term) =>
            !string.IsNullOrEmpty(field) && field.Contains(term, StringComparison.OrdinalIgnoreCase);
    }
}
```

- [ ] **Step 5: Service — take the query, filter, keep every figure as it was**

`IReportService`:

```csharp
        Task<InvoiceSalesDetailReportDto> GetInvoiceSalesDetailAsync(int companyId,
            InvoiceSalesDetailQueryDto query, HashSet<int>? accessibleDivisionIds);
        Task<byte[]> GetInvoiceSalesDetailExcelAsync(int companyId,
            InvoiceSalesDetailQueryDto query, HashSet<int>? accessibleDivisionIds);
```

`ReportService.GetInvoiceSalesDetailAsync` becomes (the per-line loop body is the existing code verbatim, writing to `rows` instead of `report.Rows`):

```csharp
        public async Task<InvoiceSalesDetailReportDto> GetInvoiceSalesDetailAsync(int companyId,
            InvoiceSalesDetailQueryDto query, HashSet<int>? accessibleDivisionIds)
        {
            var window = InvoiceSalesDetailFilter.ResolveWindow(query);
            var from = window.From!.Value.Date;
            var to = window.To!.Value.Date;
            var until = to.AddDays(1);
            InvoiceSalesDetailFilter.TryParseFbrStatus(query.FbrStatus, out var fbrStatus);
            var search = (query.Search ?? "").Trim();
            var company = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => new { Name = c.BrandName ?? c.Name, c.InvoiceNumberPrefix })
                .FirstOrDefaultAsync();
            var invoiceQuery = _context.Invoices.AsNoTracking().AsSplitQuery()
                .Include(i => i.Client).Include(i => i.Items)
                .Where(i => i.CompanyId == companyId && i.Date >= from && i.Date < until
                    && i.NoteKind == 0 && !i.IsDemo);
            if (accessibleDivisionIds != null)
                invoiceQuery = invoiceQuery.Where(i => i.DivisionId == null
                    || accessibleDivisionIds.Contains(i.DivisionId.Value));
            var inPeriod = await invoiceQuery.OrderBy(i => i.Date).ThenBy(i => i.Id).ToListAsync();

            var buyers = inPeriod
                .GroupBy(i => i.ClientId)
                .Select(g => g.First())
                .Select(i => new InvoiceSalesDetailBuyerDto
                {
                    ClientId = i.ClientId, Name = i.Client?.Name ?? "", Ntn = i.Client?.NTN ?? "",
                })
                .OrderBy(b => b.Name, StringComparer.OrdinalIgnoreCase).ThenBy(b => b.ClientId)
                .ToList();

            var invoices = inPeriod
                .Where(i => query.ClientId == null || i.ClientId == query.ClientId.Value)
                .Where(i => fbrStatus == null
                    || IsSubmittedToFbr(i) == (fbrStatus == InvoiceSalesDetailFilter.Submitted))
                .ToList();
            var invoiceIds = invoices.Select(i => i.Id).ToList();
            var challans = await _context.DeliveryChallans.AsNoTracking()
                .Where(c => c.CompanyId == companyId && c.InvoiceId.HasValue
                    && invoiceIds.Contains(c.InvoiceId.Value))
                .Select(c => new { InvoiceId = c.InvoiceId!.Value, c.ChallanNumber })
                .ToListAsync();
            var challansByInvoice = challans.GroupBy(c => c.InvoiceId)
                .ToDictionary(g => g.Key, g => string.Join(", ", g.Select(c => c.ChallanNumber).Distinct().OrderBy(n => n)));

            var report = new InvoiceSalesDetailReportDto
            {
                CompanyId = companyId, CompanyName = company?.Name ?? "", PeriodLabel = window.Label,
                From = from, To = to, GeneratedAt = DateTime.UtcNow, Buyers = buyers,
            };
            var listed = new List<Invoice>();
            foreach (var inv in invoices)
            {
                var rows = new List<InvoiceSalesDetailRowDto>();
                // ... the existing per-invoice body, unchanged, with
                //     report.Rows.Add(new InvoiceSalesDetailRowDto { ... })
                //     written as rows.Add(new InvoiceSalesDetailRowDto { ... })
                if (search.Length > 0 && !rows.Any(r => InvoiceSalesDetailFilter.RowMatches(r, search)))
                    continue;
                report.Rows.AddRange(rows);
                listed.Add(inv);
            }
            report.InvoiceCount = listed.Count;
            report.SubmittedCount = listed.Count(IsSubmittedToFbr);
            report.NotSubmittedCount = listed.Count(i => !IsSubmittedToFbr(i));
            report.CancelledCount = listed.Count(i => i.IsCancelled);
            report.ExcludingTax = report.Rows.Sum(r => r.ExcludingTax);
            report.SalesTax = report.Rows.Sum(r => r.SalesTax);
            report.AdvanceTax = report.Rows.Sum(r => r.AdvanceTax);
            report.FurtherTax = report.Rows.Sum(r => r.FurtherTax);
            report.Total = report.Rows.Sum(r => r.Total);
            return report;
        }

        /// <summary>The one split the report's counts and its FBR status filter share.</summary>
        private static bool IsSubmittedToFbr(Invoice i) =>
            i.FbrStatus == "Submitted" && i.FbrCancelledAt == null;
```

(The previous `InvoiceCount = invoices.Count`, `SubmittedCount = ...`, `NotSubmittedCount = ...` initialisers move below the loop as shown; the "(the existing per-invoice body)" is the current lines 91-130 moved verbatim — it is not re-typed here because it must not change.)

`GetInvoiceSalesDetailExcelAsync`: only its signature and first line change:

```csharp
        public async Task<byte[]> GetInvoiceSalesDetailExcelAsync(int companyId,
            InvoiceSalesDetailQueryDto query, HashSet<int>? accessibleDivisionIds)
        {
            var report = await GetInvoiceSalesDetailAsync(companyId, query, accessibleDivisionIds);
            // ...the workbook code below this line is untouched...
```

- [ ] **Step 6: Controller — one query, validated the same on both routes**

```csharp
        [HttpGet("company/{companyId}/invoice-sales-detail")]
        [HasPermission("reports.invoicedetail.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<InvoiceSalesDetailReportDto>> GetInvoiceSalesDetail(
            int companyId, [FromQuery] InvoiceSalesDetailQueryDto query)
        {
            if (InvoiceSalesDetailFilter.Validate(query) is { } err)
                return BadRequest(new { message = err });
            var divisions = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            return Ok(await _reports.GetInvoiceSalesDetailAsync(companyId, query, divisions));
        }

        [HttpGet("company/{companyId}/invoice-sales-detail/excel")]
        [HasPermission("reports.invoicedetail.export")]
        [AuthorizeCompany]
        public async Task<IActionResult> GetInvoiceSalesDetailExcel(
            int companyId, [FromQuery] InvoiceSalesDetailQueryDto query)
        {
            if (InvoiceSalesDetailFilter.Validate(query) is { } err)
                return BadRequest(new { message = err });
            var divisions = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            var bytes = await _reports.GetInvoiceSalesDetailExcelAsync(companyId, query, divisions);
            var window = InvoiceSalesDetailFilter.ResolveWindow(query);
            return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                InvoiceSalesDetailFilter.ExcelFileName(window.From!.Value, window.To!.Value));
        }
```

- [ ] **Step 7: Build and restart OUR server**

Stop task btcl0y6v9 (ours), then:

```bash
dotnet build MyApp.Api.csproj
```
Expected: `0 Error(s)`. Restart: `ASPNETCORE_ENVIRONMENT=Development dotnet run --no-launch-profile --no-build --urls "http://localhost:5134"` (background).

- [ ] **Step 8: Run the suite**

Run: `python scripts/test_invoice_sales_detail.py --db "Server=.\MSSQLSERVER02;Database=MyApp_Importer_Local;Trusted_Connection=True;TrustServerCertificate=True;"`
Expected: `N/N checks passed`, 0 failed.

- [ ] **Step 9: Prove the Excel did not move (scratch)**

Capture after: `python <scratch>/isd_capture.py --out isd_after_legacy --mode legacy` and `--out isd_after_custom --mode custom`. Compare each with `<scratch>/isd_compare.py isd_baseline isd_after_*`: every workbook identical in sheet names, dimensions, every cell value, number format, bold, fill, wrap, column widths, row heights, freeze panes and autofilter; every JSON row and total identical; file names identical.
Expected: `11/11 workbooks identical` for both modes.

- [ ] **Step 10: Commit**

```bash
git diff --stat
git commit -F <msg> -- DTOs/InvoiceSalesDetailDtos.cs Helpers/InvoiceSalesDetailFilter.cs Services/Interfaces/IReportService.cs Services/Implementations/ReportService.cs Controllers/ReportsController.cs scripts/test_invoice_sales_detail.py
```
Message: `Let Invoice Sales Detail take a period and filters` + a short body (presets as Accounting Reports, All Periods refused, old month links still work, search / FBR status / customer on both routes, Excel builder untouched).

---

### Task 2: Shared report pieces take optional props

**Files:**
- Modify: `myapp-frontend/src/Components/ReportShell.jsx` (extract `ReportHeader`, `TotalsStrip`; export `buildReportHtml`)
- Modify: `myapp-frontend/src/Components/ReportFilterBar.jsx`
- Modify: `myapp-frontend/src/Components/Pagination.jsx`, `myapp-frontend/src/Components/PageSizeSelect.jsx`

**Interfaces:**
- Produces: `export function ReportHeader({ report, onBack, categoryTitle, canExport = false, onExportExcel, subtitle })`
- Produces: `export function TotalsStrip({ totals = {}, totalLabels = {}, notes = {}, compact = false })`
- Produces: `export function buildReportHtml(report)` — honours `report.sourceLabel`
- Produces: `ReportFilterBar` props `periodOptions`, `clientOptions`, `statusOptions`, `statusLabel`, `searchPlaceholder`
- Produces: `Pagination` prop `sizeLabel` (default `"Rows:"`), passed to `PageSizeSelect` as `label`

- [ ] **Step 1: Snapshot an Accounting report before the change**

In the pane (current wwwroot), open `/accounting/reports/sales-detail?period=thisMonth` for Alpha Traders and record: header text, action buttons, tile labels and values, the first tile's computed padding / font size, the table's header cells. Save as `<scratch>/acct_before.json`.

- [ ] **Step 2: Extract `ReportHeader` and `TotalsStrip` inside ReportShell.jsx**

Move the identity + actions block (and `busy` / `doPrint` / `doPdf`) into:

```jsx
/**
 * A report's identity and actions: title, company · period · generated, the
 * filters that shaped it, and Excel / Print / PDF. ReportShell renders it for
 * every accounting report; a screen with its own grid renders it directly, so
 * the two read as one product.
 */
export function ReportHeader({ report, onBack, categoryTitle, canExport = false, onExportExcel, subtitle }) {
  const [busy, setBusy] = useState(null);

  const doPrint = async () => {
    setBusy("print");
    try {
      const w = window.open("", "_blank");
      if (w) writeAndPrint(w, buildReportHtml(report));
    } finally { setBusy(null); }
  };

  const doPdf = async () => {
    setBusy("pdf");
    try {
      // (existing orientation comment kept)
      // exportToPdf adds ".pdf" itself; passing it here saved "X.pdf.pdf".
      await exportToPdf(buildReportHtml(report), slug(report.title), {
        orientation: report.statement ? "portrait" : "landscape",
        sideMarginMm: report.statement ? 12 : 10,
      });
    } finally { setBusy(null); }
  };

  return (
    <div style={st.header}>
      {/* the existing header JSX, verbatim, plus one line under the provenance: */}
      {subtitle && <div style={st.subtitle}>{subtitle}</div>}
    </div>
  );
}

/**
 * The answer first: one tile per total. `compact` is for a screen whose grid
 * needs the height; `notes` puts a short line under a tile's figure.
 */
export function TotalsStrip({ totals = {}, totalLabels = {}, notes = {}, compact = false }) {
  const entries = Object.entries(totals || {});
  if (entries.length === 0) return null;
  return (
    <div style={compact ? st.totalsStripCompact : st.totalsStrip}>
      {entries.map(([key, value]) => {
        // The figure decides its own type size (existing comment kept).
        const shown = isCount(key) ? fmtInt(value) : fmtMoney(value);
        const base = compact ? (isCount(key) ? 1.05 : 1.15) : (isCount(key) ? 1.2 : 1.35);
        return (
          <div key={key} style={compact ? st.totalTileCompact : st.totalTile}>
            <span style={st.totalLabel}>{totalLabels[key] || humanise(key)}</span>
            <span style={{
              ...st.totalValue,
              ...(isCount(key) ? st.totalValueCount : {}),
              ...fitFigure(shown, base),
            }}>
              {shown}
            </span>
            {notes?.[key] && <span style={st.totalNote}>{notes[key]}</span>}
          </div>
        );
      })}
    </div>
  );
}
```

ReportShell's body renders `<ReportHeader report={report} onBack={onBack} categoryTitle={categoryTitle} canExport={canExport} onExportExcel={onExportExcel} />` where the header was, and `{report && <TotalsStrip totals={totals} totalLabels={totalLabels} />}` where the strip was. `buildReportHtml` gains `export` and its source line becomes
`esc(report.sourceLabel || (report.ledgerSourced ? "Source: general ledger" : "Source: payment records (GL posting off)"))`.
New styles:

```js
  subtitle: { marginTop: 4, fontSize: "0.78rem", color: colors.textSecondary, lineHeight: 1.45, maxWidth: 820 },
  totalsStripCompact: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
    gap: "0.6rem", marginBottom: "0.85rem",
  },
  totalTileCompact: {
    display: "flex", flexDirection: "column", gap: 2, minWidth: 0,
    padding: "0.55rem 0.8rem", borderRadius: 12,
    background: "linear-gradient(135deg, rgba(13,71,161,0.06), rgba(0,137,123,0.07))",
    border: `1px solid ${colors.cardBorder}`,
  },
  totalNote: { fontSize: "0.7rem", fontWeight: 600, color: colors.textSecondary },
```

- [ ] **Step 3: ReportFilterBar optional props**

Signature adds `periodOptions = PERIOD_OPTIONS, clientOptions = null, statusOptions = null, statusLabel = null, searchPlaceholder = "Account, description, reference…"`; `const ownClients = Array.isArray(clientOptions);`. The lookup effect fetches clients only when `need(FILTERS.payee) || (need(FILTERS.client) && !ownClients)` (deps `[companyId, wants, ownClients]`); the Customer picker reads `(ownClients ? clientOptions : clients)`; the Status field uses `statusLabel || (isPartyReport ? "Transaction" : "Status")` and `statusOptions || (isPartyReport ? PARTY_STATUS_OPTIONS : STATUS_OPTIONS)`; the period select maps `periodOptions`; the search input takes `placeholder={searchPlaceholder}`; `describeChips` receives `clients: ownClients ? clientOptions : clients` and `statusOptions`, and names a status from `lookups.statusOptions` first. `reset` keeps a custom range:

```js
  const reset = () => {
    const cleared = { period: draft.period || "thisMonth", page: 1, pageSize: draft.pageSize };
    // A custom period IS its dates: clearing the other filters must not strand
    // it without them, or the report refuses to run.
    if (cleared.period === "custom") { cleared.from = draft.from; cleared.to = draft.to; }
    setDraft(cleared);
    onApply(cleared);
  };
```

- [ ] **Step 4: Pagination `sizeLabel`**

`Pagination({ ..., sizeLabel })` passes `label={sizeLabel}` to `PageSizeSelect`; `PageSizeSelect({ value, onChange, options = PAGE_SIZE_OPTIONS, label = "Rows:" })` renders `{label}` instead of the literal `Rows:`.

- [ ] **Step 5: Build, deploy locally, re-snapshot, compare**

`cd myapp-frontend && npm run build`, copy `dist/*` into `wwwroot/`, reload the same Accounting report, record `<scratch>/acct_after.json`.
Expected: identical header text, buttons, tiles, tile styles and table headers.

- [ ] **Step 6: Commit**

`Share the report header and tiles with screens that draw their own grid` — body: ReportHeader / TotalsStrip extracted unchanged, optional filter-bar and pagination props, Clear filters keeps a custom range's dates, PDF name no longer ends ".pdf.pdf".

---

### Task 3: The screen's rules, pure and pinned

**Files:**
- Create: `myapp-frontend/src/utils/invoiceSalesDetail.js`
- Test: `scripts/test_invoice_sales_detail.mjs`

**Interfaces:**
- Consumes: `PERIOD_OPTIONS` from `config/accountingReports.js`
- Produces: `ISD_PERIOD_OPTIONS`, `FBR_STATUS_OPTIONS`, `DEFAULT_PAGE_SIZE`, `PRINT_COLUMNS`, `filtersFromSearch(URLSearchParams)`, `filtersToSearch(filters)`, `toApiParams(filters)`, `groupBills(rows)`, `pageOfBills(bills, page, size)`, `totalsFor(report)`, `sumOf(rows, key)`, `fbrTone(status)`, `fmtQty(n)`, `fmtRate(n)`, `fmtDay(iso)`, `excelFileName(report)`, `filtersApplied(filters, buyers)`, `printEnvelope(report, bills, { filtersApplied, pageNote })`, `emptyText(report, filters)`

- [ ] **Step 1: Write the failing node suite**

`scripts/test_invoice_sales_detail.mjs` — see the file in this commit: one `check` per rule listed in the interface (period list without All Periods; URL round trip; stale range and bad values dropped; API params; grouping and rounding; paging by bill incl. clamping; tiles order and optional taxes; tones; formatting; file names incl. a leap February and a partial month; applied-filter lines; print envelope shape, first-line-only bill fields, cancelled note, page note; empty text).

- [ ] **Step 2: Run to see it fail**

Run: `node scripts/test_invoice_sales_detail.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the util** (full source in the commit)

- [ ] **Step 4: Run to see it pass**

Expected: `N/N checks passed`.

- [ ] **Step 5: Commit** — `Add the Invoice Sales Detail screen rules`

---

### Task 4: The page and its grid

**Files:**
- Modify: `myapp-frontend/src/api/reportApi.js:3-8`
- Rewrite: `myapp-frontend/src/pages/InvoiceSalesDetailPage.jsx`
- Create: `myapp-frontend/src/Components/reports/InvoiceSalesDetailGrid.jsx`
- Create: `myapp-frontend/src/Components/reports/InvoiceSalesDetailGrid.css`

**Interfaces:**
- Consumes: everything Task 2 and Task 3 produce; `getInvoiceSalesDetail(companyId, params)`, `getInvoiceSalesDetailExcel(companyId, params)`
- Produces: `<InvoiceSalesDetailGrid report bills allBillCount loading emptyText />`

- [ ] **Step 1: API helpers take params**

```js
// Invoice Sales Detail — every bill line in the period, filed or not.
// params: { period, from?, to?, search?, fbrStatus?, clientId? } (legacy year + month still accepted)
export const getInvoiceSalesDetail = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/invoice-sales-detail`, { params });

export const getInvoiceSalesDetailExcel = (companyId, params = {}) =>
  http.get(`/reports/company/${companyId}/invoice-sales-detail/excel`, { params, responseType: "blob" });
```

- [ ] **Step 2: Grid + CSS** (desktop table with two header rows, frozen Bill columns, sticky header and totals, bill bands, chips; phone cards) — full source in the commit.

- [ ] **Step 3: Page** (title row + company picker, ReportFilterBar with the optional props, ReportHeader with the one-line note, compact TotalsStrip, grid, Pagination by bill, filters in the URL, customer cleared on company switch, Excel named by `excelFileName`) — full source in the commit.

- [ ] **Step 4: Build and deploy locally**

`cd myapp-frontend && npm run build` (0 errors), copy `dist/*` into `wwwroot/`.

- [ ] **Step 5: Verify in the pane at 1280 / 768 / 375**

Log in by token injection, open `/reports/invoice-sales-detail`:
- default This Month; switch to This Year, Custom range; Apply; chips; Clear filters.
- Customer and FBR status via Filters; search by party / HS; counts and totals match the API.
- desktop: header sticks and Bill columns stay frozen when the box scrolls (scrollTop / scrollLeft then `elementFromPoint`), totals row pinned; bill bands; cancelled chip; tiles.
- paging by bill (set 10 per page on This Year).
- 768: table; 375: cards, no horizontal page overflow, 44px targets.
- Excel downloads (same name as the server); Print and PDF build.
- Console: no errors.

- [ ] **Step 6: Commit** — `Rebuild Invoice Sales Detail on the shared report pieces`

---

### Task 5: Docs, then retire the plan

**Files:**
- Modify: `README.md` (changelog entry under 2026-09-25)
- Modify: `CLAUDE.md` (§5b-16 + a test-table row)
- Delete: this plan and its spec, in their own commit, once everything is verified

- [ ] **Step 1: README + CLAUDE.md**, run `python scripts/verify_no_production_identifiers.py`, commit `Record the Invoice Sales Detail redesign`.
- [ ] **Step 2: Final regression gate**: `dotnet build`, the new suites, `node scripts/test_bill_entry.mjs`, `node scripts/test_gd_costing_entry.mjs`, `python scripts/verify_audit_2026_05_13_security.py`, `python scripts/test_basic_flows.py`.
- [ ] **Step 3: Delete spec + plan**, commit `Remove the Invoice Sales Detail spec and plan now it has shipped`.
