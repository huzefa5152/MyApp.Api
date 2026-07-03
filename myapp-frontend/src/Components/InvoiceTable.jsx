import { useNavigate } from "react-router-dom";
import {
  MdVisibility, MdPrint, MdPictureAsPdf, MdGridOn, MdDescription,
  MdCloudUpload, MdCheckCircle, MdHourglassEmpty, MdError, MdBlock, MdRestore,
  MdEdit, MdDelete, MdOpenInNew, MdCancel, MdPayments, MdUndo,
} from "react-icons/md";
import DataTable from "./DataTable";
import StatusBadge from "./StatusBadge";

// Renders the FBR-status pill in compact form for the table.
function fbrStatusBadge(inv, isBillsMode, fbrEnabled = true) {
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
  // FBR disabled for this company → no FBR status badge on unsubmitted bills
  // (already-submitted bills above still show their status for accuracy).
  if (!fbrEnabled) return null;
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

// Renders the payment-status pill (balance due / paid / overdue).
function paymentStatusBadge(inv) {
  const s = inv.paymentStatus;
  if (s === "Paid") return <StatusBadge tone="success">Paid</StatusBadge>;
  if (s === "Overdue") return <StatusBadge tone="danger" title={inv.daysOverdue ? `${inv.daysOverdue} day(s) overdue` : undefined}>Overdue{inv.daysOverdue ? ` ${inv.daysOverdue}d` : ""}</StatusBadge>;
  if (s === "PartiallyPaid") return <StatusBadge tone="info">Partial</StatusBadge>;
  return <StatusBadge tone="neutral">Unpaid</StatusBadge>;
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
  fbrEnabled = true,
  fbrValidated,
  fbrLoading,
  exportingId,
  // handlers (parent owns them; we just call them)
  onView,
  onRecordReceipt,
  onShowPayments,
  onPrintBill,
  onPrintTax,
  onExportBillPdf,
  onExportBillExcel,
  onExportTaxPdf,
  onExportTaxExcel,
  onFbrPreview,
  onFbrValidate,
  onFbrSubmit,
  onEdit,
  onToggleFbrExcluded,
  onDelete,
  onVoid,
  onReverse,
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
          <strong>{i.invoiceNumber}</strong>
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
      render: (i) => (
        <span>
          {i.clientName || "—"}
          {i.divisionName && <span style={divisionChip}>{i.divisionName}</span>}
        </span>
      ),
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
          <div style={{ fontSize: "0.75rem", color: "#5f6d7e" }} title={i.noteReasonRemarks || undefined}>
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
      key: "balanceDue",
      header: "Balance Due",
      width: 130,
      align: "right",
      accessor: (i) => i.balanceDue ?? 0,
      render: (i) => `Rs. ${(i.balanceDue ?? 0).toLocaleString()}`,
    },
    {
      key: "paymentStatus",
      header: "Payment",
      width: 110,
      accessor: (i) => i.paymentStatus || "",
      render: (i) => (perms.canViewReceipts && onShowPayments && !i.isCancelled) ? (
        <button type="button" onClick={() => onShowPayments(i)} title="View receipts & balance"
          style={{ all: "unset", cursor: "pointer" }}>
          {paymentStatusBadge(i)}
        </button>
      ) : paymentStatusBadge(i),
    },
    {
      key: "dueDate",
      header: "Due Date",
      width: 110,
      defaultHidden: true,
      accessor: (i) => i.dueDate ? new Date(i.dueDate).getTime() : 0,
      render: (i) => i.dueDate ? new Date(i.dueDate).toLocaleDateString() : "—",
    },
    {
      key: "fbrStatus",
      header: isBillsMode ? "FBR" : "FBR Status",
      width: 140,
      accessor: (i) => i.fbrStatus || "",
      render: (i) => fbrStatusBadge(i, isBillsMode, fbrEnabled),
    },
  ];

  const renderActions = (inv) => {
    const isSubmitted = inv.fbrStatus === "Submitted";
    return (
      <>
        {isBillsMode && (
          <button style={btn.view} onClick={() => onView?.(inv)} title="View bill">
            <MdVisibility size={14} />
          </button>
        )}
        {perms.canRecordReceipt && !inv.isCancelled && (
          <button style={btn.receipt} onClick={() => onRecordReceipt?.(inv)} title="Record a receipt (payment received) against this invoice">
            <MdPayments size={14} />
          </button>
        )}
        {isBillsMode && (
          <button
            style={btn.teal}
            onClick={() => navigate(`/invoices?search=${encodeURIComponent(inv.invoiceNumber)}`)}
            title="Open this bill on the Invoices tab"
          >
            <MdOpenInNew size={14} />
          </button>
        )}
        {isBillsMode && perms.canPrint && (
          <button style={btn.print} onClick={() => onPrintBill?.(inv)} title="Print bill">
            <MdPrint size={14} />
          </button>
        )}
        {!isBillsMode && perms.canPrint && (
          <button style={btn.tax} onClick={() => onPrintTax?.(inv)} title="Print tax invoice">
            <MdDescription size={14} />
          </button>
        )}
        {isBillsMode && perms.canPrint && (
          <button
            style={{ ...btn.pdf, opacity: exportingId ? 0.55 : 1 }}
            disabled={!!exportingId}
            onClick={() => onExportBillPdf?.(inv)}
            title="Export Bill PDF"
          >
            {exportingId === inv.id + "-bill-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />}
          </button>
        )}
        {!isBillsMode && perms.canPrint && (
          <button
            style={{ ...btn.pdf, opacity: exportingId ? 0.55 : 1 }}
            disabled={!!exportingId}
            onClick={() => onExportTaxPdf?.(inv)}
            title="Export Tax Invoice PDF"
          >
            {exportingId === inv.id + "-tax-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />}
          </button>
        )}
        {isBillsMode && perms.canPrint && hasExcelBill && (
          <button
            style={{ ...btn.excel, opacity: exportingId ? 0.55 : 1 }}
            disabled={!!exportingId}
            onClick={() => onExportBillExcel?.(inv)}
            title="Export Bill XLS"
          >
            {exportingId === inv.id + "-bill-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />}
          </button>
        )}
        {!isBillsMode && perms.canPrint && hasExcelTax && (
          <button
            style={{ ...btn.excel, opacity: exportingId ? 0.55 : 1 }}
            disabled={!!exportingId}
            onClick={() => onExportTaxExcel?.(inv)}
            title="Export Tax Invoice XLS"
          >
            {exportingId === inv.id + "-tax-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />}
          </button>
        )}
        {!isBillsMode && perms.canFbrPreview && (
          <button style={btn.view} onClick={() => onFbrPreview?.(inv)} title="Preview FBR payload">
            <MdVisibility size={14} />
          </button>
        )}
        {!isBillsMode && perms.canFbrAny && selectedCompanyHasFbrToken && !isSubmitted && !inv.isCancelled && (
          <>
            {perms.canFbrValidate && (
              <button
                style={{
                  ...btn.fbrValidate,
                  opacity: fbrLoading || !inv.fbrReady ? 0.45 : 1,
                  cursor: !inv.fbrReady ? "not-allowed" : "pointer",
                  ...(fbrValidated.has(inv.id) ? { backgroundColor: "#e8f5e9", color: "#2e7d32" } : {}),
                }}
                disabled={!!fbrLoading || !inv.fbrReady}
                onClick={() => onFbrValidate?.(inv)}
                title={
                  !inv.fbrReady
                    ? `Complete FBR setup first:\n• ${inv.fbrMissing?.join("\n• ") || "Missing FBR fields"}`
                    : "Validate this bill with FBR (dry-run)"
                }
              >
                {fbrLoading === inv.id + "-validate" ? <span className="btn-spinner" /> : <MdCheckCircle size={14} />}
              </button>
            )}
            {perms.canFbrSubmit && (
              <button
                style={{
                  ...btn.fbrSubmit,
                  opacity: fbrLoading || !fbrValidated.has(inv.id) || !inv.fbrReady ? 0.4 : 1,
                  cursor: !fbrValidated.has(inv.id) || !inv.fbrReady ? "not-allowed" : "pointer",
                }}
                disabled={!!fbrLoading || !fbrValidated.has(inv.id) || !inv.fbrReady}
                onClick={() => onFbrSubmit?.(inv)}
                title={
                  !inv.fbrReady ? "Complete FBR setup first."
                    : fbrValidated.has(inv.id) ? "Submit to FBR"
                    : "Validate first before submitting."
                }
              >
                {fbrLoading === inv.id + "-submit" ? <span className="btn-spinner" /> : <MdCloudUpload size={14} />}
              </button>
            )}
          </>
        )}
        {perms.canOpenEdit && !isSubmitted && !inv.isCancelled && (
          <button
            style={btn.edit}
            onClick={() => onEdit?.(inv)}
            title={isBillsMode ? "Edit bill" : "Classify line items by Item Type"}
          >
            <MdEdit size={14} />
          </button>
        )}
        {!isBillsMode && perms.canFbrExclude && !isSubmitted && !inv.isCancelled && (
          <button
            style={{
              ...btn.neutral,
              backgroundColor: inv.isFbrExcluded ? "#e8f5e9" : "#eceff1",
              color: inv.isFbrExcluded ? "#2e7d32" : "#546e7a",
              border: `1px solid ${inv.isFbrExcluded ? "#a5d6a7" : "#b0bec5"}`,
            }}
            onClick={() => onToggleFbrExcluded?.(inv)}
            title={inv.isFbrExcluded
              ? "Re-enable for Validate All / Submit All bulk actions."
              : "Exclude from Validate All / Submit All. Per-bill actions still work."}
          >
            {inv.isFbrExcluded ? <MdRestore size={14} /> : <MdBlock size={14} />}
          </button>
        )}
        {(isBillsMode || isReturnsMode) && perms.canDelete && !isSubmitted && !inv.isCancelled && inv.isLatest && (
          <button style={btn.delete} onClick={() => onDelete?.(inv)} title="Delete — only the latest document in its sequence, removes the row entirely.">
            <MdDelete size={14} />
          </button>
        )}
        {(isBillsMode || isReturnsMode) && perms.canVoid && !isSubmitted && !inv.isCancelled && (
          <button
            style={btn.void}
            onClick={() => onVoid?.(inv)}
            title="Void bill — keeps the bill number (no gap), marks it cancelled and reverts its delivery challan(s) to Pending so they can be re-billed."
          >
            <MdCancel size={14} />
          </button>
        )}
        {perms.canReverse && isSubmitted && !inv.isCancelled && !inv.reversedByCreditNoteNumber &&
         inv.documentType !== 9 && inv.documentType !== 10 && (
          <button
            style={btn.reverse}
            onClick={() => onReverse?.(inv)}
            title="Reverse this FBR-submitted bill — opens the Credit Note screen prefilled with its lines (trim for a partial return)."
          >
            <MdUndo size={14} />
          </button>
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

// Same chip ChallanTable uses — wraps with the client name, no
// nowrap/ellipsis, so long division names never mask each other.
const divisionChip = {
  display: "inline-block",
  marginLeft: 6,
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#0d47a1",
  background: "#e3f0ff",
  padding: "0.1rem 0.5rem",
  borderRadius: 6,
};

const baseBtn = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 28,
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  padding: 0,
};
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
  receipt:     { ...baseBtn, backgroundColor: "#e8f5e9", color: "#1b5e20" },
  reverse:     { ...baseBtn, backgroundColor: "#ede7f6", color: "#5e35b1" },
  fbrValidate: { ...baseBtn, backgroundColor: "#e3f2fd", color: "#0d47a1" },
  fbrSubmit:   { ...baseBtn, backgroundColor: "#e8eaf6", color: "#1a237e" },
  neutral:     { ...baseBtn, backgroundColor: "#eceff1", color: "#546e7a" },
};
