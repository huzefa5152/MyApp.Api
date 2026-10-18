import {useEffect, useRef, useState} from 'react';
import {MdAdd, MdRefresh, MdUndo} from 'react-icons/md';
import http from '../api/httpClient';
import {colors, formStyles} from '../theme';
import {usePermissions} from '../contexts/PermissionsContext';
import {useConfirm} from './ConfirmDialog';
import StockEntryForm from './StockEntryForm';

const rowStyle = {display:'flex', flexWrap:'wrap', alignItems:'center', justifyContent:'space-between', gap:12};
const buttonStyle = {...formStyles.button, minHeight:44};
const number = value => Number(value).toLocaleString('en-PK', {maximumFractionDigits:4});
const money = value => Number(value).toLocaleString('en-PK', {minimumFractionDigits:2, maximumFractionDigits:2});

// The company key discards rows, pending confirmations and drafts on a company switch.
export default function StockEntryHistory({companyId, onChanged}) {
  return <CompanyStockEntryHistory key={companyId} companyId={companyId} onChanged={onChanged}/>;
}

function CompanyStockEntryHistory({companyId, onChanged}) {
  const {has} = usePermissions();
  const canOpen = has('stock.opening.manage'), canAdjust = has('stock.adjust.create');
  const allowed = canOpen || canAdjust;
  const confirm = useConfirm();
  const [entries, setEntries] = useState([]), [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [refresh, setRefresh] = useState(0), [showForm, setShowForm] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);

  useEffect(() => {
    let active = true;
    setEntries([]); setError(''); setLoading(true);
    if (!companyId || !allowed) {setLoading(false); return;}
    http.get(`/stockentries/company/${companyId}?page=${page}`)
      .then(({data}) => {if (active) setEntries(data);})
      .catch(() => {if (active) setError('Could not load stock entries. Please retry.');})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [companyId, page, refresh, allowed, canOpen, canAdjust]);

  async function reverse(entry) {
    if (busy) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const accepted = await confirm({title:`Reverse stock entry #${entry.id}?`,
        message:`Reverse ${entry.itemName} in stock and accounting.`, confirmText:'Reverse entry', variant:'danger'});
      if (!accepted || !mounted.current) return;
      await http.post(`/stockentries/${entry.id}/cancel`);
      if (!mounted.current) return;
      setSuccess(`Stock entry #${entry.id} reversed.`);
      setRefresh(value => value + 1); onChanged?.();
    } catch (err) {
      if (mounted.current) setError(err.response?.data?.error || 'Could not reverse this entry. Please retry.');
    } finally {if (mounted.current) setBusy(false);}
  }

  if (!allowed) return null;
  const visible = entries.filter(entry => entry.kind === 'Opening' ? canOpen : canAdjust);
  return <section aria-label="Opening stock and adjustment history" style={{minWidth:0}}>
    <div style={{...rowStyle, marginBottom:16}}>
      <div><h3 style={{fontSize:20, color:colors.blue, margin:'0 0 4px'}}>Opening stock & adjustments</h3>
        <p style={{color:colors.textSecondary, margin:0}}>Stock and valuation only · No supplier payable.</p></div>
      <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
        <button type="button" style={buttonStyle} disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}><MdRefresh aria-hidden="true"/> Refresh entries</button>
        <button type="button" style={{...buttonStyle, ...formStyles.submit}} disabled={busy} onClick={() => setShowForm(true)}><MdAdd aria-hidden="true"/> New stock entry</button>
      </div>
    </div>
    {error && <p role="alert" style={formStyles.error}>{error}</p>}
    {success && <p role="status" style={{color:colors.teal}}>{success}</p>}
    {loading ? <p role="status">Loading stock entries…</p> : <>
      {!error && !visible.length && <p>{page === 1 ? 'No stock entries yet.' : 'No more stock entries.'}</p>}
      <div style={{display:'grid', gap:12}}>{visible.map(entry => <article key={entry.id} aria-label={`Stock entry #${entry.id}`}
        style={{background:colors.cardBg, border:`1px solid ${colors.cardBorder}`, borderRadius:12, padding:16, overflowWrap:'anywhere', minWidth:0}}>
        <div style={rowStyle}>
          <strong style={{color:colors.textPrimary}}>#{entry.id} · {entry.itemName}</strong>
          <span style={{color:entry.isCancelled ? colors.textSecondary : colors.teal, fontWeight:600}}>{entry.isCancelled ? 'Reversed' : 'Active'}</span>
        </div>
        <p style={{color:colors.textSecondary, margin:'8px 0'}}>{entry.kind === 'Opening' ? 'Opening stock' : 'Stock adjustment'} · {entry.date.slice(0,10)}</p>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(150px,100%),1fr))', gap:12}}>
          <div><span style={{color:colors.textSecondary}}>Quantity</span><br/><strong>{entry.quantityDelta > 0 ? '+' : ''}{number(entry.quantityDelta)} {entry.uom}</strong></div>
          <div><span style={{color:colors.textSecondary}}>Unit cost</span><br/><strong>Rs. {money(entry.unitCost)}</strong></div>
          <div><span style={{color:colors.textSecondary}}>Value</span><br/><strong>Rs. {money(Math.abs(entry.quantityDelta * entry.unitCost))}</strong></div>
        </div>
        <p style={{margin:'12px 0', color:colors.textSecondary}}>{entry.reason}</p>
        {!entry.isCancelled && <button type="button" style={{...buttonStyle, color:colors.danger}} disabled={busy}
          onClick={() => reverse(entry)}><MdUndo aria-hidden="true"/> Reverse entry #{entry.id}</button>}
      </article>)}</div>
    </>}
    <nav aria-label="Stock entry pages" style={{...rowStyle, marginTop:16}}>
      <button type="button" style={buttonStyle} disabled={busy || loading || page === 1} onClick={() => setPage(value => value - 1)}>Previous entries</button>
      <span>Page {page}</span>
      <button type="button" style={buttonStyle} disabled={busy || loading || !!error || entries.length < 20} onClick={() => setPage(value => value + 1)}>Next entries</button>
    </nav>
    {showForm && <StockEntryForm companyId={companyId} onBack={() => {setShowForm(false); setRefresh(value => value + 1); onChanged?.();}}
      onClose={() => {setShowForm(false); setRefresh(value => value + 1); onChanged?.();}}/>}
  </section>;
}
