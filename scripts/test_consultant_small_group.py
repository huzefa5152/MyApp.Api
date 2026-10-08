import sys
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'scripts'))
"""Local-only tax grouping regression: commercial printing stays independent."""
import pyodbc,re
import test_basic_flows as f
BASE='http://127.0.0.1:5152'
def main():
 token,company,client=f.setup(BASE,'admin','admin123');cid=company['id']
 db=pyodbc.connect(r'DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\MSSQLSERVER02;DATABASE=MyApp_Trader_Local;Trusted_Connection=yes;TrustServerCertificate=yes',autocommit=True)
 count=0
 def call(m,p,b=None):
  st,r=f.http(m,p,BASE,token=token,body=b);assert st in (200,201,204),(st,r);return r
 def check(name,condition):
  nonlocal count
  assert condition,name;count+=1;print('PASS',name,flush=True)
 try:
  kind=call('POST',f'/api/itemtypes?companyId={cid}',{'companyId':cid,'name':'Sample electrical grouping','uom':'Pcs'})
  sources=[call('POST',f'/api/deliverychallans/company/{cid}',{'clientId':client['id'],'poNumber':'GROUP-UOM','deliveryDate':'2026-10-08','items':[{'description':'Sample line '+u,'quantity':2,'unit':u,'itemTypeId':kind['id']}]}) for u in (['Nos','Ft','Pcs'] * 8)]
  bill=call('POST','/api/invoices',{'companyId':cid,'clientId':client['id'],'date':'2026-10-08','gstRate':18,'challanIds':[c['id'] for c in sources],'items':[{'deliveryItemId':c['items'][0]['id'],'unitPrice':100,'uom':c['items'][0]['unit']} for c in sources]});iid=bill['id']
  db.execute("UPDATE ItemTypes SET HSCode='8536.5010',SaleType='Goods at standard rate (default)' WHERE Id=?",kind['id'])
  db.execute("UPDATE InvoiceItems SET HSCode='8536.5010',SaleType='Goods at standard rate (default)' WHERE InvoiceId=?",iid)
  from playwright.sync_api import sync_playwright
  import json,os
  db.execute('UPDATE Invoices SET GroupTaxInvoiceByItemType=0 WHERE Id=? AND CompanyId=?',iid,cid)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,channel='msedge')
   for width in (375,768,1280):
    ctx=browser.new_context(viewport={'width':width,'height':900})
    ctx.add_init_script('localStorage.setItem("token",'+json.dumps(token)+');localStorage.setItem("selectedCompanyId",'+json.dumps(str(cid))+');')
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:5189/invoices')
    page.locator('button[title="Adjust invoice for FBR"],button[title="Review and adjust the current bill for FBR; commercial bill edits are on Bills"]').first.click(timeout=30000)
    page.get_by_text(re.compile(r'1 item type.*24 lines')).wait_for(timeout=30000)
    check(str(width)+'px consultant starts as one group despite individual print setting',True)
    check(str(width)+'px tax group shows catalog Pcs',page.get_by_title('Comes from Item Type',exact=True).filter(has_text='Pcs').count()==1)
    check(str(width)+'px no horizontal page overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    check(str(width)+'px no browser errors',not errors)
    page.get_by_role('button',name='Exact Line Total',exact=True).click()
    group_qty=page.locator('input[type="number"][step="1"]').last
    group_qty.fill('10')
    check(str(width)+'px group quantity can be below commercial line count',group_qty.input_value()=='10')
    check(str(width)+'px old minimum blocker absent',page.get_by_text('needs at least 24',exact=False).count()==0)
    page.screenshot(path=os.path.join(os.environ['TEMP'],f'trader-small-group-{width}.png'),full_page=True)
    with page.expect_response(lambda r: '/itemtypes-and-qty' in r.url and r.request.method=='PATCH') as response:
     page.get_by_role('button',name='Save Adjustments',exact=True).click()
    check(str(width)+'px adjustment saves',response.value.status==200)
    saved=call('GET',f'/api/invoices/{iid}')
    check(str(width)+'px saving preserves individual print preference',saved['groupTaxInvoiceByItemType'] is False)
    check(str(width)+'px saving preserves commercial units',[i['uom'] for i in saved['items']]==(['Nos','Ft','Pcs'] * 8))
    check(str(width)+'px saved adjusted quantity sums to 10',abs(sum(float(i.get('adjustment',{}).get('adjustedQuantity') or i['quantity']) for i in saved['items'])-10)<0.00001)
    check(str(width)+'px commercial quantity unchanged',all(i['quantity']==2 for i in saved['items']))
    check(str(width)+'px exact total unchanged',saved['subtotal']==4800)
    bad=[{'id':i['id'],'itemTypeId':kind['id'],'quantity':0.1,'unitPrice':2000,'exactLineTotal':200} for i in saved['items']]
    st,resp=f.http('PATCH',f'/api/invoices/{iid}/itemtypes-and-qty',BASE,token=token,body={'items':bad,'writeMode':'adjustment'})
    check(str(width)+'px fractional Pcs group rejected',st==400)
    ctx.close()
   browser.close()

 finally:
  db.close();f.teardown(BASE,token,company,False)
if __name__=='__main__':main()
