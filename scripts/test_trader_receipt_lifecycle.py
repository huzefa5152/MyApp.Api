"""Local-only receipt/payment lifecycle regression, including company isolation."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from test_accounting_posting import http

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://localhost:5200")
ap.add_argument("--fixture", type=Path, required=True)
args = ap.parse_args()
assert urlparse(args.base).hostname in ("localhost", "127.0.0.1"), "Local API only"
token=http("POST","/api/auth/login",args.base,body={"username":"admin","password":"admin123"})[1]["token"]
checks=0

def call(method,path,body=None,expected=(200,201,204),auth=None):
    global checks
    status,data=http(method,path,args.base,auth or token,body)
    assert status in expected,(method,path,status,data)
    checks+=1
    return data

def check(label,ok):
    global checks
    assert ok,label
    checks+=1
    print("PASS",label)

today=datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
stamp=datetime.now(timezone.utc).strftime("%H%M%S")
company=call("POST","/api/companies",{"name":"[TEMP] Receipt lifecycle "+stamp,"startingInvoiceNumber":1,"startingChallanNumber":1,"startingPurchaseBillNumber":1,"startingGoodsReceiptNumber":1,"startingSalesQuoteNumber":1,"startingSalesOrderNumber":1})
cid=company["id"]
client=call("POST","/api/clients",{"companyId":cid,"name":"Sample receipt buyer","registrationType":"Unregistered"})
supplier=call("POST","/api/suppliers",{"companyId":cid,"name":"Sample payment supplier"})
call("POST",f"/api/accounts/company/{cid}/seed-wholesale")
accounts=call("GET",f"/api/accounts/company/{cid}/flat")
bank=next(a["id"] for a in accounts if a["controlType"]=="BankCash")
inv=call("POST","/api/invoices/standalone",{"date":today,"companyId":cid,"clientId":client["id"],"gstRate":18,"items":[{"description":"Sample goods","quantity":1,"unitPrice":100,"uom":"KG"}]})
invoice=inv["id"]
f={"companyId":cid,"bank":{"id":bank},"client":client,"supplier":supplier,"invoice":inv}
args.fixture.write_text(json.dumps(f))
body={"date":today,"contactType":"Client","contactId":f["client"]["id"],"bankAccountId":bank,"method":"Cheque","chequeNumber":"SAMPLE-CHEQUE","allocations":[{"invoiceId":invoice,"amount":10},{"kind":"OnAccount","amount":5}]}
def summary(): return next(r for r in call("GET",f"/api/bank-reconciliation/company/{cid}/summary") if r["accountId"]==bank)
def paid(): return call("GET",f"/api/invoices/{invoice}")["amountPaid"]
def status(pid,s): return call("PATCH",f"/api/payments/{pid}/cheque-status",{"status":s})
base=summary()["actualBalance"]
p=call("POST",f"/api/payments/receipts/company/{cid}",body);pid=p["id"]
check("mixed receipt keeps full amount",p["amount"]==15 and len(p["allocations"])==2)
check("cheque defaults pending",p["chequeStatus"]=="Pending")
check("pending cheque not cleared",summary()["pendingDeposits"]==15 and summary()["clearedBalance"]==base)
check("pending receipt reserves invoice allocation",paid()==10)
status(pid,"Deposited");check("deposit remains pending",summary()["pendingDeposits"]==15)
call("POST",f"/api/bank-reconciliation/payment/{pid}/cleared",{"cleared":True})
check("reconciliation clears cheque status",call("GET",f"/api/payments/receipts/{pid}")["chequeStatus"]=="Cleared")
check("clear removes pending bucket",summary()["pendingDeposits"]==0)
body["description"]="Sample issuer bank; deposit into selected account"
body["chequeStatus"]="Cleared"
call("PUT",f"/api/payments/receipts/{pid}",body)
check("edit retains cleared state",summary()["pendingDeposits"]==0)
legacy=dict(body);legacy.pop("chequeStatus")
call("PUT",f"/api/payments/receipts/{pid}",legacy)
check("older edit payload preserves cleared cheque",call("GET",f"/api/payments/receipts/{pid}")["chequeStatus"]=="Cleared")
status(pid,"Bounced")
check("bounce restores invoice outstanding",paid()==0)
check("bounce removes bank effect",summary()["actualBalance"]==base and summary()["pendingDeposits"]==0)
check("bounced receipt excluded from reconciliation",all(r["docId"]!=pid or r["docType"]!="Receipt" for r in call("GET",f"/api/bank-reconciliation/account/{bank}/transactions")))
call("POST",f"/api/bank-reconciliation/payment/{pid}/cleared",{"cleared":True},expected=(400,))
call("POST",f"/api/accounting/gl/company/{cid}/rebuild")
check("rebuild cannot repost bounced cheque",summary()["actualBalance"]==base)
inv=call("GET",f"/api/invoices/{invoice}")
replacement=call("POST",f"/api/payments/receipts/company/{cid}",{**body,"method":"Cash","chequeNumber":None,"chequeStatus":"None","allocations":[{"invoiceId":invoice,"amount":inv["balanceDue"]}]})
call("PATCH",f"/api/payments/{pid}/cheque-status",{"status":"Pending"},expected=(400,))
check("refused restoration keeps bounced state",call("GET",f"/api/payments/receipts/{pid}")["chequeStatus"]=="Bounced")
call("DELETE",f"/api/payments/receipts/{replacement['id']}")
status(pid,"Pending");check("restoring cheque restores one allocation and bank leg",paid()==10 and summary()["actualBalance"]==base+15)
status(pid,"Pending");check("repeated status cannot double post",summary()["actualBalance"]==base+15)
matched=call("POST",f"/api/payments/receipts/company/{cid}",{**body,"chequeNumber":"SAMPLE-MATCHED","chequeStatus":"Pending","allocations":[{"kind":"OnAccount","amount":17}]})
call("POST",f"/api/bank-statements/company/{cid}/import",{"bankAccountId":bank,"fileName":"sample.csv","csvText":f"Date,Description,Amount\n{today[:10]},Sample clearance,17\n"})
check("statement matching clears cheque lifecycle",call("GET",f"/api/payments/receipts/{matched['id']}")["chequeStatus"]=="Cleared")
check("statement match leaves only other pending receipt",summary()["pendingDeposits"]==15)
base+=17
pay=call("POST",f"/api/payments/payments/company/{cid}",{"date":today,"contactType":"Supplier","contactId":supplier["id"],"bankAccountId":bank,"method":"Cheque","chequeNumber":"SAMPLE-PAYMENT","allocations":[{"kind":"OnAccount","amount":7}]})
check("outgoing cheque reduces bank and remains pending",summary()["actualBalance"]==base+8 and summary()["pendingWithdrawals"]==7)
status(pay["id"],"Bounced")
check("bounced payment restores bank and removes pending withdrawal",summary()["actualBalance"]==base+15 and summary()["pendingWithdrawals"]==0)
call("PUT",f"/api/accounting/gl/company/{cid}/lock-date",{"lockDate":today})
call("PATCH",f"/api/payments/{pid}/cheque-status",{"status":"Bounced"},expected=(400,))
call("PUT",f"/api/accounting/gl/company/{cid}/lock-date",{"lockDate":None})
call("POST",f"/api/bank-reconciliation/company/{cid}/lock",{"bankAccountId":bank,"statementDate":today,"statementBalance":base})
call("PATCH",f"/api/payments/{pid}/cheque-status",{"status":"Cleared"},expected=(400,))
call("PUT",f"/api/payments/receipts/{pid}",body,expected=(400,))
call("DELETE",f"/api/payments/receipts/{pid}",expected=(400,))
call("PATCH",f"/api/payments/{pid}/cheque-status",{"status":"999"},expected=(400,))
# A fully permitted product user still cannot reach an unassigned company.
foreign=call("POST","/api/companies",{"name":"[TEMP] Receipt isolation "+stamp})
call("POST",f"/api/accounts/company/{foreign['id']}/seed-wholesale")
username="receipt_scope_"+datetime.now(timezone.utc).strftime("%H%M%S")
user=call("POST","/api/users",{"username":username,"password":"Passw0rd!23","fullName":"Sample receipt operator","role":"User"})
roles=call("GET","/api/roles")
role=next(r for r in roles if r["name"]=="Complete Edition")
call("PUT",f"/api/users/{user['id']}/roles",{"roleIds":[role["id"]]})
call("PUT",f"/api/usercompanies/user/{user['id']}",{"companyIds":[foreign["id"]]})
scoped=call("POST","/api/auth/login",{"username":username,"password":"Passw0rd!23"})["token"]
own_banks=call("GET",f"/api/accounts/company/{foreign['id']}/bank-cash",auth=scoped)
own_bank=call("POST",f"/api/accounts/company/{foreign['id']}",{"name":"Sample runtime cash","accountGroupId":own_banks[0]["accountGroupId"],"accountType":"Asset","controlType":"BankCash","openingBalance":0},auth=scoped)
check("permitted operator creates own bank/cash account",own_bank["companyId"]==foreign["id"] and own_bank["controlType"]=="BankCash")
check("created account immediately available in picker",any(a["id"]==own_bank["id"] for a in call("GET",f"/api/accounts/company/{foreign['id']}/bank-cash",auth=scoped)))
own_client=call("POST","/api/clients",{"companyId":foreign["id"],"name":"Sample own buyer","registrationType":"Unregistered"},auth=scoped)
own_receipt=call("POST",f"/api/payments/receipts/company/{foreign['id']}",{"date":today,"contactType":"Client","contactId":own_client["id"],"bankAccountId":own_bank["id"],"method":"Cheque","chequeNumber":"SAMPLE-OWN","allocations":[{"kind":"OnAccount","amount":2}]},auth=scoped)
call("PATCH",f"/api/payments/{own_receipt['id']}/cheque-status",{"status":"Cleared"},auth=scoped)
check("permitted operator clears own receipt",call("GET",f"/api/payments/receipts/{own_receipt['id']}",auth=scoped)["chequeStatus"]=="Cleared")
for method,path,data in [
 ("GET",f"/api/payments/receipts/{pid}",None),
 ("GET",f"/api/accounts/company/{cid}/bank-cash",None),
 ("POST",f"/api/accounts/company/{cid}",{"name":"Forbidden bank","accountGroupId":bank,"accountType":"Asset","controlType":"BankCash"}),
 ("PUT",f"/api/payments/receipts/{pid}",body),
 ("PATCH",f"/api/payments/{pid}/cheque-status",{"status":"Cleared"}),
 ("POST",f"/api/bank-reconciliation/payment/{pid}/cleared",{"cleared":True}),
 ("POST",f"/api/payments/receipts/company/{cid}",body),
]: call(method,path,data,expected=(403,),auth=scoped)
check("cross-company attempts leave receipt unchanged",call("GET",f"/api/payments/receipts/{pid}")["chequeStatus"]=="Pending")
print(f"{checks} lifecycle checks passed")
