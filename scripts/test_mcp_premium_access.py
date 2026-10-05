"""Loopback-only proof that premium MCP grants are seed-only and stay company/role scoped."""
import argparse
from mcp_catalog_fixture import LocalCatalogFixture

p=argparse.ArgumentParser();p.add_argument('--base',default='http://localhost:5197');args=p.parse_args()
f=LocalCatalogFixture(args.base);checks=0

def check(label,passed):
    global checks
    assert passed,label
    checks+=1;print('PASS '+label,flush=True)

try:
    seed_me=f.require(*f.http('GET','/api/auth/me',f.admin))
    seed_settings=f.profile(f.admin,seed_me['id'])
    check('MCP defaults off for seed admin',not seed_settings['accessGranted'])
    check('disabled seed cannot create an agent token',f.http('POST','/api/mcp/me/tokens',f.admin,{'name':'Disabled seed','companyIds':[],'scopes':['read'],'expiresInDays':1})[0]==403)
    companies=f.require(*f.http('GET','/api/companies',f.admin));assert len(companies)>=2
    foreign_invoice = None
    for company in companies:
        page=f.require(*f.http('GET',f"/api/invoices/company/{company['id']}/paged?pageSize=1",f.admin))
        if page.get('items'):
            foreign=company['id'];foreign_invoice=page['items'][0]['id'];break
    assert foreign_invoice is not None,'Need a local invoice fixture'
    own=next(c['id'] for c in companies if c['id'] != foreign)
    roles=f.require(*f.http('GET','/api/roles',f.admin));system={r['name']:r['id'] for r in roles if r['isSystemRole']}
    aid,manager=f.user(f.admin,'manager',[system['Complete Edition'],system['Tenant Administrator']],[own],True)
    uid,worker=f.user(manager,'worker',[system['Sales Edition']],[own])
    check('disabled user cannot create an agent token',f.http('POST','/api/mcp/me/tokens',worker,{'name':'Blocked','companyIds':[own],'scopes':['read'],'expiresInDays':1})[0]==403)
    grants=['search_clients','search_invoices','get_invoice']
    profile=f.profile(worker,uid)
    check('user cannot self grant',f.http('PUT',f'/api/mcp/catalog/{uid}',worker,f.body(profile,accessGranted=True,grantedTools=grants,selectedTools=grants))[0]==403)
    f.save(f.admin,aid,accessGranted=True,grantedTools=grants,selectedTools=grants)
    check('enabled tenant manager cannot read another catalog',f.http('GET',f'/api/mcp/catalog/{uid}',manager)[0]==404)
    check('enabled tenant manager cannot grant another user',f.http('PUT',f'/api/mcp/catalog/{uid}',manager,f.body(profile,accessGranted=True,grantedTools=grants,selectedTools=grants))[0]==404)
    check('manager cannot assign MCP system role',f.http('PUT',f'/api/users/{uid}/roles',manager,{'roleIds':[system['Sales Edition'],system['MCP Access']]})[0] in (400,403))
    check('manager cannot create a role containing MCP access',f.http('POST','/api/roles',manager,{'name':'Local premium '+f.run,'permissionKeys':['mcp.access.use']})[0] in (400,403))
    granted=f.save(f.admin,uid,accessGranted=True,grantedTools=grants,selectedTools=grants)
    check('seed admin enables user',granted['accessGranted'] and granted['canManageGrants'])
    agent=f.token(worker,[own]);check('assigned company available',not f.call(agent,'search_clients',companyId=own)[0])
    check('unassigned company denied',f.call(agent,'search_clients',companyId=foreign)[0])
    listed=f.ok(agent,'list_companies')
    check('company list excludes other tenants',str(foreign) not in [str(c['id']) for c in (listed if isinstance(listed,list) else listed.get('companies',listed.get('items',[])))])
    check('foreign invoice id cannot be read through own company',f.call(agent,'get_invoice',companyId=own,invoiceId=foreign_invoice)[0])
    f.require(*f.http('PUT',f'/api/users/{uid}/roles',f.admin,{'roleIds':[]}))
    check('grant does not override lost ERP role',f.call(agent,'search_clients',companyId=own)[0])
    f.require(*f.http('PUT',f'/api/users/{uid}/roles',f.admin,{'roleIds':[system['Sales Edition']]}))
    check('restoring role restores allowed tool',not f.call(agent,'search_clients',companyId=own)[0])
    check('token cannot widen companies' ,f.http('POST','/api/mcp/me/tokens',worker,{'name':'Foreign','companyIds':[foreign],'scopes':['read'],'expiresInDays':1})[0] in (400,403))
    check('token cannot request all companies',f.http('POST','/api/mcp/me/tokens',worker,{'name':'All','allCompanies':True,'scopes':['read'],'expiresInDays':1})[0] in (400,403))
    f.require(*f.http('PUT',f'/api/usercompanies/user/{uid}',f.admin,{'companyIds':[]}))
    check('existing token loses removed assignment immediately',f.call(agent,'search_clients',companyId=own)[0])
    f.require(*f.http('PUT',f'/api/usercompanies/user/{uid}',f.admin,{'companyIds':[own]}))
    check('restored assignment works',not f.call(agent,'search_clients',companyId=own)[0])
    f.save(f.admin,uid,accessGranted=False,writesGranted=False)
    check('revoked MCP access blocks existing token',f.call(agent,'search_clients',companyId=own)[0])
    print(f'{checks} premium MCP checks passed')
finally:
    f.cleanup()
