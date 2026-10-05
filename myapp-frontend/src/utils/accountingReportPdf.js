import { createStyledContainer, parseHtml } from "./exportUtils";
import { choosePageCuts } from "./pdfPageCuts";

export async function renderAccountingReportIntoPdf(pdf, html) {
  const { default: html2canvas } = await import("html2canvas");
  const { css, bodyHtml } = parseHtml(html);
  const { wrapper, content } = createStyledContainer(css, bodyHtml);
  try {
    await content.ownerDocument.fonts.ready;
    await Promise.all([...content.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
    const table = content.querySelector(".accounting-table");
    let repeat = null;
    if (table?.querySelector("thead")) {
      repeat = table.cloneNode(false);
      repeat.appendChild(table.querySelector("thead").cloneNode(true));
      repeat.style.width = `${table.getBoundingClientRect().width}px`;
      const widths = [...table.querySelectorAll("thead th")].map((th) => th.getBoundingClientRect().width);
      repeat.querySelectorAll("th").forEach((th, i) => { th.style.width = `${widths[i]}px`; });
      table.parentElement.appendChild(repeat);
    }
    const options = { scale:2, useCORS:true, windowWidth:796 };
    const header = repeat ? await html2canvas(repeat, options) : null;
    repeat?.remove();
    const canvas = await html2canvas(content, options);
    const margin = 12;
    const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
    const width = pageW - margin * 2;
    const headerMm = header ? header.height * width / header.width : 0;
    const ratio = canvas.height / content.scrollHeight;
    const top = content.getBoundingClientRect().top;
    const cuts = [...content.querySelectorAll("tr,img,.no-break")]
      .filter((el) => !el.parentElement?.closest(".no-break"))
      .map((el) => Math.round((el.getBoundingClientRect().bottom - top) * ratio))
      .sort((a, b) => a - b);
    let start = 0, pages = 0;
    while (start < canvas.height) {
      if (pages) pdf.addPage();
      const headingHeight = pages ? headerMm : 0;
      const capacity = (pageH - margin * 2 - headingHeight) * canvas.width / width;
      const end = start + choosePageCuts(cuts.filter((c) => c > start).map((c) => c - start), capacity, canvas.height - start)[0];
      const slice = content.ownerDocument.createElement("canvas");
      slice.width = canvas.width;
      slice.height = end - start;
      slice.getContext("2d").drawImage(canvas, 0, -start);
      if (headingHeight) pdf.addImage(header.toDataURL("image/png"), "PNG", margin, margin, width, headingHeight);
      pdf.addImage(slice.toDataURL("image/jpeg", .98), "JPEG", margin, margin + headingHeight, width, slice.height * width / canvas.width);
      start = end;
      pages++;
    }
    return pages;
  } finally { wrapper.remove(); }
}

export async function downloadAccountingReportPdf(html, filename, orientation) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({unit:"mm",format:"a4",orientation});
  await renderAccountingReportIntoPdf(pdf, html);
  pdf.save(`${filename}.pdf`);
}
