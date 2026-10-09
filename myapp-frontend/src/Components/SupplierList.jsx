import { MdEmail, MdPhone, MdLocationOn, MdEdit, MdDelete, MdContentCopy, MdReceiptLong } from "react-icons/md";
import { useNavigate } from "react-router-dom";
import { deleteSupplier } from "../api/supplierApi";
import { cardStyles, cardHover } from "../theme";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";

export default function SupplierList({ suppliers, onEdit, onCopy, fetchSuppliers }) {
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
    <div className="card-grid">
      {suppliers.map((supplier) => (
        <div
          key={supplier.id}
          style={cardStyles.card}
          onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
          onMouseLeave={(e) =>
            Object.assign(e.currentTarget.style, {
              transform: "none",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            })
          }
        >
          <div style={cardStyles.cardContent}>
            <div>
              <h5 style={cardStyles.title}>{supplier.name}</h5>
              {supplier.email && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdEmail style={{ color: "#0d47a1", flexShrink: 0 }} /> {supplier.email}
                </p>
              )}
              {supplier.phone && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdPhone style={{ color: "#00897b", flexShrink: 0 }} /> {supplier.phone}
                </p>
              )}
              {supplier.address && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdLocationOn style={{ color: "#5f6d7e", flexShrink: 0 }} /> {supplier.address}
                </p>
              )}
              {supplier.ntn && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>NTN:</strong> {supplier.ntn}
                </p>
              )}
              {supplier.strn && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>STRN:</strong> {supplier.strn}
                </p>
              )}
              {supplier.registrationType && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>Type:</strong> {supplier.registrationType}
                </p>
              )}
              {supplier.hasPurchaseBills && (
                <p style={{ ...cardStyles.text, fontSize: "0.74rem", color: "#00695c", marginTop: "0.25rem" }}>
                  has purchase bills
                </p>
              )}
            </div>
            {(canUpdate || canDelete || canCopy || canStatement) && (
              <div style={cardStyles.buttonGroup}>
                {canUpdate && (
                  <button
                    style={{ ...cardStyles.button, ...cardStyles.edit, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => onEdit(supplier)}
                  >
                    <MdEdit /> Edit
                  </button>
                )}
                {canStatement && (
                  <button
                    type="button"
                    style={{ ...cardStyles.button, backgroundColor: "#e0f2f1", color: "#00695c", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => openStatement(supplier)}
                    title="Open this supplier's statement"
                  >
                    <MdReceiptLong /> Statement
                  </button>
                )}
                {canCopy && onCopy && (
                  <button
                    style={{ ...cardStyles.button, backgroundColor: "#ede7f6", color: "#4527a0", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => onCopy(supplier)}
                    title="Copy this supplier into another company"
                  >
                    <MdContentCopy /> Copy
                  </button>
                )}
                {canDelete && (
                  <button
                    style={{
                      ...cardStyles.button, ...cardStyles.delete,
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      opacity: supplier.hasPurchaseBills ? 0.5 : 1,
                      cursor: supplier.hasPurchaseBills ? "not-allowed" : "pointer",
                    }}
                    title={supplier.hasPurchaseBills ? "Has purchase bills — delete those first" : "Delete supplier"}
                    onClick={() => handleDelete(supplier)}
                  >
                    <MdDelete /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
