/**
 * Journal Voucher starter templates — 4 distinct professional archetypes.
 * All templates are A4 print-ready, Handlebars-powered, double-entry (debit/credit).
 * Merge fields: companyBrandName, companyLogoPath, companyAddress, companyPhone,
 * companyNTN, companySTRN, divisionName, divisionBrandName, divisionLogoPath,
 * divisionAddress, divisionPhone, divisionNTN, divisionSTRN, divisionEmail,
 * reference, entryNo, date, narration, totalDebit, totalCredit,
 * lines[] (sNo, accountCode, accountName, description, debit, credit).
 * Use only registered helpers: fmt, fmtDate, fmtDec, nl2br, richText, inc,
 * math, eq, gt, or, emptyRows, #each, #if, #unless.
 */

export const journalEntryStarters = [

  // ─── 1. Classic Serif (double-rule header, dark table head) — DEFAULT ────────
  {
    id: "journal-classic-serif",
    name: "Classic Serif",
    type: "JournalEntry",
    description: "Traditional Times New Roman voucher with double-rule header and dark ledger header row",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Journal Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 12mm; color: #000; font-size: 12pt; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #37474f; padding-bottom: 14px; margin-bottom: 14px; }
.brand { font-size: 30px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; }
.addr { font-size: 10px; color: #333; margin-top: 4px; line-height: 1.5; }
.tax { font-size: 10px; color: #555; margin-top: 3px; }
.jv-block { text-align: right; }
.jv-title { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 6px; }
.jv-ref { font-size: 20px; font-weight: 900; }
.jv-meta { font-size: 12px; margin-top: 4px; }
.info { margin: 10px 0 6px; font-size: 11pt; line-height: 1.7; }
.info b { font-weight: 700; min-width: 90px; display: inline-block; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th { background: #37474f !important; color: #fff !important; font-family: "Times New Roman", serif; font-size: 11px; text-transform: uppercase; padding: 6px 10px; border: 1px solid #37474f; letter-spacing: 1px; text-align: left; }
th.c { text-align: center; }
th.money { text-align: right; }
td { border: 1px solid #999; padding: 6px 10px; font-size: 12px; height: 26px; }
td.c { text-align: center; }
.n { text-align: center; width: 40px; }
.code { width: 90px; }
.money { text-align: right; width: 90px; }
tbody tr:nth-child(even) td { background: #f5f5f5 !important; }
tr.total td { background: #eceff1 !important; font-weight: 900; font-size: 12px; border-top: 2px solid #37474f; }
tr.total td.lbl { text-align: right; text-transform: uppercase; letter-spacing: 1px; }
.narration { margin-top: 16px; border: 1px solid #999; padding: 8px 12px; font-size: 11pt; }
.narration .lbl { font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; color: #37474f; display: block; margin-bottom: 4px; }
.footer { margin-top: 44px; display: flex; justify-content: space-between; padding: 0 10px; }
.sig { text-align: center; }
.sig .line { width: 170px; border-top: 1.5px solid #37474f; margin: 0 auto 4px; }
.sig .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px;margin-bottom:6px;display:block">{{/if}}
    <div class="brand">{{#if divisionBrandName}}{{divisionBrandName}}{{else}}{{companyBrandName}}{{/if}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="tax">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;|&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="jv-block">
    <div class="jv-title">Journal Voucher</div>
    <div class="jv-ref">{{#if reference}}{{reference}}{{else}}JV{{/if}}</div>
    {{#if entryNo}}<div class="jv-meta">Entry No: {{entryNo}}</div>{{/if}}
    <div class="jv-meta">Date: {{fmtDate date}}</div>
  </div>
</div>
{{#if divisionName}}<div class="info"><b>Division:</b> {{divisionName}}</div>{{/if}}
<table>
  <thead><tr><th class="c n">S#</th><th class="code">Account Code</th><th>Account</th><th>Description</th><th class="money">Debit</th><th class="money">Credit</th></tr></thead>
  <tbody>
    {{#each lines}}<tr><td class="c n">{{inc @index}}</td><td>{{this.accountCode}}</td><td>{{this.accountName}}</td><td>{{{richText this.description}}}</td><td class="money">{{#if this.debit}}{{fmt this.debit}}{{/if}}</td><td class="money">{{#if this.credit}}{{fmt this.credit}}{{/if}}</td></tr>{{/each}}
    {{emptyRows (math 10 "-" lines.length) 6}}
    <tr class="total"><td class="lbl" colspan="4">TOTAL</td><td class="money">Rs {{fmt totalDebit}}</td><td class="money">Rs {{fmt totalCredit}}</td></tr>
  </tbody>
</table>
{{#if narration}}<div class="narration"><span class="lbl">Narration</span>{{{nl2br narration}}}</div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Prepared By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Checked By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
</div>
</body></html>`,
  },

  // ─── 2. Modern Minimal (thin gradient accent rule) ───────────────────────────
  {
    id: "journal-modern-minimal",
    name: "Modern Minimal",
    type: "JournalEntry",
    description: "Clean sans-serif voucher with a thin gradient accent rule and card info strip",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Journal Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 13mm; color: #222; }
.accent-rule { height: 5px; background: linear-gradient(90deg, #37474f 0%, #78909c 100%); border-radius: 3px; margin-bottom: 18px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.brand { font-size: 26px; font-weight: 800; color: #37474f; letter-spacing: 0.5px; }
.sub { font-size: 10px; color: #666; margin-top: 3px; line-height: 1.5; }
.tax { font-size: 9px; color: #90a4ae; margin-top: 3px; }
.badge { background: #37474f !important; color: #fff !important; padding: 5px 14px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; display: inline-block; }
.jv-ref { font-size: 20px; font-weight: 800; color: #37474f; margin-top: 6px; text-align: right; }
.jv-meta { font-size: 11px; color: #777; text-align: right; margin-top: 2px; }
.info-strip { display: flex; gap: 12px; background: #eceff1 !important; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; }
.info-cell { flex: 1; }
.info-lbl { font-size: 8px; text-transform: uppercase; color: #90a4ae; font-weight: 700; letter-spacing: 0.6px; }
.info-val { font-size: 12px; font-weight: 600; margin-top: 2px; color: #1a1a1a; }
table { width: 100%; border-collapse: collapse; }
th { background: #f0f2f4 !important; color: #455a64; font-size: 9px; text-transform: uppercase; padding: 8px 10px; border-bottom: 2px solid #37474f; text-align: left; letter-spacing: 0.4px; }
th.c { text-align: center; }
th.money { text-align: right; }
td { padding: 7px 10px; font-size: 12px; border-bottom: 1px solid #eceff1; }
td.c { text-align: center; }
.n { width: 36px; }
.code { width: 84px; }
.money { text-align: right; width: 90px; }
tr.total td { border-top: 2px solid #37474f; border-bottom: none; font-weight: 800; color: #37474f; font-size: 12px; padding-top: 9px; }
tr.total td.lbl { text-align: right; text-transform: uppercase; letter-spacing: 1px; }
.narration { margin-top: 18px; background: #eceff1 !important; border-radius: 6px; padding: 10px 14px; font-size: 11px; color: #37474f; }
.narration .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; color: #90a4ae; display: block; margin-bottom: 3px; }
.footer { margin-top: 40px; display: flex; justify-content: space-between; padding: 0 6px; }
.sig { text-align: center; }
.sig .line { width: 170px; border-top: 2px solid #37474f; margin: 0 auto 4px; }
.sig .label { font-size: 9px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="accent-rule"></div>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:6px;display:block">{{/if}}
    <div class="brand">{{#if divisionBrandName}}{{divisionBrandName}}{{else}}{{companyBrandName}}{{/if}}</div>
    <div class="sub">{{{nl2br companyAddress}}}</div>
    <div class="sub">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="tax">NTN {{companyNTN}}{{#if companySTRN}} &middot; STRN {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div style="text-align:right">
    <div class="badge">JOURNAL VOUCHER</div>
    <div class="jv-ref">{{#if reference}}{{reference}}{{else}}JV{{/if}}</div>
    <div class="jv-meta">{{fmtDate date}}</div>
    {{#if entryNo}}<div class="jv-meta">Entry No: {{entryNo}}</div>{{/if}}
  </div>
</div>
<div class="info-strip">
  {{#if entryNo}}<div class="info-cell"><div class="info-lbl">Entry No</div><div class="info-val">{{entryNo}}</div></div>{{/if}}
  <div class="info-cell"><div class="info-lbl">Reference</div><div class="info-val">{{#if reference}}{{reference}}{{else}}&mdash;{{/if}}</div></div>
  <div class="info-cell"><div class="info-lbl">Date</div><div class="info-val">{{fmtDate date}}</div></div>
  {{#if divisionName}}<div class="info-cell"><div class="info-lbl">Division</div><div class="info-val">{{divisionName}}</div></div>{{/if}}
</div>
<table>
  <thead><tr><th class="c n">#</th><th class="code">Code</th><th>Account</th><th>Description</th><th class="money">Debit</th><th class="money">Credit</th></tr></thead>
  <tbody>
    {{#each lines}}<tr><td class="c n">{{inc @index}}</td><td>{{this.accountCode}}</td><td>{{this.accountName}}</td><td>{{{richText this.description}}}</td><td class="money">{{#if this.debit}}{{fmt this.debit}}{{/if}}</td><td class="money">{{#if this.credit}}{{fmt this.credit}}{{/if}}</td></tr>{{/each}}
    {{emptyRows (math 10 "-" lines.length) 6}}
    <tr class="total"><td class="lbl" colspan="4">TOTAL</td><td class="money">Rs {{fmt totalDebit}}</td><td class="money">Rs {{fmt totalCredit}}</td></tr>
  </tbody>
</table>
{{#if narration}}<div class="narration"><span class="lbl">Narration</span>{{{nl2br narration}}}</div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Prepared By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Checked By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
</div>
</body></html>`,
  },

  // ─── 3. Corporate Band (full-width colored header, reversed white text) ───────
  {
    id: "journal-corporate-band",
    name: "Corporate Band",
    type: "JournalEntry",
    description: "Full-width slate header band with white reversed company name and voucher reference",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Journal Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; color: #111; }
.header-band { background: #37474f !important; color: #fff !important; padding: 16px 16mm; display: flex; justify-content: space-between; align-items: center; }
.hb-left { display: flex; align-items: center; gap: 14px; }
.hb-logo img { height: 56px; }
.hb-name { font-size: 26px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
.hb-addr { font-size: 9px; opacity: 0.85; margin-top: 4px; line-height: 1.5; }
.hb-tax { font-size: 9px; opacity: 0.7; margin-top: 3px; }
.hb-right { text-align: right; }
.hb-title { font-size: 15px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; opacity: 0.85; }
.hb-ref { font-size: 24px; font-weight: 900; margin-top: 4px; }
.hb-meta { font-size: 11px; opacity: 0.85; margin-top: 2px; }
.body { padding: 12px 16mm 14mm; }
.ref-row { display: flex; gap: 0; margin: 14px 0; border: 1px solid #cfd8dc; border-radius: 4px; overflow: hidden; }
.ref-cell { flex: 1; padding: 8px 12px; border-right: 1px solid #cfd8dc; }
.ref-cell:last-child { border-right: none; }
.ref-lbl { font-size: 8px; text-transform: uppercase; color: #90a4ae; font-weight: 700; letter-spacing: 0.5px; }
.ref-val { font-size: 12px; font-weight: 600; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th { background: #37474f !important; color: #fff !important; font-size: 10px; text-transform: uppercase; padding: 8px 10px; border: 1px solid #37474f; letter-spacing: 0.5px; text-align: left; }
th.c { text-align: center; }
th.money { text-align: right; }
td { border: 1px solid #cfd8dc; padding: 6px 10px; font-size: 12px; height: 26px; }
td.c { text-align: center; }
.n { text-align: center; width: 38px; }
.code { width: 90px; }
.money { text-align: right; width: 90px; }
tbody tr:nth-child(even) td { background: #eceff1 !important; }
tr.total td { background: #37474f !important; color: #fff !important; font-weight: 800; font-size: 12px; }
tr.total td.lbl { text-align: right; text-transform: uppercase; letter-spacing: 1px; }
.narration { margin-top: 16px; border-left: 4px solid #37474f; background: #eceff1 !important; padding: 10px 14px; font-size: 11px; }
.narration .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; color: #607d8b; display: block; margin-bottom: 3px; }
.footer { margin-top: 42px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 180px; border-top: 2px solid #37474f; margin: 0 auto 5px; }
.sig .label { font-size: 9px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="header-band">
  <div class="hb-left">
    {{#if companyLogoPath}}<div class="hb-logo"><img src="{{companyLogoPath}}"></div>{{/if}}
    <div>
      <div class="hb-name">{{#if divisionBrandName}}{{divisionBrandName}}{{else}}{{companyBrandName}}{{/if}}</div>
      <div class="hb-addr">{{{nl2br companyAddress}}}</div>
      <div class="hb-addr">{{{nl2br companyPhone}}}</div>
      {{#if companyNTN}}<div class="hb-tax">NTN {{companyNTN}}{{#if companySTRN}} &middot; STRN {{companySTRN}}{{/if}}</div>{{/if}}
    </div>
  </div>
  <div class="hb-right">
    <div class="hb-title">Journal Voucher</div>
    <div class="hb-ref">{{#if reference}}{{reference}}{{else}}JV{{/if}}</div>
    <div class="hb-meta">{{fmtDate date}}</div>
  </div>
</div>
<div class="body">
  <div class="ref-row">
    {{#if entryNo}}<div class="ref-cell"><div class="ref-lbl">Entry No</div><div class="ref-val">{{entryNo}}</div></div>{{/if}}
    <div class="ref-cell"><div class="ref-lbl">Reference</div><div class="ref-val">{{#if reference}}{{reference}}{{else}}&mdash;{{/if}}</div></div>
    <div class="ref-cell"><div class="ref-lbl">Date</div><div class="ref-val">{{fmtDate date}}</div></div>
    {{#if divisionName}}<div class="ref-cell"><div class="ref-lbl">Division</div><div class="ref-val">{{divisionName}}</div></div>{{/if}}
  </div>
  <table>
    <thead><tr><th class="c n">S#</th><th class="code">Account Code</th><th>Account</th><th>Description</th><th class="money">Debit</th><th class="money">Credit</th></tr></thead>
    <tbody>
      {{#each lines}}<tr><td class="c n">{{inc @index}}</td><td>{{this.accountCode}}</td><td>{{this.accountName}}</td><td>{{{richText this.description}}}</td><td class="money">{{#if this.debit}}{{fmt this.debit}}{{/if}}</td><td class="money">{{#if this.credit}}{{fmt this.credit}}{{/if}}</td></tr>{{/each}}
      {{emptyRows (math 10 "-" lines.length) 6}}
      <tr class="total"><td class="lbl" colspan="4">TOTAL</td><td class="money">Rs {{fmt totalDebit}}</td><td class="money">Rs {{fmt totalCredit}}</td></tr>
    </tbody>
  </table>
  {{#if narration}}<div class="narration"><span class="lbl">Narration</span>{{{nl2br narration}}}</div>{{/if}}
  <div class="footer">
    <div class="sig"><div class="line"></div><div class="label">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Checked By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 4. Monochrome Ink-Saver (hairline black borders, no fills) ──────────────
  {
    id: "journal-monochrome-ink",
    name: "Monochrome Ink-Saver",
    type: "JournalEntry",
    description: "Hairline black borders only, no fills, pure black-and-white for minimum toner use",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Journal Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, sans-serif; padding: 12mm; color: #000; font-size: 11pt; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #000; padding-bottom: 10px; margin-bottom: 12px; }
.brand { font-size: 20px; font-weight: 700; text-transform: uppercase; }
.addr { font-size: 9px; margin-top: 4px; line-height: 1.5; }
.tax { font-size: 9px; margin-top: 3px; }
.jv-block { text-align: right; border: 1px solid #000; padding: 8px 12px; }
.jv-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.jv-ref { font-size: 18px; font-weight: 900; margin-top: 4px; }
.jv-meta { font-size: 10px; margin-top: 2px; }
.info { margin: 10px 0; font-size: 10pt; line-height: 1.7; }
.info-row { display: flex; }
.info-lbl { min-width: 110px; font-weight: 700; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th { font-size: 9px; text-transform: uppercase; padding: 5px 8px; border: 1px solid #000; background: none !important; color: #000 !important; text-align: left; letter-spacing: 0.5px; }
th.c { text-align: center; }
th.money { text-align: right; }
td { border: 1px solid #000; padding: 5px 8px; font-size: 10pt; height: 24px; }
td.c { text-align: center; }
.n { text-align: center; width: 36px; }
.code { width: 84px; }
.money { text-align: right; width: 90px; }
tr.total td { font-weight: 900; border: 1px solid #000; }
tr.total td.lbl { text-align: right; text-transform: uppercase; letter-spacing: 1px; }
.narration { margin-top: 14px; border: 1px solid #000; padding: 8px 10px; font-size: 10pt; }
.narration .lbl { font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 1px; display: block; margin-bottom: 3px; }
.footer { margin-top: 44px; display: flex; justify-content: space-between; padding: 0 10px; }
.sig { text-align: center; }
.sig .line { width: 170px; border-top: 1px solid #000; margin: 0 auto 4px; }
.sig .label { font-size: 8pt; text-transform: uppercase; }
</style></head><body>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:6px;display:block;filter:grayscale(100%)">{{/if}}
    <div class="brand">{{#if divisionBrandName}}{{divisionBrandName}}{{else}}{{companyBrandName}}{{/if}}</div>
    <div class="addr">{{{nl2br companyAddress}}}</div>
    <div class="addr">{{{nl2br companyPhone}}}</div>
    {{#if companyNTN}}<div class="tax">NTN: {{companyNTN}}{{#if companySTRN}} | STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="jv-block">
    <div class="jv-title">Journal Voucher</div>
    <div class="jv-ref">{{#if reference}}{{reference}}{{else}}JV{{/if}}</div>
    {{#if entryNo}}<div class="jv-meta">Entry No: {{entryNo}}</div>{{/if}}
    <div class="jv-meta">{{fmtDate date}}</div>
  </div>
</div>
<div class="info">
  {{#if entryNo}}<div class="info-row"><span class="info-lbl">Entry No:</span><span>{{entryNo}}</span></div>{{/if}}
  <div class="info-row"><span class="info-lbl">Reference:</span><span>{{#if reference}}{{reference}}{{else}}&mdash;{{/if}}</span></div>
  <div class="info-row"><span class="info-lbl">Date:</span><span>{{fmtDate date}}</span></div>
  {{#if divisionName}}<div class="info-row"><span class="info-lbl">Division:</span><span>{{divisionName}}</span></div>{{/if}}
</div>
<table>
  <thead><tr><th class="c n">S#</th><th class="code">Account Code</th><th>Account</th><th>Description</th><th class="money">Debit</th><th class="money">Credit</th></tr></thead>
  <tbody>
    {{#each lines}}<tr><td class="c n">{{inc @index}}</td><td>{{this.accountCode}}</td><td>{{this.accountName}}</td><td>{{{richText this.description}}}</td><td class="money">{{#if this.debit}}{{fmt this.debit}}{{/if}}</td><td class="money">{{#if this.credit}}{{fmt this.credit}}{{/if}}</td></tr>{{/each}}
    {{emptyRows (math 10 "-" lines.length) 6}}
    <tr class="total"><td class="lbl" colspan="4">TOTAL</td><td class="money">Rs {{fmt totalDebit}}</td><td class="money">Rs {{fmt totalCredit}}</td></tr>
  </tbody>
</table>
{{#if narration}}<div class="narration"><span class="lbl">Narration</span>{{{nl2br narration}}}</div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Prepared By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Checked By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
</div>
</body></html>`,
  },

];
