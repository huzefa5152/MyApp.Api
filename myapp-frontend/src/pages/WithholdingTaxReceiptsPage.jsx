import { useState, useEffect, useCallback, useMemo } from "react";
import { MdFactCheck, MdAdd, MdBusiness, MdSearch, MdEdit, MdDelete, MdPrint, MdVisibility, MdPictureAsPdf } from "react-icons/md";
import {
  getWithholdingReceiptsByCompany, createWithholdingReceipt,
  updateWithholdingReceipt, deleteWithholdingReceipt,
  getWithholdingReceiptPrintData,
} from "../api/withholdingTaxApi";
import WithholdingTaxReceiptForm from "../Components/WithholdingTaxReceiptForm";
import AttachmentManager from "../Components/AttachmentManager";
import DivisionSelect from "../Components/DivisionSelect";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import { useConfirm } from "../Components/ConfirmDialog";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import { notify } from "../utils/notify";
import { writeAndPrint } from "../utils/printDocument";
import { mergeTemplate } from "../utils/templateEngine";
import { exportToPdf } from "../utils/exportUtils";
import { defaultWithholdingTaxTemplate } from "../utils/accountingDocTemplates";
import { formStyles, modalSizes, dropdownStyles } from "../theme";

const colors = { blue: "#0d47a1", textPrimary: "#1a2332", textSecondary: "#5f6d7e", cardBorder: "#e8edf3" };

const money = (n) => "Rs. " + (Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "");

export default function WithholdingTaxReceiptsPage() {
  const { companies, selectedCompany, setSelectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has("withholdingtax.list.view");
  const canCreate = has("withholdingtax.manage.create");
  const canUpdate = has("withholdingtax.manage.update");
  const canDelete = has("withholdingtax.manage.delete");
  const canPrint = has("withholdingtax.print.view");

  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exportingId, setExportingId] = useState(null);
  const [search, setSearch] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  // Shared template-picker state, scoped to the selected division: "All
  // Divisions" → company-wide templates; a specific division → that division's.
  // An empty scope hides the picker and blocks Print/PDF (in the View modal).
  const tplPicker = usePrintTemplates("WithholdingTaxReceipt", { divisionId: divisionFilter });
  const [showForm, setShowForm] = useState(false);
  const [editReceipt, setEditReceipt] = useState(null);
  const [viewReceipt, setViewReceipt] = useState(null);

  // Explicit dropdown pick wins; else the company default; else the built-in.
  const resolveTpl = (r) => tplPicker.resolveTemplate(r)?.htmlContent || defaultWithholdingTaxTemplate;

  const fetchReceipts = useCallback(async (companyId) => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { data } = await getWithholdingReceiptsByCompany(companyId);
      setReceipts(Array.isArray(data) ? data : []);
    } catch {
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCompany) fetchReceipts(selectedCompany.id);
    else setReceipts([]);
    setDivisionFilter("");
  }, [selectedCompany, fetchReceipts]);

  const handleSave = async (payload) => {
    const res = editReceipt
      ? await updateWithholdingReceipt(editReceipt.id, payload)
      : await createWithholdingReceipt(selectedCompany.id, payload);
    notify(editReceipt ? "Receipt updated." : "Receipt created.", "success");
    await fetchReceipts(selectedCompany.id);
    return res.data;
  };

  const handleDelete = async (r) => {
    const ok = await confirm({
      title: "Delete receipt?",
      message: `Delete Withholding Tax Receipt #${r.receiptNumber} for "${r.clientName}" (${money(r.amount)})? This cannot be undone.`,
      variant: "danger", confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteWithholdingReceipt(r.id);
      notify("Receipt deleted.", "success");
      fetchReceipts(selectedCompany.id);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete the receipt.", "error");
    }
  };

  const handlePrint = async (r) => {
    // Open the popup BEFORE any await so the pop-up blocker doesn't kill it.
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Allow popups for this site to print.", "warning"); return; }
    w.document.write("<p style='font-family:sans-serif;padding:24px'>Loading certificate…</p>");
    try {
      const { data } = await getWithholdingReceiptPrintData(r.id);
      writeAndPrint(w, mergeTemplate(resolveTpl(r), data));
    } catch {
      w.close();
      notify("Failed to prepare the print view.", "error");
    }
  };

  const handleExportPdf = async (r) => {
    if (exportingId) return;
    setExportingId(r.id);
    try {
      const { data } = await getWithholdingReceiptPrintData(r.id);
      await exportToPdf(mergeTemplate(resolveTpl(r), data), `WHT Receipt ${data.receiptNumber || r.id}`);
    } catch {
      notify("Failed to export PDF.", "error");
    } finally {
      setExportingId(null);
    }
  };

  const filtered = useMemo(() => {
    return receipts.filter((r) => {
      if (divisionFilter && String(r.divisionId || "") !== String(divisionFilter)) return false;
      if (!search.trim()) return true;
      const t = search.toLowerCase();
      return (r.clientName || "").toLowerCase().includes(t)
        || (r.description || "").toLowerCase().includes(t)
        || String(r.receiptNumber).includes(t);
    });
  }, [receipts, search, divisionFilter]);

  const total = useMemo(() => filtered.reduce((sum, r) => sum + (Number(r.amount) || 0), 0), [filtered]);

  if (!canView) {
    return <div style={styles.emptyState}><MdFactCheck size={40} color={colors.cardBorder} /><p style={{ color: colors.textSecondary, marginTop: 8 }}>You don't have access to Withholding Tax Receipts.</p></div>;
  }

  return (
    <div>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={styles.headerIcon}><MdFactCheck size={26} color="#fff" /></div>
          <div>
            <h2 style={styles.pageTitle}>Withholding Tax Receipts</h2>
            <p style={styles.pageSubtitle}>
              {selectedCompany ? `${filtered.length} receipt${filtered.length !== 1 ? "s" : ""} · ${money(total)} total` : "Select a company"}
            </p>
          </div>
        </div>
        {companies.length > 0 && canCreate && selectedCompany && (
          <button style={styles.addBtn} onClick={() => { setEditReceipt(null); setShowForm(true); }}>
            <MdAdd size={18} /> New Receipt
          </button>
        )}
      </div>

      {loadingCompanies ? (
        <div style={styles.loading}><div style={styles.spinner} /></div>
      ) : companies.length > 0 ? (
        <div style={styles.filters}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <MdBusiness size={20} color={colors.blue} />
            <select
              style={dropdownStyles.base}
              value={selectedCompany?.id || ""}
              onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
            >
              {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
            </select>
          </div>
          {has("divisions.manage.view") && selectedCompany && (
            <DivisionSelect companyId={selectedCompany.id} value={divisionFilter} onChange={setDivisionFilter} style={dropdownStyles.base} wrapStyle={{ minWidth: 180 }} />
          )}
          {receipts.length > 3 && (
            <div style={styles.searchWrap}>
              <MdSearch style={styles.searchIcon} />
              <input type="text" placeholder="Search customer / description…" value={search} onChange={(e) => setSearch(e.target.value)} style={styles.searchInput} />
            </div>
          )}
          {canPrint && tplPicker.canChoose && <PrintTemplateSelect picker={tplPicker} />}
        </div>
      ) : (
        <div style={styles.emptyState}><MdBusiness size={40} color={colors.cardBorder} /><p style={{ color: colors.textSecondary, marginTop: 8 }}>No companies available.</p></div>
      )}

      {loading ? (
        <div style={styles.loading}><div style={styles.spinner} /></div>
      ) : selectedCompany && filtered.length === 0 ? (
        <div style={styles.emptyState}>
          <MdFactCheck size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: 8 }}>
            {receipts.length === 0 ? "No withholding tax receipts yet." : "No receipts match your search."}
          </p>
        </div>
      ) : selectedCompany ? (
        <div style={styles.scroll}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.thNum}>#</th>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Customer</th>
                <th style={styles.th}>Description</th>
                <th style={styles.thMoney}>Amount</th>
                <th style={styles.thActions}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={styles.tr}>
                  <td style={styles.tdNum}>{r.receiptNumber}</td>
                  <td style={styles.td}>{fmtDate(r.date)}</td>
                  <td style={{ ...styles.td, fontWeight: 600 }}>
                    {r.clientName}{r.divisionName ? <span style={styles.divTag}>{r.divisionName}</span> : null}
                  </td>
                  <td style={{ ...styles.td, color: colors.textSecondary }}>{r.description || "—"}</td>
                  <td style={styles.tdMoney}>{money(r.amount)}</td>
                  <td style={styles.tdActions}>
                    <div style={styles.actionRow}>
                      <button style={{ ...styles.iconBtn, ...styles.view }} title="View / Print" onClick={() => setViewReceipt(r)}><MdVisibility size={16} /></button>
                      {canUpdate && <button style={{ ...styles.iconBtn, ...styles.edit }} title="Edit" onClick={() => { setEditReceipt(r); setShowForm(true); }}><MdEdit size={16} /></button>}
                      {canDelete && r.isLatest && <button style={{ ...styles.iconBtn, ...styles.del }} title="Delete (latest only)" onClick={() => handleDelete(r)}><MdDelete size={16} /></button>}
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
      ) : null}

      {showForm && selectedCompany && (
        <WithholdingTaxReceiptForm
          companyId={selectedCompany.id}
          receipt={editReceipt}
          defaultDivisionId={divisionFilter || null}
          onClose={() => { setShowForm(false); setEditReceipt(null); }}
          onSaved={handleSave}
        />
      )}

      {viewReceipt && (
        <div style={formStyles.backdrop} onClick={() => setViewReceipt(null)}>
          <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px` }} onClick={(e) => e.stopPropagation()}>
            <div style={formStyles.header}>
              <h5 style={formStyles.title}>Withholding Tax Receipt #{viewReceipt.receiptNumber}</h5>
              <button style={formStyles.closeButton} onClick={() => setViewReceipt(null)}>&times;</button>
            </div>
            <div style={formStyles.body}>
              <div style={styles.vRow}><span style={styles.vLbl}>Customer</span><span style={styles.vVal}>{viewReceipt.clientName}</span></div>
              <div style={styles.vRow}><span style={styles.vLbl}>Date</span><span style={styles.vVal}>{fmtDate(viewReceipt.date)}</span></div>
              {viewReceipt.divisionName && <div style={styles.vRow}><span style={styles.vLbl}>Division</span><span style={styles.vVal}>{viewReceipt.divisionName}</span></div>}
              <div style={styles.vRow}><span style={styles.vLbl}>Description</span><span style={styles.vVal}>{viewReceipt.description || "—"}</span></div>
              <div style={{ ...styles.vRow, borderTop: `1px solid ${colors.cardBorder}`, marginTop: 8, paddingTop: 12 }}>
                <span style={styles.vLbl}>Amount</span><span style={{ ...styles.vVal, fontSize: "1.2rem", fontWeight: 700, color: colors.blue }}>{money(viewReceipt.amount)}</span>
              </div>
              <div style={{ marginTop: 14 }}>
                <AttachmentManager companyId={selectedCompany.id} entityType="WithholdingTaxReceipt" entityId={viewReceipt.id} mode="view" title="Certificate" />
              </div>
            </div>
            <div style={formStyles.footer}>
              <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={() => setViewReceipt(null)}>Close</button>
              {canPrint && (
                <button
                  type="button"
                  disabled={tplPicker.noTemplate}
                  title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print certificate"}
                  style={{ ...formStyles.button, ...formStyles.submit, display: "inline-flex", alignItems: "center", gap: 6, ...(tplPicker.noTemplate ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
                  onClick={() => handlePrint(viewReceipt)}
                >
                  <MdPrint size={16} /> Print
                </button>
              )}
              {canPrint && (
                <button
                  type="button"
                  disabled={tplPicker.noTemplate || !!exportingId}
                  title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Download PDF"}
                  style={{ ...formStyles.button, ...formStyles.submit, display: "inline-flex", alignItems: "center", gap: 6, ...((tplPicker.noTemplate || exportingId) ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
                  onClick={() => handleExportPdf(viewReceipt)}
                >
                  <MdPictureAsPdf size={16} /> PDF
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" },
  headerIcon: { width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg, #0d47a1, #00897b)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  pageTitle: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  pageSubtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1.25rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #0d47a1, #00897b)", color: "#fff", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  filters: { display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.25rem" },
  searchWrap: { position: "relative", flex: 1, minWidth: 180, maxWidth: 320 },
  searchIcon: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: "1.1rem" },
  searchInput: { width: "100%", padding: "0.55rem 0.75rem 0.55rem 2.3rem", border: "1px solid #d0d7e2", borderRadius: 10, fontSize: "0.88rem", backgroundColor: "#f8f9fb", color: "#1a2332", outline: "none" },
  scroll: { width: "100%", overflowX: "auto", border: `1px solid ${colors.cardBorder}`, borderRadius: 12, background: "#fff", WebkitOverflowScrolling: "touch" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 640 },
  th: { textAlign: "left", padding: "0.6rem 0.8rem", fontWeight: 700, color: colors.textSecondary, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.02em", background: "#f8f9fb", borderBottom: "2px solid #e8edf3", whiteSpace: "nowrap" },
  thNum: { textAlign: "right", padding: "0.6rem 0.6rem", fontWeight: 700, color: colors.textSecondary, fontSize: "0.72rem", background: "#f8f9fb", borderBottom: "2px solid #e8edf3", width: 50 },
  thMoney: { textAlign: "right", padding: "0.6rem 0.8rem", fontWeight: 700, color: colors.textSecondary, fontSize: "0.72rem", background: "#f8f9fb", borderBottom: "2px solid #e8edf3", whiteSpace: "nowrap" },
  thActions: { padding: "0.6rem 0.5rem", background: "#f8f9fb", borderBottom: "2px solid #e8edf3", width: 1 },
  tr: { borderBottom: "1px solid #eef2f7" },
  td: { padding: "0.55rem 0.8rem", color: "#334155", verticalAlign: "middle" },
  tdNum: { padding: "0.55rem 0.6rem", textAlign: "right", color: colors.textSecondary, verticalAlign: "middle", fontVariantNumeric: "tabular-nums" },
  tdMoney: { padding: "0.55rem 0.8rem", textAlign: "right", color: "#1a2332", fontWeight: 600, verticalAlign: "middle", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  tdActions: { padding: "0.4rem 0.5rem", verticalAlign: "middle" },
  divTag: { marginLeft: 8, fontSize: "0.68rem", fontWeight: 700, color: "#4527a0", background: "#ede7f6", padding: "0.1rem 0.4rem", borderRadius: 8 },
  actionRow: { display: "flex", gap: 4, justifyContent: "flex-end" },
  iconBtn: { display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, border: "none", cursor: "pointer" },
  view: { background: "#e0f2f1", color: "#00695c" },
  edit: { background: "#e3f2fd", color: "#0d47a1" },
  del: { background: "#ffebee", color: "#c62828" },
  tfLabel: { padding: "0.6rem 0.8rem", textAlign: "right", fontWeight: 700, color: colors.textSecondary, borderTop: "2px solid #e8edf3", background: "#fafbfc" },
  tfMoney: { padding: "0.6rem 0.8rem", textAlign: "right", fontWeight: 800, color: colors.blue, borderTop: "2px solid #e8edf3", background: "#fafbfc", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  vRow: { display: "flex", justifyContent: "space-between", gap: 12, padding: "0.4rem 0" },
  vLbl: { fontSize: "0.78rem", fontWeight: 600, color: colors.textSecondary, textTransform: "uppercase", letterSpacing: "0.02em" },
  vVal: { fontSize: "0.9rem", color: "#1a2332", textAlign: "right" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`, borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  emptyState: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", textAlign: "center" },
};
