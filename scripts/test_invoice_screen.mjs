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

const { lineStock, isHardBlock, pendingFromFbrCode } = await import(src("utils/lineStock.js"));
const hard = { inventoryTrackingEnabled: true, stockGuardHardBlock: true, inventoryFlowVersion: 1 };
const soft = { inventoryTrackingEnabled: true, stockGuardHardBlock: false, inventoryFlowVersion: 1 };
const off = { inventoryTrackingEnabled: false, stockGuardHardBlock: true };
const pending = { name: "Check valve", hsCode: "8481.3000" };

console.log("\n=== stock before save (D8) ===");
check("41: a pending new item on a hard-block company: No stock, Save blocked", () =>
  assert.deepStrictEqual(lineStock({ pending, quantity: 1, company: hard }), { noStock: true, blocksSave: true, onHand: 0 }));
check("41d: the same on a soft company: No stock, Save allowed", () => {
  const r = lineStock({ pending, quantity: 1, company: soft });
  assert.ok(r.noStock && !r.blocksSave);
});
check("41c: a catalog item with less on hand than the line: blocked when hard", () =>
  assert.ok(lineStock({ item: { hsCode: "8481.3000", availableQty: 2 }, quantity: 5, company: hard }).blocksSave));
check("a catalog item with enough stock is fine", () =>
  assert.ok(!lineStock({ item: { hsCode: "8481.3000", availableQty: 5 }, quantity: 5, company: hard }).noStock));
check("v1 tracking ignores an item with no HS code", () =>
  assert.ok(!lineStock({ item: { hsCode: "", availableQty: 0 }, quantity: 5, company: hard }).noStock));
check("v2 tracking counts an item with no HS code", () =>
  assert.ok(lineStock({ item: { hsCode: "", availableQty: 0 }, quantity: 5, company: { ...hard, inventoryFlowVersion: 2 } }).blocksSave));
check("tracking off: never a stock message", () =>
  assert.ok(!lineStock({ pending, quantity: 1, company: off }).noStock && !isHardBlock(off)));
check("an item with no on-hand figure is left to the server", () =>
  assert.ok(!lineStock({ item: { hsCode: "8481.3000" }, quantity: 5, company: hard }).noStock));

console.log("\n=== FBR code -> pending new item (D7) ===");
check("32: name is the FBR description, trimmed to 100 characters", () => {
  const p = pendingFromFbrCode({ id: 7, hsCode: "8481.3000", fbrDescription: "x".repeat(150), uom: "" });
  assert.strictEqual(p.name.length, 100);
  assert.strictEqual(p.placeholderId, 7);
  assert.strictEqual(p.hsCode, "8481.3000");
});
check("32: no FBR description falls back to the row name", () =>
  assert.strictEqual(pendingFromFbrCode({ id: null, hsCode: "1", name: "HS Code 1" }).name, "HS Code 1"));

console.log(`\n${pass}/${pass + failures.length} checks passed`);
if (failures.length) process.exit(1);
