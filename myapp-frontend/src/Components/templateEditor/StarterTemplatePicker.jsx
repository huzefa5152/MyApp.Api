import { useState } from "react";
import { MdClose, MdDescription, MdReceipt, MdLocalShipping } from "react-icons/md";
import { STARTER_TEMPLATES } from "../../utils/starterTemplates";

const TYPE_ICONS = {
  Challan: MdLocalShipping,
  Bill: MdReceipt,
  TaxInvoice: MdDescription,
};

const TYPE_COLORS = {
  Challan: "#1565c0",
  Bill: "#7b1fa2",
  TaxInvoice: "#2e7d32",
};

export default function StarterTemplatePicker({ templateType, onSelect, onClose }) {
  const [hoveredId, setHoveredId] = useState(null);

  const templates = STARTER_TEMPLATES.filter(
    (t) => !templateType || t.type === templateType
  );

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <h3 style={s.title}>Start from Template</h3>
          <button style={s.closeBtn} onClick={onClose}><MdClose size={20} /></button>
        </div>
        <p style={s.subtitle}>Choose a starter template to begin customizing</p>

        <div style={s.grid}>
          {templates.map((t) => {
            const Icon = TYPE_ICONS[t.type] || MdDescription;
            const color = TYPE_COLORS[t.type] || "#333";
            const isHovered = hoveredId === t.id;
            return (
              <button
                key={t.id}
                style={{ ...s.card, ...(isHovered ? s.cardHover : {}), borderColor: isHovered ? color : "#e0e0e0" }}
                onClick={() => onSelect(t)}
                onMouseEnter={() => setHoveredId(t.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div style={{ ...s.iconCircle, background: color + "18", color }}>
                  <Icon size={24} />
                </div>
                <div style={s.cardName}>{t.name}</div>
                <div style={{ ...s.typeBadge, background: color + "14", color }}>{t.type}</div>
                <div style={s.cardDesc}>{t.description}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 10000, backdropFilter: "blur(2px)",
  },
  modal: {
    background: "#fff", borderRadius: 14, width: "90%", maxWidth: 680,
    maxHeight: "85vh", overflow: "auto", padding: "1.5rem",
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  title: {
    margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "#1a2332",
  },
  closeBtn: {
    border: "none", background: "transparent", cursor: "pointer",
    color: "#888", padding: 4, borderRadius: 6,
  },
  subtitle: {
    margin: "0.25rem 0 1.25rem", fontSize: "0.85rem", color: "#5f6d7e",
  },
  grid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "0.75rem",
  },
  card: {
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "1.25rem 1rem", borderRadius: 10, border: "2px solid #e0e0e0",
    background: "#fff", cursor: "pointer", transition: "all 0.2s",
    textAlign: "center",
  },
  cardHover: {
    transform: "translateY(-2px)", boxShadow: "0 6px 20px rgba(0,0,0,0.1)",
  },
  iconCircle: {
    width: 48, height: 48, borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    marginBottom: 8,
  },
  cardName: {
    fontSize: "0.92rem", fontWeight: 700, color: "#1a2332", marginBottom: 4,
  },
  typeBadge: {
    fontSize: "0.68rem", fontWeight: 600, padding: "2px 8px", borderRadius: 4,
    textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6,
  },
  cardDesc: {
    fontSize: "0.78rem", color: "#5f6d7e", lineHeight: 1.4,
  },
};
