// Default print templates for the Sales Quote (priced) and Sales Order
// (quantity-only) documents. Kept in their own module so the large
// defaultTemplates.js (Challan / Bill / TaxInvoice) stays untouched.
// Tokens are Handlebars and match the merge fields seeded for "SalesQuote"
// and "SalesOrder" — see AppDbContext MergeField seed + PrintQuoteDto /
// PrintOrderDto. Operators can override these per-company in the Template
// Editor; these are just the starting layout.

const SHARED_CSS = `
  * { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  body { font-family:"Segoe UI", Arial, sans-serif; font-size:12px; color:#1a2332; padding:4px; }
  .hdr { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:10px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .brand img { height:62px; }
  .cname { font-size:25px; font-weight:800; text-transform:uppercase; letter-spacing:1px; }
  .caddr { font-size:11px; color:#555; margin-top:3px; line-height:1.4; }
  .doc { text-align:right; white-space:nowrap; padding-left:18px; }
  .doc .t { font-size:21px; font-weight:800; letter-spacing:2px; }
  .doc .meta { font-size:12px; margin-top:6px; line-height:1.6; }
  .parties { display:flex; justify-content:space-between; margin-top:16px; gap:20px; }
  .box { flex:1; }
  .box .lbl { font-size:10px; text-transform:uppercase; color:#888; font-weight:700; letter-spacing:.5px; }
  .box .v { font-size:13px; font-weight:700; margin-top:2px; }
  .box .s { font-size:11px; color:#555; margin-top:2px; }
  table { width:100%; border-collapse:collapse; margin-top:16px; }
  th { color:#fff !important; font-size:11px; text-transform:uppercase; padding:8px 10px; text-align:left; }
  th.r, td.r { text-align:right; } th.c, td.c { text-align:center; }
  td { border-bottom:1px solid #e3e3e3; padding:7px 10px; font-size:12px; }
  tbody tr:nth-child(even) td { background:#f6f8fb !important; }
  .totals { margin-top:8px; width:300px; margin-left:auto; }
  .totals .row { display:flex; justify-content:space-between; padding:4px 0; }
  .grand { border-top:2px solid #0d47a1; font-weight:800; font-size:15px; color:#0d47a1; padding-top:6px; }
  .words { margin-top:10px; font-style:italic; font-size:12px; }
  .notes { margin-top:14px; font-size:11px; color:#555; white-space:pre-line; border-top:1px dashed #ccc; padding-top:8px; }
  .statusline { margin-top:14px; font-size:13px; font-weight:700; }
  .sig { display:flex; justify-content:flex-end; margin-top:46px; }
  .sig .b { text-align:center; } .sig .line { width:200px; border-top:1.5px solid #888; } .sig .l { font-size:11px; margin-top:3px; }
  @media print { @page { size:A4; margin:12mm; } }
`;

export const defaultQuoteTemplate = `<!DOCTYPE html><html><head><title>Quotation #{{quoteNumber}}</title>
<style>${SHARED_CSS}
  .hdr { border-bottom:3px solid #0d47a1; }
  .cname { color:#0d47a1; }
  .doc .t { color:#00897b; }
  th { background:#0d47a1 !important; }
</style></head><body>
  <div class="hdr">
    <div class="brand">
      {{#if companyLogoPath}}<img src="{{companyLogoPath}}" />{{/if}}
      <div>
        <div class="cname">{{companyBrandName}}</div>
        {{#if companyAddress}}<div class="caddr">{{{nl2br companyAddress}}}</div>{{/if}}
        {{#if companyPhone}}<div class="caddr">{{{nl2br companyPhone}}}</div>{{/if}}
        {{#if companyNTN}}<div class="caddr">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
      </div>
    </div>
    <div class="doc">
      <div class="t">QUOTATION</div>
      <div class="meta">
        <div><strong>Quote #:</strong> {{quoteNumber}}</div>
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
      {{#if clientNTN}}<div class="s">NTN: {{clientNTN}}{{#if clientSTRN}} &nbsp; STRN: {{clientSTRN}}{{/if}}</div>{{/if}}
    </div>
    {{#if customerEnquiryRef}}
    <div class="box" style="text-align:right">
      <div class="lbl">Your Enquiry Ref</div>
      <div class="v">{{customerEnquiryRef}}</div>
      {{#if enquiryDate}}<div class="s">{{fmtDate enquiryDate}}</div>{{/if}}
    </div>
    {{/if}}
  </div>

  <table>
    <thead><tr>
      <th class="c" style="width:36px">#</th>
      <th>Description</th>
      <th class="c" style="width:70px">Qty</th>
      <th class="c" style="width:60px">Unit</th>
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
        <td class="r">{{fmt this.unitPrice}}</td>
        <td class="r">{{fmt this.lineTotal}}</td>
      </tr>
    {{/each}}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>Rs {{fmt subtotal}}</span></div>
    <div class="row"><span>GST @ {{gstRate}}%</span><span>Rs {{fmt gstAmount}}</span></div>
    <div class="row grand"><span>Grand Total</span><span>Rs {{fmt grandTotal}}</span></div>
  </div>
  <div class="words"><strong>Amount in words:</strong> {{amountInWords}}</div>
  {{#if notes}}<div class="notes"><strong>Notes / Terms:</strong><br>{{{nl2br notes}}}</div>{{/if}}

  <div class="sig"><div class="b"><div class="line"></div><div class="l">For {{companyBrandName}}</div></div></div>
</body></html>`;

export const defaultOrderTemplate = `<!DOCTYPE html><html><head><title>Sales Order #{{salesOrderNumber}}</title>
<style>${SHARED_CSS}
  .hdr { border-bottom:3px solid #00897b; }
  .cname { color:#00695c; }
  .doc .t { color:#0d47a1; }
  th { background:#00897b !important; }
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
      <div class="t">SALES ORDER</div>
      <div class="meta">
        <div><strong>Order #:</strong> {{salesOrderNumber}}</div>
        <div><strong>Order Date:</strong> {{fmtDate orderDate}}</div>
        {{#if requiredDate}}<div><strong>Required By:</strong> {{fmtDate requiredDate}}</div>{{/if}}
        {{#if customerPoNumber}}<div><strong>Customer PO:</strong> {{customerPoNumber}}</div>{{/if}}
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

  <table>
    <thead><tr>
      <th class="c" style="width:36px">#</th>
      <th>Description</th>
      <th class="c" style="width:70px">Ordered</th>
      <th class="c" style="width:60px">Unit</th>
      <th class="c" style="width:80px">Delivered</th>
      <th class="c" style="width:80px">Remaining</th>
    </tr></thead>
    <tbody>
    {{#each items}}
      <tr>
        <td class="c">{{this.sNo}}</td>
        <td>{{{richText this.description}}}</td>
        <td class="c">{{this.quantity}}</td>
        <td class="c">{{this.uom}}</td>
        <td class="c">{{this.deliveredQuantity}}</td>
        <td class="c">{{this.remainingQuantity}}</td>
      </tr>
    {{/each}}
    </tbody>
  </table>

  <div class="statusline">Fulfilment Status: {{status}}</div>

  <div class="sig"><div class="b"><div class="line"></div><div class="l">Authorised Signature</div></div></div>
</body></html>`;
