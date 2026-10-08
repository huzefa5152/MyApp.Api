"""Verify built login success, private failure messaging and responsive layouts."""
import base64
import json
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

dist = Path(__file__).resolve().parents[1] / 'myapp-frontend/dist'
message = 'Unable to sign in. Check your username and password, try again later, or contact your administrator.'

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        self.path = self.path.removeprefix('/admin') or '/'
        if self.path == '/runtime-env.js':
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.end_headers()
            self.wfile.write(b'window._env_={API_URL:"/api"};')
            return
        if not (dist / self.path.split('?')[0].lstrip('/')).is_file():
            self.path = '/index.html'
        super().do_GET()

    def log_message(self, *args):
        pass

payload = {'sub': '2', 'stamp': 'local-ui-check', 'sid': 'local-ui-check', 'jti': 'local-ui-check',
    'exp': int(time.time()) + 86400}
token = 'e30.' + base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=') + '.local'
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(dist)))
threading.Thread(target=server.serve_forever, daemon=True).start()
checks = 0
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='msedge', headless=True)
        for width in (375, 768, 1280):
            context = browser.new_context(viewport={'width': width, 'height': 900})
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            def api(route):
                path = route.request.url.split('/api/')[-1]
                authorized = route.request.headers.get('authorization') == 'Bearer ' + token
                status = 200
                if path == 'auth/login':
                    success = route.request.post_data_json['password'] == 'Correct#123'
                    status = 200 if success else 401
                    data = {'token': token, 'username': 'localuser', 'fullName': 'Local User'} if success else {'message': message}
                elif path == 'auth/me':
                    status = 200 if authorized else 401
                    data = {'id': 2, 'username': 'localuser', 'fullName': 'Local User', 'isSeedAdmin': False}
                elif path == 'permissions/me':
                    data = {'permissions': ['dashboard.view'], 'isSeedAdmin': False}
                else:
                    data = []
                route.fulfill(status=status, content_type='application/json', body=json.dumps(data))
            page.route('**/api/**', api)
            page.goto(f'http://127.0.0.1:{server.server_port}/admin/login')
            page.locator('input').first.fill('localuser')
            page.locator('input[type=password]').fill('Incorrect#123')
            page.locator('button[type=submit]').click()
            page.get_by_text(message, exact=True).wait_for()
            assert page.url.endswith('/admin/login')
            assert page.evaluate('localStorage.getItem("token")') is None
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            assert not errors, errors
            checks += 1
            print(f'PASS {width}px generic failure, no session, no horizontal overflow', flush=True)
            page.locator('input[type=password]').fill('Correct#123')
            page.locator('button[type=submit]').click()
            page.wait_for_url('**/admin/dashboard*')
            assert page.evaluate('localStorage.getItem("token")') == token
            assert not errors, errors
            checks += 1
            print(f'PASS {width}px successful sign-in reaches dashboard', flush=True)
            context.close()
        browser.close()
finally:
    server.shutdown()
print(f'{checks} responsive login checks passed')
