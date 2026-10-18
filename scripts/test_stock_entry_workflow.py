"""Local-only stock purchase, direct purchase and valued stock-entry regression."""
import argparse, copy, json, time, uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
import pyodbc
from test_basic_flows import http
p=argparse.ArgumentParser();p.add_argument('--base',required=True);p.add_argument('--database',required=True);a=p.parse_args()
assert urlparse(a.base).hostname in ('localhost','127.0.0.1') and a.database.endswith('_Test')
db=pyodbc.connect('DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost\\MSSQLSERVER02;DATABASE='+a.database+';Trusted_Connection=yes;TrustServerCertificate=yes',autocommit=True)
s,r=http('POST','/api/auth/login',a.base,body={'username':'admin','password':'admin123'});assert s==200;token=r['token'];checks=0

def call(method,path,body=None,expected=(200,201,204),auth=None):
 s,r=http(method,path,a.base,token=auth or token,body=body);assert s in expected,(path,s,r);return r

def check(name,ok):
 global checks
 assert ok,name
 checks+=1;print('PASS '+name,flush=True)

stamp=str(time.time_ns());today=time.strftime('%Y-%m-%d')
c=call('POST','/api/companies',{'name':'[TEMP] Stock entry '+stamp,'startingInvoiceNumber':1});cid=c['id']
db.execute('UPDATE Companies SET InventoryTrackingEnabled=1,GlPostingEnabled=1 WHERE Id=?',cid)
call('POST',f'/api/accounts/company/{cid}/seed-wholesale')
sup=call('POST','/api/suppliers',{'companyId':cid,'name':'Sample stock supplier'})
def item(name):
 return call('POST',f'/api/itemtypes?companyId={cid}',{'companyId':cid,'name':name+stamp,'hsCode':'8412.9020','uom':'Pcs','fbrUOMId':1,'saleType':'Goods at Standard Rate (default)'})
it=item('Entry item ');pit=item('Purchase item ')
def stock(i):
 return db.execute('SELECT COALESCE(SUM(CASE WHEN Direction=1 THEN Quantity ELSE -Quantity END),0) FROM StockMovements WHERE CompanyId=? AND ItemTypeId=?',cid,i).fetchone()[0]
def balances():
 return {r[0]:r[1] for r in db.execute('SELECT a.ControlType,SUM(l.Debit-l.Credit) FROM JournalLines l JOIN JournalEntries e ON e.Id=l.JournalEntryId JOIN Accounts a ON a.Id=l.AccountId WHERE e.CompanyId=? GROUP BY a.ControlType',cid)}
def due():
 return sum(r['netBalance'] for r in call('GET',f'/api/commercial-costs/suppliers/{cid}'))
def create_entry(kind='Opening',delta=10,cost=50,**extras):
 return {'companyId':cid,'itemTypeId':it['id'],'requestId':str(uuid.uuid4()),'kind':kind,'date':today,'quantityDelta':delta,'unitCost':cost,'reason':'Sample stock verification',**extras}
body=create_entry();opening=call('POST','/api/stockentries',body)
check('opening adds ten units',stock(it['id'])==10)
check('opening has zero supplier outstanding',due()==0)
b=balances();check('opening debits inventory 500 without AP or input tax',b.get(3)==500 and b.get(2,0)==0 and b.get(8,0)==0)
check('opening journal balances',db.execute('SELECT COALESCE(SUM(l.Debit-l.Credit),0) FROM JournalLines l JOIN JournalEntries e ON e.Id=l.JournalEntryId WHERE e.CompanyId=?',cid).fetchone()[0]==0)
with ThreadPoolExecutor(max_workers=4) as pool:
 retry=list(pool.map(lambda _:call('POST','/api/stockentries',body),range(4)))
check('repeated concurrent request returns same entry',all(r['id']==opening['id'] for r in retry))
check('retry creates one stock movement and one journal',db.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=? AND SourceType=6 AND SourceId=?',cid,opening['id']).fetchone()[0]==1 and db.execute('SELECT COUNT(*) FROM JournalEntries WHERE CompanyId=? AND SourceDocType=7 AND SourceDocId=?',cid,opening['id']).fetchone()[0]==1)
call('POST','/api/stockentries',{**body,'quantityDelta':11},expected=(400,));check('request key cannot be reused for different quantities',stock(it['id'])==10)
call('POST','/api/stockentries',create_entry(),expected=(400,));check('second opening rejected',stock(it['id'])==10)
add=call('POST','/api/stockentries',create_entry('Adjustment',2))
remove=call('POST','/api/stockentries',create_entry('Adjustment',-3,0))
check('add and reduce leave nine units',stock(it['id'])==9)
check('reduction uses existing unit cost',remove['unitCost']==50)
check('adjusted inventory value is 450 with no supplier debt',balances().get(3)==450 and due()==0)
call('POST','/api/stockentries',create_entry('Adjustment',-20,0),expected=(400,));check('negative stock refused',stock(it['id'])==9)
call('POST',f"/api/stockentries/{opening['id']}/cancel",expected=(400,));check('used opening cannot be reversed',stock(it['id'])==9)
# Both genuine purchase flows retain their previous financial behavior.
line={'itemTypeId':pit['id'],'description':'Sample purchased goods','quantity':2,'unitPrice':100,'uom':'Pcs'}
purchase=call('POST','/api/purchasebills',{'companyId':cid,'supplierId':sup['id'],'date':today,'gstRate':18,'purchaseCategory':'Inventory','items':[line]})
local=call('POST','/api/purchasebills',{'companyId':cid,'supplierId':sup['id'],'date':today,'gstRate':0,'purchaseCategory':'LocalDirect','items':[{'description':'Sample direct cost','quantity':1,'unitPrice':60,'uom':'Pcs'}]})
check('stock purchase adds stock and owes supplier',stock(pit['id'])==2 and purchase['balanceDue']==236)
check('direct purchase owes supplier and moves no stock',local['balanceDue']==60 and db.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=? AND SourceType=1 AND SourceId=?',cid,local['id']).fetchone()[0]==0)
check('supplier report counts purchases only',due()==296)
check('purchase input tax remains 36',balances().get(8)==36)
db.execute("UPDATE PurchaseBills SET Source='fbr-import' WHERE Id=?",purchase['id'])
legacy=call('GET',f"/api/purchasebills/{purchase['id']}")
call('POST',f'/api/accounting/gl/company/{cid}/rebuild')
check('rebuild keeps all stock-entry value and purchase value',balances().get(3)==650 and due()==296)
check('FBR imported purchase remains unchanged',call('GET',f"/api/purchasebills/{purchase['id']}")==legacy)
for entry in [remove,add,opening]:
 call('POST',f"/api/stockentries/{entry['id']}/cancel")
check('reversals remove only new stock entries',stock(it['id'])==0 and stock(pit['id'])==2)
check('reversals preserve purchase accounting',balances().get(3)==200 and due()==296 and balances().get(8)==36)
count=db.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=?',cid).fetchone()[0]
call('POST',f"/api/stockentries/{opening['id']}/cancel")
check('repeat reversal adds no movements',db.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=?',cid).fetchone()[0]==count)
# Authorization checks use a real non-seed account and current company assignments.
foreign=call('POST','/api/companies',{'name':'[TEMP] Entry other '+stamp})
u=call('POST','/api/users',{'username':'entry_'+stamp,'password':'SampleStockEntry2026!','fullName':'Sample entry tester','role':'Administrator'})
role=next(r['id'] for r in call('GET','/api/roles') if r['name']=='Administrator')
call('PUT',f"/api/users/{u['id']}/roles",{'roleIds':[role]});call('PUT',f"/api/usercompanies/user/{u['id']}",{'companyIds':[cid]})
limited=call('POST','/api/auth/login',{'username':'entry_'+stamp,'password':'SampleStockEntry2026!'})['token']
call('GET',f'/api/stockentries/company/{cid}',auth=limited)
check('assigned company stock entries visible',True)
for path in [f"/api/stockentries/company/{foreign['id']}",f"/api/stockentries/company/{foreign['id']}/items"]:
 call('GET',path,expected=(403,),auth=limited)
call('POST','/api/stockentries',create_entry('Adjustment',1,companyId=foreign['id']),expected=(403,),auth=limited)
check('unassigned company read and create denied',True)
call('POST','/api/stockentries',create_entry('Adjustment',1,itemTypeId=9999999),expected=(400,))
other_item=call('POST',f"/api/itemtypes?companyId={foreign['id']}",{'companyId':foreign['id'],'name':'Other stock '+stamp,'hsCode':'8412.9020','uom':'Pcs','fbrUOMId':1,'saleType':'Goods at Standard Rate (default)'})
call('POST','/api/stockentries',create_entry('Adjustment',1,itemTypeId=other_item['id']),expected=(400,))
check('invalid or foreign catalog item refused',True)
call('PUT',f"/api/usercompanies/user/{u['id']}",{'companyIds':[foreign['id']]})
call('POST',f"/api/stockentries/{opening['id']}/cancel",expected=(403,),auth=limited)
call('GET',f'/api/stockentries/company/{cid}/items',expected=(403,),auth=limited)
check('revocation blocks record cancellation and picker immediately',True)
call('PUT',f"/api/users/{u['id']}/roles",{'roleIds':[]})
call('GET',f"/api/stockentries/company/{foreign['id']}",expected=(403,),auth=limited)
check('stock permission required even for assigned company',True)

# A sale of stock introduced without a purchase still relieves inventory at cost.
valued=call('POST','/api/stockentries',create_entry(delta=100,cost=10))
client=call('POST','/api/clients',{'companyId':cid,'name':'Sample stock buyer','registrationType':'Registered','ntn':'1234567','strn':'1234567890123','fbrProvinceCode':8})
sale=call('POST','/api/invoices/standalone',{'companyId':cid,'clientId':client['id'],'date':today,'gstRate':18,'items':[{'itemTypeId':it['id'],'description':'Sample stock sale','quantity':2,'unitPrice':20,'uom':'Pcs'}]})
check('sale relieves stock-entry value at cost',stock(it['id'])==98 and balances().get(3)==1180)
cogs=db.execute("SELECT COALESCE(SUM(l.Debit-l.Credit),0) FROM JournalLines l JOIN JournalEntries e ON e.Id=l.JournalEntryId JOIN Accounts a ON a.Id=l.AccountId WHERE e.CompanyId=? AND a.ExternalRef='seed:cogs'",cid).fetchone()[0]
check('stock-entry sale records correct cost of goods sold',cogs==80)
call('DELETE',f"/api/invoices/{sale['id']}")
check('sale reversal restores stock and valuation',stock(it['id'])==100 and balances().get(3)==1200)
call('POST',f"/api/stockentries/{valued['id']}/cancel")
check('supplier outstanding stays unchanged throughout stock-only sales',due()==296)


opening_role=call('POST','/api/roles',{'name':'Entry opening '+stamp,'tenantAdminUserId':u['id'],'permissionKeys':['stock.opening.manage']})
call('PUT',f"/api/users/{u['id']}/roles",{'roleIds':[opening_role['id']]})
call('PUT',f"/api/usercompanies/user/{u['id']}",{'companyIds':[cid]})
call('POST','/api/stockentries',create_entry('Adjustment',1),expected=(403,),auth=limited)
call('POST',f"/api/stockentries/{add['id']}/cancel",expected=(403,),auth=limited)
visible=call('GET',f'/api/stockentries/company/{cid}',auth=limited)
check('opening-only permission cannot write reverse or read adjustments',all(r['kind']=='Opening' for r in visible))

db.execute('UPDATE Companies SET GlLockDate=? WHERE Id=?',today,cid)
call('POST','/api/stockentries',create_entry('Adjustment',1),expected=(400,))
check('closed period refuses stock and accounting write',stock(it['id'])==0)
print(f'{checks} stock-entry workflow checks passed')
