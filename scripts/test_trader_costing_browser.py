"""Exercise optional costs and six-supplier purchase confirmation through the local UI."""
import argparse
import json
import re
from datetime import date
from playwright.sync_api import sync_playwright, expect
from test_basic_flows import setup, http


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://localhost:5134')
    parser.add_argument('--ui', default='http://localhost:5173')
    args = parser.parse_args()
    token, company, client = setup(args.base, 'admin', 'admin123')
    cid = company['id']
    today = date.today().isoformat()

    def call(method, path, body=None):
        status, data = http(method, path, args.base, token=token, body=body)
        assert status in (200, 201, 204), (path, status, data)
        return data

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for width in (375, 768, 1280):
                suppliers = [call('POST', '/api/suppliers', {'companyId': cid, 'name': f'Sample costing supplier {width}-{n}'}) for n in range(6)]
                challan = call('POST', f'/api/deliverychallans/company/{cid}', {'clientId': client['id'], 'deliveryDate': today,
                    'items': [{'description': f'Sample costing item {width}-{n}', 'quantity': 2, 'unit': 'Pcs'} for n in range(6)]})
                page = browser.new_page(viewport={'width': width, 'height': 900})
                page.add_init_script('localStorage.setItem("token",'+json.dumps(token)+');localStorage.setItem("selectedCompanyId",'+json.dumps(str(cid))+');')
                if args.ui != args.base:
                    page.route(args.ui+'/api/**', lambda r: r.fulfill(response=r.fetch(url=r.request.url.replace(args.ui, args.base))))
                page.goto(args.ui+'/challans')
                page.get_by_label('Costing status', exact=True).select_option('not-costed')
                page.get_by_role('button', name='Edit costing: Costing not added, 0 of 6 lines', exact=True).first.click()
                dialog = page.get_by_role('dialog').filter(has=page.get_by_role('heading', name=f'Challan #{challan["challanNumber"]} · Costs & suppliers', exact=True))
                dialog.get_by_role('button', name='Preview supplier purchases', exact=True).click()
                expect(dialog.get_by_role('alert')).to_contain_text('No lines are ready yet')
                dialog.get_by_role('button', name='Apply supplier to all', exact=True).click()
                page.get_by_text(suppliers[0]['name'], exact=True).click()
                for n in range(6):
                    dialog.get_by_label(f'Actual cost per unit for line {n+1}', exact=True).fill(str(10+n))
                    if n:
                        dialog.locator('.challan-private-supplier').nth(n).get_by_role('button').first.click()
                        page.get_by_text(suppliers[n]['name'], exact=True).click()
                dialog.get_by_role('button', name='Save costs', exact=True).click()
                expect(dialog.get_by_role('status').filter(has_text='Private costs saved')).to_be_visible()
                dialog.get_by_role('button', name='Preview supplier purchases', exact=True).click()
                expect(dialog.locator('.supplier-review-row')).to_have_count(6)
                expect(dialog.locator('.purchase-review-summary')).to_contain_text('150.00')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                dialog.get_by_role('button', name='Create supplier purchases', exact=True).click()
                expect(dialog.get_by_role('status').filter(has_text='Supplier purchases created')).to_be_visible()
                dialog.get_by_label('Close costs').click()
                linked = call('POST', '/api/invoices', {'companyId': cid, 'clientId': client['id'], 'date': today, 'gstRate': 0,
                    'challanIds': [challan['id']], 'items': [{'deliveryItemId': i['id'], 'unitPrice': 30} for i in challan['items']]})
                costs = call('GET', f'/api/commercial-costs/bill/{linked["id"]}')
                assert costs['actualAmount'] == 150 and costs['profit'] == 210
                payables = call('GET', f'/api/commercial-costs/bill/{linked["id"]}/payables')
                assert len(payables) == 6 and sum(p['outstanding'] for p in payables) == 150
                standalone = call('POST', '/api/invoices/standalone', {'companyId': cid, 'clientId': client['id'], 'date': today, 'gstRate': 0,
                    'items': [{'description': f'Sample standalone {width}', 'quantity': 2, 'uom': 'Pcs', 'unitPrice': 100}]})
                page.goto(args.ui+'/bills')
                page.get_by_label('Costing status', exact=True).select_option('not-costed')
                page.get_by_role('button', name='Edit costing: Costing not added, 0 of 1 lines', exact=True).first.click()
                dialog = page.get_by_role('dialog').filter(has=page.get_by_role('heading', name=f'Bill #{standalone["invoiceNumber"]} · Costs & suppliers', exact=True))
                dialog.get_by_label('Actual cost per unit for line 1', exact=True).fill('40')
                dialog.get_by_role('button', name='Save costs', exact=True).click()
                expect(dialog.get_by_role('status').filter(has_text='Private costs saved')).to_be_visible()
                expect(dialog.locator('.commercial-metrics > div').filter(has_text='Commercial profit')).to_be_visible()
                expect(dialog.locator('.commercial-metrics')).to_contain_text('120.00')
                costs = call('GET', f'/api/commercial-costs/bill/{standalone["id"]}')
                assert costs['profit'] == 120 and costs['items'][0]['supplierId'] is None
                dialog.get_by_label('Close costs').click()
                page.goto(args.ui+'/purchase-bills')
                for mode in ('Cards', 'Table'):
                    page.get_by_role('tab', name=mode, exact=True).click()
                    page.get_by_text(re.compile('Local direct purchase')).filter(visible=True).first.wait_for()
                    expect(page.get_by_role('button', name='Edit', exact=True)).to_have_count(0)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                print(f'PASS {width}px: optional challan costs, bulk supplier, six-supplier review and creation, linked bill profit/payables, standalone profit without supplier, generated purchase edit hidden', flush=True)
                page.unroute_all(behavior='wait')
                page.close()
            browser.close()
    finally:
        call('DELETE', f'/api/companies/{cid}')


if __name__ == '__main__':
    main()
