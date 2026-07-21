/**
 * Starter templates for Credit Note — FBR digital-invoicing sales-return / adjustment documents.
 * Pakistani wholesale ERP, A4 print-ready, Handlebars merge fields.
 * Registered helpers: fmtDate, fmt, fmtDec, nl2br, richText, join, joinDates, emptyRows, math, inc, eq, gt, or
 * CreditNote merge fields: supplierName, supplierLogoPath, supplierAddress, supplierPhone, supplierNTN,
 *   supplierSTRN, buyerName, buyerAddress, buyerPhone, buyerNTN, buyerSTRN, invoiceNumber (the note's own
 *   number), date, subtotal, gstRate, gstAmount, grandTotal, amountInWords, originalInvoiceNumber,
 *   originalInvoiceDate, originalInvoiceRefIRN, noteReason, noteReasonRemarks, noteKindLabel,
 *   fbrIRN, fbrStatus, fbrSubmittedAt, fbrQrPngDataUrl, fbrLogoUrl.
 * Item loop fields: this.itemTypeName, this.quantity, this.uom, this.description, this.hsCode,
 *   this.valueExclTax, this.gstRate, this.gstAmount, this.totalInclTax.
 */

export const creditNoteStarters = [

  // ─── 1. Classic Serif ────────────────────────────────────────
  {
    id: "creditnote-classic-serif",
    name: "Classic Serif",
    type: "CreditNote",
    description: "Traditional Times New Roman layout with double-rule header, maroon note title and FBR block",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 8mm 10mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer { margin-top: auto; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #000; padding-bottom: 10px; margin-bottom: 10px; }
.logo-name { font-size: 28pt; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; }
.sup-sub { font-size: 9pt; color: #333; margin-top: 3px; line-height: 1.4; }
.note-head { text-align: right; }
.note-title { font-size: 18pt; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; border: 2px solid #7b1e26; color: #7b1e26; padding: 4px 10px; display: inline-block; }
.note-meta { font-size: 10pt; margin-top: 6px; line-height: 1.6; }
.parties { display: flex; gap: 14px; margin: 8px 0; }
.party { flex: 1; border: 1px solid #000; padding: 6px 10px; font-size: 10pt; line-height: 1.55; }
.party-hdr { font-size: 9pt; font-weight: 700; text-decoration: underline; margin-bottom: 3px; text-transform: uppercase; }
.party-name { font-size: 12pt; font-weight: 700; font-style: italic; }
.prow { display: flex; }
.prow .pl { font-weight: 700; min-width: 65px; }
.ref-note { border: 1px solid #7b1e26; background: #fdf3f4 !important; padding: 5px 10px; margin: 6px 0; font-size: 10pt; line-height: 1.6; }
.ref-note b { color: #7b1e26; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #222 !important; color: #fff !important; font-size: 9pt; font-family: Arial, sans-serif; padding: 4px 6px; border: 1px solid #222; text-align: center; }
.cell { border: 1px solid #777; padding: 3px 6px; font-size: 10pt; height: 22px; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #f0f0f0 !important; }
.tfoot-row td { font-weight: 700; border: 1px solid #000; padding: 3px 6px; background: #ddd !important; font-size: 10pt; }
.words-area { border: 1px solid #000; margin-top: 8px; display: flex; }
.words-lbl { padding: 4px 10px; border-right: 1px solid #000; font-weight: 700; font-size: 10pt; white-space: nowrap; }
.words-val { padding: 4px 12px; font-size: 11pt; font-weight: 700; }
.fbr-block { border: 2px solid #007532; border-radius: 4px; padding: 8px 12px; margin-top: 10px; display: flex; align-items: center; gap: 16px; background: #f0fff4 !important; }
.fbr-info { flex: 1; font-size: 9pt; line-height: 1.6; }
.fbr-info .fbr-irn { font-size: 10pt; font-weight: 700; color: #007532; }
.sig-row { display: flex; justify-content: space-between; margin-top: 36px; padding: 0 40px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1px solid #000; margin-bottom: 3px; }
.sig .label { font-size: 9pt; font-weight: 700; text-transform: uppercase; }
</style></head><body>
<div class="main">
<div class="header">
  <div>
    {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:52px;margin-bottom:4px;display:block">{{/if}}
    <div class="logo-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="sup-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div class="sup-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
    {{#if supplierNTN}}<div class="sup-sub"><b>NTN:</b> {{supplierNTN}}{{#if supplierSTRN}} &bull; <b>STRN:</b> {{supplierSTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="note-head">
    <div class="note-title">CREDIT NOTE</div>
    <div class="note-meta">
      <b>Credit Note #:</b> {{invoiceNumber}}<br>
      <b>Date:</b> {{fmtDate date}}<br>
    </div>
  </div>
</div>
<div class="parties">
  <div class="party">
    <div class="party-hdr">Supplier</div>
    <div class="party-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="prow"><span class="pl">Address:</span><span>{{supplierAddress}}</span></div>{{/if}}
    {{#if supplierSTRN}}<div class="prow"><span class="pl">STRN:</span><span>{{supplierSTRN}}</span></div>{{/if}}
    {{#if supplierNTN}}<div class="prow"><span class="pl">NTN:</span><span>{{supplierNTN}}</span></div>{{/if}}
  </div>
  <div class="party">
    <div class="party-hdr">Buyer</div>
    <div class="party-name">{{buyerName}}</div>
    {{#if buyerAddress}}<div class="prow"><span class="pl">Address:</span><span>{{{nl2br buyerAddress}}}</span></div>{{/if}}
    {{#if buyerPhone}}<div class="prow"><span class="pl">Phone:</span><span>{{buyerPhone}}</span></div>{{/if}}
    {{#if buyerSTRN}}<div class="prow"><span class="pl">STRN:</span><span>{{buyerSTRN}}</span></div>{{/if}}
    {{#if buyerNTN}}<div class="prow"><span class="pl">NTN:</span><span>{{buyerNTN}}</span></div>{{/if}}
  </div>
</div>
{{#if (or (or originalInvoiceNumber originalInvoiceRefIRN) noteReason)}}
<div class="ref-note">
  {{#if originalInvoiceNumber}}<div><b>Against Invoice #</b> {{originalInvoiceNumber}} <b>dated</b> {{fmtDate originalInvoiceDate}}</div>{{/if}}
  {{#if originalInvoiceRefIRN}}<div><b>Ref IRN:</b> {{originalInvoiceRefIRN}}</div>{{/if}}
  {{#if noteReason}}<div><b>Reason:</b> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</div>{{/if}}
</div>
{{/if}}
<table class="items">
  <thead>
    <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th>Description</th><th style="width:88px">Value Excl. Tax</th><th style="width:46px">Rate</th><th style="width:78px">Sales Tax</th><th style="width:88px">Value Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 14 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT :</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="words-area"><span class="words-lbl">Amount In Words:</span><span class="words-val">{{amountInWords}}</span></div>
{{#if fbrIRN}}
<div class="fbr-block">
  <img src="{{fbrLogoUrl}}" style="height:42px">
  <div class="fbr-info">
    <div class="fbr-irn">FBR Invoice Reference No: {{fbrIRN}}</div>
    {{#if fbrStatus}}<div>Status: {{fbrStatus}}</div>{{/if}}
    {{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
</div>
{{/if}}
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 2. Modern Minimal ───────────────────────────────────────
  {
    id: "creditnote-modern-minimal",
    name: "Modern Minimal",
    type: "CreditNote",
    description: "Clean sans-serif with a thin crimson accent bar, whitespace-driven layout",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Calibri, Arial, sans-serif; padding: 8mm 10mm; color: #1a1a1a; display: flex; flex-direction: column; min-height: 100vh; font-size: 10pt; }
.main { flex: 1; }
.footer { margin-top: auto; }
.accent { height: 3px; background: #b71c1c !important; margin-bottom: 16px; }
.top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.sup-name { font-size: 22pt; font-weight: 800; color: #b71c1c; letter-spacing: 0.5px; }
.sup-sub { font-size: 8.5pt; color: #555; margin-top: 3px; line-height: 1.5; }
.note-tag { display: inline-block; background: #b71c1c !important; color: #fff !important; padding: 5px 14px; border-radius: 3px; font-size: 11pt; font-weight: 700; letter-spacing: 2px; }
.note-meta { text-align: right; margin-top: 8px; font-size: 9pt; color: #555; line-height: 1.7; }
.note-meta strong { color: #111; }
.parties { display: flex; gap: 12px; margin-bottom: 8px; }
.party { flex: 1; padding: 8px 12px; border-left: 3px solid #b71c1c; background: #fdf6f6 !important; }
.pty-lbl { font-size: 7.5pt; text-transform: uppercase; color: #888; font-weight: 700; letter-spacing: 0.6px; }
.pty-name { font-size: 12pt; font-weight: 700; margin-top: 2px; }
.pty-det { font-size: 8.5pt; color: #444; margin-top: 2px; line-height: 1.5; }
.reason-strip { border-left: 3px solid #b71c1c; background: #fdf3f3 !important; padding: 5px 10px; margin-bottom: 8px; font-size: 9pt; color: #444; }
.reason-strip strong { color: #b71c1c; }
table.items { width: 100%; border-collapse: collapse; margin-top: 8px; }
table.items thead th { border-bottom: 2px solid #b71c1c; font-size: 8pt; text-transform: uppercase; color: #b71c1c; padding: 5px 6px; text-align: center; background: transparent !important; letter-spacing: 0.4px; }
table.items thead th.left { text-align: left; }
.cell { border-bottom: 1px solid #ebebeb; padding: 4px 6px; height: 22px; font-size: 9pt; }
.c { text-align: center; } .r { text-align: right; }
.tfoot-row td { border-top: 2px solid #b71c1c; border-bottom: none; font-weight: 700; padding: 4px 6px; font-size: 9.5pt; background: #fbe9e9 !important; }
.totals-row { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 10px; }
.words-box { flex: 1; padding-right: 20px; }
.words-lbl { font-size: 8.5pt; color: #777; font-weight: 700; }
.words-val { font-size: 10pt; font-weight: 700; margin-top: 3px; }
.fbr-strip { display: flex; align-items: center; gap: 14px; margin-top: 10px; padding: 8px 12px; border: 1.5px solid #b71c1c; border-radius: 4px; background: #fdf3f3 !important; }
.fbr-info { flex: 1; font-size: 8.5pt; line-height: 1.6; }
.fbr-irn { font-weight: 700; font-size: 9.5pt; color: #b71c1c; }
.sig-row { display: flex; justify-content: space-between; margin-top: 32px; padding: 0 30px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 2px solid #b71c1c; margin-bottom: 3px; }
.sig .label { font-size: 8pt; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="main">
<div class="accent"></div>
<div class="top">
  <div>
    {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:44px;margin-bottom:4px;display:block">{{/if}}
    <div class="sup-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="sup-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div class="sup-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
    {{#if supplierNTN}}<div class="sup-sub"><strong>NTN:</strong> {{supplierNTN}}{{#if supplierSTRN}} &nbsp;|&nbsp; <strong>STRN:</strong> {{supplierSTRN}}{{/if}}</div>{{/if}}
  </div>
  <div style="text-align:right">
    <div class="note-tag">CREDIT NOTE</div>
    <div class="note-meta">
      <strong>Note #:</strong> {{invoiceNumber}}<br>
      <strong>Date:</strong> {{fmtDate date}}
    </div>
  </div>
</div>
<div class="parties">
  <div class="party">
    <div class="pty-lbl">Supplier</div>
    <div class="pty-name">{{supplierName}}</div>
    <div class="pty-det">
      {{#if supplierAddress}}{{supplierAddress}}<br>{{/if}}
      {{#if supplierSTRN}}<strong>STRN:</strong> {{supplierSTRN}}<br>{{/if}}
      {{#if supplierNTN}}<strong>NTN:</strong> {{supplierNTN}}{{/if}}
    </div>
  </div>
  <div class="party">
    <div class="pty-lbl">Buyer</div>
    <div class="pty-name">{{buyerName}}</div>
    <div class="pty-det">
      {{#if buyerAddress}}{{{nl2br buyerAddress}}}<br>{{/if}}
      {{#if buyerPhone}}<strong>Ph:</strong> {{buyerPhone}}<br>{{/if}}
      {{#if buyerSTRN}}<strong>STRN:</strong> {{buyerSTRN}}<br>{{/if}}
      {{#if buyerNTN}}<strong>NTN:</strong> {{buyerNTN}}{{/if}}
    </div>
  </div>
  <div class="party" style="border-left-color:#aaa;background:#fafafa !important">
    <div class="pty-lbl">Reference</div>
    <div class="pty-det">
      {{#if originalInvoiceNumber}}Against Invoice # {{originalInvoiceNumber}} dated {{fmtDate originalInvoiceDate}}<br>{{/if}}
      {{#if originalInvoiceRefIRN}}Ref IRN: {{originalInvoiceRefIRN}}{{/if}}
    </div>
  </div>
</div>
{{#if noteReason}}<div class="reason-strip"><strong>Reason:</strong> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</div>{{/if}}
<table class="items">
  <thead>
    <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th class="left">Description</th><th style="width:88px">Value Excl. Tax</th><th style="width:44px">Rate</th><th style="width:76px">Sales Tax</th><th style="width:88px">Value Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 14 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="totals-row">
  <div class="words-box"><div class="words-lbl">Amount In Words</div><div class="words-val">{{amountInWords}}</div></div>
</div>
{{#if fbrIRN}}
<div class="fbr-strip">
  <img src="{{fbrLogoUrl}}" style="height:42px">
  <div class="fbr-info">
    <div class="fbr-irn">FBR Invoice Reference No: {{fbrIRN}}</div>
    {{#if fbrStatus}}<div>Status: {{fbrStatus}}</div>{{/if}}
    {{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
</div>
{{/if}}
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 3. Corporate Maroon Band ────────────────────────────────
  {
    id: "creditnote-corporate-navy",
    name: "Corporate Maroon Band",
    type: "CreditNote",
    description: "Deep maroon header band with white text, reference bar and maroon-accented tables",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #111; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; padding: 0 10mm 6mm; }
.footer { margin-top: auto; padding: 0 10mm 8mm; }
.mar-band { background: #7b1e26 !important; color: #fff !important; padding: 12px 10mm; display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.mar-name { font-size: 22pt; font-weight: 800; letter-spacing: 1px; color: #fff !important; }
.mar-sub { font-size: 8.5pt; color: #dfb3b7 !important; margin-top: 3px; line-height: 1.4; }
.mar-note { text-align: right; }
.mar-note-title { font-size: 13pt; font-weight: 700; letter-spacing: 3px; color: #ffd700 !important; }
.mar-note-num { font-size: 11pt; color: #fff !important; margin-top: 4px; }
.mar-note-date { font-size: 9pt; color: #dfb3b7 !important; margin-top: 2px; }
.ref-bar { background: #f9ecec !important; border-left: 4px solid #7b1e26; padding: 6px 12px; margin-bottom: 8px; font-size: 9pt; display: flex; gap: 24px; flex-wrap: wrap; }
.ref-bar span strong { color: #7b1e26; }
.reason-bar { background: #f9ecec !important; border-left: 4px solid #7b1e26; padding: 6px 12px; margin-bottom: 10px; font-size: 9pt; }
.reason-bar strong { color: #7b1e26; }
.parties { display: flex; gap: 12px; margin-bottom: 10px; }
.party { flex: 1; border: 1px solid #e0c3c6; padding: 8px 10px; font-size: 9.5pt; line-height: 1.55; }
.party-hdr { font-size: 8pt; text-transform: uppercase; font-weight: 700; color: #7b1e26; letter-spacing: 0.5px; border-bottom: 1px solid #e0c3c6; padding-bottom: 3px; margin-bottom: 5px; }
.party-name { font-size: 12pt; font-weight: 700; }
.party-row { display: flex; }
.party-row .lbl { font-weight: 700; min-width: 58px; font-size: 9pt; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #7b1e26 !important; color: #fff !important; font-size: 8pt; padding: 5px 6px; border: 1px solid #7b1e26; text-align: center; text-transform: uppercase; letter-spacing: 0.3px; }
table.items th.left { text-align: left; }
.cell { border: 1px solid #e0c3c6; padding: 3px 6px; font-size: 9.5pt; height: 21px; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #f9eff0 !important; }
.tfoot-row td { font-weight: 700; border: 1px solid #7b1e26; padding: 3px 6px; background: #7b1e26 !important; color: #fff !important; font-size: 9.5pt; }
.words-area { border: 1px solid #e0c3c6; margin-top: 8px; display: flex; }
.words-lbl { padding: 4px 10px; border-right: 1px solid #e0c3c6; font-weight: 700; font-size: 9pt; white-space: nowrap; background: #f9ecec !important; }
.words-val { padding: 4px 12px; font-size: 10pt; font-weight: 700; }
.fbr-block { display: flex; align-items: center; gap: 14px; margin-top: 10px; padding: 8px 12px; border: 2px solid #7b1e26; background: #f9ecec !important; }
.fbr-info { flex: 1; font-size: 8.5pt; line-height: 1.7; }
.fbr-irn { font-weight: 700; font-size: 10pt; color: #7b1e26; }
.sig-row { display: flex; justify-content: space-between; margin-top: 36px; padding: 0 40px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 1.5px solid #7b1e26; margin-bottom: 3px; }
.sig .label { font-size: 8.5pt; color: #555; text-transform: uppercase; font-weight: 700; }
</style></head><body>
<div class="mar-band">
  <div>
    {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:44px;margin-bottom:4px;display:block">{{/if}}
    <div class="mar-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="mar-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div class="mar-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
    {{#if supplierNTN}}<div class="mar-sub">NTN: {{supplierNTN}}{{#if supplierSTRN}} &nbsp;|&nbsp; STRN: {{supplierSTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="mar-note">
    <div class="mar-note-title">CREDIT NOTE</div>
    <div class="mar-note-num"># {{invoiceNumber}}</div>
    <div class="mar-note-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="main">
<div class="ref-bar">
  {{#if originalInvoiceNumber}}<span><strong>Against Invoice #</strong> {{originalInvoiceNumber}} <strong>dated</strong> {{fmtDate originalInvoiceDate}}</span>{{/if}}
  {{#if originalInvoiceRefIRN}}<span><strong>Ref IRN:</strong> {{originalInvoiceRefIRN}}</span>{{/if}}
  <span><strong>Document:</strong> {{#if noteKindLabel}}{{noteKindLabel}}{{else}}Credit Note{{/if}}</span>
</div>
{{#if noteReason}}<div class="reason-bar"><strong>Reason:</strong> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</div>{{/if}}
<div class="parties">
  <div class="party">
    <div class="party-hdr">Supplier</div>
    <div class="party-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="party-row"><span class="lbl">Address:</span><span>{{supplierAddress}}</span></div>{{/if}}
    {{#if supplierSTRN}}<div class="party-row"><span class="lbl">STRN:</span><span>{{supplierSTRN}}</span></div>{{/if}}
    {{#if supplierNTN}}<div class="party-row"><span class="lbl">NTN:</span><span>{{supplierNTN}}</span></div>{{/if}}
  </div>
  <div class="party">
    <div class="party-hdr">Buyer</div>
    <div class="party-name">{{buyerName}}</div>
    {{#if buyerAddress}}<div class="party-row"><span class="lbl">Address:</span><span>{{{nl2br buyerAddress}}}</span></div>{{/if}}
    {{#if buyerPhone}}<div class="party-row"><span class="lbl">Phone:</span><span>{{buyerPhone}}</span></div>{{/if}}
    {{#if buyerSTRN}}<div class="party-row"><span class="lbl">STRN:</span><span>{{buyerSTRN}}</span></div>{{/if}}
    {{#if buyerNTN}}<div class="party-row"><span class="lbl">NTN:</span><span>{{buyerNTN}}</span></div>{{/if}}
  </div>
</div>
<table class="items">
  <thead>
    <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th class="left">Description</th><th style="width:88px">Value Excl. Tax</th><th style="width:44px">Rate</th><th style="width:76px">Sales Tax</th><th style="width:88px">Value Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 14 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="words-area"><span class="words-lbl">Amount In Words:</span><span class="words-val">{{amountInWords}}</span></div>
{{#if fbrIRN}}
<div class="fbr-block">
  <img src="{{fbrLogoUrl}}" style="height:42px">
  <div class="fbr-info">
    <div class="fbr-irn">FBR Invoice Reference No: {{fbrIRN}}</div>
    {{#if fbrStatus}}<div>Status: {{fbrStatus}}</div>{{/if}}
    {{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
</div>
{{/if}}
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 4. Bold Colored Banner ──────────────────────────────────
  {
    id: "creditnote-bold-banner",
    name: "Bold Colored Banner",
    type: "CreditNote",
    description: "Crimson/rust gradient banner with bold typography and FBR QR sidebar",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Calibri, Arial, sans-serif; color: #111; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; padding: 0 10mm 6mm; }
.footer { margin-top: auto; padding: 0 10mm 8mm; }
.banner { background: linear-gradient(135deg, #b71c1c 0%, #7f0000 55%, #e65100 100%) !important; padding: 14px 10mm 10px; display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; }
.ban-name { font-size: 24pt; font-weight: 900; color: #fff !important; text-transform: uppercase; letter-spacing: 1.5px; }
.ban-sub { font-size: 8.5pt; color: #f5c6c2 !important; margin-top: 3px; line-height: 1.4; }
.ban-right { text-align: right; }
.ban-title { font-size: 11pt; font-weight: 700; letter-spacing: 3px; color: #fff !important; text-transform: uppercase; border: 2px solid rgba(255,255,255,0.6); padding: 4px 10px; display: inline-block; }
.ban-num { font-size: 14pt; font-weight: 800; color: #fff !important; margin-top: 5px; }
.ban-date { font-size: 9pt; color: #f5c6c2 !important; margin-top: 2px; }
.meta-strip { display: flex; gap: 20px; flex-wrap: wrap; background: #f5f5f5 !important; padding: 5px 12px; border-bottom: 2px solid #b71c1c; font-size: 9pt; margin-bottom: 8px; }
.meta-strip b { color: #b71c1c; }
.reason-strip { border-left: 3px solid #e65100; background: #fff3e0 !important; padding: 5px 12px; margin-bottom: 8px; font-size: 9pt; }
.reason-strip b { color: #b71c1c; }
.parties { display: flex; gap: 12px; margin-bottom: 10px; }
.party { flex: 1; border-top: 3px solid #b71c1c; padding: 7px 10px; font-size: 9.5pt; line-height: 1.5; background: #fafafa !important; }
.party-hdr { font-size: 7.5pt; text-transform: uppercase; font-weight: 700; color: #b71c1c; letter-spacing: 0.5px; margin-bottom: 4px; }
.party-name { font-size: 11pt; font-weight: 700; }
.party-det { font-size: 8.5pt; color: #444; margin-top: 2px; line-height: 1.5; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #b71c1c !important; color: #fff !important; font-size: 8pt; padding: 5px 6px; border: 1px solid #b71c1c; text-align: center; text-transform: uppercase; }
table.items th.left { text-align: left; }
.cell { border: 1px solid #ddd; padding: 3px 6px; font-size: 9.5pt; height: 21px; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #fdecea !important; }
.tfoot-row td { font-weight: 700; border: 1px solid #b71c1c; padding: 4px 6px; background: #b71c1c !important; color: #fff !important; font-size: 10pt; }
.bot-area { display: flex; align-items: flex-start; gap: 14px; margin-top: 10px; }
.words-box { flex: 1; border: 1px solid #ddd; padding: 6px 10px; }
.words-lbl { font-size: 8pt; font-weight: 700; color: #b71c1c; text-transform: uppercase; margin-bottom: 2px; }
.words-val { font-size: 10.5pt; font-weight: 700; }
.fbr-box { border: 2px solid #b71c1c; padding: 8px 10px; text-align: center; min-width: 130px; }
.fbr-box .fbr-irn { font-size: 7.5pt; font-weight: 700; color: #b71c1c; margin-top: 4px; word-break: break-all; }
.fbr-box .fbr-meta { font-size: 7pt; color: #555; margin-top: 2px; }
.sig-row { display: flex; justify-content: space-between; margin-top: 32px; padding: 0 30px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 2px solid #b71c1c; margin-bottom: 3px; }
.sig .label { font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #b71c1c; }
</style></head><body>
<div class="banner">
  <div>
    {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:40px;margin-bottom:4px;display:block">{{/if}}
    <div class="ban-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="ban-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div class="ban-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
    {{#if supplierNTN}}<div class="ban-sub">NTN: {{supplierNTN}}{{#if supplierSTRN}} &nbsp;|&nbsp; STRN: {{supplierSTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="ban-right">
    <div class="ban-title">Credit Note</div>
    <div class="ban-num">{{invoiceNumber}}</div>
    <div class="ban-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="main">
<div class="meta-strip">
  {{#if originalInvoiceNumber}}<span><b>Against Invoice #</b> {{originalInvoiceNumber}} <b>dated</b> {{fmtDate originalInvoiceDate}}</span>{{/if}}
  {{#if originalInvoiceRefIRN}}<span><b>Ref IRN:</b> {{originalInvoiceRefIRN}}</span>{{/if}}
  <span><b>Document:</b> {{#if noteKindLabel}}{{noteKindLabel}}{{else}}Credit Note{{/if}}</span>
</div>
{{#if noteReason}}<div class="reason-strip"><b>Reason:</b> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</div>{{/if}}
<div class="parties">
  <div class="party">
    <div class="party-hdr">Supplier</div>
    <div class="party-name">{{supplierName}}</div>
    <div class="party-det">
      {{#if supplierAddress}}{{supplierAddress}}<br>{{/if}}
      {{#if supplierSTRN}}<b>STRN:</b> {{supplierSTRN}}<br>{{/if}}
      {{#if supplierNTN}}<b>NTN:</b> {{supplierNTN}}{{/if}}
    </div>
  </div>
  <div class="party">
    <div class="party-hdr">Buyer</div>
    <div class="party-name">{{buyerName}}</div>
    <div class="party-det">
      {{#if buyerAddress}}{{{nl2br buyerAddress}}}<br>{{/if}}
      {{#if buyerPhone}}<b>Ph:</b> {{buyerPhone}}<br>{{/if}}
      {{#if buyerSTRN}}<b>STRN:</b> {{buyerSTRN}}<br>{{/if}}
      {{#if buyerNTN}}<b>NTN:</b> {{buyerNTN}}{{/if}}
    </div>
  </div>
</div>
<table class="items">
  <thead>
    <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th class="left">Description</th><th style="width:88px">Value Excl. Tax</th><th style="width:44px">Rate</th><th style="width:76px">Sales Tax</th><th style="width:88px">Value Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 14 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="bot-area">
  <div class="words-box"><div class="words-lbl">Amount In Words</div><div class="words-val">{{amountInWords}}</div></div>
  {{#if fbrIRN}}
  <div class="fbr-box">
    <img src="{{fbrLogoUrl}}" style="height:32px">
    <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px;display:block;margin:4px auto">
    <div class="fbr-irn">IRN: {{fbrIRN}}</div>
    {{#if fbrSubmittedAt}}<div class="fbr-meta">{{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  {{/if}}
</div>
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 5. Monochrome Ink-Saver ─────────────────────────────────
  {
    id: "creditnote-monochrome-ink",
    name: "Monochrome Ink-Saver",
    type: "CreditNote",
    description: "Black-and-white only, no fills, hairline borders — minimal toner use",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, Helvetica, sans-serif; padding: 8mm 10mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; font-size: 9.5pt; }
.main { flex: 1; }
.footer { margin-top: auto; }
.hdr { display: flex; justify-content: space-between; border-bottom: 1.5px solid #000; padding-bottom: 8px; margin-bottom: 8px; }
.sup-name { font-size: 20pt; font-weight: 900; text-transform: uppercase; }
.sup-sub { font-size: 8.5pt; margin-top: 3px; line-height: 1.4; }
.note-right { text-align: right; }
.note-title { font-size: 13pt; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; }
.note-num { font-size: 11pt; font-weight: 700; margin-top: 4px; }
.note-line { font-size: 9pt; margin-top: 2px; }
.parties { display: flex; gap: 12px; margin: 8px 0; }
.party { flex: 1; border: 0.75pt solid #000; padding: 6px 8px; font-size: 9pt; line-height: 1.5; }
.party-hdr { font-size: 8pt; text-transform: uppercase; font-weight: 700; border-bottom: 0.5pt solid #000; padding-bottom: 2px; margin-bottom: 4px; }
.party-name { font-size: 11pt; font-weight: 700; }
.prow { display: flex; }
.prow .lbl { font-weight: 700; min-width: 56px; }
.meta-line { font-size: 9pt; margin: 5px 0; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { border: 0.75pt solid #000; font-size: 8.5pt; padding: 4px 5px; text-align: center; background: #000 !important; color: #fff !important; font-weight: 700; text-transform: uppercase; }
table.items th.left { text-align: left; }
.cell { border: 0.5pt solid #000; padding: 3px 5px; font-size: 9pt; height: 20px; }
.c { text-align: center; } .r { text-align: right; }
.tfoot-row td { border: 0.75pt solid #000; padding: 3px 5px; font-weight: 700; font-size: 9.5pt; }
.words-area { display: flex; border: 0.75pt solid #000; margin-top: 8px; }
.words-lbl { padding: 4px 8px; border-right: 0.75pt solid #000; font-weight: 700; font-size: 9pt; white-space: nowrap; }
.words-val { padding: 4px 10px; font-size: 9.5pt; font-weight: 700; }
.fbr-bw { display: flex; align-items: center; gap: 12px; margin-top: 8px; padding: 6px 10px; border: 0.75pt solid #000; }
.fbr-bw img { filter: grayscale(100%); }
.fbr-info { flex: 1; font-size: 8.5pt; line-height: 1.6; }
.fbr-irn { font-weight: 700; font-size: 9.5pt; }
.sig-row { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 40px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 0.75pt solid #000; margin-bottom: 3px; }
.sig .label { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; }
</style></head><body>
<div class="main">
<div class="hdr">
  <div>
    <div class="sup-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="sup-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div class="sup-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
    {{#if supplierNTN}}<div class="sup-sub"><b>NTN:</b> {{supplierNTN}}{{#if supplierSTRN}} &nbsp;|&nbsp; <b>STRN:</b> {{supplierSTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="note-right">
    <div class="note-title">CREDIT NOTE</div>
    <div class="note-num">No. {{invoiceNumber}}</div>
    <div class="note-line">Date: {{fmtDate date}}</div>
    {{#if originalInvoiceNumber}}<div class="note-line">Against Invoice # {{originalInvoiceNumber}} dated {{fmtDate originalInvoiceDate}}</div>{{/if}}
    {{#if originalInvoiceRefIRN}}<div class="note-line">Ref IRN: {{originalInvoiceRefIRN}}</div>{{/if}}
  </div>
</div>
<div class="parties">
  <div class="party">
    <div class="party-hdr">Supplier</div>
    <div class="party-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="prow"><span class="lbl">Address:</span><span>{{supplierAddress}}</span></div>{{/if}}
    {{#if supplierSTRN}}<div class="prow"><span class="lbl">STRN:</span><span>{{supplierSTRN}}</span></div>{{/if}}
    {{#if supplierNTN}}<div class="prow"><span class="lbl">NTN:</span><span>{{supplierNTN}}</span></div>{{/if}}
  </div>
  <div class="party">
    <div class="party-hdr">Buyer</div>
    <div class="party-name">{{buyerName}}</div>
    {{#if buyerAddress}}<div class="prow"><span class="lbl">Address:</span><span>{{{nl2br buyerAddress}}}</span></div>{{/if}}
    {{#if buyerPhone}}<div class="prow"><span class="lbl">Phone:</span><span>{{buyerPhone}}</span></div>{{/if}}
    {{#if buyerSTRN}}<div class="prow"><span class="lbl">STRN:</span><span>{{buyerSTRN}}</span></div>{{/if}}
    {{#if buyerNTN}}<div class="prow"><span class="lbl">NTN:</span><span>{{buyerNTN}}</span></div>{{/if}}
  </div>
</div>
{{#if noteReason}}<div class="meta-line"><b>Reason:</b> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</div>{{/if}}
<table class="items">
  <thead>
    <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th class="left">Description</th><th style="width:90px">Value Excl. Tax</th><th style="width:44px">Rate</th><th style="width:78px">Sales Tax</th><th style="width:90px">Value Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 14 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT :</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="words-area"><span class="words-lbl">Amount In Words:</span><span class="words-val">{{amountInWords}}</span></div>
{{#if fbrIRN}}
<div class="fbr-bw">
  <img src="{{fbrLogoUrl}}" style="height:36px">
  <div class="fbr-info">
    <div class="fbr-irn">FBR Invoice Reference No: {{fbrIRN}}</div>
    {{#if fbrStatus}}<div>Status: {{fbrStatus}}</div>{{/if}}
    {{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  <img src="{{{fbrQrPngDataUrl}}}" style="width:84px;height:84px">
</div>
{{/if}}
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 6. Elegant Premium (Charcoal + Gold) ────────────────────
  {
    id: "creditnote-elegant-premium",
    name: "Elegant Premium",
    type: "CreditNote",
    description: "Charcoal & gold luxury look with reference strip and FBR compliance block",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Calibri, Arial, sans-serif; color: #1a1a1a; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; padding: 0 10mm 6mm; }
.footer { margin-top: auto; padding: 0 10mm 8mm; }
.gold-top { height: 5px; background: linear-gradient(90deg, #b8960c, #f0c040, #b8960c) !important; }
.charcoal-band { background: #2c2c2c !important; padding: 14px 10mm 12px; display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 14px; }
.cb-name { font-size: 22pt; font-weight: 800; color: #f0c040 !important; letter-spacing: 1px; text-transform: uppercase; }
.cb-sub { font-size: 8pt; color: #aaa !important; margin-top: 3px; line-height: 1.4; }
.cb-right { text-align: right; }
.cb-title { font-size: 9.5pt; font-weight: 700; letter-spacing: 4px; color: #f0c040 !important; text-transform: uppercase; }
.cb-num { font-size: 14pt; font-weight: 800; color: #fff !important; margin-top: 4px; }
.cb-date { font-size: 8.5pt; color: #aaa !important; margin-top: 2px; }
.gold-rule { height: 1px; background: linear-gradient(90deg, #b8960c, #f0c040, #b8960c) !important; margin: 8px 0; }
.meta-row { display: flex; gap: 20px; flex-wrap: wrap; font-size: 9pt; margin-bottom: 8px; }
.meta-row span { color: #555; }
.meta-row strong { color: #2c2c2c; }
.reason-note { border-left: 2px solid #b8960c; padding: 4px 10px; font-size: 9pt; color: #444; margin-bottom: 8px; background: #faf7ef !important; }
.reason-note strong { color: #2c2c2c; }
.parties { display: flex; gap: 12px; margin-bottom: 10px; }
.party { flex: 1; border-top: 2px solid #b8960c; padding: 7px 10px; font-size: 9.5pt; line-height: 1.5; background: #fafafa !important; }
.party-hdr { font-size: 7.5pt; text-transform: uppercase; font-weight: 700; color: #b8960c; letter-spacing: 0.6px; margin-bottom: 4px; }
.party-name { font-size: 11.5pt; font-weight: 700; color: #2c2c2c; }
.party-det { font-size: 8.5pt; color: #555; margin-top: 2px; line-height: 1.5; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #2c2c2c !important; color: #f0c040 !important; font-size: 8pt; padding: 5px 6px; border: 1px solid #2c2c2c; text-align: center; text-transform: uppercase; letter-spacing: 0.3px; }
table.items th.left { text-align: left; }
.cell { border: 1px solid #e0e0e0; padding: 3px 6px; font-size: 9.5pt; height: 21px; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #faf7ef !important; }
.tfoot-row td { font-weight: 700; border: 1px solid #2c2c2c; padding: 4px 6px; background: #2c2c2c !important; color: #f0c040 !important; font-size: 10pt; }
.bot-section { display: flex; gap: 14px; margin-top: 10px; }
.words-block { flex: 1; border: 1px solid #e0e0e0; border-top: 2px solid #b8960c; padding: 7px 10px; }
.words-lbl { font-size: 8pt; text-transform: uppercase; font-weight: 700; color: #b8960c; letter-spacing: 0.5px; margin-bottom: 2px; }
.words-val { font-size: 10pt; font-weight: 700; }
.fbr-block { border: 1.5px solid #b8960c; padding: 8px 10px; display: flex; align-items: center; gap: 12px; }
.fbr-info { font-size: 8.5pt; line-height: 1.6; }
.fbr-irn { font-weight: 700; font-size: 9pt; color: #2c2c2c; }
.sig-row { display: flex; justify-content: space-between; margin-top: 36px; padding: 0 40px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 1.5px solid #b8960c; margin-bottom: 3px; }
.sig .label { font-size: 8.5pt; color: #555; text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px; }
</style></head><body>
<div class="gold-top"></div>
<div class="charcoal-band">
  <div>
    {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:40px;margin-bottom:4px;display:block">{{/if}}
    <div class="cb-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="cb-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div class="cb-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
    {{#if supplierNTN}}<div class="cb-sub">NTN: {{supplierNTN}}{{#if supplierSTRN}} &nbsp;|&nbsp; STRN: {{supplierSTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="cb-right">
    <div class="cb-title">Credit Note</div>
    <div class="cb-num">{{invoiceNumber}}</div>
    <div class="cb-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="main">
<div class="gold-rule"></div>
<div class="meta-row">
  {{#if originalInvoiceNumber}}<span><strong>Against Invoice #</strong> {{originalInvoiceNumber}} <strong>dated</strong> {{fmtDate originalInvoiceDate}}</span>{{/if}}
  {{#if originalInvoiceRefIRN}}<span><strong>Ref IRN:</strong> {{originalInvoiceRefIRN}}</span>{{/if}}
  <span><strong>Document:</strong> {{#if noteKindLabel}}{{noteKindLabel}}{{else}}Credit Note{{/if}}</span>
</div>
{{#if noteReason}}<div class="reason-note"><strong>Reason:</strong> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</div>{{/if}}
<div class="parties">
  <div class="party">
    <div class="party-hdr">Supplier</div>
    <div class="party-name">{{supplierName}}</div>
    <div class="party-det">
      {{#if supplierAddress}}{{supplierAddress}}<br>{{/if}}
      {{#if supplierSTRN}}<b>STRN:</b> {{supplierSTRN}}<br>{{/if}}
      {{#if supplierNTN}}<b>NTN:</b> {{supplierNTN}}{{/if}}
    </div>
  </div>
  <div class="party">
    <div class="party-hdr">Buyer</div>
    <div class="party-name">{{buyerName}}</div>
    <div class="party-det">
      {{#if buyerAddress}}{{{nl2br buyerAddress}}}<br>{{/if}}
      {{#if buyerPhone}}<b>Ph:</b> {{buyerPhone}}<br>{{/if}}
      {{#if buyerSTRN}}<b>STRN:</b> {{buyerSTRN}}<br>{{/if}}
      {{#if buyerNTN}}<b>NTN:</b> {{buyerNTN}}{{/if}}
    </div>
  </div>
</div>
<div class="gold-rule"></div>
<table class="items">
  <thead>
    <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th class="left">Description</th><th style="width:88px">Value Excl. Tax</th><th style="width:44px">Rate</th><th style="width:76px">Sales Tax</th><th style="width:88px">Value Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 12 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="bot-section">
  <div class="words-block"><div class="words-lbl">Amount In Words</div><div class="words-val">{{amountInWords}}</div></div>
  {{#if fbrIRN}}
  <div class="fbr-block">
    <img src="{{fbrLogoUrl}}" style="height:38px">
    <div class="fbr-info">
      <div class="fbr-irn">FBR IRN: {{fbrIRN}}</div>
      {{#if fbrStatus}}<div>{{fbrStatus}}</div>{{/if}}
      {{#if fbrSubmittedAt}}<div>{{fmtDate fbrSubmittedAt}}</div>{{/if}}
    </div>
    <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
  </div>
  {{/if}}
</div>
</div>
<div class="footer">
  <div class="gold-rule"></div>
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 7. Compact Dense ────────────────────────────────────────
  {
    id: "creditnote-compact-dense",
    name: "Compact Dense",
    type: "CreditNote",
    description: "Tight 8pt font with maximized rows per page for high-volume line items",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 6mm 8mm; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, Helvetica, sans-serif; padding: 6mm 8mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; font-size: 8pt; }
.main { flex: 1; }
.footer { margin-top: auto; }
.hdr { display: flex; justify-content: space-between; align-items: flex-start; border: 1px solid #000; padding: 5px 8px; margin-bottom: 6px; }
.sup-name { font-size: 14pt; font-weight: 900; text-transform: uppercase; }
.sup-sub { font-size: 7.5pt; color: #333; margin-top: 2px; line-height: 1.35; }
.note-right { text-align: right; border-left: 1px solid #000; padding-left: 8px; }
.note-title { font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; }
.note-row { font-size: 8pt; margin-top: 2px; line-height: 1.5; }
.parties { display: flex; gap: 8px; margin-bottom: 5px; }
.party { flex: 1; border: 0.5pt solid #000; padding: 4px 6px; font-size: 7.5pt; line-height: 1.4; }
.party-hdr { font-size: 7pt; font-weight: 700; text-decoration: underline; margin-bottom: 2px; text-transform: uppercase; }
.party-name { font-size: 9pt; font-weight: 700; }
.prow { display: flex; }
.prow .lbl { font-weight: 700; min-width: 44px; }
.meta-line { font-size: 7.5pt; margin: 3px 0; }
table.items { width: 100%; border-collapse: collapse; margin-top: 3px; }
table.items th { background: #333 !important; color: #fff !important; font-size: 7pt; padding: 3px 4px; border: 0.5pt solid #333; text-align: center; text-transform: uppercase; }
table.items th.left { text-align: left; }
.cell { border: 0.5pt solid #888; padding: 2px 4px; font-size: 7.5pt; height: 16px; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #f0f0f0 !important; }
.tfoot-row td { font-weight: 700; border: 0.75pt solid #000; padding: 2px 4px; background: #ddd !important; font-size: 8pt; }
.words-area { display: flex; border: 0.5pt solid #000; margin-top: 5px; }
.words-lbl { padding: 3px 6px; border-right: 0.5pt solid #000; font-weight: 700; font-size: 7.5pt; white-space: nowrap; }
.words-val { padding: 3px 8px; font-size: 8pt; font-weight: 700; }
.fbr-block { display: flex; align-items: center; gap: 10px; margin-top: 6px; padding: 5px 8px; border: 1px solid #007532; font-size: 7.5pt; background: #f0fff4 !important; }
.fbr-info { flex: 1; line-height: 1.5; }
.fbr-irn { font-weight: 700; color: #007532; }
.sig-row { display: flex; justify-content: space-between; margin-top: 28px; padding: 0 30px; }
.sig { text-align: center; }
.sig .line { width: 160px; border-top: 0.75pt solid #000; margin-bottom: 2px; }
.sig .label { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; }
</style></head><body>
<div class="main">
<div class="hdr">
  <div>
    {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:34px;margin-bottom:3px;display:block">{{/if}}
    <div class="sup-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="sup-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div class="sup-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
    {{#if supplierNTN}}<div class="sup-sub"><b>NTN:</b> {{supplierNTN}}{{#if supplierSTRN}} | <b>STRN:</b> {{supplierSTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="note-right">
    <div class="note-title">Credit Note</div>
    <div class="note-row"><b>No:</b> {{invoiceNumber}}</div>
    <div class="note-row"><b>Date:</b> {{fmtDate date}}</div>
    {{#if originalInvoiceNumber}}<div class="note-row">Against Invoice # {{originalInvoiceNumber}} dated {{fmtDate originalInvoiceDate}}</div>{{/if}}
    {{#if originalInvoiceRefIRN}}<div class="note-row">Ref IRN: {{originalInvoiceRefIRN}}</div>{{/if}}
  </div>
</div>
<div class="parties">
  <div class="party">
    <div class="party-hdr">Supplier</div>
    <div class="party-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="prow"><span class="lbl">Addr:</span><span>{{supplierAddress}}</span></div>{{/if}}
    {{#if supplierSTRN}}<div class="prow"><span class="lbl">STRN:</span><span>{{supplierSTRN}}</span></div>{{/if}}
    {{#if supplierNTN}}<div class="prow"><span class="lbl">NTN:</span><span>{{supplierNTN}}</span></div>{{/if}}
  </div>
  <div class="party">
    <div class="party-hdr">Buyer</div>
    <div class="party-name">{{buyerName}}</div>
    {{#if buyerAddress}}<div class="prow"><span class="lbl">Addr:</span><span>{{{nl2br buyerAddress}}}</span></div>{{/if}}
    {{#if buyerPhone}}<div class="prow"><span class="lbl">Ph:</span><span>{{buyerPhone}}</span></div>{{/if}}
    {{#if buyerSTRN}}<div class="prow"><span class="lbl">STRN:</span><span>{{buyerSTRN}}</span></div>{{/if}}
    {{#if buyerNTN}}<div class="prow"><span class="lbl">NTN:</span><span>{{buyerNTN}}</span></div>{{/if}}
  </div>
</div>
{{#if noteReason}}<div class="meta-line"><b>Reason:</b> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</div>{{/if}}
<table class="items">
  <thead>
    <tr><th style="width:32px">Qty</th><th style="width:36px">Unit</th><th class="left">Description</th><th style="width:82px">Excl. Tax</th><th style="width:38px">Rate</th><th style="width:70px">Sales Tax</th><th style="width:82px">Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 20 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT :</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="words-area"><span class="words-lbl">Amount In Words:</span><span class="words-val">{{amountInWords}}</span></div>
{{#if fbrIRN}}
<div class="fbr-block">
  <img src="{{fbrLogoUrl}}" style="height:34px">
  <div class="fbr-info">
    <div class="fbr-irn">FBR Invoice Reference No: {{fbrIRN}}</div>
    {{#if fbrStatus}}<div>Status: {{fbrStatus}}</div>{{/if}}
    {{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  <img src="{{{fbrQrPngDataUrl}}}" style="width:80px;height:80px">
</div>
{{/if}}
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 8. Left Sidebar Strip ───────────────────────────────────
  {
    id: "creditnote-left-sidebar",
    name: "Left Sidebar Strip",
    type: "CreditNote",
    description: "Vertical maroon sidebar carries supplier info and FBR QR",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #111; min-height: 100vh; display: flex; }
.sidebar { width: 48mm; background: #6d1521 !important; color: #fff !important; padding: 12mm 6mm 10mm; display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
.sb-logo { margin-bottom: 8px; }
.sb-name { font-size: 13pt; font-weight: 800; color: #ffd700 !important; text-transform: uppercase; letter-spacing: 1px; text-align: center; line-height: 1.3; }
.sb-divider { width: 80%; height: 1px; background: rgba(255,255,255,0.3) !important; margin: 8px 0; }
.sb-lbl { font-size: 7pt; text-transform: uppercase; color: #dcaeb4 !important; letter-spacing: 0.5px; margin-top: 8px; margin-bottom: 2px; }
.sb-val { font-size: 8pt; color: #fff !important; text-align: center; line-height: 1.4; }
.sb-qr { margin-top: 12px; text-align: center; }
.sb-qr-lbl { font-size: 7pt; color: #dcaeb4 !important; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.sb-irn { font-size: 6.5pt; color: #ffd700 !important; margin-top: 4px; word-break: break-all; text-align: center; line-height: 1.4; }
.content { flex: 1; padding: 10mm 10mm 8mm; display: flex; flex-direction: column; }
.main { flex: 1; }
.footer { margin-top: auto; }
.note-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #6d1521; padding-bottom: 8px; margin-bottom: 10px; }
.note-title { font-size: 18pt; font-weight: 900; color: #6d1521; text-transform: uppercase; letter-spacing: 2px; }
.note-meta { text-align: right; font-size: 9.5pt; line-height: 1.7; }
.note-meta strong { color: #6d1521; }
.party-section { margin-bottom: 8px; }
.party-hdr { font-size: 7.5pt; text-transform: uppercase; font-weight: 700; color: #6d1521; letter-spacing: 0.5px; border-bottom: 1px solid #ddd; padding-bottom: 2px; margin-bottom: 4px; }
.party-name { font-size: 11pt; font-weight: 700; }
.party-det { font-size: 8.5pt; color: #444; margin-top: 2px; line-height: 1.5; }
.meta-row { font-size: 9pt; margin: 5px 0 8px; }
.meta-row b { color: #6d1521; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #6d1521 !important; color: #fff !important; font-size: 8pt; padding: 5px 5px; border: 1px solid #6d1521; text-align: center; text-transform: uppercase; }
table.items th.left { text-align: left; }
.cell { border: 1px solid #e3c4c8; padding: 3px 5px; font-size: 9pt; height: 20px; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #f9edee !important; }
.tfoot-row td { font-weight: 700; border: 1px solid #6d1521; padding: 3px 5px; background: #6d1521 !important; color: #fff !important; font-size: 9.5pt; }
.words-area { border: 1px solid #e3c4c8; border-top: 2px solid #6d1521; margin-top: 8px; display: flex; }
.words-lbl { padding: 4px 8px; border-right: 1px solid #e3c4c8; font-weight: 700; font-size: 8.5pt; white-space: nowrap; background: #f9edee !important; }
.words-val { padding: 4px 10px; font-size: 9.5pt; font-weight: 700; }
.sig-row { display: flex; justify-content: space-between; margin-top: 32px; }
.sig { text-align: center; }
.sig .line { width: 150px; border-top: 1.5px solid #6d1521; margin-bottom: 3px; }
.sig .label { font-size: 8pt; color: #555; text-transform: uppercase; font-weight: 700; }
</style></head><body>
<div class="sidebar">
  {{#if supplierLogoPath}}<div class="sb-logo"><img src="{{supplierLogoPath}}" style="height:44px"></div>{{/if}}
  <div class="sb-name">{{supplierName}}</div>
  <div class="sb-divider"></div>
  {{#if supplierAddress}}<div class="sb-lbl">Address</div><div class="sb-val">{{{nl2br supplierAddress}}}</div>{{/if}}
  {{#if supplierPhone}}<div class="sb-lbl">Phone</div><div class="sb-val">{{{nl2br supplierPhone}}}</div>{{/if}}
  {{#if supplierNTN}}<div class="sb-lbl">NTN</div><div class="sb-val">{{supplierNTN}}</div>{{/if}}
  {{#if supplierSTRN}}<div class="sb-lbl">STRN</div><div class="sb-val">{{supplierSTRN}}</div>{{/if}}
  {{#if fbrIRN}}
  <div class="sb-divider"></div>
  <div class="sb-qr">
    <img src="{{fbrLogoUrl}}" style="height:30px;margin-bottom:4px">
    <div class="sb-qr-lbl">FBR Verified</div>
    <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
    <div class="sb-irn">{{fbrIRN}}</div>
    {{#if fbrSubmittedAt}}<div class="sb-irn" style="color:#dcaeb4 !important">{{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  {{/if}}
</div>
<div class="content">
<div class="main">
<div class="note-head">
  <div class="note-title">Credit Note</div>
  <div class="note-meta">
    <strong>Note #:</strong> {{invoiceNumber}}<br>
    <strong>Date:</strong> {{fmtDate date}}
  </div>
</div>
<div class="party-section">
  <div class="party-hdr">Buyer Information</div>
  <div class="party-name">{{buyerName}}</div>
  <div class="party-det">
    {{#if buyerAddress}}{{{nl2br buyerAddress}}}<br>{{/if}}
    {{#if buyerPhone}}<b>Ph:</b> {{buyerPhone}}<br>{{/if}}
    {{#if buyerSTRN}}<b>STRN:</b> {{buyerSTRN}}<br>{{/if}}
    {{#if buyerNTN}}<b>NTN:</b> {{buyerNTN}}{{/if}}
  </div>
</div>
{{#if (or originalInvoiceNumber originalInvoiceRefIRN)}}
<div class="party-section">
  <div class="party-hdr">Reference</div>
  <div class="party-det">
    {{#if originalInvoiceNumber}}Against Invoice # {{originalInvoiceNumber}} dated {{fmtDate originalInvoiceDate}}<br>{{/if}}
    {{#if originalInvoiceRefIRN}}<b>Ref IRN:</b> {{originalInvoiceRefIRN}}{{/if}}
  </div>
</div>
{{/if}}
{{#if noteReason}}<div class="meta-row"><b>Reason:</b> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</div>{{/if}}
<table class="items">
  <thead>
    <tr><th style="width:36px">Qty</th><th style="width:38px">Unit</th><th class="left">Description</th><th style="width:82px">Excl. Tax</th><th style="width:40px">Rate</th><th style="width:72px">Sales Tax</th><th style="width:82px">Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 12 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="words-area"><span class="words-lbl">Amount In Words:</span><span class="words-val">{{amountInWords}}</span></div>
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</div>
</body></html>`,
  },

  // ─── 9. Boxed Traditional ────────────────────────────────────
  {
    id: "creditnote-boxed-traditional",
    name: "Boxed Traditional",
    type: "CreditNote",
    description: "All sections inside full-border boxes, classic Pakistani stationery style",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 8mm 10mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer { margin-top: auto; }
.outer-box { border: 2px solid #000; }
.title-row { border-bottom: 2px solid #000; text-align: center; padding: 6px 10px; background: #e8e8e8 !important; }
.title-row h1 { font-size: 16pt; font-weight: 900; text-transform: uppercase; letter-spacing: 3px; }
.header-row { display: flex; border-bottom: 1.5px solid #000; }
.sup-cell { flex: 1; padding: 8px 10px; border-right: 1.5px solid #000; }
.sup-name { font-size: 18pt; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
.sup-sub { font-size: 9pt; margin-top: 3px; line-height: 1.4; }
.note-cell { width: 140px; padding: 8px 10px; text-align: center; }
.note-lbl { font-size: 9pt; font-weight: 700; text-transform: uppercase; }
.note-num { font-size: 14pt; font-weight: 900; margin-top: 2px; border: 1.5px solid #000; padding: 2px 6px; display: inline-block; }
.note-date { font-size: 9pt; margin-top: 4px; }
.parties-row { display: flex; border-bottom: 1.5px solid #000; }
.party-cell { flex: 1; padding: 7px 10px; }
.party-cell:first-child { border-right: 1.5px solid #000; }
.party-hdr { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; border-bottom: 0.75pt solid #000; padding-bottom: 2px; margin-bottom: 4px; }
.party-name { font-size: 12pt; font-weight: 700; }
.prow { display: flex; font-size: 9pt; margin-top: 1px; }
.prow .lbl { font-weight: 700; min-width: 60px; }
.ref-row { border-bottom: 1.5px solid #000; padding: 4px 10px; display: flex; gap: 24px; flex-wrap: wrap; font-size: 9.5pt; }
.ref-row b { font-weight: 700; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #e8e8e8 !important; color: #000 !important; font-size: 8.5pt; font-weight: 700; padding: 4px 5px; border-right: 1px solid #000; border-bottom: 1.5px solid #000; text-align: center; text-transform: uppercase; }
table.items th:last-child { border-right: none; }
table.items th.left { text-align: left; }
.cell { border-right: 0.5pt solid #ccc; border-bottom: 0.5pt solid #ccc; padding: 3px 5px; font-size: 9.5pt; height: 21px; }
.cell:last-child { border-right: none; }
.c { text-align: center; } .r { text-align: right; }
.tfoot-row td { font-weight: 700; border-top: 1.5px solid #000; border-right: 0.5pt solid #ccc; border-bottom: none; padding: 3px 5px; background: #e8e8e8 !important; font-size: 10pt; }
.words-row { border-top: 1.5px solid #000; padding: 5px 10px; display: flex; }
.words-lbl { font-weight: 700; font-size: 9.5pt; border-right: 1px solid #000; padding-right: 10px; margin-right: 10px; white-space: nowrap; }
.words-val { font-size: 10.5pt; font-weight: 700; }
.fbr-row { border-top: 1.5px solid #000; padding: 6px 10px; display: flex; align-items: center; gap: 14px; background: #f0fff4 !important; }
.fbr-info { flex: 1; font-size: 8.5pt; line-height: 1.6; }
.fbr-irn { font-weight: 700; font-size: 9.5pt; color: #007532; }
.sig-row { display: flex; justify-content: space-between; margin-top: 36px; padding: 0 40px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1px solid #000; margin-bottom: 3px; }
.sig .label { font-size: 9pt; font-weight: 700; text-transform: uppercase; }
</style></head><body>
<div class="main">
<div class="outer-box">
  <div class="title-row"><h1>Credit Note</h1></div>
  <div class="header-row">
    <div class="sup-cell">
      {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:44px;margin-bottom:4px;display:block">{{/if}}
      <div class="sup-name">{{supplierName}}</div>
      {{#if supplierAddress}}<div class="sup-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
      {{#if supplierPhone}}<div class="sup-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
      {{#if supplierNTN}}<div class="sup-sub"><b>NTN:</b> {{supplierNTN}}{{#if supplierSTRN}} &bull; <b>STRN:</b> {{supplierSTRN}}{{/if}}</div>{{/if}}
    </div>
    <div class="note-cell">
      <div class="note-lbl">Credit Note No</div>
      <div class="note-num">{{invoiceNumber}}</div>
      <div class="note-date">{{fmtDate date}}</div>
    </div>
  </div>
  <div class="parties-row">
    <div class="party-cell">
      <div class="party-hdr">Supplier</div>
      <div class="party-name">{{supplierName}}</div>
      {{#if supplierAddress}}<div class="prow"><span class="lbl">Address:</span><span>{{supplierAddress}}</span></div>{{/if}}
      {{#if supplierSTRN}}<div class="prow"><span class="lbl">STRN:</span><span>{{supplierSTRN}}</span></div>{{/if}}
      {{#if supplierNTN}}<div class="prow"><span class="lbl">NTN:</span><span>{{supplierNTN}}</span></div>{{/if}}
    </div>
    <div class="party-cell">
      <div class="party-hdr">Buyer</div>
      <div class="party-name">{{buyerName}}</div>
      {{#if buyerAddress}}<div class="prow"><span class="lbl">Address:</span><span>{{{nl2br buyerAddress}}}</span></div>{{/if}}
      {{#if buyerPhone}}<div class="prow"><span class="lbl">Phone:</span><span>{{buyerPhone}}</span></div>{{/if}}
      {{#if buyerSTRN}}<div class="prow"><span class="lbl">STRN:</span><span>{{buyerSTRN}}</span></div>{{/if}}
      {{#if buyerNTN}}<div class="prow"><span class="lbl">NTN:</span><span>{{buyerNTN}}</span></div>{{/if}}
    </div>
  </div>
  {{#if (or originalInvoiceNumber originalInvoiceRefIRN)}}
  <div class="ref-row">
    {{#if originalInvoiceNumber}}<span><b>Against Invoice #</b> {{originalInvoiceNumber}} <b>dated</b> {{fmtDate originalInvoiceDate}}</span>{{/if}}
    {{#if originalInvoiceRefIRN}}<span><b>Ref IRN:</b> {{originalInvoiceRefIRN}}</span>{{/if}}
  </div>
  {{/if}}
  {{#if noteReason}}
  <div class="ref-row">
    <span><b>Reason:</b> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</span>
  </div>
  {{/if}}
  <table class="items">
    <thead>
      <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th class="left">Description</th><th style="width:88px">Value Excl. Tax</th><th style="width:44px">Rate</th><th style="width:78px">Sales Tax</th><th style="width:88px">Value Incl. Tax</th></tr>
    </thead>
    <tbody>
      {{#each items}}<tr>
        <td class="cell c">{{this.quantity}}</td>
        <td class="cell c">{{this.uom}}</td>
        <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
        <td class="cell r">{{fmtDec this.valueExclTax}}</td>
        <td class="cell c">{{this.gstRate}}%</td>
        <td class="cell r">{{fmtDec this.gstAmount}}</td>
        <td class="cell r">{{fmtDec this.totalInclTax}}</td>
      </tr>{{/each}}
      {{emptyRows (math 12 "-" items.length) 7}}
    </tbody>
    <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT :</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
  </table>
  <div class="words-row"><span class="words-lbl">Amount In Words:</span><span class="words-val">{{amountInWords}}</span></div>
  {{#if fbrIRN}}
  <div class="fbr-row">
    <img src="{{fbrLogoUrl}}" style="height:42px">
    <div class="fbr-info">
      <div class="fbr-irn">FBR Invoice Reference No: {{fbrIRN}}</div>
      {{#if fbrStatus}}<div>Status: {{fbrStatus}}</div>{{/if}}
      {{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
    </div>
    <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
  </div>
  {{/if}}
</div>
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 10. Bismillah Header ────────────────────────────────────
  {
    id: "creditnote-bismillah-header",
    name: "Bismillah Header",
    type: "CreditNote",
    description: "Opens with Bismillah in Arabic calligraphy, warm rust palette with FBR block",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; padding: 8mm 10mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; }
.footer { margin-top: auto; }
.bismillah { text-align: center; font-size: 20pt; color: #4a1505; margin-bottom: 6px; font-family: "Traditional Arabic", "Scheherazade", serif; direction: rtl; letter-spacing: 1px; }
.outer { border: 2px solid #8b3a1a; }
.title-band { background: #8b3a1a !important; text-align: center; padding: 5px 10px; }
.title-band h1 { font-size: 15pt; font-weight: 900; letter-spacing: 3px; text-transform: uppercase; color: #fff !important; }
.sup-row { display: flex; border-bottom: 1px solid #8b3a1a; }
.sup-block { flex: 1; padding: 8px 10px; border-right: 1px solid #8b3a1a; }
.sup-name { font-size: 18pt; font-weight: 900; text-transform: uppercase; color: #4a1505; }
.sup-sub { font-size: 9pt; color: #333; margin-top: 3px; line-height: 1.4; }
.note-block { width: 140px; padding: 8px 10px; text-align: center; }
.note-lbl { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; color: #8b3a1a; }
.note-num { font-size: 13pt; font-weight: 900; margin-top: 2px; }
.note-date { font-size: 9pt; margin-top: 3px; }
.parties-row { display: flex; border-bottom: 1px solid #8b3a1a; }
.party { flex: 1; padding: 7px 10px; }
.party:first-child { border-right: 1px solid #8b3a1a; }
.pty-hdr { font-size: 8pt; font-weight: 700; text-transform: uppercase; color: #8b3a1a; border-bottom: 0.5pt solid #ddd; padding-bottom: 2px; margin-bottom: 3px; }
.pty-name { font-size: 11pt; font-weight: 700; }
.pty-row { display: flex; font-size: 9pt; margin-top: 1px; }
.pty-row .lbl { font-weight: 700; min-width: 60px; }
.ref-bar { border-bottom: 1px solid #8b3a1a; padding: 4px 10px; font-size: 9pt; display: flex; gap: 20px; flex-wrap: wrap; background: #fdf1e7 !important; }
.ref-bar b { color: #4a1505; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #8b3a1a !important; color: #fff !important; font-size: 8.5pt; padding: 4px 5px; border-right: 1px solid #8b3a1a; border-bottom: 1px solid #8b3a1a; text-align: center; text-transform: uppercase; }
table.items th:last-child { border-right: none; }
table.items th.left { text-align: left; }
.cell { border-right: 0.5pt solid #ddb59a; border-bottom: 0.5pt solid #ddb59a; padding: 3px 5px; font-size: 9.5pt; height: 21px; }
.cell:last-child { border-right: none; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #fdf1e7 !important; }
.tfoot-row td { font-weight: 700; border-top: 1px solid #8b3a1a; border-right: 0.5pt solid #ddb59a; padding: 3px 5px; background: #8b3a1a !important; color: #fff !important; font-size: 10pt; }
.words-row { border-top: 1px solid #8b3a1a; padding: 5px 10px; display: flex; }
.words-lbl { font-weight: 700; font-size: 9.5pt; border-right: 1px solid #8b3a1a; padding-right: 10px; margin-right: 10px; white-space: nowrap; color: #4a1505; }
.words-val { font-size: 10.5pt; font-weight: 700; }
.fbr-row { border-top: 1px solid #8b3a1a; padding: 6px 10px; display: flex; align-items: center; gap: 14px; background: #fdf1e7 !important; }
.fbr-info { flex: 1; font-size: 8.5pt; line-height: 1.6; }
.fbr-irn { font-weight: 700; font-size: 9.5pt; color: #4a1505; }
.sig-row { display: flex; justify-content: space-between; margin-top: 36px; padding: 0 40px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 1px solid #8b3a1a; margin-bottom: 3px; }
.sig .label { font-size: 9pt; font-weight: 700; text-transform: uppercase; color: #4a1505; }
</style></head><body>
<div class="main">
<div class="bismillah">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>
<div class="outer">
  <div class="title-band"><h1>Credit Note</h1></div>
  <div class="sup-row">
    <div class="sup-block">
      {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:44px;margin-bottom:4px;display:block">{{/if}}
      <div class="sup-name">{{supplierName}}</div>
      {{#if supplierAddress}}<div class="sup-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
      {{#if supplierPhone}}<div class="sup-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
      {{#if supplierNTN}}<div class="sup-sub"><b>NTN:</b> {{supplierNTN}}{{#if supplierSTRN}} &bull; <b>STRN:</b> {{supplierSTRN}}{{/if}}</div>{{/if}}
    </div>
    <div class="note-block">
      <div class="note-lbl">Credit Note No</div>
      <div class="note-num">{{invoiceNumber}}</div>
      <div class="note-date">{{fmtDate date}}</div>
    </div>
  </div>
  <div class="parties-row">
    <div class="party">
      <div class="pty-hdr">Supplier</div>
      <div class="pty-name">{{supplierName}}</div>
      {{#if supplierAddress}}<div class="pty-row"><span class="lbl">Address:</span><span>{{supplierAddress}}</span></div>{{/if}}
      {{#if supplierSTRN}}<div class="pty-row"><span class="lbl">STRN:</span><span>{{supplierSTRN}}</span></div>{{/if}}
      {{#if supplierNTN}}<div class="pty-row"><span class="lbl">NTN:</span><span>{{supplierNTN}}</span></div>{{/if}}
    </div>
    <div class="party">
      <div class="pty-hdr">Buyer</div>
      <div class="pty-name">{{buyerName}}</div>
      {{#if buyerAddress}}<div class="pty-row"><span class="lbl">Address:</span><span>{{{nl2br buyerAddress}}}</span></div>{{/if}}
      {{#if buyerPhone}}<div class="pty-row"><span class="lbl">Phone:</span><span>{{buyerPhone}}</span></div>{{/if}}
      {{#if buyerSTRN}}<div class="pty-row"><span class="lbl">STRN:</span><span>{{buyerSTRN}}</span></div>{{/if}}
      {{#if buyerNTN}}<div class="pty-row"><span class="lbl">NTN:</span><span>{{buyerNTN}}</span></div>{{/if}}
    </div>
  </div>
  <div class="ref-bar">
    {{#if originalInvoiceNumber}}<span><b>Against Invoice #</b> {{originalInvoiceNumber}} <b>dated</b> {{fmtDate originalInvoiceDate}}</span>{{/if}}
    {{#if originalInvoiceRefIRN}}<span><b>Ref IRN:</b> {{originalInvoiceRefIRN}}</span>{{/if}}
    <span><b>Document:</b> {{#if noteKindLabel}}{{noteKindLabel}}{{else}}Credit Note{{/if}}</span>
  </div>
  {{#if noteReason}}
  <div class="ref-bar">
    <span><b>Reason:</b> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</span>
  </div>
  {{/if}}
  <table class="items">
    <thead>
      <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th class="left">Description</th><th style="width:88px">Value Excl. Tax</th><th style="width:44px">Rate</th><th style="width:78px">Sales Tax</th><th style="width:88px">Value Incl. Tax</th></tr>
    </thead>
    <tbody>
      {{#each items}}<tr>
        <td class="cell c">{{this.quantity}}</td>
        <td class="cell c">{{this.uom}}</td>
        <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
        <td class="cell r">{{fmtDec this.valueExclTax}}</td>
        <td class="cell c">{{this.gstRate}}%</td>
        <td class="cell r">{{fmtDec this.gstAmount}}</td>
        <td class="cell r">{{fmtDec this.totalInclTax}}</td>
      </tr>{{/each}}
      {{emptyRows (math 12 "-" items.length) 7}}
    </tbody>
    <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT :</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
  </table>
  <div class="words-row"><span class="words-lbl">Amount In Words:</span><span class="words-val">{{amountInWords}}</span></div>
  {{#if fbrIRN}}
  <div class="fbr-row">
    <img src="{{fbrLogoUrl}}" style="height:42px">
    <div class="fbr-info">
      <div class="fbr-irn">FBR Invoice Reference No: {{fbrIRN}}</div>
      {{#if fbrStatus}}<div>Status: {{fbrStatus}}</div>{{/if}}
      {{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
    </div>
    <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
  </div>
  {{/if}}
</div>
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 11. Maroon & Gold ───────────────────────────────────────
  {
    id: "creditnote-green-gold",
    name: "Maroon & Gold",
    type: "CreditNote",
    description: "Deep maroon header with gold accents, note details section and FBR block",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #111; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; padding: 0 10mm 6mm; }
.footer { margin-top: auto; padding: 0 10mm 8mm; }
.maroon-bar { background: #7b1e26 !important; padding: 12px 10mm; display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px; }
.mb-name { font-size: 22pt; font-weight: 800; color: #fdd835 !important; text-transform: uppercase; letter-spacing: 1px; }
.mb-sub { font-size: 8pt; color: #dfb3b7 !important; margin-top: 3px; line-height: 1.4; }
.mb-right { text-align: right; }
.mb-title { font-size: 9.5pt; font-weight: 700; letter-spacing: 3px; color: #fdd835 !important; text-transform: uppercase; }
.mb-num { font-size: 14pt; font-weight: 800; color: #fff !important; margin-top: 4px; }
.mb-date { font-size: 8.5pt; color: #dfb3b7 !important; margin-top: 2px; }
.gold-rule { height: 3px; background: linear-gradient(90deg, #fdd835, #f9a825, #fdd835) !important; margin-bottom: 10px; }
.parties { display: flex; gap: 12px; margin-bottom: 8px; }
.party { flex: 1; border-left: 3px solid #7b1e26; padding: 7px 10px; background: #faeded !important; font-size: 9.5pt; line-height: 1.5; }
.party-hdr { font-size: 7.5pt; text-transform: uppercase; font-weight: 700; color: #7b1e26; letter-spacing: 0.5px; margin-bottom: 4px; }
.party-name { font-size: 11.5pt; font-weight: 700; }
.party-det { font-size: 8.5pt; color: #333; margin-top: 2px; line-height: 1.5; }
.meta-row { font-size: 9pt; margin-bottom: 6px; display: flex; gap: 24px; flex-wrap: wrap; }
.meta-row b { color: #7b1e26; }
.reason-line { border-left: 3px solid #f9a825; background: #fdf7e2 !important; padding: 5px 10px; margin-bottom: 8px; font-size: 9pt; }
.reason-line b { color: #7b1e26; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #7b1e26 !important; color: #fdd835 !important; font-size: 8pt; padding: 5px 6px; border: 1px solid #7b1e26; text-align: center; text-transform: uppercase; }
table.items th.left { text-align: left; }
.cell { border: 1px solid #e8c8cb; padding: 3px 6px; font-size: 9.5pt; height: 21px; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #faeded !important; }
.tfoot-row td { font-weight: 700; border: 1px solid #7b1e26; padding: 4px 6px; background: #7b1e26 !important; color: #fdd835 !important; font-size: 10pt; }
.bot-row { display: flex; gap: 14px; margin-top: 10px; }
.words-block { flex: 1; border: 1px solid #e8c8cb; border-top: 2px solid #7b1e26; padding: 6px 10px; }
.words-lbl { font-size: 8pt; text-transform: uppercase; font-weight: 700; color: #7b1e26; margin-bottom: 2px; }
.words-val { font-size: 10pt; font-weight: 700; }
.note-details { min-width: 160px; border: 1px solid #e8c8cb; border-top: 2px solid #fdd835; padding: 6px 10px; font-size: 8pt; line-height: 1.6; }
.nd-title { font-size: 7.5pt; text-transform: uppercase; font-weight: 700; color: #7b1e26; margin-bottom: 3px; }
.fbr-block { display: flex; align-items: center; gap: 14px; margin-top: 10px; padding: 7px 10px; border: 1.5px solid #7b1e26; background: #faeded !important; }
.fbr-info { flex: 1; font-size: 8.5pt; line-height: 1.6; }
.fbr-irn { font-weight: 700; font-size: 9.5pt; color: #7b1e26; }
.sig-row { display: flex; justify-content: space-between; margin-top: 32px; padding: 0 40px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 1.5px solid #7b1e26; margin-bottom: 3px; }
.sig .label { font-size: 8.5pt; font-weight: 700; color: #7b1e26; text-transform: uppercase; }
</style></head><body>
<div class="maroon-bar">
  <div>
    {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:40px;margin-bottom:4px;display:block">{{/if}}
    <div class="mb-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="mb-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div class="mb-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
    {{#if supplierNTN}}<div class="mb-sub">NTN: {{supplierNTN}}{{#if supplierSTRN}} | STRN: {{supplierSTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="mb-right">
    <div class="mb-title">Credit Note</div>
    <div class="mb-num">{{invoiceNumber}}</div>
    <div class="mb-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="main">
<div class="gold-rule"></div>
<div class="parties">
  <div class="party">
    <div class="party-hdr">Supplier</div>
    <div class="party-name">{{supplierName}}</div>
    <div class="party-det">
      {{#if supplierAddress}}{{supplierAddress}}<br>{{/if}}
      {{#if supplierSTRN}}<b>STRN:</b> {{supplierSTRN}}<br>{{/if}}
      {{#if supplierNTN}}<b>NTN:</b> {{supplierNTN}}{{/if}}
    </div>
  </div>
  <div class="party">
    <div class="party-hdr">Buyer</div>
    <div class="party-name">{{buyerName}}</div>
    <div class="party-det">
      {{#if buyerAddress}}{{{nl2br buyerAddress}}}<br>{{/if}}
      {{#if buyerPhone}}<b>Ph:</b> {{buyerPhone}}<br>{{/if}}
      {{#if buyerSTRN}}<b>STRN:</b> {{buyerSTRN}}<br>{{/if}}
      {{#if buyerNTN}}<b>NTN:</b> {{buyerNTN}}{{/if}}
    </div>
  </div>
</div>
<div class="meta-row">
  {{#if originalInvoiceNumber}}<span><b>Against Invoice #</b> {{originalInvoiceNumber}} <b>dated</b> {{fmtDate originalInvoiceDate}}</span>{{/if}}
  {{#if originalInvoiceRefIRN}}<span><b>Ref IRN:</b> {{originalInvoiceRefIRN}}</span>{{/if}}
</div>
{{#if noteReason}}<div class="reason-line"><b>Reason:</b> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</div>{{/if}}
<table class="items">
  <thead>
    <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th class="left">Description</th><th style="width:88px">Value Excl. Tax</th><th style="width:44px">Rate</th><th style="width:76px">Sales Tax</th><th style="width:88px">Value Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 12 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="bot-row">
  <div class="words-block"><div class="words-lbl">Amount In Words</div><div class="words-val">{{amountInWords}}</div></div>
  <div class="note-details">
    <div class="nd-title">Note Details</div>
    <div>Document: {{#if noteKindLabel}}{{noteKindLabel}}{{else}}Credit Note{{/if}}</div>
    <div>Issued By: {{supplierName}}</div>
  </div>
</div>
{{#if fbrIRN}}
<div class="fbr-block">
  <img src="{{fbrLogoUrl}}" style="height:42px">
  <div class="fbr-info">
    <div class="fbr-irn">FBR Invoice Reference No: {{fbrIRN}}</div>
    {{#if fbrStatus}}<div>Status: {{fbrStatus}}</div>{{/if}}
    {{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
</div>
{{/if}}
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 12. Rust & Slate ────────────────────────────────────────
  {
    id: "creditnote-teal-slate",
    name: "Rust & Slate",
    type: "CreditNote",
    description: "Warm rust & slate palette with card-style party boxes and terms section",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } .footer, .terms { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Segoe UI", Calibri, Arial, sans-serif; padding: 8mm 10mm; color: #1a1a1a; display: flex; flex-direction: column; min-height: 100vh; font-size: 10pt; }
.main { flex: 1; }
.footer { margin-top: auto; }
.rust-rule { height: 4px; background: linear-gradient(90deg, #bf360c, #e64a19, #bf360c) !important; margin-bottom: 14px; }
.top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.sup-name { font-size: 20pt; font-weight: 800; color: #7f2300; letter-spacing: 0.5px; }
.sup-sub { font-size: 8.5pt; color: #546e7a; margin-top: 3px; line-height: 1.5; }
.badge-area { text-align: right; }
.badge { display: inline-block; background: #bf360c !important; color: #fff !important; padding: 5px 14px; font-size: 10pt; font-weight: 700; letter-spacing: 2px; border-radius: 2px; }
.note-meta { text-align: right; margin-top: 6px; font-size: 9pt; color: #546e7a; line-height: 1.7; }
.note-meta strong { color: #7f2300; }
.parties { display: flex; gap: 12px; margin-bottom: 10px; }
.party { flex: 1; border: 1px solid #f0c1ae; border-top: 3px solid #bf360c; padding: 8px 10px; font-size: 9.5pt; line-height: 1.5; background: #fbe9e7 !important; }
.party-hdr { font-size: 7.5pt; text-transform: uppercase; font-weight: 700; color: #bf360c; letter-spacing: 0.5px; margin-bottom: 4px; }
.party-name { font-size: 11pt; font-weight: 700; color: #7f2300; }
.party-det { font-size: 8.5pt; color: #37474f; margin-top: 2px; line-height: 1.5; }
.meta-bar { background: #f5f5f5 !important; border-left: 3px solid #bf360c; padding: 5px 10px; margin-bottom: 6px; font-size: 9pt; display: flex; gap: 20px; flex-wrap: wrap; }
.meta-bar b { color: #bf360c; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #bf360c !important; color: #fff !important; font-size: 8pt; padding: 5px 6px; border: 1px solid #bf360c; text-align: center; text-transform: uppercase; }
table.items th.left { text-align: left; }
.cell { border: 1px solid #f0c1ae; padding: 3px 6px; font-size: 9.5pt; height: 21px; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #fbe9e7 !important; }
.tfoot-row td { font-weight: 700; border: 1px solid #bf360c; padding: 4px 6px; background: #bf360c !important; color: #fff !important; font-size: 10pt; }
.words-area { border: 1px solid #f0c1ae; margin-top: 8px; display: flex; }
.words-lbl { padding: 4px 10px; border-right: 1px solid #f0c1ae; font-weight: 700; font-size: 9pt; white-space: nowrap; background: #fbe9e7 !important; color: #bf360c; }
.words-val { padding: 4px 12px; font-size: 10pt; font-weight: 700; }
.fbr-block { display: flex; align-items: center; gap: 14px; margin-top: 10px; padding: 8px 12px; border: 1.5px solid #bf360c; background: #fbe9e7 !important; }
.fbr-info { flex: 1; font-size: 8.5pt; line-height: 1.6; }
.fbr-irn { font-weight: 700; font-size: 9.5pt; color: #7f2300; }
.terms { margin-top: 10px; font-size: 8pt; color: #546e7a; line-height: 1.6; border-top: 1px solid #f0c1ae; padding-top: 6px; }
.terms b { color: #bf360c; }
.sig-row { display: flex; justify-content: space-between; margin-top: 28px; padding: 0 30px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 2px solid #bf360c; margin-bottom: 3px; }
.sig .label { font-size: 8pt; color: #546e7a; text-transform: uppercase; font-weight: 700; }
</style></head><body>
<div class="main">
<div class="rust-rule"></div>
<div class="top">
  <div>
    {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:44px;margin-bottom:4px;display:block">{{/if}}
    <div class="sup-name">{{supplierName}}</div>
    {{#if supplierAddress}}<div class="sup-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
    {{#if supplierPhone}}<div class="sup-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
    {{#if supplierNTN}}<div class="sup-sub"><strong>NTN:</strong> {{supplierNTN}}{{#if supplierSTRN}} &nbsp;|&nbsp; <strong>STRN:</strong> {{supplierSTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="badge-area">
    <div class="badge">CREDIT NOTE</div>
    <div class="note-meta">
      <strong>No:</strong> {{invoiceNumber}}<br>
      <strong>Date:</strong> {{fmtDate date}}
    </div>
  </div>
</div>
<div class="parties">
  <div class="party">
    <div class="party-hdr">Supplier</div>
    <div class="party-name">{{supplierName}}</div>
    <div class="party-det">
      {{#if supplierAddress}}{{supplierAddress}}<br>{{/if}}
      {{#if supplierSTRN}}<b>STRN:</b> {{supplierSTRN}}<br>{{/if}}
      {{#if supplierNTN}}<b>NTN:</b> {{supplierNTN}}{{/if}}
    </div>
  </div>
  <div class="party">
    <div class="party-hdr">Buyer</div>
    <div class="party-name">{{buyerName}}</div>
    <div class="party-det">
      {{#if buyerAddress}}{{{nl2br buyerAddress}}}<br>{{/if}}
      {{#if buyerPhone}}<b>Ph:</b> {{buyerPhone}}<br>{{/if}}
      {{#if buyerSTRN}}<b>STRN:</b> {{buyerSTRN}}<br>{{/if}}
      {{#if buyerNTN}}<b>NTN:</b> {{buyerNTN}}{{/if}}
    </div>
  </div>
</div>
<div class="meta-bar">
  {{#if originalInvoiceNumber}}<span><b>Against Invoice #</b> {{originalInvoiceNumber}} <b>dated</b> {{fmtDate originalInvoiceDate}}</span>{{/if}}
  {{#if originalInvoiceRefIRN}}<span><b>Ref IRN:</b> {{originalInvoiceRefIRN}}</span>{{/if}}
  <span><b>Document:</b> {{#if noteKindLabel}}{{noteKindLabel}}{{else}}Credit Note{{/if}}</span>
</div>
{{#if noteReason}}<div class="meta-bar"><span><b>Reason:</b> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</span></div>{{/if}}
<table class="items">
  <thead>
    <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th class="left">Description</th><th style="width:88px">Value Excl. Tax</th><th style="width:44px">Rate</th><th style="width:76px">Sales Tax</th><th style="width:88px">Value Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 12 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="words-area"><span class="words-lbl">Amount In Words:</span><span class="words-val">{{amountInWords}}</span></div>
{{#if fbrIRN}}
<div class="fbr-block">
  <img src="{{fbrLogoUrl}}" style="height:42px">
  <div class="fbr-info">
    <div class="fbr-irn">FBR Invoice Reference No: {{fbrIRN}}</div>
    {{#if fbrStatus}}<div>Status: {{fbrStatus}}</div>{{/if}}
    {{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
</div>
{{/if}}
<div class="terms"><b>Note:</b> This credit note adjusts the referenced sales tax invoice. The amount credited reduces the buyer's outstanding payable. All disputes subject to local jurisdiction.</div>
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 13. Big Letterhead ──────────────────────────────────────
  {
    id: "creditnote-big-letterhead",
    name: "Big Letterhead",
    type: "CreditNote",
    description: "Tall letterhead-style header with large logo space, full-bleed color bar and FBR footer",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 0; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #111; display: flex; flex-direction: column; min-height: 100vh; }
.main { flex: 1; padding: 0 10mm 6mm; }
.footer { margin-top: auto; padding: 0 10mm 8mm; }
.letterhead { background: #263238 !important; padding: 16px 10mm 12px; }
.lh-inner { display: flex; justify-content: space-between; align-items: center; }
.lh-left { display: flex; align-items: center; gap: 14px; }
.lh-name { font-size: 26pt; font-weight: 900; color: #fff !important; text-transform: uppercase; letter-spacing: 1.5px; }
.lh-sub { font-size: 8pt; color: #90a4ae !important; margin-top: 3px; line-height: 1.4; }
.lh-right { text-align: right; }
.lh-ntn { font-size: 8.5pt; color: #90a4ae !important; }
.accent-stripe { height: 6px; background: linear-gradient(90deg, #ff6f00, #ffa726, #ff6f00) !important; margin-bottom: 14px; }
.note-banner { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1.5px solid #263238; margin-bottom: 10px; }
.note-title { font-size: 18pt; font-weight: 900; color: #263238; text-transform: uppercase; letter-spacing: 2px; }
.note-meta { text-align: right; font-size: 9.5pt; line-height: 1.7; }
.note-meta strong { color: #263238; }
.parties { display: flex; gap: 12px; margin-bottom: 10px; }
.party { flex: 1; border: 1px solid #cfd8dc; border-bottom: 3px solid #263238; padding: 7px 10px; font-size: 9.5pt; line-height: 1.5; }
.party-hdr { font-size: 7.5pt; text-transform: uppercase; font-weight: 700; color: #263238; letter-spacing: 0.5px; margin-bottom: 4px; }
.party-name { font-size: 11pt; font-weight: 700; }
.party-det { font-size: 8.5pt; color: #444; margin-top: 2px; line-height: 1.5; }
.ref-row { font-size: 9pt; margin-bottom: 6px; display: flex; gap: 24px; flex-wrap: wrap; background: #eceff1 !important; padding: 5px 10px; border-left: 3px solid #ff6f00; }
.ref-row b { color: #263238; }
.reason-row { font-size: 9pt; margin-bottom: 8px; background: #fff3e0 !important; padding: 5px 10px; border-left: 3px solid #ffa726; }
.reason-row b { color: #263238; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #263238 !important; color: #ffa726 !important; font-size: 8pt; padding: 5px 6px; border: 1px solid #263238; text-align: center; text-transform: uppercase; }
table.items th.left { text-align: left; }
.cell { border: 1px solid #cfd8dc; padding: 3px 6px; font-size: 9.5pt; height: 21px; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #f5f5f5 !important; }
.tfoot-row td { font-weight: 700; border: 1px solid #263238; padding: 4px 6px; background: #263238 !important; color: #ffa726 !important; font-size: 10pt; }
.words-area { border: 1px solid #cfd8dc; margin-top: 8px; display: flex; }
.words-lbl { padding: 4px 10px; border-right: 1px solid #cfd8dc; font-weight: 700; font-size: 9pt; white-space: nowrap; background: #eceff1 !important; }
.words-val { padding: 4px 12px; font-size: 10pt; font-weight: 700; }
.fbr-block { display: flex; align-items: center; gap: 14px; margin-top: 10px; padding: 8px 12px; border: 2px solid #263238; background: #f5f5f5 !important; }
.fbr-info { flex: 1; font-size: 8.5pt; line-height: 1.6; }
.fbr-irn { font-weight: 700; font-size: 9.5pt; color: #263238; }
.sig-row { display: flex; justify-content: space-between; margin-top: 36px; padding: 0 40px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 1.5px solid #263238; margin-bottom: 3px; }
.sig .label { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; color: #263238; }
</style></head><body>
<div class="letterhead">
  <div class="lh-inner">
    <div class="lh-left">
      {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:56px">{{/if}}
      <div>
        <div class="lh-name">{{supplierName}}</div>
        {{#if supplierAddress}}<div class="lh-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
        {{#if supplierPhone}}<div class="lh-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
      </div>
    </div>
    <div class="lh-right">
      {{#if supplierNTN}}<div class="lh-ntn">NTN: {{supplierNTN}}</div>{{/if}}
      {{#if supplierSTRN}}<div class="lh-ntn">STRN: {{supplierSTRN}}</div>{{/if}}
    </div>
  </div>
</div>
<div class="accent-stripe"></div>
<div class="main">
<div class="note-banner">
  <div class="note-title">Credit Note</div>
  <div class="note-meta">
    <strong>Note #:</strong> {{invoiceNumber}}<br>
    <strong>Date:</strong> {{fmtDate date}}
  </div>
</div>
<div class="parties">
  <div class="party">
    <div class="party-hdr">Supplier</div>
    <div class="party-name">{{supplierName}}</div>
    <div class="party-det">
      {{#if supplierAddress}}{{supplierAddress}}<br>{{/if}}
      {{#if supplierSTRN}}<b>STRN:</b> {{supplierSTRN}}<br>{{/if}}
      {{#if supplierNTN}}<b>NTN:</b> {{supplierNTN}}{{/if}}
    </div>
  </div>
  <div class="party">
    <div class="party-hdr">Buyer</div>
    <div class="party-name">{{buyerName}}</div>
    <div class="party-det">
      {{#if buyerAddress}}{{{nl2br buyerAddress}}}<br>{{/if}}
      {{#if buyerPhone}}<b>Ph:</b> {{buyerPhone}}<br>{{/if}}
      {{#if buyerSTRN}}<b>STRN:</b> {{buyerSTRN}}<br>{{/if}}
      {{#if buyerNTN}}<b>NTN:</b> {{buyerNTN}}{{/if}}
    </div>
  </div>
</div>
<div class="ref-row">
  {{#if originalInvoiceNumber}}<span><b>Against Invoice #</b> {{originalInvoiceNumber}} <b>dated</b> {{fmtDate originalInvoiceDate}}</span>{{/if}}
  {{#if originalInvoiceRefIRN}}<span><b>Ref IRN:</b> {{originalInvoiceRefIRN}}</span>{{/if}}
  <span><b>Document:</b> {{#if noteKindLabel}}{{noteKindLabel}}{{else}}Credit Note{{/if}}</span>
</div>
{{#if noteReason}}<div class="reason-row"><b>Reason:</b> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</div>{{/if}}
<table class="items">
  <thead>
    <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th class="left">Description</th><th style="width:88px">Value Excl. Tax</th><th style="width:44px">Rate</th><th style="width:76px">Sales Tax</th><th style="width:88px">Value Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 12 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="words-area"><span class="words-lbl">Amount In Words:</span><span class="words-val">{{amountInWords}}</span></div>
{{#if fbrIRN}}
<div class="fbr-block">
  <img src="{{fbrLogoUrl}}" style="height:42px">
  <div class="fbr-info">
    <div class="fbr-irn">FBR Invoice Reference No: {{fbrIRN}}</div>
    {{#if fbrStatus}}<div>Status: {{fbrStatus}}</div>{{/if}}
    {{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
</div>
{{/if}}
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 14. Centered / Watermark Title ──────────────────────────
  {
    id: "creditnote-centered-watermark",
    name: "Centered / Watermark Title",
    type: "CreditNote",
    description: "Large centered CREDIT NOTE watermark in background, clean centered layout",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 8mm 10mm; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 8mm 10mm; color: #111; display: flex; flex-direction: column; min-height: 100vh; position: relative; }
.main { flex: 1; }
.footer { margin-top: auto; }
.watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 64pt; font-weight: 900; color: rgba(183,28,28,0.07) !important; text-transform: uppercase; letter-spacing: 6px; pointer-events: none; white-space: nowrap; z-index: 0; }
.page-content { position: relative; z-index: 1; }
.hdr-center { text-align: center; border-bottom: 3px solid #7b1e26; padding-bottom: 10px; margin-bottom: 10px; }
.hdr-name { font-size: 24pt; font-weight: 900; color: #7b1e26; text-transform: uppercase; letter-spacing: 2px; }
.hdr-sub { font-size: 9pt; color: #555; margin-top: 3px; line-height: 1.5; }
.note-center { text-align: center; margin: 6px 0 10px; }
.note-title { font-size: 14pt; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; color: #7b1e26; border: 2px solid #7b1e26; display: inline-block; padding: 4px 20px; }
.note-nums { display: flex; justify-content: center; gap: 30px; margin-top: 6px; font-size: 9.5pt; color: #555; }
.note-nums strong { color: #7b1e26; }
.ref-center { text-align: center; font-size: 9.5pt; margin-bottom: 4px; color: #444; }
.ref-center b { color: #7b1e26; }
.reason-center { text-align: center; font-size: 9.5pt; font-style: italic; margin-bottom: 8px; color: #444; }
.reason-center b { color: #7b1e26; font-style: normal; }
.parties { display: flex; gap: 12px; margin-bottom: 8px; }
.party { flex: 1; border: 1px solid #ddc3c6; padding: 7px 10px; font-size: 9.5pt; line-height: 1.5; }
.party-hdr { font-size: 7.5pt; text-transform: uppercase; font-weight: 700; color: #7b1e26; letter-spacing: 0.5px; margin-bottom: 4px; }
.party-name { font-size: 11pt; font-weight: 700; }
.party-det { font-size: 8.5pt; color: #444; margin-top: 2px; line-height: 1.5; }
table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
table.items th { background: #7b1e26 !important; color: #fff !important; font-size: 8pt; padding: 5px 6px; border: 1px solid #7b1e26; text-align: center; text-transform: uppercase; }
table.items th.left { text-align: left; }
.cell { border: 1px solid #ddc3c6; padding: 3px 6px; font-size: 9.5pt; height: 21px; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #f7eced !important; }
.tfoot-row td { font-weight: 700; border: 1px solid #7b1e26; padding: 4px 6px; background: #7b1e26 !important; color: #fff !important; font-size: 10pt; }
.words-center { text-align: center; margin-top: 8px; }
.words-box { display: inline-flex; border: 1px solid #ddc3c6; }
.wlbl { padding: 4px 12px; border-right: 1px solid #ddc3c6; font-weight: 700; font-size: 9.5pt; background: #f7eced !important; }
.wval { padding: 4px 16px; font-size: 11pt; font-weight: 700; }
.fbr-block { display: flex; align-items: center; gap: 14px; margin-top: 10px; padding: 8px 12px; border: 1.5px solid #7b1e26; background: #f7eced !important; }
.fbr-info { flex: 1; font-size: 8.5pt; line-height: 1.6; }
.fbr-irn { font-weight: 700; font-size: 9.5pt; color: #7b1e26; }
.sig-row { display: flex; justify-content: space-between; margin-top: 36px; padding: 0 50px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 1.5px solid #7b1e26; margin-bottom: 3px; }
.sig .label { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; color: #7b1e26; }
</style></head><body>
<div class="watermark">Credit Note</div>
<div class="page-content">
<div class="main">
<div class="hdr-center">
  {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:50px;margin-bottom:6px">{{/if}}
  <div class="hdr-name">{{supplierName}}</div>
  {{#if supplierAddress}}<div class="hdr-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
  {{#if supplierPhone}}<div class="hdr-sub">{{{nl2br supplierPhone}}}</div>{{/if}}
  {{#if supplierNTN}}<div class="hdr-sub"><b>NTN:</b> {{supplierNTN}}{{#if supplierSTRN}} &nbsp;&bull;&nbsp; <b>STRN:</b> {{supplierSTRN}}{{/if}}</div>{{/if}}
</div>
<div class="note-center">
  <div class="note-title">Credit Note</div>
  <div class="note-nums">
    <span><strong>No:</strong> {{invoiceNumber}}</span>
    <span><strong>Date:</strong> {{fmtDate date}}</span>
  </div>
</div>
{{#if (or originalInvoiceNumber originalInvoiceRefIRN)}}
<div class="ref-center">
  {{#if originalInvoiceNumber}}<b>Against Invoice #</b> {{originalInvoiceNumber}} <b>dated</b> {{fmtDate originalInvoiceDate}}{{/if}}
  {{#if originalInvoiceRefIRN}} &nbsp;&bull;&nbsp; <b>Ref IRN:</b> {{originalInvoiceRefIRN}}{{/if}}
</div>
{{/if}}
{{#if noteReason}}<div class="reason-center"><b>Reason:</b> {{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}</div>{{/if}}
<div class="parties">
  <div class="party">
    <div class="party-hdr">Supplier</div>
    <div class="party-name">{{supplierName}}</div>
    <div class="party-det">
      {{#if supplierAddress}}{{supplierAddress}}<br>{{/if}}
      {{#if supplierSTRN}}<b>STRN:</b> {{supplierSTRN}}<br>{{/if}}
      {{#if supplierNTN}}<b>NTN:</b> {{supplierNTN}}{{/if}}
    </div>
  </div>
  <div class="party">
    <div class="party-hdr">Buyer</div>
    <div class="party-name">{{buyerName}}</div>
    <div class="party-det">
      {{#if buyerAddress}}{{{nl2br buyerAddress}}}<br>{{/if}}
      {{#if buyerPhone}}<b>Ph:</b> {{buyerPhone}}<br>{{/if}}
      {{#if buyerSTRN}}<b>STRN:</b> {{buyerSTRN}}<br>{{/if}}
      {{#if buyerNTN}}<b>NTN:</b> {{buyerNTN}}{{/if}}
    </div>
  </div>
</div>
<table class="items">
  <thead>
    <tr><th style="width:38px">Qty</th><th style="width:42px">Unit</th><th class="left">Description</th><th style="width:88px">Value Excl. Tax</th><th style="width:44px">Rate</th><th style="width:76px">Sales Tax</th><th style="width:88px">Value Incl. Tax</th></tr>
  </thead>
  <tbody>
    {{#each items}}<tr>
      <td class="cell c">{{this.quantity}}</td>
      <td class="cell c">{{this.uom}}</td>
      <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
      <td class="cell r">{{fmtDec this.valueExclTax}}</td>
      <td class="cell c">{{this.gstRate}}%</td>
      <td class="cell r">{{fmtDec this.gstAmount}}</td>
      <td class="cell r">{{fmtDec this.totalInclTax}}</td>
    </tr>{{/each}}
    {{emptyRows (math 12 "-" items.length) 7}}
  </tbody>
  <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT :</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
</table>
<div class="words-center"><div class="words-box"><span class="wlbl">Amount In Words</span><span class="wval">{{amountInWords}}</span></div></div>
{{#if fbrIRN}}
<div class="fbr-block">
  <img src="{{fbrLogoUrl}}" style="height:42px">
  <div class="fbr-info">
    <div class="fbr-irn">FBR Invoice Reference No: {{fbrIRN}}</div>
    {{#if fbrStatus}}<div>Status: {{fbrStatus}}</div>{{/if}}
    {{#if fbrSubmittedAt}}<div>Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
</div>
{{/if}}
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
    <div class="sig"><div class="line"></div><div class="label">Receiver's Signature &amp; Stamp</div></div>
  </div>
</div>
</div>
</body></html>`,
  },

  // ─── 15. Government-Form Grid (most FBR-official-looking) ────
  {
    id: "creditnote-govt-form-grid",
    name: "Government-Form Grid",
    type: "CreditNote",
    description: "FBR-official government-form style: rigid grid with reference row and prominent FBR block",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Note #{{invoiceNumber}}</title><style>
@media print { @page { size: A4; margin: 7mm 9mm; } .footer { page-break-inside: avoid; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, Helvetica, sans-serif; padding: 7mm 9mm; color: #000; display: flex; flex-direction: column; min-height: 100vh; font-size: 9pt; }
.main { flex: 1; }
.footer { margin-top: auto; }
.form-outer { border: 2px solid #000; }
.title-row { display: flex; border-bottom: 2px solid #000; }
.title-left { flex: 1; display: flex; align-items: center; padding: 6px 10px; border-right: 2px solid #000; }
.title-sup { font-size: 15pt; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
.title-center { flex: 1.5; text-align: center; padding: 6px 10px; border-right: 2px solid #000; }
.form-title { font-size: 14pt; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; }
.form-subtitle { font-size: 8pt; font-weight: 700; color: #333; margin-top: 1px; }
.title-right { width: 130px; padding: 6px 8px; text-align: center; }
.note-lbl { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 3px; }
.note-num { font-size: 12pt; font-weight: 900; }
.note-date { font-size: 8pt; margin-top: 2px; }
.grid-row { display: flex; border-bottom: 1.5px solid #000; }
.grid-cell { flex: 1; padding: 5px 8px; border-right: 1px solid #000; font-size: 8.5pt; line-height: 1.4; }
.grid-cell:last-child { border-right: none; }
.gc-lbl { font-size: 7pt; font-weight: 700; text-transform: uppercase; color: #444; border-bottom: 0.5pt solid #ddd; padding-bottom: 1px; margin-bottom: 3px; letter-spacing: 0.3px; }
.gc-val { font-size: 9pt; font-weight: 700; }
.gc-sub { font-size: 8pt; color: #333; margin-top: 1px; line-height: 1.4; }
.field-row { border-bottom: 1px solid #000; padding: 3px 8px; font-size: 8.5pt; display: flex; gap: 6px; }
.field-row .fl { font-weight: 700; min-width: 80px; }
table.items { width: 100%; border-collapse: collapse; }
table.items th { background: #333 !important; color: #fff !important; font-size: 8pt; padding: 4px 5px; border-right: 1px solid #666; border-bottom: 1.5px solid #000; text-align: center; text-transform: uppercase; font-weight: 700; }
table.items th:last-child { border-right: none; }
table.items th.left { text-align: left; }
.cell { border-right: 0.5pt solid #bbb; border-bottom: 0.5pt solid #bbb; padding: 3px 5px; font-size: 8.5pt; height: 20px; }
.cell:last-child { border-right: none; }
.c { text-align: center; } .r { text-align: right; }
tbody tr:nth-child(even) td { background: #f7f7f7 !important; }
.tfoot-row td { font-weight: 700; border-top: 1.5px solid #000; border-right: 0.5pt solid #bbb; border-bottom: none; padding: 3px 5px; background: #e8e8e8 !important; font-size: 9pt; }
.tfoot-row td:last-child { border-right: none; }
.words-row { border-top: 1.5px solid #000; padding: 5px 8px; display: flex; align-items: center; gap: 0; }
.words-lbl { font-weight: 700; font-size: 8.5pt; border-right: 1px solid #000; padding-right: 8px; margin-right: 8px; white-space: nowrap; text-transform: uppercase; }
.words-val { font-size: 9.5pt; font-weight: 700; }
.fbr-section { border-top: 2px solid #000; display: flex; }
.fbr-main { flex: 1; padding: 8px 10px; border-right: 1.5px solid #000; }
.fbr-hdr { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.fbr-title { font-size: 10pt; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; color: #007532; }
.fbr-fields { font-size: 8pt; line-height: 1.8; }
.fbr-irn { font-size: 9.5pt; font-weight: 700; color: #007532; }
.fbr-qr-cell { width: 108px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 6px; }
.fbr-qr-lbl { font-size: 7pt; font-weight: 700; text-align: center; margin-top: 4px; text-transform: uppercase; }
.sig-row { display: flex; justify-content: space-between; margin-top: 36px; padding: 0 30px; }
.sig { text-align: center; }
.sig .line { width: 160px; border-top: 1px solid #000; margin-bottom: 3px; }
.sig .label { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; }
</style></head><body>
<div class="main">
<div class="form-outer">
  <div class="title-row">
    <div class="title-left">
      {{#if supplierLogoPath}}<img src="{{supplierLogoPath}}" style="height:40px;margin-right:8px">{{/if}}
      <div class="title-sup">{{supplierName}}</div>
    </div>
    <div class="title-center">
      <div class="form-title">Credit Note</div>
      <div class="form-subtitle">Issued Under Section 9 of the Sales Tax Act 1990</div>
    </div>
    <div class="title-right">
      <div class="note-lbl">Credit Note No</div>
      <div class="note-num">{{invoiceNumber}}</div>
      <div class="note-date">{{fmtDate date}}</div>
    </div>
  </div>
  <div class="grid-row">
    <div class="grid-cell">
      <div class="gc-lbl">Supplier</div>
      <div class="gc-val">{{supplierName}}</div>
      {{#if supplierAddress}}<div class="gc-sub">{{{nl2br supplierAddress}}}</div>{{/if}}
      {{#if supplierPhone}}<div class="gc-sub">Ph: {{{nl2br supplierPhone}}}</div>{{/if}}
    </div>
    <div class="grid-cell">
      <div class="gc-lbl">Buyer</div>
      <div class="gc-val">{{buyerName}}</div>
      {{#if buyerAddress}}<div class="gc-sub">{{{nl2br buyerAddress}}}</div>{{/if}}
      {{#if buyerPhone}}<div class="gc-sub">Ph: {{buyerPhone}}</div>{{/if}}
    </div>
  </div>
  <div class="grid-row">
    <div class="grid-cell">
      <div class="gc-lbl">Supplier NTN</div>
      <div class="gc-val">{{#if supplierNTN}}{{supplierNTN}}{{else}}&mdash;{{/if}}</div>
    </div>
    <div class="grid-cell">
      <div class="gc-lbl">Supplier STRN</div>
      <div class="gc-val">{{#if supplierSTRN}}{{supplierSTRN}}{{else}}&mdash;{{/if}}</div>
    </div>
    <div class="grid-cell">
      <div class="gc-lbl">Buyer NTN</div>
      <div class="gc-val">{{#if buyerNTN}}{{buyerNTN}}{{else}}&mdash;{{/if}}</div>
    </div>
    <div class="grid-cell" style="border-right:none">
      <div class="gc-lbl">Buyer STRN</div>
      <div class="gc-val">{{#if buyerSTRN}}{{buyerSTRN}}{{else}}&mdash;{{/if}}</div>
    </div>
  </div>
  <div class="field-row"><span class="fl">Reference:</span><span>{{#if originalInvoiceNumber}}Against Invoice # {{originalInvoiceNumber}} dated {{fmtDate originalInvoiceDate}}{{else}}&mdash;{{/if}}{{#if originalInvoiceRefIRN}} &nbsp;&bull;&nbsp; Ref IRN: {{originalInvoiceRefIRN}}{{/if}}</span></div>
  <div class="field-row"><span class="fl">Reason:</span><span>{{#if noteReason}}{{noteReason}}{{#if noteReasonRemarks}} &mdash; {{noteReasonRemarks}}{{/if}}{{else}}&mdash;{{/if}}</span></div>
  <div class="field-row"><span class="fl">Document:</span><span>{{#if noteKindLabel}}{{noteKindLabel}}{{else}}Credit Note{{/if}}</span></div>
  <table class="items">
    <thead>
      <tr><th style="width:36px">Qty</th><th style="width:40px">Unit</th><th class="left">Description / HS Code</th><th style="width:85px">Value Excl. Tax</th><th style="width:42px">Rate</th><th style="width:75px">Sales Tax</th><th style="width:85px">Value Incl. Tax</th></tr>
    </thead>
    <tbody>
      {{#each items}}<tr>
        <td class="cell c">{{this.quantity}}</td>
        <td class="cell c">{{this.uom}}</td>
        <td class="cell">{{#if this.hsCode}}{{this.hsCode}} - {{{richText this.description}}}{{else}}{{{richText this.description}}}{{/if}}</td>
        <td class="cell r">{{fmtDec this.valueExclTax}}</td>
        <td class="cell c">{{this.gstRate}}%</td>
        <td class="cell r">{{fmtDec this.gstAmount}}</td>
        <td class="cell r">{{fmtDec this.totalInclTax}}</td>
      </tr>{{/each}}
      {{emptyRows (math 12 "-" items.length) 7}}
    </tbody>
    <tfoot><tr class="tfoot-row"><td colspan="3" class="r">TOTAL CREDIT :</td><td class="r">{{fmtDec subtotal}}</td><td class="c">{{gstRate}}%</td><td class="r">{{fmtDec gstAmount}}</td><td class="r">{{fmtDec grandTotal}}</td></tr></tfoot>
  </table>
  <div class="words-row"><span class="words-lbl">Amount In Words:</span><span class="words-val">{{amountInWords}}</span></div>
  {{#if fbrIRN}}
  <div class="fbr-section">
    <div class="fbr-main">
      <div class="fbr-hdr">
        <img src="{{fbrLogoUrl}}" style="height:42px">
        <div class="fbr-title">Federal Board of Revenue &mdash; Verified Credit Note</div>
      </div>
      <div class="fbr-fields">
        <div class="fbr-irn">FBR Invoice Reference No (IRN): {{fbrIRN}}</div>
        {{#if fbrStatus}}<div><b>Submission Status:</b> {{fbrStatus}}</div>{{/if}}
        {{#if fbrSubmittedAt}}<div><b>Submitted At:</b> {{fmtDate fbrSubmittedAt}}</div>{{/if}}
      </div>
    </div>
    <div class="fbr-qr-cell">
      <img src="{{{fbrQrPngDataUrl}}}" style="width:90px;height:90px">
      <div class="fbr-qr-lbl">Scan to Verify</div>
    </div>
  </div>
  {{/if}}
</div>
</div>
<div class="footer">
  <div class="sig-row">
    <div class="sig"><div class="line"></div><div class="label">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Checked By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Authorized Signatory</div></div>
  </div>
</div>
</body></html>`,
  },

];
