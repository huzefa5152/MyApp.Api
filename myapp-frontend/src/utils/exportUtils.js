import { saveAs } from "file-saver";

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
 * Export rendered template HTML to PDF.
 */
export async function exportToPdf(html, filename) {
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
    const imgData = canvas.toDataURL("image/jpeg", 0.98);
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = 210;
    const pageH = 297;
    const imgH = (canvas.height * pageW) / canvas.width;

    if (imgH <= pageH * 1.02) {
      pdf.addImage(imgData, "JPEG", 0, 0, pageW, Math.min(imgH, pageH));
    } else {
      const pageCanvasH = (canvas.width * pageH) / pageW;
      let y = 0;
      let pageNum = 0;
      while (y < canvas.height) {
        if (pageNum > 0) pdf.addPage();
        const sliceH = Math.min(pageCanvasH, canvas.height - y);
        const page = document.createElement("canvas");
        page.width = canvas.width;
        page.height = sliceH;
        page.getContext("2d").drawImage(canvas, 0, -y);
        const sliceData = page.toDataURL("image/jpeg", 0.98);
        const sliceMmH = (sliceH * pageW) / canvas.width;
        pdf.addImage(sliceData, "JPEG", 0, 0, pageW, sliceMmH);
        y += pageCanvasH;
        pageNum++;
      }
    }
    pdf.save(`${filename}.pdf`);
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
