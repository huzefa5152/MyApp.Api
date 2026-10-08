"""Trader sales-order/challan/bill workflow regression on loopback fixtures only."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
import pyodbc
import test_basic_flows as f

def main():
 p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:5152');p.add_argument('--local-db',default='MyApp_Trader_Local');args=p.parse_args()
 assert urlparse(args.base).hostname in ('127.0.0.1','localhost') and args.local_db.endswith('_Local') and all(c.isalnum() or c=='_' for c in args.local_db)
 token,company,client=f.setup(args.base,'admin','admin123');cid=company['id']
 db=pyodbc.connect(f'DRIVER={{ODBC Driver 18 for SQL Server}};SERVER=.\\MSSQLSERVER02;DATABASE={args.local_db};Trusted_Connection=yes;TrustServerCertificate=yes',autocommit=True)
 assert db.execute('SELECT Name FROM Companies WHERE Id=?',cid).fetchval()==company['name']
 count=0
 def call(m,path,body=None):return f.http(m,path,args.base,token=token,body=body)
 def ok(name,condition,value=None):
  nonlocal count
  assert condition,(name,value);count+=1;print('[PASS]',name,flush=True)
 def get(path):
  st,r=call('GET',path);assert st==200,(st,r);return r
 def order():return get(f'/api/salesorders/{oid}')
 def bill():return get(f'/api/invoices/{iid}')
 def source(label,qty):
  st,r=call('POST',f'/api/deliverychallans/company/{cid}',{'companyId':cid,'clientId':client['id'],'poNumber':label,'deliveryDate':'2026-10-08','items':[{'description':'Workflow hardware','quantity':qty,'unit':'Pcs'}]});assert st==201,r;return r
 def make_bill(sources):
  st,r=call('POST','/api/invoices',{'companyId':cid,'clientId':client['id'],'date':'2026-10-08','gstRate':18,'challanIds':[c['id'] for c in sources],'items':[{'deliveryItemId':i['id'],'unitPrice':100} for c in sources for i in c['items']]});assert st==201,r;return r
 def edit_bill(body):return call('PUT',f'/api/invoices/{iid}',{'gstRate':18,'items':[{'id':i['id'],'description':i['description'],'quantity':i['quantity'],'unitPrice':i['unitPrice'],'uom':i['uom']} for i in body['items']]})
 try:
  st,o=call('POST',f'/api/salesorders/company/{cid}',{'clientId':client['id'],'orderDate':'2026-10-08','customerPoNumber':'WORKFLOW','items':[{'description':'Workflow hardware','quantity':10,'unit':'Pcs','unitPrice':100}]})
  ok('order created',st==201,o);oid=o['id'];line=o['items'][0]['id']
  sources=[]
  for qty in [6,4]:
   st,c=call('POST',f'/api/salesorders/{oid}/create-challan',{'deliveryDate':'2026-10-08','lines':[{'salesOrderItemId':line,'quantity':qty}]});assert st==200,c;sources.append(c)
  a,b=sources
  o=order();ok('fully delivered remains open until billed',o['fulfillmentStatus']=='Fully Delivered' and o['status']=='Open',o)
  invoice=make_bill(sources);iid=invoice['id'];o=order();ok('fully delivered and billed auto closes',o['status']=='Closed' and o['invoiceStatus']=='Invoiced',o)
  o['items'][0]['unitPrice']=120;o['applyRatesToBills']=True
  st,r=call('PUT',f'/api/salesorders/{oid}',o);ok('billed order editable before FBR',st==200,r);ok('confirmed order rate updates bill',bill()['subtotal']==1200,bill())
  o=order();o['items'][0]['quantity']=12
  st,r=call('PUT',f'/api/salesorders/{oid}',o);ok('ordered quantity changes commitment only',st==200 and r['items'][0]['deliveredQuantity']==10 and r['items'][0]['remainingQuantity']==2 and r['status']=='Open',r)
  old=order();fresh=bill();fresh['items'][0]['quantity']=5
  st,r=edit_bill(fresh);ok('bill edit updates actual order deliveries',st==200 and order()['items'][0]['deliveredQuantity']==9,r)
  c=get(f"/api/deliverychallans/{a['id']}");c['items'][0]['quantity']=4
  st,r=call('PUT',f"/api/deliverychallans/{a['id']}",c);ok('challan edit updates bill and order',st==200 and bill()['subtotal']==960 and order()['items'][0]['deliveredQuantity']==8,r)
  ok('challan edit mandates consultant review',bill()['fbrReviewRequired'] and not bill()['fbrReady'])
  c['clientId']=client['id']+999999;st,r=call('PUT',f"/api/deliverychallans/{a['id']}",c);ok('linked challan cannot switch buyer',st==400,r)
  c['clientId']=client['id']
  for state in ['Submitting','Uncertain','Submitted']:
   db.execute('UPDATE Invoices SET FbrStatus=? WHERE Id=? AND CompanyId=?',state,iid,cid)
   for method,path,body in [('PUT',f"/api/deliverychallans/{a['id']}",c),('PUT',f"/api/deliverychallans/{a['id']}/cancel",None),('DELETE',f"/api/deliverychallans/{a['id']}",None)]:
    st,r=call(method,path,body);ok(state+' locks linked challan '+method+path.rsplit('/',1)[-1],st==400,r)
   o=order();o['items'][0]['unitPrice']=130;o['applyRatesToBills']=True
   st,r=call('PUT',f'/api/salesorders/{oid}',o);ok(state+' refuses rate propagation atomically',st==400 and order()['items'][0]['unitPrice']==120,r)
  db.execute('UPDATE Invoices SET FbrStatus=NULL WHERE Id=? AND CompanyId=?',iid,cid)
  st,r=call('PUT',f"/api/deliverychallans/{a['id']}/cancel");ok('billed challan cancellation updates bill',st==200 and bill()['subtotal']==480 and len(bill()['items'])==1,r)
  ok('cancelled delivery removed from order totals',order()['items'][0]['deliveredQuantity']==4)
  st,r=call('DELETE',f"/api/deliverychallans/{b['id']}");ok('final billed challan deletion refuses empty bill',st==400 and bill()['subtotal']==480,r)
  st,r=call('PUT',f'/api/salesorders/{oid}/status',{'status':'Closed'});ok('manual closure explicit',st==200 and order()['manuallyClosed'] and order()['needsAttention'],r)
  # A filed historical bill records order linkage without changing the filed invoice.
  x,y=source('HISTORY-X',2),source('HISTORY-Y',3);historical=make_bill([x,y]);hid=historical['id']
  db.execute("UPDATE Invoices SET FbrStatus='Submitted',FbrIRN='LOCAL-WORKFLOW-IRN',FbrSubmittedAt='2026-10-08' WHERE Id=? AND CompanyId=?",hid,cid)
  before=tuple(db.execute('SELECT * FROM Invoices WHERE Id=?',hid).fetchone());movement_count=db.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=?',cid).fetchval()
  with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:call('POST',f'/api/salesorders/from-bill/{hid}'),range(2)))
  ok('concurrent retrospective creation happens once',sorted(st for st,r in results)==[200,400],results)
  recorded=next(r for st,r in results if st==200)
  ok('historical order fully delivered billed closed',recorded['fulfillmentStatus']=='Fully Delivered' and recorded['invoiceStatus']=='Invoiced' and recorded['status']=='Closed',recorded)
  ok('all historical challans attached',len(get(f"/api/salesorders/{recorded['id']}/challans"))==2)
  ok('filed bill scalar fields preserved',before==tuple(db.execute('SELECT * FROM Invoices WHERE Id=?',hid).fetchone()))
  ok('retrospective order creates no stock movement',movement_count==db.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=?',cid).fetchval())
  st,r=call('POST','/api/invoices/standalone',{'companyId':cid,'clientId':client['id'],'date':'2026-10-08','gstRate':18,'items':[{'description':'Standalone service','quantity':1,'unitPrice':100,'uom':'Pcs'}]});assert st==201,r
  ok('standalone has no create-order action',not r['canCreateSalesOrder'])
  st,r=call('POST',f"/api/salesorders/from-bill/{r['id']}");ok('standalone conversion rejected on server',st==400,r)
  st,r=call('PUT',f'/api/salesorders/{oid}',old);ok('stale order edit rejected',st==400,r)
  # Explicit bill-side attachment updates delivery totals; mismatched PO rolls back.
  added=source('WORKFLOW',2)
  options=get(f'/api/invoices/{iid}/challans')
  def selection(opts,c,attach=True):
   available=next(x for x in opts['available'] if x['id']==c['id'])
   return {'version':opts['version'],'challanIds':[x['id'] for x in opts['linked']]+[c['id']],
     'addedChallanVersions':{str(c['id']):available['version']},'unitPrices':{str(x['id']):100 for x in c['items']},'attachAddedChallansToOrder':attach}
  st,r=call('PUT',f'/api/invoices/{iid}/challans',selection(options,added))
  ok('bill-side attach links matching delivery to order',st==200 and get(f"/api/deliverychallans/{added['id']}")['salesOrderId']==oid and order()['items'][0]['deliveredQuantity']==6,r)
  bad=source('DIFFERENT-PO',1);options=get(f'/api/invoices/{iid}/challans')
  st,r=call('PUT',f'/api/invoices/{iid}/challans',selection(options,bad))
  ok('different PO attachment refused atomically',st==400 and get(f"/api/deliverychallans/{bad['id']}")['invoiceId'] is None,r)
  st,r=call('PUT',f'/api/invoices/{iid}/challans',selection(options,bad,False))
  ok('explicit independent challan preserves order totals',st==200 and order()['items'][0]['deliveredQuantity']==6,r)
  st,r=call('DELETE',f"/api/deliverychallans/{bad['id']}")
  ok('latest billed challan can be deleted and bill reconciles',st==204 and len(bill()['items'])==2,r)
  c=get(f"/api/deliverychallans/{added['id']}");c['items'][0]['description']='Updated actual delivery'
  st,r=call('PUT',f"/api/deliverychallans/{added['id']}",c)
  ok('source description updates linked bill',st==200 and any(x['description']=='Updated actual delivery' for x in bill()['items']),r)
  st,r=call('PUT',f"/api/deliverychallans/{added['id']}",c)
  ok('stale source edit refused',st==400,r)
  print(f'{count}/{count} workflow checks passed',flush=True)
 finally:
  db.execute('UPDATE Invoices SET FbrStatus=NULL,FbrIRN=NULL,FbrSubmittedAt=NULL WHERE CompanyId=?',cid);db.close();f.teardown(args.base,token,company,False)
if __name__=='__main__':main()
