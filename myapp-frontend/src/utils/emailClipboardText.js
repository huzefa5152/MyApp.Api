// Parse clipboard markup in an inert document; never render email HTML.
export function emailClipboardText(html, plainText = "") {
  if (!html || html.length > 2_000_000) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,img,iframe,object").forEach(el => el.remove());
  const tables = [...doc.querySelectorAll("table")].filter(t => !t.querySelector("table") && /qty|quantity/i.test(t.textContent) && /description|particular|iteam|item/i.test(t.textContent));
  if (!tables.length) return null;
  const text = tables.map(t => [...t.rows].map(r => [...r.cells].map(c => c.textContent.replace(/\s+/g, " ").trim()).join("\t")).join("\n")).join("\n\n");
  const context = plainText.split(/\r?\n/).filter(l => /subject:|requirement no|mention brand/i.test(l)).join("\n");
  return context + "\n" + text;
}
