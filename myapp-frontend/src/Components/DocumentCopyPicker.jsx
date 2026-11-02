import { useEffect, useRef, useState } from "react";
import http from "../api/httpClient";
import { usePermissions } from "../contexts/PermissionsContext";
import { COPY_TYPES } from "../utils/documentCopy";
import { formStyles } from "../theme";
import { MdContentCopy, MdClose, MdSearch, MdInbox, MdChevronLeft, MdChevronRight } from "react-icons/md";

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
  // Is there anything to copy at all? A one-row count per allowed type, the
  // form's own type first and the rest only while those come back empty, so a
  // form with source documents costs one small request. null = still checking,
  // and any failure counts as "maybe" so a flaky network never hides the button.
  const [hasSources,setHasSources] = useState(null);
  const typeKeys = types.map(([k]) => k).join(",");
  useEffect(() => {
    if (disabled || !companyId || !typeKeys) return undefined;
    let active = true;
    const order = typeKeys.split(",").sort((x,y) => (x===destination ? -1 : y===destination ? 1 : 0));
    (async () => {
      for (const key of order) {
        try {
          const {data} = await http.get(`/${COPY_TYPES[key].route}/company/${companyId}/paged`, {params:{page:1,pageSize:1}});
          if (!active) return;
          if ((data?.totalCount || 0) > 0) { setHasSources(true); return; }
        } catch { if (active) setHasSources(true); return; }
      }
      if (active) setHasSources(false);
    })();
    return () => { active = false; };
  }, [companyId, typeKeys, destination, disabled]);
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
  // Nothing of any allowed type exists for this company: no button, rather
  // than one that opens onto an empty list. An open panel is never pulled away.
  if(hasSources === false && !open)return null;
  // Presentation only below: every state change and request above is unchanged.
  const label = COPY_TYPES[type]?.label || "document";
  const pages = Math.max(1, Math.ceil(total / 20));
  const itemCount = (source?.items || []).length;
  const copyAll = details && allowDetails && type === destination;
  const nothingToPick = !error && !busy && docs.length === 0;
  return <section className="admin-document-copy" data-open={open} style={{border:"1px solid #d0d7e2",borderRadius:10,padding:12,marginBottom:16}}>
    <button type="button" aria-expanded={open} style={toggle} onClick={() => {if(!open&&!types.some(([k])=>k===type))setType(types[0][0]);setOpen(!open);}}>
      <MdContentCopy size={15} aria-hidden="true" /> Copy from a document
      {open && <MdClose size={15} aria-hidden="true" style={{marginLeft:2,opacity:0.7}} />}
    </button>
    {open && <div className="admin-document-copy__panel" style={{display:"grid",gap:10,marginTop:10}}>
      {/* What to copy from, and a search, on one line. */}
      <div style={{display:"grid",gap:8,gridTemplateColumns:"repeat(auto-fit, minmax(min(180px, 100%), 1fr))"}}>
        <select aria-label="Copy source type" style={formStyles.input} value={type} onChange={e=>{setType(e.target.value);setPage(1);setDetails(false);}}>
          {types.map(([key,t])=><option key={key} value={key}>{t.label}</option>)}
        </select>
        <div style={{position:"relative",gridColumn:"span 2",minWidth:0}}>
          <MdSearch size={16} aria-hidden="true" style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"#8a97a8"}} />
          <input aria-label="Find source document" style={{...formStyles.input,paddingLeft:32}} placeholder="Search number or customer / supplier" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} />
        </div>
      </div>
      {error && <div role="alert" style={formStyles.error}>{error}</div>}
      {nothingToPick ? (
        // Nothing to copy: say so, rather than an empty dropdown and pager.
        <div style={empty}>
          <MdInbox size={22} aria-hidden="true" style={{color:"#8a97a8",flexShrink:0}} />
          <div>
            <strong style={{display:"block",color:"#1a2332"}}>{search ? `No ${label.toLowerCase()} matches "${search}"` : `No ${label.toLowerCase()} to copy from yet`}</strong>
            <span>{search ? "Try another number or name." : types.length > 1 ? "Choose another document type above, or close this and fill the form in." : "Close this and fill the form in."}</span>
          </div>
        </div>
      ) : (
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select aria-label="Copy source document" style={{...formStyles.input,flex:"1 1 260px",minWidth:0}} value={source?.id || ""} disabled={busy} onChange={e=>e.target.value&&choose(e.target.value)}>
            <option value="">{busy ? "Loading…" : `Choose a ${label.toLowerCase()} (${total})`}</option>
            {docs.map(d=><option key={d.id} value={d.id}>#{d[COPY_TYPES[type].number]} — {d.clientName || d.supplierName || ""}</option>)}
          </select>
          {pages > 1 && <div style={{display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}>
            <button type="button" style={pager} aria-label="Previous page" disabled={page===1||busy} onClick={()=>setPage(page-1)}><MdChevronLeft size={18} /></button>
            <span style={{fontSize:12.5,color:"#5f6d7e",whiteSpace:"nowrap"}}>Page {page} of {pages}</span>
            <button type="button" style={pager} aria-label="Next page" disabled={page*20>=total||busy} onClick={()=>setPage(page+1)}><MdChevronRight size={18} /></button>
          </div>}
        </div>
      )}
      {/* Hidden (not cleared) while the empty state shows: with the document
          list gone there is nothing saying which document these lines are. */}
      {source && !nothingToPick && <>
        <div style={{display:"flex",gap:8,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
          {allowDetails&&type===destination ? <label style={check}><input type="checkbox" checked={details} onChange={e=>setDetails(e.target.checked)} />Copy document details too (replaces current details)</label> : <span />}
          <button type="button" style={linkBtn} onClick={()=>setSelected(selected.length===(source.items||[]).length?[]:(source.items||[]).map((_,i)=>i))}>
            {selected.length === itemCount ? "Clear all" : "Select all"} · {selected.length}/{itemCount}
          </button>
        </div>
        <div style={lines}>{(source.items||[]).map((line,i)=><label key={i} style={{...check,minHeight:36,padding:"4px 10px",borderBottom:i<itemCount-1?"1px solid #eef2f7":"none",overflowWrap:"anywhere"}}>
          <input type="checkbox" checked={selected.includes(i)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,i]:prev.filter(n=>n!==i))} />
          <span style={{flex:1,minWidth:0}}>{line.description}</span>
          {/* Read as "description — quantity unit"; the dash is only hidden visually. */}
          <span style={srOnly}> — </span>
          <span style={{color:"#5f6d7e",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{line.quantity} {line.unit || line.uom}</span>
        </label>)}</div>
        <div style={{display:"flex",gap:10,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
          <p style={{margin:0,fontSize:12.5,color:"#5f6d7e",flex:"1 1 260px"}}>Items remain editable. Numbers, dates, payment/FBR status and order/delivery links are not copied.</p>
          <button type="button" style={{...primary,opacity:selected.length?1:0.5}} disabled={!selected.length} onClick={()=>{
            onCopy(source,selected.map(i=>source.items[i]),details&&allowDetails&&type===destination);
            setOpen(false);setSource(null);setSelected([]);generation.current++;
          }}>{copyAll ? "Copy document into this form" : <>Add selected items <span aria-hidden="true" style={countBadge}>{selected.length}</span></>}</button>
        </div>
      </>}
    </div>}
  </section>;
}
const toggle={display:"inline-flex",alignItems:"center",gap:6,minHeight:36,padding:"6px 12px",border:"1px solid #d0d7e2",borderRadius:8,background:"#fff",color:"#0d47a1",fontWeight:600,fontSize:13,cursor:"pointer"};
const pager={display:"grid",placeItems:"center",width:32,height:32,padding:0,border:"1px solid #d0d7e2",borderRadius:8,background:"#fff",color:"#0d47a1",cursor:"pointer"};
const linkBtn={padding:"4px 6px",border:"none",background:"none",color:"#0d47a1",fontWeight:600,fontSize:13,cursor:"pointer"};
const primary={minHeight:36,padding:"7px 16px",border:"none",borderRadius:8,background:"linear-gradient(135deg, #0d47a1, #00897b)",color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"};
const check={display:"flex",alignItems:"center",gap:10,minHeight:36,fontSize:13};
const lines={maxHeight:240,overflowY:"auto",border:"1px solid #e8edf3",borderRadius:8,background:"#fff"};
const srOnly={position:"absolute",width:1,height:1,overflow:"hidden",clip:"rect(0 0 0 0)",whiteSpace:"nowrap"};
const countBadge={display:"inline-grid",placeItems:"center",minWidth:20,height:20,padding:"0 6px",marginLeft:6,borderRadius:999,background:"rgba(255,255,255,0.25)",fontSize:11.5};
const empty={display:"flex",gap:10,alignItems:"flex-start",padding:"12px 14px",border:"1px dashed #d0d7e2",borderRadius:8,background:"#f8f9fb",fontSize:13,color:"#5f6d7e",lineHeight:1.45};
