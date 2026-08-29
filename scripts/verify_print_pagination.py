"""Prove the signature prints at the bottom of EVERY page, for every template.

Renders each case produced by scripts/print_templates/pagination_render.mjs
through real Chrome print-to-PDF -- the same Blink print pipeline the app uses
(utils/printDocument.js opens a popup and calls w.print(); there is no
server-side PDF library) -- then measures the resulting page geometry.

Per case it asserts:
  signature_every_page  the signature block appears on every printed page
  pinned_to_bottom      it sits at the page bottom on every page, at the same
                        offset (so it is genuinely pinned, not just trailing
                        the content)
  no_overlap            no other glyph shares its vertical band
  no_blank_rows         the merged HTML has no filler <tr> after the real items

Usage (from repo root):
    python scripts/verify_print_pagination.py <caseDir> [--jobs N] [--baseline]

--baseline relaxes the assertions to a report: it is how the pre-fix behaviour
was measured for the before/after matrix, and is expected to fail.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

import pdfplumber

# The harness paints every glyph inside the pinned signature this colour, and
# nothing else on the page uses it. The signature is located by that ink rather
# than by marker spans: an absolutely-positioned marker inside a repeated
# position:fixed element is NOT painted consistently by Blink on pages after the
# first (observed bands like 785.1..56.6), so markers cannot be trusted here.
FOOTER_INK = (2 / 255.0, 251 / 255.0, 7 / 255.0)
# PDF text colour is exact, so this only has to absorb float noise. It must stay
# far below the distance to black: an earlier 0.02 was wider than the gap
# between a near-black marker and #000, so every black glyph read as signature
# ink and the whole page looked like one enormous signature.
INK_TOLERANCE = 0.002
# Legacy marker text, ignored when present so it cannot skew the band.
PROBE_TEXT = ("ZQTOPZQ", "ZQBOTZQ")

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]

# A pinned signature sits within this many points of the page bottom. The
# templates' @page bottom margins run from 0 to 16mm (45pt); the allowance
# covers that plus the block's own height.
MAX_GAP_PT = 210.0
# Page-to-page variation in that offset. Anything above this means the block is
# trailing the content on some page rather than being pinned.
MAX_GAP_SPREAD_PT = 2.0


def find_chrome() -> str:
    for path in CHROME_CANDIDATES:
        if os.path.exists(path):
            return path
    raise SystemExit("no Chrome/Edge binary found - cannot print-to-PDF")


def render(chrome: str, html: str, pdf: str, time_budget_ms: int = 800) -> str | None:
    """Print one page to PDF. Returns an error string, or None on success."""
    if os.path.exists(pdf):
        os.remove(pdf)
    profile = tempfile.mkdtemp(prefix="chr_")
    cmd = [
        chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        "--disable-background-networking", "--disable-sync",
        "--no-pdf-header-footer", "--virtual-time-budget=%d" % time_budget_ms,
        "--user-data-dir=" + profile,
        "--print-to-pdf=" + pdf,
        "file:///" + os.path.abspath(html).replace("\\", "/"),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return "chrome timeout"
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if not os.path.exists(pdf):
        return "no pdf produced: " + (proc.stderr or "")[-200:]
    return None


def is_footer_ink(char):
    colour = char.get("non_stroking_color")
    if not colour or len(colour) < 3:
        return False
    return all(abs(float(colour[i]) - FOOTER_INK[i]) <= INK_TOLERANCE for i in range(3))


def signature_band(chars):
    """(top, bottom) of the signature's ink on this page, or None if absent.

    Reads raw glyphs, not extract_words(): a footer painted over table text is
    clustered into the surrounding words and drops out of the word list, which
    would read as "no footer on this page" when it is plainly there.
    """
    ordered = sorted(chars, key=lambda c: (round(c["top"], 1), c["x0"]))
    raw, owner = [], []
    for c in ordered:
        for ch in c["text"]:
            raw.append(ch)
            owner.append(c)
    text = "".join(raw)
    skip = set()
    for marker in PROBE_TEXT:
        start = text.find(marker)
        while start >= 0:
            skip.update(id(o) for o in owner[start:start + len(marker)])
            start = text.find(marker, start + 1)
    ink = [c for c in chars if is_footer_ink(c) and id(c) not in skip and c["text"].strip()]
    if not ink:
        return None
    # `skip` (harness marker glyphs) is folded in so the overlap check does not
    # mistake the harness's own text for a stray line item.
    return min(c["top"] for c in ink), max(c["bottom"] for c in ink), {id(c) for c in ink} | skip


def check(pdf_path: str, case: dict) -> dict:
    out = {
        "case": case["case"], "pages": 0, "signature_every_page": False,
        "pinned_to_bottom": False, "no_overlap": True, "gaps": [], "detail": "",
    }
    with pdfplumber.open(pdf_path) as pdf:
        out["pages"] = len(pdf.pages)
        missing = []
        for pno, page in enumerate(pdf.pages, 1):
            band = signature_band(page.chars)
            if band is None:
                missing.append(pno)
                continue
            band_top, band_bottom, ink_ids = band
            out["gaps"].append(round(page.height - band_bottom, 1))
            # Anything inside the signature's band that is not the signature's
            # own ink is a line item that has run underneath it.
            for c in page.chars:
                if id(c) in ink_ids or not c["text"].strip():
                    continue
                if c["bottom"] > band_top and c["top"] < band_bottom:
                    out["no_overlap"] = False
                    break
    out["signature_every_page"] = not missing and out["pages"] > 0
    if missing:
        out["detail"] = "no signature on page(s) " + ",".join(map(str, missing))
    if out["gaps"]:
        spread = max(out["gaps"]) - min(out["gaps"])
        out["pinned_to_bottom"] = max(out["gaps"]) <= MAX_GAP_PT and spread <= MAX_GAP_SPREAD_PT
        if not out["pinned_to_bottom"] and not out["detail"]:
            out["detail"] = "gap=%s spread=%.1f" % (out["gaps"], spread)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--only", default="", help="substring filter on the case name")
    ap.add_argument("--reuse-pdf", action="store_true",
                    help="re-measure PDFs already on disk instead of printing them again")
    args = ap.parse_args()

    chrome = find_chrome()
    manifest = json.load(open(os.path.join(args.case_dir, "manifest.json"), encoding="utf-8"))
    if args.only:
        manifest = [c for c in manifest if args.only in c["case"]]
    pdf_dir = os.path.join(args.case_dir, "pdf")
    os.makedirs(pdf_dir, exist_ok=True)

    results = []

    def run_one(case):
        html = os.path.join(args.case_dir, case["case"] + ".html")
        pdf = os.path.join(pdf_dir, case["case"] + ".pdf")
        if not (args.reuse_pdf and os.path.exists(pdf)):
            err = render(chrome, html, pdf)
            if err:
                res = {"case": case["case"], "pages": 0, "signature_every_page": False,
                       "pinned_to_bottom": False, "no_overlap": False, "gaps": [], "detail": err}
                res.update(blankRows=case.get("blankRows", 0), hasSignature=case.get("hasSignature", True),
                           type=case["type"], templateId=case["templateId"],
                           lineCount=case["lineCount"], longDescription=case["longDescription"])
                return res
        res = check(pdf, case)
        res["blankRows"] = case.get("blankRows", 0)
        # Templates with no signature at all are left untouched by design; they
        # are still held to "no filler rows".
        res["hasSignature"] = case.get("hasSignature", True)
        res["type"] = case["type"]
        res["templateId"] = case["templateId"]
        res["lineCount"] = case["lineCount"]
        res["longDescription"] = case["longDescription"]
        return res

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for i, res in enumerate(pool.map(run_one, manifest), 1):
            results.append(res)
            if i % 25 == 0:
                print("  ... %d/%d" % (i, len(manifest)), flush=True)

    json.dump(results, open(os.path.join(args.case_dir, "results.json"), "w", encoding="utf-8"), indent=1)

    def failed(r):
        if r["blankRows"] != 0:
            return True
        if not r.get("hasSignature", True):
            return False  # nothing to pin; only the filler-row rule applies
        return not (r["signature_every_page"] and r["pinned_to_bottom"] and r["no_overlap"])

    signed = [r for r in results if r.get("hasSignature", True)]
    unsigned = [r for r in results if not r.get("hasSignature", True)]
    bad = [r for r in results if failed(r)]
    print()
    print("cases                   : %d" % len(results))
    print("  with a signature      : %d" % len(signed))
    print("  none by design        : %d (templates %s)"
          % (len(unsigned), sorted({r["templateId"] for r in unsigned})))
    print("signature on every page : %d / %d" % (sum(r["signature_every_page"] for r in signed), len(signed)))
    print("pinned to page bottom   : %d / %d" % (sum(r["pinned_to_bottom"] for r in signed), len(signed)))
    print("no overlap              : %d / %d" % (sum(r["no_overlap"] for r in signed), len(signed)))
    print("no blank filler rows    : %d / %d" % (sum(r["blankRows"] == 0 for r in results), len(results)))
    print("multi-page cases        : %d (max %d pages)"
          % (sum(r["pages"] > 1 for r in results), max((r["pages"] for r in results), default=0)))

    if bad:
        print("\nFAILING (%d):" % len(bad))
        by_tpl = collections.defaultdict(list)
        for r in bad:
            by_tpl[r["templateId"]].append(r)
        for tpl, rs in sorted(by_tpl.items()):
            flags = []
            if not all(r["signature_every_page"] for r in rs):
                flags.append("missing-on-page")
            if not all(r["pinned_to_bottom"] for r in rs):
                flags.append("not-pinned")
            if not all(r["no_overlap"] for r in rs):
                flags.append("overlap")
            if any(r["blankRows"] for r in rs):
                flags.append("blank-rows")
            print("  template %-4s %-22s %s  (%s)"
                  % (tpl, rs[0]["type"], ",".join(flags),
                     "; ".join(sorted({r["detail"] for r in rs if r["detail"]}))[:150]))

    if args.baseline:
        print("\n(baseline run - failures are the pre-fix behaviour)")
        return 0
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
