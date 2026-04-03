import { useState } from "react";
import { MdSearch, MdReceipt, MdPerson, MdCalendarToday, MdVisibility } from "react-icons/md";
import ChallanModal from "./ChallanModal";
import { cardStyles, cardHover } from "../theme";

const colors = {
  blue: "#0d47a1",
  blueLight: "#1565c0",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
  inputBg: "#f8f9fb",
  inputBorder: "#d0d7e2",
};

export default function ChallanList({ challans }) {
  const [selectedChallan, setSelectedChallan] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  if (!challans || challans.length === 0) return null;

  const filteredChallans = challans.filter((c) => {
    const term = searchTerm.toLowerCase();
    return (
      c.challanNumber.toString().includes(term) ||
      c.clientName.toLowerCase().includes(term) ||
      (c.poNumber && c.poNumber.toLowerCase().includes(term))
    );
  });

  return (
    <>
      {/* Search Bar */}
      {challans.length > 2 && (
        <div style={styles.searchWrapper}>
          <MdSearch size={18} style={styles.searchIcon} />
          <input
            type="text"
            style={styles.searchInput}
            placeholder="Search by Challan #, Client, or PO Number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      )}

      {/* Challan cards grid */}
      <div style={{ ...cardStyles.grid, maxHeight: "calc(100vh - 320px)", overflowY: "auto" }}>
        {filteredChallans.length === 0 && (
          <p style={{ color: colors.textSecondary, gridColumn: "1 / -1", textAlign: "center", padding: "2rem 0" }}>
            No matching challans found.
          </p>
        )}

        {filteredChallans.map((c) => (
          <div
            key={c.challanNumber}
            style={cardStyles.card}
            onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
            onMouseLeave={(e) =>
              Object.assign(e.currentTarget.style, { transform: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" })
            }
          >
            <div style={cardStyles.cardContent}>
              <div>
                <div style={styles.cardTopRow}>
                  <h5 style={cardStyles.title}>
                    <MdReceipt style={{ color: colors.blue, marginRight: 6, verticalAlign: "middle" }} />
                    Challan #{c.challanNumber}
                  </h5>
                  <span style={styles.dateBadge}>
                    <MdCalendarToday size={12} style={{ marginRight: 4 }} />
                    {new Date(c.deliveryDate).toLocaleDateString()}
                  </span>
                </div>

                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdPerson style={{ color: colors.teal, flexShrink: 0 }} />
                  <strong>Client:</strong> {c.clientName}
                </p>
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdReceipt style={{ color: colors.textSecondary, flexShrink: 0 }} />
                  <strong>PO:</strong> {c.poNumber || "—"}
                </p>
              </div>

              <div style={cardStyles.buttonGroup}>
                <button
                  style={{ ...cardStyles.button, ...cardStyles.edit, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                  onClick={() => setSelectedChallan(c)}
                  onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.08)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
                >
                  <MdVisibility /> View Details
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Detail Modal */}
      <ChallanModal challan={selectedChallan} onClose={() => setSelectedChallan(null)} />
    </>
  );
}

const styles = {
  searchWrapper: {
    position: "relative",
    marginBottom: "1.25rem",
    maxWidth: 420,
  },
  searchIcon: {
    position: "absolute",
    left: 12,
    top: "50%",
    transform: "translateY(-50%)",
    color: colors.textSecondary,
  },
  searchInput: {
    width: "100%",
    padding: "0.55rem 0.85rem 0.55rem 2.2rem",
    borderRadius: 10,
    border: `1px solid ${colors.inputBorder}`,
    backgroundColor: colors.inputBg,
    fontSize: "0.9rem",
    color: colors.textPrimary,
    outline: "none",
    transition: "border-color 0.25s, box-shadow 0.25s",
  },
  cardTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "0.5rem",
    marginBottom: "0.5rem",
  },
  dateBadge: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: colors.teal,
    backgroundColor: `${colors.teal}12`,
    padding: "0.2rem 0.6rem",
    borderRadius: 20,
    whiteSpace: "nowrap",
  },
};
