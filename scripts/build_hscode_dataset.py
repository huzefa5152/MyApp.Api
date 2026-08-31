"""
Generate the bundled HS / PCT code dataset from FBR's published Customs Tariff.

WHY THIS EXISTS
---------------
PRAL's catalog endpoints (/pdi/v1/itemdesccode, /pdi/v1/uom, /pdi/v2/HS_UOM) all
answer 401 "Missing Credentials" without an OAuth token, so a company that has
not been issued one — or is simply mid-onboarding — cannot classify its items at
all. FBR does, however, publish the Pakistan Customs Tariff itself as an open
PDF download with no authentication, and that document is the authoritative list
of PCT codes.

This script parses that PDF ONCE, offline, and writes a compact dataset the
application embeds. Deliberately not a runtime download: the published URL
carries a generated filename that changes every tariff year, so a hardcoded URL
would break annually and silently, and parsing 327 pages on demand to obtain
static reference data is worse than shipping the result.

WHAT IT CANNOT PROVIDE
----------------------
Units. The tariff has no unit-of-measure column anywhere — checked across the
whole document. UOM per code exists only behind PRAL's token-gated
/pdi/v2/HS_UOM, one code per call. Imported rows therefore carry no UOM, which
the model already allows: HsCode.Uom is nullable and is filled lazily the first
time someone asks for a code's UOMs with a token available.

USAGE
-----
    # Point it at the tariff PDF for the year (download it from fbr.gov.pk first)
    python scripts/build_hscode_dataset.py --pdf Tariff-2025-26.pdf --year 2025-26

    # Or let it fetch a URL you give it
    python scripts/build_hscode_dataset.py --url https://download1.fbr.gov.pk/Docs/<file>.pdf --year 2025-26

Find the current file at:
    https://fbr.gov.pk/categ/customs-tariff/51149/70853/131189

Writes Data/HsCodes/pakistan-customs-tariff.csv, which is embedded into the
assembly by MyApp.Api.csproj. Re-run it once a year when FBR publishes the new
tariff, then commit the regenerated file.

Requires: pypdf  (pip install pypdf)
"""

import argparse
import csv
import os
import re
import sys
from datetime import date, timezone, datetime

try:
    import pypdf
except ImportError:
    print("pypdf is required:  pip install pypdf")
    sys.exit(2)


# An 8-digit PCT code at the start of a line: 8481.1000
PCT = re.compile(r"^(\d{4}\.\d{4})\b\s*(.*)$")
# A 4-digit HEADING (84.51) — a section title, never an importable code.
HEADING = re.compile(r"^\d{2}\.\d{2}\b")
# The trailing customs-duty percentage on a tariff line.
DUTY = re.compile(r"(?:\s|^)(\d{1,2}(?:\.\d+)?)\s*$")
# Page furniture.
NOISE = re.compile(r"^(PCT CODE|DESCRIPTION|CD \(%\)|\d{4}-\d{2}$|Page \d+)", re.I)
# The tariff's own "heading deleted" annotations: "Other [05.03]".
DELETED_MARK = re.compile(r"\s*\[\s*\d{2}\.\d{2}\s*\]")
# A cross-reference inside a description is legitimate prose and must survive:
# "... of heading 87.03". Only an UNREFERENCED NN.NN is a bleed from the next
# section's title.
REFERENCE_LEAD = re.compile(r"(heading|sub-?\s?heading|chapter)\s*$", re.I)

MAX_CONTINUATION_LINES = 3


def strip_heading_bleed(text: str) -> str:
    """Cut a section title that ran onto the end of a description, while keeping
    a genuine cross-reference such as "of heading 87.03"."""
    for m in re.finditer(r"\b\d{2}\.\d{2}\b", text):
        if not REFERENCE_LEAD.search(text[: m.start()].rstrip()):
            return text[: m.start()].strip()
    return text


def tidy(text: str) -> str:
    text = DELETED_MARK.sub("", text)
    text = strip_heading_bleed(text)
    text = re.sub(r"^[-\s]+", "", text)
    text = re.sub(r"\s{2,}", " ", text)
    # The PDF hyphenates across its column layout: "Pressure- reducing".
    text = re.sub(r"(\w)-\s+(\w)", r"\1-\2", text)
    return text.strip(" -:;.")


def parse(pdf_path: str):
    reader = pypdf.PdfReader(pdf_path)
    lines = []
    for page in reader.pages:
        lines.extend((page.extract_text() or "").splitlines())
    lines = [l.strip() for l in lines]

    codes: dict[str, str] = {}
    for i, line in enumerate(lines):
        m = PCT.match(line)
        if not m:
            continue
        code, rest = m.group(1), m.group(2).strip()

        duty = DUTY.search(rest)
        if duty:
            rest = rest[: duty.start()].strip()

        # A description can wrap onto the following lines. Stop at anything that
        # is plainly the start of something else.
        j = i + 1
        while j < len(lines) and j - i <= MAX_CONTINUATION_LINES:
            nxt = lines[j]
            if not nxt or PCT.match(nxt) or HEADING.match(nxt) or NOISE.match(nxt):
                break
            if re.fullmatch(r"\d{1,2}(?:\.\d+)?", nxt):   # a stray duty cell
                break
            rest = f"{rest} {nxt}".strip()
            j += 1

        rest = tidy(rest)
        if code not in codes and rest:
            codes[code] = rest

    return reader, codes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", help="path to the tariff PDF")
    ap.add_argument("--url", help="download the tariff PDF from here first")
    ap.add_argument("--year", required=True, help="tariff year, e.g. 2025-26")
    ap.add_argument("--out", default=os.path.join("Data", "HsCodes", "pakistan-customs-tariff.csv"))
    args = ap.parse_args()

    pdf_path = args.pdf
    if args.url:
        import urllib.request
        pdf_path = pdf_path or "tariff-download.pdf"
        print(f"downloading {args.url}")
        urllib.request.urlretrieve(args.url, pdf_path)
    if not pdf_path or not os.path.exists(pdf_path):
        print("Give --pdf <file> or --url <link>.")
        return 2

    reader, codes = parse(pdf_path)
    print(f"pages parsed : {len(reader.pages)}")
    print(f"PCT codes    : {len(codes)}")
    if len(codes) < 5000:
        print(f"REFUSING TO WRITE: only {len(codes)} codes found. The tariff holds "
              f"roughly 7,600 — the layout has probably changed and the parser needs "
              f"revisiting. Nothing was written.")
        return 1

    suspicious = [c for c, d in codes.items() if len(d) < 3]
    if suspicious:
        print(f"warning: {len(suspicious)} descriptions look too short, e.g. {suspicious[:5]}")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["# Pakistan Customs Tariff", args.year,
                    f"generated {datetime.now(timezone.utc).date().isoformat()}",
                    f"{len(codes)} codes",
                    "source: FBR published tariff (no token required)"])
        w.writerow(["Code", "Description"])
        for code in sorted(codes):
            w.writerow([code, codes[code]])

    size = os.path.getsize(args.out)
    print(f"wrote {args.out}  ({size/1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
