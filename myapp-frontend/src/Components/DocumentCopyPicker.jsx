import { useEffect, useRef, useState } from "react";
import http from "../api/httpClient";
import { usePermissions } from "../contexts/PermissionsContext";
import { COPY_TYPES } from "../utils/documentCopy";
import { formStyles } from "../theme";

// Existing APIs enforce source access. The destination form owns validation and saving.
export default function DocumentCopyPicker({ companyId, destination, allowDetails = true, disabled = false, onCopy }) {
  const { has } = usePermissions();
  const types = Object.entries(COPY_TYPES).filter(([,t]) => t.side === COPY_TYPES[destination].side && has(t.permission));
  const [open,setOpen] = useState(false), [type,setType] = useState(destination);
  const [search,setSearch] = useState(""), [page,setPage] = useState(1), [docs,setDocs] = useState([]), [total,setTotal] = useState(0);
  const [source,setSource] = useState(null), [selected,setSelected] = useState([]), [details,setDetails] = useState(false);
  const [error,setError] = useState(""), [busy,setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!open || !types.some(([key]) => key===type)) return;
    let active = true;
    const timer = setTimeout(() => {
      setError(""); setBusy(true);
      http.get(`/${COPY_TYPES[type].route}/company/${companyId}/paged`, {params:{page,pageSize:20,search}})
        .then(({data}) => { if(active) { setDocs(data.items || []);setTotal(data.totalCount || 0); } })
        .catch(() => { if(active) {setDocs([]);setError("Could not load source documents.");} })
        .finally(() => {if(active)setBusy(false);});
    },250);
    return () => { active=false;clearTimeout(timer); };
  }, [open,type,companyId,search,page]);
  useEffect(() => {generation.current++;setSource(null);setSelected([]);},[companyId,type]);
  const choose = async id => {
    const request = ++generation.current;setSource(null);setSelected([]);setBusy(true);setError("");
    try {
      const {data} = await http.get(`/${COPY_TYPES[type].route}/${id}`);
      if(request!==generation.current)return;
      if(Number(data.companyId)!==Number(companyId))throw new Error("Company mismatch");
      setSource(data);setSelected((data.items || []).map((_,i)=>i));
    } catch {if(request===generation.current)setError("Could not load this document for copying.");}
    finally {if(request===generation.current)setBusy(false);}
  };
  if(disabled || !types.length)return null;
  return <section className="admin-document-copy" data-open={open} style={{border:"1px solid #d0d7e2",borderRadius:10,padding:12,marginBottom:16}}>
    <button type="button" aria-expanded={open} style={button} onClick={() => {if(!open&&!types.some(([k])=>k===type))setType(types[0][0]);setOpen(!open);}}>Copy from a document</button>
    {open && <div style={{display:"grid",gap:10,marginTop:10}}>
      <select aria-label="Copy source type" style={formStyles.input} value={type} onChange={e=>{setType(e.target.value);setPage(1);setDetails(false);}}>
        {types.map(([key,t])=><option key={key} value={key}>{t.label}</option>)}
      </select>
      <input aria-label="Find source document" style={formStyles.input} placeholder="Search number or customer / supplier" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} />
      <select aria-label="Copy source document" style={formStyles.input} value={source?.id || ""} disabled={busy} onChange={e=>e.target.value&&choose(e.target.value)}>
        <option value="">Choose source document</option>
        {docs.map(d=><option key={d.id} value={d.id}>#{d[COPY_TYPES[type].number]} — {d.clientName || d.supplierName || ""}</option>)}
      </select>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button type="button" style={button} disabled={page===1||busy} onClick={()=>setPage(page-1)}>Previous</button>
        <span>Page {page}</span><button type="button" style={button} disabled={page*20>=total||busy} onClick={()=>setPage(page+1)}>Next</button>
      </div>
      {busy&&<span>Loading…</span>}{error&&<div role="alert" style={formStyles.error}>{error}</div>}
      {source&&<>
        {allowDetails&&type===destination&&<label style={check}><input type="checkbox" checked={details} onChange={e=>setDetails(e.target.checked)} />Copy document details too (replaces current details)</label>}
        <button type="button" style={button} onClick={()=>setSelected(selected.length===(source.items||[]).length?[]:(source.items||[]).map((_,i)=>i))}>Select / clear all items</button>
        <div style={{maxHeight:240,overflowY:"auto"}}>{(source.items||[]).map((line,i)=><label key={i} style={{...check,overflowWrap:"anywhere"}}>
          <input type="checkbox" checked={selected.includes(i)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,i]:prev.filter(n=>n!==i))} />
          <span>{line.description} — {line.quantity} {line.unit || line.uom}</span>
        </label>)}</div>
        <p style={{margin:0,fontSize:13}}>Items remain editable. Numbers, dates, payment/FBR status and order/delivery links are not copied.</p>
        <button type="button" style={button} disabled={!selected.length} onClick={()=>{
          onCopy(source,selected.map(i=>source.items[i]),details&&allowDetails&&type===destination);
          setOpen(false);setSource(null);setSelected([]);generation.current++;
        }}>{details&&allowDetails&&type===destination?"Copy document into this form":"Add selected items"}</button>
      </>}
    </div>}
  </section>;
}
const button={minHeight:44,padding:"8px 12px",border:"1px solid #d0d7e2",borderRadius:8,background:"#fff",color:"#0d47a1",cursor:"pointer"};
const check={display:"flex",alignItems:"center",gap:10,minHeight:44};
