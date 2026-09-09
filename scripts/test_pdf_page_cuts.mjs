/*
 * Page-break arithmetic for the PDF export — the one thing that decides whether
 * a line item survives a page boundary.
 *
 * html2canvas paints the document as one continuous bitmap, so the templates'
 * `page-break-inside: avoid` does nothing on the PDF path and the SLICER is
 * what has to respect row boundaries. Before 2026-09-09 it advanced by a fixed
 * number of pixels: on a 40-line invoice that cut a row in half, its top on
 * page 1 and its bottom on page 2, so the line item was unreadable on both.
 *
 * This runs offline — no browser, no server, no PDF — because the defect lives
 * entirely in `choosePageCuts` and finding it should not need a 2 MB download
 * and a pair of eyes.
 *
 * Run:  node scripts/test_pdf_page_cuts.mjs
 */
import assert from "node:assert";

const { choosePageCuts } = await import(
  new URL("../myapp-frontend/src/utils/pdfPageCuts.js", import.meta.url).href
);

let pass = 0;
const failures = [];
function check(label, fn) {
  try {
    fn();
    pass += 1;
    console.log("  [PASS] " + label);
  } catch (err) {
    failures.push(label);
    console.log("  [FAIL] " + label + " — " + err.message);
  }
}

// A 40-row invoice: a header block, then 40 rows of 52 px, then totals.
const rows = [];
for (let i = 0, y = 300; i < 40; i++) { y += 52; rows.push(y); }
const totals = rows[rows.length - 1] + 180;
const CUTS = [300, ...rows, totals];
const TOTAL = totals + 40;
const PAGE = 2130;   // the real slice height for A4 at 796px render width

check("every page ends on a safe boundary, never mid-row", () => {
  const ends = choosePageCuts(CUTS, PAGE, TOTAL);
  for (const e of ends.slice(0, -1)) {
    assert.ok(CUTS.includes(e), `page ended at ${e}, which is not a block edge`);
  }
});

check("the last page ends at the end of the document", () => {
  const ends = choosePageCuts(CUTS, PAGE, TOTAL);
  assert.strictEqual(ends[ends.length - 1], TOTAL);
});

check("no page exceeds the printable height", () => {
  const ends = choosePageCuts(CUTS, PAGE, TOTAL);
  let y = 0;
  for (const e of ends) { assert.ok(e - y <= PAGE + 1, `page of ${e - y}px`); y = e; }
});

check("the pages cover the document exactly once, with no gap or overlap", () => {
  const ends = choosePageCuts(CUTS, PAGE, TOTAL);
  let y = 0;
  let covered = 0;
  for (const e of ends) { assert.ok(e > y); covered += e - y; y = e; }
  assert.strictEqual(covered, TOTAL);
});

check("a document shorter than one page is a single page", () => {
  assert.deepStrictEqual(choosePageCuts([100, 200], 2130, 400), [400]);
});

check("a document with NO safe boundary still terminates", () => {
  // One indivisible block taller than several pages: it has to be cut, and the
  // alternative — refusing to cut — is an endless loop.
  const ends = choosePageCuts([], PAGE, PAGE * 3 + 10);
  assert.strictEqual(ends.length, 4);
  assert.strictEqual(ends[ends.length - 1], PAGE * 3 + 10);
});

check("a row taller than a page is cut rather than looping forever", () => {
  const ends = choosePageCuts([9000], PAGE, 9000);
  assert.ok(ends.length >= 4 && ends[ends.length - 1] === 9000, JSON.stringify(ends));
});

check("a page is never left almost empty by an early boundary", () => {
  // A boundary at 5% of the page must not end the page there.
  const ends = choosePageCuts([100, 2000, 4000], PAGE, 4000);
  assert.ok(ends[0] >= PAGE * 0.35, `first page ended at ${ends[0]}`);
});

check("no zero-height page, whatever the boundaries say", () => {
  const ends = choosePageCuts([0, 0, 0, TOTAL], PAGE, TOTAL);
  let y = 0;
  for (const e of ends) { assert.ok(e > y, `zero-height page at ${e}`); y = e; }
});

check("the 40-row case cuts EARLIER than the blind fixed cut", () => {
  // The regression itself: a fixed cut lands at 2130, mid-row. The fix must
  // pull the boundary back to the row edge below it.
  const ends = choosePageCuts(CUTS, PAGE, TOTAL);
  assert.ok(ends[0] < PAGE, `first page still ends at ${ends[0]}`);
  assert.ok(CUTS.includes(ends[0]), `${ends[0]} is not a row edge`);
});

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
