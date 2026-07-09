/**
 * Purchase Bill / Purchase Invoice starter templates — 15 archetypes for Pakistani FBR-compliant wholesale ERP.
 * The tenant company (company*) is the BUYER / receiving party; the Supplier (supplier*) is the vendor.
 * Merge fields: companyBrandName/LogoPath/Address/Phone/NTN/STRN, supplierName/Address/Phone/NTN/STRN,
 * purchaseBillNumber, date, supplierBillNumber, supplierIRN, paymentTerms, dueDate,
 * goodsReceiptNumbers[], linkedSaleBillNumbers[], division*, subtotal, gstRate, gstAmount, grandTotal,
 * amountInWords, items[] (sNo, itemTypeName, description, quantity, uom, unitPrice, lineTotal, hsCode).
 * Renders via Handlebars, prints to A4.
 * ONLY registered helpers used: fmtDate, fmt, nl2br, richText, join, emptyRows, math
 */

export const purchaseBillStarters = [
  // ── 1. Classic Serif ─────────────────────────────────────────────────────────
  {
    id: "purchasebill-classic-serif",
    name: "Classic Serif",
    type: "PurchaseBill",
    description: "Traditional Times New Roman layout with double-rule border and ruled item rows",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 12mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer-sect { margin-top: auto; }
.top-rule { border-top: 4px double #000; border-bottom: 1.5px solid #000; padding: 6px 0; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
.co-name { font-size: 26pt; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; }
.co-sub { font-size: 9pt; color: #333; margin-top: 3px; line-height: 1.4; }
.co-tax { font-size: 9pt; margin-top: 3px; }
.doc-block { text-align: right; }
.doc-title { font-size: 18pt; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; color: #1a1a1a; }
.doc-num { font-size: 12pt; font-weight: 700; border: 1.5px solid #000; display: inline-block; padding: 2px 14px; margin-top: 4px; }
.doc-date { font-size: 10pt; margin-top: 3px; font-style: italic; }
.vendor-ref { font-size: 9.5pt; font-style: italic; margin-top: 2px; }
.from-row { display: flex; justify-content: space-between; align-items: flex-start; margin: 10px 0 6px; border-bottom: 1px solid #999; padding-bottom: 6px; }
.from-left { font-size: 11pt; line-height: 1.6; }
.from-right { font-size: 9.5pt; text-align: right; line-height: 1.6; }
.ref-line { font-size: 10.5pt; font-weight: 700; font-style: italic; margin-bottom: 6px; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #333 !important; color: #fff !important; font-size: 9pt; text-transform: uppercase; padding: 5px 8px; border: 1px solid #333; text-align: center; letter-spacing: 0.5px; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #aaa; padding: 3px 8px; font-size: 10pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #f0f0f0 !important; }
.no-break { page-break-inside: avoid; }
.totals-row { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 2px; }
.words-block { flex: 1; padding-right: 20px; }
.words-lbl { font-size: 10.5pt; font-weight: 700; font-style: italic; }
.words-val { font-size: 12pt; font-weight: 700; margin-top: 6px; font-style: italic; }
.ttbl { border-collapse: collapse; }
.ttbl td { border: 1px solid #aaa; padding: 3px 10px; font-size: 10pt; }
.ttbl .lbl { font-weight: 700; text-transform: uppercase; white-space: nowrap; }
.ttbl .val { text-align: right; min-width: 100px; }
.ttbl tr:nth-child(even) td { background: #f0f0f0 !important; }
.ttbl tr.grand td { font-weight: 900; border-top: 2.5px double #000; font-size: 11pt; }
.sigs { display: flex; justify-content: space-between; padding: 0 40px; margin-top: 44px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1.5px solid #555; margin-bottom: 4px; }
.sig .lbl { font-size: 9pt; color: #444; font-style: italic; }
.bottom-rule { border-top: 4px double #000; margin-top: 10px; }
</style></head><body>
<div class="main">
<div class="top-rule">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px;margin-bottom:4px"><br>{{/if}}
    <div class="co-name">{{companyBrandName}}</div>
    <div class="co-sub">{{{nl2br companyAddress}}}</div>
    <div class="co-sub">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="co-tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;&bull;&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="doc-block">
    <div class="doc-title">PURCHASE BILL</div>
    <div class="doc-num">PB # {{purchaseBillNumber}}</div>
    <div class="doc-date">{{fmtDate date}}</div>
    {{#if supplierBillNumber}}<div class="vendor-ref">Supplier Inv # {{supplierBillNumber}}</div>{{/if}}
    {{#if supplierIRN}}<div class="vendor-ref">Supplier IRN: {{supplierIRN}}</div>{{/if}}
  </div>
</div>
<div class="from-row">
  <div class="from-left">
    <div><strong>From Messrs (Vendor):</strong> {{supplierName}}</div>
    <div><strong>Address:</strong> {{{nl2br supplierAddress}}}</div>
    {{#if supplierPhone}}<div><strong>Phone:</strong> {{supplierPhone}}</div>{{/if}}
  </div>
  <div class="from-right">
    {{#if supplierNTN}}<div>NTN # {{supplierNTN}}</div>{{/if}}
    {{#if supplierSTRN}}<div>GST # {{supplierSTRN}}</div>{{/if}}
  </div>
</div>
<div class="ref-line">{{#if goodsReceiptNumbers}}GRN # {{join goodsReceiptNumbers}} &nbsp; {{/if}}Payment Terms: {{#if paymentTerms}}{{paymentTerms}}{{else}}&mdash;{{/if}}{{#if dueDate}} &nbsp; Due Date: {{fmtDate dueDate}}{{/if}}</div>
<table class="items">
  <thead><tr><th style="width:30px">S#</th><th class="l">Description</th><th style="width:50px">Qty</th><th style="width:45px">UoM</th><th style="width:90px">Unit Price</th><th style="width:95px">Amount</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
    {{emptyRows (math 20 "-" items.length) 6}}
  </tbody>
</table>
<div class="no-break">
  <div class="totals-row">
    <div class="words-block"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
    <table class="ttbl">
      <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
    </table>
  </div>
</div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
  <div class="bottom-rule"></div>
</div>
</body></html>`,
  },

  // ── 2. Modern Minimal ────────────────────────────────────────────────────────
  {
    id: "purchasebill-modern-minimal",
    name: "Modern Minimal",
    type: "PurchaseBill",
    description: "Clean sans-serif layout with thin indigo accent bar and card-style vendor block",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 9mm; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Calibri, Arial, sans-serif; padding: 10mm; color: #1a1a1a; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer-sect { margin-top: auto; }
.accent { height: 3px; background: #4338ca !important; margin-bottom: 18px; }
.hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.co-name { font-size: 22pt; font-weight: 700; color: #4338ca; letter-spacing: 0.5px; }
.co-detail { font-size: 8.5pt; color: #666; margin-top: 4px; line-height: 1.5; }
.doc-right { text-align: right; }
.doc-label { font-size: 9pt; color: #4338ca; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.doc-num { font-size: 18pt; font-weight: 700; color: #111; margin-top: 2px; }
.doc-date { font-size: 9pt; color: #666; margin-top: 2px; }
.cards { display: flex; gap: 12px; margin: 0 0 12px; }
.card { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; }
.card-lbl { font-size: 7.5pt; text-transform: uppercase; color: #9ca3af; letter-spacing: 0.8px; font-weight: 700; margin-bottom: 4px; }
.card-val { font-size: 10.5pt; font-weight: 600; color: #111; }
.card-sub { font-size: 8.5pt; color: #666; margin-top: 2px; }
.card-indigo { border-top: 2px solid #4338ca; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #f8fafc !important; color: #374151; font-size: 7.5pt; text-transform: uppercase; padding: 7px 10px; border-bottom: 2px solid #e5e7eb; text-align: left; letter-spacing: 0.5px; font-weight: 700; }
table.items th.r { text-align: right; }
table.items th.c { text-align: center; }
.cell { padding: 5px 10px; font-size: 9.5pt; border-bottom: 1px solid #f1f5f9; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
.no-break { page-break-inside: avoid; }
.totals-area { display: flex; justify-content: flex-end; margin-top: 4px; }
.ttbl { border-collapse: collapse; min-width: 260px; }
.ttbl td { padding: 4px 12px; font-size: 9.5pt; border-bottom: 1px solid #f1f5f9; }
.ttbl .lbl { color: #6b7280; }
.ttbl .val { text-align: right; font-weight: 600; }
.ttbl tr.grand td { border-top: 2px solid #4338ca; border-bottom: 2px solid #4338ca; color: #4338ca; font-weight: 700; font-size: 10.5pt; }
.words-lbl { font-size: 8.5pt; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; margin-top: 12px; }
.words-val { font-size: 10.5pt; font-weight: 600; margin-top: 3px; }
.sigs { display: flex; justify-content: space-between; padding: 0 30px; margin-top: 40px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 1.5px solid #4338ca; margin-bottom: 4px; }
.sig .lbl { font-size: 8pt; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="main">
<div class="accent"></div>
<div class="hdr">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px;display:block;margin-bottom:8px">{{/if}}
    <div class="co-name">{{companyBrandName}}</div>
    <div class="co-detail">{{{nl2br companyAddress}}}</div>
    <div class="co-detail">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="co-detail">NTN: {{companyNTN}}{{#if companySTRN}} &bull; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="doc-right">
    <div class="doc-label">Purchase Bill</div>
    <div class="doc-num"># {{purchaseBillNumber}}</div>
    <div class="doc-date">{{fmtDate date}}</div>
    {{#if goodsReceiptNumbers}}<div class="doc-date">GRN # {{join goodsReceiptNumbers}}</div>{{/if}}
  </div>
</div>
<div class="cards">
  <div class="card card-indigo">
    <div class="card-lbl">Vendor / From</div>
    <div class="card-val">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="card-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div class="card-sub">{{supplierPhone}}</div>{{/if}}
    {{#if supplierNTN}}<div class="card-sub">NTN: {{supplierNTN}}{{#if supplierSTRN}} &bull; STRN: {{supplierSTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="card">
    <div class="card-lbl">Supplier Invoice</div>
    <div class="card-val">{{#if supplierBillNumber}}{{supplierBillNumber}}{{else}}&mdash;{{/if}}</div>
    {{#if supplierIRN}}<div class="card-sub">Supplier IRN: {{supplierIRN}}</div>{{/if}}
  </div>
  <div class="card">
    <div class="card-lbl">Payment</div>
    <div class="card-val">{{#if paymentTerms}}{{paymentTerms}}{{else}}As Agreed{{/if}}</div>
    {{#if dueDate}}<div class="card-sub">Due {{fmtDate dueDate}}</div>{{/if}}
  </div>
</div>
<table class="items">
  <thead><tr><th style="width:32px">S#</th><th>Description</th><th class="c" style="width:50px">Qty</th><th class="c" style="width:45px">UoM</th><th class="r" style="width:88px">Unit Price</th><th class="r" style="width:92px">Amount</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
    {{emptyRows (math 20 "-" items.length) 6}}
  </tbody>
</table>
<div class="no-break">
  <div class="words-lbl">Amount In Words</div>
  <div class="words-val">{{amountInWords}}</div>
  <div class="totals-area">
    <table class="ttbl">
      <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST (Input Tax) {{gstRate}}%</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
    </table>
  </div>
</div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
</div>
</body></html>`,
  },

  // ── 3. Corporate Navy Band ───────────────────────────────────────────────────
  {
    id: "purchasebill-corporate-navy",
    name: "Corporate Navy Band",
    type: "PurchaseBill",
    description: "Solid navy header band with white company name and contrasting gold accent line",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #1a1a1a; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; padding: 0 10mm 6mm; }
.footer-sect { margin-top: auto; padding: 0 10mm; }
.nav-band { background: #1e3a5f !important; padding: 10mm 10mm 6mm; display: flex; justify-content: space-between; align-items: center; }
.co-name { font-size: 24pt; font-weight: 800; color: #fff; text-transform: uppercase; letter-spacing: 1.5px; }
.co-detail { font-size: 8.5pt; color: #a8c0d8; margin-top: 4px; line-height: 1.4; }
.co-tax { font-size: 8.5pt; color: #c8d8e8; margin-top: 3px; }
.doc-box { text-align: right; }
.doc-title { font-size: 19pt; font-weight: 800; color: #fff; text-transform: uppercase; letter-spacing: 2px; }
.doc-meta { font-size: 9.5pt; color: #c8d8e8; margin-top: 4px; line-height: 1.6; }
.gold-rule { height: 4px; background: #d4a017 !important; }
.info-strip { background: #f0f4f8 !important; padding: 8px 0; margin: 10px 0; display: flex; gap: 0; border-top: 1px solid #dde3ea; border-bottom: 1px solid #dde3ea; }
.info-cell { flex: 1; padding: 0 14px; font-size: 9pt; border-right: 1px solid #dde3ea; }
.info-cell:last-child { border-right: none; }
.info-lbl { font-size: 7.5pt; text-transform: uppercase; color: #6b7280; font-weight: 700; letter-spacing: 0.5px; }
.info-val { font-weight: 600; margin-top: 2px; }
table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
table.items th { background: #1e3a5f !important; color: #fff !important; font-size: 8pt; text-transform: uppercase; padding: 6px 8px; border: 1px solid #1e3a5f; text-align: center; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #c8d0da; padding: 3px 8px; font-size: 9.5pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #f0f4f8 !important; }
.no-break { page-break-inside: avoid; }
.totals-layout { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; }
.words-side { flex: 1; padding-right: 20px; }
.words-lbl { font-size: 9pt; font-weight: 700; color: #1e3a5f; }
.words-val { font-size: 11pt; font-weight: 700; margin-top: 5px; }
.ttbl { border-collapse: collapse; }
.ttbl td { padding: 3px 12px; font-size: 9.5pt; border: 1px solid #c8d0da; }
.ttbl .lbl { font-weight: 700; white-space: nowrap; }
.ttbl .val { text-align: right; min-width: 100px; }
.ttbl tr:nth-child(even) td { background: #f0f4f8 !important; }
.ttbl tr.grand td { background: #1e3a5f !important; color: #fff !important; font-weight: 700; font-size: 10.5pt; }
.sigs { display: flex; justify-content: space-between; padding: 0 30px; margin-top: 40px; padding-bottom: 8mm; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #1e3a5f; margin-bottom: 4px; }
.sig .lbl { font-size: 8.5pt; color: #555; text-transform: uppercase; }
.footer-band { height: 6px; background: #1e3a5f !important; margin-top: 6px; }
</style></head><body>
<div class="nav-band">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:55px;display:block;margin-bottom:6px">{{/if}}
    <div class="co-name">{{companyBrandName}}</div>
    <div class="co-detail">{{{nl2br companyAddress}}}</div>
    <div class="co-detail">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="co-tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;|&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="doc-box">
    <div class="doc-title">PURCHASE BILL</div>
    <div class="doc-meta">PB # {{purchaseBillNumber}}<br>{{fmtDate date}}{{#if goodsReceiptNumbers}}<br>GRN # {{join goodsReceiptNumbers}}{{/if}}</div>
  </div>
</div>
<div class="gold-rule"></div>
<div class="main">
  <div class="info-strip">
    <div class="info-cell"><div class="info-lbl">Vendor</div><div class="info-val">{{supplierName}}</div>{{#if supplierNTN}}<div style="font-size:8.5pt;color:#555">NTN: {{supplierNTN}}</div>{{/if}}{{#if supplierSTRN}}<div style="font-size:8.5pt;color:#555">GST: {{supplierSTRN}}</div>{{/if}}</div>
    <div class="info-cell"><div class="info-lbl">Vendor Address</div><div class="info-val" style="font-size:9pt">{{{nl2br supplierAddress}}}</div>{{#if supplierPhone}}<div style="font-size:8.5pt;color:#555">{{supplierPhone}}</div>{{/if}}</div>
    <div class="info-cell"><div class="info-lbl">Supplier Inv #</div><div class="info-val">{{#if supplierBillNumber}}{{supplierBillNumber}}{{else}}&mdash;{{/if}}</div>{{#if supplierIRN}}<div style="font-size:8.5pt;color:#555">IRN: {{supplierIRN}}</div>{{/if}}</div>
    <div class="info-cell"><div class="info-lbl">Payment</div><div class="info-val">{{#if paymentTerms}}{{paymentTerms}}{{else}}&mdash;{{/if}}</div>{{#if dueDate}}<div style="font-size:8.5pt;color:#555">Due {{fmtDate dueDate}}</div>{{/if}}</div>
  </div>
  <table class="items">
    <thead><tr><th style="width:32px">S#</th><th class="l">Description</th><th style="width:50px">Qty</th><th style="width:45px">UoM</th><th style="width:88px">Unit Price</th><th style="width:94px">Total</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
      {{emptyRows (math 20 "-" items.length) 6}}
    </tbody>
  </table>
  <div class="no-break">
    <div class="totals-layout">
      <div class="words-side"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
      <table class="ttbl">
        <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
        <tr><td class="lbl">GST (Input Tax) {{gstRate}}%</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
        <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
      </table>
    </div>
  </div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
</div>
<div class="footer-band"></div>
</body></html>`,
  },

  // ── 4. Bold Colored Banner ───────────────────────────────────────────────────
  {
    id: "purchasebill-bold-banner",
    name: "Bold Colored Banner",
    type: "PurchaseBill",
    description: "Vivid burnt-orange gradient banner header with bright white title badge",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Calibri, Arial, sans-serif; color: #111; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; padding: 0 10mm 6mm; }
.footer-sect { margin-top: auto; padding: 0 10mm 8mm; }
.banner { background: linear-gradient(135deg, #9a3412 0%, #ea580c 100%) !important; padding: 8mm 10mm; display: flex; justify-content: space-between; align-items: center; }
.co-name { font-size: 23pt; font-weight: 800; color: #fff; text-transform: uppercase; letter-spacing: 1px; }
.co-sub { font-size: 8.5pt; color: rgba(255,255,255,0.8); margin-top: 3px; line-height: 1.4; }
.badge { background: #fff !important; color: #9a3412; font-size: 14pt; font-weight: 900; padding: 6px 18px; border-radius: 4px; text-transform: uppercase; letter-spacing: 1.5px; display: inline-block; }
.banner-meta { text-align: right; margin-top: 6px; font-size: 9pt; color: rgba(255,255,255,0.85); line-height: 1.6; }
.divider { height: 4px; background: #334155 !important; }
.info-bar { display: flex; gap: 0; margin: 10px 0; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; }
.info-seg { flex: 1; padding: 8px 14px; }
.info-seg:not(:last-child) { border-right: 1px solid #d1d5db; }
.info-seg .lbl { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; }
.info-seg .val { font-size: 10pt; font-weight: 600; margin-top: 2px; }
.info-seg .sub { font-size: 8.5pt; color: #6b7280; margin-top: 1px; }
table.items { width: 100%; border-collapse: collapse; margin-top: 8px; }
table.items th { background: #9a3412 !important; color: #fff !important; font-size: 8pt; text-transform: uppercase; padding: 6px 8px; border: 1px solid #9a3412; text-align: center; letter-spacing: 0.3px; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #d1d5db; padding: 3px 8px; font-size: 9.5pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #fff7ed !important; }
.no-break { page-break-inside: avoid; }
.totals-layout { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 6px; }
.words-side { flex: 1; padding-right: 18px; }
.words-lbl { font-size: 9pt; font-weight: 700; color: #9a3412; }
.words-val { font-size: 11pt; font-weight: 700; margin-top: 5px; }
.ttbl { border-collapse: collapse; }
.ttbl td { padding: 4px 12px; font-size: 9.5pt; border: 1px solid #d1d5db; }
.ttbl .lbl { font-weight: 700; }
.ttbl .val { text-align: right; min-width: 100px; }
.ttbl tr:nth-child(even) td { background: #fff7ed !important; }
.ttbl tr.grand td { background: #9a3412 !important; color: #fff !important; font-weight: 800; font-size: 10.5pt; }
.sigs { display: flex; justify-content: space-between; padding: 0 30px; margin-top: 40px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #9a3412; margin-bottom: 4px; }
.sig .lbl { font-size: 8.5pt; color: #555; }
.footer-accent { height: 6px; background: linear-gradient(135deg, #9a3412, #ea580c) !important; margin-top: 8px; }
</style></head><body>
<div class="banner">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:55px;display:block;margin-bottom:6px">{{/if}}
    <div class="co-name">{{companyBrandName}}</div>
    <div class="co-sub">{{{nl2br companyAddress}}}</div>
    <div class="co-sub">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="co-sub">NTN: {{companyNTN}}{{#if companySTRN}} &bull; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div style="text-align:right">
    <div class="badge">PURCHASE BILL</div>
    <div class="banner-meta"># {{purchaseBillNumber}}<br>{{fmtDate date}}{{#if goodsReceiptNumbers}}<br>GRN # {{join goodsReceiptNumbers}}{{/if}}</div>
  </div>
</div>
<div class="divider"></div>
<div class="main">
  <div class="info-bar">
    <div class="info-seg"><div class="lbl">Vendor</div><div class="val">{{supplierName}}</div>{{#if supplierNTN}}<div class="sub">NTN: {{supplierNTN}}</div>{{/if}}{{#if supplierSTRN}}<div class="sub">GST: {{supplierSTRN}}</div>{{/if}}</div>
    <div class="info-seg"><div class="lbl">Vendor Address</div><div class="val" style="font-size:9pt">{{{nl2br supplierAddress}}}</div>{{#if supplierPhone}}<div class="sub">{{supplierPhone}}</div>{{/if}}</div>
    <div class="info-seg"><div class="lbl">Supplier Inv #</div><div class="val">{{#if supplierBillNumber}}{{supplierBillNumber}}{{else}}&mdash;{{/if}}</div>{{#if supplierIRN}}<div class="sub">IRN: {{supplierIRN}}</div>{{/if}}</div>
    <div class="info-seg"><div class="lbl">Payment</div><div class="val">{{#if paymentTerms}}{{paymentTerms}}{{else}}&mdash;{{/if}}</div>{{#if dueDate}}<div class="sub">Due {{fmtDate dueDate}}</div>{{/if}}</div>
  </div>
  <table class="items">
    <thead><tr><th style="width:32px">S#</th><th class="l">Description</th><th style="width:50px">Qty</th><th style="width:45px">UoM</th><th style="width:88px">Unit Price</th><th style="width:94px">Total</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
      {{emptyRows (math 20 "-" items.length) 6}}
    </tbody>
  </table>
  <div class="no-break">
    <div class="totals-layout">
      <div class="words-side"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
      <table class="ttbl">
        <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
        <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
        <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
      </table>
    </div>
  </div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
</div>
<div class="footer-accent"></div>
</body></html>`,
  },

  // ── 5. Monochrome Ink-Saver ──────────────────────────────────────────────────
  {
    id: "purchasebill-monochrome-ink",
    name: "Monochrome Ink-Saver",
    type: "PurchaseBill",
    description: "Pure black and white, no background fills — optimized for laser printing on plain paper",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm 12mm; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, Helvetica, sans-serif; padding: 10mm 12mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer-sect { margin-top: auto; }
.hdr { border: 2px solid #000; padding: 8px 12px; display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.co-name { font-size: 20pt; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
.co-sub { font-size: 8.5pt; margin-top: 3px; line-height: 1.4; }
.doc-box { text-align: right; }
.doc-title { font-size: 16pt; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; text-decoration: underline; }
.doc-meta { font-size: 9pt; margin-top: 4px; line-height: 1.6; }
.divider { border-top: 1px solid #000; margin: 8px 0; }
.from-section { font-size: 10pt; line-height: 1.7; margin-bottom: 6px; }
.from-row { display: flex; justify-content: space-between; }
.ref-line { font-size: 10pt; font-weight: 700; margin-bottom: 6px; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #fff !important; color: #000 !important; font-size: 8.5pt; text-transform: uppercase; padding: 4px 7px; border: 1.5px solid #000; text-align: center; font-weight: 900; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #000; padding: 3px 7px; font-size: 9.5pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
.no-break { page-break-inside: avoid; }
.totals-row { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; }
.words-block { flex: 1; padding-right: 20px; }
.words-lbl { font-size: 9.5pt; font-weight: 700; text-decoration: underline; }
.words-val { font-size: 10.5pt; font-weight: 700; margin-top: 5px; }
.ttbl { border-collapse: collapse; }
.ttbl td { border: 1px solid #000; padding: 3px 10px; font-size: 9.5pt; }
.ttbl .lbl { font-weight: 700; text-transform: uppercase; }
.ttbl .val { text-align: right; min-width: 100px; }
.ttbl tr.grand td { font-weight: 900; border: 2px solid #000; font-size: 10.5pt; }
.sigs { display: flex; justify-content: space-between; padding: 0 30px; margin-top: 44px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 1.5px solid #000; margin-bottom: 4px; }
.sig .lbl { font-size: 8.5pt; text-transform: uppercase; font-weight: 700; }
.bottom-border { border-top: 2px solid #000; margin-top: 8px; }
</style></head><body>
<div class="main">
<div class="hdr">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:55px;display:block;margin-bottom:5px;filter:grayscale(100%)">{{/if}}
    <div class="co-name">{{companyBrandName}}</div>
    <div class="co-sub">{{{nl2br companyAddress}}}</div>
    <div class="co-sub">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="co-sub">NTN: {{companyNTN}}{{#if companySTRN}} | STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="doc-box">
    <div class="doc-title">PURCHASE BILL</div>
    <div class="doc-meta">PB No: {{purchaseBillNumber}}<br>Date: {{fmtDate date}}{{#if supplierBillNumber}}<br>Supplier Inv # {{supplierBillNumber}}{{/if}}{{#if supplierIRN}}<br>Supplier IRN: {{supplierIRN}}{{/if}}</div>
  </div>
</div>
<div class="from-section">
  <div class="from-row">
    <div>
      <div><strong>From (Vendor):</strong> {{supplierName}}</div>
      <div><strong>Address:</strong> {{{nl2br supplierAddress}}}</div>
      {{#if supplierPhone}}<div><strong>Phone:</strong> {{supplierPhone}}</div>{{/if}}
    </div>
    <div style="text-align:right">
      {{#if supplierNTN}}<div>NTN: {{supplierNTN}}</div>{{/if}}
      {{#if supplierSTRN}}<div>STRN/GST: {{supplierSTRN}}</div>{{/if}}
    </div>
  </div>
</div>
<div class="ref-line">{{#if goodsReceiptNumbers}}GRN #: {{join goodsReceiptNumbers}} &nbsp;|&nbsp; {{/if}}Payment: {{#if paymentTerms}}{{paymentTerms}}{{else}}&mdash;{{/if}}{{#if dueDate}} &nbsp;|&nbsp; Due: {{fmtDate dueDate}}{{/if}}</div>
<div class="divider"></div>
<table class="items">
  <thead><tr><th style="width:30px">S#</th><th class="l">Description</th><th style="width:50px">Qty</th><th style="width:45px">UoM</th><th style="width:90px">Unit Price</th><th style="width:95px">Total</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
    {{emptyRows (math 20 "-" items.length) 6}}
  </tbody>
</table>
<div class="no-break">
  <div class="totals-row">
    <div class="words-block"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
    <table class="ttbl">
      <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
    </table>
  </div>
</div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Checked By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
  <div class="bottom-border"></div>
</div>
</body></html>`,
  },

  // ── 6. Elegant Premium (Charcoal + Gold) ─────────────────────────────────────
  {
    id: "purchasebill-elegant-premium",
    name: "Elegant Premium",
    type: "PurchaseBill",
    description: "Charcoal and gold palette with fine rules and italic serif accents for high-end stationery",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Georgia, "Times New Roman", serif; padding: 12mm; color: #1c1c1c; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer-sect { margin-top: auto; }
.top-gold { height: 3px; background: #b8922a !important; margin-bottom: 14px; }
.hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #b8922a; padding-bottom: 12px; margin-bottom: 14px; }
.co-name { font-size: 22pt; font-weight: 700; color: #1c1c1c; letter-spacing: 0.5px; }
.co-detail { font-size: 8.5pt; color: #555; margin-top: 4px; line-height: 1.5; font-family: Arial, sans-serif; }
.co-tax { font-size: 8.5pt; color: #555; margin-top: 3px; font-family: Arial, sans-serif; }
.doc-area { text-align: right; }
.doc-title { font-size: 16pt; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: #1c1c1c; }
.doc-title span { color: #b8922a; }
.doc-rule { width: 100%; height: 1px; background: #b8922a !important; margin: 5px 0; }
.doc-num { font-size: 11pt; font-style: italic; }
.doc-date { font-size: 9.5pt; color: #555; font-family: Arial, sans-serif; }
.from-section { margin: 10px 0; }
.from-row { display: flex; justify-content: space-between; align-items: flex-start; }
.from-left { font-size: 10.5pt; line-height: 1.7; }
.from-left strong { color: #b8922a; }
.from-right { font-size: 9.5pt; text-align: right; color: #555; line-height: 1.6; font-family: Arial, sans-serif; }
.ref-line { font-size: 10pt; font-style: italic; margin-bottom: 8px; font-family: Arial, sans-serif; }
table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
table.items th { background: #2c2c2c !important; color: #b8922a !important; font-size: 8pt; text-transform: uppercase; padding: 6px 8px; border: 1px solid #2c2c2c; text-align: center; letter-spacing: 0.8px; font-family: Arial, sans-serif; font-style: normal; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #ccc; padding: 3px 8px; font-size: 9.5pt; height: 22px; font-family: Arial, sans-serif; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #f9f6ef !important; }
.no-break { page-break-inside: avoid; }
.totals-layout { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 6px; }
.words-side { flex: 1; padding-right: 20px; }
.words-lbl { font-size: 9pt; font-weight: 700; color: #b8922a; font-style: italic; }
.words-val { font-size: 11pt; font-weight: 700; margin-top: 6px; }
.ttbl { border-collapse: collapse; }
.ttbl td { border: 1px solid #ccc; padding: 3px 12px; font-size: 9.5pt; font-family: Arial, sans-serif; }
.ttbl .lbl { font-weight: 700; }
.ttbl .val { text-align: right; min-width: 100px; }
.ttbl tr:nth-child(even) td { background: #f9f6ef !important; }
.ttbl tr.grand td { background: #2c2c2c !important; color: #b8922a !important; font-weight: 700; font-size: 10.5pt; }
.sigs { display: flex; justify-content: space-between; padding: 0 30px; margin-top: 44px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1px solid #b8922a; margin-bottom: 4px; }
.sig .lbl { font-size: 8.5pt; color: #777; font-style: italic; }
.bot-gold { height: 3px; background: #b8922a !important; margin-top: 10px; }
</style></head><body>
<div class="main">
<div class="top-gold"></div>
<div class="hdr">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:58px;display:block;margin-bottom:6px">{{/if}}
    <div class="co-name">{{companyBrandName}}</div>
    <div class="co-detail">{{{nl2br companyAddress}}}</div>
    <div class="co-detail">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="co-tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;&bull;&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="doc-area">
    <div class="doc-title">Purchase <span>Bill</span></div>
    <div class="doc-rule"></div>
    <div class="doc-num">No. {{purchaseBillNumber}}</div>
    <div class="doc-date">{{fmtDate date}}</div>
    {{#if supplierBillNumber}}<div class="doc-date">Supplier Inv # {{supplierBillNumber}}</div>{{/if}}
    {{#if supplierIRN}}<div class="doc-date">Supplier IRN: {{supplierIRN}}</div>{{/if}}
  </div>
</div>
<div class="from-section">
  <div class="from-row">
    <div class="from-left">
      <div><strong>From Messrs:</strong> {{supplierName}}</div>
      {{#if supplierAddress}}<div>{{{nl2br supplierAddress}}}</div>{{/if}}
      {{#if supplierPhone}}<div>{{supplierPhone}}</div>{{/if}}
    </div>
    <div class="from-right">
      {{#if supplierNTN}}<div>NTN: {{supplierNTN}}</div>{{/if}}
      {{#if supplierSTRN}}<div>GST: {{supplierSTRN}}</div>{{/if}}
    </div>
  </div>
</div>
<div class="ref-line">{{#if goodsReceiptNumbers}}GRN # {{join goodsReceiptNumbers}} &mdash; {{/if}}Payment Terms: {{#if paymentTerms}}{{paymentTerms}}{{else}}&mdash;{{/if}}{{#if dueDate}} &mdash; Due {{fmtDate dueDate}}{{/if}}</div>
<table class="items">
  <thead><tr><th style="width:30px">S#</th><th class="l">Description</th><th style="width:50px">Qty</th><th style="width:45px">UoM</th><th style="width:90px">Unit Price</th><th style="width:95px">Total</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
    {{emptyRows (math 20 "-" items.length) 6}}
  </tbody>
</table>
<div class="no-break">
  <div class="totals-layout">
    <div class="words-side"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
    <table class="ttbl">
      <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
    </table>
  </div>
</div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
  <div class="bot-gold"></div>
</div>
</body></html>`,
  },

  // ── 7. Compact Dense ─────────────────────────────────────────────────────────
  {
    id: "purchasebill-compact-dense",
    name: "Compact Dense",
    type: "PurchaseBill",
    description: "Tight row heights and small font for high line-count purchase bills that must fit on one A4 sheet",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 6mm 8mm; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Arial, sans-serif; padding: 6mm 8mm; color: #000; font-size: 8.5pt; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer-sect { margin-top: auto; }
.hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid #333; padding-bottom: 5px; margin-bottom: 6px; }
.co-name { font-size: 15pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
.co-sub { font-size: 7.5pt; color: #444; margin-top: 2px; line-height: 1.4; }
.co-tax { font-size: 7.5pt; margin-top: 2px; }
.doc-box { text-align: right; }
.doc-title { font-size: 13pt; font-weight: 800; text-transform: uppercase; color: #234580; }
.doc-meta { font-size: 8pt; color: #333; margin-top: 2px; line-height: 1.5; }
.info-row { display: flex; justify-content: space-between; align-items: flex-start; font-size: 8.5pt; margin-bottom: 4px; line-height: 1.5; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
.ref-line { font-size: 8.5pt; font-weight: 700; margin-bottom: 4px; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #234580 !important; color: #fff !important; font-size: 7.5pt; text-transform: uppercase; padding: 3px 5px; border: 1px solid #234580; text-align: center; letter-spacing: 0.3px; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #bbb; padding: 2px 5px; font-size: 8.5pt; height: 18px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #eef2fa !important; }
.no-break { page-break-inside: avoid; }
.totals-row { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 3px; }
.words-block { flex: 1; padding-right: 14px; }
.words-lbl { font-size: 8.5pt; font-weight: 700; }
.words-val { font-size: 9.5pt; font-weight: 700; margin-top: 3px; }
.ttbl { border-collapse: collapse; }
.ttbl td { border: 1px solid #bbb; padding: 2px 8px; font-size: 8.5pt; }
.ttbl .lbl { font-weight: 700; white-space: nowrap; }
.ttbl .val { text-align: right; min-width: 88px; }
.ttbl tr:nth-child(even) td { background: #eef2fa !important; }
.ttbl tr.grand td { background: #234580 !important; color: #fff !important; font-weight: 800; font-size: 9pt; }
.sigs { display: flex; justify-content: space-between; padding: 0 20px; margin-top: 24px; }
.sig { text-align: center; }
.sig .line { width: 160px; border-top: 1px solid #333; margin-bottom: 3px; }
.sig .lbl { font-size: 7.5pt; color: #555; text-transform: uppercase; }
</style></head><body>
<div class="main">
<div class="hdr">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:44px;display:block;margin-bottom:3px">{{/if}}
    <div class="co-name">{{companyBrandName}}</div>
    <div class="co-sub">{{{nl2br companyAddress}}}</div>
    <div class="co-sub">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="co-tax">NTN: {{companyNTN}}{{#if companySTRN}} | STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="doc-box">
    <div class="doc-title">PURCHASE BILL</div>
    <div class="doc-meta">No: {{purchaseBillNumber}}<br>{{fmtDate date}}{{#if goodsReceiptNumbers}}<br>GRN# {{join goodsReceiptNumbers}}{{/if}}</div>
  </div>
</div>
<div class="info-row">
  <div><strong>Vendor:</strong> {{supplierName}} {{#if supplierAddress}}&nbsp;|&nbsp; {{supplierAddress}}{{/if}} {{#if supplierPhone}}&nbsp;|&nbsp; {{supplierPhone}}{{/if}}</div>
  <div>{{#if supplierNTN}}NTN: {{supplierNTN}}{{/if}}{{#if supplierSTRN}} &nbsp;|&nbsp; GST: {{supplierSTRN}}{{/if}}</div>
</div>
<div class="ref-line">{{#if supplierBillNumber}}Supplier Inv # {{supplierBillNumber}}{{else}}Supplier Inv #: &mdash;{{/if}}{{#if supplierIRN}} &nbsp;|&nbsp; Supplier IRN: {{supplierIRN}}{{/if}}{{#if paymentTerms}} &nbsp;|&nbsp; Terms: {{paymentTerms}}{{/if}}{{#if dueDate}} &nbsp;|&nbsp; Due: {{fmtDate dueDate}}{{/if}}</div>
<table class="items">
  <thead><tr><th style="width:26px">S#</th><th class="l">Description</th><th style="width:42px">Qty</th><th style="width:40px">UoM</th><th style="width:82px">Unit Price</th><th style="width:88px">Total</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
    {{emptyRows (math 26 "-" items.length) 6}}
  </tbody>
</table>
<div class="no-break">
  <div class="totals-row">
    <div class="words-block"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
    <table class="ttbl">
      <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
    </table>
  </div>
</div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Checked By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
</div>
</body></html>`,
  },

  // ── 8. Left Sidebar Strip ────────────────────────────────────────────────────
  {
    id: "purchasebill-left-sidebar",
    name: "Left Sidebar Strip",
    type: "PurchaseBill",
    description: "Vertical navy sidebar on the left carries company identity; content flows to the right",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #111; display: flex; min-height: 100vh; }
.sidebar { width: 48mm; background: #1b3057 !important; color: #fff; padding: 10mm 6mm; display: flex; flex-direction: column; flex-shrink: 0; }
.sb-logo { margin-bottom: 8px; }
.sb-name { font-size: 13pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.2; color: #fff; }
.sb-divider { border-top: 1px solid rgba(255,255,255,0.3); margin: 8px 0; }
.sb-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.8px; color: rgba(255,255,255,0.55); font-weight: 700; margin-bottom: 2px; }
.sb-value { font-size: 8.5pt; color: rgba(255,255,255,0.9); line-height: 1.4; margin-bottom: 8px; }
.sb-bottom { margin-top: auto; }
.content { flex: 1; padding: 10mm 10mm 8mm 8mm; display: flex; flex-direction: column; }
.main { flex: 1; }
.footer-sect { margin-top: auto; }
.doc-hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1b3057; padding-bottom: 8px; margin-bottom: 10px; }
.doc-title { font-size: 19pt; font-weight: 800; color: #1b3057; text-transform: uppercase; letter-spacing: 1.5px; }
.doc-meta { text-align: right; font-size: 9.5pt; color: #444; line-height: 1.6; }
.from-section { font-size: 10pt; line-height: 1.7; margin-bottom: 6px; }
.from-row { display: flex; justify-content: space-between; }
.ref-line { font-size: 10pt; font-weight: 700; font-style: italic; margin-bottom: 6px; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #1b3057 !important; color: #fff !important; font-size: 8pt; text-transform: uppercase; padding: 5px 7px; border: 1px solid #1b3057; text-align: center; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #c5ccd5; padding: 3px 7px; font-size: 9.5pt; height: 21px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #edf1f7 !important; }
.no-break { page-break-inside: avoid; }
.totals-layout { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; }
.words-side { flex: 1; padding-right: 16px; }
.words-lbl { font-size: 9pt; font-weight: 700; color: #1b3057; }
.words-val { font-size: 10.5pt; font-weight: 700; margin-top: 5px; }
.ttbl { border-collapse: collapse; }
.ttbl td { border: 1px solid #c5ccd5; padding: 3px 10px; font-size: 9.5pt; }
.ttbl .lbl { font-weight: 700; white-space: nowrap; }
.ttbl .val { text-align: right; min-width: 92px; }
.ttbl tr:nth-child(even) td { background: #edf1f7 !important; }
.ttbl tr.grand td { background: #1b3057 !important; color: #fff !important; font-weight: 700; font-size: 10pt; }
.sigs { display: flex; justify-content: space-between; padding: 0 10px; margin-top: 40px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 1.5px solid #1b3057; margin-bottom: 4px; }
.sig .lbl { font-size: 8.5pt; color: #666; }
</style></head><body>
<div class="sidebar">
  {{#if companyLogoPath}}<div class="sb-logo"><img src="{{companyLogoPath}}" style="height:55px;max-width:100%"></div>{{/if}}
  <div class="sb-name">{{companyBrandName}}</div>
  <div class="sb-divider"></div>
  <div class="sb-label">Address</div>
  <div class="sb-value">{{{nl2br companyAddress}}}</div>
  <div class="sb-label">Phone</div>
  <div class="sb-value">{{{nl2br companyPhone}}}</div>
  {{#if companyNTN}}<div class="sb-label">NTN</div><div class="sb-value">{{companyNTN}}</div>{{/if}}
  {{#if companySTRN}}<div class="sb-label">STRN</div><div class="sb-value">{{companySTRN}}</div>{{/if}}
  <div class="sb-bottom">
    <div class="sb-divider"></div>
    <div class="sb-value" style="font-size:7.5pt;color:rgba(255,255,255,0.5)">FBR Registered Taxpayer</div>
  </div>
</div>
<div class="content">
  <div class="main">
    <div class="doc-hdr">
      <div class="doc-title">PURCHASE BILL</div>
      <div class="doc-meta"><strong>PB #</strong> {{purchaseBillNumber}}<br><strong>Date:</strong> {{fmtDate date}}{{#if supplierBillNumber}}<br><strong>Supplier Inv #</strong> {{supplierBillNumber}}{{/if}}{{#if supplierIRN}}<br><strong>Supplier IRN:</strong> {{supplierIRN}}{{/if}}</div>
    </div>
    <div class="from-section">
      <div class="from-row">
        <div>
          <div><strong>Vendor:</strong> {{supplierName}}</div>
          {{#if supplierAddress}}<div><strong>Addr:</strong> {{{nl2br supplierAddress}}}</div>{{/if}}
          {{#if supplierPhone}}<div><strong>Phone:</strong> {{supplierPhone}}</div>{{/if}}
        </div>
        <div style="text-align:right;font-size:9.5pt">
          {{#if supplierNTN}}<div>NTN: {{supplierNTN}}</div>{{/if}}
          {{#if supplierSTRN}}<div>GST: {{supplierSTRN}}</div>{{/if}}
        </div>
      </div>
    </div>
    <div class="ref-line">{{#if goodsReceiptNumbers}}GRN # {{join goodsReceiptNumbers}} &nbsp; {{/if}}Payment: {{#if paymentTerms}}{{paymentTerms}}{{else}}&mdash;{{/if}}{{#if dueDate}} &nbsp; (Due {{fmtDate dueDate}}){{/if}}</div>
    <table class="items">
      <thead><tr><th style="width:28px">S#</th><th class="l">Description</th><th style="width:44px">Qty</th><th style="width:42px">UoM</th><th style="width:84px">Unit Price</th><th style="width:90px">Total</th></tr></thead>
      <tbody>
        {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
        {{emptyRows (math 20 "-" items.length) 6}}
      </tbody>
    </table>
    <div class="no-break">
      <div class="totals-layout">
        <div class="words-side"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
        <table class="ttbl">
          <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
          <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
          <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
        </table>
      </div>
    </div>
  </div>
  <div class="footer-sect">
    <div class="sigs">
      <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
      <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
    </div>
  </div>
</div>
</body></html>`,
  },

  // ── 9. Boxed Traditional ─────────────────────────────────────────────────────
  {
    id: "purchasebill-boxed-traditional",
    name: "Boxed Traditional",
    type: "PurchaseBill",
    description: "Every section enclosed in a ruled box — classic Pakistani wholesale purchase voucher look",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; padding: 8mm 10mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; font-size: 9.5pt; }
.main { flex: 1; }
.footer-sect { margin-top: auto; }
.outer-box { border: 2px solid #000; }
.hdr-box { border-bottom: 2px solid #000; display: flex; justify-content: space-between; align-items: stretch; }
.co-area { flex: 1; padding: 8px 12px; border-right: 1.5px solid #000; }
.co-name { font-size: 20pt; font-weight: 800; text-transform: uppercase; }
.co-sub { font-size: 8pt; color: #333; line-height: 1.4; margin-top: 3px; }
.co-tax { font-size: 8pt; margin-top: 2px; }
.doc-area { padding: 8px 12px; text-align: center; display: flex; flex-direction: column; justify-content: center; min-width: 140px; }
.doc-title { font-size: 14pt; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
.doc-num { font-size: 10.5pt; font-weight: 700; margin-top: 3px; border: 1px solid #000; padding: 2px 8px; display: inline-block; }
.doc-date { font-size: 8.5pt; margin-top: 3px; }
.from-box { border-bottom: 1.5px solid #000; display: flex; }
.from-left { flex: 1; padding: 6px 10px; border-right: 1.5px solid #000; line-height: 1.6; }
.from-right { padding: 6px 10px; text-align: right; min-width: 140px; line-height: 1.6; }
.ref-box { border-bottom: 1.5px solid #000; display: flex; }
.ref-cell { flex: 1; padding: 4px 10px; }
.ref-cell:not(:last-child) { border-right: 1px solid #000; }
.ref-lbl { font-size: 7.5pt; text-transform: uppercase; color: #666; font-weight: 700; }
.ref-val { font-size: 9.5pt; font-weight: 600; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #333 !important; color: #fff !important; font-size: 8pt; text-transform: uppercase; padding: 5px 7px; border: 1px solid #333; text-align: center; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #999; padding: 3px 7px; height: 21px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #f4f4f4 !important; }
.totals-box { border-top: 1.5px solid #000; display: flex; justify-content: space-between; align-items: flex-start; padding: 6px 10px; }
.words-block { flex: 1; padding-right: 16px; }
.words-lbl { font-size: 9pt; font-weight: 700; }
.words-val { font-size: 10.5pt; font-weight: 700; margin-top: 4px; }
.ttbl { border-collapse: collapse; border: 1px solid #999; }
.ttbl td { border: 1px solid #999; padding: 3px 10px; }
.ttbl .lbl { font-weight: 700; }
.ttbl .val { text-align: right; min-width: 96px; }
.ttbl tr:nth-child(even) td { background: #f4f4f4 !important; }
.ttbl tr.grand td { background: #333 !important; color: #fff !important; font-weight: 700; font-size: 10pt; }
.sigs { display: flex; justify-content: space-between; padding: 0 30px; margin-top: 40px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 1.5px solid #000; margin-bottom: 4px; }
.sig .lbl { font-size: 8.5pt; color: #444; text-transform: uppercase; }
</style></head><body>
<div class="main">
{{#if companyLogoPath}}<div style="text-align:center;margin-bottom:6px"><img src="{{companyLogoPath}}" style="height:55px"></div>{{/if}}
<div class="outer-box">
  <div class="hdr-box">
    <div class="co-area">
      <div class="co-name">{{companyBrandName}}</div>
      <div class="co-sub">{{{nl2br companyAddress}}}</div>
      <div class="co-sub">{{{nl2br companyPhone}}}</div>
      {{#if companyNTN}}<div class="co-tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;|&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
    </div>
    <div class="doc-area">
      <div class="doc-title">PURCHASE BILL</div>
      <div class="doc-num"># {{purchaseBillNumber}}</div>
      <div class="doc-date">{{fmtDate date}}</div>
    </div>
  </div>
  <div class="from-box">
    <div class="from-left">
      <div><strong>From Messrs (Vendor):</strong> {{supplierName}}</div>
      {{#if supplierAddress}}<div><strong>Address:</strong> {{{nl2br supplierAddress}}}</div>{{/if}}
      {{#if supplierPhone}}<div><strong>Phone:</strong> {{supplierPhone}}</div>{{/if}}
    </div>
    <div class="from-right">
      {{#if supplierNTN}}<div>NTN: {{supplierNTN}}</div>{{/if}}
      {{#if supplierSTRN}}<div>GST: {{supplierSTRN}}</div>{{/if}}
      {{#if divisionName}}<div style="font-size:8.5pt;color:#444">Deliver To: {{divisionName}}</div>{{/if}}
    </div>
  </div>
  <div class="ref-box">
    <div class="ref-cell"><div class="ref-lbl">Supplier Inv #</div><div class="ref-val">{{#if supplierBillNumber}}{{supplierBillNumber}}{{else}}&mdash;{{/if}}</div></div>
    <div class="ref-cell"><div class="ref-lbl">Supplier IRN</div><div class="ref-val">{{#if supplierIRN}}{{supplierIRN}}{{else}}&mdash;{{/if}}</div></div>
    <div class="ref-cell"><div class="ref-lbl">GRN #</div><div class="ref-val">{{#if goodsReceiptNumbers}}{{join goodsReceiptNumbers}}{{else}}&mdash;{{/if}}</div></div>
    <div class="ref-cell"><div class="ref-lbl">Sale Bill Ref</div><div class="ref-val">{{#if linkedSaleBillNumbers}}{{join linkedSaleBillNumbers}}{{else}}&mdash;{{/if}}</div></div>
    <div class="ref-cell"><div class="ref-lbl">Due Date</div><div class="ref-val">{{#if dueDate}}{{fmtDate dueDate}}{{else}}&mdash;{{/if}}</div></div>
  </div>
  <table class="items">
    <thead><tr><th style="width:30px">S#</th><th class="l">Description</th><th style="width:48px">Qty</th><th style="width:44px">UoM</th><th style="width:88px">Unit Price</th><th style="width:92px">Total</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
      {{emptyRows (math 20 "-" items.length) 6}}
    </tbody>
  </table>
  <div class="totals-box no-break">
    <div class="words-block"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div>{{#if paymentTerms}}<div style="font-size:8.5pt;margin-top:4px"><strong>Payment Terms:</strong> {{paymentTerms}}</div>{{/if}}</div>
    <table class="ttbl">
      <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
    </table>
  </div>
</div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Checked By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
</div>
</body></html>`,
  },

  // ── 10. Bismillah Header ─────────────────────────────────────────────────────
  {
    id: "purchasebill-bismillah-header",
    name: "Bismillah Header",
    type: "PurchaseBill",
    description: "Opens with centered Arabic Bismillah calligraphy above the company header — traditional Islamic business stationery",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 8mm 10mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer-sect { margin-top: auto; }
.bismillah { text-align: center; font-size: 20pt; color: #14532d; margin-bottom: 4px; font-family: "Noto Naskh Arabic", "Scheherazade New", "Traditional Arabic", serif; direction: rtl; letter-spacing: 1px; }
.top-rule { border-top: 2px solid #14532d; border-bottom: 1px solid #14532d; padding: 2px 0; margin-bottom: 10px; }
.hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.co-name { font-size: 22pt; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #14532d; }
.co-sub { font-size: 8.5pt; color: #444; margin-top: 3px; line-height: 1.4; }
.co-tax { font-size: 8.5pt; margin-top: 3px; }
.doc-box { text-align: right; }
.doc-title { font-size: 16pt; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; color: #14532d; }
.doc-num { font-size: 11pt; font-weight: 700; border: 1.5px solid #14532d; display: inline-block; padding: 2px 12px; margin-top: 4px; }
.doc-date { font-size: 9pt; color: #555; margin-top: 3px; }
.vendor-ref { font-size: 9pt; font-style: italic; margin-top: 2px; }
.from-row { display: flex; justify-content: space-between; align-items: flex-start; border: 1px solid #ccc; padding: 6px 10px; margin-bottom: 6px; background: #f0fdf4 !important; }
.from-left { font-size: 10.5pt; line-height: 1.7; }
.from-right { font-size: 9.5pt; text-align: right; line-height: 1.6; }
.ref-line { font-size: 10pt; font-weight: 700; font-style: italic; margin-bottom: 6px; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #14532d !important; color: #fff !important; font-size: 8pt; text-transform: uppercase; padding: 5px 8px; border: 1px solid #14532d; text-align: center; letter-spacing: 0.3px; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #bbb; padding: 3px 8px; font-size: 9.5pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #f0fdf4 !important; }
.no-break { page-break-inside: avoid; }
.totals-layout { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; }
.words-side { flex: 1; padding-right: 18px; }
.words-lbl { font-size: 9.5pt; font-weight: 700; color: #14532d; }
.words-val { font-size: 11pt; font-weight: 700; margin-top: 5px; }
.ttbl { border-collapse: collapse; }
.ttbl td { border: 1px solid #bbb; padding: 3px 12px; font-size: 9.5pt; }
.ttbl .lbl { font-weight: 700; }
.ttbl .val { text-align: right; min-width: 100px; }
.ttbl tr:nth-child(even) td { background: #f0fdf4 !important; }
.ttbl tr.grand td { background: #14532d !important; color: #fff !important; font-weight: 700; font-size: 10.5pt; }
.terms { margin-top: 10px; font-size: 8pt; color: #555; line-height: 1.5; border-top: 1px solid #ccc; padding-top: 6px; }
.sigs { display: flex; justify-content: space-between; padding: 0 30px; margin-top: 36px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1.5px solid #14532d; margin-bottom: 4px; }
.sig .lbl { font-size: 8.5pt; color: #555; }
.bot-rule { border-top: 2px solid #14532d; margin-top: 8px; }
</style></head><body>
<div class="main">
<div class="bismillah">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>
<div class="top-rule"></div>
<div class="hdr">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:55px;display:block;margin-bottom:5px">{{/if}}
    <div class="co-name">{{companyBrandName}}</div>
    <div class="co-sub">{{{nl2br companyAddress}}}</div>
    <div class="co-sub">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="co-tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;|&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="doc-box">
    <div class="doc-title">PURCHASE BILL</div>
    <div class="doc-num">PB # {{purchaseBillNumber}}</div>
    <div class="doc-date">{{fmtDate date}}</div>
    {{#if supplierBillNumber}}<div class="vendor-ref">Supplier Inv # {{supplierBillNumber}}</div>{{/if}}
    {{#if supplierIRN}}<div class="vendor-ref">Supplier IRN: {{supplierIRN}}</div>{{/if}}
  </div>
</div>
<div class="from-row">
  <div class="from-left">
    <div><strong>From Messrs (Vendor):</strong> {{supplierName}}</div>
    {{#if supplierAddress}}<div><strong>Address:</strong> {{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div><strong>Phone:</strong> {{supplierPhone}}</div>{{/if}}
  </div>
  <div class="from-right">
    {{#if supplierNTN}}<div>NTN: {{supplierNTN}}</div>{{/if}}
    {{#if supplierSTRN}}<div>GST: {{supplierSTRN}}</div>{{/if}}
  </div>
</div>
<div class="ref-line">{{#if goodsReceiptNumbers}}GRN # {{join goodsReceiptNumbers}} &nbsp; {{/if}}Payment: {{#if paymentTerms}}{{paymentTerms}}{{else}}&mdash;{{/if}}{{#if dueDate}} &nbsp; Due Date: {{fmtDate dueDate}}{{/if}}</div>
<table class="items">
  <thead><tr><th style="width:30px">S#</th><th class="l">Description</th><th style="width:48px">Qty</th><th style="width:44px">UoM</th><th style="width:88px">Unit Price</th><th style="width:94px">Total</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
    {{emptyRows (math 20 "-" items.length) 6}}
  </tbody>
</table>
<div class="no-break">
  <div class="totals-layout">
    <div class="words-side"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
    <table class="ttbl">
      <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
    </table>
  </div>
  <div class="terms"><strong>Note:</strong> Goods received against this purchase bill have been checked and taken into stock. Input tax claimed as per Sales Tax Act 1990. JazakAllah for your service.</div>
</div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
  <div class="bot-rule"></div>
</div>
</body></html>`,
  },

  // ── 11. Green & Gold ─────────────────────────────────────────────────────────
  {
    id: "purchasebill-green-gold",
    name: "Green & Gold",
    type: "PurchaseBill",
    description: "Forest green header with gold accents — popular palette for Pakistani textile traders",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #111; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; padding: 0 10mm 6mm; }
.footer-sect { margin-top: auto; padding: 0 10mm 8mm; }
.top-band { background: #166534 !important; padding: 8mm 10mm 6mm; display: flex; justify-content: space-between; align-items: center; }
.co-name { font-size: 22pt; font-weight: 800; color: #fef08a; text-transform: uppercase; letter-spacing: 1px; }
.co-sub { font-size: 8.5pt; color: rgba(255,255,255,0.78); margin-top: 3px; line-height: 1.4; }
.co-tax { font-size: 8.5pt; color: #fef08a; margin-top: 3px; }
.doc-right { text-align: right; }
.doc-title { font-size: 18pt; font-weight: 900; color: #fef08a; text-transform: uppercase; letter-spacing: 2px; }
.doc-meta { font-size: 9pt; color: rgba(255,255,255,0.85); margin-top: 4px; line-height: 1.6; }
.gold-line { height: 4px; background: #ca8a04 !important; }
.info-bar { display: flex; gap: 0; margin: 10px 0; border: 1px solid #d4d4aa; }
.info-cell { flex: 1; padding: 6px 12px; }
.info-cell:not(:last-child) { border-right: 1px solid #d4d4aa; }
.info-lbl { font-size: 7.5pt; text-transform: uppercase; color: #6b6b3a; font-weight: 700; letter-spacing: 0.5px; }
.info-val { font-size: 10pt; font-weight: 600; color: #111; margin-top: 2px; }
.info-sub { font-size: 8.5pt; color: #555; margin-top: 1px; }
table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
table.items th { background: #166534 !important; color: #fef08a !important; font-size: 8pt; text-transform: uppercase; padding: 5px 8px; border: 1px solid #166534; text-align: center; letter-spacing: 0.3px; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #c8c8a0; padding: 3px 8px; font-size: 9.5pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #f7f7e8 !important; }
.no-break { page-break-inside: avoid; }
.totals-layout { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; }
.words-side { flex: 1; padding-right: 18px; }
.words-lbl { font-size: 9pt; font-weight: 700; color: #166534; }
.words-val { font-size: 11pt; font-weight: 700; margin-top: 5px; }
.ttbl { border-collapse: collapse; }
.ttbl td { border: 1px solid #c8c8a0; padding: 3px 12px; font-size: 9.5pt; }
.ttbl .lbl { font-weight: 700; }
.ttbl .val { text-align: right; min-width: 100px; }
.ttbl tr:nth-child(even) td { background: #f7f7e8 !important; }
.ttbl tr.grand td { background: #166534 !important; color: #fef08a !important; font-weight: 800; font-size: 10.5pt; }
.pay-section { margin-top: 10px; border-top: 1px solid #d4d4aa; padding-top: 6px; font-size: 8.5pt; color: #555; }
.pay-title { font-weight: 700; color: #166534; margin-bottom: 3px; font-size: 9pt; }
.pay-row { display: flex; gap: 20px; }
.sigs { display: flex; justify-content: space-between; padding: 0 30px; margin-top: 36px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #166534; margin-bottom: 4px; }
.sig .lbl { font-size: 8.5pt; color: #555; }
.bot-band { height: 6px; background: linear-gradient(90deg, #166534, #ca8a04) !important; margin-top: 8px; }
</style></head><body>
<div class="top-band">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:52px;display:block;margin-bottom:5px">{{/if}}
    <div class="co-name">{{companyBrandName}}</div>
    <div class="co-sub">{{{nl2br companyAddress}}}</div>
    <div class="co-sub">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="co-tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;|&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="doc-right">
    <div class="doc-title">PURCHASE BILL</div>
    <div class="doc-meta">PB # {{purchaseBillNumber}}<br>Date: {{fmtDate date}}{{#if goodsReceiptNumbers}}<br>GRN # {{join goodsReceiptNumbers}}{{/if}}</div>
  </div>
</div>
<div class="gold-line"></div>
<div class="main">
  <div class="info-bar">
    <div class="info-cell"><div class="info-lbl">Vendor</div><div class="info-val">{{supplierName}}</div>{{#if supplierNTN}}<div class="info-sub">NTN: {{supplierNTN}}</div>{{/if}}{{#if supplierSTRN}}<div class="info-sub">GST: {{supplierSTRN}}</div>{{/if}}</div>
    <div class="info-cell"><div class="info-lbl">Vendor Address</div><div class="info-val" style="font-size:9pt">{{{nl2br supplierAddress}}}</div>{{#if supplierPhone}}<div class="info-sub">{{supplierPhone}}</div>{{/if}}</div>
    <div class="info-cell"><div class="info-lbl">Supplier Inv #</div><div class="info-val">{{#if supplierBillNumber}}{{supplierBillNumber}}{{else}}&mdash;{{/if}}</div>{{#if supplierIRN}}<div class="info-sub">IRN: {{supplierIRN}}</div>{{/if}}</div>
  </div>
  <table class="items">
    <thead><tr><th style="width:30px">S#</th><th class="l">Description</th><th style="width:48px">Qty</th><th style="width:44px">UoM</th><th style="width:88px">Unit Price</th><th style="width:94px">Total</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
      {{emptyRows (math 20 "-" items.length) 6}}
    </tbody>
  </table>
  <div class="no-break">
    <div class="totals-layout">
      <div class="words-side"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
      <table class="ttbl">
        <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
        <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
        <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
      </table>
    </div>
    <div class="pay-section">
      <div class="pay-title">Payment Details:</div>
      <div class="pay-row">
        <span><strong>Terms:</strong> {{#if paymentTerms}}{{paymentTerms}}{{else}}As agreed with vendor{{/if}}</span>
        {{#if dueDate}}<span><strong>Due Date:</strong> {{fmtDate dueDate}}</span>{{/if}}
        {{#if linkedSaleBillNumbers}}<span><strong>Linked Sale Bill #:</strong> {{join linkedSaleBillNumbers}}</span>{{/if}}
      </div>
    </div>
  </div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
</div>
<div class="bot-band"></div>
</body></html>`,
  },

  // ── 12. Teal / Slate ─────────────────────────────────────────────────────────
  {
    id: "purchasebill-teal-slate",
    name: "Teal / Slate",
    type: "PurchaseBill",
    description: "Teal header with slate-grey accents; clean card layout and rounded info pills",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Calibri, Arial, sans-serif; color: #1e293b; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; padding: 0 10mm 6mm; }
.footer-sect { margin-top: auto; padding: 0 10mm 8mm; }
.hdr-band { background: #0d9488 !important; padding: 7mm 10mm 5mm; display: flex; justify-content: space-between; align-items: center; }
.co-name { font-size: 22pt; font-weight: 700; color: #fff; letter-spacing: 0.5px; }
.co-sub { font-size: 8.5pt; color: rgba(255,255,255,0.78); margin-top: 4px; line-height: 1.4; }
.co-tax { font-size: 8.5pt; color: rgba(255,255,255,0.9); margin-top: 3px; }
.doc-right { text-align: right; }
.doc-title { font-size: 18pt; font-weight: 800; color: #fff; text-transform: uppercase; letter-spacing: 2px; }
.doc-chip { display: inline-block; background: rgba(255,255,255,0.15) !important; color: #fff; border: 1px solid rgba(255,255,255,0.4); padding: 3px 14px; border-radius: 20px; font-size: 9pt; margin-top: 4px; }
.slate-rule { height: 3px; background: #475569 !important; }
.party-row { display: flex; gap: 12px; margin: 10px 0; }
.party-card { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; border-left: 3px solid #0d9488; }
.pc-lbl { font-size: 7.5pt; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 3px; }
.pc-val { font-size: 10.5pt; font-weight: 600; }
.pc-sub { font-size: 8.5pt; color: #64748b; margin-top: 2px; }
table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
table.items th { background: #475569 !important; color: #fff !important; font-size: 7.5pt; text-transform: uppercase; padding: 5px 8px; border: 1px solid #475569; text-align: center; letter-spacing: 0.3px; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #e2e8f0; padding: 3px 8px; font-size: 9.5pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #f0fdfa !important; }
.no-break { page-break-inside: avoid; }
.totals-layout { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; }
.words-side { flex: 1; padding-right: 18px; }
.words-lbl { font-size: 9pt; font-weight: 700; color: #0d9488; }
.words-val { font-size: 11pt; font-weight: 700; margin-top: 5px; }
.ttbl { border-collapse: collapse; }
.ttbl td { border: 1px solid #e2e8f0; padding: 3px 12px; font-size: 9.5pt; }
.ttbl .lbl { font-weight: 700; color: #475569; }
.ttbl .val { text-align: right; min-width: 100px; }
.ttbl tr:nth-child(even) td { background: #f0fdfa !important; }
.ttbl tr.grand td { background: #0d9488 !important; color: #fff !important; font-weight: 700; font-size: 10.5pt; }
.sigs { display: flex; justify-content: space-between; padding: 0 30px; margin-top: 40px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #0d9488; margin-bottom: 4px; }
.sig .lbl { font-size: 8.5pt; color: #64748b; }
.bot-slate { height: 5px; background: #475569 !important; margin-top: 8px; }
</style></head><body>
<div class="hdr-band">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:52px;display:block;margin-bottom:5px">{{/if}}
    <div class="co-name">{{companyBrandName}}</div>
    <div class="co-sub">{{{nl2br companyAddress}}}</div>
    <div class="co-sub">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="co-tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;|&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="doc-right">
    <div class="doc-title">PURCHASE BILL</div>
    <div class="doc-chip">No. {{purchaseBillNumber}}</div><br>
    <div class="doc-chip">{{fmtDate date}}</div>
    {{#if goodsReceiptNumbers}}<br><div class="doc-chip">GRN # {{join goodsReceiptNumbers}}</div>{{/if}}
  </div>
</div>
<div class="slate-rule"></div>
<div class="main">
  <div class="party-row">
    <div class="party-card">
      <div class="pc-lbl">Vendor / From</div>
      <div class="pc-val">{{supplierName}}</div>
      {{#if supplierAddress}}<div class="pc-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
      {{#if supplierPhone}}<div class="pc-sub">{{supplierPhone}}</div>{{/if}}
      {{#if supplierNTN}}<div class="pc-sub">NTN: {{supplierNTN}}</div>{{/if}}
      {{#if supplierSTRN}}<div class="pc-sub">GST: {{supplierSTRN}}</div>{{/if}}
    </div>
    <div class="party-card">
      <div class="pc-lbl">Supplier Invoice</div>
      <div class="pc-val">{{#if supplierBillNumber}}{{supplierBillNumber}}{{else}}&mdash;{{/if}}</div>
      {{#if supplierIRN}}<div class="pc-sub">Supplier IRN: {{supplierIRN}}</div>{{/if}}
    </div>
    <div class="party-card">
      <div class="pc-lbl">Payment Terms</div>
      <div class="pc-val">{{#if paymentTerms}}{{paymentTerms}}{{else}}As Agreed{{/if}}</div>
      {{#if dueDate}}<div class="pc-sub">Due {{fmtDate dueDate}}</div>{{/if}}
    </div>
  </div>
  <table class="items">
    <thead><tr><th style="width:30px">S#</th><th class="l">Description</th><th style="width:48px">Qty</th><th style="width:44px">UoM</th><th style="width:88px">Unit Price</th><th style="width:94px">Total</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
      {{emptyRows (math 20 "-" items.length) 6}}
    </tbody>
  </table>
  <div class="no-break">
    <div class="totals-layout">
      <div class="words-side"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
      <table class="ttbl">
        <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
        <tr><td class="lbl">GST (Input Tax) {{gstRate}}%</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
        <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
      </table>
    </div>
  </div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
</div>
<div class="bot-slate"></div>
</body></html>`,
  },

  // ── 13. Big Letterhead ───────────────────────────────────────────────────────
  {
    id: "purchasebill-big-letterhead",
    name: "Big Letterhead",
    type: "PurchaseBill",
    description: "Large centred logo + company name letterhead at top, then purchase bill content below — for branded stationery",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 8mm 10mm; color: #111; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer-sect { margin-top: auto; }
.letterhead { text-align: center; padding-bottom: 10px; border-bottom: 2.5px solid #1e40af; margin-bottom: 12px; }
.lh-logo { margin-bottom: 6px; }
.lh-name { font-size: 28pt; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; color: #1e40af; }
.lh-addr { font-size: 9pt; color: #444; margin-top: 3px; line-height: 1.5; }
.lh-tax { font-size: 9pt; color: #333; margin-top: 2px; font-weight: 700; }
.doc-strip { display: flex; justify-content: space-between; align-items: center; background: #1e40af !important; color: #fff; padding: 5px 12px; border-radius: 4px; margin-bottom: 10px; }
.ds-title { font-size: 14pt; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; }
.ds-meta { font-size: 9.5pt; text-align: right; line-height: 1.6; }
.from-section { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; padding: 6px 10px; border: 1px solid #dde3ea; background: #f8fafc !important; }
.from-left { font-size: 10pt; line-height: 1.7; }
.from-right { font-size: 9.5pt; text-align: right; line-height: 1.6; color: #444; }
.ref-line { font-size: 10pt; font-weight: 700; font-style: italic; margin-bottom: 6px; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #1e40af !important; color: #fff !important; font-size: 8pt; text-transform: uppercase; padding: 5px 8px; border: 1px solid #1e40af; text-align: center; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #cbd5e1; padding: 3px 8px; font-size: 9.5pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #eff6ff !important; }
.no-break { page-break-inside: avoid; }
.totals-layout { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; }
.words-side { flex: 1; padding-right: 18px; }
.words-lbl { font-size: 9pt; font-weight: 700; color: #1e40af; }
.words-val { font-size: 11pt; font-weight: 700; margin-top: 5px; }
.ttbl { border-collapse: collapse; }
.ttbl td { border: 1px solid #cbd5e1; padding: 3px 12px; font-size: 9.5pt; }
.ttbl .lbl { font-weight: 700; }
.ttbl .val { text-align: right; min-width: 100px; }
.ttbl tr:nth-child(even) td { background: #eff6ff !important; }
.ttbl tr.grand td { background: #1e40af !important; color: #fff !important; font-weight: 700; font-size: 10.5pt; }
.terms { margin-top: 10px; font-size: 8pt; color: #555; line-height: 1.5; }
.sigs { display: flex; justify-content: space-between; padding: 0 30px; margin-top: 40px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #1e40af; margin-bottom: 4px; }
.sig .lbl { font-size: 8.5pt; color: #555; }
.bot-line { border-top: 2.5px solid #1e40af; margin-top: 8px; }
</style></head><body>
<div class="main">
<div class="letterhead">
  {{#if companyLogoPath}}<div class="lh-logo"><img src="{{companyLogoPath}}" style="height:68px"></div>{{/if}}
  <div class="lh-name">{{companyBrandName}}</div>
  <div class="lh-addr">{{{nl2br companyAddress}}} &nbsp;&bull;&nbsp; {{{nl2br companyPhone}}}</div>
  {{#if companyNTN}}<div class="lh-tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;&bull;&nbsp; STRN / GST: {{companySTRN}}{{/if}}</div>{{/if}}
</div>
<div class="doc-strip">
  <div class="ds-title">PURCHASE BILL</div>
  <div class="ds-meta">PB # {{purchaseBillNumber}} &nbsp;|&nbsp; {{fmtDate date}}{{#if goodsReceiptNumbers}} &nbsp;|&nbsp; GRN # {{join goodsReceiptNumbers}}{{/if}}</div>
</div>
<div class="from-section">
  <div class="from-left">
    <div><strong>From Messrs (Vendor):</strong> {{supplierName}}</div>
    {{#if supplierAddress}}<div><strong>Address:</strong> {{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div><strong>Phone:</strong> {{supplierPhone}}</div>{{/if}}
  </div>
  <div class="from-right">
    {{#if supplierNTN}}<div>NTN: {{supplierNTN}}</div>{{/if}}
    {{#if supplierSTRN}}<div>GST: {{supplierSTRN}}</div>{{/if}}
    {{#if divisionName}}<div>Deliver To: {{divisionName}}</div>{{/if}}
  </div>
</div>
<div class="ref-line">Supplier Inv #: {{#if supplierBillNumber}}{{supplierBillNumber}}{{else}}&mdash;{{/if}}{{#if supplierIRN}} &nbsp; Supplier IRN: {{supplierIRN}}{{/if}}</div>
<table class="items">
  <thead><tr><th style="width:30px">S#</th><th class="l">Description</th><th style="width:48px">Qty</th><th style="width:44px">UoM</th><th style="width:88px">Unit Price</th><th style="width:94px">Total</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
    {{emptyRows (math 20 "-" items.length) 6}}
  </tbody>
</table>
<div class="no-break">
  <div class="totals-layout">
    <div class="words-side"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
    <table class="ttbl">
      <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
    </table>
  </div>
  <div class="terms"><strong>Payment:</strong> {{#if paymentTerms}}{{paymentTerms}}{{else}}As agreed with vendor.{{/if}}{{#if dueDate}} Due by {{fmtDate dueDate}}.{{/if}} Input tax claimed against supplier invoice as per Sales Tax Act 1990.</div>
</div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
  <div class="bot-line"></div>
</div>
</body></html>`,
  },

  // ── 14. Centered / Watermark Title ───────────────────────────────────────────
  {
    id: "purchasebill-centered-watermark",
    name: "Centered / Watermark Title",
    type: "PurchaseBill",
    description: "Large faded PURCHASE watermark behind the table; centred company header block",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 8mm 10mm; color: #111; display: flex; flex-direction: column; min-height: 100vh; position: relative; }
.watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-25deg); font-size: 64pt; font-weight: 900; color: rgba(30,64,175,0.06) !important; text-transform: uppercase; letter-spacing: 8px; pointer-events: none; white-space: nowrap; z-index: 0; }
.main { flex: 1; position: relative; z-index: 1; }
.footer-sect { margin-top: auto; position: relative; z-index: 1; }
.hdr { text-align: center; border-bottom: 2px solid #1e40af; padding-bottom: 10px; margin-bottom: 12px; }
.hdr-logo { margin-bottom: 5px; }
.hdr-name { font-size: 24pt; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #1e40af; }
.hdr-sub { font-size: 8.5pt; color: #555; margin-top: 3px; line-height: 1.5; }
.hdr-tax { font-size: 9pt; font-weight: 700; margin-top: 3px; }
.doc-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.doc-title { font-size: 17pt; font-weight: 900; text-transform: uppercase; letter-spacing: 3px; color: #1e40af; text-decoration: underline; text-underline-offset: 4px; }
.doc-meta { font-size: 9.5pt; text-align: right; line-height: 1.6; color: #333; }
.from-section { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; padding: 5px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }
.from-left { font-size: 10pt; line-height: 1.7; }
.from-right { font-size: 9.5pt; text-align: right; color: #444; line-height: 1.6; }
.ref-line { font-size: 10pt; font-weight: 700; font-style: italic; margin-bottom: 6px; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #1e40af !important; color: #fff !important; font-size: 8pt; text-transform: uppercase; padding: 5px 8px; border: 1px solid #1e40af; text-align: center; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #cbd5e1; padding: 3px 8px; font-size: 9.5pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #eff6ff !important; }
.no-break { page-break-inside: avoid; }
.totals-layout { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4px; }
.words-side { flex: 1; padding-right: 18px; }
.words-lbl { font-size: 9pt; font-weight: 700; color: #1e40af; }
.words-val { font-size: 11pt; font-weight: 700; margin-top: 5px; }
.ttbl { border-collapse: collapse; }
.ttbl td { border: 1px solid #cbd5e1; padding: 3px 12px; font-size: 9.5pt; }
.ttbl .lbl { font-weight: 700; }
.ttbl .val { text-align: right; min-width: 100px; }
.ttbl tr:nth-child(even) td { background: #eff6ff !important; }
.ttbl tr.grand td { background: #1e40af !important; color: #fff !important; font-weight: 700; font-size: 10.5pt; }
.sigs { display: flex; justify-content: space-between; padding: 0 30px; margin-top: 44px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #1e40af; margin-bottom: 4px; }
.sig .lbl { font-size: 8.5pt; color: #555; }
.bot-line { border-top: 2px solid #1e40af; margin-top: 8px; }
</style></head><body>
<div class="watermark">PURCHASE</div>
<div class="main">
<div class="hdr">
  {{#if companyLogoPath}}<div class="hdr-logo"><img src="{{companyLogoPath}}" style="height:60px"></div>{{/if}}
  <div class="hdr-name">{{companyBrandName}}</div>
  <div class="hdr-sub">{{{nl2br companyAddress}}} &nbsp;&bull;&nbsp; {{{nl2br companyPhone}}}</div>
  {{#if companyNTN}}<div class="hdr-tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;&bull;&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
</div>
<div class="doc-bar">
  <div class="doc-title">PURCHASE BILL</div>
  <div class="doc-meta"><strong>PB #:</strong> {{purchaseBillNumber}}<br><strong>Date:</strong> {{fmtDate date}}{{#if goodsReceiptNumbers}}<br><strong>GRN #:</strong> {{join goodsReceiptNumbers}}{{/if}}</div>
</div>
<div class="from-section">
  <div class="from-left">
    <div><strong>From Messrs (Vendor):</strong> {{supplierName}}</div>
    {{#if supplierAddress}}<div>{{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div>{{supplierPhone}}</div>{{/if}}
  </div>
  <div class="from-right">
    {{#if supplierNTN}}<div>NTN: {{supplierNTN}}</div>{{/if}}
    {{#if supplierSTRN}}<div>GST: {{supplierSTRN}}</div>{{/if}}
  </div>
</div>
<div class="ref-line">Supplier Inv #: {{#if supplierBillNumber}}{{supplierBillNumber}}{{else}}&mdash;{{/if}}{{#if supplierIRN}} &nbsp; IRN: {{supplierIRN}}{{/if}}{{#if paymentTerms}} &nbsp; Terms: {{paymentTerms}}{{/if}}{{#if dueDate}} &nbsp; Due: {{fmtDate dueDate}}{{/if}}</div>
<table class="items">
  <thead><tr><th style="width:30px">S#</th><th class="l">Description</th><th style="width:48px">Qty</th><th style="width:44px">UoM</th><th style="width:88px">Unit Price</th><th style="width:94px">Total</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
    {{emptyRows (math 20 "-" items.length) 6}}
  </tbody>
</table>
<div class="no-break">
  <div class="totals-layout">
    <div class="words-side"><div class="words-lbl">Amount In Words:</div><div class="words-val">{{amountInWords}}</div></div>
    <table class="ttbl">
      <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
      <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
      <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
    </table>
  </div>
</div>
</div>
<div class="footer-sect">
  <div class="sigs">
    <div class="sig"><div class="line"></div><div class="lbl">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="lbl">Approved By</div></div>
  </div>
  <div class="bot-line"></div>
</div>
</body></html>`,
  },

  // ── 15. Government-Form Grid ─────────────────────────────────────────────────
  {
    id: "purchasebill-govt-form-grid",
    name: "Government-Form Grid",
    type: "PurchaseBill",
    description: "Heavy grid with labelled cell blocks mimicking official Pakistani government printed forms",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Purchase Bill #{{purchaseBillNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } thead { display: table-header-group; } .no-break { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, Helvetica, sans-serif; padding: 8mm 10mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; font-size: 9pt; }
.main { flex: 1; }
.footer-sect { margin-top: auto; }
.form-outer { border: 2px solid #000; }
.form-title-row { background: #1a1a1a !important; color: #fff; text-align: center; padding: 6px 0; font-size: 13pt; font-weight: 900; text-transform: uppercase; letter-spacing: 3px; border-bottom: 2px solid #000; }
.form-sub-row { text-align: center; font-size: 7.5pt; padding: 3px 0; border-bottom: 2px solid #000; color: #333; }
.form-hdr { display: flex; border-bottom: 2px solid #000; }
.fh-co { flex: 1; padding: 6px 10px; border-right: 2px solid #000; }
.fh-co .co-name { font-size: 16pt; font-weight: 900; text-transform: uppercase; }
.fh-co .co-sub { font-size: 7.5pt; line-height: 1.4; margin-top: 2px; color: #333; }
.fh-co .co-tax { font-size: 7.5pt; margin-top: 2px; font-weight: 700; }
.fh-doc { min-width: 130px; padding: 6px 10px; text-align: center; }
.fh-doc .fd-lbl { font-size: 7pt; text-transform: uppercase; font-weight: 700; color: #555; }
.fh-doc .fd-num { font-size: 12pt; font-weight: 900; border: 1.5px solid #000; padding: 2px 8px; display: inline-block; margin: 3px 0; }
.fh-doc .fd-date { font-size: 8pt; }
.grid-row { display: flex; border-bottom: 1.5px solid #000; }
.grid-cell { padding: 4px 8px; }
.grid-cell:not(:last-child) { border-right: 1.5px solid #000; }
.gc-lbl { font-size: 6.5pt; text-transform: uppercase; font-weight: 900; color: #555; letter-spacing: 0.3px; }
.gc-val { font-size: 9pt; font-weight: 600; margin-top: 1px; }
.gc-sub { font-size: 7.5pt; color: #444; margin-top: 1px; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #1a1a1a !important; color: #fff !important; font-size: 7.5pt; text-transform: uppercase; padding: 4px 6px; border: 1.5px solid #1a1a1a; text-align: center; letter-spacing: 0.3px; font-weight: 900; }
table.items th.l { text-align: left; }
.cell { border: 1px solid #888; padding: 2px 6px; font-size: 8.5pt; height: 19px; }
.c { text-align: center; } .r { text-align: right; }
table.items tbody tr:nth-child(even) td { background: #f2f2f2 !important; }
.totals-section { border-top: 2px solid #000; display: flex; justify-content: space-between; align-items: stretch; }
.words-col { flex: 1; padding: 6px 10px; border-right: 2px solid #000; }
.words-lbl { font-size: 7.5pt; text-transform: uppercase; font-weight: 900; color: #555; }
.words-val { font-size: 9.5pt; font-weight: 700; margin-top: 4px; }
.totals-col { padding: 0; }
.ttbl { border-collapse: collapse; height: 100%; }
.ttbl td { border: 1px solid #888; padding: 3px 10px; font-size: 8.5pt; }
.ttbl .lbl { font-weight: 700; text-transform: uppercase; white-space: nowrap; background: #f2f2f2 !important; }
.ttbl .val { text-align: right; min-width: 96px; }
.ttbl tr.grand td { font-weight: 900; font-size: 9.5pt; border: 2px solid #000; background: #1a1a1a !important; color: #fff !important; }
.sig-row { border-top: 2px solid #000; display: flex; }
.sig-cell { flex: 1; padding: 28px 10px 6px; text-align: center; font-size: 7.5pt; text-transform: uppercase; font-weight: 700; }
.sig-cell:not(:last-child) { border-right: 2px solid #000; }
</style></head><body>
<div class="main">
{{#if companyLogoPath}}<div style="text-align:center;margin-bottom:4px"><img src="{{companyLogoPath}}" style="height:50px"></div>{{/if}}
<div class="form-outer">
  <div class="form-title-row">PURCHASE BILL / VOUCHER</div>
  <div class="form-sub-row">Input tax adjustable as applicable under the Sales Tax Act 1990</div>
  <div class="form-hdr">
    <div class="fh-co">
      <div class="co-name">{{companyBrandName}}</div>
      <div class="co-sub">{{{nl2br companyAddress}}}</div>
      <div class="co-sub">{{{nl2br companyPhone}}}</div>
      {{#if companyNTN}}<div class="co-tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;&bull;&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
    </div>
    <div class="fh-doc">
      <div class="fd-lbl">PB No.</div>
      <div class="fd-num">{{purchaseBillNumber}}</div>
      <div class="fd-lbl">Date</div>
      <div class="fd-date">{{fmtDate date}}</div>
      {{#if goodsReceiptNumbers}}<div class="fd-lbl" style="margin-top:4px">GRN #</div><div class="fd-date">{{join goodsReceiptNumbers}}</div>{{/if}}
    </div>
  </div>
  <div class="grid-row">
    <div class="grid-cell" style="flex:2"><div class="gc-lbl">Vendor (Messrs)</div><div class="gc-val">{{supplierName}}</div>{{#if supplierPhone}}<div class="gc-sub">Ph: {{supplierPhone}}</div>{{/if}}</div>
    <div class="grid-cell" style="flex:2"><div class="gc-lbl">Vendor Address</div><div class="gc-val" style="font-size:8.5pt">{{{nl2br supplierAddress}}}</div></div>
    <div class="grid-cell" style="flex:1"><div class="gc-lbl">NTN</div><div class="gc-val">{{#if supplierNTN}}{{supplierNTN}}{{else}}&mdash;{{/if}}</div><div class="gc-lbl" style="margin-top:4px">GST / STRN</div><div class="gc-val">{{#if supplierSTRN}}{{supplierSTRN}}{{else}}&mdash;{{/if}}</div></div>
  </div>
  <div class="grid-row">
    <div class="grid-cell" style="flex:1"><div class="gc-lbl">Supplier Inv #</div><div class="gc-val">{{#if supplierBillNumber}}{{supplierBillNumber}}{{else}}&mdash;{{/if}}</div></div>
    <div class="grid-cell" style="flex:1"><div class="gc-lbl">Supplier IRN</div><div class="gc-val" style="font-size:8pt">{{#if supplierIRN}}{{supplierIRN}}{{else}}&mdash;{{/if}}</div></div>
    <div class="grid-cell" style="flex:1"><div class="gc-lbl">Payment Terms</div><div class="gc-val">{{#if paymentTerms}}{{paymentTerms}}{{else}}&mdash;{{/if}}</div></div>
    <div class="grid-cell" style="flex:1"><div class="gc-lbl">Due Date</div><div class="gc-val">{{#if dueDate}}{{fmtDate dueDate}}{{else}}&mdash;{{/if}}</div></div>
  </div>
  <table class="items">
    <thead><tr><th style="width:28px">S#</th><th class="l">Item Type</th><th class="l">Description</th><th style="width:44px">Qty</th><th style="width:40px">UoM</th><th style="width:84px">Unit Price</th><th style="width:90px">Total</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c">{{this.sNo}}</td><td class="cell">{{this.itemTypeName}}{{#if this.hsCode}}<div style="font-size:7pt;color:#555">HS {{this.hsCode}}</div>{{/if}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.quantity}}</td><td class="cell c">{{this.uom}}</td><td class="cell r">Rs {{fmt this.unitPrice}}</td><td class="cell r">Rs {{fmt this.lineTotal}}</td></tr>{{/each}}
      {{emptyRows (math 18 "-" items.length) 7}}
    </tbody>
  </table>
  <div class="totals-section no-break">
    <div class="words-col">
      <div class="words-lbl">Amount In Words</div>
      <div class="words-val">{{amountInWords}}</div>
      {{#if linkedSaleBillNumbers}}<div class="gc-sub" style="margin-top:4px">Linked Sale Bill #: {{join linkedSaleBillNumbers}}</div>{{/if}}
    </div>
    <div class="totals-col">
      <table class="ttbl">
        <tr><td class="lbl">Sub Total</td><td class="val">Rs {{fmt subtotal}}</td></tr>
        <tr><td class="lbl">GST ({{gstRate}}%)</td><td class="val">Rs {{fmt gstAmount}}</td></tr>
        <tr class="grand"><td class="lbl">Grand Total</td><td class="val">Rs {{fmt grandTotal}}</td></tr>
      </table>
    </div>
  </div>
  <div class="sig-row">
    <div class="sig-cell">Prepared By</div>
    <div class="sig-cell">Checked By</div>
    <div class="sig-cell">Approved By</div>
  </div>
</div>
</div>
</body></html>`,
  },
];
