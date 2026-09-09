/**
 * Page-break arithmetic for the PDF export path.
 *
 * Its own module, with NO imports, for two reasons: it is the one piece of
 * the export that decides whether a line item survives a page boundary, and
 * it is pure — so it can be tested under plain node
 * (scripts/test_pdf_page_cuts.mjs) instead of needing a browser, a server and
 * a rendered PDF to catch a regression in it.
 */

/**
 * Choose where each page ends, given the offsets it is safe to cut at.
 *
 * Split out from the render loop and exported so it can be tested without a
 * browser — the bug this exists to prevent (a line item sliced in half across
 * a page boundary) is a property of THIS arithmetic, and it should not take a
 * 2 MB PDF and a pair of eyes to catch a regression in it.
 *
 * `cuts` are ascending canvas-pixel offsets of block bottom edges. A page runs
 * to the largest such edge that fits; when none does — a block taller than a
 * page — the page is cut at the hard limit, because the alternative is an
 * endless document. `minFillRatio` stops a page ending almost as soon as it
 * began.
 */
export function choosePageCuts(cuts, pageHeight, totalHeight, minFillRatio = 0.35) {
  const ends = [];
  let y = 0;
  let guard = 0;
  while (y < totalHeight && guard++ < 10000) {
    const hardEnd = Math.min(y + pageHeight, totalHeight);
    let end = hardEnd;
    if (hardEnd < totalHeight) {
      const floor = y + pageHeight * minFillRatio;
      let best = 0;
      for (const c of cuts) {
        if (c > hardEnd) break;
        if (c > floor) best = c;
      }
      if (best) end = best;
    }
    // Never emit a zero-height page, whatever the inputs look like.
    if (end <= y) end = hardEnd > y ? hardEnd : totalHeight;
    ends.push(end);
    y = end;
  }
  return ends;
}
