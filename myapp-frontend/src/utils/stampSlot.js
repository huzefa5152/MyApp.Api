/**
 * Stamp slots in print templates — pure string helpers, no React, no DOM.
 *
 * SHARED FILE: this must stay byte-identical on `master` and on
 * `customize-solution-for-other`. Nothing here may reference divisions, page
 * structure, or anything else that differs between the branches.
 *
 * A template carries its signature image in a slot:
 *
 *     <span class="stamp-slot"><img class="stamp-img" src="{{stamp}}" alt=""></span>
 *
 * `{{stamp}}` is NOT resolved by Handlebars — `materializeStamp` rewrites it to
 * the assigned stamp's URL before the template reaches the merge engine, and
 * strips the whole slot when nothing is assigned. That choice keeps every
 * existing mergeTemplate() call site untouched: the template arrives already
 * carrying a real <img src>, or carrying nothing at all.
 *
 * A Handlebars `{{#if stamp}}…{{/if}}` block was the obvious alternative but
 * would have to be removed by string surgery when unassigned, and matching the
 * right `{{/if}}` through nested conditionals is not reliably regex-able.
 *
 * `{{stamps.<slug>}}` (plural) remains the escape hatch for documents carrying
 * two different signatures. It is resolved by the merge engine as before and is
 * deliberately untouched here.
 */

// The slot wrapper, non-greedy so several slots in one document stay separate.
const SLOT_RE = /<span[^>]*class="[^"]*\bstamp-slot\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi;
const SLOT_TOKEN_RE = /\{\{\s*stamp\s*\}\}/g;
const PINNED_TOKEN_RE = /\{\{\s*stamps\.([a-z0-9_]+)\s*\}\}/gi;

export const STAMP_STATE = { SLOTTED: "slotted", PINNED: "pinned", NONE: "none" };

/** Markup inserted by "Add signature block" and carried by every starter. */
export function slotMarkup() {
  return '<span class="stamp-slot"><img class="stamp-img" src="{{stamp}}" alt=""></span>';
}

/** CSS that keeps an arbitrary upload from blowing out the signature row. */
export function slotCss() {
  return ".stamp-img { height: 90px; max-width: 220px; object-fit: contain; }";
}

/**
 * Which stamp mechanism this template uses.
 *   slotted — has a {{stamp}} slot, so the picker drives it
 *   pinned  — references {{stamps.<slug>}} directly (pre-slot templates)
 *   none    — no stamp markup at all; needs a block injected first
 */
export function detectStampState(html) {
  if (!html) return STAMP_STATE.NONE;
  // Fresh regexes: the module-level ones carry /g lastIndex between calls.
  if (/\{\{\s*stamp\s*\}\}/.test(html)) return STAMP_STATE.SLOTTED;
  if (/\{\{\s*stamps\.[a-z0-9_]+\s*\}\}/i.test(html)) return STAMP_STATE.PINNED;
  return STAMP_STATE.NONE;
}

/** Slugs referenced via {{stamps.<slug>}}, in document order, deduped. */
export function pinnedSlugs(html) {
  if (!html) return [];
  const re = new RegExp(PINNED_TOKEN_RE.source, "gi");
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Rewrite a template so it carries a real image (or none) instead of a token.
 * Called once per resolved template, in usePrintTemplates.resolveTemplate.
 */
export function materializeStamp(html, url) {
  if (!html) return html;
  if (url) return html.replace(SLOT_TOKEN_RE, escapeAttr(url));
  // Unassigned: drop the slot rather than leave src="" behind, which renders as
  // a broken-image glyph on the print.
  //
  // Only slots that STILL hold an unresolved {{stamp}} are removed. This runs
  // twice on the real print path — once in withStamp(), again as the safety net
  // in mergeTemplate() — so removing every slot unconditionally would delete the
  // <img> withStamp had just resolved, and an assigned stamp would silently
  // vanish from every document.
  return html
    .replace(SLOT_RE, (slot) => (/\{\{\s*stamp\s*\}\}/.test(slot) ? "" : slot))
    .replace(SLOT_TOKEN_RE, "");
}

/**
 * Resolve a template object for rendering. THE portability seam — every
 * mergeTemplate() call site reaches its template through here, so no call site
 * needs to know stamps exist.
 */
export function withStamp(tpl, stampsBySlug, fallbackSlug = null) {
  if (!tpl || !tpl.htmlContent) return tpl;
  const slug = tpl.stampSlug || fallbackSlug || null;
  const url = slug ? stampsBySlug?.[slug] || null : null;
  const htmlContent = materializeStamp(tpl.htmlContent, url);
  return htmlContent === tpl.htmlContent ? tpl : { ...tpl, htmlContent };
}

/** Turn {{stamps.<slug>}} into a picker-driven {{stamp}} slot. */
export function convertPinnedToSlot(html, slug) {
  if (!html || !slug) return html;
  const re = new RegExp("\\{\\{\\s*stamps\\." + slug + "\\s*\\}\\}", "gi");
  return html.replace(re, "{{stamp}}");
}

/**
 * Insert a signature block into a template that has none.
 *
 * Returns { html, anchor, changed }. `anchor` names WHERE it landed so the UI
 * can say so in words — never inject silently into someone's markup.
 */
export function injectSignatureBlock(html) {
  if (!html) return { html, anchor: "empty", changed: false };
  if (detectStampState(html) === STAMP_STATE.SLOTTED) {
    return { html, anchor: "already-present", changed: false };
  }

  const block = slotMarkup();
  const withCss = ensureSlotCss(html);

  // 1. An existing signature row — the block belongs inside it.
  const rowRe = /(<[a-z]+[^>]*class="[^"]*\b(?:sig-row|sign-row|sig-block|signature)\b[^"]*"[^>]*>)/i;
  if (rowRe.test(withCss)) {
    return { html: withCss.replace(rowRe, (m) => m + block), anchor: "signature-row", changed: true };
  }

  // 2. Text that reads like a signature label — sit directly above it.
  const labelRe = /(<[a-z]+[^>]*>)(\s*(?:authori[sz]ed\s+)?signature[^<]*)(<\/[a-z]+>)/i;
  if (labelRe.test(withCss)) {
    return {
      html: withCss.replace(labelRe, (m, open, text, close) => block + open + text + close),
      anchor: "signature-text",
      changed: true,
    };
  }

  // 3. Nothing matched — append a standalone row and say so.
  const row = '<div class="sig-row" style="margin-top:24px;text-align:right">' + block + "</div>";
  if (/<\/body>/i.test(withCss)) {
    return { html: withCss.replace(/<\/body>/i, row + "</body>"), anchor: "appended", changed: true };
  }
  return { html: withCss + row, anchor: "appended", changed: true };
}

// src="data:image/png;base64,…" — how signatures were carried before stamps.
const EMBEDDED_IMG_RE =
  /<img\b[^>]*\bsrc\s*=\s*(["'])\s*data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+\1[^>]*>/i;

/**
 * The first base64-embedded <img> in a template, or null.
 * Used on import to offer extracting it into a reusable stamp — a 90KB
 * template that is 90% one signature is the exact problem stamps solve.
 */
export function firstEmbeddedImage(html) {
  if (!html) return null;
  const m = html.match(EMBEDDED_IMG_RE);
  return m ? m[0] : null;
}

/** Swap that embedded <img> for a stamp slot, leaving the rest of the HTML alone. */
export function replaceEmbeddedImageWithSlot(html) {
  if (!html) return html;
  const tag = firstEmbeddedImage(html);
  if (!tag) return html;
  return ensureSlotCss(html).replace(tag, slotMarkup());
}

/** Add the sizing rule once, so a huge upload cannot break the layout. */
function ensureSlotCss(html) {
  if (/\.stamp-img\s*\{/.test(html)) return html;
  const css = slotCss();
  if (/<\/style>/i.test(html)) return html.replace(/<\/style>/i, css + "</style>");
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, "<style>" + css + "</style></head>");
  return "<style>" + css + "</style>" + html;
}

/** A URL is about to land inside src="…" — a stray quote would break out of it. */
function escapeAttr(url) {
  return String(url).replace(/"/g, "&quot;");
}
