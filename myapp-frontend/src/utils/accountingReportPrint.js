import { invoiceBranding } from "./customerLedgerPrint";

export async function brandAccountingReport(html, company, template) {
  const brand = await invoiceBranding(template, company);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const header = doc.querySelector(".co");
  if (header) {
    header.className = "report-letterhead no-break";
    if (brand.branding) {
      header.innerHTML = brand.branding;
      if (!header.textContent.includes(company.name || "")) {
        const identity = doc.createElement("div");
        identity.textContent = company.name;
        header.appendChild(identity);
      }
    }
  }
  const table = [...doc.querySelectorAll("table")].find((el) => el.querySelector("thead"));
  table?.classList.add("accounting-table");
  // Scope report rules before the PDF renderer attaches them to the app DOM.
  for (const style of doc.querySelectorAll("style")) {
    style.textContent = style.textContent.replace(/(^|})([^{}]+)\{/g, (match, end, selectors) => {
      if (selectors.trim().startsWith("@")) return match;
      return `${end}${selectors.split(",").map((s) => s.trim() === "body"
        ? ".accounting-print" : `.accounting-print ${s.trim()}`).join(",")} {`;
    });
  }
  const theme = doc.createElement("style");
  theme.textContent = `
    @page { size:A4 ${doc.querySelector(".chk") || /A4 portrait/.test(html) ? "portrait" : "landscape"}; margin:12mm; }
    .accounting-print { font-family:${brand.font}; color:${brand.color}; margin:0; }
    .accounting-print * { box-sizing:border-box; }
    .accounting-print .report-letterhead { margin-bottom:16px; }
    .accounting-print .ttl,.accounting-print h3,.accounting-print tr.g td { color:${brand.headerColor}; }
    .accounting-print .ttl,.accounting-print tr.g td { background:${brand.headerBackground}; padding:6px; }
    .accounting-print th { background:${brand.headerBackground}; color:${brand.headerColor}; }
    .accounting-print table { font-family:inherit; font-size:11px; }
    .accounting-print td { overflow-wrap:anywhere; }
    .accounting-print .rule { border-color:${brand.color}; }
    .accounting-print tfoot { display:table-row-group; }
    .accounting-print tr,.accounting-print .no-break { break-inside:avoid; page-break-inside:avoid; }
    .accounting-print thead { display:table-header-group; }
  `;
  doc.head.appendChild(theme);
  const wrapper = doc.createElement("div");
  wrapper.className = "accounting-print";
  while (doc.body.firstChild) wrapper.appendChild(doc.body.firstChild);
  doc.body.appendChild(wrapper);
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}
