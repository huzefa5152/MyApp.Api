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
checks=0
with sync_playwright() as pw:
 browser=pw.chromium.launch();context=browser.new_context()
 context.add_init_script('localStorage.setItem("token",'+json.dumps(token)+' );localStorage.setItem("selectedCompanyId",'+json.dumps(str(cid))+');')
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/env.js',lambda r:r.fulfill(body="window._env_={API_URL:'/api'};",content_type='text/javascript'))
 for width in (375,768,1280):
  page.set_viewport_size({'width':width,'height':900})
  for path,button in [('/receipts','Record Receipt'),('/payments','Record Payment')]:
   page.goto(args.ui+path)
   page.get_by_role('button',name=button,exact=True).click(timeout=30000)
   page.get_by_role('button',name='Someone else',exact=True).click()
   page.get_by_label('Payee or payer name').fill('UI transport')
   page.get_by_label('Account 1').select_option(str((f['income'] if path=='/receipts' else f['expense'])['id']))
   page.get_by_label('Amount 1',exact=True).fill('50')
   page.get_by_role('button',name='Add account line',exact=True).click()
   page.get_by_label('Account 2').select_option(str((f['income'] if path=='/receipts' else f['expense'])['id']))
   page.get_by_label('Amount 2',exact=True).fill('25')
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(path,width,'overflow')
   save=page.get_by_role('button',name='Save Receipt' if path=='/receipts' else 'Save Payment',exact=True)
   with page.expect_response(lambda r:'/api/payments/' in r.url and r.request.method=='POST') as response:save.click()
   assert response.value.status in (200,201),response.value.text()
   d=response.value.json();assert d['contactName']=='UI transport' and d['amount']==75
   assert not errors,errors
   checks+=1
   print('PASS flexible money',path,width)
 browser.close()
print(f'{checks} money UI cases passed at 375/768/1280px')
