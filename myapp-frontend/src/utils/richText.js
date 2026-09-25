// src/utils/richText.js
// Safe "limited rich text" for item descriptions. The rule: escape EVERYTHING
// (so no operator-entered markup can execute — XSS-safe), then re-allow only a
// whitelist — newlines → <br> and <b>/<i>/<u> (case-insensitive). Anything else
// (e.g. <script>, <img onerror=…>) stays escaped and shows as inert text.
//
// Mirrors the Handlebars `richText` helper in templateEngine.js so on-screen
// and printed descriptions render identically.
const ALLOWED = "b|i|u";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderRichTextHtml(text) {
  if (text == null) return "";
  let out = escapeHtml(text);
  out = out.replace(new RegExp(`&lt;(/?)(${ALLOWED})&gt;`, "gi"), (_m, slash, tag) => `<${slash}${tag.toLowerCase()}>`);
  out = out.replace(/\r\n|\r|\n/g, "<br>");
  return out;
}

// Plain one-line version of a rich description: strips the <b>/<i>/<u> tags and
// flattens newlines to spaces. For compact list/card displays where the full
// formatted text is available via a detail/view modal.
export function richTextToPlain(text) {
  if (text == null) return "";
  return String(text)
    .replace(new RegExp(`</?(${ALLOWED})>`, "gi"), "")
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
