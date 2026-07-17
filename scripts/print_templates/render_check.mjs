/*
 * Offline render check for a print template — registers the EXACT Handlebars
 * helpers from myapp-frontend/src/utils/templateEngine.js, merges a template
 * with sample data, and fails loudly on Handlebars errors or unresolved {{tokens}}.
 * See PRINT_TEMPLATE_GUIDE.md (repo root).
 *
 * Usage (run from repo root, needs Node 20):
 *   node scripts/print_templates/render_check.mjs <template.html> <sample.json>
 *   node scripts/print_templates/render_check.mjs <template.html> <sample.json> --www <name>
 *
 * --www <name> writes the rendered HTML to myapp-frontend? no -> to wwwroot/_prev_<name>.html
 * and rewrites /data/uploads/logos/*.png to http://localhost:5134/... so the logo
 * loads when you open http://localhost:5134/_prev_<name>.html in the browser.
 * (The in-app screenshot tool is broken on the dev box — verify via javascript_tool
 *  DOM assertions instead; delete the _prev_*.html afterwards.)
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const require = createRequire(import.meta.url);
const H = require(path.join(repo, "myapp-frontend", "node_modules", "handlebars"));

const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fdate = d => { if(!d) return ""; const t=new Date(d);
  return String(t.getDate()).padStart(2,"0")+"-"+months[t.getMonth()]+"-"+String(t.getFullYear()).slice(-2); };
H.registerHelper("fmtDate", fdate);
H.registerHelper("fmtDMY", d => { if(!d) return ""; const t=new Date(d); return String(t.getDate()).padStart(2,"0")+"/"+String(t.getMonth()+1).padStart(2,"0")+"/"+t.getFullYear(); });
H.registerHelper("fmt", n => Number(n||0).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0}));
H.registerHelper("fmtDec", n => Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}));
H.registerHelper("fmtQty", n => Number(n||0).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:3}));
H.registerHelper("nl2br", s => s==null?"":new H.SafeString(H.Utils.escapeExpression(String(s)).replace(/\n/g,"<br>")));
H.registerHelper("richText", s => { if(s==null) return ""; let o=H.Utils.escapeExpression(String(s));
  o=o.replace(/&lt;(\/?)(b|i|u)&gt;/gi,(_,sl,t)=>`<${sl}${t.toLowerCase()}>`); return new H.SafeString(o.replace(/\n/g,"<br>")); });
H.registerHelper("join", (a,s)=>(a||[]).join(typeof s==="string"?s:", "));
H.registerHelper("joinDates", a => (a||[]).map(fdate).filter(Boolean).join(", "));
H.registerHelper("emptyRows", (count,cols)=>{ let h=""; for(let i=0;i<count;i++){h+="<tr>";for(let j=0;j<cols;j++)h+='<td class="cell">&nbsp;</td>';h+="</tr>";} return new H.SafeString(h); });
H.registerHelper("billEmptyRows", c=>{ let h=""; for(let i=0;i<c;i++) h+='<tr><td class="cell c">&nbsp;</td><td class="cell c">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell r">&nbsp;</td><td class="cell r">Rs &nbsp;&nbsp; -</td></tr>'; return new H.SafeString(h); });
H.registerHelper("taxEmptyRows", c=>{ let h=""; for(let i=0;i<c;i++) h+='<tr><td></td><td></td><td></td><td class="right">-</td><td class="center">-</td><td class="right">-</td><td class="right">-</td></tr>'; return new H.SafeString(h); });
H.registerHelper("math",(a,op,b)=>{a=Number(a||0);b=Number(b||0);if(op==="-")return Math.max(0,a-b);if(op==="+")return a+b;return a;});
H.registerHelper("gt",(a,b)=>Number(a)>Number(b));
H.registerHelper("eq",(a,b)=>a===b);
H.registerHelper("or",(a,b)=>a||b);
H.registerHelper("uniqueTypes",items=>{const n=[...new Set((items||[]).map(i=>i.itemTypeName).filter(Boolean))];return n.length?n.join(" | ")+" |":"";});
H.registerHelper("inc",n=>Number(n)+1);

const [tplPath, samplePath] = process.argv.slice(2);
if (!tplPath || !samplePath) { console.error("usage: render_check.mjs <template.html> <sample.json> [--www <name>]"); process.exit(2); }
const tpl = fs.readFileSync(tplPath, "utf8");
const data = JSON.parse(fs.readFileSync(samplePath, "utf8"));
let out;
try { out = H.compile(tpl)(data); }
catch (e) { console.error("RENDER FAILED:", e.message); process.exit(1); }
const leftover = (out.match(/\{\{/g) || []).length;
console.log(`rendered ${out.length} chars, unresolved {{ tokens = ${leftover}`);
if (leftover) { console.error("WARNING: template still has unresolved {{tokens}} — a merge field is wrong or missing from the sample."); }

const wwwIdx = process.argv.indexOf("--www");
if (wwwIdx > -1) {
  const name = process.argv[wwwIdx + 1];
  out = out.replace(/\/data\/uploads\/logos\/([\w.-]+\.png)/g, "http://localhost:5134/data/uploads/logos/$1");
  const dest = path.join(repo, "wwwroot", `_prev_${name}.html`);
  fs.writeFileSync(dest, out);
  console.log(`preview -> ${dest}\n  open http://localhost:5134/_prev_${name}.html  (delete the file when done)`);
}
process.exit(leftover ? 1 : 0);
