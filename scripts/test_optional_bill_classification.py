"""Local bill classification regression, both create paths; never submits to FBR."""
import argparse
import json
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import uuid4
from test_tenant_leak_sweep import http, company_payload

parser = argparse.ArgumentParser()
parser.add_argument('--base', required=True)
args = parser.parse_args()
assert urlparse(args.base).hostname in ('localhost', '127.0.0.1')
status, login = http('POST', '/api/auth/login', args.base, body={'username':'admin','password':'admin123'})
assert status == 200, status
token = login['token']
checks = 0

def call(method, path, body=None):
    status, result = http(method, path, args.base, token, body)
    assert status in (200, 201, 204), (path, status, result)
    return result

def check(ok, label):
    global checks
    assert ok, label
    checks += 1
    print('PASS', label, flush=True)

payload = company_payload('[TEMP] Optional classification '+uuid4().hex[:8])
payload.update(fbrToken='local-fixture-token', fbrBusinessActivity='Importer', fbrSector='Other')
company = call('POST', '/api/companies', payload)
cid = company['id']
try:
    client = call('POST', '/api/clients', {'companyId':cid,'name':'Sample buyer','registrationType':'Registered','ntn':'1234567','address':'Sample address','fbrProvinceCode':8})
    sale = 'Goods at standard rate (default)'
    groups = [call('POST', '/api/itemtypes', {'companyId':cid,'name':['Sample hardware','Sample pneumatic'][n],'uom':'Nos'}) for n in range(2)]
    filing = [call('POST', '/api/itemtypes', {'companyId':cid,'name':['Sample furniture','Sample seating'][n],'hsCode':code,'uom':'Nos','fbrUOMId':13,'saleType':sale}) for n,code in enumerate(['9403.6000','9401.3000'])]
    today = datetime.now(timezone.utc).strftime('%Y-%m-%dT00:00:00Z')
    for mode in ('standalone', 'challan'):
        for classified in (False, True):
            lines = [{'description':'Sample product '+str(n),'quantity':1,'uom':'Nos','unitPrice':100, **({'itemTypeId':groups[n//5]['id']} if classified else {})} for n in range(10)]
            body = {'companyId':cid,'clientId':client['id'],'date':today,'gstRate':18,'groupTaxInvoiceByItemType':True}
            if mode == 'standalone':
                body['items'] = lines
                bill = call('POST','/api/invoices/standalone',body)
            else:
                challan = call('POST',f'/api/deliverychallans/company/{cid}',{'clientId':client['id'],'deliveryDate':today,'items':[{'description':r['description'],'quantity':1,'unit':'Nos'} for r in lines]})
                body['challanIds']=[challan['id']]
                body['items']=[{'deliveryItemId':r['id'],'unitPrice':100, **({'itemTypeId':groups[n//5]['id']} if classified else {})} for n,r in enumerate(challan['items'])]
                bill=call('POST','/api/invoices',body)
            label=mode+(' typed' if classified else ' unclassified')
            path=f"/api/invoices/{bill['id']}/tax-filing"
            editor=call('GET',path)
            check(len(editor['rows']) == (2 if classified else 10),label+' starts with the intended groups')
            check(len(bill['items']) == 10,label+' preserves ten commercial lines')
            before=call('GET',f"/api/invoices/{bill['id']}/print/bill")
            source=bill['items']
            rows=[{'sourceLineIds':[r['id'] for r in source[n*5:n*5+5]],'itemTypeId':filing[n]['id'],'quantity':5,'valueExclTax':500} for n in range(2)]
            saved=call('PUT',path,{'version':editor['version'],'rows':rows})
            preview=call('GET',f"/api/fbr/{bill['id']}/preview-payload")
            check(preview.get("success") and len(json.loads(preview["preview"]["json"])["items"]) == 2,label+" FBR preview contains exactly two rows")
            check(len(saved['rows']) == 2,label+' saves two HS groups')
            check(saved['bill']['items'] == bill['items'],label+' filing leaves source items unchanged')
            check(call('GET',f"/api/invoices/{bill['id']}/print/bill") == before,label+' commercial print stays unchanged')
            merged={'sourceLineIds':[r['id'] for r in source],'itemTypeId':filing[0]['id'],'quantity':10,'valueExclTax':1000}
            saved=call('PUT',path,{'version':saved['version'],'rows':[merged]})
            check(len(call('GET',f"/api/invoices/{bill['id']}/print/tax-invoice")['items']) == 1,label+' can merge both groups to one tax invoice row')
            check(saved['bill']['gstAmount'] == 180,label+' GST stays unchanged')
    print(f'{checks} passed, 0 failed',flush=True)
finally:
    call('DELETE', f'/api/companies/{cid}')
