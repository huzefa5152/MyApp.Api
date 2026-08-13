import { saveAs } from "file-saver";

/**
 * Parse full HTML document, extract CSS from <style> tags and body content.
 */
export function parseHtml(html) {
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
 * Lift the rules inside every `@media print { … }` block up to the top level.
 *
 * The offscreen container we rasterise renders in *screen* media, so a
 * template's print-only rules — crucially `page-break-inside: avoid` on the
 * FBR box, the totals block and the signature footer — would never reach the
 * computed style. Unwrapping them lets the pagination pass below read those
 * declarations back out via getComputedStyle and honour them when it picks
 * page-cut positions. Any `@page` rule swept up with them is inert on screen.
 */
function unwrapPrintMedia(css) {
  const re = /@media[^{]*\bprint\b[^{]*\{/gi;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(css)) !== null) {
    out += css.slice(last, m.index);
    let depth = 1;
    let j = re.lastIndex;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    out += css.slice(re.lastIndex, Math.max(re.lastIndex, j - 1));
    last = j;
    re.lastIndex = j;
  }
  return out + css.slice(last);
}

/**
 * Create a styled container in the main document for PDF rendering.
 */
export function createStyledContainer(css, bodyHtml) {
  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "position:fixed;left:-9999px;top:0;width:796px;z-index:-1;background:#fff;";

  let scopedCss = unwrapPrintMedia(css).replace(/\bbody\b/g, ".pdf-content");
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

const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MULTIPAGE_MARGIN_MM = 8;

// A document that overflows one page by only a little is shrunk to fit rather
// than spilling a stub onto page 2.
//
// The tax invoice pads its item table to a fixed 20 rows, so every invoice up
// to 20 items renders at the same height — measured 289mm (Arial) to 308mm
// (Segoe UI) depending on which fonts the operator's machine actually has.
// Against a 297mm page that is a worst case of 0.964, so 0.94 keeps all of
// them on one page on every machine while leaving a genuinely long invoice
// (25+ items, past 320mm) to paginate properly.
const MIN_FIT_SCALE = 0.94;

// An element only counts as unbreakable if it would actually fit inside a
// page; past this share of the usable height it has to be sliced or nothing
// could ever be paginated.
const MAX_ATOMIC_SHARE = 0.5;

/**
 * Measure the vertical bands (in canvas pixels) that a page cut must not fall
 * inside. Rasterised output has no notion of a page break, so without this the
 * slicer guillotines whatever straddles the boundary — mid-glyph text, half a
 * QR code, the top half of the FBR box.
 *
 * Atomic = anything the template marked `page-break-inside: avoid`, plus table
 * rows, images, text leaves, and any bordered/filled box small enough to fit a
 * page. That last rule is what protects the FBR block in the templates already
 * stored per company, which mark it with an inline border and no class hook.
 */
export function collectAtomicBands(root, pxRatio, maxBandPx) {
  const rootTop = root.getBoundingClientRect().top;
  const bands = [];

  root.querySelectorAll("*").forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0 || rect.height > maxBandPx) return;

    const cs = window.getComputedStyle(el);
    const tag = el.tagName;
    let atomic =
      cs.breakInside === "avoid" ||
      cs.pageBreakInside === "avoid" ||
      tag === "TR" ||
      tag === "IMG" ||
      (el.children.length === 0 && (el.textContent || "").trim() !== "");

    if (!atomic) {
      const borders = [
        cs.borderTopWidth, cs.borderRightWidth,
        cs.borderBottomWidth, cs.borderLeftWidth,
      ];
      const hasBorder = borders.some((w) => parseFloat(w) > 0);
      const bg = cs.backgroundColor;
      const hasFill = !!bg && bg !== "transparent" && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(bg);
      atomic = hasBorder || hasFill;
    }
    if (!atomic) return;

    bands.push({
      start: (rect.top - rootTop) * pxRatio,
      end: (rect.bottom - rootTop) * pxRatio,
    });
  });

  return bands;
}

/**
 * Pull a proposed cut upwards until it no longer lands inside an atomic band.
 * Returns the original cut when no safe position leaves forward progress —
 * a forced cut is still better than an infinite loop.
 */
export function safeCut(bands, from, proposed) {
  let cut = proposed;
  // Nested boxes mean lifting the cut above one band can drop it inside an
  // outer one, so keep sweeping until a pass changes nothing.
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const b of bands) {
      if (b.start < cut && b.end > cut) {
        cut = b.start;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return cut > from ? cut : proposed;
}

/**
 * Export rendered template HTML to PDF.
 *
 * Returns the pagination decision it made — `{ mode, pages, scale, heightPx,
 * cuts }` — and, if `opts.onLayout` is supplied, calls it with the same object
 * plus the still-mounted `content` element just before teardown. Both exist so
 * `scripts/test_pdf_pagination.py` can assert against a real export run
 * instead of re-implementing the decision; normal callers ignore the return.
 */
export async function exportToPdf(html, filename, opts = {}) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const { css, bodyHtml } = parseHtml(html);
  const { wrapper, content } = createStyledContainer(css, bodyHtml);

  await new Promise((r) => setTimeout(r, 400));

  try {
    const canvas = await html2canvas(content, {
      scale: 2,
      useCORS: true,
      letterRendering: true,
      windowWidth: 796,
    });
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const layout = paginateOntoPdf(pdf, canvas, content);

    if (typeof opts.onLayout === "function") opts.onLayout({ ...layout, content });
    pdf.save(`${filename}.pdf`);
    return layout;
  } finally {
    document.body.removeChild(wrapper);
  }
}

/**
 * Draw a rasterised document onto a jsPDF instance, choosing the page layout.
 *
 * Shared by every rasterising export path so none of them can regress to
 * slicing the bitmap at blind fixed offsets — which is what cut the FBR box,
 * and half its verification QR, across a page boundary in production.
 *
 * Returns the decision it made: `{ mode, pages, scale, cuts, ... }`.
 */
function paginateOntoPdf(pdf, canvas, content) {
  const imgH = (canvas.height * PAGE_W_MM) / canvas.width;   // natural height in mm
  const oneFitScale = PAGE_H_MM / imgH;
  const layout = {
    mode: "", pages: 1, scale: 1, cuts: [],
    heightPx: canvas.height, heightMm: imgH, oneFitScale,
    pxRatio: content.offsetHeight > 0 ? canvas.height / content.offsetHeight : 1,
  };

  {
    if (oneFitScale >= 1) {
      // Fits as-is. Drawn edge-to-edge at natural size — the template supplies
      // its own page padding, so no extra margin here.
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.98), "JPEG", 0, 0, PAGE_W_MM, imgH);
      layout.mode = "natural";
    } else if (oneFitScale >= MIN_FIT_SCALE) {
      // Slight overflow (font-substitution on a machine without Calibri is the
      // usual cause): shrink uniformly onto one page instead of spilling a
      // fragment — and a fragment of the FBR box at that — onto page 2.
      const drawW = PAGE_W_MM * oneFitScale;
      pdf.addImage(
        canvas.toDataURL("image/jpeg", 0.98), "JPEG",
        (PAGE_W_MM - drawW) / 2, 0, drawW, PAGE_H_MM,
      );
      layout.mode = "shrink";
      layout.scale = oneFitScale;
    } else {
      // Genuinely multi-page (30-40 line items). Every page keeps a top and
      // bottom white margin so consecutive pages don't butt together, and each
      // cut is pulled up to the nearest position that doesn't run through a
      // row, an image, a line of text or the FBR box.
      const usableMm = PAGE_H_MM - MULTIPAGE_MARGIN_MM * 2;
      const maxSlicePx = (canvas.width * usableMm) / PAGE_W_MM;
      const pxRatio = content.offsetHeight > 0 ? canvas.height / content.offsetHeight : 1;
      const bands = collectAtomicBands(content, pxRatio, maxSlicePx * MAX_ATOMIC_SHARE);

      let y = 0;
      let pageNum = 0;
      while (y < canvas.height) {
        if (pageNum > 0) pdf.addPage();
        const proposed = Math.min(y + maxSlicePx, canvas.height);
        const end = proposed >= canvas.height ? canvas.height : safeCut(bands, y, proposed);
        const sliceH = end - y;

        const page = document.createElement("canvas");
        page.width = canvas.width;
        page.height = Math.ceil(sliceH);
        const ctx = page.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, page.width, page.height);
        ctx.drawImage(canvas, 0, -y);

        pdf.addImage(
          page.toDataURL("image/jpeg", 0.98), "JPEG",
          0, MULTIPAGE_MARGIN_MM, PAGE_W_MM, (page.height * PAGE_W_MM) / canvas.width,
        );
        y = end;
        pageNum++;
        layout.cuts.push(end);
      }
      layout.mode = "multipage";
      layout.pages = pageNum;
    }
  }

  return layout;
}

// Wrapper class every merged page gets. The template's own `body` rules are
// rescoped onto it (same rewrite createStyledContainer performs), so each page
// keeps the template's padding / font / colours.
const MERGED_PAGE_CLASS = "print-page";

/**
 * Concatenate several rendered template documents into ONE printable A4
 * document, each original document becoming a page that breaks after itself.
 *
 * Used by the Sales report's bulk export. Unlike exportToPdf this never
 * rasterizes — the browser's own print engine lays the pages out — so the
 * output is vector text and the cost is independent of the invoice count.
 * That's what makes a 500-invoice month viable; html2canvas at ~1-2s per
 * invoice is not.
 *
 * All documents come from the same template, so the <style> block is emitted
 * once (deduped) rather than repeated per page.
 */
export function buildMergedPrintDocument(htmlDocs, title = "Tax Invoices") {
  const cssBlocks = new Set();
  const pages = [];

  for (const doc of htmlDocs) {
    const { css, bodyHtml } = parseHtml(doc);
    const scoped = css
      .replace(/\bbody\b/g, `.${MERGED_PAGE_CLASS}`)
      // A template sized to fill the viewport would collapse or overflow once
      // it's one of many stacked pages — the page box below sets the real size.
      .replace(/min-height\s*:\s*100vh\s*;?/g, "")
      .replace(/height\s*:\s*100%\s*;?/g, "");
    if (scoped.trim()) cssBlocks.add(scoped);
    pages.push(`<div class="${MERGED_PAGE_CLASS}">${bodyHtml}</div>`);
  }

  // Page-box rules come AFTER the template CSS so the A4 sizing and the break
  // behaviour win, while the template's padding and typography survive.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
</style>
<style>${[...cssBlocks].join("\n")}</style>
<style>
  .${MERGED_PAGE_CLASS} {
    box-sizing: border-box;
    width: 210mm;
    /* min-height, NOT height, and deliberately no overflow:hidden — an invoice
       with enough line items must flow onto a second printed page. Clipping it
       to one page would silently drop line items from the customer's document. */
    min-height: 297mm;
    page-break-after: always;
    break-after: page;
  }
  .${MERGED_PAGE_CLASS}:last-child { page-break-after: auto; break-after: auto; }
  @media print {
    /* Keep a page cut from running through a table row, an image, or the FBR
       box — a sliced QR does not scan. The default template carries its own
       .fbr-block rule, but company templates stored in the DB do not, so it's
       restated here to cover every template. */
    .${MERGED_PAGE_CLASS} tr,
    .${MERGED_PAGE_CLASS} img,
    .${MERGED_PAGE_CLASS} .no-break,
    .${MERGED_PAGE_CLASS} .fbr-block { page-break-inside: avoid; break-inside: avoid; }
    .${MERGED_PAGE_CLASS} thead { display: table-header-group; }
  }
</style></head><body>${pages.join("")}</body></html>`;
}

/**
 * Print a complete HTML document through a hidden iframe.
 *
 * Resolves once the print dialog has been handed off. Images are awaited first
 * — printing before a logo or the FBR QR has decoded silently drops it from the
 * output. The iframe is torn down on a delay because removing it while the
 * dialog is still opening aborts the job in some browsers.
 */
export async function printHtmlDocument(html) {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    // Off-screen rather than hidden: `visibility:hidden` / `display:none`
    // stops some browsers rendering the frame at all, which prints a blank page.
    iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;";
    iframe.setAttribute("aria-hidden", "true");

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      try { document.body.removeChild(iframe); } catch { /* already gone */ }
      resolve();
    };

    iframe.onload = async () => {
      const win = iframe.contentWindow;
      if (!win) { cleanup(); return; }
      try {
        await Promise.all(
          Array.from(win.document.images).map((img) =>
            img.complete
              ? Promise.resolve(img.decode?.()).catch(() => {})
              : new Promise((r) => { img.onload = r; img.onerror = r; })
          )
        );
      } catch { /* a broken image must not block the print */ }

      // Let layout settle after the images resolve.
      await new Promise((r) => setTimeout(r, 200));
      try {
        win.focus();
        win.print();
      } catch { /* dialog blocked — fall through to cleanup */ }
      setTimeout(cleanup, 1500);
    };

    document.body.appendChild(iframe);
    iframe.srcdoc = html;
  });
}

/**
 * Render one template document to a PDF Blob instead of saving it.
 *
 * Same pipeline as exportToPdf — shared so the ZIP export and the single-file
 * download can never drift visually — but returns the bytes so a caller can
 * pack many into an archive.
 */
export async function renderPdfBlob(html) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const { css, bodyHtml } = parseHtml(html);
  const { wrapper, content } = createStyledContainer(css, bodyHtml);

  await new Promise((r) => setTimeout(r, 400));

  try {
    const canvas = await html2canvas(content, {
      scale: 2,
      useCORS: true,
      letterRendering: true,
      windowWidth: 796,
    });
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    paginateOntoPdf(pdf, canvas, content);
    return pdf.output("blob");
  } finally {
    document.body.removeChild(wrapper);
  }
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
