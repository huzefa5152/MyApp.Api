import { MdContentCopy } from "react-icons/md";
import { colors } from "../theme";

/**
 * The "copy this line" button on a document's item rows: one look on every
 * form (bill, standalone bill, purchase bill, goods receipt, order, quote).
 * An icon the size of the row's Remove button, in the brand teal rather than
 * Remove's red; the words are its accessible name and tooltip. A touch screen
 * gets a full 44px target from Motion.css (`.copy-line-btn`).
 */
export default function CopyLineButton({ onClick, disabled = false, title = "Copy line", style }) {
  return (
    <button type="button" className="copy-line-btn" style={{ ...base, ...style }} onClick={onClick} disabled={disabled} title={title} aria-label={title}>
      <MdContentCopy size={15} aria-hidden="true" />
    </button>
  );
}

const base = {
  display: "inline-grid", placeItems: "center", width: 34, height: 34, minWidth: 34, minHeight: 34, padding: 0, margin: 0,
  verticalAlign: "middle", flexShrink: 0, borderRadius: 8, cursor: "pointer", boxShadow: "none",
  border: `1px solid ${colors.teal}40`, backgroundColor: `${colors.teal}12`, color: colors.teal,
};
