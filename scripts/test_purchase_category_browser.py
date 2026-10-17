"""Local browser proof for category-first purchases; disposable company only."""
import json
import os
from datetime import date
from playwright.sync_api import sync_playwright, expect
from test_basic_flows import setup, http


def main():
    base = 'http://localhost:5134'
    ui = 'http://localhost:5173'
    token, company, _ = setup(base, 'admin', 'admin123')
    cid = company['id']

    def call(method, path, body=None):
        status, data = http(method, path, base, token=token, body=body)
        assert status in (200, 201, 204), (path, status, data)
        return data

    try:
        supplier = call('POST', '/api/suppliers', {'companyId': cid, 'name': 'Sample purchase flow supplier'})
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for width in (375, 768, 1280):
                page = browser.new_page(viewport={'width': width, 'height': 900})
                page.add_init_script('localStorage.setItem("token",'+json.dumps(token)+');localStorage.setItem("selectedCompanyId",'+json.dumps(str(cid))+');')
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(ui+'/purchase-bills')
                for category, title, gst in [('LocalDirect', 'Local direct purchase', 0), ('Inventory', 'Inventory purchase', 18)]:
                    page.get_by_role('button', name='New Purchase Bill', exact=True).click()
                    dialog = page.locator('[data-admin-dialog]').filter(has=page.get_by_role('heading', name='New Purchase Bill', exact=True))
                    expect(dialog.get_by_label('Description for item 1')).to_have_count(0)
                    dialog.get_by_role('button', name='Continue', exact=True).click()
                    expect(dialog.get_by_role('alert')).to_contain_text('Choose a purchase category')
                    dialog.get_by_role('radio', name=title, exact=False).check()
                    expect(dialog.get_by_role('heading', name='New Purchase Bill', exact=True)).to_be_in_viewport()
                    if category == 'LocalDirect':
                        page.screenshot(path=os.path.join(os.environ['TEMP'], f'purchase-category-{width}.png'), full_page=True)
                    dialog.get_by_role('button', name='Continue', exact=True).click()
                    expect(dialog.get_by_label('GST rate', exact=True)).to_have_value(str(gst))
                    dialog.get_by_role('button', name='Create', exact=True).click()
                    expect(dialog.get_by_role('alert')).to_contain_text('Select a supplier')
                    dialog.get_by_role('button', name='Search supplier…', exact=True).click()
                    page.locator('span').filter(has_text=supplier['name']).last.click()
                    reference = f'SAMPLE-{width}-{category}'
                    dialog.get_by_label('Supplier Bill #', exact=True).fill(reference)
                    dialog.get_by_label('Description for item 1', exact=True).fill('Sample purchase workflow line')
                    dialog.get_by_label('Unit price for item 1', exact=True).fill('25')
                    dialog.get_by_label('Bill date', exact=True).fill('')
                    dialog.get_by_role('button', name='Create', exact=True).click()
                    expect(dialog.get_by_role('alert')).to_contain_text('Choose a valid bill date')
                    dialog.get_by_label('Bill date', exact=True).fill(date.today().isoformat())
                    dialog.get_by_label('GST rate', exact=True).fill('101')
                    dialog.get_by_role('button', name='Create', exact=True).click()
                    expect(dialog.get_by_role('alert')).to_contain_text('GST rate must be between 0 and 100')
                    dialog.get_by_label('GST rate', exact=True).fill(str(gst))
                    expect(dialog.get_by_role('heading', name='New Purchase Bill', exact=True)).to_be_in_viewport()
                    expect(dialog.get_by_role('button', name='Create', exact=True)).to_be_in_viewport()
                    if category == 'LocalDirect':
                        page.screenshot(path=os.path.join(os.environ['TEMP'], f'purchase-details-{width}.png'), full_page=True)
                    dialog.get_by_role('button', name='Create', exact=True).click()
                    expect(dialog).to_have_count(0)
                    purchases = call('GET', f'/api/purchasebills/company/{cid}/paged?pageSize=100')['items']
                    saved = next(p for p in purchases if p['supplierBillNumber'] == reference)
                    assert saved['purchaseCategory'] == category and saved['supplierId'] == supplier['id']
                    assert saved['grandTotal'] == (25 if gst == 0 else 29.5)
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                assert not errors, errors
                print(f'PASS {width}px: category gate, supplier/date/GST validation, local and inventory purchase creation and saved totals', flush=True)
                page.close()
            browser.close()
    finally:
        call('DELETE', f'/api/companies/{cid}')


if __name__ == '__main__':
    main()
