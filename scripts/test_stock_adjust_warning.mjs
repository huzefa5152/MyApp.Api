// Offline: when the Adjustment dialog asks "Were these goods sold?".
//   node scripts/test_stock_adjust_warning.mjs
import { adjustmentLooksLikeSale as warn } from "../myapp-frontend/src/utils/stockAdjustWarning.js";

let passed = 0, failed = 0;
const check = (name, ok) => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };
const held = { onHand: 1047, valueExcludingTax: 705950.15 };

check("set: value to nothing with stock still held asks (the AY write-down)",
  warn(held, { mode: "set", targetQuantity: "", targetValue: "0" }));
check("set: quantity down asks", warn(held, { mode: "set", targetQuantity: "0", targetValue: "0" }));
check("delta: taking quantity out asks", warn(held, { mode: "delta", delta: "-1047", valueDelta: "" }));
check("delta: writing the whole value off asks", warn(held, { mode: "delta", delta: "", valueDelta: "-705950.15" }));
check("set: a partial write-down does not ask", !warn(held, { mode: "set", targetQuantity: "", targetValue: "500000" }));
check("set: a recount up does not ask", !warn(held, { mode: "set", targetQuantity: "1100", targetValue: "" }));
check("delta: adding stock does not ask", !warn(held, { mode: "delta", delta: "10", valueDelta: "100" }));
check("an item already worth nothing does not ask on a value-only edit",
  !warn({ onHand: 5, valueExcludingTax: 0 }, { mode: "set", targetQuantity: "", targetValue: "0" }));
check("no item picked does not ask", !warn(null, { mode: "set", targetQuantity: "0" }));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
