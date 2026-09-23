#!/usr/bin/env node
// Grouped-quantity spread (EditBillForm, invoice mode) — offline, no backend.
//
// Pins the rule that retyping a grouped Item Type's quantity never leaves a
// bill line at zero while there are enough units to go round, that the lines
// always re-sum to what was typed, and that a total the group genuinely cannot
// hold is reported rather than silently split with zeros.
//
//   node scripts/test_group_quantity_split.mjs
import { splitGroupQuantity } from "../myapp-frontend/src/utils/groupQuantitySplit.js";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}  -- ${detail}`); }
};
const sum = (a) => a.reduce((x, y) => x + y, 0);

// INV-3932 as it stood on 2026-09-19: 37 medicine lines, 137 units.
const inv3932 = [1,1,3,2,3,6,4,1,1,6,6,6,2,5,2,2,6,6,4,3,1,6,1,6,1,6,1,7,2,4,1,2,4,10,8,6,1];
check("fixture is the real bill", inv3932.length === 37 && sum(inv3932) === 137);

console.log("\n=== 1. The bug: 61 units over 37 lines ===");
{
  const r = splitGroupQuantity(61, inv3932);
  check("no line is left at zero", r.shares.every((q) => q >= 1), `zeros: ${r.shares.filter((q) => q <= 0).length}`);
  check("the lines re-sum to 61", sum(r.shares) === 61, `sum ${sum(r.shares)}`);
  check("every share is a whole number", r.shares.every(Number.isInteger));
  check("reported as feasible", r.infeasible === false);
  const biggest = r.shares[inv3932.indexOf(10)];
  check("the 10-unit line still gets the most", biggest === Math.max(...r.shares), `10-unit line got ${biggest}`);
}

console.log("\n=== 2. Retyping the same total is a no-op ===");
{
  const r = splitGroupQuantity(137, inv3932);
  check("137 reproduces the original lines exactly", r.shares.join(",") === inv3932.join(","));
}

console.log("\n=== 3. Exactly one unit per line ===");
{
  const r = splitGroupQuantity(37, inv3932);
  check("37 units → every line 1", r.shares.every((q) => q === 1) && r.infeasible === false);
}

console.log("\n=== 4. Fewer units than lines cannot be split whole ===");
{
  const r = splitGroupQuantity(36, inv3932);
  check("36 units over 37 lines is infeasible", r.infeasible === true);
  check("and says the minimum is 37", r.minimum === 37, `minimum ${r.minimum}`);
  check("shares still sum to what was typed (half-typed values keep echoing)", sum(r.shares) === 36, `sum ${sum(r.shares)}`);
  const six = splitGroupQuantity(6, inv3932);
  check("a half-typed '6' on the way to '61' is infeasible, not a crash", six.infeasible === true && sum(six.shares) === 6);
}

console.log("\n=== 5. Weights ===");
{
  const r = splitGroupQuantity(10, [0, 0, 0, 0]);
  check("no original quantities → even split", r.shares.join(",") === "3,3,2,2" || sum(r.shares) === 10 && r.shares.every((q) => q >= 2));
  const s = splitGroupQuantity(5, [4]);
  check("single line takes the whole total", s.shares.join(",") === "5");
  const heavy = splitGroupQuantity(100, [1, 99]);
  check("proportion survives when no repair is needed", heavy.shares.join(",") === "1,99", heavy.shares.join(","));
  const skew = splitGroupQuantity(3, [1, 1, 100]);
  check("repair takes from the largest line, not from a small one", skew.shares.join(",") === "1,1,1", skew.shares.join(","));
}

console.log("\n=== 6. Decimal units ===");
{
  const r = splitGroupQuantity(10.5, [1, 2], { allowDecimal: true });
  check("10.5 over weights 1:2 → 3.5 + 7", r.shares.join(",") === "3.5,7", r.shares.join(","));
  const t = splitGroupQuantity(1, [1, 1, 1], { allowDecimal: true });
  check("decimal shares re-sum exactly at 4 dp", Math.abs(sum(t.shares) - 1) < 1e-9 && t.shares.every((q) => q > 0), t.shares.join(","));
  const z = splitGroupQuantity(0, [1, 2], { allowDecimal: true });
  check("zero total is infeasible", z.infeasible === true);
}

console.log("\n=== 7. Per-line decimal capability (decimalOk) ===");
{
  // One Item Type can cover lines on different units, so the question "may this
  // carry a fraction?" belongs to the line, not the group. INV-3922 (2026-09-23):
  // a consultant filing 1.61 against a two-line Chemical group was rounded to 2.
  const both = splitGroupQuantity(1.61, [1, 1], { decimalOk: [true, true] });
  check("1.61 over two decimal lines re-sums exactly",
    Math.abs(sum(both.shares) - 1.61) < 1e-9 && both.shares.every((q) => q > 0), both.shares.join(","));

  const mixed = splitGroupQuantity(1.61, [1, 1], { decimalOk: [false, true] });
  check("the integer-only line keeps a whole number", Number.isInteger(mixed.shares[0]), mixed.shares.join(","));
  check("and the decimal line carries the fraction",
    Math.abs(sum(mixed.shares) - 1.61) < 1e-9 && mixed.shares[1] > 0, mixed.shares.join(","));

  const mixed2 = splitGroupQuantity(5.5, [2, 3], { decimalOk: [false, true] });
  check("mixed split re-sums exactly at a larger total",
    Math.abs(sum(mixed2.shares) - 5.5) < 1e-9 && Number.isInteger(mixed2.shares[0]), mixed2.shares.join(","));

  // Capability is permission, not instruction: a whole total splits whole.
  const whole = splitGroupQuantity(58, [1, 100], { decimalOk: [true, true] });
  check("a whole total still splits into whole lines", whole.shares.join(",") === "1,57", whole.shares.join(","));

  // And a fraction typed where nothing can hold one is rounded, not invented.
  const none = splitGroupQuantity(1.61, [1, 1], { decimalOk: [false, false] });
  check("no decimal line → whole shares only", none.shares.every(Number.isInteger), none.shares.join(","));
}

console.log("\n=== 8. Bad input ===");
{
  check("NaN total → zeros, infeasible", splitGroupQuantity(NaN, [1, 2]).infeasible === true);
  check("empty group → empty shares", splitGroupQuantity(5, []).shares.length === 0);
}

console.log("\n" + "=".repeat(60));
if (fail) { console.log(`  ${pass} passed, ${fail} FAILED`); process.exit(1); }
console.log(`  ${pass} passed, 0 failed`);
