import assert from "node:assert/strict";
import { collectPagedDocuments, flattenDocumentLines, linesToTsv, safeCell } from "../myapp-frontend/src/utils/documentLines.js";

const fixtures = [
  ["quote", { quoteNumber: 1, date: "2026-09-25", clientName: "Buyer", items: [{ description: "Quote line", quantity: 2, unit: "Pcs", unitPrice: 12, lineTotal: 24 }] }],
  ["order", { salesOrderNumber: 2, orderDate: "2026-09-25", clientName: "Buyer", items: [{ description: "Order line", quantity: 3, unit: "Pcs" }] }],
  ["challan", { challanNumber: 3, deliveryDate: "2026-09-25", clientName: "Buyer", items: [{ description: "Delivery line", quantity: 4, unit: "Pcs" }] }],
  ["bill", { invoiceNumber: 4, date: "2026-09-25", clientName: "Buyer", items: [{ description: "Original", quantity: 5, uom: "Pcs", unitPrice: 10, lineTotal: 50,
    adjustment: { adjustedDescription: "Adjusted", adjustedQuantity: 6, adjustedUnitPrice: 12, adjustedLineTotal: 72 } }] }],
  ["taxInvoice", { invoiceNumber: 4, date: "2026-09-25", clientName: "Buyer", items: [{ description: "Original", quantity: 5, uom: "Pcs", unitPrice: 10, lineTotal: 50,
    adjustment: { adjustedDescription: "Adjusted", adjustedQuantity: 0, adjustedUnitPrice: 12, adjustedLineTotal: 0 } }] }],
  ["creditNote", { invoiceNumber: 7, date: "2026-09-25", clientName: "Buyer", items: [{ description: "Credit", quantity: 1, uom: "Pcs" }] }],
  ["debitNote", { invoiceNumber: 8, date: "2026-09-25", clientName: "Buyer", items: [{ description: "Debit", quantity: 1, uom: "Pcs" }] }],
  ["purchase", { purchaseBillNumber: 5, date: "2026-09-25", supplierName: "Supplier", items: [{ description: "Purchase line", quantity: 6, uom: "Pcs", unitPrice: 8, lineTotal: 48 }] }],
  ["purchaseDebit", { debitNoteNumber: 9, date: "2026-09-25", supplierName: "Supplier", items: [{ description: "Purchase debit", quantity: 1, uom: "Pcs" }] }],
  ["receipt", { goodsReceiptNumber: 6, receiptDate: "2026-09-25", supplierName: "Supplier", items: [{ description: "Receipt line", quantity: 7, unit: "Pcs" }] }],
];

for (const [type, document] of fixtures) {
  const rows = flattenDocumentLines(type, [{ id: 99, ...document }]);
  assert.equal(rows.length, 1, `${type} has one line`);
  assert.equal(rows[0].date, "2026-09-25", `${type} date`);
  assert.equal(rows[0].documentId, 99, `${type} identity`);
  assert.equal(rows[0].unit, "Pcs", `${type} unit`);
}
assert.equal(flattenDocumentLines("bill", [fixtures[3][1]])[0].description, "Original");
const adjusted = flattenDocumentLines("taxInvoice", [fixtures[4][1]])[0];
assert.equal(adjusted.description, "Adjusted");
assert.equal(adjusted.quantity, 0, "zero adjustment must not fall back to bill quantity");
assert.equal(adjusted.lineTotal, 0);
const privateLine = flattenDocumentLines("challan", [{ challanNumber: 9, items: [{
  quantity: 2.5, supplierName: "Internal Supplier", actualUnitCost: 80,
  sellingUnitPrice: 125, unitProfit: 45, totalProfit: 112.5,
}] }])[0];
assert.equal(privateLine.supplier, "Internal Supplier");
assert.equal(privateLine.actualUnitCost, 80);
assert.equal(privateLine.totalProfit, 112.5);
assert.equal(flattenDocumentLines("challan", [{ items: [{ actualUnitCost: 80 }] }])[0].totalProfit, "",
  "profit remains blank until a selling price exists");
assert.equal(safeCell("=WEBSERVICE(1)"), "'=WEBSERVICE(1)");
assert.equal(safeCell("a\tb\nc"), "a b c");
assert.equal(linesToTsv([{ description: "=1+1", quantity: 2 }], ["description", "quantity"]),
  "Description\tQuantity\r\n'=1+1\t2");
const allPages = await collectPagedDocuments(async (page) => ({ totalCount: 3, items: page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }] }));
assert.deepEqual(allPages.map((row) => row.id), [1, 2, 3]);
await assert.rejects(() => collectPagedDocuments(async (page) => ({ totalCount: 3, items: page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 2 }] })), /changed during export/);
console.log("document line mapping and clipboard safety passed");
