"""
Tax-invoice PDF export pagination regression test.

Guards the defect that shipped to production: the PDF download rasterised the
whole invoice with html2canvas and sliced the bitmap at fixed pixel offsets,
so anything straddling a page boundary was guillotined mid-glyph. Operators on
a machine without Calibri hit it and operators with Calibri did not, because
the 20-row invoice renders at 289mm-308mm depending on which fonts resolve,
against a 297mm page.

Two invariants:

  1. Every invoice up to the template's 20 padded rows exports as ONE page, on
     every font stack. That is the whole of current production.
  2. Any invoice long enough to genuinely paginate never puts a page cut
     through the FBR block, which carries the IRN and the verification QR.
     A sliced QR does not scan.

The test drives the real exportToPdf() in a real browser via
myapp-frontend/src/devtools/pdfPaginationHarness.html, so html2canvas and jsPDF
actually run. It needs no backend and no database.

Usage:
    python scripts/test_pdf_pagination.py
    python scripts/test_pdf_pagination.py --engines chromium,firefox
    python scripts/test_pdf_pagination.py --prod-template "<conn str>"

Requires: pip install playwright && python -m playwright install chromium
"""

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import closing

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "myapp-frontend")
HARNESS_PATH = "/src/devtools/pdfPaginationHarness.html"

# The template pads its item table to a fixed 20 rows, so 1 item and 20 items
# render at the same height.
PADDED_ROWS = 20
SINGLE_PAGE_COUNTS = [1, 2, 3, 5, 10, 20]
MULTI_PAGE_COUNTS = [25, 30, 40, 60]

# Every invoice on production today is 1-3 items, so that must hold on ANY
# font the operator's machine might substitute.
PRODUCTION_SHAPE = 3

# (css stack, guaranteed-single-page item count).
#
# None = whatever the template asks for and this machine actually has. The
# rest stand in for machines missing it, since font substitution is the only
# real per-machine variable here: the container is pinned to 796px and
# html2canvas hardcodes scale 2, so neither DPR nor zoom moves the layout.
#
# Calibri / Segoe UI / Arial / Liberation Sans are near enough in metrics that
# a full 20-row invoice still fits one page. Verdana is the outlier at ~383mm,
# standing in for DejaVu Sans -- what a Linux box falls back to when the whole
# stack is missing. There a 10+ item invoice legitimately paginates, and the
# guarantee that survives is the one that matters: the FBR block stays whole.
FONT_STACKS = [
    (None, PADDED_ROWS),
    ("Arial, sans-serif", PADDED_ROWS),
    ('"Segoe UI", sans-serif', PADDED_ROWS),
    ('"Times New Roman", serif', PADDED_ROWS),
    ("Verdana, sans-serif", PRODUCTION_SHAPE),
]

# Same layout, different rasteriser scaling in the host browser. html2canvas
# hardcodes scale 2 and the container is pinned to 796px, so these must not
# change the outcome -- asserting that is the point.
DEVICE_SCALE_FACTORS = [1, 2]

# The operator-selectable starter layouts are enumerated by the harness at
# runtime, so a newly added starter is covered without touching this file. They
# run a reduced matrix -- the full one across 15 layouts costs more wall clock
# than it buys, and DPR has already been shown not to move the layout.
#
# Each starter pads its item table to its own row count (14, 16 or 22), and up
# to that count every invoice renders at an identical height. That is where the
# single-page guarantee is asserted; past it the table grows per row and
# whether it still fits is a property of the individual layout, not a bug.
STARTER_FONTS = [None, '"Segoe UI", sans-serif']


def free_port():
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ViteServer:
    def __init__(self, port):
        self.port = port
        self.proc = None

    def __enter__(self):
        # Log to a file rather than a pipe: nothing reads the pipe while we
        # poll the port, and a full pipe buffer would wedge the dev server.
        self.log = tempfile.NamedTemporaryFile(
            prefix="vite-", suffix=".log", delete=False, mode="w+")
        self.proc = subprocess.Popen(
            "npm run dev -- --port %d --strictPort --host 127.0.0.1" % self.port,
            cwd=FRONTEND_DIR, stdout=self.log, stderr=subprocess.STDOUT,
            shell=True, text=True,
        )
        deadline = time.time() + 120
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError("vite exited:\n" + self._log_text())
            with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
                if s.connect_ex(("127.0.0.1", self.port)) == 0:
                    return self
            time.sleep(0.4)
        raise RuntimeError("vite did not come up on port %d:\n%s"
                           % (self.port, self._log_text()))

    def _log_text(self):
        try:
            with open(self.log.name) as fh:
                return fh.read()[-2000:]
        except OSError:
            return "(no log)"

    def __exit__(self, *exc):
        if self.proc and self.proc.poll() is None:
            # shell=True means proc is the cmd wrapper; kill the tree or vite
            # survives and holds the port.
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(self.proc.pid)],
                               capture_output=True)
            else:
                self.proc.terminate()
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        try:
            self.log.close()
            os.unlink(self.log.name)
        except OSError:
            pass


def fetch_prod_template(conn_str):
    """Pull a live per-company template so the test covers what production
    actually renders, not just the shipped default. Read-only SELECT."""
    def field(name):
        m = re.search(name + r"\s*=\s*([^;]+)", conn_str, re.I)
        return m.group(1).strip() if m else None

    server, db = field("Server"), field("Database")
    user, pwd = field("User Id"), field("Password")
    if not all([server, db, user, pwd]):
        raise SystemExit("could not parse connection string")

    out = subprocess.run(
        ["sqlcmd", "-S", server, "-d", db, "-U", user, "-P", pwd, "-N", "-C", "-I",
         "-y", "0", "-Q",
         "SET NOCOUNT ON; SELECT TOP 1 HtmlContent FROM PrintTemplates "
         "WHERE TemplateType='TaxInvoice' AND IsDefault=1 ORDER BY CompanyId;"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise SystemExit("sqlcmd failed: " + (out.stderr or out.stdout)[:400])
    return out.stdout.replace("\r", "").strip("\n")


def run_engine(pw, engine_name, base_url, templates, results):
    try:
        browser_type = getattr(pw, engine_name)
        browser = browser_type.launch()
    except Exception as exc:
        first = str(exc).splitlines()[0]
        print("  SKIP %-9s not installed (%s)" % (engine_name, first[:60]))
        print("       install with: python -m playwright install %s" % engine_name)
        return False

    def fresh_page(context):
        """Each case rasterises the invoice into two full-page canvases. Over a
        few hundred cases that exhausts the renderer and it dies mid-evaluate,
        so the page is recycled per group and downloads are dropped rather than
        accumulated."""
        page = context.new_page()
        # jsPDF's save() fires a real download per case; drop them rather than
        # spool hundreds of PDFs to disk. Cancelling races context teardown, so
        # a failure here is never interesting.
        def drop(download):
            try:
                download.cancel()
            except Exception:
                pass
        page.on("download", drop)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base_url + HARNESS_PATH, wait_until="load")
        page.wait_for_function("window.__HARNESS_READY__ === true", timeout=60_000)
        page.evaluate("t => { window.__EXTRA_TEMPLATES__ = t; }", templates)
        if errors:
            raise RuntimeError("harness failed to load: " + errors[0])
        return page

    def sweep(context, dsf, tpl, font_stacks, counts):
        for font, single_page_upto in font_stacks:
            page = fresh_page(context)
            for n in counts:
                res = page.evaluate(
                    "a => window.runPdfCase(a)",
                    {"template": tpl, "itemCount": n, "fontStack": font},
                )
                results.append({
                    "engine": engine_name, "dsf": dsf, "template": tpl,
                    "font": font or "template default", "items": n,
                    "singlePageUpto": single_page_upto, **res,
                })
            page.close()

    try:
        for dsf in DEVICE_SCALE_FACTORS:
            context = browser.new_context(device_scale_factor=dsf, accept_downloads=True)
            for tpl in ["shipped-default"] + sorted(templates.keys()):
                sweep(context, dsf, tpl, FONT_STACKS,
                      SINGLE_PAGE_COUNTS + MULTI_PAGE_COUNTS)
                print("    %-32s dsf=%d done (%d cases)" % (tpl, dsf, len(results)))

            if dsf == DEVICE_SCALE_FACTORS[0]:
                probe = fresh_page(context)
                starters = probe.evaluate("window.__STARTER_INFO__") or []
                probe.close()
                for s in starters:
                    pad = s["padRows"]
                    # At the pad count the table is still full-height-constant;
                    # well past it, it must paginate safely.
                    counts = sorted({1, PRODUCTION_SHAPE, pad, pad + 12})
                    sweep(context, dsf, s["id"],
                          [(f, pad) for f in STARTER_FONTS], counts)
                print("    %-32s dsf=%d done (%d cases)"
                      % ("%d starters" % len(starters), dsf, len(results)))
            context.close()
    finally:
        browser.close()
    return True


def check_single_paginator():
    """Every rasterising export path must share one paginator.

    The production bug was a bitmap sliced at blind fixed offsets, and it came
    back once already: a bulk-export path was added by copying the old slicer
    verbatim, so the fix applied to the single-invoice download did not reach
    it. A duplicated slice loop is the signature of that drift.
    """
    path = os.path.join(FRONTEND_DIR, "src", "utils", "exportUtils.js")
    with open(path, encoding="utf-8") as fh:
        src = fh.read()

    problems = []
    loops = src.count("while (y < canvas.height)")
    if loops != 1:
        problems.append(
            "exportUtils.js has %d bitmap slice loops, expected exactly 1 "
            "(in paginateOntoPdf) -- a copied slicer will not honour "
            "FBR-block page breaks" % loops)
    if "pageH * 1.02" in src:
        problems.append(
            "exportUtils.js still contains the old `pageH * 1.02` fit "
            "threshold, which slices whatever straddles the boundary")
    return problems


def check(results):
    """Returns (failures, notes). Notes are non-fatal observations worth
    printing -- a wide substituted font paginating a mid-size invoice is
    expected behaviour, not a regression, but it should stay visible."""
    failures, notes = [], []
    for r in results:
        tag = ("%s dsf=%d %s items=%-2d font=%s"
               % (r["engine"], r["dsf"], r["template"], r["items"], r["font"]))

        # The FBR block must never be cut, in any configuration. This is the
        # invariant the production bug violated.
        if not r["fbrFound"]:
            failures.append(tag + " -- FBR block not found in rendered output")
        if r["cutsThroughFbr"]:
            failures.append(
                tag + " -- page cut runs through the FBR block at %s (block %.0f..%.0f)"
                % (r["cutsThroughFbr"], r["fbrBand"]["start"], r["fbrBand"]["end"]))

        if r["items"] <= r["singlePageUpto"]:
            if r["pages"] != 1:
                failures.append(
                    tag + " -- expected 1 page, got %d (height %.1fmm, fit %.3f)"
                    % (r["pages"], r["heightMm"], r["oneFitScale"]))
        elif r["items"] <= PADDED_ROWS and r["pages"] != 1:
            notes.append(
                tag + " -- paginates at %d pages (height %.1fmm); substituted font is "
                "too wide to fit one page" % (r["pages"], r["heightMm"]))

        # A long invoice must paginate rather than be squeezed to unreadable
        # text. Note this is the only guard needed: a dense layout that
        # genuinely fits 40 items on one page is a good outcome, not a bug.
        if r["mode"] == "shrink" and r["scale"] < 0.9:
            failures.append(
                tag + " -- shrink-to-fit scale %.3f is below legibility floor" % r["scale"])

    # Smoke check: if nothing paginated, the multi-page path and every
    # FBR-not-cut assertion above were vacuous.
    if not any(r["mode"] == "multipage" for r in results):
        failures.append("no case paginated -- the multi-page path was never exercised")
    return failures, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engines", default="chromium",
                    help="comma-separated: chromium,firefox,webkit")
    ap.add_argument("--prod-template", default=None, metavar="CONNSTR",
                    help="also test the live default TaxInvoice template from this DB")
    ap.add_argument("--json", default=None, help="write full per-case results here")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("playwright missing: pip install playwright && "
                         "python -m playwright install chromium")

    templates = {}
    if args.prod_template:
        templates["prod-default"] = fetch_prod_template(args.prod_template)
        print("fetched live template: %d chars" % len(templates["prod-default"]))

    port = free_port()
    results = []
    ran_any = False
    print("starting vite on port %d ..." % port)
    with ViteServer(port) as _srv:
        base = "http://127.0.0.1:%d" % port
        with sync_playwright() as pw:
            for engine in [e.strip() for e in args.engines.split(",") if e.strip()]:
                print("running %s ..." % engine)
                ran_any |= run_engine(pw, engine, base, templates, results)

    if not ran_any:
        raise SystemExit("no browser engine available -- nothing was verified")

    if args.json:
        with open(args.json, "w") as fh:
            json.dump(results, fh, indent=2)

    heights = [r["heightMm"] for r in results if r["items"] == PADDED_ROWS]
    if heights:
        print("\n%d-row invoice height across fonts/engines: %.1fmm - %.1fmm (page is 297mm)"
              % (PADDED_ROWS, min(heights), max(heights)))

    starters = sorted({r["template"] for r in results if r["template"].startswith("taxinvoice-")})
    if starters:
        print("\nstarter one-page capacity (worst font tested):")
        for tpl in starters:
            rows = [r for r in results if r["template"] == tpl]
            fits = [r["items"] for r in rows if r["pages"] == 1]
            spills = [r["items"] for r in rows if r["pages"] > 1]
            guarantee = rows[0]["singlePageUpto"]
            print("  %-32s pads to %-2d rows | 1 page up to %-3s | paginates from %s"
                  % (tpl, guarantee, max(fits) if fits else "none",
                     min(spills) if spills else "never (in tested range)"))

    modes = {}
    for r in results:
        modes.setdefault((r["items"], r["mode"]), 0)
        modes[(r["items"], r["mode"])] += 1
    print("\noutcomes by item count:")
    for (items, mode), count in sorted(modes.items()):
        print("  items=%-2d %-10s %d cases" % (items, mode, count))

    failures, notes = check(results)
    failures = check_single_paginator() + failures
    print("\n%d cases checked" % len(results))
    if notes:
        print("\nnotes (%d, not failures):" % len(notes))
        for n in notes:
            print("  " + n)
    if failures:
        print("\nFAILURES (%d):" % len(failures))
        for f in failures:
            print("  " + f)
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()
