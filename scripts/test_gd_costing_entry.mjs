/*
 * The Import Costing screen's decisions, pinned offline:
 * myapp-frontend/src/utils/gdCostingEntry.js.
 *
 * The line rules are a MIRROR of Helpers/GdLineRules.cs, so the checks here
 * repeat the offline harness's cases and the server's exact messages -- if the
 * two disagree, the screen promises what the server refuses. The rest (what
 * happens to each line, the checklist, the summary) only reads a preview.
 *
 * Run:  node scripts/test_gd_costing_entry.mjs
 */
import assert from "node:assert";

const {
  FIELDS, MODE_NEW_ARRIVALS, MODE_BACKFILL, lineAnchor, cleanHsCode, lineProblems, messagesFor,
  computeCosting, blankLine, nextLineFrom, editorLineFrom, toLinePayload, previewLineToPayload,
  defaultLeaveOut, effectiveLeaveOut, lineOutcome, entryChecklist, commitSummary, summarySentences,
  commitLabel,
} = await import(new URL("../myapp-frontend/src/utils/gdCostingEntry.js", import.meta.url).href);

let pass = 0;
const failures = [];
function check(label, fn) {
  try { fn(); pass++; console.log("  PASS", label); }
  catch (e) { failures.push(label); console.log("  FAIL", label, "\n      ", e.message); }
}

const TODAY = "2026-09-25";
const good = () => ({
  gdNumber: "KAPW-HC-8876", gdDate: "2026-09-01", description: "SCREW DRIVER", hsCode: "8205.4000",
  quantity: "10", unit: "Pcs", assessedValue: "62490", customsDuty: "0", acd: "0", regulatoryDuty: "0",
  others: "0", salesTaxRate: "18", astRate: "3", incomeTaxRate: "6", addOnProfit: "0", sellingValue: "",
});
const fields = (m) => lineProblems(m, TODAY).map((p) => p.field).join(",");

console.log("\n=== line rules (mirror of GdLineRules) ===");
check("a complete line has no problems", () => assert.strictEqual(fields(good()), ""));
check("a padded HS code cleans and passes", () => assert.strictEqual(fields({ ...good(), hsCode: "  8205.4000 " }), ""));
check("blank GD number", () => assert.strictEqual(fields({ ...good(), gdNumber: "  " }), FIELDS.gdNumber));
check("missing GD date", () => assert.strictEqual(fields({ ...good(), gdDate: "" }), FIELDS.gdDate));
check("GD date before 2000", () => assert.strictEqual(fields({ ...good(), gdDate: "1999-12-31" }), FIELDS.gdDate));
check("1 Jan 2000 is allowed", () => assert.strictEqual(fields({ ...good(), gdDate: "2000-01-01" }), ""));
check("tomorrow is allowed (Pakistan runs ahead of UTC)", () => assert.strictEqual(fields({ ...good(), gdDate: "2026-09-26" }), ""));
check("the day after tomorrow is the future", () => assert.strictEqual(fields({ ...good(), gdDate: "2026-09-27" }), FIELDS.gdDate));
check("a server ISO date is read by its day", () => assert.strictEqual(fields({ ...good(), gdDate: "2026-07-01T00:00:00" }), ""));
check("blank description", () => assert.strictEqual(fields({ ...good(), description: "" }), FIELDS.description));
check("blank HS code", () => assert.strictEqual(fields({ ...good(), hsCode: "" }), FIELDS.hsCode));
check("punctuation-only HS code", () => assert.strictEqual(fields({ ...good(), hsCode: " - " }), FIELDS.hsCode));
check("quantity zero", () => assert.strictEqual(fields({ ...good(), quantity: "0" }), FIELDS.quantity));
check("quantity blank", () => assert.strictEqual(fields({ ...good(), quantity: "" }), FIELDS.quantity));
check("a fractional quantity is fine", () => assert.strictEqual(fields({ ...good(), quantity: "0.5" }), ""));
check("blank unit", () => assert.strictEqual(fields({ ...good(), unit: " " }), FIELDS.unit));
check("assessed value zero", () => assert.strictEqual(fields({ ...good(), assessedValue: "0" }), FIELDS.assessedValue));
check("assessed value of a paisa is fine", () => assert.strictEqual(fields({ ...good(), assessedValue: "0.01" }), ""));
check("a negative duty", () => assert.strictEqual(fields({ ...good(), regulatoryDuty: "-5" }), FIELDS.amounts));
check("a rate of 100 is refused", () => assert.strictEqual(fields({ ...good(), incomeTaxRate: "100" }), FIELDS.rates));
check("a negative rate is refused", () => assert.strictEqual(fields({ ...good(), astRate: "-1" }), FIELDS.rates));
check("99.99 and 0 are rates", () => assert.strictEqual(fields({ ...good(), salesTaxRate: "99.99", astRate: "0" }), ""));
check("a negative stated selling value", () => assert.strictEqual(fields({ ...good(), sellingValue: "-1" }), FIELDS.sellingValue));
check("a blank stated selling value is simply not stated", () => assert.strictEqual(fields({ ...good(), sellingValue: "" }), ""));
check("several at once are all reported, in form order", () =>
  assert.strictEqual(fields({ ...good(), gdDate: "", unit: "", assessedValue: "0" }), "gdDate,unit,assessedValue"));
check("the messages are the server's, word for word", () => {
  const m = lineProblems({ ...good(), gdNumber: "", gdDate: "", description: "", hsCode: "", quantity: "", unit: "",
    assessedValue: "", customsDuty: "-1", salesTaxRate: "100", sellingValue: "-2" }, TODAY).map((p) => p.message);
  assert.deepStrictEqual(m, [
    "Enter the GD number.", "Enter the GD date.", "Enter what the goods are (the item name).",
    "Enter the HS code.", "Enter a quantity above zero.", "Enter the unit (Pcs, Kg, ...).",
    "Enter the assessed value from the GD.", "Duties, other charges and add-on profit cannot be negative.",
    "Each rate is a percentage from 0 to 100 (write 1% as 1).", "The stated selling value cannot be negative.",
  ]);
});
check("messagesFor picks one field's messages", () =>
  assert.deepStrictEqual(messagesFor([{ field: "unit", message: "a" }, { field: "gdDate", message: "b" }], "unit"), ["a"]));
check("cleanHsCode keeps digits and dots only", () => assert.strictEqual(cleanHsCode(" 8413.2000-A "), "8413.2000"));

console.log("\n=== costing chain (estimate) ===");
check("Alpha row 3 reproduces the client's own figures", () => {
  const c = computeCosting(good());
  assert.deepStrictEqual([c.cost, c.salesTax, c.ast, c.subtotal, c.incomeTax, c.inputTax, c.sellingValue],
    [62490, 11248.2, 1874.7, 75612.9, 4536.77, 13122.9, 72905]);
});
check("zero-rated goods sell at cost plus add-on", () =>
  assert.strictEqual(computeCosting({ ...good(), salesTaxRate: "0", addOnProfit: "10" }).sellingValue, 62500));

console.log("\n=== editor <-> payload ===");
check("a blank line starts on the 18/3/6 rates with nothing required filled", () => {
  const b = blankLine();
  assert.deepStrictEqual([b.salesTaxRate, b.astRate, b.incomeTaxRate], ["18", "3", "6"]);
  assert.strictEqual(fields(b), "gdNumber,gdDate,description,hsCode,quantity,unit,assessedValue");
});
check("the next line keeps the GD, date, unit and rates only", () => {
  const n = nextLineFrom({ ...good(), salesTaxRate: "25" });
  assert.deepStrictEqual([n.gdNumber, n.gdDate, n.unit, n.salesTaxRate, n.description, n.quantity, n.assessedValue],
    ["KAPW-HC-8876", "2026-09-01", "Pcs", "25", "", "", ""]);
});
check("the payload is numbers, trims text, and blank selling is null", () => {
  const p = toLinePayload({ ...good(), description: "  SCREW DRIVER ", unit: " Pcs " }, { sourceRow: 4, leaveOut: true });
  assert.deepStrictEqual([p.sourceRow, p.leaveOut, p.quantity, p.assessedValue, p.description, p.unit, p.sellingValue, p.gdDate],
    [4, true, 10, 62490, "SCREW DRIVER", "Pcs", null, "2026-09-01"]);
});
check("a preview line round-trips to the same payload, stated selling value kept", () => {
  const l = { sourceRow: 7, gdNumber: "G1", gdDate: "2026-07-01T00:00:00", description: "X", hsCode: "8413.2000",
    quantity: 3, unit: "Pcs", assessedValue: 100, customsDuty: 1, acd: 2, regulatoryDuty: 3, others: 4,
    salesTaxRate: 18, astRate: 3, incomeTaxRate: 6, addOnProfit: 0, sheetSellingValue: 150 };
  const e = editorLineFrom(l);
  assert.strictEqual(e.gdDate, "2026-07-01");
  const p = previewLineToPayload(l, { chosenOpeningStockBalanceId: 9 });
  assert.deepStrictEqual([p.sourceRow, p.quantity, p.customsDuty, p.sellingValue, p.chosenOpeningStockBalanceId, p.leaveOut],
    [7, 3, 1, 150, 9, null]);
});

console.log("\n=== leave-out defaults ===");
const newLine = { sourceRow: 1, disposition: "stock-posted" };
const matchedLine = { sourceRow: 2, disposition: "cost-only" };
check("Backfill leaves a line with nothing to price out by default", () =>
  assert.ok(defaultLeaveOut(newLine, MODE_BACKFILL) && !defaultLeaveOut(matchedLine, MODE_BACKFILL)));
check("New Arrivals brings every line in by default", () =>
  assert.ok(!defaultLeaveOut(newLine, MODE_NEW_ARRIVALS) && !defaultLeaveOut(matchedLine, MODE_NEW_ARRIVALS)));
check("the operator's own choice beats the default", () =>
  assert.ok(!effectiveLeaveOut(newLine, MODE_BACKFILL, { 1: false }) && effectiveLeaveOut(matchedLine, MODE_NEW_ARRIVALS, { 2: true })));

console.log("\n=== what happens to each line ===");
const adds = { sourceRow: 1, disposition: "cost-only", itemTypeId: 5, itemTypeName: "PUMP", quantity: 10, unit: "Pcs",
  matchedBalanceQuantity: 90, problems: [] };
check("new arrivals onto an item says how much and the new total", () => {
  const o = lineOutcome(adds, MODE_NEW_ARRIVALS);
  assert.deepStrictEqual([o.kind, o.title, o.detail, o.blocking], ["adds", "Adds 10 Pcs to PUMP", "On the books: 90 → 100", false]);
});
check("Backfill says it sets the cost, not the quantity", () =>
  assert.strictEqual(lineOutcome(adds, MODE_BACKFILL).kind, "cost"));
check("a new item names itself, its code and unit", () => {
  const o = lineOutcome({ sourceRow: 2, disposition: "stock-posted", hsCode: "8517.6250", newItemResolution: "create",
    newItemName: "ROUTER", newItemUnit: "Pcs", problems: [] }, MODE_NEW_ARRIVALS);
  assert.deepStrictEqual([o.kind, o.title], ["new", "New item: ROUTER"]);
  assert.match(o.detail, /8517\.6250, kept in Pcs/);
});
check("reusing a catalog item says so", () =>
  assert.match(lineOutcome({ disposition: "stock-posted", newItemResolution: "reuse", newItemName: "X", hsCode: "1", problems: [] },
    MODE_NEW_ARRIVALS).title, /^First stock of X/));
check("an ambiguous line asks for a choice", () => {
  const o = lineOutcome({ disposition: "ambiguous", hsCode: "8536.1010", candidates: [{}, {}], problems: [] }, MODE_NEW_ARRIVALS);
  assert.deepStrictEqual([o.kind, o.title], ["choose", "Choose the item"]);
  assert.match(o.detail, /2 items/);
});
check("a left-out line says its goods will not come in, and never blocks", () => {
  const o = lineOutcome({ ...adds, leaveOut: true, problems: [{ field: "unit", message: "x" }] }, MODE_NEW_ARRIVALS);
  assert.deepStrictEqual([o.kind, o.blocking], ["left-out", false]);
});
check("a line with a problem blocks", () =>
  assert.ok(lineOutcome({ ...adds, problems: [{ field: "unit", message: "x" }] }, MODE_NEW_ARRIVALS).blocking));

console.log("\n=== checklist ===");
check("no company: choose it first, nothing else", () =>
  assert.deepStrictEqual(entryChecklist({}).map((i) => i.key), ["company"]));
check("no preview yet: check the GD", () =>
  assert.deepStrictEqual(entryChecklist({ companyId: 4 }).map((i) => i.key), ["gd"]));
check("an edit after Check asks for Check again", () =>
  assert.deepStrictEqual(entryChecklist({ companyId: 4, preview: { lines: [adds] }, stale: true }).map((i) => i.key), ["stale"]));
check("a complete preview has nothing left", () =>
  assert.deepStrictEqual(entryChecklist({ companyId: 4, preview: { lines: [adds] } }), []));
check("blocking errors, problem lines and undecided lines are listed, each with its row", () => {
  const items = entryChecklist({ companyId: 4, preview: {
    blockingErrors: ["GD X already has a consignment"],
    lines: [
      { ...adds, sourceRow: 3, problems: [{ field: "unit", message: "Enter the unit (Pcs, Kg, ...)." }] },
      { sourceRow: 4, disposition: "ambiguous", problems: [] },
      { sourceRow: 5, disposition: "ambiguous", leaveOut: true, problems: [] },
    ] } });
  assert.deepStrictEqual(items.map((i) => i.label), [
    "GD X already has a consignment",
    "Row 3: Enter the unit (Pcs, Kg, ...).",
    "Row 4: choose the item, or leave the line out",
  ]);
  assert.strictEqual(items[1].target, lineAnchor(3));
});
check("every line left out is itself something to fix", () =>
  assert.deepStrictEqual(entryChecklist({ companyId: 4, preview: { lines: [{ ...adds, leaveOut: true }] } }).map((i) => i.key), ["all-out"]));

console.log("\n=== summary ===");
const preview = { lines: [
  { ...adds, cost: 1000, sellingValue: 1166.67 },
  { ...adds, sourceRow: 2, quantity: 5, cost: 500, sellingValue: 583.33 },
  { sourceRow: 3, disposition: "stock-posted", hsCode: "8517.6250", description: "ROUTER", quantity: 4, cost: 400, sellingValue: 466.67, sheetSellingValue: 500 },
  { sourceRow: 4, disposition: "stock-posted", hsCode: "8517.6250", description: "router ", quantity: 1, cost: 100, sellingValue: 116.67 },
  { sourceRow: 5, disposition: "cost-only", itemTypeId: 9, quantity: 7, cost: 700, sellingValue: 816.67, leaveOut: true },
  { sourceRow: 6, disposition: "ambiguous", quantity: 2, cost: 200, sellingValue: 233.33 },
] };
check("counts what comes in, what is new, what is left out", () => {
  const s = commitSummary(preview, MODE_NEW_ARRIVALS);
  assert.deepStrictEqual([s.lineCount, s.itemsTouched, s.unitsAdded, s.newItems, s.newUnits, s.leftOut, s.undecided],
    [4, 1, 15, 1, 5, 1, 1]);
  assert.deepStrictEqual([s.totalCost, s.totalSelling], [2000, 2366.67]);
});
check("the sentences say the left-out goods will NOT come in", () => {
  const t = summarySentences(commitSummary(preview, MODE_NEW_ARRIVALS));
  assert.deepStrictEqual(t, [
    "1 item on the books gets more stock: 15 units in all.",
    "1 new item created with 5 units of opening stock.",
    "1 line left out: its goods will NOT come into stock.",
    "1 line still needs an item chosen.",
  ]);
});
check("plurals read as plurals", () => {
  const t = summarySentences({ mode: MODE_BACKFILL, itemsTouched: 2, newItems: 0, leftOut: 3, undecided: 2 });
  assert.deepStrictEqual(t, [
    "2 items get their actual cost set. Quantities stay as they are.",
    "3 lines left out: their goods will NOT come into stock.",
    "2 lines still need an item chosen.",
  ]);
});
check("the button says what it does, per mode", () => {
  assert.strictEqual(commitLabel(commitSummary(preview, MODE_NEW_ARRIVALS)), "Bring 4 lines into stock");
  assert.strictEqual(commitLabel(commitSummary(preview, MODE_BACKFILL)), "Record 4 lines");
});

console.log(`\n${pass}/${pass + failures.length} checks passed`);
if (failures.length) process.exit(1);
