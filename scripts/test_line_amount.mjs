// Offline checks for utils/lineAmount.js — no backend, no DB:
//   node scripts/test_line_amount.mjs
//
// The load-bearing property is the ROUND TRIP. The server recomputes
// LineTotal = Quantity × UnitPrice, so a rate this module derives has to
// reproduce the total the operator typed once stored at 2dp. If that ever
// stops holding, a bill silently bills a different amount than the one on
// screen — which is exactly what happened at 2dp rates (220,000 over 196
// units came out as 220,000.20).

import {
  roundTo, lineTotalFrom, unitPriceFrom, roundTripsTo, recalcLine, displayUnitPrice,
} from "../myapp-frontend/src/utils/lineAmount.js";

let passed = 0, failed = 0;
const fails = [];

function check(label, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; fails.push(`${label} — ${detail}`); console.log(`  FAIL  ${label}  (${detail})`); }
}

console.log("\n=== rounding ===");
check("2dp half-up", roundTo(0.145, 2) === 0.15, roundTo(0.145, 2));
check("negative rounds away from zero", roundTo(-0.145, 2) === -0.15, roundTo(-0.145, 2));
check("already-round value is untouched", roundTo(220000, 2) === 220000, roundTo(220000, 2));

console.log("\n=== the case this exists for: 220,000 over 196 ===");
const rate = unitPriceFrom(220000, 196);
check("rate is derived at 12dp", rate === 1122.448979591837, String(rate));
check("rate × qty stores back as exactly 220,000.00",
  lineTotalFrom(196, rate) === 220000, String(lineTotalFrom(196, rate)));
check("the OLD 2dp rate is what produced 220,000.20",
  lineTotalFrom(196, 1122.45) === 220000.2, String(lineTotalFrom(196, 1122.45)));

console.log("\n=== round trip over many awkward splits ===");
let worst = 0, worstCase = null;
for (const total of [220000, 100000, 99.01, 1, 12345.67, 7, 2000, 333.33]) {
  for (const qty of [1, 3, 7, 196, 999, 1000, 13]) {
    const p = unitPriceFrom(total, qty);
    const back = lineTotalFrom(qty, p);
    const drift = Math.abs(back - roundTo(total, 2));
    if (drift > worst) { worst = drift; worstCase = `${total} / ${qty} -> ${p} -> ${back}`; }
  }
}
check("every total/qty pair round-trips exactly", worst === 0, `worst drift ${worst} at ${worstCase}`);

console.log("\n=== guards ===");
check("zero quantity yields no rate rather than 0", unitPriceFrom(500, 0) === null, String(unitPriceFrom(500, 0)));
check("negative quantity yields no rate", unitPriceFrom(500, -2) === null, String(unitPriceFrom(500, -2)));
check("non-numeric total yields no rate", unitPriceFrom("abc", 5) === null, String(unitPriceFrom("abc", 5)));

console.log("\n=== recalcLine: the field just typed is never overwritten ===");
let r = recalcLine({ quantity: "196", unitPrice: "1122.45", lineTotal: "220000.20" }, "lineTotal");
check("editing the total keeps the total verbatim", r.lineTotal === "220000.20", r.lineTotal);
check("editing the total re-derives the rate", r.unitPrice === "1122.45", r.unitPrice);
check("editing the total leaves quantity alone", r.quantity === "196", r.quantity);

// ...and the correction the operator actually wants: type the round figure.
r = recalcLine({ quantity: "196", unitPrice: "1122.45", lineTotal: "220000" }, "lineTotal");
check("typing the round total derives the 12dp rate", r.unitPrice === "1122.448979591837", r.unitPrice);
check("that rate reproduces 220,000.00 exactly",
  lineTotalFrom(196, Number(r.unitPrice)) === 220000, String(lineTotalFrom(196, Number(r.unitPrice))));

r = recalcLine({ quantity: "10", unitPrice: "25", lineTotal: "" }, "unitPrice");
check("editing the rate computes the total", r.lineTotal === "250", r.lineTotal);
check("editing the rate keeps the rate verbatim", r.unitPrice === "25", r.unitPrice);

r = recalcLine({ quantity: "20", unitPrice: "25", lineTotal: "250" }, "quantity");
check("a quantity change follows the RATE when one is set", r.lineTotal === "500", r.lineTotal);

r = recalcLine({ quantity: "8", unitPrice: "", lineTotal: "200" }, "quantity");
check("a quantity change re-derives the rate when only a total is set",
  r.unitPrice === "25" && r.lineTotal === "200", `${r.unitPrice} / ${r.lineTotal}`);

r = recalcLine({ quantity: "", unitPrice: "", lineTotal: "" }, "quantity");
check("empty boxes stay empty", r.quantity === "" && r.unitPrice === "" && r.lineTotal === "",
  JSON.stringify(r));

r = recalcLine({ quantity: "0", unitPrice: "", lineTotal: "500" }, "lineTotal");
check("a total typed against zero quantity does not invent a rate",
  r.unitPrice === "", `unitPrice=${r.unitPrice}`);

console.log("\n=== display: short when it can be, long when it must be ===");
check("a clean rate shows short", displayUnitPrice(25, 10, 250) === "25", displayUnitPrice(25, 10, 250));
check("an awkward rate keeps enough decimals to still reproduce the total",
  roundTripsTo(196, Number(displayUnitPrice(rate, 196, 220000)), 220000),
  displayUnitPrice(rate, 196, 220000));

console.log("\n" + "=".repeat(60));
console.log(`  ${passed} passed, ${failed} failed`);
for (const f of fails) console.log(`   - ${f}`);
process.exit(failed ? 1 : 0);
