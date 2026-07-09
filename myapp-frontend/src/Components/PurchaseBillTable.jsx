import { MdVisibility, MdEdit, MdDelete, MdPayments, MdPrint, MdPictureAsPdf } from "react-icons/md";
import DataTable from "./DataTable";
import StatusBadge from "./StatusBadge";

// Payment-status pill (mirror of InvoiceTable's): Paid / Partial / Overdue / Unpaid.
function paymentStatusBadge(b) {
  const s = b.paymentStatus;
  if (s === "Paid") return <StatusBadge tone="success">Paid</StatusBadge>;
  if (s === "Overdue") return <StatusBadge tone="danger" title={b.daysOverdue ? `${b.daysOverdue} day(s) overdue` : undefined}>Overdue{b.daysOverdue ? ` ${b.daysOverdue}d` : ""}</StatusBadge>;
  if (s === "PartiallyPaid") return <StatusBadge tone="info">Partial</StatusBadge>;
  return <StatusBadge tone="neutral">Unpaid</StatusBadge>;
}

export default function PurchaseBillTable({ bills, perms, onView, onEdit, onDelete, onRecordPayment, onShowPayments, onPrint, onExportPdf, exportingId }) {
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
      key: "paymentStatus",
      header: "Payment",
      width: 110,
      accessor: (b) => b.paymentStatus || "",
      render: (b) => (perms.canViewPayments && onShowPayments) ? (
        <button type="button" onClick={() => onShowPayments(b)} title="View payments & balance"
          style={{ all: "unset", cursor: "pointer" }}>
          {paymentStatusBadge(b)}
        </button>
      ) : paymentStatusBadge(b),
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
        <button style={btn.print} onClick={() => onPrint(b)} title="Print purchase bill">
          <MdPrint size={14} />
        </button>
      )}
      {perms.canPrint && onExportPdf && (
        <button style={{ ...btn.pdf, opacity: exportingId === b.id ? 0.5 : 1 }} disabled={!!exportingId} onClick={() => onExportPdf(b)} title="Download PDF">
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
  print:   { ...baseBtn, backgroundColor: "#ede7f6", color: "#4527a0", border: "1px solid #b39ddb" },
  pdf:     { ...baseBtn, backgroundColor: "#fce4ec", color: "#ad1457", border: "1px solid #f48fb1" },
  payment: { ...baseBtn, backgroundColor: "#e8f5e9", color: "#1b5e20", border: "1px solid #a5d6a7" },
  edit:   { ...baseBtn, backgroundColor: "#fff3e0", color: "#e65100" },
  delete: { ...baseBtn, backgroundColor: "#ffebee", color: "#b71c1c" },
};
