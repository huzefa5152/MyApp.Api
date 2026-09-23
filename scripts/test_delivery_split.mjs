/**
 * Splitting a merged bill row back over its delivery challans.
 *
 * Offline. No backend, no database:
 *     node scripts/test_delivery_split.mjs
 *
 * The rule under test is the minimum-preserving reverse waterfall described in
 * myapp-frontend/src/utils/deliverySplit.js. The cases below are the ones the
 * maintainer specified when the rule was agreed, and they are the contract: a
 * reduction comes off the newest delivery first, no selected challan is ever
 * reduced below its minimum, and a quantity under the row's floor is refused
 * rather than silently starving a challan.
 */
import {
  splitDeliveryQuantities,
  rowFloor,
  isUnderFloor,
} from "../myapp-frontend/src/utils/deliverySplit.js";

let passed = 0;
let failed = 0;

const members = (...qs) => qs.map((q) => ({ quantity: q }));

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
  }
}

function split(qty, ...qs) {
  return splitDeliveryQuantities(qty, members(...qs));
}

// ── The maintainer's worked example: 50 / 5 / 1 delivered, oldest first ──────
// DC 2770 = 50 (oldest), DC 2778 = 5, DC 2816 = 1 (newest).
check("56 = delivered, nothing moves", split(56, 50, 5, 1), [50, 5, 1]);
check("55 takes 1 off the middle, newest already at its minimum",
  split(55, 50, 5, 1), [50, 4, 1]);
check("52 empties the middle to its minimum, oldest untouched",
  split(52, 50, 5, 1), [50, 1, 1]);
check("51 is the first quantity that moves the oldest",
  split(51, 50, 5, 1), [49, 1, 1]);
check("50 keeps taking from the oldest only", split(50, 50, 5, 1), [48, 1, 1]);
check("3 is the floor: every challan on its minimum", split(3, 50, 5, 1), [1, 1, 1]);
check("floor of three challans is 3", rowFloor(members(50, 5, 1)), 3);
check("2 is under the floor", isUnderFloor(2, members(50, 5, 1)), true);
check("3 is not under the floor", isUnderFloor(3, members(50, 5, 1)), false);

// ── Two challans: 200 (oldest) and 72 (newest) ──────────────────────────────
check("250 comes off the newest alone", split(250, 200, 72), [200, 50]);
check("150 empties the newest, then cuts the oldest", split(150, 200, 72), [149, 1]);
check("2 is the floor for two challans", split(2, 200, 72), [1, 1]);
check("1 is under the floor for two challans", isUnderFloor(1, members(200, 72)), true);

// ── Billing MORE than was delivered ─────────────────────────────────────────
// The surplus can only sit on the newest line: no earlier challan is claimed to
// have carried goods it did not.
check("a surplus lands on the newest delivery", split(60, 50, 5, 1), [50, 5, 5]);
check("a surplus on a single delivery", split(9, 4), [9]);

// ── One delivery only (the ordinary, unmerged row) ──────────────────────────
check("a single delivery takes the whole quantity", split(3, 10), [3]);
check("a single delivery can go to its minimum", split(1, 10), [1]);
check("below 1 on a single whole delivery is refused",
  isUnderFloor(0.5, members(10)), true);

// ── Decimal UOMs (KG, LTR): a delivery smaller than 1 keeps itself ──────────
// minKeep is min(1, delivered), so a 0.5 KG delivery is not asked to keep 1 —
// which would be more than was ever delivered.
check("floor follows a sub-unit delivery", rowFloor(members(2.5, 0.5)), 1.5);
check("a sub-unit delivery keeps all of itself", split(1.5, 2.5, 0.5), [1, 0.5]);
check("a reduction still comes off the newest first",
  split(2.5, 2.5, 0.5), [2, 0.5]);
check("under a fractional floor is refused", isUnderFloor(1.4, members(2.5, 0.5)), true);
check("no float dust in the result", split(2.9, 2.5, 0.5), [2.4, 0.5]);

// ── Whole deliveries never produce fractions ────────────────────────────────
// A proportional split would return 49.1 / 4.91 / 0.98 for 55 of 50/5/1; this
// rule keeps whole numbers whole, which is what an operator can sign for.
for (const qty of [3, 4, 10, 25, 40, 51, 55, 56, 70]) {
  const parts = split(qty, 50, 5, 1);
  check(`whole in, whole out at ${qty}`,
    parts.every((p) => Number.isInteger(p)), true);
  check(`the parts re-sum to ${qty}`, parts.reduce((a, b) => a + b, 0), qty);
}

// ── The sum is the quantity, always (except under the floor) ────────────────
for (const qty of [2, 3, 5, 137, 271, 272, 400]) {
  check(`two-challan parts re-sum to ${qty}`,
    split(qty, 200, 72).reduce((a, b) => a + b, 0), qty);
}

// ── No member is ever starved above the floor ───────────────────────────────
for (const qty of [3, 6, 20, 56]) {
  check(`nothing is zeroed at ${qty}`, split(qty, 50, 5, 1).every((p) => p > 0), true);
}

// ── Degenerate inputs ───────────────────────────────────────────────────────
check("no members splits to nothing", split(5), []);
check("an empty row has no floor", rowFloor([]), 0);
check("a blank quantity is under any floor", isUnderFloor("", members(4)), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
