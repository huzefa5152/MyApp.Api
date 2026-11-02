"""Verify Trader accounting additions against an explicitly supplied local API.

Run only against a disposable database: this creates fixture companies and users.
Existing accounting suites remain independent and retain their assertions.
"""
import argparse
import datetime
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import requests


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    args = parser.parse_args()
    assert urlparse(args.base).hostname in ('127.0.0.1', 'localhost'), 'Local API required'
    base = args.base.rstrip('/')
    session = requests.Session()
    count = 0

    def request(method, path, body=None, statuses=(200, 201, 204), token=None):
        nonlocal count
        headers = {'Authorization': 'Bearer ' + token} if token else {}
        response = session.request(method, base + path, json=body, headers=headers, timeout=120)
        assert response.status_code in statuses, (method, path, response.status_code, response.text[:250])
        count += 1
        return response.json() if response.content and 'json' in response.headers.get('Content-Type', '') else response

    seed = request('POST', '/api/auth/login', {'username': 'admin', 'password': 'admin123'})['token']
    def api(method, path, body=None, **kwargs):
        return request(method, path, body, token=kwargs.pop('token', seed), **kwargs)

    companies = []
    user_id = role_id = None
    try:
        roles = api('GET', '/api/roles')
        sales_edition = next(role for role in roles if role['name'] == 'Sales Edition')
        complete_edition = next(role for role in roles if role['name'] == 'Complete Edition')
        new_keys = {'accounting.transfers.view', 'accounting.transfers.create', 'accounting.transfers.delete',
                    'accounting.transfers.print', 'accounting.reconciliation.view', 'accounting.reconciliation.manage'}
        assert new_keys.isdisjoint(sales_edition['permissionKeys'])
        assert new_keys.issubset(complete_edition['permissionKeys'])
        for label in ('A', 'B'):
            company = api('POST', '/api/companies', {'name': '[TEMP] Accounting expansion ' + label})
            companies.append(company['id'])
            api('POST', f"/api/accounts/company/{company['id']}/seed-wholesale")
        a, b = companies
        flat = api('GET', f'/api/accounts/company/{a}/flat')
        bank = next(row for row in flat if row['controlType'] == 'BankCash')
        rent = next(row for row in flat if row['name'] == 'Rent')
        sales = next(row for row in flat if row['name'] == 'Sales')
        bank2 = api('POST', f'/api/accounts/company/{a}', {
            'name': 'Sample second bank', 'accountGroupId': bank['accountGroupId'], 'controlType': 'BankCash'})
        foreign = api('GET', f'/api/accounts/company/{b}/bank-cash')[0]
        today = datetime.date.today().isoformat()
        transfer_body = {'date': today, 'fromAccountId': bank['id'], 'toAccountId': bank2['id'], 'amount': 125}
        transfer = api('POST', f'/api/account-transfers/company/{a}', transfer_body)
        api('GET', f"/api/account-transfers/{transfer['id']}/print")
        for change in ({'toAccountId': bank['id']}, {'toAccountId': foreign['id']}, {'amount': -1}):
            api('POST', f'/api/account-transfers/company/{a}', transfer_body | change, statuses=(400,))
        summary = api('GET', f'/api/bank-reconciliation/company/{a}/summary')
        assert next(x for x in summary if x['accountId'] == bank['id'])['actualBalance'] == -125
        assert next(x for x in summary if x['accountId'] == bank2['id'])['actualBalance'] == 125
        api('POST', f"/api/bank-reconciliation/transfer/{transfer['id']}/cleared", {'cleared': True})
        api('POST', f'/api/bank-reconciliation/company/{a}/lock', {
            'bankAccountId': bank['id'], 'statementDate': today, 'statementBalance': -125})
        api('POST', f"/api/bank-reconciliation/transfer/{transfer['id']}/cleared", {'cleared': False}, statuses=(400,))
        supplier = api('POST', '/api/suppliers', {'companyId': a, 'name': 'Sample supplier'})
        note = api('POST', '/api/purchasedebitnotes', {
            'companyId': a, 'supplierId': supplier['id'], 'date': today, 'gstRate': 18,
            'items': [{'description': 'Returned sample', 'quantity': 2, 'unitPrice': 50, 'uom': 'KG'}]})
        assert note['grandTotal'] == 118
        api('GET', f"/api/purchasedebitnotes/{note['id']}/print")
        api('DELETE', f"/api/suppliers/{supplier['id']}", statuses=(400,))
        payment = api('POST', f'/api/payments/payments/company/{a}', {
            'date': today, 'bankAccountId': bank2['id'], 'contactType': 'Other', 'contactName': 'Sample payee',
            'allocations': [{'kind': 'Account', 'accountId': rent['id'], 'amount': 118, 'taxRate': 18}]})
        entries = api('GET', f'/api/journal-entries/company/{a}/paged?pageSize=100')['items']
        payment_entry = next(e for e in entries if e['sourceDocType'] == 'Payment' and e['sourceDocId'] == payment['id'])
        legs = {line['accountId']: line['debit'] - line['credit'] for line in payment_entry['lines']}
        tax = next(row for row in flat if row['controlType'] == 'InputTax')
        assert legs[rent['id']] == 100 and legs[tax['id']] == 18 and legs[bank2['id']] == -118
        api('GET', f"/api/journal-entries/{payment_entry['id']}/print")
        item = api('POST', '/api/itemtypes', {'companyId': a, 'name': 'Sample fixture item ' + str(time.time_ns()), 'uom': 'KG'})
        bill = api('POST', '/api/purchasebills', {'companyId': a, 'supplierId': supplier['id'], 'date': today,
            'gstRate': 0, 'items': [{'itemTypeId': item['id'], 'description': 'Sample goods', 'quantity': 1, 'unitPrice': 100, 'uom': 'KG'}]})
        discount = next(row for row in flat if row['controlType'] == 'DiscountReceived')
        adjusted = api('POST', f'/api/payments/payments/company/{a}', {
            'date': today, 'bankAccountId': bank2['id'], 'contactType': 'Supplier', 'contactId': supplier['id'],
            'allocations': [{'kind': 'Document', 'purchaseBillId': bill['id'], 'amount': 90,
                             'adjustmentAmount': 10, 'adjustmentAccountId': discount['id']}]})
        assert adjusted['amount'] == 90
        settled = api('GET', f"/api/purchasebills/{bill['id']}")
        assert settled['balanceDue'] == 0
        api('POST', f'/api/bank-statements/company/{a}/import', {
            'bankAccountId': bank2['id'], 'csvText': f'Date,Description,Amount\n{today},Deposit,200\n{today},Ignore,5\n'})
        lines = api('GET', f"/api/bank-statements/account/{bank2['id']}/lines")
        api('POST', f"/api/bank-statements/line/{lines[0]['id']}/categorize", {'accountId': sales['id']})
        api('POST', f"/api/bank-statements/line/{lines[0]['id']}/categorize", {'accountId': sales['id']}, statuses=(400,))
        api('POST', f"/api/bank-statements/line/{lines[1]['id']}/ignore")
        before = api('GET', f'/api/accounts/company/{a}/flat')
        rebuilt = api('POST', f'/api/accounting/gl/company/{a}/rebuild')
        after = api('GET', f'/api/accounts/company/{a}/flat')
        assert {x['id']: x['balance'] for x in before} == {x['id']: x['balance'] for x in after}
        assert rebuilt['result']['postedTransfers'] == 1 and rebuilt['result']['postedPurchaseDebitNotes'] == 1
        assert rebuilt['status']['isBalanced']
        export = api('GET', f'/api/accounting/catalog/company/{a}/export/general-ledger')
        assert export.content[:2] == b'PK'
        print('PASS transfers, reconciliation, tax, statements, debit notes, rebuild and Excel export')

        username = 'accountingCheck' + str(time.time_ns())
        fixture_password = 'Passw0rd!23'
        user = api('POST', '/api/users', {'username': username, 'fullName': 'Accounting fixture', 'password': fixture_password, 'role': 'User'})
        user_id = user['id']
        keys = ['accounting.transfers.view', 'accounting.transfers.create', 'accounting.reconciliation.view',
                'accounting.reports.view', 'purchasedebitnotes.list.view', 'purchasedebitnotes.manage.create']
        role = api('POST', '/api/roles', {'name': username, 'tenantAdminUserId': user_id, 'permissionKeys': keys})
        role_id = role['id']
        api('PUT', f'/api/users/{user_id}/roles', {'roleIds': [role_id]})
        api('PUT', f'/api/usercompanies/user/{user_id}', {'companyIds': [a]})
        token = request('POST', '/api/auth/login', {'username': username, 'password': fixture_password})['token']
        for path in (f'/api/accounts/company/{a}/bank-cash', f'/api/accounts/company/{a}/flat',
                     f'/api/suppliers/company/{a}', f'/api/itemtypes?companyId={a}', f'/api/units?companyId={a}'):
            api('GET', path, token=token)
        api('POST', f"/api/bank-reconciliation/transfer/{transfer['id']}/cleared", {'cleared': False}, token=token, statuses=(403,))
        api('GET', f'/api/accounting/catalog/company/{a}/export/general-ledger', token=token, statuses=(403,))
        source = (Path(__file__).resolve().parents[1] / 'Controllers/AccountingCatalogController.cs').read_text(encoding='utf-8-sig')
        routes = re.findall(r'HttpGet\("company/\{companyId\}/([^"{}]+)"\)', source)
        for path in routes:
            api('GET', f'/api/accounting/catalog/company/{b}/{path}', token=token, statuses=(403,))
            if path not in ('customer-ledger', 'customer-statement', 'supplier-ledger', 'supplier-statement'):
                api('GET', f'/api/accounting/catalog/company/{a}/{path}', token=token)
        for path in (f'/api/account-transfers/company/{b}/paged', f'/api/bank-reconciliation/company/{b}/summary',
                     f'/api/accounts/company/{b}/bank-cash', f'/api/purchasedebitnotes/company/{b}'):
            api('GET', path, token=token, statuses=(403,))
        print(f'PASS all {len(routes)} catalogue tenant guards, module pickers and mutation/export permissions')
    finally:
        if user_id:
            api('DELETE', f'/api/users/{user_id}')
        if role_id:
            api('DELETE', f'/api/roles/{role_id}')
        for company_id in reversed(companies):
            api('DELETE', f'/api/companies/{company_id}')
    print(f'PASS {count} HTTP checks plus balance/format invariants; fixture cleanup passed')


if __name__ == '__main__':
    main()
