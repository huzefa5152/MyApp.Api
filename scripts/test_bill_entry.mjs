/*
 * The two decisions every bill screen shares, pinned offline: what is left
 * before a bill can be saved (the footer checklist), and which totals rows it
 * shows. Both live in myapp-frontend/src/utils/billEntry.js, a pure module, so
 * New Bill, New Bill (No Challan), Edit and View cannot drift apart again.
 *
 * The totals rows must reproduce the rows the forms printed before the
 * redesign, figure for figure: the redesign changes layout and wording, never
 * an amount.
 *
 * Run:  node scripts/test_bill_entry.mjs
 */
import assert from "node:assert";

const { BILL_ANCHORS, lineAnchor, rateBlockText, billChecklist, billTotalsRows } = await import(
  new URL("../myapp-frontend/src/utils/billEntry.js", import.meta.url).href
);

let pass = 0;
const failures = [];
function check(label, fn) {
  try { fn(); pass++; console.log("  PASS", label); }
  catch (e) { failures.push(label); console.log("  FAIL", label, "\n      ", e.message); }
}

const ready = { needsScenario: true, hasScenario: true, hasBuyer: true, billNumberOk: true, rateBlock: null, lines: [] };

console.log("\n=== checklist ===");
check("a complete bill has nothing left", () => assert.deepStrictEqual(billChecklist(ready), []));
check("FBR off needs no scenario", () =>
  assert.deepStrictEqual(billChecklist({ ...ready, needsScenario: false, hasScenario: false }), []));
check("order: scenario, buyer, number, rate, then lines", () => {
  const items = billChecklist({
    needsScenario: true, hasScenario: false, hasBuyer: false, billNumberOk: false,
    rateBlock: "These goods came in at a different sales tax rate: change the scenario, or write a reason.",
    lines: [{ key: "a1", n: 2, problem: "enter Qty" }],
  });
  assert.deepStrictEqual(items.map((i) => i.key), ["scenario", "buyer", "number", "rate", "line-a1"]);
});
check("targets are the shared anchors", () => {
  const items = billChecklist({ ...ready, hasBuyer: false, rateBlock: "x", lines: [{ key: 7, n: 1, problem: "enter Qty" }] });
  assert.deepStrictEqual(items.map((i) => i.target), [BILL_ANCHORS.buyer, BILL_ANCHORS.rate, lineAnchor(7)]);
});
check("a line reads 'Line n: what it needs'", () => {
  const [item] = billChecklist({ ...ready, lines: [{ key: "x", n: 2, problem: "enter Qty" }] });
  assert.strictEqual(item.label, "Line 2: enter Qty");
});
check("extra items come last", () => {
  const items = billChecklist({ ...ready, hasBuyer: false, extra: [{ key: "challans", label: "Pick a challan", target: BILL_ANCHORS.challans }] });
  assert.deepStrictEqual(items.map((i) => i.key), ["buyer", "challans"]);
});
check("lineAnchor is stable and prefixed", () => assert.strictEqual(lineAnchor("r9"), "bill-line-r9"));

console.log("\n=== rate block wording ===");
check("with a one-click switch it names the button", () =>
  assert.match(rateBlockText({ suggestion: { label: "Bill under SN024 (25%)" }, splitNeeded: false }), /press “Bill under SN024 \(25%\)”, or write a reason\./));
check("goods at two rates are told to split", () =>
  assert.match(rateBlockText({ suggestion: { label: "x" }, splitNeeded: true }), /separate bills/));
check("no suggestion: change the scenario", () =>
  assert.match(rateBlockText({ suggestion: null, splitNeeded: false }), /change the scenario, or write a reason\./));

console.log("\n=== totals rows ===");
const base = { subtotal: 10000, gstRate: 25, gstAmount: 2500, grandTotal: 12500, scenarioCode: "SN024" };
check("plain bill: subtotal, GST, grand total", () =>
  assert.deepStrictEqual(billTotalsRows(base).map((r) => [r.key, r.amount]),
    [["subtotal", 10000], ["gst", 2500], ["grand", 12500]]));
check("GST row names its rate and scenario", () => {
  const gst = billTotalsRows(base).find((r) => r.key === "gst");
  assert.strictEqual(gst.label, "GST (25%)");
  assert.match(gst.note, /SN024/);
});
check("further tax only when charged, and says why", () => {
  assert.ok(!billTotalsRows({ ...base, furtherTaxRate: 4, furtherTaxAmount: 0 }).some((r) => r.key === "further"));
  const rows = billTotalsRows({ ...base, furtherTaxRate: 4, furtherTaxAmount: 400, grandTotal: 12900, buyerRegistered: false });
  const ft = rows.find((r) => r.key === "further");
  assert.strictEqual(ft.label, "Further Tax (4%)");
  assert.strictEqual(ft.amount, 400);
  assert.match(ft.note, /unregistered/);
  assert.deepStrictEqual(rows.map((r) => r.key), ["subtotal", "gst", "further", "grand"]);
});
check("withholding adds itself and the balance due", () => {
  const rows = billTotalsRows({ ...base, withholdingAmount: 500, withholdingRate: 4, balanceDue: 12000 });
  assert.deepStrictEqual(rows.map((r) => [r.key, r.amount]),
    [["subtotal", 10000], ["gst", 2500], ["grand", 12500], ["wht", 500], ["balance", 12000]]);
  assert.strictEqual(rows.find((r) => r.key === "wht").label, "Withholding tax (4%)");
  assert.strictEqual(rows.find((r) => r.key === "balance").strong, true);
});
check("a fixed-amount withholding shows no rate", () =>
  assert.strictEqual(billTotalsRows({ ...base, withholdingAmount: 500, withholdingRate: null, balanceDue: 12000 })
    .find((r) => r.key === "wht").label, "Withholding tax"));
check("advance income tax adds itself and the total", () => {
  const rows = billTotalsRows({ ...base, advanceTaxAmount: 12.5, advanceTaxSection: "236G", advanceTaxRate: 0.1, totalWithAdvance: 12512.5 });
  assert.deepStrictEqual(rows.slice(-2).map((r) => [r.key, r.amount]), [["advance", 12.5], ["total-adv", 12512.5]]);
  assert.strictEqual(rows.find((r) => r.key === "advance").label, "Advance income tax 236G (0.1%)");
});
check("grand total is the strong row", () =>
  assert.deepStrictEqual(billTotalsRows(base).filter((r) => r.strong).map((r) => r.key), ["grand"]));

console.log(`\n${pass}/${pass + failures.length} checks passed`);
if (failures.length) process.exit(1);
