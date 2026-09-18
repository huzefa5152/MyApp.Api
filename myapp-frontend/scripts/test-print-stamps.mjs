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
  assert.equal((tpl.html.match(/<th>/g)||[]).length,8);
  assert.ok(rendered.includes('80,000'));
  assert.ok(rendered.includes('14,400'));
  assert.ok(!rendered.includes('NaN'));
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
console.log(`PASS: ${layouts.length} starter/default layouts: signed, unsigned, positioning, repeat rendering; eight-column invoice data and legacy conditionals.`);
