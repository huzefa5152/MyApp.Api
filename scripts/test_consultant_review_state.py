"""Local-only regression for first adjustment versus re-review. Never submits to FBR."""
import argparse
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import uuid4
from test_tenant_leak_sweep import http, company_payload
parser=argparse.ArgumentParser()
parser.add_argument('--base',default='http://localhost:5144')
a=parser.parse_args()
assert urlparse(a.base).hostname in ('localhost','127.0.0.1','::1')
status,login=http('POST','/api/auth/login',a.base,body={'username':'admin','password':'admin123'})
assert status==200
token=login['token']; count=0

def call(method,path,body=None):
 status,data=http(method,path,a.base,token,body)
 assert status in (200,201,204),(method,path,status,data)
 return data

def check(ok,label):
 global count
 assert ok,label
 count+=1;print('PASS',label,flush=True)

company=company_payload('[TEMP] Review state '+uuid4().hex[:8])
company.update(fbrToken='local-fixture-token',fbrBusinessActivity='Importer',fbrSector='Other')
cid=call('POST','/api/companies',company)['id']
try:
 client=call('POST','/api/clients',{'companyId':cid,'name':'[TEMP] Review buyer','address':'Sample address','ntn':'1234567','registrationType':'Registered','fbrProvinceCode':8})
 plain=call('POST','/api/itemtypes',{'companyId':cid,'name':'[TEMP] Commercial item','uom':'Nos'})
 filing=call('POST','/api/itemtypes',{'companyId':cid,'name':'[TEMP] Filing classification','uom':'Nos','hsCode':'9403.6000','saleType':'Goods at standard rate (default)','fbrUOMId':13})
 today=datetime.now(timezone.utc).strftime('%Y-%m-%dT00:00:00Z')
 def challan(label):
  return call('POST',f'/api/deliverychallans/company/{cid}',{'companyId':cid,'clientId':client['id'],'poNumber':'LOCAL-'+label,'poDate':today,'deliveryDate':today,'items':[{'description':label,'quantity':1,'unit':'Nos','itemTypeId':plain['id']}]})
 first,second=challan('First'),challan('Second')
 bill=call('POST','/api/invoices',{'companyId':cid,'clientId':client['id'],'date':today,'gstRate':18,'challanIds':[first['id']],'items':[{'deliveryItemId':first['items'][0]['id'],'unitPrice':100}]})
 iid=bill['id']; path=f'/api/invoices/{iid}'
 check(bill['fbrAdjustmentRequired'] and not bill['fbrReviewRequired'],'new bill needs initial adjustment, not re-review')
 ch=call('GET',f'/api/deliverychallans/{first["id"]}')
 ch['items'][0]['quantity']=2
 call('PUT',f'/api/deliverychallans/{first["id"]}',ch)
 bill=call('GET',path)
 check(bill['fbrAdjustmentRequired'] and not bill['fbrReviewRequired'],'billed challan edit before consultant work does not trigger re-review')
 opts=call('GET',path+'/challans')
 available=next(x for x in opts['available'] if x['id']==second['id'])
 bill=call('PUT',path+'/challans',{'version':opts['version'],'challanIds':[first['id'],second['id']],'addedChallanVersions':{str(second['id']):available['version']},'unitPrices':{str(x['id']):100 for x in available['items']}})
 check(not bill['fbrReviewRequired'] and bill['fbrAdjustmentRequired'],'adding a challan before consultant work stays initial adjustment')
 preview=call('GET',f'/api/fbr/{iid}/preview-payload')
 check(not preview['success'] and 'initial' in preview['errorMessage'].lower(),'first filing cannot bypass consultant review through FBR preview')
 def review():
  editor=call('GET',path+'/tax-filing')
  return call('PUT',path+'/tax-filing',{'version':editor['version'],'rows':[{'sourceLineIds':[i['id'] for i in editor['bill']['items']],'itemTypeId':filing['id'],'quantity':3,'valueExclTax':editor['bill']['subtotal']}]})
 saved=review(); baseline=saved['rows']
 check(not saved['requiresReview'] and saved['bill']['fbrReady'],'completed first review makes filing ready')
 bill=call('GET',path); bill['freightCharges']=50; bill['notes']='Local non-filing note'
 call('PUT',path,bill)
 state=call('GET',path+'/tax-filing')

 check(not state['requiresReview'] and state['rows']==baseline,'freight and notes preserve reviewed filing')
 ch=call('GET',f'/api/deliverychallans/{first["id"]}')
 ch['items'][0]['actualUnitCost']=10
 call('PUT',f'/api/deliverychallans/{first["id"]}',ch)
 state=call('GET',path+'/tax-filing')
 check(not state['requiresReview'],'supplier actual cost does not trigger re-review')
 bill=call('GET',path); bill['items'][0]['description']='Changed filing supply'
 call('PUT',path,bill)
 state=call('GET',path+'/tax-filing')
 check(state['requiresReview'] and state['bill']['fbrReviewRequired'],'same-total filing change requires consultant re-review')
 check(state['rows']==baseline,'saved combined HS filing remains intact for comparison')
 review()
 state=call('GET',path+'/tax-filing')
 check(not state['requiresReview'] and state['bill']['fbrReady'],'completing re-review clears the warning')
 reviewed_rows=state['rows']
 third=challan('Third')
 opts=call('GET',path+'/challans')
 available=next(x for x in opts['available'] if x['id']==third['id'])
 changed=call('PUT',path+'/challans',{'version':opts['version'],'challanIds':[first['id'],second['id'],third['id']],'addedChallanVersions':{str(third['id']):available['version']},'unitPrices':{str(x['id']):100 for x in available['items']}})
 check(changed['fbrReviewRequired'] and not changed['fbrAdjustmentRequired'],'adding a challan after consultant work requires re-review')
 check(call('GET',path+'/tax-filing')['rows']==reviewed_rows,'challan addition preserves prior saved filing rows')
 print(f'{count} passed, 0 failed',flush=True)
finally:
 call('DELETE',f'/api/companies/{cid}')
