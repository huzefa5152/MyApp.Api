"""Local scratch test of company-specific tax prints and FBR descriptions."""
import argparse
import json
from datetime import date
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
from test_basic_flows import http
from test_tenant_leak_sweep import company_payload

p = argparse.ArgumentParser()
p.add_argument('--base', required=True)
p.add_argument('--fixture', help='Optional private print-payload output')
a = p.parse_args()
assert urlparse(a.base).hostname in ('localhost', '127.0.0.1')
token = http('POST', '/api/auth/login', a.base, body={'username': 'admin', 'password': 'admin123'})[1]['token']

def call(method, path, body=None, auth=None, expected=(200, 201, 204)):
    status, data = http(method, path, a.base, token=auth or token, body=body)
    assert status in expected, (method, path, status, data)
    return data

checks = 0
def check(ok, label):
    global checks
    assert ok, label
    checks += 1
    print('PASS', label, flush=True)

stamp = uuid4().hex[:8]
co = call('POST', '/api/companies', {**company_payload('[TEMP] Print policy '+stamp), 'fbrToken': 'synthetic-local-token'})
cid = co['id']
check(not co['taxInvoiceUseOriginalBillLines'] and not co['fbrOmitProductDescription'], 'new company policies default off')
client = call('POST', '/api/clients', {'companyId': cid, 'name': 'Synthetic buyer', 'address': 'Sample address', 'ntn': '1234567', 'registrationType': 'Registered', 'fbrProvinceCode': 8})
classification = call('POST', '/api/itemtypes', {'companyId': cid, 'name': 'Synthetic classification '+stamp, 'hsCode': '8481.8090', 'uom': 'Numbers, pieces, units', 'fbrUOMId': 69, 'saleType': 'Goods at Standard Rate (default)'})
rows = [{'description': 'Original sheet '+str(n), 'quantity': n, 'unitPrice': n*100, 'uom': 'Numbers, pieces, units'} for n in (2, 3, 4)]
bill = call('POST', '/api/invoices/standalone', {'companyId': cid, 'clientId': client['id'], 'date': date.today().isoformat(), 'gstRate': 18, 'groupTaxInvoiceByItemType': True, 'items': rows})
iid = bill['id']
editor = call('GET', f'/api/invoices/{iid}/tax-filing')
filing = call('PUT', f'/api/invoices/{iid}/tax-filing', {'version': editor['version'], 'rows': [{'sourceLineIds': [i['id'] for i in bill['items']], 'itemTypeId': classification['id'], 'quantity': 1, 'valueExclTax': bill['subtotal'], 'description': 'Grouped filing description'}]})
before = call('GET', f'/api/invoices/{iid}/print/tax-invoice')
check(len(before['items']) == 1 and before['items'][0]['quantity'] == 1, 'default company retains grouped filing print')
preview_before = call('GET', f'/api/fbr/{iid}/preview-payload')
check(preview_before['success'], 'default preview succeeds')
payload_before = json.loads(preview_before['preview']['json'])
check(bool(payload_before['items'][0]['productDescription']), 'default FBR description retained')
call('PUT', f'/api/companies/{cid}', {**co, 'taxInvoiceUseOriginalBillLines': True, 'fbrOmitProductDescription': True})
printed = call('GET', f'/api/invoices/{iid}/print/tax-invoice')
check(len(printed['items']) == 3 and len(printed['billItems']) == 3, 'policy prints individual original rows despite filing grouping')
check([r['description'] for r in printed['items']] == [r['description'] for r in rows], 'original descriptions retained in order')
check([r['quantity'] for r in printed['items']] == [2, 3, 4], 'original quantities retained')
check([r['unitPrice'] for r in printed['items']] == [200, 300, 400], 'original unit prices retained')
check(sum(r['valueExclTax'] for r in printed['items']) == bill['subtotal'] and sum(r['gstAmount'] for r in printed['items']) == bill['gstAmount'], 'printed amounts reconcile to bill')
preview_after = call('GET', f'/api/fbr/{iid}/preview-payload')
check(preview_after['success'], 'opted-in preview succeeds')
payload_after = json.loads(preview_after['preview']['json'])
check(payload_after['items'][0]['productDescription'] == '', 'opted-in FBR preview has explicit empty description')
payload_before['items'][0]['productDescription'] = ''
check(payload_before == payload_after, 'FBR grouping quantity HS code and all monetary fields unchanged')
check(call('GET', f'/api/invoices/{iid}/tax-filing')['rows'] == filing['rows'], 'printing and preview do not mutate consultant filing')
name = 'policy_'+stamp
user = call('POST', '/api/users', {'username': name, 'fullName': 'Synthetic policy tester', 'password': 'LocalTest123!', 'role': 'User'})
role = call('POST', '/api/roles', {'name': name, 'tenantAdminUserId': user['id'], 'permissionKeys': ['companies.manage.view', 'companies.manage.create', 'companies.manage.update', 'invoices.print.view', 'invoices.fbr.preview', 'invoices.fbr.validate', 'invoices.fbr.submit']})
call('PUT', f"/api/users/{user['id']}/roles", {'roleIds': [role['id']]})
call('PUT', f"/api/usercompanies/user/{user['id']}", {'companyIds': [cid]})
auth = call('POST', '/api/auth/login', {'username': name, 'password': 'LocalTest123!'})['token']
call('GET', f'/api/invoices/{iid}/print/tax-invoice', auth=auth)
for field in ['taxInvoiceUseOriginalBillLines', 'fbrOmitProductDescription']:
    call('PUT', f'/api/companies/{cid}', {**co, field: False}, auth=auth, expected=(403,))
    call('POST', '/api/companies', {**company_payload('[TEMP] Denied '+stamp), field: True}, auth=auth, expected=(403,))
check(True, 'assigned non-seed user can print but cannot configure either policy')
call('PUT', f'/api/companies/{cid}', {k: v for k, v in co.items() if k not in ('taxInvoiceUseOriginalBillLines', 'fbrOmitProductDescription')})
saved = call('GET', f'/api/companies/{cid}')
check(saved['taxInvoiceUseOriginalBillLines'] and saved['fbrOmitProductDescription'], 'omitted fields preserve policy settings')
call('PUT', f"/api/usercompanies/user/{user['id']}", {'companyIds': []})
for method, path in [('GET', f'/api/invoices/{iid}/print/tax-invoice'), ('GET', f'/api/fbr/{iid}/preview-payload'), ('POST', f'/api/fbr/{iid}/validate'), ('POST', f'/api/fbr/{iid}/submit')]:
    call(method, path, auth=auth, expected=(403,))
check(True, 'unassigned company denies print preview validate and submit before provider calls')
call('PUT', f'/api/companies/{cid}', {**co, 'taxInvoiceUseOriginalBillLines': False, 'fbrOmitProductDescription': False})
check(call('GET', f'/api/invoices/{iid}/print/tax-invoice')['items'] == before['items'], 'switching off restores existing print output exactly')
check(json.loads(call('GET', f'/api/fbr/{iid}/preview-payload')['preview']['json']) == json.loads(preview_before['preview']['json']), 'switching off restores existing FBR payload exactly')
if a.fixture:
    Path(a.fixture).write_text(json.dumps({'print': printed, 'companyId': cid, 'invoiceId': iid}), encoding='utf8')
call('DELETE', f"/api/users/{user['id']}")
call('DELETE', f"/api/roles/{role['id']}")
print(f'ALL {checks} company invoice presentation checks passed')
