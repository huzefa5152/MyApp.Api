/*
 * The importer's one Invoices screen, pinned offline: the pure decisions the
 * create / edit forms and the invoice card + table share.
 *
 *   - utils/lineDescription.js: what a line description becomes when an item
 *     is picked (plan cases 15-19, 26, 39).
 *
 * Run:  node scripts/test_invoice_screen.mjs
 */
import assert from "node:assert";

const src = (p) => new URL(`../myapp-frontend/src/${p}`, import.meta.url).href;
const { autoDescription, descriptionAfterPick } = await import(src("utils/lineDescription.js"));

let pass = 0;
const failures = [];
function check(label, fn) {
  try { fn(); pass++; console.log("  PASS", label); }
  catch (e) { failures.push(label); console.log("  FAIL", label, "\n      ", e.message); }
}

const valve = { id: 1, name: "Ball Valve 2in" };
const pump = { id: 2, name: "Water Pump 1HP" };
const charge = { id: 9, name: "Freight", defaultLineDescription: "Freight and handling" };

console.log("\n=== line description (D6) ===");
check("15: picking an item fills an empty description", () =>
  assert.strictEqual(descriptionAfterPick("", "", valve), "Ball Valve 2in"));
check("15: whitespace-only counts as empty", () =>
  assert.strictEqual(descriptionAfterPick("   ", "", valve), "Ball Valve 2in"));
check("16: a description typed first is kept", () =>
  assert.strictEqual(descriptionAfterPick("Brass valve, export grade", "", valve), "Brass valve, export grade"));
check("17: the auto text follows a swap to another item", () =>
  assert.strictEqual(descriptionAfterPick("Ball Valve 2in", "Ball Valve 2in", pump), "Water Pump 1HP"));
check("17: the auto text follows even with outer spaces", () =>
  assert.strictEqual(descriptionAfterPick(" Ball Valve 2in ", "Ball Valve 2in", pump), "Water Pump 1HP"));
check("18: an edited auto text survives a swap", () =>
  assert.strictEqual(descriptionAfterPick("Ball Valve 2in - blue", "Ball Valve 2in", pump), "Ball Valve 2in - blue"));
check("19: clearing the item keeps the description", () =>
  assert.strictEqual(descriptionAfterPick("Ball Valve 2in", "Ball Valve 2in", null), "Ball Valve 2in"));
check("default line text wins over the name", () =>
  assert.strictEqual(autoDescription(charge), "Freight and handling"));
check("non-inventory pick fills an empty line with its default text", () =>
  assert.strictEqual(descriptionAfterPick("", "", charge), "Freight and handling"));
check("an item with no text leaves the description alone", () =>
  assert.strictEqual(descriptionAfterPick("kept", "", { id: 3, name: "" }), "kept"));
check("26: a challan line's own text is kept when an item is picked", () =>
  assert.strictEqual(descriptionAfterPick("As per challan 41, 12 cartons", "", valve), "As per challan 41, 12 cartons"));

console.log(`\n${pass}/${pass + failures.length} checks passed`);
if (failures.length) process.exit(1);
