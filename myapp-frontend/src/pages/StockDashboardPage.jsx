import { useState, useEffect, useCallback, Fragment } from "react";
import { MdInventory, MdBusiness, MdSearch, MdAdd, MdHistory, MdTune, MdClose, MdSwapHoriz, MdExpandMore, MdChevronRight } from "react-icons/md";
import { getStockOnHand, getStockMovements, getOpeningBalances, upsertOpeningBalance, deleteOpeningBalance, adjustStock } from "../api/stockApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getAllUnits } from "../api/unitsApi";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import { isDecimalUnit } from "../utils/formatQuantity";
import SearchableItemTypeSelect from "../Components/SearchableItemTypeSelect";

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
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canManageOpening = has("stock.opening.manage");
  const canAdjust = has("stock.adjust.create");
  const canViewMovements = has("stock.movements.view");

  const [tab, setTab] = useState("onhand");
  const [onhand, setOnhand] = useState([]);
  const [movements, setMovements] = useState([]);
  const [movPage, setMovPage] = useState(1);
  const [movTotal, setMovTotal] = useState(0);
  // Server-driven page size from appsettings Pagination:DefaultPageSize.
  // Set after the first response so the pagination math is accurate.
  const [movPageSize, setMovPageSize] = useState(0);
  const [openings, setOpenings] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // On-hand drill-down: which item-type row is expanded, plus a cache of
  // the full movement history per item type (so re-expanding is instant).
  const [expandedId, setExpandedId] = useState(null);
  const [drill, setDrill] = useState({});        // itemTypeId → movement[]
  const [drillLoading, setDrillLoading] = useState(null); // itemTypeId being fetched

  const [showOpening, setShowOpening] = useState(false);
  const [openingDraft, setOpeningDraft] = useState({ itemTypeId: "", quantity: 0, asOfDate: todayYmd(), notes: "" });
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustDraft, setAdjustDraft] = useState({ itemTypeId: "", delta: 0, movementDate: todayYmd(), notes: "" });
  // Set when the Adjustment modal is launched from a grid row — the item
  // is fixed (read-only display) so the operator just types the delta.
  // Null when opened from the header button (free pick).
  const [adjustLockedItem, setAdjustLockedItem] = useState(null);

  const fetchAll = useCallback(async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const [oh, op, it, mov] = await Promise.all([
        getStockOnHand(selectedCompany.id),
        canManageOpening ? getOpeningBalances(selectedCompany.id) : Promise.resolve({ data: [] }),
        getItemTypes(),
        // 2026-05-12: also pull the movements first page on initial load
        // so the "Movements (N)" tab label shows the correct count
        // BEFORE the operator clicks into the tab. Pre-fix this was 0
        // until the tab was opened, which made the tab look empty even
        // when there were 20+ records waiting.
        canViewMovements
          ? getStockMovements(selectedCompany.id, { page: 1 }).catch(() => ({ data: { items: [], totalCount: 0, pageSize: 0 } }))
          : Promise.resolve({ data: { items: [], totalCount: 0, pageSize: 0 } }),
      ]);
      setOnhand(oh.data || []);
      setOpenings(op.data || []);
      setItemTypes(it.data || []);
      setMovements(mov.data?.items || []);
      setMovTotal(mov.data?.totalCount || 0);
      setMovPageSize(mov.data?.pageSize || 0);
      // A refresh can change movement history (new adjustment, edited bill),
      // so drop the drill cache; keep the expanded row open to refetch.
      setDrill({});
    } catch {
      setOnhand([]); setOpenings([]); setItemTypes([]);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, canManageOpening, canViewMovements]);

  const fetchMovements = useCallback(async (pg) => {
    if (!selectedCompany || !canViewMovements) return;
    try {
      // Don't send pageSize — let the server apply Pagination:DefaultPageSize
      // from appsettings.json. Read it back from the response so totalPages
      // is accurate.
      const { data } = await getStockMovements(selectedCompany.id, { page: pg || movPage });
      setMovements(data.items || []);
      setMovTotal(data.totalCount || 0);
      setMovPageSize(data.pageSize || 0);
    } catch {
      setMovements([]); setMovTotal(0);
    }
  }, [selectedCompany, movPage, canViewMovements]);

  useEffect(() => { if (selectedCompany) fetchAll(); }, [selectedCompany]);
  useEffect(() => { if (tab === "movements") fetchMovements(movPage); }, [tab, selectedCompany, movPage]);

  // Units list (carries the AllowsDecimalQuantity flag) drives whether the
  // opening-balance / adjustment quantity inputs accept decimals — the same
  // per-Unit rule the bill / challan forms use. Units are global (not
  // company-scoped), so fetch once on mount.
  useEffect(() => {
    getAllUnits().then(r => setUnits(r.data || [])).catch(() => setUnits([]));
  }, []);

  const filteredOnhand = onhand.filter(r =>
    !search || r.itemTypeName.toLowerCase().includes(search.toLowerCase()) ||
    (r.hsCode || "").toLowerCase().includes(search.toLowerCase())
  );

  const submitOpening = async (e) => {
    e.preventDefault();
    if (!openingDraft.itemTypeId) return notify("Pick an item.", "error");
    try {
      await upsertOpeningBalance({
        companyId: selectedCompany.id,
        itemTypeId: parseInt(openingDraft.itemTypeId),
        quantity: parseFloat(openingDraft.quantity) || 0,
        asOfDate: openingDraft.asOfDate,
        notes: openingDraft.notes || null,
      });
      notify("Opening balance saved.", "success");
      setShowOpening(false);
      setOpeningDraft({ itemTypeId: "", quantity: 0, asOfDate: todayYmd(), notes: "" });
      fetchAll();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to save opening balance.", "error");
    }
  };

  // Single delete handler shared between the desktop table and the
  // mobile card so the confirm dialog stays consistent across viewports.
  const handleDeleteOpening = async (o) => {
    const ok = await confirm({
      title: "Delete opening balance?",
      message: `Remove the opening balance for "${o.itemTypeName}"? This won't affect movement-driven stock; only the seeded starting quantity is removed.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteOpeningBalance(o.id);
      fetchAll();
    } catch (err) {
      notify(err?.response?.data?.error || "Failed to delete opening balance.", "error");
    }
  };

  const closeAdjust = () => {
    setShowAdjust(false);
    setAdjustLockedItem(null);
    setAdjustDraft({ itemTypeId: "", delta: 0, movementDate: todayYmd(), notes: "" });
  };

  // Per-row "Adjust" action on the on-hand grid: open the Adjustment modal
  // with the row's item pre-picked and locked — operator just enters the
  // delta. Header "Adjustment" button keeps the free item pick.
  const openAdjustForRow = (r) => {
    setAdjustLockedItem({ id: r.itemTypeId, name: r.itemTypeName, hsCode: r.hsCode, uom: r.uom });
    setAdjustDraft({ itemTypeId: String(r.itemTypeId), delta: 0, movementDate: todayYmd(), notes: "" });
    setShowAdjust(true);
  };

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

  const submitAdjust = async (e) => {
    e.preventDefault();
    if (!adjustDraft.itemTypeId || !adjustDraft.delta) return notify("Pick an item and a non-zero delta.", "error");
    try {
      await adjustStock({
        companyId: selectedCompany.id,
        itemTypeId: parseInt(adjustDraft.itemTypeId),
        delta: parseFloat(adjustDraft.delta),
        movementDate: adjustDraft.movementDate,
        notes: adjustDraft.notes || null,
      });
      notify("Adjustment recorded.", "success");
      closeAdjust();
      fetchAll();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to record adjustment.", "error");
    }
  };

  // UOM-driven decimal rule for the modal quantity inputs. Each ItemType
  // carries a UOM string; whether that unit allows fractional quantities is
  // configured per-Unit (AllowsDecimalQuantity) on the Units page. Unknown
  // UOMs fall back to whole-numbers-only, same as the bill / challan forms.
  const openingItem = itemTypes.find(it => String(it.id) === String(openingDraft.itemTypeId));
  const openingUom = openingItem?.uom || "";
  const openingAllowsDecimal = isDecimalUnit(openingUom, units);
  // Fall back to the locked row's UOM when the catalog lookup misses
  // (e.g. soft-deleted item type still present in the grid).
  const adjustItem = itemTypes.find(it => String(it.id) === String(adjustDraft.itemTypeId)) || adjustLockedItem;
  const adjustUom = adjustItem?.uom || "";
  const adjustAllowsDecimal = isDecimalUnit(adjustUom, units);

  // Modal pickers list ALL catalog item types (HS-coded or not) — opening
  // balances/adjustments are operational stock counts, not FBR submissions,
  // so items without an HS code must be selectable too. Opening Balance still
  // hides items already on the on-hand grid: those are corrected via the
  // per-row Adjust action, not by seeding a second opening.
  const onhandIds = new Set(onhand.map(r => r.itemTypeId));
  const openingPickerItems = itemTypes.filter(it => !onhandIds.has(it.id));

  return (
    <div className="stock-page">
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}><MdInventory size={28} color="#fff" /></div>
          <div>
            <h2 style={styles.title}>Stock Dashboard</h2>
            <p style={styles.subtitle}>
              {selectedCompany
                ? `On-hand inventory for ${selectedCompany.brandName || selectedCompany.name}`
                : "Select a company"}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {canManageOpening && (
            <button style={styles.altBtn} onClick={() => setShowOpening(true)}>
              <MdTune size={16} /> Opening Balance
            </button>
          )}
          {canAdjust && (
            <button style={styles.altBtn} onClick={() => { setAdjustLockedItem(null); setShowAdjust(true); }}>
              <MdSwapHoriz size={16} /> Adjustment
            </button>
          )}
        </div>
      </div>

      {loadingCompanies ? (
        <div style={styles.loading}><div style={styles.spinner} /></div>
      ) : companies.length === 0 ? (
        <div style={styles.empty}>No companies available.</div>
      ) : (
        <>
          <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select style={dropdownStyles.base} value={selectedCompany?.id || ""}
                    onChange={e => setSelectedCompany(companies.find(c => parseInt(c.id) === parseInt(e.target.value)))}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </div>

          {selectedCompany && !selectedCompany.inventoryTrackingEnabled && (
            <div style={styles.warnBanner}>
              ⚠ Inventory tracking is OFF for this company. Stock IN / OUT movements are not being recorded automatically.
              You can still record opening balances and manual adjustments here, then enable tracking on the Company settings to begin auto-tracking purchases and sales.
            </div>
          )}

          <div style={styles.tabs}>
            <TabBtn active={tab === "onhand"} onClick={() => setTab("onhand")}>On-Hand ({onhand.length})</TabBtn>
            {canManageOpening && <TabBtn active={tab === "opening"} onClick={() => setTab("opening")}>Opening Balances ({openings.length})</TabBtn>}
            {canViewMovements && <TabBtn active={tab === "movements"} onClick={() => setTab("movements")}>Movements ({movTotal})</TabBtn>}
          </div>

          {tab === "onhand" && (
            <>
              {/* Search renders whenever there is ANY stock data — gating it
                  on the FILTERED list meant a no-match search unmounted the
                  box itself and the operator had no way to clear it. */}
              {onhand.length > 0 && (
                <div style={styles.searchWrap}>
                  <MdSearch style={styles.searchIcon} />
                  <input type="text" placeholder="Search item or HS code..." value={search} onChange={e => setSearch(e.target.value)} style={styles.searchInput} />
                  {search && (
                    <button type="button" style={styles.searchClear} onClick={() => setSearch("")} title="Clear search">
                      <MdClose size={16} />
                    </button>
                  )}
                </div>
              )}
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
                      No stock data yet. Set opening balances or post a Purchase Bill / FBR-submitted invoice to start tracking.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {/* Desktop / tablet — table */}
                  <div className="stock-table" style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          {canViewMovements && <th style={{ ...styles.th, width: 34 }} aria-label="Expand"></th>}
                          <th style={styles.th}>Item</th>
                          <th style={styles.th}>HS Code</th>
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
                          const colCount = 8 + (canViewMovements ? 1 : 0) + (canAdjust ? 1 : 0);
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
                            <td style={styles.td}><strong>{r.itemTypeName}</strong></td>
                            <td style={{ ...styles.td, fontFamily: "monospace", fontSize: "0.78rem" }}>{r.hsCode || "—"}</td>
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
            </>
          )}

          {tab === "opening" && canManageOpening && (
            <>
              {openings.length === 0 ? (
                <div style={{ ...styles.empty, padding: "2rem 1rem" }}>
                  <p style={{ color: colors.textSecondary }}>No opening balances set yet. Click "Opening Balance" above to add one.</p>
                </div>
              ) : (
                <>
                  {/* Desktop — table */}
                  <div className="stock-table" style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Item</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Quantity</th>
                          <th style={styles.th}>As Of</th>
                          <th style={styles.th}>Notes</th>
                          <th style={{ ...styles.th, width: 60 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {openings.map((o, idx) => (
                          <tr key={o.id} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : colors.rowAlt }}>
                            <td style={styles.td}><strong>{o.itemTypeName}</strong></td>
                            <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>{o.quantity.toLocaleString()}</td>
                            <td style={styles.td}>{new Date(o.asOfDate).toLocaleDateString()}</td>
                            <td style={{ ...styles.td, fontSize: "0.78rem", color: colors.textSecondary }}>{o.notes || "—"}</td>
                            <td style={styles.td}>
                              <button style={btnTiny} onClick={() => handleDeleteOpening(o)}><MdClose size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile — opening balance cards */}
                  <div className="stock-cards">
                    {openings.map((o) => (
                      <div key={o.id} className="stock-card">
                        <div className="stock-card__top">
                          <div className="stock-card__top-left">
                            <span className="stock-card__name">{o.itemTypeName}</span>
                            <span className="stock-card__hs">As of {new Date(o.asOfDate).toLocaleDateString()}</span>
                          </div>
                          <div className="stock-card__onhand">
                            <span className="stock-card__onhand-label">Quantity</span>
                            <span className="stock-card__onhand-value" style={{ color: colors.blue }}>
                              {o.quantity.toLocaleString()}
                            </span>
                          </div>
                        </div>
                        {o.notes && (
                          <div className="stock-card__notes">{o.notes}</div>
                        )}
                        <button
                          className="stock-card__delete"
                          onClick={() => handleDeleteOpening(o)}
                        >
                          <MdClose size={14} /> Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
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
                  {/* Desktop — table */}
                  <div className="stock-table" style={styles.tableWrap}>
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

                  {movPageSize > 0 && movTotal > movPageSize && (
                    <div className="irh-pagination">
                      <button className="irh-page-btn" disabled={movPage <= 1} onClick={() => setMovPage(movPage - 1)}>Prev</button>
                      <span className="irh-page-info">
                        Page {movPage} of {Math.ceil(movTotal / movPageSize)}{" "}
                        <span className="irh-page-info__count">({movTotal} total)</span>
                      </span>
                      <button className="irh-page-btn" disabled={movPage * movPageSize >= movTotal} onClick={() => setMovPage(movPage + 1)}>Next</button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {showOpening && (
        <SmallModal title="Set Opening Balance" onClose={() => setShowOpening(false)} onSubmit={submitOpening}>
          <Field label="Item">
            <SearchableItemTypeSelect
              items={openingPickerItems}
              value={openingDraft.itemTypeId}
              onChange={(newId) => setOpeningDraft({ ...openingDraft, itemTypeId: newId ? String(newId) : "" })}
              placeholder="Search & pick an item…"
              style={mInput}
            />
            <div style={qtyHint}>
              Items without an HS Code, or already on the stock grid, are hidden —
              use the grid's Adjust action for tracked items.
            </div>
          </Field>
          <Field label="Quantity">
            <input type="number" min={0} step={openingAllowsDecimal ? "0.0001" : "1"} required style={mInput} value={openingDraft.quantity} onChange={e => setOpeningDraft({ ...openingDraft, quantity: e.target.value })} />
            {openingItem && (
              <div style={qtyHint}>UOM: <strong>{openingUom || "—"}</strong> · {openingAllowsDecimal ? "decimals allowed" : "whole numbers only"}</div>
            )}
          </Field>
          <Field label="As Of"><input type="date" required style={mInput} value={openingDraft.asOfDate} onChange={e => setOpeningDraft({ ...openingDraft, asOfDate: e.target.value })} /></Field>
          <Field label="Notes"><input type="text" style={mInput} value={openingDraft.notes} onChange={e => setOpeningDraft({ ...openingDraft, notes: e.target.value })} placeholder="optional" /></Field>
        </SmallModal>
      )}

      {showAdjust && (
        <SmallModal title="Stock Adjustment" onClose={closeAdjust} onSubmit={submitAdjust}>
          <Field label="Item">
            {adjustLockedItem ? (
              <input
                type="text"
                readOnly
                value={`${adjustLockedItem.name}${adjustLockedItem.hsCode ? ` (${adjustLockedItem.hsCode})` : ""}`}
                style={{ ...mInput, backgroundColor: "#eef5ff", cursor: "not-allowed" }}
                title="Opened from the stock grid — item is fixed. Use the header Adjustment button to pick a different item."
              />
            ) : (
              <>
                <SearchableItemTypeSelect
                  items={itemTypes}
                  value={adjustDraft.itemTypeId}
                  onChange={(newId) => setAdjustDraft({ ...adjustDraft, itemTypeId: newId ? String(newId) : "" })}
                  placeholder="Search & pick an item…"
                  style={mInput}
                />
                <div style={qtyHint}>Items without an HS Code are hidden.</div>
              </>
            )}
          </Field>
          <Field label="Delta (positive = up, negative = down)">
            <input type="number" step={adjustAllowsDecimal ? "0.0001" : "1"} required style={mInput} value={adjustDraft.delta} onChange={e => setAdjustDraft({ ...adjustDraft, delta: e.target.value })} />
            {adjustItem && (
              <div style={qtyHint}>UOM: <strong>{adjustUom || "—"}</strong> · {adjustAllowsDecimal ? "decimals allowed" : "whole numbers only"}</div>
            )}
          </Field>
          <Field label="Date"><input type="date" required style={mInput} value={adjustDraft.movementDate} onChange={e => setAdjustDraft({ ...adjustDraft, movementDate: e.target.value })} /></Field>
          <Field label="Notes"><input type="text" style={mInput} value={adjustDraft.notes} onChange={e => setAdjustDraft({ ...adjustDraft, notes: e.target.value })} placeholder="e.g. count correction, breakage" /></Field>
        </SmallModal>
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
  return (
    <button onClick={onClick} style={{
      padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #d0d7e2", cursor: "pointer",
      backgroundColor: active ? "#0d47a1" : "#fff", color: active ? "#fff" : "#1a2332",
      fontSize: "0.85rem", fontWeight: 600, boxShadow: "none", padding: "0.45rem 0.95rem"
    }}>{children}</button>
  );
}

function SmallModal({ title, children, onClose, onSubmit }) {
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(15,20,30,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: "2vh 1rem" }}>
      <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 480, padding: "1.25rem", boxShadow: "0 20px 60px rgba(13,71,161,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#1a2332" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#5f6d7e", cursor: "pointer", padding: 0, fontSize: "1.5rem", lineHeight: 1 }}>×</button>
        </div>
        <form onSubmit={onSubmit}>
          {children}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
            <button type="button" onClick={onClose} style={{ padding: "0.45rem 1rem", borderRadius: 8, border: "1px solid #d0d7e2", background: "#fff", color: "#1a2332", cursor: "pointer", boxShadow: "none" }}>Cancel</button>
            <button type="submit" style={{ padding: "0.45rem 1rem", borderRadius: 8, border: "none", background: "#0d47a1", color: "#fff", cursor: "pointer", fontWeight: 600, boxShadow: "none" }}>Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={{ display: "block", fontSize: "0.82rem", color: "#5f6d7e", marginBottom: "0.25rem", fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

const mInput = { width: "100%", padding: "0.45rem 0.65rem", border: "1px solid #d0d7e2", borderRadius: 8, fontSize: "0.85rem", backgroundColor: "#f8f9fb", color: "#1a2332", outline: "none" };
const qtyHint = { fontSize: "0.72rem", color: "#5f6d7e", marginTop: "0.35rem" };
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
const btnTiny = { padding: 0, width: 28, height: 28, borderRadius: 6, border: "1px solid #d0d7e2", backgroundColor: "#fff", color: "#c62828", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "none" };
