"""Loopback-only Customize OAuth and company-isolation regression proof."""
import argparse, base64, hashlib, json, secrets, urllib.parse, urllib.request, urllib.error
from mcp_catalog_fixture import LocalCatalogFixture

ap=argparse.ArgumentParser();ap.add_argument('--base',default='http://127.0.0.1:5198');args=ap.parse_args()
f=LocalCatalogFixture(args.base);checks=0

def check(label,ok):
    global checks
    assert ok,label
    checks+=1;print('PASS '+label,flush=True)

def form(body):
    request=urllib.request.Request(f.base+'/oauth/token',data=urllib.parse.urlencode(body).encode(),headers={'Content-Type':'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(request,timeout=30) as response:return response.status,json.loads(response.read())
    except urllib.error.HTTPError as error:return error.code,json.loads(error.read())

try:
    companies=f.require(*f.http('GET','/api/companies',f.admin));assert len(companies)>=2
    own,foreign=[c['id'] for c in companies[:2]]
    role=next(r['id'] for r in f.require(*f.http('GET','/api/roles',f.admin)) if r['name']=='Complete Edition' and r['isSystemRole'])
    uid,user=f.user(f.admin,'oauth',[role],[own])
    redirect='http://127.0.0.1:8976/callback'
    registered=f.require(*f.http('POST','/oauth/register',None,{'client_name':'Local Customize OAuth '+f.run,'redirect_uris':[redirect]}),accepted=(201,))
    client=registered['client_id'];verifier=secrets.token_urlsafe(48)
    challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    payload={'clientId':client,'redirectUri':redirect,'state':'local-state','codeChallenge':challenge,'codeChallengeMethod':'S256','companyIds':[own],'scopes':['read']}
    check('disabled user cannot approve OAuth',f.http('POST','/api/oauth/authorize',user,payload)[0]==403)
    tools=['search_clients','search_invoices','get_invoice','get_profit_and_loss','get_balance_sheet','get_cash_book','get_trial_balance','get_aged_payables','outstanding_ledger','get_challan']
    f.save(f.admin,uid,accessGranted=True,grantedTools=tools,selectedTools=tools)
    info=f.require(*f.http('GET','/api/oauth/authorize-info?'+urllib.parse.urlencode({'client_id':client,'redirect_uri':redirect}),user))
    check('consent lists assigned company only',[c['id'] for c in info['companies']]==[own])
    check('cannot approve a foreign company',f.http('POST','/api/oauth/authorize',user,{**payload,'companyIds':[foreign]})[0]==400)
    check('cannot approve all companies',f.http('POST','/api/oauth/authorize',user,{**payload,'allCompanies':True})[0]==400)
    approved=f.require(*f.http('POST','/api/oauth/authorize',user,payload));q=urllib.parse.parse_qs(urllib.parse.urlparse(approved['redirectUrl']).query)
    check('OAuth returns original state',q['state']==['local-state'])
    exchange={'grant_type':'authorization_code','client_id':client,'redirect_uri':redirect,'code':q['code'][0],'code_verifier':verifier}
    check('PKCE mismatch refused',form({**exchange,'code_verifier':secrets.token_urlsafe(48)})[0]==400)
    token=f.require(*form(exchange));agent=token['access_token']
    check('OAuth connection reads assigned company',not f.call(agent,'search_clients',companyId=own)[0])
    check('OAuth connection refuses foreign company',f.call(agent,'search_clients',companyId=foreign)[0])
    for tool in ['get_profit_and_loss','get_balance_sheet','get_cash_book','get_trial_balance','get_aged_payables']:
        check(tool+' executes with company scope',not f.call(agent,tool,companyId=own)[0])
    f.require(*f.http('PUT',f'/api/userdivisions/user/{uid}/company/{own}',f.admin,{'restrictToDivisions':True,'divisionIds':[]}))
    check('division restriction stops existing OAuth company operations',f.call(agent,'search_clients',companyId=own)[0])
    f.require(*f.http('PUT',f'/api/userdivisions/user/{uid}/company/{own}',f.admin,{'restrictToDivisions':False,'divisionIds':[]}))
    check('unrestricted assigned company operations resume',not f.call(agent,'search_clients',companyId=own)[0])
    refreshed=f.require(*form({'grant_type':'refresh_token','client_id':client,'refresh_token':token['refresh_token']}))
    check('refresh rotates access token',refreshed['access_token']!=agent)
    check('old access token stops working',f.call(agent,'search_clients',companyId=own)[0])
    agent=refreshed['access_token']
    f.require(*f.http('PUT',f'/api/usercompanies/user/{uid}',f.admin,{'companyIds':[]}))
    check('assignment revocation stops existing OAuth token',f.call(agent,'search_clients',companyId=own)[0])
    f.require(*f.http('PUT',f'/api/usercompanies/user/{uid}',f.admin,{'companyIds':[own]}))
    check('authorization code cannot replay',form(exchange)[0]==400)
    check('replay revokes its issued connection',f.call(agent,'search_clients',companyId=own)[0])
    print(str(checks)+' Customize OAuth checks passed')
finally:
    f.cleanup()
