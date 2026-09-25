/*
 * The Invoice Sales Detail screen's decisions, pinned offline. The server picks
 * the bills (period and filters, one query for the screen and the Excel); what
 * the SCREEN decides lives in myapp-frontend/src/utils/invoiceSalesDetail.js, a
 * pure module: which filters are applied, how lines group into bills, which
 * bills are on a page, the tiles, and what Print / PDF receive.
 *
 * Run:  node scripts/test_invoice_sales_detail.mjs
 */
import assert from "node:assert";

const U = await import(
  new URL("../myapp-frontend/src/utils/invoiceSalesDetail.js", import.meta.url).href
);

let pass = 0;
const failures = [];
function check(label, fn) {
  try { fn(); pass++; console.log("  PASS", label); }
  catch (e) { failures.push(label); console.log("  FAIL", label, "\n      ", e.message); }
}

const sp = (q) => new URLSearchParams(q);

// Two bills: #7 with two lines, #8 cancelled with one.
const line = (o) => ({
  invoiceId: 1, lineNumber: 1, date: "2026-08-01T00:00:00", invoiceSeries: "", invoiceNumber: "7",
  deliveryChallanNumbers: "", buyer: "Naeem Garments", buyerAddress: "B Block", buyerNtn: "1234567",
  hsCode: "8481.8090", description: "Valve", unit: "Pcs", quantity: 10, rate: 500,
  excludingTax: 5000, taxRate: 18, salesTax: 900, includingTax: 5900, advanceTax: 0, furtherTax: 0,
  total: 5900, fbrStatus: "Submitted", fbrInvoiceNumber: "IRN-7", billStatus: "Active", ...o,
});
const rows = [
  line({}),
  line({ lineNumber: 2, description: "Valve seat", quantity: 0.1, rate: 1, excludingTax: 0.1,
    salesTax: 0.2, includingTax: 0.3, total: 0.3 }),
  line({ invoiceId: 2, invoiceNumber: "8", date: "2026-08-03T00:00:00", buyer: "Elite Venture",
    buyerNtn: "", fbrStatus: "Not submitted", fbrInvoiceNumber: "", billStatus: "Cancelled",
    quantity: 2, rate: 1000, excludingTax: 2000, salesTax: 360, includingTax: 2360, furtherTax: 80,
    total: 2440 }),
];
const report = {
  companyName: "Alpha Traders", periodLabel: "1 Aug 2026 – 31 Aug 2026",
  from: "2026-08-01T00:00:00", to: "2026-08-31T00:00:00", generatedAt: "2026-09-25T09:00:00Z",
  rows, invoiceCount: 2, submittedCount: 1, notSubmittedCount: 1, cancelledCount: 1,
  excludingTax: 7000.1, salesTax: 1260.2, advanceTax: 0, furtherTax: 80, total: 8340.3,
  buyers: [{ clientId: 71, name: "Naeem Garments", ntn: "1234567" }, { clientId: 72, name: "Elite Venture", ntn: "" }],
};

console.log("\n=== period presets ===");
check("the presets are the shared ones without All Periods", () => {
  const values = U.ISD_PERIOD_OPTIONS.map((o) => o.value);
  assert.ok(!values.includes("allPeriods"));
  for (const v of ["thisMonth", "lastMonth", "thisQuarter", "thisYear", "lastYear", "custom"])
    assert.ok(values.includes(v), v);
  assert.strictEqual(values[0], "thisMonth");
});

console.log("\n=== filters in the URL ===");
check("nothing in the URL is This Month", () =>
  assert.deepStrictEqual(U.filtersFromSearch(sp("")), { period: "thisMonth" }));
check("All Periods or a made-up period falls back to This Month", () => {
  assert.strictEqual(U.filtersFromSearch(sp("period=allPeriods")).period, "thisMonth");
  assert.strictEqual(U.filtersFromSearch(sp("period=sometime")).period, "thisMonth");
});
check("a custom range keeps its dates", () =>
  assert.deepStrictEqual(U.filtersFromSearch(sp("period=custom&from=2026-01-01&to=2026-03-31")),
    { period: "custom", from: "2026-01-01", to: "2026-03-31" }));
check("dates without a custom period are dropped", () =>
  assert.deepStrictEqual(U.filtersFromSearch(sp("period=thisYear&from=2026-01-01&to=2026-03-31")),
    { period: "thisYear" }));
check("search is trimmed, status checked, customer a positive number", () =>
  assert.deepStrictEqual(U.filtersFromSearch(sp("period=thisYear&search=%20 valve %20&status=submitted&clientId=71")),
    { period: "thisYear", search: "valve", status: "submitted", clientId: 71 }));
check("an unknown status and a bad customer are ignored", () =>
  assert.deepStrictEqual(U.filtersFromSearch(sp("status=maybe&clientId=abc")), { period: "thisMonth" }));
check("filtersToSearch drops paging, blanks and a stale range", () =>
  assert.deepStrictEqual(
    U.filtersToSearch({ period: "thisYear", from: "2026-01-01", to: "2026-02-01", search: "  ", page: 3, pageSize: 50, status: "", clientId: undefined }),
    { period: "thisYear" }));
check("filtersToSearch round-trips a full set", () => {
  const f = { period: "custom", from: "2026-01-01", to: "2026-03-31", search: "valve", status: "notSubmitted", clientId: 71 };
  assert.deepStrictEqual(U.filtersFromSearch(sp(U.filtersToSearch(f))), f);
});

console.log("\n=== API query ===");
check("status travels as fbrStatus, customer as clientId", () =>
  assert.deepStrictEqual(U.toApiParams({ period: "thisYear", status: "submitted", clientId: 71, search: " a " }),
    { period: "thisYear", fbrStatus: "submitted", clientId: 71, search: "a" }));
check("a custom range sends its dates; any other period does not", () => {
  assert.deepStrictEqual(U.toApiParams({ period: "custom", from: "2026-01-01", to: "2026-01-31" }),
    { period: "custom", from: "2026-01-01", to: "2026-01-31" });
  assert.deepStrictEqual(U.toApiParams({ period: "thisMonth", from: "2026-01-01" }), { period: "thisMonth" });
});

console.log("\n=== bills ===");
const bills = U.groupBills(rows);
check("lines group into bills in the report's order", () => {
  assert.deepStrictEqual(bills.map((b) => b.invoiceId), [1, 2]);
  assert.deepStrictEqual(bills.map((b) => b.lines.length), [2, 1]);
  assert.strictEqual(bills[0].first.lineNumber, 1);
});
check("a bill's totals are its lines', rounded to the paisa", () => {
  assert.strictEqual(bills[0].totals.excl, 5000.1);
  assert.strictEqual(bills[0].totals.gst, 900.2);
  assert.strictEqual(bills[0].totals.total, 5900.3);
});
check("a cancelled bill is marked", () =>
  assert.deepStrictEqual(bills.map((b) => b.cancelled), [false, true]));
check("no rows, no bills", () => assert.deepStrictEqual(U.groupBills([]), []));
check("sumOf adds a column to the paisa", () => assert.strictEqual(U.sumOf(rows, "includingTax"), 8260.3));

console.log("\n=== pages of bills ===");
const many = Array.from({ length: 120 }, (_, i) => ({ invoiceId: i + 1 }));
check("120 bills at 50 a page is 3 pages", () => {
  const p = U.pageOfBills(many, 3, 50);
  assert.strictEqual(p.totalPages, 3);
  assert.strictEqual(p.bills.length, 20);
  assert.strictEqual(p.firstIndex, 100);
  assert.strictEqual(p.lastIndex, 120);
});
check("a page past the end shows the last page", () => assert.strictEqual(U.pageOfBills(many, 9, 50).page, 3));
check("page 0 is page 1", () => assert.strictEqual(U.pageOfBills(many, 0, 50).page, 1));
check("no bills is one empty page", () =>
  assert.deepStrictEqual(U.pageOfBills([], 1, 50), { bills: [], page: 1, totalPages: 1, firstIndex: 0, lastIndex: 0 }));
check("no page size uses the default", () =>
  assert.strictEqual(U.pageOfBills(many, 1, null).bills.length, U.DEFAULT_PAGE_SIZE));

console.log("\n=== tiles ===");
const tiles = U.totalsFor(report);
check("counts first, then money, further tax only because it was charged", () =>
  assert.deepStrictEqual(Object.keys(tiles.totals),
    ["invoiceCount", "submittedCount", "notSubmittedCount", "excludingTax", "salesTax", "furtherTax", "total"]));
check("the labels are the report's words", () => {
  assert.strictEqual(tiles.totalLabels.invoiceCount, "Bills");
  assert.strictEqual(tiles.totalLabels.salesTax, "G. S. T");
  assert.strictEqual(tiles.totalLabels.total, "Total incl taxes");
});
check("cancelled bills are noted under the bill count", () =>
  assert.strictEqual(tiles.notes.invoiceCount, "1 cancelled"));
check("no cancelled bills, no note", () =>
  assert.deepStrictEqual(U.totalsFor({ ...report, cancelledCount: 0 }).notes, {}));
check("advance tax gets a tile when charged", () =>
  assert.ok("advanceTax" in U.totalsFor({ ...report, advanceTax: 12 }).totals));

console.log("\n=== formatting ===");
check("FBR statuses have tones", () => {
  assert.strictEqual(U.fbrTone("Submitted"), "ok");
  assert.strictEqual(U.fbrTone("Not submitted"), "warn");
  assert.strictEqual(U.fbrTone("FBR cancelled"), "bad");
  assert.strictEqual(U.fbrTone("Failed"), "bad");
  assert.strictEqual(U.fbrTone("Validated"), "info");
  assert.strictEqual(U.fbrTone("Excluded from FBR"), "muted");
  assert.strictEqual(U.fbrTone("something new"), "muted");
});
check("quantities drop needless decimals", () => {
  assert.strictEqual(U.fmtQty(10), "10");
  assert.strictEqual(U.fmtQty(2.5), "2.5");
  assert.strictEqual(U.fmtQty(1234), "1,234");
});
check("rates read as percentages", () => {
  assert.strictEqual(U.fmtRate(18), "18%");
  assert.strictEqual(U.fmtRate(12.5), "12.5%");
  assert.strictEqual(U.fmtRate(0), "0%");
});
check("dates read dd Mon yyyy, from the date alone", () => {
  assert.strictEqual(U.fmtDay("2026-08-01T00:00:00"), "01 Aug 2026");
  assert.strictEqual(U.fmtDay(""), "");
});

console.log("\n=== Excel file name ===");
check("a whole month keeps the export's old name", () =>
  assert.strictEqual(U.excelFileName(report), "Invoice-Sales-Detail-2026-08.xlsx"));
check("a leap February is a whole month", () =>
  assert.strictEqual(U.excelFileName({ from: "2028-02-01T00:00:00", to: "2028-02-29T00:00:00" }), "Invoice-Sales-Detail-2028-02.xlsx"));
check("part of a month names its dates", () =>
  assert.strictEqual(U.excelFileName({ from: "2026-08-01T00:00:00", to: "2026-08-30T00:00:00" }),
    "Invoice-Sales-Detail-2026-08-01_to_2026-08-30.xlsx"));
check("a year names its dates", () =>
  assert.strictEqual(U.excelFileName({ from: "2026-01-01T00:00:00", to: "2026-12-31T00:00:00" }),
    "Invoice-Sales-Detail-2026-01-01_to_2026-12-31.xlsx"));

console.log("\n=== what the header and print say ===");
check("applied filters read in words", () =>
  assert.deepStrictEqual(U.filtersApplied({ clientId: 71, status: "notSubmitted", search: " valve " }, report.buyers),
    ["Customer: Naeem Garments", "FBR: Not submitted to FBR", 'Search: "valve"']));
check("no filters, nothing to say", () => assert.deepStrictEqual(U.filtersApplied({ period: "thisMonth" }, []), []));
check("a customer no longer in the list still reads", () =>
  assert.deepStrictEqual(U.filtersApplied({ clientId: 99 }, report.buyers), ["Customer: #99"]));

const env = U.printEnvelope(report, bills, { filtersApplied: ["Customer: Naeem Garments"], pageNote: "Bills 1–2 of 5" });
check("print carries the report's identity and a truthful source", () => {
  assert.strictEqual(env.title, "Invoice Sales Detail");
  assert.strictEqual(env.companyName, "Alpha Traders");
  assert.strictEqual(env.periodLabel, "1 Aug 2026 – 31 Aug 2026");
  assert.strictEqual(env.sourceLabel, "Source: saved bill values");
  assert.deepStrictEqual(env.filtersApplied, ["Customer: Naeem Garments", "Bills 1–2 of 5"]);
});
check("print has 16 columns, totalled where the money is", () => {
  assert.strictEqual(env.columns.length, 16);
  assert.deepStrictEqual(env.columns.filter((c) => c.totalled).map((c) => c.key),
    ["excludingTax", "salesTax", "advanceTax", "furtherTax", "total"]);
});
check("a bill's own fields print on its first line only", () => {
  assert.strictEqual(env.rows.length, 3);
  assert.strictEqual(env.rows[0].invoiceNumber, "7");
  assert.strictEqual(env.rows[1].invoiceNumber, "");
  assert.strictEqual(env.rows[1].buyer, "");
  assert.strictEqual(env.rows[1].description, "Valve seat");
});
check("quantity prints with its unit, rate as a percentage", () => {
  assert.strictEqual(env.rows[0].qtyLabel, "10 Pcs");
  assert.strictEqual(env.rows[0].taxRateLabel, "18%");
});
check("a cancelled bill says so in print", () =>
  assert.strictEqual(env.rows[2].fbrStatus, "Not submitted · Bill cancelled"));
check("print totals are the report's", () => {
  assert.strictEqual(env.totals.total, 8340.3);
  assert.strictEqual(env.totalLabels.total, "Total incl taxes");
});

console.log("\n=== empty grid ===");
check("empty without filters names the period", () =>
  assert.strictEqual(U.emptyText(report, { period: "thisMonth" }), "No bills in 1 Aug 2026 – 31 Aug 2026."));
check("empty with filters says the filters matched nothing", () =>
  assert.strictEqual(U.emptyText(report, { search: "x" }), "No bills match these filters in 1 Aug 2026 – 31 Aug 2026."));

console.log(`\n${pass}/${pass + failures.length} checks passed`);
if (failures.length) {
  console.log("FAILED:\n  " + failures.join("\n  "));
  process.exit(1);
}
