import Handlebars from "handlebars";

// Register custom helpers
Handlebars.registerHelper("fmtDate", (d) => {
  if (!d) return "";
  const dt = new Date(d);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dd = String(dt.getDate()).padStart(2, "0");
  const mmm = months[dt.getMonth()];
  const yy = String(dt.getFullYear()).slice(-2);
  return `${dd}-${mmm}-${yy}`;
});

Handlebars.registerHelper("fmt", (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
);

Handlebars.registerHelper("fmtDec", (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
);

Handlebars.registerHelper("nl2br", (s) =>
  new Handlebars.SafeString((s || "").replace(/\n/g, "<br>"))
);

Handlebars.registerHelper("join", (arr, sep) =>
  (arr || []).join(typeof sep === "string" ? sep : ", ")
);

Handlebars.registerHelper("joinDates", (arr) =>
  (arr || []).map(d => {
    if (!d) return "";
    const dt = new Date(d);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return String(dt.getDate()).padStart(2,"0") + "-" + months[dt.getMonth()] + "-" + String(dt.getFullYear()).slice(-2);
  }).filter(Boolean).join(", ")
);

Handlebars.registerHelper("emptyRows", (count, cols) => {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += "<tr>";
    for (let j = 0; j < cols; j++) html += '<td class="cell">&nbsp;</td>';
    html += "</tr>";
  }
  return new Handlebars.SafeString(html);
});

Handlebars.registerHelper("math", (a, op, b) => {
  a = Number(a || 0);
  b = Number(b || 0);
  if (op === "-") return Math.max(0, a - b);
  if (op === "+") return a + b;
  return a;
});

Handlebars.registerHelper("gt", (a, b) => Number(a) > Number(b));
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("or", (a, b) => a || b);

Handlebars.registerHelper("uniqueTypes", (items) => {
  const names = [...new Set((items || []).map(i => i.itemTypeName).filter(Boolean))];
  return names.length > 0 ? names.join(" | ") + " |" : "";
});

Handlebars.registerHelper("inc", (n) => Number(n) + 1);

Handlebars.registerHelper("billEmptyRows", (count) => {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += '<tr>';
    html += '<td class="cell c">&nbsp;</td>';
    html += '<td class="cell c">&nbsp;</td>';
    html += '<td class="cell">&nbsp;</td>';
    html += '<td class="cell r">&nbsp;</td>';
    html += '<td class="cell r">Rs &nbsp;&nbsp; -</td>';
    html += '</tr>';
  }
  return new Handlebars.SafeString(html);
});

Handlebars.registerHelper("taxEmptyRows", (count) => {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += '<tr>';
    html += '<td></td>';
    html += '<td></td>';
    html += '<td></td>';
    html += '<td class="right">-</td>';
    html += '<td class="center">-</td>';
    html += '<td class="right">-</td>';
    html += '<td class="right">-</td>';
    html += '</tr>';
  }
  return new Handlebars.SafeString(html);
});

/**
 * Compile a Handlebars template and merge with data.
 */
export function mergeTemplate(htmlTemplate, data) {
  const compiled = Handlebars.compile(htmlTemplate);
  return compiled(data);
}

/**
 * Merge field definitions for each template type.
 */
export const MERGE_FIELDS = {
  Challan: [
    { field: "{{companyBrandName}}", label: "Company Brand Name" },
    { field: "{{companyLogoPath}}", label: "Company Logo URL" },
    { field: "{{{nl2br companyAddress}}}", label: "Company Address (with line breaks)" },
    { field: "{{{nl2br companyPhone}}}", label: "Company Phone (with line breaks)" },
    { field: "{{challanNumber}}", label: "Challan Number" },
    { field: "{{fmtDate deliveryDate}}", label: "Delivery Date" },
    { field: "{{clientName}}", label: "Client Name" },
    { field: "{{clientAddress}}", label: "Client Address" },
    { field: "{{clientSite}}", label: "Client Site" },
    { field: "{{poNumber}}", label: "PO Number" },
    { field: "{{fmtDate poDate}}", label: "PO Date" },
    { field: "{{items.length}}", label: "Item Count" },
    { field: "{{#each items}}", label: "Loop: Items Start" },
    { field: "{{/each}}", label: "Loop: End" },
    { field: "{{this.quantity}}", label: "Item Quantity (in loop)" },
    { field: "{{this.description}}", label: "Item Description (in loop)" },
  ],
  Bill: [
    { field: "{{companyBrandName}}", label: "Company Brand Name" },
    { field: "{{companyLogoPath}}", label: "Company Logo URL" },
    { field: "{{{nl2br companyAddress}}}", label: "Company Address (with line breaks)" },
    { field: "{{{nl2br companyPhone}}}", label: "Company Phone (with line breaks)" },
    { field: "{{companyNTN}}", label: "Company NTN" },
    { field: "{{companySTRN}}", label: "Company STRN" },
    { field: "{{invoiceNumber}}", label: "Invoice/Bill Number" },
    { field: "{{fmtDate date}}", label: "Invoice Date" },
    { field: "{{join challanNumbers}}", label: "Challan Numbers" },
    { field: "{{joinDates challanDates}}", label: "Challan Dates" },
    { field: "{{poNumber}}", label: "PO Number" },
    { field: "{{fmtDate poDate}}", label: "PO Date" },
    { field: "{{clientName}}", label: "Client Name" },
    { field: "{{clientAddress}}", label: "Client Address" },
    { field: "{{concernDepartment}}", label: "Concern Department" },
    { field: "{{clientNTN}}", label: "Client NTN" },
    { field: "{{clientSTRN}}", label: "Client STRN/GST" },
    { field: "{{fmt subtotal}}", label: "Subtotal" },
    { field: "{{gstRate}}", label: "GST Rate %" },
    { field: "{{fmt gstAmount}}", label: "GST Amount" },
    { field: "{{fmt grandTotal}}", label: "Grand Total" },
    { field: "{{amountInWords}}", label: "Amount In Words" },
    { field: "{{#each items}}", label: "Loop: Items Start" },
    { field: "{{/each}}", label: "Loop: End" },
    { field: "{{this.sNo}}", label: "Item S# (in loop)" },
    { field: "{{this.quantity}}", label: "Item Quantity (in loop)" },
    { field: "{{this.description}}", label: "Item Description (in loop)" },
    { field: "{{this.itemTypeName}}", label: "Item Type Name (in loop)" },
    { field: "{{fmt this.unitPrice}}", label: "Item Unit Price (in loop)" },
    { field: "{{fmt this.lineTotal}}", label: "Item Line Total (in loop)" },
  ],
  TaxInvoice: [
    { field: "{{supplierName}}", label: "Supplier Name" },
    { field: "{{{nl2br supplierAddress}}}", label: "Supplier Address (with line breaks)" },
    { field: "{{{nl2br supplierPhone}}}", label: "Supplier Phone (with line breaks)" },
    { field: "{{supplierNTN}}", label: "Supplier NTN" },
    { field: "{{supplierSTRN}}", label: "Supplier STRN" },
    { field: "{{buyerName}}", label: "Buyer Name" },
    { field: "{{{nl2br buyerAddress}}}", label: "Buyer Address (with line breaks)" },
    { field: "{{buyerPhone}}", label: "Buyer Phone" },
    { field: "{{buyerNTN}}", label: "Buyer NTN" },
    { field: "{{buyerSTRN}}", label: "Buyer STRN" },
    { field: "{{invoiceNumber}}", label: "Invoice Number" },
    { field: "{{fmtDate date}}", label: "Invoice Date" },
    { field: "{{join challanNumbers}}", label: "Challan Numbers" },
    { field: "{{poNumber}}", label: "PO Number" },
    { field: "{{gstRate}}", label: "GST Rate %" },
    { field: "{{fmtDec subtotal}}", label: "Subtotal" },
    { field: "{{fmtDec gstAmount}}", label: "GST Amount" },
    { field: "{{fmtDec grandTotal}}", label: "Grand Total" },
    { field: "{{amountInWords}}", label: "Amount In Words" },
    { field: "{{#each items}}", label: "Loop: Items Start" },
    { field: "{{/each}}", label: "Loop: End" },
    { field: "{{this.quantity}}", label: "Item Quantity (in loop)" },
    { field: "{{this.uom}}", label: "Item UOM (in loop)" },
    { field: "{{this.description}}", label: "Item Description (in loop)" },
    { field: "{{fmtDec this.valueExclTax}}", label: "Value Excl Tax (in loop)" },
    { field: "{{this.gstRate}}", label: "GST Rate % (in loop)" },
    { field: "{{fmtDec this.gstAmount}}", label: "GST Amount (in loop)" },
    { field: "{{fmtDec this.totalInclTax}}", label: "Total Incl Tax (in loop)" },
    { field: "{{fbrIRN}}", label: "FBR Invoice Reference Number (IRN)" },
    { field: "{{fbrStatus}}", label: "FBR Status (Submitted/Failed)" },
    { field: "{{fmtDate fbrSubmittedAt}}", label: "FBR Submission Date" },
  ],
};
