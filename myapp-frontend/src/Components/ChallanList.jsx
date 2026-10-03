import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { MdReceipt, MdPerson, MdCalendarToday, MdVisibility, MdEdit, MdCancel, MdDelete, MdPrint, MdPictureAsPdf, MdGridOn, MdWarning, MdRequestQuote, MdLocationOn, MdContentCopy, MdLink, MdAssignment } from "react-icons/md";
import ChallanModal from "./ChallanModal";
import AttachmentBadge from "./AttachmentBadge";
import { usePermissions } from "../contexts/PermissionsContext";
import { Button, Card } from "../ui/Kit";

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

export default function ChallanList({ challans, onCancel, onDelete, onPrint, onEditItems, onExportPdf, onExportExcel, onGenerateBill, onDuplicate, onLinkOrder, exportingId, duplicatingId, printDisabled = false, printDisabledReason = "", attachCounts = {}, onAttach }) {
  const { has } = usePermissions();
  const permUpdate = has("challans.manage.update");
  const permDelete = has("challans.manage.delete");
  const permPrint = has("challans.print.view");
  const permCreateBill = has("bills.manage.create");
  // 2026-05-08: Duplicate is gated by its own permission so a role can
  // be allowed to spawn copies without also being granted create-from-
  // scratch. The one-time migration in Program.cs auto-grants the new
  // perm to every role that already had challans.manage.create.
  const permDuplicate = has("challans.manage.duplicate");
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
          const isDuplicate = c.duplicatedFromId != null;
          const isDuplicating = duplicatingId === c.id;
          // Delete eligibility:
          //   • Originals: only the LATEST challan (gap-free numbering rule).
          //   • Duplicates: any unbilled duplicate (they share the parent's
          //     number — deleting one doesn't create a numbering gap).
          //     2026-05-08: this carve-out matches the new server-side rule
          //     in DeliveryChallanService.DeleteAsync.
          const canDelete = canCancel && (isDuplicate || c.isLatest === true);
          const hasWarnings = c.warnings && c.warnings.length > 0;
          // Generate Bill shortcut — only for billable statuses
          // (Pending / Imported), matching the backend's CreateAsync guard.
          const canGenerateBill = permCreateBill && (c.status === "Pending" || c.status === "Imported");
          // Duplicate is available on the same statuses as Generate Bill,
          // EXCEPT duplicating-a-duplicate is not allowed (2026-05-08): the
          // original is the only canonical row, and the new "create N copies"
          // dialog removes any reason to duplicate-the-duplicate as a workaround.
          // Permission gate: challans.manage.duplicate (split off from
          // .create on 2026-05-08).
          const canDuplicate = permDuplicate
            && !isDuplicate
            && (c.status === "Pending" || c.status === "Imported");
          // Link to a Sales Order — only "No PO" challans (a delivery raised
          // before the PO arrived). A Pending challan already carries its own
          // PO, so it isn't part of the attach-to-order flow.
          const canLink = onLinkOrder && c.status === "No PO" && !c.salesOrderId && !c.invoiceId;
          return (
            <Card key={c.id} style={styles.card}>
              <div style={styles.cardContent}>
                <div>
                  <div style={styles.cardTopRow}>
                    <h5 style={styles.title}>
                      <MdReceipt style={{ color: "var(--k-blue)", marginRight: 6, verticalAlign: "middle" }} />
                      Challan #{c.challanNumber}
                    </h5>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <AttachmentBadge count={attachCounts?.[c.id]} onClick={() => onAttach?.(c)} />
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
                      ...styles.text,
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
                  <p style={styles.line}>
                    <MdPerson style={{ color: "var(--k-teal)", flexShrink: 0 }} />
                    <span style={styles.clamp}><strong>Client:</strong> {c.clientName}</span>
                  </p>
                  <p style={styles.line}>
                    <MdReceipt style={{ color: "var(--k-muted)", flexShrink: 0 }} />
                    <strong>PO:</strong> {c.poNumber || "—"}
                  </p>
                  {c.salesOrderNumber && (
                    <p style={{ ...styles.line, color: "var(--k-blue)", fontWeight: 600 }}>
                      <MdAssignment size={14} style={{ flexShrink: 0 }} />
                      <strong>SO #{c.salesOrderNumber}</strong>
                    </p>
                  )}
                  {/* Indent No + Site — surfaced on the card so the
                      operator can scan a list and see "is this the
                      Soorty PO for Unit-2?" without having to open the
                      view modal. Both fields are optional; only render
                      when set so unfilled cards don't get noise. */}
                  {c.indentNo && (
                    <p style={styles.line}>
                      <MdReceipt style={{ color: "var(--k-muted)", flexShrink: 0, opacity: 0.7 }} />
                      <strong>Indent:</strong> {c.indentNo}
                    </p>
                  )}
                  {c.site && (
                    <p style={styles.line}>
                      <MdLocationOn size={14} style={{ color: "var(--k-muted)", flexShrink: 0 }} />
                      <strong>Site:</strong> {c.site}
                    </p>
                  )}
                  {c.deliveryDate && (
                    <p style={styles.line}>
                      <MdCalendarToday size={14} style={{ color: "var(--k-muted)", flexShrink: 0 }} />
                      {new Date(c.deliveryDate).toLocaleDateString()}
                    </p>
                  )}
                  <p style={{ ...styles.text, fontSize: "0.78rem", color: "var(--k-muted)" }}>
                    {c.items?.length || 0} item{(c.items?.length || 0) !== 1 ? "s" : ""}
                  </p>
                </div>

                <div style={styles.buttonGroup}>
                  <Button size="sm" icon={MdVisibility} style={styles.viewBtn} onClick={() => setSelectedChallan(c)}>
                    View
                  </Button>
                  {permPrint && (
                    <Button
                      size="sm"
                      icon={MdPrint}
                      style={styles.printBtn}
                      disabled={printDisabled}
                      onClick={() => onPrint?.(c)}
                      title={printDisabled ? printDisabledReason : "Print"}
                    >
                      Print
                    </Button>
                  )}
                  {permPrint && (
                    <Button
                      size="sm"
                      style={styles.pdfBtn}
                      disabled={printDisabled || !!exportingId}
                      onClick={() => onExportPdf?.(c)}
                      title={printDisabled ? printDisabledReason : "Export PDF"}
                    >
                      {exportingId === c.id + "-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />} PDF
                    </Button>
                  )}
                  {permPrint && onExportExcel && (
                    <Button
                      size="sm"
                      style={styles.excelBtn}
                      disabled={!!exportingId}
                      onClick={() => onExportExcel(c)}
                    >
                      {exportingId === c.id + "-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />} Excel
                    </Button>
                  )}
                  {permUpdate && isEditable && (
                    <Button
                      size="sm"
                      icon={MdEdit}
                      style={styles.editBtn}
                      onClick={() => onEditItems?.(c)}
                      title={c.status === "Invoiced" ? "Edit items (bill will auto-sync)" : "Edit items"}
                    >
                      Edit
                    </Button>
                  )}
                  {canDuplicate && onDuplicate && (
                    <Button
                      size="sm"
                      style={styles.duplicateBtn}
                      // Disable the entire row's button while ANY duplicate is in
                      // flight — prevents double-clicks AND prevents starting a
                      // second duplicate before the first one finishes.
                      disabled={!!duplicatingId}
                      onClick={() => onDuplicate(c)}
                      title="Create a new billable challan with the same number for a different PO"
                    >
                      {isDuplicating ? <span className="btn-spinner" /> : <MdContentCopy size={14} />}
                      {isDuplicating ? "Duplicating…" : "Duplicate"}
                    </Button>
                  )}
                  {canGenerateBill && (
                    <Button
                      size="sm"
                      icon={MdRequestQuote}
                      style={styles.generateBillBtn}
                      onClick={() => onGenerateBill?.(c)}
                      title="Open the New Bill form with this challan pre-selected"
                    >
                      Generate Bill
                    </Button>
                  )}
                  {canLink && (
                    <Button
                      size="sm"
                      icon={MdLink}
                      style={styles.linkBtn}
                      onClick={() => onLinkOrder?.(c)}
                      title="Link this challan to a Sales Order"
                    >
                      Link to Order
                    </Button>
                  )}
                  {permUpdate && canCancel && (
                    <Button size="sm" icon={MdCancel} style={styles.cancelBtn} onClick={() => onCancel?.(c)}>
                      Cancel
                    </Button>
                  )}
                  {permDelete && canDelete && (
                    <Button
                      size="sm"
                      icon={MdDelete}
                      style={styles.deleteBtn}
                      onClick={() => onDelete?.(c)}
                      title={isDuplicate
                        ? "Delete this duplicate. The original challan keeps the same number — no gap."
                        : "Only the latest challan can be deleted — earlier ones must be edited to keep numbering gap-free."}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <ChallanModal challan={selectedChallan} onClose={() => setSelectedChallan(null)} />
    </>
  );
}

// Tinted action buttons: each action keeps its own colour family so operators
// can scan a card's actions by colour; the kit Button supplies size + shape.
const tint = (backgroundColor, color) => ({ backgroundColor, color, borderColor: "transparent" });

const styles = {
  card: { marginTop: 0, overflow: "hidden" },
  cardContent: { display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" },
  title: { fontSize: "calc(var(--k-font) + 0.2rem)", fontWeight: 800, margin: "0 0 0.5rem", color: "var(--k-ink)", letterSpacing: "-0.01em" },
  text: { fontSize: "var(--k-font)", color: "var(--k-muted)", margin: "0 0 0.2rem", lineHeight: 1.5 },
  line: { fontSize: "var(--k-font)", color: "var(--k-muted)", margin: "0 0 0.2rem", lineHeight: 1.5, display: "flex", alignItems: "center", gap: "0.4rem" },
  // Client names are user-supplied — clamp to two lines, never nowrap+ellipsis.
  clamp: { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minWidth: 0 },
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
  buttonGroup: { display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem", paddingTop: "0.9rem", borderTop: "1px solid var(--k-line)" },
  viewBtn: tint("#e3f2fd", "#0d47a1"),
  printBtn: tint("#f3e5f5", "#7b1fa2"),
  pdfBtn: tint("#ffebee", "#c62828"),
  excelBtn: tint("#e8f5e9", "#2e7d32"),
  editBtn: tint("#fff3e0", "#e65100"),
  cancelBtn: tint("#fce4ec", "#c62828"),
  deleteBtn: tint("#ffebee", "#b71c1c"),
  generateBillBtn: tint("#e0f2f1", "#00695c"),
  linkBtn: tint("#e3f2fd", "#0d47a1"),
  // Purple matches the "Duplicate of #N" subtitle and the DUPLICATE pill
  // so all three signals form one visual cue across the card.
  duplicateBtn: tint("#ede7f6", "#4527a0"),
  duplicateBadge: {
    backgroundColor: "#ede7f6",
    color: "#4527a0",
    border: "1px solid #4527a040",
  },
};
