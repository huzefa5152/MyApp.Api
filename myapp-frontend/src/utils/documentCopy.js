// Copy editable values only: no record ids, fulfilment links or workflow state.
export function copyLine(source, blank = () => ({})) {
  const row = { ...blank(), id: 0, _imageKey: crypto.randomUUID() };
  for (const field of ["itemTypeId", "description", "quantity", "unit", "unitPrice", "imagePath"])
    if (source[field] != null) row[field] = source[field];
  row.unit = source.unit || source.uom || "";
  return row;
}
export function appendCopiedLines(current, selected, blank) {
  const base = current.length === 1 && !String(current[0].description || current[0].itemTypeName || "").trim() ? [] : current;
  return [...base, ...selected.map(line => copyLine(line, blank))];
}
export const COPY_TYPES = {
  Challan: { label: "Challan", route: "deliverychallans", number: "challanNumber", permission: "challans.list.view", side: "sales" },
  Quote: { label: "Quotation", route: "salesquotes", number: "quoteNumber", permission: "salesquotes.list.view", side: "sales" },
  Order: { label: "Sales order", route: "salesorders", number: "salesOrderNumber", permission: "salesorders.list.view", side: "sales" },
  Bill: { label: "Bill", route: "invoices", number: "invoiceNumber", permission: "bills.list.view", side: "sales" },
  PurchaseBill: { label: "Purchase bill", route: "purchasebills", number: "purchaseBillNumber", permission: "purchasebills.list.view", side: "purchase" },
  GoodsReceipt: { label: "Goods receipt", route: "goodsreceipts", number: "goodsReceiptNumber", permission: "goodsreceipts.list.view", side: "purchase" },
};
