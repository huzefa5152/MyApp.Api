"""Trader non-FBR billing regression. Local scratch database only."""
import argparse,time
from datetime import date
from urllib.parse import urlparse
import pyodbc
import test_basic_flows as f
p=argparse.ArgumentParser();p.add_argument('--base',required=True);p.add_argument('--database',required=True);a=p.parse_args()
assert urlparse(a.base).hostname in ('localhost','127.0.0.1') and a.database.endswith('_Test')
db=pyodbc.connect('DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost\\MSSQLSERVER02;DATABASE='+a.database+';Trusted_Connection=yes;TrustServerCertificate=yes',autocommit=True)
token,co,client=f.setup(a.base,'admin','admin123');cid=co['id'];checks=0

def call(m,path,body=None,auth=None,status=(200,201,204)):
 s,d=f.http(m,path,a.base,token=auth or token,body=body);assert s in status,(m,path,s,d);return d

def check(label,ok):
 global checks
 assert ok,label
 checks+=1;print('PASS '+label,flush=True)

def bill(kind='FBR',rate=18):return {'companyId':cid,'clientId':client['id'],'date':date.today().isoformat(),'gstRate':rate,'taxTreatment':kind,'items':[{'description':'Service work','quantity':2,'unitPrice':5000,'uom':'Pcs'}]}

def ledger(b):
 rows=db.execute('SELECT l.Debit,l.Credit,l.Description FROM JournalLines l JOIN JournalEntries e ON e.Id=l.JournalEntryId WHERE e.CompanyId=? AND e.SourceDocId=?',cid,b['id']).fetchall()
 check('ledger balanced at bill total',sum(x[0] for x in rows)==sum(x[1] for x in rows)==b['grandTotal'])
 check('SRB tax posts to actual output-tax liability',db.execute('SELECT SUM(l.Credit) FROM JournalLines l JOIN JournalEntries e ON e.Id=l.JournalEntryId JOIN Accounts a ON a.Id=l.AccountId WHERE e.CompanyId=? AND e.SourceDocId=? AND a.ControlType=7',cid,b['id']).fetchone()[0]==b['gstAmount'])
 check('SRB tax separately labelled in tax liability entry',any(x[1]==b['gstAmount'] and 'SRB' in (x[2] or '') for x in rows))

call('POST',f'/api/accounts/company/{cid}/seed-wholesale')
check('new companies default off',not co['allowNonFbrBills'])
call('POST','/api/invoices/standalone',bill('SRB',15),status=(400,))
check('disabled company refuses SRB API creation',True)
normal=call('POST','/api/invoices/standalone',bill())
check('existing FBR defaults and 18 percent unchanged',normal['taxTreatment']=='FBR' and normal['gstAmount']==1800 and normal['grandTotal']==11800)
call('PUT',f'/api/companies/{cid}',{'name':co['name'],'allowNonFbrBills':True,'fbrSellerRegistrationNo':'9999999'})
srb=call('POST','/api/invoices/standalone',bill('SRB',15))
check('standalone 15 percent SRB totals',srb['gstAmount']==1500 and srb['grandTotal']==11500 and srb['balanceDue']==11500)
check('SRB cannot be FBR ready',not srb['fbrReady'] and not srb['fbrAdjustmentRequired'])
ledger(srb)
for suffix in ['validate','submit','preview-payload']:
 result=call('GET' if suffix=='preview-payload' else 'POST',f"/api/fbr/{srb['id']}/{suffix}")
 check('direct FBR '+suffix+' refused before provider call',not result['success'] and 'outside FBR' in str(result))
pr=call('GET',f"/api/invoices/{srb['id']}/print/bill")
check('print carries SRB label and saved rate',pr['taxTreatment']=='SRB' and pr['taxLabel']=='SRB sales tax' and pr['gstRate']==15)
updated=call('PUT',f"/api/invoices/{srb['id']}",{'gstRate':12.5,'taxTreatment':'SRB','items':[dict(x,unitPrice=x['unitPrice']) for x in srb['items']]})
check('edit arbitrary SRB rate persists',updated['gstRate']==12.5 and updated['gstAmount']==1250 and updated['grandTotal']==11250)
ledger(updated)
dc=call('POST',f'/api/deliverychallans/company/{cid}',{'clientId':client['id'],'deliveryDate':date.today().isoformat(),'items':[{'description':'Challan service','quantity':2,'unit':'Pcs'}]})
ch=call('POST','/api/invoices',{'companyId':cid,'clientId':client['id'],'date':date.today().isoformat(),'gstRate':17.25,'taxTreatment':'SRB','challanIds':[dc['id']],'items':[{'deliveryItemId':dc['items'][0]['id'],'unitPrice':5000}]})
check('challan bill supports arbitrary SRB percentage',ch['gstAmount']==1725 and ch['grandTotal']==11725 and ch['taxTreatment']=='SRB')
ledger(ch)
no=call('POST','/api/invoices/standalone',bill('NoTax',0))
check('no tax commercial bill',no['gstAmount']==0 and no['grandTotal']==10000 and not no['fbrReady'])
for kind,rate in [('bogus',15),('SRB',101),('SRB',-1),('NoTax',15)]:call('POST','/api/invoices/standalone',bill(kind,rate),status=(400,))
check('invalid treatments and rates rejected',True)
tax=call('GET',f'/api/reports/company/{cid}/tax-sheet?year={date.today().year}')
check('SRB and no tax excluded from FBR tax sheet',not any(x['invoiceId'] in [srb['id'],ch['id'],no['id']] for x in tax['rows']))
report=call('GET',f'/api/reports/company/{cid}/invoice-sales-detail')
check('commercial sales retains SRB with outside FBR status',any(x['invoiceId']==srb['id'] and 'Outside FBR' in x['fbrStatus'] for x in report['rows']))
db.execute("UPDATE InvoiceItems SET HSCode='9999.9999' WHERE InvoiceId=?",srb['id'])
claim=call('POST','/api/tax-claim/claim-summary',{'companyId':cid,'billDate':date.today().isoformat(),'billGstRate':18,'periodCode':'all-time','billRows':[{'hsCode':'9999.9999','itemTypeName':'Synthetic classification','qty':0,'value':0}]})
check('SRB does not consume the FBR input-tax bank',all(x['bank']['soldTax']==0 and x['bank']['soldQty']==0 for x in claim['rows']))
call('PUT',f"/api/invoices/{srb['id']}/tax-filing",{'version':'synthetic','rows':[]},status=(400,))
check('SRB cannot acquire an FBR filing plan',True)
name='srb_test_'+str(time.time_ns());u=call('POST','/api/users',{'username':name,'fullName':'Local bill tester','password':'LocalTest123!','role':'User'})
keys=['companies.manage.view','companies.manage.update','bills.manage.create','bills.manage.update','bills.list.view','invoices.fbr.validate','invoices.fbr.submit','invoices.fbr.preview','reports.invoicedetail.view']
role=call('POST','/api/roles',{'name':name,'permissionKeys':keys,'tenantAdminUserId':u['id']});call('PUT',f"/api/users/{u['id']}/roles",{'roleIds':[role['id']]});call('PUT',f"/api/usercompanies/user/{u['id']}",{'companyIds':[cid]})
auth=call('POST','/api/auth/login',{'username':name,'password':'LocalTest123!'})['token']
call('GET',f"/api/invoices/{srb['id']}",auth=auth)
call('PUT',f'/api/companies/{cid}',{'name':co['name'],'allowNonFbrBills':False},auth=auth,status=(403,))
check('assigned user can read bill but cannot change seed-only setting',True)
call('PUT',f"/api/usercompanies/user/{u['id']}",{'companyIds':[]})
for m,path,data in [('GET',f"/api/invoices/{srb['id']}",None),('POST','/api/invoices/standalone',bill('SRB',15)),('PUT',f"/api/invoices/{srb['id']}",{'gstRate':15,'items':srb['items']}),('POST',f"/api/fbr/{srb['id']}/validate",None),('GET',f'/api/reports/company/{cid}/invoice-sales-detail',None)]:call(m,path,data,auth=auth,status=(403,))
check('revoked company denies read write FBR and report paths',True)
# Submitted FBR bills stay immutable when a caller requests SRB instead.
db.execute("UPDATE Invoices SET FbrStatus='Submitted',FbrIRN='SYNTHETIC-IRN' WHERE Id=? AND CompanyId=?",normal['id'],cid)
call('PUT',f"/api/invoices/{normal['id']}",{'gstRate':15,'taxTreatment':'SRB','items':normal['items']},status=(400,))
check('submitted FBR bill cannot be converted to SRB',True)
call('PUT',f'/api/companies/{cid}',{'name':co['name'],'allowNonFbrBills':False,'fbrSellerRegistrationNo':'9999999'})
call('POST','/api/invoices/standalone',bill('SRB',15),status=(400,))
keep=call('PUT',f"/api/invoices/{srb['id']}",{'gstRate':10,'items':updated['items']})
check('disabled setting preserves and permits editing existing SRB bills',keep['taxTreatment']=='SRB' and keep['gstAmount']==1000)
# Old clients omit taxTreatment on update; this must not silently turn SRB into FBR.
check('legacy update preserves saved tax treatment',keep['taxTreatment']=='SRB')
call('DELETE',f"/api/users/{u['id']}");call('DELETE',f"/api/roles/{role['id']}")
print(f'ALL {checks} non-FBR billing checks passed',flush=True)
