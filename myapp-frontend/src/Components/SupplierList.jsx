import { MdEdit, MdDelete, MdContentCopy, MdReceiptLong, MdInventory2 } from "react-icons/md";
import { useNavigate } from "react-router-dom";
import { deleteSupplier } from "../api/supplierApi";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import PartyCard from "./party/PartyCard";

export default function SupplierList({ suppliers, commonGroups, onEdit, onEditCommon, onCopy, fetchSuppliers }) {
  const confirm = useConfirm();
  const { has } = usePermissions();
  const canUpdate = has("suppliers.manage.update");
  const canDelete = has("suppliers.manage.delete");
  const canCopy = has("suppliers.manage.copy");
  // Statement opens the accounting report supplier-statement for this supplier, so it
  // carries that report's permission — a role without it never sees a button
  // that would land on a refusal. All periods: a statement answers "how did
  // this balance come about", which is the whole history.
  const canStatement = has("accounting.reports.view");
  const navigate = useNavigate();
  const openStatement = (s) =>
    navigate(`/accounting/reports/catalog/supplier-statement?${new URLSearchParams({ period: "allPeriods", supplierId: String(s.id) })}`);

  const handleDelete = async (s) => {
    if (s.hasPurchaseBills) {
      notify("Cannot delete — purchase bills exist for this supplier. Delete those first.", "error");
      return;
    }
    const ok = await confirm({
      title: "Delete Supplier?",
      message: "Are you sure you want to delete this supplier? This action cannot be undone.",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    try {
      await deleteSupplier(s.id);
      fetchSuppliers();
    } catch (err) {
      notify(err.response?.data?.message || "Failed to delete supplier.", "error");
    }
  };

  return (
    <div className="pd-grid">
      {suppliers.map((supplier, i) => {
        // A supplier shared with other companies edits through the Common
        // Supplier form, so the change reaches every company's copy.
        const shared = supplier.supplierGroupId != null ? commonGroups?.get(supplier.supplierGroupId) : null;
        return (
        <PartyCard
          key={supplier.id}
          party={supplier}
          shared={shared}
          style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}
          footnote={supplier.hasPurchaseBills && (
            <span className="pd-contact__row" style={{ color: "#00695c", fontSize: "0.76rem", fontWeight: 600 }}>
              <MdInventory2 style={{ color: "#00897b" }} /><span>Has purchase bills</span>
            </span>
          )}
          actions={[
            canUpdate && (shared && onEditCommon
              ? { key: "edit", label: "Edit", icon: <MdEdit size={16} />, variant: "primary", onClick: () => onEditCommon(shared.groupId), title: "Edit for every company that has this supplier" }
              : { key: "edit", label: "Edit", icon: <MdEdit size={16} />, variant: "primary", onClick: () => onEdit(supplier) }),
            canStatement && { key: "statement", label: "Statement", icon: <MdReceiptLong size={16} />, onClick: () => openStatement(supplier), title: "Open this supplier's statement" },
            canCopy && onCopy && { key: "copy", label: "Copy", icon: <MdContentCopy size={16} />, iconOnly: true, onClick: () => onCopy(supplier), title: "Copy this supplier into another company" },
            canDelete && {
              key: "delete", label: "Delete", icon: <MdDelete size={17} />, iconOnly: true, variant: "danger",
              onClick: () => handleDelete(supplier),
              title: supplier.hasPurchaseBills ? "Has purchase bills — delete those first" : "Delete supplier",
            },
          ].filter(Boolean)}
        />
        );
      })}
    </div>
  );
}
