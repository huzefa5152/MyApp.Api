"""Offline browser checks for company branding, report content and PDF margins."""
import argparse
import base64
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--templates", type=Path, help="Optional private template snapshot (read only)")
parser.add_argument("--output", type=Path)
parser.add_argument("--api-base", help="Optional isolated local API for report screen checks")
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
    environment = os.environ.copy()
    if args.api_base:
        assert args.api_base.startswith(("http://127.0.0.1:", "http://localhost:")), "UI checks require a local API"
        environment.update(VITE_API_PROXY_TARGET=args.api_base, VITE_API_URL="/api")
    server = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(port)], cwd=ROOT / "myapp-frontend", stdout=log, stderr=log, env=environment)
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
              const {buildTraderReportHtml} = await import(url+'/src/utils/traderAccountingReportPrint.js');
              const {brandAccountingReport} = await import(url+'/src/utils/accountingReportPrint.js');
              const {selectReportInvoiceTemplate} = await import(url+'/src/utils/invoiceReportBranding.js');
              const {renderAccountingReportIntoPdf} = await import(url+'/src/utils/accountingReportPdf.js');
              const {jsPDF} = await import(url+'/node_modules/.vite/deps/jspdf.js');
              const company={id:7,name:'Sample Company',fullAddress:'Sample address',phone:'Sample phone'};
              const report={rows:Array.from({length:100},(_,i)=>({name:'Customer '+i,openDocuments:1,current:100,total:100})),current:10000,total:10000};
              const buildReportHtml=()=>buildTraderReportHtml('aged-receivables',report,company,'Aged Receivables','October 2026');
              let checks=0,htmls=[];
              const assert=(ok,message)=>{if(!ok)throw new Error(message);checks++};
              for(const [templateIndex,template] of templates.entries()){
                const html=await brandAccountingReport(buildReportHtml(),company,template);
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
              assert(selectReportInvoiceTemplate(owned,7,4).htmlContent==='DIVISION','Division fallback');
              assert(selectReportInvoiceTemplate(owned,7,5).htmlContent==='COMPANY','Company fallback');
              assert(selectReportInvoiceTemplate(owned,99).htmlContent!=='WRONG','Cross-company branding');
              const statement={income:[{name:'Sales',total:100,lines:[{name:'Revenue',code:'4000',amount:100}]}],expenses:[],totalIncome:100,totalExpenses:10,netProfit:90};
              const stmt=await brandAccountingReport(buildTraderReportHtml('profit-and-loss',statement,company,'Profit and Loss','October 2026'),company,templates[0]);
              assert(stmt.includes('Revenue')&&stmt.includes('Net profit')&&stmt.includes('90.00'),'Profit and loss figures lost');
              const cases={
                'balance-sheet':{assets:[{name:'Assets',total:200,lines:[{name:'Bank',amount:200}]}],liabilities:[],equity:[],totalAssets:200,totalLiabilities:100,totalEquity:100,currentEarnings:10,isBalanced:false},
                'profit-and-loss':statement,'aged-receivables':report,'aged-payables':report,
                'cash-book':{accounts:[{name:'Bank',opening:10,moneyIn:30,moneyOut:5,closing:35}],opening:10,moneyIn:30,moneyOut:5,closing:35},
                expenses:{rows:[{name:'Rent',groupName:'Office',amount:15,percent:100}],total:15},
                'tax-control':{rows:[{role:'SalesTax',accountName:'Tax payable',perLedger:18,perDocuments:17,difference:1,reconciles:false}],allReconcile:false}
              };
              for(const [tab,data] of Object.entries(cases)){
                const html=await brandAccountingReport(buildTraderReportHtml(tab,data,company,tab,'October 2026'),company,templates[0]);
                assert(html.includes('accounting-table')&&!/NaN|undefined/.test(html),'Invalid report '+tab);
                if(tab==='balance-sheet')assert(html.includes('Does not balance')&&html.includes('Current-Year Earnings'),'Balance warning/earnings lost');
                if(tab==='cash-book')assert(html.includes('35.00'),'Closing balance lost');
                if(tab==='tax-control')assert(html.includes('disagrees')&&html.includes('18.00')&&html.includes('17.00'),'Tax comparison lost');
              }
              const pdfs=[];
              for(const [index,html] of [htmls[0],stmt].entries()){
                const pdf=new jsPDF({unit:'mm',format:'a4',orientation:index?'portrait':'landscape'});
                const original=pdf.addImage.bind(pdf);
                pdf.addImage=(data,type,x,y,w,h,...rest)=>{
                  assert(x>=11.99&&y>=11.99&&x+w<=pdf.internal.pageSize.getWidth()-11.99&&y+h<=pdf.internal.pageSize.getHeight()-11.99,'PDF content outside margins');
                  return original(data,type,x,y,w,h,...rest);
                };
                const pages=await renderAccountingReportIntoPdf(pdf,html);
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
                printed = page.pdf(prefer_css_page_size=True, print_background=False)
                (args.output / "browser-print.pdf").write_bytes(printed)
                import fitz
                document = fitz.open(stream=printed, filetype="pdf")
                assert "Customer 99" in "".join(p.get_text() for p in document)
                pixels = document[0].get_pixmap().samples
                green = sum(1 for r, g, b in zip(*[iter(pixels)] * 3) if abs(r-25) <= 1 and abs(g-59) <= 1 and abs(b-37) <= 1)
                assert green > 100, "Company heading lost its background in browser Print"
                print("Browser Print keeps every row and company colors with background graphics off")
            if args.api_base:
                ui = browser.new_page()
                ui.route("**/env.js", lambda route: route.fulfill(body="window._env_={API_URL:'/api'};", content_type="text/javascript"))
                ui.context.add_init_script("window.print=()=>{window.__printed=true}")
                ui.goto(url + "/login")
                ui.get_by_label("Username", exact=True).fill("admin")
                ui.get_by_label("Password", exact=True).fill("admin123")
                ui.locator('button[type="submit"]').click()
                ui.wait_for_url("**/dashboard")
                ui.goto(url + "/accounting/reports")
                for width in (375, 768, 1280):
                    ui.set_viewport_size({"width": width, "height": 900})
                    for label in ("Balance Sheet", "Profit & Loss", "Aged Receivables", "Aged Payables", "Cash Book", "Expenses", "Tax Control"):
                        ui.get_by_role("button", name=label, exact=True).click()
                        expect(ui.get_by_role("button", name="PDF", exact=True)).to_be_enabled(timeout=30000)
                        for action in ("Print", "PDF"):
                            button = ui.get_by_role("button", name=action, exact=True)
                            assert button.locator("svg").evaluate("el=>el.getBoundingClientRect().width") > 0
                        assert ui.evaluate("document.documentElement.scrollWidth<=innerWidth"), f"Report page overflows at {width}px"
                ui.get_by_role("button", name="Aged Receivables", exact=True).click()
                expect(ui.get_by_role("button", name="PDF", exact=True)).to_be_enabled()
                with ui.expect_download(timeout=60000) as download:
                    ui.get_by_role("button", name="PDF", exact=True).click()
                assert download.value.suggested_filename.endswith(".pdf")
                with ui.expect_popup() as popup:
                    ui.get_by_role("button", name="Print", exact=True).click()
                expect(popup.value.locator(".accounting-table")).to_be_visible(timeout=30000)
                popup.value.close()
                if args.output:
                    ui.screenshot(path=str(args.output / "accounting-report-screen.png"))
                print("21 report screen cases passed at 375/768/1280px; real PDF download and Print popup passed")
            browser.close()
            print(f'{result["checks"]} checks passed; {len(templates)} distinct template inputs; 2 PDF layouts verified')
    finally:
        server.terminate()
        server.wait(timeout=10)
