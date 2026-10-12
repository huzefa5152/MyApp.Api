import assert from "node:assert/strict";
import { mergeFilingRows, separateFilingRow, filingErrors } from "../myapp-frontend/src/utils/taxFilingRows.js";
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const sources = [
  { id: 1, description: "Table", quantity: 1, lineTotal: 12500 },
  { id: 2, description: "Chair A", quantity: 1, lineTotal: 10500 },
  { id: 3, description: "Chair B", quantity: 1, lineTotal: 7000 },
];
const rows = [
  { sourceLineIds: [1], itemTypeId: 1, hsCode: "9403.6000", uom: "Nos", quantity: 1, valueExclTax: 12500, saleType: "Goods at standard rate (default)" },
  { sourceLineIds: [2, 3], itemTypeId: 2, hsCode: "9401.3000", uom: "Nos", quantity: 2, valueExclTax: 17500, saleType: "Goods at standard rate (default)" },
];
check("two groups combine to one exact amount", () => { const result = mergeFilingRows(rows, [0, 1]); assert.equal(result.length, 1); assert.equal(result[0].valueExclTax, 30000); assert.deepEqual(result[0].sourceLineIds, [1, 2, 3]); });
check("combining requires deliberate classification", () => assert.equal(mergeFilingRows(rows, [0, 1])[0].itemTypeId, null));
check("same unit combines quantities", () => assert.equal(mergeFilingRows(rows, [0, 1])[0].quantity, 3));
check("different units never silently sum quantities", () => assert.equal(mergeFilingRows([rows[0], { ...rows[1], uom: "KG" }], [0, 1])[0].quantity, ""));
check("single selection stays unchanged", () => assert.equal(mergeFilingRows(rows, [1]), rows));
check("unselected group stays separate", () => { const third = { ...rows[0], sourceLineIds: [4] }; assert.equal(mergeFilingRows([...rows, third], [0, 1])[1], third); });
check("separate restores all source links", () => assert.deepEqual(separateFilingRow(rows[1], sources).map(r => r.sourceLineIds), [[2], [3]]));
check("separate preserves exact grouped amount", () => assert.equal(separateFilingRow({ ...rows[1], valueExclTax: 17500.01 }, sources).reduce((n, r) => n + Math.round(r.valueExclTax * 100), 0), 1750001));
check("separate rejects removed sources", () => assert.throws(() => separateFilingRow(rows[1], sources.slice(0, 2))));
check("valid separate classifications pass", () => assert.deepEqual(filingErrors(rows, { items: sources, subtotal: 30000 }), []));
check("duplicate source is refused", () => assert.ok(filingErrors([{ ...rows[0], sourceLineIds: [1, 2] }, rows[1]], { items: sources, subtotal: 30000 }).some(e => e.includes("Source lines"))));
check("one paisa mismatch is refused", () => assert.ok(filingErrors(rows, { items: sources, subtotal: 30000.01 }).some(e => e.includes("exactly"))));
check("zero quantity is refused", () => assert.ok(filingErrors([{ ...rows[0], quantity: 0 }, rows[1]], { items: sources, subtotal: 30000 }).some(e => e.includes("quantity"))));
check("missing classification is refused", () => assert.ok(filingErrors([{ ...rows[0], hsCode: "" }, rows[1]], { items: sources, subtotal: 30000 }).some(e => e.includes("classification"))));
check("original row objects remain unchanged", () => { mergeFilingRows(rows, [0, 1]); separateFilingRow(rows[1], sources); assert.equal(rows[1].valueExclTax, 17500); assert.deepEqual(rows[1].sourceLineIds, [2, 3]); });
console.log(`${passed} passed, 0 failed`);
