import RecordsViewport from "../Components/RecordsViewport";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  MdAdd,
  MdDelete,
  MdSwapHoriz,
  MdCalendarToday,
  MdNotes,
  MdEdit,
  MdClose,
  MdArrowForward,
  MdPrint,
  MdPictureAsPdf,
  MdVisibility,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { formStyles, modalSizes } from "../theme";
import {
  Alert,
  Button,
  CompanyPicker,
  EmptyState,
  Loading,
  PageHeader,
  SearchBox,
  Toolbar,
  ToolbarSpacer,
} from "../ui/Kit";
import BankCashSelect from "../Components/BankCashSelect";
import AttachmentManager from "../Components/AttachmentManager";
import {
  getTransfersPaged,
  createTransfer,
  updateTransfer,
  deleteTransfer,
  getTransferPrintData,
} from "../api/accountingApi";
import { mergeTemplate } from "../utils/templateEngine";
import { writeAndPrint } from "../utils/printDocument";
import { exportToPdf } from "../utils/exportUtils";
import { usePrintTemplates } from "../hooks/usePrintTemplates";
import PrintTemplateSelect from "../Components/PrintTemplateSelect";
import { defaultTransferTemplate } from "../utils/accountingDocTemplates";
import Pagination from "../Components/Pagination";
import AttachmentBadge from "../Components/AttachmentBadge";
import AttachmentQuickModal from "../Components/AttachmentQuickModal";
import { useEntityAttachmentCounts } from "../hooks/useEntityAttachmentCounts";
import usePageSize from "../hooks/usePageSize";
import useScrollToError from "../hooks/useScrollToError";

const fmtMoney = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

// Transfers are neutral money movement (neither in nor out) — teal accent
// distinguishes them from Receipts (green) and Payments (blue).
const accent = "var(--k-teal)";

/**
 * Inter-account transfers — move money between two bank/cash accounts
 * (e.g. cash deposit into the bank, or bank → bank). List + create/edit
 * modal, mirroring the Receipts/Payments page structure. Gated by
 * accounting.transfers.*.
 */
export default function TransfersPage() {
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canView = has("accounting.transfers.view");
  const canCreate = has("accounting.transfers.create");
  const canDelete = has("accounting.transfers.delete");
  const canPrintTransfer = has("accounting.transfers.print");

  // drives which template scope Print/PDF use — consistent with every other
  // Shared template-picker state (dropdown + Print/PDF resolution).
  const tplPicker = usePrintTemplates("Transfer");
  const [exportingId, setExportingId] = useState(null);

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize("transfers");
  const [serverPageSize, setServerPageSize] = useState(null);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // transfer being edited
  const [viewing, setViewing] = useState(null); // transfer being viewed (read-only)

  const companyId = selectedCompany?.id;
  const [attachTarget, setAttachTarget] = useState(null);
  const { counts: attachCounts, refresh: refreshAttachCounts } = useEntityAttachmentCounts(
    companyId,
    "AccountTransfer",
    rows.map((r) => r.id),
  );

  const fetchRows = useCallback(
    async (pg) => {
      if (!companyId) {
        setRows([]);
        return;
      }
      setLoading(true);
      try {
        const params = { page: pg || page };
        if (size) params.pageSize = size;
        if (search.trim()) params.search = search.trim();
        const { data } = await getTransfersPaged(companyId, params);
        setRows(data.items || []);
        setTotalCount(data.totalCount || 0);
        setServerPageSize(data.pageSize ?? null);
        setTotalPages(data.totalPages || 0);
      } catch {
        setRows([]);
        setTotalCount(0);
        setTotalPages(0);
      } finally {
        setLoading(false);
      }
    },
    [companyId, page, size, search],
  );

  // Reset to page 1 on company switch.
  useEffect(() => {
    setPage(1);
    setSearch("");
  }, [companyId]);
  useEffect(() => {
    fetchRows(page);
  }, [fetchRows, page]);

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
    if (!w) {
      notify("Popup blocked. Please allow popups for this site.", "warning");
      return;
    }
    w.document.write("<p>Loading transfer voucher...</p>");
    try {
      const { data } = await getTransferPrintData(t.id);
      writeAndPrint(w, mergeTemplate(resolveTpl(t), data));
    } catch {
      w.close();
      notify("Failed to load print data.", "error");
    }
  };

  const handleExportPdf = async (t) => {
    if (exportingId) return;
    setExportingId(t.id);
    try {
      const { data } = await getTransferPrintData(t.id);
      await exportToPdf(mergeTemplate(resolveTpl(t), data), `Transfer ${data.reference || t.id}`);
    } catch {
      notify("Failed to export PDF.", "error");
    } finally {
      setExportingId(null);
    }
  };

  if (!canView) {
    return <Alert tone="warn">You don't have permission to view transfers.</Alert>;
  }

  // Sum of what's shown on this page — a quick "money on screen" cue.
  const pageTotal = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div>
      <PageHeader
        icon={MdSwapHoriz}
        tone="teal"
        title="Transfers"
        subtitle="Money moved between bank / cash accounts"
        actions={
          canCreate &&
          companyId && (
            <Button variant="teal" icon={MdAdd} onClick={() => setShowForm(true)}>
              New Transfer
            </Button>
          )
        }
      />

      <CompanyPicker />

      {!companyId ? (
        <EmptyState icon={MdSwapHoriz}>Select a company to view transfers.</EmptyState>
      ) : (
        <>
          <Toolbar data-admin-toolbar="">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search transfers…"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setPage(1);
                  fetchRows(1);
                }
              }}
            />
            {canPrintTransfer && tplPicker.canChoose && <PrintTemplateSelect picker={tplPicker} />}
            <ToolbarSpacer />
            {rows.length > 0 && (
              <div style={st.pageSummary}>
                <span style={st.pageSummaryCount}>{totalCount} transfers</span>
                <span style={st.pageSummaryDot}>·</span>
                <span>Rs {fmtMoney(pageTotal)} on this page</span>
              </div>
            )}
          </Toolbar>

          <RecordsViewport label="Transfers records">
            {loading ? (
              <Loading>Loading transfers…</Loading>
            ) : rows.length === 0 ? (
              <EmptyState icon={MdSwapHoriz} title="No transfers yet." />
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
                    attachCount={attachCounts[t.id]}
                    onAttach={() => setAttachTarget(t)}
                  />
                ))}
              </div>
            )}
          </RecordsViewport>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={totalCount}
            onPage={setPage}
            pageSize={size ?? serverPageSize}
            onPageSize={(n) => {
              setSize(n);
              setPage(1);
            }}
          />
        </>
      )}

      {showForm && companyId && (
        <TransferForm
          companyId={companyId}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setPage(1);
            fetchRows(1);
            notify("Transfer saved.", "success");
          }}
        />
      )}

      {attachTarget && companyId && (
        <AttachmentQuickModal
          companyId={companyId}
          entityType="AccountTransfer"
          entityId={attachTarget.id}
          title={`Transfer ${attachTarget.reference} — Attachments`}
          onClose={() => {
            setAttachTarget(null);
            refreshAttachCounts();
          }}
        />
      )}

      {editing && companyId && (
        <TransferForm
          companyId={companyId}
          editTransfer={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            fetchRows(page);
            notify("Transfer updated.", "success");
          }}
        />
      )}

      {viewing && (
        <ViewTransferModal
          t={viewing}
          canEdit={canCreate}
          onEdit={() => {
            setViewing(null);
            setEditing(viewing);
          }}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function TransferCard({
  t,
  canEdit,
  canDelete,
  canPrint,
  tplPicker,
  exportingId,
  onView,
  onEdit,
  onDelete,
  onPrint,
  onExportPdf,
  attachCount,
  onAttach,
}) {
  const noTpl = tplPicker?.noTemplate;
  const noTplReason = tplPicker?.noTemplateReason;
  return (
    <div className="k-card" style={st.card}>
      <div style={{ ...st.accentStrip, background: accent }} />
      <div style={st.cardBody}>
        <div style={st.cardTop}>
          <span style={{ ...st.ref, color: accent }}>{t.reference}</span>
          <AttachmentBadge count={attachCount} onClick={onAttach} />
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

        <div style={st.metaGrid}>
          <span style={st.metaItem}>
            <MdCalendarToday size={13} /> {fmtDate(t.date)}
          </span>
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
              <Button size="sm" icon={MdVisibility} onClick={onView} title="View transfer">
                View
              </Button>
            )}
            {canPrint && (
              <Button
                size="sm"
                icon={MdPrint}
                disabled={noTpl}
                title={noTpl ? noTplReason : "Print transfer"}
                onClick={onPrint}
              >
                Print
              </Button>
            )}
            {canPrint && (
              <Button
                size="sm"
                icon={MdPictureAsPdf}
                disabled={noTpl || !!exportingId}
                title={noTpl ? noTplReason : "Download PDF"}
                onClick={onExportPdf}
              >
                PDF
              </Button>
            )}
            {canEdit && (
              <Button size="sm" icon={MdEdit} onClick={onEdit} title="Edit">
                Edit
              </Button>
            )}
            {canDelete && (
              <Button size="sm" variant="danger" icon={MdDelete} onClick={onDelete} title="Delete">
                Delete
              </Button>
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
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div
        data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: modalSizes.md }}
        onClick={(e) => e.stopPropagation()}
      >
        <div data-admin-header="" style={formStyles.header}>
          <h3 style={formStyles.title}>Transfer {t.reference}</h3>
          <button
            data-admin-close=""
            style={formStyles.closeButton}
            onClick={onClose}
            title="Close"
          >
            <MdClose size={18} />
          </button>
        </div>
        <div data-admin-body="" style={formStyles.body}>
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
            {t.description && <Row label="Description">{t.description}</Row>}
            {t.createdAt && <Row label="Created">{fmtDate(t.createdAt)}</Row>}
          </div>
        </div>
        <div style={st.viewFooter}>
          <Button data-admin-close="" onClick={onClose}>
            Close
          </Button>
          {canEdit && (
            <Button variant="primary" icon={MdEdit} onClick={onEdit}>
              Edit
            </Button>
          )}
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
  const isEdit = !!editTransfer?.id;

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(editTransfer?.date ? editTransfer.date.slice(0, 10) : today);
  const [fromAccountId, setFromAccountId] = useState(
    editTransfer?.fromAccountId ? String(editTransfer.fromAccountId) : "",
  );
  const [toAccountId, setToAccountId] = useState(
    editTransfer?.toAccountId ? String(editTransfer.toAccountId) : "",
  );
  const [amount, setAmount] = useState(
    editTransfer?.amount != null ? String(editTransfer.amount) : "",
  );
  const [description, setDescription] = useState(editTransfer?.description || "");
  // Transfers REQUIRE two real bank/cash accounts — the free-text fallback
  // BankCashSelect offers for payments doesn't apply here.
  const [hasAccounts, setHasAccounts] = useState(false);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const attachmentRef = useRef(null);
  const errRef = useScrollToError(error);

  const sameAccount = !!fromAccountId && fromAccountId === toAccountId;
  const amtNum = parseFloat(amount) || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError("");

    if (!fromAccountId || !toAccountId) {
      setError(
        hasAccounts
          ? "Select both the account the money was paid from and the account it was received in."
          : "Transfers need at least two Bank & Cash accounts — add them in Chart of Accounts first.",
      );
      return;
    }
    if (sameAccount) {
      setError('The "Paid from" and "Received in" accounts must be different.');
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
      };
      const { data: saved } = isEdit
        ? await updateTransfer(editTransfer.id, payload)
        : await createTransfer(companyId, payload);
      // Upload any files staged before the record had an id (best-effort).
      try {
        const savedId = saved?.id ?? editTransfer?.id;
        if (savedId) await attachmentRef.current?.flush(savedId);
      } catch {
        /* attachments are best-effort — the transfer is already saved */
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error || "Could not save the transfer.");
      setSaving(false);
    }
  };

  const blocked = saving || amtNum <= 0 || !fromAccountId || !toAccountId || sameAccount;

  return (
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={onClose}>
      <div
        data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px`, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div data-admin-header="" style={formStyles.header}>
          <h5 style={formStyles.title}>
            {isEdit ? `Edit ${editTransfer.reference || "Transfer"}` : "New Transfer"}
          </h5>
          <button
            data-admin-close=""
            style={formStyles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            <MdClose size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div data-admin-body="" style={formStyles.body}>
            {error && (
              <div ref={errRef} style={formStyles.error}>
                {error}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
                gap: "0.75rem",
              }}
            >
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Date</label>
                <input
                  type="date"
                  style={formStyles.input}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  max={today}
                />
              </div>
              <div style={formStyles.formGroup}>
                <label style={formStyles.label}>Amount</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  style={formStyles.input}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
                gap: "0.75rem",
              }}
            >
              <BankCashSelect
                companyId={companyId}
                value={fromAccountId}
                onChange={(id) => setFromAccountId(id ? String(id) : "")}
                onLoaded={(list) => setHasAccounts(list.length > 0)}
                includeAccount={
                  editTransfer?.fromAccountId
                    ? { id: editTransfer.fromAccountId, name: editTransfer.fromAccountName }
                    : null
                }
                label="Paid from (bank/cash)"
              />
              <BankCashSelect
                companyId={companyId}
                value={toAccountId}
                onChange={(id) => setToAccountId(id ? String(id) : "")}
                includeAccount={
                  editTransfer?.toAccountId
                    ? { id: editTransfer.toAccountId, name: editTransfer.toAccountName }
                    : null
                }
                label="Received in (bank/cash)"
              />
            </div>
            {sameAccount && (
              <div style={sameHint}>
                The "Paid from" and "Received in" accounts must be different.
              </div>
            )}

            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Description (optional)</label>
              <input
                style={formStyles.input}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

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

          <div data-admin-footer="" style={formStyles.footer}>
            <button
              data-admin-close=""
              type="button"
              style={{ ...formStyles.button, ...formStyles.cancel }}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...formStyles.button, ...formStyles.submit, opacity: blocked ? 0.6 : 1 }}
              disabled={blocked}
            >
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Save Transfer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const sameHint = {
  marginTop: "-0.25rem",
  marginBottom: "0.75rem",
  fontSize: "0.78rem",
  color: "var(--k-danger)",
  fontWeight: 600,
};

const st = {
  pageSummary: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: "0.8rem",
    color: "var(--k-muted)",
    flexWrap: "wrap",
  },
  pageSummaryCount: { fontWeight: 700, color: "var(--k-ink)" },
  pageSummaryDot: { opacity: 0.5 },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
    gap: "1rem",
    alignItems: "start",
  },
  card: {
    position: "relative",
    overflow: "hidden",
    display: "flex",
  },
  accentStrip: { width: 5, flexShrink: 0 },
  cardBody: { padding: "0.95rem 1.05rem", flex: 1, minWidth: 0 },

  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 },
  ref: { fontWeight: 800, fontSize: "0.92rem", letterSpacing: "0.3px" },

  amount: {
    fontSize: "1.5rem",
    fontWeight: 800,
    marginTop: 6,
    lineHeight: 1.1,
    wordBreak: "break-word",
  },
  rs: { fontSize: "0.85rem", fontWeight: 700, opacity: 0.7 },

  accountsRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" },
  accountName: {
    fontSize: "0.88rem",
    color: "var(--k-ink)",
    fontWeight: 700,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    minWidth: 0,
  },

  metaGrid: { display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8 },
  metaItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: "0.78rem",
    color: "var(--k-muted)",
  },

  descRow: {
    display: "flex",
    gap: 5,
    marginTop: 8,
    fontSize: "0.8rem",
    color: "var(--k-muted)",
    lineHeight: 1.4,
  },
  descText: {
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },

  cardActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 6,
    marginTop: 10,
    flexWrap: "wrap",
  },
  viewFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.6rem",
    flexWrap: "wrap",
    padding: "0.9rem clamp(1rem, 2vw, 1.5rem)",
    borderTop: "1px solid var(--k-line)",
    flexShrink: 0,
  },
  vRow: {
    display: "flex",
    gap: "0.75rem",
    padding: "0.4rem 0",
    borderBottom: "1px solid var(--k-line)",
  },
  vLabel: {
    flex: "0 0 130px",
    fontSize: "0.78rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color: "var(--k-muted)",
  },
  vValue: { flex: 1, fontSize: "0.9rem", color: "var(--k-ink)", wordBreak: "break-word" },
};
