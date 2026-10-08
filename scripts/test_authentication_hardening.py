"""Local-only authentication regressions; creates temporary users and cleans up.

Run with --base http://127.0.0.1:<port>. AUTH_TEST_JWT_KEY enables signed
malformed-token tests against an isolated backend using the same local key.
"""
import argparse
import base64
import concurrent.futures
import hashlib
import hmac
import http.client
import json
import os
import time
import uuid
from urllib.parse import urlparse

ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True)
args = ap.parse_args()
url = urlparse(args.base)
assert url.hostname in ('localhost', '127.0.0.1'), 'Run only against an isolated local application'
prefix = 'authcheck' + uuid.uuid4().hex[:10]
password = 'Local#Check2026'
created = []
checks = []
login_number = 0


def request(method, path, token=None, body=None, login_ip=None):
    connection = http.client.HTTPConnection(url.hostname, url.port, timeout=60,
        source_address=(login_ip, 0) if login_ip else None)
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    connection.request(method, path, json.dumps(body) if body is not None else None, headers)
    response = connection.getresponse()
    raw = response.read()
    status = response.status
    connection.close()
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, raw.decode(errors='replace')


def check(name, condition):
    checks.append((name, bool(condition)))
    print(('PASS ' if condition else 'FAIL ') + name, flush=True)


def sign_in(name, pwd):
    global login_number
    login_number += 1
    return request('POST', '/api/auth/login', body={'username': name, 'password': pwd},
        login_ip=f'127.0.2.{login_number}')


def login(name, pwd=password):
    status, data = sign_in(name, pwd)
    assert status == 200, f'Login failed: {status}'
    return data['token']


def create(name, token, pwd=password):
    status, user = request('POST', '/api/users', token,
        {'username': name, 'password': pwd, 'fullName': 'Security Test User', 'role': 'User'})
    assert status == 201, f'Create failed: {status} {user}'
    created.append(user['id'])
    return user


def claims(token):
    value = token.split('.')[1]
    return json.loads(base64.urlsafe_b64decode(value + '=' * (-len(value) % 4)))


try:
    seed_name = os.environ.get('AUTH_TEST_ADMIN_USER', 'admin')
    seed_pwd = os.environ.get('AUTH_TEST_ADMIN_PASSWORD', 'admin123')
    seed = login(seed_name, seed_pwd)
    status, me = request('GET', '/api/auth/me', seed)
    assert status == 200 and me['isSeedAdmin']
    seed_id = me['id']
    a = create(prefix + 'A', seed)
    b = create(prefix + 'B', seed)
    ta = login(a['username'])
    tb = login(b['username'])
    check('same password on distinct accounts does not confer seed privileges',
        request('GET', '/api/auth/me', ta)[1]['isSeedAdmin'] is False)
    check('user without a role cannot list users', request('GET', '/api/users', ta)[0] == 403)
    check('user without a role cannot create another user', request('POST', '/api/users', ta,
        {'username': prefix + 'Denied', 'password': password, 'fullName': 'Denied'})[0] == 403)
    check('user without a role cannot assign roles', request('PUT', f"/api/users/{a['id']}/roles", ta,
        {'roleIds': []})[0] == 403)
    check('user without a role cannot unlock users', request('POST', f"/api/users/{b['id']}/unlock", ta)[0] == 403)

    for name in (seed_name, b['username'], ' ' + b['username'] + ' '):
        status, data = request('POST', '/api/users', seed,
            {'username': name, 'password': password, 'fullName': 'Duplicate'})
        check('duplicate username blocked without identifying owner: ' + ('seed' if name == seed_name else 'user'),
            status == 409 and data.get('message') == 'This username is unavailable. Choose another username.')
    status, data = request('PUT', '/api/auth/profile', ta, {'username': seed_name})
    check('profile cannot claim seed username', status in (400, 409))

    status, data = request('PUT', '/api/auth/profile', ta, {'username': prefix + 'Renamed'})
    check('normal profile rename works', status == 200 and data['id'] == a['id'])
    reused = create(a['username'], seed)
    status, old_me = request('GET', '/api/auth/me', ta)
    check('old token stays bound to original user after username reuse', status == 200 and old_me['id'] == a['id'])
    status, changed = request('PUT', '/api/auth/profile', ta, {'fullName': 'Changed Original User'})
    check('old token cannot mint a token for the account reusing its name',
        status == 200 and changed['id'] == a['id'] and int(claims(changed['token'])['sub']) == a['id'])
    tr = login(reused['username'])
    check('reused-name account remains unchanged', request('GET', '/api/auth/me', tr)[1]['fullName'] == 'Security Test User')

    status, _ = request('PUT', '/api/auth/password', ta,
        {'currentPassword': password, 'newPassword': 'Local#Changed2026'})
    check('self password change works', status == 200)
    check('self password change immediately revokes previous token', request('GET', '/api/auth/me', ta)[0] == 401)
    ta = login(prefix + 'Renamed', 'Local#Changed2026')
    status, _ = request('PUT', f"/api/users/{a['id']}", seed, {'password': password})
    check('seed password reset works', status == 200)
    check('seed reset immediately revokes existing token', request('GET', '/api/auth/me', ta)[0] == 401)
    ta = login(prefix + 'Renamed')
    check('login after reset works', request('GET', '/api/auth/me', ta)[0] == 200)
    check('logout works', request('POST', '/api/auth/logout', ta)[0] == 200)
    check('logout revokes the current token', request('GET', '/api/auth/me', ta)[0] == 401)

    locked = create(prefix + 'Locked', seed)
    failures = [sign_in(locked['username'], 'Incorrect#123') for _ in range(10)]
    failures += [sign_in(prefix + 'Unknown', 'Incorrect#123'), sign_in(seed_name, 'Incorrect#123'),
        sign_in(locked['username'], password)]
    check('unknown, wrong, seed and locked logins have identical status and body',
        all(result == failures[0] for result in failures) and failures[0][0] == 401)
    check('failure body exposes no counters or account lock details', set(failures[0][1]) == {'message'})
    rows = request('GET', '/api/users', seed)[1]
    row = next(u for u in rows if u['id'] == locked['id'])
    check('seed management retains real ten-attempt lock information', row['failedLoginAttempts'] == 10 and bool(row['lockoutUntil']))
    check('seed can unlock before expiry', request('POST', f"/api/users/{locked['id']}/unlock", seed)[0] == 200)
    check('unlocked user can sign in with unchanged password', bool(login(locked['username'])))
    for _ in range(10):
        sign_in(seed_name, 'Incorrect#123')
    check('seed remains able to sign in after repeated wrong passwords', bool(login(seed_name, seed_pwd)))

    check('deleted user removal works', request('DELETE', f"/api/users/{b['id']}", seed)[0] == 200)
    created.remove(b['id'])
    check('deleted-user token is rejected immediately', request('GET', '/api/auth/me', tb)[0] == 401)
    create(b['username'], seed)
    check('deleted-user token cannot access a reused username', request('PUT', '/api/auth/profile', tb,
        {'fullName': 'Must Not Change'})[0] == 401)

    key = os.environ.get('AUTH_TEST_JWT_KEY')
    assert key, 'Set AUTH_TEST_JWT_KEY to the isolated backend signing key'
    original = claims(seed)
    def forged(payload):
        enc = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')
        signed = enc({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + enc(payload)
        return (signed + b'.' + base64.urlsafe_b64encode(hmac.new(key.encode(), signed, hashlib.sha256).digest()).rstrip(b'=')).decode()
    for label, modifications in [('missing stamp', {'stamp': None}), ('wrong stamp', {'stamp': 'invalid'}),
            ('missing subject', {'sub': None}), ('nonexistent subject', {'sub': '2147483647'})]:
        payload = dict(original)
        for field, value in modifications.items():
            if value is None:
                payload.pop(field, None)
            else:
                payload[field] = value
        check('signed token rejected: ' + label, request('GET', '/api/auth/me', forged(payload))[0] == 401)

    def race(_):
        return request('POST', '/api/users', seed,
            {'username': prefix + 'Race', 'password': password, 'fullName': 'Race'})
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        raced = list(pool.map(race, range(6)))
    created += [data['id'] for status, data in raced if status == 201]
    check('concurrent duplicate creation creates exactly one account without 500s',
        [status for status, _ in raced].count(201) == 1 and all(status in (201, 409) for status, _ in raced))
    check('duplicate races return no SQL or owner details', all(status == 201 or data.get('message') ==
        'This username is unavailable. Choose another username.' for status, data in raced))

    statuses = [request('POST', '/api/auth/login', body={'username': prefix + 'Unknown', 'password': password},
        login_ip='127.0.3.1')[0] for _ in range(11)]
    check('per-IP brute-force rate limit remains active', statuses == [401] * 10 + [429])
finally:
    if 'seed' in globals():
        for user_id in reversed(created):
            status, _ = request('DELETE', f'/api/users/{user_id}', seed)
            check('temporary user cleaned up', status == 200)

passed = sum(ok for _, ok in checks)
print(f'{passed}/{len(checks)} authentication checks passed')
raise SystemExit(0 if passed == len(checks) else 1)
