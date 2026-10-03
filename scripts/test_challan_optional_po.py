"""Local billing contracts for optional PO details and incomplete FBR setup."""
import argparse
from test_custom_bill_number import setup, http, TODAY
from urllib.parse import urlparse
p=argparse.ArgumentParser();p.add_argument('--base',default='http://localhost:5136');a=p.parse_args()
if urlparse(a.base).hostname not in ('localhost','127.0.0.1','::1'):
    p.error('This write test requires a local, isolated test database.')
token,company,client,item=setup(a.base,'admin','admin123','TEST')
def req(method,path,body=None):
    return http(method,path,a.base,token,body)
def challan(po='',date=None,buyer=None,co=None):
    co=co or company;buyer=buyer or client
    code,data=req('POST',f"/api/deliverychallans/company/{co['id']}",dict(companyId=co['id'],clientId=buyer['id'],poNumber=po,poDate=date,deliveryDate=TODAY,items=[dict(description='Sample delivery',quantity=2,unit='Pcs')]))
    assert code in (200,201),(code,data)
    return data
def bill(challans,po=None,date=None,buyer=None,co=None):
    return req('POST','/api/invoices',dict(companyId=(co or company)['id'],clientId=(buyer or client)['id'],date=TODAY,gstRate=18,challanIds=[c['id'] for c in challans],poNumber=po,poDate=date,items=[dict(deliveryItemId=i['id'],unitPrice=100) for c in challans for i in c['items']]))
def get(c):
    code,data=req('GET',f"/api/deliverychallans/{c['id']}");assert code==200;return data
count=0
def check(label,condition):
    global count
    assert condition,label
    count+=1;print('PASS',label)
c=challan();check('no PO source',c['status']=='No PO')
code,pool=req('GET',f"/api/deliverychallans/company/{company['id']}/pending")
check('no PO available for billing',code==200 and c['id'] in [x['id'] for x in pool])
code,invoice=bill([c]);check('bill without PO succeeds',code in (200,201))
check('bill PO stays empty',not invoice.get('poNumber') and not invoice.get('poDate'))
check('blank PO preserved',not get(c).get('poNumber') and not get(c).get('poDate'))
c1,c2,untouched=challan(),challan(),challan()
code,invoice=bill([c1,c2],'PO-SAMPLE',TODAY);check('multiple no PO deliveries billed',code in (200,201))
for c in [c1,c2]:
    saved=get(c);check('PO number and date backfilled',saved['poNumber']=='PO-SAMPLE' and saved['poDate'][:10]==TODAY[:10] and saved['invoiceId']==invoice['id'])
check('unselected challan untouched',not get(untouched).get('poNumber'))
code,data=bill([c1],'OTHER',TODAY);check('already billed refused',code==400)
check('refused billing preserves PO',get(c1)['poNumber']=='PO-SAMPLE')
c3,c4=challan('PO-ORIGINAL',TODAY),challan('PO-ORIGINAL',TODAY)
code,data=bill([c3,c4]);check('one PO multiple challans succeeds',code in (200,201))
check('existing PO preserved when blank',all(get(c)['poNumber']=='PO-ORIGINAL' for c in [c3,c4]))
c5=challan('PO-OLD',TODAY);code,data=bill([c5],'PO-NEW','2026-10-02');check('explicit PO replaces original',code in (200,201) and get(c5)['poNumber']=='PO-NEW' and get(c5)['poDate'][:10]=='2026-10-02')
code,other=req('POST','/api/clients',dict(companyId=company['id'],name='Sample second buyer'))
assert code in (200,201),(code,other)
code,data=bill([untouched],buyer=other);check('different client refused',code==400)
check('refused client leaves challan unbilled',get(untouched).get('invoiceId') is None)
code,minimal=req('POST','/api/companies',dict(name='Sample normal billing '+str(company['id']),startingInvoiceNumber=1));assert code in (200,201),(code,minimal)
code,buyer=req('POST','/api/clients',dict(companyId=minimal['id'],name='Sample normal buyer'));assert code in (200,201),(code,buyer)
c=challan(buyer=buyer,co=minimal);check('incomplete setup source',c['status']=='Setup Required')
code,pool=req('GET',f"/api/deliverychallans/company/{minimal['id']}/pending");check('setup required available',code==200 and c['id'] in [x['id'] for x in pool])
code,data=bill([c],buyer=buyer,co=minimal);check('normal bill without FBR setup succeeds',code in (200,201))
check('incomplete FBR setup is not ready',data.get('fbrReady') is False and 'Seller or buyer FBR setup' in data.get('fbrMissing',[]))
code,paged=req('GET',f"/api/invoices/company/{minimal['id']}/paged?page=1&pageSize=10")
check('list keeps incomplete setup not ready',code==200 and all(not x['fbrReady'] for x in paged['items']))
code,ready=req('POST','/api/invoices/standalone',dict(companyId=company['id'],clientId=client['id'],date=TODAY,gstRate=18,items=[dict(description='Sample ready goods',quantity=1,uom='Pcs',unitPrice=100,hsCode='8431.4900',saleType='Goods at standard rate (default)')]))
check('complete setup and classification remains ready',code in (200,201) and ready['fbrReady'])
code,paged=req('GET',f"/api/invoices/company/{company['id']}/paged?page=1&pageSize=100")
check('ready bill remains ready in list',code==200 and next(x for x in paged['items'] if x['id']==ready['id'])['fbrReady'])
print(f'{count}/{count} checks passed')
