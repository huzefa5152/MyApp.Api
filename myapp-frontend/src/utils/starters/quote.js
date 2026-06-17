export const quoteStarters = [
  {
    id: "quote-classic-serif",
    name: "Classic Serif",
    type: "SalesQuote",
    description: "Traditional serif typography with double-rule borders, formal Pakistani business style.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:Georgia,"Times New Roman",serif;font-size:12px;color:#1a1a1a;padding:6px;}
.outer{border:2.5px double #1a1a1a;padding:14px;}
.inner{border:1px solid #1a1a1a;padding:10px;}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;border-bottom:2px solid #1a1a1a;margin-bottom:10px;}
.brand img{height:60px;margin-bottom:4px;}
.cname{font-size:22px;font-weight:700;letter-spacing:1px;text-transform:uppercase;}
.caddr{font-size:10.5px;color:#333;margin-top:3px;line-height:1.5;}
.doctitle{text-align:right;}
.doctitle .t{font-size:24px;font-weight:700;letter-spacing:3px;text-transform:uppercase;border-bottom:2px solid #1a1a1a;padding-bottom:4px;display:inline-block;}
.doctitle .meta{font-size:11.5px;margin-top:6px;line-height:1.7;text-align:right;}
.parties{display:flex;justify-content:space-between;gap:20px;margin:12px 0;}
.box .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.8px;font-weight:700;border-bottom:1px solid #1a1a1a;padding-bottom:2px;margin-bottom:4px;}
.box .v{font-size:13px;font-weight:700;margin-top:2px;}
.box .s{font-size:11px;color:#444;margin-top:2px;}
table{width:100%;border-collapse:collapse;margin-top:12px;}
th{background:#1a1a1a !important;color:#fff !important;font-size:11px;text-transform:uppercase;padding:7px 9px;font-family:Georgia,serif;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border:1px solid #ccc;padding:6px 9px;font-size:12px;}
tbody tr:nth-child(even) td{background:#f5f5f5 !important;}
.totals{margin-top:10px;width:280px;margin-left:auto;border:1px solid #1a1a1a;}
.totals .row{display:flex;justify-content:space-between;padding:5px 10px;border-bottom:1px solid #ccc;}
.totals .row:last-child{border-bottom:none;}
.grand{font-weight:700;font-size:14px;background:#1a1a1a !important;color:#fff !important;}
.words{margin-top:10px;font-style:italic;font-size:11.5px;border:1px dashed #999;padding:6px 10px;}
.notes{margin-top:12px;font-size:11px;color:#444;border-top:1px solid #ccc;padding-top:8px;}
.validity{margin-top:8px;font-size:12px;font-weight:700;color:#333;}
.sig{display:flex;justify-content:space-between;margin-top:40px;}
.sig .b{text-align:center;}.sig .line{width:180px;border-top:1.5px solid #1a1a1a;margin:0 auto;}.sig .l{font-size:10.5px;margin-top:3px;}
@media print{@page{size:A4;margin:11mm;}}
</style></head><body>
<div class="outer"><div class="inner">
  <div class="hdr">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px">{{/if}}
      <div class="cname">{{companyBrandName}}</div>
      {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
      {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;|&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
    </div>
    <div class="doctitle">
      <div class="t">QUOTATION</div>
      <div class="meta">
        <div><strong>Quote No.:</strong> {{quoteNumber}}</div>
        <div><strong>Date:</strong> {{fmtDate date}}</div>
        {{#if validUntil}}<div><strong>Valid Until:</strong> {{fmtDate validUntil}}</div>{{/if}}
      </div>
    </div>
  </div>
  <div class="parties">
    <div class="box" style="flex:1">
      <div class="lbl">Quotation For</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} &nbsp;|&nbsp; STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
    </div>
    {{#if customerEnquiryRef}}
    <div class="box" style="text-align:right">
      <div class="lbl">Your Enquiry Ref</div>
      <div class="v">{{customerEnquiryRef}}</div>
      {{#if enquiryDate}}<div class="s">Dated: {{fmtDate enquiryDate}}</div>{{/if}}
    </div>
    {{/if}}
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:38px">#</th>
      <th>Description</th>
      <th class="c" style="width:55px">Type</th>
      <th class="c" style="width:60px">Qty</th>
      <th class="c" style="width:55px">Unit</th>
      <th class="r" style="width:95px">Unit Price</th>
      <th class="r" style="width:100px">Amount</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{{richText this.description}}}</td>
        <td class="c">{{this.itemTypeName}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="r">Rs {{fmt this.unitPrice}}</td>
        <td class="r">Rs {{fmt this.lineTotal}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 12 "-" items.length) 7}}
    </tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
    <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
    <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
  </div>
  <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
  {{#if notes}}<div class="notes"><strong>Notes / Terms &amp; Conditions:</strong><br>{{{nl2br notes}}}</div>{{/if}}
  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">Prepared By</div></div>
    <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
  </div>
</div></div>
</body></html>`
  },
  {
    id: "quote-modern-minimal",
    name: "Modern Minimal",
    type: "SalesQuote",
    description: "Clean white space, light grey accents, sans-serif â€” contemporary minimal look.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#222;padding:4px;}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:1px solid #e0e0e0;margin-bottom:14px;}
.brand img{height:52px;margin-bottom:4px;display:block;}
.cname{font-size:18px;font-weight:700;color:#111;letter-spacing:.5px;}
.caddr{font-size:10.5px;color:#777;margin-top:3px;line-height:1.5;}
.doctitle{text-align:right;}
.doctitle .t{font-size:28px;font-weight:300;letter-spacing:4px;color:#bbb;text-transform:uppercase;}
.doctitle .meta{font-size:11.5px;margin-top:6px;line-height:1.7;color:#555;}
.doctitle .meta strong{color:#222;}
.parties{display:flex;gap:20px;margin:14px 0;}
.box{flex:1;padding:10px 12px;border:1px solid #ebebeb;border-radius:4px;}
.box .lbl{font-size:9.5px;text-transform:uppercase;letter-spacing:1px;color:#aaa;font-weight:700;margin-bottom:4px;}
.box .v{font-size:13px;font-weight:600;color:#111;}
.box .s{font-size:11px;color:#777;margin-top:2px;}
table{width:100%;border-collapse:collapse;margin-top:14px;}
thead tr{border-bottom:2px solid #222;}
th{font-size:10.5px;text-transform:uppercase;padding:8px 8px;text-align:left;color:#555 !important;font-weight:700;background:transparent !important;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px solid #f0f0f0;padding:7px 8px;font-size:12px;color:#222;}
.totals{margin-top:10px;width:260px;margin-left:auto;}
.totals .row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#555;border-bottom:1px solid #f0f0f0;}
.grand{font-weight:700;font-size:15px;color:#111 !important;border-top:2px solid #222 !important;border-bottom:none !important;padding-top:8px !important;}
.words{margin-top:10px;font-size:11px;color:#888;font-style:italic;}
.notes{margin-top:14px;font-size:11px;color:#777;border-top:1px solid #ebebeb;padding-top:8px;}
.sig{display:flex;justify-content:flex-end;margin-top:50px;}
.sig .b{text-align:center;}.sig .line{width:180px;border-top:1px solid #ccc;}.sig .l{font-size:10.5px;color:#888;margin-top:3px;}
@media print{@page{size:A4;margin:12mm;}}
</style></head><body>
  <div class="hdr">
    <div>
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:52px">{{/if}}
      <div class="cname">{{companyBrandName}}</div>
      {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
      {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
    </div>
    <div class="doctitle">
      <div class="t">Quotation</div>
      <div class="meta">
        <div><strong>#{{quoteNumber}}</strong></div>
        <div>{{fmtDate date}}</div>
        {{#if validUntil}}<div>Valid until {{fmtDate validUntil}}</div>{{/if}}
      </div>
    </div>
  </div>
  <div class="parties">
    <div class="box">
      <div class="lbl">Prepared for</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} &nbsp; STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
    </div>
    {{#if customerEnquiryRef}}
    <div class="box" style="flex:0 0 auto;min-width:160px;text-align:right;">
      <div class="lbl">Enquiry Reference</div>
      <div class="v">{{customerEnquiryRef}}</div>
      {{#if enquiryDate}}<div class="s">{{fmtDate enquiryDate}}</div>{{/if}}
    </div>
    {{/if}}
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:34px">#</th>
      <th>Description</th>
      <th class="c" style="width:60px">Qty</th>
      <th class="c" style="width:55px">Unit</th>
      <th class="r" style="width:90px">Unit Price</th>
      <th class="r" style="width:100px">Amount</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{{richText this.description}}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="r">Rs {{fmt this.unitPrice}}</td>
        <td class="r">Rs {{fmt this.lineTotal}}</td>
      </tr>
    {{/each}}
    </tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
    <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
    <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
  </div>
  <div class="words">Amount in words: {{amountInWords}}</div>
  {{#if notes}}<div class="notes"><strong>Notes / Terms:</strong><br>{{{nl2br notes}}}</div>{{/if}}
  <div class="sig"><div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div></div>
</body></html>`
  },
  {
    id: "quote-corporate-navy",
    name: "Corporate Navy Band",
    type: "SalesQuote",
    description: "Full-width navy header band with white logo/name, professional corporate identity.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#1a2332;padding:0;}
.header-band{background:#0d2855 !important;color:#fff !important;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;}
.header-band img{height:60px;filter:brightness(0) invert(1);}
.cname{font-size:22px;font-weight:800;color:#fff !important;letter-spacing:1.5px;text-transform:uppercase;}
.caddr{font-size:10.5px;color:#a8c4e8 !important;margin-top:3px;line-height:1.5;}
.doc-block{text-align:right;}
.doc-block .t{font-size:26px;font-weight:800;color:#ffd700 !important;letter-spacing:3px;}
.doc-block .meta{font-size:11.5px;color:#d0e4f7 !important;margin-top:5px;line-height:1.7;}
.sub-band{background:#1a4a8a !important;color:#fff !important;padding:6px 18px;display:flex;justify-content:space-between;font-size:10.5px;}
.body{padding:14px 18px;}
.parties{display:flex;gap:20px;margin-bottom:12px;}
.box{flex:1;padding:10px 12px;border:1px solid #d0dce8;border-left:3px solid #0d2855;}
.box .lbl{font-size:9.5px;text-transform:uppercase;letter-spacing:1px;color:#0d2855;font-weight:800;margin-bottom:4px;}
.box .v{font-size:13px;font-weight:700;}
.box .s{font-size:11px;color:#555;margin-top:2px;}
table{width:100%;border-collapse:collapse;margin-top:4px;}
th{background:#0d2855 !important;color:#fff !important;font-size:11px;text-transform:uppercase;padding:8px 10px;text-align:left;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px solid #e0e8f0;padding:7px 10px;font-size:12px;}
tbody tr:nth-child(even) td{background:#f0f5fb !important;}
.totals{margin-top:10px;width:290px;margin-left:auto;border:1px solid #d0dce8;}
.totals .row{display:flex;justify-content:space-between;padding:5px 12px;border-bottom:1px solid #e8eef5;}
.grand{background:#0d2855 !important;color:#fff !important;font-weight:800;font-size:14px;border-bottom:none !important;}
.words{margin-top:10px;font-size:11.5px;font-style:italic;color:#555;padding:6px 12px;background:#f0f5fb !important;border-left:3px solid #0d2855;}
.notes{margin-top:12px;font-size:11px;color:#555;border-top:1px dashed #cdd8e5;padding-top:8px;}
.sig{display:flex;justify-content:space-between;margin-top:40px;padding:0 4px;}
.sig .b{text-align:center;}.sig .line{width:170px;border-top:1.5px solid #0d2855;margin:0 auto;}.sig .l{font-size:10.5px;margin-top:3px;color:#555;}
@media print{@page{size:A4;margin:0 0 10mm 0;}}
</style></head><body>
  <div class="header-band">
    <div style="display:flex;align-items:center;gap:14px;">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px">{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="doc-block">
      <div class="t">QUOTATION</div>
      <div class="meta">
        <div>#{{quoteNumber}} &nbsp;|&nbsp; {{fmtDate date}}</div>
        {{#if companyNTN}}<div>NTN: {{companyNTN}}{{#if companySTRN}} &nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
      </div>
    </div>
  </div>
  <div class="sub-band">
    <span>{{#if validUntil}}Valid Until: <strong>{{fmtDate validUntil}}</strong>{{/if}}</span>
    <span>{{#if customerEnquiryRef}}Your Ref: <strong>{{customerEnquiryRef}}</strong>{{#if enquiryDate}} ({{fmtDate enquiryDate}}){{/if}}{{/if}}</span>
  </div>
  <div class="body">
    <div class="parties">
      <div class="box">
        <div class="lbl">Quotation For</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} &nbsp; STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="c" style="width:36px">#</th>
        <th>Description</th>
        <th class="c" style="width:65px">Qty</th>
        <th class="c" style="width:55px">Unit</th>
        <th class="r" style="width:95px">Unit Price</th>
        <th class="r" style="width:105px">Amount</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{{richText this.description}}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="r">Rs {{fmt this.unitPrice}}</td>
          <td class="r">Rs {{fmt this.lineTotal}}</td>
        </tr>
      {{/each}}
      {{emptyRows (math 10 "-" items.length) 6}}
      </tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
      <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
      <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
    </div>
    <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
    {{#if notes}}<div class="notes"><strong>Notes / Terms:</strong><br>{{{nl2br notes}}}</div>{{/if}}
    <div class="sig">
      <div class="b"><div class="line"></div><div class="l">Prepared By</div></div>
      <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
    </div>
  </div>
</body></html>`
  },
  {
    id: "quote-bold-banner",
    name: "Bold Colored Banner",
    type: "SalesQuote",
    description: "Vibrant teal-to-blue gradient banner, bold document title, eye-catching modern design.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#1a2332;}
.banner{background:linear-gradient(135deg,#00796b 0%,#0d47a1 100%) !important;padding:16px 20px;display:flex;align-items:center;gap:16px;}
.banner img{height:60px;background:#fff;border-radius:4px;padding:3px;}
.cname{font-size:24px;font-weight:800;color:#fff !important;text-transform:uppercase;letter-spacing:1px;}
.caddr{font-size:10.5px;color:#b2dfdb !important;margin-top:3px;line-height:1.4;}
.badge{margin-left:auto;text-align:right;}
.badge .t{font-size:30px;font-weight:900;color:#fff !important;letter-spacing:4px;text-shadow:0 2px 4px rgba(0,0,0,.3);}
.badge .qnum{font-size:13px;color:#b2dfdb !important;margin-top:4px;}
.content{padding:14px 20px;}
.info-row{display:flex;gap:12px;margin-bottom:12px;}
.info-card{flex:1;background:#f0f7ff !important;border-radius:4px;padding:9px 12px;border-top:3px solid #0d47a1;}
.info-card .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#666;font-weight:700;margin-bottom:3px;}
.info-card .v{font-size:13px;font-weight:700;color:#0d2855;}
.info-card .s{font-size:10.5px;color:#555;margin-top:2px;}
.dates-row{display:flex;gap:12px;margin-bottom:10px;}
.date-chip{background:#e3f2fd !important;padding:5px 12px;border-radius:20px;font-size:11px;color:#0d2855;}
.date-chip strong{color:#0d47a1;}
table{width:100%;border-collapse:collapse;}
th{background:linear-gradient(135deg,#00796b,#0d47a1) !important;color:#fff !important;font-size:11px;text-transform:uppercase;padding:8px 10px;text-align:left;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px solid #e8f0fe;padding:7px 10px;font-size:12px;}
tbody tr:nth-child(even) td{background:#f8fbff !important;}
.totals{margin-top:10px;width:280px;margin-left:auto;}
.totals .row{display:flex;justify-content:space-between;padding:4px 10px;font-size:12px;}
.grand{background:linear-gradient(135deg,#00796b,#0d47a1) !important;color:#fff !important;font-weight:800;font-size:14px;border-radius:4px;padding:8px 10px !important;margin-top:4px;}
.words{margin-top:8px;font-size:11px;font-style:italic;color:#555;padding:5px 10px;background:#f0f7ff !important;border-radius:3px;}
.notes{margin-top:12px;font-size:11px;color:#555;border-top:1px dashed #b3d1f7;padding-top:8px;}
.sig{display:flex;justify-content:flex-end;margin-top:40px;padding:0 4px;}
.sig .b{text-align:center;}.sig .line{width:180px;border-top:2px solid #0d47a1;}.sig .l{font-size:10.5px;color:#555;margin-top:3px;}
@media print{@page{size:A4;margin:0 0 10mm 0;}}
</style></head><body>
  <div class="banner">
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px">{{/if}}
    <div>
      <div class="cname">{{companyBrandName}}</div>
      {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
      {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} | STRN: {{companySTRN}}{{/if}}</div>{{/if}}
    </div>
    <div class="badge">
      <div class="t">SALES QUOTE</div>
      <div class="qnum"># {{quoteNumber}}</div>
    </div>
  </div>
  <div class="content">
    <div class="dates-row">
      <div class="date-chip"><strong>Date:</strong> {{fmtDate date}}</div>
      {{#if validUntil}}<div class="date-chip"><strong>Valid Until:</strong> {{fmtDate validUntil}}</div>{{/if}}
      {{#if customerEnquiryRef}}<div class="date-chip"><strong>Your Ref:</strong> {{customerEnquiryRef}}{{#if enquiryDate}} ({{fmtDate enquiryDate}}){{/if}}</div>{{/if}}
    </div>
    <div class="info-row">
      <div class="info-card">
        <div class="lbl">Quotation For</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} | STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="c" style="width:36px">#</th>
        <th>Description</th>
        <th class="c" style="width:65px">Qty</th>
        <th class="c" style="width:55px">Unit</th>
        <th class="r" style="width:95px">Unit Price</th>
        <th class="r" style="width:105px">Amount</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{{richText this.description}}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="r">Rs {{fmt this.unitPrice}}</td>
          <td class="r">Rs {{fmt this.lineTotal}}</td>
        </tr>
      {{/each}}
      </tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
      <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
      <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
    </div>
    <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
    {{#if notes}}<div class="notes"><strong>Notes / Terms:</strong><br>{{{nl2br notes}}}</div>{{/if}}
    <div class="sig"><div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div></div>
  </div>
</body></html>`
  },
  {
    id: "quote-monochrome-ink",
    name: "Monochrome Ink-Saver",
    type: "SalesQuote",
    description: "Pure black and white, no background fills, minimal ink usage for high-volume printing.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:Arial,sans-serif;font-size:11.5px;color:#000;padding:6px;}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:8px;border-bottom:2px solid #000;margin-bottom:10px;}
.brand img{height:54px;margin-bottom:4px;filter:grayscale(100%);}
.cname{font-size:20px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;}
.caddr{font-size:10px;margin-top:3px;line-height:1.4;}
.doctitle{text-align:right;}
.doctitle .t{font-size:22px;font-weight:700;letter-spacing:2px;text-transform:uppercase;border:2px solid #000;padding:3px 10px;display:inline-block;}
.doctitle .meta{font-size:11px;margin-top:7px;line-height:1.7;}
.parties{display:flex;gap:20px;margin:10px 0;border:1px solid #000;}
.box{flex:1;padding:8px 10px;border-right:1px solid #000;}
.box:last-child{border-right:none;}
.box .lbl{font-size:9.5px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:4px;}
.box .v{font-size:12.5px;font-weight:700;}
.box .s{font-size:10.5px;margin-top:2px;}
table{width:100%;border-collapse:collapse;margin-top:10px;}
th{background:transparent !important;color:#000 !important;font-size:11px;text-transform:uppercase;padding:6px 8px;text-align:left;border-top:2px solid #000;border-bottom:1px solid #000;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px dotted #999;padding:6px 8px;font-size:11.5px;}
.totals{margin-top:10px;width:260px;margin-left:auto;border:1px solid #000;}
.totals .row{display:flex;justify-content:space-between;padding:5px 10px;border-bottom:1px solid #ccc;}
.totals .row:last-child{border-bottom:none;}
.grand{font-weight:700;font-size:14px;border-top:2px solid #000 !important;background:transparent !important;}
.words{margin-top:8px;font-size:11px;font-style:italic;border:1px dashed #000;padding:5px 8px;}
.notes{margin-top:10px;font-size:11px;border-top:1px solid #000;padding-top:7px;}
.sig{display:flex;justify-content:space-between;margin-top:40px;}
.sig .b{text-align:center;}.sig .line{width:160px;border-top:1px solid #000;margin:0 auto;}.sig .l{font-size:10px;margin-top:3px;}
@media print{@page{size:A4;margin:10mm;}}
</style></head><body>
  <div class="hdr">
    <div>
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:54px">{{/if}}
      <div class="cname">{{companyBrandName}}</div>
      {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
      {{#if companyPhone}}<div class="caddr">Tel: {{{nl2br companyPhone}}}</div>{{/if}}
      {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} | STRN: {{companySTRN}}{{/if}}</div>{{/if}}
    </div>
    <div class="doctitle">
      <div class="t">QUOTATION</div>
      <div class="meta">
        <div><strong>Quote No.:</strong> {{quoteNumber}}</div>
        <div><strong>Date:</strong> {{fmtDate date}}</div>
        {{#if validUntil}}<div><strong>Valid Until:</strong> {{fmtDate validUntil}}</div>{{/if}}
      </div>
    </div>
  </div>
  <div class="parties">
    <div class="box">
      <div class="lbl">Quotation For</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} | STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
    </div>
    {{#if customerEnquiryRef}}
    <div class="box">
      <div class="lbl">Your Enquiry Ref</div>
      <div class="v">{{customerEnquiryRef}}</div>
      {{#if enquiryDate}}<div class="s">Dated: {{fmtDate enquiryDate}}</div>{{/if}}
    </div>
    {{/if}}
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:36px">#</th>
      <th>Description</th>
      <th class="c" style="width:65px">Qty</th>
      <th class="c" style="width:55px">Unit</th>
      <th class="r" style="width:95px">Unit Price</th>
      <th class="r" style="width:100px">Amount</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{{richText this.description}}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="r">Rs {{fmt this.unitPrice}}</td>
        <td class="r">Rs {{fmt this.lineTotal}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 12 "-" items.length) 6}}
    </tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
    <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
    <div class="row grand"><span>GRAND TOTAL</span><span>Rs {{fmt grandTotal}}</span></div>
  </div>
  <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
  {{#if notes}}<div class="notes"><strong>Notes / Terms:</strong><br>{{{nl2br notes}}}</div>{{/if}}
  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">Prepared By</div></div>
    <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
  </div>
</body></html>`
  },
  {
    id: "quote-elegant-premium",
    name: "Elegant Premium (Charcoal & Gold)",
    type: "SalesQuote",
    description: "Charcoal and gold luxury aesthetic, premium wholesale and high-value goods quotations.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#1a1a1a;background:#fff;padding:4px;}
.hdr{background:#1c1c2e !important;color:#fff !important;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;}
.hdr img{height:60px;}
.cname{font-size:22px;font-weight:700;color:#f5c518 !important;letter-spacing:2px;text-transform:uppercase;}
.caddr{font-size:10px;color:#aaa !important;margin-top:3px;line-height:1.5;}
.doc-right{text-align:right;}
.doc-right .t{font-size:28px;font-weight:300;letter-spacing:5px;color:#f5c518 !important;text-transform:uppercase;}
.doc-right .meta{font-size:11.5px;color:#ccc !important;margin-top:5px;line-height:1.7;}
.gold-line{height:3px;background:linear-gradient(90deg,#1c1c2e,#f5c518,#1c1c2e) !important;}
.body{padding:14px 20px;}
.parties{display:flex;gap:20px;margin-bottom:12px;}
.box{flex:1;padding:10px 14px;border:1px solid #e8e0d0;border-top:3px solid #f5c518;}
.box .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#c5a028;font-weight:700;margin-bottom:5px;}
.box .v{font-size:13px;font-weight:700;color:#1c1c2e;}
.box .s{font-size:11px;color:#666;margin-top:2px;}
.meta-chips{display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap;}
.chip{padding:4px 12px;background:#faf7f0 !important;border:1px solid #e8d9a0;font-size:11px;color:#555;border-radius:2px;}
.chip strong{color:#c5a028;}
table{width:100%;border-collapse:collapse;}
th{background:#1c1c2e !important;color:#f5c518 !important;font-size:10.5px;text-transform:uppercase;padding:8px 10px;text-align:left;letter-spacing:.5px;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px solid #f0ebe0;padding:7px 10px;font-size:12px;}
tbody tr:nth-child(even) td{background:#faf7f0 !important;}
.totals{margin-top:10px;width:280px;margin-left:auto;}
.totals .row{display:flex;justify-content:space-between;padding:5px 0;font-size:12px;border-bottom:1px solid #f0ebe0;}
.grand{border-top:2px solid #f5c518 !important;border-bottom:none !important;font-weight:800;font-size:15px;color:#1c1c2e;padding-top:8px !important;}
.words{margin-top:10px;font-size:11px;font-style:italic;color:#666;padding:6px 10px;border-left:3px solid #f5c518;background:#faf7f0 !important;}
.notes{margin-top:12px;font-size:11px;color:#666;border-top:1px dashed #e8d9a0;padding-top:8px;}
.sig{display:flex;justify-content:flex-end;margin-top:44px;padding:0 4px;}
.sig .b{text-align:center;}.sig .line{width:180px;border-top:1.5px solid #f5c518;}.sig .l{font-size:10.5px;color:#666;margin-top:3px;}
@media print{@page{size:A4;margin:0 0 10mm 0;}}
</style></head><body>
  <div class="hdr">
    <div style="display:flex;align-items:center;gap:14px;">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px">{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
        {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
      </div>
    </div>
    <div class="doc-right">
      <div class="t">Quotation</div>
      <div class="meta">
        <div>#{{quoteNumber}}</div>
        <div>{{fmtDate date}}</div>
      </div>
    </div>
  </div>
  <div class="gold-line"></div>
  <div class="body">
    <div class="meta-chips">
      {{#if validUntil}}<div class="chip"><strong>Valid Until:</strong> {{fmtDate validUntil}}</div>{{/if}}
      {{#if customerEnquiryRef}}<div class="chip"><strong>Your Ref:</strong> {{customerEnquiryRef}}{{#if enquiryDate}} &mdash; {{fmtDate enquiryDate}}{{/if}}</div>{{/if}}
    </div>
    <div class="parties">
      <div class="box">
        <div class="lbl">Quotation For</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} &nbsp; STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="c" style="width:36px">#</th>
        <th>Description</th>
        <th class="c" style="width:65px">Qty</th>
        <th class="c" style="width:55px">Unit</th>
        <th class="r" style="width:95px">Unit Price</th>
        <th class="r" style="width:105px">Amount</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{{richText this.description}}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="r">Rs {{fmt this.unitPrice}}</td>
          <td class="r">Rs {{fmt this.lineTotal}}</td>
        </tr>
      {{/each}}
      </tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
      <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
      <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
    </div>
    <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
    {{#if notes}}<div class="notes"><strong>Notes / Terms:</strong><br>{{{nl2br notes}}}</div>{{/if}}
    <div class="sig"><div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div></div>
  </div>
</body></html>`
  },
  {
    id: "quote-compact-dense",
    name: "Compact Dense",
    type: "SalesQuote",
    description: "Tight spacing and small fonts to fit many line items on one A4 page.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:10.5px;color:#1a2332;padding:4px;}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0d47a1;padding-bottom:7px;margin-bottom:7px;}
.brand{display:flex;align-items:center;gap:8px;}
.brand img{height:44px;}
.cname{font-size:15px;font-weight:800;text-transform:uppercase;color:#0d47a1;}
.caddr{font-size:9.5px;color:#555;margin-top:2px;line-height:1.3;}
.doctitle{text-align:right;}
.doctitle .t{font-size:17px;font-weight:800;letter-spacing:2px;color:#0d47a1;}
.doctitle .meta{font-size:10px;margin-top:3px;line-height:1.5;}
.parties{display:flex;gap:10px;margin:7px 0;}
.box{flex:1;padding:5px 8px;border:1px solid #d0d8e8;}
.box .lbl{font-size:8.5px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;color:#0d47a1;margin-bottom:2px;}
.box .v{font-size:11.5px;font-weight:700;}
.box .s{font-size:9.5px;color:#555;margin-top:1px;}
table{width:100%;border-collapse:collapse;margin-top:6px;}
th{background:#0d47a1 !important;color:#fff !important;font-size:9.5px;text-transform:uppercase;padding:5px 7px;text-align:left;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px solid #e8eef5;padding:4px 7px;font-size:10.5px;}
tbody tr:nth-child(even) td{background:#f5f8fc !important;}
.totals{margin-top:7px;width:240px;margin-left:auto;}
.totals .row{display:flex;justify-content:space-between;padding:3px 0;font-size:10.5px;border-bottom:1px solid #e8eef5;}
.grand{border-top:2px solid #0d47a1 !important;border-bottom:none !important;font-weight:800;font-size:13px;color:#0d47a1;padding-top:5px !important;}
.words{margin-top:6px;font-size:10px;font-style:italic;color:#555;}
.notes{margin-top:8px;font-size:10px;color:#555;border-top:1px dashed #cdd8e8;padding-top:6px;}
.sig{display:flex;justify-content:flex-end;margin-top:30px;}
.sig .b{text-align:center;}.sig .line{width:160px;border-top:1.5px solid #0d47a1;}.sig .l{font-size:9.5px;color:#555;margin-top:2px;}
@media print{@page{size:A4;margin:10mm;}}
</style></head><body>
  <div class="hdr">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:44px">{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
        {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} | STRN: {{companySTRN}}{{/if}}</div>{{/if}}
      </div>
    </div>
    <div class="doctitle">
      <div class="t">QUOTATION</div>
      <div class="meta">
        <div><strong>#{{quoteNumber}}</strong> &nbsp; {{fmtDate date}}</div>
        {{#if validUntil}}<div><strong>Valid:</strong> {{fmtDate validUntil}}</div>{{/if}}
        {{#if customerEnquiryRef}}<div><strong>Ref:</strong> {{customerEnquiryRef}}</div>{{/if}}
      </div>
    </div>
  </div>
  <div class="parties">
    <div class="box">
      <div class="lbl">Quotation For</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} | STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
    </div>
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:28px">#</th>
      <th>Description</th>
      <th class="c" style="width:55px">Qty</th>
      <th class="c" style="width:48px">Unit</th>
      <th class="r" style="width:85px">Unit Price</th>
      <th class="r" style="width:90px">Amount</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{{richText this.description}}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="r">Rs {{fmt this.unitPrice}}</td>
        <td class="r">Rs {{fmt this.lineTotal}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 18 "-" items.length) 6}}
    </tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
    <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
    <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
  </div>
  <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
  {{#if notes}}<div class="notes"><strong>Notes:</strong> {{{nl2br notes}}}</div>{{/if}}
  <div class="sig"><div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div></div>
</body></html>`
  },
  {
    id: "quote-left-sidebar",
    name: "Left Sidebar Strip",
    type: "SalesQuote",
    description: "Vertical navy sidebar on left carries company identity, main content on white right.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#1a2332;padding:0;}
.layout{display:flex;min-height:297mm;}
.sidebar{width:108px;min-width:108px;background:#0d2855 !important;color:#fff !important;padding:16px 8px;display:flex;flex-direction:column;align-items:center;}
.sidebar img{width:80px;height:auto;margin-bottom:10px;background:#fff;border-radius:3px;padding:3px;}
.sidebar .cname{font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#fff !important;text-align:center;word-break:break-word;margin-bottom:8px;}
.sidebar .cdiv{width:40px;height:2px;background:#f5c518 !important;margin:4px auto;}
.sidebar .cinfo{font-size:7.5px;color:#a8c4e8 !important;text-align:center;line-height:1.5;margin-top:6px;}
.sidebar .doc-label{margin-top:auto;font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#f5c518 !important;text-align:center;border-top:1px solid rgba(255,255,255,.2);padding-top:8px;word-break:break-word;}
.main{flex:1;padding:14px 16px;}
.main-hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0d2855;padding-bottom:10px;margin-bottom:12px;}
.doctitle .t{font-size:26px;font-weight:800;letter-spacing:3px;color:#0d2855;text-transform:uppercase;}
.doctitle .meta{font-size:11.5px;margin-top:5px;line-height:1.7;text-align:right;}
.validity-tag{background:#e3f2fd !important;color:#0d2855;font-size:11px;padding:4px 10px;border-radius:3px;font-weight:700;}
.parties{display:flex;gap:16px;margin-bottom:10px;}
.box{flex:1;padding:8px 10px;border:1px solid #d0dce8;border-left:3px solid #0d2855;}
.box .lbl{font-size:9px;text-transform:uppercase;letter-spacing:.8px;font-weight:800;color:#0d2855;margin-bottom:3px;}
.box .v{font-size:13px;font-weight:700;}
.box .s{font-size:10.5px;color:#555;margin-top:2px;}
table{width:100%;border-collapse:collapse;}
th{background:#0d2855 !important;color:#fff !important;font-size:10.5px;text-transform:uppercase;padding:7px 9px;text-align:left;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px solid #e8eef5;padding:6px 9px;font-size:11.5px;}
tbody tr:nth-child(even) td{background:#f0f5fb !important;}
.totals{margin-top:10px;width:250px;margin-left:auto;}
.totals .row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid #e8eef5;}
.grand{border-top:2px solid #0d2855 !important;border-bottom:none !important;font-weight:800;font-size:14px;color:#0d2855;padding-top:6px !important;}
.words{margin-top:8px;font-size:11px;font-style:italic;color:#555;}
.notes{margin-top:10px;font-size:11px;color:#555;border-top:1px dashed #cdd8e8;padding-top:7px;}
.sig{display:flex;justify-content:flex-end;margin-top:36px;}
.sig .b{text-align:center;}.sig .line{width:170px;border-top:1.5px solid #0d2855;}.sig .l{font-size:10px;color:#555;margin-top:3px;}
@media print{@page{size:A4;margin:0;}.layout{min-height:0;}}
</style></head><body>
  <div class="layout">
    <div class="sidebar">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="width:80px">{{/if}}
      <div class="cname">{{companyBrandName}}</div>
      <div class="cdiv"></div>
      <div class="cinfo">
        {{#if companyNTN}}NTN:<br>{{companyNTN}}{{/if}}
        {{#if companySTRN}}<br>STRN:<br>{{companySTRN}}{{/if}}
        {{#if companyPhone}}<br>{{{nl2br companyPhone}}}{{/if}}
      </div>
      <div class="doc-label">QUOTATION<br>#{{quoteNumber}}</div>
    </div>
    <div class="main">
      <div class="main-hdr">
        <div>
          {{#if companyAddress}}<div style="font-size:10.5px;color:#555;line-height:1.5;">{{{nl2br companyAddress}}}</div>{{/if}}
        </div>
        <div class="doctitle">
          <div class="t">QUOTATION</div>
          <div class="meta">
            <div><strong>Date:</strong> {{fmtDate date}}</div>
            {{#if validUntil}}<div><span class="validity-tag">Valid Until: {{fmtDate validUntil}}</span></div>{{/if}}
          </div>
        </div>
      </div>
      <div class="parties">
        <div class="box">
          <div class="lbl">Quotation For</div>
          <div class="v">{{clientName}}</div>
          {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
          {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} | STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
        </div>
        {{#if customerEnquiryRef}}
        <div class="box">
          <div class="lbl">Your Enquiry Ref</div>
          <div class="v">{{customerEnquiryRef}}</div>
          {{#if enquiryDate}}<div class="s">{{fmtDate enquiryDate}}</div>{{/if}}
        </div>
        {{/if}}
      </div>
      <table>
        <thead><tr>
          <th class="c" style="width:32px">#</th>
          <th>Description</th>
          <th class="c" style="width:60px">Qty</th>
          <th class="c" style="width:52px">Unit</th>
          <th class="r" style="width:90px">Unit Price</th>
          <th class="r" style="width:95px">Amount</th>
        </tr></thead>
        <tbody>
        {{#each items}}
          <tr>
            <td class="c">{{this.sNo}}</td>
            <td>{{{richText this.description}}}</td>
            <td class="c">{{this.quantity}}</td>
            <td class="c">{{this.uom}}</td>
            <td class="r">Rs {{fmt this.unitPrice}}</td>
            <td class="r">Rs {{fmt this.lineTotal}}</td>
          </tr>
        {{/each}}
        </tbody>
      </table>
      <div class="totals">
        <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
        <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
        <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
      </div>
      <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
      {{#if notes}}<div class="notes"><strong>Notes / Terms:</strong><br>{{{nl2br notes}}}</div>{{/if}}
      <div class="sig"><div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div></div>
    </div>
  </div>
</body></html>`
  },
  {
    id: "quote-boxed-traditional",
    name: "Boxed Traditional",
    type: "SalesQuote",
    description: "Bordered box layout with distinct ruled sections, traditional Pakistani trade document style.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:Arial,sans-serif;font-size:11.5px;color:#111;padding:6px;}
.wrapper{border:1.5px solid #333;padding:0;}
.hdr{padding:12px 14px;border-bottom:1.5px solid #333;display:flex;justify-content:space-between;align-items:flex-start;}
.brand img{height:56px;margin-bottom:4px;display:block;}
.cname{font-size:19px;font-weight:700;text-transform:uppercase;}
.caddr{font-size:10px;color:#444;margin-top:3px;line-height:1.4;}
.doc-meta{text-align:right;}
.doc-meta .t{font-size:20px;font-weight:700;letter-spacing:2px;text-transform:uppercase;border:2px solid #333;display:inline-block;padding:3px 12px;}
.dm-table{width:auto;border-collapse:collapse;margin-top:7px;margin-left:auto;}
.dm-table td{border:1px solid #aaa;padding:3px 8px;font-size:11px;text-align:right;}
.dm-table td:first-child{background:#f5f5f5 !important;font-weight:700;text-align:left;}
.parties-row{display:flex;border-bottom:1.5px solid #333;}
.party-cell{flex:1;padding:9px 12px;border-right:1.5px solid #333;}
.party-cell:last-child{border-right:none;}
.party-cell .lbl{font-size:9.5px;text-transform:uppercase;font-weight:700;letter-spacing:.5px;border-bottom:1px solid #ccc;padding-bottom:2px;margin-bottom:4px;}
.party-cell .v{font-size:12.5px;font-weight:700;}
.party-cell .s{font-size:10.5px;color:#444;margin-top:2px;}
table.items{width:100%;border-collapse:collapse;border-top:1.5px solid #333;}
table.items th{background:#333 !important;color:#fff !important;font-size:10.5px;padding:7px 9px;text-align:left;border-right:1px solid #555;}
table.items th:last-child{border-right:none;}
table.items th.r,table.items td.r{text-align:right;}
table.items th.c,table.items td.c{text-align:center;}
table.items td{border-bottom:1px solid #ddd;border-right:1px dotted #ccc;padding:6px 9px;font-size:11.5px;}
table.items td:last-child{border-right:none;}
.footer-section{padding:10px 14px;border-top:1.5px solid #333;}
.totals-table{width:260px;margin-left:auto;border-collapse:collapse;border:1px solid #ccc;}
.totals-table td{padding:5px 10px;font-size:11.5px;border-bottom:1px solid #ddd;}
.totals-table td:last-child{text-align:right;}
.totals-table tr:last-child td{font-weight:700;font-size:13.5px;background:#f0f0f0 !important;border-bottom:none;}
.words{margin-top:8px;font-size:11px;font-style:italic;border:1px dashed #aaa;padding:5px 9px;}
.notes{margin-top:10px;font-size:11px;color:#444;border-top:1px solid #ccc;padding-top:7px;}
.sig-row{display:flex;justify-content:space-between;margin-top:36px;}
.sig-row .b{text-align:center;}.sig-row .line{width:160px;border-top:1px solid #555;margin:0 auto;}.sig-row .l{font-size:10px;margin-top:3px;}
@media print{@page{size:A4;margin:10mm;}}
</style></head><body>
  <div class="wrapper">
    <div class="hdr">
      <div>
        {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:56px">{{/if}}
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">Tel: {{{nl2br companyPhone}}}</div>{{/if}}
        {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
      </div>
      <div class="doc-meta">
        <div class="t">QUOTATION</div>
        <table class="dm-table"><tbody>
          <tr><td>Quote No.</td><td>{{quoteNumber}}</td></tr>
          <tr><td>Date</td><td>{{fmtDate date}}</td></tr>
          {{#if validUntil}}<tr><td>Valid Until</td><td>{{fmtDate validUntil}}</td></tr>{{/if}}
        </tbody></table>
      </div>
    </div>
    <div class="parties-row">
      <div class="party-cell">
        <div class="lbl">Quotation For</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} &nbsp; STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
      </div>
      {{#if customerEnquiryRef}}
      <div class="party-cell">
        <div class="lbl">Your Enquiry Reference</div>
        <div class="v">{{customerEnquiryRef}}</div>
        {{#if enquiryDate}}<div class="s">Dated: {{fmtDate enquiryDate}}</div>{{/if}}
      </div>
      {{/if}}
    </div>
    <table class="items">
      <thead><tr>
        <th class="c" style="width:36px">#</th>
        <th>Description</th>
        <th class="c" style="width:65px">Qty</th>
        <th class="c" style="width:55px">Unit</th>
        <th class="r" style="width:95px">Unit Price</th>
        <th class="r" style="width:105px">Amount</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{{richText this.description}}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="r">Rs {{fmt this.unitPrice}}</td>
          <td class="r">Rs {{fmt this.lineTotal}}</td>
        </tr>
      {{/each}}
      {{emptyRows (math 10 "-" items.length) 6}}
      </tbody>
    </table>
    <div class="footer-section">
      <table class="totals-table"><tbody>
        <tr><td>Subtotal</td><td>Rs {{fmt subtotal}}</td></tr>
        <tr><td>GST @ {{gstRate}}%</td><td>Rs {{fmt gstAmount}}</td></tr>
        <tr><td>Grand Total</td><td>Rs {{fmt grandTotal}}</td></tr>
      </tbody></table>
      <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
      {{#if notes}}<div class="notes"><strong>Notes / Terms &amp; Conditions:</strong><br>{{{nl2br notes}}}</div>{{/if}}
      <div class="sig-row">
        <div class="b"><div class="line"></div><div class="l">Prepared By</div></div>
        <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
      </div>
    </div>
  </div>
</body></html>`
  },
  {
    id: "quote-bismillah-header",
    name: "Bismillah Header",
    type: "SalesQuote",
    description: "Opens with Bismillah in Arabic calligraphy, combining Islamic tradition with formal business layout.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#1a2332;padding:6px;}
.bismillah{text-align:center;font-size:22px;font-family:"Traditional Arabic","Arial Unicode MS",serif;color:#1a5c2a;margin-bottom:6px;letter-spacing:2px;line-height:1.6;}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-top:2px solid #1a5c2a;border-bottom:2px solid #1a5c2a;padding:10px 0;margin-bottom:12px;}
.brand img{height:58px;margin-bottom:4px;}
.cname{font-size:20px;font-weight:700;text-transform:uppercase;color:#1a5c2a;}
.caddr{font-size:10.5px;color:#555;margin-top:3px;line-height:1.4;}
.doctitle{text-align:right;}
.doctitle .t{font-size:24px;font-weight:800;letter-spacing:2px;color:#1a5c2a;text-transform:uppercase;}
.doctitle .meta{font-size:11.5px;margin-top:5px;line-height:1.7;}
.validity{display:inline-block;background:#e8f5e9 !important;color:#1a5c2a;font-size:11px;font-weight:700;padding:3px 10px;border:1px solid #a5d6a7;border-radius:3px;margin-top:4px;}
.parties{display:flex;gap:18px;margin-bottom:12px;}
.box{flex:1;padding:9px 12px;border:1px solid #c8e6c9;border-left:3px solid #1a5c2a;}
.box .lbl{font-size:9.5px;text-transform:uppercase;letter-spacing:.8px;font-weight:700;color:#1a5c2a;margin-bottom:4px;}
.box .v{font-size:13px;font-weight:700;}
.box .s{font-size:11px;color:#555;margin-top:2px;}
table{width:100%;border-collapse:collapse;}
th{background:#1a5c2a !important;color:#fff !important;font-size:11px;text-transform:uppercase;padding:8px 10px;text-align:left;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px solid #e8f5e9;padding:7px 10px;font-size:12px;}
tbody tr:nth-child(even) td{background:#f1f8f2 !important;}
.totals{margin-top:10px;width:270px;margin-left:auto;}
.totals .row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid #e8f5e9;}
.grand{border-top:2px solid #1a5c2a !important;border-bottom:none !important;font-weight:800;font-size:15px;color:#1a5c2a;padding-top:6px !important;}
.words{margin-top:10px;font-size:11.5px;font-style:italic;color:#555;padding:5px 10px;background:#e8f5e9 !important;border-left:3px solid #1a5c2a;}
.notes{margin-top:12px;font-size:11px;color:#555;border-top:1px dashed #a5d6a7;padding-top:8px;}
.closing{margin-top:10px;text-align:center;font-size:11.5px;color:#1a5c2a;font-style:italic;}
.sig{display:flex;justify-content:space-between;margin-top:36px;}
.sig .b{text-align:center;}.sig .line{width:160px;border-top:1.5px solid #1a5c2a;margin:0 auto;}.sig .l{font-size:10.5px;color:#555;margin-top:3px;}
@media print{@page{size:A4;margin:11mm;}}
</style></head><body>
  <div class="bismillah">Ø¨ÙØ³Ù’Ù…Ù Ø§Ù„Ù„ÛÙ Ø§Ù„Ø±ÙŽÙ‘Ø­Ù’Ù…Ù°Ù†Ù Ø§Ù„Ø±ÙŽÙ‘Ø­ÙÙŠÙ’Ù…</div>
  <div class="hdr">
    <div>
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:58px">{{/if}}
      <div class="cname">{{companyBrandName}}</div>
      {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
      {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
    </div>
    <div class="doctitle">
      <div class="t">QUOTATION</div>
      <div class="meta">
        <div><strong>Quote No.:</strong> {{quoteNumber}}</div>
        <div><strong>Date:</strong> {{fmtDate date}}</div>
        {{#if validUntil}}<div><span class="validity">Valid Until: {{fmtDate validUntil}}</span></div>{{/if}}
      </div>
    </div>
  </div>
  <div class="parties">
    <div class="box">
      <div class="lbl">Quotation For</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} &nbsp; STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
    </div>
    {{#if customerEnquiryRef}}
    <div class="box">
      <div class="lbl">Your Enquiry Reference</div>
      <div class="v">{{customerEnquiryRef}}</div>
      {{#if enquiryDate}}<div class="s">Dated: {{fmtDate enquiryDate}}</div>{{/if}}
    </div>
    {{/if}}
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:36px">#</th>
      <th>Description</th>
      <th class="c" style="width:65px">Qty</th>
      <th class="c" style="width:55px">Unit</th>
      <th class="r" style="width:95px">Unit Price</th>
      <th class="r" style="width:105px">Amount</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{{richText this.description}}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="r">Rs {{fmt this.unitPrice}}</td>
        <td class="r">Rs {{fmt this.lineTotal}}</td>
      </tr>
    {{/each}}
    {{emptyRows (math 10 "-" items.length) 6}}
    </tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
    <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
    <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
  </div>
  <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
  {{#if notes}}<div class="notes"><strong>Notes / Terms &amp; Conditions:</strong><br>{{{nl2br notes}}}</div>{{/if}}
  <div class="closing">We thank you for the opportunity and look forward to your valued business.</div>
  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">Prepared By</div></div>
    <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
  </div>
</body></html>`
  },
  {
    id: "quote-green-gold",
    name: "Green & Gold",
    type: "SalesQuote",
    description: "Forest green and gold palette evoking prosperity, popular in Pakistani textile and commodity trade.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#1a2332;padding:0;}
.top-strip{height:6px;background:linear-gradient(90deg,#1b5e20,#f9a825,#1b5e20) !important;}
.hdr{padding:12px 18px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #c8e6c9;}
.brand img{height:60px;margin-bottom:4px;}
.cname{font-size:21px;font-weight:800;color:#1b5e20;text-transform:uppercase;letter-spacing:.5px;}
.caddr{font-size:10.5px;color:#555;margin-top:3px;line-height:1.4;}
.doctitle{text-align:right;}
.doctitle .t{font-size:26px;font-weight:800;letter-spacing:3px;color:#1b5e20;text-transform:uppercase;}
.doctitle .badge{display:inline-block;background:#f9a825 !important;color:#1b5e20 !important;font-size:13px;font-weight:800;padding:4px 14px;margin-top:5px;border-radius:3px;}
.doctitle .meta{font-size:11.5px;margin-top:5px;line-height:1.7;}
.body{padding:12px 18px;}
.parties{display:flex;gap:18px;margin-bottom:12px;}
.box{flex:1;padding:9px 12px;border:1px solid #c8e6c9;border-top:3px solid #f9a825;}
.box .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:800;color:#1b5e20;margin-bottom:4px;}
.box .v{font-size:13px;font-weight:700;}
.box .s{font-size:11px;color:#555;margin-top:2px;}
.validity-bar{background:#e8f5e9 !important;border:1px solid #a5d6a7;padding:5px 14px;font-size:11.5px;font-weight:700;color:#1b5e20;margin-bottom:10px;display:inline-block;border-radius:2px;}
table{width:100%;border-collapse:collapse;}
th{background:#1b5e20 !important;color:#f9a825 !important;font-size:11px;text-transform:uppercase;padding:8px 10px;text-align:left;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px solid #e8f5e9;padding:7px 10px;font-size:12px;}
tbody tr:nth-child(even) td{background:#f1f8f2 !important;}
.totals{margin-top:10px;width:275px;margin-left:auto;}
.totals .row{display:flex;justify-content:space-between;padding:4px 8px;font-size:12px;border-bottom:1px solid #e8f5e9;}
.grand{background:#1b5e20 !important;color:#f9a825 !important;font-weight:800;font-size:14px;border-bottom:none !important;border-radius:0 0 3px 3px;padding:7px 8px !important;}
.words{margin-top:10px;font-size:11px;font-style:italic;color:#555;padding:5px 10px;border-left:4px solid #f9a825;background:#fffde7 !important;}
.notes{margin-top:12px;font-size:11px;color:#555;border-top:1px dashed #a5d6a7;padding-top:8px;}
.bank-details{margin-top:12px;font-size:11px;border:1px solid #c8e6c9;padding:8px 12px;background:#f1f8f2 !important;}
.bank-details strong{color:#1b5e20;}
.sig{display:flex;justify-content:flex-end;margin-top:36px;}
.sig .b{text-align:center;}.sig .line{width:180px;border-top:2px solid #1b5e20;}.sig .l{font-size:10.5px;color:#555;margin-top:3px;}
.bottom-strip{height:6px;background:linear-gradient(90deg,#1b5e20,#f9a825,#1b5e20) !important;margin-top:14px;}
@media print{@page{size:A4;margin:0 0 0 0;}}
</style></head><body>
  <div class="top-strip"></div>
  <div class="hdr">
    <div>
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px">{{/if}}
      <div class="cname">{{companyBrandName}}</div>
      {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
      {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
    </div>
    <div class="doctitle">
      <div class="t">QUOTATION</div>
      <div class="badge"># {{quoteNumber}}</div>
      <div class="meta">
        <div><strong>Date:</strong> {{fmtDate date}}</div>
        {{#if validUntil}}<div><strong>Valid Until:</strong> {{fmtDate validUntil}}</div>{{/if}}
      </div>
    </div>
  </div>
  <div class="body">
    {{#if customerEnquiryRef}}<div class="validity-bar">Your Ref: {{customerEnquiryRef}}{{#if enquiryDate}} &mdash; {{fmtDate enquiryDate}}{{/if}}</div>{{/if}}
    <div class="parties">
      <div class="box">
        <div class="lbl">Quotation For</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} &nbsp; STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="c" style="width:36px">#</th>
        <th>Description</th>
        <th class="c" style="width:65px">Qty</th>
        <th class="c" style="width:55px">Unit</th>
        <th class="r" style="width:95px">Unit Price</th>
        <th class="r" style="width:105px">Amount</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{{richText this.description}}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="r">Rs {{fmt this.unitPrice}}</td>
          <td class="r">Rs {{fmt this.lineTotal}}</td>
        </tr>
      {{/each}}
      </tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
      <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
      <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
    </div>
    <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
    {{#if notes}}<div class="notes"><strong>Terms &amp; Conditions:</strong><br>{{{nl2br notes}}}</div>{{/if}}
    <div class="sig"><div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div></div>
  </div>
  <div class="bottom-strip"></div>
</body></html>`
  },
  {
    id: "quote-teal-slate",
    name: "Teal / Slate",
    type: "SalesQuote",
    description: "Cool teal header with slate-grey body, modern industrial wholesale aesthetic.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#263238;padding:0;}
.hdr{background:#00695c !important;color:#fff !important;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;}
.hdr img{height:60px;background:#fff;border-radius:3px;padding:3px;}
.cname{font-size:21px;font-weight:800;color:#fff !important;text-transform:uppercase;letter-spacing:1px;}
.caddr{font-size:10px;color:#b2dfdb !important;margin-top:3px;line-height:1.4;}
.doc-block{text-align:right;}
.doc-block .t{font-size:26px;font-weight:800;letter-spacing:3px;color:#e0f2f1 !important;}
.doc-block .meta{font-size:11px;color:#b2dfdb !important;margin-top:4px;line-height:1.7;}
.sub-bar{background:#37474f !important;color:#eceff1 !important;padding:5px 20px;display:flex;justify-content:space-between;font-size:11px;}
.sub-bar strong{color:#80cbc4 !important;}
.body{padding:12px 20px;}
.parties{display:flex;gap:18px;margin-bottom:12px;}
.box{flex:1;padding:9px 12px;background:#eceff1 !important;border-left:4px solid #00695c;}
.box .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:800;color:#00695c;margin-bottom:4px;}
.box .v{font-size:13px;font-weight:700;color:#263238;}
.box .s{font-size:11px;color:#546e7a;margin-top:2px;}
table{width:100%;border-collapse:collapse;}
th{background:#37474f !important;color:#80cbc4 !important;font-size:11px;text-transform:uppercase;padding:8px 10px;text-align:left;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px solid #eceff1;padding:7px 10px;font-size:12px;}
tbody tr:nth-child(even) td{background:#f5f7f8 !important;}
.totals{margin-top:10px;width:270px;margin-left:auto;}
.totals .row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#546e7a;border-bottom:1px solid #eceff1;}
.grand{border-top:2px solid #00695c !important;border-bottom:none !important;font-weight:800;font-size:15px;color:#00695c;padding-top:6px !important;}
.words{margin-top:10px;font-size:11px;font-style:italic;color:#546e7a;padding:5px 10px;background:#e0f2f1 !important;border-left:3px solid #00695c;}
.notes{margin-top:12px;font-size:11px;color:#546e7a;border-top:1px dashed #b2dfdb;padding-top:8px;}
.sig{display:flex;justify-content:space-between;margin-top:40px;}
.sig .b{text-align:center;}.sig .line{width:160px;border-top:1.5px solid #37474f;margin:0 auto;}.sig .l{font-size:10.5px;color:#546e7a;margin-top:3px;}
@media print{@page{size:A4;margin:0 0 10mm 0;}}
</style></head><body>
  <div class="hdr">
    <div style="display:flex;align-items:center;gap:14px;">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px">{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
        {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} | STRN: {{companySTRN}}{{/if}}</div>{{/if}}
      </div>
    </div>
    <div class="doc-block">
      <div class="t">QUOTATION</div>
      <div class="meta">
        <div># {{quoteNumber}}</div>
        <div>{{fmtDate date}}</div>
      </div>
    </div>
  </div>
  <div class="sub-bar">
    <span>{{#if validUntil}}<strong>Valid Until:</strong> {{fmtDate validUntil}}{{else}}&nbsp;{{/if}}</span>
    <span>{{#if customerEnquiryRef}}<strong>Your Ref:</strong> {{customerEnquiryRef}}{{#if enquiryDate}} ({{fmtDate enquiryDate}}){{/if}}{{/if}}</span>
  </div>
  <div class="body">
    <div class="parties">
      <div class="box">
        <div class="lbl">Quotation For</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} | STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="c" style="width:36px">#</th>
        <th>Description</th>
        <th class="c" style="width:65px">Qty</th>
        <th class="c" style="width:55px">Unit</th>
        <th class="r" style="width:95px">Unit Price</th>
        <th class="r" style="width:105px">Amount</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{{richText this.description}}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="r">Rs {{fmt this.unitPrice}}</td>
          <td class="r">Rs {{fmt this.lineTotal}}</td>
        </tr>
      {{/each}}
      </tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
      <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
      <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
    </div>
    <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
    {{#if notes}}<div class="notes"><strong>Notes / Terms:</strong><br>{{{nl2br notes}}}</div>{{/if}}
    <div class="sig">
      <div class="b"><div class="line"></div><div class="l">Prepared By</div></div>
      <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
    </div>
  </div>
</body></html>`
  },
  {
    id: "quote-big-letterhead",
    name: "Big Letterhead",
    type: "SalesQuote",
    description: "Oversized company name as decorative letterhead backdrop, large bold identity at the top.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#1a2332;padding:6px;}
.letterhead{text-align:center;padding:10px 0 4px;border-bottom:3px double #0d47a1;}
.letterhead img{height:64px;margin-bottom:6px;}
.lh-name{font-size:32px;font-weight:900;text-transform:uppercase;letter-spacing:3px;color:#0d47a1;}
.lh-tagline{font-size:11px;color:#888;letter-spacing:2px;margin-top:2px;text-transform:uppercase;}
.lh-info{font-size:11px;color:#555;margin-top:5px;line-height:1.5;}
.lh-tax{font-size:11px;font-weight:700;color:#333;margin-top:4px;}
.doc-row{display:flex;justify-content:space-between;align-items:flex-start;margin-top:14px;padding-bottom:10px;border-bottom:1px solid #d0dce8;}
.doc-title{font-size:24px;font-weight:800;letter-spacing:3px;color:#0d47a1;text-transform:uppercase;}
.doc-meta{text-align:right;font-size:11.5px;line-height:1.7;}
.validity-pill{display:inline-block;background:#e3f2fd !important;color:#0d47a1;font-size:11px;font-weight:700;padding:3px 12px;border-radius:20px;border:1px solid #bbdefb;margin-top:4px;}
.parties{display:flex;gap:18px;margin:12px 0;}
.box{flex:1;padding:9px 12px;border:1px solid #d0dce8;border-top:3px solid #0d47a1;}
.box .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:800;color:#0d47a1;margin-bottom:4px;}
.box .v{font-size:13.5px;font-weight:700;}
.box .s{font-size:11px;color:#555;margin-top:2px;}
table{width:100%;border-collapse:collapse;}
th{background:#0d47a1 !important;color:#fff !important;font-size:11px;text-transform:uppercase;padding:8px 10px;text-align:left;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px solid #e8eef5;padding:7px 10px;font-size:12px;}
tbody tr:nth-child(even) td{background:#f0f5fb !important;}
.totals{margin-top:10px;width:280px;margin-left:auto;}
.totals .row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid #e8eef5;}
.grand{border-top:2px solid #0d47a1 !important;border-bottom:none !important;font-weight:800;font-size:15px;color:#0d47a1;padding-top:7px !important;}
.words{margin-top:10px;font-size:11.5px;font-style:italic;color:#555;padding:5px 10px;background:#f0f5fb !important;border-left:3px solid #0d47a1;}
.notes{margin-top:12px;font-size:11px;color:#555;border-top:1px dashed #cdd8e8;padding-top:8px;}
.sig{display:flex;justify-content:space-between;margin-top:44px;}
.sig .b{text-align:center;}.sig .line{width:160px;border-top:1.5px solid #0d47a1;margin:0 auto;}.sig .l{font-size:10.5px;color:#555;margin-top:3px;}
@media print{@page{size:A4;margin:11mm;}}
</style></head><body>
  <div class="letterhead">
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:64px"><br>{{/if}}
    <div class="lh-name">{{companyBrandName}}</div>
    {{#if companyAddress}}<div class="lh-info">{{{nl2br companyAddress}}}</div>{{/if}}
    {{#if companyPhone}}<div class="lh-info">{{{nl2br companyPhone}}}</div>{{/if}}
    {{#if companyNTN}}<div class="lh-tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp; &bull; &nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="doc-row">
    <div>
      <div class="doc-title">QUOTATION</div>
      {{#if validUntil}}<div><span class="validity-pill">Valid Until: {{fmtDate validUntil}}</span></div>{{/if}}
    </div>
    <div class="doc-meta">
      <div><strong>Quote No.:</strong> {{quoteNumber}}</div>
      <div><strong>Date:</strong> {{fmtDate date}}</div>
      {{#if customerEnquiryRef}}<div><strong>Your Ref:</strong> {{customerEnquiryRef}}{{#if enquiryDate}} ({{fmtDate enquiryDate}}){{/if}}</div>{{/if}}
    </div>
  </div>
  <div class="parties">
    <div class="box">
      <div class="lbl">Quotation For</div>
      <div class="v">{{clientName}}</div>
      {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
      {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} &nbsp; STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
    </div>
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:36px">#</th>
      <th>Description</th>
      <th class="c" style="width:65px">Qty</th>
      <th class="c" style="width:55px">Unit</th>
      <th class="r" style="width:95px">Unit Price</th>
      <th class="r" style="width:105px">Amount</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{{richText this.description}}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="r">Rs {{fmt this.unitPrice}}</td>
        <td class="r">Rs {{fmt this.lineTotal}}</td>
      </tr>
    {{/each}}
    </tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
    <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
    <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
  </div>
  <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
  {{#if notes}}<div class="notes"><strong>Notes / Terms &amp; Conditions:</strong><br>{{{nl2br notes}}}</div>{{/if}}
  <div class="sig">
    <div class="b"><div class="line"></div><div class="l">Prepared By</div></div>
    <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
  </div>
</body></html>`
  },
  {
    id: "quote-centered-watermark",
    name: "Centered / Watermark Title",
    type: "SalesQuote",
    description: "Centered layout with large faded watermark QUOTATION behind the content for a dramatic print effect.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#1a2332;padding:6px;position:relative;}
.watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:88px;font-weight:900;color:rgba(13,71,161,0.07) !important;text-transform:uppercase;letter-spacing:10px;pointer-events:none;white-space:nowrap;z-index:0;}
.content{position:relative;z-index:1;}
.hdr{text-align:center;border-bottom:3px solid #0d47a1;padding-bottom:12px;margin-bottom:14px;}
.hdr img{height:60px;margin-bottom:6px;}
.cname{font-size:22px;font-weight:800;text-transform:uppercase;color:#0d47a1;letter-spacing:1.5px;}
.caddr{font-size:10.5px;color:#555;margin-top:3px;line-height:1.4;}
.doc-title-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;padding:8px 12px;background:#e3f2fd !important;border-left:4px solid #0d47a1;border-right:4px solid #0d47a1;}
.doc-title{font-size:22px;font-weight:900;letter-spacing:4px;color:#0d47a1;text-transform:uppercase;}
.doc-meta{text-align:right;font-size:11.5px;line-height:1.7;}
.validity-tag{display:inline-block;background:#0d47a1 !important;color:#fff !important;font-size:11px;font-weight:700;padding:3px 10px;border-radius:2px;margin-top:3px;}
.parties{display:flex;gap:18px;margin-bottom:12px;}
.box{flex:1;padding:9px 12px;border:1px solid #d0dce8;border-top:3px solid #0d47a1;}
.box .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:800;color:#0d47a1;margin-bottom:4px;}
.box .v{font-size:13px;font-weight:700;}
.box .s{font-size:11px;color:#555;margin-top:2px;}
table{width:100%;border-collapse:collapse;}
th{background:#0d47a1 !important;color:#fff !important;font-size:11px;text-transform:uppercase;padding:8px 10px;text-align:left;}
th.r,td.r{text-align:right;}th.c,td.c{text-align:center;}
td{border-bottom:1px solid #e8eef5;padding:7px 10px;font-size:12px;}
tbody tr:nth-child(even) td{background:#f0f5fb !important;}
.totals{margin-top:10px;width:280px;margin-left:auto;}
.totals .row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid #e8eef5;}
.grand{border-top:2px solid #0d47a1 !important;border-bottom:none !important;font-weight:800;font-size:15px;color:#0d47a1;padding-top:6px !important;}
.words{margin-top:10px;font-size:11.5px;font-style:italic;color:#555;padding:5px 10px;background:#f0f5fb !important;}
.notes{margin-top:12px;font-size:11px;color:#555;border-top:1px dashed #cdd8e8;padding-top:8px;}
.sig{display:flex;justify-content:space-between;margin-top:44px;}
.sig .b{text-align:center;}.sig .line{width:160px;border-top:1.5px solid #0d47a1;margin:0 auto;}.sig .l{font-size:10.5px;color:#555;margin-top:3px;}
@media print{@page{size:A4;margin:11mm;}}
</style></head><body>
  <div class="watermark">QUOTATION</div>
  <div class="content">
    <div class="hdr">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px"><br>{{/if}}
      <div class="cname">{{companyBrandName}}</div>
      {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
      {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
      {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
    </div>
    <div class="doc-title-row">
      <div>
        <div class="doc-title">QUOTATION</div>
        {{#if validUntil}}<div><span class="validity-tag">Valid Until: {{fmtDate validUntil}}</span></div>{{/if}}
      </div>
      <div class="doc-meta">
        <div><strong>Quote #:</strong> {{quoteNumber}}</div>
        <div><strong>Date:</strong> {{fmtDate date}}</div>
        {{#if customerEnquiryRef}}<div><strong>Your Ref:</strong> {{customerEnquiryRef}}{{#if enquiryDate}} ({{fmtDate enquiryDate}}){{/if}}</div>{{/if}}
      </div>
    </div>
    <div class="parties">
      <div class="box">
        <div class="lbl">Quotation For</div>
        <div class="v">{{clientName}}</div>
        {{#if clientAddress}}<div class="s">{{clientAddress}}</div>{{/if}}
        {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} &nbsp; STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
      </div>
    </div>
    <table>
      <thead><tr>
        <th class="c" style="width:36px">#</th>
        <th>Description</th>
        <th class="c" style="width:65px">Qty</th>
        <th class="c" style="width:55px">Unit</th>
        <th class="r" style="width:95px">Unit Price</th>
        <th class="r" style="width:105px">Amount</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c">{{this.sNo}}</td>
          <td>{{{richText this.description}}}</td>
          <td class="c">{{this.quantity}}</td>
          <td class="c">{{this.uom}}</td>
          <td class="r">Rs {{fmt this.unitPrice}}</td>
          <td class="r">Rs {{fmt this.lineTotal}}</td>
        </tr>
      {{/each}}
      </tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
      <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
      <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
    </div>
    <div class="words"><strong>Amount in Words:</strong> {{amountInWords}}</div>
    {{#if notes}}<div class="notes"><strong>Notes / Terms:</strong><br>{{{nl2br notes}}}</div>{{/if}}
    <div class="sig">
      <div class="b"><div class="line"></div><div class="l">Prepared By</div></div>
      <div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div>
    </div>
  </div>
</body></html>`
  },
  {
    id: "quote-govt-form-grid",
    name: "Government-Form Grid",
    type: "SalesQuote",
    description: "Rigid grid layout with labeled cells mimicking official Pakistani government procurement form style.",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation #{{quoteNumber}}</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
body{font-family:Arial,"Courier New",monospace;font-size:11px;color:#000;padding:6px;}
.outer{border:2px solid #000;}
.title-row{text-align:center;border-bottom:2px solid #000;padding:8px 4px;}
.title-row .main-title{font-size:18px;font-weight:700;letter-spacing:3px;text-transform:uppercase;}
.title-row .sub-title{font-size:11px;margin-top:3px;letter-spacing:1px;}
.company-row{display:flex;border-bottom:1.5px solid #000;}
.company-cell{flex:1;padding:7px 10px;border-right:1px solid #000;}
.company-cell:last-child{border-right:none;}
.field-label{font-size:8.5px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:3px;color:#333;}
.field-value{font-size:12px;font-weight:700;}
.field-sub{font-size:10.5px;color:#333;margin-top:2px;}
.doc-ref-row{display:flex;border-bottom:1.5px solid #000;}
.ref-cell{padding:5px 10px;border-right:1px solid #000;font-size:11px;}
.ref-cell:last-child{border-right:none;}
.ref-cell .fl{font-size:8.5px;text-transform:uppercase;font-weight:700;margin-bottom:2px;}
.ref-cell .fv{font-size:12px;font-weight:700;}
table.items{width:100%;border-collapse:collapse;border-top:1.5px solid #000;}
table.items th{background:#000 !important;color:#fff !important;font-size:10px;text-transform:uppercase;padding:6px 8px;text-align:left;border-right:1px solid #555;letter-spacing:.3px;}
table.items th:last-child{border-right:none;}
table.items th.r,table.items td.r{text-align:right;}
table.items th.c,table.items td.c{text-align:center;}
table.items td{border-bottom:1px solid #ccc;border-right:1px solid #ddd;padding:5px 8px;font-size:11px;}
table.items td:last-child{border-right:none;}
table.items tbody tr:nth-child(even) td{background:#f8f8f8 !important;}
.totals-section{border-top:1.5px solid #000;display:flex;}
.totals-left{flex:1;padding:8px 10px;border-right:1.5px solid #000;font-size:10.5px;}
.totals-right{width:240px;padding:0;}
.totals-right table{width:100%;border-collapse:collapse;}
.totals-right table td{padding:4px 10px;border-bottom:1px solid #ddd;font-size:11px;}
.totals-right table td:last-child{text-align:right;font-weight:700;}
.totals-right table tr:last-child td{font-weight:800;font-size:13px;background:#f0f0f0 !important;border-bottom:none;}
.words-row{border-top:1.5px solid #000;padding:7px 10px;font-size:11px;font-style:italic;}
.notes-row{border-top:1px solid #aaa;padding:7px 10px;font-size:10.5px;}
.sig-row{border-top:1.5px solid #000;display:flex;}
.sig-cell{flex:1;padding:8px 10px 14px;border-right:1px solid #aaa;text-align:center;}
.sig-cell:last-child{border-right:none;}
.sig-cell .sig-line{width:140px;border-top:1px solid #000;margin:20px auto 0;}
.sig-cell .sig-label{font-size:10px;margin-top:3px;}
@media print{@page{size:A4;margin:10mm;}}
</style></head><body>
  <div class="outer">
    <div class="title-row">
      <div class="main-title">QUOTATION / SALES QUOTE</div>
      <div class="sub-title">Subject to GST as applicable under Sales Tax Act 1990</div>
    </div>
    <div class="company-row">
      <div class="company-cell" style="flex:2;">
        <div class="field-label">Seller / Quotation By</div>
        {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:44px;margin-bottom:4px;display:block;">{{/if}}
        <div class="field-value">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="field-sub">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="field-sub">Tel: {{{nl2br companyPhone}}}</div>{{/if}}
        {{#if companyNTN}}<div class="field-sub">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
      </div>
      <div class="company-cell" style="flex:2;">
        <div class="field-label">Buyer / Quotation For</div>
        <div class="field-value">{{clientName}}</div>
        {{#if clientAddress}}<div class="field-sub">{{clientAddress}}</div>{{/if}}
        {{#if clientNTN}}<div class="field-sub">NTN: {{clientNTN}}{{#if clientSTRN}} &nbsp; STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
      </div>
      <div class="company-cell" style="flex:1;">
        <div class="field-label">Quote No.</div>
        <div class="field-value">{{quoteNumber}}</div>
        <div class="field-label" style="margin-top:6px;">Date</div>
        <div class="field-value">{{fmtDate date}}</div>
        {{#if validUntil}}<div class="field-label" style="margin-top:6px;">Valid Until</div>
        <div class="field-value">{{fmtDate validUntil}}</div>{{/if}}
      </div>
    </div>
    {{#if customerEnquiryRef}}
    <div class="doc-ref-row">
      <div class="ref-cell" style="flex:1;"><div class="fl">Your Enquiry Ref</div><div class="fv">{{customerEnquiryRef}}</div></div>
      {{#if enquiryDate}}<div class="ref-cell" style="flex:1;"><div class="fl">Enquiry Date</div><div class="fv">{{fmtDate enquiryDate}}</div></div>{{/if}}
      <div class="ref-cell" style="flex:2;">&nbsp;</div>
    </div>
    {{/if}}
    <table class="items">
      <thead><tr>
        <th class="c" style="width:32px">S#</th>
        <th>Description of Goods</th>
        <th class="c" style="width:60px">Qty</th>
        <th class="c" style="width:50px">UOM</th>
        <th class="r" style="width:90px">Unit Price</th>
        <th class="r" style="width:100px">Amount</th>
      </tr></thead>
      <tbody>
      {{#each items}}
        <tr>
          <td class="c cell">{{this.sNo}}</td>
          <td class="cell">{{{richText this.description}}}</td>
          <td class="c cell">{{this.quantity}}</td>
          <td class="c cell">{{this.uom}}</td>
          <td class="r cell">Rs {{fmt this.unitPrice}}</td>
          <td class="r cell">Rs {{fmt this.lineTotal}}</td>
        </tr>
      {{/each}}
      {{emptyRows (math 10 "-" items.length) 6}}
      </tbody>
    </table>
    <div class="totals-section">
      <div class="totals-left">
        <strong>Amount in Words:</strong><br>{{amountInWords}}
      </div>
      <div class="totals-right">
        <table><tbody>
          <tr><td>Subtotal</td><td>Rs {{fmt subtotal}}</td></tr>
          <tr><td>GST @ {{gstRate}}%</td><td>Rs {{fmt gstAmount}}</td></tr>
          <tr><td>Grand Total</td><td>Rs {{fmt grandTotal}}</td></tr>
        </tbody></table>
      </div>
    </div>
    {{#if notes}}<div class="notes-row"><strong>Notes / Terms &amp; Conditions:</strong><br>{{{nl2br notes}}}</div>{{/if}}
    <div class="sig-row">
      <div class="sig-cell"><div class="sig-line"></div><div class="sig-label">Prepared By</div></div>
      <div class="sig-cell"><div class="sig-line"></div><div class="sig-label">Checked By</div></div>
      <div class="sig-cell"><div class="sig-line"></div><div class="sig-label">For {{companyBrandName}}</div></div>
    </div>
  </div>
</body></html>`
  },
];


