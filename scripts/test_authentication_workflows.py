"""Run core document workflows as real administrator and business-user accounts.

Local only; uses temporary companies, customers, users and system role grants.
"""
import argparse
import uuid
from urllib.parse import urlparse
import test_basic_flows as flows

parser = argparse.ArgumentParser()
parser.add_argument('--base', required=True)
parser.add_argument('--role', action='append', choices=('Administrator', 'Complete Edition', 'Sales Edition'))
args = parser.parse_args()
base = args.base
assert urlparse(base).hostname in ('127.0.0.1', 'localhost')
status, response = flows.http('POST', '/api/auth/login', base, body={'username': 'admin', 'password': 'admin123'})
assert status == 200
seed = response['token']
status, roles = flows.http('GET', '/api/roles', base, token=seed)
assert status == 200
password = 'Workflow#Test2026'
for role_name in args.role or ('Administrator', 'Complete Edition', 'Sales Edition'):
    print('Testing normal document workflow as ' + role_name, flush=True)
    role = next(role for role in roles if role['name'] == role_name and role['isSystemRole'])
    status, user = flows.http('POST', '/api/users', base, token=seed, body={
        'username': 'authflow' + uuid.uuid4().hex[:12], 'password': password,
        'fullName': 'Local workflow verification', 'role': 'User'})
    assert status == 201
    company = None
    try:
        assert flows.http('PUT', f"/api/users/{user['id']}/roles", base, token=seed,
            body={'roleIds': [role['id']]})[0] == 200
        _, company, client = flows.setup(base, 'admin', 'admin123')
        assert flows.http('PUT', f"/api/usercompanies/user/{user['id']}", base, token=seed,
            body={'companyIds': [company['id']]})[0] == 200
        status, signed_in = flows.http('POST', '/api/auth/login', base,
            body={'username': user['username'], 'password': password})
        assert status == 200
        token = signed_in['token']
        status, profile = flows.http('GET', '/api/auth/me', base, token=token)
        flows.check('identity', role_name + ' is not seed admin', status == 200 and not profile['isSeedAdmin'])
        status, item = flows.http('POST', f"/api/itemtypes?companyId={company['id']}", base, token=seed, body={
            'name': 'Workflow Goods ' + uuid.uuid4().hex[:8], 'companyId': company['id'],
            'hsCode': '8481.1000', 'uom': 'Pcs', 'saleType': 'Goods at Standard Rate (default)', 'isFavorite': True})
        assert status in (200, 201)
        classified = flows.pick_classified_item_type(base, token, company['id'])
        assert classified
        challan = flows.test_challan_creation(base, token, company, client, classified)
        assert challan and challan['status'] == 'Pending'
        linked = flows.test_bill_from_challan(base, token, company, client, challan)
        standalone = flows.test_standalone_bill(base, token, company, client)
        flows.test_invoice_update(base, token, standalone)
        flows.test_item_rate_history(base, token, company, classified)
        flows.test_tax_calculations(base, token, company, client)
        for label, invoice in (('linked', linked), ('standalone', standalone)):
            for document in ('bill', 'tax-invoice'):
                status, printed = flows.http('GET', f"/api/invoices/{invoice['id']}/print/{document}", base, token=token)
                flows.check('printing', role_name + ' ' + label + ' ' + document, status == 200 and bool(printed))
    finally:
        if company:
            assert flows.http('DELETE', f"/api/companies/{company['id']}", base, token=seed)[0] == 204
        assert flows.http('DELETE', f"/api/users/{user['id']}", base, token=seed)[0] == 200
raise SystemExit(flows.print_report())
