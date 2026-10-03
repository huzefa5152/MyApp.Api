import { formStyles } from "../theme";
import { useId } from "react";
import { Field } from "../ui/Kit";

export default function TaxInvoiceGrouping({ value, onChange, disabled = false, companyDefault = false }) {
  const id = useId();
  return (
    <div style={{ marginBottom: formStyles.formGroup.marginBottom, minWidth: 0 }}>
      <Field
        htmlFor={id}
        label={companyDefault ? "Default Sales Tax Invoice layout" : "Sales Tax Invoice layout"}
        hint={<>
          {companyDefault ? "Default for new bills only. " : "Applies to Invoice View, print, PDF and Excel. "}
          Grouped rows sum quantity and value; unit price is value ÷ quantity. Different units or tax classifications remain separate.
        </>}
      >
        <select id={id} className="k-select"
          value={value ? "grouped" : "individual"} disabled={disabled}
          onChange={(e) => onChange(e.target.value === "grouped")}>
          <option value="individual">Individual lines</option>
          <option value="grouped">Grouped by Item Type</option>
        </select>
      </Field>
    </div>
  );
}
