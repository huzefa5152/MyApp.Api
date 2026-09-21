"""Local integration regression for company-private catalogs and foreign item IDs.
Run: python scripts/test_private_catalogs.py --base http://localhost:5104
Creates and removes its own companies/users. Requires the catalog migration.
"""
import argparse
import sys
from urllib.parse import urlparse
from test_tenant_leak_sweep import http, company_payload


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--base',default='http://localhost:5104')
    args=parser.parse_args()
    if urlparse(args.base).hostname not in ('localhost','127.0.0.1','::1'):
        raise SystemExit('This test only runs against localhost.')
    base=args.base; passed=0; companies=[]; users=[]
    def check(ok,name,detail=''):
        nonlocal passed
        if not ok: raise AssertionError(f'{name}: {detail}')
        passed+=1;print('PASS',name,flush=True)
    def req(method,path,token=None,body=None):
        return http(method,path,base,token=token,body=body)
    status,login=req('POST','/api/auth/login',body={'username':'admin','password':'admin123'})
    check(status==200,'admin login',status);seed=login['token']
    try:
        for suffix in ('A','B'):
            status,co=req('POST','/api/companies',seed,company_payload('[TEMP] Private Catalog '+suffix))
            check(status in (200,201),'create company '+suffix,co);companies.append(co)
        a,b=[c['id'] for c in companies]
        status,roles=req('GET','/api/roles',seed)
        sales=next(r['id'] for r in roles if r['name']=='Sales Edition')
        tokens=[]
        for suffix,cid,roleids in [('a',a,[sales]),('b',b,[sales]),('empty',a,[])]:
            name='tempPrivateCatalog_'+suffix
            status,u=req('POST','/api/users',seed,{'username':name,'fullName':name,'password':'PrivateTest!26','role':'User'})
            check(status in (200,201),'create '+suffix,u);users.append(u)
            status,_=req('PUT',f"/api/users/{u['id']}/roles",seed,{'roleIds':roleids});check(status==200,'assign role '+suffix)
            status,_=req('PUT',f"/api/usercompanies/user/{u['id']}",seed,{'companyIds':[cid]});check(status==200,'assign company '+suffix)
            status,auth=req('POST','/api/auth/login',body={'username':name,'password':'PrivateTest!26'});check(status==200,'login '+suffix,status)
            tokens.append(auth['token'])
        ta,tb,empty=tokens
        items=[];descriptions=[];units=[]
        for token,cid in ((ta,a),(tb,b)):
            status,item=req('POST','/api/itemtypes',token,{'companyId':cid,'name':'Same private item','uom':'Pcs'})
            check(status in (200,201),'same item name permitted in separate company',item);items.append(item)
            status,d=req('POST',f'/api/lookup/items/fbr-defaults?companyId={cid}',token,{'name':'Private description','hsCode':str(cid)})
            check(status==200,'save private description',d);descriptions.append(d)
            status,u=req('POST',f'/api/lookup/units?companyId={cid}',token,{'name':'Private measurement'})
            check(status==200,'same unit name permitted in separate company',u);units.append(u)
        for token,cid,foreign,own_item,foreign_item,own_desc in [(ta,a,b,items[0],items[1],descriptions[0]),(tb,b,a,items[1],items[0],descriptions[1])]:
            status,rows=req('GET',f'/api/itemtypes?companyId={cid}',token)
            check(status==200 and [x['id'] for x in rows]==[own_item['id']],'catalog list contains only own item',rows)
            status,rows=req('GET','/api/itemtypes',token)
            check(status==200 and len(rows)==1,'single-company user receives private default catalog',rows)
            for path in (f'/api/itemtypes?companyId={foreign}',f'/api/units?companyId={foreign}',f'/api/lookup/items/top?companyId={foreign}'):
                status,_=req('GET',path,token);check(status==403,'foreign company catalog refused',path)
            for method,body in [('GET',None),('PUT',{'name':'Tampered'}),('DELETE',None)]:
                status,_=req(method,f"/api/itemtypes/{foreign_item['id']}",token,body)
                check(status==404,'foreign item id refused '+method,status)
            status,d=req('GET',f'/api/lookup/items/by-name?companyId={cid}&name=Private%20description',token)
            check(status==200 and d['id']==own_desc['id'] and d['hsCode']==str(cid),'same-name defaults remain private',d)
        status,_=req('PUT',f"/api/lookup/items/{descriptions[1]['id']}/favorite",ta,{'isFavorite':True})
        check(status==404,'foreign favorite mutation refused',status)
        status,_=req('PUT',f"/api/units/{units[1]['id']}",ta,{'allowsDecimalQuantity':True})
        check(status==404,'foreign unit mutation refused',status)
        for path in (f'/api/itemtypes?companyId={a}',f'/api/units?companyId={a}',f'/api/lookup/items/top?companyId={a}'):
            status,_=req('GET',path,empty);check(status==403,'empty role cannot read catalog',path)
        # Even the platform admin may not link one company's document to another's item.
        status,d=req('POST','/api/stock/opening',seed,{'companyId':a,'itemTypeId':items[1]['id'],'quantity':3,'asOfDate':'2026-09-21'})
        check(status==400,'foreign item cannot be saved in stock',f'{status} {d}')
        status,client=req('POST','/api/clients',seed,{'companyId':a,'name':'Private catalog buyer','address':'Karachi'})
        check(status in (200,201),'create document owner',client)
        for path,extra in [(f'/api/salesquotes/company/{a}',{'date':'2026-09-21','gstRate':0}),
                           (f'/api/deliverychallans/company/{a}',{'poNumber':'PRIVATE','poDate':'2026-09-21','deliveryDate':'2026-09-21'})]:
            body={'companyId':a,'clientId':client['id'],**extra,'items':[{'itemTypeId':items[0]['id'],'description':'Own document item','quantity':1,'unit':'Pcs','unitPrice':10}]}
            status,document=req('POST',path,seed,body)
            check(status in (200,201),'own item saves on '+path,f'{status} {document}')
            body['items'][0]['itemTypeId']=items[1]['id']
            status,document=req('POST',path,seed,body)
            check(status==400,'foreign item rejected on '+path,f'{status} {document}')
        print(f'{passed}/{passed} private catalog checks passed')
        return 0
    finally:
        cleanup_errors=[]
        for u in users:
            status,d=req('DELETE',f"/api/users/{u['id']}",seed)
            if status not in (200,204): cleanup_errors.append(('user',u['id'],status,d))
        for c in companies:
            status,d=req('DELETE',f"/api/companies/{c['id']}",seed)
            if status not in (200,204): cleanup_errors.append(('company',c['id'],status,d))
        if cleanup_errors: raise AssertionError(f'Cleanup failed: {cleanup_errors}')

if __name__=='__main__':sys.exit(main())
