import { useState, useEffect, useCallback } from "react";
import {
  MdAdd, MdDelete, MdChevronLeft, MdChevronRight, MdReceiptLong, MdPayments,
  MdSearch, MdBusiness, MdExpandMore, MdPerson, MdAccountBalanceWallet,
  MdCalendarToday, MdLabel, MdNotes, MdVisibility, MdEdit, MdClose,
  MdPrint, MdPictureAsPdf,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, dropdownStyles } from "../theme";
import StatusBadge from "../Components/StatusBadge";
import PaymentForm from "../Components/PaymentForm";
import AttachmentManager from "../Components/AttachmentManager";
import { getPagedPayments, deletePayment, getPaymentPrintData } from "../api/paymentApi";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import { defaultReceiptTemplate, defaultPaymentTemplate } from "../utils/accountingDocTemplates";

const fmtMoney = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * Receipts (money in) / Payments (money out) list. mode = "receipts" |
 * "payments" — one component, registered twice in App.jsx. Responsive card
 * grid (collapses to one column on phones). Gated by accounting.<mode>.*.
 */
export default function PaymentsPage({ mode = "receipts" }) {
  const isReceipt = mode === "receipts";
  const dir = isReceipt ? "receipts" : "payments";
  const title = isReceipt ? "Receipts" : "Payments";
  const Icon = isReceipt ? MdReceiptLong : MdPayments;
  // Money in = green accent, money out = brand blue. Gives an at-a-glance cue
  // and colours the amount + allocation chips consistently.
  const accent = isReceipt ? colors.success : colors.blue;
  const docNoun = isReceipt ? "invoice" : "bill";

  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has(`accounting.${dir}.view`);
  const canCreate = has(`accounting.${dir}.create`);
  const canDelete = has(`accounting.${dir}.delete`);
  const canPrint = has(`accounting.${dir}.print`);

  // Mode-aware print-template picker (dropdown + Print/PDF resolution + gating).
  const tplPicker = usePrintTemplates(isReceipt ? "Receipt" : "Payment");
  const defaultTpl = isReceipt ? defaultReceiptTemplate : defaultPaymentTemplate;
  // Explicit dropdown pick wins; else the company default; else the built-in.
  const resolveTpl = (p) => tplPicker.resolveTemplate(p)?.htmlContent || defaultTpl;

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);   // payment being edited
  const [viewing, setViewing] = useState(null);    // payment being viewed (read-only)
  const [exportingId, setExportingId] = useState(null);   // PDF export in flight

  const companyId = selectedCompany?.id;

  const fetchRows = useCallback(async (pg) => {
    if (!companyId) { setRows([]); return; }
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (search.trim()) params.search = search.trim();
      const { data } = await getPagedPayments(dir, companyId, params);
      setRows(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(data.totalPages || 0);
    } catch {
      setRows([]); setTotalCount(0); setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [companyId, dir, page, search]);

  // Reset to page 1 on company / mode switch.
  useEffect(() => { setPage(1); setSearch(""); }, [companyId, dir]);
  useEffect(() => { fetchRows(page); }, [fetchRows, page]);

  const handleDelete = async (p) => {
    const ok = await confirm({
      title: `Delete ${isReceipt ? "Receipt" : "Payment"}?`,
      message: `Delete ${p.reference}? The settled ${isReceipt ? "invoices" : "bills"} will have their balance restored. This cannot be undone.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deletePayment(dir, p.id);
      notify(`${p.reference} deleted.`, "success");
      fetchRows(page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete.", "error");
    }
  };

  const onSaved = () => { setPage(1); fetchRows(1); notify(`${isReceipt ? "Receipt" : "Payment"} saved.`, "success"); };

  const handlePrint = async (p) => {
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Please allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading voucher...</p>");
    try {
      const { data } = await getPaymentPrintData(dir, p.id);
      writeAndPrint(w, mergeTemplate(resolveTpl(p), data));
    } catch { w.close(); notify("Failed to load print data.", "error"); }
  };

  const handleExportPdf = async (p) => {
    if (exportingId) return;
    setExportingId(p.id);
    try {
      const { data } = await getPaymentPrintData(dir, p.id);
      await exportToPdf(mergeTemplate(resolveTpl(p), data), `${isReceipt ? "Receipt" : "Payment"} ${data.reference || p.id}`);
    } catch { notify("Failed to export PDF.", "error"); }
    finally { setExportingId(null); }
  };

  if (!canView) {
    return <div style={{ padding: "2rem", color: colors.textSecondary }}>You don't have permission to view {title.toLowerCase()}.</div>;
  }

  // Sum of what's shown on this page — a quick "money on screen" cue.
  const pageTotal = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={{ ...st.headerIcon, background: `${accent}15`, color: accent }}><Icon size={24} /></span>
          <div>
            <h2 style={st.h2}>{title}</h2>
            <div style={st.subtitle}>{isReceipt ? "Money received from customers" : "Money paid to suppliers"}</div>
          </div>
        </div>
        {canCreate && companyId && (
          <button style={{ ...st.primaryBtn, background: accent }} onClick={() => setShowForm(true)}>
            <MdAdd size={18} /> {isReceipt ? "Record Receipt" : "Record Payment"}
          </button>
        )}
      </div>

      {companies.length > 0 && (
        <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <MdBusiness size={20} color={colors.blue} />
          <select
            style={dropdownStyles.base}
            value={selectedCompany?.id || ""}
            onChange={(e) => setSelectedCompany(companies.find((c) => parseInt(c.id) === parseInt(e.target.value)))}
          >
            {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
          </select>
        </div>
      )}

      {!companyId ? (
        <div style={st.empty}>Select a company to view {title.toLowerCase()}.</div>
      ) : (
        <>
          <div style={st.toolbar}>
            <div style={{ position: "relative", flex: "1 1 240px", minWidth: 0, maxWidth: 360 }}>
              <MdSearch size={18} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.textSecondary }} />
              <input
                style={{ ...dropdownStyles.base, width: "100%", paddingLeft: 34 }}
                placeholder={`Search ${title.toLowerCase()}…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); fetchRows(1); } }}
              />
            </div>
            {tplPicker.canChoose && <PrintTemplateSelect picker={tplPicker} />}
            {rows.length > 0 && (
              <div style={st.pageSummary}>
                <span style={st.pageSummaryCount}>{totalCount} {title.toLowerCase()}</span>
                <span style={st.pageSummaryDot}>·</span>
                <span>Rs {fmtMoney(pageTotal)} on this page</span>
              </div>
            )}
          </div>

          {loading ? (
            <div style={st.empty}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={st.empty}>No {title.toLowerCase()} yet.</div>
          ) : (
            <div style={st.grid}>
              {rows.map((p) => (
                <PayCard
                  key={p.id}
                  p={p}
                  accent={accent}
                  docNoun={docNoun}
                  canDelete={canDelete}
                  canEdit={canCreate}
                  canPrint={canPrint}
                  tplPicker={tplPicker}
                  exportingId={exportingId}
                  onDelete={() => handleDelete(p)}
                  onEdit={() => setEditing(p)}
                  onView={() => setViewing(p)}
                  onPrint={() => handlePrint(p)}
                  onExportPdf={() => handleExportPdf(p)}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div style={st.pagination}>
              <button style={{ ...st.pageBtn, opacity: page <= 1 ? 0.4 : 1 }} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <MdChevronLeft size={20} /> Prev
              </button>
              <span style={st.pageInfo}>Page {page} of {totalPages} ({totalCount} total)</span>
              <button style={{ ...st.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next <MdChevronRight size={20} />
              </button>
            </div>
          )}
        </>
      )}

      {showForm && companyId && (
        <PaymentForm mode={mode} companyId={companyId} onClose={() => setShowForm(false)} onSaved={onSaved} />
      )}

      {editing && companyId && (
        <PaymentForm
          mode={mode}
          companyId={companyId}
          editPayment={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchRows(page); notify(`${isReceipt ? "Receipt" : "Payment"} updated.`, "success"); }}
        />
      )}

      {viewing && (
        <PaymentViewDialog p={viewing} companyId={companyId} accent={accent} docNoun={docNoun} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

/**
 * One receipt/payment card. Header identity + amount always visible; the
 * settled-document breakdown is collapsed behind an expander so a 10-invoice
 * receipt and a 1-invoice receipt take the same space until you drill in.
 */
function PayCard({ p, accent, docNoun, canDelete, canEdit, canPrint, tplPicker, exportingId, onDelete, onEdit, onView, onPrint, onExportPdf }) {
  const [open, setOpen] = useState(false);
  const allocs = p.allocations || [];
  const count = allocs.length;
  const isCheque = (p.method || "").toLowerCase().includes("cheque");
  const chequeStatusTone =
    p.chequeStatus === "Bounced" ? "danger" : p.chequeStatus === "Cleared" ? "success" : "warning";

  return (
    <div style={st.card}>
      <div style={{ ...st.accentStrip, background: accent }} />
      <div style={st.cardBody}>
        {/* Header: reference + status badges */}
        <div style={st.cardTop}>
          <span style={{ ...st.ref, color: accent }}>{p.reference}</span>
          <div style={st.badges}>
            {p.isCancelled && <StatusBadge tone="danger">Cancelled</StatusBadge>}
            {p.isPostDated && <StatusBadge tone="warning">PDC</StatusBadge>}
            {isCheque && p.chequeStatus && p.chequeStatus !== "None" && (
              <StatusBadge tone={chequeStatusTone}>{p.chequeStatus}</StatusBadge>
            )}
          </div>
        </div>

        {/* Amount */}
        <div style={{ ...st.amount, color: accent }}>
          <span style={st.rs}>Rs</span> {fmtMoney(p.amount)}
        </div>

        {/* Contact */}
        {p.contactName && (
          <div style={st.contactRow}>
            <MdPerson size={15} style={{ color: colors.textSecondary, flexShrink: 0 }} />
            <span style={st.contact}>{p.contactName}</span>
          </div>
        )}

        {/* Meta grid: date · method · division */}
        <div style={st.metaGrid}>
          <span style={st.metaItem}><MdCalendarToday size={13} /> {fmtDate(p.date)}</span>
          <span style={st.metaItem}><MdAccountBalanceWallet size={13} /> {p.method}</span>
          {p.divisionName && <span style={st.metaItem}><MdLabel size={13} /> {p.divisionName}</span>}
        </div>

        {/* Cheque / bank detail line */}
        {(isCheque || p.bankAccountName) && (
          <div style={st.bankLine}>
            {isCheque && p.chequeNumber && <span>Cheque #{p.chequeNumber}</span>}
            {isCheque && p.chequeDate && <span>· dated {fmtDate(p.chequeDate)}</span>}
            {p.bankAccountName && <span>· {p.bankAccountName}</span>}
          </div>
        )}

        {/* Description */}
        {p.description && (
          <div style={st.descRow}>
            <MdNotes size={13} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{p.description}</span>
          </div>
        )}

        {/* Allocations — collapsed summary that expands to a clean breakdown */}
        {count > 0 && (
          <div style={st.allocWrap}>
            <button
              style={st.allocToggle}
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              <span style={st.allocToggleLabel}>
                <MdExpandMore
                  size={18}
                  style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none", color: accent }}
                />
                {count} {docNoun}{count !== 1 ? "s" : ""} settled
              </span>
              {!open && <span style={st.allocToggleHint}>view details</span>}
            </button>

            {open && (
              <div style={st.allocList}>
                {allocs.map((a) => (
                  <div key={a.id} style={st.allocRow}>
                    <span style={st.allocLabel}>{a.documentLabel || `${docNoun} #${a.invoiceNumber ?? a.purchaseBillNumber ?? ""}`}</span>
                    <span style={st.allocAmt}>Rs {fmtMoney(a.amount)}</span>
                  </div>
                ))}
                <div style={st.allocTotalRow}>
                  <span>Total</span>
                  <span style={{ color: accent }}>Rs {fmtMoney(p.amount)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer — View / Edit / Delete */}
        <div style={st.cardActions}>
          <button style={st.viewBtn} onClick={onView} title="View details">
            <MdVisibility size={16} /> View
          </button>
          {canPrint && (
            <button
              style={{ ...st.printBtn, ...(tplPicker.noTemplate ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
              disabled={tplPicker.noTemplate}
              title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print voucher"}
              onClick={onPrint}
            >
              <MdPrint size={14} /> Print
            </button>
          )}
          {canPrint && (
            <button
              style={{ ...st.pdfBtn, ...((tplPicker.noTemplate || exportingId === p.id) ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
              disabled={tplPicker.noTemplate || !!exportingId}
              title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Download PDF"}
              onClick={onExportPdf}
            >
              <MdPictureAsPdf size={14} /> PDF
            </button>
          )}
          {canEdit && !p.isCancelled && (
            <button style={st.editBtn} onClick={onEdit} title="Edit">
              <MdEdit size={16} /> Edit
            </button>
          )}
          {canDelete && (
            <button style={st.delBtn} onClick={onDelete} title="Delete">
              <MdDelete size={16} /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Read-only detail view of a single receipt/payment (manager.io-style). */
function PaymentViewDialog({ p, companyId, accent, docNoun, onClose }) {
  const allocs = p.allocations || [];
  const Row = ({ label, value }) => value == null || value === "" ? null : (
    <div style={vd.row}><span style={vd.k}>{label}</span><span style={vd.v}>{value}</span></div>
  );
  return (
    <div style={vd.backdrop} onClick={onClose}>
      <div style={vd.modal} onClick={(e) => e.stopPropagation()}>
        <div style={vd.header}>
          <span style={{ ...vd.ref, color: accent }}>{p.reference}</span>
          <button style={vd.close} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>
        <div style={vd.body}>
          <div style={{ ...vd.amount, color: accent }}>Rs {fmtMoney(p.amount)}</div>
          <Row label="Date" value={fmtDate(p.date)} />
          <Row label="Contact" value={p.contactName} />
          <Row label="Method" value={p.method} />
          <Row label="Bank / Cash account" value={p.bankAccountName} />
          {p.divisionName && <Row label="Division" value={p.divisionName} />}
          {p.chequeNumber && <Row label="Cheque #" value={`${p.chequeNumber}${p.chequeDate ? ` · ${fmtDate(p.chequeDate)}` : ""}`} />}
          <Row label="Status" value={p.isCancelled ? "Cancelled" : (p.chequeStatus && p.chequeStatus !== "None" ? p.chequeStatus : "Active")} />
          {p.description && <Row label="Description" value={p.description} />}
          {allocs.length > 0 && (
            <div style={{ marginTop: "0.6rem" }}>
              <div style={vd.k}>{docNoun}s settled</div>
              <div style={{ marginTop: 4 }}>
                {allocs.map((a) => (
                  <div key={a.id} style={vd.allocRow}>
                    <span>{a.documentLabel || `${docNoun} #${a.invoiceNumber ?? a.purchaseBillNumber ?? ""}`}</span>
                    <span style={{ fontWeight: 700 }}>Rs {fmtMoney(a.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {companyId && (
            <div style={{ marginTop: "0.9rem" }}>
              <AttachmentManager companyId={companyId} entityType="Payment" entityId={p.id} mode="view" />
            </div>
          )}
        </div>
        <div style={vd.footer}>
          <button style={vd.closeBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const st = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" },
  headerIcon: { display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 12, flexShrink: 0 },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary, lineHeight: 1.1 },
  subtitle: { fontSize: "0.8rem", color: colors.textSecondary, marginTop: 2 },
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1rem", minHeight: 44, borderRadius: 8, border: "none", color: "#fff", fontWeight: 700, cursor: "pointer" },
  toolbar: { display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" },
  pageSummary: { display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: colors.textSecondary, flexWrap: "wrap" },
  pageSummaryCount: { fontWeight: 700, color: colors.textPrimary },
  pageSummaryDot: { opacity: 0.5 },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "1rem", alignItems: "start" },
  card: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 14, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", position: "relative", overflow: "hidden", display: "flex" },
  accentStrip: { width: 5, flexShrink: 0 },
  cardBody: { padding: "0.95rem 1.05rem", flex: 1, minWidth: 0 },

  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 },
  ref: { fontWeight: 800, fontSize: "0.92rem", letterSpacing: "0.3px" },
  badges: { display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" },

  amount: { fontSize: "1.5rem", fontWeight: 800, marginTop: 6, lineHeight: 1.1, wordBreak: "break-word" },
  rs: { fontSize: "0.85rem", fontWeight: 700, opacity: 0.7 },

  contactRow: { display: "flex", alignItems: "center", gap: 5, marginTop: 8 },
  contact: { fontSize: "0.9rem", color: colors.textPrimary, fontWeight: 700, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },

  metaGrid: { display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8 },
  metaItem: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.78rem", color: colors.textSecondary },

  bankLine: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6, fontSize: "0.76rem", color: colors.textSecondary, fontStyle: "italic" },
  descRow: { display: "flex", gap: 5, marginTop: 8, fontSize: "0.8rem", color: colors.textSecondary, lineHeight: 1.4 },

  allocWrap: { marginTop: 10, borderTop: `1px dashed ${colors.cardBorder}`, paddingTop: 8 },
  allocToggle: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", minHeight: 36, padding: "0.3rem 0", background: "none", border: "none", cursor: "pointer", font: "inherit", color: colors.textPrimary },
  allocToggleLabel: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.82rem", fontWeight: 700 },
  allocToggleHint: { fontSize: "0.72rem", color: colors.textSecondary },
  allocList: { marginTop: 4, display: "flex", flexDirection: "column", gap: 1 },
  allocRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "0.4rem 0.5rem", borderRadius: 6, background: colors.inputBg, fontSize: "0.8rem" },
  allocLabel: { color: colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  allocAmt: { color: colors.textSecondary, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  allocTotalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "0.45rem 0.5rem 0.1rem", fontSize: "0.82rem", fontWeight: 800, color: colors.textPrimary, fontVariantNumeric: "tabular-nums" },

  cardActions: { display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10, flexWrap: "wrap" },
  viewBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 36, padding: "0.35rem 0.7rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  printBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 36, padding: "0.35rem 0.7rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: "#4527a0", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  pdfBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 36, padding: "0.35rem 0.7rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: "#ad1457", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  editBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 36, padding: "0.35rem 0.7rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: "#e65100", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  delBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 36, padding: "0.35rem 0.7rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.danger, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },

  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", marginTop: "1.25rem" },
  pageBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "0.45rem 0.8rem", minHeight: 44, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, fontWeight: 600, cursor: "pointer" },
  pageInfo: { fontSize: "0.85rem", color: colors.textSecondary },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
};

const vd = {
  backdrop: { position: "fixed", inset: 0, background: "rgba(15,20,30,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: "2vh 1rem" },
  modal: { background: "#fff", borderRadius: 12, width: "min(460px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.2)" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.9rem 1.1rem", borderBottom: `1px solid ${colors.cardBorder}` },
  ref: { fontWeight: 800, fontSize: "1rem" },
  close: { background: "transparent", border: "none", cursor: "pointer", color: colors.textSecondary, display: "grid", placeItems: "center" },
  body: { padding: "1rem 1.1rem", overflowY: "auto" },
  amount: { fontSize: "1.5rem", fontWeight: 800, marginBottom: "0.75rem" },
  row: { display: "flex", justifyContent: "space-between", gap: 12, padding: "0.3rem 0", borderBottom: `1px solid ${colors.inputBg}`, fontSize: "0.86rem" },
  k: { color: colors.textSecondary, fontWeight: 600 },
  v: { color: colors.textPrimary, fontWeight: 600, textAlign: "right" },
  allocRow: { display: "flex", justifyContent: "space-between", gap: 12, padding: "0.25rem 0.5rem", background: colors.inputBg, borderRadius: 6, marginBottom: 4, fontSize: "0.82rem" },
  footer: { display: "flex", justifyContent: "flex-end", padding: "0.75rem 1.1rem", borderTop: `1px solid ${colors.cardBorder}` },
  closeBtn: { padding: "0.5rem 1rem", minHeight: 40, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.textPrimary, fontWeight: 700, cursor: "pointer" },
};
