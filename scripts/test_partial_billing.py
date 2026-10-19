"""Partial billing of delivery challans (local test database only).

A bill can carry only some lines of a challan. The lines left out move to a new
row of the same challan number that stays billable; rows of one challan that
end up together (both billed on one bill, or both unbilled) are merged back.

    python scripts/test_partial_billing.py --base http://localhost:5137 --database MyApp_Trader_Sync_Test
"""
import argparse, time
from urllib.parse import urlparse
import pyodbc
import test_basic_flows as flows

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--base', required=True)
p.add_argument('--database', required=True)
a = p.parse_args()
assert urlparse(a.base).hostname in ('localhost', '127.0.0.1')
assert a.database.endswith('_Test') and all(c.isalnum() or c == '_' for c in a.database)
db = pyodbc.connect('DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost\\MSSQLSERVER02;DATABASE=' + a.database
                    + ';Trusted_Connection=yes;TrustServerCertificate=yes;', autocommit=True)
token, company, client = flows.setup(a.base, 'admin', 'admin123')
cid = company['id']
assert db.execute('SELECT Name FROM Companies WHERE Id=?', cid).fetchone()[0] == company['name']
passed = 0
today = time.strftime('%Y-%m-%dT00:00:00Z', time.gmtime())


def check(label, ok, detail=''):
    global passed
    assert ok, f'{label} {detail}'
    passed += 1
    print('PASS ' + label, flush=True)


def call(method, path, body=None, expected=(200, 201, 204), auth=None):
    status, data = flows.http(method, path, a.base, token=auth or token, body=body)
    assert status in expected, (method, path, status, data)
    return data


def refused(method, path, body, needle=None, auth=None):
    status, data = flows.http(method, path, a.base, token=auth or token, body=body)
    msg = str((data or {}).get('error') or (data or {}).get('message') or data)
    return status in (400, 403, 404, 409) and (needle is None or needle.lower() in msg.lower()), (status, msg)


def challan(lines, po='PO-PART-1', customer=None, company_id=None):
    return call('POST', f'/api/deliverychallans/company/{company_id or cid}', {
        'clientId': (customer or client)['id'], 'poNumber': po, 'poDate': today if po else None,
        'deliveryDate': today, 'items': lines})


def line(desc, qty, **extra):
    return dict({'description': desc, 'quantity': qty, 'unit': 'Pcs'}, **extra)


def bill(challans, lines, prices=None, expected=(200, 201)):
    return call('POST', '/api/invoices', {
        'companyId': cid, 'clientId': client['id'], 'date': today, 'gstRate': 18,
        'challanIds': [c['id'] for c in challans],
        'items': [{'deliveryItemId': i['id'], 'unitPrice': (prices or {}).get(i['id'], 100)} for i in lines]}, expected)


def rows(number):
    return [dict(zip(['id', 'invoiceId', 'status', 'splitFrom', 'lines'], r)) for r in db.execute(
        'SELECT c.Id, c.InvoiceId, c.Status, c.SplitFromChallanId, '
        '(SELECT STRING_AGG(Description, \'|\') WITHIN GROUP (ORDER BY Id) FROM DeliveryItems d WHERE d.DeliveryChallanId = c.Id) '
        'FROM DeliveryChallans c WHERE c.CompanyId=? AND c.ChallanNumber=? ORDER BY c.Id', cid, number).fetchall()]


def pending_ids():
    return {c['id'] for c in call('GET', f'/api/deliverychallans/company/{cid}/pending')}


def options(bill_id):
    return call('GET', f'/api/invoices/{bill_id}/challans')


def edit(bill_id, ids, leave_out=(), prices=None, expected=(200,)):
    snap = options(bill_id)
    added = [r for r in snap['available'] if r['id'] in ids]
    out = set(leave_out)
    return call('PUT', f'/api/invoices/{bill_id}/challans', {
        'version': snap['version'], 'challanIds': ids,
        'addedChallanVersions': {str(r['id']): r['version'] for r in added},
        'unitPrices': prices if prices is not None else {str(i['id']): 50 for r in added for i in r['items'] if i['id'] not in out},
        'leaveOutDeliveryItemIds': list(out)}, expected)


# ── 1. Create: bill two of three lines of one challan, plus a whole challan ──
A = challan([line('Part A1', 2), line('Part A2', 3), line('Part A3', 4)])
B = challan([line('Whole B1', 1)], po='')
b1 = bill([A, B], [A['items'][0], A['items'][1], B['items'][0]])
r = rows(A['challanNumber'])
check('the bill carries only the ticked lines', sorted(i['description'] for i in b1['items']) == ['Part A1', 'Part A2', 'Whole B1'])
check('the original row keeps the billed lines and the bill', len(r) == 2 and r[0]['id'] == A['id'] and r[0]['invoiceId'] == b1['id']
      and r[0]['status'] == 'Invoiced' and r[0]['lines'] == 'Part A1|Part A2', str(r))
check('the left-out line moves to a billable row of the same number', r[1]['invoiceId'] is None and r[1]['status'] == 'Pending'
      and r[1]['splitFrom'] == A['id'] and r[1]['lines'] == 'Part A3', str(r))
check('subtotal is the billed lines only', b1['subtotal'] == (2 + 3 + 1) * 100)
split = r[1]['id']
check('the remaining row is offered for billing', split in pending_ids() and A['id'] not in pending_ids())
listed = {c['id']: c for c in call('GET', f'/api/deliverychallans/company/{cid}/paged?page=1&pageSize=100')['items']}
check('both rows show as partially billed', listed[A['id']]['isPartiallyBilled'] and listed[split]['isPartiallyBilled']
      and listed[split]['splitFromChallanId'] == A['id'])
check('a fully billed challan is not partial', not listed[B['id']]['isPartiallyBilled'] and listed[B['id']]['status'] == 'Invoiced')

# ── 2. Refusals on create ──
C = challan([line('Refuse C1', 1), line('Refuse C2', 1)])
ok, why = refused('POST', '/api/invoices', {'companyId': cid, 'clientId': client['id'], 'date': today, 'gstRate': 18,
                  'challanIds': [C['id'], B['id']], 'items': []}, None)
check('a challan with no ticked line is refused', ok, str(why))
D = challan([line('Solo D1', 1)])
ok, why = refused('POST', '/api/invoices', {'companyId': cid, 'clientId': client['id'], 'date': today, 'gstRate': 18,
                  'challanIds': [C['id'], D['id']], 'items': [{'deliveryItemId': C['items'][0]['id'], 'unitPrice': 1}]},
                  'untick the whole challan')
check('ticking a challan but none of its lines says to untick the challan', ok, str(why))
ok, why = refused('POST', '/api/invoices', {'companyId': cid, 'clientId': client['id'], 'date': today, 'gstRate': 18,
                  'challanIds': [C['id']], 'items': [{'deliveryItemId': C['items'][0]['id'], 'unitPrice': 1},
                                                     {'deliveryItemId': C['items'][0]['id'], 'unitPrice': 1}]}, 'twice')
check('the same delivery line twice is refused', ok, str(why))
check('a refused bill changes no challan', len(rows(C['challanNumber'])) == 1 and rows(C['challanNumber'])[0]['status'] == 'Pending')

# ── 3. The remaining line is billed later on another bill ──
S = call('GET', f'/api/deliverychallans/{split}')
b2 = bill([S], S['items'])
r = rows(A['challanNumber'])
check('the remaining row bills on its own', r[1]['invoiceId'] == b2['id'] and r[1]['status'] == 'Invoiced' and b2['subtotal'] == 400)
listed = {c['id']: c for c in call('GET', f'/api/deliverychallans/company/{cid}/paged?page=1&pageSize=100')['items']}
check('all rows billed: no longer partial', not listed[A['id']]['isPartiallyBilled'])

# ── 4. Editor: leave out a billed line of a kept challan ──
before = call('GET', f'/api/invoices/{b1["id"]}')
a2 = A['items'][1]['id']
after = edit(b1['id'], [A['id'], B['id']], leave_out=[a2])
r = rows(A['challanNumber'])
check('the left-out line leaves the bill', all(i['deliveryItemId'] != a2 for i in after['items']) and after['subtotal'] == before['subtotal'] - 300)
check('it is back on a billable row', any(x['invoiceId'] is None and x['lines'] == 'Part A2' and x['splitFrom'] == A['id'] for x in r), str(r))
check('GST follows the new subtotal', abs(after['gstAmount'] - round(after['subtotal'] * 0.18, 2)) < 0.01)
pending_a2 = next(x['id'] for x in r if x['lines'] == 'Part A2')

# ── 5. Editor: add that row back — it merges into the original row ──
again = edit(b1['id'], [A['id'], B['id'], pending_a2], prices={str(a2): 150})
r = rows(A['challanNumber'])
check('re-added line is billed at the entered rate', any(i['deliveryItemId'] == a2 and i['unitPrice'] == 150 for i in again['items']))
check('rows of one challan on one bill merge back', not any(x['id'] == pending_a2 for x in r)
      and next(x for x in r if x['id'] == A['id'])['lines'] == 'Part A1|Part A2', str(r))

# ── 6. Editor: add a new challan but leave one of its lines out ──
E = challan([line('Edit E1', 1), line('Edit E2', 1)])
e2 = E['items'][1]['id']
withE = edit(b1['id'], [A['id'], B['id'], E['id']], leave_out=[e2], prices={str(E['items'][0]['id']): 70})
r = rows(E['challanNumber'])
check('an added challan can be billed in part', any(i['deliveryItemId'] == E['items'][0]['id'] for i in withE['items'])
      and all(i['deliveryItemId'] != e2 for i in withE['items']))
check('its left-out line stays billable', len(r) == 2 and r[1]['invoiceId'] is None and r[1]['lines'] == 'Edit E2', str(r))
snap = options(b1['id'])
ok, why = refused('PUT', f'/api/invoices/{b1["id"]}/challans', {'version': snap['version'], 'challanIds': [A['id'], B['id'], E['id']],
                  'addedChallanVersions': {}, 'unitPrices': {}, 'leaveOutDeliveryItemIds': [i['id'] for i in A['items'][:2]]},
                  'remove the whole challan')
check('leaving out every line of a kept challan says to remove it instead', ok, str(why))
ok, why = refused('PUT', f'/api/invoices/{b1["id"]}/challans', {'version': snap['version'], 'challanIds': [A['id'], B['id'], E['id']],
                  'addedChallanVersions': {}, 'unitPrices': {}, 'leaveOutDeliveryItemIds': [C['items'][0]['id']]}, 'not on a selected challan')
check('a line from an unselected challan cannot be left out', ok, str(why))
ok, why = refused('PUT', f'/api/invoices/{b1["id"]}/challans', {'version': 'stale', 'challanIds': [A['id'], B['id']],
                  'addedChallanVersions': {}, 'unitPrices': {}, 'leaveOutDeliveryItemIds': []}, 'changed')
check('a stale editor is refused', ok, str(why))

# ── 7. Removing a whole challan from the bill joins it with its unbilled row ──
edit(b1['id'], [A['id'], B['id']])
r = rows(E['challanNumber'])
check('a removed challan and its unbilled row become one challan again', len(r) == 1 and r[0]['invoiceId'] is None
      and r[0]['lines'] == 'Edit E1|Edit E2' and r[0]['status'] == 'Pending', str(r))

# ── 8. Deleting / voiding a bill hands every row back as one challan ──
F = challan([line('Void F1', 1), line('Void F2', 1)], po='')
bf = bill([F], [F['items'][0]])
check('a PO-less left-out line returns as No PO', rows(F['challanNumber'])[1]['status'] == 'No PO')
call('POST', f'/api/invoices/{bf["id"]}/cancel', {'reason': 'test void'}, expected=(200, 204))
r = rows(F['challanNumber'])
check('voiding the bill makes the challan whole and billable', len(r) == 1 and r[0]['invoiceId'] is None
      and r[0]['lines'] == 'Void F1|Void F2' and r[0]['status'] == 'No PO', str(r))
G = challan([line('Del G1', 1), line('Del G2', 1)])
bg = bill([G], [G['items'][1]])
call('DELETE', f'/api/invoices/{bg["id"]}', expected=(200, 204))
r = rows(G['challanNumber'])
check('deleting the bill makes the challan whole and billable', len(r) == 1 and r[0]['invoiceId'] is None
      and r[0]['lines'] == 'Del G1|Del G2' and r[0]['status'] == 'Pending', str(r))

# ── 9. Editing a billed challan still updates its bill ──
H = challan([line('Sync H1', 2), line('Sync H2', 5)])
bh = bill([H], [H['items'][0]], prices={H['items'][0]['id']: 10})
snap = call('GET', f"/api/deliverychallans/{H['id']}/bill-edit")
body = {'version': snap['challan']['version'], 'billVersion': snap['billVersion'],
        'items': [dict(i, quantity=7, billUnitPrice=10) for i in snap['challan']['items']]}
call('PUT', f"/api/deliverychallans/{H['id']}/bill-edit", body)
bh2 = call('GET', f'/api/invoices/{bh["id"]}')
check('a quantity change on the billed row updates the bill', bh2['items'][0]['quantity'] == 7 and bh2['subtotal'] == 70)
check('the left-out row is untouched by that edit', rows(H['challanNumber'])[1]['lines'] == 'Sync H2')

# ── 10. Supplier purchases follow the line, and a paid one pins it ──
sup = call('POST', '/api/suppliers', {'companyId': cid, 'name': f'Part supplier {time.time_ns()}'})
J = challan([line('Cost J1', 1, supplierId=sup['id'], actualUnitCost=5), line('Cost J2', 2, supplierId=sup['id'], actualUnitCost=7)])
src = lambda item_id: db.execute('SELECT pb.SourceDeliveryChallanId FROM PurchaseItems pi JOIN PurchaseBills pb ON pb.Id = pi.PurchaseBillId '
                                 'WHERE pi.LocalDeliveryItemId = ?', item_id).fetchall()
j2 = J['items'][1]['id']
check('a costed line books an automatic purchase on its challan', [r[0] for r in src(j2)] == [J['id']])
bj = bill([J], [J['items'][0]])
moved = next(x['id'] for x in rows(J['challanNumber']) if x['lines'] == 'Cost J2')
check('its open purchase moves with the left-out line', [r[0] for r in src(j2)] == [moved])
check('the billed line keeps its purchase on the original row', [r[0] for r in src(J['items'][0]['id'])] == [J['id']])
db.execute('UPDATE PurchaseBills SET AmountPaid = 1 WHERE SourceDeliveryChallanId = ?', J['id'])
snap = options(bj['id'])
K = challan([line('Cost K1', 1), line('Cost K2', 1)])
ok, why = refused('PUT', f'/api/invoices/{bj["id"]}/challans', {'version': snap['version'], 'challanIds': [J['id'], K['id']],
                  'addedChallanVersions': {}, 'unitPrices': {}, 'leaveOutDeliveryItemIds': [J['items'][0]['id']]}, None)
check('a line on a paid supplier bill cannot be left out', ok, str(why))

# ── 11. FBR: a submitted bill is locked ──
L = challan([line('Fbr L1', 1), line('Fbr L2', 1)])
bl = bill([L], L['items'])
db.execute("UPDATE Invoices SET FbrIRN = 'TEST-IRN-PART', FbrStatus = 'Submitted', FbrSubmittedAt = SYSUTCDATETIME() WHERE Id = ?", bl['id'])
status, _ = flows.http('GET', f'/api/invoices/{bl["id"]}/challans', a.base, token=token)
check('a bill submitted to FBR cannot change its challans', status == 400)
status, _ = flows.http('PUT', f'/api/invoices/{bl["id"]}/challans', a.base, token=token, body={
    'version': 'x', 'challanIds': [L['id']], 'addedChallanVersions': {}, 'unitPrices': {}, 'leaveOutDeliveryItemIds': [L['items'][1]['id']]})
check('nor leave a line out', status == 400 and len(rows(L['challanNumber'])) == 1)

# ── 12. Another company's user reaches none of it ──
other = call('POST', '/api/companies', {'name': f'[TEMP] Partial other {time.time_ns()}', 'startingChallanNumber': 1, 'startingInvoiceNumber': 1})
roles = call('GET', '/api/roles')
sales = next(r['id'] for r in roles if r['name'] == 'Sales Edition')
uname = f'partial{time.time_ns()}'
u = call('POST', '/api/users', {'username': uname, 'password': 'Testpartial12345', 'fullName': 'Partial tester', 'role': 'User'})
try:
    call('PUT', f"/api/users/{u['id']}/roles", {'roleIds': [sales]})
    call('PUT', f"/api/usercompanies/user/{u['id']}", {'companyIds': [other['id']]})
    ut = call('POST', '/api/auth/login', {'username': uname, 'password': 'Testpartial12345'})['token']
    status, _ = flows.http('GET', f'/api/invoices/{b1["id"]}/challans', a.base, token=ut)
    check('another company cannot read the bill challans', status in (403, 404))
    status, _ = flows.http('PUT', f'/api/invoices/{b1["id"]}/challans', a.base, token=ut, body={
        'version': 'x', 'challanIds': [A['id']], 'addedChallanVersions': {}, 'unitPrices': {}, 'leaveOutDeliveryItemIds': [A['items'][0]['id']]})
    check('nor leave a line out of it', status in (403, 404))
    M = challan([line('Tenant M1', 1), line('Tenant M2', 1)])
    status, _ = flows.http('POST', '/api/invoices', a.base, token=ut, body={'companyId': cid, 'clientId': client['id'], 'date': today,
        'gstRate': 18, 'challanIds': [M['id']], 'items': [{'deliveryItemId': M['items'][0]['id'], 'unitPrice': 1}]})
    check('nor bill part of its challan', status in (403, 404) and len(rows(M['challanNumber'])) == 1)
finally:
    flows.http('DELETE', f"/api/users/{u['id']}", a.base, token=token)
    flows.http('DELETE', f"/api/companies/{other['id']}", a.base, token=token)

print(f'\n{passed}/{passed} partial billing checks passed')
