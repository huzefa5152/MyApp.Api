import { MdVisibility, MdEdit, MdDelete, MdPrint, MdPictureAsPdf } from "react-icons/md";
import DataTable from "./DataTable";
import { IconButton } from "../ui/Kit";
import StatusBadge from "./StatusBadge";
import PaymentStatusBadge from "./PaymentStatusBadge";
import AttachmentBadge from "./AttachmentBadge";

export default function PurchaseBillTable({ bills, perms, onView, onEdit, onDelete, onPrint, onExportPdf, exportingId, printDisabled = false, printDisabledReason = "", showPaymentStatus = false, attachCounts = {}, onAttach }) {
  const columns = [
    {
      key: "purchaseBillNumber",
      header: "PB #",
      width: 110,
      accessor: (b) => Number(b.purchaseBillNumber) || b.purchaseBillNumber,
      render: (b) => (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <strong>{b.purchaseBillNumber}</strong>
          <AttachmentBadge count={attachCounts?.[b.id]} onClick={() => onAttach?.(b)} />
        </div>
      ),
    },
    {
      key: "supplierName",
      header: "Supplier",
      render: (b) => (
        <>
          {b.supplierName || "—"}
          {b.sourceDeliveryChallanId && <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 6, fontSize: "0.7rem", fontWeight: 600, background: "#e0f2f1", color: "#00695c" }}>From delivery challan</span>}
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
      key: "reconciliationStatus",
      header: "Status",
      width: 130,
      accessor: (b) => b.reconciliationStatus || "",
      render: (b) => b.reconciliationStatus
        ? <StatusBadge status={b.reconciliationStatus} />
        : "—",
    },
    ...(showPaymentStatus ? [{
      key: "paymentStatus",
      header: "Payment",
      width: 150,
      accessor: (b) => b.paymentStatus || "",
      render: (b) => b.paymentStatus
        ? <PaymentStatusBadge status={b.paymentStatus} balanceDue={b.balanceDue} daysOverdue={b.daysOverdue} />
        : "—",
    }] : []),
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
      <IconButton label="View" icon={MdVisibility} size={16} onClick={() => onView?.(b)} />
      {perms.canUpdate && (
        <IconButton label="Edit" icon={MdEdit} size={16} onClick={() => onEdit?.(b)} />
      )}
      {onPrint && (
        <IconButton
          label="Print"
          icon={MdPrint}
          size={16}
          disabled={printDisabled}
          onClick={() => onPrint(b)}
          title={printDisabled ? printDisabledReason : "Print"}
        />
      )}
      {onExportPdf && (
        <IconButton
          label="Download PDF"
          icon={MdPictureAsPdf}
          size={16}
          onClick={() => onExportPdf(b)}
          disabled={printDisabled || !!exportingId}
          title={printDisabled ? printDisabledReason : "Download PDF"}
        />
      )}
      {perms.canDelete && (
        <IconButton label="Delete" icon={MdDelete} size={16} danger onClick={() => onDelete?.(b)} />
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
