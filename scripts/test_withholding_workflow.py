"""Local-only withholding defaults, bill modes and certificate regression checks."""
import argparse
from datetime import datetime
from urllib.parse import urlparse
from test_basic_flows import http


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://localhost:5134')
    parser.add_argument('--admin-user', default='admin')
    parser.add_argument('--admin-pw', default='admin123')
    args = parser.parse_args()
    if urlparse(args.base).hostname not in ('localhost', '127.0.0.1', '::1'):
        parser.error('This fixture suite may only run against a local server.')
    status, auth = http('POST', '/api/auth/login', args.base,
                        body={'username': args.admin_user, 'password': args.admin_pw})
    assert status == 200, 'Local admin login failed'
    def request(method, path, body=None):
        return http(method, path, args.base, token=auth['token'], body=body)
    checks = 0
    def check(label, condition):
        nonlocal checks
        assert condition, label
        checks += 1
        print('PASS', label, flush=True)
    suffix = datetime.now().strftime('%H%M%S%f')
    company_id = None
    try:
        status, company = request('POST', '/api/companies', {
            'name': '_test_wht_' + suffix, 'startingInvoiceNumber': 1,
            'startingChallanNumber': 1, 'fbrSellerRegistrationNo': '9999999',
            'fullAddress': 'Local test address', 'ntn': '9999999',
            'strn': '9999999999999', 'fbrEnvironment': 'sandbox',
            'fbrProvinceCode': 8, 'fbrBusinessActivity': 'Manufacturer',
            'fbrSector': 'All Other Sectors', 'fbrToken': 'local-fixture-not-a-real-token',
            'defaultWithholdingTaxRate': 5.5})
        check('company preference persists', status == 201 and company['defaultWithholdingTaxRate'] == 5.5)
        company_id = company['id']
        status, client = request('POST', '/api/clients', {
            'companyId': company_id, 'name': 'Local WHT buyer', 'ntn': '9999999',
            'address': 'Local test address', 'strn': '9999999999999', 'fbrProvinceCode': 8,
            'registrationType': 'Registered'})
        check('local buyer saves', status in (200, 201))
        status, item = request('POST', f'/api/itemtypes?companyId={company_id}', {
            'companyId': company_id, 'name': 'WHT item ' + suffix, 'hsCode': '8481.8090',
            'uom': 'Pcs', 'saleType': 'Goods at standard rate (default)', 'isFavorite': True})
        check('classified local item saves', status in (200, 201))
        date = datetime.now().strftime('%Y-%m-%dT00:00:00')
        for path in ('standalone', 'challan'):
            for label, tax, expected in (
                ('Rate', {'withholdingTaxRate': 5.5}, 64.90),
                ('Fixed', {'withholdingTaxRate': None, 'withholdingTaxAmount': 75}, 75),
                ('None', {'withholdingTaxRate': None, 'withholdingTaxAmount': None}, 0)):
                payload = {'companyId': company_id, 'clientId': client['id'], 'date': date,
                           'gstRate': 18, **tax}
                if path == 'standalone':
                    endpoint = '/api/invoices/standalone'
                    payload['items'] = [{'description': 'Local proof', 'quantity': 1,
                                         'uom': 'Pcs', 'unitPrice': 1000}]
                else:
                    status, challan = request('POST', f'/api/deliverychallans/company/{company_id}', {
                        'companyId': company_id, 'clientId': client['id'], 'deliveryDate': date,
                        'poNumber': 'LOCAL-PROOF', 'poDate': date,
                        'items': [{'description': 'Local proof', 'quantity': 1, 'unit': 'Pcs',
                                   'itemTypeId': item['id']}]})
                    check(label + ' challan saves', status in (200, 201))
                    endpoint = '/api/invoices'
                    payload['challanIds'] = [challan['id']]
                    payload['items'] = [{'deliveryItemId': challan['items'][0]['id'], 'unitPrice': 1000}]
                status, invoice = request('POST', endpoint, payload)
                if status not in (200, 201):
                    print('Local bill validation:', status, invoice, flush=True)
                check(path + ' ' + label + ' preserves gross/GST and computes collectible',
                      status in (200, 201) and invoice['grandTotal'] == 1180
                      and invoice['gstAmount'] == 180 and invoice['withholdingTaxAmount'] == expected
                      and invoice['amountPaid'] == 0 and invoice['balanceDue'] == 1180 - expected)
            for label, tax, expected in (
                ('Rate', {'withholdingTaxRate': 5.5}, 64.90),
                ('Fixed', {'withholdingTaxRate': None, 'withholdingTaxAmount': 75}, 75),
                ('None', {'withholdingTaxRate': None, 'withholdingTaxAmount': None}, 0)):
                status, invoice = request('PUT', f"/api/invoices/{invoice['id']}", {
                    'gstRate': 18, 'items': invoice['items'], **tax})
                check(path + ' edit can switch to ' + label,
                      status == 200 and invoice['grandTotal'] == 1180
                      and invoice['withholdingTaxAmount'] == expected
                      and invoice['balanceDue'] == 1180 - expected)
        status, receipts = request('GET', f'/api/withholdingtaxreceipts/company/{company_id}')
        check('certificate list starts empty', status == 200 and receipts == [])
        status, certificate = request('POST', f'/api/withholdingtaxreceipts/company/{company_id}', {
            'clientId': client['id'], 'date': date, 'amount': 64.9, 'description': 'Local customer certificate'})
        check('certificate records the customer deduction', status == 201 and certificate['amount'] == 64.9)
        status, after = request('GET', f"/api/invoices/{invoice['id']}")
        check('certificate does not count as cash received', status == 200 and after['amountPaid'] == 0
              and after['balanceDue'] == invoice['balanceDue'])
        status, data = request('GET', f"/api/withholdingtaxreceipts/{certificate['id']}/print")
        check('certificate print identifies the correct company and buyer', status == 200
              and data['companyBrandName'] == company['name'] and data['customerName'] == client['name'])
        check('certificate words preserve paisa', data['amountInWords'] == 'Sixty Four Rupees and Ninety Paisa Only')
        status, _ = request('POST', f'/api/withholdingtaxreceipts/company/{company_id}',
                            {'clientId': client['id'], 'amount': 0})
        check('zero deduction refused', status == 400)
        status, _ = request('DELETE', f"/api/withholdingtaxreceipts/{certificate['id']}")
        check('latest certificate may be removed', status == 204)
        print(f'{checks}/{checks} withholding checks passed', flush=True)
    finally:
        if company_id is not None:
            status, _ = request('DELETE', f'/api/companies/{company_id}')
            assert status == 204, 'Local fixture cleanup failed'


if __name__ == '__main__':
    main()
