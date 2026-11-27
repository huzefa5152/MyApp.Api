import { useId, useState } from "react";
import { formStyles } from "../theme";

const NEW = "__new_site__";

/**
 * Site / department of a standalone bill. Like the challan's Site field: a
 * dropdown of the client's own sites (Client.site, separated by ";"), with
 * "Add a new site" for one that is not in the list, and a free-text box when
 * the client has none. A site already saved on the bill that is no longer in
 * the client's list stays selectable, so an edit never silently drops it.
 *
 * `remembers`: the user may edit customers, so a new site is added to the
 * customer's list when the bill is saved (InvoicesController.RememberSiteAsync).
 */
export default function BillSiteField({
  value,
  onChange,
  clientSites,
  readOnly = false,
  disabled = false,
  remembers = false,
}) {
  const id = useId();
  const [typing, setTyping] = useState(false);
  const sites = (clientSites || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const options = value && !sites.includes(value) && !typing ? [value, ...sites] : sites;
  const style = { ...formStyles.input, width: "100%", boxSizing: "border-box" };
  const isNew =
    !!value.trim() && !sites.some((s) => s.toLowerCase() === value.trim().toLowerCase());
  // ";" separates a customer's sites, so it cannot be part of one.
  const type = (v) => onChange(v.replace(/;/g, ","));

  const pickFromList = options.length > 0 && !typing;

  return (
    <div style={{ ...formStyles.formGroup, minWidth: 0 }}>
      <label htmlFor={id} style={formStyles.label}>
        Site / Department
      </label>
      {pickFromList ? (
        <select
          id={id}
          className="k-select"
          value={value}
          onChange={(e) => {
            if (e.target.value === NEW) {
              setTyping(true);
              onChange("");
            } else onChange(e.target.value);
          }}
          disabled={readOnly || disabled}
          style={style}
        >
          <option value="">(none)</option>
          {options.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value={NEW}>+ Add a new site…</option>
        </select>
      ) : (
        <input
          id={id}
          type="text"
          className="k-input"
          maxLength={200}
          value={value}
          onChange={(e) => type(e.target.value)}
          readOnly={readOnly}
          disabled={disabled}
          autoFocus={typing}
          placeholder={disabled ? "Pick a client first" : typing ? "Type the new site" : "Optional"}
          style={style}
        />
      )}
      {!pickFromList && !readOnly && !disabled && (
        <small style={{ display: "block", marginTop: 4 }}>
          {isNew && remembers
            ? "Saved to this customer's sites with the bill, so it is in the list next time."
            : isNew
              ? "Kept on this bill. Ask someone who can edit customers to add it to their sites."
              : ""}
          {typing && sites.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setTyping(false);
                onChange("");
              }}
              style={{
                marginLeft: isNew ? 8 : 0,
                padding: 0,
                border: "none",
                background: "none",
                boxShadow: "none",
                color: "var(--k-primary, #0d47a1)",
                cursor: "pointer",
                font: "inherit",
                textDecoration: "underline",
              }}
            >
              Choose from the list
            </button>
          )}
        </small>
      )}
    </div>
  );
}
