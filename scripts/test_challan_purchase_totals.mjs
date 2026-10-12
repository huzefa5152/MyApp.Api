import assert from "node:assert/strict";
import { challanPurchaseTax, validChallanPurchaseRate } from "../myapp-frontend/src/utils/challanPurchaseTotals.mjs";
const cases = [["150", "18", 27], ["200", "0", 0], ["10", "7.5", .75], [".01", "50", 0], [".03", "50", .02], ["12.34", "18", 2.22], ["100", "17.25", 17.25], ["999.99", "100", 999.99]];
for (const [subtotal, rate, expected] of cases) assert.equal(challanPurchaseTax(subtotal, rate), expected);
for (const rate of ["", "-1", "101", "18.123", "NaN", "Infinity"]) assert.equal(validChallanPurchaseRate(rate), false);
for (const rate of ["0", "18", "7.5", "100", "17.25"]) assert.equal(validChallanPurchaseRate(rate), true);
console.log("19 purchase-preview GST checks passed");
