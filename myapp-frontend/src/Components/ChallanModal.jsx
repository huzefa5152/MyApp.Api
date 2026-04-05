import { MdPerson, MdReceipt, MdCalendarToday } from "react-icons/md";
import { formStyles } from "../theme";

const colors = {
  blue: "#0d47a1",
  teal: "#00897b",
  textPrimary: "#1a2332",
  textSecondary: "#5f6d7e",
  cardBorder: "#e8edf3",
};

export default function ChallanModal({ challan, onClose }) {
  if (!challan) return null;

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div
        style={{ ...formStyles.modal, maxWidth: 680, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>
            <MdReceipt size={18} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Challan #{challan.challanNumber} Details
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>

        {/* Body */}
        <div style={formStyles.body}>
          {/* Info row */}
          <div style={styles.infoGrid}>
            <div style={styles.infoItem}>
              <MdPerson size={16} color={colors.teal} />
              <div>
                <span style={styles.infoLabel}>Client</span>
                <span style={styles.infoValue}>{challan.clientName}</span>
              </div>
            </div>
            <div style={styles.infoItem}>
              <MdReceipt size={16} color={colors.blue} />
              <div>
                <span style={styles.infoLabel}>PO Number</span>
                <span style={styles.infoValue}>{challan.poNumber || "—"}</span>
              </div>
            </div>
            <div style={styles.infoItem}>
              <MdCalendarToday size={16} color={colors.textSecondary} />
              <div>
                <span style={styles.infoLabel}>Delivery Date</span>
                <span style={styles.infoValue}>
                  {new Date(challan.deliveryDate).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* Items table */}
          <div style={{ marginTop: "1.25rem" }}>
            <h6 style={{ fontWeight: 700, fontSize: "0.92rem", color: colors.textPrimary, marginBottom: "0.6rem" }}>
              Items ({challan.items.length})
            </h6>
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, width: 40 }}>#</th>
                    <th style={{ ...styles.th, width: 110 }}>Item Type</th>
                    <th style={styles.th}>Description</th>
                    <th style={{ ...styles.th, width: 70, textAlign: "center" }}>Qty</th>
                    <th style={{ ...styles.th, width: 90, textAlign: "center" }}>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {challan.items.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ ...styles.td, textAlign: "center", color: colors.textSecondary }}>{idx + 1}</td>
                      <td style={styles.td}>{item.itemTypeName || "—"}</td>
                      <td style={styles.td}>{item.description}</td>
                      <td style={{ ...styles.td, textAlign: "center", fontWeight: 600 }}>{item.quantity}</td>
                      <td style={{ ...styles.td, textAlign: "center" }}>{item.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={formStyles.footer}>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.cancel }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "1rem",
  },
  infoItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    padding: "0.75rem",
    backgroundColor: "#f8f9fb",
    borderRadius: 10,
    border: `1px solid ${colors.cardBorder}`,
  },
  infoLabel: {
    display: "block",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "0.3px",
  },
  infoValue: {
    display: "block",
    fontSize: "0.92rem",
    fontWeight: 600,
    color: colors.textPrimary,
    marginTop: "0.1rem",
  },
  tableWrapper: {
    maxHeight: 280,
    overflowY: "auto",
    borderRadius: 10,
    border: `1px solid ${colors.cardBorder}`,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.88rem",
  },
  th: {
    padding: "0.6rem 0.75rem",
    fontWeight: 700,
    fontSize: "0.78rem",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    color: colors.textSecondary,
    backgroundColor: "#f5f7fa",
    borderBottom: `2px solid ${colors.cardBorder}`,
    position: "sticky",
    top: 0,
    zIndex: 2,
  },
  td: {
    padding: "0.55rem 0.75rem",
    color: colors.textPrimary,
    borderBottom: `1px solid ${colors.cardBorder}`,
  },
};
