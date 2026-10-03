import { MdEdit, MdDelete } from "react-icons/md";
import { deleteCompany } from "../api/companyApi";
import { notify } from "../utils/notify";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { Button, Facts } from "../ui/Kit";

export default function CompanyList({ companies, onEdit, fetchCompanies }) {
  const confirm = useConfirm();
  const { has } = usePermissions();
  const canUpdate = has("companies.manage.update");
  const canDelete = has("companies.manage.delete");

  const handleDelete = async (id) => {
    const ok = await confirm({ title: "Delete Company?", message: "Are you sure you want to delete this company? This action cannot be undone.", variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    try {
      await deleteCompany(id);
      fetchCompanies();
    } catch {
      notify("Failed to delete company.", "error");
    }
  };

  return (
    <div className="k-grid-cards">
      {companies.map((c) => (
        <article key={c.id} className="k-card" style={styles.card}>
          <div className="k-card__body" style={styles.body}>
            <h3 style={styles.name} title={c.brandName || c.name}>{c.brandName || c.name}</h3>
            {c.inventoryTrackingEnabled && (
              <span style={styles.badge}>✓ Inventory tracking ON</span>
            )}
            <Facts
              facts={[
                c.brandName && c.brandName !== c.name && ["Name", c.name],
                c.fullAddress && ["Address", c.fullAddress],
                c.phone && ["Phone", c.phone],
                c.ntn && ["NTN", c.ntn],
                c.cnic && ["CNIC", c.cnic],
                c.strn && ["STRN", c.strn],
                ["Challan #", `Starts at ${c.startingChallanNumber}${c.currentChallanNumber > 0 ? ` → Current: #${c.currentChallanNumber}` : ""}`],
                ["Invoice #", `Starts at ${c.startingInvoiceNumber}${c.currentInvoiceNumber > 0 ? ` → Current: #${c.currentInvoiceNumber}` : ""}`],
              ]}
            />
            {c.logoPath && (
              <div style={styles.logo}>
                <img src={c.logoPath} alt="Company Logo" style={{ height: "36px", borderRadius: 4, objectFit: "contain" }} />
                <span style={{ fontSize: "var(--k-font-sm)", color: "var(--k-muted)", fontWeight: 500 }}>Company Logo</span>
              </div>
            )}
            {(canUpdate || canDelete) && (
              <div style={styles.actions}>
                {canUpdate && (
                  <Button variant="primary" icon={MdEdit} onClick={() => onEdit(c)}>Edit</Button>
                )}
                {canDelete && (
                  <Button variant="danger" icon={MdDelete} onClick={() => handleDelete(c.id)}>Delete</Button>
                )}
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

// Shared entity-card layout (same shape as ClientList): name, labelled facts, action row.
const styles = {
  // marginTop: 0 cancels the kit's `.k-card + .k-card` stacking gap inside the grid.
  card: { display: "flex", flexDirection: "column", overflow: "hidden", marginTop: 0 },
  body: { flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem" },
  name: {
    margin: 0, fontSize: "calc(var(--k-font) + 0.22rem)", fontWeight: 800, lineHeight: 1.3, letterSpacing: "-0.01em", color: "var(--k-ink)",
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere",
  },
  badge: {
    display: "inline-flex", alignItems: "center", gap: "0.3rem", width: "fit-content", padding: "0.15rem 0.55rem", borderRadius: 12,
    backgroundColor: "#e0f2f1", color: "#00695c", fontSize: "0.72rem", fontWeight: 700,
  },
  logo: {
    display: "flex", alignItems: "center", gap: "0.5rem", width: "fit-content", padding: "0.4rem 0.6rem",
    backgroundColor: "var(--k-surface-2)", borderRadius: 8, border: "1px solid var(--k-line)",
  },
  actions: { display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "auto", paddingTop: "0.75rem", borderTop: "1px solid var(--k-line)" },
};
