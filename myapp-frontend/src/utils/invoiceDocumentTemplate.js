/** Shared eight-column bill / sales tax layout. Company branding and document
 * values always come from the print DTO; no tenant-specific content is stored here. */
const DOCUMENT = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>__TITLE__ #{{invoiceNumber}}</title>
<style>
@page { size:A4 portrait; margin:12mm 14mm 16mm; }
* { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html,body { margin:0; padding:0; }
body { font-family:Arial,Helvetica,sans-serif; color:#111; font-size:8pt; line-height:1.3; }
.header { position:relative; height:47mm; }
.company-logo { position:absolute; left:0; top:0; width:45mm; height:19mm; object-fit:contain; object-position:left top; }
.brand { position:absolute; left:0; top:0; font-size:20pt; font-weight:bold; }
.title { position:absolute; top:11mm; left:0; right:0; text-align:center; font-size:20pt; font-weight:bold; text-decoration:underline; white-space:nowrap; }
.meta { position:absolute; right:0; top:31mm; width:59mm; border-collapse:collapse; font-size:8.5pt; }
.meta td { padding:0.5mm 1mm; height:4.7mm; }
.meta-label { text-align:right; }
.meta-value { border:0.8pt solid #111; width:23mm; text-align:center; font-weight:bold; }
.parties { display:grid; grid-template-columns:1fr 1fr; border:0.8pt solid #111; break-inside:avoid; }
.party + .party { border-left:0.8pt solid #111; }
.party-title { text-align:center; font-size:9pt; font-weight:bold; padding:1.5mm 1mm; border-bottom:0.8pt solid #111; }
.party-body { min-height:30mm; padding:1.3mm 2mm; line-height:1.35; }
.detail { display:grid; grid-template-columns:12mm 2mm minmax(0,1fr); margin-bottom:0.35mm; }
.detail div:last-child { overflow-wrap:anywhere; min-width:0; }
.item-area { margin-top:24mm; }
.po { font-size:8pt; margin-bottom:2mm; }
.items { width:100%; border-collapse:collapse; table-layout:fixed; }
.items th,.items td { border-left:0.7pt solid #111; border-right:0.7pt solid #111; }
.items th { border-top:0.9pt solid #111; border-bottom:1.5pt double #111; height:10mm; padding:1mm 0.7mm; text-align:center; font-size:7.4pt; line-height:1.45; }
.items tbody td { padding:1.2mm 0.8mm; vertical-align:top; border-bottom:0.35pt solid #d6d6d6; overflow-wrap:anywhere; font-size:8pt; }
.items tbody td.cell { height:4mm; padding:0; }
.center { text-align:center; }
.money { text-align:right; white-space:nowrap; }
.uom { display:block; margin-top:0.5mm; font-size:7pt; line-height:1.1; }
.items tfoot td { height:9.5mm; padding:1.1mm 0.8mm; border-top:0.9pt solid #111; border-bottom:0.9pt solid #111; font-weight:bold; vertical-align:top; }
.ending { margin-top:4mm; border:0.8pt solid #111; break-inside:avoid; page-break-inside:avoid; }
.amount { min-height:22mm; padding:3mm 2.5mm; }
.amount-heading { font-style:italic; font-weight:bold; margin-bottom:1mm; }
.amount-text { width:85%; margin:auto; text-align:center; text-decoration:underline; font-weight:bold; }
.signatures { min-height:26mm; border-top:0.8pt solid #111; display:flex; align-items:flex-end; justify-content:space-around; gap:3mm; padding:4mm 12mm 7mm; }
.signature { display:flex; align-items:flex-end; gap:1mm; white-space:nowrap; font-size:8pt; }
.signature-line { display:inline-block; width:20mm; border-bottom:0.6pt solid #111; }
.bottom-strip { height:12mm; border-top:1.5pt double #111; }
.stamp-slot { display:block; text-align:center; }
.stamp-img { display:block; max-width:30mm; max-height:12mm; margin:0 auto 1mm; }
.fbr-section { display:flex; align-items:center; gap:4mm; padding:3mm; border-top:0.8pt solid #111; break-inside:avoid; page-break-inside:avoid; }
.fbr-info { flex:1; min-width:0; overflow-wrap:anywhere; font-size:8pt; line-height:1.5; }
.fbr-title { font-weight:bold; font-size:9pt; margin-bottom:1mm; }
.fbr-qr { flex:0 0 24mm; font-size:7pt; text-align:center; }
.fbr-qr img { display:block; width:24mm; height:24mm; }
.fbr-logo { width:21mm; height:21mm; object-fit:contain; }
@media print { thead { display:table-header-group; } tfoot { display:table-row-group; } tr { break-inside:avoid; page-break-inside:avoid; } }
@media screen { body { width:182mm; margin:12mm auto 16mm; } }
</style></head><body>
<div class="header">
 {{#if companyLogoPath}}<img class="company-logo" src="{{companyLogoPath}}" alt="{{companyBrandName}}">{{else}}<div class="brand">{{companyBrandName}}</div>{{/if}}
 <div class="title">__TITLE__</div>
 <table class="meta"><tr><td class="meta-label">__NUMBER_LABEL__ :</td><td class="meta-value">{{invoiceNumber}}</td></tr><tr><td class="meta-label">Dated :</td><td class="meta-value">{{fmtDate date}}</td></tr></table>
</div>
<div class="parties">
 <div class="party"><div class="party-title">Supplier's Details</div><div class="party-body">
  <div class="detail"><div>Name</div><div>:</div><div>{{companyBrandName}}</div></div>
  <div class="detail"><div>Address</div><div>:</div><div>{{{nl2br companyAddress}}}</div></div>
  <div class="detail"><div>Tel No.</div><div>:</div><div>{{companyPhone}}</div></div>
  <div class="detail"><div>GST No.</div><div>:</div><div>{{companySTRN}}</div></div>
  <div class="detail"><div>NTN No.</div><div>:</div><div>{{companyNTN}}</div></div>
 </div></div>
 <div class="party"><div class="party-title">Buyer's Details</div><div class="party-body">
  <div class="detail"><div>Name</div><div>:</div><div>{{__BUYER_NAME__}}</div></div>
  <div class="detail"><div>Address</div><div>:</div><div>{{{nl2br __BUYER_ADDRESS__}}}</div></div>
  <div class="detail"><div>Tel No.</div><div>:</div><div>{{__BUYER_PHONE__}}</div></div>
  <div class="detail"><div>GST No.</div><div>:</div><div>{{__BUYER_STRN__}}</div></div>
  <div class="detail"><div>NTN No.</div><div>:</div><div>{{__BUYER_NTN__}}</div></div>
 </div></div>
</div>
<div class="item-area">
 {{#if poNumber}}<div class="po"><b>PO #:</b> {{poNumber}}</div>{{/if}}
 <table class="items">
  <colgroup><col style="width:8.3%"><col style="width:33.7%"><col style="width:8.2%"><col style="width:8.3%"><col style="width:11.5%"><col style="width:5.8%"><col style="width:12.7%"><col style="width:11.5%"></colgroup>
  <thead><tr><th>S.No.</th><th>Description Of Goods</th><th>Qty.</th><th>Unit Price</th><th>Value Excl.<br>Sales Tax</th><th>GST %</th><th>Sales Tax<br>Amount</th><th>Value Incl.<br>Sales Tax</th></tr></thead>
  <tbody>{{#each items}}<tr>
   <td class="center">{{inc @index}}</td>
   <td>__DESCRIPTION__</td>
   <td class="center">{{this.quantity}}{{#if this.uom}}<span class="uom">{{this.uom}}</span>{{/if}}</td>
   <td class="money">{{fmt this.unitPrice}}</td>
   <td class="money">{{fmt this.valueExclTax}}</td>
   <td class="center">{{this.gstRate}}</td>
   <td class="money">{{fmt this.gstAmount}}</td>
   <td class="money">{{fmt this.totalInclTax}}</td>
  </tr>{{/each}}
  {{{emptyRows (math 7 "-" items.length) 8}}}
  </tbody>
  <tfoot><tr><td></td><td class="center">TOTAL</td><td></td><td></td><td class="money">{{fmt subtotal}}</td><td></td><td class="money">{{fmt gstAmount}}</td><td class="money">{{fmt grandTotal}}</td></tr></tfoot>
 </table>
</div>
<div class="ending">
 <div class="amount"><div class="amount-heading">Amount In Words :</div><div class="amount-text">{{amountInWords}}</div></div>
 {{#if (eq fbrStatus "Submitted")}}{{#if fbrIRN}}
 <div class="fbr-section" data-bill-fbr="true">
  <div class="fbr-info"><div class="fbr-title">FBR Digital Invoice</div><div><b>IRN:</b> {{fbrIRN}}</div>{{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}</div>
  {{#if fbrQrPngDataUrl}}<div class="fbr-qr"><img src="{{fbrQrPngDataUrl}}" alt="FBR Verify QR"><div>Scan to verify</div></div>{{/if}}
  {{#if fbrLogoUrl}}<img class="fbr-logo" src="{{fbrLogoUrl}}" alt="FBR Digital Invoicing">{{/if}}
 </div>
 {{/if}}{{/if}}
 <div class="signatures">
  <div class="signature">Prepared By<span class="signature-line"></span></div>
  <div><span class="stamp-slot"><img class="stamp-img" src="{{stamp}}" alt=""></span><div class="signature">Verified By<span class="signature-line"></span></div></div>
  <div class="signature">Received By<span class="signature-line"></span></div>
 </div>
 <div class="bottom-strip"></div>
</div>
</body></html>
`;

export function invoiceDocumentTemplate(type, { accent = "#111111", font = "Arial,Helvetica,sans-serif" } = {}) {
  const tax = type === "TaxInvoice";
  const buyer = tax ? "buyer" : "client";
  let html = DOCUMENT.replaceAll("__TITLE__", tax ? "Sales Tax Invoice" : "Invoice")
    .replaceAll("__NUMBER_LABEL__", tax ? "Sale Tax Inv #" : "Invoice #");
  for (const [token, field] of [["NAME", "Name"], ["ADDRESS", "Address"], ["PHONE", "Phone"], ["STRN", "STRN"], ["NTN", "NTN"]]) {
    html = html.replaceAll(`__BUYER_${token}__`, buyer + field);
  }
  html = html.replace("__DESCRIPTION__", tax
    ? '{{#if this.hsCode}}{{this.hsCode}} - {{/if}}{{#if this.itemTypeName}}{{{richText this.itemTypeName}}}{{else}}{{{richText this.description}}}{{/if}}'
    : '{{{richText this.description}}}');
  return html.replace("</style>", `body { font-family:${font}; } .title,.fbr-title { color:${accent}; } .party-title { color:${accent}; } </style>`);
}
