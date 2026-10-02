import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sameSession, sessionIdentity } from '../myapp-frontend/src/utils/sessionIdentity.js';
const source=fs.readFileSync('myapp-frontend/src/api/httpClient.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.env','({BASE_URL:"/admin/"})').replaceAll('import.meta','({env:{}})').replace('export default httpClient;','return httpClient;');
let requestHandler,responseSuccess,responseError,posts=0;
const storage=new Map();
const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
const token=(exp,sub='101',sid='device-1',extras={})=>'x.'+Buffer.from(JSON.stringify({exp,sub,stamp:'test-stamp',sid,jti:'test-token',...extras})).toString('base64url')+'.x';
const old=token(Math.floor(Date.now()/1000)+1800),fresh=token(Math.floor(Date.now()/1000)+604800);
const window={location:{pathname:'/admin/bills',search:'',hash:'',href:''},dispatchEvent(){}};
class CanceledError extends Error { code="ERR_CANCELED"; }
const axios={CanceledError,isCancel:e=>e?.code==="ERR_CANCELED",create:()=>({interceptors:{request:{use:f=>requestHandler=f},response:{use:(a,b)=>{responseSuccess=a;responseError=b}}}}),post:async()=>{posts++;await new Promise(r=>setTimeout(r,10));return {data:{token:fresh}}}};
new Function('axios','notify','localStorage','window','sessionStorage','sameSession',source)(axios,()=>{},localStorage,window,{setItem(){}},sameSession);
localStorage.setItem('token',old);
const configs=await Promise.all(Array.from({length:12},()=>requestHandler({url:'/invoices',headers:{}})));
assert.equal(posts,1);assert(configs.every(c=>c.headers.Authorization===`Bearer ${fresh}`));
console.log('PASS 12 concurrent requests share renewal and use refreshed token');
await responseError({response:{status:401},config:{headers:{Authorization:`Bearer ${old}`}}}).catch(()=>{});
assert.equal(localStorage.getItem('token'),fresh);assert.equal(window.location.href,'');console.log('PASS delayed old-token 401 preserves renewed session');
localStorage.setItem('token',old);axios.post=async()=>{throw Error('Network unavailable')};
const config=await requestHandler({url:'/invoices',headers:{}});assert.equal(config.headers.Authorization,`Bearer ${old}`);assert.equal(localStorage.getItem('token'),old);console.log('PASS renewal network failure preserves valid token');
await requestHandler({url:'/auth/logout',headers:{}});assert.equal(localStorage.getItem('token'),old);console.log('PASS logout sends original device token without renewal');
console.log('4 frontend session checks passed');

const context=fs.readFileSync('myapp-frontend/src/contexts/AuthContext.jsx','utf8');
const start=context.indexOf('  useEffect(() => {');
const effect=context.slice(start,context.indexOf('  }, []);',start)+10).replaceAll('import.meta.env','({BASE_URL:"/admin/"})');
let runEffect,retry,loading=true,currentUser=null,attempt=0;
localStorage.setItem('token',old);
new Function('useEffect','localStorage','getCurrentUser','setLoading','setUser','setToken','setAvatarVersion','setTimeout','clearTimeout','window','sessionStorage',effect)(
 f=>runEffect=f,localStorage,async()=>{ if(attempt++===0) throw {response:{status:503}}; return {data:{id:123}}; },
 v=>loading=v,v=>currentUser=v,()=>{},()=>{},f=>{retry=f;return 1},()=>{},window,{setItem(){}});
runEffect();await new Promise(r=>setImmediate(r));
assert.equal(localStorage.getItem('token'),old);assert.equal(loading,true);assert.equal(typeof retry,'function');
console.log('PASS temporary startup error preserves token and schedules retry');
retry();await new Promise(r=>setImmediate(r));assert.equal(loading,false);assert.equal(currentUser.id,123);
console.log('PASS successful startup retry restores user and releases loading');
console.log('6 frontend session checks passed');

const other=token(Math.floor(Date.now()/1000)+604800,'202','device-2');
localStorage.setItem('token',old);
let finishRenewal;
axios.post=()=>new Promise(resolve=>{finishRenewal=resolve});
const waiting=requestHandler({url:'/invoices/company/1',method:'post',headers:{}});
localStorage.setItem('token',other);finishRenewal({data:{token:fresh}});
await assert.rejects(waiting,e=>axios.isCancel(e));assert.equal(localStorage.getItem('token'),other);
console.log('PASS queued write cancelled after account switch; renewal cannot overwrite new user');
await assert.rejects(responseSuccess({config:{headers:{Authorization:`Bearer ${old}`}},data:{private:'previous account'}}),e=>axios.isCancel(e));
console.log('PASS previous-account success response cannot enter new account state');
await assert.rejects(responseError({config:{headers:{Authorization:`Bearer ${old}`}},response:{status:401}}),e=>axios.isCancel(e));
assert.equal(localStorage.getItem('token'),other);console.log('PASS previous-account failure cannot sign out new account');
const legacy=token(Math.floor(Date.now()/1000)+1000,'101',null,{jti:'legacy-token'});
const upgraded=token(Math.floor(Date.now()/1000)+604800,'101','legacy:legacy-token');
assert(sameSession(legacy,upgraded));assert(!sameSession(old,other));assert.notEqual(sessionIdentity(old),sessionIdentity(other));
console.log('PASS legacy upgrade retains identity; different users and devices remain distinct');
let pendingLogout;
const logoutStart=context.indexOf('  const logout = useCallback');
const logoutCode=context.slice(logoutStart,context.indexOf('  }, [navigate]);',logoutStart)+18)+'return logout;';
localStorage.setItem('token',old);
const doLogout=new Function('useCallback','localStorage','logoutApi','sameSession','loginAttempt','setToken','setUser','navigate',logoutCode)(
 f=>f,localStorage,()=>new Promise(r=>pendingLogout=r),sameSession,{current:0},()=>{},()=>{},()=>{});
const exiting=doLogout();localStorage.setItem('token',other);pendingLogout();await exiting;
assert.equal(localStorage.getItem('token'),other);console.log('PASS delayed sign-out preserves newer account login');
let reloads=0,storageListener;
const storageStart=context.lastIndexOf('  useEffect(() => {',context.indexOf('    const storageChanged'));
const storageCode=context.slice(storageStart,context.indexOf('  }, []);',storageStart)+10);
new Function('useEffect','window','sameSession',storageCode)(f=>f(),{
 addEventListener:(name,f)=>storageListener=f,removeEventListener(){},location:{reload:()=>reloads++}},sameSession);
storageListener({key:'token',oldValue:old,newValue:fresh});assert.equal(reloads,0);
storageListener({key:'token',oldValue:fresh,newValue:other});assert.equal(reloads,1);
storageListener({key:'token',oldValue:other,newValue:null});assert.equal(reloads,2);
console.log('PASS account change or sign-out in another tab clears cached app state; renewal does not reload');
console.log('12 frontend session checks passed');
