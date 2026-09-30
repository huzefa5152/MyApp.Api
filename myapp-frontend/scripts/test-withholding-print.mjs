import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  stdin: { contents: `
export { withholdingTaxStarters } from './src/utils/starters/withholdingTax';
export { mergeTemplate } from './src/utils/templateEngine';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { withholdingTaxStarters, mergeTemplate } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`,
);
const data = {
  companyBrandName: 'SAMPLE COMPANY', customerName: 'Sample Customer',
  date: '2026-10-01', receiptNumber: 5, amount: 64.90,
  amountInWords: 'Sixty Four Rupees and Ninety Paisa Only',
  description: '<script>alert(1)</script>',
};
for (const template of withholdingTaxStarters) {
  const html = mergeTemplate(template.html, data);
  assert.ok(html.includes('64.90'), `${template.id}: precise deduction missing`);
  assert.ok(html.includes(data.amountInWords), `${template.id}: paisa wording missing`);
  assert.ok(html.includes(data.customerName), `${template.id}: customer missing`);
  assert.ok(html.includes(data.companyBrandName), `${template.id}: company missing`);
  assert.ok(!html.includes('<script>alert(1)</script>'), `${template.id}: description executed as markup`);
  assert.ok(!html.includes('NaN'), `${template.id}: invalid amount rendered`);
}
console.log(`${withholdingTaxStarters.length} withholding print layouts passed: exact deduction, words, parties and escaping.`);
