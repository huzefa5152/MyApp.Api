"""Loopback tests for seed-only MCP catalog configuration."""
import argparse
from mcp_catalog_fixture import LocalCatalogFixture
ap=argparse.ArgumentParser();ap.add_argument('--base',required=True);args=ap.parse_args()
f=LocalCatalogFixture(args.base);checks=0
def check(name,ok):
    global checks
    assert ok,name
    checks+=1;print('PASS '+name,flush=True)
try:
    roles=f.require(*f.http('GET','/api/roles',f.admin))
    role=next(r['id'] for r in roles if r['isSystemRole'] and r['name']=='Complete Edition')
    for suffix,administrator in [('user',False),('administrator',True)]:
        uid,actor=f.user(f.admin,suffix,[role],[],administrator=administrator)
        profile=f.profile(f.admin,uid)
        check(suffix+' cannot read own catalog',f.http('GET',f'/api/mcp/catalog/{uid}',actor)[0]==404)
        check(suffix+' cannot read seed catalog',f.http('GET','/api/mcp/catalog/1',actor)[0]==404)
        check(suffix+' cannot change own catalog',f.http('PUT',f'/api/mcp/catalog/{uid}',actor,f.body(profile))[0]==404)
        check(suffix+' can read own connection status',f.http('GET','/api/mcp/me/status',actor)[0]==200)
        check('seed can configure '+suffix,f.http('PUT',f'/api/mcp/catalog/{uid}',f.admin,f.body(profile))[0]==200)
        check('seed catalog identifies '+suffix,profile['userId']==uid and bool(profile['username']))
    print(str(checks)+' seed-only catalog checks passed')
finally:f.cleanup()
