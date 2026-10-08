"""Local-only customer document import integration checks."""
import argparse, io, json, uuid, os
from urllib.parse import urlparse
import requests
from openpyxl import Workbook

parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:5155');args=parser.parse_args()
assert urlparse(args.base).hostname in ('localhost','127.0.0.1'), 'Run only on localhost'
s=requests.Session();b=args.base+'/api';checks=0

def check(condition,name):
 global checks
 assert condition,name
 checks+=1

def post(path,body):
 r=s.post(b+path,json=body);r.raise_for_status();return r.json() if r.content else None

s.headers['Authorization']='Bearer '+post('/auth/login',{'username':os.environ.get('LOCAL_TEST_USER','admin'),'password':os.environ.get('LOCAL_TEST_PASSWORD','admin123')})['token']
suffix=uuid.uuid4().hex[:8]
company=post('/companies',{'name':'_test_document_import_'+suffix})['id']
client=post('/clients',{'name':'Sample customer '+suffix,'companyId':company})['id']
workbook=Workbook();sheet=workbook.active;sheet.title='Demand';sheet.append(['Sample demand']);sheet.append(['Description','Quantity','UOM','Rate']);sheet.append(['Fitting 1/2 inch',12.5,'KG',25]);sheet.append(['Pipe',100,'Mtr',0]);data=io.BytesIO();workbook.save(data);data=data.getvalue()
params={'companyId':company,'clientId':client}
mapping={'sheet':'Demand','headerRow':2,'descriptionColumn':1,'quantityColumn':2,'unitColumn':3,'rateColumn':4,'headers':['Description','Quantity','UOM','Rate']}
def upload(mapping=None,params=params,filename='demand.xlsx',data=data):
 return s.post(b+'/poimport/workbook',params=params,files={'file':(filename,data)},data={'mapping':json.dumps(mapping)} if mapping else {})
try:
 r=upload();check(r.status_code==200,'preview');check(r.json()['sheets'][0]['name']=='Demand','worksheet choices')
 r=upload(mapping);check(r.status_code==200,'parse');parsed=r.json();check(len(parsed['items'])==2,'line count');check(parsed['items'][0]['quantity']==12.5,'fractional quantity');check(parsed['items'][0]['unitPrice']==25,'price');check(parsed['items'][1]['unitPrice']==0,'zero price');check(parsed['archiveId']>0,'archive persisted')
 check(upload(params={**params,'clientId':-1}).status_code==400,'foreign customer refused')
 check(upload(filename='demand.xls').status_code==400,'unsupported legacy workbook refused')
 check(upload(data=b'not a zip').status_code==400,'corrupt file refused')
 name='Excel demand'
 fmt=post('/poimport/workbook-format?companyId='+str(company)+'&clientId='+str(client),{'name':name,'mapping':mapping});check(fmt['id']>0,'save mapping')
 r=s.post(b+'/poimport/workbook-format',params=params,json={'name':name,'mapping':mapping});check(r.status_code==409,'duplicate named layout refused')
 second=post('/poimport/workbook-format?companyId='+str(company)+'&clientId='+str(client),{'name':'Excel alternate','mapping':mapping});check(second['id']!=fmt['id'],'multiple layouts per customer')
 formats=s.get(b+'/poimport/workbook-formats',params=params).json();check(len(formats)==2,'customer saved layouts');check(json.loads(formats[0]['ruleSetJson'])['mapping']['headers']==mapping['headers'],'mapping retained')
 common={'clientId':client,'items':[{'description':i['description'],'quantity':i['quantity'],'unit':i['unit'],'unitPrice':i['unitPrice'] or 0} for i in parsed['items']]}
 for kind,route,extra in [('salesquote','salesquotes',{'date':'2026-10-08','gstRate':18}),('salesorder','salesorders',{'orderDate':'2026-10-08','isImported':True}),('challan','deliverychallans',{'deliveryDate':'2026-10-08'})]:
  source=upload(mapping).json();check(s.get(b+'/poimport/archives/'+str(parsed['archiveId'])+'/duplicate',params={'documentKind':kind}).json()['duplicate']==False,kind+' is distinct from other document kinds');created=post('/'+route+'/company/'+str(company),{**common,**extra});check(created['id']>0,kind+' create')
  link=s.post(b+'/poimport/archives/'+str(source['archiveId'])+'/link',json={'documentKind':kind,'documentId':created['id']});check(link.status_code==200,kind+' source attached')
  check(s.get(b+'/poimport/archives/'+str(parsed['archiveId'])+'/duplicate',params={'documentKind':kind}).json()['duplicate']==True,kind+' duplicate detected')
  check(s.post(b+'/poimport/archives/'+str(source['archiveId'])+'/link',json={'documentKind':kind,'documentId':created['id']}).status_code==200,kind+' idempotent attachment')
  archived=s.get(b+'/poimport/archives/'+str(source['archiveId'])+'/file');check(archived.status_code==200 and archived.content==data,kind+' original download')
 print(f'{checks}/{checks} checks passed')
finally:
 r=s.delete(b+'/companies/'+str(company));print('Fixture cleanup:',r.status_code)
