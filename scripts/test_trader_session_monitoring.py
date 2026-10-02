"""Seed-admin session management regression against local disposable data."""
import argparse,base64,json,uuid
import httpx,pyodbc
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:5222');a=p.parse_args()
assert httpx.URL(a.base).host in ('127.0.0.1','localhost','::1')
c=httpx.Client(base_url=a.base,trust_env=False,timeout=30);users=[];checks=[]
def req(method,path,token=None,body=None):return c.request(method,path,json=body,headers={'Authorization':'Bearer '+token} if token else {})
def ok(label,v):assert v,label;checks.append(label);print('PASS '+label,flush=True)
def login(name):
 r=req('POST','/api/auth/login',body={'username':name,'password':'admin123' if name=='admin' else 'LocalSession#12345'});assert r.status_code==200,(r.status_code,r.text);return r.json()['token']
def sid(t):return json.loads(base64.urlsafe_b64decode(t.split('.')[1]+'=='))['sid']
admin=login('admin')
def overview(query=''):return req('GET','/api/user-sessions'+query,admin).json()
try:
 baseline=overview()['summary'];suffix=uuid.uuid4().hex[:8]
 roles=req('GET','/api/roles',admin).json();role=next(r['id'] for r in roles if r['name']=='Administrator')
 for i in range(2):
  r=req('POST','/api/users',admin,{'username':f'monitor.{i}.{suffix}','fullName':'Local monitoring user','password':'LocalSession#12345','role':'User'});assert r.status_code in (200,201);users.append(r.json())
  req('PUT',f"/api/users/{users[-1]['id']}/roles",admin,{'roleIds':[role]})
 first=login(users[0]['username']);second=login(users[0]['username']);other=login(users[1]['username'])
 summary=overview()['summary']
 ok('distinct signed-in user count increases by two',summary['signedInUsers']==baseline['signedInUsers']+2)
 ok('browser session count increases by three',summary['signedInSessions']==baseline['signedInSessions']+3)
 ok('recent activity counts both users',summary['recentlyActiveUsers']==baseline['recentlyActiveUsers']+2)
 for method,path in [('GET','/api/user-sessions'),('POST',f'/api/user-sessions/{sid(first)}/revoke'),('POST',f"/api/user-sessions/user/{users[0]['id']}/revoke")]:
  ok('non-seed Administrator denied '+path,req(method,path,other).status_code==403)
 ok('anonymous session overview denied',req('GET','/api/user-sessions').status_code==401)
 ok('pagination capped',overview('?pageSize=99999')['pageSize']==200)
 ok('invalid status rejected',req('GET','/api/user-sessions?status=invalid',admin).status_code==400)
 mine=overview(f"?userId={users[0]['id']}")['items'];ok('user filter returns only selected user',len(mine)==2 and all(s['userId']==users[0]['id'] for s in mine))
 ok('secrets absent from session response',all(not ({'token','securityStamp','passwordHash'} & set(s)) for s in mine))
 ok('observed device details recorded',all(s['userAgent'] and s['ipAddress'] for s in mine))
 db=pyodbc.connect(r'DRIVER={ODBC Driver 17 for SQL Server};SERVER=.\MSSQLSERVER02;DATABASE=MyApp_Trader_SecurityAudit_20261001;Trusted_Connection=yes;TrustServerCertificate=yes',autocommit=True);q=db.cursor()
 q.execute('UPDATE UserSessions SET TokenExpiresAt=DATEADD(minute,-1,SYSUTCDATETIME()) WHERE Id=?',sid(first))
 expired=overview(f"?userId={users[0]['id']}&status=expired")['items']
 ok('expired access token excluded from signed-in sessions',overview()['summary']['signedInSessions']==baseline['signedInSessions']+2)
 ok('expired access token visible in expired history',len(expired)==1 and expired[0]['id']==sid(first))
 req('POST','/api/auth/refresh',first)
 ok('renewal restores token validity in monitoring',overview()['summary']['signedInSessions']==baseline['signedInSessions']+3)
 q.execute('UPDATE UserSessions SET LastSeenAt=DATEADD(minute,-6,SYSUTCDATETIME()) WHERE Id=?',sid(first))
 def target():return next(s for s in overview(f"?userId={users[0]['id']}")['items'] if s['id']==sid(first))
 ok('inactive session remains signed in',target()['status']=='Signed in')
 req('GET','/api/auth/me',first);ok('authenticated activity marks session recent',target()['status']=='Recently active')
 before=q.execute('SELECT LastSeenAt FROM UserSessions WHERE Id=?',sid(first)).fetchone()[0];req('GET','/api/auth/me',first)
 ok('activity write throttled within one minute',before==q.execute('SELECT LastSeenAt FROM UserSessions WHERE Id=?',sid(first)).fetchone()[0])
 ok('seed admin revokes selected device',req('POST',f'/api/user-sessions/{sid(first)}/revoke',admin).status_code==200)
 ok('revoked device rejected immediately',req('GET','/api/auth/me',first).status_code==401)
 ok('other device survives single revocation',req('GET','/api/auth/me',second).status_code==200)
 revoked=overview(f"?userId={users[0]['id']}&status=revoked")['items'];ok('revocation timestamp displayed',len(revoked)==1 and revoked[0]['revokedAt'])
 ok('seed admin revokes all selected user sessions',req('POST',f"/api/user-sessions/user/{users[0]['id']}/revoke",admin).status_code==200)
 ok('all-user revocation rejects remaining device',req('GET','/api/auth/me',second).status_code==401)
 ok('different user unaffected by all-user revocation',req('GET','/api/auth/me',other).status_code==200)
 req('PUT','/api/auth/password',other,{'currentPassword':'LocalSession#12345','newPassword':'ChangedLocalSession#12345'})
 ok('password change excluded from signed-in totals',overview()['summary']['signedInUsers']==baseline['signedInUsers'])
 ok('password-invalidated session listed as revoked',len(overview(f"?userId={users[1]['id']}&status=revoked")['items'])==1)
 db.close()
finally:
 for u in users:req('DELETE',f"/api/users/{u['id']}",admin)
 c.close()
print(str(len(checks))+' session monitoring checks passed')
