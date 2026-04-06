/**
 * Starter templates for the visual template builder.
 * Each template is a complete HTML document with Handlebars expressions.
 * Users can pick one as a starting point and customize in the visual editor.
 */

// ─── CHALLAN TEMPLATES ───────────────────────────────────────

export const starterClassicChallan = `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 12mm; color: #000; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #333; padding-bottom: 12px; margin-bottom: 14px; }
.header-left { flex: 1; }
.brand { font-size: 32px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; }
.addr { font-size: 10px; color: #444; margin-top: 4px; line-height: 1.4; }
.header-right { text-align: right; }
.dc-title { font-size: 20px; font-weight: 700; color: #1a5276; text-transform: uppercase; letter-spacing: 1px; }
.dc-num { font-size: 24px; font-weight: 900; margin-top: 6px; }
.dc-date { font-size: 14px; margin-top: 4px; }
.info { margin: 10px 0; font-size: 14px; line-height: 1.6; }
.info b { font-weight: 700; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th { background: #2c3e50 !important; color: #fff !important; font-size: 11px; text-transform: uppercase; padding: 6px 10px; border: 1px solid #2c3e50; }
td { border: 1px solid #999; padding: 6px 10px; font-size: 13px; height: 28px; }
.c { text-align: center; width: 100px; }
tbody tr:nth-child(even) td { background: #eee !important; }
.footer { margin-top: 40px; display: flex; justify-content: space-between; padding: 0 30px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1.5px solid #666; margin-bottom: 4px; }
.sig .label { font-size: 11px; color: #555; }
.thanks { text-align: center; font-size: 16px; font-style: italic; font-weight: 700; margin-top: 20px; }
</style></head><body>
<div class="header">
  <div class="header-left">
    <div class="brand">{{companyBrandName}}</div>
    <div class="addr">{{companyAddress}}</div>
    <div class="addr">{{companyPhone}}</div>
  </div>
  <div class="header-right">
    <div class="dc-title">Delivery Challan</div>
    <div class="dc-num">DC # {{challanNumber}}</div>
    <div class="dc-date">{{fmtDate deliveryDate}}</div>
  </div>
</div>
<div class="info">
  <div><b>Messers:</b> {{clientName}}</div>
  <div><b>Address:</b> {{clientAddress}}</div>
  <div><b>Purchase Order:</b> {{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</div>
</div>
<table>
  <thead><tr><th class="c">Qty</th><th>Description</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="c">{{this.quantity}}</td><td>{{this.description}}</td></tr>{{/each}}
    {{emptyRows (math 15 "-" items.length) 2}}
  </tbody>
</table>
<div class="thanks">Thank you for your business!</div>
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Receiver Signature</div></div>
</div>
</body></html>`;


export const starterModernChallan = `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 14mm; color: #222; }
.top-bar { height: 6px; background: linear-gradient(90deg, #0d47a1, #00897b); margin-bottom: 20px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.brand { font-size: 28px; font-weight: 800; color: #0d47a1; letter-spacing: 1px; }
.sub { font-size: 10px; color: #666; margin-top: 4px; line-height: 1.5; }
.badge { display: inline-block; background: #0d47a1; color: #fff; padding: 6px 16px; border-radius: 6px; font-size: 12px; font-weight: 700; letter-spacing: 1px; }
.dc-num { font-size: 22px; font-weight: 800; color: #0d47a1; margin-top: 8px; text-align: right; }
.dc-date { font-size: 12px; color: #666; text-align: right; margin-top: 2px; }
.info-grid { display: flex; gap: 20px; margin: 16px 0; padding: 12px; background: #f5f7fa; border-radius: 8px; }
.info-item { flex: 1; }
.info-label { font-size: 9px; text-transform: uppercase; color: #888; font-weight: 700; letter-spacing: 0.5px; }
.info-value { font-size: 13px; font-weight: 600; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th { background: #f0f2f5 !important; color: #333; font-size: 10px; text-transform: uppercase; padding: 8px 12px; border-bottom: 2px solid #ddd; text-align: left; }
th.c { text-align: center; width: 80px; }
td { padding: 8px 12px; font-size: 12px; border-bottom: 1px solid #eee; }
td.c { text-align: center; width: 80px; }
tbody tr:hover td { background: #f9fbfd; }
.footer { margin-top: 30px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 2px solid #0d47a1; margin-bottom: 4px; }
.sig .label { font-size: 10px; color: #666; }
</style></head><body>
<div class="top-bar"></div>
<div class="header">
  <div>
    <div class="brand">{{companyBrandName}}</div>
    <div class="sub">{{companyAddress}}</div>
    <div class="sub">{{companyPhone}}</div>
  </div>
  <div>
    <div class="badge">DELIVERY CHALLAN</div>
    <div class="dc-num">DC # {{challanNumber}}</div>
    <div class="dc-date">{{fmtDate deliveryDate}}</div>
  </div>
</div>
<div class="info-grid">
  <div class="info-item"><div class="info-label">Client</div><div class="info-value">{{clientName}}</div></div>
  <div class="info-item"><div class="info-label">Address</div><div class="info-value">{{clientAddress}}</div></div>
  <div class="info-item"><div class="info-label">PO Number</div><div class="info-value">{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</div></div>
</div>
<table>
  <thead><tr><th class="c">#</th><th class="c">Qty</th><th>Description</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="c">{{inc @index}}</td><td class="c">{{this.quantity}}</td><td>{{this.description}}</td></tr>{{/each}}
    {{emptyRows (math 15 "-" items.length) 3}}
  </tbody>
</table>
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
</div>
</body></html>`;


// ─── BILL TEMPLATES ──────────────────────────────────────────

export const starterStandardBill = `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 8mm 10mm; } thead { display: table-header-group; } .totals-wrap, .footer-section { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 8mm 10mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer-section { margin-top: auto; }
.hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.hdr-left .name { font-size: 28pt; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
.hdr-left .addr { font-size: 9pt; color: #444; line-height: 1.4; margin-top: 2px; }
.hdr-right { text-align: right; }
.bill-tag { font-size: 24pt; font-weight: 800; text-transform: uppercase; color: #1a5276; }
.bill-box { border: 1.5px solid #000; display: inline-block; margin-top: 4px; }
.bill-box .row { display: flex; }
.bill-box .lbl { padding: 2px 8px; border-right: 1.5px solid #000; font-style: italic; font-size: 10pt; }
.bill-box .val { padding: 2px 12px; font-size: 10pt; }
.bill-box .num { border-top: 1.5px solid #000; text-align: center; font-weight: 700; font-style: italic; padding: 2px 8px; font-size: 11pt; }
.dc-ref { font-size: 11pt; font-weight: 700; font-style: italic; margin-top: 4px; }
.client-row { display: flex; justify-content: space-between; margin: 10px 0; }
.client-left { font-size: 11pt; }
.client-right { text-align: right; font-size: 10pt; font-weight: 700; }
.po { font-size: 11pt; font-weight: 700; margin-bottom: 6px; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #4472C4 !important; color: #fff !important; font-size: 9pt; text-transform: uppercase; padding: 5px 8px; border: 1px solid #4472C4; text-align: center; }
table.items th.left { text-align: left; }
.cell { border: 1px solid #bbb; padding: 3px 8px; font-size: 10pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #D9E2F3 !important; }
.totals-wrap { page-break-inside: avoid; }
.totals { display: flex; justify-content: space-between; margin-top: 0; }
.words { flex: 1; padding-right: 20px; }
.words-label { font-size: 11pt; font-weight: 700; font-style: italic; }
.words-text { font-size: 12pt; font-weight: 700; margin-top: 8px; }
.ttable { border-collapse: collapse; }
.ttable td { border: 1px solid #bbb; padding: 2px 10px; font-size: 10pt; }
.ttable td.lbl { font-weight: 700; text-transform: uppercase; }
.ttable td.val { text-align: right; min-width: 90px; }
.ttable tr:nth-child(even) td { background: #D9E2F3 !important; }
.ttable tr.grand td { font-weight: 700; border-top: 2px solid #000; border-bottom: 2px solid #000; }
.sig-row { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 40px; }
.sig-text { font-size: 11pt; text-decoration: underline; }
</style></head><body>
<div class="main">
<div class="hdr">
  <div class="hdr-left">
    <div class="name">{{companyBrandName}}</div>
    <div class="addr">{{companyAddress}}</div>
    <div class="addr">{{companyPhone}}</div>
  </div>
  <div class="hdr-right">
    <div class="bill-tag">BILL</div>
    <div class="bill-box">
      <div class="row"><span class="lbl">Date:</span><span class="val">{{fmtDate date}}</span></div>
      <div class="num">BILL # {{invoiceNumber}}</div>
    </div>
    <div class="dc-ref">DC # {{join challanNumbers}}</div>
  </div>
</div>
<div class="client-row">
  <div class="client-left">To; <span style="margin-left:20px">{{clientName}}</span></div>
  <div class="client-right">
    {{#if clientNTN}}<div>NTN # {{clientNTN}}</div>{{/if}}
    {{#if clientSTRN}}<div>GST # {{clientSTRN}}</div>{{/if}}
  </div>
</div>
<div class="po">Purchase Order: {{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</div>
<table class="items">
  <thead><tr><th style="width:35px">S#</th><th style="width:60px">Qty</th><th class="left">Item Details</th><th style="width:85px">Unit Price</th><th style="width:95px">Total Price</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell c">{{this.quantity}}</td><td class="cell">{{this.description}}</td><td class="cell r">Rs{{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
    {{billEmptyRows (math 22 "-" items.length)}}
  </tbody>
</table>
<div class="totals-wrap">
  <div class="totals">
    <div class="words"><div class="words-label">Amount In Words:</div><div class="words-text">{{amountInWords}}</div></div>
    <table class="ttable">
      <tr><td class="lbl">SUB TOTAL</td><td class="val">Rs{{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs{{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">GRAND TOTAL</td><td class="val">Rs{{fmt grandTotal}}</td></tr>
    </table>
  </div>
</div>
</div>
<div class="footer-section">
  <div class="sig-row"><span class="sig-text">Signature and Stamp</span><span class="sig-text">Receiver Signature and Stamp</span></div>
</div>
</body></html>`;


export const starterProfessionalBill = `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 8mm; } thead { display: table-header-group; } .totals-wrap, .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; padding: 10mm; color: #1a1a1a; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer { margin-top: auto; }
.top-accent { height: 4px; background: linear-gradient(90deg, #0d47a1, #1565c0, #42a5f5); margin-bottom: 16px; }
.header { display: flex; justify-content: space-between; margin-bottom: 16px; }
.company { font-size: 26pt; font-weight: 800; color: #0d47a1; }
.company-sub { font-size: 9pt; color: #666; line-height: 1.5; margin-top: 3px; }
.invoice-badge { background: #0d47a1; color: #fff; padding: 8px 20px; border-radius: 4px; font-size: 14pt; font-weight: 700; letter-spacing: 2px; display: inline-block; }
.meta { text-align: right; margin-top: 8px; font-size: 10pt; color: #555; }
.meta strong { color: #000; }
.parties { display: flex; gap: 16px; margin: 12px 0; }
.party-box { flex: 1; background: #f5f7fa; border-radius: 6px; padding: 10px 14px; border-left: 3px solid #0d47a1; }
.party-label { font-size: 8pt; text-transform: uppercase; color: #888; font-weight: 700; letter-spacing: 0.5px; }
.party-name { font-size: 12pt; font-weight: 700; margin-top: 2px; }
.party-detail { font-size: 9pt; color: #555; margin-top: 2px; }
table.items { width: 100%; border-collapse: collapse; margin-top: 10px; }
table.items th { background: #0d47a1 !important; color: #fff !important; font-size: 8pt; text-transform: uppercase; padding: 6px 8px; border: 1px solid #0d47a1; letter-spacing: 0.5px; }
table.items th.left { text-align: left; }
.cell { border: 1px solid #ddd; padding: 4px 8px; font-size: 10pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #f0f4fa !important; }
.totals-wrap { page-break-inside: avoid; margin-top: 0; }
.totals-flex { display: flex; justify-content: space-between; align-items: flex-start; }
.words-section { flex: 1; padding-right: 20px; }
.words-label { font-size: 10pt; font-weight: 700; color: #555; }
.words-text { font-size: 12pt; font-weight: 700; margin-top: 6px; }
.totals-table { border-collapse: collapse; }
.totals-table td { padding: 3px 12px; font-size: 10pt; border: 1px solid #ddd; }
.totals-table .lbl { font-weight: 700; }
.totals-table .val { text-align: right; min-width: 90px; }
.totals-table tr:nth-child(even) td { background: #f0f4fa !important; }
.totals-table tr.grand td { background: #0d47a1 !important; color: #fff !important; font-weight: 700; }
.sig-row { display: flex; justify-content: space-between; margin-top: 36px; padding: 0 30px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #0d47a1; margin-bottom: 3px; }
.sig .label { font-size: 9pt; color: #666; }
</style></head><body>
<div class="main">
<div class="top-accent"></div>
<div class="header">
  <div>
    <div class="company">{{companyBrandName}}</div>
    <div class="company-sub">{{companyAddress}}<br>{{companyPhone}}</div>
  </div>
  <div style="text-align:right">
    <div class="invoice-badge">BILL</div>
    <div class="meta"><strong>Bill #</strong> {{invoiceNumber}}<br><strong>Date:</strong> {{fmtDate date}}<br><strong>DC #</strong> {{join challanNumbers}}</div>
  </div>
</div>
<div class="parties">
  <div class="party-box">
    <div class="party-label">Bill To</div>
    <div class="party-name">{{clientName}}</div>
    {{#if clientNTN}}<div class="party-detail">NTN: {{clientNTN}}</div>{{/if}}
    {{#if clientSTRN}}<div class="party-detail">GST: {{clientSTRN}}</div>{{/if}}
  </div>
  <div class="party-box">
    <div class="party-label">Purchase Order</div>
    <div class="party-name">{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</div>
    {{#if poDate}}<div class="party-detail">PO Date: {{fmtDate poDate}}</div>{{/if}}
  </div>
</div>
<table class="items">
  <thead><tr><th style="width:35px">S#</th><th style="width:60px">Qty</th><th class="left">Description</th><th style="width:85px">Unit Price</th><th style="width:95px">Total</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell c">{{this.quantity}}</td><td class="cell">{{this.description}}</td><td class="cell r">Rs{{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
    {{billEmptyRows (math 20 "-" items.length)}}
  </tbody>
</table>
<div class="totals-wrap">
  <div class="totals-flex">
    <div class="words-section"><div class="words-label">Amount In Words:</div><div class="words-text">{{amountInWords}}</div></div>
    <table class="totals-table">
      <tr><td class="lbl">Sub Total</td><td class="val">Rs{{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs{{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs{{fmt grandTotal}}</td></tr>
    </table>
  </div>
</div>
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver Signature</div></div>
  </div>
</div>
</body></html>`;


// ─── TAX INVOICE TEMPLATES ───────────────────────────────────

export const starterGSTTaxInvoice = `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 6mm 10mm; } .footer, .words-wrap { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; padding: 6mm 10mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer { margin-top: auto; }
.title { text-align: center; margin-bottom: 10px; }
.title span { font-size: 20pt; font-weight: 800; text-transform: uppercase; border: 2px solid #000; padding: 5px 0; letter-spacing: 3px; background: #d9d9d9 !important; display: block; }
.meta { display: flex; gap: 24px; font-size: 10pt; margin-bottom: 8px; padding: 0 8px; }
.meta span { text-decoration: underline; } .meta strong { font-weight: 700; }
.parties { display: flex; gap: 16px; margin-bottom: 8px; }
.party { flex: 1; border: 1px solid #000; padding: 6px 10px; font-size: 10pt; line-height: 1.5; }
.party-hdr { font-size: 9pt; text-decoration: underline; font-weight: 700; margin-bottom: 2px; }
.party-name { font-size: 12pt; font-weight: 700; font-style: italic; }
.party-row { display: flex; justify-content: space-between; }
.party-row .lbl { font-weight: 700; }
.term { font-size: 11pt; font-weight: 700; font-style: italic; margin-bottom: 6px; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #d9d9d9 !important; color: #000 !important; font-weight: 700; font-size: 9pt; padding: 4px 6px; border: 1px solid #000; text-align: center; }
.cell { border: 1px solid #000; padding: 3px 6px; font-size: 10pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #f2f2f2 !important; }
.num-row td { text-align: center; font-size: 9pt; font-weight: 700; border: 1px solid #000; padding: 2px; background: #fff !important; }
.total-row td { font-weight: 700; font-size: 10pt; border: 1px solid #000; padding: 3px 6px; background: #d9d9d9 !important; }
.words-wrap { page-break-inside: avoid; }
.words-box { display: inline-flex; border: 1px solid #000; margin-top: 10px; }
.words-box .wlbl { padding: 4px 12px; font-weight: 700; font-size: 10pt; border-right: 1px solid #000; }
.words-box .wval { padding: 4px 16px; font-size: 11pt; font-weight: 700; }
.words-center { text-align: center; }
.sig-row { display: flex; justify-content: space-between; margin-top: 36px; padding: 0 40px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1px solid #000; margin-bottom: 3px; }
.sig .label { font-size: 9pt; font-weight: 700; text-transform: uppercase; }
</style></head><body>
<div class="main">
<div class="title"><span>SALES TAX INVOICE</span></div>
<div class="meta">
  <span><strong>Invoice No:</strong> {{invoiceNumber}}</span>
  <span><strong>Date:</strong> {{fmtDate date}}</span>
  <span><strong>Time Of Supply:</strong></span>
</div>
<div class="parties">
  <div class="party">
    <div class="party-hdr">Supplier's</div>
    <div class="party-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="party-row"><span class="lbl">Address:</span><span>{{supplierAddress}}</span></div>{{/if}}
    {{#if supplierPhone}}<div class="party-row"><span class="lbl">Phone:</span><span>{{supplierPhone}}</span></div>{{/if}}
    {{#if supplierSTRN}}<div class="party-row"><span class="lbl">STRN #:</span><span>{{supplierSTRN}}</span></div>{{/if}}
    {{#if supplierNTN}}<div class="party-row"><span class="lbl">NTN #:</span><span>{{supplierNTN}}</span></div>{{/if}}
  </div>
  <div class="party">
    <div class="party-hdr">Buyer's</div>
    <div style="font-weight:700;font-size:11pt">{{buyerName}}</div>
    {{#if buyerAddress}}<div class="party-row"><span class="lbl">Address:</span><span>{{buyerAddress}}</span></div>{{/if}}
    {{#if buyerPhone}}<div class="party-row"><span class="lbl">Phone:</span><span>{{buyerPhone}}</span></div>{{/if}}
    {{#if buyerSTRN}}<div class="party-row"><span class="lbl">STRN #:</span><span>{{buyerSTRN}}</span></div>{{/if}}
    {{#if buyerNTN}}<div class="party-row"><span class="lbl">NTN #:</span><span>{{buyerNTN}}</span></div>{{/if}}
  </div>
</div>
<div class="term">Term Of Sale: Credit</div>
<table class="items">
  <thead>
    <tr><th colspan="2" style="width:80px">Quantity</th><th rowspan="2">Description</th><th rowspan="2" style="width:90px">Value Excl. Tax</th><th rowspan="2" style="width:50px">Rate</th><th rowspan="2" style="width:80px">Sales Tax</th><th rowspan="2" style="width:90px">Value Incl. Tax</th></tr>
    <tr><th style="width:35px">Qty</th><th style="width:40px">Unit</th></tr>
  </thead>
  <tbody>
    <tr class="num-row"><td colspan="2"></td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td></tr>
    {{#each items}}<tr><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell">{{this.description}}</td><td class="cell r">{{fmtDec this.valueExclTax}}</td><td class="cell c">{{this.gstRate}}%</td><td class="cell r">{{fmtDec this.gstAmount}}</td><td class="cell r">{{fmtDec this.totalInclTax}}</td></tr>{{/each}}
    {{taxEmptyRows (math 18 "-" items.length)}}
  </tbody>
  <tfoot><tr class="total-row"><td colspan="3" class="r">TOTAL :</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="words-wrap"><div class="words-center"><div class="words-box"><span class="wlbl">Amount In Words</span><span class="wval">{{amountInWords}}</span></div></div></div>
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Signature and Stamp</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver Signature</div></div>
  </div>
</div>
</body></html>`;


export const starterDetailedTaxInvoice = `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 6mm 8mm; } .footer, .words-wrap, .bank-section { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; padding: 6mm 8mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; font-size: 10pt; }
.main { flex: 1; }
.footer { margin-top: auto; }
.accent { height: 3px; background: #2c3e50; margin-bottom: 10px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.brand { font-size: 22pt; font-weight: 800; color: #2c3e50; }
.brand-sub { font-size: 9pt; color: #555; line-height: 1.4; }
.inv-box { border: 2px solid #2c3e50; padding: 6px 14px; text-align: center; }
.inv-title { font-size: 14pt; font-weight: 800; color: #2c3e50; letter-spacing: 2px; text-transform: uppercase; }
.inv-num { font-size: 11pt; margin-top: 2px; }
.inv-date { font-size: 9pt; color: #555; margin-top: 2px; }
.parties { display: flex; gap: 12px; margin-bottom: 8px; }
.party { flex: 1; border: 1px solid #333; padding: 6px 10px; }
.party-hdr { font-size: 8pt; text-transform: uppercase; color: #666; font-weight: 700; letter-spacing: 0.5px; border-bottom: 1px solid #ddd; padding-bottom: 2px; margin-bottom: 4px; }
.party-name { font-size: 12pt; font-weight: 700; }
.party-info { font-size: 9pt; color: #333; line-height: 1.5; }
table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
table.items th { background: #2c3e50 !important; color: #fff !important; font-size: 8pt; text-transform: uppercase; padding: 4px 6px; border: 1px solid #2c3e50; text-align: center; letter-spacing: 0.3px; }
.cell { border: 1px solid #999; padding: 3px 6px; font-size: 9pt; height: 20px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #f4f6f8 !important; }
.total-row td { font-weight: 700; border: 1px solid #2c3e50; padding: 3px 6px; background: #d9e1e8 !important; font-size: 9pt; }
.words-wrap { page-break-inside: avoid; margin-top: 8px; }
.words-box { border: 1px solid #333; padding: 4px 12px; display: inline-flex; }
.words-box .wlbl { font-weight: 700; font-size: 9pt; border-right: 1px solid #333; padding-right: 10px; margin-right: 10px; }
.words-box .wval { font-size: 10pt; font-weight: 700; }
.words-center { text-align: center; }
.bank-section { margin-top: 12px; page-break-inside: avoid; }
.bank-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; color: #2c3e50; border-bottom: 1px solid #ddd; padding-bottom: 2px; margin-bottom: 4px; }
.bank-grid { display: flex; gap: 30px; font-size: 9pt; }
.bank-item .lbl { font-weight: 700; color: #555; }
.terms { margin-top: 10px; font-size: 8pt; color: #666; line-height: 1.5; }
.terms-title { font-weight: 700; font-size: 9pt; color: #333; margin-bottom: 2px; }
.sig-row { display: flex; justify-content: space-between; margin-top: 30px; padding: 0 30px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 1.5px solid #2c3e50; margin-bottom: 3px; }
.sig .label { font-size: 8pt; color: #666; text-transform: uppercase; }
</style></head><body>
<div class="main">
<div class="accent"></div>
<div class="header">
  <div>
    <div class="brand">{{supplierName}}</div>
    <div class="brand-sub">{{supplierAddress}}<br>{{supplierPhone}}</div>
    {{#if supplierNTN}}<div class="brand-sub"><strong>NTN:</strong> {{supplierNTN}} {{#if supplierSTRN}}&bull; <strong>STRN:</strong> {{supplierSTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="inv-box">
    <div class="inv-title">Sales Tax Invoice</div>
    <div class="inv-num"><strong>#</strong> {{invoiceNumber}}</div>
    <div class="inv-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="parties">
  <div class="party">
    <div class="party-hdr">Buyer Information</div>
    <div class="party-name">{{buyerName}}</div>
    <div class="party-info">
      {{#if buyerAddress}}{{buyerAddress}}<br>{{/if}}
      {{#if buyerPhone}}Phone: {{buyerPhone}}<br>{{/if}}
      {{#if buyerNTN}}NTN: {{buyerNTN}}<br>{{/if}}
      {{#if buyerSTRN}}STRN: {{buyerSTRN}}{{/if}}
    </div>
  </div>
  <div class="party">
    <div class="party-hdr">Reference</div>
    <div class="party-info" style="margin-top:4px">
      <strong>DC #:</strong> {{join challanNumbers}}<br>
      {{#if poNumber}}<strong>PO #:</strong> {{poNumber}}<br>{{/if}}
      <strong>Term:</strong> Credit
    </div>
  </div>
</div>
<table class="items">
  <thead>
    <tr><th style="width:35px">Qty</th><th style="width:40px">Unit</th><th>Description</th><th style="width:85px">Value Excl. Tax</th><th style="width:45px">Rate</th><th style="width:75px">Sales Tax</th><th style="width:85px">Value Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell">{{this.description}}</td><td class="cell r">{{fmtDec this.valueExclTax}}</td><td class="cell c">{{this.gstRate}}%</td><td class="cell r">{{fmtDec this.gstAmount}}</td><td class="cell r">{{fmtDec this.totalInclTax}}</td></tr>{{/each}}
    {{taxEmptyRows (math 16 "-" items.length)}}
  </tbody>
  <tfoot><tr class="total-row"><td colspan="3" class="r">TOTAL</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="words-wrap"><div class="words-center"><div class="words-box"><span class="wlbl">Amount In Words</span><span class="wval">{{amountInWords}}</span></div></div></div>
<div class="terms">
  <div class="terms-title">Terms &amp; Conditions:</div>
  1. Payment is due within 30 days of invoice date.<br>
  2. Late payments are subject to 2% monthly interest.<br>
  3. All disputes shall be resolved under the jurisdiction of local courts.
</div>
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`;


// ─── TEMPLATE CATALOG ────────────────────────────────────────

export const STARTER_TEMPLATES = [
  {
    id: "classic-challan",
    name: "Classic Challan",
    type: "Challan",
    description: "Traditional serif layout with double-border header",
    html: starterClassicChallan,
  },
  {
    id: "modern-challan",
    name: "Modern Challan",
    type: "Challan",
    description: "Clean sans-serif design with accent bar and info grid",
    html: starterModernChallan,
  },
  {
    id: "standard-bill",
    name: "Standard Bill",
    type: "Bill",
    description: "Classic bill layout matching traditional format",
    html: starterStandardBill,
  },
  {
    id: "professional-bill",
    name: "Professional Bill",
    type: "Bill",
    description: "Modern corporate look with accent colors and card layout",
    html: starterProfessionalBill,
  },
  {
    id: "gst-tax-invoice",
    name: "GST Tax Invoice",
    type: "TaxInvoice",
    description: "Standard GST-compliant layout with supplier/buyer boxes",
    html: starterGSTTaxInvoice,
  },
  {
    id: "detailed-tax-invoice",
    name: "Detailed Tax Invoice",
    type: "TaxInvoice",
    description: "Comprehensive layout with terms, conditions and reference details",
    html: starterDetailedTaxInvoice,
  },
];
