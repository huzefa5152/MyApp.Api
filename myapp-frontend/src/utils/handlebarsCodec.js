/**
 * Encode/decode Handlebars expressions for GrapesJS compatibility.
 * GrapesJS parses HTML and can mangle {{expressions}}, so we wrap them
 * in <span data-hbs="base64"> placeholders before loading into the canvas,
 * and unwrap them on export.
 *
 * Handlebars inside HTML attribute values (e.g. src="{{field}}") are stored
 * as data-hbs-attr-<name> data attributes instead, since <span> tags inside
 * attribute values produce invalid HTML.
 */

export function encodeHandlebars(html) {
  if (!html) return "";

  // Phase 1: Protect Handlebars inside attribute values.
  // Match attr="...{{expr}}..." and replace the value with a placeholder,
  // storing the original in data-hbs-attr-<attrName>.
  html = html.replace(
    /(\s)([\w-]+)="([^"]*?\{\{[\s\S]*?\}\}[^"]*?)"/g,
    (full, space, attr, value) => {
      // Skip data-hbs attributes themselves (avoid double-encoding)
      if (attr.startsWith("data-hbs")) return full;
      const encoded = btoa(unescape(encodeURIComponent(value)));
      // Use a safe placeholder for the original attribute
      const placeholder = attr === "src" ? "" : attr === "href" ? "#" : "";
      return `${space}${attr}="${placeholder}" data-hbs-attr-${attr}="${encoded}"`;
    }
  );

  // Phase 2: Replace text-node Handlebars with <span> placeholders.
  html = html.replace(/(\{\{\{[^}]+\}\}\}|\{\{[^}]+\}\})/g, (match) => {
    const encoded = btoa(unescape(encodeURIComponent(match)));
    const display = match.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<span data-hbs="${encoded}" class="hbs-placeholder" contenteditable="false">${display}</span>`;
  });

  return html;
}

export function decodeHandlebars(html) {
  if (!html) return "";

  // Phase 1: Restore attribute-level Handlebars.
  // Find tags with data-hbs-attr-* and restore original attribute values
  // (handles attribute reordering by GrapesJS).
  html = html.replace(/<[^>]+data-hbs-attr-[\w-]+="[^"]+"[^>]*>/g, (tag) => {
    const hbsAttrs = [...tag.matchAll(/data-hbs-attr-([\w-]+)="([^"]+)"/g)];
    for (const [, attrName, b64] of hbsAttrs) {
      try {
        const original = decodeURIComponent(escape(atob(b64)));
        // Remove the data-hbs-attr-<name> first
        tag = tag.replace(new RegExp(`\\s*data-hbs-attr-${attrName}="[^"]+"`), "");
        // Replace the placeholder value of the real attribute
        tag = tag.replace(
          new RegExp(`(\\s)${attrName}="[^"]*?"`),
          `$1${attrName}="${original}"`
        );
      } catch { /* ignore decode errors */ }
    }
    return tag;
  });

  // Phase 2: Restore text-node Handlebars.
  html = html.replace(/<span[^>]*data-hbs="([^"]+)"[^>]*>[^<]*<\/span>/g, (_, b64) => {
    try {
      return decodeURIComponent(escape(atob(b64)));
    } catch {
      return "";
    }
  });

  return html;
}
