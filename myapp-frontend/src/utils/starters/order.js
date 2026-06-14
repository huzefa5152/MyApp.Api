// Starter templates for Sales Order (quantity-only, fulfilment-tracking) documents.
// Rendered via Handlebars — see utils/templateEngine.js for registered helpers.
// type: "SalesOrder" for all entries.

export const orderStarters = [

  /* ─── 1. Classic Serif ─────────────────────────────────────────────────── */
  {
    id: "order-classic-serif",
    name: "Classic Serif",
    type: "SalesOrder",
    description: "Traditional serif typeface with ruled dividers — formal and timeless",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:Georgia,"Times New Roman",serif; font-size:12px; color:#1a1a1a; padding:6px; }
.page-border { border:1.5px solid #333; padding:18px; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px double #333; padding-bottom:12px; margin-bottom:14px; }
.brand { display:flex; align-items:center; gap:14px; }
.brand img { height:62px; }
.cname { font-size:22px; font-weight:700; letter-spacing:1px; }
.caddr { font-size:11px; color:#444; margin-top:4px; line-height:1.5; }
.doc { text-align:right; }
.doc .t { font-size:26px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#1a1a1a; }
.doc .meta { font-size:11.5px; margin-top:6px; line-height:1.7; }
.parties { display:flex; justify-content:space-between; gap:20px; margin-bottom:14px; }
.box .lbl { font-size:10px; text-transform:uppercase; letter-spacing:.8px; color:#666; font-weight:700; border-bottom:1px solid #ccc; padding-bottom:2px; margin-bottom:4px; }
.box .v { font-size:13px; font-weight:700; }
.box .s { font-size:11px; color:#444; margin-top:2px; }
.statusline { margin-top:6px; font-size:12px; border:1px solid #aaa; display:inline-block; padding:3px 10px; }
table { width:100%; border-collapse:collapse; margin-top:14px; }
thead tr { border-top:2px solid #333; border-bottom:2px solid #333; }
th { font-size:11px; text-transform:uppercase; padding:7px 8px; text-align:left; background:transparent; color:#1a1a1a; font-weight:700; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #ddd; padding:6px 8px; font-size:12px; }
tbody tr:nth-child(even) td { background:#f7f7f5 !important; }
td.rem { font-weight:700; }
.cell { background:#fafaf8 !important; }
tfoot td { font-style:italic; font-size:11px; color:#555; padding-top:4px; }
.sig { display:flex; justify-content:space-between; margin-top:50px; }
.sig .b { text-align:center; }
.sig .line { width:180px; border-top:1.5px solid #333; }
.sig .l { font-size:11px; margin-top:3px; font-style:italic; }
@media print { @page { size:A4; margin:11mm; } }
</style></head><body>
<div class="page-border">
  <div class="hdr">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="doc">
      <div class="t">Sales Order</div>
      <div class="meta">
        <div><strong>Order No:</strong> {{salesOrderNumber}}</div>
        <div><strong>Order Date:</strong> {{fmtDate orderDate}}</div>
        {{#if requiredDate}}<div><strong>Required By:</strong> {{fmtDate requiredDate}}</div>{{/if}}
        {{#if customerPoNumber}}<div><strong>Customer PO:</strong> {{customerPoNumber}} {{#if customerPoDate}}/ {{fmtDate customerPoDate}}{{/if}}</div>{{/if}}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="box">
      <div class="lbl">Customer</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
    </div>
    <div class="box" style="text-align:right">
      <div class="lbl">Fulfilment Status</div>
      <div class="statusline">{{status}}</div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th class="c" style="width:34px">#</th>
      <th>Description</th>
      <th class="c" style="width:66px">Ordered</th>
      <th class="c" style="width:58px">Unit</th>
      <th class="c" style="width:76px">Delivered</th>
      <th class="c" style="width:76px">Remaining</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{#if this.itemTypeName}}<span style="font-size:10px;color:#777;">{{this.itemTypeName}} &mdash; </span>{{/if}}{{this.description}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="c">{{this.deliveredQuantity}}</td>
        <td class="c rem">{{this.remainingQuantity}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 14 "-" items.length) 6}}
    </tbody>
  </table>

  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">Received By</div></div>
    <div class="b"><div class="line"></div><div class="l">Authorised Signature &mdash; For {{companyBrandName}}</div></div>
  </div>
</div>
</body></html>`,
  },

  /* ─── 2. Modern Minimal ─────────────────────────────────────────────────── */
  {
    id: "order-modern-minimal",
    name: "Modern Minimal",
    type: "SalesOrder",
    description: "Clean sans-serif layout with generous whitespace and thin accent line",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:"Segoe UI",Arial,sans-serif; font-size:12px; color:#222; padding:4px; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:16px; border-bottom:1px solid #e0e0e0; }
.brand { display:flex; align-items:center; gap:14px; }
.brand img { height:58px; }
.cname { font-size:20px; font-weight:800; color:#111; text-transform:uppercase; letter-spacing:1.5px; }
.caddr { font-size:11px; color:#777; margin-top:3px; line-height:1.4; }
.doc .t { font-size:28px; font-weight:300; letter-spacing:6px; text-transform:uppercase; color:#555; }
.doc .accent { width:40px; height:3px; background:#2196f3; margin:6px 0 6px auto; }
.doc .meta { font-size:11.5px; color:#444; line-height:1.7; text-align:right; }
.parties { display:flex; gap:30px; margin-top:18px; }
.box { flex:1; }
.box .lbl { font-size:9px; text-transform:uppercase; letter-spacing:1.5px; color:#aaa; margin-bottom:4px; }
.box .v { font-size:14px; font-weight:700; color:#111; }
.box .s { font-size:11px; color:#666; margin-top:2px; }
.status-pill { display:inline-block; margin-top:8px; padding:3px 12px; border:1px solid #2196f3; border-radius:12px; color:#2196f3; font-size:11px; font-weight:600; }
table { width:100%; border-collapse:collapse; margin-top:20px; }
th { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#aaa; padding:6px 8px; border-bottom:2px solid #e0e0e0; font-weight:600; background:transparent; text-align:left; }
th.c, td.c { text-align:center; }
td { padding:8px; font-size:12px; border-bottom:1px solid #f0f0f0; color:#333; }
.rem-cell { font-weight:700; color:#111; }
.cell { }
.sig { display:flex; justify-content:flex-end; margin-top:50px; }
.sig .b { text-align:center; }
.sig .line { width:200px; border-top:1px solid #aaa; }
.sig .l { font-size:11px; margin-top:3px; color:#777; }
@media print { @page { size:A4; margin:12mm; } }
</style></head><body>
  <div class="hdr">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="doc">
      <div class="t">Sales Order</div>
      <div class="accent"></div>
      <div class="meta">
        <div><strong>Order #</strong> {{salesOrderNumber}}</div>
        <div>{{fmtDate orderDate}}</div>
        {{#if requiredDate}}<div>Required By: {{fmtDate requiredDate}}</div>{{/if}}
        {{#if customerPoNumber}}<div>PO: {{customerPoNumber}}{{#if customerPoDate}} / {{fmtDate customerPoDate}}{{/if}}</div>{{/if}}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="box">
      <div class="lbl">Bill To</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
    </div>
    <div class="box" style="text-align:right">
      <div class="lbl">Fulfilment Status</div>
      <div class="status-pill">{{status}}</div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th class="c" style="width:34px">#</th>
      <th>Description</th>
      <th class="c" style="width:66px">Ordered</th>
      <th class="c" style="width:58px">Unit</th>
      <th class="c" style="width:76px">Delivered</th>
      <th class="c" style="width:76px">Remaining</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c" style="color:#aaa">{{this.sNo}}</td>
        <td>{{#if this.itemTypeName}}<span style="font-size:10px;color:#bbb;text-transform:uppercase;letter-spacing:.5px;">{{this.itemTypeName}} </span><br>{{/if}}{{this.description}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c" style="color:#888">{{this.uom}}</td>
        <td class="c">{{this.deliveredQuantity}}</td>
        <td class="c rem-cell">{{this.remainingQuantity}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 14 "-" items.length) 6}}
    </tbody>
  </table>

  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
  </div>
</body></html>`,
  },

  /* ─── 3. Corporate Navy Band ─────────────────────────────────────────────── */
  {
    id: "order-corporate-navy",
    name: "Corporate Navy Band",
    type: "SalesOrder",
    description: "Navy header band with white-on-dark title — professional corporate style",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:"Segoe UI",Arial,sans-serif; font-size:12px; color:#1a2332; padding:0; }
.top-band { background:#0d3b72 !important; color:#fff !important; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; }
.brand { display:flex; align-items:center; gap:14px; }
.brand img { height:58px; filter:brightness(10); }
.cname { font-size:22px; font-weight:800; color:#fff !important; text-transform:uppercase; letter-spacing:1px; }
.caddr { font-size:11px; color:#b0c4de !important; margin-top:3px; line-height:1.4; }
.doc-title { text-align:right; }
.doc-title .t { font-size:28px; font-weight:300; color:#fff !important; letter-spacing:5px; text-transform:uppercase; }
.doc-title .sub { font-size:12px; color:#b0c4de !important; margin-top:4px; line-height:1.6; }
.meta-bar { background:#e8eef7 !important; padding:10px 18px; display:flex; gap:30px; flex-wrap:wrap; border-bottom:1px solid #c5d4e8; }
.meta-bar .item .lbl { font-size:9px; text-transform:uppercase; letter-spacing:1px; color:#888; }
.meta-bar .item .v { font-size:12px; font-weight:700; color:#0d3b72; }
.body-pad { padding:14px 18px; }
.parties { display:flex; gap:24px; margin-bottom:14px; }
.box .lbl { font-size:10px; text-transform:uppercase; color:#888; font-weight:700; letter-spacing:.5px; }
.box .v { font-size:13px; font-weight:700; margin-top:3px; }
.box .s { font-size:11px; color:#555; margin-top:2px; }
.status-badge { background:#0d3b72 !important; color:#fff !important; display:inline-block; padding:4px 14px; border-radius:3px; font-size:12px; font-weight:700; }
table { width:100%; border-collapse:collapse; margin-top:10px; }
th { background:#0d3b72 !important; color:#fff !important; font-size:11px; text-transform:uppercase; padding:8px 10px; text-align:left; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #dde4ef; padding:7px 10px; font-size:12px; }
tbody tr:nth-child(even) td { background:#f0f4fb !important; }
td.rem { font-weight:800; color:#0d3b72; }
.cell { background:#f7f9fd !important; }
.footer-band { background:#0d3b72 !important; color:#b0c4de !important; padding:10px 18px; margin-top:30px; display:flex; justify-content:space-between; font-size:11px; }
.sig-line { border-top:1px solid #b0c4de; width:180px; display:inline-block; }
@media print { @page { size:A4; margin:0; } body { padding:0; } }
</style></head><body>
  <div class="top-band">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="doc-title">
      <div class="t">Sales Order</div>
      <div class="sub"># {{salesOrderNumber}}</div>
    </div>
  </div>

  <div class="meta-bar">
    <div class="item"><div class="lbl">Order Date</div><div class="v">{{fmtDate orderDate}}</div></div>
    {{#if requiredDate}}<div class="item"><div class="lbl">Required By</div><div class="v">{{fmtDate requiredDate}}</div></div>{{/if}}
    {{#if customerPoNumber}}<div class="item"><div class="lbl">Customer PO</div><div class="v">{{customerPoNumber}}</div></div>{{/if}}
    {{#if customerPoDate}}<div class="item"><div class="lbl">PO Date</div><div class="v">{{fmtDate customerPoDate}}</div></div>{{/if}}
  </div>

  <div class="body-pad">
    <div class="parties">
      <div class="box" style="flex:2">
        <div class="lbl">Customer</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
      </div>
      <div class="box" style="flex:1; text-align:right">
        <div class="lbl">Fulfilment Status</div>
        <div style="margin-top:6px"><span class="status-badge">{{status}}</span></div>
      </div>
    </div>

    <table>
      <thead><tr>
        <th class="c" style="width:34px">#</th>
        <th>Description</th>
        <th class="c" style="width:66px">Ordered</th>
        <th class="c" style="width:58px">Unit</th>
        <th class="c" style="width:76px">Delivered</th>
        <th class="c" style="width:80px; background:#07285a !important;">Remaining</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{#if this.itemTypeName}}<span style="font-size:10px;color:#888;">{{this.itemTypeName}}</span><br>{{/if}}{{this.description}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="c">{{this.deliveredQuantity}}</td>
          <td class="c rem">{{this.remainingQuantity}}</td>
        </tr>
      {{/each}}
      {{emptyRows (math 13 "-" items.length) 6}}
      </tbody>
    </table>
  </div>

  <div class="footer-band">
    <span>Delivery Instructions: Handle with care. Partial deliveries accepted.</span>
    <span><div class="sig-line"></div><br>Authorised Signature</span>
  </div>
</body></html>`,
  },

  /* ─── 4. Bold Colored Banner ─────────────────────────────────────────────── */
  {
    id: "order-bold-banner",
    name: "Bold Colored Banner",
    type: "SalesOrder",
    description: "High-impact teal banner header with vivid accent colors for remaining qty",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:"Segoe UI",Arial,sans-serif; font-size:12px; color:#222; padding:4px; }
.banner { background:#00695c !important; color:#fff !important; padding:18px 20px; display:flex; justify-content:space-between; align-items:center; border-radius:3px 3px 0 0; }
.brand { display:flex; align-items:center; gap:14px; }
.brand img { height:60px; background:#fff; border-radius:3px; padding:2px; }
.cname { font-size:24px; font-weight:900; color:#fff !important; text-transform:uppercase; letter-spacing:1.5px; }
.caddr { font-size:11px; color:#a5d6a7 !important; margin-top:3px; line-height:1.4; }
.order-num { text-align:right; }
.order-num .label { font-size:12px; color:#a5d6a7 !important; text-transform:uppercase; letter-spacing:2px; }
.order-num .num { font-size:30px; font-weight:900; color:#fff !important; letter-spacing:2px; }
.sub-banner { background:#004d40 !important; color:#80cbc4 !important; padding:8px 20px; display:flex; gap:30px; font-size:11px; }
.sub-banner strong { color:#fff !important; }
.content { padding:14px 4px; }
.parties { display:flex; gap:20px; margin-bottom:14px; align-items:flex-start; }
.cust-block { flex:2; background:#e0f2f1 !important; padding:10px 14px; border-left:4px solid #00897b; }
.cust-block .lbl { font-size:10px; text-transform:uppercase; color:#00695c; font-weight:700; letter-spacing:.5px; }
.cust-block .v { font-size:14px; font-weight:800; color:#004d40; margin-top:3px; }
.cust-block .s { font-size:11px; color:#555; margin-top:2px; }
.status-block { flex:1; background:#00897b !important; color:#fff !important; padding:10px 14px; text-align:center; border-radius:3px; }
.status-block .lbl { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#b2dfdb !important; }
.status-block .v { font-size:16px; font-weight:800; color:#fff !important; margin-top:4px; }
table { width:100%; border-collapse:collapse; }
th { background:#00897b !important; color:#fff !important; font-size:11px; text-transform:uppercase; padding:8px 10px; text-align:left; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #e0f2f1; padding:7px 10px; font-size:12px; }
tbody tr:nth-child(even) td { background:#f1f9f8 !important; }
.rem-td { background:#00695c !important; color:#fff !important; font-weight:800; }
tbody tr:nth-child(even) .rem-td { background:#00695c !important; color:#fff !important; }
.cell { }
.sig { display:flex; justify-content:space-between; margin-top:46px; padding:0 4px; }
.sig .b { text-align:center; }
.sig .line { border-top:2px solid #00897b; width:180px; }
.sig .l { font-size:11px; margin-top:3px; color:#444; }
@media print { @page { size:A4; margin:10mm; } }
</style></head><body>
  <div class="banner">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="order-num">
      <div class="label">Sales Order</div>
      <div class="num"># {{salesOrderNumber}}</div>
    </div>
  </div>
  <div class="sub-banner">
    <span>Date: <strong>{{fmtDate orderDate}}</strong></span>
    {{#if requiredDate}}<span>Required By: <strong>{{fmtDate requiredDate}}</strong></span>{{/if}}
    {{#if customerPoNumber}}<span>PO: <strong>{{customerPoNumber}}</strong>{{#if customerPoDate}} dated <strong>{{fmtDate customerPoDate}}</strong>{{/if}}</span>{{/if}}
  </div>

  <div class="content">
    <div class="parties">
      <div class="cust-block">
        <div class="lbl">Customer</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if site}}<div class="s"><strong>Site:</strong> {{site}}</div>{{/if}}
      </div>
      <div class="status-block">
        <div class="lbl">Fulfilment Status</div>
        <div class="v">{{status}}</div>
      </div>
    </div>

    <table>
      <thead><tr>
        <th class="c" style="width:34px">#</th>
        <th>Description</th>
        <th class="c" style="width:66px">Ordered</th>
        <th class="c" style="width:58px">Unit</th>
        <th class="c" style="width:76px">Delivered</th>
        <th class="c" style="width:80px; background:#004d40 !important;">Remaining</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{#if this.itemTypeName}}<span style="font-size:10px;color:#00897b;font-weight:700;">{{this.itemTypeName}}</span><br>{{/if}}{{this.description}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="c">{{this.deliveredQuantity}}</td>
          <td class="c rem-td">{{this.remainingQuantity}}</td>
        </tr>
      {{/each}}
      {{emptyRows (math 13 "-" items.length) 6}}
      </tbody>
    </table>

    <div class="sig">
      <div class="b"><div class="line"></div><div class="l">Received By</div></div>
      <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
    </div>
  </div>
</body></html>`,
  },

  /* ─── 5. Monochrome Ink-Saver ────────────────────────────────────────────── */
  {
    id: "order-monochrome",
    name: "Monochrome Ink-Saver",
    type: "SalesOrder",
    description: "Black and white only — minimal ink usage, crisp plain borders, zero backgrounds",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:Arial,sans-serif; font-size:11px; color:#000; padding:4px; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #000; padding-bottom:10px; margin-bottom:10px; }
.brand { display:flex; align-items:center; gap:12px; }
.brand img { height:54px; filter:grayscale(100%); }
.cname { font-size:20px; font-weight:900; text-transform:uppercase; letter-spacing:1px; }
.caddr { font-size:10px; margin-top:3px; line-height:1.4; }
.doc { text-align:right; }
.doc .t { font-size:24px; font-weight:900; text-transform:uppercase; letter-spacing:3px; }
.doc .meta { font-size:11px; margin-top:6px; line-height:1.6; }
.parties { display:flex; gap:20px; margin-bottom:10px; }
.box { flex:1; border:1px solid #000; padding:8px; }
.box .lbl { font-size:9px; text-transform:uppercase; font-weight:700; letter-spacing:.8px; border-bottom:1px solid #000; padding-bottom:2px; margin-bottom:4px; }
.box .v { font-size:12px; font-weight:700; }
.box .s { font-size:10px; margin-top:2px; }
table { width:100%; border-collapse:collapse; margin-top:10px; }
th { border:1px solid #000; font-size:10px; text-transform:uppercase; padding:5px 7px; text-align:left; font-weight:700; background:transparent; color:#000; }
th.c, td.c { text-align:center; }
td { border:1px solid #aaa; padding:5px 7px; font-size:11px; }
td.rem { font-weight:900; border:1.5px solid #000; }
.cell { }
.statusline { margin-top:10px; font-size:11.5px; font-weight:700; border:1px solid #000; display:inline-block; padding:3px 10px; }
.sig { display:flex; justify-content:space-between; margin-top:46px; }
.sig .b { text-align:center; }
.sig .line { width:180px; border-top:1px solid #000; }
.sig .l { font-size:10px; margin-top:2px; }
.note { margin-top:12px; font-size:10px; border:1px dashed #000; padding:6px; }
@media print { @page { size:A4; margin:12mm; } }
</style></head><body>
  <div class="hdr">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="doc">
      <div class="t">Sales Order</div>
      <div class="meta">
        <div><strong>Order #:</strong> {{salesOrderNumber}}</div>
        <div><strong>Date:</strong> {{fmtDate orderDate}}</div>
        {{#if requiredDate}}<div><strong>Required By:</strong> {{fmtDate requiredDate}}</div>{{/if}}
        {{#if customerPoNumber}}<div><strong>Cust. PO:</strong> {{customerPoNumber}}{{#if customerPoDate}} / {{fmtDate customerPoDate}}{{/if}}</div>{{/if}}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="box">
      <div class="lbl">Customer</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
    </div>
    <div class="box">
      <div class="lbl">Fulfilment Status</div>
      <div class="v" style="margin-top:6px;">{{status}}</div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th class="c" style="width:30px">#</th>
      <th>Description</th>
      <th class="c" style="width:60px">Ordered</th>
      <th class="c" style="width:52px">Unit</th>
      <th class="c" style="width:68px">Delivered</th>
      <th class="c" style="width:68px">Remaining</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{#if this.itemTypeName}}({{this.itemTypeName}}) {{/if}}{{this.description}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="c">{{this.deliveredQuantity}}</td>
        <td class="c rem">{{this.remainingQuantity}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 15 "-" items.length) 6}}
    </tbody>
  </table>

  <div class="statusline">Fulfilment Status: {{status}}</div>

  <div class="note">Delivery Instructions: Partial deliveries acceptable. Kindly inform before dispatch.</div>

  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">Customer Signature</div></div>
    <div class="b"><div class="line"></div><div class="l">Authorised Signature / For {{companyBrandName}}</div></div>
  </div>
</body></html>`,
  },

  /* ─── 6. Elegant Premium (Charcoal + Gold) ───────────────────────────────── */
  {
    id: "order-elegant-premium",
    name: "Elegant Premium",
    type: "SalesOrder",
    description: "Charcoal and gold luxury feel — ideal for high-value clients",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:Georgia,"Times New Roman",serif; font-size:12px; color:#1c1c1c; padding:4px; background:#fff; }
.outer { border:1px solid #c8a951; padding:16px; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #c8a951; padding-bottom:14px; margin-bottom:14px; }
.brand { display:flex; align-items:center; gap:14px; }
.brand img { height:62px; }
.cname { font-size:22px; font-weight:700; color:#1c1c1c; letter-spacing:2px; text-transform:uppercase; }
.cgold { color:#c8a951; }
.caddr { font-size:11px; color:#666; margin-top:4px; line-height:1.5; }
.doc { text-align:right; }
.doc .t { font-size:26px; font-weight:400; letter-spacing:5px; text-transform:uppercase; color:#2c2c2c; }
.doc .gold-bar { width:60px; height:2px; background:#c8a951; margin:8px 0 8px auto; }
.doc .meta { font-size:11.5px; color:#444; line-height:1.7; }
.doc .meta strong { color:#1c1c1c; }
.parties { display:flex; gap:24px; margin-bottom:14px; }
.box { flex:1; }
.box .lbl { font-size:9px; text-transform:uppercase; letter-spacing:1.5px; color:#c8a951; font-weight:700; margin-bottom:4px; }
.box .v { font-size:13px; font-weight:700; }
.box .s { font-size:11px; color:#555; margin-top:2px; }
.status-tag { border:1px solid #c8a951; color:#1c1c1c; font-size:11.5px; font-weight:700; display:inline-block; padding:3px 14px; letter-spacing:1px; }
table { width:100%; border-collapse:collapse; margin-top:12px; }
thead tr { background:#2c2c2c !important; }
th { background:#2c2c2c !important; color:#c8a951 !important; font-size:10px; text-transform:uppercase; letter-spacing:1px; padding:9px 10px; text-align:left; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #e8e0cc; padding:8px 10px; font-size:12px; }
tbody tr:nth-child(even) td { background:#faf7f0 !important; }
td.rem { font-weight:700; color:#8a6914; background:#fef9e7 !important; }
tbody tr:nth-child(even) td.rem { background:#fef9e7 !important; }
.cell { }
.sig { display:flex; justify-content:space-between; margin-top:50px; }
.sig .b { text-align:center; }
.sig .line { width:200px; border-top:1.5px solid #c8a951; }
.sig .l { font-size:11px; margin-top:3px; color:#666; font-style:italic; }
@media print { @page { size:A4; margin:12mm; } }
</style></head><body>
<div class="outer">
  <div class="hdr">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div>
        <div class="cname"><span class="cgold">&#9670;</span> {{companyBrandName}} <span class="cgold">&#9670;</span></div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="doc">
      <div class="t">Sales Order</div>
      <div class="gold-bar"></div>
      <div class="meta">
        <div><strong>Order No:</strong> {{salesOrderNumber}}</div>
        <div><strong>Date:</strong> {{fmtDate orderDate}}</div>
        {{#if requiredDate}}<div><strong>Required By:</strong> {{fmtDate requiredDate}}</div>{{/if}}
        {{#if customerPoNumber}}<div><strong>Customer PO:</strong> {{customerPoNumber}}{{#if customerPoDate}} &mdash; {{fmtDate customerPoDate}}{{/if}}</div>{{/if}}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="box">
      <div class="lbl">Customer</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
    </div>
    <div class="box" style="text-align:right">
      <div class="lbl">Fulfilment Status</div>
      <div style="margin-top:6px"><span class="status-tag">{{status}}</span></div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th class="c" style="width:34px">#</th>
      <th>Description</th>
      <th class="c" style="width:66px">Ordered</th>
      <th class="c" style="width:58px">Unit</th>
      <th class="c" style="width:76px">Delivered</th>
      <th class="c" style="width:80px">Remaining</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{#if this.itemTypeName}}<span style="font-size:10px;color:#c8a951;">{{this.itemTypeName}} &mdash; </span>{{/if}}{{this.description}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="c">{{this.deliveredQuantity}}</td>
        <td class="c rem">{{this.remainingQuantity}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 13 "-" items.length) 6}}
    </tbody>
  </table>

  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">Received / Accepted By</div></div>
    <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
  </div>
</div>
</body></html>`,
  },

  /* ─── 7. Compact Dense ───────────────────────────────────────────────────── */
  {
    id: "order-compact-dense",
    name: "Compact Dense",
    type: "SalesOrder",
    description: "Very small font and tight rows — fits maximum lines on one A4 page",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:"Segoe UI",Arial,sans-serif; font-size:10px; color:#111; padding:3px; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid #999; padding-bottom:7px; margin-bottom:7px; }
.brand { display:flex; align-items:center; gap:8px; }
.brand img { height:44px; }
.cname { font-size:14px; font-weight:800; text-transform:uppercase; }
.caddr { font-size:9px; color:#555; margin-top:2px; line-height:1.3; }
.doc { text-align:right; }
.doc .t { font-size:16px; font-weight:800; text-transform:uppercase; letter-spacing:2px; color:#1a56a8; }
.doc .meta { font-size:10px; line-height:1.5; margin-top:3px; }
.parties { display:flex; gap:14px; margin-bottom:7px; }
.box { flex:1; }
.box .lbl { font-size:8px; text-transform:uppercase; color:#888; font-weight:700; letter-spacing:.5px; }
.box .v { font-size:11px; font-weight:700; }
.box .s { font-size:9px; color:#555; }
.statusline { font-size:10px; font-weight:700; margin-bottom:6px; }
table { width:100%; border-collapse:collapse; }
th { background:#1a56a8 !important; color:#fff !important; font-size:9px; text-transform:uppercase; padding:5px 6px; text-align:left; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #eee; padding:4px 6px; font-size:10px; }
tbody tr:nth-child(even) td { background:#f5f7fb !important; }
td.rem { font-weight:800; background:#e8f0fe !important; color:#1a56a8; }
tbody tr:nth-child(even) td.rem { background:#e8f0fe !important; }
.cell { }
.sig { display:flex; justify-content:flex-end; margin-top:30px; }
.sig .b { text-align:center; }
.sig .line { width:160px; border-top:1px solid #666; }
.sig .l { font-size:9px; margin-top:2px; color:#555; }
@media print { @page { size:A4; margin:10mm; } }
</style></head><body>
  <div class="hdr">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="doc">
      <div class="t">Sales Order</div>
      <div class="meta">
        <strong>Order #:</strong> {{salesOrderNumber}}&nbsp;|&nbsp;<strong>Date:</strong> {{fmtDate orderDate}}
        {{#if requiredDate}}&nbsp;|&nbsp;<strong>Req By:</strong> {{fmtDate requiredDate}}{{/if}}
        {{#if customerPoNumber}}&nbsp;|&nbsp;<strong>PO:</strong> {{customerPoNumber}}{{#if customerPoDate}} ({{fmtDate customerPoDate}}){{/if}}{{/if}}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="box">
      <div class="lbl">Customer</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
    </div>
  </div>
  <div class="statusline">Fulfilment Status: {{status}}</div>

  <table>
    <thead><tr>
      <th class="c" style="width:26px">#</th>
      <th>Description</th>
      <th class="c" style="width:54px">Type</th>
      <th class="c" style="width:52px">Ordered</th>
      <th class="c" style="width:46px">Unit</th>
      <th class="c" style="width:60px">Delivered</th>
      <th class="c" style="width:60px">Remaining</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{this.description}}</td>
        <td class="c" style="font-size:9px;color:#777;">{{this.itemTypeName}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="c">{{this.deliveredQuantity}}</td>
        <td class="c rem">{{this.remainingQuantity}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 20 "-" items.length) 7}}
    </tbody>
  </table>

  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">Authorised Signature</div></div>
  </div>
</body></html>`,
  },

  /* ─── 8. Left Sidebar Strip ──────────────────────────────────────────────── */
  {
    id: "order-left-sidebar",
    name: "Left Sidebar Strip",
    type: "SalesOrder",
    description: "Vertical colored sidebar on the left carries company details — distinctive layout",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:"Segoe UI",Arial,sans-serif; font-size:12px; color:#1a1a2e; display:flex; min-height:100vh; padding:0; }
.sidebar { width:100px; background:#1a1a2e !important; color:#fff !important; display:flex; flex-direction:column; align-items:center; padding:20px 8px; gap:14px; flex-shrink:0; }
.sidebar img { height:54px; filter:brightness(10); }
.sidebar .sname { font-size:9px; text-transform:uppercase; letter-spacing:1px; color:#8892b0 !important; text-align:center; line-height:1.4; margin-top:6px; font-weight:700; }
.sidebar .saddr { font-size:8px; color:#6272a4 !important; text-align:center; line-height:1.4; margin-top:4px; }
.sidebar .rot { writing-mode:vertical-rl; transform:rotate(180deg); font-size:18px; font-weight:900; letter-spacing:6px; text-transform:uppercase; color:#6272a4 !important; margin-top:auto; }
.main { flex:1; padding:16px 18px; }
.top { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1a1a2e; padding-bottom:10px; margin-bottom:12px; }
.doc .t { font-size:26px; font-weight:900; text-transform:uppercase; letter-spacing:3px; color:#1a1a2e; }
.doc .meta { font-size:11.5px; color:#444; line-height:1.7; margin-top:6px; }
.parties { display:flex; gap:20px; margin-bottom:12px; }
.box { flex:1; }
.box .lbl { font-size:9px; text-transform:uppercase; letter-spacing:1px; color:#8892b0; font-weight:700; margin-bottom:3px; }
.box .v { font-size:13px; font-weight:800; color:#1a1a2e; }
.box .s { font-size:11px; color:#555; margin-top:2px; }
.status-chip { background:#1a1a2e !important; color:#fff !important; border-radius:2px; display:inline-block; padding:3px 12px; font-size:11.5px; font-weight:700; }
table { width:100%; border-collapse:collapse; margin-top:8px; }
th { background:#1a1a2e !important; color:#8892b0 !important; font-size:10px; text-transform:uppercase; letter-spacing:1px; padding:8px 8px; text-align:left; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #e8e8f0; padding:7px 8px; font-size:12px; }
tbody tr:nth-child(even) td { background:#f4f4f8 !important; }
td.rem { font-weight:800; color:#1a1a2e; background:#e8e8f0 !important; }
tbody tr:nth-child(even) td.rem { background:#e8e8f0 !important; }
.cell { }
.sig { display:flex; justify-content:flex-end; margin-top:46px; }
.sig .b { text-align:center; }
.sig .line { width:200px; border-top:1.5px solid #1a1a2e; }
.sig .l { font-size:11px; margin-top:3px; color:#666; }
@media print { @page { size:A4; margin:0; } body { min-height:auto; } }
</style></head><body>
  <div class="sidebar">
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
    <div class="sname">{{companyBrandName}}</div>
    {{#if companyPhone}}<div class="saddr">{{{nl2br companyPhone}}}</div>{{/if}}
    <div class="rot">Sales Order</div>
  </div>
  <div class="main">
    <div class="top">
      <div>
        <div class="doc"><div class="t">Sales Order</div></div>
        {{#if companyAddress}}<div style="font-size:10px;color:#666;margin-top:4px;">{{{nl2br companyAddress}}}</div>{{/if}}
      </div>
      <div class="doc" style="text-align:right">
        <div class="meta">
          <div><strong>Order #:</strong> {{salesOrderNumber}}</div>
          <div><strong>Date:</strong> {{fmtDate orderDate}}</div>
          {{#if requiredDate}}<div><strong>Required By:</strong> {{fmtDate requiredDate}}</div>{{/if}}
          {{#if customerPoNumber}}<div><strong>PO:</strong> {{customerPoNumber}}{{#if customerPoDate}} / {{fmtDate customerPoDate}}{{/if}}</div>{{/if}}
        </div>
      </div>
    </div>

    <div class="parties">
      <div class="box">
        <div class="lbl">Customer</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
      </div>
      <div class="box" style="text-align:right">
        <div class="lbl">Fulfilment Status</div>
        <div style="margin-top:5px"><span class="status-chip">{{status}}</span></div>
      </div>
    </div>

    <table>
      <thead><tr>
        <th class="c" style="width:30px">#</th>
        <th>Description</th>
        <th class="c" style="width:64px">Ordered</th>
        <th class="c" style="width:55px">Unit</th>
        <th class="c" style="width:74px">Delivered</th>
        <th class="c" style="width:74px">Remaining</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{#if this.itemTypeName}}<span style="font-size:9px;color:#8892b0;">{{this.itemTypeName}}</span><br>{{/if}}{{this.description}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="c">{{this.deliveredQuantity}}</td>
          <td class="c rem">{{this.remainingQuantity}}</td>
        </tr>
      {{/each}}
      {{emptyRows (math 13 "-" items.length) 6}}
      </tbody>
    </table>

    <div class="sig">
      <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
    </div>
  </div>
</body></html>`,
  },

  /* ─── 9. Boxed Traditional ───────────────────────────────────────────────── */
  {
    id: "order-boxed-traditional",
    name: "Boxed Traditional",
    type: "SalesOrder",
    description: "Every section in a bordered box — structured traditional accounting style",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:Arial,sans-serif; font-size:11.5px; color:#111; padding:4px; }
.outer { border:2px solid #333; padding:0; }
.top-box { display:flex; border-bottom:2px solid #333; }
.logo-cell { border-right:1px solid #888; padding:12px; display:flex; align-items:center; justify-content:center; min-width:120px; }
.logo-cell img { height:58px; }
.name-cell { flex:1; padding:10px 14px; border-right:1px solid #888; }
.cname { font-size:21px; font-weight:900; text-transform:uppercase; letter-spacing:1px; }
.caddr { font-size:10.5px; color:#444; margin-top:3px; line-height:1.4; }
.doc-cell { padding:10px 14px; text-align:right; min-width:200px; }
.doc-cell .t { font-size:22px; font-weight:900; text-transform:uppercase; letter-spacing:2px; color:#2c3e50; }
.doc-cell .meta { font-size:11px; margin-top:6px; line-height:1.6; }
.info-row { display:flex; border-bottom:1px solid #888; }
.info-cell { flex:1; padding:8px 12px; border-right:1px solid #ddd; }
.info-cell:last-child { border-right:none; }
.info-cell .lbl { font-size:9px; text-transform:uppercase; font-weight:700; color:#666; letter-spacing:.5px; }
.info-cell .v { font-size:12px; font-weight:700; margin-top:3px; }
.info-cell .s { font-size:10.5px; color:#444; }
.status-box { border-left:3px solid #2c3e50; padding-left:8px; }
table { width:100%; border-collapse:collapse; }
th { background:#2c3e50 !important; color:#fff !important; font-size:10.5px; text-transform:uppercase; padding:8px 10px; text-align:left; border-right:1px solid #1a252f; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #ddd; border-right:1px solid #eee; padding:6px 10px; font-size:11.5px; }
td:last-child { border-right:none; }
tbody tr:nth-child(even) td { background:#f5f6f8 !important; }
td.rem { font-weight:800; background:#eaf1fb !important; color:#2c3e50; }
tbody tr:nth-child(even) td.rem { background:#eaf1fb !important; }
.cell { }
.sig-row { display:flex; border-top:2px solid #333; }
.sig-cell { flex:1; border-right:1px solid #888; padding:40px 12px 10px; text-align:center; }
.sig-cell:last-child { border-right:none; }
.sig-cell .line { border-top:1px solid #666; width:60%; margin:0 auto 4px; }
.sig-cell .l { font-size:10px; color:#555; }
@media print { @page { size:A4; margin:10mm; } }
</style></head><body>
<div class="outer">
  <div class="top-box">
    <div class="logo-cell">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{else}}<div style="width:80px;height:50px;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;font-size:9px;color:#aaa;">LOGO</div>{{/if}}
    </div>
    <div class="name-cell">
      <div class="cname">{{companyBrandName}}</div>
      {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
      {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
    </div>
    <div class="doc-cell">
      <div class="t">Sales Order</div>
      <div class="meta">
        <div><strong>Order #:</strong> {{salesOrderNumber}}</div>
        <div><strong>Date:</strong> {{fmtDate orderDate}}</div>
        {{#if requiredDate}}<div><strong>Req. By:</strong> {{fmtDate requiredDate}}</div>{{/if}}
      </div>
    </div>
  </div>
  <div class="info-row">
    <div class="info-cell" style="flex:2">
      <div class="lbl">Customer</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
    </div>
    {{#if customerPoNumber}}
    <div class="info-cell">
      <div class="lbl">Customer PO</div>
      <div class="v">{{customerPoNumber}}</div>
      {{#if customerPoDate}}<div class="s">{{fmtDate customerPoDate}}</div>{{/if}}
    </div>
    {{/if}}
    <div class="info-cell">
      <div class="lbl">Fulfilment Status</div>
      <div class="v status-box">{{status}}</div>
    </div>
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:34px">#</th>
      <th>Description</th>
      <th class="c" style="width:66px">Ordered</th>
      <th class="c" style="width:58px">Unit</th>
      <th class="c" style="width:76px">Delivered</th>
      <th class="c" style="width:80px">Remaining</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{#if this.itemTypeName}}<span style="font-size:9.5px;color:#777;">{{this.itemTypeName}} &mdash; </span>{{/if}}{{this.description}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="c">{{this.deliveredQuantity}}</td>
        <td class="c rem">{{this.remainingQuantity}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 13 "-" items.length) 6}}
    </tbody>
  </table>
  <div class="sig-row">
    <div class="sig-cell"><div class="line"></div><div class="l">Prepared By</div></div>
    <div class="sig-cell"><div class="line"></div><div class="l">Authorised Signature</div></div>
    <div class="sig-cell"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
  </div>
</div>
</body></html>`,
  },

  /* ─── 10. Bismillah Header ────────────────────────────────────────────────── */
  {
    id: "order-bismillah",
    name: "Bismillah Header",
    type: "SalesOrder",
    description: "Opens with Bismillah in Arabic script — traditional Islamic business etiquette",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:"Segoe UI",Arial,sans-serif; font-size:12px; color:#1a1a1a; padding:4px; }
.bismillah { text-align:center; font-family:"Noto Nastaliq Urdu","Jameel Noori Nastaleeq","Arabic Typesetting",serif; font-size:22px; color:#1a6e3a; padding:10px 0 6px; border-bottom:1px solid #ddd; margin-bottom:14px; direction:rtl; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:12px; border-bottom:3px solid #1a6e3a; margin-bottom:14px; }
.brand { display:flex; align-items:center; gap:12px; }
.brand img { height:60px; }
.cname { font-size:21px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#1a3a2a; }
.caddr { font-size:11px; color:#555; margin-top:3px; line-height:1.4; }
.doc { text-align:right; }
.doc .t { font-size:24px; font-weight:800; text-transform:uppercase; letter-spacing:3px; color:#1a6e3a; }
.doc .meta { font-size:11.5px; margin-top:6px; line-height:1.7; color:#333; }
.parties { display:flex; gap:20px; margin-bottom:14px; }
.box { flex:1; }
.box .lbl { font-size:10px; text-transform:uppercase; color:#1a6e3a; font-weight:700; letter-spacing:.5px; margin-bottom:3px; }
.box .v { font-size:13px; font-weight:700; }
.box .s { font-size:11px; color:#555; margin-top:2px; }
.status-line { margin-bottom:8px; font-size:12.5px; font-weight:700; color:#1a3a2a; }
table { width:100%; border-collapse:collapse; margin-top:8px; }
thead tr { background:#1a6e3a !important; }
th { background:#1a6e3a !important; color:#fff !important; font-size:11px; text-transform:uppercase; padding:8px 10px; text-align:left; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #d4e8d8; padding:7px 10px; font-size:12px; }
tbody tr:nth-child(even) td { background:#f0f7f2 !important; }
td.rem { font-weight:800; color:#1a6e3a; background:#d4f0dc !important; }
tbody tr:nth-child(even) td.rem { background:#d4f0dc !important; }
.cell { }
.sig { display:flex; justify-content:space-between; margin-top:46px; }
.sig .b { text-align:center; }
.sig .line { width:180px; border-top:1.5px solid #1a6e3a; }
.sig .l { font-size:11px; margin-top:3px; color:#555; }
.delivery-note { margin-top:12px; font-size:11px; color:#444; border:1px dashed #1a6e3a; padding:7px 10px; border-radius:2px; }
@media print { @page { size:A4; margin:11mm; } }
</style></head><body>
  <div class="bismillah">بسم اللہ الرحمٰن الرحیم</div>

  <div class="hdr">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="doc">
      <div class="t">Sales Order</div>
      <div class="meta">
        <div><strong>Order #:</strong> {{salesOrderNumber}}</div>
        <div><strong>Order Date:</strong> {{fmtDate orderDate}}</div>
        {{#if requiredDate}}<div><strong>Required By:</strong> {{fmtDate requiredDate}}</div>{{/if}}
        {{#if customerPoNumber}}<div><strong>Customer PO:</strong> {{customerPoNumber}}{{#if customerPoDate}} / {{fmtDate customerPoDate}}{{/if}}</div>{{/if}}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="box">
      <div class="lbl">Customer</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
    </div>
    <div class="box" style="text-align:right">
      <div class="lbl">Fulfilment Status</div>
      <div class="v" style="margin-top:4px;color:#1a6e3a;">{{status}}</div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th class="c" style="width:34px">#</th>
      <th>Description</th>
      <th class="c" style="width:66px">Ordered</th>
      <th class="c" style="width:58px">Unit</th>
      <th class="c" style="width:76px">Delivered</th>
      <th class="c" style="width:80px">Remaining</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{#if this.itemTypeName}}<span style="font-size:10px;color:#1a6e3a;font-weight:600;">{{this.itemTypeName}} &mdash; </span>{{/if}}{{this.description}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="c">{{this.deliveredQuantity}}</td>
        <td class="c rem">{{this.remainingQuantity}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 13 "-" items.length) 6}}
    </tbody>
  </table>

  <div class="delivery-note">Delivery Instructions: Please ensure items are delivered in good condition. Partial delivery allowed upon mutual agreement.</div>

  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">Customer Acknowledgement</div></div>
    <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
  </div>
</body></html>`,
  },

  /* ─── 11. Green & Gold ────────────────────────────────────────────────────── */
  {
    id: "order-green-gold",
    name: "Green & Gold",
    type: "SalesOrder",
    description: "Forest green and gold colour scheme — popular in Pakistani trade stationery",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:"Segoe UI",Arial,sans-serif; font-size:12px; color:#1c2416; padding:4px; }
.hdr { background:#1e4d2b !important; color:#fff !important; padding:16px 18px; display:flex; justify-content:space-between; align-items:center; }
.brand { display:flex; align-items:center; gap:14px; }
.brand img { height:58px; background:#fff; border-radius:3px; padding:2px; }
.cname { font-size:22px; font-weight:800; color:#f0c040 !important; text-transform:uppercase; letter-spacing:1.5px; }
.caddr { font-size:10.5px; color:#a8c5a0 !important; margin-top:3px; line-height:1.4; }
.doc-title { text-align:right; }
.doc-title .t { font-size:26px; font-weight:300; color:#f0c040 !important; letter-spacing:4px; text-transform:uppercase; }
.doc-title .meta { font-size:11.5px; color:#d4e8c8 !important; margin-top:5px; line-height:1.6; }
.gold-bar { height:4px; background:#f0c040 !important; }
.content { padding:14px 4px; }
.parties { display:flex; gap:20px; margin-bottom:12px; }
.box { flex:1; }
.box .lbl { font-size:9px; text-transform:uppercase; letter-spacing:1px; color:#1e4d2b; font-weight:800; margin-bottom:3px; }
.box .v { font-size:13px; font-weight:700; color:#1c2416; }
.box .s { font-size:11px; color:#555; margin-top:2px; }
.status-badge { background:#1e4d2b !important; color:#f0c040 !important; display:inline-block; padding:4px 14px; font-size:12px; font-weight:700; border-radius:2px; }
table { width:100%; border-collapse:collapse; }
th { background:#1e4d2b !important; color:#f0c040 !important; font-size:11px; text-transform:uppercase; padding:8px 10px; text-align:left; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #d4e8c8; padding:7px 10px; font-size:12px; }
tbody tr:nth-child(even) td { background:#f2f8f0 !important; }
td.rem { font-weight:800; background:#fffbe6 !important; color:#8a6914; }
tbody tr:nth-child(even) td.rem { background:#fffbe6 !important; }
.cell { }
.footer { margin-top:12px; border:1px dashed #1e4d2b; padding:7px; font-size:11px; color:#444; }
.sig { display:flex; justify-content:space-between; margin-top:44px; }
.sig .b { text-align:center; }
.sig .line { width:180px; border-top:2px solid #f0c040; }
.sig .l { font-size:11px; margin-top:3px; color:#555; }
@media print { @page { size:A4; margin:10mm; } }
</style></head><body>
  <div class="hdr">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="doc-title">
      <div class="t">Sales Order</div>
      <div class="meta">
        <div>Order # {{salesOrderNumber}}</div>
        <div>{{fmtDate orderDate}}</div>
        {{#if requiredDate}}<div>Req. By: {{fmtDate requiredDate}}</div>{{/if}}
        {{#if customerPoNumber}}<div>PO: {{customerPoNumber}}{{#if customerPoDate}} / {{fmtDate customerPoDate}}{{/if}}</div>{{/if}}
      </div>
    </div>
  </div>
  <div class="gold-bar"></div>

  <div class="content">
    <div class="parties">
      <div class="box" style="flex:2">
        <div class="lbl">Customer</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
      </div>
      <div class="box" style="text-align:right">
        <div class="lbl">Fulfilment Status</div>
        <div style="margin-top:5px"><span class="status-badge">{{status}}</span></div>
      </div>
    </div>

    <table>
      <thead><tr>
        <th class="c" style="width:34px">#</th>
        <th>Description</th>
        <th class="c" style="width:66px">Ordered</th>
        <th class="c" style="width:58px">Unit</th>
        <th class="c" style="width:76px">Delivered</th>
        <th class="c" style="width:80px; background:#163a1f !important; color:#f0c040 !important;">Remaining</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{#if this.itemTypeName}}<span style="font-size:10px;color:#1e4d2b;font-weight:700;">{{this.itemTypeName}}</span><br>{{/if}}{{this.description}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="c">{{this.deliveredQuantity}}</td>
          <td class="c rem">{{this.remainingQuantity}}</td>
        </tr>
      {{/each}}
      {{emptyRows (math 13 "-" items.length) 6}}
      </tbody>
    </table>

    <div class="footer">Terms: Goods once dispatched are non-returnable without prior written consent. All disputes subject to local jurisdiction.</div>

    <div class="sig">
      <div class="b"><div class="line"></div><div class="l">Customer Signature</div></div>
      <div class="b"><div class="line"></div><div class="l">Authorised Signature / For {{companyBrandName}}</div></div>
    </div>
  </div>
</body></html>`,
  },

  /* ─── 12. Teal / Slate ────────────────────────────────────────────────────── */
  {
    id: "order-teal-slate",
    name: "Teal / Slate",
    type: "SalesOrder",
    description: "Teal accent on slate grey body — modern business-casual feel",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:"Segoe UI",Arial,sans-serif; font-size:12px; color:#2d3748; padding:4px; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:12px; border-bottom:3px solid #2b9aa0; margin-bottom:14px; }
.brand { display:flex; align-items:center; gap:14px; }
.brand img { height:60px; }
.cname { font-size:20px; font-weight:800; color:#1a3a40; text-transform:uppercase; letter-spacing:1px; }
.caddr { font-size:11px; color:#718096; margin-top:3px; line-height:1.4; }
.doc { text-align:right; }
.doc .t { font-size:26px; font-weight:800; text-transform:uppercase; letter-spacing:3px; color:#2b9aa0; }
.doc .meta { font-size:11.5px; color:#4a5568; line-height:1.7; margin-top:6px; }
.meta-tags { display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
.tag { background:#e6f7f8 !important; color:#1a3a40; font-size:10.5px; font-weight:700; padding:3px 10px; border-radius:12px; border:1px solid #b2e0e4; }
.parties { display:flex; gap:20px; margin-bottom:14px; }
.box { flex:1; }
.box .lbl { font-size:9px; text-transform:uppercase; letter-spacing:1.2px; color:#718096; font-weight:700; margin-bottom:3px; }
.box .v { font-size:13px; font-weight:700; color:#1a2532; }
.box .s { font-size:11px; color:#718096; margin-top:2px; }
.status-tag { background:#2b9aa0 !important; color:#fff !important; display:inline-block; padding:4px 14px; border-radius:3px; font-size:12px; font-weight:700; }
table { width:100%; border-collapse:collapse; margin-top:4px; }
th { background:#2b9aa0 !important; color:#fff !important; font-size:10.5px; text-transform:uppercase; letter-spacing:.5px; padding:8px 10px; text-align:left; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #e2e8f0; padding:7px 10px; font-size:12px; }
tbody tr:nth-child(even) td { background:#f7fafa !important; }
td.rem { font-weight:800; background:#d1fafa !important; color:#1a3a40; }
tbody tr:nth-child(even) td.rem { background:#d1fafa !important; }
.cell { }
.sig { display:flex; justify-content:space-between; margin-top:46px; }
.sig .b { text-align:center; }
.sig .line { width:180px; border-top:2px solid #2b9aa0; }
.sig .l { font-size:11px; margin-top:3px; color:#718096; }
@media print { @page { size:A4; margin:11mm; } }
</style></head><body>
  <div class="hdr">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="doc">
      <div class="t">Sales Order</div>
      <div class="meta">
        <div><strong>Order #</strong> {{salesOrderNumber}}</div>
        <div><strong>Date:</strong> {{fmtDate orderDate}}</div>
        {{#if requiredDate}}<div><strong>Required By:</strong> {{fmtDate requiredDate}}</div>{{/if}}
        {{#if customerPoNumber}}<div><strong>Customer PO:</strong> {{customerPoNumber}}{{#if customerPoDate}} / {{fmtDate customerPoDate}}{{/if}}</div>{{/if}}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="box" style="flex:2">
      <div class="lbl">Customer</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
    </div>
    <div class="box" style="text-align:right">
      <div class="lbl">Fulfilment Status</div>
      <div style="margin-top:5px"><span class="status-tag">{{status}}</span></div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th class="c" style="width:34px">#</th>
      <th>Description</th>
      <th class="c" style="width:66px">Ordered</th>
      <th class="c" style="width:58px">Unit</th>
      <th class="c" style="width:76px">Delivered</th>
      <th class="c" style="width:80px; background:#1a7880 !important;">Remaining</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c" style="color:#a0aec0">{{this.sNo}}</td>
        <td>{{#if this.itemTypeName}}<span style="font-size:10px;color:#2b9aa0;font-weight:600;">{{this.itemTypeName}}</span><br>{{/if}}{{this.description}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c" style="color:#718096">{{this.uom}}</td>
        <td class="c">{{this.deliveredQuantity}}</td>
        <td class="c rem">{{this.remainingQuantity}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 13 "-" items.length) 6}}
    </tbody>
  </table>

  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">Received By</div></div>
    <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
  </div>
</body></html>`,
  },

  /* ─── 13. Big Letterhead ──────────────────────────────────────────────────── */
  {
    id: "order-big-letterhead",
    name: "Big Letterhead",
    type: "SalesOrder",
    description: "Full-width prominent letterhead with large logo area — looks like official stationery",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:"Segoe UI",Arial,sans-serif; font-size:12px; color:#1a1a1a; padding:0; }
.letterhead { border-bottom:4px solid #c0392b; padding:20px 20px 14px; display:flex; flex-direction:column; align-items:center; gap:6px; }
.letterhead img { height:72px; }
.lh-cname { font-size:28px; font-weight:900; text-transform:uppercase; letter-spacing:3px; color:#1a1a1a; }
.lh-sub { font-size:12px; color:#666; letter-spacing:1px; }
.lh-addr { font-size:11px; color:#555; margin-top:4px; text-align:center; line-height:1.4; }
.doc-band { background:#c0392b !important; color:#fff !important; padding:10px 20px; display:flex; justify-content:space-between; align-items:center; }
.doc-band .t { font-size:22px; font-weight:900; text-transform:uppercase; letter-spacing:3px; color:#fff !important; }
.doc-band .num { font-size:18px; font-weight:700; color:#ffc8c0 !important; }
.meta-strip { background:#fef5f5 !important; padding:9px 20px; display:flex; gap:24px; border-bottom:1px solid #f0c8c8; flex-wrap:wrap; }
.meta-strip .item .lbl { font-size:9px; text-transform:uppercase; color:#aaa; letter-spacing:.8px; }
.meta-strip .item .v { font-size:12px; font-weight:700; color:#c0392b; }
.content { padding:14px 20px; }
.parties { display:flex; gap:20px; margin-bottom:14px; }
.box { flex:1; }
.box .lbl { font-size:10px; text-transform:uppercase; color:#c0392b; font-weight:700; letter-spacing:.5px; border-bottom:1px solid #f0c8c8; padding-bottom:3px; margin-bottom:4px; }
.box .v { font-size:13px; font-weight:800; color:#1a1a1a; margin-top:3px; }
.box .s { font-size:11px; color:#555; margin-top:2px; }
.statusline { font-size:13px; font-weight:700; margin-bottom:8px; color:#c0392b; }
table { width:100%; border-collapse:collapse; }
th { background:#c0392b !important; color:#fff !important; font-size:11px; text-transform:uppercase; padding:8px 10px; text-align:left; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #f0c8c8; padding:7px 10px; font-size:12px; }
tbody tr:nth-child(even) td { background:#fef5f5 !important; }
td.rem { font-weight:800; background:#ffe0d8 !important; color:#c0392b; }
tbody tr:nth-child(even) td.rem { background:#ffe0d8 !important; }
.cell { }
.footer-lh { border-top:4px solid #c0392b; margin-top:30px; padding-top:12px; display:flex; justify-content:space-between; align-items:flex-end; padding:12px 20px 0; }
.sig .b { text-align:center; }
.sig .line { width:180px; border-top:1.5px solid #c0392b; }
.sig .l { font-size:11px; margin-top:3px; color:#666; }
@media print { @page { size:A4; margin:0; } .letterhead, .doc-band, .meta-strip { page-break-inside:avoid; } }
</style></head><body>
  <div class="letterhead">
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
    <div class="lh-cname">{{companyBrandName}}</div>
    {{#if companyAddress}}<div class="lh-addr">{{{nl2br companyAddress}}}</div>{{/if}}
    {{#if companyPhone}}<div class="lh-addr">{{{nl2br companyPhone}}}</div>{{/if}}
  </div>

  <div class="doc-band">
    <div class="t">Sales Order</div>
    <div class="num">Order # {{salesOrderNumber}}</div>
  </div>

  <div class="meta-strip">
    <div class="item"><div class="lbl">Order Date</div><div class="v">{{fmtDate orderDate}}</div></div>
    {{#if requiredDate}}<div class="item"><div class="lbl">Required By</div><div class="v">{{fmtDate requiredDate}}</div></div>{{/if}}
    {{#if customerPoNumber}}<div class="item"><div class="lbl">Customer PO</div><div class="v">{{customerPoNumber}}</div></div>{{/if}}
    {{#if customerPoDate}}<div class="item"><div class="lbl">PO Date</div><div class="v">{{fmtDate customerPoDate}}</div></div>{{/if}}
    <div class="item"><div class="lbl">Status</div><div class="v">{{status}}</div></div>
  </div>

  <div class="content">
    <div class="parties">
      <div class="box">
        <div class="lbl">Customer</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
      </div>
    </div>

    <table>
      <thead><tr>
        <th class="c" style="width:34px">#</th>
        <th>Description</th>
        <th class="c" style="width:66px">Ordered</th>
        <th class="c" style="width:58px">Unit</th>
        <th class="c" style="width:76px">Delivered</th>
        <th class="c" style="width:80px; background:#922b1e !important;">Remaining</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{#if this.itemTypeName}}<span style="font-size:10px;color:#c0392b;">{{this.itemTypeName}}</span><br>{{/if}}{{this.description}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="c">{{this.deliveredQuantity}}</td>
          <td class="c rem">{{this.remainingQuantity}}</td>
        </tr>
      {{/each}}
      {{emptyRows (math 12 "-" items.length) 6}}
      </tbody>
    </table>
  </div>

  <div class="footer-lh">
    <div style="font-size:11px;color:#888;">This is a computer-generated document. No signature required for digital copy.</div>
    <div class="sig"><div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div></div>
  </div>
</body></html>`,
  },

  /* ─── 14. Centered / Watermark Title ─────────────────────────────────────── */
  {
    id: "order-centered-watermark",
    name: "Centered / Watermark Title",
    type: "SalesOrder",
    description: "Document title centered at the top as a large watermark-style text over the header",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:"Segoe UI",Arial,sans-serif; font-size:12px; color:#1a2332; padding:4px; }
.title-band { text-align:center; padding:20px 0 8px; position:relative; }
.title-band .watermark { font-size:60px; font-weight:900; text-transform:uppercase; letter-spacing:12px; color:#f0f2f5; position:absolute; top:10px; left:50%; transform:translateX(-50%); white-space:nowrap; z-index:0; user-select:none; pointer-events:none; }
.title-band .title { font-size:26px; font-weight:900; text-transform:uppercase; letter-spacing:5px; color:#3558a8; position:relative; z-index:1; }
.title-band .order-num { font-size:15px; color:#555; margin-top:4px; position:relative; z-index:1; }
.divider { border:none; border-top:2px solid #3558a8; margin:10px 0; }
.hdr-cols { display:flex; justify-content:space-between; gap:20px; margin-bottom:14px; }
.co-block { flex:1; }
.co-block .brand { display:flex; align-items:center; gap:10px; }
.co-block .brand img { height:54px; }
.co-block .cname { font-size:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#1a2332; }
.co-block .caddr { font-size:11px; color:#666; margin-top:3px; line-height:1.4; }
.meta-block { text-align:right; }
.meta-block .lbl { font-size:9px; text-transform:uppercase; color:#aaa; letter-spacing:.8px; }
.meta-block .v { font-size:12px; font-weight:700; color:#3558a8; margin-bottom:3px; }
.parties { display:flex; gap:20px; margin-bottom:12px; }
.box { flex:1; }
.box .lbl { font-size:9px; text-transform:uppercase; color:#aaa; letter-spacing:.8px; }
.box .v { font-size:13px; font-weight:800; color:#1a2332; margin-top:2px; }
.box .s { font-size:11px; color:#666; margin-top:2px; }
.status-center { text-align:center; margin-bottom:10px; }
.status-center .chip { background:#3558a8 !important; color:#fff !important; padding:4px 20px; border-radius:12px; font-size:12px; font-weight:700; display:inline-block; letter-spacing:1px; }
table { width:100%; border-collapse:collapse; }
th { background:#3558a8 !important; color:#fff !important; font-size:11px; text-transform:uppercase; padding:8px 10px; text-align:left; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #e8ecf5; padding:7px 10px; font-size:12px; }
tbody tr:nth-child(even) td { background:#f4f6fb !important; }
td.rem { font-weight:800; color:#3558a8; background:#e8ecf5 !important; }
tbody tr:nth-child(even) td.rem { background:#e8ecf5 !important; }
.cell { }
.sig { display:flex; justify-content:space-between; margin-top:46px; }
.sig .b { text-align:center; }
.sig .line { width:180px; border-top:1.5px solid #3558a8; }
.sig .l { font-size:11px; margin-top:3px; color:#666; }
@media print { @page { size:A4; margin:11mm; } }
</style></head><body>
  <div class="title-band">
    <div class="watermark">SALES ORDER</div>
    <div class="title">Sales Order</div>
    <div class="order-num">Order # {{salesOrderNumber}}</div>
  </div>
  <hr class="divider">

  <div class="hdr-cols">
    <div class="co-block">
      <div class="brand">
        {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
        <div>
          <div class="cname">{{companyBrandName}}</div>
          {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
          {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
        </div>
      </div>
    </div>
    <div class="meta-block">
      <div class="lbl">Order Date</div><div class="v">{{fmtDate orderDate}}</div>
      {{#if requiredDate}}<div class="lbl">Required By</div><div class="v">{{fmtDate requiredDate}}</div>{{/if}}
      {{#if customerPoNumber}}<div class="lbl">Customer PO</div><div class="v">{{customerPoNumber}}{{#if customerPoDate}} / {{fmtDate customerPoDate}}{{/if}}</div>{{/if}}
    </div>
  </div>

  <div class="parties">
    <div class="box">
      <div class="lbl">Customer</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
    </div>
    <div class="box">
      <div class="status-center"><div class="lbl">Fulfilment Status</div><div style="margin-top:5px"><span class="chip">{{status}}</span></div></div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th class="c" style="width:34px">#</th>
      <th>Description</th>
      <th class="c" style="width:66px">Ordered</th>
      <th class="c" style="width:58px">Unit</th>
      <th class="c" style="width:76px">Delivered</th>
      <th class="c" style="width:80px">Remaining</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{#if this.itemTypeName}}<span style="font-size:10px;color:#3558a8;">{{this.itemTypeName}} &mdash; </span>{{/if}}{{this.description}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="c">{{this.deliveredQuantity}}</td>
        <td class="c rem">{{this.remainingQuantity}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 13 "-" items.length) 6}}
    </tbody>
  </table>

  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">Customer Signature</div></div>
    <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
  </div>
</body></html>`,
  },

  /* ─── 15. Government-Form Grid ────────────────────────────────────────────── */
  {
    id: "order-govt-grid",
    name: "Government-Form Grid",
    type: "SalesOrder",
    description: "Government-ledger style with bordered header cells and grid everywhere — formal procurement look",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sales Order #{{salesOrderNumber}}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
body { font-family:Arial,sans-serif; font-size:11px; color:#000; padding:3px; }
.outer { border:2px solid #000; }
.top-row { display:flex; border-bottom:2px solid #000; }
.logo-col { width:110px; border-right:1px solid #000; padding:10px; display:flex; align-items:center; justify-content:center; }
.logo-col img { height:54px; filter:grayscale(100%); }
.center-col { flex:1; border-right:1px solid #000; padding:8px 10px; text-align:center; }
.center-col .cname { font-size:19px; font-weight:900; text-transform:uppercase; letter-spacing:1px; }
.center-col .caddr { font-size:10px; color:#333; margin-top:3px; line-height:1.3; }
.doc-col { width:170px; padding:8px 10px; }
.doc-col .title-box { border:1px solid #000; text-align:center; padding:6px 0; font-size:16px; font-weight:900; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px; }
.doc-col .field { display:flex; justify-content:space-between; font-size:10.5px; border-bottom:1px solid #ccc; padding:3px 0; }
.doc-col .field .lbl { font-weight:700; }
.info-row { display:flex; border-bottom:1px solid #000; }
.info-cell { flex:1; border-right:1px solid #000; }
.info-cell:last-child { border-right:none; }
.info-cell .cell-head { background:#e8e8e8 !important; font-size:9px; text-transform:uppercase; font-weight:700; padding:4px 8px; border-bottom:1px solid #999; letter-spacing:.5px; }
.info-cell .cell-body { padding:6px 8px; min-height:44px; }
.info-cell .v { font-size:12px; font-weight:700; }
.info-cell .s { font-size:10px; color:#333; margin-top:2px; }
table { width:100%; border-collapse:collapse; }
th { background:#333 !important; color:#fff !important; font-size:10px; text-transform:uppercase; padding:6px 7px; text-align:left; border-right:1px solid #111; }
th:last-child { border-right:none; }
th.c, td.c { text-align:center; }
td { border-bottom:1px solid #ccc; border-right:1px solid #e0e0e0; padding:5px 7px; font-size:11px; }
td:last-child { border-right:none; }
tbody tr:nth-child(even) td { background:#f6f6f6 !important; }
td.rem { font-weight:900; background:#fffbe0 !important; border-left:2px solid #999; }
tbody tr:nth-child(even) td.rem { background:#fffbe0 !important; }
.cell { }
.sig-row { display:flex; border-top:2px solid #000; }
.sig-cell { flex:1; border-right:1px solid #000; padding:36px 10px 8px; }
.sig-cell:last-child { border-right:none; }
.sig-cell .lbl { font-size:9px; text-transform:uppercase; font-weight:700; letter-spacing:.5px; color:#555; margin-bottom:2px; }
.sig-cell .line { border-top:1px solid #000; width:70%; margin:0 auto 3px; }
.sig-cell .l { font-size:10px; text-align:center; }
.status-field { font-weight:900; font-size:12px; }
@media print { @page { size:A4; margin:8mm; } }
</style></head><body>
<div class="outer">
  <div class="top-row">
    <div class="logo-col">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{else}}<div style="width:70px;height:46px;border:1px dashed #aaa;display:flex;align-items:center;justify-content:center;font-size:8px;color:#aaa;">LOGO</div>{{/if}}
    </div>
    <div class="center-col">
      <div class="cname">{{companyBrandName}}</div>
      {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
      {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
    </div>
    <div class="doc-col">
      <div class="title-box">Sales Order</div>
      <div class="field"><span class="lbl">Order No:</span><span>{{salesOrderNumber}}</span></div>
      <div class="field"><span class="lbl">Date:</span><span>{{fmtDate orderDate}}</span></div>
      {{#if requiredDate}}<div class="field"><span class="lbl">Req. By:</span><span>{{fmtDate requiredDate}}</span></div>{{/if}}
    </div>
  </div>
  <div class="info-row">
    <div class="info-cell" style="flex:2">
      <div class="cell-head">Customer</div>
      <div class="cell-body">
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if site}}<div class="s">Site: {{site}}</div>{{/if}}
      </div>
    </div>
    {{#if customerPoNumber}}
    <div class="info-cell">
      <div class="cell-head">Customer PO</div>
      <div class="cell-body">
        <div class="v">{{customerPoNumber}}</div>
        {{#if customerPoDate}}<div class="s">Date: {{fmtDate customerPoDate}}</div>{{/if}}
      </div>
    </div>
    {{/if}}
    <div class="info-cell">
      <div class="cell-head">Fulfilment Status</div>
      <div class="cell-body"><div class="status-field">{{status}}</div></div>
    </div>
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:30px">S#</th>
      <th>Description of Goods</th>
      <th class="c" style="width:62px">Ordered Qty</th>
      <th class="c" style="width:52px">Unit</th>
      <th class="c" style="width:70px">Delivered Qty</th>
      <th class="c" style="width:72px">Balance / Remaining</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{#if this.itemTypeName}}<strong>{{this.itemTypeName}}:</strong> {{/if}}{{this.description}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="c">{{this.deliveredQuantity}}</td>
        <td class="c rem">{{this.remainingQuantity}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 15 "-" items.length) 6}}
    </tbody>
  </table>
  <div class="sig-row">
    <div class="sig-cell"><div class="line"></div><div class="l">Prepared By</div></div>
    <div class="sig-cell"><div class="line"></div><div class="l">Checked By</div></div>
    <div class="sig-cell"><div class="line"></div><div class="l">Authorised Signatory<br>For {{companyBrandName}}</div></div>
  </div>
</div>
</body></html>`,
  },

];
