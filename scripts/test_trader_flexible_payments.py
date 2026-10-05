"""Local-only regression for Trader settlements, advances/refunds and direct money flows."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from test_accounting_posting import http


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5197")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--fixture", type=Path)
    args = ap.parse_args()
    assert args.base.startswith(("http://localhost:", "http://127.0.0.1:")), "Local API only"
    token = http("POST", "/api/auth/login", args.base, body={"username":args.user,"password":args.password})[1]["token"]
    checks = 0
    def call(method,path,body=None,expected=(200,201)):
        nonlocal checks
        status,data = http(method,path,args.base,token,body)
        assert status in expected, (method,path,status,data)
        checks += 1
        return data
    def check(label,condition):
        nonlocal checks
        assert condition,label
        checks += 1
        print("PASS",label)
    stamp=datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    today=datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    company=call("POST","/api/companies",{"name":"[TEMP] Flexible money "+stamp,"startingChallanNumber":1,"startingInvoiceNumber":1,"startingPurchaseBillNumber":1,"startingGoodsReceiptNumber":1,"startingSalesQuoteNumber":1,"startingSalesOrderNumber":1})
    cid=company["id"]
    foreign=call("POST","/api/companies",{"name":"[TEMP] Foreign money "+stamp})
    call("POST",f"/api/accounts/company/{cid}/seed-wholesale")
    call("POST",f"/api/accounts/company/{foreign['id']}/seed-wholesale")
    client=call("POST","/api/clients",{"companyId":cid,"name":"[TEMP] Buyer "+stamp,"registrationType":"Unregistered"})
    supplier=call("POST","/api/suppliers",{"companyId":cid,"name":"[TEMP] Supplier "+stamp})
    other_client=call("POST","/api/clients",{"companyId":cid,"name":"[TEMP] Other buyer "+stamp,"registrationType":"Unregistered"})
    foreign_client=call("POST","/api/clients",{"companyId":foreign['id'],"name":"[TEMP] Foreign buyer "+stamp,"registrationType":"Unregistered"})
    accounts=call("GET",f"/api/accounts/company/{cid}/flat")
    foreign_accounts=call("GET",f"/api/accounts/company/{foreign['id']}/flat")
    bank=next(a for a in accounts if a['controlType']=='BankCash')
    income=next(a for a in accounts if a['accountType']=='Income')
    expense=next(a for a in accounts if a['accountType']=='Expense')
    ar=next(a for a in accounts if a['controlType']=='AccountsReceivable')
    payable=next(a for a in accounts if a['controlType']=='AccountsPayable')
    def entry(pid):
        entries=call("GET",f"/api/journal-entries/company/{cid}/paged?pageSize=100")['items']
        hit=[e for e in entries if e['sourceDocType']=='Payment' and e['sourceDocId']==pid]
        check("one balanced entry",len(hit)==1 and sum(l['debit']-l['credit'] for l in hit[0]['lines'])==0)
        return hit[0]
    ids=[]
    for direction,party,pid in [('Receipt','Client',client['id']),('Payment','Client',client['id']),('Payment','Supplier',supplier['id']),('Receipt','Supplier',supplier['id'])]:
        route='receipts' if direction=='Receipt' else 'payments'
        body={'date':today,'contactType':party,'contactId':pid,'bankAccountId':bank['id'],'allocations':[{'kind':'OnAccount','amount':125}]}
        result=call('POST',f'/api/payments/{route}/company/{cid}',body)
        ids.append(result['id'])
        check(direction+' '+party+' round trip',result['allocations'][0]['kind']=='OnAccount')
        lines=entry(result['id'])['lines']
        target=ar if party=='Client' else payable
        party_line=next(l for l in lines if l['accountId']==target['id'])
        check(direction+' '+party+' control and sign',party_line['partyId']==pid and party_line['partyType']==party and party_line['debit']==(125 if direction=='Payment' else 0) and party_line['credit']==(125 if direction=='Receipt' else 0))
    for direction in ['Receipt','Payment']:
        route='receipts' if direction=='Receipt' else 'payments';account=income if direction=='Receipt' else expense
        body={'date':today,'contactType':'Other','contactName':'[TEMP] Transport driver','bankAccountId':bank['id'],'allocations':[{'kind':'Account','accountId':account['id'],'amount':150},{'kind':'Account','accountId':account['id'],'amount':25}]}
        result=call('POST',f'/api/payments/{route}/company/{cid}',body);ids.append(result['id'])
        check('named other '+direction,result['contactName']==body['contactName'] and result['amount']==175)
        lines=entry(result['id'])['lines'];check('direct account '+direction,sum(l['debit']-l['credit'] for l in lines if l['accountId']==account['id'])==(175 if direction=='Payment' else -175))
        printed=call('GET',f"/api/payments/{route}/{result['id']}/print");check('voucher retains other name',printed['contactName']==body['contactName'])
        body['allocations']=[{'kind':'Account','accountId':account['id'],'amount':80}]
        updated=call('PUT',f"/api/payments/{route}/{result['id']}",body);check('edit replaces allocation',updated['amount']==80 and len(updated['allocations'])==1);entry(result['id'])
        body['contactId']=foreign_client['id'];body['contactType']='Client'
        call('PUT',f"/api/payments/{route}/{result['id']}",body,(400,403));check('failed edit keeps original',call('GET',f"/api/payments/{route}/{result['id']}")['amount']==80)
    invalid=[
        {'contactType':'Other','contactName':'x','allocations':[{'kind':'OnAccount','amount':1}]},
        {'contactType':'Client','contactId':foreign_client['id'],'allocations':[{'kind':'OnAccount','amount':1}]},
        {'contactType':'Other','contactName':'x','allocations':[{'kind':'Account','accountId':foreign_accounts[0]['id'],'amount':1}]},
        {'contactType':'Other','contactName':'x','allocations':[{'kind':'Account','accountId':expense['id'],'amount':1}]},
        {'contactType':'Other','contactName':'x','allocations':[{'kind':'Account','accountId':income['id'],'amount':1.001}]},
        {'contactType':'Client','contactId':client['id'],'bankAccountId':foreign_accounts[0]['id'],'allocations':[{'kind':'OnAccount','amount':1}]},
        {'contactType':'Bogus','allocations':[{'kind':'OnAccount','amount':1}]},
    ]
    for body in invalid:call('POST',f'/api/payments/receipts/company/{cid}',{'date':today,**body},(400,403))
    inv=call('POST','/api/invoices/standalone',{'date':today,'companyId':cid,'clientId':client['id'],'gstRate':18,'freightCharges':100,'items':[{'description':'[TEMP] Widget','quantity':2,'unitPrice':100,'uom':'KG'}]})
    allocation={'date':today,'contactType':'Client','contactId':other_client['id'],'allocations':[{'invoiceId':inv['id'],'amount':10}]}
    call('POST',f'/api/payments/receipts/company/{cid}',allocation,(400,403))
    allocation['contactId']=client['id'];receipt=call('POST',f'/api/payments/receipts/company/{cid}',allocation)
    check('settlement reflows only linked bill',call('GET',f"/api/invoices/{inv['id']}")['amountPaid']==10)
    call('DELETE',f"/api/payments/receipts/{receipt['id']}",expected=(200,204))
    check('delete restores outstanding',call('GET',f"/api/invoices/{inv['id']}")['amountPaid']==0)
    check('advance/refund leaves invoice unpaid',call('GET',f"/api/invoices/{inv['id']}")['amountPaid']==0)
    # Direct income/expense may name a contact, but must not become AR/AP.
    for party,pid in [('Client',client['id']),('Supplier',supplier['id'])]:
        before=call('GET',f'/api/accounting/reports/company/{cid}/party-ledger?partyType={party}&partyId={pid}')['closingBalance']
        for route,account in [('receipts',income),('payments',expense)]:
            result=call('POST',f'/api/payments/{route}/company/{cid}',{'date':today,'contactType':party,'contactId':pid,'allocations':[{'kind':'Account','accountId':account['id'],'amount':13}]})
            lines=entry(result['id'])['lines'];check('direct amount does not tag a control balance',all(not l.get('partyId') for l in lines))
        after=call('GET',f'/api/accounting/reports/company/{cid}/party-ledger?partyType={party}&partyId={pid}')['closingBalance']
        check('direct amounts leave '+party+' ledger unchanged',before==after)
    before={a['id']:a['balance'] for a in call('GET',f'/api/accounts/company/{cid}/flat')}
    call('POST',f'/api/accounting/gl/company/{cid}/rebuild')
    check('rebuild preserves all money flows',before=={a['id']:a['balance'] for a in call('GET',f'/api/accounts/company/{cid}/flat')})
    call('PUT',f'/api/accounting/gl/company/{cid}/lock-date',{'lockDate':today})
    call('POST',f'/api/payments/receipts/company/{cid}',{'date':today,'contactType':'Client','contactId':client['id'],'allocations':[{'kind':'OnAccount','amount':1}]},(400,409))
    call('PUT',f'/api/accounting/gl/company/{cid}/lock-date',{'lockDate':None})
    if args.fixture:
        args.fixture.write_text(json.dumps({'companyId':cid,'client':client,'supplier':supplier,'invoice':inv,'bank':bank,'income':income,'expense':expense}))
    print(f'{checks} checks passed')
    return 0

if __name__=='__main__':raise SystemExit(main())
