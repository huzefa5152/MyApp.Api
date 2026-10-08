import { useNavigate } from "react-router-dom";
import {
  MdVisibility, MdPrint, MdPictureAsPdf, MdGridOn, MdDescription,
  MdCloudUpload, MdCheckCircle, MdHourglassEmpty, MdError, MdBlock, MdRestore,
  MdEdit, MdDelete, MdOpenInNew, MdCancel, MdUndo, MdPostAdd, MdAssignmentTurnedIn,
} from "react-icons/md";
import DataTable from "./DataTable";
import StatusBadge from "./StatusBadge";
import PaymentStatusBadge from "./PaymentStatusBadge";
import AttachmentBadge from "./AttachmentBadge";
import { IconButton } from "../ui/Kit";

// Renders the FBR-status pill in compact form for the table.
function fbrStatusBadge(inv, isBillsMode) {
  if (inv.isCancelled) {
    return (
      <StatusBadge tone="danger" title={inv.cancelReason ? `Cancelled — ${inv.cancelReason}` : "This bill has been cancelled (voided)"}>
        Cancelled
      </StatusBadge>
    );
  }
  if (inv.fbrStatus === "Submitted") {
    return (
      <StatusBadge tone="submitted" title={inv.fbrIRN ? `IRN: ${inv.fbrIRN}` : undefined}>
        {isBillsMode ? "Submitted" : "FBR Submitted"}
      </StatusBadge>
    );
  }
  if (inv.fbrStatus === "Submitting") {
    return <StatusBadge tone="info" title="A submission is in progress. Please wait and refresh — do not submit again.">Submitting…</StatusBadge>;
  }
  if (inv.fbrStatus === "Uncertain") {
    return <StatusBadge tone="warning" title="A previous submission timed out — its FBR outcome is unconfirmed. An administrator must verify it at FBR and reset it.">Uncertain</StatusBadge>;
  }
  if (inv.fbrReviewRequired) return <StatusBadge tone="warning" title="Next: consultant opens Invoices, reviews every current item and completes review. FBR validation and submission are blocked.">Needs consultant review</StatusBadge>;
  if (isBillsMode) {
    return <StatusBadge tone="warning">Pending FBR</StatusBadge>;
  }
  if (inv.fbrStatus === "Failed") {
    return <StatusBadge tone="danger" title={inv.fbrErrorMessage || "FBR rejected this submission"}>FBR Failed</StatusBadge>;
  }
  if (inv.isFbrExcluded) {
    return <StatusBadge tone="excluded" title="Excluded from FBR bulk actions">Excluded</StatusBadge>;
  }
  if (!inv.fbrReady) {
    const missing = inv.fbrMissing?.length ? `Missing:\n• ${inv.fbrMissing.join("\n• ")}` : "";
    return <StatusBadge tone="setup" title={missing}>Setup Incomplete</StatusBadge>;
  }
  return <StatusBadge tone="ready">Ready</StatusBadge>;
}

// Customer document-handover badge (Invoices / Notes). Separate concern from
// the FBR badge: "were the printed customer copies handed over?". "—" for
// non-submitted / cancelled / demo rows (derived server-side as NotApplicable).
function handoverBadge(inv) {
  if (inv.handoverStatus === "Delivered") {
    const when = inv.handoverAt ? new Date(inv.handoverAt).toLocaleDateString() : "";
    const who = inv.handoverByName ? ` by ${inv.handoverByName}` : " (migrated)";
    const remark = inv.handoverRemark ? ` — ${inv.handoverRemark}` : "";
    return <StatusBadge tone="submitted" title={`Handed over${when ? ` on ${when}` : ""}${who}${remark}`}>Delivered</StatusBadge>;
  }
  if (inv.handoverStatus === "Pending") {
    return <StatusBadge tone="warning" title="Submitted to FBR but the printed customer copies have not been marked handed over yet.">Pending</StatusBadge>;
  }
  return <span style={{ color: "var(--k-faint)" }}>—</span>;
}

export default function InvoiceTable({
  invoices,
  isBillsMode,
  // Note tabs — rows are Credit Notes or Debit Notes in their own
  // numbering sequences; number column reads "Credit Note # / Debit Note #".
  isReturnsMode = false,
  noteDocType = null,
  perms,
  hasExcelBill,
  hasExcelTax,
  selectedCompanyHasFbrToken,
  fbrValidated,
  fbrLoading,
  exportingId,
  printDisabled = false,
  printDisabledReason = "",
  attachCounts = {},
  onAttach,
  // Gates the payment-status (AR) column — driven by accounting.paymentstatus.view.
  showPaymentStatus = false,
  // handlers (parent owns them; we just call them)
  onView,
  onPrintBill,
  onPrintTax,
  onExportBillPdf,
  onExportBillExcel,
  onExportTaxPdf,
  onExportTaxExcel,
  onFbrPreview,
  onFbrValidate,
  onFbrSubmit,
  onFbrReset,
  onEdit,
  onCreateOrderFromBill, creatingOrderFor,
  onToggleFbrExcluded,
  onDelete,
  onVoid,
  onReverse,
  onCorrect,
  onMarkHandover,
  onRevertHandover,
}) {
  const navigate = useNavigate();

  const columns = [
    {
      key: "invoiceNumber",
      header: isReturnsMode ? (noteDocType === 10 ? "Credit Note #" : "Debit Note #") : isBillsMode ? "Bill #" : "Invoice #",
      width: 130,
      accessor: (i) => Number(i.invoiceNumber) || i.invoiceNumber,
      render: (i) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <strong>{i.invoiceNumber}</strong>
            <AttachmentBadge count={attachCounts?.[i.id]} onClick={() => onAttach?.(i)} />
          </div>
          {(i.documentType === 9 || i.documentType === 10) && (
            <span
              style={{
                fontSize: 10, fontWeight: 700, lineHeight: 1.2,
                color: i.documentType === 10 ? "#5e35b1" : "#00695c",
              }}
              title={i.originalInvoiceNumber ? `Against bill #${i.originalInvoiceNumber}${i.originalInvoiceRefIRN ? ` (IRN ${i.originalInvoiceRefIRN})` : ""}` : undefined}
            >
              {i.documentType === 10 ? "CREDIT NOTE" : "DEBIT NOTE"}
              {i.originalInvoiceNumber ? ` ↩ #${i.originalInvoiceNumber}` : ""}
            </span>
          )}
          {i.documentType !== 9 && i.documentType !== 10 && i.fbrCancelledAt && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 3, alignSelf: "flex-start",
                fontSize: 10, fontWeight: 700, lineHeight: 1.2, padding: "2px 6px",
                borderRadius: 6, background: "#f9dedc", color: "#b3261e", border: "1px solid #f2b8b5",
              }}
              title={`Cancelled on the FBR portal on ${new Date(i.fbrCancelledAt).toLocaleDateString()}`
                + (i.fbrCancelledReason ? ` — ${i.fbrCancelledReason}` : "")
                + ". The bill keeps its number and IRN but no longer counts as a sale."}
            >
              <MdBlock size={11} /> FBR CANCELLED
            </span>
          )}
          {i.documentType !== 9 && i.documentType !== 10 && i.reversedByCreditNoteNumber && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 3, alignSelf: "flex-start",
                fontSize: 10, fontWeight: 700, lineHeight: 1.2, padding: "2px 6px",
                borderRadius: 6, background: "#ede7f6", color: "#5e35b1", border: "1px solid #b39ddb",
              }}
              title={`A Credit Note (#${i.reversedByCreditNoteNumber}) has been created against this invoice — it reverses this sale.`}
            >
              <MdUndo size={11} /> REVERSED · CN #{i.reversedByCreditNoteNumber}
            </span>
          )}
          {i.documentType !== 9 && i.documentType !== 10 && i.adjustedByDebitNoteNumber && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 3, alignSelf: "flex-start",
                fontSize: 10, fontWeight: 700, lineHeight: 1.2, padding: "2px 6px",
                borderRadius: 6, background: "#e0f2f1", color: "#00695c", border: "1px solid #80cbc4",
              }}
              title={`A Debit Note (#${i.adjustedByDebitNoteNumber}) adjusts this invoice upward.`}
            >
              <MdUndo size={11} /> ADJUSTED · DN #{i.adjustedByDebitNoteNumber}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "clientName",
      header: "Client",
      render: (i) => i.clientName || "—",
    },
    // Returns tab only: which invoice the note reverses + the FBR reason.
    ...(isReturnsMode ? [{
      key: "against",
      header: "Against / Reason",
      render: (i) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            Bill #{i.originalInvoiceNumber ?? "—"}
          </div>
          <div style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)" }} title={i.noteReasonRemarks || undefined}>
            {i.noteReason || "—"}
          </div>
        </div>
      ),
    }] : []),
    {
      key: "poNumber",
      header: "PO",
      defaultHidden: true,
      render: (i) => i.poNumber || "—",
    },
    {
      key: "indentNo",
      header: "Indent",
      defaultHidden: true,
      render: (i) => i.indentNo || "—",
    },
    {
      key: "challanNumbers",
      header: "DC #",
      width: 120,
      accessor: (i) => (i.challanNumbers || []).join(","),
      render: (i) => (i.challanNumbers && i.challanNumbers.length > 0
        ? `#${i.challanNumbers.join(", #")}`
        : "—"),
    },
    {
      key: "date",
      header: "Date",
      width: 110,
      accessor: (i) => i.date ? new Date(i.date).getTime() : 0,
      render: (i) => i.date ? new Date(i.date).toLocaleDateString() : "—",
    },
    {
      key: "items",
      header: "Lines",
      width: 70,
      align: "right",
      accessor: (i) => i.items?.length || 0,
      render: (i) => i.items?.length || 0,
    },
    {
      key: "grandTotal",
      header: "Grand Total",
      width: 140,
      align: "right",
      accessor: (i) => i.grandTotal || 0,
      render: (i) => `Rs. ${(i.grandTotal ?? 0).toLocaleString()}`,
    },
    {
      key: "fbrStatus",
      header: isBillsMode ? "FBR" : "FBR Status",
      width: 140,
      accessor: (i) => i.fbrStatus || "",
      render: (i) => fbrStatusBadge(i, isBillsMode),
    },
    // Customer document handover — Invoices + Notes only (not the pre-FBR
    // Bills tab). Its own column; answers a different question than FBR status.
    ...(!isBillsMode ? [{
      key: "handoverStatus",
      header: "Documents",
      width: 130,
      accessor: (i) => i.handoverStatus || "",
      render: (i) => handoverBadge(i),
    }] : []),
    // Payment status (AR) — gated by permission; not shown on the note tabs.
    ...(showPaymentStatus && !isReturnsMode ? [{
      key: "paymentStatus",
      header: "Payment",
      width: 150,
      accessor: (i) => i.paymentStatus || "",
      render: (i) => (i.isCancelled || !i.paymentStatus)
        ? "—"
        : <PaymentStatusBadge status={i.paymentStatus} balanceDue={i.balanceDue} daysOverdue={i.daysOverdue} />,
    }] : []),
  ];

  const renderActions = (inv) => {
    const isSubmitted = inv.fbrStatus === "Submitted";
    // A bill mid-submit ("Submitting") or with an unconfirmed outcome
    // ("Uncertain") is NOT submittable — the server refuses it, so we must not
    // offer Validate/Submit. It can only be moved on via the admin Reset action.
    const isFbrPending = inv.fbrStatus === "Submitting" || inv.fbrStatus === "Uncertain";
    const canReset = !!perms?.canFbrReset && isFbrPending;
    return (
      <>
        {isBillsMode && (
          <IconButton style={btn.view} onClick={() => onView?.(inv)} label="View bill">
            <MdVisibility size={14} />
          </IconButton>
        )}
        {isBillsMode && (
          <IconButton
            style={btn.teal}
            onClick={() => navigate(`/invoices?search=${encodeURIComponent(inv.invoiceNumber)}`)}
            label="Open this bill on the Invoices tab"
          >
            <MdOpenInNew size={14} />
          </IconButton>
        )}
        {isBillsMode && perms.canPrint && (
          <IconButton
            style={{ ...btn.print }}
            disabled={printDisabled}
            onClick={() => onPrintBill?.(inv)}
            label={printDisabled ? printDisabledReason : "Print bill"}
          >
            <MdPrint size={14} />
          </IconButton>
        )}
        {!isBillsMode && perms.canPrint && (
          <IconButton
            style={{ ...btn.tax }}
            disabled={printDisabled}
            onClick={() => onPrintTax?.(inv)}
            label={printDisabled ? printDisabledReason : "Print tax invoice"}
          >
            <MdDescription size={14} />
          </IconButton>
        )}
        {isBillsMode && perms.canPrint && (
          <IconButton
            style={{ ...btn.pdf }}
            disabled={printDisabled || !!exportingId}
            onClick={() => onExportBillPdf?.(inv)}
            label={printDisabled ? printDisabledReason : "Export Bill PDF"}
          >
            {exportingId === inv.id + "-bill-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />}
          </IconButton>
        )}
        {!isBillsMode && perms.canPrint && (
          <IconButton
            style={{ ...btn.pdf }}
            disabled={printDisabled || !!exportingId}
            onClick={() => onExportTaxPdf?.(inv)}
            label={printDisabled ? printDisabledReason : "Export Tax Invoice PDF"}
          >
            {exportingId === inv.id + "-tax-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />}
          </IconButton>
        )}
        {isBillsMode && perms.canPrint && hasExcelBill && (
          <IconButton
            style={{ ...btn.excel }}
            disabled={!!exportingId}
            onClick={() => onExportBillExcel?.(inv)}
            label="Export Bill XLS"
          >
            {exportingId === inv.id + "-bill-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />}
          </IconButton>
        )}
        {!isBillsMode && perms.canPrint && hasExcelTax && (
          <IconButton
            style={{ ...btn.excel }}
            disabled={!!exportingId}
            onClick={() => onExportTaxExcel?.(inv)}
            label="Export Tax Invoice XLS"
          >
            {exportingId === inv.id + "-tax-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />}
          </IconButton>
        )}
        {!isBillsMode && perms.canFbrPreview && (
          <IconButton style={btn.view} onClick={() => onFbrPreview?.(inv)} label="Preview FBR payload">
            <MdVisibility size={14} />
          </IconButton>
        )}
        {!isBillsMode && canReset && (
          <IconButton
            style={{ ...btn.neutral, backgroundColor: "#fff8e1", color: "#8a6d00", border: "1px solid #ffe082" }}
            onClick={() => onFbrReset?.(inv)}
            label="Reset this bill's FBR state (it is stuck after a timed-out/uncertain submit). Verify at FBR first."
          >
            <MdRestore size={14} />
          </IconButton>
        )}
        {!isBillsMode && perms.canFbrAny && selectedCompanyHasFbrToken && inv.fbrReady && !isSubmitted && !isFbrPending && !inv.isCancelled && (
          <>
            {perms.canFbrValidate && (
              <IconButton
                style={{
                  ...btn.fbrValidate,
                  ...(fbrValidated.has(inv.id) ? { backgroundColor: "#e8f5e9", color: "#2e7d32" } : {}),
                }}
                disabled={!!fbrLoading || !inv.fbrReady}
                onClick={() => onFbrValidate?.(inv)}
                label={
                  !inv.fbrReady
                    ? `Complete FBR setup first:\n• ${inv.fbrMissing?.join("\n• ") || "Missing FBR fields"}`
                    : "Validate this bill with FBR (dry-run)"
                }
              >
                {fbrLoading === inv.id + "-validate" ? <span className="btn-spinner" /> : <MdCheckCircle size={14} />}
              </IconButton>
            )}
            {perms.canFbrSubmit && (
              <IconButton
                style={btn.fbrSubmit}
                disabled={!!fbrLoading || !fbrValidated.has(inv.id) || !inv.fbrReady}
                onClick={() => onFbrSubmit?.(inv)}
                label={
                  !inv.fbrReady ? "Complete FBR setup first."
                    : fbrValidated.has(inv.id) ? "Submit to FBR"
                    : "Validate first before submitting."
                }
              >
                {fbrLoading === inv.id + "-submit" ? <span className="btn-spinner" /> : <MdCloudUpload size={14} />}
              </IconButton>
            )}
          </>
        )}
        {isBillsMode && perms.canCreateOrderFromBill && inv.canCreateSalesOrder && <button style={btn.edit} disabled={!!creatingOrderFor} onClick={() => onCreateOrderFromBill?.(inv)}>Create sales order</button>}
        {isBillsMode && perms.canViewOrders && inv.salesOrders?.map(o => <button key={o.id} style={btn.edit} onClick={() => navigate(`/sales-orders?viewOrder=${o.id}`)}>Order #{o.number || o.id}</button>)}
        {perms.canOpenEdit && inv.isEditable && (
          <IconButton
            style={btn.edit}
            onClick={() => onEdit?.(inv)}
            label={isBillsMode ? "Edit bill" : inv.fbrReviewRequired ? "Review changed bill and complete consultant review" : "Adjust invoice for FBR"}
          >
            <MdEdit size={14} />
          </IconButton>
        )}
        {!isBillsMode && perms.canFbrExclude && !isSubmitted && !inv.isCancelled && (
          <IconButton
            style={{
              ...btn.neutral,
              backgroundColor: inv.isFbrExcluded ? "#e8f5e9" : "#eceff1",
              color: inv.isFbrExcluded ? "#2e7d32" : "#546e7a",
              border: `1px solid ${inv.isFbrExcluded ? "#a5d6a7" : "#b0bec5"}`,
            }}
            onClick={() => onToggleFbrExcluded?.(inv)}
            label={inv.isFbrExcluded
              ? "Re-enable for Validate All / Submit All bulk actions."
              : "Exclude from Validate All / Submit All. Per-bill actions still work."}
          >
            {inv.isFbrExcluded ? <MdRestore size={14} /> : <MdBlock size={14} />}
          </IconButton>
        )}
        {/* Customer document handover — Mark (Pending rows) / Revert (Delivered
            rows). Invoices + Notes only; each gated by its own permission. */}
        {!isBillsMode && perms.canDocsDeliver && inv.handoverStatus === "Pending" && (
          <IconButton
            style={btn.handoverMark}
            onClick={() => onMarkHandover?.(inv)}
            label="Mark customer documents delivered"
          >
            <MdAssignmentTurnedIn size={14} />
          </IconButton>
        )}
        {!isBillsMode && perms.canDocsRevert && inv.handoverStatus === "Delivered" && (
          <IconButton
            style={btn.handoverRevert}
            onClick={() => onRevertHandover?.(inv)}
            label={`Delivered${inv.handoverAt ? ` on ${new Date(inv.handoverAt).toLocaleDateString()}` : ""}${inv.handoverByName ? ` by ${inv.handoverByName}` : " (migrated)"}. Click to revert to Pending.`}
          >
            <MdUndo size={14} />
          </IconButton>
        )}
        {(isBillsMode || isReturnsMode) && perms.canDelete && !isSubmitted && inv.isLatest && (
          <IconButton style={btn.delete} onClick={() => onDelete?.(inv)} label={inv.isCancelled
            ? "Delete this voided document — it is the latest in its sequence, so removing it rolls the number back."
            : "Delete — only the latest document in its sequence, removes the row entirely."}>
            <MdDelete size={14} />
          </IconButton>
        )}
        {(isBillsMode || isReturnsMode) && perms.canVoid && !isSubmitted && !inv.isCancelled && (
          <IconButton
            style={btn.void}
            onClick={() => onVoid?.(inv)}
            label="Void bill — keeps the bill number (no gap), marks it cancelled and reverts its delivery challan(s) to Pending so they can be re-billed."
          >
            <MdCancel size={14} />
          </IconButton>
        )}
        {perms.canReverse && isSubmitted && !inv.isCancelled && !inv.fbrCancelledAt &&
         inv.documentType !== 9 && inv.documentType !== 10 && (
          <IconButton
            style={btn.reverse}
            onClick={() => onReverse?.(inv)}
            label="Reverse this FBR-submitted bill — opens the Credit Note screen prefilled with its lines (trim for a partial return)."
          >
            <MdUndo size={14} />
          </IconButton>
        )}
        {perms.canReverse && isSubmitted && !inv.isCancelled &&
         inv.documentType !== 9 && inv.documentType !== 10 && (
          <IconButton
            style={btn.teal}
            onClick={() => onCorrect?.(inv)}
            label="Bill the balance quantity under-reported on this submitted bill — creates a new unclassified bill (+ same challan/PO) for the tax consultant to classify and submit to FBR."
          >
            <MdPostAdd size={14} />
          </IconButton>
        )}
      </>
    );
  };

  return (
    <DataTable
      columns={columns}
      rows={invoices}
      rowKey={(i) => i.id}
      actions={renderActions}
      quickSearchPlaceholder="Quick filter visible rows..."
      storageKey={isBillsMode ? "bills" : "invoices"}
      emptyMessage={isBillsMode ? "No bills on this page." : "No invoices on this page."}
    />
  );
}

// Row actions are kit IconButtons (size, radius, focus and disabled dimming come
// from the theme tokens); each keeps its colour-coded tint so the action family
// (print / PDF / XLS / FBR / edit / delete …) still reads at a glance.
const baseBtn = { border: "none" };
const btn = {
  view:        { ...baseBtn, backgroundColor: "#e3f2fd", color: "#0d47a1" },
  teal:        { ...baseBtn, backgroundColor: "#e0f2f1", color: "#00695c" },
  print:       { ...baseBtn, backgroundColor: "#f3e5f5", color: "#7b1fa2" },
  tax:         { ...baseBtn, backgroundColor: "#e0f2f1", color: "#00695c" },
  pdf:         { ...baseBtn, backgroundColor: "#ffebee", color: "#c62828" },
  excel:       { ...baseBtn, backgroundColor: "#e8f5e9", color: "#2e7d32" },
  edit:        { ...baseBtn, backgroundColor: "#fff3e0", color: "#e65100" },
  delete:      { ...baseBtn, backgroundColor: "#ffebee", color: "#b71c1c" },
  void:        { ...baseBtn, backgroundColor: "#fff8e1", color: "#b26a00" },
  reverse:     { ...baseBtn, backgroundColor: "#ede7f6", color: "#5e35b1" },
  fbrValidate: { ...baseBtn, backgroundColor: "#e3f2fd", color: "#0d47a1" },
  fbrSubmit:   { ...baseBtn, backgroundColor: "#e8eaf6", color: "#1a237e" },
  neutral:     { ...baseBtn, backgroundColor: "#eceff1", color: "#546e7a" },
  handoverMark:   { ...baseBtn, backgroundColor: "#e8f5e9", color: "#2e7d32" },
  handoverRevert: { ...baseBtn, backgroundColor: "#fff8e1", color: "#8a6d00" },
};
