import { useId } from "react";
import { formStyles } from "../theme";

export default function ManualChallanNumberField({ value, onChange, readOnly = false }) {
  const id = useId();
  return <div style={{ ...formStyles.formGroup, minWidth: 0 }}>
    <label htmlFor={id} style={formStyles.label}>Delivery challan number (optional)</label>
    <input id={id} type="text" maxLength={100} value={value} onChange={e => onChange(e.target.value)} readOnly={readOnly} style={{ ...formStyles.input, width: "100%", boxSizing: "border-box" }} placeholder="e.g. DC-212" />
    <small>Print reference only. This does not create a delivery challan or move stock.</small>
  </div>;
}
