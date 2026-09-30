"""Local-only regression: rebuild concurrently with document writes on two API instances.

Creates a disposable company. Checks exact ledger legs, not just successful HTTP
responses, and verifies closed-period/manual entries survive unchanged.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from urllib.parse import urlparse
from uuid import uuid4

from test_accounting_posting import http


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--secondary', required=True)
    parser.add_argument('--user', default='admin')
    parser.add_argument('--password', default='admin123')
    args = parser.parse_args()
    for url in (args.base, args.secondary):
        if urlparse(url).hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError('Use disposable LOCAL API instances only')
    status, login = http('POST', '/api/auth/login', args.base,
                         body={'username': args.user, 'password': args.password})
    assert status == 200, (status, login)
    token = login['token']
    company_id = None

    def call(method, path, body=None, base=None):
        status, response = http(method, path, base or args.base, token=token, body=body)
        assert 200 <= status < 300, (method, path, status, response)
        return response

    try:
        company = call('POST', '/api/companies', {
            'name': 'Sample ledger concurrency ' + uuid4().hex[:8],
            'startingInvoiceNumber': 1, 'startingChallanNumber': 1,
            'startingPurchaseBillNumber': 1, 'inventoryTrackingEnabled': False,
            'fbrSellerRegistrationNo': '9999999', 'fbrProvinceCode': 8,
            'fbrBusinessActivity': 'Wholesaler', 'fbrSector': 'Wholesale / Retails',
            'fbrToken': 'sample-not-a-real-token', 'fbrEnvironment': 'sandbox'})
        company_id = company['id']
        call('POST', f'/api/accounts/company/{company_id}/seed-wholesale')
        accounts = call('GET', f'/api/accounts/company/{company_id}/flat')
        names = {a['name']: a['id'] for a in accounts}
        bank = next(a['id'] for a in accounts if a['controlType'] == 'BankCash')
        client = call('POST', '/api/clients', {'companyId': company_id, 'name': 'Sample buyer',
            'ntn': '9999999', 'registrationType': 'Registered', 'fbrProvinceCode': 8})
        supplier = call('POST', '/api/suppliers', {'companyId': company_id, 'name': 'Sample supplier'})
        date = '2001-01-01T00:00:00Z'

        def sale(base, quantity=2.5, price=11, when=date):
            return call('POST', '/api/invoices/standalone', {
                'companyId': company_id, 'clientId': client['id'], 'date': when,
                'gstRate': 18, 'items': [{'description': 'Sample sold', 'quantity': quantity,
                                         'uom': 'KG', 'unitPrice': price}]}, base=base)

        def linked_sale(base):
            dc = call('POST', f'/api/deliverychallans/company/{company_id}', {
                'companyId': company_id, 'clientId': client['id'], 'deliveryDate': date,
                'poNumber': 'SAMPLE-PO', 'poDate': date,
                'items': [{'description': 'Sample linked sale', 'quantity': 2.5, 'unit': 'KG'}]}, base=base)
            return call('POST', '/api/invoices', {
                'companyId': company_id, 'clientId': client['id'], 'date': date, 'gstRate': 18,
                'challanIds': [dc['id']], 'items': [{'deliveryItemId': dc['items'][0]['id'],
                    'description': 'Sample linked sale', 'unitPrice': 11}]}, base=base)

        def purchase(base):
            return call('POST', '/api/purchasebills', {
                'companyId': company_id, 'supplierId': supplier['id'], 'date': date,
                'gstRate': 18, 'supplierBillNumber': 'SAMPLE-' + uuid4().hex,
                'items': [{'description': 'Sample bought', 'quantity': 1.25,
                           'uom': 'KG', 'unitPrice': 8}]}, base=base)

        def receipt(base):
            return call('POST', f'/api/payments/receipts/company/{company_id}', {
                'date': date, 'contactType': 'Client', 'contactId': client['id'],
                'bankAccountId': bank, 'method': 'Cash',
                'allocations': [{'accountId': names['Other income'], 'amount': 5}]}, base=base)

        def entries():
            return call('GET', f'/api/journal-entries/company/{company_id}/paged?pageSize=200')['items']

        def shape(entry):
            return (entry['sourceDocType'], entry.get('sourceDocId'), entry['date'],
                    tuple(sorted((line['accountId'], str(Decimal(str(line['debit']))),
                                  str(Decimal(str(line['credit']))), line.get('partyType'),
                                  line.get('partyId'), line.get('invoiceId'), line.get('purchaseBillId'))
                                 for line in entry['lines'])))

        closed_sale = sale(args.base, 7, 10, '2000-01-01T00:00:00Z')
        manual = call('POST', f'/api/journal-entries/company/{company_id}', {
            'date': '2000-01-01T00:00:00Z', 'narration': 'Sample manual accrual',
            'lines': [{'accountId': names['Rent'], 'debit': 2, 'credit': 0},
                      {'accountId': names['Salaries'], 'debit': 0, 'credit': 2}]})
        protected = {e['id']: shape(e) for e in entries()}
        assert len(protected) == 2
        call('PUT', f'/api/accounting/gl/company/{company_id}/lock-date', {'lockDate': '2000-12-31'})
        # Build enough history that each rebuild and writer overlap in SQL.
        for _ in range(10):
            sale(args.base)

        rendezvous = Barrier(3)
        expected = []

        def writers():
            rendezvous.wait()
            for i in range(12):
                base = args.base if i % 2 == 0 else args.secondary
                inv = sale(base) if i % 2 == 0 else linked_sale(base)
                pb = purchase(base)
                pay = receipt(base)
                assert Decimal(str(inv['grandTotal'])) == Decimal('32.45')
                assert Decimal(str(pb['grandTotal'])) == Decimal('11.8')
                expected.extend([('Invoice', inv['id']), ('PurchaseBill', pb['id']), ('Payment', pay['id'])])
                if i in (2, 6, 10):
                    edited = call('PUT', f"/api/invoices/{inv['id']}", {
                        'gstRate': 18, 'items': [{'id': inv['items'][0]['id'],
                            'description': 'Sample sold edited', 'quantity': 3.5,
                            'uom': 'KG', 'unitPrice': 10}]}, base=base)
                    assert Decimal(str(edited['grandTotal'])) == Decimal('41.3')
                    edited_pb = call('PUT', f"/api/purchasebills/{pb['id']}", {
                        'gstRate': 18, 'items': [{'id': pb['items'][0]['id'],
                            'description': 'Sample bought edited', 'quantity': 2,
                            'uom': 'KG', 'unitPrice': 8}]}, base=base)
                    assert Decimal(str(edited_pb['grandTotal'])) == Decimal('18.88')
                if i in (4, 8):
                    call('POST', f"/api/invoices/{inv['id']}/cancel", {'reason': 'Sample cancellation'}, base=base)
                    expected.remove(('Invoice', inv['id']))
                # Deletion also owns a document/ledger transaction.
                if i % 3 == 0:
                    call('DELETE', f"/api/invoices/{inv['id']}", base=base)
                    expected.remove(('Invoice', inv['id']))
                    call('DELETE', f"/api/purchasebills/{pb['id']}", base=base)
                    expected.remove(('PurchaseBill', pb['id']))
                    call('DELETE', f"/api/payments/receipts/{pay['id']}", base=base)
                    expected.remove(('Payment', pay['id']))

        def rebuilds(base):
            rendezvous.wait()
            for _ in range(16):
                call('POST', f'/api/accounting/gl/company/{company_id}/rebuild', base=base)

        with ThreadPoolExecutor(max_workers=3) as pool:
            jobs = [pool.submit(writers), pool.submit(rebuilds, args.base),
                    pool.submit(rebuilds, args.secondary)]
            for job in jobs:
                job.result(timeout=180)
        before = entries()
        by_source = {(e['sourceDocType'], e.get('sourceDocId')): e for e in before if not e['isManual']}
        assert len(by_source) == len(before) - 1, 'Duplicate source posting'
        for key in expected:
            assert key in by_source, ('Missing concurrent posting', key)
        assert len(before) == 2 + 10 + len(expected), 'Missing or extra journal entries'
        for e in before:
            assert Decimal(str(e['totalDebit'])) == Decimal(str(e['totalCredit']))
            if e['id'] in protected:
                assert shape(e) == protected[e['id']], 'Protected posting changed'
        assert all(key in {e['id'] for e in before} for key in protected), 'Protected posting removed'
        assert sum(Decimal(str(e['totalDebit'])) for e in before) == Decimal('770.06'), 'Independent expected ledger total differs'
        call('POST', f'/api/accounting/gl/company/{company_id}/rebuild')
        after = entries()
        assert sorted(map(shape, before), key=str) == sorted(map(shape, after), key=str), 'Concurrent ledger differs from clean rebuild'
        assert {e['id']: shape(e) for e in after if e['id'] in protected} == protected
        print('PASS: 32 overlapping rebuilds and 56 document create/edit/cancel/delete operations across two API instances; exact ledger legs and independently calculated total 770.06 converge, no duplicate/missing entries, closed/manual entries unchanged.')
    finally:
        if company_id is not None:
            call('PUT', f'/api/accounting/gl/company/{company_id}/lock-date', {'lockDate': None})
            call('DELETE', f'/api/companies/{company_id}')


if __name__ == '__main__':
    main()

