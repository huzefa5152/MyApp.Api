import { useState } from "react";
import { MdClose, MdDescription, MdReceipt, MdLocalShipping } from "react-icons/md";
import { STARTER_TEMPLATES } from "../../utils/starterTemplates";
// Pulled from shared formStyles so this picker matches every other popup —
// blurred backdrop, fixed centered modal, non-movable, standard z-index.
import { formStyles, modalSizes } from "../../theme";

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

  // Backdrop click is a no-op so a stray click can't drop the picker
  // before the operator commits to a starter template.
  return (
    <div data-admin-backdrop="" style={s.overlay}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="starter-picker-title">
        <div style={formStyles.header}>
          <h3 id="starter-picker-title" style={formStyles.title}>Start from Template</h3>
          <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={20} /></button>
        </div>
        <div style={formStyles.body}>
        <p style={s.subtitle}>Choose a starter template to begin customizing</p>

        <div style={s.grid}>
          {templates.map((t) => {
            const Icon = TYPE_ICONS[t.type] || MdDescription;
            const color = TYPE_COLORS[t.type] || "#333";
            const isHovered = hoveredId === t.id;
            return (
              <button
                type="button"
                key={t.id}
                style={{ ...s.card, ...(isHovered ? s.cardHover : {}), borderColor: isHovered ? color : "var(--k-line)" }}
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
    </div>
  );
}

// Dialog chrome from the shared formStyles (themed); card colours from the
// kit tokens (--k-*).
const s = {
  overlay: formStyles.backdrop,
  modal: {
    ...formStyles.modal,
    maxWidth: `${modalSizes.lg}px`,
  },
  subtitle: {
    margin: "0 0 1.25rem", fontSize: "var(--k-font)", color: "var(--k-muted)",
  },
  grid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))",
    gap: "0.75rem",
  },
  card: {
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "1.25rem 1rem", borderRadius: "var(--k-radius)", border: "2px solid var(--k-line)",
    background: "var(--k-surface)", cursor: "pointer", transition: "all 0.2s",
    textAlign: "center", boxShadow: "none",
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
    fontSize: "var(--k-font)", fontWeight: 700, color: "var(--k-ink)", marginBottom: 4,
  },
  typeBadge: {
    fontSize: "0.68rem", fontWeight: 600, padding: "2px 8px", borderRadius: 4,
    textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6,
  },
  cardDesc: {
    fontSize: "var(--k-font-sm)", color: "var(--k-muted)", lineHeight: 1.4,
  },
};
