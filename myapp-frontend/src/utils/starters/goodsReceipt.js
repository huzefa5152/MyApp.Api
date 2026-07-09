/**
 * Goods Receipt Note (GRN) starter templates — 15 distinct visual archetypes.
 * All templates are A4 print-ready, Handlebars-powered, quantity-only (no prices).
 * Merge fields: companyBrandName, companyLogoPath, companyAddress, companyPhone,
 * supplierName, supplierAddress, supplierPhone, goodsReceiptNumber, receiptDate,
 * supplierChallanNumber, purchaseBillNumber, site, status,
 * items[] (sNo, itemTypeName, description, quantity, unit).
 * Use only registered helpers: fmtDate, fmt, fmtDec, nl2br, richText, join,
 * joinDates, emptyRows, math, inc, eq, gt, or, #each, #if.
 */

export const goodsReceiptStarters = [

  // ─── 1. Classic Serif (double-border header) ────────────────────────────────
  {
    id: "goodsreceipt-classic-serif",
    name: "Classic Serif",
    type: "GoodsReceipt",
    description: "Traditional Times New Roman layout with double-rule header border and item type column",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 12mm; color: #000; font-size: 12pt; }
.outer-border { border: 2px solid #000; padding: 10px; }
.inner-border { border: 1px solid #000; padding: 10px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #333; padding-bottom: 14px; margin-bottom: 14px; }
.brand { font-size: 30px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; }
.addr { font-size: 10px; color: #333; margin-top: 4px; line-height: 1.5; }
.logo-wrap { margin-bottom: 6px; }
.grn-block { text-align: right; }
.grn-title { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 6px; }
.grn-num { font-size: 22px; font-weight: 900; }
.grn-date { font-size: 12px; margin-top: 4px; }
.info { margin: 10px 0 14px; font-size: 12pt; line-height: 1.8; }
.info b { font-weight: 700; min-width: 130px; display: inline-block; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th { background: #2c3e50 !important; color: #fff !important; font-family: "Times New Roman", serif; font-size: 11px; text-transform: uppercase; padding: 6px 10px; border: 1px solid #2c3e50; letter-spacing: 1px; }
td { border: 1px solid #999; padding: 6px 10px; font-size: 12px; height: 26px; }
.c { text-align: center; width: 70px; }
.n { text-align: center; width: 40px; }
.type-col { text-align: center; width: 90px; }
tbody tr:nth-child(even) td { background: #f5f5f5 !important; }
.received { margin-top: 22px; font-size: 11pt; font-style: italic; border-top: 1px solid #999; padding-top: 8px; }
.footer { margin-top: 36px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 170px; border-top: 1.5px solid #333; margin: 0 auto 4px; }
.sig .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="outer-border"><div class="inner-border">
<div class="header">
  <div>
    <div class="logo-wrap">{{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px">{{/if}}</div>
    <div class="brand">{{companyBrandName}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
  </div>
  <div class="grn-block">
    <div class="grn-title">Goods Receipt Note</div>
    <div class="grn-num">GRN # {{goodsReceiptNumber}}</div>
    <div class="grn-date">Date: {{fmtDate receiptDate}}</div>
  </div>
</div>
<div class="info">
  <div><b>Received From:</b> {{supplierName}}</div>
  {{#if supplierAddress}}<div><b>Address:</b> {{{nl2br supplierAddress}}}</div>{{/if}}
  {{#if supplierPhone}}<div><b>Phone:</b> {{supplierPhone}}</div>{{/if}}
  <div><b>Supplier DC #:</b> {{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}{{#if purchaseBillNumber}} &nbsp;&nbsp; <b>Against PB #:</b> {{purchaseBillNumber}}{{/if}}</div>
  {{#if site}}<div><b>Site:</b> {{site}}</div>{{/if}}
</div>
<table>
  <thead><tr><th class="n">S#</th><th class="c">Qty</th><th>Description of Goods</th><th class="type-col">Type</th><th class="c">Unit</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell n">{{inc @index}}</td><td class="cell c">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell type-col">{{#if this.itemTypeName}}{{this.itemTypeName}}{{else}}&mdash;{{/if}}</td><td class="cell c">{{this.unit}}</td></tr>{{/each}}
    {{emptyRows (math 15 "-" items.length) 5}}
  </tbody>
</table>
<div class="received">Received the above goods in good order &amp; condition.</div>
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Checked By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
</div>
</div></div>
</body></html>`,
  },

  // ─── 2. Modern Minimal (accent rule + status pill) ──────────────────────────
  {
    id: "goodsreceipt-modern-minimal",
    name: "Modern Minimal",
    type: "GoodsReceipt",
    description: "Clean sans-serif with a thin gradient accent rule, card info strip and status pill",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 13mm; color: #222; }
.accent-rule { height: 5px; background: linear-gradient(90deg, #1565c0 0%, #26c6da 100%); border-radius: 3px; margin-bottom: 18px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
.brand { font-size: 26px; font-weight: 800; color: #1565c0; letter-spacing: 0.5px; }
.sub { font-size: 10px; color: #666; margin-top: 3px; line-height: 1.5; }
.badge { background: #1565c0 !important; color: #fff !important; padding: 5px 14px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; display: inline-block; }
.grn-num { font-size: 20px; font-weight: 800; color: #1565c0; margin-top: 6px; text-align: right; }
.grn-date { font-size: 11px; color: #777; text-align: right; margin-top: 2px; }
.status-pill { display: inline-block; margin-top: 6px; padding: 3px 12px; border-radius: 10px; background: #fff3e0 !important; color: #e65100; border: 1px solid #ffcc80; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.info-strip { display: flex; gap: 12px; background: #f4f6fb !important; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; }
.info-cell { flex: 1; }
.info-lbl { font-size: 8px; text-transform: uppercase; color: #999; font-weight: 700; letter-spacing: 0.6px; }
.info-val { font-size: 12px; font-weight: 600; margin-top: 2px; color: #1a1a1a; }
.info-sub { font-size: 9px; color: #888; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; }
th { background: #f0f3f8 !important; color: #444; font-size: 9px; text-transform: uppercase; padding: 7px 10px; border-bottom: 2px solid #1565c0; text-align: left; letter-spacing: 0.4px; }
th.c { text-align: center; }
td { padding: 7px 10px; font-size: 12px; border-bottom: 1px solid #edf0f5; }
td.c { text-align: center; }
.n { width: 36px; }
.qty { width: 68px; }
.unit { width: 64px; }
.received { margin-top: 20px; font-size: 10px; color: #555; font-style: italic; border-top: 1px solid #e0e5ef; padding-top: 8px; }
.footer { margin-top: 34px; display: flex; justify-content: space-between; padding: 0 10px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 2px solid #1565c0; margin: 0 auto 4px; }
.sig .label { font-size: 9px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="accent-rule"></div>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:6px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="sub">{{{nl2br companyAddress}}}</div>
    <div class="sub">{{{nl2br companyPhone}}}</div>
  </div>
  <div style="text-align:right">
    <div class="badge">GOODS RECEIPT NOTE</div>
    <div class="grn-num">GRN # {{goodsReceiptNumber}}</div>
    <div class="grn-date">{{fmtDate receiptDate}}</div>
    {{#if status}}<div class="status-pill">{{status}}</div>{{/if}}
  </div>
</div>
<div class="info-strip">
  <div class="info-cell"><div class="info-lbl">Received From</div><div class="info-val">{{supplierName}}</div>{{#if supplierPhone}}<div class="info-sub">{{supplierPhone}}</div>{{/if}}</div>
  {{#if supplierAddress}}<div class="info-cell"><div class="info-lbl">Address</div><div class="info-val">{{{nl2br supplierAddress}}}</div></div>{{/if}}
  {{#if supplierChallanNumber}}<div class="info-cell"><div class="info-lbl">Supplier DC #</div><div class="info-val">{{supplierChallanNumber}}</div></div>{{/if}}
  {{#if purchaseBillNumber}}<div class="info-cell"><div class="info-lbl">Against PB #</div><div class="info-val">{{purchaseBillNumber}}</div></div>{{/if}}
  {{#if site}}<div class="info-cell"><div class="info-lbl">Site</div><div class="info-val">{{site}}</div></div>{{/if}}
</div>
<table>
  <thead><tr><th class="c n">#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
    {{emptyRows (math 15 "-" items.length) 4}}
  </tbody>
</table>
<div class="received">Received the above goods in good order &amp; condition.</div>
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
</div>
</body></html>`,
  },

  // ─── 3. Corporate Navy Header Band ──────────────────────────────────────────
  {
    id: "goodsreceipt-corporate-navy",
    name: "Corporate Navy",
    type: "GoodsReceipt",
    description: "Full-width navy header band with white reversed company name and GRN number",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; color: #111; }
.header-band { background: #0d2b55 !important; color: #fff !important; padding: 14px 16mm; display: flex; justify-content: space-between; align-items: center; }
.hb-left { display: flex; align-items: center; gap: 14px; }
.hb-logo img { height: 56px; }
.hb-name { font-size: 26px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
.hb-addr { font-size: 9px; opacity: 0.8; margin-top: 4px; line-height: 1.5; }
.hb-right { text-align: right; }
.hb-title { font-size: 15px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; opacity: 0.85; }
.hb-num { font-size: 24px; font-weight: 900; margin-top: 4px; }
.hb-date { font-size: 11px; opacity: 0.8; margin-top: 2px; }
.body { padding: 10px 16mm 14mm; }
.ref-row { display: flex; gap: 0; margin: 14px 0; border: 1px solid #c8d0dc; border-radius: 4px; overflow: hidden; }
.ref-cell { flex: 1; padding: 8px 12px; border-right: 1px solid #c8d0dc; }
.ref-cell:last-child { border-right: none; }
.ref-lbl { font-size: 8px; text-transform: uppercase; color: #888; font-weight: 700; letter-spacing: 0.5px; }
.ref-val { font-size: 12px; font-weight: 600; margin-top: 2px; }
.ref-sub { font-size: 9px; color: #888; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th { background: #0d2b55 !important; color: #fff !important; font-size: 10px; text-transform: uppercase; padding: 7px 10px; border: 1px solid #0d2b55; letter-spacing: 0.5px; }
th.c { text-align: center; }
td { border: 1px solid #c8d0dc; padding: 6px 10px; font-size: 12px; height: 26px; }
td.c { text-align: center; }
.n { width: 38px; }
.qty { width: 70px; }
.unit { width: 66px; }
tbody tr:nth-child(even) td { background: #eef2f9 !important; }
.received { margin-top: 20px; font-size: 10px; color: #555; font-style: italic; }
.footer { margin-top: 36px; display: flex; justify-content: space-between; padding: 0 30px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #0d2b55; margin: 0 auto 5px; }
.sig .label { font-size: 9px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="header-band">
  <div class="hb-left">
    {{#if companyLogoPath}}<div class="hb-logo"><img src="{{companyLogoPath}}"></div>{{/if}}
    <div>
      <div class="hb-name">{{companyBrandName}}</div>
      <div class="hb-addr">{{{nl2br companyAddress}}}</div>
      <div class="hb-addr">{{{nl2br companyPhone}}}</div>
    </div>
  </div>
  <div class="hb-right">
    <div class="hb-title">Goods Receipt Note</div>
    <div class="hb-num">GRN # {{goodsReceiptNumber}}</div>
    <div class="hb-date">{{fmtDate receiptDate}}</div>
  </div>
</div>
<div class="body">
  <div class="ref-row">
    <div class="ref-cell"><div class="ref-lbl">Received From</div><div class="ref-val">{{supplierName}}</div>{{#if supplierPhone}}<div class="ref-sub">{{supplierPhone}}</div>{{/if}}</div>
    {{#if supplierAddress}}<div class="ref-cell"><div class="ref-lbl">Address</div><div class="ref-val">{{{nl2br supplierAddress}}}</div></div>{{/if}}
    <div class="ref-cell"><div class="ref-lbl">Supplier DC #</div><div class="ref-val">{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</div></div>
    {{#if purchaseBillNumber}}<div class="ref-cell"><div class="ref-lbl">Against PB #</div><div class="ref-val">{{purchaseBillNumber}}</div></div>{{/if}}
    {{#if site}}<div class="ref-cell"><div class="ref-lbl">Site</div><div class="ref-val">{{site}}</div></div>{{/if}}
  </div>
  <table>
    <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
      {{emptyRows (math 15 "-" items.length) 4}}
    </tbody>
  </table>
  <div class="received">Received the above goods in good order &amp; condition.</div>
  <div class="footer">
    <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 4. Bold Colored Banner ──────────────────────────────────────────────────
  {
    id: "goodsreceipt-bold-banner",
    name: "Bold Colored Banner",
    type: "GoodsReceipt",
    description: "High-contrast teal-to-blue gradient banner with large bold GRN number and vivid table header",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #111; }
.banner { background: linear-gradient(135deg, #00796b 0%, #0277bd 100%) !important; color: #fff !important; padding: 0; }
.banner-top { display: flex; justify-content: space-between; align-items: stretch; }
.banner-company { padding: 16px 16mm; display: flex; align-items: center; gap: 14px; flex: 1; }
.banner-logo img { height: 58px; }
.banner-name { font-size: 28px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; line-height: 1.1; }
.banner-sub { font-size: 9px; opacity: 0.85; margin-top: 5px; line-height: 1.5; }
.banner-grn { background: #004d40 !important; padding: 0 20px; display: flex; flex-direction: column; justify-content: center; align-items: flex-end; min-width: 170px; }
.banner-grn-label { font-size: 9px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.8; }
.banner-grn-num { font-size: 26px; font-weight: 900; margin-top: 2px; }
.banner-grn-date { font-size: 11px; opacity: 0.8; margin-top: 4px; }
.body { padding: 10px 16mm 14mm; }
.from-block { margin: 14px 0; padding: 10px 14px; border-left: 4px solid #00796b; background: #f4faf9 !important; }
.from-grid { display: flex; gap: 20px; flex-wrap: wrap; }
.from-item { flex: 1; min-width: 140px; }
.from-lbl { font-size: 8px; text-transform: uppercase; color: #00796b; font-weight: 700; letter-spacing: 0.6px; }
.from-val { font-size: 12px; font-weight: 600; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
th { background: linear-gradient(90deg, #00796b 0%, #0277bd 100%) !important; color: #fff !important; font-size: 10px; text-transform: uppercase; padding: 8px 10px; border: 1px solid #00796b; letter-spacing: 0.5px; }
th.c { text-align: center; }
td { border: 1px solid #b2dfdb; padding: 6px 10px; font-size: 12px; height: 26px; }
td.c { text-align: center; }
.n { width: 38px; }
.qty { width: 70px; }
.unit { width: 66px; }
tbody tr:nth-child(even) td { background: #e0f2f1 !important; }
.received { margin-top: 20px; font-size: 10px; font-style: italic; color: #444; border-top: 1px solid #b2dfdb; padding-top: 8px; }
.footer { margin-top: 36px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #00796b; margin: 0 auto 5px; }
.sig .label { font-size: 9px; color: #555; text-transform: uppercase; }
</style></head><body>
<div class="banner">
  <div class="banner-top">
    <div class="banner-company">
      {{#if companyLogoPath}}<div class="banner-logo"><img src="{{companyLogoPath}}"></div>{{/if}}
      <div>
        <div class="banner-name">{{companyBrandName}}</div>
        <div class="banner-sub">{{{nl2br companyAddress}}}</div>
        <div class="banner-sub">{{{nl2br companyPhone}}}</div>
      </div>
    </div>
    <div class="banner-grn">
      <div class="banner-grn-label">Goods Receipt Note</div>
      <div class="banner-grn-num">{{goodsReceiptNumber}}</div>
      <div class="banner-grn-date">{{fmtDate receiptDate}}</div>
    </div>
  </div>
</div>
<div class="body">
  <div class="from-block">
    <div class="from-grid">
      <div class="from-item"><div class="from-lbl">Received From</div><div class="from-val">{{supplierName}}</div></div>
      {{#if supplierAddress}}<div class="from-item"><div class="from-lbl">Address</div><div class="from-val">{{{nl2br supplierAddress}}}</div></div>{{/if}}
      {{#if supplierPhone}}<div class="from-item"><div class="from-lbl">Phone</div><div class="from-val">{{supplierPhone}}</div></div>{{/if}}
      <div class="from-item"><div class="from-lbl">Supplier DC #</div><div class="from-val">{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</div></div>
      {{#if purchaseBillNumber}}<div class="from-item"><div class="from-lbl">Against PB #</div><div class="from-val">{{purchaseBillNumber}}</div></div>{{/if}}
      {{#if site}}<div class="from-item"><div class="from-lbl">Site</div><div class="from-val">{{site}}</div></div>{{/if}}
    </div>
  </div>
  <table>
    <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
      {{emptyRows (math 15 "-" items.length) 4}}
    </tbody>
  </table>
  <div class="received">Received the above goods in good order &amp; condition.</div>
  <div class="footer">
    <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 5. Monochrome Ink-Saver ─────────────────────────────────────────────────
  {
    id: "goodsreceipt-monochrome-ink",
    name: "Monochrome Ink-Saver",
    type: "GoodsReceipt",
    description: "Hairline borders only, no fills, pure black-and-white for minimum toner use",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, sans-serif; padding: 12mm; color: #000; font-size: 11pt; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #000; padding-bottom: 10px; margin-bottom: 12px; }
.brand { font-size: 20px; font-weight: 700; text-transform: uppercase; }
.addr { font-size: 9px; margin-top: 4px; line-height: 1.5; }
.grn-block { text-align: right; border: 1px solid #000; padding: 8px 12px; }
.grn-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.grn-num { font-size: 18px; font-weight: 900; margin-top: 4px; }
.grn-date { font-size: 10px; margin-top: 2px; }
.info { margin: 10px 0; font-size: 10pt; line-height: 1.8; }
.info-row { display: flex; }
.info-lbl { min-width: 120px; font-weight: 700; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th { font-size: 9px; text-transform: uppercase; padding: 5px 8px; border: 1px solid #000; background: none !important; color: #000 !important; text-align: left; letter-spacing: 0.5px; }
th.c { text-align: center; }
td { border: 1px solid #000; padding: 5px 8px; font-size: 10pt; height: 24px; }
td.c { text-align: center; }
.n { width: 36px; }
.qty { width: 68px; }
.unit { width: 64px; }
.received { margin-top: 20px; font-size: 9pt; font-style: italic; }
.footer { margin-top: 40px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 170px; border-top: 1px solid #000; margin: 0 auto 4px; }
.sig .label { font-size: 8pt; text-transform: uppercase; }
</style></head><body>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:6px;display:block;filter:grayscale(100%)">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
  </div>
  <div class="grn-block">
    <div class="grn-title">Goods Receipt Note</div>
    <div class="grn-num">GRN # {{goodsReceiptNumber}}</div>
    <div class="grn-date">{{fmtDate receiptDate}}</div>
  </div>
</div>
<div class="info">
  <div class="info-row"><span class="info-lbl">Received From:</span><span>{{supplierName}}</span></div>
  {{#if supplierAddress}}<div class="info-row"><span class="info-lbl">Address:</span><span>{{{nl2br supplierAddress}}}</span></div>{{/if}}
  {{#if supplierPhone}}<div class="info-row"><span class="info-lbl">Phone:</span><span>{{supplierPhone}}</span></div>{{/if}}
  <div class="info-row"><span class="info-lbl">Supplier DC #:</span><span>{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</span></div>
  {{#if purchaseBillNumber}}<div class="info-row"><span class="info-lbl">Against PB #:</span><span>{{purchaseBillNumber}}</span></div>{{/if}}
  {{#if site}}<div class="info-row"><span class="info-lbl">Site:</span><span>{{site}}</span></div>{{/if}}
</div>
<table>
  <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
    {{emptyRows (math 15 "-" items.length) 4}}
  </tbody>
</table>
<div class="received">Received the above goods in good order &amp; condition.</div>
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Checked By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
</div>
</body></html>`,
  },

  // ─── 6. Elegant Premium (charcoal + gold) ────────────────────────────────────
  {
    id: "goodsreceipt-elegant-premium",
    name: "Elegant Premium",
    type: "GoodsReceipt",
    description: "Charcoal and gold premium look with ornamental dividers and italic serif accents",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Georgia, "Times New Roman", serif; padding: 13mm; color: #1a1a1a; background: #fff; }
.gold-top { height: 4px; background: #c9a84c !important; margin-bottom: 16px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #c9a84c; }
.brand { font-size: 28px; font-weight: 700; letter-spacing: 2px; color: #1a1a1a; }
.brand-tagline { font-size: 9px; color: #888; letter-spacing: 2px; text-transform: uppercase; margin-top: 4px; }
.addr { font-size: 10px; color: #555; margin-top: 5px; line-height: 1.5; font-style: italic; }
.grn-panel { text-align: right; }
.grn-title { font-size: 10px; letter-spacing: 4px; text-transform: uppercase; color: #c9a84c; font-family: Georgia, serif; }
.grn-num { font-size: 24px; font-weight: 700; color: #1a1a1a; margin-top: 5px; }
.grn-date { font-size: 11px; color: #777; margin-top: 4px; font-style: italic; }
.divider { text-align: center; margin: 10px 0; color: #c9a84c; font-size: 14px; letter-spacing: 8px; }
.info { margin: 10px 0 14px; font-size: 11pt; line-height: 1.9; }
.info-row { display: flex; }
.info-lbl { min-width: 130px; font-weight: 700; color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding-top: 3px; }
.info-val { font-size: 12px; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th { background: #2c2c2c !important; color: #c9a84c !important; font-family: Georgia, serif; font-size: 10px; text-transform: uppercase; padding: 7px 10px; border: 1px solid #2c2c2c; letter-spacing: 1px; }
th.c { text-align: center; }
td { border: 1px solid #ddd; padding: 6px 10px; font-size: 12px; height: 26px; }
td.c { text-align: center; }
.n { width: 38px; }
.qty { width: 70px; }
.unit { width: 66px; }
tbody tr:nth-child(even) td { background: #fdf8ee !important; }
.received { margin-top: 20px; font-size: 10px; font-style: italic; color: #555; border-top: 1px solid #c9a84c; padding-top: 8px; }
.footer { margin-top: 38px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1.5px solid #c9a84c; margin: 0 auto 5px; }
.sig .label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 1px; font-family: Georgia, serif; }
.gold-bottom { height: 3px; background: #c9a84c !important; margin-top: 20px; }
</style></head><body>
<div class="gold-top"></div>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:55px;margin-bottom:8px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="brand-tagline">Est. &mdash; Pakistan</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
  </div>
  <div class="grn-panel">
    <div class="grn-title">Goods Receipt Note</div>
    <div class="grn-num">{{goodsReceiptNumber}}</div>
    <div class="grn-date">{{fmtDate receiptDate}}</div>
  </div>
</div>
<div class="divider">&#9670; &mdash; &#9670;</div>
<div class="info">
  <div class="info-row"><span class="info-lbl">Received From</span><span class="info-val">{{supplierName}}</span></div>
  {{#if supplierAddress}}<div class="info-row"><span class="info-lbl">Address</span><span class="info-val">{{{nl2br supplierAddress}}}</span></div>{{/if}}
  {{#if supplierPhone}}<div class="info-row"><span class="info-lbl">Phone</span><span class="info-val">{{supplierPhone}}</span></div>{{/if}}
  <div class="info-row"><span class="info-lbl">Supplier DC #</span><span class="info-val">{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</span></div>
  {{#if purchaseBillNumber}}<div class="info-row"><span class="info-lbl">Against PB #</span><span class="info-val">{{purchaseBillNumber}}</span></div>{{/if}}
  {{#if site}}<div class="info-row"><span class="info-lbl">Site</span><span class="info-val">{{site}}</span></div>{{/if}}
</div>
<table>
  <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
    {{emptyRows (math 15 "-" items.length) 4}}
  </tbody>
</table>
<div class="received">Received the above goods in good order &amp; condition.</div>
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
</div>
<div class="gold-bottom"></div>
</body></html>`,
  },

  // ─── 7. Compact Dense ────────────────────────────────────────────────────────
  {
    id: "goodsreceipt-compact-dense",
    name: "Compact Dense",
    type: "GoodsReceipt",
    description: "Tight 9pt font, minimal spacing, fits maximum items on one page",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, sans-serif; padding: 8mm; color: #000; font-size: 9pt; }
.header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 6px; margin-bottom: 6px; border-bottom: 2px solid #333; }
.brand { font-size: 16px; font-weight: 900; text-transform: uppercase; }
.addr { font-size: 8px; color: #444; margin-top: 2px; line-height: 1.4; }
.grn-block { text-align: right; }
.grn-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.grn-num { font-size: 16px; font-weight: 900; }
.grn-date { font-size: 9px; color: #555; }
.info { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 6px 0; font-size: 9pt; }
.info-item { display: flex; gap: 4px; }
.info-lbl { font-weight: 700; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th { background: #444 !important; color: #fff !important; font-size: 8px; text-transform: uppercase; padding: 4px 6px; border: 1px solid #444; letter-spacing: 0.5px; }
th.c { text-align: center; }
td { border: 1px solid #bbb; padding: 3px 6px; font-size: 9pt; height: 20px; }
td.c { text-align: center; }
.n { width: 30px; }
.qty { width: 55px; }
.unit { width: 52px; }
tbody tr:nth-child(even) td { background: #f5f5f5 !important; }
.received { margin-top: 10px; font-size: 8pt; font-style: italic; }
.footer { margin-top: 22px; display: flex; justify-content: space-between; padding: 0 10px; }
.sig { text-align: center; }
.sig .line { width: 160px; border-top: 1px solid #555; margin: 0 auto 3px; }
.sig .label { font-size: 7pt; text-transform: uppercase; }
</style></head><body>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:36px;margin-bottom:3px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
  </div>
  <div class="grn-block">
    <div class="grn-title">GRN</div>
    <div class="grn-num"># {{goodsReceiptNumber}}</div>
    <div class="grn-date">{{fmtDate receiptDate}}</div>
  </div>
</div>
<div class="info">
  <div class="info-item"><span class="info-lbl">From:</span><span>{{supplierName}}</span></div>
  {{#if supplierAddress}}<div class="info-item"><span class="info-lbl">Addr:</span><span>{{{nl2br supplierAddress}}}</span></div>{{/if}}
  {{#if supplierPhone}}<div class="info-item"><span class="info-lbl">Ph:</span><span>{{supplierPhone}}</span></div>{{/if}}
  <div class="info-item"><span class="info-lbl">Supplier DC:</span><span>{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</span></div>
  {{#if purchaseBillNumber}}<div class="info-item"><span class="info-lbl">Against PB:</span><span>{{purchaseBillNumber}}</span></div>{{/if}}
  {{#if site}}<div class="info-item"><span class="info-lbl">Site:</span><span>{{site}}</span></div>{{/if}}
</div>
<table>
  <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description</th><th class="c unit">Unit</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
    {{emptyRows (math 20 "-" items.length) 4}}
  </tbody>
</table>
<div class="received">Received the above goods in good order &amp; condition.</div>
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
</div>
</body></html>`,
  },

  // ─── 8. Left Sidebar Color Strip ─────────────────────────────────────────────
  {
    id: "goodsreceipt-left-sidebar",
    name: "Left Sidebar Strip",
    type: "GoodsReceipt",
    description: "Vertical deep-blue sidebar strip on the left carrying GRN number rotated vertically",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #111; display: flex; min-height: 297mm; }
.sidebar { background: #1a237e !important; color: #fff !important; width: 22mm; display: flex; flex-direction: column; align-items: center; padding: 14mm 0; flex-shrink: 0; }
.sidebar-grn-label { font-size: 8px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.75; writing-mode: vertical-rl; transform: rotate(180deg); margin-bottom: 10px; }
.sidebar-grn-num { font-size: 16px; font-weight: 900; writing-mode: vertical-rl; transform: rotate(180deg); letter-spacing: 2px; }
.sidebar-date { font-size: 8px; opacity: 0.75; writing-mode: vertical-rl; transform: rotate(180deg); margin-top: 10px; }
.main { flex: 1; padding: 12mm; }
.top-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; border-bottom: 2px solid #1a237e; padding-bottom: 10px; }
.brand { font-size: 24px; font-weight: 800; color: #1a237e; text-transform: uppercase; }
.addr { font-size: 9px; color: #555; margin-top: 4px; line-height: 1.5; }
.grn-title-inline { font-size: 16px; font-weight: 700; text-transform: uppercase; color: #1a237e; text-align: right; letter-spacing: 1px; }
.info { margin: 12px 0 14px; font-size: 11pt; }
.info-row { display: flex; margin-bottom: 4px; }
.info-lbl { min-width: 130px; font-size: 10px; text-transform: uppercase; color: #1a237e; font-weight: 700; letter-spacing: 0.5px; padding-top: 2px; }
.info-val { font-size: 12px; }
table { width: 100%; border-collapse: collapse; }
th { background: #1a237e !important; color: #fff !important; font-size: 9px; text-transform: uppercase; padding: 7px 8px; border: 1px solid #1a237e; letter-spacing: 0.5px; }
th.c { text-align: center; }
td { border: 1px solid #c5cae9; padding: 5px 8px; font-size: 11px; height: 24px; }
td.c { text-align: center; }
.n { width: 34px; }
.qty { width: 66px; }
.unit { width: 62px; }
tbody tr:nth-child(even) td { background: #e8eaf6 !important; }
.received { margin-top: 18px; font-size: 9px; font-style: italic; color: #555; border-top: 1px solid #c5cae9; padding-top: 6px; }
.footer { margin-top: 34px; display: flex; justify-content: space-between; padding: 0 10px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 2px solid #1a237e; margin: 0 auto 4px; }
.sig .label { font-size: 8px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="sidebar">
  <div class="sidebar-grn-label">Goods Receipt Note</div>
  <div class="sidebar-grn-num">{{goodsReceiptNumber}}</div>
  <div class="sidebar-date">{{fmtDate receiptDate}}</div>
</div>
<div class="main">
  <div class="top-row">
    <div>
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:6px;display:block">{{/if}}
      <div class="brand">{{companyBrandName}}</div>
      <div class="addr">{{{nl2br companyAddress}}}</div>
      <div class="addr">{{{nl2br companyPhone}}}</div>
    </div>
    <div class="grn-title-inline">GRN # {{goodsReceiptNumber}}</div>
  </div>
  <div class="info">
    <div class="info-row"><span class="info-lbl">Received From</span><span class="info-val">{{supplierName}}</span></div>
    {{#if supplierAddress}}<div class="info-row"><span class="info-lbl">Address</span><span class="info-val">{{{nl2br supplierAddress}}}</span></div>{{/if}}
    {{#if supplierPhone}}<div class="info-row"><span class="info-lbl">Phone</span><span class="info-val">{{supplierPhone}}</span></div>{{/if}}
    <div class="info-row"><span class="info-lbl">Supplier DC #</span><span class="info-val">{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</span></div>
    {{#if purchaseBillNumber}}<div class="info-row"><span class="info-lbl">Against PB #</span><span class="info-val">{{purchaseBillNumber}}</span></div>{{/if}}
    {{#if site}}<div class="info-row"><span class="info-lbl">Site</span><span class="info-val">{{site}}</span></div>{{/if}}
  </div>
  <table>
    <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
      {{emptyRows (math 15 "-" items.length) 4}}
    </tbody>
  </table>
  <div class="received">Received the above goods in good order &amp; condition.</div>
  <div class="footer">
    <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 9. Boxed Traditional (heavy boxed sections) ─────────────────────────────
  {
    id: "goodsreceipt-boxed-traditional",
    name: "Boxed Traditional",
    type: "GoodsReceipt",
    description: "Heavy-bordered box sections for each field group, classic Pakistani wholesale style",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 10mm; color: #000; font-size: 11pt; }
.outer { border: 2px solid #000; }
.title-box { border-bottom: 2px solid #000; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; }
.company-name { font-size: 26px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
.company-meta { font-size: 9px; color: #333; margin-top: 3px; line-height: 1.4; }
.grn-box { border: 2px solid #000; padding: 6px 14px; text-align: center; }
.grn-box .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
.grn-box .num { font-size: 22px; font-weight: 900; margin: 2px 0; }
.grn-box .date { font-size: 11px; }
.fields-row { display: flex; border-bottom: 1.5px solid #000; }
.field-cell { flex: 1; border-right: 1.5px solid #000; padding: 6px 10px; }
.field-cell:last-child { border-right: none; }
.field-lbl { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
.field-val { font-size: 11pt; margin-top: 2px; min-height: 20px; }
table { width: 100%; border-collapse: collapse; }
th { background: #333 !important; color: #fff !important; font-family: "Times New Roman", serif; font-size: 10px; text-transform: uppercase; padding: 6px 8px; border: 1.5px solid #333; letter-spacing: 0.8px; }
th.c { text-align: center; }
td { border: 1px solid #666; padding: 5px 8px; font-size: 11pt; height: 26px; }
td.c { text-align: center; }
.n { width: 36px; }
.qty { width: 70px; }
.unit { width: 66px; }
tbody tr:nth-child(even) td { background: #f5f5f5 !important; }
.recv-box { border-top: 1.5px solid #000; padding: 8px 12px; font-size: 10pt; font-style: italic; }
.sig-box { border-top: 2px solid #000; display: flex; }
.sig-cell { flex: 1; border-right: 1.5px solid #000; padding: 30px 20px 10px; text-align: center; }
.sig-cell:last-child { border-right: none; }
.sig-cell .lbl { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-top: 1px solid #000; padding-top: 4px; }
</style></head><body>
<div class="outer">
  <div class="title-box">
    <div>
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:5px;display:block">{{/if}}
      <div class="company-name">{{companyBrandName}}</div>
      <div class="company-meta">{{{nl2br companyAddress}}} &nbsp;|&nbsp; {{{nl2br companyPhone}}}</div>
    </div>
    <div class="grn-box">
      <div class="lbl">Goods Receipt Note</div>
      <div class="num">{{goodsReceiptNumber}}</div>
      <div class="date">{{fmtDate receiptDate}}</div>
    </div>
  </div>
  <div class="fields-row">
    <div class="field-cell" style="flex:2"><div class="field-lbl">Received From</div><div class="field-val">{{supplierName}}</div></div>
    <div class="field-cell" style="flex:2"><div class="field-lbl">Address</div><div class="field-val">{{#if supplierAddress}}{{{nl2br supplierAddress}}}{{else}}&mdash;{{/if}}</div></div>
    <div class="field-cell"><div class="field-lbl">Supplier DC #</div><div class="field-val">{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</div></div>
    <div class="field-cell"><div class="field-lbl">Against PB #</div><div class="field-val">{{#if purchaseBillNumber}}{{purchaseBillNumber}}{{else}}&mdash;{{/if}}</div></div>
  </div>
  <div class="fields-row">
    <div class="field-cell"><div class="field-lbl">Phone</div><div class="field-val">{{#if supplierPhone}}{{supplierPhone}}{{else}}&mdash;{{/if}}</div></div>
    <div class="field-cell"><div class="field-lbl">Site</div><div class="field-val">{{#if site}}{{site}}{{else}}&mdash;{{/if}}</div></div>
  </div>
  <table>
    <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
      {{emptyRows (math 15 "-" items.length) 4}}
    </tbody>
  </table>
  <div class="recv-box">Received the above goods in good order &amp; condition.</div>
  <div class="sig-box">
    <div class="sig-cell"><div class="lbl">Received By</div></div>
    <div class="sig-cell"><div class="lbl">Checked By</div></div>
    <div class="sig-cell"><div class="lbl">Store Incharge</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 10. Bismillah Header ────────────────────────────────────────────────────
  {
    id: "goodsreceipt-bismillah-header",
    name: "Bismillah Header",
    type: "GoodsReceipt",
    description: "Centered Bismillah calligraphy line at the top with a green-ruled traditional format",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 12mm; color: #000; font-size: 11pt; }
.bismillah { text-align: center; font-family: "Traditional Arabic", "Arial Unicode MS", serif; font-size: 22px; color: #1a5c2a; margin-bottom: 8px; letter-spacing: 2px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-top: 2px solid #1a5c2a; border-bottom: 2px solid #1a5c2a; padding: 10px 0; margin-bottom: 14px; }
.brand { font-size: 24px; font-weight: 900; text-transform: uppercase; color: #123c1c; letter-spacing: 1px; }
.addr { font-size: 9px; color: #2e7d32; margin-top: 4px; line-height: 1.5; }
.grn-block { text-align: right; }
.grn-title { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #1a5c2a; letter-spacing: 2px; }
.grn-num { font-size: 22px; font-weight: 900; color: #123c1c; margin-top: 4px; }
.grn-date { font-size: 11px; color: #388e3c; margin-top: 3px; font-style: italic; }
.info { margin: 10px 0 14px; font-size: 11pt; line-height: 1.9; }
.info-row { display: flex; }
.info-lbl { min-width: 130px; font-weight: 700; color: #1a5c2a; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding-top: 2px; }
table { width: 100%; border-collapse: collapse; }
th { background: #1b5e20 !important; color: #fff !important; font-family: "Times New Roman", serif; font-size: 10px; text-transform: uppercase; padding: 6px 10px; border: 1px solid #1b5e20; letter-spacing: 1px; }
th.c { text-align: center; }
td { border: 1px solid #a5d6a7; padding: 5px 10px; font-size: 11pt; height: 26px; }
td.c { text-align: center; }
.n { width: 36px; }
.qty { width: 70px; }
.unit { width: 64px; }
tbody tr:nth-child(even) td { background: #e8f5e9 !important; }
.received { margin-top: 20px; font-size: 10pt; font-style: italic; color: #1a5c2a; border-top: 1px solid #a5d6a7; padding-top: 8px; }
.footer { margin-top: 36px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1.5px solid #1a5c2a; margin: 0 auto 4px; }
.sig .label { font-size: 9pt; color: #1a5c2a; font-style: italic; }
</style></head><body>
<div class="bismillah">&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1729; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1740;&#1605;</div>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:54px;margin-bottom:6px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
  </div>
  <div class="grn-block">
    <div class="grn-title">Goods Receipt Note</div>
    <div class="grn-num">GRN # {{goodsReceiptNumber}}</div>
    <div class="grn-date">{{fmtDate receiptDate}}</div>
  </div>
</div>
<div class="info">
  <div class="info-row"><span class="info-lbl">Received From</span><span>{{supplierName}}</span></div>
  {{#if supplierAddress}}<div class="info-row"><span class="info-lbl">Address</span><span>{{{nl2br supplierAddress}}}</span></div>{{/if}}
  {{#if supplierPhone}}<div class="info-row"><span class="info-lbl">Phone</span><span>{{supplierPhone}}</span></div>{{/if}}
  <div class="info-row"><span class="info-lbl">Supplier DC #</span><span>{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</span></div>
  {{#if purchaseBillNumber}}<div class="info-row"><span class="info-lbl">Against PB #</span><span>{{purchaseBillNumber}}</span></div>{{/if}}
  {{#if site}}<div class="info-row"><span class="info-lbl">Site</span><span>{{site}}</span></div>{{/if}}
</div>
<table>
  <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
    {{emptyRows (math 15 "-" items.length) 4}}
  </tbody>
</table>
<div class="received">Received the above goods in good order &amp; condition.</div>
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
</div>
</body></html>`,
  },

  // ─── 11. Green & Gold ────────────────────────────────────────────────────────
  {
    id: "goodsreceipt-green-gold",
    name: "Green & Gold",
    type: "GoodsReceipt",
    description: "Pakistani national colors — forest green header with gold accent lines and olive tints",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; color: #1a1a1a; }
.header-wrap { background: #2e7d32 !important; }
.gold-stripe { height: 4px; background: #f9a825 !important; }
.header { padding: 12px 14mm; display: flex; justify-content: space-between; align-items: center; }
.brand { font-size: 26px; font-weight: 900; color: #fff !important; text-transform: uppercase; letter-spacing: 1px; }
.addr { font-size: 9px; color: rgba(255,255,255,0.82); margin-top: 4px; line-height: 1.5; }
.grn-right { text-align: right; }
.grn-title { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: #f9a825; font-weight: 700; }
.grn-num { font-size: 24px; font-weight: 900; color: #fff !important; margin-top: 4px; }
.grn-date { font-size: 11px; color: rgba(255,255,255,0.8); margin-top: 3px; }
.body { padding: 10px 14mm 14mm; }
.info-band { display: flex; gap: 0; margin: 14px 0; border: 1.5px solid #a5d6a7; border-radius: 4px; overflow: hidden; }
.info-band-cell { flex: 1; padding: 7px 10px; border-right: 1px solid #a5d6a7; }
.info-band-cell:last-child { border-right: none; }
.ibl { font-size: 7px; text-transform: uppercase; color: #388e3c; font-weight: 700; letter-spacing: 0.6px; }
.ivl { font-size: 11px; font-weight: 600; margin-top: 2px; }
.isb { font-size: 8px; color: #666; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th { background: #2e7d32 !important; color: #fff !important; font-size: 9px; text-transform: uppercase; padding: 6px 8px; border: 1px solid #2e7d32; letter-spacing: 0.5px; }
th.c { text-align: center; }
td { border: 1px solid #c8e6c9; padding: 5px 8px; font-size: 11px; height: 24px; }
td.c { text-align: center; }
.n { width: 36px; }
.qty { width: 68px; }
.unit { width: 64px; }
tbody tr:nth-child(even) td { background: #f1f8e9 !important; }
tbody tr:nth-child(odd) td { background: #fff !important; }
.received { margin-top: 18px; font-size: 9px; font-style: italic; color: #555; border-top: 1px solid #a5d6a7; padding-top: 7px; }
.footer { margin-top: 34px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #f9a825; margin: 0 auto 4px; }
.sig .label { font-size: 9px; color: #555; text-transform: uppercase; }
</style></head><body>
<div class="header-wrap">
  <div class="gold-stripe"></div>
  <div class="header">
    <div>
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:52px;margin-bottom:6px;display:block">{{/if}}
      <div class="brand">{{companyBrandName}}</div>
      <div class="addr">{{{nl2br companyAddress}}}</div>
      <div class="addr">{{{nl2br companyPhone}}}</div>
    </div>
    <div class="grn-right">
      <div class="grn-title">Goods Receipt Note</div>
      <div class="grn-num">GRN # {{goodsReceiptNumber}}</div>
      <div class="grn-date">{{fmtDate receiptDate}}</div>
    </div>
  </div>
  <div class="gold-stripe"></div>
</div>
<div class="body">
  <div class="info-band">
    <div class="info-band-cell"><div class="ibl">Received From</div><div class="ivl">{{supplierName}}</div>{{#if supplierPhone}}<div class="isb">{{supplierPhone}}</div>{{/if}}</div>
    {{#if supplierAddress}}<div class="info-band-cell"><div class="ibl">Address</div><div class="ivl">{{{nl2br supplierAddress}}}</div></div>{{/if}}
    <div class="info-band-cell"><div class="ibl">Supplier DC #</div><div class="ivl">{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</div></div>
    {{#if purchaseBillNumber}}<div class="info-band-cell"><div class="ibl">Against PB #</div><div class="ivl">{{purchaseBillNumber}}</div></div>{{/if}}
    {{#if site}}<div class="info-band-cell"><div class="ibl">Site</div><div class="ivl">{{site}}</div></div>{{/if}}
  </div>
  <table>
    <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
      {{emptyRows (math 15 "-" items.length) 4}}
    </tbody>
  </table>
  <div class="received">Received the above goods in good order &amp; condition.</div>
  <div class="footer">
    <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 12. Teal / Slate Two-Tone ───────────────────────────────────────────────
  {
    id: "goodsreceipt-teal-slate",
    name: "Teal & Slate Two-Tone",
    type: "GoodsReceipt",
    description: "Split two-tone header — teal company panel left, slate GRN panel right",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Calibri, Arial, sans-serif; color: #111; }
.header { display: flex; height: 72px; }
.header-left { background: #00838f !important; flex: 1; display: flex; align-items: center; gap: 12px; padding: 0 14mm; }
.header-left .hl-logo img { height: 50px; }
.hl-name { font-size: 22px; font-weight: 800; color: #fff !important; text-transform: uppercase; letter-spacing: 0.5px; }
.hl-addr { font-size: 8px; color: rgba(255,255,255,0.8); margin-top: 3px; line-height: 1.4; }
.header-right { background: #455a64 !important; width: 150px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; padding: 0 12px; }
.hr-title { font-size: 8px; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.7); }
.hr-num { font-size: 20px; font-weight: 900; color: #fff !important; margin-top: 3px; }
.hr-date { font-size: 9px; color: rgba(255,255,255,0.7); margin-top: 3px; }
.body { padding: 10px 14mm 14mm; }
.info-row-wrap { display: flex; gap: 0; margin: 14px 0; border: 1px solid #b0bec5; border-radius: 3px; }
.irc { flex: 1; border-right: 1px solid #b0bec5; padding: 7px 10px; }
.irc:last-child { border-right: none; }
.irc-lbl { font-size: 7px; text-transform: uppercase; color: #00838f; font-weight: 700; letter-spacing: 0.6px; }
.irc-val { font-size: 11px; font-weight: 600; margin-top: 2px; }
.irc-sub { font-size: 8px; color: #666; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; }
th { background: #455a64 !important; color: #fff !important; font-size: 9px; text-transform: uppercase; padding: 6px 8px; border: 1px solid #455a64; letter-spacing: 0.5px; }
th.c { text-align: center; }
td { border: 1px solid #cfd8dc; padding: 5px 8px; font-size: 11px; height: 24px; }
td.c { text-align: center; }
.n { width: 36px; }
.qty { width: 68px; }
.unit { width: 64px; }
tbody tr:nth-child(even) td { background: #eceff1 !important; }
.received { margin-top: 18px; font-size: 9px; font-style: italic; color: #555; border-top: 1px solid #cfd8dc; padding-top: 7px; }
.footer { margin-top: 34px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 2px solid #00838f; margin: 0 auto 4px; }
.sig .label { font-size: 8px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="header">
  <div class="header-left">
    {{#if companyLogoPath}}<div class="hl-logo"><img src="{{companyLogoPath}}"></div>{{/if}}
    <div>
      <div class="hl-name">{{companyBrandName}}</div>
      <div class="hl-addr">{{{nl2br companyAddress}}}</div>
      <div class="hl-addr">{{{nl2br companyPhone}}}</div>
    </div>
  </div>
  <div class="header-right">
    <div class="hr-title">GRN</div>
    <div class="hr-num">{{goodsReceiptNumber}}</div>
    <div class="hr-date">{{fmtDate receiptDate}}</div>
  </div>
</div>
<div class="body">
  <div class="info-row-wrap">
    <div class="irc"><div class="irc-lbl">Received From</div><div class="irc-val">{{supplierName}}</div>{{#if supplierPhone}}<div class="irc-sub">{{supplierPhone}}</div>{{/if}}</div>
    {{#if supplierAddress}}<div class="irc"><div class="irc-lbl">Address</div><div class="irc-val">{{{nl2br supplierAddress}}}</div></div>{{/if}}
    <div class="irc"><div class="irc-lbl">Supplier DC #</div><div class="irc-val">{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</div></div>
    {{#if purchaseBillNumber}}<div class="irc"><div class="irc-lbl">Against PB #</div><div class="irc-val">{{purchaseBillNumber}}</div></div>{{/if}}
    {{#if site}}<div class="irc"><div class="irc-lbl">Site</div><div class="irc-val">{{site}}</div></div>{{/if}}
  </div>
  <table>
    <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
      {{emptyRows (math 15 "-" items.length) 4}}
    </tbody>
  </table>
  <div class="received">Received the above goods in good order &amp; condition.</div>
  <div class="footer">
    <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 13. Big Letterhead ──────────────────────────────────────────────────────
  {
    id: "goodsreceipt-big-letterhead",
    name: "Big Letterhead",
    type: "GoodsReceipt",
    description: "Oversized centered company name as letterhead with ruled lines and logo prominent",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 12mm; color: #111; }
.letterhead { text-align: center; padding-bottom: 10px; border-bottom: 3px solid #1565c0; margin-bottom: 6px; }
.lh-logo { margin-bottom: 6px; }
.lh-name { font-size: 36px; font-weight: 900; text-transform: uppercase; color: #1565c0; letter-spacing: 3px; }
.lh-contact { font-size: 9px; color: #555; margin-top: 3px; line-height: 1.5; }
.sub-rule { height: 1px; background: #1565c0 !important; margin-bottom: 12px; }
.doc-meta { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.grn-badge-wrap { text-align: right; }
.grn-badge { display: inline-block; border: 2px solid #1565c0; padding: 6px 16px; }
.grn-badge .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #1565c0; font-weight: 700; }
.grn-badge .num { font-size: 20px; font-weight: 900; color: #1565c0; margin-top: 2px; }
.grn-badge .date { font-size: 10px; color: #777; margin-top: 2px; }
.info { font-size: 11pt; line-height: 1.9; }
.info-row { display: flex; margin-bottom: 2px; }
.info-lbl { min-width: 130px; font-weight: 700; color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; padding-top: 2px; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th { background: #1565c0 !important; color: #fff !important; font-size: 10px; text-transform: uppercase; padding: 7px 10px; border: 1px solid #1565c0; letter-spacing: 0.5px; }
th.c { text-align: center; }
td { border: 1px solid #cfd8e3; padding: 6px 10px; font-size: 12px; height: 26px; }
td.c { text-align: center; }
.n { width: 38px; }
.qty { width: 70px; }
.unit { width: 66px; }
tbody tr:nth-child(even) td { background: #e8edf5 !important; }
.received { margin-top: 20px; font-size: 10px; font-style: italic; color: #555; border-top: 1px solid #cfd8e3; padding-top: 8px; }
.footer { margin-top: 36px; display: flex; justify-content: space-between; padding: 0 30px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #1565c0; margin: 0 auto 4px; }
.sig .label { font-size: 9px; color: #666; text-transform: uppercase; }
</style></head><body>
<div class="letterhead">
  <div class="lh-logo">{{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px">{{/if}}</div>
  <div class="lh-name">{{companyBrandName}}</div>
  <div class="lh-contact">{{{nl2br companyAddress}}}</div>
  <div class="lh-contact">{{{nl2br companyPhone}}}</div>
</div>
<div class="sub-rule"></div>
<div class="doc-meta">
  <div class="info">
    <div class="info-row"><span class="info-lbl">Received From</span><span>{{supplierName}}</span></div>
    {{#if supplierAddress}}<div class="info-row"><span class="info-lbl">Address</span><span>{{{nl2br supplierAddress}}}</span></div>{{/if}}
    {{#if supplierPhone}}<div class="info-row"><span class="info-lbl">Phone</span><span>{{supplierPhone}}</span></div>{{/if}}
    <div class="info-row"><span class="info-lbl">Supplier DC #</span><span>{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</span></div>
    {{#if purchaseBillNumber}}<div class="info-row"><span class="info-lbl">Against PB #</span><span>{{purchaseBillNumber}}</span></div>{{/if}}
    {{#if site}}<div class="info-row"><span class="info-lbl">Site</span><span>{{site}}</span></div>{{/if}}
  </div>
  <div class="grn-badge-wrap">
    <div class="grn-badge">
      <div class="lbl">Goods Receipt Note</div>
      <div class="num">{{goodsReceiptNumber}}</div>
      <div class="date">{{fmtDate receiptDate}}</div>
    </div>
  </div>
</div>
<table>
  <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
    {{emptyRows (math 15 "-" items.length) 4}}
  </tbody>
</table>
<div class="received">Received the above goods in good order &amp; condition.</div>
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
</div>
</body></html>`,
  },

  // ─── 14. Centered Title / Faint Watermark (status-aware) ─────────────────────
  {
    id: "goodsreceipt-centered-watermark",
    name: "Centered Title & Watermark",
    type: "GoodsReceipt",
    description: "Centered document title with a faint diagonal status watermark behind the table",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, "Segoe UI", sans-serif; padding: 12mm; color: #111; position: relative; }
.wm { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-40deg); font-size: 90px; font-weight: 900; color: rgba(0,0,0,0.05) !important; text-transform: uppercase; letter-spacing: 10px; pointer-events: none; z-index: 0; white-space: nowrap; }
.content { position: relative; z-index: 1; }
.header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 8px; margin-bottom: 4px; }
.brand { font-size: 22px; font-weight: 800; text-transform: uppercase; color: #263238; }
.addr { font-size: 9px; color: #607d8b; margin-top: 3px; line-height: 1.5; }
.grn-title-center { text-align: center; margin: 8px 0 4px; }
.grn-title-text { font-size: 18px; font-weight: 900; text-transform: uppercase; letter-spacing: 4px; border-bottom: 2px solid #263238; display: inline-block; padding-bottom: 3px; }
.meta-row { display: flex; justify-content: center; gap: 30px; font-size: 11px; margin: 6px 0 14px; color: #555; }
.meta-row b { color: #111; }
.info { margin: 10px 0 12px; font-size: 11pt; line-height: 1.8; }
.info-row { display: flex; }
.info-lbl { min-width: 130px; font-weight: 700; color: #607d8b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; padding-top: 2px; }
table { width: 100%; border-collapse: collapse; }
th { background: #263238 !important; color: #fff !important; font-size: 9px; text-transform: uppercase; padding: 6px 10px; border: 1px solid #263238; letter-spacing: 0.5px; }
th.c { text-align: center; }
td { border: 1px solid #cfd8dc; padding: 5px 10px; font-size: 12px; height: 24px; }
td.c { text-align: center; }
.n { width: 36px; }
.qty { width: 68px; }
.unit { width: 64px; }
tbody tr:nth-child(even) td { background: #f5f7f9 !important; }
.received { margin-top: 18px; font-size: 9px; font-style: italic; color: #607d8b; border-top: 1px solid #cfd8dc; padding-top: 7px; }
.footer { margin-top: 36px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 1.5px solid #607d8b; margin: 0 auto 4px; }
.sig .label { font-size: 9px; color: #777; text-transform: uppercase; }
</style></head><body>
<div class="wm">{{#if status}}{{status}}{{else}}{{companyBrandName}}{{/if}}</div>
<div class="content">
  <div class="header">
    <div>
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:5px;display:block">{{/if}}
      <div class="brand">{{companyBrandName}}</div>
      <div class="addr">{{{nl2br companyAddress}}}</div>
      <div class="addr">{{{nl2br companyPhone}}}</div>
    </div>
  </div>
  <div class="grn-title-center"><div class="grn-title-text">Goods Receipt Note</div></div>
  <div class="meta-row">
    <span><b>GRN #:</b> {{goodsReceiptNumber}}</span>
    <span><b>Date:</b> {{fmtDate receiptDate}}</span>
    {{#if supplierChallanNumber}}<span><b>Supplier DC #:</b> {{supplierChallanNumber}}</span>{{/if}}
    {{#if purchaseBillNumber}}<span><b>Against PB #:</b> {{purchaseBillNumber}}</span>{{/if}}
  </div>
  <div class="info">
    <div class="info-row"><span class="info-lbl">Received From</span><span>{{supplierName}}</span></div>
    {{#if supplierAddress}}<div class="info-row"><span class="info-lbl">Address</span><span>{{{nl2br supplierAddress}}}</span></div>{{/if}}
    {{#if supplierPhone}}<div class="info-row"><span class="info-lbl">Phone</span><span>{{supplierPhone}}</span></div>{{/if}}
    {{#if site}}<div class="info-row"><span class="info-lbl">Site</span><span>{{site}}</span></div>{{/if}}
  </div>
  <table>
    <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
      {{emptyRows (math 15 "-" items.length) 4}}
    </tbody>
  </table>
  <div class="received">Received the above goods in good order &amp; condition.</div>
  <div class="footer">
    <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Store Incharge</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 15. Government-Form Grid (heavy bordered cells) ─────────────────────────
  {
    id: "goodsreceipt-govt-form-grid",
    name: "Government Form Grid",
    type: "GoodsReceipt",
    description: "Heavy-ruled form-style grid with labeled header cells, official goods-inward register style",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Goods Receipt Note #{{goodsReceiptNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, sans-serif; padding: 10mm; color: #000; font-size: 10pt; }
.outer { border: 2.5px solid #000; }
.title-row { border-bottom: 2px solid #000; display: flex; align-items: stretch; }
.title-logo { border-right: 2px solid #000; padding: 8px 12px; display: flex; align-items: center; justify-content: center; min-width: 70px; }
.title-main { flex: 1; text-align: center; padding: 8px; }
.title-company { font-size: 20px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
.title-sub { font-size: 8px; color: #333; margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }
.title-addr { font-size: 8px; color: #333; margin-top: 3px; line-height: 1.4; }
.title-doc { border-left: 2px solid #000; padding: 8px 12px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; min-width: 130px; text-align: right; }
.title-doc .doc-name { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; }
.title-doc .doc-num { font-size: 18px; font-weight: 900; margin-top: 3px; }
.title-doc .doc-date { font-size: 9px; color: #444; margin-top: 2px; }
.field-table { width: 100%; border-collapse: collapse; border-bottom: 2px solid #000; }
.field-table td { border: 1px solid #000; padding: 4px 8px; vertical-align: top; }
.field-table .lbl { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.5px; color: #555; font-weight: 700; display: block; }
.field-table .val { font-size: 10pt; font-weight: 600; min-height: 18px; display: block; margin-top: 1px; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #e0e0e0 !important; color: #000 !important; font-size: 9px; text-transform: uppercase; padding: 5px 8px; border: 1.5px solid #000; letter-spacing: 0.5px; font-weight: 700; }
table.items th.c { text-align: center; }
table.items td { border: 1px solid #000; padding: 4px 8px; font-size: 10pt; height: 24px; }
table.items td.c { text-align: center; }
.n { width: 36px; }
.qty { width: 68px; }
.unit { width: 64px; }
.recv-row { border-top: 2px solid #000; padding: 6px 10px; font-size: 9pt; font-style: italic; border-bottom: 2px solid #000; }
.sig-table { width: 100%; border-collapse: collapse; }
.sig-table td { border: 1px solid #000; padding: 30px 10px 8px; text-align: center; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; vertical-align: bottom; }
</style></head><body>
<div class="outer">
  <div class="title-row">
    <div class="title-logo">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:52px">{{else}}<div style="width:52px;height:52px;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:7px;color:#aaa">LOGO</div>{{/if}}
    </div>
    <div class="title-main">
      <div class="title-company">{{companyBrandName}}</div>
      <div class="title-sub">Goods Inward / Gate Entry Record</div>
      <div class="title-addr">{{{nl2br companyAddress}}}</div>
      <div class="title-addr">{{{nl2br companyPhone}}}</div>
    </div>
    <div class="title-doc">
      <div class="doc-name">Goods Receipt Note</div>
      <div class="doc-num">{{goodsReceiptNumber}}</div>
      <div class="doc-date">{{fmtDate receiptDate}}</div>
    </div>
  </div>
  <table class="field-table">
    <tr>
      <td style="width:35%"><span class="lbl">Received From (Supplier)</span><span class="val">{{supplierName}}</span></td>
      <td style="width:35%"><span class="lbl">Address</span><span class="val">{{#if supplierAddress}}{{{nl2br supplierAddress}}}{{else}}&mdash;{{/if}}</span></td>
      <td style="width:15%"><span class="lbl">Supplier DC #</span><span class="val">{{#if supplierChallanNumber}}{{supplierChallanNumber}}{{else}}&mdash;{{/if}}</span></td>
      <td style="width:15%"><span class="lbl">Against PB #</span><span class="val">{{#if purchaseBillNumber}}{{purchaseBillNumber}}{{else}}&mdash;{{/if}}</span></td>
    </tr>
    <tr>
      <td><span class="lbl">Phone</span><span class="val">{{#if supplierPhone}}{{supplierPhone}}{{else}}&mdash;{{/if}}</span></td>
      <td><span class="lbl">Site</span><span class="val">{{#if site}}{{site}}{{else}}&mdash;{{/if}}</span></td>
      <td colspan="2"><span class="lbl">Receipt Date</span><span class="val">{{fmtDate receiptDate}}</span></td>
    </tr>
  </table>
  <table class="items">
    <thead><tr><th class="c n">S.No.</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
      {{emptyRows (math 15 "-" items.length) 4}}
    </tbody>
  </table>
  <div class="recv-row">Received the above goods in good order &amp; condition.</div>
  <table class="sig-table">
    <tr>
      <td>Received By</td>
      <td>Checked By</td>
      <td>Store Incharge &amp; Stamp</td>
    </tr>
  </table>
</div>
</body></html>`,
  },

];
