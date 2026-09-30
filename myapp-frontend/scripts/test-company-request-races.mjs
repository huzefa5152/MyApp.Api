import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const tasks=[];let active={},auth={isAuthenticated:true,token:'sample-a'};
const deferred=(kind,id)=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});const task={kind,id,resolve,reject,promise};tasks.push(task);return task;};
let slots=[],index=0,effects=[];
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
const hooks={
 createContext:()=>({Provider:'Provider'}),useContext:()=>null,
 useState:(initial)=>{const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
 useRef:(initial)=>{const i=index++;return slots[i]??=( {current:initial} );},
 useMemo:(fn,deps)=>{const i=index++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
 useCallback:(fn,deps)=>hooks.useMemo(()=>fn,deps),
 useEffect:(fn,deps)=>{const i=index++;if(!same(slots[i]?.deps,deps))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
};
globalThis.auditStampAllowed=true;globalThis.window={addEventListener:()=>{},removeEventListener:()=>{}};globalThis.document={visibilityState:'visible',addEventListener:()=>{},removeEventListener:()=>{}};
globalThis.auditHooks=hooks;globalThis.auditAuth=()=>auth;
globalThis.auditCompanies=()=>deferred('company').promise;
globalThis.auditStamps=id=>deferred('stamp',id).promise;
globalThis.auditSetStamps=v=>{active=v;};
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const mocks={
 'react':`export const {createContext,useContext,useState,useRef,useMemo,useCallback,useEffect}=globalThis.auditHooks;`,
 'react/jsx-runtime':`export const jsx=(type,props)=>({type,props});export const jsxs=jsx;`,
 '../api/companyApi':`export const getCompanies=globalThis.auditCompanies;`,
 '../api/stampApi':`export const getCompanyStamps=globalThis.auditStamps;`,
 '../utils/templateEngine':`export const setActiveStamps=globalThis.auditSetStamps;`,
 './PermissionsContext':`export const usePermissions=()=>({has:()=>globalThis.auditStampAllowed});`,
 './AuthContext':`export const useAuth=globalThis.auditAuth;`,
};
const bundled=await build({stdin:{contents:`export {CompanyProvider} from './src/contexts/CompanyContext.jsx'`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
const {CompanyProvider}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const render=()=>{index=0;const result=CompanyProvider({children:null}).props.value;const run=effects;effects=[];run.forEach(fn=>fn());return result;};
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();return render();};
render();tasks.find(t=>t.kind==='company').resolve({data:[{id:1},{id:2}]});let value=await settle();value=render();
const a=tasks.find(t=>t.kind==='stamp'&&t.id===1);
value.setSelectedCompany({id:2});render();assert.deepEqual(active,{});
const b=tasks.find(t=>t.kind==='stamp'&&t.id===2);b.resolve({data:[{slug:'b',url:'sample-b'}]});value=await settle();
a.resolve({data:[{slug:'a',url:'sample-a'}]});value=await settle();assert.deepEqual(active,{b:'sample-b'});assert.equal(value.companyStamps[0].slug,'b');
const stampRefresh=value.refreshStamps();const pendingStamp=tasks.at(-1);
assert.deepEqual(active,{});
const newestRefresh=value.refreshStamps();const newestStamp=tasks.at(-1);
newestStamp.resolve({data:[{slug:'b',url:'newest-b'}]});await newestRefresh;await settle();
pendingStamp.reject(new Error('obsolete failure'));await stampRefresh;value=await settle();assert.deepEqual(active,{b:'newest-b'});
const refresh=value.refreshCompanies();const pending=tasks.at(-1);auth={isAuthenticated:false,token:null};render();pending.resolve({data:[{id:1}]});await refresh;value=await settle();assert.deepEqual(value.companies,[]);assert.deepEqual(active,{});
auth={isAuthenticated:true,token:'sample-b'};globalThis.auditStampAllowed=false;render();
const pendingCompanies=tasks.at(-1);pendingCompanies.resolve({data:[{id:1}]});await settle();render();
assert.deepEqual(active,{});assert.equal(tasks.at(-1).kind,'company');
console.log('PASS: actual CompanyProvider ignores stale stamp/company responses and clears active stamps on company switch/logout.');
