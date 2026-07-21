/**
 * Receipt Voucher starter templates — 4 distinct visual archetypes.
 * All templates are A4 print-ready, Handlebars-powered. A Receipt Voucher records
 * money the company RECEIVED (cash-in), optionally settling specific invoices/bills.
 * Merge fields: companyBrandName, companyLogoPath, companyAddress, companyPhone,
 * companyNTN, companySTRN, reference, date, contactType, contactName,
 * contactAddress, contactPhone, method, bankAccountName, chequeNumber, chequeDate,
 * description, amount, amountInWords,
 * allocations[] (sNo, documentLabel, date, amount).
 * Use only registered helpers: fmt, fmtDate, fmtDec, nl2br, richText, join,
 * emptyRows, math, inc, eq, gt, or, #each, #if, #unless.
 */

export const receiptStarters = [

  // ─── 1. Classic Serif (double-rule header) — DEFAULT ────────────────────────
  {
    id: "receipt-classic-serif",
    name: "Classic Serif",
    type: "Receipt",
    description: "Traditional Times New Roman layout with double-rule header, prominent amount box and settled-against table",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 12mm; color: #000; font-size: 12pt; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #333; padding-bottom: 14px; margin-bottom: 14px; }
.brand { font-size: 30px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; }
.addr { font-size: 10px; color: #333; margin-top: 4px; line-height: 1.5; }
.tax { font-size: 10px; color: #333; margin-top: 3px; }
.logo-wrap { margin-bottom: 6px; }
.rcv-block { text-align: right; }
.rcv-title { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 6px; }
.rcv-num { font-size: 22px; font-weight: 900; }
.rcv-date { font-size: 12px; margin-top: 4px; }
.from { margin: 8px 0 14px; padding: 10px 14px; border: 1px solid #999; }
.from-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #555; font-weight: 700; }
.from-name { font-size: 16px; font-weight: 700; margin-top: 3px; }
.from-sub { font-size: 11px; color: #333; margin-top: 3px; line-height: 1.5; }
.method { margin: 12px 0; font-size: 11pt; line-height: 1.9; }
.method b { min-width: 150px; display: inline-block; font-weight: 700; }
.amount-box { display: flex; justify-content: space-between; align-items: center; border: 2px solid #000; padding: 14px 18px; margin: 14px 0; }
.amount-lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; }
.amount-val { font-size: 30px; font-weight: 900; }
.words { font-size: 11pt; font-style: italic; margin: 6px 0 12px; border-bottom: 1px solid #999; padding-bottom: 8px; }
.words b { font-style: normal; font-weight: 700; }
.alloc-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin: 10px 0 6px; }
table { width: 100%; border-collapse: collapse; }
th { background: #2c3e50 !important; color: #fff !important; font-family: "Times New Roman", serif; font-size: 11px; text-transform: uppercase; padding: 6px 10px; border: 1px solid #2c3e50; letter-spacing: 1px; }
th.r { text-align: right; }
td { border: 1px solid #999; padding: 6px 10px; font-size: 12px; height: 26px; }
td.c { text-align: center; width: 40px; }
td.d { text-align: center; width: 110px; }
td.r { text-align: right; width: 130px; }
tbody tr:nth-child(even) td { background: #f5f5f5 !important; }
tfoot td { font-weight: 700; border-top: 2px solid #000; }
.desc { margin-top: 14px; font-size: 11pt; }
.desc b { font-weight: 700; }
.footer { margin-top: 40px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 1.5px solid #333; margin: 0 auto 4px; }
.sig .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="header">
  <div>
    <div class="logo-wrap">{{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px">{{/if}}</div>
    <div class="brand">{{companyBrandName}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;|&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{else}}{{#if companySTRN}}<div class="tax">STRN: {{companySTRN}}</div>{{/if}}{{/if}}
  </div>
  <div class="rcv-block">
    <div class="rcv-title">Receipt Voucher</div>
    <div class="rcv-num">{{reference}}</div>
    <div class="rcv-date">Date: {{fmtDate date}}</div>
  </div>
</div>
<div class="from">
  <div class="from-lbl">Received From{{#if contactType}} ({{contactType}}){{/if}}</div>
  <div class="from-name">{{contactName}}</div>
  {{#if contactAddress}}<div class="from-sub">{{{nl2br contactAddress}}}</div>{{/if}}
  {{#if contactPhone}}<div class="from-sub">Phone: {{contactPhone}}</div>{{/if}}
</div>
<div class="method">
  {{#if method}}<div><b>Payment Method:</b> {{method}}</div>{{/if}}
  {{#if bankAccountName}}<div><b>Bank / Account:</b> {{bankAccountName}}</div>{{/if}}
  {{#if chequeNumber}}<div><b>Cheque No:</b> {{chequeNumber}}</div>{{/if}}
  {{#if chequeDate}}<div><b>Cheque Date:</b> {{fmtDate chequeDate}}</div>{{/if}}
</div>
<div class="amount-box">
  <div class="amount-lbl">Amount Received</div>
  <div class="amount-val">Rs {{fmt amount}}</div>
</div>
<div class="words"><b>Amount in words:</b> {{amountInWords}}</div>
{{#if allocations.length}}
<div class="alloc-title">Settled Against</div>
<table>
  <thead><tr><th style="width:40px;text-align:center">S#</th><th>Document</th><th style="width:110px;text-align:center">Date</th><th class="r">Amount</th></tr></thead>
  <tbody>
    {{#each allocations}}<tr><td class="c">{{inc @index}}</td><td>{{this.documentLabel}}</td><td class="d">{{fmtDate this.date}}</td><td class="r">Rs {{fmt this.amount}}</td></tr>{{/each}}
  </tbody>
  <tfoot><tr><td colspan="3" style="text-align:right">Total Allocated</td><td class="r">Rs {{fmt amount}}</td></tr></tfoot>
</table>
{{/if}}
{{#if description}}<div class="desc"><b>Note:</b> {{{richText description}}}</div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
</div>
</body></html>`,
  },

  // ─── 2. Modern Minimal (green accent, card strip) ───────────────────────────
  {
    id: "receipt-modern-minimal",
    name: "Modern Minimal",
    type: "Receipt",
    description: "Clean sans-serif with a thin gradient accent rule, card info strip and green money-in highlight",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 13mm; color: #222; }
.accent-rule { height: 5px; background: linear-gradient(90deg, #1b7a3d 0%, #66bb6a 100%); border-radius: 3px; margin-bottom: 18px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
.brand { font-size: 26px; font-weight: 800; color: #1b7a3d; letter-spacing: 0.5px; }
.sub { font-size: 10px; color: #666; margin-top: 3px; line-height: 1.5; }
.tax { font-size: 9px; color: #888; margin-top: 3px; }
.badge { background: #1b7a3d !important; color: #fff !important; padding: 5px 14px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; display: inline-block; }
.rcv-num { font-size: 20px; font-weight: 800; color: #1b7a3d; margin-top: 6px; text-align: right; }
.rcv-date { font-size: 11px; color: #777; text-align: right; margin-top: 2px; }
.info-strip { display: flex; gap: 12px; background: #e8f5e9 !important; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }
.info-cell { flex: 1; }
.info-lbl { font-size: 8px; text-transform: uppercase; color: #4b8a5f; font-weight: 700; letter-spacing: 0.6px; }
.info-val { font-size: 13px; font-weight: 600; margin-top: 2px; color: #1a1a1a; }
.info-sub { font-size: 9px; color: #6b8f76; margin-top: 2px; }
.method-strip { display: flex; flex-wrap: wrap; gap: 6px 24px; padding: 10px 4px; margin-bottom: 14px; border-bottom: 1px solid #e0e5ef; font-size: 11px; }
.method-item .k { font-size: 8px; text-transform: uppercase; color: #999; font-weight: 700; letter-spacing: 0.5px; }
.method-item .v { font-size: 12px; font-weight: 600; margin-top: 1px; }
.money { display: flex; justify-content: space-between; align-items: center; background: #e8f5e9 !important; border: 1px solid #a5d6a7; border-left: 6px solid #1b7a3d; border-radius: 6px; padding: 16px 20px; margin-bottom: 8px; }
.money-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #1b7a3d; font-weight: 700; }
.money-val { font-size: 30px; font-weight: 800; color: #14672f; }
.words { font-size: 11px; font-style: italic; color: #555; margin-bottom: 16px; }
.words b { font-style: normal; color: #333; }
.alloc-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #1b7a3d; font-weight: 700; margin: 6px 0 6px; }
table { width: 100%; border-collapse: collapse; }
th { background: #f1f8f2 !important; color: #33684a; font-size: 9px; text-transform: uppercase; padding: 7px 10px; border-bottom: 2px solid #1b7a3d; text-align: left; letter-spacing: 0.4px; }
th.c { text-align: center; }
th.r { text-align: right; }
td { padding: 7px 10px; font-size: 12px; border-bottom: 1px solid #edf0f5; }
td.c { text-align: center; width: 36px; }
td.d { text-align: center; width: 110px; }
td.r { text-align: right; width: 130px; font-variant-numeric: tabular-nums; }
tfoot td { font-weight: 700; border-top: 2px solid #1b7a3d; color: #14672f; }
.desc { margin-top: 14px; font-size: 11px; color: #555; }
.desc b { color: #333; }
.footer { margin-top: 34px; display: flex; justify-content: space-between; padding: 0 10px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 2px solid #1b7a3d; margin: 0 auto 4px; }
.sig .label { font-size: 9px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="accent-rule"></div>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:6px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="sub">{{{nl2br companyAddress}}}</div>
    <div class="sub">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;|&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{else}}{{#if companySTRN}}<div class="tax">STRN: {{companySTRN}}</div>{{/if}}{{/if}}
  </div>
  <div style="text-align:right">
    <div class="badge">RECEIPT VOUCHER</div>
    <div class="rcv-num">{{reference}}</div>
    <div class="rcv-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="info-strip">
  <div class="info-cell"><div class="info-lbl">Received From{{#if contactType}} ({{contactType}}){{/if}}</div><div class="info-val">{{contactName}}</div>{{#if contactPhone}}<div class="info-sub">{{contactPhone}}</div>{{/if}}</div>
  {{#if contactAddress}}<div class="info-cell"><div class="info-lbl">Address</div><div class="info-val" style="font-size:11px;font-weight:500">{{{nl2br contactAddress}}}</div></div>{{/if}}
</div>
{{#if method}}
<div class="method-strip">
  {{#if method}}<div class="method-item"><div class="k">Method</div><div class="v">{{method}}</div></div>{{/if}}
  {{#if bankAccountName}}<div class="method-item"><div class="k">Bank / Account</div><div class="v">{{bankAccountName}}</div></div>{{/if}}
  {{#if chequeNumber}}<div class="method-item"><div class="k">Cheque No</div><div class="v">{{chequeNumber}}</div></div>{{/if}}
  {{#if chequeDate}}<div class="method-item"><div class="k">Cheque Date</div><div class="v">{{fmtDate chequeDate}}</div></div>{{/if}}
</div>
{{/if}}
<div class="money">
  <div class="money-lbl">Amount Received</div>
  <div class="money-val">Rs {{fmt amount}}</div>
</div>
<div class="words"><b>Amount in words:</b> {{amountInWords}}</div>
{{#if allocations.length}}
<div class="alloc-title">Settled Against</div>
<table>
  <thead><tr><th class="c">S#</th><th>Document</th><th class="c">Date</th><th class="r">Amount</th></tr></thead>
  <tbody>
    {{#each allocations}}<tr><td class="c">{{inc @index}}</td><td>{{this.documentLabel}}</td><td class="d">{{fmtDate this.date}}</td><td class="r">Rs {{fmt this.amount}}</td></tr>{{/each}}
  </tbody>
  <tfoot><tr><td colspan="3" style="text-align:right">Total Allocated</td><td class="r">Rs {{fmt amount}}</td></tr></tfoot>
</table>
{{/if}}
{{#if description}}<div class="desc"><b>Note:</b> {{{richText description}}}</div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
</div>
</body></html>`,
  },

  // ─── 3. Corporate Band (full-width green header) ────────────────────────────
  {
    id: "receipt-corporate-band",
    name: "Corporate Band",
    type: "Receipt",
    description: "Full-width green header band with white reversed company name and voucher number, money-in styling",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; color: #111; }
.header-band { background: #1b7a3d !important; color: #fff !important; padding: 16px 16mm; display: flex; justify-content: space-between; align-items: center; }
.hb-left { display: flex; align-items: center; gap: 14px; }
.hb-logo img { height: 56px; }
.hb-name { font-size: 26px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
.hb-addr { font-size: 9px; opacity: 0.85; margin-top: 4px; line-height: 1.5; }
.hb-tax { font-size: 9px; opacity: 0.85; margin-top: 3px; }
.hb-right { text-align: right; }
.hb-title { font-size: 15px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; opacity: 0.9; }
.hb-num { font-size: 24px; font-weight: 900; margin-top: 4px; }
.hb-date { font-size: 11px; opacity: 0.85; margin-top: 2px; }
.body { padding: 12px 16mm 16mm; }
.from-row { display: flex; gap: 0; margin: 14px 0; border: 1px solid #c3e0cc; border-radius: 4px; overflow: hidden; }
.from-cell { flex: 1; padding: 10px 14px; border-right: 1px solid #c3e0cc; }
.from-cell:last-child { border-right: none; }
.from-lbl { font-size: 8px; text-transform: uppercase; color: #4b8a5f; font-weight: 700; letter-spacing: 0.5px; }
.from-val { font-size: 13px; font-weight: 600; margin-top: 2px; }
.from-sub { font-size: 9px; color: #6b8f76; margin-top: 2px; }
.method-row { display: flex; flex-wrap: wrap; gap: 6px 26px; padding: 8px 2px 12px; font-size: 11px; }
.method-item .k { font-size: 8px; text-transform: uppercase; color: #888; font-weight: 700; letter-spacing: 0.5px; }
.method-item .v { font-size: 12px; font-weight: 600; margin-top: 1px; }
.money { display: flex; justify-content: space-between; align-items: center; background: #1b7a3d !important; color: #fff !important; border-radius: 6px; padding: 16px 22px; margin: 6px 0 8px; }
.money-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; opacity: 0.9; }
.money-val { font-size: 32px; font-weight: 900; }
.words { font-size: 11px; font-style: italic; color: #444; margin-bottom: 16px; }
.words b { font-style: normal; color: #222; }
.alloc-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #1b7a3d; font-weight: 700; margin: 6px 0 6px; }
table { width: 100%; border-collapse: collapse; }
th { background: #1b7a3d !important; color: #fff !important; font-size: 10px; text-transform: uppercase; padding: 7px 10px; border: 1px solid #1b7a3d; letter-spacing: 0.5px; text-align: left; }
th.c { text-align: center; }
th.r { text-align: right; }
td { border: 1px solid #c3e0cc; padding: 6px 10px; font-size: 12px; height: 26px; }
td.c { text-align: center; width: 40px; }
td.d { text-align: center; width: 110px; }
td.r { text-align: right; width: 130px; font-variant-numeric: tabular-nums; }
tbody tr:nth-child(even) td { background: #eef7f0 !important; }
tfoot td { font-weight: 700; background: #e8f5e9 !important; }
.desc { margin-top: 14px; font-size: 11px; color: #444; }
.desc b { color: #222; }
.footer { margin-top: 36px; display: flex; justify-content: space-between; padding: 0 30px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #1b7a3d; margin: 0 auto 5px; }
.sig .label { font-size: 9px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="header-band">
  <div class="hb-left">
    {{#if companyLogoPath}}<div class="hb-logo"><img src="{{companyLogoPath}}"></div>{{/if}}
    <div>
      <div class="hb-name">{{companyBrandName}}</div>
      <div class="hb-addr">{{{nl2br companyAddress}}}</div>
      <div class="hb-addr">{{{nl2br companyPhone}}}</div>
      {{#if companyNTN}}<div class="hb-tax">NTN: {{companyNTN}}{{#if companySTRN}} | STRN: {{companySTRN}}{{/if}}</div>{{else}}{{#if companySTRN}}<div class="hb-tax">STRN: {{companySTRN}}</div>{{/if}}{{/if}}
    </div>
  </div>
  <div class="hb-right">
    <div class="hb-title">Receipt Voucher</div>
    <div class="hb-num">{{reference}}</div>
    <div class="hb-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="body">
  <div class="from-row">
    <div class="from-cell"><div class="from-lbl">Received From{{#if contactType}} ({{contactType}}){{/if}}</div><div class="from-val">{{contactName}}</div>{{#if contactPhone}}<div class="from-sub">{{contactPhone}}</div>{{/if}}</div>
    {{#if contactAddress}}<div class="from-cell"><div class="from-lbl">Address</div><div class="from-val" style="font-size:11px;font-weight:500">{{{nl2br contactAddress}}}</div></div>{{/if}}
  </div>
  {{#if method}}
  <div class="method-row">
    {{#if method}}<div class="method-item"><div class="k">Method</div><div class="v">{{method}}</div></div>{{/if}}
    {{#if bankAccountName}}<div class="method-item"><div class="k">Bank / Account</div><div class="v">{{bankAccountName}}</div></div>{{/if}}
    {{#if chequeNumber}}<div class="method-item"><div class="k">Cheque No</div><div class="v">{{chequeNumber}}</div></div>{{/if}}
    {{#if chequeDate}}<div class="method-item"><div class="k">Cheque Date</div><div class="v">{{fmtDate chequeDate}}</div></div>{{/if}}
  </div>
  {{/if}}
  <div class="money">
    <div class="money-lbl">Amount Received</div>
    <div class="money-val">Rs {{fmt amount}}</div>
  </div>
  <div class="words"><b>Amount in words:</b> {{amountInWords}}</div>
  {{#if allocations.length}}
  <div class="alloc-title">Settled Against</div>
  <table>
    <thead><tr><th class="c">S#</th><th>Document</th><th class="c">Date</th><th class="r">Amount</th></tr></thead>
    <tbody>
      {{#each allocations}}<tr><td class="c">{{inc @index}}</td><td>{{this.documentLabel}}</td><td class="d">{{fmtDate this.date}}</td><td class="r">Rs {{fmt this.amount}}</td></tr>{{/each}}
    </tbody>
    <tfoot><tr><td colspan="3" style="text-align:right">Total Allocated</td><td class="r">Rs {{fmt amount}}</td></tr></tfoot>
  </table>
  {{/if}}
  {{#if description}}<div class="desc"><b>Note:</b> {{{richText description}}}</div>{{/if}}
  <div class="footer">
    <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 4. Monochrome Ink-Saver (hairline borders, no fills) ───────────────────
  {
    id: "receipt-monochrome-ink",
    name: "Monochrome Ink-Saver",
    type: "Receipt",
    description: "Hairline black borders only, no fills, pure black-and-white for minimum toner use",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, sans-serif; padding: 12mm; color: #000; font-size: 11pt; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #000; padding-bottom: 10px; margin-bottom: 12px; }
.brand { font-size: 20px; font-weight: 700; text-transform: uppercase; }
.addr { font-size: 9px; margin-top: 4px; line-height: 1.5; }
.tax { font-size: 9px; margin-top: 3px; }
.rcv-block { text-align: right; border: 1px solid #000; padding: 8px 12px; }
.rcv-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.rcv-num { font-size: 18px; font-weight: 900; margin-top: 4px; }
.rcv-date { font-size: 10px; margin-top: 2px; }
.from { margin: 10px 0; border: 1px solid #000; padding: 8px 12px; }
.from-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
.from-name { font-size: 15px; font-weight: 700; margin-top: 2px; }
.from-sub { font-size: 10px; margin-top: 2px; line-height: 1.5; }
.method { margin: 10px 0; font-size: 10pt; line-height: 1.9; }
.method-row { display: flex; }
.method-lbl { min-width: 140px; font-weight: 700; }
.amount-box { display: flex; justify-content: space-between; align-items: center; border: 2px solid #000; padding: 12px 16px; margin: 12px 0; }
.amount-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; }
.amount-val { font-size: 28px; font-weight: 900; }
.words { font-size: 10pt; font-style: italic; margin: 4px 0 12px; border-bottom: 1px solid #000; padding-bottom: 8px; }
.words b { font-style: normal; font-weight: 700; }
.alloc-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin: 10px 0 6px; }
table { width: 100%; border-collapse: collapse; }
th { font-size: 9px; text-transform: uppercase; padding: 5px 8px; border: 1px solid #000; background: none !important; color: #000 !important; text-align: left; letter-spacing: 0.5px; }
th.c { text-align: center; }
th.r { text-align: right; }
td { border: 1px solid #000; padding: 5px 8px; font-size: 10pt; height: 24px; }
td.c { text-align: center; width: 38px; }
td.d { text-align: center; width: 110px; }
td.r { text-align: right; width: 130px; font-variant-numeric: tabular-nums; }
tfoot td { font-weight: 700; }
.desc { margin-top: 12px; font-size: 10pt; }
.desc b { font-weight: 700; }
.footer { margin-top: 40px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 1px solid #000; margin: 0 auto 4px; }
.sig .label { font-size: 8pt; text-transform: uppercase; }
</style></head><body>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:6px;display:block;filter:grayscale(100%)">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="tax">NTN: {{companyNTN}}{{#if companySTRN}} | STRN: {{companySTRN}}{{/if}}</div>{{else}}{{#if companySTRN}}<div class="tax">STRN: {{companySTRN}}</div>{{/if}}{{/if}}
  </div>
  <div class="rcv-block">
    <div class="rcv-title">Receipt Voucher</div>
    <div class="rcv-num">{{reference}}</div>
    <div class="rcv-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="from">
  <div class="from-lbl">Received From{{#if contactType}} ({{contactType}}){{/if}}</div>
  <div class="from-name">{{contactName}}</div>
  {{#if contactAddress}}<div class="from-sub">{{{nl2br contactAddress}}}</div>{{/if}}
  {{#if contactPhone}}<div class="from-sub">Phone: {{contactPhone}}</div>{{/if}}
</div>
<div class="method">
  {{#if method}}<div class="method-row"><span class="method-lbl">Payment Method:</span><span>{{method}}</span></div>{{/if}}
  {{#if bankAccountName}}<div class="method-row"><span class="method-lbl">Bank / Account:</span><span>{{bankAccountName}}</span></div>{{/if}}
  {{#if chequeNumber}}<div class="method-row"><span class="method-lbl">Cheque No:</span><span>{{chequeNumber}}</span></div>{{/if}}
  {{#if chequeDate}}<div class="method-row"><span class="method-lbl">Cheque Date:</span><span>{{fmtDate chequeDate}}</span></div>{{/if}}
</div>
<div class="amount-box">
  <div class="amount-lbl">Amount Received</div>
  <div class="amount-val">Rs {{fmt amount}}</div>
</div>
<div class="words"><b>Amount in words:</b> {{amountInWords}}</div>
{{#if allocations.length}}
<div class="alloc-title">Settled Against</div>
<table>
  <thead><tr><th class="c">S#</th><th>Document</th><th class="c">Date</th><th class="r">Amount</th></tr></thead>
  <tbody>
    {{#each allocations}}<tr><td class="c">{{inc @index}}</td><td>{{this.documentLabel}}</td><td class="d">{{fmtDate this.date}}</td><td class="r">Rs {{fmt this.amount}}</td></tr>{{/each}}
  </tbody>
  <tfoot><tr><td colspan="3" style="text-align:right">Total Allocated</td><td class="r">Rs {{fmt amount}}</td></tr></tfoot>
</table>
{{/if}}
{{#if description}}<div class="desc"><b>Note:</b> {{{richText description}}}</div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Received By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
</div>
</body></html>`,
  },

];
