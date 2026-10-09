/**
 * Print documents are built from operator-edited template HTML and printed in
 * a popup that shares this app's origin, so anything in a template that can
 * run would run as whoever prints it — with their login token in reach. These
 * two helpers make a merged document inert. No shipped template uses script;
 * a template without it is left byte-for-byte as it was, apart from the CSP.
 *
 * Two layers, because each covers a path the other cannot:
 *  - withPrintCsp: a Content-Security-Policy as the FIRST thing the parser
 *    sees. It blocks <script>, inline event handlers (onerror=…) and
 *    javascript: URLs in the print popup, the print iframe and the portal.
 *  - stripActiveContent: removes those constructs from the markup itself, for
 *    the PDF export, which inserts the body with innerHTML into a document of
 *    its own (where an <img onerror> would otherwise fire).
 *
 * Kept dependency-free so the node test harnesses can load it.
 */
export const PRINT_CSP = "script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'";
export const PRINT_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">`;

const SCRIPT_BLOCK = /<script\b[\s\S]*?<\/script\s*>/gi;
const ACTIVE_TAG = /<\/?(?:script|iframe|frame|frameset|object|embed|applet|portal)\b[^>]*>/gi;
// An on…= attribute inside a tag; attributes may be separated by "/" as well
// as whitespace (<img/onerror=…>). Applied until nothing changes, so stacked
// handlers on one tag all go.
const EVENT_ATTR = /(<[a-z][^>]*?)[\s/]+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const SCRIPT_URL = /((?:href|src|xlink:href|action|formaction|data)\s*=\s*["']?)\s*(?:javascript|vbscript)\s*:/gi;

export function stripActiveContent(html) {
  let out = String(html ?? "").replace(SCRIPT_BLOCK, "").replace(ACTIVE_TAG, "");
  for (let prev = null; prev !== out;) { prev = out; out = out.replace(EVENT_ATTR, "$1"); }
  return out.replace(SCRIPT_URL, "$1about:blank#");
}

/**
 * Put the CSP before anything that could run. Straight after the doctype when
 * there is one (so the document keeps its standards/quirks mode), otherwise
 * at the very start: a <meta> before <html> is placed into <head> by the parser.
 */
export function withPrintCsp(html) {
  const s = String(html ?? "");
  // Plain text (a merge with no markup at all) has nothing that could run and
  // is used as text by some callers, so it is returned exactly as merged.
  if (!s.includes("<") || s.includes(PRINT_CSP_META)) return s;
  const doctype = s.match(/^\s*<!doctype[^>]*>/i);
  return doctype
    ? doctype[0] + PRINT_CSP_META + s.slice(doctype[0].length)
    : PRINT_CSP_META + s;
}

/** Both layers, in the order a merged document needs them. */
export function makePrintSafe(html) {
  return withPrintCsp(stripActiveContent(html));
}
