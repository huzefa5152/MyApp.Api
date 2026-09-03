import { MdVisibility, MdEdit, MdDelete, MdPayments, MdPrint, MdPictureAsPdf, MdCopyAll } from "react-icons/md";
import DataTable from "./DataTable";
import StatusBadge from "./StatusBadge";

// Payment-status pill (mirror of InvoiceTable's): Paid / Partial / Overdue / Unpaid.
// No per-document payment status (2026-09-03) — payments here are recorded
// against the supplier, not allocated per bill, so the pill described the
// allocation rather than the supplier. The payments drill-down stays.

export default function PurchaseBillTable({ bills, perms, onView, onEdit, onDelete, onCopy, onRecordPayment, onShowPayments, onPrint, onExportPdf, exportingId, printDisabled = false, printDisabledReason = "" }) {
  const columns = [
    {
      key: "purchaseBillNumber",
      header: "PB #",
      width: 110,
      accessor: (b) => Number(b.purchaseBillNumber) || b.purchaseBillNumber,
      render: (b) => <strong>{b.purchaseBillNumber}</strong>,
    },
    {
      key: "supplierName",
      header: "Supplier",
      render: (b) => (
        <>
          {b.supplierName || "—"}
          {b.divisionName && <span style={divisionChip}>{b.divisionName}</span>}
        </>
      ),
    },
    {
      key: "date",
      header: "Date",
      width: 110,
      accessor: (b) => b.date ? new Date(b.date).getTime() : 0,
      render: (b) => b.date ? new Date(b.date).toLocaleDateString() : "—",
    },
    {
      key: "items",
      header: "Lines",
      width: 70,
      align: "right",
      accessor: (b) => b.items?.length || 0,
      render: (b) => b.items?.length || 0,
    },
    {
      key: "grandTotal",
      header: "Grand Total",
      width: 140,
      align: "right",
      accessor: (b) => b.grandTotal || 0,
      render: (b) => `Rs. ${(b.grandTotal ?? 0).toLocaleString()}`,
    },
    {
      key: "balanceDue",
      header: "Balance Due",
      width: 130,
      align: "right",
      accessor: (b) => b.balanceDue ?? 0,
      render: (b) => `Rs. ${(b.balanceDue ?? 0).toLocaleString()}`,
    },
    {
      key: "payments",
      header: "Payments",
      width: 100,
      accessor: () => "",
      render: (b) => (perms.canViewPayments && onShowPayments) ? (
        <button type="button" onClick={() => onShowPayments(b)} title="What has been applied to this bill"
          style={{ all: "unset", cursor: "pointer", color: colors.blue, fontWeight: 700, fontSize: "0.78rem" }}>
          View
        </button>
      ) : "—",
    },
    {
      key: "reconciliationStatus",
      header: "Status",
      width: 130,
      accessor: (b) => b.reconciliationStatus || "",
      render: (b) => b.reconciliationStatus
        ? <StatusBadge status={b.reconciliationStatus} />
        : "—",
    },
    {
      key: "supplierIRN",
      header: "Supplier IRN",
      defaultHidden: true,
      render: (b) => b.supplierIRN
        ? <span style={{ fontFamily: "monospace", fontSize: "0.75rem", wordBreak: "break-all" }}>{b.supplierIRN}</span>
        : "—",
    },
  ];

  const renderActions = (b) => (
    <>
      <button style={btn.view} onClick={() => onView?.(b)} title="View">
        <MdVisibility size={14} />
      </button>
      {perms.canPrint && onPrint && (
        <button style={{ ...btn.print, ...(printDisabled ? { opacity: 0.5, cursor: "not-allowed" } : {}) }} disabled={printDisabled} onClick={() => onPrint(b)} title={printDisabled ? printDisabledReason : "Print purchase bill"}>
          <MdPrint size={14} />
        </button>
      )}
      {perms.canPrint && onExportPdf && (
        <button style={{ ...btn.pdf, opacity: (exportingId === b.id || printDisabled) ? 0.5 : 1, ...(printDisabled ? { cursor: "not-allowed" } : {}) }} disabled={!!exportingId || printDisabled} onClick={() => onExportPdf(b)} title={printDisabled ? printDisabledReason : "Download PDF"}>
          <MdPictureAsPdf size={14} />
        </button>
      )}
      {perms.canRecordPayment && (
        <button style={btn.payment} onClick={() => onRecordPayment?.(b)} title="Record a payment (money paid) against this bill">
          <MdPayments size={14} />
        </button>
      )}
      {perms.canUpdate && (
        <button style={btn.edit} onClick={() => onEdit?.(b)} title="Edit">
          <MdEdit size={14} />
        </button>
      )}
      {perms.canCopy && onCopy && (
        <button style={btn.copy} onClick={() => onCopy(b)} title="Copy this bill">
          <MdCopyAll size={14} />
        </button>
      )}
      {perms.canDelete && (
        <button style={btn.delete} onClick={() => onDelete?.(b)} title="Delete">
          <MdDelete size={14} />
        </button>
      )}
    </>
  );

  return (
    <DataTable
      columns={columns}
      rows={bills}
      rowKey={(b) => b.id}
      actions={renderActions}
      quickSearchPlaceholder="Quick filter visible rows..."
      storageKey="purchaseBills"
      emptyMessage="No purchase bills on this page."
    />
  );
}

// Subtle per-row division tag (mirrors SalesQuotePage's card chip).
const divisionChip = { display: "inline-block", marginLeft: 6, fontSize: "0.7rem", fontWeight: 700, color: "#0d47a1", background: "#e3f0ff", padding: "0.1rem 0.5rem", borderRadius: 6 };

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
  view:    { ...baseBtn, backgroundColor: "#e3f2fd", color: "#0d47a1", border: "1px solid #90caf9" },
  copy:    { ...baseBtn, backgroundColor: "#e8eaf6", color: "#283593", border: "1px solid #9fa8da" },
  print:   { ...baseBtn, backgroundColor: "#ede7f6", color: "#4527a0", border: "1px solid #b39ddb" },
  pdf:     { ...baseBtn, backgroundColor: "#fce4ec", color: "#ad1457", border: "1px solid #f48fb1" },
  payment: { ...baseBtn, backgroundColor: "#e8f5e9", color: "#1b5e20", border: "1px solid #a5d6a7" },
  edit:   { ...baseBtn, backgroundColor: "#fff3e0", color: "#e65100" },
  delete: { ...baseBtn, backgroundColor: "#ffebee", color: "#b71c1c" },
};
