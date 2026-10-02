"""Exercise independent Trader sessions against disposable local data only."""
import argparse,base64,json,uuid
import httpx
import pyodbc
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:5220');a=p.parse_args()
assert httpx.URL(a.base).host in ('127.0.0.1','localhost','::1')
c=httpx.Client(base_url=a.base,trust_env=False,timeout=30)
checks=[]
def req(method,path,token=None,body=None):
 return c.request(method,path,json=body,headers={'Authorization':'Bearer '+token} if token else {})
def ok(name,value):
 assert value,name
 checks.append(name);print('PASS '+name,flush=True)
def login(name,pw):
 r=req('POST','/api/auth/login',body={'username':name,'password':pw});assert r.status_code==200;return r.json()['token']
def claims(t):return json.loads(base64.urlsafe_b64decode(t.split('.')[1]+'=='))
admin=login('admin','admin123');users=[]
try:
 suffix=uuid.uuid4().hex[:8]
 for tag in ('device','other'):
  r=req('POST','/api/users',admin,{'username':'session.'+tag+'.'+suffix,'fullName':'Local session test','password':'LocalSession#12345','role':'User'});assert r.status_code in (200,201),(r.status_code,r.text);users.append(r.json())
 u=users[0]['username'];v=users[1]['username']
 one=login(u,'LocalSession#12345');two=login(u,'LocalSession#12345');other=login(v,'LocalSession#12345')
 ok('same user receives independent device sessions',claims(one)['sid']!=claims(two)['sid'])
 ok('new token lasts seven days',claims(one)['exp']-claims(one)['nbf']>=604790 if 'nbf' in claims(one) else claims(one)['exp']>__import__('time').time()+604790)
 for label,t in [('first device',one),('second device',two),('different user',other)]:ok(label+' stays authenticated',req('GET','/api/auth/me',t).status_code==200)
 refreshed=req('POST','/api/auth/refresh',two);ok('authenticated renewal succeeds',refreshed.status_code==200);new=refreshed.json()['token']
 ok('renewal retains device identity',claims(new)['sid']==claims(two)['sid'])
 ok('device logout succeeds',req('POST','/api/auth/logout',one).status_code==200)
 ok('logged out device denied',req('GET','/api/auth/me',one).status_code==401)
 ok('logged out device cannot renew',req('POST','/api/auth/refresh',one).status_code==401)
 ok('second device survives other device logout',req('GET','/api/auth/me',new).status_code==200)
 ok('different user survives logout',req('GET','/api/auth/me',other).status_code==200)
 ok('anonymous renewal denied',req('POST','/api/auth/refresh').status_code==401)
 ok('password change succeeds',req('PUT','/api/auth/password',new,{'currentPassword':'LocalSession#12345','newPassword':'NewLocalSession#12345'}).status_code==200)
 ok('password change revokes second device',req('GET','/api/auth/me',new).status_code==401)
 ok('old password session cannot renew',req('POST','/api/auth/refresh',two).status_code==401)
 fresh=login(u,'NewLocalSession#12345');ok('new password creates valid session',req('GET','/api/auth/me',fresh).status_code==200)
 db=pyodbc.connect(r'DRIVER={ODBC Driver 17 for SQL Server};SERVER=.\MSSQLSERVER02;DATABASE=MyApp_Trader_SecurityAudit_20261001;Trusted_Connection=yes;TrustServerCertificate=yes',autocommit=True)
 db.cursor().execute('UPDATE UserSessions SET ExpiresAt=DATEADD(day,-1,SYSUTCDATETIME()) WHERE Id=?',claims(fresh)['sid']);db.close()
 ok('expired device session denied before JWT expiry',req('GET','/api/auth/me',fresh).status_code==401)
 ok('expired session cannot renew',req('POST','/api/auth/refresh',fresh).status_code==401)
finally:
 for user in users:
  req('DELETE',f"/api/users/{user['id']}",admin)
 c.close()
print(str(len(checks))+' live local session checks passed')
