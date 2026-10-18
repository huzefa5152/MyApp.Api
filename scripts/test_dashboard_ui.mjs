/*
 * Dashboard chart foundation, pinned offline: the palette reads theme tokens
 * with fallbacks, and PK money is shortened to lakh / crore.
 * Run:  node scripts/test_dashboard_ui.mjs
 */
import assert from "node:assert";

const { chartPalette, formatMoneyShort, PALETTE_FALLBACK } = await import(
  new URL("../myapp-frontend/src/Components/dashboard/chartTheme.js", import.meta.url).href
);

let pass = 0;
const failures = [];
function check(label, fn) {
  try { fn(); pass++; console.log("  PASS", label); }
  catch (e) { failures.push(label); console.log("  FAIL", label, "\n      ", e.message); }
}

console.log("\n=== palette ===");
check("no document -> fallbacks with all nine keys", () => {
  const p = chartPalette();
  assert.deepStrictEqual(Object.keys(p).sort(), ["card", "grid", "ink", "negative", "positive", "primary", "secondary", "text", "warn"]);
  assert.deepStrictEqual(p, PALETTE_FALLBACK);
});
check("CSS variable wins, blank falls back", () => {
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: (k) => (k === "--dash-primary" ? " #123456 " : "") });
  const p = chartPalette();
  assert.strictEqual(p.primary, "#123456");
  assert.strictEqual(p.negative, PALETTE_FALLBACK.negative);
  delete globalThis.document; delete globalThis.getComputedStyle;
});

console.log("\n=== formatMoneyShort ===");
check("lakh", () => assert.strictEqual(formatMoneyShort(1234567), "12.3 lakh"));
check("crore", () => assert.strictEqual(formatMoneyShort(123456789), "12.3 crore"));
check("thousands stay full", () => assert.strictEqual(formatMoneyShort(99999), "99,999"));
check("negative keeps sign", () => assert.strictEqual(formatMoneyShort(-1234567), "-12.3 lakh"));
check("null is a dash", () => assert.strictEqual(formatMoneyShort(null), "—"));

console.log("\n=== tax panel rows ===");
const { taxPanelRows } = await import(new URL("../myapp-frontend/src/Components/dashboard/taxPanelRows.js", import.meta.url).href);
const sample = { outputTax: 1000, furtherTax: 40, inputTaxClaimed: 300, salesTaxPayable: 700, adv236G: 10, adv236H: 5, whtPayable: 20,
  recoverableImportAdvanceTax: 7, recoverableWhtDeducted: 3, ledgerEnabled: true, inputBasis: "worksheet" };
check("total = salesTaxPayable + 236G + 236H + WHT", () => {
  const rows = taxPanelRows(sample);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.strictEqual(by.total.value, by.salesTaxPayable.value + by["236G"].value + by["236H"].value + by.wht.value);
  assert.strictEqual(by.total.value, 735);
});
check("note only when the cap/carry-forward moved sales tax payable", () => {
  assert.ok(taxPanelRows(sample).find((r) => r.key === "salesTaxPayable").note);
  assert.ok(!taxPanelRows({ ...sample, salesTaxPayable: 740 }).find((r) => r.key === "salesTaxPayable").note);
});
check("ledger off gates only WHT and recoverables, not 236G/H", () => {
  const by = Object.fromEntries(taxPanelRows({ ...sample, ledgerEnabled: false }).map((r) => [r.key, r]));
  assert.strictEqual(by["236G"].value, 10);
  for (const k of ["wht", "recImport", "recWht"]) assert.strictEqual(by[k].unavailable, "Ledger not enabled");
});
check("recoverables are not drillable; gl-before-cap relabels input", () => {
  const rows = taxPanelRows({ ...sample, inputBasis: "gl-before-cap" });
  assert.ok(rows.filter((r) => r.kind === "recoverable").every((r) => r.drill === null));
  assert.match(rows.find((r) => r.key === "input").label, /before 8B cap/);
});

console.log("\n=== drill-down ===");
const D = await import(new URL("../myapp-frontend/src/utils/dashboardDrill.js", import.meta.url).href);
check("reconciles within tolerance", () => {
  assert.strictEqual(D.reconciles([{ amount: 1 }, { amount: 2.04 }], 3), true);
  assert.strictEqual(D.reconciles([{ amount: 1 }, { amount: 2.04 }], 3.1), false);
  assert.strictEqual(D.reconciles([{ amount: 1 }], null), true);
});
check("exportRows neutralises formulas, header included", () => {
  const out = D.exportRows([{ key: "k", label: "=Bad" }], [{ label: "=HYPERLINK(1)", sub: "ok", amount: -5, values: { k: "@x" } }]);
  assert.strictEqual(out[0][3], "'=Bad");
  assert.deepStrictEqual(out[1], ["'=HYPERLINK(1)", "ok", -5, "'@x"]);
});
check("drill URL state round-trips", () => {
  assert.deepStrictEqual(D.drillFromSearch(new URLSearchParams("drill=sales&group=2026-09")), { kind: "sales", groupKey: "2026-09" });
  assert.deepStrictEqual(D.drillFromSearch(new URLSearchParams("drill=cogs")), { kind: "cogs", groupKey: null });
  assert.strictEqual(D.drillFromSearch(new URLSearchParams("x=1")), null);
  const p = D.drillToSearch(new URLSearchParams("a=1&drill=old&group=g"), { kind: "sales", groupKey: "k" });
  assert.strictEqual(p.toString(), "a=1&drill=sales&group=k");
  assert.strictEqual(D.drillToSearch(p, null).toString(), "a=1");
});
check("invoice breakdown + bill link", () => {
  const rows = D.invoiceBreakdown({ net: 100, gst: 18, adv236: 0.1, advSection: "236G", fbrStatus: "Submitted" }, (s) => s);
  assert.strictEqual(rows.length, 7);
  assert.match(rows[3].label, /236G/);
  assert.strictEqual(D.openBillPath(1234), "/bills?search=1234");
});

console.log("\n=== overview page data ===");
const O = await import(new URL("../myapp-frontend/src/Components/dashboard/overviewData.js", import.meta.url).href);
check("each drill's card figure is the tile that opened it", () => {
  const hero = { netSales: 100, salesInclTax: 118, grossMarginLanded: 30, receivablesTotal: 500, stockAgeUnder30: 1, stockAge30To90: 2, stockAgeOver90: 3 };
  assert.strictEqual(O.drillCardValue({ kind: "sales" }, { hero }), 100); // NET, not incl. tax
  assert.strictEqual(O.drillCardValue({ kind: "margin-landed" }, { hero }), 30);
  assert.strictEqual(O.drillCardValue({ kind: "receivables" }, { hero }), 500);
  assert.strictEqual(O.drillCardValue({ kind: "receivables" }, { hero: { ...hero, receivablesScopeRestricted: true } }), null);
  assert.strictEqual(O.drillCardValue({ kind: "stock-ageing" }, { hero }), 6);
  assert.strictEqual(O.drillCardValue({ kind: "tax-payable" }, { hero, tax: { totalPayable: 42 } }), 42);
  assert.strictEqual(O.drillCardValue({ kind: "health-unfiled" }, { hero, health: [{ key: "health-unfiled", amount: 9 }] }), 9);
  assert.strictEqual(O.drillCardValue({ kind: "sales", period: "all-time" }, { hero }), null); // chart month: own window
  assert.strictEqual(O.drillCardValue(null, { hero }), null);
});
check("chart series: months labelled, input tax below the line, top 10", () => {
  assert.strictEqual(O.monthLabel("2026-05"), "May 26");
  const m = O.monthlySeries([{ month: "2026-01", netSales: 10, landedCost: 7, marginPct: null }]);
  assert.deepStrictEqual(m[0], { month: "2026-01", label: "Jan 26", netSales: 10, landedCost: 7, marginPct: null });
  const t = O.taxMonthSeries([{ month: "2026-02", outputTax: 18, furtherTax: 4, adv236: 1, inputTax: 5 }]);
  assert.strictEqual(t[0].input, -5);
  assert.strictEqual(O.topCustomers(Array.from({ length: 20 }, (_, i) => ({ id: i, name: "C" + i, value: i }))).length, 10);
  assert.deepStrictEqual(O.topCustomers([{ id: 1, name: "A", value: 118, netValue: 100, groupKey: "c:-1" }])[0],
    { id: 1, label: "A", value: 100, groupKey: "c:-1" }); // net, with the drill key
  assert.deepStrictEqual(O.monthRange("2024-02"), { from: "2024-02-01", to: "2024-02-29" });
  assert.deepStrictEqual(O.monthRange("2026-12"), { from: "2026-12-01", to: "2026-12-31" });
  assert.strictEqual(O.monthRange("x"), null);
  assert.strictEqual(O.hasAny(t, ["output"]), true);
  assert.strictEqual(O.hasAny([{ output: 0 }], ["output"]), false);
});

console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
