"""Local manual challan reference checks; creates no delivery documents or stock."""
import argparse
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import uuid4
from test_tenant_leak_sweep import http

p=argparse.ArgumentParser()
p.add_argument('--base',required=True)
a=p.parse_args()
assert urlparse(a.base).hostname in ('localhost','127.0.0.1')
s,login=http('POST','/api/auth/login',a.base,body={'username':'admin','password':'admin123'})
assert s==200,s
token=login['token']
checks=0

def call(method,path,body=None):
 s,data=http(method,path,a.base,token,body)
 assert s in (200,201,204),(path,s,data)
 return data

def check(ok,label):
 global checks
 assert ok,label
 checks+=1
 print('PASS',label,flush=True)

co=call('POST','/api/companies',{'name':'[TEMP] Manual reference '+uuid4().hex[:8],'startingInvoiceNumber':1})
cid=co['id']
try:
 client=call('POST','/api/clients',{'companyId':cid,'name':'Sample buyer','registrationType':'Unregistered'})
 body={'companyId':cid,'clientId':client['id'],'date':datetime.now(timezone.utc).strftime('%Y-%m-%d'),'gstRate':18,'manualChallanNumber':'  DC-00212  ','items':[{'description':'Sample service','quantity':2,'unitPrice':100,'uom':'Nos'}]}
 bill=call('POST','/api/invoices/standalone',body)
 iid=bill['id']
 check(bill['manualChallanNumber']=='DC-00212','manual reference is trimmed and saved')
 check(bill['challanNumbers']==[],'manual reference is not a linked system challan')
 check(call('GET',f'/api/invoices/{iid}')['manualChallanNumber']=='DC-00212','reference survives a reload')
 check(call('GET',f'/api/deliverychallans/company/{cid}/pending')==[],'no delivery challan is created')
 check(call('GET',f'/api/stock/company/{cid}/onhand')==[],'no inventory is created')
 for kind in ('bill','tax-invoice'):
  printed=call('GET',f'/api/invoices/{iid}/print/{kind}')
  check(printed['challanNumbers']==['DC-00212'],kind+' existing merge field contains the manual reference')
  check(printed['manualChallanNumber']=='DC-00212',kind+' explicit merge field contains the reference')
 update={'gstRate':18,'items':bill['items']}
 call('PUT',f'/api/invoices/{iid}',update)
 check(call('GET',f'/api/invoices/{iid}')['manualChallanNumber']=='DC-00212','older API edits preserve an omitted reference')
 update['manualChallanNumber']='DC-00300'
 call('PUT',f'/api/invoices/{iid}',update)
 check(call('GET',f'/api/invoices/{iid}/print/bill')['challanNumbers']==['DC-00300'],'standalone bill reference can be edited')
 update['manualChallanNumber']=''
 call('PUT',f'/api/invoices/{iid}',update)
 check(call('GET',f'/api/invoices/{iid}/print/bill')['challanNumbers']==[],'clearing the reference prints an empty value')
 body['manualChallanNumber']='x'*101
 check(http('POST','/api/invoices/standalone',a.base,token,body)[0]==400,'overlong reference is rejected')
 challan=call('POST',f'/api/deliverychallans/company/{cid}',{'clientId':client['id'],'deliveryDate':body['date'],'items':[{'description':'Sample linked product','quantity':1,'unit':'Nos'}]})
 linked=call('POST','/api/invoices',{'companyId':cid,'clientId':client['id'],'date':body['date'],'gstRate':18,'challanIds':[challan['id']],'items':[{'deliveryItemId':challan['items'][0]['id'],'unitPrice':100}]})
 update={'gstRate':18,'items':linked['items'],'manualChallanNumber':'FAKE-REFERENCE'}
 check(http('PUT',f"/api/invoices/{linked['id']}",a.base,token,update)[0]==400,'linked challans cannot be overridden with a manual reference')
 printed=call('GET',f"/api/invoices/{linked['id']}/print/bill")
 check(printed['challanNumbers']==[challan['challanNumber']],'linked challans retain their numeric print contract')
 print(f'{checks} passed, 0 failed',flush=True)
finally:
 call('DELETE',f'/api/companies/{cid}')
