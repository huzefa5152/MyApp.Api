import { useId } from "react";
import { formStyles } from "../theme";

/**
 * Site / department of a standalone bill. Like the challan's Site field: a
 * dropdown of the client's own sites (Client.site, separated by ";"), and a
 * free-text box when the client has none. A site already saved on the bill
 * that is no longer in the client's list stays selectable, so an edit never
 * silently drops it.
 */
export default function BillSiteField({
  value,
  onChange,
  clientSites,
  readOnly = false,
  disabled = false,
}) {
  const id = useId();
  const sites = (clientSites || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const options = value && !sites.includes(value) ? [value, ...sites] : sites;
  const style = { ...formStyles.input, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ ...formStyles.formGroup, minWidth: 0 }}>
      <label htmlFor={id} style={formStyles.label}>
        Site / Department
      </label>
      {options.length > 0 ? (
        <select
          id={id}
          className="k-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly || disabled}
          style={style}
        >
          <option value="">(none)</option>
          {options.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="text"
          className="k-input"
          maxLength={200}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          disabled={disabled}
          placeholder={disabled ? "Pick a client first" : "Optional"}
          style={style}
        />
      )}
    </div>
  );
}
