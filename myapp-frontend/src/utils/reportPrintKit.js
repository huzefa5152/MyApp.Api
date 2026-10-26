import { getAccountingReportInvoiceLayout } from "../api/printTemplateApi";
import { buildReportHtml } from "../Components/AccountingCatalogShell";
import { brandAccountingReport } from "./accountingReportPrint";
import { selectReportInvoiceTemplate } from "./invoiceReportBranding";
import { writeAndPrint } from "./printDocument";
import { exportToPdf } from "./exportUtils";

/**
 * Print / PDF for a report screen that is not part of the accounting catalog.
 *
 * The screen hands over the rows it already shows in the catalog's report
 * envelope — { title, companyName, periodLabel, generatedAt, filtersApplied,
 * sourceLabel, columns: [{ key, label, format, totalled }], rows, totals,
 * totalLabels } — and gets the same document the accounting reports print:
 * the company's own letterhead and colours from its default Bill template.
 * Nothing is recomputed here; every figure is the one on screen.
 */
export async function brandedReportHtml(envelope, company) {
  const { data: layout } = await getAccountingReportInvoiceLayout(company.id);
  const template = selectReportInvoiceTemplate(layout ? [layout] : [], company.id);
  return brandAccountingReport(buildReportHtml(envelope), company, template);
}

export async function printReport(envelope, company) {
  const w = window.open("", "_blank");
  if (!w) throw new Error("Popup blocked");
  try {
    writeAndPrint(w, await brandedReportHtml(envelope, company));
  } catch (e) {
    w.close();
    throw e;
  }
}

export async function pdfReport(envelope, company, fileName) {
  await exportToPdf(await brandedReportHtml(envelope, company), fileName, {
    marginMm: 12, repeatTableHeader: ".accounting-table",
    orientation: (envelope.columns || []).length > 6 ? "landscape" : "portrait",
  });
}

export const fileSlug = (s) => (s || "report").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
