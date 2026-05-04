import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { MdReceipt, MdPerson, MdCalendarToday, MdVisibility, MdEdit, MdCancel, MdDelete, MdPrint, MdPictureAsPdf, MdGridOn, MdWarning, MdRequestQuote, MdLocationOn, MdContentCopy } from "react-icons/md";
import ChallanModal from "./ChallanModal";
import { cardStyles, cardHover } from "../theme";
import { usePermissions } from "../contexts/PermissionsContext";

const colors = {
  blue: "#0d47a1",
  blueLight: "#1565c0",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

const statusColors = {
  Pending: { bg: "#fff3e0", color: "#e65100", border: "#e6510030" },
  // Imported = historical back-fill, billable same as Pending.
  // Purple tint so operators can tell at a glance which rows came from import.
  Imported: { bg: "#f3e5f5", color: "#6a1b9a", border: "#6a1b9a30" },
  "No PO": { bg: "#e3f2fd", color: "#0d47a1", border: "#0d47a130" },
  Invoiced: { bg: "#e8f5e9", color: "#2e7d32", border: "#2e7d3230" },
  Cancelled: { bg: "#ffebee", color: "#c62828", border: "#c6282830" },
  "Setup Required": { bg: "#fce4ec", color: "#880e4f", border: "#880e4f30" },
};

function WarningTooltip({ warnings }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const show = useCallback(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 260) });
  }, []);
  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)} style={{ color: "#e65100", cursor: "help", display: "inline-flex", alignItems: "center" }}>
      <MdWarning size={18} />
      {pos && createPortal(
        <div style={{
          position: "fixed", top: pos.top, left: pos.left, zIndex: 9999,
          minWidth: 240, maxWidth: 320, padding: "0.6rem 0.75rem",
          background: "#fff", border: "1px solid #e65100", borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.15)", color: "#333",
          pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4, fontSize: "0.78rem", color: "#e65100" }}>FBR Setup Required</div>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.75rem", lineHeight: 1.6 }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>,
        document.body
      )}
    </span>
  );
}

export default function ChallanList({ challans, onCancel, onDelete, onPrint, onEditItems, onExportPdf, onExportExcel, onGenerateBill, onDuplicate, exportingId, duplicatingId }) {
  const { has } = usePermissions();
  const permUpdate = has("challans.manage.update");
  const permDelete = has("challans.manage.delete");
  const permPrint = has("challans.print.view");
  const permCreateBill = has("invoices.manage.create");
  const permCreate = has("challans.manage.create");
  const [selectedChallan, setSelectedChallan] = useState(null);

  if (!challans || challans.length === 0) return null;

  return (
    <>
      <div className="card-grid">
        {challans.map((c) => {
          const sc = statusColors[c.status] || statusColors.Pending;
          // Backend now sends `isEditable` — use it so billed-but-not-FBR-submitted challans can also be edited
          const isEditable = c.isEditable ?? (c.status === "Pending" || c.status === "Imported" || c.status === "No PO" || c.status === "Setup Required");
          // Separate flag: delete/cancel is only allowed when NOT billed
          const canCancel = c.status !== "Invoiced" && isEditable;
          // Delete is only allowed on the LATEST challan so numbering stays
          // gap-free — earlier challans must be edited instead.
          const canDelete = canCancel && c.isLatest === true;
          const hasWarnings = c.warnings && c.warnings.length > 0;
          // Generate Bill shortcut — only for billable statuses
          // (Pending / Imported), matching the backend's CreateAsync guard.
          const canGenerateBill = permCreateBill && (c.status === "Pending" || c.status === "Imported");
          // Duplicate is available on the same statuses as Generate Bill —
          // a duplicate is essentially a fast new-row create that reuses the
          // challan number for a different PO. Backend's DuplicateAsync
          // enforces the same guard.
          const canDuplicate = permCreate && (c.status === "Pending" || c.status === "Imported");
          const isDuplicate = c.duplicatedFromId != null;
          const isDuplicating = duplicatingId === c.id;
          return (
            <div
              key={c.id}
              style={cardStyles.card}
              onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
              onMouseLeave={(e) =>
                Object.assign(e.currentTarget.style, { transform: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" })
              }
            >
              <div style={cardStyles.cardContent}>
                <div>
                  <div style={styles.cardTopRow}>
                    <h5 style={cardStyles.title}>
                      <MdReceipt style={{ color: colors.blue, marginRight: 6, verticalAlign: "middle" }} />
                      Challan #{c.challanNumber}
                    </h5>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {hasWarnings && <WarningTooltip warnings={c.warnings} />}
                      {/* DUPLICATE pill — shown when this row was created via
                          the Duplicate action, so operators can tell at a
                          glance which rows share a challan number with a
                          sibling. Title shows the parent's number. */}
                      {isDuplicate && (
                        <span
                          style={{ ...styles.statusBadge, ...styles.duplicateBadge }}
                          title={c.duplicatedFromChallanNumber
                            ? `Duplicate of Challan #${c.duplicatedFromChallanNumber} — separate billable copy`
                            : "Duplicate — separate billable copy of an earlier challan"}
                        >
                          <MdContentCopy size={11} style={{ marginRight: 3 }} />
                          DUPLICATE
                        </span>
                      )}
                      <span style={{ ...styles.statusBadge, backgroundColor: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                        {c.status === "Invoiced" ? "Billed" : c.status}
                      </span>
                    </div>
                  </div>

                  {isDuplicate && c.duplicatedFromChallanNumber && (
                    <p style={{
                      ...cardStyles.text,
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      color: "#6a1b9a",
                      fontWeight: 600,
                      fontSize: "0.78rem",
                      marginTop: "-0.15rem",
                    }}>
                      <MdContentCopy size={13} style={{ flexShrink: 0 }} />
                      Duplicate of Challan #{c.duplicatedFromChallanNumber}
                    </p>
                  )}
                  <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <MdPerson style={{ color: colors.teal, flexShrink: 0 }} />
                    <strong>Client:</strong> {c.clientName}
                  </p>
                  <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <MdReceipt style={{ color: colors.textSecondary, flexShrink: 0 }} />
                    <strong>PO:</strong> {c.poNumber || "\u2014"}
                  </p>
                  {/* Indent No + Site \u2014 surfaced on the card so the
                      operator can scan a list and see "is this the
                      Soorty PO for Unit-2?" without having to open the
                      view modal. Both fields are optional; only render
                      when set so unfilled cards don't get noise. */}
                  {c.indentNo && (
                    <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <MdReceipt style={{ color: colors.textSecondary, flexShrink: 0, opacity: 0.7 }} />
                      <strong>Indent:</strong> {c.indentNo}
                    </p>
                  )}
                  {c.site && (
                    <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <MdLocationOn size={14} style={{ color: colors.textSecondary, flexShrink: 0 }} />
                      <strong>Site:</strong> {c.site}
                    </p>
                  )}
                  {c.deliveryDate && (
                    <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <MdCalendarToday size={14} style={{ color: colors.textSecondary, flexShrink: 0 }} />
                      {new Date(c.deliveryDate).toLocaleDateString()}
                    </p>
                  )}
                  <p style={{ ...cardStyles.text, fontSize: "0.78rem", color: colors.textSecondary }}>
                    {c.items?.length || 0} item{(c.items?.length || 0) !== 1 ? "s" : ""}
                  </p>
                </div>

                <div style={{ ...cardStyles.buttonGroup, flexWrap: "wrap" }}>
                  <button
                    style={{ ...styles.actionBtn, ...styles.viewBtn }}
                    onClick={() => setSelectedChallan(c)}
                  >
                    <MdVisibility size={14} /> View
                  </button>
                  {permPrint && (
                    <button
                      style={{ ...styles.actionBtn, ...styles.printBtn }}
                      onClick={() => onPrint?.(c)}
                    >
                      <MdPrint size={14} /> Print
                    </button>
                  )}
                  {permPrint && (
                    <button
                      style={{ ...styles.actionBtn, ...styles.pdfBtn, opacity: exportingId ? 0.5 : 1 }}
                      disabled={!!exportingId}
                      onClick={() => onExportPdf?.(c)}
                    >
                      {exportingId === c.id + "-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />} PDF
                    </button>
                  )}
                  {permPrint && onExportExcel && (
                    <button
                      style={{ ...styles.actionBtn, ...styles.excelBtn, opacity: exportingId ? 0.5 : 1 }}
                      disabled={!!exportingId}
                      onClick={() => onExportExcel(c)}
                    >
                      {exportingId === c.id + "-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />} Excel
                    </button>
                  )}
                  {permUpdate && isEditable && (
                    <button
                      style={{ ...styles.actionBtn, ...styles.editBtn }}
                      onClick={() => onEditItems?.(c)}
                      title={c.status === "Invoiced" ? "Edit items (bill will auto-sync)" : "Edit items"}
                    >
                      <MdEdit size={14} /> Edit
                    </button>
                  )}
                  {canDuplicate && onDuplicate && (
                    <button
                      style={{
                        ...styles.actionBtn,
                        ...styles.duplicateBtn,
                        opacity: isDuplicating || duplicatingId ? 0.55 : 1,
                        cursor: isDuplicating || duplicatingId ? "not-allowed" : "pointer",
                      }}
                      // Disable the entire row's button while ANY duplicate is in
                      // flight — prevents double-clicks AND prevents starting a
                      // second duplicate before the first one finishes.
                      disabled={!!duplicatingId}
                      onClick={() => onDuplicate(c)}
                      title="Create a new billable challan with the same number for a different PO"
                    >
                      {isDuplicating ? <span className="btn-spinner" /> : <MdContentCopy size={14} />}
                      {isDuplicating ? "Duplicating…" : "Duplicate"}
                    </button>
                  )}
                  {canGenerateBill && (
                    <button
                      style={{ ...styles.actionBtn, ...styles.generateBillBtn }}
                      onClick={() => onGenerateBill?.(c)}
                      title="Open the New Bill form with this challan pre-selected"
                    >
                      <MdRequestQuote size={14} /> Generate Bill
                    </button>
                  )}
                  {permUpdate && canCancel && (
                    <button
                      style={{ ...styles.actionBtn, ...styles.cancelBtn }}
                      onClick={() => onCancel?.(c)}
                    >
                      <MdCancel size={14} /> Cancel
                    </button>
                  )}
                  {permDelete && canDelete && (
                    <button
                      style={{ ...styles.actionBtn, ...styles.deleteBtn }}
                      onClick={() => onDelete?.(c)}
                      title="Only the latest challan can be deleted — earlier ones must be edited to keep numbering gap-free."
                    >
                      <MdDelete size={14} /> Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ChallanModal challan={selectedChallan} onClose={() => setSelectedChallan(null)} />
    </>
  );
}

const styles = {
  searchWrapper: {
    position: "relative",
    marginBottom: "1.25rem",
    maxWidth: 420,
  },
  searchIcon: {
    position: "absolute",
    left: 12,
    top: "50%",
    transform: "translateY(-50%)",
    color: colors.textSecondary,
  },
  searchInput: {
    width: "100%",
    padding: "0.55rem 0.85rem 0.55rem 2.2rem",
    borderRadius: 10,
    border: `1px solid ${colors.inputBorder}`,
    backgroundColor: colors.inputBg,
    fontSize: "0.9rem",
    color: colors.textPrimary,
    outline: "none",
    transition: "border-color 0.25s, box-shadow 0.25s",
  },
  cardTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "0.5rem",
    marginBottom: "0.5rem",
  },
  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "0.72rem",
    fontWeight: 700,
    padding: "0.2rem 0.65rem",
    borderRadius: 20,
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  actionBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.3rem 0.6rem",
    borderRadius: 6,
    border: "none",
    fontSize: "0.76rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "filter 0.2s",
  },
  viewBtn: { backgroundColor: "#e3f2fd", color: "#0d47a1" },
  printBtn: { backgroundColor: "#f3e5f5", color: "#7b1fa2" },
  pdfBtn: { backgroundColor: "#ffebee", color: "#c62828" },
  excelBtn: { backgroundColor: "#e8f5e9", color: "#2e7d32" },
  editBtn: { backgroundColor: "#fff3e0", color: "#e65100" },
  cancelBtn: { backgroundColor: "#fce4ec", color: "#c62828" },
  deleteBtn: { backgroundColor: "#ffebee", color: "#b71c1c" },
  generateBillBtn: { backgroundColor: "#e0f2f1", color: "#00695c" },
  // Purple matches the "Duplicate of #N" subtitle and the DUPLICATE pill
  // so all three signals form one visual cue across the card.
  duplicateBtn: { backgroundColor: "#ede7f6", color: "#4527a0" },
  duplicateBadge: {
    backgroundColor: "#ede7f6",
    color: "#4527a0",
    border: "1px solid #4527a040",
  },
};
