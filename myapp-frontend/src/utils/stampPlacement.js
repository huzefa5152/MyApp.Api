import { slotMarkup } from "./stampSlot";

// Rewrite only the chosen text node. Parsing/re-serializing a Handlebars table
// through DOMParser can move its #each tokens outside the table (foster parenting).
const LABEL = /^\s*(Verified\s+By|Authori[sz]ed\s+(?:Signatory|Signature)|Signature(?:\s+and\s+Stamp)?|Prepared\s+By|Received\s+By|Receiver(?:'s)?\s+Signature(?:\s*(?:&amp;|&|and)\s*Stamp)?)\s*$/i;
const MANAGED = /<!--stamp-placement:(\d+)-->([\s\S]*?)<!--\/stamp-placement-->/g;

function unwrapPlacement(html) {
  return html.replace(MANAGED, (_all, _id, content) =>
    content.match(/<span data-signature-label="true">([\s\S]*?)<\/span>/)?.[1] || "");
}

export function signatureAreas(html) {
  const source = unwrapPlacement(html || "");
  const areas = [];
  for (const match of source.matchAll(/>([^<>]+)</g)) {
    if (!LABEL.test(match[1])) continue;
    areas.push({ id: String(areas.length), label: match[1].trim().replace(/&amp;/g, "&"),
      start: match.index + 1, length: match[1].length });
  }
  return areas;
}

export function currentStampArea(html) {
  return html?.match(/<!--stamp-placement:(\d+)-->/)?.[1] ?? "";
}

export function positionStamp(html, areaId) {
  let source = unwrapPlacement(html || "")
    .replace(/<span\b[^>]*class="[^"]*\bstamp-slot\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<img\b[^>]*\{\{\s*stamp\s*\}\}[^>]*>/gi, "")
    .replace(/\{\{\s*stamp\s*\}\}/g, "")
    .replace(/\{\{#if\s+stamp\s*\}\}/g, "{{#if true}}");
  const area = signatureAreas(source).find(a => a.id === String(areaId));
  if (!area) return { html, changed: false };
  const label = source.slice(area.start, area.start + area.length);
  const block = `<!--stamp-placement:${area.id}--><span style="display:inline-flex;flex-direction:column;align-items:center;max-width:100%">${slotMarkup()}<span data-signature-label="true">${label}</span></span><!--/stamp-placement-->`;
  source = source.slice(0, area.start) + block + source.slice(area.start + area.length);
  return { html: source, changed: true };
}
