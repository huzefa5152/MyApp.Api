"""Exercise real Trader copy and flexible money forms against an approved local database."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from test_accounting_posting import http

ap=argparse.ArgumentParser()
ap.add_argument('--base',default='http://localhost:5197')
ap.add_argument('--ui',default='http://127.0.0.1:5198')
ap.add_argument('--fixture',type=Path,required=True)
args=ap.parse_args()
assert all(url.startswith(('http://localhost:','http://127.0.0.1:')) for url in (args.base,args.ui))
f=json.loads(args.fixture.read_text());cid=f['companyId']
status,login=http('POST','/api/auth/login',args.base,body={'username':'admin','password':'admin123'});assert status==200
token=login['token']
def api(method,path,body=None):
 s,d=http(method,path,args.base,token,body);assert s in (200,201),(path,s,d);return d
source=api('POST',f'/api/deliverychallans/company/{cid}',{'clientId':f['client']['id'],'poNumber':'COPY-PO','poDate':'2026-10-05','deliveryDate':'2026-10-05','notes':'Copy source notes','items':[{'description':'Copy bolt','quantity':2,'unit':'KG'},{'description':'Copy nut','quantity':3,'unit':'KG'}]})
quote=api('POST',f'/api/salesquotes/company/{cid}',{'clientId':f['client']['id'],'date':'2026-10-05','gstRate':18,'items':[{'description':'Copy quote','quantity':1,'unit':'KG','unitPrice':150}]})
order=api('POST',f'/api/salesorders/company/{cid}',{'clientId':f['client']['id'],'orderDate':'2026-10-05','items':[{'description':'Copy order','quantity':2,'unit':'KG'}]})
purchase=api('POST','/api/purchasebills',{'companyId':cid,'supplierId':f['supplier']['id'],'date':'2026-10-05','gstRate':18,'items':[{'description':'Copy purchase','quantity':2,'uom':'KG','unitPrice':80}]})
goods=api('POST','/api/goodsreceipts',{'companyId':cid,'supplierId':f['supplier']['id'],'receiptDate':'2026-10-05','items':[{'description':'Copy receipt','quantity':2,'unit':'KG'}]})
checks=0
with sync_playwright() as pw:
 browser=pw.chromium.launch()
 context=browser.new_context()
 context.add_init_script('localStorage.setItem("token",'+json.dumps(token)+');localStorage.setItem("selectedCompanyId",'+json.dumps(str(cid))+');')
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/env.js',lambda r:r.fulfill(body="window._env_={API_URL:'/api'};",content_type='text/javascript'))
 cases=[('/challans','New Challan',source['id']),('/sales-quotes','New Quote',quote['id']),('/sales-orders','New Order',order['id']),('/bills','New Bill (No Challan)',f['invoice']['id']),('/purchase-bills','New Purchase Bill',purchase['id']),('/goods-receipts','New Receipt',goods['id'])]
 for width in (375,768,1280):
  page.set_viewport_size({'width':width,'height':900})
  for path,button,sid in cases:
   page.goto(args.ui+path)
   page.get_by_role('button',name=button,exact=True).click(timeout=30000)
   page.get_by_role('button',name='Copy from a document',exact=True).click()
   picker=page.get_by_label('Copy source document')
   expect(picker.locator(f'option[value="{sid}"]')).to_be_attached(timeout=30000)
   picker.select_option(str(sid))
   page.get_by_text('Copy document details too',exact=False).click()
   page.get_by_role('button',name='Copy document into this form',exact=True).click()
   expect(page.get_by_role('button',name='Copy from a document',exact=True)).to_be_visible()
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(path,width,'overflow')
   assert not errors,(path,width,errors)
   # Verify actual copied values, not merely successful rendering.
   expected_text = '/challans' == path and 'Copy bolt' or '/sales-quotes' == path and 'Copy quote' or '/sales-orders' == path and 'Copy order' or '/bills' == path and '[TEMP] Widget' or '/purchase-bills' == path and 'Copy purchase' or 'Copy receipt'
   assert page.locator('input,textarea').evaluate_all('(els,text)=>els.some(el=>el.value===text)',expected_text),(path,'missing copied description')
   if path=='/challans':
    copies=page.get_by_role('button',name='Copy',exact=True)
    copies.first.click()
    assert page.locator('input,textarea').evaluate_all('(els)=>els.filter(el=>el.value==="Copy bolt").length')==2
    checks+=1
    if width==1280:
     with page.expect_response(lambda r:'/api/deliverychallans/company/' in r.url and r.request.method=='POST') as saved:
      page.get_by_role('button',name='Save Challan',exact=True).click()
     assert saved.value.status in (200,201),saved.value.text()
     d=saved.value.json();assert d['id']!=source['id'] and d['challanNumber']!=source['challanNumber'] and len(d['items'])==3
     assert not d.get('invoiceId') and not d.get('duplicatedFromId') and not d.get('salesOrderId')
     assert all(not line.get('salesOrderItemId') for line in d['items'])
     checks+=1
   checks+=1
   print('PASS copy form' ,path,width)
 # Selected-line append across document types keeps the destination header untouched.
 page.goto(args.ui+'/challans');page.get_by_role('button',name='New Challan',exact=True).click()
 page.get_by_role('button',name='Copy from a document',exact=True).click()
 page.get_by_label('Copy source document').select_option(str(source['id']))
 expect(page.get_by_text('Copy document details too',exact=False)).to_be_visible()
 page.locator('label').filter(has_text='Copy nut —').locator('input').uncheck()
 page.get_by_role('button',name='Add selected items',exact=True).click()
 assert page.locator('input,textarea').evaluate_all('(els)=>els.some(el=>el.value==="Copy bolt") && !els.some(el=>el.value==="Copy nut")')
 page.get_by_role('button',name='Copy from a document',exact=True).click()
 page.get_by_label('Copy source type').select_option('Quote')
 expect(page.get_by_label('Copy source document').locator(f'option[value="{quote["id"]}"]')).to_be_attached()
 page.get_by_label('Copy source document').select_option(str(quote['id']))
 page.get_by_role('button',name='Add selected items',exact=True).click()
 assert page.locator('input,textarea').evaluate_all('(els)=>els.some(el=>el.value==="Copy bolt") && els.some(el=>el.value==="Copy quote")')
 assert not page.get_by_role('button',name='Save Challan',exact=True).is_enabled(), 'Items-only copy must not silently select a client'
 checks+=3
 print('PASS selected items, cross-document append and header preservation')
 browser.close()
print(f'{checks} real-form cases passed at 375/768/1280px')
