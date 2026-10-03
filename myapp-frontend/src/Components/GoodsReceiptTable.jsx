import { MdVisibility, MdEdit, MdDelete, MdPrint, MdPictureAsPdf } from "react-icons/md";
import DataTable from "./DataTable";
import { IconButton } from "../ui/Kit";
import StatusBadge from "./StatusBadge";
import AttachmentBadge from "./AttachmentBadge";

export default function GoodsReceiptTable({ receipts, perms, onView, onEdit, onDelete, onPrint, onExportPdf, exportingId, printDisabled = false, printDisabledReason = "", attachCounts, onAttach }) {
  const columns = [
    {
      key: "goodsReceiptNumber",
      header: "GR #",
      width: 110,
      accessor: (g) => Number(g.goodsReceiptNumber) || g.goodsReceiptNumber,
      render: (g) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <strong>{g.goodsReceiptNumber}</strong>
          <AttachmentBadge count={attachCounts?.[g.id]} onClick={() => onAttach?.(g)} />
        </span>
      ),
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
      <IconButton label="View" icon={MdVisibility} size={16} onClick={() => onView?.(g)} />
      {perms.canUpdate && (
        <IconButton label="Edit" icon={MdEdit} size={16} onClick={() => onEdit?.(g)} />
      )}
      {onPrint && (
        <IconButton
          label="Print"
          icon={MdPrint}
          size={16}
          disabled={printDisabled}
          onClick={() => onPrint(g)}
          title={printDisabled ? printDisabledReason : "Print"}
        />
      )}
      {onExportPdf && (
        <IconButton
          label="Download PDF"
          icon={MdPictureAsPdf}
          size={16}
          onClick={() => onExportPdf(g)}
          disabled={printDisabled || !!exportingId}
          title={printDisabled ? printDisabledReason : "Download PDF"}
        />
      )}
      {perms.canDelete && (
        <IconButton label="Delete" icon={MdDelete} size={16} danger onClick={() => onDelete?.(g)} />
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
