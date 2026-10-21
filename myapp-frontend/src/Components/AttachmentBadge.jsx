import { MdAttachFile } from "react-icons/md";

// Small paperclip + count pill for document list cards / table rows. Renders
// NOTHING when count is falsy/0 (no "0 📎" clutter on files-less documents).
// The button is a transparent 44×44 tap target around a compact pill; the
// negative vertical margin keeps row and card-header heights where they were.
// Clickable — onClick opens the attachments quick modal.
export default function AttachmentBadge({ count, onClick, title }) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  const label = title || `${n} attachment${n !== 1 ? "s" : ""}`;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      title={label}
      aria-label={label}
      style={st.hit}
    >
      <span style={st.pill}>
        <MdAttachFile size={14} />
        <span>{n}</span>
      </span>
    </button>
  );
}

const st = {
  // padding:0 / boxShadow:none override the global `button` rule in index.css.
  hit: {
    display: "inline-grid", placeItems: "center", padding: 0, margin: "-7px 0",
    minWidth: 44, minHeight: 44, border: "none", background: "transparent",
    boxShadow: "none", cursor: "pointer", flexShrink: 0, verticalAlign: "middle",
  },
  pill: {
    display: "inline-flex", alignItems: "center", gap: 3,
    padding: "0.2rem 0.55rem", borderRadius: 20, border: "1px solid #b9d4ff",
    background: "#e3f0ff", color: "#0d47a1", fontSize: "0.74rem", fontWeight: 700,
    lineHeight: 1,
  },
};
