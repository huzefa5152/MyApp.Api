import { saveAs } from "file-saver";
import { choosePageCuts } from "./pdfPageCuts";

/**
 * Parse full HTML document, extract CSS from <style> tags and body content.
 */
function parseHtml(html) {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  let css = "";
  if (styleMatch) {
    css = styleMatch.map((s) => s.replace(/<\/?style[^>]*>/gi, "")).join("\n");
  }
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch
    ? bodyMatch[1]
    : html.replace(/<html[^>]*>|<\/html>|<head>[\s\S]*?<\/head>|<!DOCTYPE[^>]*>/gi, "");
  return { css, bodyHtml };
}

/**
 * Create a styled container in the main document for PDF rendering.
 */
function createStyledContainer(css, bodyHtml) {
  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "position:fixed;left:-9999px;top:0;width:796px;z-index:-1;background:#fff;";

  let scopedCss = css.replace(/\bbody\b/g, ".pdf-content");
  scopedCss = scopedCss.replace(/min-height\s*:\s*100vh\s*;?/g, "");
  scopedCss += "\n.pdf-content{box-sizing:border-box;width:796px;}";

  const style = document.createElement("style");
  style.textContent = scopedCss;
  wrapper.appendChild(style);

  const content = document.createElement("div");
  content.className = "pdf-content";
  content.innerHTML = bodyHtml;
  wrapper.appendChild(content);

  document.body.appendChild(wrapper);
  return { wrapper, content };
}

/**
 * Lift the page-bottom signature out of the captured flow.
 *
 * utils/printLayout.js pins the signature with `position: fixed`, which the
 * browser repeats on every printed page. html2canvas has no pages — it paints
 * one tall bitmap — so a fixed element would be captured once, at whatever the
 * real viewport happened to be. Instead the signature is moved into a sibling
 * container (carrying the same `.pdf-content` class, so the scoped template CSS
 * still applies), rasterised on its own, and stamped onto the bottom of every
 * PDF page below. The hidden spacer printLayout put in the item table's <tfoot>
 * stays behind, so the reserved strip is still there and nothing collides.
 */
function detachPrintFooter(wrapper, content) {
  const footer = content.querySelector(".mpl-fixed");
  if (!footer) return null;
  const holder = document.createElement("div");
  holder.className = "pdf-content";
  holder.style.cssText = "box-sizing:border-box;width:796px;";
  footer.style.position = "static";
  // The holder already carries the template's body padding; keep the wrapper's
  // inherited copy from doubling it.
  footer.style.paddingLeft = "0";
  footer.style.paddingRight = "0";
  holder.appendChild(footer);
  wrapper.appendChild(holder);
  return holder;
}

/**
 * Export rendered template HTML to PDF.
 */
/**
 * Where the rasterised page may be cut WITHOUT slicing a line item in half.
 *
 * html2canvas paints the whole document as one continuous bitmap — it has no
 * concept of a page — so a template's `page-break-inside: avoid` does nothing
 * on this path. The slicer used to advance by a fixed number of pixels, which
 * put the page boundary wherever it happened to fall: on a 40-line invoice a
 * row was sliced through the middle, its top half at the foot of page 1 and its
 * bottom half at the head of page 2. Neither half is readable, so the line item
 * is effectively missing from the document.
 *
 * This returns the BOTTOM EDGE of every block that must not be broken, in
 * canvas pixels, so the slicer can cut in the gap between rows instead. The
 * selector matches what printDocument.js protects on the browser print path
 * (`tr`, `img`, `.no-break`), so the PDF and the print break in the same places.
 *
 * A block is never itself forced to fit: if a row is taller than a page it
 * still has to be cut, and the caller falls back to the hard limit.
 */
function atomicCutPoints(content, scale) {
  const top = content.getBoundingClientRect().top;
  const points = new Set();
  for (const el of content.querySelectorAll("tr, img, .no-break")) {
    const r = el.getBoundingClientRect();
    if (r.height <= 0) continue;
    points.add(Math.round((r.bottom - top) * scale));
  }
  return [...points].sort((a, b) => a - b);
}

/**
 * Draw one document into an existing jsPDF, starting a new page when the
 * caller already owns page one.
 *
 * Split out of exportToPdf so a bulk operation can append many documents to one
 * PDF without a second renderer: a consolidated invoice pack is then a sequence
 * of real pages, each drawn exactly as that document prints on its own.
 */
export async function renderIntoPdf(pdf, html, opts = {}) {
  const { default: html2canvas } = await import("html2canvas");
  // Every document after the first opens its own page. That is what keeps
  // invoice 2 off the end of invoice 1 -- a physical page break, not a CSS one
  // the rasteriser would ignore.
  if (opts.newPage) pdf.addPage();
  const { css, bodyHtml } = parseHtml(html);
  const { wrapper, content } = createStyledContainer(css, bodyHtml);
  const footerHolder = detachPrintFooter(wrapper, content);

  await new Promise((r) => setTimeout(r, 400));

  try {
    const canvas = await html2canvas(content, {
      scale: 2,
      useCORS: true,
      letterRendering: true,
      windowWidth: 796,
    });
    const footerCanvas = footerHolder
      ? await html2canvas(footerHolder, { scale: 2, useCORS: true, letterRendering: true, windowWidth: 796 })
      : null;
    const imgData = canvas.toDataURL("image/jpeg", 0.98);
    const pageW = 210;
    const pageH = 297;
    const imgH = (canvas.height * pageW) / canvas.width;
    const marginMm = 8;

    // Same signature on the bottom of every page as the print path produces.
    const footerData = footerCanvas && footerCanvas.height
      ? footerCanvas.toDataURL("image/png")
      : null;
    const footerMmH = footerData ? (footerCanvas.height * pageW) / footerCanvas.width : 0;
    const stampFooter = () => {
      if (footerData) pdf.addImage(footerData, "PNG", 0, pageH - marginMm - footerMmH, pageW, footerMmH);
    };

    let pagesAdded = 0;
    if (imgH <= pageH * 1.02) {
      pdf.addImage(imgData, "JPEG", 0, 0, pageW, Math.min(imgH, pageH));
      stampFooter();
      pagesAdded = 1;
    } else {
      // Multi-page: leave a top + bottom white margin on EVERY page so
      // consecutive pages don't butt together — page 1 ends with a bottom
      // margin and page 2 starts with a top margin (previously the tall image
      // was sliced edge-to-edge at exact A4 heights, so the break looked
      // "combined" and rows were cut flush). Content is sliced into
      // (pageH − 2·margin) tall bands, each drawn `marginMm` down from the top.
      const contentMm = pageH - marginMm * 2;
      const pageCanvasH = (canvas.width * contentMm) / pageW;   // slice height in canvas px

      // Cut in the gaps between rows rather than at fixed offsets. The scale is
      // MEASURED off the canvas rather than assumed: html2canvas rounds, and a
      // half-pixel error compounds down a long document.
      const cuts = atomicCutPoints(content, canvas.height / (content.scrollHeight || 1));
      const pageEnds = choosePageCuts(cuts, pageCanvasH, canvas.height);

      let y = 0;
      let pageNum = 0;
      for (const end of pageEnds) {
        if (pageNum > 0) pdf.addPage();
        const sliceH = end - y;
        const page = document.createElement("canvas");
        page.width = canvas.width;
        page.height = sliceH;
        page.getContext("2d").drawImage(canvas, 0, -y);
        const sliceData = page.toDataURL("image/jpeg", 0.98);
        const sliceMmH = (sliceH * pageW) / canvas.width;
        pdf.addImage(sliceData, "JPEG", 0, marginMm, pageW, sliceMmH);
        stampFooter();
        y = end;
        pageNum++;
      }
      pagesAdded = pageNum;
    }
    return pagesAdded;
  } finally {
    document.body.removeChild(wrapper);
  }
}

/**
 * Render HTML to a PDF and save it. The original one-document entry point,
 * behaviour unchanged -- it now just owns the jsPDF instance and the save,
 * while renderIntoPdf above does the drawing. Every bulk operation reuses that
 * same primitive, so a bulk PDF of one invoice is identical to this one.
 */
export async function exportToPdf(html, filename) {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  await renderIntoPdf(pdf, html);
  pdf.save(`${filename}.pdf`);
}

/**
 * Export rendered template HTML to Excel with the template as an embedded image.
 * This produces an exact visual match with the print/PDF output.
 */
export async function exportToExcel(html, filename, sheetName) {
  const [ExcelJS, { default: html2canvas }] = await Promise.all([
    import("exceljs"),
    import("html2canvas"),
  ]);

  const { css, bodyHtml } = parseHtml(html);
  const { wrapper, content } = createStyledContainer(css, bodyHtml);
  // One sheet, one image, no pages — so the signature simply flows at the end
  // and the reserved strip printLayout put in the <tfoot> comes back out.
  const pinned = content.querySelector(".mpl-fixed");
  if (pinned) pinned.style.position = "static";
  content.querySelectorAll(".mpl-spacer").forEach((el) => el.remove());

  await new Promise((r) => setTimeout(r, 400));

  try {
    const canvas = await html2canvas(content, {
      scale: 2,
      useCORS: true,
      letterRendering: true,
      windowWidth: 796,
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetName || "Sheet1", {
      pageSetup: {
        paperSize: 9,
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: {
          left: 0.25, right: 0.25,
          top: 0.25, bottom: 0.25,
          header: 0, footer: 0,
        },
      },
    });

    const colCount = 10;
    const colWidth = 10.5;
    for (let c = 1; c <= colCount; c++) {
      ws.getColumn(c).width = colWidth;
    }

    // Calculate A4 page height in canvas pixels
    // A4 aspect ratio: 297/210 = 1.4143
    const pageCanvasH = Math.floor(canvas.width * (297 / 210));
    const totalPages = Math.ceil(canvas.height / pageCanvasH);
    const rowHeight = 15;
    const totalWidthPx = colCount * colWidth * 7.5;
    const pageRowSpan = Math.ceil((totalWidthPx * (297 / 210)) / rowHeight);
    let currentRow = 0;

    for (let p = 0; p < totalPages; p++) {
      const srcY = p * pageCanvasH;
      const sliceH = Math.min(pageCanvasH, canvas.height - srcY);

      // Slice the canvas for this page
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceH;
      const ctx = pageCanvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

      const sliceBase64 = pageCanvas.toDataURL("image/png").split(",")[1];
      const imgId = wb.addImage({ base64: sliceBase64, extension: "png" });

      // Calculate row span for this slice (may be shorter on last page)
      const sliceRatio = sliceH / canvas.width;
      const sliceRowSpan = Math.ceil((totalWidthPx * sliceRatio) / rowHeight);

      // Set row heights
      for (let r = currentRow + 1; r <= currentRow + sliceRowSpan; r++) {
        ws.getRow(r).height = rowHeight;
      }

      ws.addImage(imgId, {
        tl: { col: 0, row: currentRow },
        br: { col: colCount, row: currentRow + sliceRowSpan },
      });

      currentRow += sliceRowSpan;

      // Add horizontal page break between pages (not after last)
      if (p < totalPages - 1) {
        ws.getRow(currentRow).addPageBreak();
      }
    }

    // Set print area covering all pages
    ws.pageSetup.printArea = `A1:${String.fromCharCode(64 + colCount)}${currentRow}`;

    const buf = await wb.xlsx.writeBuffer();
    saveAs(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${filename}.xlsx`
    );
  } finally {
    document.body.removeChild(wrapper);
  }
}
