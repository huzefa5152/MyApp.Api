import { useState } from "react";
import { MdVisibility, MdEdit, MdPrint, MdPictureAsPdf, MdGridOn, MdRequestQuote, MdContentCopy, MdCancel, MdDelete, MdWarning } from "react-icons/md";
import { usePermissions } from "../contexts/PermissionsContext";
import DataTable from "./DataTable";
import StatusBadge, { toneForStatus } from "./StatusBadge";
import ChallanModal from "./ChallanModal";

// Mirror of ChallanList's eligibility checks so the table view enforces the
// exact same business rules around editability / cancel / delete / duplicate.
function evalRowFlags(c, perms) {
  const isEditable = c.isEditable ?? (
    c.status === "Pending" || c.status === "Imported" || c.status === "No PO" || c.status === "Setup Required"
  );
  const canCancel = c.status !== "Invoiced" && isEditable;
  const isDuplicate = c.duplicatedFromId != null;
  const canDelete = canCancel && (isDuplicate || c.isLatest === true);
  const canGenerateBill = perms.permCreateBill && (c.status === "Pending" || c.status === "Imported");
  const canDuplicate = perms.permDuplicate
    && !isDuplicate
    && (c.status === "Pending" || c.status === "Imported");
  return { isEditable, canCancel, isDuplicate, canDelete, canGenerateBill, canDuplicate };
}

export default function ChallanTable({
  challans,
  onCancel,
  onDelete,
  onPrint,
  onEditItems,
  onExportPdf,
  onExportExcel,
  onGenerateBill,
  onDuplicate,
  exportingId,
  duplicatingId,
}) {
  const { has } = usePermissions();
  const perms = {
    permUpdate: has("challans.manage.update"),
    permDelete: has("challans.manage.delete"),
    permPrint: has("challans.print.view"),
    permCreateBill: has("bills.manage.create"),
    permDuplicate: has("challans.manage.duplicate"),
  };
  const [selectedChallan, setSelectedChallan] = useState(null);

  const columns = [
    {
      key: "challanNumber",
      header: "DC #",
      width: 110,
      accessor: (c) => Number(c.challanNumber) || c.challanNumber,
      render: (c) => (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <strong>{c.challanNumber}</strong>
          {c.duplicatedFromId != null && (
            <span title={c.duplicatedFromChallanNumber ? `Duplicate of #${c.duplicatedFromChallanNumber}` : "Duplicate"} style={{ color: "#4527a0", display: "inline-flex" }}>
              <MdContentCopy size={13} />
            </span>
          )}
          {c.warnings && c.warnings.length > 0 && (
            <span title={`FBR setup issues:\n• ${c.warnings.join("\n• ")}`} style={{ color: "#e65100", display: "inline-flex" }}>
              <MdWarning size={14} />
            </span>
          )}
        </div>
      ),
    },
    {
      key: "clientName",
      header: "Client",
      render: (c) => c.clientName || "—",
    },
    {
      key: "poNumber",
      header: "PO",
      width: 130,
      render: (c) => c.poNumber || "—",
    },
    {
      key: "indentNo",
      header: "Indent",
      width: 110,
      defaultHidden: true,
      render: (c) => c.indentNo || "—",
    },
    {
      key: "site",
      header: "Site",
      defaultHidden: true,
      render: (c) => c.site || "—",
    },
    {
      key: "deliveryDate",
      header: "Date",
      width: 110,
      accessor: (c) => c.deliveryDate ? new Date(c.deliveryDate).getTime() : 0,
      render: (c) => c.deliveryDate ? new Date(c.deliveryDate).toLocaleDateString() : "—",
    },
    {
      key: "items",
      header: "Lines",
      width: 70,
      align: "right",
      accessor: (c) => c.items?.length || 0,
      render: (c) => c.items?.length || 0,
    },
    {
      key: "status",
      header: "Status",
      width: 130,
      accessor: (c) => c.status,
      render: (c) => (
        <StatusBadge tone={toneForStatus(c.status)} status={c.status === "Invoiced" ? "Billed" : c.status} />
      ),
    },
  ];

  const renderActions = (c) => {
    const flags = evalRowFlags(c, perms);
    const isDuplicating = duplicatingId === c.id;
    return (
      <>
        <button style={btnStyles.view} onClick={() => setSelectedChallan(c)} title="View challan">
          <MdVisibility size={14} />
        </button>
        {perms.permPrint && (
          <button style={btnStyles.print} onClick={() => onPrint?.(c)} title="Print">
            <MdPrint size={14} />
          </button>
        )}
        {perms.permPrint && (
          <button
            style={{ ...btnStyles.pdf, opacity: exportingId ? 0.55 : 1 }}
            disabled={!!exportingId}
            onClick={() => onExportPdf?.(c)}
            title="Export PDF"
          >
            {exportingId === c.id + "-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />}
          </button>
        )}
        {perms.permPrint && onExportExcel && (
          <button
            style={{ ...btnStyles.excel, opacity: exportingId ? 0.55 : 1 }}
            disabled={!!exportingId}
            onClick={() => onExportExcel(c)}
            title="Export Excel"
          >
            {exportingId === c.id + "-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />}
          </button>
        )}
        {perms.permUpdate && flags.isEditable && (
          <button style={btnStyles.edit} onClick={() => onEditItems?.(c)} title="Edit items">
            <MdEdit size={14} />
          </button>
        )}
        {flags.canDuplicate && onDuplicate && (
          <button
            style={{
              ...btnStyles.duplicate,
              opacity: duplicatingId ? 0.55 : 1,
              cursor: duplicatingId ? "not-allowed" : "pointer",
            }}
            disabled={!!duplicatingId}
            onClick={() => onDuplicate(c)}
            title="Duplicate"
          >
            {isDuplicating ? <span className="btn-spinner" /> : <MdContentCopy size={14} />}
          </button>
        )}
        {flags.canGenerateBill && (
          <button style={btnStyles.generateBill} onClick={() => onGenerateBill?.(c)} title="Generate Bill from this challan">
            <MdRequestQuote size={14} />
          </button>
        )}
        {perms.permUpdate && flags.canCancel && (
          <button style={btnStyles.cancel} onClick={() => onCancel?.(c)} title="Cancel challan">
            <MdCancel size={14} />
          </button>
        )}
        {perms.permDelete && flags.canDelete && (
          <button style={btnStyles.delete} onClick={() => onDelete?.(c)} title="Delete">
            <MdDelete size={14} />
          </button>
        )}
      </>
    );
  };

  return (
    <>
      <DataTable
        columns={columns}
        rows={challans}
        rowKey={(c) => c.id}
        actions={renderActions}
        quickSearchPlaceholder="Quick filter visible rows..."
        storageKey="challans"
        emptyMessage="No delivery challans on this page."
      />
      <ChallanModal challan={selectedChallan} onClose={() => setSelectedChallan(null)} />
    </>
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
const btnStyles = {
  view:         { ...baseBtn, backgroundColor: "#e3f2fd", color: "#0d47a1" },
  print:        { ...baseBtn, backgroundColor: "#f3e5f5", color: "#7b1fa2" },
  pdf:          { ...baseBtn, backgroundColor: "#ffebee", color: "#c62828" },
  excel:        { ...baseBtn, backgroundColor: "#e8f5e9", color: "#2e7d32" },
  edit:         { ...baseBtn, backgroundColor: "#fff3e0", color: "#e65100" },
  duplicate:    { ...baseBtn, backgroundColor: "#ede7f6", color: "#4527a0" },
  generateBill: { ...baseBtn, backgroundColor: "#e0f2f1", color: "#00695c" },
  cancel:       { ...baseBtn, backgroundColor: "#fce4ec", color: "#c62828" },
  delete:       { ...baseBtn, backgroundColor: "#ffebee", color: "#b71c1c" },
};
