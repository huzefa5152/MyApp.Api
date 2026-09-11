// Every starter and built-in default for a document that carries withholding
// tax must render the withholding lines when there is withholding, render
// nothing extra when there is none, and carry a signature (stamp) slot.
// Also pins the injector used on existing templates: idempotent, and able to
// place the block in every shipped design.
//
//   node scripts/test_print_templates_wht.mjs        ->  "N passed, 0 failed"
import { pathToFileURL } from "node:url";

const here = new URL("../myapp-frontend/src/utils/", import.meta.url).href;
const load = (f) => import(new URL(f, here).href);

const { mergeTemplate } = await load("templateEngine.js");
const { injectWithholdingBlock, hasWithholdingBlock, WITHHOLDING_TEMPLATE_TYPES } = await load("withholdingBlock.js");
const { detectStampState, STAMP_STATE } = await load("stampSlot.js");
// templateSampleData.js imports "./templateEngine" without an extension, which
// Vite resolves and plain node does not, so the document data is spelled out
// here: the handful of fields every totals block reads.
const base = {
  companyBrandName: "SAMPLE COMPANY", companyAddress: "Karachi", companyPhone: "021", companyNTN: "1234567-8",
  companySTRN: "1234567890123", invoiceNumber: 501, noteNumber: 7, purchaseBillNumber: 88,
  date: new Date().toISOString(), challanNumbers: [1001], challanDates: [new Date().toISOString()],
  poNumber: "PO-1", clientName: "Sample Client", supplierName: "Sample Supplier", clientNTN: "9876543-2",
  subtotal: 150000, gstRate: 18, gstAmount: 27000, grandTotal: 177000,
  amountInWords: "One Hundred Seventy Seven Thousand Rupees Only",
  items: [{ sNo: 1, quantity: 10, description: "Sample Item", itemTypeName: "Sample", unitPrice: 15000, lineTotal: 150000,
            hsCode: "8481.8090", uom: "Pcs", gstRate: 18, gstAmount: 27000, totalWithTax: 177000 }],
};
const sample = Object.fromEntries(WITHHOLDING_TEMPLATE_TYPES.map((t) => [t, base]));
const defaults = await load("defaultTemplates.js");
const starters = {
  Bill: (await load("starters/bill.js")).billStarters,
  TaxInvoice: Object.values(await load("starters/taxInvoice.js")).find(Array.isArray),
  PurchaseBill: Object.values(await load("starters/purchaseBill.js")).find(Array.isArray),
  CreditNote: Object.values(await load("starters/creditNote.js")).find(Array.isArray),
  DebitNote: Object.values(await load("starters/debitNote.js")).find(Array.isArray),
};

let passed = 0, failed = 0;
const fails = [];
function check(name, ok, detail = "") {
  if (ok) passed++; else { failed++; fails.push(`${name}${detail ? " — " + detail : ""}`); }
}

const templates = [];
for (const type of WITHHOLDING_TEMPLATE_TYPES) {
  for (const s of starters[type] || []) templates.push({ label: `${type} starter ${s.id}`, type, html: s.html });
}
templates.push({ label: "default Bill", type: "Bill", html: defaults.defaultBillTemplate });
templates.push({ label: "default TaxInvoice", type: "TaxInvoice", html: defaults.defaultTaxInvoiceTemplate });

const strip = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

for (const t of templates) {
  const data = { ...(sample?.[t.type] || {}) };
  check(`${t.label}: has withholding merge fields`, hasWithholdingBlock(t.html));
  check(`${t.label}: has a signature slot`, detectStampState(t.html) === STAMP_STATE.SLOTTED);

  // with withholding
  const withWht = { ...data, withholdingTaxRate: 4.5, withholdingTaxAmount: 4500, balanceDueAfterWht: (data.grandTotal || 100000) - 4500 };
  let html = "";
  try { html = mergeTemplate(t.html, withWht); } catch (e) { check(`${t.label}: renders`, false, e.message); continue; }
  const text = strip(html);
  check(`${t.label}: renders the withholding line`, /Withholding Income Tax\s*\(4\.5%\)/.test(text), text.slice(text.indexOf("Withholding") - 20, text.indexOf("Withholding") + 60));
  check(`${t.label}: renders Net Payable`, /Net Payable/i.test(text));
  check(`${t.label}: renders the withheld amount`, /4,500/.test(text));

  // without withholding: nothing extra
  const without = { ...data, withholdingTaxRate: null, withholdingTaxAmount: 0, balanceDueAfterWht: data.grandTotal };
  const plain = strip(mergeTemplate(t.html, without));
  check(`${t.label}: silent when there is no withholding`, !/Withholding Income Tax|Net Payable/i.test(plain));

  // injector is idempotent on the shipped html
  const again = injectWithholdingBlock(t.html);
  check(`${t.label}: injector leaves it alone`, !again.changed && again.anchor === "already-present");
}

// The injector must still place the block into each design when the block is
// absent -- that is what the "Add withholding tax lines" action relies on for
// the templates already saved on a live installation.
// Strip every conditional block whose condition mentions withholdingTaxAmount,
// with nesting respected -- a branch's own block may nest differently from the
// injector's (e.g. a separate "(or withholdingTaxAmount advanceTaxAmount)" row).
function stripWithholding(html) {
  const OPEN = /\{\{#if\b/g;
  let out = html;
  for (;;) {
    const start = out.search(/\{\{#if\b[^}]*withholdingTaxAmount[^}]*\}\}/);
    if (start < 0) return out;
    let depth = 0, i = start;
    const tag = /\{\{(#if\b|\/if)\}?[^}]*\}\}/g;
    tag.lastIndex = start;
    let m, end = -1;
    while ((m = tag.exec(out))) {
      if (m[1].startsWith("#if")) depth++;
      else if (--depth === 0) { end = m.index + m[0].length; break; }
    }
    if (end < 0) return out;
    out = out.slice(0, start) + out.slice(end);
  }
}
for (const t of templates) {
  const bare = stripWithholding(t.html);
  const r = injectWithholdingBlock(bare);
  check(`${t.label}: injector finds the totals row`, r.changed && (r.anchor === "totals-row" || r.anchor === "footer-row"), r.anchor);
  if (r.changed) {
    const text = strip(mergeTemplate(r.html, { ...(sample?.[t.type] || {}), withholdingTaxRate: 4.5, withholdingTaxAmount: 4500, balanceDueAfterWht: 1 }));
    check(`${t.label}: re-injected block renders`, /Net Payable/i.test(text));
  }
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log("failed checks:"); for (const f of fails) console.log("  - " + f); process.exit(1); }
