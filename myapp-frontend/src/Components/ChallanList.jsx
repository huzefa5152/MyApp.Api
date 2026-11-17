import CostingStatus from "./CostingStatus";
import { canEditBilledDelivery } from "../utils/billedChallanEdit";
import { isBillableChallan } from "../utils/challanBilling";
import CardActions from "./CardActions";
import "../pages/InvoiceCardActions.css";
import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  MdReceipt,
  MdVisibility,
  MdEdit,
  MdCancel,
  MdDelete,
  MdPrint,
  MdPictureAsPdf,
  MdGridOn,
  MdWarning,
  MdRequestQuote,
  MdContentCopy,
  MdLink,
} from "react-icons/md";
import ChallanModal from "./ChallanModal";
import AttachmentBadge from "./AttachmentBadge";
import { usePermissions } from "../contexts/PermissionsContext";
import { Button, Card } from "../ui/Kit";

const statusColors = {
  Pending: { bg: "var(--k-warn-bg)", color: "var(--k-warn)" },
  // Imported = historical back-fill, billable same as Pending.
  // Purple tint so operators can tell at a glance which rows came from import.
  Imported: { bg: "var(--k-purple-bg-2)", color: "var(--k-purple-3)" },
  "No PO": { bg: "var(--k-info-bg)", color: "var(--k-blue)" },
  Invoiced: { bg: "var(--k-success-bg)", color: "var(--k-success)" },
  Cancelled: { bg: "var(--k-danger-bg-2)", color: "var(--k-danger)" },
  "Setup Required": { bg: "var(--k-danger-bg-2)", color: "var(--k-danger-ink)" },
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
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      style={{
        color: "var(--k-warn)",
        cursor: "help",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <MdWarning size={18} />
      {pos &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              zIndex: 9999,
              minWidth: 240,
              maxWidth: 320,
              padding: "0.6rem 0.75rem",
              background: "var(--k-surface)",
              border: "1px solid var(--k-warn)",
              borderRadius: "var(--k-radius)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
              color: "var(--k-ink)",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                marginBottom: 4,
                fontSize: "var(--k-fs-xs)",
                color: "var(--k-warn)",
              }}
            >
              FBR Setup Required
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: "1.1rem",
                fontSize: "var(--k-fs-xs)",
                lineHeight: 1.6,
              }}
            >
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </span>
  );
}

export default function ChallanList({
  challans,
  onCancel,
  onDelete,
  onPrint,
  onCosts,
  onLocalPurchase,
  onEditItems,
  onEditDelivery,
  onExportPdf,
  onExportExcel,
  onGenerateBill,
  onDuplicate,
  onLinkOrder,
  exportingId,
  duplicatingId,
  printDisabled = false,
  printDisabledReason = "",
  attachCounts = {},
  onAttach,
}) {
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
          // Billed row of a challan whose other lines are still pending: its
          // status reads "Partially billed", not "Billed".
          // The row with the unbilled rest reads "Pending · rest of #N".
          const partlyBilled = c.isPartiallyBilled && c.status === "Invoiced";
          const restOf = c.isPartiallyBilled && c.status !== "Invoiced";
          const sc =
            partlyBilled || restOf
              ? { bg: "var(--k-warn-bg-2)", color: "var(--k-warn-ink-3)" }
              : statusColors[c.status] || statusColors.Pending;
          // Backend now sends `isEditable` — use it so billed-but-not-FBR-submitted challans can also be edited
          const isEditable =
            c.isEditable ??
            (c.status === "Pending" ||
              c.status === "Imported" ||
              c.status === "No PO" ||
              c.status === "Setup Required");
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
          // A row split off a partial bill shares its number like a duplicate.
          const canDelete =
            canCancel && (isDuplicate || c.splitFromChallanId != null || c.isLatest === true);
          const hasWarnings = c.warnings && c.warnings.length > 0;
          // Generate Bill shortcut — only for billable statuses
          // (Pending / Imported), matching the backend's CreateAsync guard.
          const canGenerateBill = permCreateBill && isBillableChallan(c);
          // Duplicate is available on the same statuses as Generate Bill,
          // EXCEPT duplicating-a-duplicate is not allowed (2026-05-08): the
          // original is the only canonical row, and the new "create N copies"
          // dialog removes any reason to duplicate-the-duplicate as a workaround.
          // Permission gate: challans.manage.duplicate (split off from
          // .create on 2026-05-08).
          const canDuplicate =
            permDuplicate && !isDuplicate && (c.status === "Pending" || c.status === "Imported");
          // Link to a Sales Order — only "No PO" challans (a delivery raised
          // before the PO arrived). A Pending challan already carries its own
          // PO, so it isn't part of the attach-to-order flow.
          const canLink = onLinkOrder && c.status === "No PO" && !c.salesOrderId && !c.invoiceId;
          return (
            <Card key={c.id} style={styles.card}>
              <div style={styles.cardContent}>
                <div>
                  <div className="doc-card-head">
                    <h5 style={styles.title}>
                      <MdReceipt
                        style={{ color: "var(--k-blue)", marginRight: 6, verticalAlign: "middle" }}
                      />
                      Challan #{c.challanNumber}
                    </h5>
                    <div className="doc-card-pills">
                      <AttachmentBadge count={attachCounts?.[c.id]} onClick={() => onAttach?.(c)} />
                      {hasWarnings && <WarningTooltip warnings={c.warnings} />}
                      {/* DUPLICATE pill — shown when this row was created via
                          the Duplicate action, so operators can tell at a
                          glance which rows share a challan number with a
                          sibling. Title shows the parent's number. */}
                      {isDuplicate && (
                        <span
                          style={{ ...styles.statusBadge, ...styles.duplicateBadge }}
                          title={
                            c.duplicatedFromChallanNumber
                              ? `Duplicate of Challan #${c.duplicatedFromChallanNumber} — separate billable copy`
                              : "Duplicate — separate billable copy of an earlier challan"
                          }
                        >
                          <MdContentCopy size={11} style={{ marginRight: 3 }} />
                          DUPLICATE
                        </span>
                      )}
                      <span
                        style={{
                          ...styles.statusBadge,
                          backgroundColor: sc.bg,
                          color: sc.color,
                          // The border is the tag's own colour, faded, so it follows every theme.
                          border: `1px solid color-mix(in srgb, ${sc.color} 25%, transparent)`,
                        }}
                      >
                        {partlyBilled
                          ? "Partially billed"
                          : restOf
                            ? `${c.status} · rest of #${c.challanNumber}`
                            : c.status === "Invoiced"
                              ? "Billed"
                              : c.status}
                      </span>
                      {/* Which bill it went onto. */}
                      {c.invoiceNumber != null && (
                        <span
                          style={{
                            fontSize: "var(--k-fs-2xs)",
                            color: "var(--k-muted)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Bill #{c.invoiceNumber}
                        </span>
                      )}
                    </div>
                  </div>

                  {onCosts && (
                    <div style={{ margin: "8px 0" }}>
                      <CostingStatus document={c} onOpen={() => onCosts(c)} />
                    </div>
                  )}
                  {/* Client first, then one quiet line for date and items, then the
                      references the operator scans for (PO, order, indent, site). */}
                  <p className="doc-card-lead">{c.clientName}</p>
                  <div className="inv-card-meta">
                    {c.deliveryDate && <span>{new Date(c.deliveryDate).toLocaleDateString()}</span>}
                    <span>
                      {c.items?.length || 0} item{(c.items?.length || 0) !== 1 ? "s" : ""}
                    </span>
                    {isDuplicate && c.duplicatedFromChallanNumber && (
                      <span style={{ color: "var(--k-purple-3)", fontWeight: 600 }}>
                        Copy of #{c.duplicatedFromChallanNumber}
                      </span>
                    )}
                  </div>
                  <div className="inv-card-refs">
                    <span>
                      <b>PO</b> {c.poNumber || "—"}
                    </span>
                    {c.salesOrderNumber && (
                      <span style={{ color: "var(--k-blue)" }}>
                        <b>SO</b> #{c.salesOrderNumber}
                      </span>
                    )}
                    {c.indentNo && (
                      <span>
                        <b>Indent</b> {c.indentNo}
                      </span>
                    )}
                    {c.site && (
                      <span>
                        <b>Site</b> {c.site}
                      </span>
                    )}
                  </div>
                </div>

                <CardActions className="invoice-card-actions" style={styles.buttonGroup}>
                  <Button
                    data-primary
                    size="sm"
                    icon={MdVisibility}
                    style={styles.viewBtn}
                    onClick={() => setSelectedChallan(c)}
                  >
                    View
                  </Button>
                  {permPrint && (
                    <Button
                      data-primary
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
                      {exportingId === c.id + "-pdf" ? (
                        <span className="btn-spinner" />
                      ) : (
                        <MdPictureAsPdf size={14} />
                      )}{" "}
                      PDF
                    </Button>
                  )}
                  {permPrint && onExportExcel && (
                    <Button
                      size="sm"
                      style={styles.excelBtn}
                      disabled={!!exportingId}
                      onClick={() => onExportExcel(c)}
                    >
                      {exportingId === c.id + "-excel" ? (
                        <span className="btn-spinner" />
                      ) : (
                        <MdGridOn size={14} />
                      )}{" "}
                      Excel
                    </Button>
                  )}
                  {onLocalPurchase && c.status !== "Cancelled" && (
                    <Button size="sm" onClick={() => onLocalPurchase(c)}>
                      Local purchase
                    </Button>
                  )}
                  {permUpdate && isEditable && !c.invoiceId && (
                    <Button
                      size="sm"
                      icon={MdEdit}
                      style={styles.editBtn}
                      onClick={() => onEditItems?.(c)}
                      title={
                        c.invoiceId || c.status === "Invoiced"
                          ? "Edit supplier & cost"
                          : "Edit items"
                      }
                    >
                      {c.invoiceId || c.status === "Invoiced" ? "Supplier & cost" : "Edit"}
                    </Button>
                  )}
                  {onEditDelivery && canEditBilledDelivery(c, has) && (
                    <Button
                      size="sm"
                      icon={MdEdit}
                      style={styles.editBtn}
                      onClick={() => onEditDelivery(c)}
                    >
                      Edit delivery & update bill
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
                      {isDuplicating ? (
                        <span className="btn-spinner" />
                      ) : (
                        <MdContentCopy size={14} />
                      )}
                      {isDuplicating ? "Duplicating…" : "Duplicate"}
                    </Button>
                  )}
                  {canGenerateBill && (
                    <Button
                      data-primary
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
                    <Button
                      size="sm"
                      icon={MdCancel}
                      style={styles.cancelBtn}
                      onClick={() => onCancel?.(c)}
                    >
                      Cancel
                    </Button>
                  )}
                  {permDelete && canDelete && (
                    <Button
                      size="sm"
                      icon={MdDelete}
                      style={styles.deleteBtn}
                      onClick={() => onDelete?.(c)}
                      title={
                        isDuplicate
                          ? "Delete this duplicate. The original challan keeps the same number — no gap."
                          : "Only the latest challan can be deleted — earlier ones must be edited to keep numbering gap-free."
                      }
                    >
                      Delete
                    </Button>
                  )}
                </CardActions>
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
  cardContent: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    height: "100%",
  },
  title: {
    fontSize: "var(--k-fs-md)",
    fontWeight: 800,
    margin: "0 0 0.5rem",
    color: "var(--k-ink)",
    letterSpacing: "-0.01em",
  },
  // Client names are user-supplied — clamp to two lines, never nowrap+ellipsis.
  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "var(--k-fs-2xs)",
    fontWeight: 700,
    padding: "0.2rem 0.65rem",
    borderRadius: "var(--k-r-xl)",
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  buttonGroup: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    marginTop: "1rem",
    paddingTop: "0.9rem",
    borderTop: "1px solid var(--k-line)",
  },
  viewBtn: tint("var(--k-info-bg)", "var(--k-blue)"),
  printBtn: tint("var(--k-purple-bg-2)", "var(--k-purple-2)"),
  pdfBtn: tint("var(--k-danger-bg-2)", "var(--k-danger-ink)"),
  excelBtn: tint("var(--k-success-bg)", "var(--k-success)"),
  editBtn: tint("var(--k-warn-bg)", "var(--k-warn)"),
  cancelBtn: tint("var(--k-danger-bg-2)", "var(--k-danger-ink)"),
  deleteBtn: tint("var(--k-danger-bg-2)", "var(--k-danger-ink-2)"),
  generateBillBtn: tint("var(--k-teal-bg)", "var(--k-teal-ink)"),
  linkBtn: tint("var(--k-info-bg)", "var(--k-blue)"),
  // Purple matches the "Duplicate of #N" subtitle and the DUPLICATE pill
  // so all three signals form one visual cue across the card.
  duplicateBtn: tint("var(--k-purple-bg)", "var(--k-purple)"),
  duplicateBadge: {
    backgroundColor: "var(--k-purple-bg)",
    color: "var(--k-purple)",
    border: "1px solid color-mix(in srgb, var(--k-purple) 25%, transparent)",
  },
};
