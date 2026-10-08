"""Local-only consultant review lifecycle regression; no FBR request leaves the app."""
import pyodbc
import test_basic_flows as f
BASE='http://127.0.0.1:5150'
def main():
 token,company,client=f.setup(BASE,'admin','admin123')
 db=pyodbc.connect(r'DRIVER={ODBC Driver 18 for SQL Server};SERVER=.\MSSQLSERVER02;DATABASE=MyApp_Trader_Local;Trusted_Connection=yes;TrustServerCertificate=yes',autocommit=True)
 def call(m,p,b=None): return f.http(m,p,BASE,token=token,body=b)
 checks=0
 def check(name,ok,detail=None):
  nonlocal checks
  assert ok,(name,detail)
  checks+=1;print('[PASS]',name)
 try:
  st,bill=call('POST','/api/invoices/standalone',{'companyId':company['id'],'clientId':client['id'],'date':'2026-10-08','gstRate':18,'items':[{'description':'Review lifecycle','quantity':2,'unitPrice':100,'uom':'Pcs'}]})
  check('bill created',st==201,bill);iid=bill['id'];line=bill['items'][0];path=f'/api/invoices/{iid}'
  db.execute("UPDATE InvoiceItems SET HSCode='8536.5010',SaleType='Goods at standard rate (default)' WHERE InvoiceId=?",iid)
  def current():
   st,r=call('GET',path);assert st==200,r;return r
  def review(complete=False,version=None,rows=None):
   b=current()
   return call('PATCH',path+'/itemtypes-and-qty',{'writeMode':'adjustment','completeConsultantReview':complete,'reviewVersion':version or b['fbrReviewVersion'],'items':rows if rows is not None else [{'id':line['id'],'quantity':1,'unitPrice':200}]})
  st,r=review();check('consultant adjustment saved',st==200,r)
  b=current()
  payload={'gstRate':18,'items':[{'id':line['id'],'description':'Changed by administrator','quantity':2,'unitPrice':110,'uom':'Pcs','hsCode':'8536.5010','saleType':'Goods at standard rate (default)'}]}
  st,r=call('PUT',path,payload);check('administrator edit requires review',st==200 and r['fbrReviewRequired'] and not r['fbrReady'],r)
  old=b['fbrReviewVersion']
  st,r=review(True,old);check('stale consultant review rejected',st==400,r)
  st,r=review(True,rows=[]);check('incomplete item set rejected',st==400,r)
  for method,suffix in [('POST','validate'),('POST','submit'),('GET','preview-payload')]:
   st,r=call(method,f'/api/fbr/{iid}/{suffix}');check(suffix+' blocked during review',st==200 and not r.get('success',True) and 'review' in str(r).lower(),r)
  rows=[{'id':line['id'],'quantity':1,'unitPrice':220}]
  st,r=review(False,rows=rows);check('progress preserves review requirement',st==200 and r['fbrReviewRequired'],r)
  st,r=review(True,rows=rows);check('explicit review clears requirement',st==200 and not r['fbrReviewRequired'] and r['fbrReviewedAt'],r)
  payload['items'][0]['description']='Changed again at same total'
  st,r=call('PUT',path,payload);check('same-total later edit requires new review',st==200 and r['fbrReviewRequired'],r)
  st,r=review(True,rows=rows);check('repeat review completes',st==200 and not r['fbrReviewRequired'],r)
  print(f'{checks}/{checks} consultant lifecycle checks passed')
 finally:
  db.close();f.teardown(BASE,token,company,False)
if __name__=='__main__':main()
