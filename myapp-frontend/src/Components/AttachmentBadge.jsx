import { MdAttachFile } from "react-icons/md";
import "../ui/shared-components.css";

// Small paperclip + count pill for document list cards / table rows. Renders
// NOTHING when count is falsy/0 (no "0 📎" clutter on files-less documents).
// Clickable (≥ 44px tap target) — onClick opens the attachments quick modal.
export default function AttachmentBadge({ count, onClick, title }) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      title={title || `${n} attachment${n !== 1 ? "s" : ""}`}
      style={st.badge}
    >
      <MdAttachFile size={14} />
      <span>{n}</span>
    </button>
  );
}

// Size tokens: Classic = these fallbacks; Workspace = ui/shared-components.css
// (a shorter chip; still 30px on touch screens).
const st = {
  badge: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3,
    minWidth: 44, minHeight: "var(--sc-chip-h, 30px)", padding: "0.2rem 0.55rem",
    borderRadius: 20, border: "1px solid #b9d4ff", background: "#e3f0ff",
    color: "var(--k-blue, #0d47a1)", fontSize: "var(--sc-badge-font, 0.74rem)", fontWeight: 700, cursor: "pointer",
    lineHeight: 1,
  },
};
