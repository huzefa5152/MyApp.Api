import { registerHooks } from "node:module";
import { extname } from "node:path";
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith(".") && !extname(specifier)) return nextResolve(specifier + ".js", context);
    throw error;
  }
} });
const load = (file) => import(new URL("../myapp-frontend/src/utils/" + file, import.meta.url));
const { mergeTemplate } = await load("templateEngine.js");
const { defaultBillTemplate, defaultTaxInvoiceTemplate } = await load("defaultTemplates.js");
const { billStarters } = await load("starters/bill.js");
const base = { companyBrandName: "Sample Company", clientName: "Sample Client", invoiceNumber: 1,
  date: "2026-10-01", subtotal: 27426, gstRate: 18, gstAmount: 4936.68, totalBeforeFreight: 32362.68,
  freightCharges: 4000, commercialTotal: 36362.68, grandTotal: 36363,
  amountInWords: "Thirty Six Thousand Three Hundred Sixty Three Rupees Only",
  items: [{ sNo: 1, quantity: 1, description: "Sample goods", itemTypeName: "Sample goods", uom: "Pcs",
    unitPrice: 27426, lineTotal: 27426, gstRate: 18, gstAmount: 4936.68, totalWithTax: 32362.68 }],
  challanNumbers: [1], challanDates: ["2026-10-01"] };
let passed = 0;
function check(name, okay) { if (!okay) throw new Error(name); passed++; }
check("preserve all fifteen bill designs", billStarters.length === 15);
for (const [index, html] of [defaultBillTemplate, ...billStarters.map(t => t.html)].entries()) {
  const filled = mergeTemplate(html, base, "Bill");
  check(`Bill ${index} prints freight`, /Freight \/ cartage/i.test(filled) && filled.includes("4,000.00"));
  check(`Bill ${index} prints commercial total`, filled.includes("36,363") && !filled.includes("NaN"));
  const zero = mergeTemplate(html, { ...base, freightCharges: 0, grandTotal: 32363 }, "Bill");
  check(`Bill ${index} hides zero freight`, !/Freight \/ cartage/i.test(zero));
}
const tax = mergeTemplate(defaultTaxInvoiceTemplate, { ...base, grandTotal: 32363 }, "TaxInvoice");
check("tax invoice excludes freight", !/Freight \/ cartage/i.test(tax) && !tax.includes("4,000.00") && tax.includes("32,363"));
check("merge fields expose exact commercial components", mergeTemplate("{{fmtDec freightCharges}}|{{fmtDec totalBeforeFreight}}|{{fmtDec commercialTotal}}", base, "Bill") === "4,000.00|32,362.68|36,362.68");
console.log(`${passed}/${passed} freight print checks passed`);
