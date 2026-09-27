/*
 * Pricing a bill line from stock under FIFO by GD, pinned offline:
 * myapp-frontend/src/utils/fifoPricing.js turns a line amount into the
 * quantity it buys by walking the GDs the sale will drain, in order.
 * Weighted-average stock (no tiers) must return null so the forms keep their
 * own arithmetic untouched.
 *
 * Run:  node scripts/test_fifo_pricing.mjs
 */
import assert from "node:assert";

const { fifoQuantityForAmount, fifoTierText } = await import(
  new URL("../myapp-frontend/src/utils/fifoPricing.js", import.meta.url).href
);

let pass = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); pass++; } catch (e) { failures.push(`${name}: ${e.message}`); }
};
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

const price = {
  tiers: [
    { gdNumber: "GD-C", claimed: true, quantity: 10, unitCost: 100, valueExcludingTax: 1000 },
    { gdNumber: "GD-U", claimed: false, quantity: 20, unitCost: 50, valueExcludingTax: 1000 },
  ],
};

check("weighted average (no tiers) -> null", () => {
  assert.strictEqual(fifoQuantityForAmount({ unitCost: 10 }, 100), null);
  assert.strictEqual(fifoQuantityForAmount({ tiers: [] }, 100), null);
  assert.strictEqual(fifoTierText({ unitCost: 10 }), null);
});
check("amount inside the first GD", () => near(fifoQuantityForAmount(price, 500), 5));
check("amount exactly the first GD", () => near(fifoQuantityForAmount(price, 1000), 10));
check("amount crossing into the second GD", () => near(fifoQuantityForAmount(price, 1500), 20));
check("amount of the whole stock", () => near(fifoQuantityForAmount(price, 2000), 30));
check("beyond the stock continues at the last cost", () => near(fifoQuantityForAmount(price, 2100), 32));
check("zero / negative amount -> null", () => {
  assert.strictEqual(fifoQuantityForAmount(price, 0), null);
  assert.strictEqual(fifoQuantityForAmount(price, -5), null);
});
check("tiers with no quantity are skipped", () =>
  near(fifoQuantityForAmount({ tiers: [{ quantity: 0, unitCost: 9 }, ...price.tiers] }, 500), 5));
check("uses the tier value, not a rounded unit cost", () =>
  near(fifoQuantityForAmount({ tiers: [{ quantity: 3, unitCost: 33.3333, valueExcludingTax: 100 }] }, 100), 3));
check("hint names the GDs in order, claimed marked", () => {
  const t = fifoTierText(price, "Pcs");
  assert.ok(t.startsWith("Uses GD GD-C (claimed): 10 Pcs at 100"), t);
  assert.ok(t.includes("then GD GD-U: 20 Pcs at 50"), t);
});
check("hint caps the list", () => {
  const many = { tiers: Array.from({ length: 5 }, (_, i) => ({ gdNumber: `G${i}`, quantity: 1, unitCost: 1 })) };
  assert.ok(fifoTierText(many).endsWith("then 2 more"), fifoTierText(many));
});

for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`${pass}/${pass + failures.length} checks passed`);
process.exit(failures.length ? 1 : 0);
