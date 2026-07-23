/**
 * Payment Voucher starter templates — 4 distinct visual archetypes.
 * A PAYMENT VOUCHER records money the company PAID OUT (cash-out) to a
 * client/supplier, optionally settling specific bills/invoices.
 * All templates are A4 print-ready and Handlebars-powered.
 *
 * Merge fields:
 *   Branding — companyBrandName, companyLogoPath, companyAddress, companyPhone,
 *              companyNTN, companySTRN
 *   Document — reference, date, contactType, contactName, contactAddress,
 *              contactPhone, method, bankAccountName, chequeNumber, chequeDate,
 *              description, amount, amountInWords
 *   allocations[] — sNo, documentLabel, date, amount
 *
 * Registered helpers only: fmt, fmtDate, fmtDec, nl2br, richText, inc, math,
 * eq, gt, or, join, emptyRows, plus built-ins #if/#unless/#each/@index.
 * Money is always right-aligned. Accent is blue/indigo (#0d47a1 / #e3f2fd)
 * to mark payments (money-out) apart from receipts.
 */

export const paymentStarters = [

  // ─── 1. Classic Serif (double-rule header) — DEFAULT ─────────────────────────
  {
    id: "payment-classic-serif",
    name: "Classic Serif",
    type: "Payment",
    description: "Traditional Times New Roman payment voucher with double-rule header, indigo amount box and three-way signatures",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 12mm; color: #000; font-size: 12pt; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #0d47a1; padding-bottom: 14px; margin-bottom: 16px; }
.brand { font-size: 30px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; color: #0d1b3a; }
.division { font-size: 12px; font-style: italic; color: #0d47a1; margin-top: 2px; }
.addr { font-size: 10px; color: #333; margin-top: 4px; line-height: 1.5; }
.tax { font-size: 10px; color: #444; margin-top: 3px; }
.tax span { margin-right: 14px; }
.voucher-block { text-align: right; }
.voucher-title { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid #0d47a1; padding-bottom: 4px; margin-bottom: 6px; color: #0d47a1; }
.voucher-ref { font-size: 20px; font-weight: 900; }
.voucher-date { font-size: 12px; margin-top: 4px; }
.paid-to { border: 1px solid #90a4c8; background: #e3f2fd !important; padding: 10px 14px; margin-bottom: 14px; }
.paid-to .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; color: #0d47a1; }
.paid-to .name { font-size: 16px; font-weight: 700; margin-top: 3px; }
.paid-to .meta { font-size: 10px; color: #333; margin-top: 3px; line-height: 1.5; }
.method-row { display: flex; flex-wrap: wrap; gap: 6px 26px; font-size: 11pt; margin-bottom: 14px; padding: 0 2px; }
.method-item b { font-weight: 700; }
.amount-box { display: flex; justify-content: space-between; align-items: center; border: 2px solid #0d47a1; background: #e3f2fd !important; padding: 12px 18px; margin-bottom: 14px; }
.amount-box .amt-lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; color: #0d47a1; }
.amount-box .amt-val { font-size: 30px; font-weight: 900; color: #0d1b3a; }
.words { font-size: 11pt; font-style: italic; margin-bottom: 16px; padding: 0 2px; }
.words b { font-style: normal; font-weight: 700; }
.settle-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; color: #0d47a1; margin-bottom: 4px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
th { background: #0d47a1 !important; color: #fff !important; font-family: "Times New Roman", serif; font-size: 11px; text-transform: uppercase; padding: 6px 10px; border: 1px solid #0d47a1; letter-spacing: 1px; }
th.c { text-align: center; } th.r { text-align: right; }
td { border: 1px solid #b0bec5; padding: 6px 10px; font-size: 12px; height: 26px; }
td.c { text-align: center; width: 44px; } td.r { text-align: right; width: 130px; }
td.dt { text-align: center; width: 110px; }
tbody tr:nth-child(even) td { background: #f2f6fc !important; }
tfoot td { font-weight: 700; background: #e3f2fd !important; border-top: 2px solid #0d47a1; }
.desc { font-size: 11pt; border-top: 1px solid #b0bec5; padding-top: 8px; margin-bottom: 20px; }
.desc .lbl { font-weight: 700; }
.footer { margin-top: 34px; display: flex; justify-content: space-between; padding: 0 14px; }
.sig { text-align: center; }
.sig .line { width: 160px; border-top: 1.5px solid #333; margin: 0 auto 4px; }
.sig .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:58px;margin-bottom:6px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
    {{#if (or companyNTN companySTRN)}}<div class="tax">{{#if companyNTN}}<span><b>NTN:</b> {{companyNTN}}</span>{{/if}}{{#if companySTRN}}<span><b>STRN:</b> {{companySTRN}}</span>{{/if}}</div>{{/if}}
  </div>
  <div class="voucher-block">
    <div class="voucher-title">Payment Voucher</div>
    <div class="voucher-ref">{{reference}}</div>
    <div class="voucher-date">Date: {{fmtDate date}}</div>
  </div>
</div>
<div class="paid-to">
  <div class="lbl">Paid To{{#if contactType}} ({{contactType}}){{/if}}</div>
  <div class="name">{{contactName}}</div>
  {{#if contactAddress}}<div class="meta">{{{nl2br contactAddress}}}</div>{{/if}}
  {{#if contactPhone}}<div class="meta">Phone: {{contactPhone}}</div>{{/if}}
</div>
<div class="method-row">
  {{#if method}}<div class="method-item"><b>Method:</b> {{method}}</div>{{/if}}
  {{#if bankAccountName}}<div class="method-item"><b>Bank / Account:</b> {{bankAccountName}}</div>{{/if}}
  {{#if chequeNumber}}<div class="method-item"><b>Cheque #:</b> {{chequeNumber}}</div>{{/if}}
  {{#if chequeDate}}<div class="method-item"><b>Cheque Date:</b> {{fmtDate chequeDate}}</div>{{/if}}
</div>
<div class="amount-box">
  <div class="amt-lbl">Amount Paid</div>
  <div class="amt-val">Rs {{fmt amount}}</div>
</div>
{{#if amountInWords}}<div class="words"><b>Amount in words:</b> {{amountInWords}}</div>{{/if}}
{{#if allocations.length}}
<div class="settle-title">Settled Against</div>
<table>
  <thead><tr><th class="c">S#</th><th>Document</th><th class="c">Date</th><th class="r">Amount</th></tr></thead>
  <tbody>
    {{#each allocations}}<tr><td class="c">{{inc @index}}</td><td>{{this.documentLabel}}</td><td class="dt">{{fmtDate this.date}}</td><td class="r">Rs {{fmt this.amount}}</td></tr>{{/each}}
  </tbody>
  <tfoot><tr><td colspan="3" class="r">Total Paid</td><td class="r">Rs {{fmt amount}}</td></tr></tfoot>
</table>
{{/if}}
{{#if description}}<div class="desc"><span class="lbl">Remarks:</span> {{{nl2br description}}}</div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Paid By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
</div>
</body></html>`,
  },

  // ─── 2. Modern Minimal (gradient accent rule + card strip) ───────────────────
  {
    id: "payment-modern-minimal",
    name: "Modern Minimal",
    type: "Payment",
    description: "Clean Segoe/Calibri sans layout with a thin indigo gradient accent rule, method card strip and large amount panel",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 13mm; color: #222; }
.accent-rule { height: 5px; background: linear-gradient(90deg, #0d47a1 0%, #5c6bc0 100%); border-radius: 3px; margin-bottom: 18px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
.brand { font-size: 26px; font-weight: 800; color: #0d47a1; letter-spacing: 0.5px; }
.division { font-size: 11px; color: #5c6bc0; font-weight: 600; margin-top: 2px; }
.sub { font-size: 10px; color: #666; margin-top: 3px; line-height: 1.5; }
.tax { font-size: 9px; color: #777; margin-top: 3px; }
.tax span { margin-right: 12px; }
.badge { background: #0d47a1 !important; color: #fff !important; padding: 5px 14px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; display: inline-block; }
.voucher-ref { font-size: 20px; font-weight: 800; color: #0d47a1; margin-top: 6px; text-align: right; }
.voucher-date { font-size: 11px; color: #777; text-align: right; margin-top: 2px; }
.strip { display: flex; gap: 12px; background: #eef2fb !important; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }
.cell { flex: 1; }
.cell-lbl { font-size: 8px; text-transform: uppercase; color: #8a94ad; font-weight: 700; letter-spacing: 0.6px; }
.cell-val { font-size: 13px; font-weight: 600; margin-top: 2px; color: #1a1a1a; }
.cell-sub { font-size: 9px; color: #888; margin-top: 2px; line-height: 1.5; }
.method-strip { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.chip { background: #f4f6fb !important; border: 1px solid #dbe2f2; border-radius: 20px; padding: 5px 14px; font-size: 11px; }
.chip b { color: #0d47a1; }
.amount-panel { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(90deg, #0d47a1 0%, #3f51b5 100%) !important; color: #fff !important; border-radius: 8px; padding: 16px 22px; margin-bottom: 8px; }
.amount-panel .p-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; opacity: 0.85; }
.amount-panel .p-val { font-size: 30px; font-weight: 800; }
.words { font-size: 11px; color: #555; font-style: italic; margin-bottom: 18px; padding-left: 2px; }
.words b { color: #0d47a1; font-style: normal; }
.settle-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; color: #0d47a1; margin-bottom: 5px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
th { background: #eef2fb !important; color: #444; font-size: 9px; text-transform: uppercase; padding: 7px 10px; border-bottom: 2px solid #0d47a1; text-align: left; letter-spacing: 0.4px; }
th.c { text-align: center; } th.r { text-align: right; }
td { padding: 7px 10px; font-size: 12px; border-bottom: 1px solid #edf0f5; }
td.c { text-align: center; width: 40px; } td.r { text-align: right; width: 120px; }
td.dt { text-align: center; width: 110px; }
tfoot td { font-weight: 700; color: #0d47a1; border-top: 2px solid #0d47a1; border-bottom: none; }
.desc { font-size: 11px; color: #555; border-top: 1px solid #e0e5ef; padding-top: 10px; margin-bottom: 20px; }
.desc b { color: #333; }
.footer { margin-top: 32px; display: flex; justify-content: space-between; padding: 0 8px; }
.sig { text-align: center; }
.sig .line { width: 160px; border-top: 2px solid #0d47a1; margin: 0 auto 4px; }
.sig .label { font-size: 9px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="accent-rule"></div>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:6px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="sub">{{{nl2br companyAddress}}}</div>
    <div class="sub">{{{nl2br companyPhone}}}</div>
    {{#if (or companyNTN companySTRN)}}<div class="tax">{{#if companyNTN}}<span>NTN: {{companyNTN}}</span>{{/if}}{{#if companySTRN}}<span>STRN: {{companySTRN}}</span>{{/if}}</div>{{/if}}
  </div>
  <div style="text-align:right">
    <div class="badge">PAYMENT VOUCHER</div>
    <div class="voucher-ref">{{reference}}</div>
    <div class="voucher-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="strip">
  <div class="cell"><div class="cell-lbl">Paid To{{#if contactType}} · {{contactType}}{{/if}}</div><div class="cell-val">{{contactName}}</div>{{#if contactPhone}}<div class="cell-sub">{{contactPhone}}</div>{{/if}}</div>
  {{#if contactAddress}}<div class="cell"><div class="cell-lbl">Address</div><div class="cell-sub" style="font-size:12px;color:#1a1a1a">{{{nl2br contactAddress}}}</div></div>{{/if}}
</div>
{{#if (or method (or bankAccountName (or chequeNumber chequeDate)))}}
<div class="method-strip">
  {{#if method}}<div class="chip"><b>Method:</b> {{method}}</div>{{/if}}
  {{#if bankAccountName}}<div class="chip"><b>Bank / Account:</b> {{bankAccountName}}</div>{{/if}}
  {{#if chequeNumber}}<div class="chip"><b>Cheque #:</b> {{chequeNumber}}</div>{{/if}}
  {{#if chequeDate}}<div class="chip"><b>Cheque Date:</b> {{fmtDate chequeDate}}</div>{{/if}}
</div>
{{/if}}
<div class="amount-panel">
  <div class="p-lbl">Amount Paid</div>
  <div class="p-val">Rs {{fmt amount}}</div>
</div>
{{#if amountInWords}}<div class="words"><b>Amount in words:</b> {{amountInWords}}</div>{{/if}}
{{#if allocations.length}}
<div class="settle-title">Settled Against</div>
<table>
  <thead><tr><th class="c">#</th><th>Document</th><th class="c">Date</th><th class="r">Amount</th></tr></thead>
  <tbody>
    {{#each allocations}}<tr><td class="c">{{inc @index}}</td><td>{{this.documentLabel}}</td><td class="dt">{{fmtDate this.date}}</td><td class="r">Rs {{fmt this.amount}}</td></tr>{{/each}}
  </tbody>
  <tfoot><tr><td colspan="3" class="r">Total Paid</td><td class="r">Rs {{fmt amount}}</td></tr></tfoot>
</table>
{{/if}}
{{#if description}}<div class="desc"><b>Remarks:</b> {{{nl2br description}}}</div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Paid By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
</div>
</body></html>`,
  },

  // ─── 3. Corporate Band (full-width indigo header, reversed white text) ───────
  {
    id: "payment-corporate-band",
    name: "Corporate Band",
    type: "Payment",
    description: "Full-width indigo header band with reversed white company name and voucher reference, boxed reference cells",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; color: #111; }
.header-band { background: #0d47a1 !important; color: #fff !important; padding: 16px 16mm; display: flex; justify-content: space-between; align-items: center; }
.hb-left { display: flex; align-items: center; gap: 14px; }
.hb-logo img { height: 56px; }
.hb-name { font-size: 26px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
.hb-division { font-size: 11px; opacity: 0.85; margin-top: 2px; }
.hb-addr { font-size: 9px; opacity: 0.8; margin-top: 4px; line-height: 1.5; }
.hb-tax { font-size: 9px; opacity: 0.8; margin-top: 3px; }
.hb-tax span { margin-right: 12px; }
.hb-right { text-align: right; }
.hb-title { font-size: 15px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; opacity: 0.9; }
.hb-ref { font-size: 24px; font-weight: 900; margin-top: 4px; }
.hb-date { font-size: 11px; opacity: 0.85; margin-top: 2px; }
.body { padding: 14px 16mm 14mm; }
.paid-to { display: flex; justify-content: space-between; align-items: flex-start; background: #e3f2fd !important; border-left: 5px solid #0d47a1; padding: 12px 16px; margin-bottom: 16px; }
.paid-to .pt-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; color: #0d47a1; }
.paid-to .pt-name { font-size: 17px; font-weight: 700; margin-top: 3px; }
.paid-to .pt-meta { font-size: 10px; color: #444; margin-top: 3px; line-height: 1.5; }
.ref-row { display: flex; margin-bottom: 16px; border: 1px solid #c8d4ea; border-radius: 4px; overflow: hidden; }
.ref-cell { flex: 1; padding: 9px 12px; border-right: 1px solid #c8d4ea; }
.ref-cell:last-child { border-right: none; }
.ref-lbl { font-size: 8px; text-transform: uppercase; color: #8a94ad; font-weight: 700; letter-spacing: 0.5px; }
.ref-val { font-size: 12px; font-weight: 600; margin-top: 3px; }
.amount-box { display: flex; justify-content: space-between; align-items: center; border: 2px solid #0d47a1; padding: 14px 20px; margin-bottom: 8px; }
.amount-box .a-lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; color: #0d47a1; }
.amount-box .a-val { font-size: 30px; font-weight: 900; color: #0d1b3a; }
.words { font-size: 11px; font-style: italic; color: #555; margin-bottom: 18px; }
.words b { color: #0d47a1; font-style: normal; }
.settle-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; color: #0d47a1; margin-bottom: 5px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
th { background: #0d47a1 !important; color: #fff !important; font-size: 10px; text-transform: uppercase; padding: 7px 10px; border: 1px solid #0d47a1; letter-spacing: 0.5px; }
th.c { text-align: center; } th.r { text-align: right; }
td { border: 1px solid #c8d4ea; padding: 6px 10px; font-size: 12px; height: 26px; }
td.c { text-align: center; width: 44px; } td.r { text-align: right; width: 130px; }
td.dt { text-align: center; width: 110px; }
tbody tr:nth-child(even) td { background: #eef3fb !important; }
tfoot td { font-weight: 700; background: #e3f2fd !important; }
.desc { font-size: 11px; color: #555; border-top: 1px solid #c8d4ea; padding-top: 10px; margin-bottom: 20px; }
.desc b { color: #0d47a1; }
.footer { margin-top: 32px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 170px; border-top: 2px solid #0d47a1; margin: 0 auto 5px; }
.sig .label { font-size: 9px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="header-band">
  <div class="hb-left">
    {{#if companyLogoPath}}<div class="hb-logo"><img src="{{companyLogoPath}}"></div>{{/if}}
    <div>
      <div class="hb-name">{{companyBrandName}}</div>
      <div class="hb-addr">{{{nl2br companyAddress}}}</div>
      <div class="hb-addr">{{{nl2br companyPhone}}}</div>
      {{#if (or companyNTN companySTRN)}}<div class="hb-tax">{{#if companyNTN}}<span>NTN: {{companyNTN}}</span>{{/if}}{{#if companySTRN}}<span>STRN: {{companySTRN}}</span>{{/if}}</div>{{/if}}
    </div>
  </div>
  <div class="hb-right">
    <div class="hb-title">Payment Voucher</div>
    <div class="hb-ref">{{reference}}</div>
    <div class="hb-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="body">
  <div class="paid-to">
    <div>
      <div class="pt-lbl">Paid To{{#if contactType}} ({{contactType}}){{/if}}</div>
      <div class="pt-name">{{contactName}}</div>
      {{#if contactAddress}}<div class="pt-meta">{{{nl2br contactAddress}}}</div>{{/if}}
      {{#if contactPhone}}<div class="pt-meta">Phone: {{contactPhone}}</div>{{/if}}
    </div>
  </div>
  {{#if (or method (or bankAccountName (or chequeNumber chequeDate)))}}
  <div class="ref-row">
    {{#if method}}<div class="ref-cell"><div class="ref-lbl">Method</div><div class="ref-val">{{method}}</div></div>{{/if}}
    {{#if bankAccountName}}<div class="ref-cell"><div class="ref-lbl">Bank / Account</div><div class="ref-val">{{bankAccountName}}</div></div>{{/if}}
    {{#if chequeNumber}}<div class="ref-cell"><div class="ref-lbl">Cheque #</div><div class="ref-val">{{chequeNumber}}</div></div>{{/if}}
    {{#if chequeDate}}<div class="ref-cell"><div class="ref-lbl">Cheque Date</div><div class="ref-val">{{fmtDate chequeDate}}</div></div>{{/if}}
  </div>
  {{/if}}
  <div class="amount-box">
    <div class="a-lbl">Amount Paid</div>
    <div class="a-val">Rs {{fmt amount}}</div>
  </div>
  {{#if amountInWords}}<div class="words"><b>Amount in words:</b> {{amountInWords}}</div>{{/if}}
  {{#if allocations.length}}
  <div class="settle-title">Settled Against</div>
  <table>
    <thead><tr><th class="c">S#</th><th>Document</th><th class="c">Date</th><th class="r">Amount</th></tr></thead>
    <tbody>
      {{#each allocations}}<tr><td class="c">{{inc @index}}</td><td>{{this.documentLabel}}</td><td class="dt">{{fmtDate this.date}}</td><td class="r">Rs {{fmt this.amount}}</td></tr>{{/each}}
    </tbody>
    <tfoot><tr><td colspan="3" class="r">Total Paid</td><td class="r">Rs {{fmt amount}}</td></tr></tfoot>
  </table>
  {{/if}}
  {{#if description}}<div class="desc"><b>Remarks:</b> {{{nl2br description}}}</div>{{/if}}
  <div class="footer">
    <div class="sig"><div class="line"></div><div class="label">Paid By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
    <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 4. Monochrome Ink-Saver (hairline borders, no fills) ────────────────────
  {
    id: "payment-monochrome-ink",
    name: "Monochrome Ink-Saver",
    type: "Payment",
    description: "Hairline black borders only, no fills, pure black-and-white payment voucher for minimum toner use",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, sans-serif; padding: 12mm; color: #000; font-size: 11pt; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #000; padding-bottom: 10px; margin-bottom: 12px; }
.brand { font-size: 20px; font-weight: 700; text-transform: uppercase; }
.division { font-size: 10px; margin-top: 2px; }
.addr { font-size: 9px; margin-top: 4px; line-height: 1.5; }
.tax { font-size: 9px; margin-top: 3px; }
.tax span { margin-right: 12px; }
.voucher-block { text-align: right; border: 1px solid #000; padding: 8px 12px; }
.voucher-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.voucher-ref { font-size: 18px; font-weight: 900; margin-top: 4px; }
.voucher-date { font-size: 10px; margin-top: 2px; }
.paid-to { border: 1px solid #000; padding: 8px 12px; margin-bottom: 12px; }
.paid-to .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
.paid-to .name { font-size: 15px; font-weight: 700; margin-top: 2px; }
.paid-to .meta { font-size: 9px; margin-top: 2px; line-height: 1.5; }
.method { margin-bottom: 12px; font-size: 10pt; }
.method-row { display: flex; }
.method-lbl { min-width: 130px; font-weight: 700; }
.amount-box { display: flex; justify-content: space-between; align-items: center; border: 2px solid #000; padding: 10px 16px; margin-bottom: 12px; }
.amount-box .a-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; }
.amount-box .a-val { font-size: 26px; font-weight: 900; }
.words { font-size: 10pt; font-style: italic; margin-bottom: 14px; }
.words b { font-style: normal; font-weight: 700; }
.settle-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; margin-bottom: 4px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
th { font-size: 9px; text-transform: uppercase; padding: 5px 8px; border: 1px solid #000; background: none !important; color: #000 !important; text-align: left; letter-spacing: 0.5px; }
th.c { text-align: center; } th.r { text-align: right; }
td { border: 1px solid #000; padding: 5px 8px; font-size: 10pt; height: 24px; }
td.c { text-align: center; width: 42px; } td.r { text-align: right; width: 120px; }
td.dt { text-align: center; width: 108px; }
tfoot td { font-weight: 700; }
.desc { font-size: 10pt; border-top: 1px solid #000; padding-top: 8px; margin-bottom: 18px; }
.desc .lbl { font-weight: 700; }
.footer { margin-top: 36px; display: flex; justify-content: space-between; padding: 0 14px; }
.sig { text-align: center; }
.sig .line { width: 160px; border-top: 1px solid #000; margin: 0 auto 4px; }
.sig .label { font-size: 8pt; text-transform: uppercase; }
</style></head><body>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:48px;margin-bottom:6px;display:block;filter:grayscale(100%)">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
    {{#if (or companyNTN companySTRN)}}<div class="tax">{{#if companyNTN}}<span>NTN: {{companyNTN}}</span>{{/if}}{{#if companySTRN}}<span>STRN: {{companySTRN}}</span>{{/if}}</div>{{/if}}
  </div>
  <div class="voucher-block">
    <div class="voucher-title">Payment Voucher</div>
    <div class="voucher-ref">{{reference}}</div>
    <div class="voucher-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="paid-to">
  <div class="lbl">Paid To{{#if contactType}} ({{contactType}}){{/if}}</div>
  <div class="name">{{contactName}}</div>
  {{#if contactAddress}}<div class="meta">{{{nl2br contactAddress}}}</div>{{/if}}
  {{#if contactPhone}}<div class="meta">Phone: {{contactPhone}}</div>{{/if}}
</div>
{{#if (or method (or bankAccountName (or chequeNumber chequeDate)))}}
<div class="method">
  {{#if method}}<div class="method-row"><span class="method-lbl">Method:</span><span>{{method}}</span></div>{{/if}}
  {{#if bankAccountName}}<div class="method-row"><span class="method-lbl">Bank / Account:</span><span>{{bankAccountName}}</span></div>{{/if}}
  {{#if chequeNumber}}<div class="method-row"><span class="method-lbl">Cheque #:</span><span>{{chequeNumber}}</span></div>{{/if}}
  {{#if chequeDate}}<div class="method-row"><span class="method-lbl">Cheque Date:</span><span>{{fmtDate chequeDate}}</span></div>{{/if}}
</div>
{{/if}}
<div class="amount-box">
  <div class="a-lbl">Amount Paid</div>
  <div class="a-val">Rs {{fmt amount}}</div>
</div>
{{#if amountInWords}}<div class="words"><b>Amount in words:</b> {{amountInWords}}</div>{{/if}}
{{#if allocations.length}}
<div class="settle-title">Settled Against</div>
<table>
  <thead><tr><th class="c">S#</th><th>Document</th><th class="c">Date</th><th class="r">Amount</th></tr></thead>
  <tbody>
    {{#each allocations}}<tr><td class="c">{{inc @index}}</td><td>{{this.documentLabel}}</td><td class="dt">{{fmtDate this.date}}</td><td class="r">Rs {{fmt this.amount}}</td></tr>{{/each}}
  </tbody>
  <tfoot><tr><td colspan="3" class="r">Total Paid</td><td class="r">Rs {{fmt amount}}</td></tr></tfoot>
</table>
{{/if}}
{{#if description}}<div class="desc"><span class="lbl">Remarks:</span> {{{nl2br description}}}</div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Paid By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
</div>
</body></html>`,
  },

];
