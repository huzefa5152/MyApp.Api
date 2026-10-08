import assert from "node:assert/strict";
import { splitConsultantQuantity, splitGroupQuantity } from "../myapp-frontend/src/utils/groupQuantitySplit.js";
for (const total of [1, 10, 24, 100, 1.61]) {
  for (const weights of [Array(24).fill(1), [100000, ...Array(23).fill(1)], Array(24).fill(0)]) {
    const split = splitConsultantQuantity(total, weights);
    assert.equal(split.infeasible, false);
    assert.ok(split.shares.every(q => q > 0));
    assert.equal(Math.round(split.shares.reduce((a,b)=>a+b,0)*10000), Math.round(total*10000));
  }
}
assert.equal(splitConsultantQuantity(0, Array(24).fill(1)).infeasible, true);
assert.equal(splitConsultantQuantity(0.0001, Array(24).fill(1)).infeasible, true);
assert.equal(splitGroupQuantity(10, Array(24).fill(1)).infeasible, true);
console.log("PASS 15 consultant allocations, invalid quantities, and unchanged commercial whole-unit guard");
