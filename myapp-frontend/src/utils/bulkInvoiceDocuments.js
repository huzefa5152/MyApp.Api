/**
 * Turn a resolved bulk batch into files. ONE implementation, used verbatim by
 * the internal Invoices screen and by the public Customer Portal.
 *
 * ── Why the rendering is here and not on the server ─────────────────────────
 * This solution has no server-side PDF writer, and the templates are arbitrary
 * HTML + CSS (flex, grid, `position: fixed`), so a .NET PDF library cannot
 * render them without rewriting all ~233 templates. "The PDF engine" is the
 * browser: utils/exportUtils.js rasterises the merged document with
 * html2canvas and paginates it with jsPDF. The split is therefore
 *
 *     server  ->  authorization, selection, template resolution, naming
 *     browser ->  merge, render, PDF, ZIP, consolidated document
 *
 * and BOTH surfaces call the same server service and then this module. A bulk
 * PDF of one invoice is byte-comparable with the one-off PDF of that invoice
 * because it is produced by the same call.
 *
 * ── Why consolidated print is ONE PDF, not concatenated HTML ────────────────
 * The obvious approach -- merge each invoice's HTML into a single document with
 * page-break divs -- cannot work with our templates, for a measured reason.
 * utils/printLayout.js pins the signature with `position: fixed; bottom: 0`,
 * because that is the only thing Blink repeats at the bottom of every printed
 * page. A document contains ONE such element, so invoice 1's signature would
 * print on every page of invoices 2..N. There is no way to scope a fixed
 * element to a page range. On top of that, template CSS is not namespaced, so
 * two invoices on different templates would have their rules collide, and
 * mergeTemplate() emits a whole document (<head>, <base>, <style>) each time.
 *
 * So each invoice is rendered on its own -- exactly as it is when printed
 * alone -- and appended to one jsPDF as real pages. Page breaks are then
 * physical PDF pages: invoice 2 cannot bleed into invoice 1, each keeps its own
 * signature and header, multi-page invoices already work, and there is no
 * "bulk template" to drift away from the real one.
 */
import { saveAs } from "file-saver";
import { mergeTemplate } from "./templateEngine";
import { renderIntoPdf } from "./exportUtils";

/**
 * Resolve the stamp URL a template's {{stamp}} slot should carry.
 *
 * The server sends the slug -> path map for THAT template's stamp only (never
 * the company's whole stamp library), mirroring the single-invoice portal
 * payload. A stamped template must stay stamped or the customer's copy differs
 * from the office's.
 */
function stampFor(template) {
  const map = template?.stampMap || {};
  const first = Object.keys(map)[0];
  return first ? map[first] : null;
}

/**
 * Merge one invoice through the ordinary single-invoice renderer.
 *
 * This is the one place a bulk document is built, and it deliberately does
 * nothing special: same mergeTemplate, same print data, same stamp handling as
 * a one-off print. If a bulk document is ever wrong, it is wrong for a single
 * print too.
 */
function mergeOne(batch, entry) {
  const template = batch.templates.find((t) => t.id === entry.templateId);
  if (!template) throw new Error("The template for this invoice was not sent with the batch.");
  return mergeTemplate(template.htmlContent, { ...entry.printData, stamp: stampFor(template) });
}

/**
 * Render every invoice in the batch, reporting progress and honouring a cancel
 * signal between documents.
 *
 * SEQUENTIAL on purpose. Each page is rasterised at scale 2 (~2.3 megapixels)
 * and held as a JPEG until the document is written, so rendering in parallel
 * multiplies peak memory by the concurrency for no wall-clock gain -- the work
 * is one main-thread canvas at a time regardless.
 *
 * A document that throws is recorded and the run continues. One malformed
 * template must not cost the operator the other 47 invoices.
 */
async function renderEach(batch, { onProgress, shouldCancel, makePdf, onDocument }) {
  const failures = [];
  const total = batch.invoices.length;
  let done = 0;

  for (const entry of batch.invoices) {
    if (shouldCancel?.()) return { failures, cancelled: true, done };
    onProgress?.({ done, total, current: entry.fileNameBase });
    try {
      const html = mergeOne(batch, entry);
      const { pdf, isFirstOnThisPdf } = await makePdf(entry, done);
      await renderIntoPdf(pdf, html, { newPage: !isFirstOnThisPdf });
      await onDocument?.(entry, pdf);
    } catch (err) {
      failures.push({
        invoiceNumber: entry.invoiceNumber,
        reference: entry.reference,
        reason: err?.message || "This document could not be rendered.",
      });
    }
    done += 1;
    onProgress?.({ done, total, current: null });
  }
  return { failures, cancelled: false, done };
}

/**
 * "Download all PDFs" — one PDF per invoice, bundled into a ZIP.
 *
 * jszip is already in the dependency tree, so the archive is built in the
 * browser and the PDF bytes never cross the network: the server sent ~1 MB of
 * merge data and receives nothing back.
 */
export async function downloadInvoiceZip(batch, opts = {}) {
  const [{ default: JSZip }, { default: jsPDF }] = await Promise.all([
    import("jszip"),
    import("jspdf"),
  ]);
  const zip = new JSZip();
  let written = 0;

  const result = await renderEach(batch, {
    ...opts,
    makePdf: () => ({ pdf: new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" }), isFirstOnThisPdf: true }),
    onDocument: (entry, pdf) => {
      // arraybuffer, not a data URI: a base64 string of a multi-megabyte PDF
      // is ~33% larger and has to be decoded again by JSZip.
      zip.file(`${entry.fileNameBase}.pdf`, pdf.output("arraybuffer"));
      written += 1;
    },
  });

  if (result.cancelled) return { ...result, saved: false, written };
  if (written === 0) return { ...result, saved: false, written };

  // One invoice is not an archive. Hand over the PDF itself, named as it would
  // have been inside the ZIP.
  if (written === 1 && batch.invoices.length === 1) {
    const only = batch.invoices[0];
    const single = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    await renderIntoPdf(single, mergeOne(batch, only), {});
    single.save(`${only.fileNameBase}.pdf`);
    return { ...result, saved: true, written, single: true };
  }

  opts.onProgress?.({ done: batch.invoices.length, total: batch.invoices.length, current: "Building the archive" });
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  saveAs(blob, `${batch.fileNameBase}.zip`);
  return { ...result, saved: true, written };
}

/**
 * "Consolidated print" — every invoice in one PDF, each starting on its own
 * page, each keeping its own layout. See the module header for why this is a
 * PDF of real pages rather than one long HTML document.
 */
export async function downloadConsolidatedPdf(batch, opts = {}) {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let rendered = 0;

  const result = await renderEach(batch, {
    ...opts,
    // Every invoice draws into the SAME instance. The first document to render
    // successfully owns page one; each later one opens its own page. Keyed on
    // what has actually been rendered, not on the loop index, so a document
    // that fails does not leave a blank sheet behind it.
    makePdf: () => ({ pdf, isFirstOnThisPdf: rendered === 0 }),
    onDocument: () => { rendered += 1; },
  });

  if (result.cancelled || rendered === 0) return { ...result, saved: false, written: rendered };
  pdf.save(`${batch.fileNameBase}.pdf`);
  return { ...result, saved: true, written: rendered };
}
