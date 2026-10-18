"""Local-only regression for editing a billed delivery before FBR submission."""
import argparse, copy, time
from urllib.parse import urlparse
import pyodbc
import test_basic_flows as flows

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--base',required=True)
p.add_argument('--database',required=True)
a=p.parse_args()
assert urlparse(a.base).hostname in ('localhost','127.0.0.1')
assert a.database.endswith('_Test') and all(c.isalnum() or c=='_' for c in a.database)
db=pyodbc.connect('DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost\\MSSQLSERVER02;DATABASE='+a.database+';Trusted_Connection=yes;TrustServerCertificate=yes;',autocommit=True)
token,company,client=flows.setup(a.base,'admin','admin123')
cid=company['id']; assert db.execute('SELECT Name FROM Companies WHERE Id=?',cid).fetchone()[0]==company['name']
checks=0
users=[];roles=[];other_company=None
def check(label,ok):
 global checks
 assert ok,label
 checks+=1;print('PASS '+label,flush=True)
def call(method,path,body=None,expected=(200,201,204),auth=None):
 status,data=flows.http(method,path,a.base,token=auth or token,body=body)
 assert status in expected,(method,path,status,data)
 return data
now='2026-10-18T00:00:00Z'
def challan(label,lines=None):
 return call('POST',f'/api/deliverychallans/company/{cid}',{'clientId':client['id'],'poNumber':'TEST-DELIVERY','deliveryDate':now,'items':lines or [{'description':label+' A','quantity':2,'unit':'Pcs'},{'description':label+' B','quantity':3,'unit':'Pcs'}]})
def bill(dc):
 return call('POST','/api/invoices',{'companyId':cid,'clientId':client['id'],'date':now,'gstRate':18,'freightCharges':50,'challanIds':[dc['id']],'items':[{'deliveryItemId':i['id'],'unitPrice':100+index*10} for index,i in enumerate(dc['items'])]})
dc=challan('Delivery');inv=bill(dc);iid=inv['id'];path=f"/api/deliverychallans/{dc['id']}/bill-edit"
def snapshot():return call('GET',path)
def payload(s):
 return {'version':s['challan']['version'],'billVersion':s['billVersion'],'items':[dict(i,billUnitPrice=next(b['unitPrice'] for b in s['bill']['items'] if b['deliveryItemId']==i['id'])) for i in s['challan']['items']]}
def current_bill():return call('GET',f'/api/invoices/{iid}')
try:
 other_company=call('POST','/api/companies',{'name':'[TEMP] Other delivery company '+str(time.time_ns()),'startingChallanNumber':1,'startingInvoiceNumber':1})
 other_client=call('POST','/api/clients',{'companyId':other_company['id'],'name':'Other delivery buyer'})
 other_dc=call('POST',f"/api/deliverychallans/company/{other_company['id']}",{'clientId':other_client['id'],'deliveryDate':now,'items':[{'description':'Other company goods','quantity':1,'unit':'Pcs'}]})
 other_bill=call('POST','/api/invoices',{'companyId':other_company['id'],'clientId':other_client['id'],'date':now,'gstRate':18,'challanIds':[other_dc['id']],'items':[{'deliveryItemId':other_dc['items'][0]['id'],'unitPrice':100}]})
 other_path=f"/api/deliverychallans/{other_dc['id']}/bill-edit"
 other_snapshot=call('GET',other_path)
 other_type=call('POST',f"/api/itemtypes?companyId={other_company['id']}",{'companyId':other_company['id'],'name':'Other private goods','uom':'Pcs'})
 other_supplier=call('POST','/api/suppliers',{'companyId':other_company['id'],'name':'Other private supplier'})
 s=snapshot();check('edit context contains the correct bill and challan',s['bill']['id']==iid and s['challan']['id']==dc['id'])
 body=payload(s);body['items'][0]['quantity']=5;body['items'][0]['description']='Changed delivery';body['items'].pop();body['items'].append({'id':0,'description':'New priced goods','quantity':4,'unit':'Pcs','billUnitPrice':25})
 saved=call('PUT',path,body);b=current_bill()
 check('changed quantity and description synchronize',b['items'][0]['quantity']==5 and b['items'][0]['description']=='Changed delivery')
 check('retained rate preserved',b['items'][0]['unitPrice']==100)
 check('removed delivery line removed from bill',all(i['deliveryItemId']!=dc['items'][1]['id'] for i in b['items']))
 added=next(i for i in b['items'] if i['description']=='New priced goods')
 check('new line keeps generated delivery link and entered price',added['deliveryItemId'] in [i['id'] for i in saved['items']] and added['unitPrice']==25 and added['lineTotal']==100)
 check('GST and commercial freight reconcile',b['subtotal']==600 and b['gstAmount']==108 and b['grandTotal']==708 and b['freightCharges']==50)
 check('no false consultant re-review before any consultant work',not b['fbrReviewRequired'])
 call('PUT',path,body,expected=(400,));check('stale editor cannot overwrite saved changes',True)
 s=snapshot();base=payload(s)
 for name,bad in [('empty',dict(base,items=[])),('missing delivery version',dict(base,version='')),('missing bill version',dict(base,billVersion=''))]:
  call('PUT',path,bad,expected=(400,));check(name+' rejected',True)
 for rate in [None,-1,1000000]:
  bad=copy.deepcopy(base);bad['items'][0]['billUnitPrice']=rate;call('PUT',path,bad,expected=(400,));check('invalid rate '+str(rate)+' rejected',True)
 for unit,qty in [('Pcs',0),('Pcs',-1),('Pcs',1.5),('',1)]:
  bad=copy.deepcopy(base);bad['items'][0].update(unit=unit,quantity=qty);call('PUT',path,bad,expected=(400,));check('invalid unit/quantity '+str((unit,qty))+' rejected',True)
 for field,value in [('itemTypeId',other_type['id']),('supplierId',other_supplier['id'])]:
  bad=copy.deepcopy(base);bad['items'][0][field]=value;call('PUT',path,bad,expected=(400,));check('cross-company '+field+' rejected',True)
 foreign=challan('Foreign row');bad=copy.deepcopy(base);bad['items'][0]['id']=foreign['items'][0]['id'];call('PUT',path,bad,expected=(400,));check('line from another challan rejected',True)
 bad=copy.deepcopy(base);bad['items'].append(copy.deepcopy(bad['items'][0]));call('PUT',path,bad,expected=(400,));check('duplicate row IDs rejected',True)
 s=snapshot();body=payload(s);body['items'].append({'id':0,'description':'Explicit free goods','quantity':1,'unit':'Pcs','billUnitPrice':0});call('PUT',path,body);check('explicit zero rate accepted',next(i for i in current_bill()['items'] if i['description']=='Explicit free goods')['unitPrice']==0)
 # A rate-only bill edit invalidates the preview even when the delivery is unchanged.
 s=snapshot();body=payload(s);b=current_bill();call('PUT',f'/api/invoices/{iid}',{'gstRate':18,'items':[dict(i,uom=i['uom'],unitPrice=i['unitPrice']+1) for i in b['items']]});call('PUT',path,body,expected=(400,));check('concurrent bill rate change rejects stale delivery editor',True)
 s=snapshot();body=payload(s);cost=call('GET',f"/api/deliverychallans/{dc['id']}");call('PATCH',f"/api/deliverychallans/{dc['id']}/private-costs",{'version':cost['version'],'items':[{'id':i['id'],'actualUnitCost':17,'supplierId':None} for i in cost['items']]});call('PUT',path,body,expected=(400,));check('concurrent private-cost change rejects stale delivery editor',True)
 # Paid balances must remain covered; rollback must include the delivery.
 call('POST',f'/api/accounts/company/{cid}/seed-wholesale');accounts=call('GET',f'/api/accounts/company/{cid}/flat');bank=next(x for x in accounts if x.get('controlType')=='BankCash')
 receipt=call('POST',f'/api/payments/receipts/company/{cid}',{'date':now,'contactType':'Client','contactId':client['id'],'bankAccountId':bank['id'],'method':'Cash','amount':500,'allocations':[{'invoiceId':iid,'amount':500}]})
 s=snapshot();body=payload(s)
 for i in body['items']:i['billUnitPrice']=0
 call('PUT',path,body,expected=(400,));check('allocated receipts block reduction and leave delivery unchanged',snapshot()['challan']['version']==s['challan']['version'])
 call('DELETE',f"/api/payments/receipts/{receipt['id']}")
 call('PUT',f'/api/accounting/gl/company/{cid}/lock-date',{'lockDate':now});s=snapshot();body=payload(s);body['items'][0]['quantity']+=1;call('PUT',path,body,expected=(400,));check('locked accounting period blocks edit',True)
 call('PUT',f'/api/accounting/gl/company/{cid}/lock-date',{'lockDate':None})
 # SQL installs local-only FBR states. No FBR requests are made.
 for state,irn,stamp in [('Submitting',None,None),('Uncertain',None,None),('Submitted',None,None),(None,'LOCAL-ONLY-IRN',None),(None,None,now)]:
  s=snapshot();body=payload(s);db.execute('UPDATE Invoices SET FbrStatus=?,FbrIRN=?,FbrSubmittedAt=? WHERE Id=? AND CompanyId=?',state,irn,stamp,iid,cid)
  call('GET',path,expected=(400,));call('PUT',path,body,expected=(400,));check('FBR lock '+str(state or irn or 'timestamp')+' protects read and write',True)
  db.execute('UPDATE Invoices SET FbrStatus=NULL,FbrIRN=NULL,FbrSubmittedAt=NULL WHERE Id=? AND CompanyId=?',iid,cid)
 # Classified additions must reflow stock and a balanced accounting entry.
 db.execute('UPDATE Companies SET InventoryTrackingEnabled=1 WHERE Id=?',cid)
 types=call('GET',f'/api/itemtypes?companyId={cid}')
 stock_type=next((t for t in types if t.get('hsCode')),None)
 if stock_type is None:stock_type=call('POST',f'/api/itemtypes?companyId={cid}',{'companyId':cid,'name':'Local tracked delivery goods','hsCode':'8412.9020','uom':'Pcs','fbrUOMId':1,'saleType':'Goods at Standard Rate (default)'})
 supplier=call('POST','/api/suppliers',{'companyId':cid,'name':'Local delivery supplier'})
 call('POST','/api/purchasebills',{'companyId':cid,'supplierId':supplier['id'],'date':now,'gstRate':0,'items':[{'itemTypeId':stock_type['id'],'description':'Stock for delivery test','quantity':100,'unitPrice':20,'uom':'Pcs'}]})
 tracked=challan('Stock delivery');tracked_bill=bill(tracked);tracked_path=f"/api/deliverychallans/{tracked['id']}/bill-edit"
 def onhand():return next(i['onHand'] for i in call('GET',f'/api/stock/company/{cid}/onhand') if i['itemTypeId']==stock_type['id'])
 s=call('GET',tracked_path);body=payload(s);body['items'].append({'id':0,'description':'Tracked addition','itemTypeId':stock_type['id'],'quantity':3,'unit':'Pcs','billUnitPrice':50})
 call('PUT',tracked_path,body);check('new classified delivery line records one stock OUT',onhand()==97)
 journal=db.execute('SELECT COUNT(DISTINCT e.Id),COALESCE(SUM(l.Debit),0),COALESCE(SUM(l.Credit),0) FROM JournalEntries e JOIN JournalLines l ON l.JournalEntryId=e.Id WHERE e.CompanyId=? AND e.SourceDocType=1 AND e.SourceDocId=?',cid,tracked_bill['id']).fetchone()
 check('bill is reposted once with balanced accounting',journal[0]==1 and journal[1]==journal[2] and journal[1]>0)
 s=call('GET',tracked_path);body=payload(s);next(i for i in body['items'] if i['description']=='Tracked addition')['quantity']=5;call('PUT',tracked_path,body);check('quantity edit replaces previous stock movement',onhand()==95)
 s=call('GET',tracked_path);body=payload(s);body['items']=[i for i in body['items'] if i['description']!='Tracked addition'];call('PUT',tracked_path,body);check('removal restores stock exactly once',onhand()==100)
 db.execute('UPDATE Companies SET StockGuardHardBlock=1 WHERE Id=?',cid)
 s=call('GET',tracked_path);body=payload(s);body['items'].append({'id':0,'description':'Oversold addition','itemTypeId':stock_type['id'],'quantity':101,'unit':'Pcs','billUnitPrice':50});call('PUT',tracked_path,body,expected=(400,));check('hard stock guard rolls back delivery and bill',onhand()==100 and all(i['description']!='Oversold addition' for i in call('GET',tracked_path)['challan']['items']))
 db.execute('UPDATE Companies SET StockGuardHardBlock=0 WHERE Id=?',cid)
 s=call('GET',tracked_path);body=payload(s);body['items'].append({'id':0,'description':'Allowed negative stock','itemTypeId':stock_type['id'],'quantity':101,'unit':'Pcs','billUnitPrice':50})
 result=call('PUT',tracked_path,body);check('soft stock policy returns the saved negative balance warning',any(w['itemTypeId']==stock_type['id'] and w['onHand']==-1 for w in result['stockWarnings']))
 s=call('GET',tracked_path);body=payload(s);body['items']=[i for i in body['items'] if i['description']!='Allowed negative stock'];call('PUT',tracked_path,body);check('correcting soft oversell restores stock',onhand()==100)

 s=snapshot();body=payload(s);body['items'][0]['quantity']+=1
 db.execute('UPDATE Invoices SET OriginalInvoiceId=? WHERE Id=? AND CompanyId=?',iid,tracked_bill['id'],cid)
 call('PUT',path,body,expected=(400,));check('active credit/debit dependency blocks delivery mutation',True)
 db.execute('UPDATE Invoices SET OriginalInvoiceId=NULL WHERE Id=? AND CompanyId=?',tracked_bill['id'],cid)
 # Bill-side classification must survive delivery edits and rate-only edits.
 b=current_bill();lines=copy.deepcopy(b['items']);lines[0]['itemTypeId']=stock_type['id']
 call('PUT',f'/api/invoices/{iid}',{'gstRate':18,'items':lines})
 s=snapshot();body=payload(s);body['items'][0]['quantity']+=1;call('PUT',path,body)
 check('delivery quantity edit preserves bill-selected item type',current_bill()['items'][0]['itemTypeId']==stock_type['id'])
 s=snapshot();body=payload(s);body['items'][0]['billUnitPrice']+=1;call('PUT',path,body)
 check('rate-only edit preserves classification and changes price',current_bill()['items'][0]['itemTypeId']==stock_type['id'] and current_bill()['items'][0]['unitPrice']==body['items'][0]['billUnitPrice'])
 # Existing consultant work is retained and flagged for review on source change.
 b=current_bill();call('PATCH',f'/api/invoices/{iid}/itemtypes-and-qty',{'writeMode':'adjustment','items':[{'id':b['items'][0]['id'],'quantity':2,'unitPrice':b['items'][0]['lineTotal']/2}]})
 s=snapshot();body=payload(s);body['items'][0]['quantity']+=1;call('PUT',path,body);b=current_bill();check('consultant adjustment preserved',b['items'][0]['adjustment'] is not None);check('changed adjusted bill needs review',b['fbrReviewRequired'])
 # Role and company isolation on both new endpoints.
 for label,keys,assigned in [('allowed',['challans.manage.update','bills.manage.update'],[cid]),('challan-only',['challans.manage.update'],[cid]),('bill-only',['bills.manage.update'],[cid]),('unassigned',['challans.manage.update','bills.manage.update'],[])]:
  name='delivery_'+label.replace('-','_')+'_'+str(time.time_ns());user=call('POST','/api/users',{'username':name,'fullName':'Local delivery tester','password':'LocalTest123!','role':'User'});users.append(user['id'])
  role=call('POST','/api/roles',{'name':name,'permissionKeys':keys,'tenantAdminUserId':user['id']});roles.append(role['id']);call('PUT',f"/api/users/{user['id']}/roles",{'roleIds':[role['id']]});call('PUT',f"/api/usercompanies/user/{user['id']}",{'companyIds':assigned});auth=call('POST','/api/auth/login',{'username':name,'password':'LocalTest123!'})['token']
  s=snapshot();body=payload(s)
  if label=='allowed':
   call('GET',path,auth=auth);call('PUT',path,body,auth=auth);check('assigned user with both permissions can read and write',True)
   call('GET',other_path,expected=(403,),auth=auth);call('PUT',other_path,payload(other_snapshot),expected=(403,),auth=auth)
   check('assigned user cannot read or write another company delivery',call('GET',other_path)['billVersion']==other_snapshot['billVersion'])

   call('PUT',f"/api/usercompanies/user/{user['id']}",{'companyIds':[]});call('GET',path,expected=(403,),auth=auth);call('PUT',path,body,expected=(403,),auth=auth);check('revoked company access immediately blocks both endpoints',True)
  else:
   call('GET',path,expected=(403,),auth=auth);call('PUT',path,body,expected=(403,),auth=auth);check(label+' refused on both endpoints',True)
 # Editing one delivery on a combined bill must leave the others alone.
 left,right=challan('Combined left'),challan('Combined right')
 combined=call('POST','/api/invoices',{'companyId':cid,'clientId':client['id'],'date':now,'gstRate':18,'challanIds':[left['id'],right['id']],'items':[{'deliveryItemId':i['id'],'unitPrice':100} for c in [left,right] for i in c['items']]})
 combined_path=f"/api/deliverychallans/{left['id']}/bill-edit";snap=call('GET',combined_path);body=payload(snap);body['items'][0]['quantity']=5;body['items'].pop();body['items'].append({'id':0,'description':'Combined added','quantity':1,'unit':'Pcs','billUnitPrice':50})
 untouched=[i for i in combined['items'] if i['deliveryItemId'] in [x['id'] for x in right['items']]]
 call('PUT',combined_path,body);after=call('GET',f"/api/invoices/{combined['id']}")
 check('combined bill totals include the unchanged other delivery',after['subtotal']==1050 and after['grandTotal']==1239)
 check('other challan bill rows and rates remain unchanged',all(next(i for i in after['items'] if i['id']==old['id'])==old for old in untouched))
 # Costs book supplier purchases; a concurrent delivery edit and cost save
 # serialize on the challan lines and the purchase ends up matching both.
 def booked(challan_id):
  page=call('GET',f"/api/purchasebills/company/{cid}/paged?pageSize=100")
  return [call('GET',f"/api/purchasebills/{p['id']}") for p in page['items'] if p.get('sourceDeliveryChallanId')==challan_id and p.get('source')=='auto-cost']
 race=challan('Concurrent delivery',[{'description':'Concurrent goods','quantity':2,'unit':'Pcs','supplierId':supplier['id'],'actualUnitCost':10}]);race_bill=bill(race);race_path=f"/api/deliverychallans/{race['id']}/bill-edit"
 check('a costed billed challan books its purchase',[(i['quantity'],i['unitPrice']) for p in booked(race['id']) for i in p['items']]==[(2,10)])
 race_context=call('GET',race_path);race_body=payload(race_context);race_body['items'][0]['quantity']=3
 race_costs=call('GET',f"/api/commercial-costs/challan/{race['id']}")
 cost_body={'version':race_costs['version'],'items':[{'id':i['id'],'supplierId':supplier['id'],'actualUnitCost':11} for i in race_costs['items']]}
 from concurrent.futures import ThreadPoolExecutor
 from threading import Barrier
 barrier=Barrier(2)
 def compete(which):
  barrier.wait()
  return flows.http('PUT' if which==0 else 'PATCH',race_path if which==0 else f"/api/commercial-costs/challan/{race['id']}",a.base,token=token,body=race_body if which==0 else cost_body)
 with ThreadPoolExecutor(max_workers=2) as pool:outcomes=list(pool.map(compete,[0,1]))
 check('concurrent delivery edit and cost save each succeed or are told to reload',all(status in (200,201,400) for status,_ in outcomes) and any(status in (200,201) for status,_ in outcomes))
 final=call('GET',f"/api/deliverychallans/{race['id']}");final_bill=call('GET',f"/api/invoices/{race_bill['id']}")
 check('concurrent outcome leaves delivery and bill quantities consistent',final['items'][0]['quantity']==final_bill['items'][0]['quantity'])
 check('the purchase matches the surviving delivery quantity and cost',[(i['quantity'],i['unitPrice']) for p in booked(race['id']) for i in p['items']]==[(final['items'][0]['quantity'],final['items'][0]['actualUnitCost'])])
 # Purchases no longer freeze a billed delivery: an unpaid one follows the edit.
 source=call('GET',f"/api/deliverychallans/{dc['id']}")
 call('PATCH',f"/api/deliverychallans/{dc['id']}/private-costs",{'version':source['version'],'items':[{'id':i['id'],'supplierId':supplier['id'],'actualUnitCost':10} for i in source['items']]})
 s=snapshot();body=payload(s);body['items'][0]['quantity']+=1;call('PUT',path,body)
 dc_now=call('GET',f"/api/deliverychallans/{dc['id']}")
 check('a billed delivery with an unpaid purchase stays editable and the purchase follows',
  sorted((i['quantity'],i['unitPrice']) for p in booked(dc['id']) for i in p['items'])==sorted((x['quantity'],10) for x in dc_now['items']))
 print('all checks passed ('+str(checks)+' billed delivery checks)',flush=True)
finally:
 db.execute('UPDATE Invoices SET FbrStatus=NULL,FbrIRN=NULL,FbrSubmittedAt=NULL WHERE Id=? AND CompanyId=?',iid,cid)
 for uid in users:flows.http('DELETE',f'/api/users/{uid}',a.base,token=token)
 for rid in roles:flows.http('DELETE',f'/api/roles/{rid}',a.base,token=token)
 if other_company:flows.teardown(a.base,token,other_company,False)
 flows.teardown(a.base,token,company,False)
 db.close()
