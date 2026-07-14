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

// Numeric day/month/year (dd/mm/yyyy) — matches Manager's invoice-date format.
Handlebars.registerHelper("fmtDMY", (d) => {
  if (!d) return "";
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getFullYear()}`;
});

Handlebars.registerHelper("fmt", (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
);

Handlebars.registerHelper("fmtDec", (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
);

// Audit H-13 (2026-05-13): pre-fix, nl2br only replaced \n with <br>
// then wrapped the result in a SafeString. Operator-controlled fields
// (clientAddress, companyAddress, supplierAddress) flow through this
// helper; a stored "<script>" payload would have executed in the print
// popup. HTML-escape the input FIRST so any markup becomes inert text,
// THEN do the \n -> <br> replacement.
Handlebars.registerHelper("nl2br", (s) => {
  if (s == null) return "";
  const escaped = Handlebars.Utils.escapeExpression(String(s));
  return new Handlebars.SafeString(escaped.replace(/\n/g, "<br>"));
});

// Like nl2br, but ALSO re-allows a safe subset of inline formatting tags
// (<b>/<i>/<u>) so item descriptions can carry simple bold/italic plus line
// breaks. Everything else stays HTML-escaped (XSS-safe). Mirrors the React
// renderRichTextHtml() util. Use as {{{richText this.description}}}.
Handlebars.registerHelper("richText", (s) => {
  if (s == null) return "";
  let out = Handlebars.Utils.escapeExpression(String(s));
  out = out.replace(/&lt;(\/?)(b|i|u)&gt;/gi, (_m, slash, tag) => `<${slash}${tag.toLowerCase()}>`);
  out = out.replace(/\n/g, "<br>");
  return new Handlebars.SafeString(out);
});

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
 *
 * Injects a <base> so relative asset URLs — notably the logo
 * "/data/uploads/logos/…" from {{companyLogoPath}} / {{divisionLogoPath}} —
 * resolve against the app origin. Printing opens an about:blank popup and
 * document.write's this HTML; an about:blank document has no origin to resolve
 * a path-absolute URL against, so without an explicit base the logo silently
 * renders blank in the print/preview. Resolving against window.location.origin
 * works in production (same origin serves /data) and in dev (the Vite server
 * proxies /data to the backend).
 */
export function mergeTemplate(htmlTemplate, data) {
  const compiled = Handlebars.compile(htmlTemplate);
  const html = compiled(data);
  if (typeof window !== "undefined" && window.location?.origin) {
    const base = `<base href="${window.location.origin}/">`;
    return /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (m) => m + base)
      : base + html;
  }
  return html;
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
    { field: "{{{richText this.description}}}", label: "Item Description (in loop)" },
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
    { field: "{{{richText this.description}}}", label: "Item Description (in loop)" },
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
    { field: "{{{richText this.description}}}", label: "Item Description (in loop)" },
    { field: "{{fmtDec this.valueExclTax}}", label: "Value Excl Tax (in loop)" },
    { field: "{{this.gstRate}}", label: "GST Rate % (in loop)" },
    { field: "{{fmtDec this.gstAmount}}", label: "GST Amount (in loop)" },
    { field: "{{fmtDec this.totalInclTax}}", label: "Total Incl Tax (in loop)" },
    { field: "{{fbrIRN}}", label: "FBR Invoice Reference Number (IRN)" },
    { field: "{{fbrStatus}}", label: "FBR Status (Submitted/Failed)" },
    { field: "{{fmtDate fbrSubmittedAt}}", label: "FBR Submission Date" },
    // Triple braces — emits a raw "data:image/png;base64,..." URI without
    // HTML-escaping. Embed in the FBR block via:
    //   <img src="{{{fbrQrPngDataUrl}}}" />
    { field: "{{{fbrQrPngDataUrl}}}", label: "FBR QR Code (base64 PNG)" },
    { field: "{{fbrLogoUrl}}", label: "FBR Logo URL" },
  ],
  Receipt: [
    { field: "{{companyBrandName}}", label: "Company Brand Name" },
    { field: "{{companyLogoPath}}", label: "Company Logo URL" },
    { field: "{{{nl2br companyAddress}}}", label: "Company Address (with line breaks)" },
    { field: "{{{nl2br companyPhone}}}", label: "Company Phone (with line breaks)" },
    { field: "{{companyNTN}}", label: "Company NTN" },
    { field: "{{companySTRN}}", label: "Company STRN" },
    { field: "{{reference}}", label: "Voucher Reference (RCV-#)" },
    { field: "{{fmtDate date}}", label: "Receipt Date" },
    { field: "{{contactName}}", label: "Received From (Name)" },
    { field: "{{{nl2br contactAddress}}}", label: "Contact Address" },
    { field: "{{contactPhone}}", label: "Contact Phone" },
    { field: "{{method}}", label: "Payment Method" },
    { field: "{{bankAccountName}}", label: "Bank/Cash Account" },
    { field: "{{chequeNumber}}", label: "Cheque Number" },
    { field: "{{fmtDate chequeDate}}", label: "Cheque Date" },
    { field: "{{description}}", label: "Description" },
    { field: "{{fmt amount}}", label: "Amount" },
    { field: "{{amountInWords}}", label: "Amount In Words" },
    { field: "{{#if allocations.length}}", label: "If: Has Allocations" },
    { field: "{{/if}}", label: "End If" },
    { field: "{{#each allocations}}", label: "Loop: Allocations Start" },
    { field: "{{/each}}", label: "Loop: End" },
    { field: "{{this.documentLabel}}", label: "Settled Document (in loop)" },
    { field: "{{fmtDate this.date}}", label: "Document Date (in loop)" },
    { field: "{{fmt this.amount}}", label: "Settled Amount (in loop)" },
  ],
  Payment: [
    { field: "{{companyBrandName}}", label: "Company Brand Name" },
    { field: "{{companyLogoPath}}", label: "Company Logo URL" },
    { field: "{{{nl2br companyAddress}}}", label: "Company Address (with line breaks)" },
    { field: "{{{nl2br companyPhone}}}", label: "Company Phone (with line breaks)" },
    { field: "{{companyNTN}}", label: "Company NTN" },
    { field: "{{companySTRN}}", label: "Company STRN" },
    { field: "{{reference}}", label: "Voucher Reference (PMT-#)" },
    { field: "{{fmtDate date}}", label: "Payment Date" },
    { field: "{{contactName}}", label: "Paid To (Name)" },
    { field: "{{{nl2br contactAddress}}}", label: "Contact Address" },
    { field: "{{contactPhone}}", label: "Contact Phone" },
    { field: "{{method}}", label: "Payment Method" },
    { field: "{{bankAccountName}}", label: "Bank/Cash Account" },
    { field: "{{chequeNumber}}", label: "Cheque Number" },
    { field: "{{fmtDate chequeDate}}", label: "Cheque Date" },
    { field: "{{description}}", label: "Description" },
    { field: "{{fmt amount}}", label: "Amount" },
    { field: "{{amountInWords}}", label: "Amount In Words" },
    { field: "{{#if allocations.length}}", label: "If: Has Allocations" },
    { field: "{{/if}}", label: "End If" },
    { field: "{{#each allocations}}", label: "Loop: Allocations Start" },
    { field: "{{/each}}", label: "Loop: End" },
    { field: "{{this.documentLabel}}", label: "Settled Document (in loop)" },
    { field: "{{fmtDate this.date}}", label: "Document Date (in loop)" },
    { field: "{{fmt this.amount}}", label: "Settled Amount (in loop)" },
  ],
  Transfer: [
    { field: "{{companyBrandName}}", label: "Company Brand Name" },
    { field: "{{companyLogoPath}}", label: "Company Logo URL" },
    { field: "{{{nl2br companyAddress}}}", label: "Company Address (with line breaks)" },
    { field: "{{{nl2br companyPhone}}}", label: "Company Phone (with line breaks)" },
    { field: "{{reference}}", label: "Voucher Reference (TRF-#)" },
    { field: "{{fmtDate date}}", label: "Transfer Date" },
    { field: "{{fromAccountName}}", label: "From Account" },
    { field: "{{toAccountName}}", label: "To Account" },
    { field: "{{description}}", label: "Description / Remarks" },
    { field: "{{fmt amount}}", label: "Amount" },
    { field: "{{amountInWords}}", label: "Amount In Words" },
  ],
  JournalEntry: [
    { field: "{{companyBrandName}}", label: "Company Brand Name" },
    { field: "{{companyLogoPath}}", label: "Company Logo URL" },
    { field: "{{{nl2br companyAddress}}}", label: "Company Address (with line breaks)" },
    { field: "{{{nl2br companyPhone}}}", label: "Company Phone (with line breaks)" },
    { field: "{{reference}}", label: "Voucher Reference (JE-#)" },
    { field: "{{entryNo}}", label: "Entry Number" },
    { field: "{{fmtDate date}}", label: "Entry Date" },
    { field: "{{narration}}", label: "Narration" },
    { field: "{{fmt totalDebit}}", label: "Total Debit" },
    { field: "{{fmt totalCredit}}", label: "Total Credit" },
    { field: "{{#each lines}}", label: "Loop: Lines Start" },
    { field: "{{/each}}", label: "Loop: End" },
    { field: "{{this.accountCode}}", label: "Account Code (in loop)" },
    { field: "{{this.accountName}}", label: "Account Name (in loop)" },
    { field: "{{{richText this.description}}}", label: "Line Description (in loop)" },
    { field: "{{fmt this.debit}}", label: "Line Debit (in loop)" },
    { field: "{{fmt this.credit}}", label: "Line Credit (in loop)" },
  ],
  WithholdingTaxReceipt: [
    { field: "{{companyBrandName}}", label: "Company Brand Name" },
    { field: "{{companyLogoPath}}", label: "Company Logo URL" },
    { field: "{{{nl2br companyAddress}}}", label: "Company Address (with line breaks)" },
    { field: "{{{nl2br companyPhone}}}", label: "Company Phone (with line breaks)" },
    { field: "{{companyNTN}}", label: "Company NTN" },
    { field: "{{companySTRN}}", label: "Company STRN" },
    { field: "{{receiptNumber}}", label: "Certificate / Receipt Number" },
    { field: "{{fmtDate date}}", label: "Date" },
    { field: "{{customerName}}", label: "Withheld From (Name)" },
    { field: "{{{nl2br customerAddress}}}", label: "Customer Address" },
    { field: "{{customerNTN}}", label: "Customer NTN" },
    { field: "{{customerSTRN}}", label: "Customer STRN" },
    { field: "{{description}}", label: "Particulars / Description" },
    { field: "{{fmt amount}}", label: "Tax Amount Withheld" },
    { field: "{{amountInWords}}", label: "Amount In Words" },
  ],
};
