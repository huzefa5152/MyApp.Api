"""Auto/custom document numbering. Run only against a disposable local database."""
import argparse
import concurrent.futures
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:5194')
    parser.add_argument('--peer', help='Second local process on the same test database')
    args = parser.parse_args()
    for base in (args.base, args.peer):
        if base and urllib.parse.urlparse(base).hostname not in ('127.0.0.1', 'localhost', '::1'):
            parser.error('Only a local disposable test server is permitted')
    checks = []
    records = []
    companies = []

    def check(name, passed, detail=''):
        checks.append(passed)
        print(('PASS ' if passed else 'FAIL ') + name + ('' if passed else ': ' + str(detail)), flush=True)

    def call(method, path, body=None, token=None, base=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request((base or args.base) + path, method=method,
            headers=headers, data=json.dumps(body).encode() if body is not None else None)
        try:
            response = urllib.request.urlopen(req, timeout=90)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read()
        return response.code, json.loads(raw) if raw else None

    status, login = call('POST', '/api/auth/login', {'username': 'admin', 'password': 'admin123'})
    assert status == 200, (status, login)
    seed = login['token']
    routes = {'quote': 'salesquotes', 'challan': 'deliverychallans',
        'purchase-bill': 'purchasebills', 'goods-receipt': 'goodsreceipts', 'bill': 'invoices'}
    number_fields = {'quote': 'quoteNumber', 'challan': 'challanNumber',
        'purchase-bill': 'purchaseBillNumber', 'goods-receipt': 'goodsReceiptNumber', 'bill': 'invoiceNumber'}

    def create(kind, company, custom=None, base=None, bad_link=False):
        co, client, supplier = company
        body = {'companyId': co, 'clientId': client, 'supplierId': supplier,
            'date': '2026-10-01', 'deliveryDate': '2026-10-01', 'receiptDate': '2026-10-01',
            'gstRate': 18, 'customNumber': custom, 'invoiceNumber': custom, 'poNumber': 'SYNTHETIC-PO',
            'items': [{'description': 'Synthetic numbering line', 'quantity': 2,
                'unit': 'Pcs', 'uom': 'Pcs', 'unitPrice': 100}]}
        if bad_link:
            if kind == 'bill':
                body['clientId'] = 2147483647
            else:
                body['items'][0]['itemTypeId'] = 2147483647
        path = '/api/' + routes[kind] + (f'/company/{co}' if kind in ('quote', 'challan') else '/standalone' if kind == 'bill' else '')
        status, result = call('POST', path, body, seed, base)
        if status in (200, 201):
            records.append((kind, result['id'], result[number_fields[kind]]))
        return status, result

    try:
        for suffix in ('A', 'B'):
            status, co = call('POST', '/api/companies', {'name': 'Numbering audit ' + suffix + ' ' + uuid.uuid4().hex[:8],
                'startingInvoiceNumber': 499, 'startingSalesQuoteNumber': 499, 'startingChallanNumber': 499,
                'startingPurchaseBillNumber': 499, 'startingGoodsReceiptNumber': 499,
                'ntn': '9999999', 'fbrSellerRegistrationNo': '9999999',
                'fbrProvinceCode': 8, 'fbrBusinessActivity': 'Manufacturer',
                'fbrSector': 'All Other Sectors', 'fbrEnvironment': 'Sandbox',
                'fbrToken': 'test-token-not-used-for-real-pral-calls'}, seed)
            assert status in (200, 201), (status, co)
            companies.append(co['id'])
            status, client = call('POST', '/api/clients', {'companyId': co['id'], 'name': 'Synthetic buyer',
                'ntn': '8888888', 'registrationType': 'Registered', 'fbrProvinceCode': 8}, seed)
            assert status in (200, 201), (status, client)
            status, supplier = call('POST', '/api/suppliers', {'companyId': co['id'], 'name': 'Synthetic supplier'}, seed)
            assert status in (200, 201), (status, supplier)
            co['fixture'] = (co['id'], client['id'], supplier['id'])
            if suffix == 'A':
                a = co['fixture']
            else:
                b = co['fixture']

        for kind, field in number_fields.items():
            preview = f'/api/invoices/company/{a[0]}/next-number' if kind == 'bill' else f'/api/companies/{a[0]}/document-numbers/{kind}'
            separator = '?'
            status, info = call('GET', preview, token=seed)
            check(kind + ' starts at company 499', status == 200 and info['nextNumber'] == 499, info)
            check(kind + ' anonymous preview refused', call('GET', preview)[0] == 401)
            for custom, expected in ((None, 499), (501, 501), (None, 500), (None, 502), (400, 400), (None, 503), (700, 700), (None, 504)):
                status, row = create(kind, a, custom)
                check(f'{kind} custom={custom} yields {expected}', status in (200, 201) and row[field] == expected, (status, row))
            status, info = call('GET', preview + separator + 'check=500', token=seed)
            check(kind + ' preview detects duplicate', status == 200 and info['checkedAvailable'] is False, info)
            status, row = create(kind, a, 500)
            check(kind + ' duplicate refused on save', status == 400, (status, row))
            status, row = create(kind, b, 500)
            check(kind + ' same number allowed in another company', status in (200, 201) and row[field] == 500, (status, row))
            for invalid in (0, -1, 1.5, 2147483648):
                status, row = create(kind, a, invalid)
                check(f'{kind} invalid {invalid} refused', status == 400, (status, row))
            before = call('GET', preview, token=seed)[1]['nextNumber']
            status, row = create(kind, a, 850, bad_link=True)
            check(kind + ' invalid reference rolls back save', status == (404 if kind == 'bill' else 400), (status, row))
            after = call('GET', preview, token=seed)[1]['nextNumber']
            check(kind + ' failed custom save does not advance counter', before == after, (before, after))

            # Duplicate custom saves across two processes: one winner, one clear refusal.
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                pair = list(pool.map(lambda base: create(kind, a, 950, base), [args.base, args.peer or args.base]))
                check(kind + ' concurrent custom has one winner', sorted(s for s, _ in pair) in ([200, 400], [201, 400]), pair)
                rows = list(pool.map(lambda index: create(kind, a, base=(args.peer if index % 2 and args.peer else args.base)), range(6)))
            successes = [row[field] for status, row in rows if status in (200, 201)]
            check(kind + ' concurrent auto saves all succeed', len(successes) == 6, rows)
            check(kind + ' concurrent auto numbers are unique and contiguous', sorted(successes) == list(range(505, 511)), successes)
            status, info = call('GET', preview, token=seed)
            check(kind + ' next after concurrency is 511', status == 200 and info['nextNumber'] == 511, info)

        # Keep the intentional Duplicate Challan contract separate from native creates.
        source = next(r for r in records if r[0] == 'challan' and r[2] == 510)
        status, clone = call('POST', f'/api/deliverychallans/{source[1]}/duplicate', {}, seed)
        check('explicit Duplicate Challan preserves its number', status in (200, 201) and clone['challanNumber'] == 510, (status, clone))
        if status in (200, 201):
            records.append(('challan', clone['id'], clone['challanNumber']))
        check('normal custom challan cannot reuse duplicate number', create('challan', a, 510)[0] == 400)
        check('challan sandbox range remains reserved', create('challan', a, 900000)[0] == 400)
        for requested, expected in ((513, 513), (None, 511), (None, 512), (None, 514)):
            status, challan = create('challan', a)
            assert status in (200, 201), (status, challan)
            body = {'companyId': a[0], 'clientId': a[1], 'date': '2026-10-01',
                'gstRate': 18, 'invoiceNumber': requested, 'challanIds': [challan['id']],
                'items': [{'deliveryItemId': line['id'], 'unitPrice': 100} for line in challan['items']]}
            status, bill = call('POST', '/api/invoices', body, seed)
            check(f'from-challan custom={requested} shares cursor and yields {expected}',
                status in (200, 201) and bill['invoiceNumber'] == expected, (status, bill))
            if status in (200, 201):
                records.append(('bill', bill['id'], bill['invoiceNumber']))
    finally:
        for kind, record_id, number in sorted(records, key=lambda r: r[2], reverse=True):
            call('DELETE', f'/api/{routes[kind]}/{record_id}', token=seed)
        for company in companies:
            call('DELETE', f'/api/companies/{company}', token=seed)
    print(f'{sum(checks)}/{len(checks)} checks passed; {len(checks)-sum(checks)} failed', flush=True)
    return 0 if all(checks) else 1


if __name__ == '__main__':
    sys.exit(main())

