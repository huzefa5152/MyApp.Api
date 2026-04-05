import { MdEdit, MdDelete, MdReceipt, MdBusiness, MdPhone, MdLocationOn } from "react-icons/md";
import { deleteCompany } from "../api/companyApi";
import { cardStyles, cardHover } from "../theme";

export default function CompanyList({ companies, onEdit, fetchCompanies }) {
  const handleDelete = async (id) => {
    if (window.confirm("Are you sure you want to delete this company?")) {
      try {
        await deleteCompany(id);
        fetchCompanies();
      } catch {
        alert("Failed to delete company.");
      }
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
              {c.strn && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>STRN:</strong> {c.strn}
                </p>
              )}
              <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <MdReceipt style={{ color: "#0d47a1", flexShrink: 0 }} />
                <strong>Challan #:</strong> {c.startingChallanNumber}{c.currentChallanNumber > 0 ? ` → Current: #${c.currentChallanNumber}` : " (starting)"}
              </p>
              <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <MdReceipt style={{ color: "#00897b", flexShrink: 0 }} />
                <strong>Invoice #:</strong> {c.startingInvoiceNumber}{c.currentInvoiceNumber > 0 ? ` → Current: #${c.currentInvoiceNumber}` : " (starting)"}
              </p>
              {c.logoPath && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", padding: "0.4rem 0.6rem", backgroundColor: "#f8f9fb", borderRadius: 8, border: "1px solid #e8edf3", width: "fit-content" }}>
                  <img src={c.logoPath} alt="Company Logo" style={{ height: "36px", borderRadius: 4, objectFit: "contain" }} />
                  <span style={{ fontSize: "0.75rem", color: "#5f6d7e", fontWeight: 500 }}>Company Logo</span>
                </div>
              )}
            </div>
            <div style={cardStyles.buttonGroup}>
              <button
                style={{ ...cardStyles.button, ...cardStyles.edit, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                onClick={() => onEdit(c)}
                onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.08)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
              >
                <MdEdit /> Edit
              </button>
              <button
                style={{ ...cardStyles.button, ...cardStyles.delete, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                onClick={() => handleDelete(c.id)}
                onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(0.95)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
              >
                <MdDelete /> Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
