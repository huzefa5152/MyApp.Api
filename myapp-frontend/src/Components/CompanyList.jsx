import { deleteCompany } from "../api/companyApi";
import { cardStyles, cardHover, buttonHover } from "../theme";

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
        <div style={cardStyles.grid}>
            {companies.map((c) => (
                <div
                    key={c.id}
                    style={cardStyles.card}
                    onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
                    onMouseLeave={(e) =>
                        Object.assign(e.currentTarget.style, {
                            transform: "none",
                            boxShadow: "0 6px 15px rgba(0,0,0,0.2)",
                        })
                    }
                >
                    <div style={cardStyles.cardContent}>
                        <div>
                            <h5 style={cardStyles.title}>{c.name}</h5>
                            <p style={cardStyles.text}>
                                <strong>Starting Challan:</strong> {c.startingChallanNumber}
                            </p>
                            <p style={cardStyles.text}>
                                <strong>Current Challan:</strong> {c.currentChallanNumber}
                            </p>
                        </div>
                        <div style={cardStyles.buttonGroup}>
                            <button
                                style={{ ...cardStyles.button, ...cardStyles.edit }}
                                onClick={() => onEdit(c)}
                                onMouseEnter={(e) => Object.assign(e.currentTarget.style, buttonHover)}
                                onMouseLeave={(e) => Object.assign(e.currentTarget.style, { filter: "none" })}
                            >
                                Edit
                            </button>
                            <button
                                style={{ ...cardStyles.button, ...cardStyles.delete }}
                                onClick={() => handleDelete(c.id)}
                                onMouseEnter={(e) => Object.assign(e.currentTarget.style, buttonHover)}
                                onMouseLeave={(e) => Object.assign(e.currentTarget.style, { filter: "none" })}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
