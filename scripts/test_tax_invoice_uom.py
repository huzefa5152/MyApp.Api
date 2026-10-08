"""Local-only tax grouping regression: commercial printing stays independent."""
import pyodbc
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
  sources=[call('POST',f'/api/deliverychallans/company/{cid}',{'clientId':client['id'],'poNumber':'GROUP-UOM','site':{'Nos':' Main Warehouse ','Ft':'main warehouse','Pcs':'Sample Branch'}[u],'deliveryDate':'2026-10-08','items':[{'description':'Sample line '+u,'quantity':2,'unit':u,'itemTypeId':kind['id']}]}) for u in ['Nos','Ft','Pcs']]
  bill=call('POST','/api/invoices',{'companyId':cid,'clientId':client['id'],'date':'2026-10-08','gstRate':18,'challanIds':[c['id'] for c in sources],'items':[{'deliveryItemId':c['items'][0]['id'],'unitPrice':100,'uom':c['items'][0]['unit']} for c in sources]});iid=bill['id']
  path=f'/api/invoices/{iid}'
  check('bill retains all commercial units',[i['uom'] for i in bill['items']]==['Nos','Ft','Pcs'])
  db.execute('UPDATE Invoices SET GroupTaxInvoiceByItemType=1 WHERE Id=? AND CompanyId=?',iid,cid)
  tax=call('GET',path+'/print/tax-invoice')
  check('tax print aggregates distinct challan sites',tax['site']=='Main Warehouse, Sample Branch')
  check('bill print exposes the same sites',call('GET',path+'/print/bill')['site']==tax['site'])
  check('legacy bill department field remains available','concernDepartment' in call('GET',path+'/print/bill'))
  check('grouped tax print has one item type row',len(tax['items'])==1)
  check('grouped tax print uses catalog Pcs',tax['items'][0]['uom']=='Pcs')
  check('grouped print preserves commercial value',tax['items'][0]['valueExclTax']==600)
  db.execute('UPDATE Invoices SET GroupTaxInvoiceByItemType=0 WHERE Id=? AND CompanyId=?',iid,cid)
  # Same-type consultant adjustment must not leak onto an individual commercial print.
  line=bill['items'][0]
  db.execute("INSERT INTO InvoiceItemAdjustments (InvoiceId,InvoiceItemId,AdjustedQuantity,AdjustedUnitPrice,AdjustedLineTotal,AdjustedUOM,Reason,CreatedAt) VALUES (?,?,4,50,200,'Pcs','local-test',GETUTCDATE())",iid,line['id'])
  individual=call('GET',path+'/print/tax-invoice')['items']
  check('individual print retains three commercial lines',len(individual)==3)
  check('individual print retains commercial units',[i['uom'] for i in individual]==['Nos','Ft','Pcs'])
  check('individual print retains commercial quantities',[i['quantity'] for i in individual]==[2,2,2])
  check('individual print retains commercial prices',[i['unitPrice'] for i in individual]==[100,100,100])
  commercial=call('GET',path+'/print/bill')['items']
  check('bill print unchanged by consultant overlay',[i['uom'] for i in commercial]==['Nos','Ft','Pcs'])
  db.execute('UPDATE Invoices SET GroupTaxInvoiceByItemType=1 WHERE Id=? AND CompanyId=?',iid,cid)
  grouped=call('GET',path+'/print/tax-invoice')['items']
  check('grouped tax print uses adjusted quantity',len(grouped)==1 and grouped[0]['quantity']==8)
  check('grouped tax print still uses Pcs',grouped[0]['uom']=='Pcs')
  check('grouped tax print keeps total value',grouped[0]['valueExclTax']==600)
  print(f'{count}/{count} tax invoice UOM checks passed',flush=True)
 finally:
  db.close();f.teardown(BASE,token,company,False)
if __name__=='__main__':main()
