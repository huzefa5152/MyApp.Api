import { colors, formStyles } from "../theme";

export default function FreightChargesField({ value, onChange, disabled = false }) {
  return (
    <div style={{ marginTop: 16, maxWidth: 420, width: "100%", minWidth: 0 }}>
      <label style={{ display: "grid", gap: 6, color: colors.textPrimary }}>
        <span>Freight / cartage charges (PKR)</span>
        <input type="number" min="0" step="0.01" inputMode="decimal"
          value={value ?? 0} disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...formStyles.input, width: "100%", minHeight: 44, boxSizing: "border-box" }} />
      </label>
      <p style={{ color: colors.textSecondary, fontSize: "0.8rem", margin: "6px 0" }}>
        Added to the commercial bill and amount owed. Sales tax stays unchanged.
      </p>
    </div>
  );
}
