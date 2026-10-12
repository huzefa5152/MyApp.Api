"""Local Trader purchase inventory preview and HS-code stock regression."""
import argparse
import copy
import time
from urllib.parse import urlparse
import pyodbc
from test_basic_flows import http

p = argparse.ArgumentParser()
p.add_argument('--base', required=True)
p.add_argument('--database', required=True)
a = p.parse_args()
assert urlparse(a.base).hostname in ('localhost', '127.0.0.1')
assert a.database.endswith('_ChallanPurchase_Test')
sql = pyodbc.connect('DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost\\MSSQLSERVER02;DATABASE=' + a.database + ';Trusted_Connection=yes;TrustServerCertificate=yes;', autocommit=True)
s, login = http('POST', '/api/auth/login', a.base, body={'username':'admin','password':'admin123'})
assert s == 200
token = login['token']
checks = 0

def call(method, path, body=None, expected=(200,201), auth=None):
    s, data = http(method, path, a.base, token=auth or token, body=body)
    assert s in expected, (path,s,data)
    return data

def check(label, value):
    global checks
    assert value, label
    checks += 1
    print('PASS ' + label, flush=True)

stamp = str(time.time_ns())
c = call('POST','/api/companies',{'name':'[TEMP] Purchase inventory '+stamp,'startingPurchaseBillNumber':1})
cid = c['id']
sql.execute('UPDATE Companies SET InventoryTrackingEnabled=1 WHERE Id=?',cid)
supplier = call('POST','/api/suppliers',{'name':'Sample supplier','companyId':cid})
def item(name,hs=None,company=cid):
    return call('POST',f'/api/itemtypes?companyId={company}',{'companyId':company,'name':name+' '+stamp,'hsCode':hs,'uom':'Pcs','fbrUOMId':1,'saleType':'Goods at Standard Rate (default)'})
classified = item('Stock sample','8412.9020')
plain = item('Non-stock sample')
blank = item('Whitespace sample')
sql.execute('UPDATE ItemTypes SET HSCode=? WHERE Id=?','   ',blank['id'])
lines = [{'itemTypeId':it['id'],'description':'Sample '+str(i),'quantity':q,'unitPrice':10,'uom':'Pcs'} for i,(it,q) in enumerate([(classified,4),(classified,3),(plain,5),(blank,2)])]

def preview(lines,bill=None,company=cid,auth=None,expected=(200,)):
    return call('POST','/api/purchasebills/stock-preview',{'companyId':company,'billId':bill,'items':lines},expected,auth)
def net(bill):
    return dict(sql.execute('SELECT ItemTypeId,SUM(CASE WHEN Direction=1 THEN Quantity ELSE -Quantity END) FROM StockMovements WHERE CompanyId=? AND SourceType=1 AND SourceId=? GROUP BY ItemTypeId',cid,bill).fetchall())

before = sql.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=?',cid).fetchone()[0]
view = preview(lines)
byid = {r['itemTypeId']:r for r in view['items']}
check('preview groups repeated classified rows',byid[classified['id']]['changeQuantity']==7)
check('classified preview shows current zero and after seven',byid[classified['id']]['currentQuantity']==0 and byid[classified['id']]['afterQuantity']==7)
check('no-HS preview has no stock change',not byid[plain['id']]['tracksStock'] and byid[plain['id']]['changeQuantity']==0)
check('whitespace-only HS has no stock change',not byid[blank['id']]['tracksStock'] and byid[blank['id']]['changeQuantity']==0)
check('preview writes no stock',sql.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=?',cid).fetchone()[0]==before)
bill = call('POST','/api/purchasebills',{'companyId':cid,'supplierId':supplier['id'],'date':'2026-10-13','gstRate':0,'items':lines})
bid = bill['id']
check('saved mixed bill moves classified stock only',net(bid)=={classified['id']:7})
edit = {'supplierId':supplier['id'],'gstRate':0,'items':bill['items']}
unchanged = preview(edit['items'],bid)
check('unchanged edit preview adds nothing',all(r['changeQuantity']==0 for r in unchanged['items']))
count = sql.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=? AND SourceType=1 AND SourceId=?',cid,bid).fetchone()[0]
call('PUT',f'/api/purchasebills/{bid}',edit)
check('unchanged save adds no movements',sql.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=? AND SourceType=1 AND SourceId=?',cid,bid).fetchone()[0]==count)
edit['items'][0]['quantity']=2
changed = preview(edit['items'],bid)
row=next(r for r in changed['items'] if r['itemTypeId']==classified['id'])
check('edit preview subtracts only quantity difference',row['currentQuantity']==7 and row['changeQuantity']==-2 and row['afterQuantity']==5)
call('PUT',f'/api/purchasebills/{bid}',edit)
check('saved edit matches projected inventory',net(bid)=={classified['id']:5})
for row in edit['items']:
    row['itemTypeId']=plain['id']; row['hsCode']=None
remove = preview(edit['items'],bid)
check('classified-to-nonstock preview reverses old classified balance',next(r for r in remove['items'] if r['itemTypeId']==classified['id'])['changeQuantity']==-5)
call('PUT',f'/api/purchasebills/{bid}',edit)
check('classified-to-nonstock save clears stock without posting draft movement',net(bid)=={classified['id']:0})
count=sql.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=? AND SourceType=1 AND SourceId=?',cid,bid).fetchone()[0]
call('PUT',f'/api/purchasebills/{bid}',edit)
check('subsequent non-stock edit creates no movement',sql.execute('SELECT COUNT(*) FROM StockMovements WHERE CompanyId=? AND SourceType=1 AND SourceId=?',cid,bid).fetchone()[0]==count)
spoof=[{'itemTypeId':plain['id'],'description':'Spoof sample','quantity':2,'unitPrice':10,'hsCode':'8412.9020'}]
check('forged line HS does not classify the catalog',preview(spoof)['items'][0]['changeQuantity']==0)
sp=call('POST','/api/purchasebills',{'companyId':cid,'supplierId':supplier['id'],'date':'2026-10-13','gstRate':0,'items':spoof})
check('forged HS on unclassified item posts no stock',net(sp['id'])=={})
check('unclassified catalog does not retain a forged HS code',sp['items'][0]['hsCode'] is None)
foreign = call('POST','/api/companies',{'name':'[TEMP] Other purchase inventory '+stamp})
foreignitem=item('Other company stock','8412.9020',foreign['id'])
preview([dict(lines[0],itemTypeId=foreignitem['id'])],expected=(400,))
check('foreign-company catalog rejected',True)
preview(lines,bid,foreign['id'],expected=(400,))
check('stored bill cannot be previewed under another company',True)
preview([None],expected=(400,))
check('null preview line rejected without server error',True)
sql.execute('UPDATE Companies SET InventoryTrackingEnabled=0 WHERE Id=?',cid)
check('tracking-off preview shows zero effect',all(r['changeQuantity']==0 for r in preview(lines)['items']))
user=call('POST','/api/users',{'username':'stock_preview_'+stamp,'password':'SampleTestPass2026!','fullName':'Sample preview user','role':'Administrator'})
roles=call('GET','/api/roles'); role=next(r['id'] for r in roles if r['name']=='Administrator')
call('PUT',f"/api/users/{user['id']}/roles",{'roleIds':[role]})
call('PUT',f"/api/usercompanies/user/{user['id']}",{'companyIds':[cid]})
limited=call('POST','/api/auth/login',{'username':'stock_preview_'+stamp,'password':'SampleTestPass2026!'})['token']
preview(lines,auth=limited)
check('assigned-company preview allowed',True)
preview([],company=foreign['id'],auth=limited,expected=(403,))
check('unassigned-company preview denied',True)
preview([],bill=bid,company=foreign['id'],auth=limited,expected=(403,))
check('forged company with stored bill denied',True)
call('PUT',f"/api/users/{user['id']}/roles",{'roleIds':[]})
preview(lines,auth=limited,expected=(403,))
check('preview requires purchase permission',True)
standalone=[{'description':'Standalone cost','quantity':2,'unitPrice':10,'uom':'Pcs'}]
sql.execute('UPDATE Companies SET InventoryTrackingEnabled=1 WHERE Id=?',cid)
free=call('POST','/api/purchasebills',{'companyId':cid,'supplierId':supplier['id'],'date':'2026-10-13','gstRate':0,'items':standalone})
check('purchase without item type posts no stock',net(free['id'])=={})
call('PUT',f"/api/purchasebills/{free['id']}",{'gstRate':0,'items':standalone})
check('editing purchase without item type posts no stock',net(free['id'])=={})
call('PUT',f"/api/users/{user['id']}/roles",{'roleIds':[role]})
call('PUT',f"/api/usercompanies/user/{user['id']}",{'companyIds':[]})
preview(lines,auth=limited,expected=(403,))
check('revoked company assignment denied on next preview',True)
print(f'{checks} purchase inventory checks passed')
