import { mergeTemplate } from "./templateEngine";
import { defaultBillTemplate } from "./defaultTemplates";

export function selectReportInvoiceTemplate(templates, companyId, divisionId) {
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
// styles in an isolated frame so invoice CSS cannot restyle the report table.
export async function invoiceBranding(template, company) {
  const source = new DOMParser().parseFromString(template.htmlContent, "text/html");
  source.querySelectorAll(".seller").forEach((el) => el.setAttribute("data-ledger-brand", ""));
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
    const header = doc.querySelector("thead th, table th");
    const headerStyle = header ? view.getComputedStyle(header) : null;
    let background = header;
    while (background && ["rgba(0, 0, 0, 0)", "transparent"].includes(view.getComputedStyle(background).backgroundColor)) {
      background = background.parentElement;
    }
    const theme = { font: bodyStyle.fontFamily, color: bodyStyle.color,
      headerBackground: background ? view.getComputedStyle(background).backgroundColor : "#f1f4f8",
      headerColor: headerStyle?.color || "#1a2332" };
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
