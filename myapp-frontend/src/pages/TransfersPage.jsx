import { useState, useEffect, useCallback, useRef } from "react";
import {
  MdAdd, MdDelete, MdChevronLeft, MdChevronRight, MdSwapHoriz, MdSearch,
  MdBusiness, MdCalendarToday, MdLabel, MdNotes, MdEdit, MdClose,
  MdArrowForward, MdPrint, MdPictureAsPdf, MdVisibility,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, dropdownStyles, formStyles, modalSizes } from "../theme";
import BankCashSelect from "../Components/BankCashSelect";
import DivisionSelect from "../Components/DivisionSelect";
import AttachmentManager from "../Components/AttachmentManager";
import { getTransfersPaged, createTransfer, updateTransfer, deleteTransfer, getTransferPrintData } from "../api/accountingApi";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import { defaultTransferTemplate } from "../utils/accountingDocTemplates";

const fmtMoney = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

// Transfers are neutral money movement (neither in nor out) — teal accent
// distinguishes them from Receipts (green) and Payments (blue).
const accent = colors.teal;

/**
 * Inter-account transfers — move money between two bank/cash accounts
 * (e.g. cash deposit into the bank, or bank → bank). List + create/edit
 * modal, mirroring the Receipts/Payments page structure. Gated by
 * accounting.transfers.*.
 */
export default function TransfersPage() {
  const { companies, selectedCompany, setSelectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has("accounting.transfers.view");
  const canCreate = has("accounting.transfers.create");
  const canDelete = has("accounting.transfers.delete");
  const canPrintTransfer = has("accounting.transfers.print");

  // Shared template-picker state (dropdown + Print/PDF resolution).
  const tplPicker = usePrintTemplates("Transfer");
  const [exportingId, setExportingId] = useState(null);

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);   // transfer being edited
  const [viewing, setViewing] = useState(null);   // transfer being viewed (read-only)

  const companyId = selectedCompany?.id;

  const fetchRows = useCallback(async (pg) => {
    if (!companyId) { setRows([]); return; }
    setLoading(true);
    try {
      const params = { page: pg || page };
      if (search.trim()) params.search = search.trim();
      const { data } = await getTransfersPaged(companyId, params);
      setRows(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(data.totalPages || 0);
    } catch {
      setRows([]); setTotalCount(0); setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [companyId, page, search]);

  // Reset to page 1 on company switch.
  useEffect(() => { setPage(1); setSearch(""); }, [companyId]);
  useEffect(() => { fetchRows(page); }, [fetchRows, page]);

  const handleDelete = async (t) => {
    const ok = await confirm({
      title: "Delete Transfer?",
      message: `Delete ${t.reference}? Rs ${fmtMoney(t.amount)} moved from ${t.fromAccountName} to ${t.toAccountName} will be reversed in the ledger. This cannot be undone.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteTransfer(t.id);
      notify(`${t.reference} deleted.`, "success");
      fetchRows(page);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to delete.", "error");
    }
  };

  // Explicit dropdown pick wins; else the company default; else the built-in.
  const resolveTpl = (t) => tplPicker.resolveTemplate(t)?.htmlContent || defaultTransferTemplate;

  const handlePrint = async (t) => {
    const w = window.open("", "_blank");
    if (!w) { notify("Popup blocked. Please allow popups for this site.", "warning"); return; }
    w.document.write("<p>Loading transfer voucher...</p>");
    try {
      const { data } = await getTransferPrintData(t.id);
      writeAndPrint(w, mergeTemplate(resolveTpl(t), data));
    } catch { w.close(); notify("Failed to load print data.", "error"); }
  };

  const handleExportPdf = async (t) => {
    if (exportingId) return;
    setExportingId(t.id);
    try {
      const { data } = await getTransferPrintData(t.id);
      await exportToPdf(mergeTemplate(resolveTpl(t), data), `Transfer ${data.reference || t.id}`);
    } catch { notify("Failed to export PDF.", "error"); }
    finally { setExportingId(null); }
  };

  if (!canView) {
    return <div style={{ padding: "2rem", color: colors.textSecondary }}>You don't have permission to view transfers.</div>;
  }

  // Sum of what's shown on this page — a quick "money on screen" cue.
  const pageTotal = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={{ ...st.headerIcon, background: `${accent}15`, color: accent }}><MdSwapHoriz size={24} /></span>
          <div>
            <h2 style={st.h2}>Transfers</h2>
            <div style={st.subtitle}>Money moved between bank / cash accounts</div>
          </div>
        </div>
        {canCreate && companyId && (
          <button style={{ ...st.primaryBtn, background: accent }} onClick={() => setShowForm(true)}>
            <MdAdd size={18} /> New Transfer
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
        <div style={st.empty}>Select a company to view transfers.</div>
      ) : (
        <>
          <div style={st.toolbar}>
            <div style={{ position: "relative", flex: "1 1 240px", minWidth: 0, maxWidth: 360 }}>
              <MdSearch size={18} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.textSecondary }} />
              <input
                style={{ ...dropdownStyles.base, width: "100%", paddingLeft: 34 }}
                placeholder="Search transfers…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); fetchRows(1); } }}
              />
            </div>
            {canPrintTransfer && tplPicker.canChoose && <PrintTemplateSelect picker={tplPicker} />}
            {rows.length > 0 && (
              <div style={st.pageSummary}>
                <span style={st.pageSummaryCount}>{totalCount} transfers</span>
                <span style={st.pageSummaryDot}>·</span>
                <span>Rs {fmtMoney(pageTotal)} on this page</span>
              </div>
            )}
          </div>

          {loading ? (
            <div style={st.empty}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={st.empty}>No transfers yet.</div>
          ) : (
            <div style={st.grid}>
              {rows.map((t) => (
                <TransferCard
                  key={t.id}
                  t={t}
                  canEdit={canCreate}
                  canDelete={canDelete}
                  canPrint={canPrintTransfer}
                  tplPicker={tplPicker}
                  exportingId={exportingId}
                  onView={() => setViewing(t)}
                  onEdit={() => setEditing(t)}
                  onDelete={() => handleDelete(t)}
                  onPrint={() => handlePrint(t)}
                  onExportPdf={() => handleExportPdf(t)}
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
        <TransferForm
          companyId={companyId}
          onClose={() => setShowForm(false)}
          onSaved={() => { setPage(1); fetchRows(1); notify("Transfer saved.", "success"); }}
        />
      )}

      {editing && companyId && (
        <TransferForm
          companyId={companyId}
          editTransfer={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchRows(page); notify("Transfer updated.", "success"); }}
        />
      )}

      {viewing && (
        <ViewTransferModal
          t={viewing}
          canEdit={canCreate}
          onEdit={() => { setViewing(null); setEditing(viewing); }}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

/** One transfer card: reference, amount, from → to, date/division meta, description. */
function TransferCard({ t, canEdit, canDelete, canPrint, tplPicker, exportingId, onView, onEdit, onDelete, onPrint, onExportPdf }) {
  const noTpl = tplPicker?.noTemplate;
  const noTplReason = tplPicker?.noTemplateReason;
  return (
    <div style={st.card}>
      <div style={{ ...st.accentStrip, background: accent }} />
      <div style={st.cardBody}>
        <div style={st.cardTop}>
          <span style={{ ...st.ref, color: accent }}>{t.reference}</span>
        </div>

        <div style={{ ...st.amount, color: accent }}>
          <span style={st.rs}>Rs</span> {fmtMoney(t.amount)}
        </div>

        {/* From → To */}
        <div style={st.accountsRow}>
          <span style={st.accountName}>{t.fromAccountName || "—"}</span>
          <MdArrowForward size={16} style={{ color: accent, flexShrink: 0 }} />
          <span style={st.accountName}>{t.toAccountName || "—"}</span>
        </div>

        {/* Meta: date · division */}
        <div style={st.metaGrid}>
          <span style={st.metaItem}><MdCalendarToday size={13} /> {fmtDate(t.date)}</span>
          {t.divisionName && <span style={st.metaItem}><MdLabel size={13} /> {t.divisionName}</span>}
        </div>

        {/* Description — clamped so long notes don't blow the card up */}
        {t.description && (
          <div style={st.descRow}>
            <MdNotes size={13} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={st.descText}>{t.description}</span>
          </div>
        )}

        {(onView || canEdit || canDelete || canPrint) && (
          <div style={st.cardActions}>
            {onView && (
              <button style={st.viewBtn} onClick={onView} title="View transfer">
                <MdVisibility size={16} /> View
              </button>
            )}
            {canPrint && (
              <button
                style={{ ...st.printBtn, ...(noTpl ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
                disabled={noTpl}
                title={noTpl ? noTplReason : "Print transfer"}
                onClick={onPrint}
              >
                <MdPrint size={16} /> Print
              </button>
            )}
            {canPrint && (
              <button
                style={{ ...st.pdfBtn, ...((noTpl || exportingId === t.id) ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
                disabled={noTpl || !!exportingId}
                title={noTpl ? noTplReason : "Download PDF"}
                onClick={onExportPdf}
              >
                <MdPictureAsPdf size={16} /> PDF
              </button>
            )}
            {canEdit && (
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
        )}
      </div>
    </div>
  );
}

/**
 * Read-only detail view of an inter-account transfer. Mirrors the reference
 * product's "View" action — full details without the edit affordances.
 */
function ViewTransferModal({ t, canEdit, onEdit, onClose }) {
  const Row = ({ label, children }) => (
    <div style={st.vRow}>
      <span style={st.vLabel}>{label}</span>
      <span style={st.vValue}>{children}</span>
    </div>
  );
  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: modalSizes.md }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>Transfer {t.reference}</h3>
          <button style={formStyles.closeButton} onClick={onClose} title="Close"><MdClose size={18} /></button>
        </div>
        <div style={formStyles.body}>
          <div style={{ ...st.amount, color: accent, marginBottom: "1rem" }}>
            <span style={st.rs}>Rs</span> {fmtMoney(t.amount)}
          </div>
          <div style={st.accountsRow}>
            <span style={st.accountName}>{t.fromAccountName || "—"}</span>
            <MdArrowForward size={16} style={{ color: accent, flexShrink: 0 }} />
            <span style={st.accountName}>{t.toAccountName || "—"}</span>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <Row label="Reference">{t.reference}</Row>
            <Row label="Date">{fmtDate(t.date)}</Row>
            <Row label="From account">{t.fromAccountName || "—"}</Row>
            <Row label="To account">{t.toAccountName || "—"}</Row>
            <Row label="Amount">Rs {fmtMoney(t.amount)}</Row>
            {t.divisionName && <Row label="Division">{t.divisionName}</Row>}
            {t.description && <Row label="Description">{t.description}</Row>}
            {t.createdAt && <Row label="Created">{fmtDate(t.createdAt)}</Row>}
          </div>
        </div>
        <div style={st.viewFooter}>
          <button type="button" style={st.editBtn} onClick={onClose}>Close</button>
          {canEdit && <button type="button" style={st.viewBtn} onClick={onEdit}><MdEdit size={16} /> Edit</button>}
        </div>
      </div>
    </div>
  );
}

/**
 * Create / edit an inter-account transfer. Both legs use [BankCashSelect]
 * (same picker as Receipts/Payments); the server rejects non-bank/cash or
 * identical accounts — we guard client-side too so the operator gets an
 * immediate hint instead of a 400.
 */
function TransferForm({ companyId, editTransfer = null, onClose, onSaved }) {
  const { has } = usePermissions();
  const canViewDivisions = has("divisions.manage.view");
  const isEdit = !!editTransfer?.id;

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(editTransfer?.date ? editTransfer.date.slice(0, 10) : today);
  const [fromAccountId, setFromAccountId] = useState(editTransfer?.fromAccountId ? String(editTransfer.fromAccountId) : "");
  const [toAccountId, setToAccountId] = useState(editTransfer?.toAccountId ? String(editTransfer.toAccountId) : "");
  const [amount, setAmount] = useState(editTransfer?.amount != null ? String(editTransfer.amount) : "");
  const [description, setDescription] = useState(editTransfer?.description || "");
  const [divisionId, setDivisionId] = useState(editTransfer?.divisionId ? String(editTransfer.divisionId) : "");
  // Transfers REQUIRE two real bank/cash accounts — the free-text fallback
  // BankCashSelect offers for payments doesn't apply here.
  const [hasAccounts, setHasAccounts] = useState(false);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const attachmentRef = useRef(null);

  const sameAccount = !!fromAccountId && fromAccountId === toAccountId;
  const amtNum = parseFloat(amount) || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError("");

    if (!fromAccountId || !toAccountId) {
      setError(hasAccounts
        ? "Select both the account the money was paid from and the account it was received in."
        : "Transfers need at least two Bank & Cash accounts — add them in Chart of Accounts first.");
      return;
    }
    if (sameAccount) {
      setError("The \"Paid from\" and \"Received in\" accounts must be different.");
      return;
    }
    if (amtNum <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        date: new Date(date).toISOString(),
        fromAccountId: Number(fromAccountId),
        toAccountId: Number(toAccountId),
        amount: amtNum,
        description: description.trim() || null,
        divisionId: divisionId ? Number(divisionId) : null,
      };
      const { data: saved } = isEdit
        ? await updateTransfer(editTransfer.id, payload)
        : await createTransfer(companyId, payload);
      // Upload any files staged before the record had an id (best-effort).
      try {
        const savedId = saved?.id ?? editTransfer?.id;
        if (savedId) await attachmentRef.current?.flush(savedId);
      } catch { /* attachments are best-effort — the transfer is already saved */ }
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error || "Could not save the transfer.");
      setSaving(false);
    }
  };

  const blocked = saving || amtNum <= 0 || !fromAccountId || !toAccountId || sameAccount;

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? `Edit ${editTransfer.reference || "Transfer"}` : "New Transfer"}</h5>
          <button style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={formStyles.body}>
            {error && <div style={formStyles.error}>{error}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Date</label>
                <input type="date" style={formStyles.input} value={date} onChange={(e) => setDate(e.target.value)} max={today} />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Amount</label>
                <input
                  type="number" min="0.01" step="0.01" style={formStyles.input}
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "0.75rem" }}>
              <BankCashSelect
                companyId={companyId}
                value={fromAccountId}
                onChange={(id) => setFromAccountId(id ? String(id) : "")}
                onLoaded={(list) => setHasAccounts(list.length > 0)}
                includeAccount={editTransfer?.fromAccountId ? { id: editTransfer.fromAccountId, name: editTransfer.fromAccountName } : null}
                label="Paid from (bank/cash)"
              />
              <BankCashSelect
                companyId={companyId}
                value={toAccountId}
                onChange={(id) => setToAccountId(id ? String(id) : "")}
                includeAccount={editTransfer?.toAccountId ? { id: editTransfer.toAccountId, name: editTransfer.toAccountName } : null}
                label="Received in (bank/cash)"
              />
            </div>
            {sameAccount && (
              <div style={sameHint}>The "Paid from" and "Received in" accounts must be different.</div>
            )}

            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Description (optional)</label>
              <input style={formStyles.input} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            {canViewDivisions && (
              <DivisionSelect
                companyId={companyId}
                value={divisionId}
                onChange={setDivisionId}
                mode="select"
                label={<>Division <span style={{ fontWeight: 400, color: colors.textSecondary }}>(optional)</span></>}
                wrapStyle={formStyles.formGroup}
                labelStyle={formStyles.label}
                style={{ ...dropdownStyles.base, width: "100%" }}
              />
            )}

            <div style={{ marginTop: "0.5rem" }}>
              <AttachmentManager
                ref={attachmentRef}
                companyId={companyId}
                entityType="AccountTransfer"
                entityId={editTransfer?.id ?? null}
                mode="edit"
              />
            </div>
          </div>

          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: blocked ? 0.6 : 1 }} disabled={blocked}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Save Transfer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const sameHint = { marginTop: "-0.25rem", marginBottom: "0.75rem", fontSize: "0.78rem", color: colors.danger, fontWeight: 600 };

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

  amount: { fontSize: "1.5rem", fontWeight: 800, marginTop: 6, lineHeight: 1.1, wordBreak: "break-word" },
  rs: { fontSize: "0.85rem", fontWeight: 700, opacity: 0.7 },

  accountsRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" },
  accountName: { fontSize: "0.88rem", color: colors.textPrimary, fontWeight: 700, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", minWidth: 0 },

  metaGrid: { display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8 },
  metaItem: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.78rem", color: colors.textSecondary },

  descRow: { display: "flex", gap: 5, marginTop: 8, fontSize: "0.8rem", color: colors.textSecondary, lineHeight: 1.4 },
  descText: { overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" },

  cardActions: { display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10, flexWrap: "wrap" },
  viewBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, padding: "0.35rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  viewFooter: { display: "flex", justifyContent: "flex-end", gap: "0.6rem", flexWrap: "wrap", padding: "0.9rem clamp(1rem, 2vw, 1.5rem)", borderTop: `1px solid ${colors.cardBorder}`, flexShrink: 0 },
  vRow: { display: "flex", gap: "0.75rem", padding: "0.4rem 0", borderBottom: `1px solid ${colors.cardBorder}` },
  vLabel: { flex: "0 0 130px", fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: colors.textSecondary },
  vValue: { flex: 1, fontSize: "0.9rem", color: colors.textPrimary, wordBreak: "break-word" },
  printBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, padding: "0.35rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: "#4527a0", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  pdfBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, padding: "0.35rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: "#ad1457", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  editBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, padding: "0.35rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: "#e65100", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },
  delBtn: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 44, padding: "0.35rem 0.8rem", borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.danger, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" },

  pagination: { display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", marginTop: "1.25rem" },
  pageBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "0.45rem 0.8rem", minHeight: 44, borderRadius: 8, border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.blue, fontWeight: 600, cursor: "pointer" },
  pageInfo: { fontSize: "0.85rem", color: colors.textSecondary },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
};
