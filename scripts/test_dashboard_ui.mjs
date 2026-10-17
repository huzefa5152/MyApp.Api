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

console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
