/**
 * Withholding Tax Certificate starter templates — 4 distinct visual archetypes.
 * All templates are A4 print-ready, Handlebars-powered, formal certificate layouts.
 * The issuing company is the WITHHOLDING AGENT; the customer is the person from
 * whom tax was deducted/collected.
 * Merge fields: companyBrandName, companyLogoPath, companyAddress, companyPhone,
 * companyNTN, companySTRN, divisionName, divisionBrandName, divisionLogoPath,
 * divisionAddress, divisionPhone, divisionNTN, divisionSTRN, divisionEmail,
 * receiptNumber, date, customerName, customerAddress, customerNTN, customerSTRN,
 * description, amount (tax withheld), amountInWords.
 * Use only registered helpers: fmt, fmtDate, fmtDec, nl2br, richText,
 * inc, math, eq, gt, or, #if, #unless. No arrays, no line items.
 */

export const withholdingTaxStarters = [

  // ─── 1. Classic Serif (double-border frame) — DEFAULT ────────────────────────
  {
    id: "wht-classic-serif",
    name: "Classic Serif",
    type: "WithholdingTaxReceipt",
    description: "Formal Times New Roman certificate with a double-border frame, official and clean — the default",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Withholding Tax Certificate #{{receiptNumber}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 12mm; color: #000; font-size: 12pt; }
.outer-border { border: 2.5px solid #7b1113; padding: 6px; }
.inner-border { border: 1px solid #7b1113; padding: 18px 22px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #7b1113; padding-bottom: 14px; margin-bottom: 4px; }
.brand { font-size: 28px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #1a1a1a; }
.division { font-size: 11px; font-weight: 700; color: #7b1113; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
.addr { font-size: 10px; color: #333; margin-top: 5px; line-height: 1.5; }
.tax-ids { font-size: 10px; color: #333; margin-top: 5px; line-height: 1.6; }
.tax-ids b { color: #000; }
.cert-block { text-align: right; }
.cert-title { font-size: 17px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #7b1113; }
.cert-sub { font-size: 9px; font-style: italic; color: #555; margin-top: 2px; letter-spacing: 0.5px; }
.cert-meta { margin-top: 12px; font-size: 11px; line-height: 1.7; }
.cert-meta b { display: inline-block; min-width: 78px; }
.title-banner { text-align: center; margin: 20px 0 16px; }
.title-banner .line { font-size: 20px; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; color: #1a1a1a; }
.title-banner .rule { width: 120px; height: 2px; background: #7b1113 !important; margin: 8px auto 0; }
.section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #7b1113; font-weight: 700; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 8px; }
.party { margin-bottom: 18px; font-size: 11pt; line-height: 1.7; }
.party .name { font-size: 14px; font-weight: 700; }
.party .row { font-size: 11px; color: #333; margin-top: 2px; }
.party .row b { color: #000; }
.certify { font-size: 12pt; line-height: 1.9; text-align: justify; margin: 8px 0 18px; }
.certify .amt { font-weight: 700; }
.amount-box { border: 2px solid #7b1113; padding: 14px 20px; text-align: center; margin: 4px 0 18px; background: #fbf3f3 !important; }
.amount-box .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #7b1113; font-weight: 700; }
.amount-box .val { font-size: 30px; font-weight: 900; color: #1a1a1a; margin-top: 4px; }
.amount-box .words { font-size: 11px; font-style: italic; color: #444; margin-top: 4px; }
.desc { margin-bottom: 20px; }
.desc .body { font-size: 11px; color: #333; line-height: 1.6; border-left: 3px solid #7b1113; padding: 6px 12px; }
.footer { margin-top: 40px; display: flex; justify-content: flex-end; }
.sig { text-align: center; min-width: 220px; }
.sig .line { border-top: 1.5px solid #333; margin: 0 auto 5px; }
.sig .role { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.sig .co { font-size: 10px; color: #555; margin-top: 2px; }
.legal { margin-top: 22px; font-size: 8px; color: #888; text-align: center; font-style: italic; border-top: 1px solid #eee; padding-top: 6px; }
</style></head><body>
<div class="outer-border"><div class="inner-border">
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:58px;margin-bottom:6px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    {{#if divisionName}}<div class="division">{{divisionName}}</div>{{/if}}
    <div class="addr">{{{nl2br companyAddress}}}</div>
    {{#if companyPhone}}<div class="addr">{{{nl2br companyPhone}}}</div>{{/if}}
    <div class="tax-ids">{{#if companyNTN}}<b>NTN:</b> {{companyNTN}}{{/if}}{{#if companySTRN}} &nbsp;&nbsp; <b>STRN:</b> {{companySTRN}}{{/if}}</div>
  </div>
  <div class="cert-block">
    <div class="cert-title">Tax Certificate</div>
    <div class="cert-sub">Certificate of Tax Deduction/Collection</div>
    <div class="cert-meta">
      <div><b>Certificate No.:</b> WHT-{{receiptNumber}}</div>
      <div><b>Date:</b> {{fmtDate date}}</div>
    </div>
  </div>
</div>
<div class="title-banner">
  <div class="line">Withholding Tax Certificate</div>
  <div class="rule"></div>
</div>
<div class="section-label">Withheld From</div>
<div class="party">
  <div class="name">{{customerName}}</div>
  {{#if customerAddress}}<div class="row">{{{nl2br customerAddress}}}</div>{{/if}}
  {{#if customerNTN}}<div class="row"><b>NTN:</b> {{customerNTN}}</div>{{/if}}
  {{#if customerSTRN}}<div class="row"><b>STRN:</b> {{customerSTRN}}</div>{{/if}}
</div>
<div class="certify">
  This is to certify that an amount of <span class="amt">Rs {{fmt amount}}</span>{{#if amountInWords}} (<span class="amt">{{amountInWords}}</span>){{/if}} has been deducted/collected as withholding tax and deposited into the Government Treasury on behalf of the above-named person.
</div>
<div class="amount-box">
  <div class="lbl">Tax Withheld</div>
  <div class="val">Rs {{fmt amount}}</div>
  {{#if amountInWords}}<div class="words">{{amountInWords}}</div>{{/if}}
</div>
{{#if description}}
<div class="desc">
  <div class="section-label">Nature / Particulars of Transaction</div>
  <div class="body">{{{richText description}}}</div>
</div>
{{/if}}
<div class="footer">
  <div class="sig">
    <div class="line"></div>
    <div class="role">Authorized Signatory</div>
    <div class="co">For {{companyBrandName}}</div>
  </div>
</div>
<div class="legal">This certificate is issued under the relevant provisions of the Income Tax Ordinance, 2001. Computer-generated document.</div>
</div></div>
</body></html>`,
  },

  // ─── 2. Modern Minimal (thin accent rule) ────────────────────────────────────
  {
    id: "wht-modern-minimal",
    name: "Modern Minimal",
    type: "WithholdingTaxReceipt",
    description: "Clean Calibri/Segoe layout with a thin navy accent rule and airy spacing",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Withholding Tax Certificate #{{receiptNumber}}</title><style>
@media print { @page { size: A4; margin: 12mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; padding: 14mm; color: #222; font-size: 11pt; }
.accent-rule { height: 4px; background: #1a2b5e !important; border-radius: 2px; margin-bottom: 20px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
.brand { font-size: 25px; font-weight: 800; color: #1a2b5e; letter-spacing: 0.5px; }
.division { font-size: 10px; font-weight: 700; color: #5a6786; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
.sub { font-size: 10px; color: #666; margin-top: 4px; line-height: 1.5; }
.tax-ids { font-size: 9px; color: #777; margin-top: 4px; line-height: 1.6; }
.tax-ids b { color: #444; }
.cert-right { text-align: right; }
.badge { background: #1a2b5e !important; color: #fff !important; padding: 6px 14px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; display: inline-block; text-transform: uppercase; }
.cert-sub { font-size: 9px; color: #888; margin-top: 5px; }
.cert-no { font-size: 15px; font-weight: 800; color: #1a2b5e; margin-top: 8px; }
.cert-date { font-size: 10px; color: #777; margin-top: 2px; }
.title { font-size: 22px; font-weight: 700; color: #1a1a1a; letter-spacing: 1px; margin: 26px 0 4px; }
.title-sub { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px; }
.party-strip { background: #f4f6fb !important; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; }
.party-lbl { font-size: 8px; text-transform: uppercase; color: #9aa3bd; font-weight: 700; letter-spacing: 1px; }
.party-name { font-size: 15px; font-weight: 700; color: #1a1a1a; margin-top: 3px; }
.party-row { font-size: 10px; color: #555; margin-top: 3px; line-height: 1.5; }
.party-row b { color: #333; }
.certify { font-size: 11pt; line-height: 1.9; color: #333; margin-bottom: 20px; }
.certify b { color: #1a2b5e; }
.amount-box { display: flex; justify-content: space-between; align-items: center; border: 1px solid #cdd4e6; border-left: 5px solid #1a2b5e; border-radius: 6px; padding: 16px 22px; margin-bottom: 22px; }
.amount-box .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: #5a6786; font-weight: 700; }
.amount-box .words { font-size: 10px; font-style: italic; color: #777; margin-top: 4px; max-width: 320px; }
.amount-box .val { font-size: 30px; font-weight: 800; color: #1a2b5e; white-space: nowrap; }
.desc { margin-bottom: 22px; }
.desc .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: 1px; color: #9aa3bd; font-weight: 700; margin-bottom: 5px; }
.desc .body { font-size: 10px; color: #444; line-height: 1.6; }
.footer { margin-top: 44px; display: flex; justify-content: flex-end; }
.sig { text-align: center; min-width: 220px; }
.sig .line { border-top: 2px solid #1a2b5e; margin: 0 auto 5px; }
.sig .role { font-size: 10px; font-weight: 700; color: #333; text-transform: uppercase; letter-spacing: 0.5px; }
.sig .co { font-size: 9px; color: #888; margin-top: 2px; }
.legal { margin-top: 24px; font-size: 8px; color: #aaa; text-align: center; }
</style></head><body>
<div class="accent-rule"></div>
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:50px;margin-bottom:6px;display:block">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    {{#if divisionName}}<div class="division">{{divisionName}}</div>{{/if}}
    <div class="sub">{{{nl2br companyAddress}}}</div>
    {{#if companyPhone}}<div class="sub">{{{nl2br companyPhone}}}</div>{{/if}}
    <div class="tax-ids">{{#if companyNTN}}<b>NTN:</b> {{companyNTN}}{{/if}}{{#if companySTRN}} &nbsp; <b>STRN:</b> {{companySTRN}}{{/if}}</div>
  </div>
  <div class="cert-right">
    <div class="badge">Tax Certificate</div>
    <div class="cert-sub">Certificate of Tax Deduction/Collection</div>
    <div class="cert-no">Certificate No.: WHT-{{receiptNumber}}</div>
    <div class="cert-date">Date: {{fmtDate date}}</div>
  </div>
</div>
<div class="title">Withholding Tax Certificate</div>
<div class="title-sub">Certificate of Tax Deduction / Collection</div>
<div class="party-strip">
  <div class="party-lbl">Withheld From</div>
  <div class="party-name">{{customerName}}</div>
  {{#if customerAddress}}<div class="party-row">{{{nl2br customerAddress}}}</div>{{/if}}
  <div class="party-row">{{#if customerNTN}}<b>NTN:</b> {{customerNTN}}{{/if}}{{#if customerSTRN}} &nbsp; <b>STRN:</b> {{customerSTRN}}{{/if}}</div>
</div>
<div class="certify">
  This is to certify that an amount of <b>Rs {{fmt amount}}</b>{{#if amountInWords}} (<b>{{amountInWords}}</b>){{/if}} has been deducted/collected as withholding tax and deposited into the Government Treasury on behalf of the above-named person.
</div>
<div class="amount-box">
  <div>
    <div class="lbl">Tax Withheld</div>
    {{#if amountInWords}}<div class="words">{{amountInWords}}</div>{{/if}}
  </div>
  <div class="val">Rs {{fmt amount}}</div>
</div>
{{#if description}}
<div class="desc">
  <div class="lbl">Nature / Particulars of Transaction</div>
  <div class="body">{{{richText description}}}</div>
</div>
{{/if}}
<div class="footer">
  <div class="sig">
    <div class="line"></div>
    <div class="role">Authorized Signatory</div>
    <div class="co">For {{companyBrandName}}</div>
  </div>
</div>
<div class="legal">Issued under the Income Tax Ordinance, 2001. This is a computer-generated certificate.</div>
</body></html>`,
  },

  // ─── 3. Official Seal (government-certificate look) ──────────────────────────
  {
    id: "wht-official-seal",
    name: "Official Seal",
    type: "WithholdingTaxReceipt",
    description: "Formal government-style certificate with a double-border frame, corner OFFICIAL seal and watermark",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Withholding Tax Certificate #{{receiptNumber}}</title><style>
@media print { @page { size: A4; margin: 10mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: "Times New Roman", Times, serif; padding: 8mm; color: #1a1a1a; font-size: 12pt; }
.frame-outer { border: 3px double #7b1113; padding: 5px; position: relative; }
.frame-inner { border: 1.5px solid #7b1113; padding: 22px 26px; position: relative; overflow: hidden; }
.watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-28deg); font-size: 92px; font-weight: 900; color: #7b1113; opacity: 0.05; letter-spacing: 6px; white-space: nowrap; pointer-events: none; text-transform: uppercase; }
.seal { position: absolute; top: 14px; right: 16px; width: 88px; height: 88px; border: 2px solid #7b1113; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #7b1113; text-align: center; }
.seal .ring { position: absolute; top: 5px; left: 5px; right: 5px; bottom: 5px; border: 1px dashed #7b1113; border-radius: 50%; }
.seal .top { font-size: 7px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
.seal .mid { font-size: 15px; font-weight: 900; letter-spacing: 1px; margin: 2px 0; }
.seal .bot { font-size: 6px; letter-spacing: 0.5px; text-transform: uppercase; }
.content { position: relative; z-index: 1; }
.head { text-align: center; border-bottom: 2px solid #7b1113; padding-bottom: 12px; margin-bottom: 6px; }
.head .logo { margin-bottom: 6px; }
.brand { font-size: 26px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; }
.division { font-size: 10px; font-weight: 700; color: #7b1113; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 3px; }
.addr { font-size: 9px; color: #444; margin-top: 4px; line-height: 1.5; }
.tax-ids { font-size: 9px; color: #444; margin-top: 4px; }
.tax-ids b { color: #000; }
.cert-heading { text-align: center; margin: 18px 0 14px; }
.cert-heading .main { font-size: 21px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: #7b1113; }
.cert-heading .sub { font-size: 10px; font-style: italic; color: #555; letter-spacing: 1px; margin-top: 3px; }
.meta-row { display: flex; justify-content: center; gap: 34px; font-size: 11px; margin-bottom: 18px; }
.meta-row b { color: #7b1113; }
.section-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: #7b1113; font-weight: 700; margin-bottom: 6px; }
.party { border: 1px solid #d9c4c4; padding: 12px 16px; margin-bottom: 18px; background: #fdf9f9 !important; }
.party .name { font-size: 14px; font-weight: 700; }
.party .row { font-size: 10px; color: #333; margin-top: 3px; line-height: 1.5; }
.party .row b { color: #000; }
.certify { font-size: 12pt; line-height: 2; text-align: justify; margin-bottom: 18px; }
.certify b { color: #7b1113; }
.amount-box { border: 2px solid #7b1113; padding: 14px 20px; text-align: center; margin-bottom: 18px; background: #fbf3f3 !important; }
.amount-box .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #7b1113; font-weight: 700; }
.amount-box .val { font-size: 30px; font-weight: 900; margin-top: 4px; }
.amount-box .words { font-size: 11px; font-style: italic; color: #444; margin-top: 4px; }
.desc { margin-bottom: 18px; }
.desc .body { font-size: 10px; color: #333; line-height: 1.6; border-left: 3px solid #7b1113; padding: 6px 12px; }
.footer { margin-top: 40px; display: flex; justify-content: flex-end; }
.sig { text-align: center; min-width: 220px; }
.sig .line { border-top: 1.5px solid #333; margin: 0 auto 5px; }
.sig .role { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.sig .co { font-size: 10px; color: #555; margin-top: 2px; }
.legal { margin-top: 20px; font-size: 8px; color: #888; text-align: center; font-style: italic; border-top: 1px solid #eee; padding-top: 6px; }
</style></head><body>
<div class="frame-outer"><div class="frame-inner">
<div class="watermark">Official</div>
<div class="seal">
  <div class="ring"></div>
  <div class="top">Withholding</div>
  <div class="mid">OFFICIAL</div>
  <div class="bot">Tax Agent</div>
</div>
<div class="content">
  <div class="head">
    {{#if companyLogoPath}}<div class="logo"><img src="{{companyLogoPath}}" style="height:56px"></div>{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    {{#if divisionName}}<div class="division">{{divisionName}}</div>{{/if}}
    <div class="addr">{{{nl2br companyAddress}}}{{#if companyPhone}} &nbsp;|&nbsp; {{{nl2br companyPhone}}}{{/if}}</div>
    <div class="tax-ids">{{#if companyNTN}}<b>NTN:</b> {{companyNTN}}{{/if}}{{#if companySTRN}} &nbsp;&nbsp; <b>STRN:</b> {{companySTRN}}{{/if}}</div>
  </div>
  <div class="cert-heading">
    <div class="main">Withholding Tax Certificate</div>
    <div class="sub">Certificate of Tax Deduction / Collection</div>
  </div>
  <div class="meta-row">
    <div><b>Certificate No.:</b> WHT-{{receiptNumber}}</div>
    <div><b>Date:</b> {{fmtDate date}}</div>
  </div>
  <div class="section-label">Withheld From</div>
  <div class="party">
    <div class="name">{{customerName}}</div>
    {{#if customerAddress}}<div class="row">{{{nl2br customerAddress}}}</div>{{/if}}
    <div class="row">{{#if customerNTN}}<b>NTN:</b> {{customerNTN}}{{/if}}{{#if customerSTRN}} &nbsp;&nbsp; <b>STRN:</b> {{customerSTRN}}{{/if}}</div>
  </div>
  <div class="certify">
    This is to certify that an amount of <b>Rs {{fmt amount}}</b>{{#if amountInWords}} (<b>{{amountInWords}}</b>){{/if}} has been deducted/collected as withholding tax and deposited into the Government Treasury on behalf of the above-named person.
  </div>
  <div class="amount-box">
    <div class="lbl">Tax Withheld</div>
    <div class="val">Rs {{fmt amount}}</div>
    {{#if amountInWords}}<div class="words">{{amountInWords}}</div>{{/if}}
  </div>
  {{#if description}}
  <div class="desc">
    <div class="section-label">Nature / Particulars of Transaction</div>
    <div class="body">{{{richText description}}}</div>
  </div>
  {{/if}}
  <div class="footer">
    <div class="sig">
      <div class="line"></div>
      <div class="role">Authorized Signatory</div>
      <div class="co">For {{companyBrandName}}</div>
    </div>
  </div>
  <div class="legal">Issued under the relevant provisions of the Income Tax Ordinance, 2001. Computer-generated document — valid without signature where digitally issued.</div>
</div>
</div></div>
</body></html>`,
  },

  // ─── 4. Monochrome Ink-Saver (hairline black borders, no fills) ──────────────
  {
    id: "wht-monochrome-ink",
    name: "Monochrome Ink-Saver",
    type: "WithholdingTaxReceipt",
    description: "Pure black-and-white certificate with hairline borders and no fills for minimum toner use",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Withholding Tax Certificate #{{receiptNumber}}</title><style>
@media print { @page { size: A4; margin: 14mm; } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { font-family: Arial, "Helvetica Neue", sans-serif; padding: 12mm; color: #000; font-size: 11pt; }
.sheet { border: 1px solid #000; padding: 22px 26px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #000; padding-bottom: 12px; margin-bottom: 4px; }
.brand { font-size: 22px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.division { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
.addr { font-size: 9px; margin-top: 4px; line-height: 1.5; }
.tax-ids { font-size: 9px; margin-top: 4px; line-height: 1.5; }
.tax-ids b { font-weight: 700; }
.cert-block { text-align: right; border: 1px solid #000; padding: 8px 12px; }
.cert-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.cert-sub { font-size: 8px; margin-top: 2px; }
.cert-no { font-size: 14px; font-weight: 700; margin-top: 6px; }
.cert-date { font-size: 10px; margin-top: 2px; }
.title { text-align: center; font-size: 19px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; margin: 20px 0 4px; }
.title-sub { text-align: center; font-size: 9px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px; }
.section-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 3px; margin-bottom: 8px; }
.party { margin-bottom: 18px; }
.party .name { font-size: 13px; font-weight: 700; }
.party .row { font-size: 10px; margin-top: 3px; line-height: 1.5; }
.party .row b { font-weight: 700; }
.certify { font-size: 11pt; line-height: 1.9; text-align: justify; margin-bottom: 18px; }
.certify b { font-weight: 700; }
.amount-box { border: 1.5px solid #000; padding: 14px 20px; text-align: center; margin-bottom: 18px; }
.amount-box .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; }
.amount-box .val { font-size: 28px; font-weight: 700; margin-top: 4px; }
.amount-box .words { font-size: 10px; font-style: italic; margin-top: 4px; }
.desc { margin-bottom: 20px; }
.desc .body { font-size: 10px; line-height: 1.6; border: 1px solid #000; padding: 8px 12px; }
.footer { margin-top: 42px; display: flex; justify-content: flex-end; }
.sig { text-align: center; min-width: 220px; }
.sig .line { border-top: 1px solid #000; margin: 0 auto 5px; }
.sig .role { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.sig .co { font-size: 9px; margin-top: 2px; }
.legal { margin-top: 22px; font-size: 8px; text-align: center; font-style: italic; border-top: 1px solid #000; padding-top: 6px; }
</style></head><body>
<div class="sheet">
<div class="header">
  <div>
    {{#if companyLogoPath}}<img src="{{companyLogoPath}}" style="height:46px;margin-bottom:5px;display:block;filter:grayscale(100%)">{{/if}}
    <div class="brand">{{companyBrandName}}</div>
    {{#if divisionName}}<div class="division">{{divisionName}}</div>{{/if}}
    <div class="addr">{{{nl2br companyAddress}}}</div>
    {{#if companyPhone}}<div class="addr">{{{nl2br companyPhone}}}</div>{{/if}}
    <div class="tax-ids">{{#if companyNTN}}<b>NTN:</b> {{companyNTN}}{{/if}}{{#if companySTRN}} &nbsp; <b>STRN:</b> {{companySTRN}}{{/if}}</div>
  </div>
  <div class="cert-block">
    <div class="cert-title">Tax Certificate</div>
    <div class="cert-sub">Deduction / Collection</div>
    <div class="cert-no">WHT-{{receiptNumber}}</div>
    <div class="cert-date">{{fmtDate date}}</div>
  </div>
</div>
<div class="title">Withholding Tax Certificate</div>
<div class="title-sub">Certificate of Tax Deduction / Collection</div>
<div class="section-label">Withheld From</div>
<div class="party">
  <div class="name">{{customerName}}</div>
  {{#if customerAddress}}<div class="row">{{{nl2br customerAddress}}}</div>{{/if}}
  {{#if customerNTN}}<div class="row"><b>NTN:</b> {{customerNTN}}</div>{{/if}}
  {{#if customerSTRN}}<div class="row"><b>STRN:</b> {{customerSTRN}}</div>{{/if}}
</div>
<div class="certify">
  This is to certify that an amount of <b>Rs {{fmt amount}}</b>{{#if amountInWords}} (<b>{{amountInWords}}</b>){{/if}} has been deducted/collected as withholding tax and deposited into the Government Treasury on behalf of the above-named person.
</div>
<div class="amount-box">
  <div class="lbl">Tax Withheld</div>
  <div class="val">Rs {{fmt amount}}</div>
  {{#if amountInWords}}<div class="words">{{amountInWords}}</div>{{/if}}
</div>
{{#if description}}
<div class="desc">
  <div class="section-label">Nature / Particulars of Transaction</div>
  <div class="body">{{{richText description}}}</div>
</div>
{{/if}}
<div class="footer">
  <div class="sig">
    <div class="line"></div>
    <div class="role">Authorized Signatory</div>
    <div class="co">For {{companyBrandName}}</div>
  </div>
</div>
<div class="legal">Issued under the Income Tax Ordinance, 2001. Computer-generated document.</div>
</div>
</body></html>`,
  },

];
