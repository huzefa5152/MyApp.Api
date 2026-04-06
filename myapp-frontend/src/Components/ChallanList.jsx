import { useState } from "react";
import { MdReceipt, MdPerson, MdCalendarToday, MdVisibility, MdEdit, MdCancel, MdDelete, MdPrint, MdPictureAsPdf, MdGridOn } from "react-icons/md";
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

const statusColors = {
  Pending: { bg: "#fff3e0", color: "#e65100", border: "#e6510030" },
  Invoiced: { bg: "#e8f5e9", color: "#2e7d32", border: "#2e7d3230" },
  Cancelled: { bg: "#ffebee", color: "#c62828", border: "#c6282830" },
};

export default function ChallanList({ challans, onCancel, onDelete, onPrint, onEditItems, onExportPdf, onExportExcel, exportingId }) {
  const [selectedChallan, setSelectedChallan] = useState(null);

  if (!challans || challans.length === 0) return null;

  return (
    <>
      <div className="card-grid">
        {challans.map((c) => {
          const sc = statusColors[c.status] || statusColors.Pending;
          const isPending = c.status === "Pending";
          return (
            <div
              key={c.id}
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
                    <span style={{ ...styles.statusBadge, backgroundColor: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                      {c.status}
                    </span>
                  </div>

                  <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <MdPerson style={{ color: colors.teal, flexShrink: 0 }} />
                    <strong>Client:</strong> {c.clientName}
                  </p>
                  <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <MdReceipt style={{ color: colors.textSecondary, flexShrink: 0 }} />
                    <strong>PO:</strong> {c.poNumber || "\u2014"}
                  </p>
                  {c.deliveryDate && (
                    <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <MdCalendarToday size={14} style={{ color: colors.textSecondary, flexShrink: 0 }} />
                      {new Date(c.deliveryDate).toLocaleDateString()}
                    </p>
                  )}
                  <p style={{ ...cardStyles.text, fontSize: "0.78rem", color: colors.textSecondary }}>
                    {c.items?.length || 0} item{(c.items?.length || 0) !== 1 ? "s" : ""}
                  </p>
                </div>

                <div style={{ ...cardStyles.buttonGroup, flexWrap: "wrap" }}>
                  <button
                    style={{ ...styles.actionBtn, ...styles.viewBtn }}
                    onClick={() => setSelectedChallan(c)}
                  >
                    <MdVisibility size={14} /> View
                  </button>
                  <button
                    style={{ ...styles.actionBtn, ...styles.printBtn }}
                    onClick={() => onPrint?.(c)}
                  >
                    <MdPrint size={14} /> Print
                  </button>
                  <button
                    style={{ ...styles.actionBtn, ...styles.pdfBtn, opacity: exportingId ? 0.5 : 1 }}
                    disabled={!!exportingId}
                    onClick={() => onExportPdf?.(c)}
                  >
                    {exportingId === c.id + "-pdf" ? <span className="btn-spinner" /> : <MdPictureAsPdf size={14} />} PDF
                  </button>
                  {onExportExcel && (
                    <button
                      style={{ ...styles.actionBtn, ...styles.excelBtn, opacity: exportingId ? 0.5 : 1 }}
                      disabled={!!exportingId}
                      onClick={() => onExportExcel(c)}
                    >
                      {exportingId === c.id + "-excel" ? <span className="btn-spinner" /> : <MdGridOn size={14} />} Excel
                    </button>
                  )}
                  {isPending && (
                    <>
                      <button
                        style={{ ...styles.actionBtn, ...styles.editBtn }}
                        onClick={() => onEditItems?.(c)}
                      >
                        <MdEdit size={14} /> Edit
                      </button>
                      <button
                        style={{ ...styles.actionBtn, ...styles.cancelBtn }}
                        onClick={() => onCancel?.(c)}
                      >
                        <MdCancel size={14} /> Cancel
                      </button>
                      <button
                        style={{ ...styles.actionBtn, ...styles.deleteBtn }}
                        onClick={() => onDelete?.(c)}
                      >
                        <MdDelete size={14} /> Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

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
  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "0.72rem",
    fontWeight: 700,
    padding: "0.2rem 0.65rem",
    borderRadius: 20,
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  actionBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.3rem 0.6rem",
    borderRadius: 6,
    border: "none",
    fontSize: "0.76rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "filter 0.2s",
  },
  viewBtn: { backgroundColor: "#e3f2fd", color: "#0d47a1" },
  printBtn: { backgroundColor: "#f3e5f5", color: "#7b1fa2" },
  pdfBtn: { backgroundColor: "#ffebee", color: "#c62828" },
  excelBtn: { backgroundColor: "#e8f5e9", color: "#2e7d32" },
  editBtn: { backgroundColor: "#fff3e0", color: "#e65100" },
  cancelBtn: { backgroundColor: "#fce4ec", color: "#c62828" },
  deleteBtn: { backgroundColor: "#ffebee", color: "#b71c1c" },
};
