import { useState, useEffect, useCallback, useMemo } from "react";
import { MdReceiptLong, MdSearch, MdVisibility, MdDelete } from "react-icons/md";
import { getPurchaseDebitNotesByCompany, deletePurchaseDebitNote } from "../api/purchaseDebitNoteApi";
import DivisionSelect from "../Components/DivisionSelect";
import { useConfirm } from "../Components/ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { formStyles, modalSizes } from "../theme";

const colors = { blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3", danger: "#dc3545", inputBg: "#f8f9fb", inputBorder: "#d0d7e2" };
const money = (n) => "Rs. " + (Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "");

export default function PurchaseDebitNotesPage() {
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has("purchasedebitnotes.list.view");
  const canDelete = has("purchasedebitnotes.manage.delete");

  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [viewNote, setViewNote] = useState(null);

  const fetchNotes = useCallback(async (companyId) => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { data } = await getPurchaseDebitNotesByCompany(companyId);
      setNotes(Array.isArray(data) ? data : []);
    } catch {
      notify("Failed to load purchase debit notes.", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCompany?.id) fetchNotes(selectedCompany.id);
  }, [selectedCompany, fetchNotes]);

  const handleDelete = async (n) => {
    if (!(await confirm({ title: "Delete purchase debit note?", message: `Debit note #${n.debitNoteNumber} to ${n.supplierName} will be removed.`, confirmText: "Delete", danger: true }))) return;
    try {
      await deletePurchaseDebitNote(n.id);
      notify("Purchase debit note deleted.", "success");
      fetchNotes(selectedCompany.id);
    } catch (err) {
      notify(err.response?.data?.error || "Delete failed.", "error");
    }
  };

  const filtered = useMemo(() => notes.filter((n) => {
    if (divisionFilter && String(n.divisionId || "") !== String(divisionFilter)) return false;
    if (!search.trim()) return true;
    const t = search.toLowerCase();
    return (n.supplierName || "").toLowerCase().includes(t)
      || (n.notes || "").toLowerCase().includes(t)
      || String(n.debitNoteNumber).includes(t);
  }), [notes, search, divisionFilter]);

  const total = useMemo(() => filtered.reduce((s, n) => s + (Number(n.grandTotal) || 0), 0), [filtered]);

  if (!canView) {
    return <div style={styles.emptyState}><MdReceiptLong size={40} color={colors.cardBorder} /><p style={{ color: colors.textSecondary, marginTop: 8 }}>You don't have access to Purchase Debit Notes.</p></div>;
  }

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={styles.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div style={styles.iconBadge}><MdReceiptLong size={22} color="#fff" /></div>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.4rem", color: colors.textPrimary }}>Purchase Debit Notes</h2>
            <div style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>
              {filtered.length} note{filtered.length !== 1 ? "s" : ""} · {money(total)} total
            </div>
          </div>
        </div>
      </div>

      <div style={styles.filters}>
        <select
          style={styles.select}
          value={selectedCompany?.id || ""}
          onChange={(e) => setSelectedCompany(companies.find((c) => String(c.id) === e.target.value) || null)}
          disabled={loadingCompanies}
        >
          {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <DivisionSelect companyId={selectedCompany?.id} value={divisionFilter} onChange={setDivisionFilter} />
        <div style={styles.searchWrap}>
          <MdSearch size={18} color={colors.textSecondary} style={{ position: "absolute", left: 10, top: 10 }} />
          <input style={styles.searchInput} placeholder="Search supplier / description / #…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <p style={{ color: colors.textSecondary }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <div style={styles.emptyState}>
          <MdReceiptLong size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: 8 }}>No purchase debit notes for this company.</p>
        </div>
      ) : (
        <div style={styles.scroll}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.thNum}>#</th>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Supplier</th>
                <th style={styles.th}>Notes</th>
                <th style={styles.thMoney}>Amount</th>
                <th style={styles.thActions}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => (
                <tr key={n.id}>
                  <td style={styles.tdNum}>{n.debitNoteNumber}</td>
                  <td style={styles.td}>{fmtDate(n.date)}</td>
                  <td style={{ ...styles.td, fontWeight: 600 }}>
                    {n.supplierName}{n.divisionName ? <span style={styles.divTag}>{n.divisionName}</span> : null}
                  </td>
                  <td style={{ ...styles.td, color: colors.textSecondary }}>{n.supplierRef || n.notes || "—"}</td>
                  <td style={styles.tdMoney}>{money(n.grandTotal)}</td>
                  <td style={styles.tdActions}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button style={{ ...styles.iconBtn, ...styles.view }} title="View" onClick={() => setViewNote(n)}><MdVisibility size={16} /></button>
                      {canDelete && <button style={{ ...styles.iconBtn, ...styles.del }} title="Delete" onClick={() => handleDelete(n)}><MdDelete size={16} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={styles.tfLabel}>Total</td>
                <td style={styles.tfMoney}>{money(total)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {viewNote && (
        <div style={formStyles.backdrop} onClick={() => setViewNote(null)}>
          <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }} onClick={(e) => e.stopPropagation()}>
            <div style={formStyles.header}>
              <h5 style={formStyles.title}>Purchase Debit Note #{viewNote.debitNoteNumber}</h5>
              <button style={formStyles.closeButton} onClick={() => setViewNote(null)}>&times;</button>
            </div>
            <div style={formStyles.body}>
              <div style={styles.vRow}><span style={styles.vLbl}>Supplier</span><span style={styles.vVal}>{viewNote.supplierName}</span></div>
              <div style={styles.vRow}><span style={styles.vLbl}>Date</span><span style={styles.vVal}>{fmtDate(viewNote.date)}</span></div>
              {viewNote.divisionName && <div style={styles.vRow}><span style={styles.vLbl}>Division</span><span style={styles.vVal}>{viewNote.divisionName}</span></div>}
              {viewNote.supplierRef && <div style={styles.vRow}><span style={styles.vLbl}>Reference</span><span style={styles.vVal}>{viewNote.supplierRef}</span></div>}
              <div style={styles.scroll}>
                <table style={styles.table}>
                  <thead><tr><th style={styles.th}>Description</th><th style={styles.thMoney}>Qty</th><th style={styles.th}>UOM</th><th style={styles.thMoney}>Unit Price</th><th style={styles.thMoney}>Line Total</th></tr></thead>
                  <tbody>
                    {(viewNote.items || []).map((i) => (
                      <tr key={i.id}>
                        <td style={styles.td}>{i.description}</td>
                        <td style={styles.tdMoney}>{Number(i.quantity).toLocaleString()}</td>
                        <td style={styles.td}>{i.uom || "—"}</td>
                        <td style={styles.tdMoney}>{money(i.unitPrice)}</td>
                        <td style={styles.tdMoney}>{money(i.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ ...styles.vRow, borderTop: `1px solid ${colors.cardBorder}`, marginTop: 8, paddingTop: 12 }}>
                <span style={styles.vLbl}>Total</span><span style={{ ...styles.vVal, fontSize: "1.15rem", fontWeight: 700, color: colors.blue }}>{money(viewNote.grandTotal)}</span>
              </div>
            </div>
            <div style={formStyles.footer}>
              <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={() => setViewNote(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" },
  iconBadge: { width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, display: "flex", alignItems: "center", justifyContent: "center" },
  filters: { display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem" },
  select: { padding: "0.55rem 0.75rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, fontSize: "0.9rem", color: colors.textPrimary, minWidth: 220 },
  searchWrap: { position: "relative", flex: 1, minWidth: 220 },
  searchInput: { width: "100%", padding: "0.55rem 0.75rem 0.55rem 2.1rem", borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: colors.inputBg, fontSize: "0.9rem", boxSizing: "border-box" },
  scroll: { width: "100%", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 8, marginTop: 8 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 640 },
  th: { padding: "0.6rem 0.75rem", textAlign: "left", fontSize: "0.72rem", fontWeight: 800, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${colors.cardBorder}`, background: "#f8f9fb" },
  thNum: { padding: "0.6rem 0.75rem", textAlign: "left", fontSize: "0.72rem", fontWeight: 800, color: colors.textSecondary, borderBottom: `1px solid ${colors.cardBorder}`, background: "#f8f9fb", width: 60 },
  thMoney: { padding: "0.6rem 0.75rem", textAlign: "right", fontSize: "0.72rem", fontWeight: 800, color: colors.textSecondary, textTransform: "uppercase", borderBottom: `1px solid ${colors.cardBorder}`, background: "#f8f9fb" },
  thActions: { padding: "0.6rem 0.75rem", borderBottom: `1px solid ${colors.cardBorder}`, background: "#f8f9fb", width: 90 },
  td: { padding: "0.55rem 0.75rem", fontSize: "0.85rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textPrimary },
  tdNum: { padding: "0.55rem 0.75rem", fontSize: "0.85rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textSecondary },
  tdMoney: { padding: "0.55rem 0.75rem", fontSize: "0.85rem", borderBottom: `1px solid ${colors.cardBorder}`, color: colors.textPrimary, textAlign: "right", whiteSpace: "nowrap" },
  tdActions: { padding: "0.4rem 0.75rem", borderBottom: `1px solid ${colors.cardBorder}` },
  tfLabel: { padding: "0.6rem 0.75rem", textAlign: "right", fontWeight: 700, color: colors.textSecondary },
  tfMoney: { padding: "0.6rem 0.75rem", textAlign: "right", fontWeight: 800, color: colors.blue, whiteSpace: "nowrap" },
  divTag: { marginLeft: 6, padding: "0.1rem 0.4rem", borderRadius: 4, background: "#eef2ff", color: colors.blue, fontSize: "0.68rem", fontWeight: 700 },
  iconBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 6, border: "none", cursor: "pointer" },
  view: { background: "#eef2ff", color: colors.blue },
  del: { background: "#fff0f1", color: colors.danger },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", textAlign: "center" },
  vRow: { display: "flex", justifyContent: "space-between", padding: "0.3rem 0", gap: 12 },
  vLbl: { color: colors.textSecondary, fontSize: "0.85rem" },
  vVal: { color: colors.textPrimary, fontSize: "0.9rem", fontWeight: 500, textAlign: "right" },
};
