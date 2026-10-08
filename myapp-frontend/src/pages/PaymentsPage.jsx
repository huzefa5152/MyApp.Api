import { useState, useEffect, useCallback } from "react";
import {
  MdAdd, MdDelete, MdReceiptLong, MdPayments,
  MdExpandMore, MdPerson, MdAccountBalanceWallet,
  MdCalendarToday, MdNotes, MdVisibility, MdEdit, MdClose,
  MdPrint, MdPictureAsPdf, MdBusiness,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, formStyles } from "../theme";
import usePageSize, { PAGE_SIZE_OPTIONS } from "../hooks/usePageSize";
import Pagination from "../Components/Pagination";
import StatusBadge from "../Components/StatusBadge";
import PaymentForm from "../Components/PaymentForm";
import AttachmentManager from "../Components/AttachmentManager";
import AttachmentBadge from "../Components/AttachmentBadge";
import AttachmentQuickModal from "../Components/AttachmentQuickModal";
import { useEntityAttachmentCounts } from "../hooks/useEntityAttachmentCounts";
import { getPagedPayments, deletePayment, getPaymentPrintData } from "../api/paymentApi";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import { defaultReceiptTemplate, defaultPaymentTemplate } from "../utils/accountingDocTemplates";
import RichText from "../Components/RichText";
import {
  PageHeader, CompanyPicker, Button, Toolbar, ToolbarSpacer, SearchBox, EmptyState, Loading,
} from "../ui/Kit";

const fmtMoney = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * Receipts (money in) / Payments (money out) list. mode = "receipts" |
 * "payments" — one component, registered twice in App.jsx. Responsive card
 * grid (collapses to one column on phones). Gated by accounting.<mode>.*.
 *
 * Master is Division-free / GL-free: both modes print with the single "Receipt"
 * template type — the print DTO's `direction` distinguishes a receipt voucher
 * from a payment voucher.
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

  const { companies, selectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has(`accounting.${dir}.view`);
  const canCreate = has(`accounting.${dir}.create`);
  const canDelete = has(`accounting.${dir}.delete`);
  const canPrint = has(`accounting.${dir}.print`);

  // Receipts and Payments are DISTINCT print-template types so each voucher is
  // correctly titled ("Receipt Voucher" vs "Payment Voucher") from its own
  // starters. The picker + Print/PDF resolution behave like every other screen.
  const tplPicker = usePrintTemplates(isReceipt ? "Receipt" : "Payment");
  const defaultTpl = isReceipt ? defaultReceiptTemplate : defaultPaymentTemplate;
  // Explicit dropdown pick wins; else the company default; else the built-in.
  const resolveTpl = (p) => tplPicker.resolveTemplate(p)?.htmlContent || defaultTpl;

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("payments");
  const [observedSize, setObservedSize] = useState(null);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);   // payment being edited
  const [viewing, setViewing] = useState(null);    // payment being viewed (read-only)
  const [exportingId, setExportingId] = useState(null);   // PDF export in flight
  const [attachTarget, setAttachTarget] = useState(null);

  const companyId = selectedCompany?.id;
  const { counts: attachCounts, refresh: refreshAttachCounts } = useEntityAttachmentCounts(companyId, "Payment", rows.map((r) => r.id));

  const fetchRows = useCallback(async (pg) => {
    if (!companyId) { setRows([]); return; }
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (pageSize) params.pageSize = pageSize;
      if (search.trim()) params.search = search.trim();
      const { data } = await getPagedPayments(dir, companyId, params);
      setRows(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(data.totalPages || 0);
      setObservedSize(data.pageSize ?? null);
    } catch {
      setRows([]); setTotalCount(0); setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [companyId, dir, page, pageSize, search]);

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
    return <EmptyState icon={Icon}>You don't have permission to view {title.toLowerCase()}.</EmptyState>;
  }

  // Sum of what's shown on this page — a quick "money on screen" cue.
  const pageTotal = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div>
      <PageHeader
        icon={Icon}
        tone={isReceipt ? "green" : "blue"}
        title={title}
        subtitle={isReceipt ? "Money received from customers" : "Money paid to suppliers"}
        actions={canCreate && companyId && (
          <Button variant="primary" icon={MdAdd} onClick={() => setShowForm(true)}>
            {isReceipt ? "Record Receipt" : "Record Payment"}
          </Button>
        )}
      />

      {companies.length > 0 && <CompanyPicker />}

      {!companyId ? (
        <EmptyState icon={MdBusiness}>Select a company to view {title.toLowerCase()}.</EmptyState>
      ) : (
        <>
          <Toolbar>
            <SearchBox
              placeholder={`Search ${title.toLowerCase()}…`}
              value={search}
              onChange={setSearch}
              onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); fetchRows(1); } }}
            />
            {tplPicker.canChoose && <PrintTemplateSelect picker={tplPicker} />}
            <ToolbarSpacer />
            {rows.length > 0 && (
              <div style={st.pageSummary}>
                <span style={st.pageSummaryCount}>{totalCount} {title.toLowerCase()}</span>
                <span style={st.pageSummaryDot}>·</span>
                <span>Rs {fmtMoney(pageTotal)} on this page</span>
              </div>
            )}
          </Toolbar>

          {loading ? (
            <Loading>Loading…</Loading>
          ) : rows.length === 0 ? (
            <EmptyState icon={Icon}>No {title.toLowerCase()} yet.</EmptyState>
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
                  attachCount={attachCounts[p.id]}
                  onDelete={() => handleDelete(p)}
                  onEdit={() => setEditing(p)}
                  onView={() => setViewing(p)}
                  onPrint={() => handlePrint(p)}
                  onExportPdf={() => handleExportPdf(p)}
                  onAttach={() => setAttachTarget(p)}
                />
              ))}
            </div>
          )}

          {totalCount > PAGE_SIZE_OPTIONS[0] && (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={totalCount}
              onPage={setPage}
              pageSize={pageSize ?? observedSize}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
            />
          )}
        </>
      )}

      {showForm && companyId && (
        <PaymentForm mode={mode} companyId={companyId} onClose={() => { setShowForm(false); refreshAttachCounts(); }} onSaved={onSaved} />
      )}

      {editing && companyId && (
        <PaymentForm
          mode={mode}
          companyId={companyId}
          editPayment={editing}
          onClose={() => { setEditing(null); refreshAttachCounts(); }}
          onSaved={() => { setEditing(null); fetchRows(page); notify(`${isReceipt ? "Receipt" : "Payment"} updated.`, "success"); refreshAttachCounts(); }}
        />
      )}

      {viewing && (
        <PaymentViewDialog p={viewing} companyId={companyId} accent={accent} docNoun={docNoun} onClose={() => setViewing(null)} />
      )}

      {attachTarget && selectedCompany && (
        <AttachmentQuickModal
          companyId={selectedCompany.id}
          entityType="Payment"
          entityId={attachTarget.id}
          title={`#${attachTarget.number} — Attachments`}
          onClose={() => { setAttachTarget(null); refreshAttachCounts(); }}
        />
      )}
    </div>
  );
}

/**
 * One receipt/payment card. Header identity + amount always visible; the
 * settled-document breakdown is collapsed behind an expander so a 10-invoice
 * receipt and a 1-invoice receipt take the same space until you drill in.
 */
function PayCard({ p, accent, docNoun, canDelete, canEdit, canPrint, tplPicker, exportingId, attachCount, onDelete, onEdit, onView, onPrint, onExportPdf, onAttach }) {
  const [open, setOpen] = useState(false);
  const allocs = p.allocations || [];
  const count = allocs.length;
  const isCheque = (p.method || "").toLowerCase().includes("cheque");
  const chequeStatusTone =
    p.chequeStatus === "Bounced" ? "danger" : p.chequeStatus === "Cleared" ? "success" : "warning";

  return (
    <section className="k-card" style={st.card}>
      <div style={{ ...st.accentStrip, background: accent }} />
      <div style={st.cardBody}>
        {/* Header: reference + status badges */}
        <div style={st.cardTop}>
          <span style={{ ...st.ref, color: accent }}>{p.reference}</span>
          <div style={st.badges}>
            <AttachmentBadge count={attachCount} onClick={onAttach} />
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
            <MdPerson size={15} style={{ color: "var(--k-muted)", flexShrink: 0 }} />
            <span style={st.contact}>{p.contactName}</span>
          </div>
        )}

        {/* Meta grid: date · method */}
        <div style={st.metaGrid}>
          <span style={st.metaItem}><MdCalendarToday size={13} /> {fmtDate(p.date)}</span>
          <span style={st.metaItem}><MdAccountBalanceWallet size={13} /> {p.method}</span>
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
              type="button"
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

        {/* Footer — View / Print / PDF / Edit / Delete */}
        <div style={st.cardActions}>
          <Button size="sm" icon={MdVisibility} onClick={onView} title="View details">View</Button>
          {canPrint && (
            <Button
              size="sm"
              icon={MdPrint}
              disabled={tplPicker.noTemplate}
              title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Print voucher"}
              onClick={onPrint}
            >
              Print
            </Button>
          )}
          {canPrint && (
            <Button
              size="sm"
              icon={MdPictureAsPdf}
              disabled={tplPicker.noTemplate || !!exportingId}
              title={tplPicker.noTemplate ? tplPicker.noTemplateReason : "Download PDF"}
              onClick={onExportPdf}
            >
              PDF
            </Button>
          )}
          {canEdit && !p.isCancelled && (
            <Button size="sm" icon={MdEdit} onClick={onEdit} title="Edit">Edit</Button>
          )}
          {canDelete && (
            <Button size="sm" variant="danger" icon={MdDelete} onClick={onDelete} title="Delete">Delete</Button>
          )}
        </div>
      </div>
    </section>
  );
}

/** Read-only detail view of a single receipt/payment. */
function PaymentViewDialog({ p, companyId, accent, docNoun, onClose }) {
  const allocs = p.allocations || [];
  const Row = ({ label, value }) => value == null || value === "" ? null : (
    <div style={vd.row}><span style={vd.k}>{label}</span><span style={vd.v}>{value}</span></div>
  );
  return (
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: 460, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>{p.reference}</h5>
          <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>
        <div data-admin-body="" style={formStyles.body}>
          <div style={{ ...vd.amount, color: accent }}>Rs {fmtMoney(p.amount)}</div>
          <Row label="Date" value={fmtDate(p.date)} />
          <Row label="Contact" value={p.contactName} />
          <Row label="Method" value={p.method} />
          <Row label="Bank / Cash account" value={p.bankAccountName} />
          {p.chequeNumber && <Row label="Cheque #" value={`${p.chequeNumber}${p.chequeDate ? ` · ${fmtDate(p.chequeDate)}` : ""}`} />}
          <Row label="Status" value={p.isCancelled ? "Cancelled" : (p.chequeStatus && p.chequeStatus !== "None" ? p.chequeStatus : "Active")} />
          {p.description && <Row label="Description" value={p.description} />}
          {p.notes && <div style={{ marginTop: 12 }}><div style={vd.k}>Notes</div><div style={{ marginTop: 5, padding: 10, border: "1px solid var(--k-line)", borderRadius: 8 }}><RichText text={p.notes} /></div></div>}
          {allocs.length > 0 && (
            <div style={{ marginTop: "0.6rem" }}>
              <div style={vd.k}>Allocation details</div>
              <div style={{ marginTop: 4 }}>
                {allocs.map((a) => (
                  <div key={a.id} style={vd.allocRow}>
                    <span style={{ overflowWrap: "anywhere" }}>{a.documentLabel || `${docNoun} #${a.invoiceNumber ?? a.purchaseBillNumber ?? ""}`}</span>
                    <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>Rs {fmtMoney(a.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {companyId && (
            <div style={{ marginTop: "1rem" }}>
              <AttachmentManager companyId={companyId} entityType="Payment" entityId={p.id} mode="view" />
            </div>
          )}
        </div>
        <div data-admin-footer="" style={formStyles.footer}>
          <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const st = {
  pageSummary: { display: "flex", alignItems: "center", gap: 6, fontSize: "var(--k-font-sm)", color: "var(--k-muted)", flexWrap: "wrap", fontVariantNumeric: "tabular-nums" },
  pageSummaryCount: { fontWeight: 700, color: "var(--k-ink)" },
  pageSummaryDot: { opacity: 0.5 },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "var(--k-gap)", alignItems: "start" },
  // marginTop: 0 cancels the kit's ".k-card + .k-card" stacking gap — these sit in a grid.
  card: { position: "relative", overflow: "hidden", display: "flex", marginTop: 0 },
  accentStrip: { width: 5, flexShrink: 0 },
  cardBody: { padding: "var(--k-card-pad)", flex: 1, minWidth: 0 },

  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 },
  ref: { fontWeight: 800, fontSize: "calc(var(--k-font) + 0.02rem)", letterSpacing: "0.3px" },
  badges: { display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" },

  amount: { fontSize: "calc(var(--k-stat-value) + 0.15rem)", fontWeight: 800, marginTop: 6, lineHeight: 1.1, wordBreak: "break-word", fontVariantNumeric: "tabular-nums" },
  rs: { fontSize: "0.85rem", fontWeight: 700, opacity: 0.7 },

  contactRow: { display: "flex", alignItems: "center", gap: 5, marginTop: 8 },
  contact: { fontSize: "var(--k-font)", color: "var(--k-ink)", fontWeight: 700, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },

  metaGrid: { display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8 },
  metaItem: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--k-font-sm)", color: "var(--k-muted)" },

  bankLine: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6, fontSize: "var(--k-font-sm)", color: "var(--k-muted)", fontStyle: "italic" },
  descRow: { display: "flex", gap: 5, marginTop: 8, fontSize: "var(--k-font-sm)", color: "var(--k-muted)", lineHeight: 1.4 },

  allocWrap: { marginTop: 10, borderTop: "1px dashed var(--k-line)", paddingTop: 8 },
  allocToggle: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", minHeight: 36, padding: "0.3rem 0", background: "none", border: "none", boxShadow: "none", cursor: "pointer", font: "inherit", color: "var(--k-ink)" },
  allocToggleLabel: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--k-font-sm)", fontWeight: 700 },
  allocToggleHint: { fontSize: "0.72rem", color: "var(--k-muted)" },
  allocList: { marginTop: 4, display: "flex", flexDirection: "column", gap: 1 },
  allocRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "0.4rem 0.5rem", borderRadius: 6, background: "var(--k-surface-2)", fontSize: "var(--k-font-sm)" },
  allocLabel: { color: "var(--k-ink)", minWidth: 0, overflowWrap: "anywhere" },
  allocAmt: { color: "var(--k-muted)", fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  allocTotalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "0.45rem 0.5rem 0.1rem", fontSize: "var(--k-font-sm)", fontWeight: 800, color: "var(--k-ink)", fontVariantNumeric: "tabular-nums" },

  cardActions: { display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10, flexWrap: "wrap" },
};

const vd = {
  amount: { fontSize: "1.5rem", fontWeight: 800, marginBottom: "0.75rem", fontVariantNumeric: "tabular-nums" },
  row: { display: "flex", justifyContent: "space-between", gap: 12, padding: "0.3rem 0", borderBottom: "1px solid var(--k-surface-3)", fontSize: "var(--k-font)" },
  k: { color: "var(--k-muted)", fontWeight: 600 },
  v: { color: "var(--k-ink)", fontWeight: 600, textAlign: "right", overflowWrap: "anywhere" },
  allocRow: { display: "flex", justifyContent: "space-between", gap: 12, padding: "0.25rem 0.5rem", background: "var(--k-surface-2)", borderRadius: 6, marginBottom: 4, fontSize: "var(--k-font-sm)", fontVariantNumeric: "tabular-nums" },
};
