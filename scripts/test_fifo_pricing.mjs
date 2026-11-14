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

const {
  amountStock,
  fifoQuantityForAmount,
  fifoTierText,
  fifoTierTakes,
  partUnitNote,
  rowStockQuantity,
  stockQuantityForLine,
} = await import(new URL("../myapp-frontend/src/utils/fifoPricing.js", import.meta.url).href);

let pass = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    pass++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
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
check("beyond the stock continues at the last cost", () =>
  near(fifoQuantityForAmount(price, 2100), 32),
);
check("zero / negative amount -> null", () => {
  assert.strictEqual(fifoQuantityForAmount(price, 0), null);
  assert.strictEqual(fifoQuantityForAmount(price, -5), null);
});
check("tiers with no quantity are skipped", () =>
  near(fifoQuantityForAmount({ tiers: [{ quantity: 0, unitCost: 9 }, ...price.tiers] }, 500), 5),
);
check("uses the tier value, not a rounded unit cost", () =>
  near(
    fifoQuantityForAmount(
      { tiers: [{ quantity: 3, unitCost: 33.3333, valueExcludingTax: 100 }] },
      100,
    ),
    3,
  ),
);
check("hint names the GDs in order, claimed marked", () => {
  const t = fifoTierText(price, "Pcs");
  assert.ok(t.startsWith("Uses GD GD-C (claimed): 10 Pcs at 100"), t);
  assert.ok(t.includes("then GD GD-U: 20 Pcs at 50"), t);
});
check("hint caps the list", () => {
  const many = {
    tiers: Array.from({ length: 5 }, (_, i) => ({ gdNumber: `G${i}`, quantity: 1, unitCost: 1 })),
  };
  assert.ok(fifoTierText(many).endsWith("then 2 more"), fifoTierText(many));
});

check("tier takes: a sale crossing into the second GD", () => {
  const t = fifoTierTakes(price, 15);
  assert.deepStrictEqual(
    t.map((x) => x.take),
    [10, 5],
  );
  near(t[1].takeValue, 250);
});
check("tier takes: beyond the stock the last GD takes the rest", () =>
  assert.deepStrictEqual(
    fifoTierTakes(price, 32).map((x) => x.take),
    [10, 22],
  ),
);
check("tier takes: no quantity yet -> every GD takes 0", () =>
  assert.deepStrictEqual(
    fifoTierTakes(price, "").map((x) => x.take),
    [0, 0],
  ),
);
check("tier takes: values add up to the line amount", () => {
  const t = fifoTierTakes(price, 32, 2100);
  near(t[0].takeValue + t[1].takeValue, 2100);
  near(t[0].takeValue, 1000);
});
check("tier takes: no tiers -> null", () => assert.strictEqual(fifoTierTakes({}, 5), null));

// What a line priced from an amount takes out of stock (2026-11-15).
const machine = {
  tiers: [{ gdNumber: "GD-1", quantity: 1, unitCost: 250000, valueExcludingTax: 250000 }],
};
check("stock quantity: 30,000 of one 250,000 machine takes 0.12, not the unit", () => {
  const raw = fifoQuantityForAmount(machine, 30000);
  const stock = stockQuantityForLine(raw, Math.max(1, Math.round(raw)));
  near(stock, 30000 / 250000);
  near(stock * 250000, 30000);
});
check("stock quantity: an amount that buys whole units needs none", () =>
  assert.strictEqual(stockQuantityForLine(5, 5), null),
);
check("stock quantity: rounding down keeps the fraction (798.313 billed as 798)", () =>
  near(stockQuantityForLine(798.313, 798), 798.313),
);
check("stock quantity: never a whole unit or more from the billed quantity", () => {
  assert.strictEqual(stockQuantityForLine(3.2, 5), null);
  assert.strictEqual(stockQuantityForLine(2, 1), null);
});
check("stock quantity: nothing to work from -> null", () => {
  assert.strictEqual(stockQuantityForLine(0, 1), null);
  assert.strictEqual(stockQuantityForLine(null, 1), null);
  assert.strictEqual(stockQuantityForLine(0.4, 0), null);
});
check("row: sends the stock quantity while the row is as it was priced", () => {
  const a = amountStock(0.12, 1, 30000, 7);
  assert.strictEqual(
    rowStockQuantity({ amountStock: a, quantity: "1", unitPrice: "30000", itemTypeId: 7 }),
    0.12,
  );
});
check("row: a quantity, rate or item changed by hand sends none", () => {
  const a = amountStock(0.12, 1, 30000, 7);
  assert.strictEqual(
    rowStockQuantity({ amountStock: a, quantity: "2", unitPrice: "30000", itemTypeId: 7 }),
    null,
  );
  assert.strictEqual(
    rowStockQuantity({ amountStock: a, quantity: "1", unitPrice: "29000", itemTypeId: 7 }),
    null,
  );
  assert.strictEqual(
    rowStockQuantity({ amountStock: a, quantity: "1", unitPrice: "30000", itemTypeId: 9 }),
    null,
  );
  assert.strictEqual(rowStockQuantity({ quantity: "1", unitPrice: "30000" }), null);
});
check("row: whole units remember nothing", () =>
  assert.strictEqual(amountStock(5, 5, 100, 1), null),
);
check("notice: part of a unit is spelled out with both quantities", () => {
  const t = partUnitNote(0.12, 1, "Pcs", 30000);
  assert.ok(t.includes("buys 0.12 Pcs"), t);
  assert.ok(t.includes("invoice shows 1 Pcs"), t);
  assert.ok(t.includes("30,000.00"), t);
});
check("notice: small rounding on a large quantity stays quiet", () => {
  assert.strictEqual(partUnitNote(798.313, 798, "Kg", 746700), null);
  assert.strictEqual(partUnitNote(null, 1, "Pcs", 100), null);
});

for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`${pass}/${pass + failures.length} checks passed`);
process.exit(failures.length ? 1 : 0);
