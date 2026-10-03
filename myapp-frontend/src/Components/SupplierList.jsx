import { MdEmail, MdPhone, MdLocationOn, MdEdit, MdDelete, MdContentCopy } from "react-icons/md";
import { deleteSupplier } from "../api/supplierApi";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { Facts, Button } from "../ui/Kit";

export default function SupplierList({ suppliers, onEdit, onCopy, fetchSuppliers }) {
  const confirm = useConfirm();
  const { has } = usePermissions();
  const canUpdate = has("suppliers.manage.update");
  const canDelete = has("suppliers.manage.delete");
  const canCopy = has("suppliers.manage.copy");

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
    <div className="k-grid-cards">
      {suppliers.map((supplier) => (
        <section key={supplier.id} className="k-card" style={styles.card}>
          <div className="k-card__body" style={styles.body}>
          <h3 style={styles.name}>{supplier.name}</h3>
          {supplier.email && (
            <p style={styles.line}>
              <MdEmail style={{ color: "var(--k-blue)", flexShrink: 0 }} /> {supplier.email}
            </p>
          )}
          {supplier.phone && (
            <p style={styles.line}>
              <MdPhone style={{ color: "var(--k-teal)", flexShrink: 0 }} /> {supplier.phone}
            </p>
          )}
          {supplier.address && (
            <p style={styles.line}>
              <MdLocationOn style={{ color: "var(--k-muted)", flexShrink: 0 }} /> {supplier.address}
            </p>
          )}
          {(supplier.ntn || supplier.strn || supplier.registrationType) && (
            <div style={{ marginTop: "0.5rem" }}>
              <Facts
                facts={[
                  supplier.ntn && ["NTN", supplier.ntn],
                  supplier.strn && ["STRN", supplier.strn],
                  supplier.registrationType && ["Type", supplier.registrationType],
                ]}
              />
            </div>
          )}
          {supplier.hasPurchaseBills && (
            <p style={styles.note}>has purchase bills</p>
          )}
          {(canUpdate || canDelete || canCopy) && <span style={styles.push} aria-hidden="true" />}
          {(canUpdate || canDelete || canCopy) && (
            <div style={styles.actions}>
              {canUpdate && (
                <Button variant="primary" size="sm" icon={MdEdit} onClick={() => onEdit(supplier)}>Edit</Button>
              )}
              {canCopy && onCopy && (
                <Button size="sm" icon={MdContentCopy} onClick={() => onCopy(supplier)} title="Copy this supplier into another company">
                  Copy
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="danger"
                  size="sm"
                  icon={MdDelete}
                  style={supplier.hasPurchaseBills ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                  title={supplier.hasPurchaseBills ? "Has purchase bills — delete those first" : "Delete supplier"}
                  onClick={() => handleDelete(supplier)}
                >
                  Delete
                </Button>
              )}
            </div>
          )}
          </div>
        </section>
      ))}
    </div>
  );
}

// Card-specific layout; colours and sizes come from the kit tokens.
const styles = {
  card: { margin: 0 },
  // Column body so the action row sits at the bottom of every card in a grid row.
  body: { display: "flex", flexDirection: "column", height: "100%", boxSizing: "border-box" },
  name: { margin: "0 0 0.5rem", fontSize: "calc(var(--k-font) + 0.15rem)", fontWeight: 800, color: "var(--k-ink)", lineHeight: 1.3, overflowWrap: "anywhere" },
  line: { display: "flex", alignItems: "center", gap: "0.4rem", margin: "0 0 0.2rem", fontSize: "var(--k-font)", color: "var(--k-muted)", lineHeight: 1.5, overflowWrap: "anywhere" },
  note: { margin: "0.4rem 0 0", fontSize: "0.74rem", color: "#00695c" },
  push: { flex: "1 0 0.9rem" },
  actions: { display: "flex", flexWrap: "wrap", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--k-line)" },
};
