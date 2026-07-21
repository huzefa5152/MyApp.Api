import { MdVisibility, MdEdit, MdDelete, MdPrint, MdPictureAsPdf } from "react-icons/md";
import DataTable from "./DataTable";
import StatusBadge from "./StatusBadge";

export default function GoodsReceiptTable({ receipts, perms, onView, onEdit, onDelete, onPrint, onExportPdf, exportingId, printDisabled = false, printDisabledReason = "" }) {
  const columns = [
    {
      key: "goodsReceiptNumber",
      header: "GR #",
      width: 110,
      accessor: (g) => Number(g.goodsReceiptNumber) || g.goodsReceiptNumber,
      render: (g) => <strong>{g.goodsReceiptNumber}</strong>,
    },
    {
      key: "supplierName",
      header: "Supplier",
      render: (g) => g.supplierName || "—",
    },
    {
      key: "receiptDate",
      header: "Date",
      width: 110,
      accessor: (g) => g.receiptDate ? new Date(g.receiptDate).getTime() : 0,
      render: (g) => g.receiptDate ? new Date(g.receiptDate).toLocaleDateString() : "—",
    },
    {
      key: "items",
      header: "Lines",
      width: 70,
      align: "right",
      accessor: (g) => g.items?.length || 0,
      render: (g) => g.items?.length || 0,
    },
    {
      key: "purchaseBillNumber",
      header: "Linked PB",
      width: 110,
      render: (g) => g.purchaseBillNumber ? `#${g.purchaseBillNumber}` : "—",
    },
    {
      key: "supplierChallanNumber",
      header: "Supplier DC",
      defaultHidden: true,
      render: (g) => g.supplierChallanNumber || "—",
    },
    {
      key: "status",
      header: "Status",
      width: 130,
      accessor: (g) => g.status || "",
      render: (g) => g.status ? <StatusBadge status={g.status} /> : "—",
    },
  ];

  const renderActions = (g) => (
    <>
      <button style={btn.view} onClick={() => onView?.(g)} title="View">
        <MdVisibility size={14} />
      </button>
      {perms.canUpdate && (
        <button style={btn.edit} onClick={() => onEdit?.(g)} title="Edit">
          <MdEdit size={14} />
        </button>
      )}
      {onPrint && (
        <button
          style={{ ...btn.print, opacity: printDisabled ? 0.5 : 1, cursor: printDisabled ? "not-allowed" : "pointer" }}
          disabled={printDisabled}
          onClick={() => onPrint(g)}
          title={printDisabled ? printDisabledReason : "Print"}
        >
          <MdPrint size={14} />
        </button>
      )}
      {onExportPdf && (
        <button
          style={{ ...btn.pdf, opacity: printDisabled || exportingId === g.id ? 0.5 : 1, cursor: printDisabled ? "not-allowed" : "pointer" }}
          onClick={() => onExportPdf(g)}
          disabled={printDisabled || !!exportingId}
          title={printDisabled ? printDisabledReason : "Download PDF"}
        >
          <MdPictureAsPdf size={14} />
        </button>
      )}
      {perms.canDelete && (
        <button style={btn.delete} onClick={() => onDelete?.(g)} title="Delete">
          <MdDelete size={14} />
        </button>
      )}
    </>
  );

  return (
    <DataTable
      columns={columns}
      rows={receipts}
      rowKey={(g) => g.id}
      actions={renderActions}
      quickSearchPlaceholder="Quick filter visible rows..."
      storageKey="goodsReceipts"
      emptyMessage="No goods receipts on this page."
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
  view:   { ...baseBtn, backgroundColor: "#e3f2fd", color: "#0d47a1", border: "1px solid #90caf9" },
  edit:   { ...baseBtn, backgroundColor: "#fff3e0", color: "#e65100" },
  print:  { ...baseBtn, backgroundColor: "#e8f5e9", color: "#1b5e20" },
  pdf:    { ...baseBtn, backgroundColor: "#f3e5f5", color: "#6a1b9a" },
  delete: { ...baseBtn, backgroundColor: "#ffebee", color: "#b71c1c" },
};
