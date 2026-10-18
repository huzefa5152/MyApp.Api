import {useEffect, useRef, useState} from 'react';
import {MdAdd, MdRefresh, MdUndo} from 'react-icons/md';
import http from '../api/httpClient';
import {colors, formStyles} from '../theme';
import {usePermissions} from '../contexts/PermissionsContext';
import {useConfirm} from './ConfirmDialog';
import StockEntryForm from './StockEntryForm';
import '../pages/StockDashboardPage.css';

const buttonStyle = {...formStyles.button, minHeight:44};
const number = value => Number(value).toLocaleString('en-PK', {maximumFractionDigits:4});
const money = value => Number(value).toLocaleString('en-PK', {minimumFractionDigits:2, maximumFractionDigits:2});

// The company key discards rows, pending confirmations and drafts on a company switch.
export default function StockEntryHistory({companyId, onChanged, onNewEntry}) {
  return <CompanyStockEntryHistory key={companyId} companyId={companyId} onChanged={onChanged} onNewEntry={onNewEntry}/>;
}

function CompanyStockEntryHistory({companyId, onChanged, onNewEntry}) {
  const {has} = usePermissions();
  const canOpen = has('stock.opening.manage'), canAdjust = has('stock.adjust.create');
  const allowed = canOpen || canAdjust;
  const confirm = useConfirm();
  const [kind, setKind] = useState(''), [status, setStatus] = useState(''), [search, setSearch] = useState('');
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
    const filters = new URLSearchParams();
    if (kind) filters.set('kind', kind);
    if (status) filters.set('status', status);
    if (search.trim()) filters.set('search', search.trim());
    http.get(`/stockentries/company/${companyId}?page=${page}${filters.size ? '&' + filters.toString() : ''}`)
      .then(({data}) => {if (active) setEntries(data);})
      .catch(() => {if (active) setError('Could not load stock entries. Please retry.');})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [companyId, page, refresh, allowed, canOpen, canAdjust, kind, status, search]);

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
  return <section aria-label="Opening stock and adjustment history" className="inventory-entry-history">
    <div className="inventory-toolbar">
      <div className="inventory-search"><input aria-label="Search stock entries" placeholder="Search item or reason…" maxLength={100} value={search} onChange={e => {setPage(1);setSearch(e.target.value);}}/></div>
      <div className="inventory-actions">
        <select aria-label="Entry type filter" value={kind} onChange={e => {setPage(1);setKind(e.target.value);}}><option value="">All entry types</option>{canOpen && <option value="Opening">Opening stock</option>}{canAdjust && <option value="Adjustment">Adjustments</option>}</select>
        <select aria-label="Entry status filter" value={status} onChange={e => {setPage(1);setStatus(e.target.value);}}><option value="">All statuses</option><option value="active">Active</option><option value="reversed">Reversed</option></select>
        <button type="button" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}><MdRefresh aria-hidden="true"/> Refresh entries</button>
        {onNewEntry ? <>{canOpen && <button type="button" disabled={busy} onClick={() => onNewEntry('Opening')}><MdAdd aria-hidden="true"/> Opening stock</button>}{canAdjust && <button className="inventory-primary" type="button" disabled={busy} onClick={() => onNewEntry('Adjustment')}>Adjustment</button>}</> :
          <button type="button" className="inventory-primary" disabled={busy} onClick={() => setShowForm(true)}><MdAdd aria-hidden="true"/> New stock entry</button>}
      </div>
    </div>
    <p className="inventory-caption inventory-history-note">Stock and valuation only · No supplier payable.</p>
    {error && <p role="alert" style={formStyles.error}>{error}</p>}
    {success && <p role="status" style={{color:colors.teal}}>{success}</p>}
    <div className="inventory-record-scroll" role="region" aria-label="Stock entry records" tabIndex={0}>
    {loading ? <p role="status">Loading stock entries…</p> : <>
      {!error && !visible.length && <p>{page === 1 ? 'No stock entries yet.' : 'No more stock entries.'}</p>}
      <div className="inventory-entry-columns" aria-hidden="true"><span>Entry / date</span><span>Item / reason</span><span>Type</span><span>Quantity</span><span>Unit cost</span><span>Value</span><span>Status</span><span/></div>
      <div>{visible.map(entry => <article key={entry.id} aria-label={`Stock entry #${entry.id}`} className="inventory-entry-row">
        <div className="inventory-entry-id"><strong>#{entry.id}</strong><small>{entry.date.slice(0,10)}</small></div>
        <div className="inventory-entry-item"><strong>{entry.itemName}</strong><small>{entry.reason}</small></div>
        <div className="inventory-entry-kind">{entry.kind === 'Opening' ? 'Opening stock' : 'Stock adjustment'}</div>
        <div className="inventory-entry-number"><span className="inventory-mobile-label">Quantity</span><strong>{entry.quantityDelta > 0 ? '+' : ''}{number(entry.quantityDelta)} {entry.uom}</strong></div>
        <div className="inventory-entry-number"><span className="inventory-mobile-label">Unit cost</span>Rs. {money(entry.unitCost)}</div>
        <div className="inventory-entry-number"><span className="inventory-mobile-label">Value</span>Rs. {money(Math.abs(entry.quantityDelta * entry.unitCost))}</div>
        <span className={`inventory-badge ${entry.isCancelled ? 'is-reversed' : ''}`}>{entry.isCancelled ? 'Reversed' : 'Active'}</span>
        <div>{!entry.isCancelled && <button type="button" className="inventory-reverse" aria-label={`Reverse entry #${entry.id}`} disabled={busy}
          onClick={() => reverse(entry)}><MdUndo aria-hidden="true"/> Reverse</button>}</div>
      </article>)}</div>
    </>}
    </div>
    <nav aria-label="Stock entry pages" className="inventory-pagination">
      <button type="button" style={buttonStyle} disabled={busy || loading || page === 1} onClick={() => setPage(value => value - 1)}>Previous entries</button>
      <span>Page {page}</span>
      <button type="button" style={buttonStyle} disabled={busy || loading || !!error || entries.length < 20} onClick={() => setPage(value => value + 1)}>Next entries</button>
    </nav>
    {showForm && <StockEntryForm companyId={companyId} onBack={() => {setShowForm(false); setRefresh(value => value + 1); onChanged?.();}}
      onClose={() => {setShowForm(false); setRefresh(value => value + 1); onChanged?.();}}/>}
  </section>;
}
