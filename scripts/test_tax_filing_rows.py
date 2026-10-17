"""Local-only filing rows integration: commercial preservation, projections and isolation.
Creates its own fixtures; never calls FBR validate or submit. --keep supports UI testing.
"""
import argparse
import copy
import json
import re as regex
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
from test_tenant_leak_sweep import http, company_payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://localhost:5194')
    parser.add_argument('--keep', action='store_true')
    parser.add_argument('--fixture', help='Write fixture IDs (no credentials) for a UI test')
    parser.add_argument('--db', help='LOCAL database for synthetic submission/lock cases')
    args = parser.parse_args()
    if urlparse(args.base).hostname not in ('localhost', '127.0.0.1', '::1'):
        raise SystemExit('This suite only runs on localhost.')
    if args.db and args.db != 'MyApp_Trader_Local' and not regex.fullmatch(r'MyApp_Trader_Test_[A-Za-z0-9_]+', args.db):
        raise SystemExit('The SQL lock cases require the Trader LOCAL database or a MyApp_Trader_Test_ scratch database.')
    passed = 0
    success = False
    created = {'companies': [], 'users': [], 'roles': []}
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
    login = good('POST', '/api/auth/login', body={'username': 'admin', 'password': 'admin123'})
    admin = login['token']
    stamp = uuid4().hex[:8]
    today = datetime.now(timezone.utc).strftime('%Y-%m-%dT00:00:00Z')
    def sql(statement):
        import pyodbc
        with pyodbc.connect('DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\\MSSQLSERVER02;DATABASE='+args.db+';Trusted_Connection=yes;TrustServerCertificate=yes;') as connection:
            cursor = connection.execute(statement)
            result = list(cursor.fetchall()) if cursor.description else None
            connection.commit()
            return result
    try:
        for suffix in ('A', 'B'):
            payload = company_payload('[TEMP] Filing '+stamp+' '+suffix)
            payload.update(fbrToken='local-fixture-token', fbrBusinessActivity='Importer', fbrSector='Other', inventoryTrackingEnabled=suffix == 'A')
            co = good('POST', '/api/companies', admin, payload)
            created['companies'].append(co['id'])
        a, b = created['companies']
        client = good('POST', '/api/clients', admin, {'companyId': a, 'name': '[TEMP] Filing buyer', 'address': 'Sample address', 'ntn': '1234567', 'registrationType': 'Registered', 'fbrProvinceCode': 8})
        def item(cid, name, hs=None, uom='Nos', sale=None):
            return good('POST', '/api/itemtypes', admin, {'companyId': cid, 'name': '[TEMP] '+name+' '+stamp, 'uom': uom, 'hsCode': hs, 'saleType': sale, 'fbrUOMId': 13 if hs else None})
        table = item(a, 'Table')
        chair = item(a, 'Chair')
        sale = 'Goods at standard rate (default)'
        filing1 = item(a, 'Filing A', '9403.6000', sale=sale)
        filing2 = item(a, 'Filing B', '9401.3000', sale=sale)
        foreign = item(b, 'Foreign filing', '9403.6000', sale=sale)
        good('POST', '/api/stock/opening', admin, {'companyId': a, 'itemTypeId': filing1['id'], 'quantity': 100, 'asOfDate': today})
        def create_bill(values=(12500, 10500, 7000), gst=18, further=None, extra=None):
            lines = [{'description': 'Office table', 'quantity': 1, 'uom': 'Nos', 'unitPrice': values[0], 'itemTypeId': table['id']},
                     {'description': 'Low back chair', 'quantity': 1, 'uom': 'Nos', 'unitPrice': values[1], 'itemTypeId': chair['id']},
                     {'description': 'Visitor chair', 'quantity': 1, 'uom': 'Nos', 'unitPrice': values[2], 'itemTypeId': chair['id']}]
            if extra: lines = extra
            return good('POST', '/api/invoices/standalone', admin, {'companyId': a, 'clientId': client['id'], 'date': today, 'gstRate': gst, 'furtherTaxRate': further, 'items': lines, 'groupTaxInvoiceByItemType': True})
        bill = create_bill()
        iid = bill['id']
        if args.db:
            sql(f"UPDATE InvoiceItems SET SaleType = NULL WHERE Id = {bill['items'][0]['id']};")
            bill = good('GET', f'/api/invoices/{iid}', admin)
        path = f'/api/invoices/{iid}/tax-filing'
        editor = good('GET', path, admin)
        check(len(editor['rows']) == 2, 'two original groups are shown')
        check(sum(r['valueExclTax'] for r in editor['rows']) == 30000, 'original grouped total is 30,000')
        before_bill = good('GET', f'/api/invoices/{iid}/print/bill', admin)
        before_stock = good('GET', f'/api/stock/company/{a}/onhand', admin)
        check(any(row['onHand'] == 100 for row in before_stock), 'tracking fixture holds 100 real units before filing')
        before_journal = sql(f'SELECT * FROM JournalEntries WHERE CompanyId = {a} ORDER BY Id') if args.db else None
        ids = [i['id'] for i in bill['items']]
        merged = {'sourceLineIds': ids, 'itemTypeId': filing1['id'], 'quantity': 3, 'valueExclTax': 30000, 'description': 'Combined supply'}
        saved = good('PUT', path, admin, {'version': editor['version'], 'rows': [merged]})
        check(saved['hasSavedRows'] and len(saved['rows']) == 1, 'two groups saved as one independent filing row')
        check(True, 'an unclassified source can combine with a compatible classified source')
        check(saved['rows'][0]['hsCode'] == filing1['hsCode'], 'filing HS code is catalog-derived')
        check(saved['bill']['fbrReady'], 'ready status follows the filing rows')
        check(saved['bill']['items'] == bill['items'], 'every original bill line is unchanged')
        check(good('GET', f'/api/invoices/{iid}/print/bill', admin) == before_bill, 'original bill print is byte-for-byte equivalent')
        check(good('GET', f'/api/stock/company/{a}/onhand', admin) == before_stock, 'stock remains unchanged')
        if args.db:
            check(sql(f'SELECT * FROM JournalEntries WHERE CompanyId = {a} ORDER BY Id') == before_journal, 'journal entries remain unchanged')
            check(sql(f"SELECT COUNT(*) FROM AuditLogs WHERE CompanyId = {a} AND ExceptionType = 'TAX_FILING_ROWS_SAVED'")[0][0] > 0, 'filing save creates a company-scoped audit record')
        reloaded = good('GET', path, admin)
        check(reloaded['rows'] == saved['rows'], 'filing rows persist across reload')
        taxprint = good('GET', f'/api/invoices/{iid}/print/tax-invoice', admin)
        check(len(taxprint['items']) == 1 and taxprint['items'][0]['valueExclTax'] == 30000, 'tax invoice prints one exact filing row')
        check(taxprint['items'][0]['gstAmount'] == 5400, 'tax print preserves sales tax')
        check(len(taxprint['billItems']) == 2, 'tax invoice retains original bill groups separately')
        preview = good('GET', f'/api/fbr/{iid}/preview-payload', admin)
        check(preview.get('success'), 'FBR dry-run preview succeeds without submission', preview)
        payload = json.loads(preview['preview']['json'])
        check(len(payload['items']) == 1 and payload['items'][0]['valueSalesExcludingST'] == 30000, 'FBR payload uses the same combined filing row', payload)
        check(payload['items'][0]['hsCode'] == filing1['hsCode'], 'FBR payload uses the saved filing HS code')
        report = good('GET', f'/api/reports/company/{a}/tax-sheet?year={today[:4]}', admin)
        check(not any(r['invoiceId'] == iid for r in report['rows']), 'reviewed filing disappears from pending tax sheet')
        listed = good('GET', f'/api/invoices/company/{a}/paged?fbrFilter=ready', admin)
        check(any(i['id'] == iid for i in listed['items']), 'ready filter includes classified filing with unclassified commercial lines')
        not_ready = good('GET', f'/api/invoices/company/{a}/paged?fbrFilter=notadjusted', admin)
        check(not any(i['id'] == iid for i in not_ready['items']), 'not-adjusted filter excludes reviewed filing')
        # Every rejected save must retain the prior filing and original bill.
        def reject(rows, label, version=None):
            current = good('GET', path, admin)
            status, error = req('PUT', path, admin, {'version': version or current['version'], 'rows': rows})
            check(status == 400, label, (status, error))
            check(good('GET', path, admin)['rows'] == current['rows'], label+' leaves saved rows intact')
        reject([merged], 'concurrent/stale edit version is refused', editor['version'])
        reject([{**merged, 'valueExclTax': 30000.01}], 'one-paisa subtotal mismatch is refused')
        reject([{**merged, 'valueExclTax': 30000.001}], 'sub-paisa amounts are refused')
        reject([], 'empty filing plan is refused')
        reject([None], 'null filing row is refused')
        reject([{**merged, 'quantity': 0}], 'zero quantity is refused')
        reject([{**merged, 'quantity': 1.5}], 'fractional quantity for whole unit is refused')
        reject([{**merged, 'quantity': 3.00001}], 'excess quantity precision is refused')
        reject([{**merged, 'sourceLineIds': ids+[ids[0]]}], 'duplicated source line is refused')
        reject([{**merged, 'sourceLineIds': ids[:-1]}], 'missing source line is refused')
        other_bill = create_bill()
        reject([{**merged, 'sourceLineIds': ids[:-1]+[other_bill['items'][0]['id']]}], 'foreign invoice source line is refused')
        reject([{**merged, 'itemTypeId': foreign['id']}], 'foreign company classification is refused')
        reject([{**merged, 'itemTypeId': table['id']}], 'incomplete HS classification is refused')
        # Forged metadata is ignored rather than filed.
        current = good('GET', path, admin)
        result = good('PUT', path, admin, {'version': current['version'], 'rows': [{**merged, 'hsCode': '0000.0000', 'saleType': 'forged', 'uom': 'forged', 'rateId': 999}]})
        check(result['rows'][0]['hsCode'] == filing1['hsCode'] and result['rows'][0]['uom'] == 'Nos' and result['rows'][0]['rateId'] is None, 'forged tax metadata is never trusted')
        separate = [{'sourceLineIds': [ids[0]], 'itemTypeId': filing1['id'], 'quantity': 1, 'valueExclTax': 12500},
                    {'sourceLineIds': ids[1:], 'itemTypeId': filing2['id'], 'quantity': 2, 'valueExclTax': 17500}]
        current = good('GET', path, admin)
        good('PUT', path, admin, {'version': current['version'], 'rows': separate})
        taxprint = good('GET', f'/api/invoices/{iid}/print/tax-invoice', admin)
        check(len(taxprint['items']) == 2 and {r['hsCode'] for r in taxprint['items']} == {filing1['hsCode'], filing2['hsCode']}, 'consultant can keep groups separate under different HS codes')
        # Three separately classified source lines stay separate even with identical HS codes.
        three = [{'sourceLineIds': [i['id']], 'itemTypeId': filing1['id'], 'quantity': 1, 'valueExclTax': i['lineTotal']} for i in bill['items']]
        current = good('GET', path, admin)
        good('PUT', path, admin, {'version': current['version'], 'rows': three})
        preview = good('GET', f'/api/fbr/{iid}/preview-payload', admin)
        payload = json.loads(preview['preview']['json'])
        check(len(payload['items']) == 3, 'explicit separate rows are not silently regrouped in FBR payload')
        # Money rounding and further tax survive a nontrivial decomposition.
        rounding = create_bill((0.03, 0.03, 0.04), further=4)
        rid = rounding['id']
        re = good('GET', f'/api/invoices/{rid}/tax-filing', admin)
        rr = [{'sourceLineIds': [i['id']], 'itemTypeId': filing1['id'], 'quantity': 1, 'valueExclTax': i['lineTotal']} for i in rounding['items']]
        good('PUT', f'/api/invoices/{rid}/tax-filing', admin, {'version': re['version'], 'rows': rr})
        rp = good('GET', f'/api/invoices/{rid}/print/tax-invoice', admin)
        check(round(sum(i['gstAmount'] for i in rp['items']), 2) == rounding['gstAmount'], 'rounding preserves document GST across tiny rows')
        if args.db:
            sql(f"UPDATE Invoices SET FbrSubmittedAt = GETUTCDATE() WHERE Id = {rid};")
            sp = good('GET', f'/api/reports/company/{a}/sales?year={today[:4]}', admin)
            rounding_report = next(i for i in sp['invoices'] if i['invoiceId'] == rid)
            check(rounding_report['totalTax'] == rounding['gstAmount'], 'sales report allocates the same tax pennies as print and payload')
            sql(f"UPDATE Invoices SET FbrSubmittedAt = NULL WHERE Id = {rid};")
        # A commercial edit at the same subtotal still invalidates the review.
        current = good('GET', path, admin)
        updated = good('PUT', f'/api/invoices/{iid}', admin, {'gstRate': 18, 'items': [{**i, 'description': i['description']+' revised'} for i in bill['items']]})
        changed = good('GET', path, admin)
        check(changed['requiresReview'] and changed['bill']['fbrAdjustmentStale'], 'same-total commercial edit requires a fresh review')
        preview = good('GET', f'/api/fbr/{iid}/preview-payload', admin)
        check(not preview.get('success'), 'stale filing cannot be previewed/submitted')
        check(req('GET', f'/api/invoices/{iid}/print/tax-invoice', admin)[0] == 400, 'stale tax invoice cannot be printed with mismatched header totals')
        reject(three, 'bill edit invalidates the consultant edit version', current['version'])
        good('PUT', path, admin, {'version': changed['version'], 'rows': separate})
        check(not good('GET', path, admin)['requiresReview'], 'reviewing current bill clears the stale state')
        good('PUT', f"/api/itemtypes/{table['id']}", admin, {'companyId': a, 'name': table['name'], 'uom': 'KG'})
        check(good('GET', path, admin)['requiresReview'], 'catalog propagation to source bill lines invalidates filing review')
        listed = good('GET', f'/api/invoices/company/{a}/paged?fbrFilter=ready', admin)
        check(not any(i['id'] == iid for i in listed['items']), 'source catalog change removes invoice from ready filter')
        good('PUT', f"/api/itemtypes/{table['id']}", admin, {'companyId': a, 'name': table['name'], 'uom': 'Nos'})
        current = good('GET', path, admin)
        good('PUT', path, admin, {'version': current['version'], 'rows': separate})
        # An existing narrow endpoint may not override an independent filing plan.
        status, _ = req('PATCH', f'/api/invoices/{iid}/itemtypes-and-qty', admin, {'writeMode': 'adjustment', 'items': [{'id': ids[0], 'itemTypeId': filing1['id'], 'quantity': 1, 'exactLineTotal': 12500}]})
        check(status == 400, 'legacy adjustment endpoint cannot overwrite a filing plan')
        claim = good('POST', '/api/tax-claim/claim-summary', admin, {'companyId': a, 'billDate': today, 'billGstRate': 18, 'periodCode': 'all-time', 'billRows': [{'hsCode': filing2['hsCode'], 'qty': 1, 'value': 100}]})
        check(claim['rows'][0]['bank']['soldValue'] == 17500, 'tax claim bank consumes the independent filing classification', claim['rows'][0])
        # Permission and tenant gates with a real consultant and a viewer.
        tokens = []
        for suffix, company_id in [('consultant', a), ('foreign', b), ('viewer', a), ('classifier', a)]:
            username = 'filing_'+suffix+'_'+stamp
            u = good('POST', '/api/users', admin, {'username': username, 'password': 'test1234', 'fullName': 'Filing test user', 'role': 'User'})
            created['users'].append(u['id'])
            keys = ['invoices.list.view'] + ([] if suffix == 'viewer' else ['invoices.manage.update.itemtype' if suffix == 'classifier' else 'invoices.manage.update.itemtype.qty'])
            role = good('POST', '/api/roles', admin, {'name': '[TEMP] Filing '+suffix+' '+stamp, 'tenantAdminUserId': u['id'], 'permissionKeys': keys})
            created['roles'].append(role['id'])
            good('PUT', f"/api/users/{u['id']}/roles", admin, {'roleIds': [role['id']]})
            good('PUT', f"/api/usercompanies/user/{u['id']}", admin, {'companyIds': [company_id]})
            tokens.append(good('POST', '/api/auth/login', body={'username': username, 'password': 'test1234'})['token'])
        current = good('GET', path, tokens[0])
        good('PUT', path, tokens[0], {'version': current['version'], 'rows': separate})
        check(True, 'assigned consultant can read and save its own invoice')
        check(req('GET', path, tokens[1])[0] == 403, 'other-company consultant cannot read filing rows')
        check(req('PUT', path, tokens[1], {'version': current['version'], 'rows': separate})[0] == 403, 'other-company consultant cannot write filing rows')
        check(req('GET', path, tokens[2])[0] == 200, 'assigned viewer can inspect filing rows')
        check(req('PUT', path, tokens[2], {'version': current['version'], 'rows': separate})[0] == 403, 'viewer cannot edit filing rows')
        current = good('GET', path, tokens[3])
        classified = good('PUT', path, tokens[3], {'version': current['version'], 'rows': [merged]})
        check(len(classified['rows']) == 1, 'HS-only consultant can combine unchanged source values')
        classified = good('PUT', path, tokens[3], {'version': classified['version'], 'rows': separate})
        check(len(classified['rows']) == 2, 'HS-only consultant can separate unchanged groups')
        status, _ = req('PUT', path, tokens[3], {'version': classified['version'], 'rows': [{**separate[0], 'quantity': 7}, separate[1]]})
        check(status == 400, 'HS-only consultant cannot change quantity')
        changed = [{**separate[0], 'valueExclTax': 12000}, {**separate[1], 'valueExclTax': 18000}]
        status, _ = req('PUT', path, tokens[3], {'version': classified['version'], 'rows': changed})
        check(status == 400, 'HS-only consultant cannot redistribute amounts')
        check(req('GET', path)[0] == 401, 'anonymous read is refused')
        physical = create_bill(extra=[{'description': 'Tracked physical item', 'quantity': 2, 'uom': 'Nos', 'unitPrice': 100, 'itemTypeId': filing1['id']}])
        physical_stock = good('GET', f'/api/stock/company/{a}/onhand', admin)
        check(any(row['itemTypeId'] == filing1['id'] and row['onHand'] == 98 for row in physical_stock), 'physical sale consumes exactly two stocked units')
        physical_editor = good('GET', f"/api/invoices/{physical['id']}/tax-filing", admin)
        good('PUT', f"/api/invoices/{physical['id']}/tax-filing", admin, {'version': physical_editor['version'], 'rows': [{'sourceLineIds': [physical['items'][0]['id']], 'itemTypeId': filing2['id'], 'quantity': 7, 'valueExclTax': 200}]})
        check(good('GET', f'/api/stock/company/{a}/onhand', admin) == physical_stock, 'different filing type and quantity do not move real stock')
        current = good('GET', path, admin)
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(lambda text: req('PUT', path, admin, {'version': current['version'], 'rows': [{**r, 'description': text} for r in separate]})[0], ['Concurrent A', 'Concurrent B']))
        check(sorted(statuses) == [200, 400], 'simultaneous same-version saves have exactly one winner', statuses)
        if args.db:
            for state in ('Submitting', 'Uncertain', 'Submitted'):
                sql(f"UPDATE Invoices SET FbrStatus = '{state}' WHERE Id = {iid};")
                current = good('GET', path, admin)
                check(req('PUT', path, admin, {'version': current['version'], 'rows': separate})[0] == 400, state+' invoice cannot change filing')
            sql(f"UPDATE Invoices SET FbrStatus = NULL, FbrSubmittedAt = NULL, FbrIRN = NULL WHERE Id = {iid};")
            # A full reversal retains the filed row while stock returns use the original items.
            current = good('GET', path, admin)
            good('PUT', path, admin, {'version': current['version'], 'rows': [merged]})
            sql(f"UPDATE Invoices SET FbrStatus = 'Submitted', FbrSubmittedAt = GETUTCDATE(), FbrIRN = '1234567890123DI000001' WHERE Id = {iid};")
            status, partial_error = req('POST', '/api/invoices/notes', admin, {'originalInvoiceId': iid, 'documentType': 10, 'reason': 'Return of goods', 'lines': [{'invoiceItemId': ids[0], 'quantity': 1}]})
            check(status == 400, 'unrepresentable partial refund is refused before creating a note', partial_error)
            note = good('POST', '/api/invoices/notes', admin, {'originalInvoiceId': iid, 'documentType': 10, 'reason': 'Return of goods', 'lines': []})
            np = good('GET', f"/api/invoices/{note['id']}/print/tax-invoice", admin)
            check(len(np['items']) == 1 and np['items'][0]['valueExclTax'] == 30000 and np['items'][0]['hsCode'] == filing1['hsCode'], 'full return reverses the exact filed row and classification')
            check(not good('GET', f"/api/invoices/{note['id']}/tax-filing", admin)['requiresReview'], 'note fingerprint survives a database round trip')
            reversed_claim = good('POST', '/api/tax-claim/claim-summary', admin, {'companyId': a, 'billDate': today, 'billGstRate': 18, 'periodCode': 'all-time', 'billRows': [{'hsCode': filing1['hsCode'], 'qty': 1, 'value': 100}]})
            check(reversed_claim['rows'][0]['bank']['soldValue'] == 0.1, 'credit note reverses consumption in the tax claim bank')
            # Remove the synthetic note and restore the fixture to an unsubmitted editable invoice.
            good('DELETE', f"/api/invoices/{note['id']}", admin)
            sql(f"UPDATE Invoices SET FbrStatus = NULL, FbrSubmittedAt = NULL, FbrIRN = NULL WHERE Id = {iid};")
            current = good('GET', path, admin)
            good('PUT', path, admin, {'version': current['version'], 'rows': separate})
            # A partial return of a separate filed row is representable and remains supported.
            partial_bill = create_bill()
            pid = partial_bill['id']
            pe = good('GET', f'/api/invoices/{pid}/tax-filing', admin)
            pl = partial_bill['items']
            pr = [{'sourceLineIds': [pl[0]['id']], 'itemTypeId': filing1['id'], 'quantity': 1, 'valueExclTax': 12500},
                  {'sourceLineIds': [i['id'] for i in pl[1:]], 'itemTypeId': filing2['id'], 'quantity': 2, 'valueExclTax': 17500}]
            good('PUT', f'/api/invoices/{pid}/tax-filing', admin, {'version': pe['version'], 'rows': pr})
            sql(f"UPDATE Invoices SET FbrStatus = 'Submitted', FbrSubmittedAt = GETUTCDATE(), FbrIRN = '1234567890123DI000002' WHERE Id = {pid};")
            partial_note = good('POST', '/api/invoices/notes', admin, {'originalInvoiceId': pid, 'documentType': 10, 'reason': 'Return of goods', 'lines': [{'invoiceItemId': pl[0]['id'], 'quantity': 1}]})
            pn = good('GET', f"/api/invoices/{partial_note['id']}/print/tax-invoice", admin)
            check(pn['items'][0]['valueExclTax'] == 12500 and pn['items'][0]['hsCode'] == filing1['hsCode'], 'representable partial return retains the selected filed row')
            good('PUT', f"/api/itemtypes/{table['id']}", admin, {'companyId': a, 'name': table['name'], 'uom': 'KG'})
            check(not good('GET', f"/api/invoices/{partial_note['id']}/tax-filing", admin)['requiresReview'], 'later catalog edits cannot invalidate an immutable return note')
            good('PUT', f"/api/itemtypes/{table['id']}", admin, {'companyId': a, 'name': table['name'], 'uom': 'Nos'})
        else:
            print('SKIP submission lock matrix: pass --db for local SQL fixtures', flush=True)
        if args.fixture:
            Path(args.fixture).write_text(json.dumps({'companyId': a, 'invoiceId': iid, 'invoiceNumber': bill['invoiceNumber'], 'itemTypeIds': [filing1['id'], filing2['id']], 'cleanup': created}), encoding='utf-8')
        print(f'{passed} passed, 0 failed', flush=True)
        success = True
        return 0
    finally:
        if not args.keep or not success:
            for uid in reversed(created['users']): req('DELETE', f'/api/users/{uid}', admin)
            for role in reversed(created['roles']): req('DELETE', f'/api/roles/{role}', admin)
            for cid in reversed(created['companies']): req('DELETE', f'/api/companies/{cid}', admin)


if __name__ == '__main__':
    raise SystemExit(main())
