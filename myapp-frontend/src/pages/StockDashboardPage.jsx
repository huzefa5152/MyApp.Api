import { useState, useEffect, useCallback } from "react";
import { MdInventory, MdBusiness, MdSearch, MdAdd, MdHistory, MdTune, MdClose, MdSwapHoriz } from "react-icons/md";
import { getStockOnHand, getStockMovements, getOpeningBalances, upsertOpeningBalance, deleteOpeningBalance, adjustStock } from "../api/stockApi";
import { getItemTypes } from "../api/itemTypeApi";
import { dropdownStyles } from "../theme";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";

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
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [showOpening, setShowOpening] = useState(false);
  const [openingDraft, setOpeningDraft] = useState({ itemTypeId: "", quantity: 0, asOfDate: new Date().toISOString().slice(0, 10), notes: "" });
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustDraft, setAdjustDraft] = useState({ itemTypeId: "", delta: 0, movementDate: new Date().toISOString().slice(0, 10), notes: "" });

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
        quantity: parseInt(openingDraft.quantity) || 0,
        asOfDate: openingDraft.asOfDate,
        notes: openingDraft.notes || null,
      });
      notify("Opening balance saved.", "success");
      setShowOpening(false);
      setOpeningDraft({ itemTypeId: "", quantity: 0, asOfDate: new Date().toISOString().slice(0, 10), notes: "" });
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

  const submitAdjust = async (e) => {
    e.preventDefault();
    if (!adjustDraft.itemTypeId || !adjustDraft.delta) return notify("Pick an item and a non-zero delta.", "error");
    try {
      await adjustStock({
        companyId: selectedCompany.id,
        itemTypeId: parseInt(adjustDraft.itemTypeId),
        delta: parseInt(adjustDraft.delta),
        movementDate: adjustDraft.movementDate,
        notes: adjustDraft.notes || null,
      });
      notify("Adjustment recorded.", "success");
      setShowAdjust(false);
      setAdjustDraft({ itemTypeId: "", delta: 0, movementDate: new Date().toISOString().slice(0, 10), notes: "" });
      fetchAll();
    } catch (err) {
      notify(err.response?.data?.error || "Failed to record adjustment.", "error");
    }
  };

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
            <button style={styles.altBtn} onClick={() => setShowAdjust(true)}>
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
              {filteredOnhand.length > 0 && (
                <div style={styles.searchWrap}>
                  <MdSearch style={styles.searchIcon} />
                  <input type="text" placeholder="Search item or HS code..." value={search} onChange={e => setSearch(e.target.value)} style={styles.searchInput} />
                </div>
              )}
              {loading ? (
                <div style={styles.loading}><div style={styles.spinner} /></div>
              ) : filteredOnhand.length === 0 ? (
                <div style={styles.empty}>
                  <MdInventory size={40} color={colors.cardBorder} />
                  <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
                    No stock data yet. Set opening balances or post a Purchase Bill / FBR-submitted invoice to start tracking.
                  </p>
                </div>
              ) : (
                <>
                  {/* Desktop / tablet — table */}
                  <div className="stock-table" style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Item</th>
                          <th style={styles.th}>HS Code</th>
                          <th style={styles.th}>UOM</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Opening</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Total IN</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>Total OUT</th>
                          <th style={{ ...styles.th, textAlign: "right" }}>On-Hand</th>
                          <th style={styles.th}>Last Movement</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOnhand.map((r, idx) => (
                          <tr key={r.itemTypeId} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : colors.rowAlt }}>
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile — On-hand stack. The "answer" the page exists to
                      show is on-hand quantity, so it goes top-right at large
                      size. IN / OUT / Opening are secondary stats below. */}
                  <div className="stock-cards">
                    {filteredOnhand.map((r) => (
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
                      </div>
                    ))}
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
                            <td style={{ ...styles.td, fontSize: "0.78rem" }}>{m.sourceType}{m.sourceId ? ` #${m.sourceId}` : ""}</td>
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
                            {m.sourceType}{m.sourceId ? ` #${m.sourceId}` : ""}
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
          <Field label="Item"><select required style={mInput} value={openingDraft.itemTypeId} onChange={e => setOpeningDraft({ ...openingDraft, itemTypeId: e.target.value })}>
            <option value="">Pick an item...</option>
            {itemTypes.map(it => <option key={it.id} value={it.id}>{it.name}{it.hsCode ? ` (${it.hsCode})` : ""}</option>)}
          </select></Field>
          <Field label="Quantity"><input type="number" min={0} required style={mInput} value={openingDraft.quantity} onChange={e => setOpeningDraft({ ...openingDraft, quantity: e.target.value })} /></Field>
          <Field label="As Of"><input type="date" required style={mInput} value={openingDraft.asOfDate} onChange={e => setOpeningDraft({ ...openingDraft, asOfDate: e.target.value })} /></Field>
          <Field label="Notes"><input type="text" style={mInput} value={openingDraft.notes} onChange={e => setOpeningDraft({ ...openingDraft, notes: e.target.value })} placeholder="optional" /></Field>
        </SmallModal>
      )}

      {showAdjust && (
        <SmallModal title="Stock Adjustment" onClose={() => setShowAdjust(false)} onSubmit={submitAdjust}>
          <Field label="Item"><select required style={mInput} value={adjustDraft.itemTypeId} onChange={e => setAdjustDraft({ ...adjustDraft, itemTypeId: e.target.value })}>
            <option value="">Pick an item...</option>
            {itemTypes.map(it => <option key={it.id} value={it.id}>{it.name}{it.hsCode ? ` (${it.hsCode})` : ""}</option>)}
          </select></Field>
          <Field label="Delta (positive = up, negative = down)"><input type="number" required style={mInput} value={adjustDraft.delta} onChange={e => setAdjustDraft({ ...adjustDraft, delta: e.target.value })} /></Field>
          <Field label="Date"><input type="date" required style={mInput} value={adjustDraft.movementDate} onChange={e => setAdjustDraft({ ...adjustDraft, movementDate: e.target.value })} /></Field>
          <Field label="Notes"><input type="text" style={mInput} value={adjustDraft.notes} onChange={e => setAdjustDraft({ ...adjustDraft, notes: e.target.value })} placeholder="e.g. count correction, breakage" /></Field>
        </SmallModal>
      )}
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
  searchInput: { width: "100%", padding: "0.55rem 0.75rem 0.55rem 2.3rem", border: `1px solid ${colors.inputBorder}`, borderRadius: 10, fontSize: "0.88rem", backgroundColor: colors.inputBg, color: colors.textPrimary, outline: "none" },
  tableWrap: { overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 10, backgroundColor: "#fff" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" },
  th: { textAlign: "left", padding: "0.6rem 0.85rem", backgroundColor: "#f5f8fc", borderBottom: `1px solid ${colors.cardBorder}`, fontSize: "0.76rem", fontWeight: 700, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em" },
  td: { padding: "0.55rem 0.85rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textPrimary, verticalAlign: "top" },
  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", padding: "0.75rem 0" },
  pageBtn: { padding: "0.4rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, backgroundColor: "#fff", color: colors.blue, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", boxShadow: "none" },
  pageInfo: { fontSize: "0.82rem", color: colors.textSecondary, fontWeight: 500 },
};
const btnTiny = { padding: 0, width: 28, height: 28, borderRadius: 6, border: "1px solid #d0d7e2", backgroundColor: "#fff", color: "#c62828", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "none" };
