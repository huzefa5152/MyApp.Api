"""Costing filters: complete company lists, paging and linked source corrections.
Creates only disposable companies. No FBR calls are made.
"""
import argparse
from datetime import date
from test_basic_flows import setup, http


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://localhost:5134')
    args = ap.parse_args()
    token, company, client = setup(args.base, 'admin', 'admin123')
    cid = company['id']
    count = 0

    def call(method, path, body=None, expected=(200, 201, 204)):
        status, data = http(method, path, args.base, token=token, body=body)
        assert status in expected, (path, status, data)
        return data

    def check(label, condition):
        nonlocal count
        assert condition, label
        count += 1
        print('PASS', label)

    try:
        challans = []
        for entered in range(3):
            lines = [{'description': f'Sample filter line {n}', 'quantity': 1, 'unit': 'Pcs',
                      'actualUnitCost': 0 if n < entered else None} for n in range(2)]
            challans.append(call('POST', f'/api/deliverychallans/company/{cid}', {
                'clientId': client['id'], 'poNumber': f'SAMPLE-FILTER-{entered}',
                'deliveryDate': date.today().isoformat(), 'items': lines}))
            call('POST', '/api/invoices/standalone', {'companyId': cid, 'clientId': client['id'],
                'date': date.today().isoformat(), 'gstRate': 0,
                'items': [{**line, 'uom': 'Pcs', 'unitPrice': 100} for line in lines]})
        linked = call('POST', '/api/invoices', {'companyId': cid, 'clientId': client['id'],
            'date': date.today().isoformat(), 'gstRate': 0, 'challanIds': [challans[2]['id']],
            'items': [{'deliveryItemId': i['id'], 'unitPrice': 100} for i in challans[2]['items']]})
        for module in ['deliverychallans', 'invoices']:
            path = f'/api/{module}/company/{cid}/paged'
            for status, costed in [('not-costed', 0), ('partial', 1), ('full', 2)]:
                expected = 2 if module == 'invoices' and status == 'full' else 1
                result = call('GET', path + f'?costingStatus={status}&pageSize=1')
                check(f'{module} {status} total is filtered before paging', result['totalCount'] == expected and len(result['items']) == 1)
                check(f'{module} {status} count includes explicit zero cost', all(d['costedLineCount'] == costed for d in result['items']))
                combined = call('GET', path + f'?costingStatus={status}&clientId={client["id"]}&search=Sample&pageSize=100')
                check(f'{module} costing combines with client and search', combined['totalCount'] == expected)
            call('GET', path + '?costingStatus=invalid', expected=(400,))
            check(f'{module} invalid filter refused', True)
        second = call('GET', f'/api/invoices/company/{cid}/paged?costingStatus=full&pageSize=1&page=2')
        check('second page retains full filtered total', second['totalCount'] == 2 and len(second['items']) == 1)
        costs = call('GET', f'/api/commercial-costs/challan/{challans[2]["id"]}')
        call('PATCH', f'/api/commercial-costs/challan/{challans[2]["id"]}', {'version': costs['version'],
            'items': [{'id': i['id'], 'actualUnitCost': None, 'supplierId': None} for i in costs['items']]})
        result = call('GET', f'/api/invoices/company/{cid}/paged?costingStatus=not-costed')
        check('source cost correction immediately changes linked bill filter', linked['id'] in [i['id'] for i in result['items']] and result['totalCount'] == 2)
    finally:
        call('DELETE', f'/api/companies/{cid}')
    print(f'{count}/{count} costing filter checks passed')


if __name__ == '__main__':
    main()
