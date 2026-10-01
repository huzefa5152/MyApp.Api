"""Local-only private-role regression using synthetic users and companies."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import uuid
from urllib.parse import urlparse
import requests

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://127.0.0.1:5210')
ap.add_argument('--database-probes', action='store_true', help='Probe the named disposable local audit database only')
a = ap.parse_args()
assert urlparse(a.base).hostname in ('localhost', '127.0.0.1', '::1'), 'Local only'
checks = []
def call(method, path, token=None, body=None):
    r = requests.request(method, a.base + path, headers={'Authorization': 'Bearer ' + token} if token else {}, json=body, timeout=60)
    try: data = r.json()
    except ValueError: data = r.text
    return r.status_code, data

def check(label, good, detail=''):
    checks.append(good)
    print(('PASS ' if good else 'FAIL ') + label + ('' if good else ': ' + str(detail)), flush=True)

def login(name):
    code, data = call('POST', '/api/auth/login', body={'username': name, 'password': 'LocalRoles#12345'})
    assert code == 200, (code, data)
    return data['token']

code, data = call('POST', '/api/auth/login', body={'username': 'admin', 'password': 'admin123'})
assert code == 200, (code, data)
seed = data['token']
roles = call('GET', '/api/roles', seed)[1]
system = next(r['id'] for r in roles if r['name'] == 'Administrator' and r['isSystemRole'])
suffix = uuid.uuid4().hex[:8]
users, created_roles, companies = [], [], []
def user(token, label):
    name = 'private_' + label + '_' + suffix
    code, data = call('POST', '/api/users', token, {'username': name, 'fullName': 'Synthetic role ' + label, 'password': 'LocalRoles#12345', 'role': 'User'})
    assert code in (200, 201), (code, data)
    users.append(data['id'])
    return data['id'], name

def create(token, name, owner=None, keys=None):
    payload = {'name': name, 'permissionKeys': keys if keys is not None else ['bills.list.view']}
    if owner is not None: payload['tenantAdminUserId'] = owner
    code, data = call('POST', '/api/roles', token, payload)
    if code == 201: created_roles.append(data['id'])
    return code, data

try:
    aid, aname = user(seed, 'A')
    bid, bname = user(seed, 'B')
    cid, cname = user(seed, 'C')
    for uid in (aid, bid, cid):
        assert call('PUT', f'/api/users/{uid}/roles', seed, {'roleIds': [system]})[0] == 200
    at, bt, ct = login(aname), login(bname), login(cname)
    child, childname = user(at, 'A_child')
    assert call('PUT', f'/api/users/{child}/roles', seed, {'roleIds': [system]})[0] == 200
    childtoken = login(childname)
    name = 'Tax Consultant ' + suffix
    ca, ra = create(at, name)
    cb, rb = create(bt, name)
    check('same custom name in separate tenants', ca == cb == 201, (ca, cb))
    check('same tenant rejects trimmed duplicate', create(at, '  ' + name + '  ')[0] == 409)
    check('same tenant rejects case-only duplicate', create(at, name.lower())[0] == 409)
    check('descendant shares tenant namespace', create(childtoken, name)[0] == 409)
    check('forged destination tenant rejected', create(at, name + ' forged', bid)[0] == 403)
    check('seed creates specifically for tenant A', create(seed, name + ' seeded', aid)[0] == 201)
    seeded = created_roles[-1]
    check('tenant A can edit seed-created private role', call('PUT', f'/api/roles/{seeded}', at, {'description': 'Synthetic private edit'})[0] == 200)
    check('tenant B cannot read seed-created A role', call('GET', f'/api/roles/{seeded}', bt)[0] == 404)
    check('seed cannot select descendant as tenant owner', create(seed, name + ' wrong root', child)[0] == 400)
    for method, body in [('GET', None), ('PUT', {'name': 'forged'}), ('DELETE', None)]:
        check('sibling ' + method + ' role denied', call(method, f"/api/roles/{rb['id']}", at, body)[0] == 404)
    check('tenant list hides sibling role IDs', rb['id'] not in [r['id'] for r in call('GET', '/api/roles', at)[1]])
    check('seed sees both same-name private roles', {ra['id'], rb['id']} <= {r['id'] for r in call('GET', '/api/roles', seed)[1]})
    check('seed direct cross-tenant assignment denied', call('PUT', f'/api/users/{child}/roles', seed, {'roleIds': [rb['id']]})[0] == 400)
    check('tenant direct cross-tenant assignment denied', call('PUT', f'/api/users/{child}/roles', at, {'roleIds': [rb['id']]})[0] == 400)
    check('non-seed tenant inventory denied', call('GET', '/api/roles/tenants', at)[0] == 403)
    check('non-seed copying denied', call('POST', f"/api/roles/{ra['id']}/copy", at, {'tenantAdminUserIds': [bid]})[0] == 403)
    before = {r['id'] for r in call('GET', '/api/roles', seed)[1]}
    check('multi-copy conflict rejects whole request', call('POST', f"/api/roles/{ra['id']}/copy", seed, {'tenantAdminUserIds': [cid, bid]})[0] == 409)
    check('failed multi-copy writes no partial roles', before == {r['id'] for r in call('GET', '/api/roles', seed)[1]})
    copyname = name + ' copied'
    code, copies = call('POST', f"/api/roles/{ra['id']}/copy", seed, {'name': copyname, 'tenantAdminUserIds': [bid, cid, bid]})
    check('seed copies independently to multiple tenants', code == 200 and len(copies) == 2, (code, copies))
    created_roles.extend(r['id'] for r in copies)
    copyb = next(r for r in copies if r['tenantAdminUserId'] == bid)
    copyc = next(r for r in copies if r['tenantAdminUserId'] == cid)
    check('copy has no assignments', all(r['userCount'] == 0 for r in copies))
    check('destination admin can edit copy', call('PUT', f"/api/roles/{copyb['id']}", bt, {'permissionKeys': ['clients.manage.view']})[0] == 200)
    check('copy edit leaves source untouched', call('GET', f"/api/roles/{ra['id']}", seed)[1]['permissionKeys'] == ['bills.list.view'])
    check('copy edit leaves other destination untouched', call('GET', f"/api/roles/{copyc['id']}", ct)[1]['permissionKeys'] == ['bills.list.view'])
    check('source tenant cannot see destination copy', call('GET', f"/api/roles/{copyb['id']}", at)[0] == 404)
    check('own role can be assigned within tenant', call('PUT', f'/api/users/{child}/roles', at, {'roleIds': [ra['id']]})[0] == 200)
    check('assigned role permissions effective', 'bills.list.view' in call('GET', '/api/permissions/me', childtoken)[1].get('permissions', []), call('GET', '/api/permissions/me', childtoken)[1])
    if a.database_probes:
        import pyodbc
        db = pyodbc.connect(r'Driver={ODBC Driver 17 for SQL Server};Server=.\MSSQLSERVER02;Database=MyApp_Trader_SecurityAudit_20261001;Trusted_Connection=yes;TrustServerCertificate=yes;')
        assert call('PUT', f"/api/roles/{rb['id']}", bt, {'permissionKeys': ['clients.manage.view']})[0] == 200
        try:
            db.cursor().execute('INSERT INTO UserRoles(UserId,RoleId,AssignedAt) VALUES (?,?,SYSUTCDATETIME())', child, rb['id'])
            db.commit()
            check('corrupt foreign assignment grants no permissions', 'clients.manage.view' not in call('GET', '/api/permissions/me', childtoken)[1]['permissions'])
            check('corrupt foreign assignment hidden from tenant management', rb['id'] not in [r['id'] for r in call('GET', f'/api/users/{child}/roles', at)[1]['roles']])
        finally:
            db.cursor().execute('DELETE FROM UserRoles WHERE UserId=? AND RoleId=?', child, rb['id'])
            db.commit()
            db.close()
    check('own rename duplicate rejected', call('PUT', f'/api/roles/{seeded}', at, {'name': name})[0] == 409)
    check('system name reserved', create(at, 'Administrator')[0] == 409)
    race = name + ' race'
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: create(at, race), range(2)))
    check('concurrent same-tenant create returns one conflict', sorted(r[0] for r in results) == [201, 409], results)
    check('anonymous role copy denied', call('POST', f"/api/roles/{ra['id']}/copy", body={'tenantAdminUserIds': [bid]})[0] == 401)
    check('seed can delete synthetic tenant administrator', call('DELETE', f'/api/users/{aid}', seed)[0] == 200)
    check('reparented child loses former tenant private permissions immediately', 'bills.list.view' not in call('GET', '/api/permissions/me', childtoken)[1]['permissions'])

finally:
    for uid in reversed(users):
        call('PUT', f'/api/users/{uid}/roles', seed, {'roleIds': []})
        call('DELETE', f'/api/users/{uid}', seed)
    for rid in created_roles:
        check('cleanup private role ' + str(rid), call('DELETE', f'/api/roles/{rid}', seed)[0] == 200)
print(f'{sum(checks)}/{len(checks)} checks passed')
raise SystemExit(0 if all(checks) else 1)
