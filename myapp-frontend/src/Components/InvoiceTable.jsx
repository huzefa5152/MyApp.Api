import { useNavigate } from "react-router-dom";
import {
  MdVisibility, MdPrint, MdPictureAsPdf, MdGridOn, MdDescription,
  MdCloudUpload, MdCheckCircle, MdHourglassEmpty, MdError, MdBlock, MdRestore,
  MdEdit, MdDelete, MdOpenInNew,
} from "react-icons/md";
import DataTable from "../components/DataTable";
import StatusBadge from "../components/StatusBadge";

// Renders the FBR-status pill in compact form for the table.
function fbrStatusBadge(inv, isBillsMode) {
  if (inv.fbrStatus === "Submitted") {
    return (
      <StatusBadge tone="submitted" title={inv.fbrIRN ? `IRN: ${inv.fbrIRN}` : undefined}>
        {isBillsMode ? "Submitted" : "FBR Submitted"}
      </StatusBadge>
    );
  }
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

export default function InvoiceTable({
  invoices,
  isBillsMode,
  perms,
  hasExcelBill,
  hasExcelTax,
  selectedCompanyHasFbrToken,
  fbrValidated,
  fbrLoading,
  exportingId,
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
  onEdit,
  onToggleFbrExcluded,
  onDelete,
}) {
  const navigate = useNavigate();

  const columns = [
    {
      key: "invoiceNumber",
      header: isBillsMode ? "Bill #" : "Invoice #",
      width: 110,
      accessor: (i) => Number(i.invoiceNumber) || i.invoiceNumber,
      render: (i) => <strong>{i.invoiceNumber}</strong>,
    },
    {
      key: "clientName",
      header: "Client",
      render: (i) => i.clientName || "—",
    },
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
        {!isBillsMode && perms.canFbrAny && selectedCompanyHasFbrToken && !isSubmitted && (
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
        {perms.canOpenEdit && !isSubmitted && (
          <button
            style={btn.edit}
            onClick={() => onEdit?.(inv)}
            title={isBillsMode ? "Edit bill" : "Classify line items by Item Type"}
          >
            <MdEdit size={14} />
          </button>
        )}
        {!isBillsMode && perms.canFbrExclude && !isSubmitted && (
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
        {isBillsMode && perms.canDelete && !isSubmitted && inv.isLatest && (
          <button style={btn.delete} onClick={() => onDelete?.(inv)} title="Delete bill">
            <MdDelete size={14} />
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
  fbrValidate: { ...baseBtn, backgroundColor: "#e3f2fd", color: "#0d47a1" },
  fbrSubmit:   { ...baseBtn, backgroundColor: "#e8eaf6", color: "#1a237e" },
  neutral:     { ...baseBtn, backgroundColor: "#eceff1", color: "#546e7a" },
};
