/**
 * Withholding income tax (s.153) on a printed document.
 *
 * The print data has carried `withholdingTaxRate`, `withholdingTaxAmount` and
 * `balanceDueAfterWht` on the Bill, Tax Invoice and Purchase Bill DTOs since
 * withholding shipped, and the merge fields exist in the editor -- but not one
 * of the 80 templates on a live installation rendered them (2026-09-11), and
 * neither did any starter or built-in default. A buyer who withholds 4.5% got a
 * document whose only total was the gross, and the net they actually owe had
 * to be worked out by hand.
 *
 * This module is the ONE place the block is written, for three callers:
 *   - the build-time pass over every starter and default (scripts/),
 *   - the "Add withholding tax lines" actions on the Print Templates screen
 *     (per template, and company-wide for the existing rows on production),
 *   - the node test that proves every starter/default renders it.
 *
 * The rows render only when `withholdingTaxAmount` is non-zero, so a document
 * with no withholding prints exactly as before. The rate is a DECIMAL
 * percentage (4.5, 0.1), so it is formatted with `fmtQty`, never `fmt`, which
 * would round 0.1% to 0%.
 */

/** Any of the three merge fields already present -> the template has the block (or its own). */
export function hasWithholdingBlock(html) {
  return /withholdingTaxAmount|balanceDueAfterWht/.test(html || "");
}

/** Document types whose print data carries the withholding fields. */
export const WITHHOLDING_TEMPLATE_TYPES = ["Bill", "TaxInvoice", "PurchaseBill", "CreditNote", "DebitNote"];

const TR_RE = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
const GRAND_RE = /\{\{\s*(fmt|fmtDec|fmtPrice)\s+grandTotal\s*\}\}/;

function tdsOf(tr) {
  return tr.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || [];
}
function openTag(el) {
  return el.match(/^<[a-z]+\b[^>]*>/i)[0];
}
function innerOf(td) {
  return td.replace(/^<td\b[^>]*>/i, "").replace(/<\/td>$/i, "");
}
function colspanOf(td) {
  const m = openTag(td).match(/colspan\s*=\s*"?(\d+)"?/i);
  return m ? Number(m[1]) : 1;
}
function withColspan(open, n) {
  const stripped = open.replace(/\s+colspan\s*=\s*"?\d+"?/i, "");
  return n > 1 ? stripped.replace(/^<td/i, `<td colspan="${n}"`) : stripped;
}

/**
 * Adds the withholding rows straight after the row that prints the grand
 * total, cloning that row's own tags so the block inherits the template's
 * borders, fonts and shading. Two shapes are recognised:
 *
 *   - a two-cell totals row  (label | value)         -> Bill / Purchase Bill / note starters
 *   - a multi-cell footer row (colspan label ... total) -> Tax Invoice starters
 *
 * Returns { html, anchor, changed }. `anchor` names what was matched
 * ("totals-row", "footer-row", "already-present", "no-totals-row") so a caller
 * can tell the operator what happened.
 */
export function injectWithholdingBlock(html) {
  if (!html) return { html, anchor: "empty", changed: false };
  if (hasWithholdingBlock(html)) return { html, anchor: "already-present", changed: false };

  const rows = html.match(TR_RE) || [];
  const grandRow = rows.find((r) => GRAND_RE.test(r));
  if (!grandRow) return { html, anchor: "no-totals-row", changed: false };

  const helper = grandRow.match(GRAND_RE)[1];
  const tds = tdsOf(grandRow);
  const valueTd = tds.find((td) => GRAND_RE.test(td));
  if (!valueTd || tds.length < 2) return { html, anchor: "no-totals-row", changed: false };

  const trOpen = openTag(grandRow);
  const valueOpen = openTag(valueTd);
  // Whatever sits before the figure in the value cell ("Rs ", "Rs", "PKR ") is
  // the template's currency prefix -- keep it.
  const valueInner = innerOf(valueTd);
  const prefix = valueInner.slice(0, valueInner.search(GRAND_RE)).replace(/<[^>]+>/g, "").trimEnd();
  const money = (expr) => `${prefix}${prefix ? " " : ""}{{${helper} ${expr}}}`.replace(/^\s+/, "");
  const rateSuffix = "{{#if withholdingTaxRate}} ({{fmtQty withholdingTaxRate}}%){{/if}}";

  let block;
  if (tds.length === 2) {
    const labelOpen = openTag(tds[0]);
    block =
      `{{#if withholdingTaxAmount}}` +
      `${trOpen}${labelOpen}Withholding Income Tax${rateSuffix}</td>${valueOpen}(-) ${money("withholdingTaxAmount")}</td></tr>` +
      `${trOpen}${labelOpen}Net Payable</td>${valueOpen}${money("balanceDueAfterWht")}</td></tr>` +
      `{{/if}}`;
  } else {
    // Footer row: everything but the last cell collapses into one label cell.
    const span = tds.slice(0, -1).reduce((n, td) => n + colspanOf(td), 0);
    const labelOpen = withColspan(openTag(tds[0]), span);
    block =
      `{{#if withholdingTaxAmount}}` +
      `${trOpen}${labelOpen}Withholding Income Tax${rateSuffix} :</td>${valueOpen}(-) ${money("withholdingTaxAmount")}</td></tr>` +
      `${trOpen}${labelOpen}Net Payable :</td>${valueOpen}${money("balanceDueAfterWht")}</td></tr>` +
      `{{/if}}`;
  }

  const at = html.indexOf(grandRow) + grandRow.length;
  return {
    html: html.slice(0, at) + block + html.slice(at),
    anchor: tds.length === 2 ? "totals-row" : "footer-row",
    changed: true,
  };
}
