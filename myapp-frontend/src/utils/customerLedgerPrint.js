import { mergeTemplate } from "./templateEngine";
import { defaultBillTemplate } from "./defaultTemplates";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (value) => {
  const n = Number(value || 0);
  const text = Math.abs(n).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${text})` : text;
};
const date = (value) => value ? new Date(value).toLocaleDateString("en-GB", {
  day: "2-digit", month: "short", year: "numeric",
}) : "";

export function selectLedgerInvoiceTemplate(templates, companyId, divisionId) {
  const owned = templates.filter((t) => Number(t.companyId) === Number(companyId));
  const scopes = divisionId ? [Number(divisionId), null] : [null];
  for (const scope of scopes) {
    for (const type of ["Bill", "TaxInvoice"]) {
      const list = owned.filter((t) => t.templateType === type
        && (t.divisionId == null ? null : Number(t.divisionId)) === scope)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.id - b.id);
      if (list[0]?.htmlContent) return list[0];
    }
  }
  return { htmlContent: defaultBillTemplate };
}

// Keep only the invoice's company merge-field branches. Flatten their computed
// styles in an isolated frame so invoice CSS cannot restyle the ledger table.
async function invoiceBranding(template, company) {
  const source = new DOMParser().parseFromString(template.htmlContent, "text/html");
  const companyField = /\{\{\{?\s*(?:nl2br\s+)?company(?:BrandName|Name|LogoPath|Address|Phone|Email|NTN|STRN)\b/;
  for (const el of source.body.querySelectorAll("*")) {
    const direct = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
    if (companyField.test(direct) || [...el.attributes].some((a) => companyField.test(a.value))) {
      el.setAttribute("data-ledger-brand", "");
    }
  }
  const html = mergeTemplate(source.documentElement.outerHTML, {
    companyBrandName: company.brandName || company.name,
    companyName: company.name,
    companyLogoPath: company.logoPath || "",
    companyAddress: company.fullAddress || "",
    companyPhone: company.phone || "",
    companyEmail: company.email || "",
    companyNTN: company.ntn || "",
    companySTRN: company.strn || "",
    items: [],
  });
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = "position:fixed;left:-10000px;width:705px;height:1000px;visibility:hidden;border:0";
  try {
    await new Promise((resolve) => {
      frame.onload = resolve;
      frame.srcdoc = html;
      document.body.appendChild(frame);
    });
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    await doc.fonts.ready;
    const bodyStyle = view.getComputedStyle(doc.body);
    const headerStyle = doc.querySelector("thead th") ? view.getComputedStyle(doc.querySelector("thead th")) : null;
    const theme = { font: bodyStyle.fontFamily, color: bodyStyle.color,
      headerBackground: headerStyle?.backgroundColor || "#f1f4f8", headerColor: headerStyle?.color || "#1a2332" };
    const properties = ["font-family", "font-size", "font-weight", "font-style", "color", "background-color",
      "text-align", "text-transform", "letter-spacing", "line-height", "display", "align-items", "justify-content",
      "flex-direction", "gap", "padding", "margin", "border", "border-radius", "height", "max-width", "object-fit"];
    function cloneBrand(el) {
      if (el.matches("img") && !el.getAttribute("src")) return null;
      if (!el.matches("[data-ledger-brand]") && !el.querySelector("[data-ledger-brand]")) return null;
      const clone = el.cloneNode(false);
      const style = view.getComputedStyle(el);
      clone.removeAttribute("style");
      properties.forEach((p) => clone.style.setProperty(p, style.getPropertyValue(p)));
      if (!el.matches("img")) {
        clone.style.height = "auto";
        clone.style.marginTop = "0";
        clone.style.marginBottom = "0";
      }
      clone.style.maxWidth = "100%";
      if (el.matches("img")) {
        clone.style.width = style.width;
        clone.style.height = "auto";
      }
      if (!el.matches("[data-ledger-brand]") && !el.matches(".letterhead,.hdr,.brand-row,.header-left")) clone.style.padding = "0";
      clone.style.whiteSpace = "normal";
      clone.style.overflowWrap = "anywhere";
      if (el.matches("[data-ledger-brand]")) clone.innerHTML = el.innerHTML;
      else for (const child of el.children) {
        const kept = cloneBrand(child);
        if (kept) clone.appendChild(kept);
      }
      if (!clone.textContent.trim() && !clone.querySelector("img") && !clone.matches("img")) return null;
      return clone;
    }
    const branding = [...doc.body.children].map(cloneBrand).filter(Boolean).map((el) => el.outerHTML).join("");
    return { ...theme, branding };
  } finally {
    frame.remove();
  }
}

export async function buildCustomerLedgerHtml(report, company, template) {
  const brand = await invoiceBranding(template, company);
  const columns = report.columns || [];
  const cell = (row, col) => col.format === "money" ? money(row[col.key])
    : col.format === "date" ? date(row[col.key]) : row[col.key] ?? "";
  const numeric = (col) => col.format === "money" || col.format === "int";
  const headers = columns.map((c) => `<th class="${numeric(c) ? "num" : ""}">${escape(c.label)}</th>`).join("");
  const rowHtml = (report.rows || []).map((row) => `<tr>${columns.map((c) =>
    `<td class="${numeric(c) ? "num" : c.format === "date" ? "date" : ""}">${escape(cell(row, c))}</td>`).join("")}</tr>`);
  const summary = [["Opening balance", report.openingBalance], ["Invoiced / debits", report.totalDebit],
    ["Received / credits", report.totalCredit], ["Closing balance", report.closingBalance]];
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Customer Ledger</title><style>
    @page { size:A4 portrait; margin:12mm; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:${brand.font}; color:${brand.color}; font-size:12px; }
    .ledger-brand { margin-bottom:18px; }
    .ledger-heading { border-bottom:2px solid ${brand.color}; padding:0 0 10px; margin-bottom:14px; }
    h1 { font-size:23px; margin:0 0 5px; text-align:left; } .ledger-meta { font-size:11px; line-height:1.5; color:#52606d; }
    .ledger-party { font-size:14px; font-weight:700; margin:10px 0; }
    .ledger-summary { display:flex; gap:10px; margin:14px 0; }
    .ledger-summary div { flex:1; border:1px solid #cdd3da; padding:9px; border-radius:3px; }
    .ledger-summary span { display:block; font-size:10px; margin-bottom:5px; color:#52606d; }
    .ledger-summary strong { font-size:14px; }
    .ledger-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:12px; }
    .ledger-table th { background:${brand.headerBackground}; color:${brand.headerColor}; font-size:11px; }
    .ledger-table th,.ledger-table td { padding:8px 5px; border:1px solid #cdd3da; text-align:left; vertical-align:top; }
    .ledger-table td { overflow-wrap:anywhere; } .ledger-table .num { text-align:right; white-space:nowrap; }
    .ledger-table .date { white-space:nowrap; } thead { display:table-header-group; }
    tr,.no-break { break-inside:avoid; page-break-inside:avoid; }
    .ledger-total { font-weight:700; background:#f1f4f8; }
    .ledger-table .ledger-note { font-size:10px; line-height:1.5; padding-top:14px; border:none; color:#52606d; }
    @media print { * { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
  </style></head><body>
    <div class="ledger-repeat">
      <div class="ledger-brand">${brand.branding || `<div style="font-size:22px;font-weight:700">${escape(company.brandName || company.name)}</div>
        <div class="ledger-meta">${[company.fullAddress, company.phone].filter(Boolean).map(escape).join("<br>")}</div>`}</div>
      <div class="ledger-heading"><h1>Customer Ledger</h1><div class="ledger-meta">${escape(report.periodLabel)}</div>
        <div class="ledger-party">${escape(report.partyName || "All customers")}</div>
        <div class="ledger-meta">${escape((report.filtersApplied || []).join(" · "))}</div></div>
    </div>
    <div class="ledger-summary no-break">${summary.map(([label, value]) =>
      `<div><span>${label}</span><strong>${escape(money(value))}</strong></div>`).join("")}</div>
    <table class="ledger-table"><colgroup>${columns.map((c) => `<col${c.key === "description" ? "" : ` style="width:${
      numeric(c) ? "13%" : c.format === "date" ? "11%" : c.key === "reference" ? "10%" : "12%"}"`}>`).join("")}</colgroup>
      <thead><tr>${headers}</tr></thead><tbody>${rowHtml.slice(0, -1).join("")}</tbody>
      <tbody class="no-break">
      ${rowHtml.at(-1) || `<tr><td colspan="${columns.length}">No transactions in this period.</td></tr>`}
      <tr class="ledger-total">${columns.map((c, i) => `<td class="${numeric(c) ? "num" : ""}">${
        i === 0 ? "Total" : c.key === "balance" ? escape(money(report.closingBalance))
          : c.totalled ? escape(money(report.totals?.[c.key])) : ""}</td>`).join("")}</tr>
    <tr><td colspan="${columns.length}" class="ledger-note">${escape(report.notice || (report.ledgerSourced ? "Source: general ledger." : "Source: document records."))}
      <br>Generated ${escape(date(report.generatedAt))}${report.totalCount > report.rows?.length
        ? `<br>Showing ${report.rows.length} of ${report.totalCount} transactions (current report page).` : ""}</td></tr></tbody></table>
  </body></html>`;
}
