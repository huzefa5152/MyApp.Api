import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import {
  MdInventory,
  MdBusiness,
  MdAdd,
  MdHistory,
  MdClose,
  MdSwapHoriz,
  MdExpandMore,
  MdChevronRight,
  MdRefresh,
} from "react-icons/md";
import { getStockOnHand, getStockMovements } from "../api/stockApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import Pagination from "../Components/Pagination";
import StockEntryHistory from "../Components/StockEntryHistory";
import StockEntryForm from "../Components/StockEntryForm";
import {
  PageHeader,
  CompanyPicker,
  Button,
  IconButton,
  Toolbar,
  ToolbarSpacer,
  SearchBox,
  Tabs,
  TableWrap,
  StatGrid,
  StatCard,
  Alert,
  EmptyState,
  Loading,
} from "../ui/Kit";
import "./StockDashboardPage.css";

export default function StockDashboardPage() {
  const { selectedCompany } = useCompany();
  return <CompanyStockDashboard key={selectedCompany?.id || "none"} />;
}

function CompanyStockDashboard() {
  const { selectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const canManageOpening = has("stock.opening.manage");
  const canAdjust = has("stock.adjust.create");
  const canViewMovements = has("stock.movements.view");
  const [entryDraft, setEntryDraft] = useState(null);
  const [loadError, setLoadError] = useState("");
  const alive = useRef(true),
    loadRequest = useRef(0),
    movementRequest = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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
  const [drill, setDrill] = useState({}); // itemTypeId → movement[]
  const [drillLoading, setDrillLoading] = useState(null); // itemTypeId being fetched

  const fetchAll = useCallback(async () => {
    if (!selectedCompany) return;
    const request = ++loadRequest.current;
    setLoadError("");
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
          ? getStockMovements(selectedCompany.id, { page: 1 }).catch(() => ({
              data: { items: [], totalCount: 0, pageSize: 0 },
            }))
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
      setLoadError("Could not load inventory. Please refresh.");
    } finally {
      if (alive.current && request === loadRequest.current) setLoading(false);
    }
  }, [selectedCompany, canViewMovements]);

  const fetchMovements = useCallback(
    async (pg) => {
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
        setMovements([]);
        setMovTotal(0);
      }
    },
    [selectedCompany, movPage, canViewMovements],
  );

  useEffect(() => {
    if (selectedCompany) fetchAll();
  }, [fetchAll]);
  useEffect(() => {
    if (tab === "movements") fetchMovements(movPage);
  }, [tab, selectedCompany, movPage]);

  const filteredOnhand = onhand.filter(
    (r) =>
      !search ||
      r.itemTypeName.toLowerCase().includes(search.toLowerCase()) ||
      (r.hsCode || "").toLowerCase().includes(search.toLowerCase()),
  );

  const openAdjustForRow = (row) => setEntryDraft({ kind: "Adjustment", itemId: row.itemTypeId });

  // Expand/collapse the per-item movement drill-down. Pure toggle — the
  // fetch is driven by the effect below so a cache-clear (after an
  // adjustment / bill edit) re-loads an already-open row automatically.
  const toggleDrill = useCallback((itemTypeId) => {
    setExpandedId((prev) => (prev === itemTypeId ? null : itemTypeId));
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
        let page = 1,
          all = [],
          total = 0,
          size = 0;
        do {
          const { data } = await getStockMovements(selectedCompany.id, {
            itemTypeId: expandedId,
            page,
          });
          all = all.concat(data.items || []);
          total = data.totalCount || 0;
          size = data.pageSize || data.items?.length || 0;
          page += 1;
          if (!size) break;
        } while (all.length < total);
        if (!cancelled) setDrill((prev) => ({ ...prev, [expandedId]: all }));
      } catch {
        if (!cancelled) setDrill((prev) => ({ ...prev, [expandedId]: [] }));
      } finally {
        if (!cancelled) setDrillLoading(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expandedId, drill, canViewMovements, selectedCompany]);

  // Drop the drill cache + collapse whenever the company changes.
  useEffect(() => {
    setExpandedId(null);
    setDrill({});
  }, [selectedCompany]);

  const tabs = [
    { key: "onhand", label: "Stock on hand" },
    (canManageOpening || canAdjust) && { key: "entries", label: "Opening & adjustments" },
    canViewMovements && { key: "movements", label: "Movements", count: movTotal },
  ].filter(Boolean);

  return (
    <div className="stock-page inventory-page">
      <PageHeader
        icon={MdInventory}
        tone="brand"
        title="Inventory"
        subtitle="Stock balances, movements and corrections."
      />

      {loadingCompanies ? (
        <Loading>Loading companies…</Loading>
      ) : !selectedCompany ? (
        <EmptyState icon={MdBusiness}>No companies available.</EmptyState>
      ) : (
        <>
          <CompanyPicker />

          {loadError && <Alert tone="error">{loadError}</Alert>}

          <StatGrid>
            <StatCard
              label="Stock items"
              value={loading ? "—" : onhand.length}
              hint="Tracked inventory"
              tone="blue"
            />
            <StatCard
              label="Stock value"
              value={
                loading
                  ? "—"
                  : `Rs. ${onhand.reduce((total, row) => total + (row.stockValue || 0), 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`
              }
              hint="Current cost basis"
              tone="teal"
            />
            <StatCard
              label="Out of stock"
              value={loading ? "—" : onhand.filter((row) => row.onHand <= 0).length}
              hint="Items to review"
              tone="orange"
            />
            <StatCard
              label="Inventory tracking"
              value={selectedCompany.inventoryTrackingEnabled ? "Enabled" : "Off"}
              hint="For this company"
              tone="purple"
            />
          </StatGrid>

          {!selectedCompany.inventoryTrackingEnabled && (
            <Alert tone="warn">Tracking is off. Automatic stock movements are paused.</Alert>
          )}

          <Tabs
            tabs={tabs}
            value={tab}
            onChange={setTab}
            label="Inventory views"
            idPrefix="stock-tab"
          />

          <section aria-label="Inventory records">
            {tab !== "entries" && (
              <Toolbar>
                {tab === "onhand" ? (
                  <>
                    <SearchBox
                      value={search}
                      onChange={setSearch}
                      placeholder="Search item or HS code…"
                      label="Search inventory"
                    />
                    {search && (
                      <IconButton
                        label="Clear search"
                        icon={MdClose}
                        size={16}
                        onClick={() => setSearch("")}
                      />
                    )}
                  </>
                ) : (
                  <span className="k-muted">Stock movement history</span>
                )}
                <ToolbarSpacer />
                <Button
                  icon={MdRefresh}
                  disabled={loading}
                  aria-label="Refresh inventory"
                  onClick={fetchAll}
                >
                  Refresh
                </Button>
                {canManageOpening && (
                  <Button icon={MdAdd} onClick={() => setEntryDraft({ kind: "Opening" })}>
                    Opening stock
                  </Button>
                )}
                {canAdjust && (
                  <Button
                    variant="primary"
                    icon={MdSwapHoriz}
                    onClick={() => setEntryDraft({ kind: "Adjustment" })}
                  >
                    Adjustment
                  </Button>
                )}
              </Toolbar>
            )}

            {tab === "entries" && (canManageOpening || canAdjust) && (
              <StockEntryHistory
                companyId={selectedCompany.id}
                onChanged={fetchAll}
                onNewEntry={(kind) => setEntryDraft({ kind })}
              />
            )}

            {tab === "onhand" && (
              <div
                className="inventory-record-scroll"
                role="region"
                aria-label="Stock on hand records"
                tabIndex={0}
              >
                {loading ? (
                  <Loading>Loading stock…</Loading>
                ) : filteredOnhand.length === 0 ? (
                  search ? (
                    <EmptyState
                      icon={MdInventory}
                      action={
                        <Button size="sm" onClick={() => setSearch("")}>
                          Clear search
                        </Button>
                      }
                    >
                      No items match "{search}".
                    </EmptyState>
                  ) : (
                    <EmptyState icon={MdInventory}>
                      No stock data yet. Record opening stock or post a stock purchase /
                      FBR-submitted invoice to start tracking.
                    </EmptyState>
                  )
                ) : (
                  <>
                    {/* Desktop / tablet — table */}
                    <TableWrap data-admin-table-region="" className="stock-table">
                      <table className="k-table">
                        <thead>
                          <tr>
                            {canViewMovements && (
                              <th style={{ width: 34 }} aria-label="Expand"></th>
                            )}
                            <th style={{ width: "25%" }}>Item / HS code</th>
                            <th>UOM</th>
                            <th className="k-num">Opening</th>
                            <th className="k-num">Total IN</th>
                            <th className="k-num">Total OUT</th>
                            <th className="k-num">On-Hand</th>
                            <th>Last Movement</th>
                            {canAdjust && <th style={{ width: 92 }} aria-label="Actions"></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOnhand.map((r) => {
                            const isOpen = expandedId === r.itemTypeId;
                            const colCount = 7 + (canViewMovements ? 1 : 0) + (canAdjust ? 1 : 0);
                            return (
                              <Fragment key={r.itemTypeId}>
                                <tr
                                  style={{
                                    backgroundColor: isOpen ? BAND_BG : undefined,
                                    cursor: canViewMovements ? "pointer" : "default",
                                  }}
                                  onClick={
                                    canViewMovements ? () => toggleDrill(r.itemTypeId) : undefined
                                  }
                                >
                                  {canViewMovements && (
                                    <td className="is-center k-muted">
                                      {isOpen ? (
                                        <MdExpandMore size={18} />
                                      ) : (
                                        <MdChevronRight size={18} />
                                      )}
                                    </td>
                                  )}
                                  <td>
                                    {canViewMovements ? (
                                      <button
                                        type="button"
                                        className="inventory-item-link"
                                        aria-label={`Movement history for ${r.itemTypeName}`}
                                        aria-expanded={isOpen}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleDrill(r.itemTypeId);
                                        }}
                                      >
                                        {r.itemTypeName}
                                      </button>
                                    ) : (
                                      <strong>{r.itemTypeName}</strong>
                                    )}
                                    <small>{r.hsCode || "—"}</small>
                                  </td>
                                  <td>{r.uom || "—"}</td>
                                  <td className="k-num">{r.openingBalance.toLocaleString()}</td>
                                  <td className="k-num" style={{ color: IN_COLOR }}>
                                    +{r.totalIn.toLocaleString()}
                                  </td>
                                  <td className="k-num" style={{ color: OUT_COLOR }}>
                                    −{r.totalOut.toLocaleString()}
                                  </td>
                                  <td
                                    className="k-num"
                                    style={{
                                      fontWeight: 700,
                                      color: r.onHand < 0 ? OUT_COLOR : "var(--k-blue)",
                                    }}
                                  >
                                    {r.onHand.toLocaleString()}
                                  </td>
                                  <td className="k-muted" style={smallCell}>
                                    {r.lastMovementAt
                                      ? new Date(r.lastMovementAt).toLocaleDateString()
                                      : "—"}
                                  </td>
                                  {canAdjust && (
                                    <td className="k-actions" onClick={(e) => e.stopPropagation()}>
                                      <Button
                                        size="sm"
                                        icon={MdSwapHoriz}
                                        onClick={() => openAdjustForRow(r)}
                                        title={`Record a stock adjustment for ${r.itemTypeName}`}
                                      >
                                        Adjust
                                      </Button>
                                    </td>
                                  )}
                                </tr>
                                {isOpen && canViewMovements && (
                                  <tr>
                                    <td
                                      colSpan={colCount}
                                      style={{
                                        padding: 0,
                                        height: "auto",
                                        backgroundColor: BAND_BG,
                                      }}
                                    >
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
                    </TableWrap>

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
                                  style={{ color: r.onHand < 0 ? OUT_COLOR : "var(--k-blue)" }}
                                >
                                  {r.onHand.toLocaleString()}
                                  {r.uom && <span className="stock-card__uom"> {r.uom}</span>}
                                </span>
                              </div>
                            </div>
                            <div className="stock-card__stats">
                              <div className="stock-card__stat">
                                <span className="stock-card__stat-label">Opening</span>
                                <span className="stock-card__stat-value">
                                  {r.openingBalance.toLocaleString()}
                                </span>
                              </div>
                              <div className="stock-card__stat">
                                <span className="stock-card__stat-label">Total IN</span>
                                <span
                                  className="stock-card__stat-value"
                                  style={{ color: IN_COLOR }}
                                >
                                  +{r.totalIn.toLocaleString()}
                                </span>
                              </div>
                              <div className="stock-card__stat">
                                <span className="stock-card__stat-label">Total OUT</span>
                                <span
                                  className="stock-card__stat-value"
                                  style={{ color: OUT_COLOR }}
                                >
                                  −{r.totalOut.toLocaleString()}
                                </span>
                              </div>
                              <div className="stock-card__stat">
                                <span className="stock-card__stat-label">Last Move</span>
                                <span className="stock-card__stat-value stock-card__stat-value--muted">
                                  {r.lastMovementAt
                                    ? new Date(r.lastMovementAt).toLocaleDateString()
                                    : "—"}
                                </span>
                              </div>
                            </div>
                            {canViewMovements && (
                              <Button
                                variant="ghost"
                                icon={isOpen ? MdExpandMore : MdChevronRight}
                                style={cardWideBtn}
                                onClick={() => toggleDrill(r.itemTypeId)}
                              >
                                {isOpen ? "Hide movements" : "View movements"}
                              </Button>
                            )}
                            {isOpen && canViewMovements && (
                              <DrillPanel
                                rows={drill[r.itemTypeId]}
                                loading={drillLoading === r.itemTypeId}
                                uom={r.uom}
                              />
                            )}
                            {canAdjust && (
                              <Button
                                icon={MdSwapHoriz}
                                style={cardWideBtn}
                                onClick={() => openAdjustForRow(r)}
                              >
                                Adjustment
                              </Button>
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
                  <EmptyState icon={MdHistory}>No movements recorded yet.</EmptyState>
                ) : (
                  <>
                    <div
                      className="inventory-record-scroll"
                      role="region"
                      aria-label="Stock movement records"
                      tabIndex={0}
                    >
                      {/* Desktop — table */}
                      <TableWrap data-admin-table-region="" className="stock-table">
                        <table className="k-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Item</th>
                              <th>Direction</th>
                              <th className="k-num">Qty</th>
                              <th>Source</th>
                              <th>Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {movements.map((m) => (
                              <tr key={m.id}>
                                <td>{new Date(m.movementDate).toLocaleDateString()}</td>
                                <td>{m.itemTypeName}</td>
                                <td
                                  style={{
                                    color: m.direction === "In" ? IN_COLOR : OUT_COLOR,
                                    fontWeight: 600,
                                  }}
                                >
                                  {m.direction}
                                </td>
                                <td className="k-num" style={{ fontWeight: 600 }}>
                                  {m.quantity.toLocaleString()}
                                </td>
                                <td style={smallCell}>
                                  {m.sourceType}
                                  {m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}
                                </td>
                                <td className="k-muted" style={smallCell}>
                                  {m.notes || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </TableWrap>

                      {/* Mobile — movement cards */}
                      <div className="stock-cards">
                        {movements.map((m) => (
                          <div key={m.id} className="stock-card">
                            <div className="stock-card__top">
                              <div className="stock-card__top-left">
                                <span className="stock-card__name">{m.itemTypeName}</span>
                                <span className="stock-card__hs">
                                  {new Date(m.movementDate).toLocaleDateString()}
                                </span>
                              </div>
                              <div className="stock-card__onhand">
                                <span
                                  className="stock-card__direction"
                                  style={{ color: m.direction === "In" ? IN_COLOR : OUT_COLOR }}
                                >
                                  {m.direction === "In" ? "+" : "−"}
                                  {m.quantity.toLocaleString()}
                                </span>
                                <span className="stock-card__direction-label">{m.direction}</span>
                              </div>
                            </div>
                            <div className="stock-card__source">
                              <span className="stock-card__stat-label">Source</span>
                              <span className="stock-card__stat-value">
                                {m.sourceType}
                                {m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}
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
      )}

      {entryDraft &&
        selectedCompany &&
        (entryDraft.kind === "Opening" ? canManageOpening : canAdjust) && (
          <StockEntryForm
            key={selectedCompany.id}
            companyId={selectedCompany.id}
            initialKind={entryDraft.kind}
            initialItemId={entryDraft.itemId}
            compact
            onClose={() => {
              setEntryDraft(null);
              fetchAll();
            }}
            onBack={() => {
              setEntryDraft(null);
              fetchAll();
            }}
          />
        )}
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
    return (
      <div style={drillStyles.state}>
        <span className="k-spinner" aria-hidden="true" />
      </div>
    );
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
      last.id = m.id; // newest id keeps the React key stable
      last.movementDate = m.movementDate; // same document date; keep newest
    } else {
      grouped.push({
        ...m,
        groupKey: key,
        quantity: Number(m.quantity),
        balance: bal,
        lineCount: 1,
      });
    }
  }
  grouped.reverse();

  return (
    <div style={drillStyles.wrap}>
      <div style={drillStyles.heading}>
        <MdHistory size={15} /> Movement history ({grouped.length}
        {grouped.length !== rows.length ? ` documents · ${rows.length} line movements` : ""})
      </div>
      <div style={drillStyles.list}>
        {grouped.map((m) => {
          const isIn = m.direction === "In";
          const isAdjust = m.sourceType === "Adjustment";
          // Grouped rows: keep the note's document prefix, drop the per-line
          // detail (each line carried its own qty breakdown), and say how
          // many line items were summed.
          const noteText =
            m.lineCount > 1
              ? `${(m.notes || "").split(" (")[0]}${m.notes ? " — " : ""}${m.lineCount} line items summed`
              : m.notes;
          return (
            <div key={m.id} style={drillStyles.row}>
              <div style={drillStyles.rowMain}>
                <span
                  style={{
                    ...drillStyles.dirBadge,
                    ...(isIn ? drillStyles.dirIn : drillStyles.dirOut),
                  }}
                >
                  {isIn ? "IN" : "OUT"}
                </span>
                <span style={{ ...drillStyles.qty, color: isIn ? IN_COLOR : OUT_COLOR }}>
                  {isIn ? "+" : "−"}
                  {fmtQty(m.quantity)}
                  {uom ? ` ${uom}` : ""}
                </span>
                <span
                  style={{ ...drillStyles.srcChip, ...(isAdjust ? drillStyles.srcAdjust : null) }}
                >
                  {m.sourceType}
                  {m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}
                </span>
                <span style={drillStyles.date}>
                  {new Date(m.movementDate).toLocaleDateString()}
                </span>
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

// Semantic movement colours (IN green / OUT red) and the expanded-row band stay fixed across themes.
const IN_COLOR = "#2e7d32";
const OUT_COLOR = "#c62828";
const BAND_BG = "#f0f7ff";

const smallCell = { fontSize: "var(--k-font-sm)" };
const cardWideBtn = { width: "100%" };

const drillStyles = {
  wrap: { padding: "0.6rem 0.85rem 0.85rem" },
  heading: {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
    fontSize: "0.74rem",
    fontWeight: 700,
    color: "var(--k-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: "0.5rem",
  },
  state: {
    padding: "1rem 0.85rem",
    textAlign: "center",
    color: "var(--k-muted)",
    fontSize: "var(--k-font-sm)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  list: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  row: {
    padding: "0.5rem 0.65rem",
    borderRadius: 8,
    border: "1px solid var(--k-line)",
    backgroundColor: "var(--k-surface)",
  },
  rowMain: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" },
  dirBadge: {
    fontSize: "0.66rem",
    fontWeight: 800,
    padding: "0.1rem 0.4rem",
    borderRadius: 5,
    letterSpacing: "0.03em",
  },
  dirIn: { backgroundColor: "#e8f5e9", color: IN_COLOR },
  dirOut: { backgroundColor: "#fdecea", color: OUT_COLOR },
  qty: { fontSize: "var(--k-font)", fontWeight: 700, minWidth: 70 },
  srcChip: {
    fontSize: "0.74rem",
    fontWeight: 600,
    color: "var(--k-muted)",
    backgroundColor: "var(--k-surface-3)",
    padding: "0.12rem 0.45rem",
    borderRadius: 5,
  },
  srcAdjust: { backgroundColor: "#fff3e0", color: "#e65100" },
  date: { fontSize: "0.76rem", color: "var(--k-muted)", marginLeft: "auto" },
  bal: {
    fontSize: "0.74rem",
    fontWeight: 700,
    color: "var(--k-blue)",
    backgroundColor: BAND_BG,
    padding: "0.12rem 0.45rem",
    borderRadius: 5,
  },
  notes: { fontSize: "0.74rem", color: "var(--k-muted)", marginTop: "0.35rem", lineHeight: 1.35 },
};
