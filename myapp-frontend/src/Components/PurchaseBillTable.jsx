import { MdVisibility, MdEdit, MdDelete } from "react-icons/md";
import DataTable from "./DataTable";
import StatusBadge from "./StatusBadge";

export default function PurchaseBillTable({ bills, perms, onView, onEdit, onDelete }) {
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
      render: (b) => b.supplierName || "—",
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
  delete: { ...baseBtn, backgroundColor: "#ffebee", color: "#b71c1c" },
};
