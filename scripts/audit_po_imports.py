"""
Daily PO-import parser audit.

Reads the `GET /api/poimport/archives` endpoint on a target host, groups the
last N days of uploads by `ParseOutcome`, and prints a concise report
highlighting:

  * `no-format`   — fingerprint didn't match any onboarded POFormat
  * `rules-empty` — format matched but rule-set produced 0 items / 0 PO#
  * `unreadable`  — PDF text extraction failed (likely scanned image)
  * `error`       — exception during parse (ErrorMessage column populated)
  * `ok` partials — parsed successfully but ItemsExtracted == 0

For each failure bucket, prints the archive Id, original filename, company,
uploaded-by, and (where present) the matched format + ErrorMessage. The
operator can then hit `GET /api/poimport/archives/{id}/file` to fetch the
original PDF for closer inspection.

Configuration — env vars or CLI flags (CLI wins):
  POAUDIT_API_BASE      e.g. https://hakimitraders.runasp.net
  POAUDIT_USERNAME      admin (or any user with poformats.import.viewArchive)
  POAUDIT_PASSWORD      ...
  POAUDIT_DAYS          how many days back to scan (default 1)
  POAUDIT_PAGE_SIZE     archives page size (default 200; max 200 on server)

NEVER commit real credentials. Use scripts/.env (gitignored) or set the
env vars in the shell. The .example template is the only thing that ships
in the repo.

Usage:
  python scripts/audit_po_imports.py                # last 24h
  python scripts/audit_po_imports.py --days 7       # last week
  python scripts/audit_po_imports.py --outcome no-format
  python scripts/audit_po_imports.py --json         # machine-readable

Exit codes:
  0 — all imports parsed cleanly
  1 — at least one failure / partial in the window
  2 — script-level error (network, auth, etc.)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone


def load_env_file(path: str) -> None:
    """Tiny .env loader — KEY=VALUE per line, # comments, no quoting magic."""
    if not os.path.isfile(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and os.environ.get(k) is None:
                os.environ[k] = v


# Read-only enforcement allowlist. The audit agent is observation-only —
# it must never create / update / delete anything on production. The only
# non-GET request it's allowed to issue is the auth-token fetch, which
# doesn't mutate domain state. Any future edit that adds a new non-GET
# call against a different path will fail loudly here, by design.
#
# User set this guarantee on 2026-05-14: "your agent should only have read
# access to production never ever add any data without my permission".
_ALLOWED_NON_GET = {("POST", "/api/auth/login")}


def assert_readonly_call(method: str, url: str) -> None:
    if method.upper() == "GET":
        return
    path = urllib.parse.urlparse(url).path or ""
    if (method.upper(), path) in _ALLOWED_NON_GET:
        return
    raise SystemExit(
        f"BLOCKED: {method} {path} is not on the read-only allowlist. "
        "This script is read-only by contract — only GET requests + "
        "POST /api/auth/login are permitted. If you need to write to "
        "production, do it through the regular app with operator approval, "
        "not through the audit tooling."
    )


def http_request(method: str, url: str, headers: dict | None = None, body: bytes | None = None, timeout: int = 30):
    """Wraps urllib so we can read both 2xx and 4xx response bodies.
    Enforces the read-only allowlist before touching the network."""
    assert_readonly_call(method, url)
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def login(api_base: str, username: str, password: str) -> str:
    """Return JWT or raise."""
    url = api_base.rstrip("/") + "/api/auth/login"
    body = json.dumps({"username": username, "password": password}).encode("utf-8")
    status, text = http_request("POST", url, {"Content-Type": "application/json"}, body)
    if status != 200:
        raise SystemExit(f"Login failed ({status}): {text[:200]}")
    try:
        return json.loads(text)["token"]
    except Exception as e:
        raise SystemExit(f"Login response missing token: {e}; body={text[:200]}")


def fetch_archives(api_base: str, token: str, days: int, outcome_filter: str | None, page_size: int):
    """Paginate through /api/poimport/archives within the date window."""
    base = api_base.rstrip("/") + "/api/poimport/archives"
    cutoff_from = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    cutoff_to = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    headers = {"Authorization": f"Bearer {token}"}

    all_rows = []
    page = 1
    while True:
        params = {
            "from": cutoff_from,
            "to": cutoff_to,
            "page": page,
            "pageSize": page_size,
        }
        if outcome_filter:
            params["outcome"] = outcome_filter
        url = f"{base}?{urllib.parse.urlencode(params)}"
        status, text = http_request("GET", url, headers)
        if status != 200:
            raise SystemExit(f"GET {url} failed ({status}): {text[:200]}")
        data = json.loads(text)
        rows = data.get("rows") or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        page += 1
        if page > 50:  # 10k row safety cap
            break
    return all_rows


def categorise(rows: list[dict]) -> dict[str, list[dict]]:
    """
    Bucketise by parse outcome. We add a synthetic `partial` bucket for rows
    that are `ok` but extracted zero items — they're "successful" by status
    but the parser produced nothing useful, which is exactly the silent
    failure mode we want to spotlight.
    """
    buckets: dict[str, list[dict]] = {
        "no-format":   [],
        "rules-empty": [],
        "unreadable":  [],
        "error":       [],
        "partial-ok":  [],  # ParseOutcome=ok but ItemsExtracted=0
        "ok":          [],
    }
    for r in rows:
        outcome = (r.get("parseOutcome") or "").lower()
        items = r.get("itemsExtracted") or 0
        if outcome == "ok" and items == 0:
            buckets["partial-ok"].append(r)
        elif outcome in buckets:
            buckets[outcome].append(r)
        else:
            # Unknown outcome — surface under its own key so we don't lose it.
            buckets.setdefault(outcome or "unknown", []).append(r)
    return buckets


def fmt_row(r: dict) -> str:
    return (
        f"  id={r.get('id'):<6}  "
        f"company={r.get('companyId')!s:<5}  "
        f"user={r.get('uploadedByUserId')!s:<5}  "
        f"at={r.get('uploadedAt','')[:19]}  "
        f"format={r.get('matchedFormatId')!s:<5}  "
        f"items={r.get('itemsExtracted',0):<3}  "
        f"\"{(r.get('originalFileName') or '')[:60]}\""
        + (f"  err=\"{r.get('errorMessage')[:80]}\"" if r.get("errorMessage") else "")
    )


def render_report(buckets: dict[str, list[dict]], days: int) -> str:
    out = []
    total = sum(len(v) for v in buckets.values())
    out.append(f"=== PO Import Audit — last {days} day(s) — {total} upload(s) ===\n")
    order = ["no-format", "rules-empty", "unreadable", "error", "partial-ok", "ok"]
    fail_total = 0
    for key in order:
        rows = buckets.get(key) or []
        if key != "ok":
            fail_total += len(rows)
        label = {
            "no-format":   "no-format (no POFormat matched the fingerprint)",
            "rules-empty": "rules-empty (format matched, rules produced 0 items / PO#)",
            "unreadable":  "unreadable (PDF text extraction failed — likely scanned)",
            "error":       "error (exception during parse)",
            "partial-ok":  "partial-ok (parsed OK but 0 items extracted)",
            "ok":          "ok",
        }[key]
        out.append(f"--- {label}: {len(rows)} ---")
        if rows and key != "ok":
            for r in rows[:25]:
                out.append(fmt_row(r))
            if len(rows) > 25:
                out.append(f"  ... and {len(rows) - 25} more")
        out.append("")
    # Unknown buckets (defensive)
    for key in buckets:
        if key in order:
            continue
        out.append(f"--- unknown outcome '{key}': {len(buckets[key])} ---")
        for r in buckets[key][:10]:
            out.append(fmt_row(r))
        out.append("")
    out.append(f"=== Failures + partials in window: {fail_total} ===")
    return "\n".join(out)


# ─────────────────────────────────────────────────────────────────────────
# Validated-state tracking
# ─────────────────────────────────────────────────────────────────────────
# Each successful deep-drill stores the archive id + a SHA fingerprint of
# what was checked into `validated.json` next to the downloaded PDFs.
# Subsequent runs skip ids already in this file, so daily cron jobs only
# spend network/CPU on NEW uploads. Re-running with --force ignores the
# cache and re-checks everything.
#
# Identity = (archive id, contentSha256 if present). We key on archive id
# because that's what the API returns; we ALSO record the sha so an
# accidental archive-id collision (very unlikely; SQL Server identity)
# can't silently mark a different file as already-validated.

VALIDATED_FILENAME = "validated.json"


def _validated_path(save_dir: str) -> str:
    return os.path.join(save_dir, VALIDATED_FILENAME)


def load_validated(save_dir: str) -> dict:
    """Returns {archive_id_as_str: {validatedAt, parserItems, heuristicItems, outcome, contentSha256}}."""
    path = _validated_path(save_dir)
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
        return data.get("entries", {}) if isinstance(data, dict) else {}
    except Exception:
        # Corrupt file → treat as empty rather than crashing the run.
        return {}


def save_validated(save_dir: str, entries: dict) -> None:
    os.makedirs(save_dir, exist_ok=True)
    path = _validated_path(save_dir)
    payload = {
        "schemaVersion": 1,
        "savedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "entries": entries,
    }
    # Atomic-ish write: serialise to a temp file then rename.
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, default=str)
    os.replace(tmp, path)


def mark_validated(entries: dict, archive: dict, parser_items: int, heuristic_items: int) -> None:
    entries[str(archive.get("id"))] = {
        "validatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "parserItems": parser_items,
        "heuristicItems": heuristic_items,
        "outcome": archive.get("parseOutcome"),
        "contentSha256": archive.get("contentSha256"),
        "originalFileName": archive.get("originalFileName"),
    }


def is_validated(entries: dict, archive: dict) -> bool:
    """
    An archive is "validated" if we have a record under its id AND the
    contentSha256 matches what's currently in the production row. The sha
    guard prevents a stale entry from masking a re-uploaded different
    file (extremely unlikely with how POImportController writes archive
    rows, but cheap defence-in-depth).
    """
    rec = entries.get(str(archive.get("id")))
    if not rec:
        return False
    prod_sha = archive.get("contentSha256")
    cached_sha = rec.get("contentSha256")
    # If either side lacks a sha (older rows or older cache), fall back
    # to id-only equality — better than re-drilling unnecessarily.
    if prod_sha and cached_sha and prod_sha != cached_sha:
        return False
    return True


def fetch_archive_row(api_base: str, token: str, archive_id: int) -> dict | None:
    """Pull a single archive row's metadata. Returns None if not found."""
    base = api_base.rstrip("/") + "/api/poimport/archives"
    # The list endpoint is the only metadata path; filter to the desired id.
    # If we ever add a /archives/{id} GET we can switch to it; for now this
    # is a small extra scan that respects the existing read-only API surface.
    page = 1
    while True:
        url = f"{base}?page={page}&pageSize=200"
        status, text = http_request("GET", url, {"Authorization": f"Bearer {token}"})
        if status != 200:
            raise SystemExit(f"GET {url} failed ({status}): {text[:200]}")
        data = json.loads(text)
        rows = data.get("rows") or []
        for r in rows:
            if r.get("id") == archive_id:
                return r
        if len(rows) < 200:
            return None
        page += 1
        if page > 50:
            return None


def download_pdf(api_base: str, token: str, archive_id: int, save_dir: str) -> str:
    """Read-only fetch of the original PDF bytes; saves to disk and returns the local path."""
    url = api_base.rstrip("/") + f"/api/poimport/archives/{archive_id}/file"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"}, method="GET")
    assert_readonly_call("GET", url)  # belt-and-braces
    os.makedirs(save_dir, exist_ok=True)
    out_path = os.path.join(save_dir, f"archive-{archive_id}.pdf")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            if resp.status != 200:
                raise SystemExit(f"PDF download failed: HTTP {resp.status}")
            with open(out_path, "wb") as f:
                f.write(resp.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"PDF download failed: HTTP {e.code} {e.reason}")
    return out_path


def extract_pdf(pdf_path: str) -> dict:
    """
    Independent extraction of the PDF's text + tables using pdfplumber. This
    is *different* code than the .NET parser uses (which sits on pdfium via
    docnet), so divergences between the two are a useful diagnostic signal
    for parser-correctness audits. Returns a dict with `pages` (raw text per
    page) and `tables` (per-page list of row-lists).
    """
    try:
        import pdfplumber  # type: ignore
    except ImportError:
        raise SystemExit(
            "BLOCKED: pdfplumber not installed. Run `pip install pdfplumber` and retry."
        )

    out = {"pages": [], "tables": []}
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            try:
                text = page.extract_text() or ""
            except Exception as e:
                text = f"[extract_text failed: {e}]"
            out["pages"].append(text)
            try:
                tables = page.extract_tables() or []
            except Exception as e:
                tables = [[[f"[extract_tables failed: {e}]"]]]
            # Normalise None cells to empty strings; strip whitespace.
            cleaned = []
            for t in tables:
                rows = []
                for row in t:
                    rows.append([(c.strip() if isinstance(c, str) else "") for c in row])
                cleaned.append(rows)
            out["tables"].append(cleaned)
    return out


def count_heuristic_items(ext: dict) -> int:
    """
    Count rows that look like real line items: a description cell (≥3
    alphabetic chars, predominantly alphabetic) AND a quantity-ish cell
    (plain integer 1..9999, optionally with a trailing decimal like "3.00",
    no thousand separators). This rejects the totals/subtotals side-bar.
    Pure function so both render_drill and validation can share it.
    """
    def looks_like_item_row(row: list) -> bool:
        has_desc = False
        has_qty = False
        for cell in row:
            s = (cell or "").strip()
            if not s:
                continue
            letters = sum(1 for ch in s if ch.isalpha())
            digits = sum(1 for ch in s if ch.isdigit())
            if letters >= 3 and letters > digits:
                has_desc = True
            elif "," not in s:
                head = s.split(".", 1)[0].strip()
                if head.isdigit() and 1 <= int(head) <= 9999:
                    has_qty = True
        return has_desc and has_qty

    total = 0
    for page_tables in ext.get("tables", []):
        for table in page_tables:
            for row in table[1:]:  # skip header
                if looks_like_item_row(row):
                    total += 1
    return total


def render_drill(archive: dict, pdf_path: str, ext: dict, heuristic_items: int) -> str:
    """Side-by-side: archive metadata + parser's reported count + PDF text + table dump."""
    lines = []
    a = archive
    lines.append(f"=== Drill — archive id {a.get('id')} ===")
    lines.append(f"  File           : {a.get('originalFileName')}")
    lines.append(f"  Company        : {a.get('companyId')}    Uploaded-by user: {a.get('uploadedByUserId')}")
    lines.append(f"  Uploaded at    : {a.get('uploadedAt','')[:19]}    Parse {a.get('parseDurationMs')}ms")
    lines.append(f"  Outcome        : {a.get('parseOutcome')}    Matched format: {a.get('matchedFormatId')} v{a.get('matchedFormatVersion')}")
    lines.append(f"  Parser items   : {a.get('itemsExtracted', 0)}")
    if a.get("errorMessage"):
        lines.append(f"  Error          : {a.get('errorMessage')}")
    lines.append(f"  Saved PDF      : {pdf_path}")
    lines.append("")
    total_rows = sum(len(t) for page_tables in ext["tables"] for t in page_tables)
    lines.append(f"--- pdfplumber: {len(ext['pages'])} page(s), {total_rows} total table-row(s) extracted independently ---")
    for i, page_text in enumerate(ext["pages"], 1):
        lines.append(f"\n  [Page {i} text — first 30 lines] ----------------------------")
        for ln in (page_text or "").splitlines()[:30]:
            lines.append(f"    {ln}")
    for pi, page_tables in enumerate(ext["tables"], 1):
        for ti, table in enumerate(page_tables, 1):
            lines.append(f"\n  [Page {pi} table #{ti} — {len(table)} rows] ---------------------------")
            for row in table[:30]:
                # Trim each cell to keep the row width sane on terminal.
                cells = [(c[:40] if len(c) > 40 else c) for c in row]
                lines.append(f"    | " + " | ".join(cells) + " |")
            if len(table) > 30:
                lines.append(f"    ... and {len(table) - 30} more row(s)")
    lines.append("")
    # Quick heuristic verdict: the .NET parser said items=N; pdfplumber
    # sees `heuristic_items` rows that match a "description + small-integer
    # quantity" signature. Treat divergence as a "look here" prompt, not a
    # verdict — the operator reads the actual table dump above.
    lines.append(f"  Quick verdict  : parser reported {a.get('itemsExtracted', 0)} item(s); "
                 f"pdfplumber sees ~{heuristic_items} item-shaped row(s) (description + small-integer qty)")
    if a.get("itemsExtracted", 0) > 0 and a.get("itemsExtracted") != heuristic_items:
        lines.append("  HEURISTIC FLAG  Counts diverge - eyeball the table rows above to confirm.")
    return "\n".join(lines)


def main() -> int:
    # Load .env from script dir and repo root if present (script dir wins).
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    load_env_file(os.path.join(repo_root, ".env"))
    load_env_file(os.path.join(script_dir, ".env"))

    ap = argparse.ArgumentParser(description="Daily PO-import parser audit")
    ap.add_argument("--api-base", default=os.environ.get("POAUDIT_API_BASE", "http://localhost:5134"))
    ap.add_argument("--username", default=os.environ.get("POAUDIT_USERNAME", "admin"))
    ap.add_argument("--password", default=os.environ.get("POAUDIT_PASSWORD"))
    ap.add_argument("--days", type=int, default=int(os.environ.get("POAUDIT_DAYS", "1")))
    ap.add_argument("--outcome", default=None,
                    help="Filter at server: ok|no-format|rules-empty|unreadable|error")
    ap.add_argument("--page-size", type=int, default=int(os.environ.get("POAUDIT_PAGE_SIZE", "200")))
    ap.add_argument("--json", action="store_true", help="Print machine-readable JSON instead of text")
    # Drill mode: read-only deep inspection of an existing archive row. Pulls
    # the PDF over GET /archives/{id}/file (read-only, allowlist-permitted),
    # saves it under data/po-audit/, runs an INDEPENDENT text + table
    # extraction with pdfplumber, then prints both the archive metadata and
    # the raw item rows so the operator can compare what the .NET parser
    # extracted (ItemsExtracted count) against what's actually in the PDF.
    ap.add_argument("--drill", type=int, default=None, metavar="ARCHIVE_ID",
                    help="Deep-inspect a single archive: download PDF + dump items via pdfplumber")
    ap.add_argument("--drill-all", action="store_true",
                    help="Deep-inspect EVERY archive row in the window (heavier; one PDF download each)")
    ap.add_argument("--save-dir", default=os.environ.get("POAUDIT_SAVE_DIR", "data/po-audit"),
                    help="Where to save downloaded PDFs + extracted text (gitignored under data/)")
    # Validation-state controls. Default behaviour: skip ids we've already
    # deep-drilled in a prior run (tracked in <save-dir>/validated.json).
    ap.add_argument("--force", action="store_true",
                    help="Re-drill even if the archive is already in validated.json")
    ap.add_argument("--show-validated", action="store_true",
                    help="Print the current validated.json state and exit")
    ap.add_argument("--reset-validated", action="store_true",
                    help="Delete validated.json so the next run re-drills everything")
    args = ap.parse_args()

    # --reset-validated / --show-validated short-circuits that don't need auth.
    if args.reset_validated:
        path = _validated_path(args.save_dir)
        if os.path.isfile(path):
            os.remove(path)
            print(f"Removed {path}. Next run will re-drill every archive.")
        else:
            print(f"Nothing to remove — {path} doesn't exist.")
        return 0

    if args.show_validated:
        entries = load_validated(args.save_dir)
        if not entries:
            print(f"No validated entries (state file: {_validated_path(args.save_dir)}).")
            return 0
        print(f"=== Validated entries — {len(entries)} ===")
        for aid, rec in sorted(entries.items(), key=lambda kv: int(kv[0])):
            agreement = "agree" if rec.get("parserItems") == rec.get("heuristicItems") else "DIVERGE"
            print(f"  id={aid:<4}  at={rec.get('validatedAt','')[:19]}  "
                  f"parser={rec.get('parserItems')}  heuristic={rec.get('heuristicItems')}  "
                  f"{agreement}  outcome={rec.get('outcome')}  file=\"{rec.get('originalFileName','')[:50]}\"")
        return 0

    if not args.password:
        print("ERR: POAUDIT_PASSWORD env var or --password is required.", file=sys.stderr)
        return 2

    try:
        token = login(args.api_base, args.username, args.password)
    except SystemExit as e:
        print(str(e), file=sys.stderr)
        return 2

    # Load validation cache once for both drill paths.
    validated = load_validated(args.save_dir)

    # Single-archive drill mode — short-circuit the daily audit and inspect one row.
    if args.drill is not None:
        archive = fetch_archive_row(args.api_base, token, args.drill)
        if not archive:
            print(f"ERR: archive id {args.drill} not found.", file=sys.stderr)
            return 2
        if is_validated(validated, archive) and not args.force:
            cached = validated[str(archive["id"])]
            print(f"=== archive id {archive['id']} already validated at {cached.get('validatedAt')} "
                  f"(parser={cached.get('parserItems')}, heuristic={cached.get('heuristicItems')}) — "
                  f"skipping drill. Pass --force to re-check.")
            return 0
        pdf_path = download_pdf(args.api_base, token, args.drill, args.save_dir)
        ext = extract_pdf(pdf_path)
        h = count_heuristic_items(ext)
        print(render_drill(archive, pdf_path, ext, h))
        mark_validated(validated, archive, archive.get("itemsExtracted", 0), h)
        save_validated(args.save_dir, validated)
        return 0

    t0 = time.time()
    rows = fetch_archives(args.api_base, token, args.days, args.outcome, args.page_size)
    elapsed = time.time() - t0

    # Drill-all: deep-inspect every row in the window after the summary.
    # Heavy (one PDF download each) so only run on a narrow window.
    # Default behaviour skips ids already in validated.json so daily runs
    # only spend time on NEW uploads.
    if args.drill_all:
        if not args.force:
            originally = len(rows)
            rows = [r for r in rows if not is_validated(validated, r)]
            skipped = originally - len(rows)
            if skipped:
                print(f"Skipping {skipped} archive(s) already in validated.json. "
                      f"Run with --force to re-drill those too.\n")
        if len(rows) > 50:
            print(f"WARN: --drill-all on {len(rows)} rows is heavy; narrow with --days or --outcome.")
        if not rows:
            print("Nothing new to drill — all archives in this window are already validated.")
            return 0
        for r in rows:
            try:
                pdf_path = download_pdf(args.api_base, token, r["id"], args.save_dir)
                ext = extract_pdf(pdf_path)
                h = count_heuristic_items(ext)
                print(render_drill(r, pdf_path, ext, h))
                print("\n" + "=" * 80 + "\n")
                mark_validated(validated, r, r.get("itemsExtracted", 0), h)
                # Persist after each row so an interrupted run doesn't
                # forget already-completed work.
                save_validated(args.save_dir, validated)
            except Exception as ex:  # keep going on per-row failure
                print(f"  [drill {r.get('id')}] failed: {ex}")
        return 0

    buckets = categorise(rows)
    fail_total = sum(len(v) for k, v in buckets.items() if k != "ok")

    if args.json:
        payload = {
            "apiBase": args.api_base,
            "days": args.days,
            "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "fetchSeconds": round(elapsed, 2),
            "total": len(rows),
            "failures": fail_total,
            "buckets": {k: v for k, v in buckets.items()},
        }
        print(json.dumps(payload, indent=2, default=str))
    else:
        print(render_report(buckets, args.days))
        print(f"\n(fetched in {elapsed:.2f}s from {args.api_base})")

    return 0 if fail_total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
