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

const { buildInvoiceActions, statusReason, fbrChip } = await import(src("utils/invoiceActions.js"));
const all = { canEdit: true, canPrint: true, canVoid: true, canDelete: true, canCopy: true, canCreateChallan: true,
  canRecordReceipt: true, canReverse: true, canFbrPreview: true, canFbrValidate: true, canFbrSubmit: true,
  canFbrExclude: true, canFbrReset: true };
const ctx = (over = {}) => ({ perms: all, fbrEnabled: true, hasFbrToken: true, validated: false, hasExcel: true, ...over });
const unfiled = { id: 1, invoiceNumber: 7, fbrStatus: null, fbrReady: true, isCancelled: false };
const filed = { ...unfiled, fbrStatus: "Submitted", fbrIRN: "IRN-1" };
const keys = (inv, c) => buildInvoiceActions(inv, c).map((x) => x.key);

console.log("\n=== card / table actions (D10) ===");
check("64: every action has a label and a one-line tooltip", () => {
  for (const x of buildInvoiceActions(unfiled, ctx()).concat(buildInvoiceActions(filed, ctx())))
    assert.ok(x.label && x.title && !x.title.includes("\n"), JSON.stringify(x));
});
check("65: order is primary, FBR, money, danger last", () => {
  const order = { primary: 0, fbr: 1, money: 2, danger: 3 };
  const g = buildInvoiceActions(unfiled, ctx()).map((x) => order[x.group]);
  assert.deepStrictEqual(g, [...g].sort((x, y) => x - y));
});
check("66: Void and Delete are the danger actions, and come last", () => {
  const a = buildInvoiceActions(unfiled, ctx());
  assert.deepStrictEqual(a.filter((x) => x.danger).map((x) => x.key), ["void", "delete"]);
  assert.deepStrictEqual(a.slice(-2).map((x) => x.key), ["void", "delete"]);
});
check("43: a filed invoice offers no Edit / Void / Delete / Validate / Submit", () => {
  const k = keys(filed, ctx());
  for (const gone of ["edit", "void", "delete", "validate", "submit", "exclude"]) assert.ok(!k.includes(gone), gone);
  assert.ok(k.includes("creditNote") && k.includes("print"));
});
check("43: and the status line says why", () =>
  assert.strictEqual(statusReason(filed), "Filed with FBR — correct it with a credit or debit note."));
check("10: only bills.* keys -> no FBR actions", () => {
  const perms = { canEdit: true, canPrint: true, canVoid: true, canDelete: true, canCopy: true };
  const k = keys(unfiled, ctx({ perms }));
  assert.ok(!k.some((x) => ["validate", "submit", "preview", "exclude", "reset"].includes(x)));
  assert.ok(k.includes("edit") && k.includes("void"));
});
check("11: only invoices.* keys -> FBR + print, no Edit / Void", () => {
  const perms = { canPrint: true, canFbrValidate: true, canFbrSubmit: true, canFbrPreview: true };
  const k = keys(unfiled, ctx({ perms }));
  assert.ok(k.includes("validate") && k.includes("print") && !k.includes("edit") && !k.includes("void"));
});
check("13: no print key -> no Print / PDF / Excel", () => {
  const k = keys(unfiled, ctx({ perms: { ...all, canPrint: false } }));
  assert.ok(!k.includes("print") && !k.includes("pdf") && !k.includes("excel"));
});
check("Submit waits for Validate", () => {
  const sub = buildInvoiceActions(unfiled, ctx()).find((x) => x.key === "submit");
  assert.ok(sub.disabled);
  assert.ok(!buildInvoiceActions(unfiled, ctx({ validated: true })).find((x) => x.key === "submit").disabled);
});
check("FBR off -> no FBR actions at all", () =>
  assert.ok(!keys(unfiled, ctx({ fbrEnabled: false })).some((x) => ["validate", "submit", "preview", "exclude"].includes(x))));
check("a stuck submission offers Reset and nothing to submit", () => {
  const k = keys({ ...unfiled, fbrStatus: "Uncertain" }, ctx());
  assert.ok(k.includes("reset") && !k.includes("submit") && !k.includes("validate"));
});
check("a voided invoice offers only View and printing", () =>
  assert.deepStrictEqual(keys({ ...unfiled, isCancelled: true }, ctx({ perms: { ...all, canFbrPreview: false } })), ["print", "view", "pdf", "excel"]));
const inline = (inv, c) => buildInvoiceActions(inv, c).filter((x) => x.primary).map((x) => x.key);
check("an open invoice shows Edit, Print, PDF and Validate on the card", () =>
  assert.deepStrictEqual(inline(unfiled, ctx()), ["edit", "print", "pdf", "validate"]));
check("once validated, Submit takes Validate's place inline", () =>
  assert.deepStrictEqual(inline(unfiled, ctx({ validated: true })), ["edit", "print", "pdf", "submit"]));
check("a filed invoice shows Print, View and PDF inline (no Edit)", () =>
  assert.deepStrictEqual(inline(filed, ctx()), ["print", "view", "pdf"]));
const manual = { ...filed, fbrIRN: null, fbrFiledManually: true, fbrInvoiceNumber: "ABC-1" };
check("53: an unsent invoice offers 'Filed on FBR portal' to a reset-key holder", () =>
  assert.ok(keys(unfiled, ctx()).includes("recordManual")));
check("53: ...not without invoices.fbr.reset, and not with FBR off", () => {
  assert.ok(!keys(unfiled, ctx({ perms: { ...all, canFbrReset: false } })).includes("recordManual"));
  assert.ok(!keys(unfiled, ctx({ fbrEnabled: false })).includes("recordManual"));
});
check("53: ...not on a filed, stuck or voided invoice", () => {
  for (const inv of [filed, { ...unfiled, fbrStatus: "Uncertain" }, { ...unfiled, isCancelled: true }])
    assert.ok(!keys(inv, ctx()).includes("recordManual"), JSON.stringify(inv));
});
check("a manually filed invoice keeps Edit, offers no credit note or correction", () => {
  const k = keys(manual, ctx());
  assert.ok(k.includes("edit") && !k.includes("creditNote") && !k.includes("correct") && !k.includes("void"));
});
check("a manually filed invoice says where it was filed", () =>
  assert.match(statusReason(manual), /by hand on FBR's portal as ABC-1/));
check("67: its chip reads Filed manually", () => assert.strictEqual(fbrChip(manual).label, "Filed manually"));

console.log("\n=== FBR chip (67) ===");
const chip = (inv, o) => fbrChip(inv, o)?.label ?? null;
check("unfiled -> Not filed", () => assert.strictEqual(chip(unfiled), "Not filed"));
check("validated -> Checked", () => assert.strictEqual(chip(unfiled, { validated: true }), "Checked"));
check("filed -> Filed, with the IRN", () => assert.strictEqual(fbrChip(filed).irn, "IRN-1"));
check("filed manually -> Filed manually", () => assert.strictEqual(chip({ ...filed, fbrFiledManually: true }), "Filed manually"));
check("excluded -> Kept out of FBR", () => assert.strictEqual(chip({ ...unfiled, isFbrExcluded: true }), "Kept out of FBR"));
check("withdrawn -> Withdrawn", () => assert.strictEqual(chip({ ...filed, fbrCancelledAt: "2026-10-01" }), "Withdrawn"));
check("voided -> Voided", () => assert.strictEqual(chip({ ...unfiled, isCancelled: true }), "Voided"));
check("FBR off and never filed -> no chip", () => assert.strictEqual(chip(unfiled, { fbrEnabled: false }), null));
check("FBR off but filed -> still Filed", () => assert.strictEqual(chip(filed, { fbrEnabled: false }), "Filed"));

console.log(`\n${pass}/${pass + failures.length} checks passed`);
if (failures.length) process.exit(1);
