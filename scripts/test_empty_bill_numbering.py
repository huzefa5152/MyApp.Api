"""Local API regression for Custom-first billing in an empty number series."""
import argparse
import subprocess
from urllib.parse import urlparse
from datetime import datetime, timezone
from test_basic_flows import http

p = argparse.ArgumentParser()
p.add_argument('--base', required=True)
p.add_argument('--database', required=True)
a = p.parse_args()
assert urlparse(a.base).hostname in ('localhost', '127.0.0.1')
assert a.database.endswith('_Test') and a.database.startswith('MyApp_Trader_')
status, login = http('POST','/api/auth/login',a.base,body={'username':'admin','password':'admin123'})
assert status == 200, status
token = login['token']
checks = 0

def call(method,path,body=None):
    status, data = http(method,path,a.base,token=token,body=body)
    assert status in (200,201,204), (path,status,data)
    return data

def check(label, ok):
    global checks
    assert ok, label
    checks += 1
    print('PASS '+label,flush=True)

today = datetime.now(timezone.utc).strftime('%Y-%m-%dT00:00:00Z')
for mode in ('standalone','challan'):
    company = call('POST','/api/companies',{'name':'[TEMP] Custom-first '+mode,'startingInvoiceNumber':1,'startingChallanNumber':1})
    cid = int(company['id'])
    client = call('POST','/api/clients',{'name':'Sample numbering buyer','companyId':cid,'registrationType':'Unregistered'})
    subprocess.run(['sqlcmd','-S',r'.\MSSQLSERVER02','-d',a.database,'-E','-C','-b','-Q',f'SET NOCOUNT ON; UPDATE Companies SET CurrentInvoiceNumber=900 WHERE Id={cid};'],check=True,capture_output=True)
    def next_number():return call('GET',f'/api/invoices/company/{cid}/next-number')['nextNumber']
    def create(number=None):
        body={'companyId':cid,'clientId':client['id'],'date':today,'gstRate':18}
        if number is not None:body['invoiceNumber']=number
        if mode=='standalone':
            body['items']=[{'description':'Sample service','quantity':1,'unitPrice':100,'uom':'Pcs'}]
            return call('POST','/api/invoices/standalone',body)
        challan=call('POST',f'/api/deliverychallans/company/{cid}',{'clientId':client['id'],'deliveryDate':today,'items':[{'description':'Sample service','quantity':1,'unit':'Pcs'}]})
        body['challanIds']=[challan['id']]
        body['items']=[{'deliveryItemId':line['id'],'unitPrice':100} for line in challan['items']]
        return call('POST','/api/invoices',body)
    check(mode+' empty preview resets stale cursor',next_number()==1)
    first=create(50)
    check(mode+' accepts Custom 50 first',first['invoiceNumber']==50)
    check(mode+' Custom first preserves Auto 1',next_number()==1)
    auto=create()
    check(mode+' saves Auto 1 after Custom',auto['invoiceNumber']==1)
    check(mode+' next Auto advances to 2',next_number()==2)
    create(75)
    check(mode+' nonempty Custom leaves Auto at 2',next_number()==2)
    last=create()
    check(mode+' saves the next Auto 2',last['invoiceNumber']==2)
print(f'{checks} Custom-first bill API checks passed')
