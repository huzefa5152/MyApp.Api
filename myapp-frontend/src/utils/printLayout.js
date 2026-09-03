/**
 * Print pagination layout — keep the signature block at the bottom of EVERY
 * printed page, on documents of any length.
 *
 * ── Why the templates needed this ────────────────────────────────────────────
 * Every template built before 2026-08-29 pinned its signature with the CSS
 * "sticky footer" idiom (213 of the 233 templates audited):
 *
 *     html, body { height: 100% }
 *     body       { display: flex; flex-direction: column; min-height: 100vh }
 *     .main-content  { flex: 1 }
 *     .footer-section{ margin-top: auto }
 *
 * That only ever worked on a one-page document. 100vh is ONE page, so on a
 * multi-page print the flex column is as tall as the content and `margin-top:
 * auto` resolves against the whole document rather than each page: the
 * signature printed once, at the end of the flow, partway up the LAST page.
 * Measured on a 60-row document through Chrome print-to-PDF: no signature at
 * all on page 1, and on page 2 it sat 592.7pt above the page bottom.
 *
 * Templates papered over the short-document case by padding the item table out
 * to a fixed row count ({{emptyRows}} / {{billEmptyRows}} / {{taxEmptyRows}}),
 * which is where the run of blank rows after the last real line item came from.
 *
 * ── What actually works in the renderer we have ──────────────────────────────
 * The print path is the browser's own engine: utils/printDocument.js writes the
 * merged HTML into a popup and calls w.print(). There is no server-side PDF
 * library, so "the PDF engine" is Blink. Measured on real Chrome print-to-PDF
 * output, on a document spanning two A4 pages:
 *
 *   position: fixed; bottom: 0   repeats on every page, pinned to the page
 *                                bottom (pages 1 and 2 both at 805.0pt). Flow
 *                                content runs UNDER it — it reserves nothing,
 *                                so on its own it overlaps the line items.
 *   <tfoot>                      repeats on every page, but on the last page it
 *                                sits directly after the final row (573.9pt
 *                                above the page bottom), so it cannot pin.
 *   display: table-footer-group  on a plain <div>: last page only. Useless.
 *   bottom: -Npt into an enlarged
 *   @page margin                 clipped away entirely — never painted.
 *   body { padding-bottom }      reserves once at the end of the flow, not per
 *                                page: still overlaps on every full page.
 *
 * So the two are combined, each doing the half it is good at:
 *   • a `position: fixed; bottom: 0` wrapper PAINTS the signature at the bottom
 *     of every page, and
 *   • a hidden clone in the item table's <tfoot> RESERVES exactly that much room
 *     at the bottom of every page, so no line item can run underneath it.
 *
 * The reservation is a clone of the real signature rather than a hard-coded
 * height, because the height is not knowable statically: the stamp image is
 * emitted unconditionally but stampSlot.js strips the whole slot when no stamp
 * is assigned, so the same template is ~66px shorter for a company without one.
 * Cloning is exactly right for every template with nothing to keep in sync.
 *
 * The signature is wrapped WHERE IT STANDS rather than moved to the end of the
 * body: ~30 templates scope their footer CSS through a page wrapper
 * (`.page .footer-sect`, `.body .sigs`, `.outer-border .inner-border`), and
 * re-parenting would drop those rules on the floor.
 *
 * Applied centrally in mergeTemplate(), so print, the customer portal, the PDF
 * export and the template editor's preview lay out identically, and the
 * templates already saved in the database are fixed without being rewritten.
 */

// Innermost blocks that identify a signature, across the 13 naming conventions
// in the estate. `.footer`/`.footer-sect` are deliberately NOT anchors — in
// several templates they are a terms or disclaimer box — they are only climbed
// INTO from a real anchor below (see CLIMBABLE).
const ANCHORS = [
  ".print-signature",
  ".sig-row",
  ".sigs",
  ".signature-row",
  ".signatures",
  ".sig-table",
  ".sig-box",
  ".sig-cell",
  ".sig-stamp",
  ".sig-block",
  ".company_signature",
  ".signature",
  ".sign",
  ".sig",
  // Fragments — a rule or a caption on their own. Reached only so the climb
  // below can find the block that holds them.
  ".sig-line",
  ".sig-label",
  ".sig-text",
  ".sig-top",
].join(",");

// Wrappers worth taking along, when they hold nothing but end-of-document
// furniture — the signature plus e.g. a closing rule or an item-types
// strapline. Keeps `.types-footer` / `.bot-line` with the signature they were
// drawn under.
const CLIMBABLE = [
  // The documented name for the whole block (PRINT_TEMPLATE_GUIDE.md §11).
  // Without it, a template that put e.g. the address letterhead under the
  // signature inside `.print-signature` had only its inner `.sig-row` pinned
  // and the letterhead stayed in flow above it (Alpha Traders bill, 2026-09-02).
  ".print-signature",
  ".footer-section", ".footer-sect", ".doc-footer", ".page-footer",
  ".footer-band", ".footer-lh", ".footer", ".foot",
  ".sigs", ".sig-row", ".signatures", ".sig-table",
];

// Content that must stay in the flow and print exactly once. A candidate
// wrapper holding any of it is not climbed into, so amount-in-words, the totals
// block and the FBR IRN/QR panel keep printing once, after the items.
const FLOW_ONLY = [
  ".totals-wrap", ".totals-section", ".totals-table", ".totals", ".totals-area",
  ".total-row", ".ttbl", ".qtot", ".grand", ".words", ".words-side",
  ".words-section", ".amount-words", ".summary", ".fbr", ".fbr-block", "table",
].join(",");

const MARK = "mpl"; // merged-print-layout

/**
 * Climbing into a wrapper that dwarfs the signature would repeat a whole terms
 * block on every page. Anything that roughly doubles the text is left alone.
 */
const CLIMB_TEXT_BUDGET = 200;

function textLength(el) {
  return (el.textContent || "").replace(/\s+/g, " ").trim().length;
}

/** A bare rule or a lone stamp is not a signature block worth pinning. */
function hasContent(el) {
  return textLength(el) > 0 || !!el.querySelector("img");
}

/**
 * The block to pin: the outermost footer wrapper around the matched signature
 * that still holds nothing but end-of-document furniture.
 *
 * The walk passes THROUGH plain elements — several templates wrap the signature
 * in an unclassed <span> inside the footer band — but only ever settles on a
 * wrapper from CLIMBABLE, and stops as soon as an ancestor pulls in content that
 * must print once (totals, amount in words) or is far larger than the signature.
 */
function pinTargetFor(anchor, body) {
  const budget = textLength(anchor) + CLIMB_TEXT_BUDGET;
  let chosen = null;
  let fallback = null;
  for (let node = anchor.parentElement; node && node !== body; node = node.parentElement) {
    if (node.querySelector(FLOW_ONLY) || textLength(node) > budget) break;
    if (CLIMBABLE.some((sel) => node.matches(sel))) chosen = node;
    else if (!fallback && !hasContent(anchor) && hasContent(node)) fallback = node;
  }
  // Prefer a named footer wrapper; otherwise, if the match was just a rule,
  // take the smallest ancestor that carries the wording next to it.
  return chosen || (hasContent(anchor) ? anchor : fallback);
}

/**
 * The document's line-item table: the one with the most body rows. The
 * reservation has to live in the table that actually spans the page breaks, so
 * that its <tfoot> repeats the reserved strip onto every page.
 */
function itemTableOf(doc) {
  let best = null;
  let bestRows = 0;
  for (const table of doc.querySelectorAll("table")) {
    // A table nested in another table's cell paginates with its parent.
    if (table.parentElement && table.parentElement.closest("table")) continue;
    const rows = table.querySelectorAll("tr").length;
    if (rows > bestRows) {
      best = table;
      bestRows = rows;
    }
  }
  return bestRows > 0 ? best : null;
}

/** Widest row in the table, so the spacer cell spans the full width. */
function columnCountOf(table) {
  let max = 1;
  for (const tr of table.querySelectorAll("tr")) {
    let n = 0;
    for (const cell of tr.children) n += Number(cell.getAttribute("colspan") || 1);
    if (n > max) max = n;
  }
  return max;
}

const STYLE = `
/* Print pagination layout — see utils/printLayout.js */
.${MARK}-fixed {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  /* Above the full-page watermark a few templates paint at z-index 0. */
  z-index: 20;
  /* inherit resolves to the parent's padding, so the signature keeps the page
     inset its own container gave it instead of running to the paper edge. */
  padding-left: inherit;
  padding-right: inherit;
}
.${MARK}-spacer { visibility: hidden; }
/* A footer that pinned itself with position:absolute (bottom:0) would be out of
   flow inside the hidden clone, so the clone would reserve no height at all.
   Only the block we took hold of is reset — a stamp positioned against a
   .sig-block deeper down still resolves against that same ancestor. */
.${MARK}-fixed > *, .${MARK}-spacer > * { position: static !important; }
/* The reservation only works if the table's footer group repeats on every page,
   which is the default — but a template that sets tfoot{display:table-row-group}
   turns it off, and then the room is reserved once at the end of the document
   and line items print straight over the signature on every earlier page. Only
   the tfoot holding the reservation is forced back. */
tfoot.${MARK}-foot { display: table-footer-group !important; }
/* ~90 templates rule their item table through a bare td selector, which would
   otherwise draw the reservation as a visible empty bordered row. */
.${MARK}-cell {
  border: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  height: auto !important;
}
/* Retire the one-page-only sticky-footer idiom the templates were built on; the
   fixed wrapper above is what pins the signature now, on every page. */
html, body { height: auto !important; }
body { display: block !important; min-height: 0 !important; }
@media print {
  /* 12 templates disable the repeating header with display:table-row-group.
     Now that documents genuinely flow onto page 2, it has to come back. */
  thead { display: table-header-group !important; }
}
`;

/**
 * Wrap the signature in a page-bottom copy and reserve its room on every page.
 * Mutates `doc`. Returns true when a signature was found and pinned.
 */
export function applyPrintLayout(doc) {
  if (!doc || !doc.body) return false;
  if (doc.querySelector("." + MARK + "-fixed")) return false; // already applied

  const anchors = doc.body.querySelectorAll(ANCHORS);
  if (!anchors.length) return false;
  const target = pinTargetFor(anchors[anchors.length - 1], doc.body);
  if (!target || !hasContent(target)) return false;

  const spacer = doc.createElement("div");
  spacer.className = MARK + "-spacer";
  spacer.setAttribute("aria-hidden", "true");
  spacer.appendChild(target.cloneNode(true));

  const table = itemTableOf(doc);
  if (table) {
    // Only one <tfoot> is legal, and 74 templates already have one holding
    // totals — add a row to it rather than a second element.
    let tfoot = table.querySelector(":scope > tfoot");
    if (!tfoot) {
      tfoot = doc.createElement("tfoot");
      table.appendChild(tfoot);
    }
    tfoot.classList.add(MARK + "-foot");
    const tr = doc.createElement("tr");
    const td = doc.createElement("td");
    td.className = MARK + "-cell";
    td.setAttribute("colspan", String(columnCountOf(table)));
    td.appendChild(spacer);
    tr.appendChild(td);
    tfoot.appendChild(tr);
  } else {
    // No paginating table (the transfer and withholding-tax vouchers) — those
    // are single-page, so reserving once at the end of the flow is enough.
    doc.body.appendChild(spacer);
  }

  const fixed = doc.createElement("div");
  fixed.className = MARK + "-fixed";
  target.parentNode.insertBefore(fixed, target);
  fixed.appendChild(target);

  const style = doc.createElement("style");
  style.id = MARK + "-style";
  style.textContent = STYLE;
  (doc.head || doc.body).appendChild(style);
  return true;
}

/**
 * String-in / string-out wrapper for the merge pipeline. A no-op outside a
 * browser (the Node render checks in scripts/ have no DOMParser), so the merged
 * HTML always comes back intact.
 */
export function applyPrintLayoutToHtml(html) {
  if (typeof DOMParser === "undefined" || !html) return html;
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return html;
  }
  if (!doc || !doc.body || doc.querySelector("parsererror")) return html;
  if (!applyPrintLayout(doc)) return html;
  const doctype = html.match(/^\s*<!DOCTYPE[^>]*>/i);
  return (doctype ? doctype[0] + "\n" : "") + doc.documentElement.outerHTML;
}
