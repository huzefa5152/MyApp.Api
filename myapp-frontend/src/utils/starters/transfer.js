/**
 * Fund Transfer Voucher starter templates — 4 distinct visual archetypes.
 * All templates are A4 print-ready, Handlebars-powered. A fund transfer records
 * money moved between two of the company's own bank/cash accounts — there is NO
 * customer/supplier and NO line items.
 * Merge fields: companyBrandName, companyLogoPath, companyAddress, companyPhone,
 * companyNTN, companySTRN, divisionName, divisionBrandName, divisionLogoPath,
 * divisionAddress, divisionPhone, divisionNTN, divisionSTRN, divisionEmail,
 * reference, date, fromAccountName, toAccountName, description, amount, amountInWords.
 * Use only registered helpers: fmt, fmtDate, fmtDec, nl2br, richText, inc, math,
 * eq, gt, or, #if, #unless.
 */

export const transferStarters = [

  // ─── 1. Classic Serif (double-rule header, teal accent) ─────────────────────
  {
    id: "transfer-classic-serif",
    name: "Classic Serif",
    type: "Transfer",
    description: "Traditional Times New Roman layout with double-rule header, framed From/To panel and highlighted amount box",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Fund Transfer Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 14mm; color: #000; font-size: 12pt; }
.outer-border { border: 2px solid #00695c; padding: 10px; }
.inner-border { border: 1px solid #00695c; padding: 14px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #00695c; padding-bottom: 14px; margin-bottom: 16px; }
.brand { font-size: 30px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; color: #004d40; }
.division { font-size: 11px; color: #00695c; margin-top: 2px; font-style: italic; }
.addr { font-size: 10px; color: #333; margin-top: 4px; line-height: 1.5; }
.meta { font-size: 9px; color: #555; margin-top: 3px; }
.logo-wrap { margin-bottom: 6px; }
.v-block { text-align: right; }
.v-title { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #004d40; border-bottom: 1px solid #00695c; padding-bottom: 4px; margin-bottom: 6px; }
.v-ref { font-size: 20px; font-weight: 900; }
.v-date { font-size: 12px; margin-top: 4px; }
.flow { display: flex; align-items: stretch; margin: 6px 0 18px; }
.acc-box { flex: 1; border: 1px solid #00695c; padding: 12px 14px; }
.acc-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #00695c; font-weight: 700; }
.acc-name { font-size: 15px; font-weight: 700; margin-top: 6px; line-height: 1.35; }
.flow-arrow { display: flex; align-items: center; justify-content: center; width: 54px; font-size: 26px; color: #00695c; font-weight: 900; }
.amount-box { border: 2px solid #00695c; background: #e0f2f1 !important; padding: 14px 18px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
.amount-lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: #004d40; font-weight: 700; }
.amount-val { font-size: 30px; font-weight: 900; color: #004d40; }
.words { font-size: 11pt; font-style: italic; margin-bottom: 16px; border-bottom: 1px solid #999; padding-bottom: 8px; }
.words b { font-style: normal; font-weight: 700; }
.remarks { font-size: 11pt; line-height: 1.6; margin-bottom: 10px; }
.remarks .lbl { font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; color: #555; display: block; margin-bottom: 3px; }
.footer { margin-top: 46px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 1.5px solid #333; margin: 0 auto 4px; }
.sig .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="outer-border"><div class="inner-border">
<div class="header">
  <div>
    <div class="logo-wrap">{{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:60px">{{/if}}</div>
    <div class="brand">{{companyBrandName}}</div>
    {{#if divisionName}}<div class="division">{{divisionName}}</div>{{/if}}
    {{#if companyAddress}}<div class="addr">{{{nl2br companyAddress}}}</div>{{/if}}
    {{#if companyPhone}}<div class="addr">{{{nl2br companyPhone}}}</div>{{/if}}
    {{#if companyNTN}}<div class="meta">NTN: {{companyNTN}}{{#if companySTRN}} &nbsp;|&nbsp; STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="v-block">
    <div class="v-title">Fund Transfer Voucher</div>
    <div class="v-ref">{{reference}}</div>
    <div class="v-date">Date: {{fmtDate date}}</div>
  </div>
</div>
<div class="flow">
  <div class="acc-box"><div class="acc-lbl">From Account</div><div class="acc-name">{{fromAccountName}}</div></div>
  <div class="flow-arrow">&#8594;</div>
  <div class="acc-box"><div class="acc-lbl">To Account</div><div class="acc-name">{{toAccountName}}</div></div>
</div>
<div class="amount-box">
  <div class="amount-lbl">Amount Transferred</div>
  <div class="amount-val">Rs {{fmt amount}}</div>
</div>
{{#if amountInWords}}<div class="words"><b>Amount in words:</b> {{amountInWords}}</div>{{/if}}
{{#if description}}<div class="remarks"><span class="lbl">Remarks</span>{{{richText description}}}</div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Prepared By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
</div>
</div></div>
</body></html>`,
  },

  // ─── 2. Modern Minimal (gradient accent, two cards + central arrow) ──────────
  {
    id: "transfer-modern-minimal",
    name: "Modern Minimal",
    type: "Transfer",
    description: "Clean sans-serif with a thin teal-to-purple gradient accent rule and From/To as two cards with a central arrow",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inter-Account Transfer {{reference}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 14mm; color: #222; }
.accent-rule { height: 5px; background: linear-gradient(90deg, #00695c 0%, #4527a0 100%); border-radius: 3px; margin-bottom: 20px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; }
.brand { font-size: 26px; font-weight: 800; color: #00695c; letter-spacing: 0.5px; }
.division { font-size: 11px; color: #4527a0; font-weight: 600; margin-top: 2px; }
.sub { font-size: 10px; color: #666; margin-top: 3px; line-height: 1.5; }
.badge { background: linear-gradient(90deg, #00695c 0%, #4527a0 100%) !important; color: #fff !important; padding: 5px 14px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; display: inline-block; }
.v-ref { font-size: 20px; font-weight: 800; color: #4527a0; margin-top: 8px; text-align: right; }
.v-date { font-size: 11px; color: #777; text-align: right; margin-top: 2px; }
.cards { display: flex; align-items: center; gap: 0; margin: 6px 0 22px; }
.card { flex: 1; background: #f5f4fb !important; border: 1px solid #e2def2; border-radius: 8px; padding: 16px 18px; }
.card.from { border-top: 3px solid #00695c; }
.card.to { border-top: 3px solid #4527a0; }
.card-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888; font-weight: 700; }
.card-name { font-size: 16px; font-weight: 700; margin-top: 6px; color: #1a1a1a; line-height: 1.35; }
.arrow-hub { width: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.arrow-circle { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #00695c 0%, #4527a0 100%) !important; color: #fff !important; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 900; }
.arrow-txt { font-size: 7px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-top: 5px; }
.amount-box { background: #00695c !important; color: #fff !important; border-radius: 8px; padding: 18px 22px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.amount-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; opacity: 0.85; }
.amount-val { font-size: 32px; font-weight: 800; }
.words { font-size: 11px; color: #555; font-style: italic; margin-bottom: 18px; padding: 0 4px; }
.words b { font-style: normal; color: #4527a0; }
.remarks { background: #faf9fe !important; border-left: 3px solid #4527a0; border-radius: 0 6px 6px 0; padding: 12px 16px; margin-bottom: 12px; }
.remarks .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #4527a0; font-weight: 700; display: block; margin-bottom: 4px; }
.remarks .body { font-size: 12px; color: #333; line-height: 1.55; }
.footer { margin-top: 44px; display: flex; justify-content: space-between; padding: 0 10px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 2px solid #00695c; margin: 0 auto 4px; }
.sig .label { font-size: 9px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="accent-rule"></div>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:8px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    {{#if divisionName}}<div class="division">{{divisionName}}</div>{{/if}}
    {{#if companyAddress}}<div class="sub">{{{nl2br companyAddress}}}</div>{{/if}}
    {{#if companyPhone}}<div class="sub">{{{nl2br companyPhone}}}</div>{{/if}}
  </div>
  <div style="text-align:right">
    <div class="badge">INTER-ACCOUNT TRANSFER</div>
    <div class="v-ref">{{reference}}</div>
    <div class="v-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="cards">
  <div class="card from"><div class="card-lbl">From Account</div><div class="card-name">{{fromAccountName}}</div></div>
  <div class="arrow-hub"><div class="arrow-circle">&#8594;</div><div class="arrow-txt">Transferred</div></div>
  <div class="card to"><div class="card-lbl">To Account</div><div class="card-name">{{toAccountName}}</div></div>
</div>
<div class="amount-box">
  <div class="amount-lbl">Amount Transferred</div>
  <div class="amount-val">Rs {{fmt amount}}</div>
</div>
{{#if amountInWords}}<div class="words"><b>Amount in words:</b> {{amountInWords}}</div>{{/if}}
{{#if description}}<div class="remarks"><span class="lbl">Remarks</span><div class="body">{{{richText description}}}</div></div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Prepared By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
</div>
</body></html>`,
  },

  // ─── 3. Corporate Band (full-width purple header, reversed white) ────────────
  {
    id: "transfer-corporate-band",
    name: "Corporate Band",
    type: "Transfer",
    description: "Full-width purple header band with white reversed company name and voucher reference, framed From/To row and bold amount panel",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Fund Transfer Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 0; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, Arial, sans-serif; color: #111; }
.header-band { background: #4527a0 !important; color: #fff !important; padding: 16px 16mm; display: flex; justify-content: space-between; align-items: center; }
.hb-left { display: flex; align-items: center; gap: 14px; }
.hb-logo img { height: 56px; }
.hb-name { font-size: 26px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
.hb-division { font-size: 11px; opacity: 0.85; margin-top: 2px; }
.hb-addr { font-size: 9px; opacity: 0.8; margin-top: 4px; line-height: 1.5; }
.hb-right { text-align: right; }
.hb-title { font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; opacity: 0.85; }
.hb-ref { font-size: 24px; font-weight: 900; margin-top: 4px; }
.hb-date { font-size: 11px; opacity: 0.85; margin-top: 2px; }
.body { padding: 16px 16mm 16mm; }
.flow-row { display: flex; margin: 6px 0 18px; border: 1px solid #d7cff0; border-radius: 6px; overflow: hidden; }
.flow-cell { flex: 1; padding: 14px 16px; }
.flow-cell.from { background: #f4f1fb !important; }
.flow-cell.to { background: #ede8f8 !important; }
.flow-mid { width: 56px; display: flex; align-items: center; justify-content: center; background: #4527a0 !important; color: #fff !important; font-size: 24px; font-weight: 900; }
.flow-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #4527a0; font-weight: 700; }
.flow-name { font-size: 16px; font-weight: 700; margin-top: 6px; line-height: 1.35; }
.amount-panel { background: #ede8f8 !important; border: 2px solid #4527a0; border-radius: 6px; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.amount-lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: #4527a0; font-weight: 700; }
.amount-val { font-size: 32px; font-weight: 900; color: #311b7a; }
.words { font-size: 11px; font-style: italic; color: #444; margin-bottom: 18px; }
.words b { font-style: normal; color: #4527a0; }
.remarks { border: 1px solid #d7cff0; border-radius: 6px; padding: 12px 16px; margin-bottom: 12px; }
.remarks .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #4527a0; font-weight: 700; display: block; margin-bottom: 4px; }
.remarks .body { font-size: 12px; color: #333; line-height: 1.55; }
.footer { margin-top: 42px; display: flex; justify-content: space-between; padding: 0 24px; }
.sig { text-align: center; }
.sig .line { width: 200px; border-top: 2px solid #4527a0; margin: 0 auto 5px; }
.sig .label { font-size: 9px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="header-band">
  <div class="hb-left">
    {{#if companyLogoPath}}<div class="hb-logo"><img src="{{companyLogoPath}}"></div>{{/if}}
    <div>
      <div class="hb-name">{{companyBrandName}}</div>
      {{#if divisionName}}<div class="hb-division">{{divisionName}}</div>{{/if}}
      {{#if companyAddress}}<div class="hb-addr">{{{nl2br companyAddress}}}</div>{{/if}}
      {{#if companyPhone}}<div class="hb-addr">{{{nl2br companyPhone}}}</div>{{/if}}
    </div>
  </div>
  <div class="hb-right">
    <div class="hb-title">Fund Transfer Voucher</div>
    <div class="hb-ref">{{reference}}</div>
    <div class="hb-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="body">
  <div class="flow-row">
    <div class="flow-cell from"><div class="flow-lbl">From Account</div><div class="flow-name">{{fromAccountName}}</div></div>
    <div class="flow-mid">&#8594;</div>
    <div class="flow-cell to"><div class="flow-lbl">To Account</div><div class="flow-name">{{toAccountName}}</div></div>
  </div>
  <div class="amount-panel">
    <div class="amount-lbl">Amount Transferred</div>
    <div class="amount-val">Rs {{fmt amount}}</div>
  </div>
  {{#if amountInWords}}<div class="words"><b>Amount in words:</b> {{amountInWords}}</div>{{/if}}
  {{#if description}}<div class="remarks"><span class="lbl">Remarks</span><div class="body">{{{richText description}}}</div></div>{{/if}}
  <div class="footer">
    <div class="sig"><div class="line"></div><div class="label">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
  </div>
</div>
</body></html>`,
  },

  // ─── 4. Monochrome Ink-Saver (hairline borders, no fills) ────────────────────
  {
    id: "transfer-monochrome-ink",
    name: "Monochrome Ink-Saver",
    type: "Transfer",
    description: "Hairline black borders only, no fills, pure black-and-white for minimum toner use",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Fund Transfer Voucher {{reference}}</title><style>
@media print { @page { size: A4; margin: 14mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, sans-serif; padding: 14mm; color: #000; font-size: 11pt; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #000; padding-bottom: 12px; margin-bottom: 14px; }
.brand { font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.division { font-size: 10px; margin-top: 2px; }
.addr { font-size: 9px; margin-top: 4px; line-height: 1.5; }
.meta { font-size: 8px; margin-top: 3px; }
.v-block { text-align: right; border: 1px solid #000; padding: 8px 12px; }
.v-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.v-ref { font-size: 18px; font-weight: 900; margin-top: 4px; }
.v-date { font-size: 10px; margin-top: 2px; }
.flow { display: flex; align-items: stretch; margin: 6px 0 16px; border: 1px solid #000; }
.acc-box { flex: 1; padding: 12px 14px; }
.acc-box.from { border-right: 1px solid #000; }
.acc-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
.acc-name { font-size: 14px; font-weight: 700; margin-top: 6px; line-height: 1.35; }
.flow-arrow { width: 50px; display: flex; align-items: center; justify-content: center; border-left: 1px solid #000; border-right: 1px solid #000; font-size: 22px; font-weight: 900; }
.amount-box { border: 1.5px solid #000; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.amount-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; }
.amount-val { font-size: 28px; font-weight: 900; }
.words { font-size: 10pt; font-style: italic; margin-bottom: 14px; border-bottom: 1px solid #000; padding-bottom: 8px; }
.words b { font-style: normal; }
.remarks { font-size: 10pt; line-height: 1.6; margin-bottom: 10px; }
.remarks .lbl { font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px; display: block; margin-bottom: 3px; }
.footer { margin-top: 48px; display: flex; justify-content: space-between; padding: 0 20px; }
.sig { text-align: center; }
.sig .line { width: 190px; border-top: 1px solid #000; margin: 0 auto 4px; }
.sig .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
</style></head><body>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:48px;margin-bottom:6px;display:block;filter:grayscale(100%)">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    {{#if divisionName}}<div class="division">{{divisionName}}</div>{{/if}}
    {{#if companyAddress}}<div class="addr">{{{nl2br companyAddress}}}</div>{{/if}}
    {{#if companyPhone}}<div class="addr">{{{nl2br companyPhone}}}</div>{{/if}}
    {{#if companyNTN}}<div class="meta">NTN: {{companyNTN}}{{#if companySTRN}} | STRN: {{companySTRN}}{{/if}}</div>{{/if}}
  </div>
  <div class="v-block">
    <div class="v-title">Fund Transfer Voucher</div>
    <div class="v-ref">{{reference}}</div>
    <div class="v-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="flow">
  <div class="acc-box from"><div class="acc-lbl">From Account</div><div class="acc-name">{{fromAccountName}}</div></div>
  <div class="flow-arrow">&#8594;</div>
  <div class="acc-box to"><div class="acc-lbl">To Account</div><div class="acc-name">{{toAccountName}}</div></div>
</div>
<div class="amount-box">
  <div class="amount-lbl">Amount Transferred</div>
  <div class="amount-val">Rs {{fmt amount}}</div>
</div>
{{#if amountInWords}}<div class="words"><b>Amount in words:</b> {{amountInWords}}</div>{{/if}}
{{#if description}}<div class="remarks"><span class="lbl">Remarks</span>{{{richText description}}}</div>{{/if}}
<div class="footer">
  <div class="sig"><div class="line"></div><div class="label">Prepared By</div></div>
  <div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>
</div>
</body></html>`,
  },

];
