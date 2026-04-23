/**
 * Default Handlebars templates for each print type.
 * These are used as the initial template when a company has no saved template.
 */

export const defaultChallanTemplate = `<!DOCTYPE html><html><head><title>DC #{{challanNumber}}</title>
<meta name="format-detection" content="telephone=no">
<style>
  a { color: inherit !important; text-decoration: none !important; }
  @media print {
    @page { size: A4; margin: 10mm 0 0 0; }
    @page:first { margin: 0; }
    html, body { height: 100%; margin: 0; }
    .footer-section { page-break-inside: avoid; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
  }
  html, body { height: 100%; }
  body { font-family: "Times New Roman", Times, serif; font-size: 16px; color: #000;
         display: flex; flex-direction: column; min-height: 100vh;
         padding: 10mm 12mm; }
  .main-content { flex: 1; }
  .footer-section { margin-top: auto; }
  .header-grid { display: flex; justify-content: space-between; }
  .header-left { flex: 1; }
  .header-right { text-align: right; white-space: nowrap; padding-left: 20px; }
  .brand-row { display: flex; align-items: center; gap: 14px; }
  .brand-row img { height: 75px; }
  .company-name { font-size: 38px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; white-space: nowrap; }
  .company-address { font-size: 11.5px; color: #333; margin-top: 2px; line-height: 1.35; }
  .company-contact { font-size: 12.5px; margin-top: 6px; line-height: 1.4; }
  .dc-label { font-size: 22px; font-weight: 700; color: #1a5276; }
  .dc-date { font-size: 17px; font-weight: 700; margin-top: 6px; }
  .dc-number { font-size: 28px; font-weight: 900; margin-top: 14px; }
  .info-section { margin-top: 18px; }
  .info-line { font-size: 18px; margin-bottom: 5px; }
  .info-line strong { font-weight: 700; }
  .info-line .value { font-size: 20px; font-weight: 900; margin-left: 14px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  thead { display: table-row-group; }
  th { background-color: #2c3e50 !important; color: #fff !important; font-weight: 700; font-size: 12px; text-transform: uppercase; padding: 6px 14px; border: 1px solid #2c3e50; }
  th.qty-head { width: 130px; text-align: center; }
  .cell { border: 1px solid #888; padding: 8px 14px; font-size: 15px; height: 34px; }
  .cell.qty { text-align: center; width: 130px; }
  .cell.item { text-align: left; }
  tbody tr:nth-child(odd) td { background-color: #ffffff !important; }
  tbody tr:nth-child(even) td { background-color: #d9d9d9 !important; }
  .thank-you { text-align: center; font-size: 22px; font-weight: 700; font-style: italic; margin-top: 20px; }
  .sig-row { display: flex; justify-content: space-between; margin-top: 50px; padding: 0 40px; }
  .sig-block { text-align: center; }
  .sig-block .line { width: 220px; border-top: 1.5px solid #4a90b8; margin-bottom: 1px; }
  .sig-block .label { font-size: 13px; font-weight: normal; color: #000; }
</style></head><body>

<div class="main-content">
<div class="header-grid">
  <div class="header-left">
    <div class="brand-row">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <span class="company-name">{{companyBrandName}}</span>
    </div>
    {{#if companyAddress}}<div class="company-address">{{{nl2br companyAddress}}}</div>{{/if}}
    {{#if companyPhone}}<div class="company-contact">{{{nl2br companyPhone}}}</div>{{/if}}
  </div>
  <div class="header-right">
    <div class="dc-label">Delivery Challan</div>
    <div class="dc-date">{{fmtDate deliveryDate}}</div>
    <div class="dc-number">DC # {{challanNumber}}</div>
  </div>
</div>

<div class="info-section">
  <div class="info-line"><strong>Messers:</strong> <span class="value">{{clientName}}</span></div>
  <div class="info-line"><strong>Purchase Order:</strong> <span class="value">{{#if poNumber}}{{poNumber}}{{else}}\u2014{{/if}}</span></div>
  {{#if poDate}}<div class="info-line"><strong>P.O Date:</strong> <span class="value">{{fmtDate poDate}}</span></div>{{/if}}
</div>

<table>
  <thead><tr><th class="qty-head">Quantity</th><th>Item</th></tr></thead>
  <tbody>
    {{#each items}}
    <tr>
      <td class="cell qty">{{this.quantity}}</td>
      <td class="cell item">{{this.description}}</td>
    </tr>
    {{/each}}
    {{emptyRows (math 15 "-" items.length) 2}}
  </tbody>
</table>
</div>

<div class="footer-section">
  <div class="thank-you">Thank you for your business!</div>
  <div class="sig-row">
    <div class="sig-block"><div class="line"></div><div class="label">Signature and Stamp</div></div>
    <div class="sig-block"><div class="line"></div><div class="label">Receiver Signature and Stamp</div></div>
  </div>
</div>

</body></html>`;


export const defaultBillTemplate = `<!DOCTYPE html><html><head><title>Bill #{{invoiceNumber}}</title>
<meta name="format-detection" content="telephone=no">
<style>
  a { color: inherit !important; text-decoration: none !important; }
  @media print {
    @page { size: A4; margin: 6mm 10mm; }
    @page:first { margin-top: 6mm; }
    html, body { height: 100%; margin: 0; }
    thead { display: table-header-group; }
    .totals-wrap { page-break-inside: avoid; }
    .footer-section { page-break-inside: avoid; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
  }
  html, body { height: 100%; }
  body { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 12pt; color: #000;
         display: flex; flex-direction: column; min-height: 100vh;
         padding: 6mm 10mm; }
  .main-content { flex: 1; }
  .footer-section { margin-top: auto; }

  /* ---- Header ---- */
  .company-name { font-size: 30pt; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; }
  .bill-title { font-size: 26pt; font-weight: bold; text-transform: uppercase; margin-bottom: 4px; }

  /* ---- Address + logo row ---- */
  .header-detail { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 0; }
  .header-left { flex: 1; }
  .header-right { text-align: center; padding-left: 20px; white-space: nowrap; }
  .addr-row { display: flex; align-items: flex-start; gap: 10px; }
  .addr-row img { height: 45px; margin-top: 2px; }
  .company-address { font-size: 10pt; font-weight: bold; line-height: 1.45; }
  .company-contact { font-size: 10pt; font-weight: bold; margin-top: 3px; line-height: 1.4; color: #000; }

  /* ---- Date / Bill / DC info (right column) ---- */
  .date-bill-box { display: inline-block; border: 1.5px solid #000; font-size: 10pt; }
  .date-row { display: flex; }
  .date-row .lbl { padding: 2px 8px; border-right: 1.5px solid #000; font-style: italic; }
  .date-row .val { padding: 2px 12px; min-width: 80px; }
  .bill-num { font-size: 12pt; font-weight: bold; font-style: italic; text-align: center;
              padding: 2px 8px; border-top: 1.5px solid #000; }
  .dc-info { font-size: 12pt; font-weight: bold; font-style: italic; margin-top: 4px; }
  .dc-date-line { font-size: 10pt; margin-top: 3px; }
  .dc-date-line strong { font-weight: bold; }

  /* ---- Client / NTN section ---- */
  .client-row { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 10px; }
  .client-left { flex: 1; }
  .client-right { text-align: right; white-space: nowrap; }
  .to-label { font-size: 11pt; }
  .client-name { font-size: 11pt; font-weight: normal; display: inline; margin-left: 20px; }
  .ntn-line { font-size: 10pt; margin-bottom: 1px; font-weight: bold; }

  /* ---- PO section ---- */
  .po-section { margin-top: 6px; margin-bottom: 6px; }
  .po-table { border-collapse: collapse; }
  .po-table td { font-size: 11pt; font-weight: bold; padding: 1px 0; }
  .po-table td.po-val { padding-left: 40px; font-weight: normal; }

  /* ---- Table ---- */
  table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.items thead { display: table-header-group; }
  table.items th { background-color: #4472C4 !important; color: #fff !important; font-weight: bold;
       font-size: 9pt; text-transform: uppercase; padding: 5px 8px;
       border: 1px solid #4472C4; text-align: center; }
  table.items th.left { text-align: left; }
  .cell { border: 1px solid #bbb; padding: 3px 8px; font-size: 10pt; height: 22px; }
  .c { text-align: center; }
  .r { text-align: right; }
  table.items tbody tr:nth-child(odd) td { background-color: #ffffff !important; }
  table.items tbody tr:nth-child(even) td { background-color: #D9E2F3 !important; }

  /* ---- Totals (right after table) ---- */
  .totals-wrap { page-break-inside: avoid; }
  .totals-section { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 0; }
  .words-section { flex: 1; padding-right: 20px; }
  .words-label { font-size: 11pt; font-weight: bold; font-style: italic; }
  .words-text { font-size: 13pt; font-weight: bold; margin-top: 10px; }
  .totals-table { border-collapse: collapse; }
  .totals-table td { border: 1px solid #bbb; padding: 2px 10px; font-size: 10pt; }
  .totals-table td.lbl { font-weight: bold; text-transform: uppercase; }
  .totals-table td.val { text-align: right; min-width: 90px; }
  .totals-table tr:nth-child(odd) td { background-color: #ffffff !important; }
  .totals-table tr:nth-child(even) td { background-color: #D9E2F3 !important; }
  .totals-table tr.grand td { font-weight: bold; border-top: 2px solid #000; border-bottom: 2px solid #000; }

  /* ---- Signature ---- */
  .sig-row { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 40px; }
  .sig-text { font-size: 11pt; text-decoration: underline; }

  /* ---- Types footer ---- */
  .types-footer { text-align: center; margin-top: 20px; font-size: 12pt; font-weight: bold;
                   text-transform: uppercase; letter-spacing: 2px; }
</style></head><body>

<div class="main-content">
<!-- Header: Company name on left, BILL on right -->
<div class="header-detail">
  <div class="header-left">
    <div class="company-name">{{companyBrandName}}</div>
    <div class="addr-row">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div class="company-address">{{{nl2br companyAddress}}}</div>
    </div>
    <div class="company-contact">{{{nl2br companyPhone}}}</div>
  </div>
  <div class="header-right">
    <div class="bill-title">BILL</div>
    <div class="date-bill-box">
      <div class="date-row"><span class="lbl">Date:</span><span class="val">{{fmtDate date}}</span></div>
      <div class="bill-num">BILL # {{invoiceNumber}}</div>
    </div>
    <div class="dc-info">DC # {{join challanNumbers}}</div>
    <div class="dc-date-line"><strong>D.C Date</strong> &nbsp;&nbsp;&nbsp; {{joinDates challanDates}}</div>
  </div>
</div>

<!-- Client + NTN/GST -->
<div class="client-row">
  <div class="client-left">
    <span class="to-label">To;</span>
    <span class="client-name">{{clientName}}</span>
  </div>
  <div class="client-right">
    {{#if clientNTN}}<div class="ntn-line">NTN # {{clientNTN}}</div>{{/if}}
    {{#if clientSTRN}}<div class="ntn-line">GST # {{clientSTRN}}</div>{{/if}}
  </div>
</div>

<!-- Purchase Order -->
<div class="po-section">
  <table class="po-table">
    <tr><td>Purchase Order</td><td class="po-val">{{#if poNumber}}{{poNumber}}{{else}}\\u2014{{/if}}</td></tr>
    {{#if poDate}}<tr><td>P.O  Date</td><td class="po-val">{{fmtDate poDate}}</td></tr>{{/if}}
  </table>
</div>

<!-- Items Table -->
<table class="items">
  <thead><tr>
    <th style="width:35px">S #</th>
    <th style="width:70px">Quantity</th>
    <th class="left">Item Details</th>
    <th style="width:85px">Unit Price</th>
    <th style="width:95px">Total Price</th>
  </tr></thead>
  <tbody>
    {{#each items}}
    <tr>
      <td class="cell c">{{this.sNo}}</td>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell">{{this.description}}</td>
      <td class="cell r">Rs{{fmt this.unitPrice}}</td>
      <td class="cell r">Rs &nbsp; {{fmt this.lineTotal}}</td>
    </tr>
    {{/each}}
    {{billEmptyRows (math 22 "-" items.length)}}
  </tbody>
</table>

<!-- Totals (immediately after table) -->
<div class="totals-wrap">
  <div class="totals-section">
    <div class="words-section">
      <div class="words-label">Amount In Words:</div>
      <div class="words-text">{{amountInWords}}</div>
    </div>
    <table class="totals-table">
      <tr><td class="lbl">SUB TOTAL</td><td class="val">Rs{{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs{{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">GRAND TOTAL</td><td class="val">Rs{{fmt grandTotal}}</td></tr>
    </table>
  </div>
</div>
</div>

<!-- Footer: signature + types (pushed to bottom) -->
<div class="footer-section">
  <div class="sig-row">
    <span class="sig-text">Signature and Stamp</span>
    <span class="sig-text">Receiver Signature and Stamp</span>
  </div>

  <div class="types-footer">SALES | HARDWARE | GENERAL ORDER |</div>
</div>

</body></html>`;


export const defaultTaxInvoiceTemplate = `<!DOCTYPE html><html><head><title>Tax Invoice #{{invoiceNumber}}</title>
<meta name="format-detection" content="telephone=no">
<style>
  a { color: inherit !important; text-decoration: none !important; }
  @media print {
    @page { size: A4; margin: 6mm 10mm; }
    html, body { height: 100%; margin: 0; }
    .footer-section { page-break-inside: avoid; }
    .words-wrap { page-break-inside: avoid; }
    table.items th,
    table.items td,
    .num-row td,
    .total-row td {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
  }
  html, body { height: 100%; }
  body { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #000;
         display: flex; flex-direction: column; min-height: 100vh;
         padding: 6mm 10mm; }
  .main-content { flex: 1; }
  .footer-section { margin-top: auto; }

  /* ---- Title ---- */
  .title { text-align: center; margin-bottom: 12px; }
  .title span { font-size: 22pt; font-weight: bold; text-transform: uppercase;
                border: 2px solid #000; padding: 6px 0; letter-spacing: 3px;
                text-decoration: underline; text-underline-offset: 4px;
                background-color: #d9d9d9 !important; display: block;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important; }

  /* ---- Meta row: Invoice No / Date / Time Of Supply ---- */
  .meta-row { display: flex; gap: 30px; font-size: 10pt; margin-bottom: 10px; padding: 0 10px; }
  .meta-row span { white-space: nowrap; text-decoration: underline; }
  .meta-row strong { font-weight: bold; }

  /* ---- Supplier / Buyer boxes ---- */
  .parties { display: flex; gap: 20px; margin-bottom: 8px; }
  .party { flex: 1; border: 1px solid #000; padding: 6px 10px; font-size: 10pt; line-height: 1.5; }
  .party-header { font-size: 9pt; margin-bottom: 1px; text-decoration: underline; }
  .party-name { font-size: 13pt; font-weight: bold; font-style: italic; }
  .buyer-name { font-weight: bold; }
  .party-table { width: 100%; border-collapse: collapse; }
  .party-table td { padding: 0 0 1px 0; vertical-align: top; font-size: 10pt; }
  .party-table td.plbl { font-weight: bold; white-space: nowrap; width: 90px; }
  .party-table td.pval { text-align: right; }

  /* ---- Term of Sale ---- */
  .term-line { font-size: 11pt; font-weight: bold; font-style: italic; margin-bottom: 6px; }

  /* ---- Table ---- */
  table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.items thead { display: table-row-group; }
  table.items th {
       background: #d9d9d9 !important; background-color: #d9d9d9 !important;
       color: #000 !important; font-weight: bold;
       font-size: 9pt; padding: 4px 6px; border: 1px solid #000; text-align: center;
       vertical-align: middle;
       -webkit-print-color-adjust: exact !important;
       print-color-adjust: exact !important;
  }
  table.items th.left { text-align: left; }
  .cell { border: 1px solid #000; padding: 3px 6px; font-size: 10pt; height: 22px; }
  .c { text-align: center; }
  .r { text-align: right; }
  table.items tbody tr:nth-child(odd) td { background-color: #ffffff !important; }
  table.items tbody tr:nth-child(even) td { background-color: #f2f2f2 !important; }

  /* ---- Number row under headers ---- */
  .num-row td { text-align: center; font-size: 9pt; font-weight: bold;
                border: 1px solid #000; padding: 2px; background-color: #fff !important; }

  /* ---- Total row ---- */
  .total-row td { font-weight: bold; font-size: 10pt; border: 1px solid #000; padding: 3px 6px;
                   background-color: #d9d9d9 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

  /* ---- Amount In Words box ---- */
  .words-wrap { page-break-inside: avoid; }
  .words-box { display: inline-flex; border: 1px solid #000; margin-top: 10px; margin-left: auto; margin-right: auto; }
  .words-box .wlbl { padding: 4px 12px; font-weight: bold; font-size: 10pt; border-right: 1px solid #000; white-space: nowrap; }
  .words-box .wval { padding: 4px 16px; font-size: 11pt; font-weight: bold; }
  .words-center { text-align: center; }

  /* ---- Signature ---- */
  .sig-row { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 50px; }
  .sig-block { text-align: center; }
  .sig-block .line { width: 220px; border-top: 1px solid #000; margin-bottom: 3px; }
  .sig-block .label { font-size: 9pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
</style></head><body>

<div class="main-content">
<!-- Title -->
<div class="title"><span>SALES TAX INVOICE</span></div>

<!-- Meta: Invoice No / Date / Time Of Supply -->
<div class="meta-row">
  <span><strong>Invoice No:</strong> &nbsp; {{invoiceNumber}}</span>
  <span><strong>Date :</strong> &nbsp; {{fmtDate date}}</span>
  <span><strong>Time Of Supply:</strong></span>
</div>

<!-- Supplier / Buyer boxes -->
<div class="parties">
  <div class="party">
    <div class="party-header"><strong>Supplier's</strong></div>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="font-weight:bold;white-space:nowrap;width:90px;vertical-align:top;font-size:10pt;padding:0 0 1px 0">Name:</td><td style="text-align:center;vertical-align:top;padding:0 0 1px 0"><span style="font-family:'Monotype Corsiva','Palace Script MT',cursive;font-size:16pt;font-weight:bold;font-style:italic">{{supplierName}}</span></td></tr>
      {{#if supplierAddress}}<tr><td style="font-weight:bold;white-space:nowrap;width:90px;vertical-align:top;font-size:10pt;padding:0 0 1px 0">Address :</td><td style="text-align:center;vertical-align:top;font-size:10pt;padding:0 0 1px 0">{{{nl2br supplierAddress}}}</td></tr>{{/if}}
      {{#if supplierPhone}}<tr><td style="font-weight:bold;white-space:nowrap;width:90px;vertical-align:top;font-size:10pt;padding:0 0 1px 0">Telephone # :</td><td style="text-align:center;vertical-align:top;font-size:10pt;padding:0 0 1px 0">{{{nl2br supplierPhone}}}</td></tr>{{/if}}
      {{#if supplierSTRN}}<tr><td style="font-weight:bold;white-space:nowrap;width:90px;vertical-align:top;font-size:10pt;padding:0 0 1px 0">STRN #:</td><td style="text-align:center;vertical-align:top;font-size:10pt;padding:0 0 1px 0">{{supplierSTRN}}</td></tr>{{/if}}
      {{#if supplierNTN}}<tr><td style="font-weight:bold;white-space:nowrap;width:90px;vertical-align:top;font-size:10pt;padding:0 0 1px 0">NTN # :</td><td style="text-align:center;vertical-align:top;font-size:10pt;padding:0 0 1px 0">{{supplierNTN}}</td></tr>{{/if}}
    </table>
  </div>
  <div class="party">
    <div class="party-header"><strong>Buyer's</strong></div>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="font-weight:bold;white-space:nowrap;width:90px;vertical-align:top;font-size:10pt;padding:0 0 1px 0">Name:</td><td style="text-align:center;vertical-align:top;font-size:10pt;font-weight:bold;padding:0 0 1px 0">{{buyerName}}</td></tr>
      {{#if buyerAddress}}<tr><td style="font-weight:bold;white-space:nowrap;width:90px;vertical-align:top;font-size:10pt;padding:0 0 1px 0">Address :</td><td style="text-align:center;vertical-align:top;font-size:10pt;padding:0 0 1px 0">{{{nl2br buyerAddress}}}</td></tr>{{/if}}
      <tr><td style="font-weight:bold;white-space:nowrap;width:90px;vertical-align:top;font-size:10pt;padding:0 0 1px 0">Telephone # :</td><td style="text-align:center;vertical-align:top;font-size:10pt;padding:0 0 1px 0">{{#if buyerPhone}}{{buyerPhone}}{{/if}}</td></tr>
      {{#if buyerSTRN}}<tr><td style="font-weight:bold;white-space:nowrap;width:90px;vertical-align:top;font-size:10pt;padding:0 0 1px 0">STRN #:</td><td style="text-align:center;vertical-align:top;font-size:10pt;padding:0 0 1px 0">{{buyerSTRN}}</td></tr>{{/if}}
      {{#if buyerNTN}}<tr><td style="font-weight:bold;white-space:nowrap;width:90px;vertical-align:top;font-size:10pt;padding:0 0 1px 0">NTN # :</td><td style="text-align:center;vertical-align:top;font-size:10pt;padding:0 0 1px 0">{{buyerNTN}}</td></tr>{{/if}}
    </table>
  </div>
</div>

<!-- Term of Sale + conditional PO number for Lotte Kolson -->
<div class="term-line">
  Term Of Sale: Credit{{#if (eq buyerName "LOTTE Kolson (Pvt.) Limited")}}{{#if poNumber}} &nbsp;&nbsp;&nbsp; PO NO: {{poNumber}}{{/if}}{{/if}}
</div>

<!-- Items Table -->
<table class="items">
  <thead>
    <tr>
      <th colspan="2" style="width:80px;background:#d9d9d9 !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important">Quantity</th>
      <th rowspan="2" style="background:#d9d9d9 !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important">Description</th>
      <th rowspan="2" style="width:90px;background:#d9d9d9 !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important">Value Excluding<br>Sales Tax</th>
      <th rowspan="2" style="width:50px;background:#d9d9d9 !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important">Rate Of<br>Sales<br>Tax</th>
      <th rowspan="2" style="width:80px;background:#d9d9d9 !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important">Total Sales Tax<br>Payable</th>
      <th rowspan="2" style="width:90px;background:#d9d9d9 !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important">Value Including<br>Sales Tax</th>
    </tr>
    <tr>
      <th style="width:35px;background:#d9d9d9 !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important">Qty</th>
      <th style="width:40px;background:#d9d9d9 !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important">Unit</th>
    </tr>
  </thead>
  <tbody>
    <tr class="num-row">
      <td colspan="2">&nbsp;</td>
      <td>1</td>
      <td>2</td>
      <td>3</td>
      <td>4</td>
      <td>5</td>
    </tr>
    {{#each items}}
    <tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{this.description}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>
    {{/each}}
    {{taxEmptyRows (math 20 "-" items.length)}}
  </tbody>
  <tfoot>
    <tr class="total-row">
      <td colspan="3" class="r">TOTAL :</td>
      <td class="r">{{fmtDec subtotal}}</td>
      <td class="c">{{gstRate}}%</td>
      <td class="r">{{fmtDec gstAmount}}</td>
      <td class="r">{{fmtDec grandTotal}}</td>
    </tr>
  </tfoot>
</table>

<!-- Amount In Words (immediately after table) -->
<div class="words-wrap">
  <div class="words-center">
    <div class="words-box">
      <span class="wlbl">Amount In Words</span>
      <span class="wval">{{amountInWords}}</span>
    </div>
  </div>
</div>

{{#if fbrIRN}}
<!-- FBR Digital Invoicing Section -->
<div style="margin-top:14px;padding:8px 12px;border:1.5px solid #1a5276;border-radius:4px;display:flex;justify-content:space-between;align-items:center;gap:16px">
  <div style="flex:1">
    <div style="font-size:9pt;font-weight:bold;color:#1a5276;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">FBR Digital Invoice</div>
    <div style="font-size:9pt"><strong>IRN:</strong> {{fbrIRN}}</div>
    <div style="font-size:8pt;color:#555;margin-top:2px">Submitted: {{fmtDate fbrSubmittedAt}}</div>
    <div style="font-size:7pt;color:#888;margin-top:2px">This invoice is registered with the Federal Board of Revenue (FBR) Digital Invoicing System</div>
  </div>
  <div style="text-align:center">
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=96x96&data={{fbrIRN}}" style="width:96px;height:96px" />
    <div style="font-size:7pt;color:#555;margin-top:2px">Scan to verify</div>
  </div>
</div>
{{/if}}
</div>

<!-- Footer -->
<div class="footer-section">
  <div class="sig-row">
    <div class="sig-block"><div class="line"></div><div class="label">Signature and Stamp</div></div>
    <div class="sig-block"><div class="line"></div><div class="label">Receiver Signature and Stamp</div></div>
  </div>
</div>

</body></html>`;
