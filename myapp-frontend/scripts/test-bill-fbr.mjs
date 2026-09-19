import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Bundle the actual renderer and catalogs, including Vite-style imports.
const bundled = await build({
  stdin: { contents: `
    export { mergeTemplate } from './src/utils/templateEngine.js';
    export { defaultBillTemplate, defaultChallanTemplate } from './src/utils/defaultTemplates.js';
    export { billStarters } from './src/utils/starters/bill.js';
    export { withBillFbrSection } from './src/utils/billFbrSection.js';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, platform: "node", format: "esm",
});
const { mergeTemplate, defaultBillTemplate, defaultChallanTemplate, billStarters, withBillFbrSection } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const sample = {
  printTemplateType: "Bill", fbrStatus: "Submitted", fbrIRN: "TEST-IRN-123",
  fbrSubmittedAt: "2026-09-18", fbrQrPngDataUrl: "data:image/png;base64,QR",
  fbrLogoUrl: "data:image/png;base64,LOGO", items: [], grandTotal: 118,
};
const custom = '<html><body><div>Original custom content</div><div class="footer-section">Signature</div></body></html>';
const layouts = [defaultBillTemplate, ...billStarters.map(t => t.html), custom, "<p>HTML fragment</p>"];
for (const template of layouts) {
  const html = mergeTemplate(template, sample);
  assert.equal((html.match(/data-bill-fbr="true"/g) || []).length, 1);
  assert.ok(html.includes('src="data:image/png;base64,QR"'));
  assert.ok(html.includes('src="data:image/png;base64,LOGO"'));
  assert.ok(html.includes("TEST-IRN-123"));
  assert.ok(!html.includes("{{"));
  for (const fbrStatus of [null, "Pending", "Validated", "Failed", "Cancelled"]) {
    const blank = mergeTemplate(template, { ...sample, fbrStatus });
    assert.ok(!blank.includes('data-bill-fbr="true"'));
    assert.ok(!blank.includes("TEST-IRN-123"));
    assert.ok(!blank.includes("data:image/png"));
  }
  assert.ok(!mergeTemplate(template, { ...sample, fbrIRN: null }).includes('data-bill-fbr="true"'));
  assert.equal(withBillFbrSection(withBillFbrSection(template)), withBillFbrSection(template));
}
const renderedCustom = mergeTemplate(custom, sample);
assert.ok(renderedCustom.includes("Original custom content"));
assert.ok(renderedCustom.indexOf("FBR Digital Invoice") < renderedCustom.indexOf("Signature"));
assert.ok(!mergeTemplate(defaultChallanTemplate, { ...sample, printTemplateType: "Challan" }).includes("FBR Digital Invoice"));
const existing = '<div>{{#if fbrIRN}}<img src="{{fbrQrPngDataUrl}}">{{/if}}</div>';
assert.equal(withBillFbrSection(existing), existing);
assert.ok(!mergeTemplate(custom, { ...sample, fbrLogoUrl: null, fbrQrPngDataUrl: null }).includes('src=""'));
console.log(`PASS: ${layouts.length} bill layouts; submitted/unsubmitted/missing IRN, inline assets, no duplicates, preserved custom content, other document isolation.`);
