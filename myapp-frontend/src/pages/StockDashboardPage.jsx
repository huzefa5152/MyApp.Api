import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { MdInventory, MdSearch, MdAdd, MdHistory, MdClose, MdSwapHoriz, MdExpandMore, MdChevronRight } from "react-icons/md";
import { getStockOnHand, getStockMovements } from "../api/stockApi";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import Pagination from "../Components/Pagination";
import StockEntryHistory from "../Components/StockEntryHistory";
import StockEntryForm from "../Components/StockEntryForm";
import "./StockDashboardPage.css";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
  rowAlt: "#fafbfd",
  bandBg: "#f0f7ff",
};

export default function StockDashboardPage() {
  const {selectedCompany} = useCompany();
  return <CompanyStockDashboard key={selectedCompany?.id || 'none'}/>;
}

function CompanyStockDashboard() {
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const canManageOpening = has("stock.opening.manage");
  const canAdjust = has("stock.adjust.create");
  const canViewMovements = has("stock.movements.view");
  const [entryDraft, setEntryDraft] = useState(null);
  const [loadError, setLoadError] = useState('');
  const alive = useRef(true), loadRequest = useRef(0), movementRequest = useRef(0);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);

  const [tab, setTab] = useState("onhand");
  const [onhand, setOnhand] = useState([]);
  const [movements, setMovements] = useState([]);
  const [movPage, setMovPage] = useState(1);
  const [movTotal, setMovTotal] = useState(0);
  // Server-driven page size from appsettings Pagination:DefaultPageSize.
  // Set after the first response so the pagination math is accurate.
  const [movPageSize, setMovPageSize] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // On-hand drill-down: which item-type row is expanded, plus a cache of
  // the full movement history per item type (so re-expanding is instant).
  const [expandedId, setExpandedId] = useState(null);
  const [drill, setDrill] = useState({});        // itemTypeId → movement[]
  const [drillLoading, setDrillLoading] = useState(null); // itemTypeId being fetched

  const fetchAll = useCallback(async () => {
    if (!selectedCompany) return;
    const request = ++loadRequest.current;
    setLoadError('');
    setMovPage(1);
    setLoading(true);
    try {
      const [oh, mov] = await Promise.all([
        getStockOnHand(selectedCompany.id),
        // 2026-05-12: also pull the movements first page on initial load
        // so the "Movements (N)" tab label shows the correct count
        // BEFORE the operator clicks into the tab. Pre-fix this was 0
        // until the tab was opened, which made the tab look empty even
        // when there were 20+ records waiting.
        canViewMovements
          ? getStockMovements(selectedCompany.id, { page: 1 }).catch(() => ({ data: { items: [], totalCount: 0, pageSize: 0 } }))
          : Promise.resolve({ data: { items: [], totalCount: 0, pageSize: 0 } }),
      ]);
      if (!alive.current || request !== loadRequest.current) return;
      setOnhand(oh.data || []);
      setMovements(mov.data?.items || []);
      setMovTotal(mov.data?.totalCount || 0);
      setMovPageSize(mov.data?.pageSize || 0);
      // A refresh can change movement history (new adjustment, edited bill),
      // so drop the drill cache; keep the expanded row open to refetch.
      setDrill({});
    } catch {
      if (!alive.current || request !== loadRequest.current) return;
      setOnhand([]);
      setLoadError('Could not load inventory. Please refresh.');
    } finally {
      if (alive.current && request === loadRequest.current) setLoading(false);
    }
  }, [selectedCompany, canViewMovements]);

  const fetchMovements = useCallback(async (pg) => {
    if (!selectedCompany || !canViewMovements) return;
    const request = ++movementRequest.current;
    try {
      // Don't send pageSize — let the server apply Pagination:DefaultPageSize
      // from appsettings.json. Read it back from the response so totalPages
      // is accurate.
      const { data } = await getStockMovements(selectedCompany.id, { page: pg || movPage });
      if (!alive.current || request !== movementRequest.current) return;
      setMovements(data.items || []);
      setMovTotal(data.totalCount || 0);
      setMovPageSize(data.pageSize || 0);
    } catch {
      if (!alive.current || request !== movementRequest.current) return;
      setMovements([]); setMovTotal(0);
    }
  }, [selectedCompany, movPage, canViewMovements]);

  useEffect(() => { if (selectedCompany) fetchAll(); }, [fetchAll]);
  useEffect(() => { if (tab === "movements") fetchMovements(movPage); }, [tab, selectedCompany, movPage]);

  const filteredOnhand = onhand.filter(r =>
    !search || r.itemTypeName.toLowerCase().includes(search.toLowerCase()) ||
    (r.hsCode || "").toLowerCase().includes(search.toLowerCase())
  );

  const openAdjustForRow = (row) => setEntryDraft({kind:'Adjustment',itemId:row.itemTypeId});

  // Expand/collapse the per-item movement drill-down. Pure toggle — the
  // fetch is driven by the effect below so a cache-clear (after an
  // adjustment / bill edit) re-loads an already-open row automatically.
  const toggleDrill = useCallback((itemTypeId) => {
    setExpandedId(prev => (prev === itemTypeId ? null : itemTypeId));
  }, []);

  // Load the FULL movement history for the expanded item (paging through
  // all pages — the feed is small per item) so the operator sees every IN,
  // OUT, reversal and adjustment, not just the first page. Cached per item.
  useEffect(() => {
    if (expandedId == null || !canViewMovements || !selectedCompany) return;
    if (drill[expandedId]) return; // already cached
    let cancelled = false;
    (async () => {
      setDrillLoading(expandedId);
      try {
        let page = 1, all = [], total = 0, size = 0;
        do {
          const { data } = await getStockMovements(selectedCompany.id, { itemTypeId: expandedId, page });
          all = all.concat(data.items || []);
          total = data.totalCount || 0;
          size = data.pageSize || (data.items?.length || 0);
          page += 1;
          if (!size) break;
        } while (all.length < total);
        if (!cancelled) setDrill(prev => ({ ...prev, [expandedId]: all }));
      } catch {
        if (!cancelled) setDrill(prev => ({ ...prev, [expandedId]: [] }));
      } finally {
        if (!cancelled) setDrillLoading(null);
      }
    })();
    return () => { cancelled = true; };
  }, [expandedId, drill, canViewMovements, selectedCompany]);

  // Drop the drill cache + collapse whenever the company changes.
  useEffect(() => { setExpandedId(null); setDrill({}); }, [selectedCompany]);

  return (
    <div className="stock-page inventory-page">
      <div data-admin-page-header="" className="inventory-heading">
        <div className="inventory-heading-title"><div data-admin-page-icon="" style={styles.headerIcon}><MdInventory size={23} color="#fff" /></div>
          <div><h2>Inventory</h2><p>Stock balances, movements and corrections.</p></div>
        </div>
        {companies.length > 0 && <label className="inventory-company"><span className="visually-hidden">Company</span>
          <select aria-label="Company" style={dropdownStyles.base} value={selectedCompany?.id || ""}
            onChange={e => setSelectedCompany(companies.find(c => String(c.id) === e.target.value))}>
            {companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
          </select></label>}
      </div>
      {loadingCompanies ? <p role="status">Loading companies…</p> : !selectedCompany ? <div style={styles.empty}>No companies available.</div> : <>
        {loadError && <p role="alert" className="inventory-error">{loadError}</p>}
        <div className="inventory-summary" aria-label="Inventory summary">
          <div><span>Stock items</span><strong>{loading ? '—' : onhand.length}</strong><small>Tracked inventory</small></div>
          <div><span>Stock value</span><strong>{loading ? '—' : `Rs. ${onhand.reduce((total, row) => total + (row.stockValue || 0), 0).toLocaleString('en-PK', {maximumFractionDigits:2})}`}</strong><small>Current cost basis</small></div>
          <div><span>Out of stock</span><strong className="inventory-attention">{loading ? '—' : onhand.filter(row => row.onHand <= 0).length}</strong><small>Items to review</small></div>
          <div><span>Inventory tracking</span><strong className="inventory-tracking">{selectedCompany.inventoryTrackingEnabled ? 'Enabled' : 'Off'}</strong><small>For this company</small></div>
        </div>
        {!selectedCompany.inventoryTrackingEnabled && <p className="inventory-warning">Tracking is off. Automatic stock movements are paused.</p>}
        <section className="inventory-panel" aria-label="Inventory records">
          <div className="inventory-tabs" role="tablist" aria-label="Inventory views">
            <TabBtn active={tab === "onhand"} onClick={() => setTab("onhand")}>Stock on hand</TabBtn>
            {(canManageOpening || canAdjust) && <TabBtn active={tab === "entries"} onClick={() => setTab("entries")}>Opening & adjustments</TabBtn>}
            {canViewMovements && <TabBtn active={tab === "movements"} onClick={() => setTab("movements")}>Movements ({movTotal})</TabBtn>}
          </div>
          {tab !== 'entries' && <div className="inventory-toolbar">
            {tab === 'onhand' ? <div className="inventory-search"><MdSearch aria-hidden="true"/><input aria-label="Search inventory" placeholder="Search item or HS code…" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><MdClose/></button>}</div> : <span className="inventory-caption">Stock movement history</span>}
            <div className="inventory-actions">
              <button type="button" disabled={loading} aria-label="Refresh inventory" onClick={fetchAll}>Refresh</button>
              {canManageOpening && <button type="button" onClick={() => setEntryDraft({kind:'Opening'})}><MdAdd aria-hidden="true"/> Opening stock</button>}
              {canAdjust && <button type="button" className="inventory-primary" onClick={() => setEntryDraft({kind:'Adjustment'})}><MdSwapHoriz aria-hidden="true"/> Adjustment</button>}
            </div>
          </div>}
          {tab === "entries" && (canManageOpening || canAdjust) && <StockEntryHistory companyId={selectedCompany.id} onChanged={fetchAll} onNewEntry={kind => setEntryDraft({kind})}/>}
          {tab === "onhand" && (
            <div className="inventory-record-scroll" role="region" aria-label="Stock on hand records" tabIndex={0}>
              {loading ? (
                <div style={styles.loading}><div style={styles.spinner} /></div>
              ) : filteredOnhand.length === 0 ? (
                <div style={styles.empty}>
                  <MdInventory size={40} color={colors.cardBorder} />
                  {search ? (
                    <>
                      <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
                        No items match "{search}".
                      </p>
                      <button type="button" style={styles.clearSearchBtn} onClick={() => setSearch("")}>
                        Clear search
                      </button>
                    </>
                  ) : (
                    <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
                      No stock data yet. Record opening stock or post a stock purchase / FBR-submitted invoice to start tracking.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {/* Desktop / tablet — table */}
                  <div data-admin-table-region="" className="stock-table" style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          {canViewMovements && <th style={{ ...styles.th, width: 34 }} aria-label="Expand"></th>}
                          <th style={{...styles.th,width:'25%'}}>Item / HS code</th>
                          <th style={styles.th}>UOM</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Opening</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Total IN</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Total OUT</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>On-Hand</th>
                          <th style={styles.th}>Last Movement</th>
                          {canAdjust && <th style={{ ...styles.th, width: 92 }} aria-label="Actions"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOnhand.map((r, idx) => {
                          const isOpen = expandedId === r.itemTypeId;
                          const rowBg = idx % 2 === 0 ? "#fff" : colors.rowAlt;
                          const colCount = 7 + (canViewMovements ? 1 : 0) + (canAdjust ? 1 : 0);
                          return (
                          <Fragment key={r.itemTypeId}>
                          <tr
                            style={{ backgroundColor: isOpen ? colors.bandBg : rowBg, cursor: canViewMovements ? "pointer" : "default" }}
                            onClick={canViewMovements ? () => toggleDrill(r.itemTypeId) : undefined}
                          >
                            {canViewMovements && (
                              <td style={{ ...styles.td, textAlign: "center", color: colors.textSecondary }}>
                                {isOpen ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}
                              </td>
                            )}
                            <td style={styles.td}>{canViewMovements ? <button type="button" className="inventory-item-link" aria-label={`Movement history for ${r.itemTypeName}`} aria-expanded={isOpen} onClick={e => {e.stopPropagation();toggleDrill(r.itemTypeId);}}>{r.itemTypeName}</button> : <strong>{r.itemTypeName}</strong>}<small>{r.hsCode || "—"}</small></td>
                            <td style={styles.td}>{r.uom || "—"}</td>
                            <td style={{ ...styles.td, textAlign: "right" }}>{r.openingBalance.toLocaleString()}</td>
                            <td style={{ ...styles.td, textAlign: "right", color: "#2e7d32" }}>+{r.totalIn.toLocaleString()}</td>
                            <td style={{ ...styles.td, textAlign: "right", color: "#c62828" }}>−{r.totalOut.toLocaleString()}</td>
                            <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: r.onHand < 0 ? "#c62828" : colors.blue }}>{r.onHand.toLocaleString()}</td>
                            <td style={{ ...styles.td, fontSize: "0.78rem", color: colors.textSecondary }}>
                              {r.lastMovementAt ? new Date(r.lastMovementAt).toLocaleDateString() : "—"}
                            </td>
                            {canAdjust && (
                              <td style={styles.td} onClick={e => e.stopPropagation()}>
                                <button type="button" style={rowAdjustBtn} onClick={() => openAdjustForRow(r)} title={`Record a stock adjustment for ${r.itemTypeName}`}>
                                  <MdSwapHoriz size={13} /> Adjust
                                </button>
                              </td>
                            )}
                          </tr>
                          {isOpen && canViewMovements && (
                            <tr>
                              <td colSpan={colCount} style={{ padding: 0, borderBottom: `1px solid ${colors.cardBorder}`, backgroundColor: colors.bandBg }}>
                                <DrillPanel
                                  rows={drill[r.itemTypeId]}
                                  loading={drillLoading === r.itemTypeId}
                                  uom={r.uom}
                                />
                              </td>
                            </tr>
                          )}
                          </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile — On-hand stack. The "answer" the page exists to
                      show is on-hand quantity, so it goes top-right at large
                      size. IN / OUT / Opening are secondary stats below. */}
                  <div className="stock-cards">
                    {filteredOnhand.map((r) => {
                      const isOpen = expandedId === r.itemTypeId;
                      return (
                      <div key={r.itemTypeId} className="stock-card">
                        <div className="stock-card__top">
                          <div className="stock-card__top-left">
                            <span className="stock-card__name">{r.itemTypeName}</span>
                            {r.hsCode && <span className="stock-card__hs">{r.hsCode}</span>}
                          </div>
                          <div className="stock-card__onhand">
                            <span className="stock-card__onhand-label">On-Hand</span>
                            <span
                              className="stock-card__onhand-value"
                              style={{ color: r.onHand < 0 ? "#c62828" : colors.blue }}
                            >
                              {r.onHand.toLocaleString()}
                              {r.uom && <span className="stock-card__uom"> {r.uom}</span>}
                            </span>
                          </div>
                        </div>
                        <div className="stock-card__stats">
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Opening</span>
                            <span className="stock-card__stat-value">{r.openingBalance.toLocaleString()}</span>
                          </div>
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Total IN</span>
                            <span className="stock-card__stat-value" style={{ color: "#2e7d32" }}>+{r.totalIn.toLocaleString()}</span>
                          </div>
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Total OUT</span>
                            <span className="stock-card__stat-value" style={{ color: "#c62828" }}>−{r.totalOut.toLocaleString()}</span>
                          </div>
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Last Move</span>
                            <span className="stock-card__stat-value stock-card__stat-value--muted">
                              {r.lastMovementAt ? new Date(r.lastMovementAt).toLocaleDateString() : "—"}
                            </span>
                          </div>
                        </div>
                        {canViewMovements && (
                          <button type="button" style={cardDrillBtn} onClick={() => toggleDrill(r.itemTypeId)}>
                            {isOpen ? <MdExpandMore size={16} /> : <MdChevronRight size={16} />}
                            {isOpen ? "Hide movements" : "View movements"}
                          </button>
                        )}
                        {isOpen && canViewMovements && (
                          <DrillPanel rows={drill[r.itemTypeId]} loading={drillLoading === r.itemTypeId} uom={r.uom} />
                        )}
                        {canAdjust && (
                          <button type="button" style={cardAdjustBtn} onClick={() => openAdjustForRow(r)}>
                            <MdSwapHoriz size={15} /> Adjustment
                          </button>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "movements" && canViewMovements && (
            <>
              {movements.length === 0 ? (
                <div style={styles.empty}>
                  <MdHistory size={40} color={colors.cardBorder} />
                  <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>No movements recorded yet.</p>
                </div>
              ) : (
                <>
                  <div className="inventory-record-scroll" role="region" aria-label="Stock movement records" tabIndex={0}>
                  {/* Desktop — table */}
                  <div data-admin-table-region="" className="stock-table" style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Date</th>
                          <th style={styles.th}>Item</th>
                          <th style={styles.th}>Direction</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Qty</th>
                          <th style={styles.th}>Source</th>
                          <th style={styles.th}>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((m, idx) => (
                          <tr key={m.id} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : colors.rowAlt }}>
                            <td style={styles.td}>{new Date(m.movementDate).toLocaleDateString()}</td>
                            <td style={styles.td}>{m.itemTypeName}</td>
                            <td style={{ ...styles.td, color: m.direction === "In" ? "#2e7d32" : "#c62828", fontWeight: 600 }}>{m.direction}</td>
                            <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>{m.quantity.toLocaleString()}</td>
                            <td style={{ ...styles.td, fontSize: "0.78rem" }}>{m.sourceType}{m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}</td>
                            <td style={{ ...styles.td, fontSize: "0.78rem", color: colors.textSecondary }}>{m.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile — movement cards */}
                  <div className="stock-cards">
                    {movements.map((m) => (
                      <div key={m.id} className="stock-card">
                        <div className="stock-card__top">
                          <div className="stock-card__top-left">
                            <span className="stock-card__name">{m.itemTypeName}</span>
                            <span className="stock-card__hs">{new Date(m.movementDate).toLocaleDateString()}</span>
                          </div>
                          <div className="stock-card__onhand">
                            <span
                              className="stock-card__direction"
                              style={{ color: m.direction === "In" ? "#2e7d32" : "#c62828" }}
                            >
                              {m.direction === "In" ? "+" : "−"}{m.quantity.toLocaleString()}
                            </span>
                            <span className="stock-card__direction-label">{m.direction}</span>
                          </div>
                        </div>
                        <div className="stock-card__source">
                          <span className="stock-card__stat-label">Source</span>
                          <span className="stock-card__stat-value">
                            {m.sourceType}{m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}
                          </span>
                        </div>
                        {m.notes && <div className="stock-card__notes">{m.notes}</div>}
                      </div>
                    ))}
                  </div>

                  </div>
                  {movPageSize > 0 && movTotal > movPageSize && (
                    <Pagination
                      page={movPage}
                      totalPages={Math.ceil(movTotal / movPageSize)}
                      total={movTotal}
                      onPage={setMovPage}
                    />
                  )}
                </>
              )}
            </>
          )}
        </section>
        </>
      }

      {entryDraft && selectedCompany && (entryDraft.kind === 'Opening' ? canManageOpening : canAdjust) && <StockEntryForm key={selectedCompany.id} companyId={selectedCompany.id} initialKind={entryDraft.kind} initialItemId={entryDraft.itemId} compact
        onClose={() => {setEntryDraft(null);fetchAll();}} onBack={() => {setEntryDraft(null);fetchAll();}}/>}

    </div>
  );
}

// Per-item movement history shown inside an expanded On-Hand row / card.
// Movements are GROUPED BY SOURCE DOCUMENT (one row per invoice / purchase
// bill / receipt with the summed quantity across its line items) — a bill
// with 3 lines of this item shows one row, not three. Adjustments, opening
// stock and document-less reversals stay individual. Newest-first with a
// running on-hand computed after each whole document.
function DrillPanel({ rows, loading, uom }) {
  if (loading) {
    return <div style={drillStyles.state}><div style={styles.spinner} /></div>;
  }
  if (!rows) {
    return <div style={drillStyles.state}>Loading…</div>;
  }
  if (rows.length === 0) {
    return <div style={drillStyles.state}>No movements recorded for this item yet.</div>;
  }

  const fmtQty = (q) => Number(q).toLocaleString(undefined, { maximumFractionDigits: 4 });

  // rows arrive newest-first from the API. Walk oldest→newest computing the
  // running balance, merging CONSECUTIVE rows that belong to the same source
  // document (+ direction, defensively) into one summed entry whose balance
  // is the on-hand AFTER the whole document. Rows without a SourceId
  // (adjustments, opening stock, deleted-document reversals) never merge.
  const oldestFirst = [...rows].reverse();
  let bal = 0;
  const grouped = [];
  for (const m of oldestFirst) {
    bal += m.direction === "In" ? Number(m.quantity) : -Number(m.quantity);
    const key = m.sourceId != null ? `${m.sourceType}:${m.sourceId}:${m.direction}` : `row:${m.id}`;
    const last = grouped[grouped.length - 1];
    if (last && last.groupKey === key) {
      last.quantity = Number(last.quantity) + Number(m.quantity);
      last.balance = bal;
      last.lineCount += 1;
      last.id = m.id;                     // newest id keeps the React key stable
      last.movementDate = m.movementDate; // same document date; keep newest
    } else {
      grouped.push({ ...m, groupKey: key, quantity: Number(m.quantity), balance: bal, lineCount: 1 });
    }
  }
  grouped.reverse();

  return (
    <div style={drillStyles.wrap}>
      <div style={drillStyles.heading}>
        <MdHistory size={15} /> Movement history ({grouped.length}{grouped.length !== rows.length ? ` documents · ${rows.length} line movements` : ""})
      </div>
      <div style={drillStyles.list}>
        {grouped.map((m) => {
          const isIn = m.direction === "In";
          const isAdjust = m.sourceType === "Adjustment";
          // Grouped rows: keep the note's document prefix, drop the per-line
          // detail (each line carried its own qty breakdown), and say how
          // many line items were summed.
          const noteText = m.lineCount > 1
            ? `${(m.notes || "").split(" (")[0]}${m.notes ? " — " : ""}${m.lineCount} line items summed`
            : m.notes;
          return (
            <div key={m.id} style={drillStyles.row}>
              <div style={drillStyles.rowMain}>
                <span style={{ ...drillStyles.dirBadge, ...(isIn ? drillStyles.dirIn : drillStyles.dirOut) }}>
                  {isIn ? "IN" : "OUT"}
                </span>
                <span style={{ ...drillStyles.qty, color: isIn ? "#2e7d32" : "#c62828" }}>
                  {isIn ? "+" : "−"}{fmtQty(m.quantity)}{uom ? ` ${uom}` : ""}
                </span>
                <span style={{ ...drillStyles.srcChip, ...(isAdjust ? drillStyles.srcAdjust : null) }}>
                  {m.sourceType}{m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}
                </span>
                <span style={drillStyles.date}>{new Date(m.movementDate).toLocaleDateString()}</span>
                <span style={drillStyles.bal}>bal {fmtQty(m.balance)}</span>
              </div>
              {noteText && <div style={drillStyles.notes}>{noteText}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TabBtn({ active, children, onClick }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick}>{children}</button>;
}

const rowAdjustBtn = { display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "1px solid #90caf9", backgroundColor: "#e3f2fd", color: "#0d47a1", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer", boxShadow: "none", whiteSpace: "nowrap" };
const cardAdjustBtn = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.35rem", width: "100%", minHeight: 44, marginTop: "0.6rem", padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid #90caf9", backgroundColor: "#e3f2fd", color: "#0d47a1", fontSize: "0.84rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" };
const cardDrillBtn = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.3rem", width: "100%", minHeight: 40, marginTop: "0.6rem", padding: "0.45rem 0.75rem", borderRadius: 8, border: "1px solid #d0d7e2", backgroundColor: "#fff", color: "#5f6d7e", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" };

const drillStyles = {
  wrap: { padding: "0.6rem 0.85rem 0.85rem" },
  heading: { display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.74rem", fontWeight: 700, color: "#5f6d7e", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" },
  state: { padding: "1rem 0.85rem", textAlign: "center", color: "#5f6d7e", fontSize: "0.82rem", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48 },
  list: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  row: { padding: "0.5rem 0.65rem", borderRadius: 8, border: "1px solid #e8edf3", backgroundColor: "#fff" },
  rowMain: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" },
  dirBadge: { fontSize: "0.66rem", fontWeight: 800, padding: "0.1rem 0.4rem", borderRadius: 5, letterSpacing: "0.03em" },
  dirIn: { backgroundColor: "#e8f5e9", color: "#2e7d32" },
  dirOut: { backgroundColor: "#fdecea", color: "#c62828" },
  qty: { fontSize: "0.9rem", fontWeight: 700, minWidth: 70 },
  srcChip: { fontSize: "0.74rem", fontWeight: 600, color: "#37474f", backgroundColor: "#eef2f7", padding: "0.12rem 0.45rem", borderRadius: 5 },
  srcAdjust: { backgroundColor: "#fff3e0", color: "#e65100" },
  date: { fontSize: "0.76rem", color: "#5f6d7e", marginLeft: "auto" },
  bal: { fontSize: "0.74rem", fontWeight: 700, color: "#0d47a1", backgroundColor: "#f0f7ff", padding: "0.12rem 0.45rem", borderRadius: 5 },
  notes: { fontSize: "0.74rem", color: "#5f6d7e", marginTop: "0.35rem", lineHeight: 1.35 },
};

const styles = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" },
  headerIcon: { width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, display: "flex", alignItems: "center", justifyContent: "center" },
  title: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  subtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  altBtn: { display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.45rem 0.85rem", borderRadius: 8, border: "1px solid #d0d7e2", backgroundColor: "#fff", color: "#0d47a1", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", textAlign: "center", color: colors.textSecondary },
  warnBanner: { padding: "0.65rem 0.95rem", marginBottom: "1rem", backgroundColor: "#fff8e1", border: "1px solid #ffcc80", borderRadius: 8, color: "#bf360c", fontSize: "0.85rem" },
  tabs: { display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" },
  searchWrap: { position: "relative", marginBottom: "1rem", maxWidth: 360 },
  searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" },
  searchInput: { width: "100%", padding: "0.55rem 2.4rem 0.55rem 2.3rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 10, fontSize: "0.88rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none" },
  searchClear: { position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", color: "#94a3b8", cursor: "pointer", padding: 0, boxShadow: "none" },
  clearSearchBtn: { marginTop: "0.75rem", padding: "0.45rem 1rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.84rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" },
  tableWrap: { overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, backgroundColor: "#fff" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" },
  th: { textAlign: "left", padding: "0.6rem 0.85rem", backgroundColor: "#f5f8fc", borderBottom: `1px solid ${colors.cardBorder}`, fontSize: "0.76rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em" },
  td: { padding: "0.55rem 0.85rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textPrimary, verticalAlign: "top" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "0.75rem 0" },
  pageBtn: { padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
};
