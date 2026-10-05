"""Loopback proof: seed-owned companies require explicit tenant assignment."""
from mcp_catalog_fixture import LocalCatalogFixture
f=LocalCatalogFixture('http://127.0.0.1:5198');company=None;checks=0
def check(label,ok):
    global checks
    assert ok,label
    checks+=1;print('PASS '+label,flush=True)
try:
    roles=f.require(*f.http('GET','/api/roles',f.admin))
    role=next(r['id'] for r in roles if r['name']=='Complete Edition' and r['isSystemRole'])
    uid,a=f.user(f.admin,'tenant_a',[role],[],administrator=True)
    _,b=f.user(f.admin,'tenant_b',[role],[],administrator=True)
    company=f.require(*f.http('POST','/api/companies',f.admin,{'name':'Local seed isolation '+f.run,'address':'Local test','ntn':'1234567','strn':'1234567890123'}),accepted=(200,201))['id']
    for label,token in [('first administrator',a),('other administrator',b)]:
        check(label+' cannot list seed company',company not in [c['id'] for c in f.require(*f.http('GET','/api/companies',token))])
        check(label+' cannot read seed company',f.http('GET',f'/api/companies/{company}',token)[0]==404)
    f.require(*f.http('PUT',f'/api/usercompanies/user/{uid}',f.admin,{'companyIds':[company]}))
    check('assigned administrator can read company',f.http('GET',f'/api/companies/{company}',a)[0]==200)
    check('unassigned administrator remains isolated',f.http('GET',f'/api/companies/{company}',b)[0]==404)
    f.require(*f.http('PUT',f'/api/usercompanies/user/{uid}',f.admin,{'companyIds':[]}))
    check('revocation immediately removes company access',f.http('GET',f'/api/companies/{company}',a)[0]==404)
    print(str(checks)+' seed company isolation checks passed')
finally:
    f.cleanup()
    if company is not None:f.require(*f.http('DELETE',f'/api/companies/{company}',f.admin),accepted=(200,204))
