import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const result = await build({ stdin: { contents: `
export * from './src/utils/stampSlot';
export * from './src/utils/stampPlacement';
export * from './src/utils/starterTemplates';
export * from './src/utils/templateSampleData';
export {mergeTemplate} from './src/utils/templateEngine';`, resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,platform:'node',format:'esm'});
const {withStamp,materializeStamp,positionStamp,signatureAreas,currentStampArea,injectSignatureBlock,STARTER_TEMPLATES,DEFAULT_TEMPLATES,SAMPLE_DATA,mergeTemplate}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const url='data:image/png;base64,TESTSTAMP';
const layouts=[...STARTER_TEMPLATES,...Object.entries(DEFAULT_TEMPLATES).map(([type,html])=>({type,html,id:`default-${type}`}))];
for(const tpl of layouts){
 const signed=withStamp({htmlContent:tpl.html,stampSlug:'signature'},{signature:url});
 const rendered=mergeTemplate(signed.htmlContent,SAMPLE_DATA[tpl.type]);
 assert.ok(rendered.includes(url),`${tpl.id}: signed stamp missing`);
 const unsigned=withStamp({htmlContent:tpl.html,stampSlug:null},{signature:url},'signature');
 assert.ok(!mergeTemplate(unsigned.htmlContent,SAMPLE_DATA[tpl.type]).includes(url),`${tpl.id}: no signature overridden`);
 assert.ok(!rendered.includes('{{stamp}}'));
 for(const area of signatureAreas(tpl.html)){
  const moved=positionStamp(tpl.html,area.id);
  assert.ok(moved.changed);
  assert.equal(currentStampArea(moved.html),area.id);
  assert.deepEqual(signatureAreas(moved.html).map(x=>x.label),signatureAreas(tpl.html).map(x=>x.label));
  assert.equal((moved.html.match(/{{stamp}}/g)||[]).length,1);
  assert.equal(positionStamp(moved.html,area.id).html,moved.html);
  assert.ok(mergeTemplate(materializeStamp(moved.html,url),SAMPLE_DATA[tpl.type]).includes(url));
 }
 if(['Bill','TaxInvoice'].includes(tpl.type)){
  // Column count and which tax columns appear are DESIGN choices — the gallery
  // ships 15 distinct bill and 15 distinct tax layouts on purpose, and a
  // commercial Bill carries the document GST total rather than a per-line tax
  // column. Assert an item table and the document money, not one fixed layout.
  const d=SAMPLE_DATA[tpl.type];
  assert.ok((tpl.html.match(/<th[\s>]/g)||[]).length>=4,`${tpl.id}: no item-table header`);
  assert.ok(rendered.includes('80,000'),`${tpl.id}: first line total missing`);
  for(const amount of [d.subtotal,d.gstAmount,d.grandTotal])
   assert.ok(rendered.includes(amount.toLocaleString('en-US')),`${tpl.id}: ${amount} missing`);
  assert.ok(!rendered.includes('NaN'),`${tpl.id}: NaN in rendered output`);
 }
}
const legacy='<div>{{#if stamp}}<img src="{{stamp}}">{{#if title}}title{{/if}}{{/if}}</div>';
assert.ok(mergeTemplate(materializeStamp(legacy,url),{}).includes(url));
assert.ok(!mergeTemplate(materializeStamp(legacy,null),{}).includes('<img'));
assert.equal(materializeStamp(materializeStamp(legacy,url),null),materializeStamp(legacy,url));
for(const label of ['Verified By','Authorized Signatory']){
 const html=`<div class="sig-row"><div>Prepared By</div><div>${label}</div></div>`;
 const added=injectSignatureBlock(html).html;
 assert.ok(added.indexOf('{{stamp}}')>added.indexOf('Prepared By'));
 assert.ok(added.indexOf('{{stamp}}')<added.indexOf(label));
}
console.log(`PASS: ${layouts.length} starter/default layouts: signed, unsigned, positioning, repeat rendering; item table, document money and legacy conditionals.`);
