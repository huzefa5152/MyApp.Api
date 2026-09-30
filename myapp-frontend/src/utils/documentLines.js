export const lineSources = {
  quote: { label: "Sales Quotes", path: "salesquotes", permission: "salesquotes.list.view", number: "quoteNumber", date: "date", party: "clientName" },
  order: { label: "Sales Orders", path: "salesorders", permission: "salesorders.list.view", number: "salesOrderNumber", date: "orderDate", party: "clientName" },
  challan: { label: "Delivery Challans", path: "deliverychallans", permission: "challans.list.view", number: "challanNumber", date: "deliveryDate", party: "clientName" },
  bill: { label: "Bills", path: "invoices", permission: "bills.list.view", number: "invoiceNumber", date: "date", party: "clientName" },
  taxInvoice: { label: "Sales Tax Invoices", path: "invoices", permission: "invoices.list.view", number: "invoiceNumber", date: "date", party: "clientName" },
  creditNote: { label: "Credit Notes", path: "invoices", permission: "invoices.list.view", number: "invoiceNumber", date: "date", party: "clientName", typeParam: "creditnotes" },
  debitNote: { label: "Debit Notes", path: "invoices", permission: "invoices.list.view", number: "invoiceNumber", date: "date", party: "clientName", typeParam: "debitnotes" },
  purchase: { label: "Purchase Bills", path: "purchasebills", permission: "purchasebills.list.view", number: "purchaseBillNumber", date: "date", party: "supplierName" },
  receipt: { label: "Goods Receipts", path: "goodsreceipts", permission: "goodsreceipts.list.view", number: "goodsReceiptNumber", date: "receiptDate", party: "supplierName" },
};

export const lineColumns = [
  ["date", "Date"], ["number", "Document #"], ["documentId", "Record ID"], ["party", "Customer / Supplier"],
  ["status", "Status"], ["salesOrder", "Sales Order #"],
  ["po", "PO #"], ["site", "Site"], ["indentNo", "Indent #"],
  ["line", "Line #"], ["itemId", "Line ID"], ["itemType", "Item Type"],
  ["description", "Description"], ["quantity", "Quantity"], ["unit", "Unit"],
  ["unitPrice", "Unit Price"], ["lineTotal", "Line Total"], ["hsCode", "HS Code"],
  ["supplier", "Supplier"], ["actualUnitCost", "Actual Unit Cost"], ["sellingUnitPrice", "Selling Unit Price"],
  ["unitProfit", "Unit Profit"], ["totalProfit", "Total Profit"],
  ["saleType", "Sale Type"], ["account", "Account"], ["gstRate", "Document GST %"],
];

export const defaultLineColumns = ["date", "number", "party", "itemType", "description", "quantity", "unit", "unitPrice", "lineTotal"];
export const challanPrivateColumns = ["supplier", "actualUnitCost", "sellingUnitPrice", "unitProfit", "totalProfit"];
export const defaultColumnsForType = (type) => type === "challan"
  ? [...defaultLineColumns.filter((key) => key !== "unitPrice" && key !== "lineTotal"), ...challanPrivateColumns]
  : ["receipt"].includes(type)
  ? defaultLineColumns.filter((key) => key !== "unitPrice" && key !== "lineTotal")
  : defaultLineColumns;

const value = (v) => v ?? "";
const itemValue = (type, item, key) => value(type === "taxInvoice"
  ? item.adjustment?.[`adjusted${key}`] ?? item[key[0].toLowerCase() + key.slice(1)]
  : item[key[0].toLowerCase() + key.slice(1)]);

export function flattenDocumentLines(type, documents) {
  const source = lineSources[type];
  if (!source) throw new Error("Unknown document type.");
  return documents.flatMap((doc) => (doc.items || []).map((item, index) => ({
    date: doc[source.date]?.slice?.(0, 10) || "",
    number: doc[source.number] ?? "",
    documentId: doc.id,
    itemId: item.id ?? "",
    party: doc[source.party] || "",
    status: doc.status || (doc.isCancelled ? "Cancelled" : doc.fbrStatus || ""),
    salesOrder: doc.salesOrderNumber || "",
    po: doc.poNumber || doc.customerPoNumber || doc.supplierBillNumber || doc.supplierRef || doc.supplierChallanNumber || "",
    site: doc.site || "",
    indentNo: doc.indentNo || "",
    line: index + 1,
    itemType: type === "taxInvoice" ? item.adjustment?.adjustedItemTypeName ?? item.itemTypeName ?? item.nonInventoryItemName ?? "" : item.itemTypeName || item.nonInventoryItemName || "",
    description: itemValue(type, item, "Description"),
    quantity: type === "challan" ? item.physicalQuantity ?? item.quantity ?? "" : itemValue(type, item, "Quantity"),
    unit: type === "taxInvoice" ? item.adjustment?.adjustedUOM ?? item.uom ?? "" : item.unit ?? item.uom ?? "",
    unitPrice: type === "taxInvoice" ? item.adjustment?.adjustedUnitPrice ?? item.unitPrice ?? "" : item.unitPrice ?? "",
    lineTotal: type === "taxInvoice" ? item.adjustment?.adjustedLineTotal ?? item.lineTotal ?? "" : item.lineTotal ?? "",
    hsCode: type === "taxInvoice" ? item.adjustment?.adjustedHSCode ?? item.hsCode ?? "" : item.hsCode ?? "",
    saleType: type === "taxInvoice" ? item.adjustment?.adjustedSaleType ?? item.saleType ?? "" : item.saleType ?? "",
    account: item.accountName || "",
    gstRate: doc.gstRate ?? "",
    supplier: type === "challan" ? item.supplierName || "" : "",
    actualUnitCost: type === "challan" ? item.actualUnitCost ?? "" : "",
    sellingUnitPrice: type === "challan" ? item.sellingUnitPrice ?? "" : "",
    unitProfit: type === "challan" ? item.unitProfit ?? "" : "",
    totalProfit: type === "challan" ? item.totalProfit ?? "" : "",
  })));
}

export async function collectPagedDocuments(fetchPage) {
  const documents = [];
  const seenIds = new Set();
  let expectedCount = null;
  for (let page = 1; ; page++) {
    const data = await fetchPage(page);
    const batch = data?.items || [];
    if (expectedCount === null) expectedCount = data?.totalCount;
    if (!Number.isInteger(expectedCount) || expectedCount < 0)
      throw new Error("The document list did not provide a complete count.");
    if (data?.totalCount !== expectedCount || (batch.length === 0 && documents.length < expectedCount))
      throw new Error("The document list changed during export. Please reload the lines.");
    for (const document of batch) {
      if (seenIds.has(document.id)) throw new Error("The document list changed during export. Please reload the lines.");
      seenIds.add(document.id);
    }
    documents.push(...batch);
    if (documents.length > expectedCount)
      throw new Error("The document list changed during export. Please reload the lines.");
    if (documents.length >= expectedCount) return documents;
  }
}

export const safeCell = (cell) => {
  if (typeof cell === "number") return cell;
  const cleaned = String(value(cell)).replace(/[\t\r\n]+/g, " ");
  return /^[\s]*[=+@-]/.test(cleaned) ? `'${cleaned}` : cleaned;
};

export function linesToTsv(rows, columns) {
  const headings = columns.map((key) => lineColumns.find(([id]) => id === key)?.[1] || key);
  return [headings.join("\t"), ...rows.map((row) => columns.map((key) => safeCell(row[key])).join("\t"))].join("\r\n");
}

export async function saveLinesExcel(rows, columns, filename) {
  const [{ default: ExcelJS }, { saveAs }] = await Promise.all([import("exceljs"), import("file-saver")]);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Document lines", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((key) => ({ header: lineColumns.find(([id]) => id === key)?.[1] || key, key, width: key === "description" ? 48 : 20 }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00695C" } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  for (const row of rows) sheet.addRow(Object.fromEntries(columns.map((key) => [key, safeCell(row[key])])));
  const bytes = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
}
