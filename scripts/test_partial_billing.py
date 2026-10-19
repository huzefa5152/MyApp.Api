"""Partial billing + managing a bill's challans (local test database only).

Ported from the Trader line (scripts/test_partial_billing.py there). A bill can
carry only some lines of a challan. The lines left out move to a new row of the
same challan number that stays billable; rows of one challan that end up
together (both billed on one bill, or both unbilled) are merged back. The bill
editor (GET/PUT /api/invoices/{id}/challans) keeps / removes / adds challans
and leaves single lines out; the billed-delivery editor
(GET/PUT /api/deliverychallans/{id}/bill-edit) edits a billed challan and its
bill together.

Customize adaptations (each one is a real difference of this line):
  * every bill line must be classified here, so challan lines carry an item type;
  * create refuses a zero unit price, so every create sends a positive price;
  * a reduced billed quantity keeps the delivered one in DeliveredQuantity;
    a left-out line is not billed, so it keeps (or gets back) its delivered qty;
  * supplier purchases here are made from a WHOLE challan (one reviewed batch),
    so a challan with purchase bills keeps its lines together (no leave-out);
  * no "Sales Edition" role here: the outsider is an Administrator of another company;
  * RequireSalesOrderForBilling companies refuse an added challan with no order.

    python scripts/test_partial_billing.py --base http://localhost:5138 --database MyApp_Customize_Feature_Test
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
item_type = flows.first_item_type_id(a.base, token)
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
    msg = str((data or {}).get('error') or (data or {}).get('message') or data) if isinstance(data, dict) else str(data)
    return status in (400, 403, 404, 409) and (needle is None or needle.lower() in msg.lower()), (status, msg)


def challan(lines, po='PO-PART-1', customer=None, company_id=None):
    return call('POST', f'/api/deliverychallans/company/{company_id or cid}', {
        'clientId': (customer or client)['id'], 'poNumber': po, 'poDate': today if po else None,
        'deliveryDate': today, 'items': lines})


def line(desc, qty, **extra):
    return dict({'description': desc, 'quantity': qty, 'unit': 'Pcs', 'itemTypeId': item_type}, **extra)


def bill(challans, lines, prices=None, qty=None, expected=(200, 201), company_id=None, customer=None):
    return call('POST', '/api/invoices', {
        'companyId': company_id or cid, 'clientId': (customer or client)['id'], 'date': today, 'gstRate': 18,
        'challanIds': [c['id'] for c in challans],
        'items': [dict({'deliveryItemId': i['id'], 'unitPrice': (prices or {}).get(i['id'], 100)},
                       **({'quantity': qty[i['id']]} if qty and i['id'] in qty else {})) for i in lines]}, expected)


def rows(number, company_id=None):
    return [dict(zip(['id', 'invoiceId', 'status', 'splitFrom', 'lines'], r)) for r in db.execute(
        'SELECT c.Id, c.InvoiceId, c.Status, c.SplitFromChallanId, '
        '(SELECT STRING_AGG(Description, \'|\') WITHIN GROUP (ORDER BY Id) FROM DeliveryItems d WHERE d.DeliveryChallanId = c.Id) '
        'FROM DeliveryChallans c WHERE c.CompanyId=? AND c.ChallanNumber=? ORDER BY c.Id', company_id or cid, number).fetchall()]


def qty_of(item_id):
    return tuple(float(x) if x is not None else None for x in db.execute(
        'SELECT Quantity, DeliveredQuantity FROM DeliveryItems WHERE Id=?', item_id).fetchone())


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


def edit_body(bill_id, ids, leave_out=()):
    snap = options(bill_id)
    return {'version': snap['version'], 'challanIds': ids, 'addedChallanVersions': {}, 'unitPrices': {},
            'leaveOutDeliveryItemIds': list(leave_out)}


def listed():
    return {c['id']: c for c in call('GET', f'/api/deliverychallans/company/{cid}/paged?page=1&pageSize=100')['items']}


try:
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
    L = listed()
    check('both rows show as partially billed', L[A['id']]['isPartiallyBilled'] and L[split]['isPartiallyBilled']
          and L[split]['splitFromChallanId'] == A['id'])
    check('a fully billed challan is not partial', not L[B['id']]['isPartiallyBilled'] and L[B['id']]['status'] == 'Invoiced')

    # ── 2. Refusals on create ──
    C = challan([line('Refuse C1', 1), line('Refuse C2', 1)])
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
    check('all rows billed: no longer partial', not listed()[A['id']]['isPartiallyBilled'])

    # ── 4. Editor: leave out a billed line of a kept challan ──
    before = call('GET', f'/api/invoices/{b1["id"]}')
    a2 = A['items'][1]['id']
    after = edit(b1['id'], [A['id'], B['id']], leave_out=[a2])
    r = rows(A['challanNumber'])
    check('the left-out line leaves the bill', all(i['deliveryItemId'] != a2 for i in after['items']) and after['subtotal'] == before['subtotal'] - 300)
    check('it is back on a billable row', any(x['invoiceId'] is None and x['lines'] == 'Part A2' and x['splitFrom'] == A['id'] for x in r), str(r))
    check('GST follows the new subtotal', abs(after['gstAmount'] - round(after['subtotal'] * 0.18, 2)) < 0.01)
    check('the change is audited', db.execute("SELECT COUNT(*) FROM AuditLogs WHERE ExceptionType='BILL_CHALLANS_CHANGED' AND CompanyId=?", cid).fetchone()[0] >= 1)
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
    check('an added challan can be billed in part', any(i['deliveryItemId'] == E['items'][0]['id'] and i['unitPrice'] == 70 for i in withE['items'])
          and all(i['deliveryItemId'] != e2 for i in withE['items']))
    check('its left-out line stays billable', len(r) == 2 and r[1]['invoiceId'] is None and r[1]['lines'] == 'Edit E2', str(r))
    ok, why = refused('PUT', f'/api/invoices/{b1["id"]}/challans', edit_body(b1['id'], [A['id'], B['id'], E['id']],
                      [i['id'] for i in A['items'][:2]]), 'remove the whole challan')
    check('leaving out every line of a kept challan says to remove it instead', ok, str(why))
    ok, why = refused('PUT', f'/api/invoices/{b1["id"]}/challans', edit_body(b1['id'], [A['id'], B['id'], E['id']],
                      [C['items'][0]['id']]), 'not on a selected challan')
    check('a line from an unselected challan cannot be left out', ok, str(why))
    ok, why = refused('PUT', f'/api/invoices/{b1["id"]}/challans', {'version': 'stale', 'challanIds': [A['id'], B['id']],
                      'addedChallanVersions': {}, 'unitPrices': {}, 'leaveOutDeliveryItemIds': []}, 'changed')
    check('a stale editor is refused', ok, str(why))
    body = edit_body(b1['id'], [A['id'], B['id'], E['id'], C['id']])
    body['addedChallanVersions'] = {str(C['id']): 'x'}
    ok, why = refused('PUT', f'/api/invoices/{b1["id"]}/challans', body, 'changed')
    check('an added challan that changed since it was listed is refused', ok, str(why))

    # ── 7. Removing a whole challan from the bill joins it with its unbilled row ──
    edit(b1['id'], [A['id'], B['id']])
    r = rows(E['challanNumber'])
    check('a removed challan and its unbilled row become one challan again', len(r) == 1 and r[0]['invoiceId'] is None
          and r[0]['lines'] == 'Edit E1|Edit E2' and r[0]['status'] == 'Pending', str(r))
    nb = edit(b1['id'], [A['id']])
    check('a removed PO-less challan returns as No PO', rows(B['challanNumber'])[0]['status'] == 'No PO'
          and rows(B['challanNumber'])[0]['invoiceId'] is None and nb['subtotal'] == 200 + 450)

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

    # ── 9. Editing a billed challan updates its bill ──
    H = challan([line('Sync H1', 2), line('Sync H2', 5)])
    bh = bill([H], [H['items'][0]], prices={H['items'][0]['id']: 10})
    snap = call('GET', f"/api/deliverychallans/{H['id']}/bill-edit")
    body = {'version': snap['challan']['version'], 'billVersion': snap['billVersion'],
            'items': [dict(i, quantity=7, billUnitPrice=10) for i in snap['challan']['items']]
                     + [{'id': 0, 'description': 'Sync H3 new', 'quantity': 2, 'unit': 'Pcs', 'itemTypeId': item_type, 'billUnitPrice': 25}]}
    call('PUT', f"/api/deliverychallans/{H['id']}/bill-edit", body)
    bh2 = call('GET', f'/api/invoices/{bh["id"]}')
    h1 = next(i for i in bh2['items'] if i['deliveryItemId'] == H['items'][0]['id'])
    check('a quantity change on the billed row updates the bill', h1['quantity'] == 7 and h1['lineTotal'] == 70)
    check('a new delivery line joins the bill at its entered rate', any(i['description'] == 'Sync H3 new' and i['unitPrice'] == 25 for i in bh2['items'])
          and bh2['subtotal'] == 120 and abs(bh2['gstAmount'] - 21.6) < 0.01)
    check('the left-out row is untouched by that edit', rows(H['challanNumber'])[1]['lines'] == 'Sync H2')
    ok, why = refused('PUT', f"/api/deliverychallans/{H['id']}/bill-edit", body, 'changed')
    check('a stale billed-delivery edit is refused', ok, str(why))
    snap = call('GET', f"/api/deliverychallans/{H['id']}/bill-edit")
    keep = [dict(i, billUnitPrice=10) for i in snap['challan']['items'] if i['description'] != 'Sync H3 new']
    call('PUT', f"/api/deliverychallans/{H['id']}/bill-edit", {'version': snap['challan']['version'], 'billVersion': snap['billVersion'], 'items': keep})
    bh3 = call('GET', f'/api/invoices/{bh["id"]}')
    check('a removed delivery line leaves the bill', all(i['description'] != 'Sync H3 new' for i in bh3['items']) and bh3['subtotal'] == 70)

    # ── 10. Customize: a reduced billed quantity plus a left-out line on one bill ──
    Q = challan([line('Qty Q1', 10), line('Qty Q2', 5), line('Qty Q3', 4)])
    q1, q2, q3 = (i['id'] for i in Q['items'])
    bq = bill([Q], Q['items'][:2], qty={q1: 7})
    check('the reduced line bills 7 and keeps 10 as delivered', qty_of(q1) == (7.0, 10.0)
          and next(i for i in bq['items'] if i['deliveryItemId'] == q1)['quantity'] == 7)
    check('the left-out line keeps its delivered quantity, untouched', qty_of(q3) == (4.0, None)
          and next(x for x in rows(Q['challanNumber']) if x['lines'] == 'Qty Q3')['invoiceId'] is None)
    edit(bq['id'], [Q['id']], leave_out=[q1])
    check('leaving the reduced line out in the editor gives back its delivered 10', qty_of(q1) == (10.0, None))
    r = rows(Q['challanNumber'])
    check('it joins the pending row of the same challan', any(x['invoiceId'] is None and x['lines'] == 'Qty Q1|Qty Q3' for x in r), str(r))
    call('DELETE', f'/api/invoices/{bq["id"]}', expected=(200, 204))
    r = rows(Q['challanNumber'])
    check('deleting that bill makes the challan whole with its full quantities', len(r) == 1 and r[0]['lines'] == 'Qty Q1|Qty Q2|Qty Q3'
          and qty_of(q1) == (10.0, None) and qty_of(q2) == (5.0, None), str(r))

    # ── 11. Supplier purchases made from a challan keep its lines together ──
    sup = call('POST', '/api/suppliers', {'companyId': cid, 'name': f'Part supplier {time.time_ns()}'})
    J = challan([line('Cost J1', 1, supplierId=sup['id'], actualUnitCost=5), line('Cost J2', 2, supplierId=sup['id'], actualUnitCost=7)])
    call('POST', f"/api/purchasebills/from-challan/{J['id']}")
    ok, why = refused('POST', '/api/invoices', {'companyId': cid, 'clientId': client['id'], 'date': today, 'gstRate': 18,
                      'challanIds': [J['id']], 'items': [{'deliveryItemId': J['items'][0]['id'], 'unitPrice': 10}]}, 'purchase')
    check('a challan with supplier purchase bills cannot be billed in part', ok, str(why))
    check('and stays one pending row', len(rows(J['challanNumber'])) == 1 and rows(J['challanNumber'])[0]['status'] == 'Pending')
    bj = bill([J], J['items'], prices={J['items'][0]['id']: 10, J['items'][1]['id']: 10})
    ok, why = refused('PUT', f'/api/invoices/{bj["id"]}/challans', edit_body(bj['id'], [J['id']], [J['items'][0]['id']]), 'purchase')
    check('nor have a line left out in the editor', ok, str(why))
    ok, why = refused('PUT', f"/api/deliverychallans/{J['id']}/cancel", None, 'purchase')
    check('nor be cancelled off its bill', ok, str(why))

    # ── 12. Guards on the editor ──
    K = challan([line('Guard K1', 1), line('Guard K2', 1)])
    bk = bill([K], K['items'])
    db.execute('UPDATE Companies SET GlLockDate = ? WHERE Id = ?', today[:10], cid)
    ok, why = refused('PUT', f'/api/invoices/{bk["id"]}/challans', edit_body(bk['id'], [K['id']], [K['items'][1]['id']]), 'locked')
    db.execute('UPDATE Companies SET GlLockDate = NULL WHERE Id = ?', cid)
    check('a bill in a locked accounting period cannot change its challans', ok, str(why))
    db.execute('UPDATE Invoices SET OriginalInvoiceId = ? WHERE Id = ?', bk['id'], b2['id'])
    ok, why = refused('PUT', f'/api/invoices/{bk["id"]}/challans', edit_body(bk['id'], [K['id']], [K['items'][1]['id']]), 'credit or debit note')
    db.execute('UPDATE Invoices SET OriginalInvoiceId = NULL WHERE Id = ?', b2['id'])
    check('a bill with a live credit or debit note cannot change its challans', ok, str(why))
    db.execute('UPDATE Invoices SET AmountPaid = GrandTotal WHERE Id = ?', bk['id'])
    ok, why = refused('PUT', f'/api/invoices/{bk["id"]}/challans', edit_body(bk['id'], [K['id']], [K['items'][1]['id']]), 'receipts')
    db.execute('UPDATE Invoices SET AmountPaid = 0 WHERE Id = ?', bk['id'])
    check('receipts already allocated must still be covered', ok, str(why) )
    check('refused edits left the challan whole', len(rows(K['challanNumber'])) == 1)
    db.execute('UPDATE Companies SET RequireSalesOrderForBilling = 1 WHERE Id = ?', cid)
    M0 = challan([line('Order M0', 1)])
    snap = options(bk['id'])
    m0 = next(r for r in snap['available'] if r['id'] == M0['id'])
    ok, why = refused('PUT', f'/api/invoices/{bk["id"]}/challans', {'version': snap['version'], 'challanIds': [K['id'], M0['id']],
                      'addedChallanVersions': {str(M0['id']): m0['version']}, 'unitPrices': {str(M0['items'][0]['id']): 5},
                      'leaveOutDeliveryItemIds': []}, 'sales order')
    db.execute('UPDATE Companies SET RequireSalesOrderForBilling = 0 WHERE Id = ?', cid)
    check('a sales-order-only company refuses an added challan with no order', ok, str(why))

    # ── 13. FBR: a submitted bill is locked ──
    Lc = challan([line('Fbr L1', 1), line('Fbr L2', 1)])
    bl = bill([Lc], Lc['items'])
    db.execute("UPDATE Invoices SET FbrIRN = 'TEST-IRN-PART', FbrStatus = 'Submitted', FbrSubmittedAt = SYSUTCDATETIME() WHERE Id = ?", bl['id'])
    status, _ = flows.http('GET', f'/api/invoices/{bl["id"]}/challans', a.base, token=token)
    check('a bill submitted to FBR cannot change its challans', status == 400)
    status, _ = flows.http('PUT', f'/api/invoices/{bl["id"]}/challans', a.base, token=token, body={
        'version': 'x', 'challanIds': [Lc['id']], 'addedChallanVersions': {}, 'unitPrices': {}, 'leaveOutDeliveryItemIds': [Lc['items'][1]['id']]})
    check('nor leave a line out', status == 400 and len(rows(Lc['challanNumber'])) == 1)
    status, _ = flows.http('GET', f"/api/deliverychallans/{Lc['id']}/bill-edit", a.base, token=token)
    check('nor edit its delivery together with the bill', status == 400)

    # ── 13b. A challan attached to a standalone bill for reference has no billed line ──
    N = challan([line('Attach N1', 1), line('Attach N2', 1)])
    sb = call('POST', '/api/invoices/standalone', {'companyId': cid, 'clientId': client['id'], 'date': today, 'gstRate': 18,
              'items': [{'description': 'Typed service line', 'quantity': 1, 'uom': 'Pcs', 'unitPrice': 500, 'itemTypeId': item_type}]})
    call('POST', f"/api/invoices/{sb['id']}/link-challan/{N['id']}")
    ok, why = refused('PUT', f"/api/invoices/{sb['id']}/challans", edit_body(sb['id'], [N['id']], [N['items'][0]['id']]), 'only lines on this bill')
    check('a line of an attached challan cannot be left out', ok and len(rows(N['challanNumber'])) == 1, str(why))
    detached = edit(sb['id'], [])
    r = rows(N['challanNumber'])
    check('removing an attached challan detaches it and leaves the typed bill lines alone',
          len(r) == 1 and r[0]['invoiceId'] is None and detached['subtotal'] == sb['subtotal'], str(r))

    # ── 14. Another company's user reaches none of it ──
    other = call('POST', '/api/companies', {'name': f'[TEMP] Partial other {time.time_ns()}', 'startingChallanNumber': 1, 'startingInvoiceNumber': 1})
    admin_role = next(r['id'] for r in call('GET', '/api/roles') if r['name'] == 'Administrator')
    uname = f'partial{time.time_ns()}'
    u = call('POST', '/api/users', {'username': uname, 'password': 'Testpartial12345', 'fullName': 'Partial tester', 'role': 'Administrator'})
    try:
        call('PUT', f"/api/users/{u['id']}/roles", {'roleIds': [admin_role]})
        call('PUT', f"/api/usercompanies/user/{u['id']}", {'companyIds': [other['id']]})
        ut = call('POST', '/api/auth/login', {'username': uname, 'password': 'Testpartial12345'})['token']
        status, _ = flows.http('GET', f'/api/invoices/{b1["id"]}/challans', a.base, token=ut)
        check('another company cannot read the bill challans', status in (403, 404))
        status, _ = flows.http('PUT', f'/api/invoices/{b1["id"]}/challans', a.base, token=ut, body={
            'version': 'x', 'challanIds': [A['id']], 'addedChallanVersions': {}, 'unitPrices': {}, 'leaveOutDeliveryItemIds': [A['items'][0]['id']]})
        check('nor leave a line out of it', status in (403, 404))
        status, _ = flows.http('GET', f"/api/deliverychallans/{H['id']}/bill-edit", a.base, token=ut)
        check('nor open a billed delivery with its bill', status in (403, 404))
        status, _ = flows.http('PUT', f"/api/deliverychallans/{H['id']}/bill-edit", a.base, token=ut, body={'version': 'x', 'billVersion': 'x', 'items': []})
        check('nor edit it', status in (403, 404))
        M = challan([line('Tenant M1', 1), line('Tenant M2', 1)])
        status, _ = flows.http('POST', '/api/invoices', a.base, token=ut, body={'companyId': cid, 'clientId': client['id'], 'date': today,
            'gstRate': 18, 'challanIds': [M['id']], 'items': [{'deliveryItemId': M['items'][0]['id'], 'unitPrice': 1}]})
        check('nor bill part of its challan', status in (403, 404) and len(rows(M['challanNumber'])) == 1)
    finally:
        flows.http('DELETE', f"/api/users/{u['id']}", a.base, token=token)
        flows.http('DELETE', f"/api/companies/{other['id']}", a.base, token=token)

    # ── 15. Stock and GL follow the editor (a company with both switched on) ──
    g = call('POST', '/api/companies', {'name': f'[TEMP] Partial GL {time.time_ns()}', 'startingChallanNumber': 1,
                                        'startingInvoiceNumber': 1, 'enableGl': True, 'inventoryTrackingEnabled': True})
    try:
        gc = call('POST', '/api/clients', {'name': f'GL client {time.time_ns()}', 'companyId': g['id'], 'registrationType': 'Unregistered'})
        N = challan([line('Gl N1', 3), line('Gl N2', 2)], company_id=g['id'], customer=gc)
        bn = bill([N], N['items'][:1], company_id=g['id'], customer=gc)
        out = lambda: float(db.execute('SELECT ISNULL(SUM(Quantity),0) FROM StockMovements WHERE SourceType=2 AND SourceId=?', bn['id']).fetchone()[0])
        gl = lambda: float(db.execute('SELECT ISNULL(SUM(l.Debit),0) FROM JournalLines l JOIN JournalEntries e ON e.Id=l.JournalEntryId '
                                      'WHERE e.SourceDocType=1 AND e.SourceDocId=?', bn['id']).fetchone()[0])
        check('a partial bill moves stock and posts only its billed line', out() == 3 and abs(gl() - 354) < 0.01, f'{out()} {gl()}')
        rest = next(x['id'] for x in rows(N['challanNumber'], g['id']) if x['invoiceId'] is None)
        edit(bn['id'], [N['id'], rest], prices={str(N['items'][1]['id']): 100})
        check('adding the rest back re-syncs stock and re-posts the GL', out() == 5 and abs(gl() - 590) < 0.01, f'{out()} {gl()}')
    finally:
        flows.http('DELETE', f"/api/companies/{g['id']}", a.base, token=token)
finally:
    flows.teardown(a.base, token, company, False)

print(f'\n{passed}/{passed} partial billing checks passed')
