"""The filing unit the tax consultant picks is the unit FBR receives (Hakimi bill 3985, 2026-10-26).

HS 3004.9099 has two FBR units: KG (13) and Packs (71). Bill 3985 showed "Packs" and filed KG,
because its catalog item stored the name "Packs" with KG's id and FBR is sent the unit the ID names.
This suite proves, on a throwaway company, that:
  - Adjust Invoice is offered both of FBR's units for the code;
  - picking KG files KG, picking Packs files Packs, in the saved row and in View FBR;
  - a catalog item saved with "Packs" and no id gets Packs' id, not FBR's default (KG);
  - a legacy item holding "Packs" with KG's id files Packs, as shown;
  - another company's user cannot read or save the filing.

Local only; never calls FBR validate or submit. --db (a MyApp_Trader_Test_ scratch database) stores
FBR's two units for the code when the database has none, and --token-from <companyId> copies a
SANDBOX company's FBR token onto the throwaway company so View FBR maps unit ids through FBR's own
unit list, exactly as production does. Without it View FBR falls back to the unit name.
"""
import argparse
import json
import re as regex
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import uuid4
from test_tenant_leak_sweep import http, company_payload

HS, KG, PACKS = '3004.9099', 13, 71
SALE = 'Goods at standard rate (default)'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://localhost:5135')
    parser.add_argument('--db', help='MyApp_Trader_Test_ scratch database')
    parser.add_argument('--token-from', type=int, help='sandbox company whose FBR token the fixture borrows (needs --db)')
    args = parser.parse_args()
    if urlparse(args.base).hostname not in ('localhost', '127.0.0.1', '::1'):
        raise SystemExit('This suite only runs on localhost.')
    if args.db and not regex.fullmatch(r'MyApp_Trader_Test_[A-Za-z0-9_]+', args.db):
        raise SystemExit('--db must be a MyApp_Trader_Test_ scratch database.')
    if args.token_from and not args.db:
        raise SystemExit('--token-from needs --db.')

    def sql(statement):
        import pyodbc
        with pyodbc.connect('DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\MSSQLSERVER02;DATABASE=' + args.db
                            + ';Trusted_Connection=yes;TrustServerCertificate=yes;') as connection:
            cursor = connection.execute(statement)
            result = list(cursor.fetchall()) if cursor.description else None
            connection.commit()
            return result

    passed = 0

    def check(ok, label, detail=''):
        nonlocal passed
        assert ok, f'{label}: {detail}'
        passed += 1
        print('PASS', label, flush=True)

    def req(method, path, token=None, body=None):
        return http(method, path, args.base, token, body)

    def good(method, path, token=None, body=None):
        status, result = req(method, path, token, body)
        assert status in (200, 201, 204), f'{method} {path}: {status} {result}'
        return result

    admin = good('POST', '/api/auth/login', body={'username': 'admin', 'password': 'admin123'})['token']
    stamp = uuid4().hex[:8]
    today = datetime.now(timezone.utc).strftime('%Y-%m-%dT00:00:00Z')

    if args.db:
        for uom_id, label, order in ((KG, 'KG', 0), (PACKS, 'Packs', 1)):
            sql(f"IF NOT EXISTS (SELECT 1 FROM FbrLookups WHERE Category='HsUom' AND Code='{HS}|{uom_id}') "
                f"INSERT INTO FbrLookups (Category, Code, Label, SortOrder, IsActive) VALUES ('HsUom', '{HS}|{uom_id}', '{label}', {order}, 1)")

    companies = []
    for suffix in ('A', 'B'):
        payload = company_payload('[TEMP] Filing unit ' + stamp + ' ' + suffix)
        payload.update(fbrToken='local-fixture-token', fbrBusinessActivity='Wholesaler', fbrSector='Wholesale / Retails')
        companies.append(good('POST', '/api/companies', admin, payload)['id'])
    a, b = companies
    if args.token_from:
        sql(f'UPDATE Companies SET FbrToken = (SELECT FbrToken FROM Companies WHERE Id = {args.token_from}), '
            f"FbrEnvironment = 'sandbox' WHERE Id = {a} AND Name LIKE '[[]TEMP] Filing unit %'")

    hints = good('GET', f'/api/itemtypes/fbr-hints?companyId={a}&hsCode={HS}', admin)
    offered = {u['uoM_ID']: u['description'] for u in hints['uoms']}
    check(offered.get(KG) == 'KG' and offered.get(PACKS) == 'Packs', 'Adjust Invoice is offered both of FBR\'s units', offered)

    def item(name, uom, fbr_uom_id):
        # ?companyId= is what the item form sends; it chooses whose FBR unit list fills a blank half.
        return good('POST', f'/api/itemtypes?companyId={a}', admin, {'companyId': a, 'name': f'[TEMP] {name} {stamp}', 'hsCode': HS,
                                                      'uom': uom, 'fbrUOMId': fbr_uom_id, 'saleType': SALE})

    typed = item('Medicine typed', 'Packs', None)
    check(typed['fbrUOMId'] == PACKS, 'a unit typed without an id gets that unit\'s own id, not FBR\'s default', typed)
    legacy = item('Medicine legacy', 'Packs', KG)  # the shape Hakimi's "Medicine" item has on production
    check(legacy['uom'] == 'Packs' and legacy['fbrUOMId'] == KG, 'fixture holds the production mismatch', legacy)

    family = good('POST', '/api/itemtypes', admin, {'companyId': a, 'name': f'[TEMP] Medicines {stamp}', 'uom': 'Box'})
    client = good('POST', '/api/clients', admin, {'companyId': a, 'name': '[TEMP] Filing unit buyer', 'address': 'Sample address',
                                                  'ntn': '1234567', 'registrationType': 'Registered', 'fbrProvinceCode': 8})
    bill = good('POST', '/api/invoices/standalone', admin, {
        'companyId': a, 'clientId': client['id'], 'date': today, 'gstRate': 18, 'groupTaxInvoiceByItemType': True,
        'items': [{'description': 'Panadol Tablet Box Of 200', 'quantity': 42, 'uom': 'Box', 'unitPrice': 1000,
                   'itemTypeId': family['id']}]})
    iid, line = bill['id'], bill['items'][0]['id']
    path = f'/api/invoices/{iid}/tax-filing'

    def save(item_type, selected=None):
        editor = good('GET', path, admin)
        row = {'sourceLineIds': [line], 'itemTypeId': item_type['id'], 'description': 'Medicine', 'quantity': 42,
               'valueExclTax': 42000, 'selectedFbrUOMId': selected}
        return good('PUT', path, admin, {'version': editor['version'], 'rows': [row]})['rows'][0]

    def filed_unit():
        preview = good('GET', f'/api/fbr/{iid}/preview-payload', admin)
        check(preview.get('success'), 'View FBR builds the payload without submitting', preview)
        return json.loads(preview['preview']['json'])['items'][0]['uoM']

    row = save(legacy)
    check((row['uom'], row['fbrUOMId']) == ('Packs', PACKS), 'legacy Packs + KG id saves as Packs (the 3985 case)', row)
    check(filed_unit() == 'Packs', 'View FBR files Packs for the legacy item')

    row = save(legacy, KG)
    check((row['uom'], row['fbrUOMId']) == ('KG', KG), 'consultant picks KG: the row saves KG', row)
    check(filed_unit() == 'KG', 'View FBR files KG')
    check(save(legacy)['fbrUOMId'] == KG, 'a later save without a pick keeps the consultant\'s KG')

    row = save(legacy, PACKS)
    check((row['uom'], row['fbrUOMId']) == ('Packs', PACKS), 'consultant picks Packs: the row saves Packs', row)
    check(filed_unit() == 'Packs', 'View FBR files Packs')
    check(save(legacy)['fbrUOMId'] == PACKS, 'a later save without a pick keeps the consultant\'s Packs')

    editor = good('GET', path, admin)
    status, _ = req('PUT', path, admin, {'version': editor['version'], 'rows': [{
        'sourceLineIds': [line], 'itemTypeId': typed['id'], 'description': 'Medicine', 'quantity': 42,
        'valueExclTax': 42000, 'selectedFbrUOMId': 999}]})
    check(status == 400, 'a unit FBR does not list for the code is refused', status)
    check(good('GET', path, admin)['rows'][0]['fbrUOMId'] == PACKS, 'the refused save leaves the filing intact')

    # Another company's user may not read, preview or save this filing.
    username = f'temp_unit_{stamp}'
    roles = good('GET', '/api/roles', admin)
    role = next(r for r in roles if r['name'] == 'Complete Edition')
    user = good('POST', '/api/users', admin, {'username': username, 'password': 'TempPass#2026', 'fullName': '[TEMP] Other tenant',
                                              'role': 'User'})
    good('PUT', f'/api/users/{user["id"]}/roles', admin, {'roleIds': [role['id']]})
    good('PUT', f'/api/usercompanies/user/{user["id"]}', admin, {'companyIds': [b]})
    outsider = good('POST', '/api/auth/login', body={'username': username, 'password': 'TempPass#2026'})['token']
    check(req('GET', path, outsider)[0] in (403, 404), 'another company\'s user cannot read the filing')
    check(req('GET', f'/api/fbr/{iid}/preview-payload', outsider)[0] in (403, 404), 'another company\'s user cannot view FBR')
    status, _ = req('PUT', path, outsider, {'version': editor['version'], 'rows': [{
        'sourceLineIds': [line], 'itemTypeId': legacy['id'], 'description': 'Medicine', 'quantity': 42,
        'valueExclTax': 42000, 'selectedFbrUOMId': KG}]})
    check(status in (403, 404), 'another company\'s user cannot save the filing', status)
    check(good('GET', path, admin)['rows'][0]['fbrUOMId'] == PACKS, 'the outsider\'s attempt changed nothing')

    print(f'{passed}/{passed} filing unit checks passed')


if __name__ == '__main__':
    main()
