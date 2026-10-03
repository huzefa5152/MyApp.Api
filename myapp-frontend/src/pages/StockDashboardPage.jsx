import { useState, useEffect, useCallback, Fragment } from "react";
import { MdInventory, MdBusiness, MdHistory, MdTune, MdClose, MdSwapHoriz, MdExpandMore, MdChevronRight } from "react-icons/md";
import { getStockOnHand, getStockMovements, getOpeningBalances, upsertOpeningBalance, deleteOpeningBalance, adjustStock } from "../api/stockApi";
import { getItemTypes } from "../api/itemTypeApi";
import { getAllUnits } from "../api/unitsApi";
import { formStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { todayYmd } from "../utils/dateInput";
import { isDecimalUnit } from "../utils/formatQuantity";
import SearchableItemTypeSelect from "../Components/SearchableItemTypeSelect";
import Pagination from "../Components/Pagination";
import { PageHeader, CompanyPicker, Button, IconButton, Toolbar, SearchBox, Tabs, TableWrap, Field, Alert, EmptyState, Loading } from "../ui/Kit";

export default function StockDashboardPage() {
  const { companies, selectedCompany, loading: loadingCompanies } = useCompany();
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

  // Modal pickers list only HS-coded catalog items — stock tracking is
  // FBR-classified inventory; quick no-HS entries are bill drafts, not
  // stockable goods. Opening Balance additionally hides items already on
  // the on-hand grid: those are corrected via the per-row Adjust action,
  // not by seeding a second opening.
  const hsCodedItemTypes = itemTypes.filter(it => it.hsCode && it.hsCode.trim());
  const onhandIds = new Set(onhand.map(r => r.itemTypeId));
  const openingPickerItems = hsCodedItemTypes.filter(it => !onhandIds.has(it.id));

  const tabs = [
    { key: "onhand", label: "On-Hand", count: onhand.length },
    canManageOpening && { key: "opening", label: "Opening Balances", count: openings.length },
    canViewMovements && { key: "movements", label: "Movements", count: movTotal },
  ].filter(Boolean);

  return (
    <div className="stock-page">
      <PageHeader
        icon={MdInventory}
        tone="brand"
        title="Stock Dashboard"
        subtitle={selectedCompany
          ? `On-hand inventory for ${selectedCompany.brandName || selectedCompany.name}`
          : "Select a company"}
        actions={(canManageOpening || canAdjust) ? (
          <>
            {canManageOpening && (
              <Button icon={MdTune} onClick={() => setShowOpening(true)}>Opening Balance</Button>
            )}
            {canAdjust && (
              <Button icon={MdSwapHoriz} onClick={() => { setAdjustLockedItem(null); setShowAdjust(true); }}>Adjustment</Button>
            )}
          </>
        ) : null}
      />

      {loadingCompanies ? (
        <Loading>Loading companies…</Loading>
      ) : companies.length === 0 ? (
        <EmptyState icon={MdBusiness}>No companies available.</EmptyState>
      ) : (
        <>
          <CompanyPicker />

          {selectedCompany && !selectedCompany.inventoryTrackingEnabled && (
            <Alert tone="warn">
              ⚠ Inventory tracking is OFF for this company. Stock IN / OUT movements are not being recorded automatically.
              You can still record opening balances and manual adjustments here, then enable tracking on the Company settings to begin auto-tracking purchases and sales.
            </Alert>
          )}

          <Tabs tabs={tabs} value={tab} onChange={setTab} label="Stock views" idPrefix="stock-tab" />

          {tab === "onhand" && (
            <>
              {/* Search renders whenever there is ANY stock data — gating it
                  on the FILTERED list meant a no-match search unmounted the
                  box itself and the operator had no way to clear it. */}
              {onhand.length > 0 && (
                <Toolbar>
                  <SearchBox value={search} onChange={setSearch} placeholder="Search item or HS code..." />
                  {search && (
                    <IconButton label="Clear search" icon={MdClose} size={16} onClick={() => setSearch("")} />
                  )}
                </Toolbar>
              )}
              {loading ? (
                <Loading>Loading stock…</Loading>
              ) : filteredOnhand.length === 0 ? (
                search ? (
                  <EmptyState
                    icon={MdInventory}
                    action={<Button size="sm" onClick={() => setSearch("")}>Clear search</Button>}
                  >
                    No items match "{search}".
                  </EmptyState>
                ) : (
                  <EmptyState icon={MdInventory}>
                    No stock data yet. Set opening balances or post a Purchase Bill / FBR-submitted invoice to start tracking.
                  </EmptyState>
                )
              ) : (
                <>
                  {/* Desktop / tablet — table */}
                  <TableWrap className="stock-table">
                    <table className="k-table">
                      <thead>
                        <tr>
                          {canViewMovements && <th style={{ width: 34 }} aria-label="Expand"></th>}
                          <th>Item</th>
                          <th>HS Code</th>
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
                          const colCount = 8 + (canViewMovements ? 1 : 0) + (canAdjust ? 1 : 0);
                          return (
                          <Fragment key={r.itemTypeId}>
                          <tr
                            style={{ backgroundColor: isOpen ? BAND_BG : undefined, cursor: canViewMovements ? "pointer" : "default" }}
                            onClick={canViewMovements ? () => toggleDrill(r.itemTypeId) : undefined}
                          >
                            {canViewMovements && (
                              <td className="is-center k-muted">
                                {isOpen ? <MdExpandMore size={18} /> : <MdChevronRight size={18} />}
                              </td>
                            )}
                            <td><strong>{r.itemTypeName}</strong></td>
                            <td style={monoCell}>{r.hsCode || "—"}</td>
                            <td>{r.uom || "—"}</td>
                            <td className="k-num">{r.openingBalance.toLocaleString()}</td>
                            <td className="k-num" style={{ color: IN_COLOR }}>+{r.totalIn.toLocaleString()}</td>
                            <td className="k-num" style={{ color: OUT_COLOR }}>−{r.totalOut.toLocaleString()}</td>
                            <td className="k-num" style={{ fontWeight: 700, color: r.onHand < 0 ? OUT_COLOR : "var(--k-blue)" }}>{r.onHand.toLocaleString()}</td>
                            <td className="k-muted" style={smallCell}>
                              {r.lastMovementAt ? new Date(r.lastMovementAt).toLocaleDateString() : "—"}
                            </td>
                            {canAdjust && (
                              <td className="k-actions" onClick={e => e.stopPropagation()}>
                                <Button size="sm" icon={MdSwapHoriz} onClick={() => openAdjustForRow(r)} title={`Record a stock adjustment for ${r.itemTypeName}`}>
                                  Adjust
                                </Button>
                              </td>
                            )}
                          </tr>
                          {isOpen && canViewMovements && (
                            <tr>
                              <td colSpan={colCount} style={{ padding: 0, height: "auto", backgroundColor: BAND_BG }}>
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
                            <span className="stock-card__stat-value">{r.openingBalance.toLocaleString()}</span>
                          </div>
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Total IN</span>
                            <span className="stock-card__stat-value" style={{ color: IN_COLOR }}>+{r.totalIn.toLocaleString()}</span>
                          </div>
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Total OUT</span>
                            <span className="stock-card__stat-value" style={{ color: OUT_COLOR }}>−{r.totalOut.toLocaleString()}</span>
                          </div>
                          <div className="stock-card__stat">
                            <span className="stock-card__stat-label">Last Move</span>
                            <span className="stock-card__stat-value stock-card__stat-value--muted">
                              {r.lastMovementAt ? new Date(r.lastMovementAt).toLocaleDateString() : "—"}
                            </span>
                          </div>
                        </div>
                        {canViewMovements && (
                          <Button variant="ghost" icon={isOpen ? MdExpandMore : MdChevronRight} style={cardWideBtn} onClick={() => toggleDrill(r.itemTypeId)}>
                            {isOpen ? "Hide movements" : "View movements"}
                          </Button>
                        )}
                        {isOpen && canViewMovements && (
                          <DrillPanel rows={drill[r.itemTypeId]} loading={drillLoading === r.itemTypeId} uom={r.uom} />
                        )}
                        {canAdjust && (
                          <Button icon={MdSwapHoriz} style={cardWideBtn} onClick={() => openAdjustForRow(r)}>
                            Adjustment
                          </Button>
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
                <EmptyState>No opening balances set yet. Click "Opening Balance" above to add one.</EmptyState>
              ) : (
                <>
                  {/* Desktop — table */}
                  <TableWrap className="stock-table">
                    <table className="k-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="k-num">Quantity</th>
                          <th>As Of</th>
                          <th>Notes</th>
                          <th style={{ width: 60 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {openings.map((o) => (
                          <tr key={o.id}>
                            <td><strong>{o.itemTypeName}</strong></td>
                            <td className="k-num" style={{ fontWeight: 600 }}>{o.quantity.toLocaleString()}</td>
                            <td>{new Date(o.asOfDate).toLocaleDateString()}</td>
                            <td className="k-muted" style={smallCell}>{o.notes || "—"}</td>
                            <td className="k-actions">
                              <IconButton label="Delete opening balance" icon={MdClose} size={16} danger onClick={() => handleDeleteOpening(o)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>

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
                            <span className="stock-card__onhand-value" style={{ color: "var(--k-blue)" }}>
                              {o.quantity.toLocaleString()}
                            </span>
                          </div>
                        </div>
                        {o.notes && (
                          <div className="stock-card__notes">{o.notes}</div>
                        )}
                        <Button variant="danger" size="sm" icon={MdClose} style={{ alignSelf: "flex-end" }} onClick={() => handleDeleteOpening(o)}>
                          Delete
                        </Button>
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
                <EmptyState icon={MdHistory}>No movements recorded yet.</EmptyState>
              ) : (
                <>
                  {/* Desktop — table */}
                  <TableWrap className="stock-table">
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
                            <td style={{ color: m.direction === "In" ? IN_COLOR : OUT_COLOR, fontWeight: 600 }}>{m.direction}</td>
                            <td className="k-num" style={{ fontWeight: 600 }}>{m.quantity.toLocaleString()}</td>
                            <td style={smallCell}>{m.sourceType}{m.sourceDocNumber ? ` #${m.sourceDocNumber}` : ""}</td>
                            <td className="k-muted" style={smallCell}>{m.notes || "—"}</td>
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
                            <span className="stock-card__hs">{new Date(m.movementDate).toLocaleDateString()}</span>
                          </div>
                          <div className="stock-card__onhand">
                            <span
                              className="stock-card__direction"
                              style={{ color: m.direction === "In" ? IN_COLOR : OUT_COLOR }}
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
            <input type="number" min={0} step={openingAllowsDecimal ? "0.0001" : "1"} required className="k-input" value={openingDraft.quantity} onChange={e => setOpeningDraft({ ...openingDraft, quantity: e.target.value })} />
            {openingItem && (
              <div style={qtyHint}>UOM: <strong>{openingUom || "—"}</strong> · {openingAllowsDecimal ? "decimals allowed" : "whole numbers only"}</div>
            )}
          </Field>
          <Field label="As Of"><input type="date" required className="k-input" value={openingDraft.asOfDate} onChange={e => setOpeningDraft({ ...openingDraft, asOfDate: e.target.value })} /></Field>
          <Field label="Notes"><input type="text" className="k-input" value={openingDraft.notes} onChange={e => setOpeningDraft({ ...openingDraft, notes: e.target.value })} placeholder="optional" /></Field>
        </SmallModal>
      )}

      {showAdjust && (
        <SmallModal title="Stock Adjustment" onClose={closeAdjust} onSubmit={submitAdjust}>
          <Field label="Item">
            {adjustLockedItem ? (
              <input
                type="text"
                readOnly
                className="k-input"
                value={`${adjustLockedItem.name}${adjustLockedItem.hsCode ? ` (${adjustLockedItem.hsCode})` : ""}`}
                style={{ backgroundColor: "var(--k-surface-3)", cursor: "not-allowed" }}
                title="Opened from the stock grid — item is fixed. Use the header Adjustment button to pick a different item."
              />
            ) : (
              <>
                <SearchableItemTypeSelect
                  items={hsCodedItemTypes}
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
            <input type="number" step={adjustAllowsDecimal ? "0.0001" : "1"} required className="k-input" value={adjustDraft.delta} onChange={e => setAdjustDraft({ ...adjustDraft, delta: e.target.value })} />
            {adjustItem && (
              <div style={qtyHint}>UOM: <strong>{adjustUom || "—"}</strong> · {adjustAllowsDecimal ? "decimals allowed" : "whole numbers only"}</div>
            )}
          </Field>
          <Field label="Date"><input type="date" required className="k-input" value={adjustDraft.movementDate} onChange={e => setAdjustDraft({ ...adjustDraft, movementDate: e.target.value })} /></Field>
          <Field label="Notes"><input type="text" className="k-input" value={adjustDraft.notes} onChange={e => setAdjustDraft({ ...adjustDraft, notes: e.target.value })} placeholder="e.g. count correction, breakage" /></Field>
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
    return <div style={drillStyles.state}><span className="k-spinner" aria-hidden="true" /></div>;
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
                <span style={{ ...drillStyles.qty, color: isIn ? IN_COLOR : OUT_COLOR }}>
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

// Small form dialog — built on the shared (themed) formStyles.
function SmallModal({ title, children, onClose, onSubmit }) {
  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: 480 }}>
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>{title}</h3>
          <button type="button" onClick={onClose} style={formStyles.closeButton} aria-label="Close">×</button>
        </div>
        <form onSubmit={onSubmit} style={{ display: "contents" }}>
          <div style={formStyles.body}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>{children}</div>
          </div>
          <div style={formStyles.footer}>
            <button type="button" onClick={onClose} style={{ ...formStyles.button, ...formStyles.cancel }}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit }}>Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Semantic movement colours (IN green / OUT red) and the expanded-row band stay fixed across themes.
const IN_COLOR = "#2e7d32";
const OUT_COLOR = "#c62828";
const BAND_BG = "#f0f7ff";

const mInput = { width: "100%" };
const qtyHint = { fontSize: "0.72rem", color: "var(--k-muted)", marginTop: "0.35rem" };
const monoCell = { fontFamily: "monospace", fontSize: "var(--k-font-sm)" };
const smallCell = { fontSize: "var(--k-font-sm)" };
const cardWideBtn = { width: "100%" };

const drillStyles = {
  wrap: { padding: "0.6rem 0.85rem 0.85rem" },
  heading: { display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.74rem", fontWeight: 700, color: "var(--k-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" },
  state: { padding: "1rem 0.85rem", textAlign: "center", color: "var(--k-muted)", fontSize: "var(--k-font-sm)", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48 },
  list: { display: "flex", flexDirection: "column", gap: "0.4rem" },
  row: { padding: "0.5rem 0.65rem", borderRadius: 8, border: "1px solid var(--k-line)", backgroundColor: "var(--k-surface)" },
  rowMain: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" },
  dirBadge: { fontSize: "0.66rem", fontWeight: 800, padding: "0.1rem 0.4rem", borderRadius: 5, letterSpacing: "0.03em" },
  dirIn: { backgroundColor: "#e8f5e9", color: IN_COLOR },
  dirOut: { backgroundColor: "#fdecea", color: OUT_COLOR },
  qty: { fontSize: "var(--k-font)", fontWeight: 700, minWidth: 70 },
  srcChip: { fontSize: "0.74rem", fontWeight: 600, color: "#37474f", backgroundColor: "#eef2f7", padding: "0.12rem 0.45rem", borderRadius: 5 },
  srcAdjust: { backgroundColor: "#fff3e0", color: "#e65100" },
  date: { fontSize: "0.76rem", color: "var(--k-muted)", marginLeft: "auto" },
  bal: { fontSize: "0.74rem", fontWeight: 700, color: "var(--k-blue)", backgroundColor: BAND_BG, padding: "0.12rem 0.45rem", borderRadius: 5 },
  notes: { fontSize: "0.74rem", color: "var(--k-muted)", marginTop: "0.35rem", lineHeight: 1.35 },
};
