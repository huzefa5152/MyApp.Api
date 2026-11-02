"""Customer-facing supplier payment and draft FBR preview checks against local UI/API.
Creates disposable fixtures and removes only those fixtures. No FBR filing is sent.
"""
import argparse
import json
import os
import re
from datetime import date, timedelta
from playwright.sync_api import sync_playwright, expect
from test_basic_flows import setup, http


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://localhost:5134')
    ap.add_argument('--ui', default='http://localhost:5173')
    args = ap.parse_args()
    token, co, client = setup(args.base, 'admin', 'admin123')
    cid = co['id']
    other_company = None

    def call(method, path, body=None, expected=(200, 201, 204)):
        status, data = http(method, path, args.base, token=token, body=body)
        assert status in expected, (path, status, data)
        return data

    def supplier_ledger(sid):
        return call('GET', f'/api/commercial-costs/suppliers/{cid}/{sid}')

    def balances(sid, net, paid, due):
        d = supplier_ledger(sid)
        assert round(d['netBalance'], 2) == net, d
        assert round(d['cashPaid'], 2) == paid, d
        assert round(sum(p['outstanding'] for p in d['purchases']), 2) == due, d
        return d

    try:
        other_company = call('POST', '/api/companies', {'name': f'Sample ledger switch {cid}', 'startingInvoiceNumber': 1, 'startingChallanNumber': 1, 'fbrSellerRegistrationNo': '9999999'})
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for width in [375, 768, 1280]:
                supplier = call('POST', '/api/suppliers', {'companyId': cid, 'name': f'Sample Ledger Supplier {width}'})
                sid = supplier['id']
                purchases = []
                for n, cost in enumerate([100, 200]):
                    bill = call('POST', '/api/invoices/standalone', {'companyId': cid, 'clientId': client['id'], 'date': date.today().isoformat(), 'gstRate': 0,
                        'items': [{'description': f'Sample ledger line {width}-{n}', 'quantity': 1, 'uom': 'Pcs', 'unitPrice': cost + 50, 'actualUnitCost': cost, 'supplierId': sid}]})
                    d = call('GET', f'/api/commercial-costs/bill/{bill["id"]}')
                    ids = call('POST', f'/api/commercial-costs/bill/{bill["id"]}/purchases', {'version': d['version'], 'date': date.today().isoformat(), 'itemIds': [d['items'][0]['id']],
                        'suppliers': [{'supplierId': sid, 'supplierBillNumber': f'SAMPLE-REF-{width}-{n}', 'gstRate': 0}]})
                    purchases.append(call('GET', f'/api/purchasebills/{ids[0]}'))
                p1, p2 = purchases
                page = browser.new_page(viewport={'width': width, 'height': 900})
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.add_init_script('localStorage.setItem("token",'+json.dumps(token)+');localStorage.setItem("selectedCompanyId",'+json.dumps(str(cid))+');')

                def proxy(route):
                    route.fulfill(response=route.fetch(url=route.request.url.replace(args.ui, args.base)))
                if args.ui != args.base:
                    page.route(args.ui + '/api/**', proxy)
                page.goto(args.ui + '/supplier-payables')
                total_metric = page.locator('.supplier-metric').filter(has=page.get_by_text('Total payable', exact=True)).locator('strong')
                total_metric.wait_for()
                collective = total_metric.inner_text()
                page.get_by_label('Find supplier', exact=True).fill('No matching sample supplier')
                expect(page.get_by_text('No suppliers match your search.', exact=True)).to_be_visible()
                expect(total_metric).to_have_text(collective)
                page.get_by_label('Find supplier', exact=True).fill(supplier['name'])
                page.get_by_role('button', name='Open ledger').filter(visible=True).first.click()
                page.get_by_role('heading', name='Bill-wise outstanding').wait_for()

                def metric(label, amount):
                    target = page.locator('.supplier-metric').filter(has=page.get_by_text(label, exact=True))
                    expect(target.locator('strong')).to_have_text(f'Rs. {amount:,.2f}')

                def refresh():
                    page.get_by_role('button', name='Refresh', exact=True).click()
                    page.get_by_role('heading', name='Bill-wise outstanding').wait_for()

                def save(label='Save Payment'):
                    page.get_by_role('button', name=label, exact=True).click()
                    page.get_by_text('Payment saved.', exact=True).wait_for()
                    expect(page.locator('.payment-dialog')).to_have_count(0)
                    page.get_by_role('heading', name='Bill-wise outstanding').wait_for()

                metric('Payable to supplier', 300)
                metric('Total paid to supplier', 0)
                page.get_by_role('button', name=re.compile('^Customer bill #')).filter(visible=True).first.click()
                page.get_by_label('Actual cost per unit for line 1').wait_for()
                page.get_by_label('Close costs').click()
                page.get_by_role('heading', name='Bill-wise outstanding').wait_for()
                page.locator('.supplier-row-actions details').filter(visible=True).first.locator('summary').click()
                page.get_by_role('button', name='View purchase', exact=True).filter(visible=True).first.click()
                page.get_by_role('heading', name='View Purchase Bill', exact=True).wait_for()
                page.get_by_role('button', name='Close', exact=True).filter(visible=True).last.click()
                page.get_by_role('button', name='View transactions', exact=True).filter(visible=True).first.click()
                page.get_by_role('heading', name=f'Transactions for Purchase #{p1["purchaseBillNumber"]}').wait_for()
                page.get_by_role('button', name='Show complete ledger', exact=True).click()

                page.get_by_role('button', name='Pay purchase', exact=True).filter(visible=True).first.click()
                field = page.get_by_label(f'Paid for bill #{p1["purchaseBillNumber"]}', exact=True)
                field.fill('50')
                save()
                balances(sid, 250, 50, 250)
                metric('Payable to supplier', 250)
                metric('Total paid to supplier', 50)
                paid = next(r for r in supplier_ledger(sid)['rows'] if r['kind'] == 'Payment')
                page.get_by_role('button', name=paid['reference'], exact=True).filter(visible=True).first.click()
                detail = page.get_by_role('dialog', name='Supplier payment details')
                expect(detail.get_by_role('button', name=f'Purchase #{p1["purchaseBillNumber"]}', exact=True)).to_be_visible()
                expect(detail).to_contain_text(f'SAMPLE-REF-{width}-0')
                detail.get_by_role('button', name='Edit payment', exact=True).click()
                page.get_by_label(f'Paid for bill #{p1["purchaseBillNumber"]}', exact=True).fill('70')
                save('Save Changes')
                balances(sid, 230, 70, 230)
                metric('Payable to supplier', 230)
                page.get_by_role('button', name='Record payment / advance', exact=True).click()
                page.get_by_label(f'Paid for bill #{p1["purchaseBillNumber"]}', exact=True).fill('30')
                page.get_by_label(f'Paid for bill #{p2["purchaseBillNumber"]}', exact=True).fill('100')
                save()
                balances(sid, 100, 200, 100)
                metric('Total paid to supplier', 200)
                multi = [r for r in supplier_ledger(sid)['rows'] if r['kind'] == 'Payment'][-1]
                page.get_by_label('Settlement status', exact=True).select_option('paid')
                expect(page.get_by_role('button', name='Pay purchase', exact=True).filter(visible=True)).to_have_count(0)
                page.get_by_label('Settlement status', exact=True).select_option('partial')
                expect(page.get_by_role('button', name='Pay purchase', exact=True).filter(visible=True)).to_have_count(1)
                page.get_by_label('Settlement status', exact=True).select_option('')
                page.get_by_role('button', name='Record payment / advance', exact=True).click()
                page.get_by_role('button', name='Advance / on account', exact=True).click()
                page.get_by_label('Advance amount', exact=True).fill('20')
                save()
                balances(sid, 80, 220, 100)
                metric('Payable to supplier', 80)
                metric('Purchase bills outstanding', 100)
                page.get_by_text('How the payable balance is calculated', exact=True).click()
                expect(page.locator('.supplier-reconciliation')).to_contain_text('Rs. -20.00')
                page.evaluate('window.scrollTo(0,0)')
                page.screenshot(path=os.path.join(os.environ.get('TEMP', '.'), f'trader-ledger-payment-{width}.png'), full_page=True)
                page.get_by_role('button', name='Pay purchase', exact=True).filter(visible=True).first.click()
                field = page.get_by_label(f'Paid for bill #{p2["purchaseBillNumber"]}', exact=True)
                field.fill('101')
                save_button = page.get_by_role('button', name='Save Payment', exact=True)
                if save_button.is_enabled():
                    save_button.click()
                    expect(page.locator('.payment-dialog')).to_be_visible()
                assert len([r for r in supplier_ledger(sid)['rows'] if r['kind'] == 'Payment']) == 3
                field.fill('100')
                save()
                balances(sid, -20, 320, 0)
                metric('Supplier credit balance', 20)
                call('POST', f'/api/payments/receipts/company/{cid}', {'date': date.today().isoformat(), 'contactType': 'Supplier', 'contactId': sid,
                    'method': 'Cash', 'allocations': [{'kind': 'OnAccount', 'amount': 20}]})
                refresh()
                balances(sid, 0, 300, 0)
                refund = next(r for r in supplier_ledger(sid)['rows'] if r['kind'] == 'Supplier refund')
                page.get_by_role('button', name=refund['reference'], exact=True).filter(visible=True).first.click()
                expect(page.get_by_role('dialog', name='Supplier payment details')).to_contain_text('Supplier advance / on account')
                page.get_by_label('Close payment details').click()
                call('DELETE', f'/api/payments/payments/{multi["id"]}')
                refresh()
                balances(sid, 130, 170, 130)
                metric('Payable to supplier', 130)
                metric('Total paid to supplier', 170)
                page.get_by_label('Balance as of', exact=True).fill((date.today() - timedelta(days=1)).isoformat())
                metric('Payable to supplier', 0)
                metric('Total paid to supplier', 0)
                page.get_by_role('button', name='Reset dates', exact=True).click()
                metric('Payable to supplier', 130)

                page.get_by_label('Find bill', exact=True).fill(f'SAMPLE-REF-{width}-1')
                expect(page.get_by_text(re.compile('Showing 1 of 2 purchases'))).to_be_visible()
                page.get_by_label('Find bill', exact=True).fill('')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.get_by_label('Company', exact=True).select_option(str(other_company['id']))
                expect(page.get_by_text('No suppliers yet. Add a supplier to start recording purchases and payments.', exact=True)).to_be_visible()
                expect(page.get_by_role('heading', name='Bill-wise outstanding', exact=True)).to_have_count(0)
                expect(page.locator('.supplier-metric').filter(has=page.get_by_text('Total payable', exact=True)).locator('strong')).to_have_text('Rs. 0.00')
                page.get_by_label('Company', exact=True).select_option(str(cid))
                page.get_by_label('Find supplier', exact=True).wait_for()
                # Draft preview stays available in both invoice layouts; no filing action is called.
                page.goto(args.ui + '/invoices')
                for mode in ['Cards', 'Table']:
                    page.get_by_role('tab', name=mode, exact=True).click()
                    more = page.get_by_role('button', name=re.compile('^More actions')).first
                    more.scroll_into_view_if_needed()
                    page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                    more.click()
                    expect(page.get_by_role('menuitem', name=re.compile('^Validate|^Submit'))).to_have_count(0)
                    page.get_by_role('menuitem', name=re.compile('View FBR')).first.click()
                    page.get_by_text('Draft preview', exact=False).wait_for()
                    preview = page.locator('[data-admin-dialog]').filter(has=page.get_by_role('heading', name='FBR Submission Preview'))
                    expect(preview.locator('tbody tr').first.locator('td').nth(2)).to_have_text('—')
                    preview.get_by_role('button', name='Close', exact=True).first.click()
                assert not errors, errors
                print(f'PASS {width}px: partial payment, allocation detail, edit, multiple bills, advance, overpayment refusal, full settlement, refund, removal reflow, bill reference search; draft FBR preview and filing actions hidden', flush=True)
                page.close()
            browser.close()
    finally:
        if other_company:
            call('DELETE', f'/api/companies/{other_company["id"]}')
        call('DELETE', f'/api/companies/{cid}')


if __name__ == '__main__':
    main()
