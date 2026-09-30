import { formStyles } from "../theme";
import { useId } from "react";

export default function TaxInvoiceGrouping({ value, onChange, disabled = false, companyDefault = false }) {
  const id = useId();
  return (
    <div style={{ ...formStyles.formGroup, minWidth: 0 }}>
      <label htmlFor={id} style={formStyles.label}>
        {companyDefault ? "Default Sales Tax Invoice layout" : "Sales Tax Invoice layout"}
      </label>
        <select id={id} style={{ ...formStyles.input, display: "block", width: "100%", minHeight: 44 }}
          value={value ? "grouped" : "individual"} disabled={disabled}
          onChange={(e) => onChange(e.target.value === "grouped")}>
          <option value="individual">Individual lines</option>
          <option value="grouped">Grouped by Item Type</option>
        </select>
      <small>{companyDefault ? "Default for new bills only. " : "Applies to Invoice View, print, PDF and Excel. "}
        Grouped rows sum quantity and value; unit price is value ÷ quantity. Different units or tax classifications remain separate.
      </small>
    </div>
  );
}
