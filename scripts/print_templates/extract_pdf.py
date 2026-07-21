# -*- coding: utf-8 -*-
"""
Extract the LAYOUT of a supplied print PDF so a print template can be built to
match it pixel-for-pixel. See PRINT_TEMPLATE_GUIDE.md (repo root).

Usage:
  python scripts/print_templates/extract_pdf.py "<file.pdf>"          # layout + image + rects
  python scripts/print_templates/extract_pdf.py "<file.pdf>" --words  # + every word with x/y coords

Needs pdfplumber (pip install pdfplumber). Prints:
  - page size (pt) + center X  (A4 portrait is ~596 x 843 pt)
  - image (logo) boxes with center-X so you can tell centred vs top-right
  - full layout text (extract_text(layout=True)) — the primary design source
  - table rects/lines count (Manager renders are usually BORDERLESS = 0 real cell borders)
  - with --words: every token's x0/x1/top so you can derive column x-positions,
    logo centring, and label vs value alignment.
"""
import sys

def main():
    if len(sys.argv) < 2:
        print("usage: extract_pdf.py <file.pdf> [--words] [--page N]"); return
    path = sys.argv[1]
    words = "--words" in sys.argv
    pageno = 0
    if "--page" in sys.argv:
        pageno = int(sys.argv[sys.argv.index("--page") + 1]) - 1
    import pdfplumber
    pdf = pdfplumber.open(path)
    print(f"file: {path}\npages: {len(pdf.pages)}")
    pg = pdf.pages[pageno]
    print(f"page {pageno+1}: {pg.width:.0f} x {pg.height:.0f} pt   center_x={pg.width/2:.0f}")
    print(f"images: {len(pg.images)}   rects: {len(pg.rects)}   lines: {len(pg.lines)}")
    for im in pg.images:
        cx = (im['x0'] + im['x1']) / 2
        pos = "CENTRED" if abs(cx - pg.width/2) < 40 else ("RIGHT" if cx > pg.width*0.6 else "LEFT")
        print(f"  IMG cx={cx:.0f} ({pos}) top={im['top']:.0f} w={im['width']:.0f} h={im['height']:.0f}")
    print("\n===== LAYOUT TEXT =====")
    print(pg.extract_text(layout=True))
    if words:
        print("\n===== WORDS (x0 x1 top text) =====")
        for w in pg.extract_words(use_text_flow=False):
            print(f"  x0={w['x0']:6.1f} x1={w['x1']:6.1f} top={w['top']:6.1f}  {w['text']!r}")

if __name__ == "__main__":
    main()
