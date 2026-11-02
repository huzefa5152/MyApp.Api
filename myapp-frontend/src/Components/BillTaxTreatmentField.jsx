import { colors, formStyles } from "../theme";
export default function BillTaxTreatmentField({ enabled, value = "FBR", onChange, rate, onRateChange, disabled = false }) {
  if (!enabled && value === "FBR") return null;
  return <div style={{ border: `1px solid ${colors.cardBorder}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))", gap: 12 }}>
      <label>Tax treatment<select aria-label="Tax treatment" value={value} disabled={disabled} onChange={e => onChange(e.target.value)} style={{ ...formStyles.input, display: "block", width: "100%", minHeight: 44, marginTop: 6 }}>
        <option value="FBR">FBR sales tax</option><option value="SRB" disabled={!enabled && value !== "SRB"}>SRB sales tax · Outside FBR</option><option value="NoTax" disabled={!enabled && value !== "NoTax"}>No tax · Outside FBR</option>
      </select></label>
      {value !== "FBR" && <label>{value === "SRB" ? "SRB sales tax" : "Tax"} rate (%)<input aria-label="Non-FBR tax rate" type="number" min="0" max="100" step="0.01" value={rate} disabled={disabled || value === "NoTax"} onChange={e => onRateChange(e.target.value)} style={{ ...formStyles.input, display: "block", width: "100%", minHeight: 44, marginTop: 6 }} /></label>}
    </div>
    {value !== "FBR" && <p style={{ color: colors.textSecondary, margin: "10px 0 0" }}>Included in balances. Not sent to FBR.</p>}
  </div>;
}
