"""Offline browser checks for company branding, report content and PDF margins."""
import argparse
import base64
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--templates", type=Path, help="Optional private template snapshot (read only)")
parser.add_argument("--output", type=Path)
args = parser.parse_args()
templates = [
    {"htmlContent": '<style>body{font-family:Georgia;color:#222}th{background:#193b25;color:#fff}.brand{border-bottom:3px solid #b49b54;text-align:center}</style><div class="brand"><h1>{{companyName}}</h1><div>{{companyAddress}}</div></div><table><thead><tr><th>Goods</th></tr></thead></table>'},
    {"htmlContent": '<style>body{font-family:Arial;color:#183858}.hdr{display:flex;justify-content:space-between;border:2px solid #183858}th{background:#183858;color:white}</style><div class="hdr"><h2>{{companyName}}</h2><div>{{companyPhone}}</div></div><table><tr><th>Goods</th></tr></table>'},
]
if args.templates:
    templates += [{"htmlContent": t["HtmlContent"]} for t in json.loads(args.templates.read_text(encoding="utf-8")) if t["TemplateType"] == "Bill"]

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
url = f"http://127.0.0.1:{port}"
with tempfile.TemporaryFile() as log:
    server = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(port)], cwd=ROOT / "myapp-frontend", stdout=log, stderr=log)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(url, timeout=1)
                break
            except OSError:
                time.sleep(.1)
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome")
            page = browser.new_page()
            page.goto(url)
            page.set_content('<html><body><main id="sentinel" style="color:rgb(123, 45, 67)">Application</main></body></html>')
            result = page.evaluate("""async ({templates,url}) => {
              const {buildReportHtml} = await import(url+'/src/Components/ReportShell.jsx');
              const {brandAccountingReport} = await import(url+'/src/utils/accountingReportPrint.js');
              const {selectLedgerInvoiceTemplate,buildCustomerLedgerHtml} = await import(url+'/src/utils/customerLedgerPrint.js');
              const {renderIntoPdf} = await import(url+'/src/utils/exportUtils.js');
              const {jsPDF} = await import(url+'/node_modules/.vite/deps/jspdf.js');
              const company={id:7,name:'Sample Company',fullAddress:'Sample address',phone:'Sample phone'};
              const report={title:'Outstanding Invoices',companyName:company.name,periodLabel:'October 2026',ledgerSourced:true,
                columns:[{key:'name',label:'Customer',format:'text'},{key:'reference',label:'Invoice',format:'text'},{key:'amount',label:'Outstanding',format:'money',totalled:true}],
                rows:Array.from({length:100},(_,i)=>({name:'Customer '+i,reference:'REF-'+i,amount:100})),totals:{amount:10000},totalCount:100};
              let checks=0,htmls=[];
              const assert=(ok,message)=>{if(!ok)throw new Error(message);checks++};
              for(const [templateIndex,template] of templates.entries()){
                const html=await brandAccountingReport(buildReportHtml(report),company,template);
                const doc=new DOMParser().parseFromString(html,'text/html');
                assert(doc.querySelector('.report-letterhead')?.textContent.includes(company.name),'Company letterhead missing at template '+templateIndex);
                assert(doc.querySelectorAll('.accounting-table tbody tr').length===100,'Rows lost');
                assert(doc.querySelector('tfoot').textContent.includes('10,000.00'),'Total lost');
                assert(!/NaN|undefined|\\{\\{/.test(doc.body.textContent),'Unresolved fields');
                assert(doc.querySelectorAll('iframe').length===0,'Temporary frame leaked');
                htmls.push(html);
              }
              assert(htmls[0]!==htmls[1],'Distinct designs flattened');
              const owned=[{id:1,companyId:8,templateType:'Bill',htmlContent:'WRONG'},
                {id:2,companyId:7,divisionId:null,templateType:'Bill',htmlContent:'COMPANY'},
                {id:3,companyId:7,divisionId:4,templateType:'Bill',htmlContent:'DIVISION'}];
              assert(selectLedgerInvoiceTemplate(owned,7,4).htmlContent==='DIVISION','Division fallback');
              assert(selectLedgerInvoiceTemplate(owned,7,5).htmlContent==='COMPANY','Company fallback');
              assert(selectLedgerInvoiceTemplate(owned,99).htmlContent!=='WRONG','Cross-company branding');
              const statement={...report,title:'Profit and Loss',statement:'ProfitAndLoss',columns:[{key:'comparative'}],
                rows:[{label:'Revenue',amount:100,kind:'group',level:0},{label:'Net profit',amount:90,comparative:70,change:20,kind:'total',level:1}]};
              const stmt=await brandAccountingReport(buildReportHtml(statement),company,templates[0]);
              assert(stmt.includes('Net profit')&&stmt.includes('70.00')&&stmt.includes('20.00'),'Statement hierarchy/comparative lost');
              const ledger=await buildCustomerLedgerHtml({...report,openingBalance:0,closingBalance:10000,totalDebit:10000,totalCredit:0},company,templates[0]);
              assert(ledger.includes('Customer Ledger')&&ledger.includes('REF-99'),'Ledger regressed');
              const pdfs=[];
              for(const [index,html] of [htmls[0],stmt].entries()){
                const pdf=new jsPDF({unit:'mm',format:'a4',orientation:index?'portrait':'landscape'});
                const original=pdf.addImage.bind(pdf);
                pdf.addImage=(data,type,x,y,w,h,...rest)=>{
                  assert(x>=11.99&&y>=11.99&&x+w<=pdf.internal.pageSize.getWidth()-11.99&&y+h<=pdf.internal.pageSize.getHeight()-11.99,'PDF content outside margins');
                  return original(data,type,x,y,w,h,...rest);
                };
                const pages=await renderIntoPdf(pdf,html,{marginMm:12,repeatTableHeader:'.accounting-table'});
                assert(index||pages>1,'Long report did not paginate');
                assert(getComputedStyle(document.querySelector('#sentinel')).color==='rgb(123, 45, 67)','PDF CSS changed app');
                assert(!document.querySelector('iframe'),'Brand frame cleanup');
                pdfs.push(btoa(pdf.output()));
              }
              return {checks,pdfs,html:htmls[0]};
            }""", {"templates": templates, "url": url})
            if args.output:
                args.output.mkdir(parents=True, exist_ok=True)
                for i, pdf in enumerate(result["pdfs"]):
                    (args.output / f"report-{i}.pdf").write_bytes(base64.b64decode(pdf))
                page.set_content(result["html"])
                for width in (375, 768, 1280):
                    page.set_viewport_size({"width": width, "height": 900})
                    assert page.locator('.report-letterhead').is_visible()
                page.screenshot(path=str(args.output / "company-report.png"), full_page=False)
            browser.close()
            print(f'{result["checks"]} checks passed; {len(templates)} distinct template inputs; 2 PDF layouts verified')
    finally:
        server.terminate()
        server.wait(timeout=10)
