import { MdViewModule, MdViewList } from "react-icons/md";

// Segmented control: Card / Table. Pure presentational — parent owns the
// state (typically a useUiPreference call so the choice persists per screen).
export default function ViewModeToggle({ mode, onChange, ariaLabel = "View mode" }) {
  return (
    <div className="admin-view-mode" role="tablist" aria-label={ariaLabel} style={styles.group}>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "card"}
        onClick={() => onChange("card")}
        style={{ ...styles.btn, ...(mode === "card" ? styles.btnActive : styles.btnIdle) }}
        aria-label="Cards"
        title="Card view — visual cards with full details per record"
      >
        <MdViewModule size={18} />
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "table"}
        onClick={() => onChange("table")}
        style={{ ...styles.btn, ...(mode === "table" ? styles.btnActive : styles.btnIdle) }}
        aria-label="Table"
        title="Table view — dense rows for fast scanning of many records"
      >
        <MdViewList size={18} />
      </button>
    </div>
  );
}

const styles = {
  group: {
    display: "inline-flex",
    flex: "none",
    borderRadius: 8,
    border: "1px solid #d5dde8",
    backgroundColor: "#f5f8fc",
    padding: 2,
    gap: 2,
  },
  btn: {
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 30,
    padding: 0,
    borderRadius: 6,
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
};
