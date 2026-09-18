// Usage: node scripts/test_last_page_print.mjs <owned-browser-cdp-url> <playwright-module-path>
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {build}=require('../myapp-frontend/node_modules/esbuild');
const {chromium}=await import(pathToFileURL(process.argv[3]).href);
const bundle=await build({stdin:{contents:"export {paginateInvoice} from './src/utils/paginateInvoice'; export {renderIntoPdf} from './src/utils/exportUtils'; export {applyPrintLayoutToHtml} from './src/utils/printLayout';",resolveDir:process.cwd()+'/myapp-frontend'},bundle:true,write:false,format:'iife',globalName:'checks',logLevel:'silent'});
const browser=await chromium.connectOverCDP(process.argv[2]);const page=await browser.contexts()[0].newPage();
const css=`*{box-sizing:border-box}body{margin:0;font:12px Arial}.invoice-sheet{width:186mm;height:273mm;display:flex;flex-direction:column}.invoice-sheet>*{flex-shrink:0}table{table-layout:fixed;width:100%;border-collapse:collapse}td,th{padding:8px;border:1px solid black}td{height:35px}[data-invoice-header]{height:180px}[data-final-signature]{margin-top:auto;height:90px}[data-letter-footer]{margin-top:auto;height:40px}.invoice-sheet:has([data-final-signature]) [data-letter-footer]{margin-top:0}[hidden]{display:none!important}`;
function fixture(n,signed=false){return `<style>${css}</style><div data-invoice-pages><header data-invoice-header>Invoice</header><div data-continuation hidden>Continued</div><table data-item-table><thead><tr><th>Item</th><th>Amount</th></tr></thead><tbody>${Array.from({length:n},(_,i)=>`<tr data-row="${i}"><td>Item ${i} ${i%3?'':'Long description '.repeat(8)}</td><td>100</td></tr>`).join('')}</tbody></table><div data-invoice-closing style="height:100px">Totals</div><div data-final-signature style="height:${signed?150:90}px">${signed?'<div style="height:60px">Uploaded stamp</div>':''}Authorized Signatory</div><footer data-letter-footer><span data-page-number></span></footer></div>`;}
try{
 for(const n of [0,1,14,60])for(const signed of [false,true]){
  await page.setContent(fixture(n,signed));await page.addScriptTag({content:bundle.outputFiles[0].text});
  const result=await page.evaluate(async()=>{
   if(checks.applyPrintLayoutToHtml(document.body.innerHTML).includes('mpl-fixed'))throw Error('Legacy repeating footer applied');
   const pages=await checks.paginateInvoice(document);
   return {ids:pages.flatMap(p=>Array.from(p.querySelectorAll('[data-row]'),r=>Number(r.dataset.row))),count:pages.length,headers:pages.map(p=>p.querySelectorAll('thead').length),signs:pages.map(p=>p.querySelectorAll('[data-final-signature]').length),fits:pages.every(p=>p.scrollHeight<=p.clientHeight+1),bottomGap:pages.at(-1).getBoundingClientRect().bottom-pages.at(-1).querySelector('[data-final-signature]').getBoundingClientRect().bottom};
  });
  assert.deepEqual(result.ids,Array.from({length:n},(_,i)=>i));assert.ok(result.fits);assert.ok(result.headers.every(n=>n===1));assert.equal(result.signs.reduce((a,b)=>a+b,0),1);assert.equal(result.signs.at(-1),1);assert.ok(Math.abs(result.bottomGap-40)<2);if(n===60)assert.ok(result.count>=3);
 }
 await page.setContent(fixture(60,true));await page.addScriptTag({content:bundle.outputFiles[0].text});
 const exportResult=await page.evaluate(async html=>{let images=0,breaks=0;const pdf={addPage(){breaks++},addImage(){images++}};const pages=await checks.renderIntoPdf(pdf,html);return {images,breaks,pages};},fixture(60,true));
 assert.equal(exportResult.images,exportResult.pages);assert.equal(exportResult.breaks,exportResult.pages-1);assert.ok(exportResult.pages>=3);
 await page.setContent(fixture(1));await page.addScriptTag({content:bundle.outputFiles[0].text});
 const blocked=await page.evaluate(async()=>{document.querySelector('td').style.height='400mm';try{await checks.paginateInvoice(document);return false}catch{return !document.querySelector('[data-invoice-pages]').hidden}});assert.ok(blocked);
 console.log('PASS: short/boundary/multipage, intact ordered rows, repeated headers, signed/unsigned final-page footer, PDF export, oversized-row detection.');
}finally{await page.close();await browser.close();}
