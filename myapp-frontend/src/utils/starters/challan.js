/**
 * Delivery Challan starter templates — 15 distinct visual archetypes.
 * All templates are A4 print-ready, Handlebars-powered, quantity-only (no prices).
 * Use only registered helpers: fmtDate, fmt, fmtDec, nl2br, join, joinDates,
 * emptyRows, math, inc, eq, gt, or, #each, #if.
 */

export const challanStarters = [

  // ─── 1. Classic Serif (double-border header) ──────────────────────────────
  {
    id: "challan-classic-serif",
    name: "Classic Serif",
    type: "Challan",
    description: "Traditional Times New Roman layout with double-rule header border",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 12mm; color: #000; font-size: 12pt; }
.outer-border { border: 2px solid #000; padding: 10px; }
.inner-border { border: 1px solid #000; padding: 10px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #333; padding-bottom: 14px; margin-bottom: 14px; }
.brand { font-size: 30px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; }
.addr { font-size: 10px; color: #333; margin-top: 4px; line-height: 1.5; }
.logo-wrap { margin-bottom: 6px; }
.dc-block { text-align: right; }
.dc-title { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 6px; }
.dc-num { font-size: 22px; font-weight: 900; }
.dc-date { font-size: 12px; margin-top: 4px; }
.info { margin: 10px 0 14px; font-size: 12pt; line-height: 1.8; }
.info b { font-weight: 700; min-width: 120px; display: inline-block; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th { background: #2c3e50 !important; color: #fff !important; font-family: "Times New Roman", serif; font-size: 11px; text-transform: uppercase; padding: 6px 10px; border: 1px solid #2c3e50; letter-spacing: 1px; }
td { border: 1px solid #999; padding: 6px 10px; font-size: 12px; height: 26px; }
.c { text-align: center; width: 70px; }
.n { text-align: center; width: 40px; }
tbody tr:nth-child(even) td { background: #f5f5f5 !important; }
.received { margin-top: 22px; font-size: 11pt; font-style: italic; border-top: 1px solid #999; padding-top: 8px; }
.footer { margin-top: 36px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1.5px solid #333; margin: 0 auto 4px; }
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
  <div class="dc-block">
    <div class="dc-title">Delivery Challan</div>
    <div class="dc-num">DC # {{challanNumber}}</div>
    <div class="dc-date">Date: {{fmtDate deliveryDate}}</div>
  </div>
</div>
<div class="info">
  <div><b>Messers:</b> {{clientName}}</div>
  <div><b>Address:</b> {{clientAddress}}</div>
  {{#if clientSite}}<div><b>Site:</b> {{clientSite}}</div>{{/if}}
  <div><b>P.O. No.:</b> {{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}{{#if poDate}} &nbsp;&nbsp; <b>P.O. Date:</b> {{fmtDate poDate}}{{/if}}</div>
  {{#if indentNo}}<div><b>Indent No.:</b> {{indentNo}}</div>{{/if}}
</div>
<table>
  <thead><tr><th class="n">S#</th><th class="c">Qty</th><th>Description of Goods</th><th class="c">Unit</th></tr></thead>
  <tbody>
    {{#each items}}<tr><td class="cell n">{{inc @index}}</td><td class="cell c">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c">{{this.unit}}</td></tr>{{/each}}
    {{emptyRows (math 15 "-" items.length) 4}}
  </tbody>
</table>
<div class="received">Received the above goods in good order &amp; condition.</div>
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
</div>
</div></div>
</body></html>`,
  },

  // ─── 2. Modern Minimal (accent rule) ──────────────────────────────────────
  {
    id: "challan-modern-minimal",
    name: "Modern Minimal",
    type: "Challan",
    description: "Clean sans-serif with a thin gradient accent rule and card info strip",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 13mm; color: #222; }
.accent-rule { height: 5px; background: linear-gradient(90deg, #1565c0 0%, #26c6da 100%); border-radius: 3px; margin-bottom: 18px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
.brand { font-size: 26px; font-weight: 800; color: #1565c0; letter-spacing: 0.5px; }
.sub { font-size: 10px; color: #666; margin-top: 3px; line-height: 1.5; }
.badge { background: #1565c0; color: #fff; padding: 5px 14px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; display: inline-block; }
.dc-num { font-size: 20px; font-weight: 800; color: #1565c0; margin-top: 6px; text-align: right; }
.dc-date { font-size: 11px; color: #777; text-align: right; margin-top: 2px; }
.info-strip { display: flex; gap: 12px; background: #f4f6fb; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; }
.info-cell { flex: 1; }
.info-lbl { font-size: 8px; text-transform: uppercase; color: #999; font-weight: 700; letter-spacing: 0.6px; }
.info-val { font-size: 12px; font-weight: 600; margin-top: 2px; color: #1a1a1a; }
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
    <div class="badge">DELIVERY CHALLAN</div>
    <div class="dc-num">DC # {{challanNumber}}</div>
    <div class="dc-date">{{fmtDate deliveryDate}}</div>
  </div>
</div>
<div class="info-strip">
  <div class="info-cell"><div class="info-lbl">To (Messers)</div><div class="info-val">{{clientName}}</div></div>
  <div class="info-cell"><div class="info-lbl">Address</div><div class="info-val">{{clientAddress}}</div></div>
  {{#if clientSite}}<div class="info-cell"><div class="info-lbl">Site</div><div class="info-val">{{clientSite}}</div></div>{{/if}}
  <div class="info-cell"><div class="info-lbl">PO Number</div><div class="info-val">{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</div></div>
  {{#if indentNo}}<div class="info-cell"><div class="info-lbl">Indent No.</div><div class="info-val">{{indentNo}}</div></div>{{/if}}
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
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
</div>
</body></html>`,
  },

  // ─── 3. Corporate Navy Header Band ────────────────────────────────────────
  {
    id: "challan-corporate-navy",
    name: "Corporate Navy",
    type: "Challan",
    description: "Full-width navy header band with white reversed company name and DC number",
    html: `<!DOCTYPE html><html><head><style>
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
    <div class="hb-title">Delivery Challan</div>
    <div class="hb-num">DC # {{challanNumber}}</div>
    <div class="hb-date">{{fmtDate deliveryDate}}</div>
  </div>
</div>
<div class="body">
  <div class="ref-row">
    <div class="ref-cell"><div class="ref-lbl">To (Messers)</div><div class="ref-val">{{clientName}}</div></div>
    <div class="ref-cell"><div class="ref-lbl">Address</div><div class="ref-val">{{clientAddress}}</div></div>
    {{#if clientSite}}<div class="ref-cell"><div class="ref-lbl">Site</div><div class="ref-val">{{clientSite}}</div></div>{{/if}}
    <div class="ref-cell"><div class="ref-lbl">PO Number</div><div class="ref-val">{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</div></div>
    {{#if indentNo}}<div class="ref-cell"><div class="ref-lbl">Indent No.</div><div class="ref-val">{{indentNo}}</div></div>{{/if}}
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
    <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 4. Bold Colored Banner ───────────────────────────────────────────────
  {
    id: "challan-bold-banner",
    name: "Bold Colored Banner",
    type: "Challan",
    description: "High-contrast teal banner header with large bold DC number and vivid table header",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #111; }
.banner { background: #00796b !important; color: #fff !important; padding: 0; }
.banner-top { display: flex; justify-content: space-between; align-items: stretch; }
.banner-company { padding: 16px 16mm; display: flex; align-items: center; gap: 14px; flex: 1; }
.banner-logo img { height: 58px; }
.banner-name { font-size: 28px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; line-height: 1.1; }
.banner-sub { font-size: 9px; opacity: 0.85; margin-top: 5px; line-height: 1.5; }
.banner-dc { background: #004d40 !important; padding: 0 20px; display: flex; flex-direction: column; justify-content: center; align-items: flex-end; min-width: 160px; }
.banner-dc-label { font-size: 9px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.8; }
.banner-dc-num { font-size: 26px; font-weight: 900; margin-top: 2px; }
.banner-dc-date { font-size: 11px; opacity: 0.8; margin-top: 4px; }
.body { padding: 10px 16mm 14mm; }
.to-block { margin: 14px 0; padding: 10px 14px; border-left: 4px solid #00796b; background: #f4faf9 !important; }
.to-grid { display: flex; gap: 20px; flex-wrap: wrap; }
.to-item { flex: 1; min-width: 140px; }
.to-lbl { font-size: 8px; text-transform: uppercase; color: #00796b; font-weight: 700; letter-spacing: 0.6px; }
.to-val { font-size: 12px; font-weight: 600; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
th { background: #00796b !important; color: #fff !important; font-size: 10px; text-transform: uppercase; padding: 8px 10px; border: 1px solid #00796b; letter-spacing: 0.5px; }
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
    <div class="banner-dc">
      <div class="banner-dc-label">Delivery Challan</div>
      <div class="banner-dc-num">{{challanNumber}}</div>
      <div class="banner-dc-date">{{fmtDate deliveryDate}}</div>
    </div>
  </div>
</div>
<div class="body">
  <div class="to-block">
    <div class="to-grid">
      <div class="to-item"><div class="to-lbl">To (Messers)</div><div class="to-val">{{clientName}}</div></div>
      <div class="to-item"><div class="to-lbl">Address</div><div class="to-val">{{clientAddress}}</div></div>
      {{#if clientSite}}<div class="to-item"><div class="to-lbl">Site</div><div class="to-val">{{clientSite}}</div></div>{{/if}}
      <div class="to-item"><div class="to-lbl">PO No.</div><div class="to-val">{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</div></div>
      {{#if poDate}}<div class="to-item"><div class="to-lbl">PO Date</div><div class="to-val">{{fmtDate poDate}}</div></div>{{/if}}
      {{#if indentNo}}<div class="to-item"><div class="to-lbl">Indent No.</div><div class="to-val">{{indentNo}}</div></div>{{/if}}
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
    <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 5. Monochrome Ink-Saver ──────────────────────────────────────────────
  {
    id: "challan-monochrome-ink-saver",
    name: "Monochrome Ink-Saver",
    type: "Challan",
    description: "Hairline borders only, no fills, pure black-and-white for minimum toner use",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, sans-serif; padding: 12mm; color: #000; font-size: 11pt; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #000; padding-bottom: 10px; margin-bottom: 12px; }
.brand { font-size: 20px; font-weight: 700; text-transform: uppercase; }
.addr { font-size: 9px; margin-top: 4px; line-height: 1.5; }
.dc-block { text-align: right; border: 1px solid #000; padding: 8px 12px; }
.dc-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.dc-num { font-size: 18px; font-weight: 900; margin-top: 4px; }
.dc-date { font-size: 10px; margin-top: 2px; }
.info { margin: 10px 0; font-size: 10pt; line-height: 1.8; }
.info-row { display: flex; }
.info-lbl { min-width: 110px; font-weight: 700; }
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
.sig .line { width: 200px; border-top: 1px solid #000; margin: 0 auto 4px; }
.sig .label { font-size: 8pt; text-transform: uppercase; }
</style></head><body>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:6px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
  </div>
  <div class="dc-block">
    <div class="dc-title">Delivery Challan</div>
    <div class="dc-num">DC # {{challanNumber}}</div>
    <div class="dc-date">{{fmtDate deliveryDate}}</div>
  </div>
</div>
<div class="info">
  <div class="info-row"><span class="info-lbl">To (Messers):</span><span>{{clientName}}</span></div>
  <div class="info-row"><span class="info-lbl">Address:</span><span>{{clientAddress}}</span></div>
  {{#if clientSite}}<div class="info-row"><span class="info-lbl">Site:</span><span>{{clientSite}}</span></div>{{/if}}
  <div class="info-row"><span class="info-lbl">P.O. Number:</span><span>{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</span></div>
  {{#if poDate}}<div class="info-row"><span class="info-lbl">P.O. Date:</span><span>{{fmtDate poDate}}</span></div>{{/if}}
  {{#if indentNo}}<div class="info-row"><span class="info-lbl">Indent No.:</span><span>{{indentNo}}</span></div>{{/if}}
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
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
</div>
</body></html>`,
  },

  // ─── 6. Elegant Premium (charcoal + gold) ─────────────────────────────────
  {
    id: "challan-elegant-premium",
    name: "Elegant Premium",
    type: "Challan",
    description: "Charcoal and gold premium look with ornamental dividers and italic serif accents",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Georgia, "Times New Roman", serif; padding: 13mm; color: #1a1a1a; background: #fff; }
.gold-top { height: 4px; background: #c9a84c !important; margin-bottom: 16px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #c9a84c; }
.brand { font-size: 28px; font-weight: 700; letter-spacing: 2px; color: #1a1a1a; }
.brand-tagline { font-size: 9px; color: #888; letter-spacing: 2px; text-transform: uppercase; margin-top: 4px; }
.addr { font-size: 10px; color: #555; margin-top: 5px; line-height: 1.5; font-style: italic; }
.dc-panel { text-align: right; }
.dc-title { font-size: 10px; letter-spacing: 4px; text-transform: uppercase; color: #c9a84c; font-family: Georgia, serif; }
.dc-num { font-size: 24px; font-weight: 700; color: #1a1a1a; margin-top: 5px; }
.dc-date { font-size: 11px; color: #777; margin-top: 4px; font-style: italic; }
.divider { text-align: center; margin: 10px 0; color: #c9a84c; font-size: 14px; letter-spacing: 8px; }
.info { margin: 10px 0 14px; font-size: 11pt; line-height: 1.9; }
.info-row { display: flex; }
.info-lbl { min-width: 120px; font-weight: 700; color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding-top: 3px; }
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
  <div class="dc-panel">
    <div class="dc-title">Delivery Challan</div>
    <div class="dc-num">{{challanNumber}}</div>
    <div class="dc-date">{{fmtDate deliveryDate}}</div>
  </div>
</div>
<div class="divider">&#9670; &mdash; &#9670;</div>
<div class="info">
  <div class="info-row"><span class="info-lbl">To (Messers)</span><span class="info-val">{{clientName}}</span></div>
  <div class="info-row"><span class="info-lbl">Address</span><span class="info-val">{{clientAddress}}</span></div>
  {{#if clientSite}}<div class="info-row"><span class="info-lbl">Site</span><span class="info-val">{{clientSite}}</span></div>{{/if}}
  <div class="info-row"><span class="info-lbl">P.O. Number</span><span class="info-val">{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</span></div>
  {{#if poDate}}<div class="info-row"><span class="info-lbl">P.O. Date</span><span class="info-val">{{fmtDate poDate}}</span></div>{{/if}}
  {{#if indentNo}}<div class="info-row"><span class="info-lbl">Indent No.</span><span class="info-val">{{indentNo}}</span></div>{{/if}}
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
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
</div>
<div class="gold-bottom"></div>
</body></html>`,
  },

  // ─── 7. Compact Dense ─────────────────────────────────────────────────────
  {
    id: "challan-compact-dense",
    name: "Compact Dense",
    type: "Challan",
    description: "Tight 9pt font, minimal spacing, fits maximum items on one page",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 8mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, sans-serif; padding: 8mm; color: #000; font-size: 9pt; }
.header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 6px; margin-bottom: 6px; border-bottom: 2px solid #333; }
.brand { font-size: 16px; font-weight: 900; text-transform: uppercase; }
.addr { font-size: 8px; color: #444; margin-top: 2px; line-height: 1.4; }
.dc-block { text-align: right; }
.dc-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.dc-num { font-size: 16px; font-weight: 900; }
.dc-date { font-size: 9px; color: #555; }
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
  <div class="dc-block">
    <div class="dc-title">Delivery Challan</div>
    <div class="dc-num">DC # {{challanNumber}}</div>
    <div class="dc-date">{{fmtDate deliveryDate}}</div>
  </div>
</div>
<div class="info">
  <div class="info-item"><span class="info-lbl">To:</span><span>{{clientName}}</span></div>
  <div class="info-item"><span class="info-lbl">Addr:</span><span>{{clientAddress}}</span></div>
  {{#if clientSite}}<div class="info-item"><span class="info-lbl">Site:</span><span>{{clientSite}}</span></div>{{/if}}
  <div class="info-item"><span class="info-lbl">PO:</span><span>{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</span></div>
  {{#if poDate}}<div class="info-item"><span class="info-lbl">PO Date:</span><span>{{fmtDate poDate}}</span></div>{{/if}}
  {{#if indentNo}}<div class="info-item"><span class="info-lbl">Indent:</span><span>{{indentNo}}</span></div>{{/if}}
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
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Sig. &amp; Stamp</div></div>
</div>
</body></html>`,
  },

  // ─── 8. Left Sidebar Color Strip ──────────────────────────────────────────
  {
    id: "challan-left-sidebar",
    name: "Left Sidebar Strip",
    type: "Challan",
    description: "Vertical deep-blue sidebar strip on the left carrying DC number rotated vertically",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #111; display: flex; min-height: 297mm; }
.sidebar { background: #1a237e !important; color: #fff !important; width: 22mm; display: flex; flex-direction: column; align-items: center; padding: 14mm 0; flex-shrink: 0; }
.sidebar-dc-label { font-size: 8px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.75; writing-mode: vertical-rl; transform: rotate(180deg); margin-bottom: 10px; }
.sidebar-dc-num { font-size: 16px; font-weight: 900; writing-mode: vertical-rl; transform: rotate(180deg); letter-spacing: 2px; }
.sidebar-date { font-size: 8px; opacity: 0.75; writing-mode: vertical-rl; transform: rotate(180deg); margin-top: 10px; }
.main { flex: 1; padding: 12mm; }
.top-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; border-bottom: 2px solid #1a237e; padding-bottom: 10px; }
.brand { font-size: 24px; font-weight: 800; color: #1a237e; text-transform: uppercase; }
.addr { font-size: 9px; color: #555; margin-top: 4px; line-height: 1.5; }
.dc-title-inline { font-size: 16px; font-weight: 700; text-transform: uppercase; color: #1a237e; text-align: right; letter-spacing: 1px; }
.info { margin: 12px 0 14px; font-size: 11pt; }
.info-row { display: flex; margin-bottom: 4px; }
.info-lbl { min-width: 120px; font-size: 10px; text-transform: uppercase; color: #1a237e; font-weight: 700; letter-spacing: 0.5px; padding-top: 2px; }
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
  <div class="sidebar-dc-label">Delivery Challan</div>
  <div class="sidebar-dc-num">{{challanNumber}}</div>
  <div class="sidebar-date">{{fmtDate deliveryDate}}</div>
</div>
<div class="main">
  <div class="top-row">
    <div>
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:6px;display:block">{{/if}}
      <div class="brand">{{companyBrandName}}</div>
      <div class="addr">{{{nl2br companyAddress}}}</div>
      <div class="addr">{{{nl2br companyPhone}}}</div>
    </div>
    <div class="dc-title-inline">DC # {{challanNumber}}</div>
  </div>
  <div class="info">
    <div class="info-row"><span class="info-lbl">To (Messers)</span><span class="info-val">{{clientName}}</span></div>
    <div class="info-row"><span class="info-lbl">Address</span><span class="info-val">{{clientAddress}}</span></div>
    {{#if clientSite}}<div class="info-row"><span class="info-lbl">Site</span><span class="info-val">{{clientSite}}</span></div>{{/if}}
    <div class="info-row"><span class="info-lbl">P.O. Number</span><span class="info-val">{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</span></div>
    {{#if poDate}}<div class="info-row"><span class="info-lbl">P.O. Date</span><span class="info-val">{{fmtDate poDate}}</span></div>{{/if}}
    {{#if indentNo}}<div class="info-row"><span class="info-lbl">Indent No.</span><span class="info-val">{{indentNo}}</span></div>{{/if}}
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
    <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 9. Boxed Traditional (heavy boxed sections) ──────────────────────────
  {
    id: "challan-boxed-traditional",
    name: "Boxed Traditional",
    type: "Challan",
    description: "Heavy-bordered box sections for each field group, classic Pakistani wholesale style",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 10mm; color: #000; font-size: 11pt; }
.outer { border: 2px solid #000; }
.title-box { border-bottom: 2px solid #000; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; }
.company-name { font-size: 26px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
.company-meta { font-size: 9px; color: #333; margin-top: 3px; line-height: 1.4; }
.dc-box { border: 2px solid #000; padding: 6px 14px; text-align: center; }
.dc-box .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
.dc-box .num { font-size: 22px; font-weight: 900; margin: 2px 0; }
.dc-box .date { font-size: 11px; }
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
    <div class="dc-box">
      <div class="lbl">Delivery Challan</div>
      <div class="num">{{challanNumber}}</div>
      <div class="date">{{fmtDate deliveryDate}}</div>
    </div>
  </div>
  <div class="fields-row">
    <div class="field-cell" style="flex:2"><div class="field-lbl">To (Messers)</div><div class="field-val">{{clientName}}</div></div>
    <div class="field-cell" style="flex:2"><div class="field-lbl">Address</div><div class="field-val">{{clientAddress}}</div></div>
    <div class="field-cell"><div class="field-lbl">P.O. Number</div><div class="field-val">{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</div></div>
    <div class="field-cell"><div class="field-lbl">P.O. Date</div><div class="field-val">{{#if poDate}}{{fmtDate poDate}}{{else}}&mdash;{{/if}}</div></div>
  </div>
  {{#if clientSite}}<div class="fields-row">
    <div class="field-cell"><div class="field-lbl">Site</div><div class="field-val">{{clientSite}}</div></div>
    {{#if indentNo}}<div class="field-cell"><div class="field-lbl">Indent No.</div><div class="field-val">{{indentNo}}</div></div>{{/if}}
  </div>{{/if}}
  <table>
    <thead><tr><th class="c n">S#</th><th class="c qty">Qty</th><th>Description of Goods</th><th class="c unit">Unit</th></tr></thead>
    <tbody>
      {{#each items}}<tr><td class="cell c n">{{inc @index}}</td><td class="cell c qty">{{this.quantity}}</td><td class="cell">{{{richText this.description}}}</td><td class="cell c unit">{{this.unit}}</td></tr>{{/each}}
      {{emptyRows (math 15 "-" items.length) 4}}
    </tbody>
  </table>
  <div class="recv-box">Received the above goods in good order &amp; condition.</div>
  <div class="sig-box">
    <div class="sig-cell"><div class="lbl">Authorized Signature</div></div>
    <div class="sig-cell"><div class="lbl">Receiver&apos;s Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 10. Bismillah Header ────────────────────────────────────────────────
  {
    id: "challan-bismillah",
    name: "Bismillah Header",
    type: "Challan",
    description: "Centered Bismillah calligraphy line at the top, traditional Pakistani business format",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 12mm; color: #000; font-size: 11pt; }
.bismillah { text-align: center; font-size: 22px; color: #5d4037; margin-bottom: 8px; letter-spacing: 2px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-top: 2px solid #5d4037; border-bottom: 2px solid #5d4037; padding: 10px 0; margin-bottom: 14px; }
.brand { font-size: 24px; font-weight: 900; text-transform: uppercase; color: #3e2723; letter-spacing: 1px; }
.addr { font-size: 9px; color: #5d4037; margin-top: 4px; line-height: 1.5; }
.dc-block { text-align: right; }
.dc-title { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #5d4037; letter-spacing: 2px; }
.dc-num { font-size: 22px; font-weight: 900; color: #3e2723; margin-top: 4px; }
.dc-date { font-size: 11px; color: #6d4c41; margin-top: 3px; font-style: italic; }
.info { margin: 10px 0 14px; font-size: 11pt; line-height: 1.9; }
.info-row { display: flex; }
.info-lbl { min-width: 130px; font-weight: 700; color: #5d4037; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding-top: 2px; }
table { width: 100%; border-collapse: collapse; }
th { background: #4e342e !important; color: #fff !important; font-family: "Times New Roman", serif; font-size: 10px; text-transform: uppercase; padding: 6px 10px; border: 1px solid #4e342e; letter-spacing: 1px; }
th.c { text-align: center; }
td { border: 1px solid #bcaaa4; padding: 5px 10px; font-size: 11pt; height: 26px; }
td.c { text-align: center; }
.n { width: 36px; }
.qty { width: 70px; }
.unit { width: 64px; }
tbody tr:nth-child(even) td { background: #fbe9e7 !important; }
.received { margin-top: 20px; font-size: 10pt; font-style: italic; color: #5d4037; border-top: 1px solid #bcaaa4; padding-top: 8px; }
.footer { margin-top: 36px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1.5px solid #5d4037; margin: 0 auto 4px; }
.sig .label { font-size: 9pt; color: #5d4037; font-style: italic; }
</style></head><body>
<div class="bismillah">&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1729; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1740;&#1605;</div>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:54px;margin-bottom:6px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
  </div>
  <div class="dc-block">
    <div class="dc-title">Delivery Challan</div>
    <div class="dc-num">DC # {{challanNumber}}</div>
    <div class="dc-date">{{fmtDate deliveryDate}}</div>
  </div>
</div>
<div class="info">
  <div class="info-row"><span class="info-lbl">To (Messers)</span><span>{{clientName}}</span></div>
  <div class="info-row"><span class="info-lbl">Address</span><span>{{clientAddress}}</span></div>
  {{#if clientSite}}<div class="info-row"><span class="info-lbl">Site</span><span>{{clientSite}}</span></div>{{/if}}
  <div class="info-row"><span class="info-lbl">P.O. Number</span><span>{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</span></div>
  {{#if poDate}}<div class="info-row"><span class="info-lbl">P.O. Date</span><span>{{fmtDate poDate}}</span></div>{{/if}}
  {{#if indentNo}}<div class="info-row"><span class="info-lbl">Indent No.</span><span>{{indentNo}}</span></div>{{/if}}
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
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
</div>
</body></html>`,
  },

  // ─── 11. Green & Gold ────────────────────────────────────────────────────
  {
    id: "challan-green-gold",
    name: "Green & Gold",
    type: "Challan",
    description: "Pakistani national colors — forest green header with gold accent lines and olive tints",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; color: #1a1a1a; }
.header-wrap { background: #2e7d32 !important; }
.gold-stripe { height: 4px; background: #f9a825 !important; }
.header { padding: 12px 14mm; display: flex; justify-content: space-between; align-items: center; }
.brand { font-size: 26px; font-weight: 900; color: #fff !important; text-transform: uppercase; letter-spacing: 1px; }
.addr { font-size: 9px; color: rgba(255,255,255,0.82); margin-top: 4px; line-height: 1.5; }
.dc-right { text-align: right; }
.dc-title { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: #f9a825; font-weight: 700; }
.dc-num { font-size: 24px; font-weight: 900; color: #fff !important; margin-top: 4px; }
.dc-date { font-size: 11px; color: rgba(255,255,255,0.8); margin-top: 3px; }
.body { padding: 10px 14mm 14mm; }
.info-band { display: flex; gap: 0; margin: 14px 0; border: 1.5px solid #a5d6a7; border-radius: 4px; overflow: hidden; }
.info-band-cell { flex: 1; padding: 7px 10px; border-right: 1px solid #a5d6a7; }
.info-band-cell:last-child { border-right: none; }
.ibl { font-size: 7px; text-transform: uppercase; color: #388e3c; font-weight: 700; letter-spacing: 0.6px; }
.ivl { font-size: 11px; font-weight: 600; margin-top: 2px; }
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
    <div class="dc-right">
      <div class="dc-title">Delivery Challan</div>
      <div class="dc-num">DC # {{challanNumber}}</div>
      <div class="dc-date">{{fmtDate deliveryDate}}</div>
    </div>
  </div>
  <div class="gold-stripe"></div>
</div>
<div class="body">
  <div class="info-band">
    <div class="info-band-cell"><div class="ibl">To (Messers)</div><div class="ivl">{{clientName}}</div></div>
    <div class="info-band-cell"><div class="ibl">Address</div><div class="ivl">{{clientAddress}}</div></div>
    {{#if clientSite}}<div class="info-band-cell"><div class="ibl">Site</div><div class="ivl">{{clientSite}}</div></div>{{/if}}
    <div class="info-band-cell"><div class="ibl">PO Number</div><div class="ivl">{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</div></div>
    {{#if indentNo}}<div class="info-band-cell"><div class="ibl">Indent No.</div><div class="ivl">{{indentNo}}</div></div>{{/if}}
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
    <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 12. Teal / Slate Two-Tone ────────────────────────────────────────────
  {
    id: "challan-teal-slate",
    name: "Teal & Slate Two-Tone",
    type: "Challan",
    description: "Split two-tone header — teal company panel left, slate DC panel right",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Calibri, Arial, sans-serif; color: #111; }
.header { display: flex; height: 72px; }
.header-left { background: #00838f !important; flex: 1; display: flex; align-items: center; gap: 12px; padding: 0 14mm; }
.header-left .hl-logo img { height: 50px; }
.hl-name { font-size: 22px; font-weight: 800; color: #fff !important; text-transform: uppercase; letter-spacing: 0.5px; }
.hl-addr { font-size: 8px; color: rgba(255,255,255,0.8); margin-top: 3px; line-height: 1.4; }
.header-right { background: #455a64 !important; width: 140px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; padding: 0 12px; }
.hr-title { font-size: 8px; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.7); }
.hr-num { font-size: 20px; font-weight: 900; color: #fff !important; margin-top: 3px; }
.hr-date { font-size: 9px; color: rgba(255,255,255,0.7); margin-top: 3px; }
.body { padding: 10px 14mm 14mm; }
.info-row-wrap { display: flex; gap: 0; margin: 14px 0; border: 1px solid #b0bec5; border-radius: 3px; }
.irc { flex: 1; border-right: 1px solid #b0bec5; padding: 7px 10px; }
.irc:last-child { border-right: none; }
.irc-lbl { font-size: 7px; text-transform: uppercase; color: #00838f; font-weight: 700; letter-spacing: 0.6px; }
.irc-val { font-size: 11px; font-weight: 600; margin-top: 2px; }
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
    <div class="hr-title">Delivery Challan</div>
    <div class="hr-num">{{challanNumber}}</div>
    <div class="hr-date">{{fmtDate deliveryDate}}</div>
  </div>
</div>
<div class="body">
  <div class="info-row-wrap">
    <div class="irc"><div class="irc-lbl">To (Messers)</div><div class="irc-val">{{clientName}}</div></div>
    <div class="irc"><div class="irc-lbl">Address</div><div class="irc-val">{{clientAddress}}</div></div>
    {{#if clientSite}}<div class="irc"><div class="irc-lbl">Site</div><div class="irc-val">{{clientSite}}</div></div>{{/if}}
    <div class="irc"><div class="irc-lbl">PO Number</div><div class="irc-val">{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</div></div>
    {{#if indentNo}}<div class="irc"><div class="irc-lbl">Indent No.</div><div class="irc-val">{{indentNo}}</div></div>{{/if}}
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
    <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 13. Big Letterhead ───────────────────────────────────────────────────
  {
    id: "challan-big-letterhead",
    name: "Big Letterhead",
    type: "Challan",
    description: "Oversized centered company name as letterhead with ruled lines and logo prominent",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 12mm; color: #111; }
.letterhead { text-align: center; padding-bottom: 10px; border-bottom: 3px solid #1565c0; margin-bottom: 6px; }
.lh-logo { margin-bottom: 6px; }
.lh-name { font-size: 36px; font-weight: 900; text-transform: uppercase; color: #1565c0; letter-spacing: 3px; }
.lh-sub { font-size: 10px; color: #777; margin-top: 4px; letter-spacing: 0.5px; }
.lh-contact { font-size: 9px; color: #555; margin-top: 3px; line-height: 1.5; }
.sub-rule { height: 1px; background: #1565c0; margin-bottom: 12px; }
.doc-meta { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.dc-badge-wrap { text-align: right; }
.dc-badge { display: inline-block; border: 2px solid #1565c0; padding: 6px 16px; }
.dc-badge .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #1565c0; font-weight: 700; }
.dc-badge .num { font-size: 20px; font-weight: 900; color: #1565c0; margin-top: 2px; }
.dc-badge .date { font-size: 10px; color: #777; margin-top: 2px; }
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
    <div class="info-row"><span class="info-lbl">To (Messers)</span><span>{{clientName}}</span></div>
    <div class="info-row"><span class="info-lbl">Address</span><span>{{clientAddress}}</span></div>
    {{#if clientSite}}<div class="info-row"><span class="info-lbl">Site</span><span>{{clientSite}}</span></div>{{/if}}
    <div class="info-row"><span class="info-lbl">P.O. Number</span><span>{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</span></div>
    {{#if poDate}}<div class="info-row"><span class="info-lbl">P.O. Date</span><span>{{fmtDate poDate}}</span></div>{{/if}}
    {{#if indentNo}}<div class="info-row"><span class="info-lbl">Indent No.</span><span>{{indentNo}}</span></div>{{/if}}
  </div>
  <div class="dc-badge-wrap">
    <div class="dc-badge">
      <div class="lbl">Delivery Challan</div>
      <div class="num">{{challanNumber}}</div>
      <div class="date">{{fmtDate deliveryDate}}</div>
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
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
</div>
</body></html>`,
  },

  // ─── 14. Centered Title / Faint Watermark ────────────────────────────────
  {
    id: "challan-watermark",
    name: "Centered Title & Watermark",
    type: "Challan",
    description: "Centered document title with a faint diagonal COPY watermark behind the table",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, "Segoe UI", sans-serif; padding: 12mm; color: #111; position: relative; }
.wm { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-40deg); font-size: 90px; font-weight: 900; color: rgba(0,0,0,0.05) !important; text-transform: uppercase; letter-spacing: 10px; pointer-events: none; z-index: 0; white-space: nowrap; }
.content { position: relative; z-index: 1; }
.header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 8px; margin-bottom: 4px; }
.brand { font-size: 22px; font-weight: 800; text-transform: uppercase; color: #263238; }
.addr { font-size: 9px; color: #607d8b; margin-top: 3px; line-height: 1.5; }
.dc-title-center { text-align: center; margin: 8px 0 4px; }
.dc-title-text { font-size: 18px; font-weight: 900; text-transform: uppercase; letter-spacing: 4px; border-bottom: 2px solid #263238; display: inline-block; padding-bottom: 3px; }
.meta-row { display: flex; justify-content: center; gap: 30px; font-size: 11px; margin: 6px 0 14px; color: #555; }
.meta-row b { color: #111; }
.info { margin: 10px 0 12px; font-size: 11pt; line-height: 1.8; }
.info-row { display: flex; }
.info-lbl { min-width: 120px; font-weight: 700; color: #607d8b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; padding-top: 2px; }
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
<div class="wm">{{companyBrandName}}</div>
<div class="content">
  <div class="header">
    <div>
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:5px;display:block">{{/if}}
      <div class="brand">{{companyBrandName}}</div>
      <div class="addr">{{{nl2br companyAddress}}}</div>
      <div class="addr">{{{nl2br companyPhone}}}</div>
    </div>
  </div>
  <div class="dc-title-center"><div class="dc-title-text">Delivery Challan</div></div>
  <div class="meta-row">
    <span><b>DC #:</b> {{challanNumber}}</span>
    <span><b>Date:</b> {{fmtDate deliveryDate}}</span>
    {{#if poNumber}}<span><b>PO #:</b> {{poNumber}}</span>{{/if}}
    {{#if indentNo}}<span><b>Indent:</b> {{indentNo}}</span>{{/if}}
  </div>
  <div class="info">
    <div class="info-row"><span class="info-lbl">To (Messers)</span><span>{{clientName}}</span></div>
    <div class="info-row"><span class="info-lbl">Address</span><span>{{clientAddress}}</span></div>
    {{#if clientSite}}<div class="info-row"><span class="info-lbl">Site</span><span>{{clientSite}}</span></div>{{/if}}
    {{#if poDate}}<div class="info-row"><span class="info-lbl">P.O. Date</span><span>{{fmtDate poDate}}</span></div>{{/if}}
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
    <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver&apos;s Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 15. Government-Form Grid (heavy bordered cells) ──────────────────────
  {
    id: "challan-government-form",
    name: "Government Form Grid",
    type: "Challan",
    description: "Heavy-ruled form-style grid with labeled header cells, mimicking official government forms",
    html: `<!DOCTYPE html><html><head><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, sans-serif; padding: 10mm; color: #000; font-size: 10pt; }
.outer { border: 2.5px solid #000; }
.title-row { border-bottom: 2px solid #000; display: flex; align-items: stretch; }
.title-logo { border-right: 2px solid #000; padding: 8px 12px; display: flex; align-items: center; justify-content: center; min-width: 70px; }
.title-main { flex: 1; text-align: center; padding: 8px; }
.title-company { font-size: 20px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
.title-addr { font-size: 8px; color: #333; margin-top: 3px; line-height: 1.4; }
.title-doc { border-left: 2px solid #000; padding: 8px 12px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; min-width: 120px; text-align: right; }
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
      <div class="title-addr">{{{nl2br companyAddress}}}</div>
      <div class="title-addr">{{{nl2br companyPhone}}}</div>
    </div>
    <div class="title-doc">
      <div class="doc-name">Delivery Challan</div>
      <div class="doc-num">{{challanNumber}}</div>
      <div class="doc-date">{{fmtDate deliveryDate}}</div>
    </div>
  </div>
  <table class="field-table">
    <tr>
      <td style="width:35%"><span class="lbl">To (Messers)</span><span class="val">{{clientName}}</span></td>
      <td style="width:35%"><span class="lbl">Address</span><span class="val">{{clientAddress}}</span></td>
      <td style="width:15%"><span class="lbl">P.O. Number</span><span class="val">{{#if poNumber}}{{poNumber}}{{else}}&mdash;{{/if}}</span></td>
      <td style="width:15%"><span class="lbl">P.O. Date</span><span class="val">{{#if poDate}}{{fmtDate poDate}}{{else}}&mdash;{{/if}}</span></td>
    </tr>
    <tr>
      <td><span class="lbl">Site</span><span class="val">{{#if clientSite}}{{clientSite}}{{else}}&mdash;{{/if}}</span></td>
      <td><span class="lbl">Indent No.</span><span class="val">{{#if indentNo}}{{indentNo}}{{else}}&mdash;{{/if}}</span></td>
      <td colspan="2"><span class="lbl">Delivery Date</span><span class="val">{{fmtDate deliveryDate}}</span></td>
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
      <td>Authorized Signature &amp; Stamp</td>
      <td>Receiver&apos;s Signature &amp; Stamp</td>
    </tr>
  </table>
</div>
</body></html>`,
  },

];
