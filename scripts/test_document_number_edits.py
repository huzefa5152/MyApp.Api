"""Company-private renumbering regression. Disposable local test data only."""
import argparse
import concurrent.futures
import uuid
import requests
from urllib.parse import urlparse


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:5202')
    ap.add_argument('--peer')
    args = ap.parse_args()
    for base in (args.base, args.peer):
        if base and urlparse(base).hostname not in ('localhost', '127.0.0.1', '::1'):
            ap.error('Only disposable local test servers are permitted.')
    checks = []
    companies = []
    foreign_id = None

    def call(method, path, body=None, token=None, base=None):
        r = requests.request(method, (base or args.base)+path, json=body,
            headers={'Authorization': 'Bearer '+token} if token else {}, timeout=90)
        return r.status_code, r.json() if r.content else None

    def check(name, ok, detail=''):
        checks.append(ok)
        print(('PASS ' if ok else 'FAIL ')+name+('' if ok else ': '+str(detail)), flush=True)

    status, login = call('POST', '/api/auth/login', {'username':'admin','password':'admin123'})
    assert status == 200
    seed = login['token']
    roots = {'quote':'salesquotes','challan':'deliverychallans','purchase-bill':'purchasebills','goods-receipt':'goodsreceipts'}
    fields = {'quote':'quoteNumber','challan':'challanNumber','purchase-bill':'purchaseBillNumber','goods-receipt':'goodsReceiptNumber'}

    def create(kind, fixture, custom=None, base=None):
        co, client, supplier = fixture
        body = {'companyId':co,'clientId':client,'supplierId':supplier,'date':'2026-10-01',
            'deliveryDate':'2026-10-01','receiptDate':'2026-10-01','poNumber':'SYNTHETIC-PO',
            'customNumber':custom,'gstRate':18,'items':[{'description':'Synthetic editable number',
            'quantity':2,'unit':'Pcs','uom':'Pcs','unitPrice':100}]}
        path='/api/'+roots[kind]+(f'/company/{co}' if kind in ('quote','challan') else '')
        status, row=call('POST',path,body,seed,base)
        return status,row

    def edit(kind,row,number=None,base=None,token=None):
        return call('PUT','/api/'+roots[kind]+'/'+str(row['id']),{**row,'customNumber':number},token or seed,base)

    try:
        fixtures=[]
        for suffix in ('A','B'):
            status,co=call('POST','/api/companies',{'name':'Synthetic edit numbers '+suffix+' '+uuid.uuid4().hex[:8],
                'startingSalesQuoteNumber':499,'startingChallanNumber':499,'startingPurchaseBillNumber':499,'startingGoodsReceiptNumber':499,
                'ntn':'9999999','fbrSellerRegistrationNo':'9999999','fbrProvinceCode':8,
                'fbrBusinessActivity':'Manufacturer','fbrSector':'All Other Sectors','fbrEnvironment':'Sandbox','fbrToken':'synthetic-unused-token'},seed)
            assert status in (200,201),(status,co)
            companies.append(co['id'])
            status,client=call('POST','/api/clients',{'companyId':co['id'],'name':'Synthetic edit buyer','ntn':'8888888','registrationType':'Registered','fbrProvinceCode':8},seed)
            assert status in (200,201)
            status,supplier=call('POST','/api/suppliers',{'companyId':co['id'],'name':'Synthetic edit supplier'},seed)
            assert status in (200,201)
            fixtures.append((co['id'],client['id'],supplier['id']))
        a,b=fixtures
        status, roles = call('GET', '/api/roles', token=seed)
        assert status == 200
        admin_role = next(role['id'] for role in roles if role['name'] == 'Administrator')
        username = 'number-edit-foreign-' + uuid.uuid4().hex[:8]
        status, user = call('POST', '/api/users', {'username':username,'fullName':'Synthetic foreign numbering user',
            'password':'LocalAudit#12345','role':'User'}, seed)
        assert status in (200,201),(status,user)
        foreign_id = user['id']
        assert call('PUT', f'/api/users/{foreign_id}/roles', {'roleIds':[admin_role]}, seed)[0] == 200
        assert call('PUT', f'/api/usercompanies/user/{foreign_id}', {'companyIds':[b[0]]}, seed)[0] == 200
        status, login = call('POST', '/api/auth/login', {'username':username,'password':'LocalAudit#12345'})
        assert status == 200
        foreign = login['token']
        for kind,field in fields.items():
            rows=[]
            for _ in range(3):
                status,row=create(kind,a);assert status in (200,201),(status,row);rows.append(row)
            first,second,third=rows
            preview=f'/api/companies/{a[0]}/document-numbers/{kind}'
            def next_number(): return call('GET',preview,token=seed)[1]['nextNumber']
            check(kind+' initial next 502',next_number()==502)
            status,row=edit(kind,first,499)
            check(kind+' unchanged number accepted',status==200 and row[field]==499,(status,row))
            status,info=call('GET',preview+f'?excludeId={first["id"]}&check=499',token=seed)
            check(kind+' edit preview excludes itself',status==200 and info['checkedAvailable'],(status,info))
            status,row=edit(kind,first,500)
            check(kind+' duplicate edit refused',status==400,(status,row))
            check(kind+' refused edit leaves number unchanged',call('GET','/api/'+roots[kind]+'/'+str(first['id']),token=seed)[1][field]==499)
            for invalid in (0,-1,1.5,2147483648):
                check(kind+' invalid edit '+str(invalid),edit(kind,first,invalid)[0]==400)
            check(kind+' foreign edit refused',edit(kind,first,700,token=foreign)[0] in (403,404))
            check(kind+' foreign preview refused',call('GET',preview+f'?excludeId={first["id"]}&check=499',token=foreign)[0] in (403,404))
            status,row=edit(kind,first,700)
            check(kind+' new custom number saved',status==200 and row[field]==700,(status,row))
            first=row
            check(kind+' renumbering leaves Auto at 502',next_number()==502)
            check(kind+' omitted custom number preserves 700',edit(kind,first)[1][field]==700)
            status,other=create(kind,b,700)
            check(kind+' same edited number allowed in another company',status in (200,201) and other[field]==700)
            check(kind+' foreign record cannot be excluded from own company preview',call('GET',preview+f'?excludeId={other["id"]}&check=700',token=seed)[0]==404)
            status,third=edit(kind,third,503)
            check(kind+' edit reserves future number',status==200 and third[field]==503)
            status,auto=create(kind,a)
            check(kind+' Auto continues at 502',status in (200,201) and auto[field]==502)
            status,auto=create(kind,a)
            check(kind+' Auto skips edited 503 and issues 504',status in (200,201) and auto[field]==504)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results=list(pool.map(lambda entry:edit(kind,entry[0],880,entry[1]),[(first,args.base),(second,args.peer or args.base)]))
            check(kind+' concurrent edits have one winner',sorted(status for status,_ in results)==[200,400],results)
            winner=next(row for status,row in results if status==200)
            loser=first if winner['id']==second['id'] else second
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                f1=pool.submit(edit,kind,loser,881,args.base)
                f2=pool.submit(create,kind,a,881,args.peer or args.base)
                results=[f1.result(),f2.result()]
            check(kind+' edit/create race has one winner',sorted(status for status,_ in results) in ([200,400],[201,400]),results)
            check(kind+' races leave Auto at 505',next_number()==505)
            if kind=='quote':
                status,order=call('POST',f'/api/salesquotes/{third["id"]}/convert-to-order',{},seed)
                check('quote conversion fixture exists',status in (200,201),(status,order))
                check('converted quote renumber refused',edit(kind,third,990)[0]==400)
            if kind=='challan':
                status,clone=call('POST',f'/api/deliverychallans/{third["id"]}/duplicate',{},seed)
                check('duplicate challan fixture exists',status in (200,201),(status,clone))
                if status in (200,201):
                    check('duplicate challan number locked',edit(kind,clone,990)[0]==400)
                    check('source with duplicate number locked',edit(kind,third,991)[0]==400)
                    check('duplicate unchanged number stays editable',edit(kind,clone,clone[field])[0]==200)
                check('challan edit rejects reserved demo band',edit(kind,second,900000)[0]==400)
    finally:
        if foreign_id is not None:
            check('synthetic user cleanup',call('DELETE','/api/users/'+str(foreign_id),token=seed)[0] in (200,204))
        # Company deletion removes only the synthetic fixture companies and their graphs.
        for company in companies:
            status,_=call('DELETE','/api/companies/'+str(company),token=seed)
            check('synthetic company cleanup',status in (200,204),status)
    print(f'{sum(checks)}/{len(checks)} checks passed; {len(checks)-sum(checks)} failed',flush=True)
    return 0 if all(checks) else 1


if __name__=='__main__':
    raise SystemExit(main())
