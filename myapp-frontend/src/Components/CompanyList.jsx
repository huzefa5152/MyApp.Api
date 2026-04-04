import { MdEdit, MdDelete, MdReceipt } from "react-icons/md";
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
              <h5 style={cardStyles.title}>{c.name}</h5>
              <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <MdReceipt style={{ color: "#0d47a1", flexShrink: 0 }} />
                <strong>Starting Challan:</strong> {c.startingChallanNumber}
              </p>
              <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <MdReceipt style={{ color: "#00897b", flexShrink: 0 }} />
                <strong>Current Challan:</strong> {c.currentChallanNumber}
              </p>
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
