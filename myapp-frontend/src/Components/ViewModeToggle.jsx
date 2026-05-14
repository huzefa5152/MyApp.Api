import { MdViewModule, MdViewList } from "react-icons/md";

// Segmented control: Card / Table. Pure presentational — parent owns the
// state (typically a useUiPreference call so the choice persists per screen).
export default function ViewModeToggle({ mode, onChange, ariaLabel = "View mode" }) {
  return (
    <div role="tablist" aria-label={ariaLabel} style={styles.group}>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "card"}
        onClick={() => onChange("card")}
        style={{ ...styles.btn, ...(mode === "card" ? styles.btnActive : styles.btnIdle) }}
        title="Card view — visual cards with full details per record"
      >
        <MdViewModule size={16} />
        <span style={styles.label}>Cards</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "table"}
        onClick={() => onChange("table")}
        style={{ ...styles.btn, ...(mode === "table" ? styles.btnActive : styles.btnIdle) }}
        title="Table view — dense rows for fast scanning of many records"
      >
        <MdViewList size={16} />
        <span style={styles.label}>Table</span>
      </button>
    </div>
  );
}

const styles = {
  group: {
    display: "inline-flex",
    borderRadius: 10,
    border: "1px solid #d0d7e2",
    backgroundColor: "#f8f9fb",
    padding: 3,
    gap: 2,
  },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0.4rem 0.85rem",
    fontSize: "0.82rem",
    fontWeight: 600,
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    transition: "background-color 0.15s, color 0.15s, box-shadow 0.15s",
  },
  btnActive: {
    backgroundColor: "#fff",
    color: "#0d47a1",
    boxShadow: "0 1px 4px rgba(13,71,161,0.18)",
  },
  btnIdle: {
    backgroundColor: "transparent",
    color: "#5f6d7e",
  },
  label: {
    // Hide the label on very narrow screens so the icons alone remain;
    // the role="tab" / aria-label keep screen-reader semantics intact.
  },
};
