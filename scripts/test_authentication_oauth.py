"""Local OAuth connection remains functional and scoped after auth hardening."""
import argparse
import base64
import hashlib
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from mcp_catalog_fixture import LocalCatalogFixture

parser = argparse.ArgumentParser()
parser.add_argument('--base', required=True)
fixture = LocalCatalogFixture(parser.parse_args().base)
companies = []
checks = 0

def check(label, condition):
    global checks
    assert condition, label
    checks += 1
    print('PASS ' + label, flush=True)

def exchange(body):
    req = urllib.request.Request(fixture.base + '/oauth/token', data=urllib.parse.urlencode(body).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())

try:
    for label in ('Own', 'Foreign'):
        company = fixture.require(*fixture.http('POST', '/api/companies', fixture.admin,
            {'name': 'Local OAuth ' + label + fixture.run}), accepted=(200, 201))
        companies.append(company['id'])
    own, foreign = companies
    role = next(role['id'] for role in fixture.require(*fixture.http('GET', '/api/roles', fixture.admin))
        if role['name'] == 'Complete Edition' and role['isSystemRole'])
    user_id, user = fixture.user(fixture.admin, 'auth', [role], [own])
    redirect = 'http://127.0.0.1:8976/callback'
    client = fixture.require(*fixture.http('POST', '/oauth/register', None,
        {'client_name': 'Local security verification', 'redirect_uris': [redirect]}), accepted=(201,))['client_id']
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    body = {'clientId': client, 'redirectUri': redirect, 'state': 'local-security',
        'codeChallenge': challenge, 'codeChallengeMethod': 'S256', 'companyIds': [own], 'scopes': ['read']}
    check('disabled MCP user cannot authorize OAuth', fixture.http('POST', '/api/oauth/authorize', user, body)[0] == 403)
    fixture.save(fixture.admin, user_id, accessGranted=True, grantedTools=['search_clients'], selectedTools=['search_clients'])
    info = fixture.require(*fixture.http('GET', '/api/oauth/authorize-info?' + urllib.parse.urlencode({
        'client_id': client, 'redirect_uri': redirect}), user))
    check('consent only lists assigned company', [company['id'] for company in info['companies']] == [own])
    check('foreign company consent refused', fixture.http('POST', '/api/oauth/authorize', user,
        {**body, 'companyIds': [foreign]})[0] == 400)
    approved = fixture.require(*fixture.http('POST', '/api/oauth/authorize', user, body))
    query = urllib.parse.parse_qs(urllib.parse.urlparse(approved['redirectUrl']).query)
    check('OAuth state preserved', query['state'] == ['local-security'])
    grant = {'grant_type': 'authorization_code', 'client_id': client, 'redirect_uri': redirect,
        'code': query['code'][0], 'code_verifier': verifier}
    check('incorrect PKCE refused', exchange({**grant, 'code_verifier': secrets.token_urlsafe(48)})[0] == 400)
    token = fixture.require(*exchange(grant))
    agent = token['access_token']
    check('OAuth token reads assigned company', not fixture.call(agent, 'search_clients', companyId=own)[0])
    check('OAuth token cannot read foreign company', fixture.call(agent, 'search_clients', companyId=foreign)[0])
    refreshed = fixture.require(*exchange({'grant_type': 'refresh_token', 'client_id': client,
        'refresh_token': token['refresh_token']}))
    check('refresh rotates token', refreshed['access_token'] != agent)
    check('old OAuth access token is revoked', fixture.call(agent, 'search_clients', companyId=own)[0])
    agent = refreshed['access_token']
    fixture.require(*fixture.http('PUT', f'/api/usercompanies/user/{user_id}', fixture.admin, {'companyIds': []}))
    check('company revocation immediately stops existing OAuth token', fixture.call(agent, 'search_clients', companyId=own)[0])
    check('authorization code replay refused', exchange(grant)[0] == 400)
finally:
    fixture.cleanup()
    for company_id in reversed(companies):
        fixture.http('DELETE', f'/api/companies/{company_id}', fixture.admin)
print(f'{checks} OAuth authentication checks passed')
