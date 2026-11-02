"""Local browser proof of consultant interactions and 375/768/1280 layouts.
Use test_tax_filing_rows.py --keep --fixture <path> to create the fixtures first.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from test_tenant_leak_sweep import http

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://localhost:5194')
parser.add_argument('--ui', default='http://127.0.0.1:5195')
parser.add_argument('--fixture', required=True)
parser.add_argument('--screenshots')
args = parser.parse_args()
assert all(urlparse(url).hostname in ('localhost', '127.0.0.1', '::1') for url in [args.base, args.ui])
fixture = json.loads(Path(args.fixture).read_text())
status, login = http('POST', '/api/auth/login', args.base, body={'username': 'admin', 'password': 'admin123'})
assert status == 200
status, editor = http('GET', f"/api/invoices/{fixture['invoiceId']}/tax-filing", args.base, token=login['token'])
assert status == 200
items = editor['bill']['items']
setup_rows = [{'sourceLineIds': [items[0]['id']], 'itemTypeId': fixture['itemTypeIds'][0], 'quantity': items[0]['quantity'], 'valueExclTax': items[0]['lineTotal']},
              {'sourceLineIds': [i['id'] for i in items[1:]], 'itemTypeId': fixture['itemTypeIds'][1], 'quantity': sum(i['quantity'] for i in items[1:]), 'valueExclTax': sum(i['lineTotal'] for i in items[1:])}]
status, _ = http('PUT', f"/api/invoices/{fixture['invoiceId']}/tax-filing", args.base, token=login['token'], body={'version': editor['version'], 'rows': setup_rows})
assert status == 200
passed = 0
def check(ok, label):
    global passed
    assert ok, label
    passed += 1
    print('PASS', label, flush=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    def local_api(route):
        url = urlparse(route.request.url)
        response = route.fetch(url=args.base+url.path+('?' + url.query if url.query else ''))
        route.fulfill(response=response)
    page.route(args.ui+'/api/**', local_api)
    page.add_init_script('localStorage.setItem("token", '+json.dumps(login['token'])+'); localStorage.setItem("selectedCompanyId", '+json.dumps(str(fixture['companyId']))+');')
    page.goto(args.ui+'/invoices?search='+str(fixture['invoiceNumber']))
    card = page.locator('.card-grid > div').filter(has=page.get_by_role('heading', name=f"Invoice #{fixture['invoiceNumber']}", exact=True))
    adjust = card.locator('button[title="Review and adjust the current bill for FBR; commercial bill edits are on Bills"]')
    adjust.first.wait_for(timeout=30000)
    page.locator('input[placeholder*="Search"]').first.fill(str(fixture['invoiceNumber']))
    page.wait_for_timeout(700)
    adjust.first.click(timeout=30000)
    dialog = page.get_by_role('dialog', name='Tax filing rows', exact=False)
    dialog.wait_for()
    page.locator('.tf-row').first.wait_for()
    check(page.locator('.tf-row').count() == 2, 'consultant sees two saved filing groups')
    for width in [375, 768, 1280]:
        page.set_viewport_size({'width': width, 'height': 800})
        page.wait_for_timeout(500)
        check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'{width}px has no horizontal page scroll')
        check(dialog.evaluate('(el) => el.scrollWidth <= el.clientWidth'), f'{width}px dialog content fits')
        height = page.locator('.tf-footer button').bounding_box()['height']
        check(height >= 44, f'{width}px save button meets touch size (height {height})')
        check(all(e.bounding_box()['height'] >= 44 for e in page.locator('.tf-fields input').all()), f'{width}px quantity and amount inputs meet touch size')
        box = page.locator('.tf-fields').first.bounding_box()
        check(box['x'] >= 0 and box['x']+box['width'] <= width, f'{width}px row fields remain reachable')
        if args.screenshots:
            Path(args.screenshots).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(args.screenshots)/f'tax-filing-{width}.png'))
    # Combine both groups, classify and save a single exact row.
    page.locator('.tf-select input').nth(0).check()
    page.locator('.tf-select input').nth(1).check()
    page.get_by_role('button', name='Combine selected (2)', exact=True).click()
    check(page.locator('.tf-row').count() == 1, 'selecting two groups combines them into one')
    check(page.get_by_label('Row 1 amount excluding tax').input_value() == '30000', 'combined amount is exact')
    page.locator('.tf-fields').first.get_by_role('button').first.click()
    # The shared catalog picker exposes options as clickable product labels.
    page.get_by_text('[TEMP] Filing A ', exact=False).last.click()
    page.get_by_label('Row 1 filing quantity').fill('3')
    page.get_by_label('Row 1 amount excluding tax').fill('29999.99')
    check(page.get_by_role('button', name='Save filing rows & complete review').is_disabled(), 'one-paisa mismatch visibly blocks save')
    page.get_by_label('Row 1 amount excluding tax').fill('30000')
    page.get_by_role('button', name='Save filing rows & complete review').click()
    dialog.wait_for(state='hidden')
    status, saved = http('GET', f"/api/invoices/{fixture['invoiceId']}/tax-filing", args.base, token=login['token'])
    check(status == 200 and len(saved['rows']) == 1, 'browser save persists a single combined filing row')
    adjust.first.click()
    dialog.wait_for()
    page.get_by_role('button', name='Separate source lines').click()
    check(page.locator('.tf-row').count() == 3, 'consultant can separate a combined row back into three source lines')
    check(sum(float(e.input_value()) for e in page.locator('input[aria-label$="amount excluding tax"]').all()) == 30000, 'separating preserves the exact amount')
    page.get_by_role('button', name='Close', exact=True).click()
    page.get_by_role('button', name='Discard changes', exact=True).click()
    dialog.wait_for(state='hidden')
    check(True, 'closing dirty draft asks before discarding')
    page.unroute_all(behavior='wait')
    browser.close()
http('POST', '/api/auth/logout', args.base, token=login['token'], body={})
print(f'{passed} passed, 0 failed', flush=True)
