import { MdCalculate } from "react-icons/md";
import { ENTRY_MODE } from "../utils/lineAmount";

/**
 * "I'll enter [Unit price] [Line total]" — which figure the operator types on
 * every line of the form. The other one is worked out and shown read-only
 * (CalculatedField), so a sale of 500 grams for 450 is typed as 0.5 and 450.
 */
export default function LineEntryModeSwitch({ mode, onChange, totalLabel = "Line total", disabled = false }) {
  const option = (value, label) => {
    const on = mode === value;
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={disabled}
        onClick={() => !on && onChange(value)}
        style={{ ...st.option, ...(on ? st.optionOn : null) }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={st.wrap} role="group" aria-label="Which figure you type on each line">
      <span style={st.lead}>I'll enter</span>
      <div style={st.seg}>
        {option(ENTRY_MODE.price, "Unit price")}
        {option(ENTRY_MODE.total, totalLabel)}
      </div>
    </div>
  );
}

/**
 * A worked-out figure in the place of an input: same size as the box beside
 * it, grey, marked with a calculator, skipped by Tab, and never editable — so
 * keyboard entry runs qty, unit, the one typed figure, next line.
 */
export function CalculatedField({ value, label, style }) {
  const empty = value === "" || value == null;
  return (
    <div
      role="status"
      aria-label={`${label} (calculated)`}
      title={`${label} is worked out from the other figures`}
      style={{ ...st.calc, ...style }}
    >
      <MdCalculate size={14} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }} />
      <span style={st.calcValue}>{empty ? "—" : value}</span>
    </div>
  );
}

const st = {
  wrap: { display: "inline-flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" },
  lead: { fontSize: "0.78rem", fontWeight: 600, color: "#5f6d7e", whiteSpace: "nowrap" },
  seg: { display: "inline-flex", border: "1px solid #d0d7e2", borderRadius: 8, overflow: "hidden", background: "#fff" },
  option: {
    minHeight: 44, padding: "0 0.75rem", margin: 0, border: "none", borderRadius: 0, boxShadow: "none",
    background: "transparent", color: "#5f6d7e", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },
  optionOn: { background: "#0d47a1", color: "#fff", cursor: "default" },
  calc: {
    display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, minHeight: 36, width: "100%",
    boxSizing: "border-box", padding: "0.45rem 0.55rem", borderRadius: 8, border: "1px dashed #c9d3e0",
    background: "#eef3fa", color: "#3d4a5c", fontSize: "0.88rem", fontVariantNumeric: "tabular-nums", userSelect: "text",
  },
  calcValue: { minWidth: 0, overflowWrap: "anywhere", textAlign: "right" },
};
