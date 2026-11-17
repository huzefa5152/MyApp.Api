import { MdViewModule, MdViewList } from "react-icons/md";
import "../ui/kit.css";
import "../ui/shared-components.css";

// Segmented control: Card / Table. Pure presentational — parent owns the
// state (typically a useUiPreference call so the choice persists per screen).
// Look: .sc-seg / .sc-seg__btn in ui/shared-components.css (theme tokens).
export default function ViewModeToggle({ mode, onChange, ariaLabel = "View mode" }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="sc-seg admin-view-mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "card"}
        onClick={() => onChange("card")}
        className="sc-seg__btn"
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
        className="sc-seg__btn"
        aria-label="Table"
        title="Table view — dense rows for fast scanning of many records"
      >
        <MdViewList size={18} />
      </button>
    </div>
  );
}
