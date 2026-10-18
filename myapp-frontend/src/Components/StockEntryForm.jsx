import {useEffect,useRef,useState} from 'react';
import http from '../api/httpClient';
import {formStyles} from '../theme';
import {todayYmd} from '../utils/dateInput';
import {usePermissions} from '../contexts/PermissionsContext';
import {useConfirm} from './ConfirmDialog';
import SearchableItemTypeSelect from './SearchableItemTypeSelect';
import '../pages/StockDashboardPage.css';

export default function StockEntryForm({companyId,onClose,onBack,initialKind,initialItemId,compact=false}) {
 const {has}=usePermissions(),confirm=useConfirm();
 const [kind,setKind]=useState(initialKind==='Adjustment'&&has('stock.adjust.create')?'Adjustment':has('stock.opening.manage')?'Opening':'Adjustment');
 const [options,setOptions]=useState({items:[],trackingEnabled:false}),[entries,setEntries]=useState([]),[page,setPage]=useState(1);
 const [itemId,setItemId]=useState(initialItemId ? String(initialItemId) : ''),[date,setDate]=useState(todayYmd()),[direction,setDirection]=useState('add');
 const [quantity,setQuantity]=useState(''),[cost,setCost]=useState(''),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const request=useRef(crypto.randomUUID());
 const selected=options.items.find(i=>String(i.id)===String(itemId));
 const removing=kind==='Adjustment'&&direction==='remove',delta=(removing?-1:1)*Number(quantity||0),unitCost=removing?Number(selected?.unitCost||0):Number(cost);
 useEffect(()=>{request.current=crypto.randomUUID();},[kind,itemId,date,direction,quantity,cost,reason]);
 async function refresh() {
  const [o,r]=await Promise.all([http.get(`/stockentries/company/${companyId}/items?asOf=${date}`),http.get(`/stockentries/company/${companyId}?page=${page}`)]);
  setOptions(o.data);setEntries(r.data);
 }
 useEffect(()=>{let active=true;setLoading(true);Promise.all([http.get(`/stockentries/company/${companyId}/items?asOf=${date}`),http.get(`/stockentries/company/${companyId}?page=${page}`)])
  .then(([o,r])=>{if(active){setOptions(o.data);setEntries(r.data);}}).catch(()=>{if(active)setError('Could not load stock entries. Reopen to retry.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[companyId,page,date]);
 async function save(e) {
  e.preventDefault();if(busy)return;setError('');setSuccess('');
  if(!selected||!date||date>todayYmd()||!Number.isFinite(delta)||Number(quantity)<=0||!delta||!Number.isFinite(unitCost)||unitCost<=0||!reason.trim()) {setError('Choose an item and enter a valid date, quantity, cost and reason.');return;}
  setBusy(true);
  try {const r=await http.post('/stockentries',{companyId,itemTypeId:Number(itemId),requestId:request.current,kind,date,quantityDelta:delta,unitCost:removing?0:unitCost,reason:reason.trim()});
   setQuantity('');setReason('');request.current=crypto.randomUUID();setSuccess(`Stock entry #${r.data.id} recorded.`);try {await refresh();}catch{setError('Entry recorded. Reopen to refresh the list.');}
  } catch(e){setError(e.response?.data?.error||'Could not save. Retry with the same details.');}finally{setBusy(false);}
 }
 async function reverse(entry) {
  if(!await confirm({title:'Reverse stock entry?',message:'Reverse this entry in stock and accounting.',confirmText:'Reverse entry'}))return;
  setBusy(true);setError('');try{await http.post(`/stockentries/${entry.id}/cancel`);await refresh();setSuccess(`Entry #${entry.id} reversed.`);}catch(e){setError(e.response?.data?.error||'Could not reverse this entry.');}finally{setBusy(false);}
 }
 const field=(label,input)=><label style={formStyles.label}>{label}{input}</label>;
 const grid={display:'grid',gridTemplateColumns:`repeat(auto-fit,minmax(min(${compact?160:220}px,100%),1fr))`,gap:16};
 return <div data-admin-backdrop="" style={formStyles.backdrop}><div data-admin-dialog="" role="dialog" aria-modal="true" aria-label={kind==='Opening'?'Opening stock':'Stock adjustment'} className="inventory-modal" style={{...formStyles.modal,maxWidth:compact?600:850,width:'96vw'}}>
  <div data-admin-header="" style={formStyles.header}><div><h5 style={{...formStyles.title,fontSize:17}}>{kind==='Opening'?'Opening stock':'Stock adjustment'}</h5><small className="inventory-modal-subtitle">Stock and valuation · No supplier payable</small></div><button data-admin-close="" type="button" aria-label="Close stock entry" disabled={busy} style={formStyles.closeButton} onClick={onClose}>×</button></div>
  <form onSubmit={save} style={{display:'flex',flexDirection:'column',minHeight:0}}><div data-admin-body="" style={formStyles.body}>
   {!compact&&<p style={{marginTop:0}}>Stock and valuation only · No supplier payable or tax claim.</p>}
   {error&&<p role="alert" style={formStyles.error}>{error}</p>}{success&&<p role="status">{success}</p>}
   {loading?<p role="status">Loading stock…</p>:<>
    {!options.trackingEnabled&&<p role="alert">Inventory tracking is off for this company.</p>}
    <fieldset disabled={busy||!options.trackingEnabled} style={{border:0,padding:0,margin:0,minWidth:0}}>
     {!compact&&<div style={grid}>
      {field('Entry type',<select aria-label="Entry type" style={formStyles.input} value={kind} onChange={e=>setKind(e.target.value)}>{has('stock.opening.manage')&&<option value="Opening">Opening stock</option>}{has('stock.adjust.create')&&<option value="Adjustment">Stock adjustment</option>}</select>)}
      {field('Date',<input aria-label="Stock entry date" type="date" max={todayYmd()} style={formStyles.input} value={date} onChange={e=>setDate(e.target.value)}/>)}
     </div>}
     <div style={compact?{...grid,marginBottom:16}:{margin:'16px 0'}}><div><span style={formStyles.label}>Stock item</span><SearchableItemTypeSelect items={options.items} value={itemId} placeholder="Choose stock item" onChange={id=>setItemId(id)} style={formStyles.input}/></div>{compact&&field('Date',<input aria-label="Stock entry date" type="date" max={todayYmd()} style={formStyles.input} value={date} onChange={e=>setDate(e.target.value)}/>)}</div>
     <div style={grid}>
      {kind==='Adjustment'&&field('Movement',<select aria-label="Stock movement" style={formStyles.input} value={direction} onChange={e=>setDirection(e.target.value)}><option value="add">Add stock</option><option value="remove">Reduce stock</option></select>)}
      {field(`Quantity${selected?.uom?' ('+selected.uom+')':''}`,<input aria-label="Stock quantity" type="number" min="0.0001" step="0.0001" style={formStyles.input} value={quantity} onChange={e=>setQuantity(e.target.value)}/>)}
      {field('Unit cost (PKR)',<input aria-label="Stock unit cost" type="number" min="0.0001" step="0.0001" style={formStyles.input} readOnly={removing} value={removing?unitCost:cost} onChange={e=>setCost(e.target.value)}/>)}
     </div>
     {field('Reason',<input aria-label="Stock entry reason" maxLength={500} style={formStyles.input} value={reason} onChange={e=>setReason(e.target.value)}/>)}
     {selected&&<section aria-label="Stock entry preview" className="purchase-category-selected" style={{marginTop:16}}><div><strong>Current {selected.currentQuantity} → After {Number(selected.currentQuantity)+delta} {selected.uom}</strong><small>Value: Rs. {Math.abs(delta*unitCost).toLocaleString('en-PK',{maximumFractionDigits:2})} · {kind==='Opening'?'Opening equity':'Inventory adjustment'}</small></div></section>}
    </fieldset>
    {!compact&&<><h3 style={{fontSize:16}}>Recent stock entries</h3><div style={{display:'grid',gap:10}}>{!entries.length&&<p>No stock entries yet.</p>}{entries.map(e=><article key={e.id} style={{border:'1px solid #e8edf3',borderRadius:10,padding:12,overflowWrap:'anywhere'}}><strong>#{e.id} · {e.itemName}</strong><p>{e.kind} · {e.quantityDelta} {e.uom} · {e.date.slice(0,10)}{e.isCancelled?' · Reversed':''}</p><p>{e.reason}</p>{!e.isCancelled&&has(e.kind==='Opening'?'stock.opening.manage':'stock.adjust.create')&&<button type="button" disabled={busy} style={formStyles.button} onClick={()=>reverse(e)}>Reverse entry #{e.id}</button>}</article>)}</div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}><button type="button" disabled={busy||page===1} style={formStyles.button} onClick={()=>setPage(p=>p-1)}>Previous entries</button><button type="button" disabled={busy||entries.length<20} style={formStyles.button} onClick={()=>setPage(p=>p+1)}>Next entries</button></div></>}
   </>}
  </div><div data-admin-footer="" style={formStyles.footer}><button type="button" disabled={busy} style={formStyles.button} onClick={onBack}>{compact?'Cancel':'Back'}</button><button type="submit" className="inventory-primary" disabled={busy||loading||!options.trackingEnabled} style={{...formStyles.button,...formStyles.submit}}>{busy?'Saving…':'Record stock entry'}</button></div></form>
 </div></div>;
}
