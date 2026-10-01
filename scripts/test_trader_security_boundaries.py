"""Local-only adversarial regression for feedback, assets and revocation.

Run against an empty disposable Trader database. Never points at production.
"""
import argparse
import base64
import io
import json
import hashlib
import hmac
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from pathlib import Path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:5174')
    ap.add_argument('--peer', help='Second local process sharing the disposable DB')
    ap.add_argument('--test-jwt-key', help='Signing key of the disposable local test server only')
    args = ap.parse_args()
    if urllib.parse.urlparse(args.base).hostname not in ('localhost', '127.0.0.1', '::1'):
        raise SystemExit('Only a local test server is allowed.')
    if args.peer and urllib.parse.urlparse(args.peer).hostname not in ('localhost','127.0.0.1','::1'):
        raise SystemExit('Peer must also be local.')
    results = []
    response_headers = {}
    def check(label, ok, detail=''):
        results.append((label, ok))
        print(('PASS ' if ok else 'FAIL ') + label + ('' if ok else ': ' + str(detail)), flush=True)
    def call(method, path, token=None, body=None, raw=None, content_type=None, base=None, cookie=None):
        headers = {}
        if token: headers['Authorization'] = 'Bearer ' + token
        if cookie: headers['Cookie'] = cookie
        if raw is None and body is not None:
            raw = json.dumps(body).encode()
            content_type = 'application/json'
        if content_type: headers['Content-Type'] = content_type
        req = urllib.request.Request((base or args.base) + path, data=raw, headers=headers, method=method)
        try:
            response = urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as e:
            response = e
        data = response.read()
        response_headers.clear()
        response_headers.update(response.headers)
        try: data = json.loads(data)
        except (ValueError, UnicodeDecodeError): pass
        return response.code, data
    def login(name, password):
        for attempt in range(4):
            status, data = call('POST', '/api/auth/login', body={'username': name, 'password': password})
            if status != 429: break
            time.sleep(20)
        assert status == 200, (status, data)
        return data['token']
    def form(path, token, fields, file=None):
        boundary = 'audit-' + uuid.uuid4().hex
        parts = []
        for key, value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        if file:
            name, mime, data = file
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + data + b'\r\n')
        parts.append(f'--{boundary}--\r\n'.encode())
        return call('POST', path, token, raw=b''.join(parts), content_type='multipart/form-data; boundary=' + boundary)
    seed = login('admin', 'admin123')
    # Unsigned/tampered credentials must never become a seed-admin identity.
    header,payload,signature = seed.split('.')
    claims = json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
    def encoded(value): return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
    forged = header+'.'+encoded({**claims,'sub':'999999','role':'Admin'})+'.'+signature
    check('tampered role/subject JWT rejected',call('GET','/api/companies',forged)[0]==401)
    if args.test_jwt_key:
        for label, edits, remove in [('missing stamp',{},'stamp'),('missing subject',{},'sub'),('invalid subject',{'sub':'invalid'},None),('zero subject',{'sub':'0'},None),('unknown user',{'sub':'999999'},None)]:
            body = {**claims,**edits}
            if remove: body.pop(remove,None)
            content = header+'.'+encoded(body)
            signed = content+'.'+base64.urlsafe_b64encode(hmac.new(args.test_jwt_key.encode(),content.encode(),hashlib.sha256).digest()).decode().rstrip('=')
            check('signed JWT '+label+' fails closed',call('GET','/api/companies',signed)[0]==401)
    # Enumerate actual controller route declarations, including upload routes.
    # Swagger generation currently fails on an existing multipart schema.
    for controller in (Path(__file__).resolve().parent.parent / 'Controllers').glob('*Controller.cs'):
        if controller.stem in ('ProductImagesController','PublicCustomerPortalController'): continue
        source = controller.read_text(encoding='utf-8-sig')
        prefix = re.search(r'\[Route\("([^"]+)"\)\]',source)
        if not prefix: continue
        prefix = '/' + prefix[1].replace('[controller]',controller.stem.removesuffix('Controller'))
        for match in re.finditer(r'\[Http(Get|Post|Put|Patch|Delete)(?:\("([^"]*)"\))?\]',source):
            path = prefix.rstrip('/') + ('/' + match[2] if match[2] else '')
            if path.lower() == '/api/auth/login': continue
            resolved = re.sub(r'\{[^}]+\}','1',path)
            method = match[1].upper()
            multipart = method == 'POST' and (path.lower().endswith(('/avatar','/logo','/stamps','/quote-images','/fingerprint-pdf','/parse-pdf','/parse-image','/excel-template')) or path.lower() == '/api/import-feedback' or '/attachments/company/' in path.lower())
            if multipart:
                status, _ = call(method,resolved,raw=b'--audit-anonymous--\r\n',content_type='multipart/form-data; boundary=audit-anonymous')
            else:
                status, _ = call(method,resolved,body={} if method in ('POST','PUT','PATCH') else None)
            check('anonymous '+method+' '+path,status in (401,403),status)
    suffix = uuid.uuid4().hex[:8]
    companies, users = [], []
    status, roles = call('GET', '/api/roles', seed)
    admin_role = next(r['id'] for r in roles if r['name'] == 'Administrator')
    try:
        for label in ('A', 'B'):
            status, co = call('POST', '/api/companies', seed, {'name': 'Security ' + label + suffix,
                'startingInvoiceNumber':1,'startingChallanNumber':1,'startingPurchaseBillNumber':1,'startingGoodsReceiptNumber':1})
            assert status in (200, 201), (status, co)
            companies.append(co['id'])
        a, b = companies
        tokens = {}
        cookies = {}
        for label, assigned in [('A', [a]), ('B', [b]), ('None', []), ('Multi', [a, b])]:
            username = 'security' + label + suffix
            status, user = call('POST', '/api/users', seed, {'username': username, 'fullName': username, 'password': 'LocalAudit#12345', 'role': 'User'})
            assert status in (200, 201), (status, user)
            users.append(user['id'])
            assert call('PUT', f"/api/users/{user['id']}/roles", seed, {'roleIds': [admin_role]})[0] == 200
            assert call('PUT', f"/api/usercompanies/user/{user['id']}", seed, {'companyIds': assigned})[0] == 200
            tokens[label] = login(username, 'LocalAudit#12345')
            cookies[label] = response_headers.get('Set-Cookie','').split(';')[0]
            status, rows = call('GET', '/api/companies', tokens[label])
            check(label + ' sees exactly assigned companies despite Administrator role', status == 200 and {x['id'] for x in rows} == set(assigned), rows)
        # Real rows make an IDOR refusal meaningful; every GET is proven to
        # return the row for its owner before its id is manipulated.
        for kind in ('quote', 'challan', 'purchase-bill', 'goods-receipt'):
            path = f'/api/companies/{b}/document-numbers/{kind}?check=500'
            for label, expected in (('B',200), ('Multi',200), ('A',403), ('None',403)):
                check(label+' '+kind+' number preview scope',call('GET',path,tokens[label])[0]==expected)
        today = '2026-10-01T00:00:00Z'
        def create(path, payload):
            status, row = call('POST',path,seed,payload)
            check('fixture '+path,status in (200,201),(status,row))
            assert status in (200,201), (path,status,row)
            return row
        client = create('/api/clients',{'companyId':b,'name':'Private buyer '+suffix,'address':'Synthetic B street'})
        supplier = create('/api/suppliers',{'companyId':b,'name':'Private supplier '+suffix,'address':'Synthetic B street'})
        item = create('/api/itemtypes?companyId='+str(b),{'companyId':b,'name':'Private item '+suffix,'uom':'Pcs'})
        line = {'description':'Private B goods','quantity':2,'unit':'Pcs','unitPrice':100,'itemTypeId':item['id']}
        documents = []
        for path, payload in [
            ('/api/clients',client),('/api/suppliers',supplier),('/api/itemtypes',item),
        ]: documents.append((path,payload,False))
        for path, payload in [
            ('/api/salesquotes/company/'+str(b),{'companyId':b,'clientId':client['id'],'date':today,'items':[line]}),
            ('/api/salesorders/company/'+str(b),{'companyId':b,'clientId':client['id'],'date':today,'items':[line]}),
            ('/api/deliverychallans/company/'+str(b),{'companyId':b,'clientId':client['id'],'deliveryDate':today,'items':[line]}),
            ('/api/invoices/standalone',{'companyId':b,'clientId':client['id'],'date':today,'items':[line]}),
            ('/api/purchasebills',{'companyId':b,'supplierId':supplier['id'],'billDate':today,'items':[line]}),
            ('/api/goodsreceipts',{'companyId':b,'supplierId':supplier['id'],'receiptDate':today,'items':[line]}),
            ('/api/folders/company/'+str(b),{'name':'Private folder '+suffix}),
            ('/api/poformats',{'companyId':b,'clientId':client['id'],'name':'Private format '+suffix,'rawText':'Synthetic purchase order columns description quantity','rulesJson':'{}'}),
        ]:
            row = create(path,payload)
            root = path.split('/company/')[0].removesuffix('/standalone')
            documents.append((root,row,root in ('/api/salesquotes','/api/salesorders','/api/invoices','/api/purchasebills','/api/goodsreceipts','/api/deliverychallans')))
        edit_previews = []
        edit_kinds = {'/api/salesquotes':'quote', '/api/deliverychallans':'challan',
            '/api/purchasebills':'purchase-bill', '/api/goodsreceipts':'goods-receipt'}
        for root,row,prints in documents:
            if root in edit_kinds:
                edit_preview = f'/api/companies/{b}/document-numbers/{edit_kinds[root]}?excludeId={row["id"]}&check=1'
                edit_previews.append(edit_preview)
                for who, expected in (('B',200), ('Multi',200), ('A',403), ('None',403)):
                    check(who+' edit number preview '+root,call('GET',edit_preview,tokens[who])[0]==expected)
            path = root+'/'+str(row['id'])
            status,_ = call('GET',path,seed)
            check('owner can read '+path,status==200,status)
            for who in ('A','None'):
                for method in ('GET','PUT','DELETE'):
                    write_path = path+'/simple' if root=='/api/poformats' and method=='PUT' else path
                    status,_ = call(method,write_path,tokens[who],{**row,'companyId':a,'descriptionHeader':'Description','quantityHeader':'Quantity'} if method=='PUT' else None)
                    check(who+' foreign '+method+' '+root,status in (403,404),status)
                if prints:
                    print_path = path+('/print/bill' if root=='/api/invoices' else '/print')
                    status,_ = call('GET',print_path,seed)
                    check('owner print route exists '+root,status==200,status)
                    status,_ = call('GET',print_path,tokens[who])
                    check(who+' foreign print refused '+root,status in (403,404),status)
            check('foreign mutation leaves row intact '+root,call('GET',path,seed)[0]==200)
        for path in [f'/api/reports/company/{b}/sales/excel?year=2026&month=10',f'/api/reports/company/{b}/tax-sheet/excel?year=2026&month=10',f'/api/stock/company/{b}/onhand',f'/api/dashboard/kpis?companyId={b}']:
            check('owner export/dashboard route exists '+path,call('GET',path,seed)[0]==200)
            for who in ('A','None'):
                check(who+' export/dashboard refused '+path,call('GET',path,tokens[who])[0] in (403,404))
        # A caller cannot use an owned parent with a foreign child id either.
        for root in ('/api/invoices/standalone',f'/api/salesquotes/company/{a}',f'/api/salesorders/company/{a}'):
            status,_ = call('POST',root,tokens['A'],{'companyId':a,'clientId':client['id'],'date':today,'items':[line]})
            check('cross-company client/item link refused '+root,status in (400,403,404),status)
        status, attachment = form(f'/api/attachments/company/{b}',seed,{},('private.txt','text/plain',b'private company B audit document'))
        check('attachment fixture created',status==200,(status,attachment))
        if status==200:
            for who in ('A','None'):
                for method,tail in [('GET','/download'),('DELETE','')]:
                    check(who+' foreign attachment '+method,call(method,f"/api/attachments/{attachment['id']}"+tail,tokens[who])[0] in (403,404))
        feedback = []
        for cid in (a, b, None):
            fields = {'feedbackStatus': 'Incorrect', 'parserVersion': 'private-' + str(cid), 'originalFileName': 'private-' + str(cid) + '.pdf'}
            if cid: fields['companyId'] = cid
            status, fb = form('/api/import-feedback', seed, fields, ('source.pdf', 'application/pdf', b'%PDF-1.4\nsynthetic-audit-only'))
            assert status == 200, (status, fb)
            feedback.append(fb)
        for who, allowed in [('A', {a}), ('B', {b}), ('None', set()), ('Multi', {a,b})]:
            tok = tokens[who]
            status, rows = call('GET', '/api/import-feedback/incorrect?pageSize=200', tok)
            check(who + ' feedback list filtered before pagination', status == 200 and all(x['companyId'] in allowed for x in rows['rows']), rows)
            status, stats = call('GET', '/api/import-feedback/statistics', tok)
            check(who + ' feedback aggregates contain only assigned versions', status == 200 and {v['parserVersion'] for v in stats['byParserVersion']} == {'private-' + str(cid) for cid in allowed}, stats)
            for fb in feedback:
                status, data = call('GET', f"/api/import-feedback/{fb['id']}/download", tok)
                check(who + ' feedback PDF ' + str(fb['companyId']), status == 200 if fb['companyId'] in allowed else status in (403,404), status)
            status, data = call('POST', '/api/import-feedback/download', tok, {'ids': [x['id'] for x in feedback]})
            if allowed:
                names = zipfile.ZipFile(io.BytesIO(data)).namelist() if status == 200 and isinstance(data, bytes) else []
                check(who + ' mixed ZIP excludes foreign and company-less PDF', len(names) == len(allowed) and all(any(n.startswith(str(f['id'])+'_') for f in feedback if f['companyId'] in allowed) for n in names), names)
            else: check('no-assignment ZIP refused', status == 404, status)
            status, _ = form('/api/import-feedback', tok, {'feedbackStatus':'Correct'})
            check(who + ' feedback without company fails closed', status in (400,403), status)
        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
        status, stamp = form(f'/api/companies/{b}/stamps', seed, {'name':'private_signature'}, ('stamp.png','image/png',png))
        assert status == 200, (status, stamp)
        for who, tok, expected in [('anonymous',None,False),('A',tokens['A'],False),('None',tokens['None'],False),('B',tokens['B'],True),('Multi',tokens['Multi'],True),('seed',seed,True)]:
            status, _ = call('GET', stamp['url'], tok)
            check(who + ' direct stamp URL respects company', status == 200 if expected else status in (401,403,404), status)
        check('image cookie works without Bearer header',call('GET',stamp['url'],cookie=cookies['B'])[0] == 200)
        check('private image response prevents caching',response_headers.get('Cache-Control') == 'no-store, private',response_headers)
        check('image cookie cannot authenticate API',call('GET','/api/companies',cookie=cookies['B'])[0] == 401)
        status, photo = form(f'/api/companies/{b}/quote-images',tokens['B'],{},('product.png','image/png',png))
        check('owner uploads optional quote photo',status==200,(status,photo))
        assert status==200
        photo_url=photo['url']
        for who,tok,expected in [('anonymous',None,401),('A',tokens['A'],404),('None',tokens['None'],404),('B',tokens['B'],200),('seed',seed,200)]:
            check(who+' private quote image access',call('GET',photo_url,tok)[0]==expected)
        check('quote image cookie works',call('GET',photo_url,cookie=cookies['B'])[0]==200)
        check('foreign quote photo upload refused',form(f'/api/companies/{b}/quote-images',tokens['A'],{},('product.png','image/png',png))[0]==403)
        check('invalid image bytes refused',form(f'/api/companies/{b}/quote-images',tokens['B'],{},('product.png','image/png',b'not a photo'))[0]==400)
        quoted=next(row for root,row,_ in documents if root=='/api/salesquotes')
        quoted['items'][0]['imagePath']=photo_url
        status,saved=call('PUT',f"/api/salesquotes/{quoted['id']}",tokens['B'],quoted)
        check('quote image persists without changing totals',status==200 and saved['items'][0]['imagePath']==photo_url and saved['subtotal']==200,(status,saved))
        status,printed=call('GET',f"/api/salesquotes/{quoted['id']}/print",tokens['B'])
        check('quote print exposes optional image merge field',status==200 and printed['items'][0]['imagePath']==photo_url,(status,printed))
        for forged_path in ('https://example.invalid/photo.png','/data/uploads/quoteitems/company_'+str(a)+'/0123456789abcdef0123456789abcdef.png','/data/uploads/quoteitems/company_'+str(b)+'/../secret.png','/data/uploads/quoteitems/company_'+str(b)+'/0123456789abcdef0123456789abcdef.png'):
            quoted['items'][0]['imagePath']=forged_path
            check('forged or missing quote image refused '+forged_path,call('PUT',f"/api/salesquotes/{quoted['id']}",tokens['B'],quoted)[0]==400)
        quoted['items'][0]['imagePath']=None
        status,saved=call('PUT',f"/api/salesquotes/{quoted['id']}",tokens['B'],quoted)
        check('quote photo removal leaves totals unchanged',status==200 and saved['items'][0]['imagePath'] is None and saved['subtotal']==200)
        assert call('PUT',f'/api/users/{users[1]}/roles',seed,{'roleIds':[]})[0]==200
        check('assigned user without quote permission cannot read image',call('GET',photo_url,tokens['B'])[0]==404)
        for kind in ('quote', 'challan', 'purchase-bill', 'goods-receipt'):
            check(kind+' preview requires create permission',call('GET',f'/api/companies/{b}/document-numbers/{kind}',tokens['B'])[0]==403)
        for path in edit_previews:
            check('edit preview permission revocation '+path,call('GET',path,tokens['B'])[0]==403)
        assert call('PUT',f'/api/users/{users[1]}/roles',seed,{'roleIds':[admin_role]})[0]==200
        status, logo = form(f'/api/companies/{b}/logo',seed,{},('logo.png','image/png',png))
        assert status == 200, (status,logo)
        logo_url = logo['logoPath']
        for who, tok, permitted in [('anonymous',None,False),('A',tokens['A'],False),('B',tokens['B'],True),('None',tokens['None'],False)]:
            status,_ = call('GET',logo_url,tok)
            check(who+' logo file respects company', status==200 if permitted else status in (401,403,404),status)
        status, avatar = form('/api/auth/avatar',tokens['B'],{},('avatar.png','image/png',png))
        assert status == 200,(status,avatar)
        for who,tok,permitted in [('anonymous',None,False),('A',tokens['A'],False),('B',tokens['B'],True),('None',tokens['None'],False),('seed',seed,True)]:
            status,_ = call('GET',avatar['avatarPath'],tok)
            check(who+' avatar file respects user management scope',status==200 if permitted else status in (401,403,404),status)
        template = create(f'/api/printtemplates/company/{b}',{'name':'Security print','templateType':'Bill','isDefault':True,'htmlContent':'<html><body><img src="'+logo_url+'"><img src="'+stamp['url']+'">{{companyLogoPath}}</body></html>'})
        portal = create('/api/customer-portals',{'companyId':b,'clientId':client['id'],'documentType':'Bill'})
        portal_path = '/api/public/customer-portal/'+portal['publicUrl'].rsplit('/',1)[-1]
        status, portal_home = call('GET',portal_path)
        check('portal capability embeds only its company logo',status==200 and portal_home['companyLogoPath'].startswith('data:image/'),portal_home)
        invoice = next(row for root,row,_ in documents if root=='/api/invoices')
        status, printed = call('GET',portal_path+f"/invoices/{invoice['invoiceNumber']}/print")
        check('portal print preserves protected logo and signature',status==200 and 'data:image/' in printed['templateHtml'] and logo_url not in printed['templateHtml'] and stamp['url'] not in printed['templateHtml'],(status,printed))
        for path in ('/data/keys/any.xml','/data/attachments/any.txt','/data/uploads/excel-templates/company_1.xlsx','/data/uploads/po_imports/any.pdf','/data/uploads/parser_feedback/any.pdf','/data/unknown.txt'):
            check('static deny '+path,call('GET',path,seed)[0]==404)
        # Revocation must reject the same JWT, with its access cache already warm.
        call('GET', f'/api/clients/company/{b}', tokens['Multi'])
        if args.peer:
            check('peer initially serves granted company', call('GET',f'/api/clients/company/{b}',tokens['Multi'],base=args.peer)[0] == 200)
        assert call('PUT', f'/api/usercompanies/user/{users[3]}', seed, {'companyIds':[a]})[0] == 200
        if args.peer:
            check('revocation effective on another process next request',call('GET',f'/api/clients/company/{b}',tokens['Multi'],base=args.peer)[0] in (403,404))
        for path in (f'/api/clients/company/{b}', f'/api/stock/company/{b}/onhand', stamp['url'], f"/api/import-feedback/{feedback[1]['id']}/download"):
            status, _ = call('GET', path, tokens['Multi'])
            check('revoked access rejects next request ' + path, status in (403,404), status)
        status, rows = call('GET', '/api/import-feedback/incorrect', tokens['Multi'])
        check('revoked feedback absent from unfiltered list', status == 200 and all(x['companyId']==a for x in rows['rows']), rows)
        status, _ = call('POST', '/api/auth/logout', tokens['A'])
        check('logout succeeds', status == 200, status)
        check('logged-out JWT rejected', call('GET','/api/companies',tokens['A'])[0] == 401)
        call('GET', '/api/companies', tokens['B'])
        check('delete user succeeds', call('DELETE', f'/api/users/{users[1]}', seed)[0] in (200,204))
        check('deleted user JWT rejected immediately', call('GET','/api/companies',tokens['B'])[0] == 401)
        if args.peer:
            call('GET','/api/roles',tokens['None'],base=args.peer)
            assert call('PUT',f'/api/users/{users[2]}/roles',seed,{'roleIds':[]})[0] == 200
            check('role revocation effective on another process next request',call('GET','/api/roles',tokens['None'],base=args.peer)[0] == 403)
    finally:
        for uid in users: call('DELETE',f'/api/users/{uid}',seed)
        for cid in companies: call('DELETE',f'/api/companies/{cid}',seed)
    failed = sum(not ok for _,ok in results)
    print(f'{len(results)-failed}/{len(results)} checks passed; {failed} failed', flush=True)
    return int(failed > 0)

if __name__ == '__main__': sys.exit(main())
