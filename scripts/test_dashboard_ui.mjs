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
check("no document -> fallbacks with all seven keys", () => {
  const p = chartPalette();
  assert.deepStrictEqual(Object.keys(p).sort(), ["grid", "negative", "positive", "primary", "secondary", "text", "warn"]);
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

console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
