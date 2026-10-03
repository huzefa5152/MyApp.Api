"""Exercise the built Trader login UI with simulated APIs; no production writes."""
import base64
import argparse
import json
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

dist = Path(__file__).resolve().parents[1] / 'myapp-frontend' / 'dist'
cases = ('fresh', 'existing', 'return-to', 'switch-user', 'expired', 'wrong-password', 'unsafe-return', 'failed-return')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', help='Optional deployed frontend; all API requests are simulated.')
parser.add_argument('--width', type=int, choices=(375, 768, 1280), action='append')
parser.add_argument('--case', choices=cases, action='append')
args = parser.parse_args()


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        self.path = self.path.removeprefix('/admin') or '/'
        if not (dist / self.path.split('?')[0].lstrip('/')).is_file():
            self.path = '/index.html'
        super().do_GET()

    def log_message(self, *args):
        pass


def token(sid, user=1):
    claims = {'sub': str(user), 'stamp': 'test', 'sid': sid, 'jti': sid,
              'exp': int(time.time()) + 86400}
    return 'e30.' + base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=') + '.test'


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(dist)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = (args.base or f'http://127.0.0.1:{server.server_port}').rstrip('/')
checks = 0
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        for width in args.width or (375, 768, 1280):
            for case in args.case or cases:
                context = browser.new_context(viewport={'width': width, 'height': 900})
                page = context.new_page()
                saved = case in ('existing', 'return-to', 'switch-user', 'expired', 'unsafe-return')
                user = 2 if case == 'switch-user' else 1
                old_token = token('old')
                new_token = token('new', user)
                calls = []

                def api(route):
                    path = route.request.url.split('/api/')[-1]
                    calls.append(path)
                    status = 200
                    if path == 'auth/login':
                        status = 401 if case in ('wrong-password', 'failed-return') and route.request.post_data_json['password'] == 'test' else 200
                        data = {'message': 'Invalid username or password'} if status == 401 else {
                            'token': new_token, 'username': 'test', 'fullName': 'Test'}
                    elif path == 'auth/me':
                        old = route.request.headers.get('authorization') == 'Bearer ' + old_token
                        status = 401 if case == 'expired' and old else 200
                        data = {'id': 1 if old else user, 'username': 'test', 'fullName': 'Test', 'isSeedAdmin': False}
                    elif path == 'permissions/me':
                        data = {'permissions': ['dashboard.view', 'sales.challans.view'], 'isSeedAdmin': False}
                    else:
                        data = []
                    route.fulfill(status=status, content_type='application/json', body=json.dumps(data))

                page.route('**/api/**', api)
                page.goto(base + '/admin/login')
                if saved:
                    page.evaluate('(t) => {localStorage.setItem("token", t); localStorage.setItem("selectedCompanyId", "999");}', old_token)
                    page.reload()
                    page.wait_for_timeout(400)
                if case in ('return-to', 'failed-return'):
                    page.evaluate('sessionStorage.setItem("postLoginReturnTo", "/dashboard?from=expired")')
                if case == 'unsafe-return':
                    page.evaluate('sessionStorage.setItem("postLoginReturnTo", "//example.invalid")')
                page.evaluate('window.previousTenantMemory = "private old tenant data"')
                page.locator('input').nth(0).fill('test')
                page.locator('input[type=password]').fill('test')
                page.locator('button[type=submit]').click()
                if case in ('wrong-password', 'failed-return'):
                    page.get_by_text('Invalid username or password', exact=True).wait_for()
                    assert page.url.endswith('/admin/login')
                    assert page.evaluate('localStorage.getItem("token")') is None
                    if case == 'failed-return':
                        assert page.evaluate('sessionStorage.getItem("postLoginReturnTo")') == '/dashboard?from=expired'
                        page.locator('input[type=password]').fill('correct')
                        page.locator('button[type=submit]').click()
                        page.wait_for_url('**/admin/dashboard?from=expired')
                        assert page.evaluate('sessionStorage.getItem("postLoginReturnTo")') is None
                else:
                    page.wait_for_url('**/admin/dashboard*')
                    page.wait_for_timeout(400)
                    assert page.locator('input[type=password]').count() == 0
                    assert page.evaluate('localStorage.getItem("token")') == new_token
                    if case in ('existing', 'return-to', 'switch-user', 'unsafe-return'):
                        assert page.evaluate('window.previousTenantMemory') is None
                        assert page.evaluate('localStorage.getItem("selectedCompanyId")') is None
                    if case == 'return-to':
                        assert page.url.endswith('/admin/dashboard?from=expired')
                    assert 'auth/me' in calls
                checks += 1
                print(f'PASS {width}px {case}', flush=True)
                context.close()
        browser.close()
finally:
    server.shutdown()
print(f'{checks} browser login checks passed')
