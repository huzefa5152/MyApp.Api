"""Local-only identity, legacy session and concurrent lockout regressions."""
import argparse
import base64
import hashlib
import hmac
import json
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx
import pyodbc

p = argparse.ArgumentParser()
p.add_argument('--base', required=True)
p.add_argument('--peer', required=True)
p.add_argument('--test-jwt-key', required=True)
a = p.parse_args()
assert all(httpx.URL(url).host in ('localhost', '127.0.0.1', '::1') for url in (a.base, a.peer))
c = httpx.Client(trust_env=False, timeout=40)
db = pyodbc.connect(r'DRIVER={ODBC Driver 17 for SQL Server};SERVER=.\MSSQLSERVER02;DATABASE=MyApp_Trader_SecurityAudit_20261001;Trusted_Connection=yes;TrustServerCertificate=yes', autocommit=True)
users, checks = [], []
password = 'LocalSession#12345'

def req(method, path, token=None, body=None, peer=False):
    return c.request(method, (a.peer if peer else a.base) + path, json=body,
                     headers={'Authorization': 'Bearer ' + token} if token else {})

def ok(label, condition):
    assert condition, label
    checks.append(label)
    print('PASS ' + label, flush=True)

def login(name, pw=password, peer=False):
    r = req('POST', '/api/auth/login', body={'username': name, 'password': pw}, peer=peer)
    assert r.status_code == 200, ('login status', r.status_code)
    return r.json()['token']

def claims(token):
    return json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '=='))

def signed(payload):
    encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=').decode()
    data = encode(b'{"alg":"HS256","typ":"JWT"}') + '.' + encode(json.dumps(payload).encode())
    return data + '.' + encode(hmac.new(a.test_jwt_key.encode(), data.encode(), hashlib.sha256).digest())

admin = login('admin', 'admin123')
try:
    suffix = uuid.uuid4().hex[:10]
    for tag in ('first', 'second', 'lock'):
        r = req('POST', '/api/users', admin, {'username': f'session.audit.{tag}.{suffix}',
                'fullName': 'Local identity regression', 'password': password, 'role': 'User'})
        assert r.status_code in (200, 201), r.status_code
        users.append(r.json())
    first, second, locked = users
    one = login(first['username']); two = login(first['username']); other = login(second['username'])
    ok('authenticated identity responses are not cacheable', 'no-store' in req('GET', '/api/auth/me', one).headers.get('cache-control', ''))
    ok('session owner cannot be replaced by refresh body', req('POST', '/api/auth/refresh', one,
       {'userId': second['id'], 'sid': claims(other)['sid']}).json()['token'] != other)
    forged = claims(one); forged['sid'] = claims(other)['sid']
    ok('validly signed foreign device identity is denied', req('GET', '/api/auth/me', signed(forged)).status_code == 401)
    forged['sid'] = uuid.uuid4().hex
    ok('unknown device identity is denied', req('GET', '/api/auth/me', signed(forged)).status_code == 401)
    for field in ('sub', 'stamp'):
        forged = claims(one); forged.pop(field, None)
        ok('missing ' + field + ' fails closed', req('GET', '/api/auth/me', signed(forged)).status_code == 401)
    renamed = req('PUT', '/api/auth/profile', one, {'username': first['username'] + '.new'})
    ok('profile rename succeeds', renamed.status_code == 200)
    ok('seed can reuse vacated username for a different user', req('PUT', f"/api/users/{second['id']}", admin,
       {'username': first['username'], 'fullName': 'Other local user', 'role': 'User'}).status_code == 200)
    ok('old token still resolves permanent original user', req('GET', '/api/auth/me', one).json()['id'] == first['id'])
    ok('old token edits only original profile', req('PUT', '/api/auth/profile', one,
       {'fullName': 'Updated original local user'}).status_code == 200 and
       req('GET', '/api/auth/me', other).json()['fullName'] == 'Other local user')
    ok('trimmed duplicate username is refused without server error', req('PUT', '/api/auth/profile', one,
       {'username': '  ' + first['username'] + '  '}).status_code == 400)
    ok('renamed user cannot delete self using old token', req('DELETE', f"/api/users/{first['id']}", one).status_code in (400, 403))
    legacy = claims(one); legacy.pop('sid'); legacy['jti'] = uuid.uuid4().hex
    old = signed(legacy)
    ok('legacy session can independently sign out', req('POST', '/api/auth/logout', old).status_code == 200)
    ok('legacy logout revocation reaches other worker', req('GET', '/api/auth/me', old, peer=True).status_code == 401)
    ok('legacy logout preserves separate current devices', all(req('GET', '/api/auth/me', t).status_code == 200 for t in (one, two, other)))
    legacy['jti'] = uuid.uuid4().hex; old = signed(legacy)
    with ThreadPoolExecutor(max_workers=8) as pool:
        refreshed = list(pool.map(lambda _: req('POST', '/api/auth/refresh', old), range(8)))
    ok('concurrent legacy upgrades all succeed', all(r.status_code == 200 for r in refreshed))
    tokens = [r.json()['token'] for r in refreshed]
    ok('legacy upgrades share stable device identity', {claims(t)['sid'] for t in tokens} == {'legacy:' + legacy['jti']})
    ok('legacy upgrade creates exactly one database session', db.cursor().execute('SELECT COUNT(*) FROM UserSessions WHERE Id=?', 'legacy:' + legacy['jti']).fetchone()[0] == 1)
    req('POST', '/api/auth/logout', tokens[0])
    ok('upgraded logout rejects original legacy token and renewed tokens', all(req('GET', '/api/auth/me', t, peer=True).status_code == 401 for t in (old, *tokens)))
    req('POST', '/api/auth/logout', one)
    ok('device logout propagates across workers', req('GET', '/api/auth/me', one, peer=True).status_code == 401)
    ok('other device survives cross-worker logout', req('GET', '/api/auth/me', two, peer=True).status_code == 200)
    with ThreadPoolExecutor(max_workers=5) as pool:
        failures = list(pool.map(lambda _: req('POST', '/api/auth/login', body={'username': locked['username'], 'password': 'WrongLocalPassword'}, peer=True), range(5)))
    state = db.cursor().execute('SELECT FailedLoginAttempts, CASE WHEN LockoutUntil>SYSUTCDATETIME() THEN 1 ELSE 0 END FROM Users WHERE Id=?', locked['id']).fetchone()
    ok('five simultaneous failures are counted and activate lockout', all(r.status_code == 401 for r in failures) and tuple(state) == (5, 1))
    ok('correct password cannot bypass activated lockout', req('POST', '/api/auth/login', body={'username': locked['username'], 'password': password}, peer=True).status_code == 401)
    ok('different user stays authenticated during lockout', req('GET', '/api/auth/me', other, peer=True).status_code == 200)
    db.cursor().execute('UPDATE Users SET LockoutUntil=DATEADD(hour,-1,SYSUTCDATETIME()) WHERE Id=?', locked['id'])
    req('POST', '/api/auth/login', body={'username': locked['username'], 'password': 'WrongLocalPassword'}, peer=True)
    state = db.cursor().execute('SELECT FailedLoginAttempts, LockoutUntil FROM Users WHERE Id=?', locked['id']).fetchone()
    ok('expired lock starts a new failure count', state[0] == 1 and state[1] is None)
    lock_token = login(locked['username'], peer=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        changes = list(pool.map(lambda index: req('PUT', '/api/auth/password', lock_token,
               {'currentPassword': password, 'newPassword': f'ChangedLocalSession#{index}2345'}), range(2)))
    ok('concurrent password changes accept only one winner', sorted(r.status_code for r in changes) == [200, 401])
    ok('password change invalidates previous session on both workers', all(req('GET', '/api/auth/me', lock_token, peer=peer).status_code == 401 for peer in (False, True)))
    ok('password reset of original account succeeds', req('PUT', f"/api/users/{first['id']}", admin,
       {'username': first['username'] + '.new', 'fullName': 'Local identity regression', 'role': 'User', 'password': 'ResetLocalSession#12345'}).status_code == 200)
    ok('administrator password reset invalidates remaining device', req('GET', '/api/auth/me', two, peer=True).status_code == 401)
    ok('unrelated account survives original account reset', req('GET', '/api/auth/me', other, peer=True).status_code == 200)
finally:
    for user in users:
        req('DELETE', f"/api/users/{user['id']}", admin)
    db.close(); c.close()
print(f'{len(checks)} local session isolation checks passed')
