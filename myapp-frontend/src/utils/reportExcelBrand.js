import { getCustomerLedgerInvoiceLayout } from "../api/printTemplateApi";
import { invoiceBranding, selectLedgerInvoiceTemplate } from "./customerLedgerPrint";

/** "rgb(25, 59, 37)" -> "#193b25"; anything else (transparent, named) -> "". */
export function cssColorToHex(value) {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(String(value || "").trim());
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return "";
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The header colours of the company's default Bill template, as the query
 * parameters the Excel exports accept. The same template the Print / PDF
 * letterhead comes from, so all three outputs carry one identity. Best
 * effort: a template that cannot be read leaves the export on its default
 * colours rather than failing it. `letterhead: true` asks the server for the
 * company letterhead; a caller that omits it gets the plain workbook.
 */
export async function excelBrandParams(company, divisionId) {
  try {
    const { data: layout } = await getCustomerLedgerInvoiceLayout(company.id, divisionId);
    const template = selectLedgerInvoiceTemplate(layout ? [layout] : [], company.id, divisionId);
    const brand = await invoiceBranding(template, company);
    const brandFill = cssColorToHex(brand.headerBackground);
    const brandText = cssColorToHex(brand.headerColor);
    return { letterhead: true, ...(brandFill ? { brandFill } : {}), ...(brandText ? { brandText } : {}) };
  } catch {
    return { letterhead: true };
  }
}
