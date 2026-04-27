import { MdEdit, MdDelete, MdReceipt, MdBusiness, MdPhone, MdLocationOn } from "react-icons/md";
import { deleteCompany } from "../api/companyApi";
import { notify } from "../utils/notify";
import { cardStyles, cardHover } from "../theme";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";

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
    <div className="card-grid">
      {companies.map((c) => (
        <div
          key={c.id}
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
              <h5 style={cardStyles.title}>{c.brandName || c.name}</h5>
              {c.brandName && c.brandName !== c.name && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdBusiness style={{ color: "#5f6d7e", flexShrink: 0 }} /> {c.name}
                </p>
              )}
              {c.fullAddress && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdLocationOn style={{ color: "#5f6d7e", flexShrink: 0 }} /> {c.fullAddress}
                </p>
              )}
              {c.phone && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdPhone style={{ color: "#00897b", flexShrink: 0 }} /> {c.phone}
                </p>
              )}
              {c.ntn && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>NTN:</strong> {c.ntn}
                </p>
              )}
              {c.cnic && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>CNIC:</strong> {c.cnic}
                </p>
              )}
              {c.strn && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>STRN:</strong> {c.strn}
                </p>
              )}
              {c.inventoryTrackingEnabled && (
                <p style={{ ...cardStyles.text, display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.15rem 0.55rem", marginTop: "0.25rem", borderRadius: 12, backgroundColor: "#e0f2f1", color: "#00695c", fontSize: "0.72rem", fontWeight: 700, width: "fit-content" }}>
                  ✓ Inventory tracking ON
                </p>
              )}
              <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <MdReceipt style={{ color: "#0d47a1", flexShrink: 0 }} />
                <strong>Challan #:</strong> Starts at {c.startingChallanNumber}{c.currentChallanNumber > 0 ? ` → Current: #${c.currentChallanNumber}` : ""}
              </p>
              <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <MdReceipt style={{ color: "#00897b", flexShrink: 0 }} />
                <strong>Invoice #:</strong> Starts at {c.startingInvoiceNumber}{c.currentInvoiceNumber > 0 ? ` → Current: #${c.currentInvoiceNumber}` : ""}
              </p>
              {c.logoPath && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", padding: "0.4rem 0.6rem", backgroundColor: "#f8f9fb", borderRadius: 8, border: "1px solid #e8edf3", width: "fit-content" }}>
                  <img src={c.logoPath} alt="Company Logo" style={{ height: "36px", borderRadius: 4, objectFit: "contain" }} />
                  <span style={{ fontSize: "0.75rem", color: "#5f6d7e", fontWeight: 500 }}>Company Logo</span>
                </div>
              )}
            </div>
            {(canUpdate || canDelete) && (
              <div style={cardStyles.buttonGroup}>
                {canUpdate && (
                  <button
                    style={{ ...cardStyles.button, ...cardStyles.edit, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => onEdit(c)}
                    onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.08)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
                  >
                    <MdEdit /> Edit
                  </button>
                )}
                {canDelete && (
                  <button
                    style={{ ...cardStyles.button, ...cardStyles.delete, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => handleDelete(c.id)}
                    onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(0.95)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
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
