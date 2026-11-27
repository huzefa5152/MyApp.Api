import { useId, useState } from "react";
import { formStyles } from "../theme";
import { usePermissions } from "../contexts/PermissionsContext";

const NEW = "__new_site__";

/** A customer's sites, from Client.site (";"-separated). */
export const splitSites = (raw) =>
  (raw || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The one Site / Department picker, used wherever a customer document takes a
 * site: challan (create, edit, from an order), sales order, PO import and the
 * bills. A dropdown of the customer's own sites with "+ Add a new site…", or a
 * text box when the customer has none. A site the document already holds that
 * is no longer in the list stays selectable, so an edit never drops it.
 *
 * A new site is saved to the customer's list by the server when the document is
 * saved (CustomerSiteMemory), for users who may edit customers; the field reads
 * the same permission to say which will happen.
 *
 * Without `label` it renders just the control and its note, for a parent that
 * supplies the label (the kit's <Field>). With `label` it renders its own
 * label and group (the bill forms).
 */
export default function SiteField({
  value,
  onChange,
  clientSites,
  label,
  readOnly = false,
  disabled = false,
  noClientText = "Pick a client first",
}) {
  const id = useId();
  const { has } = usePermissions();
  const remembers = has("clients.manage.update");
  const [typing, setTyping] = useState(false);
  const current = value || "";
  const sites = splitSites(clientSites);
  const options = current && !sites.includes(current) && !typing ? [current, ...sites] : sites;
  const isNew =
    !!current.trim() && !sites.some((s) => s.toLowerCase() === current.trim().toLowerCase());
  // ";" separates a customer's sites, so it cannot be part of one.
  const type = (v) => onChange(v.replace(/;/g, ","));
  const pickFromList = options.length > 0 && !typing;
  const own = label ? { ...formStyles.input, width: "100%", boxSizing: "border-box" } : undefined;

  const control = pickFromList ? (
    <select
      id={id}
      className="k-select"
      value={current}
      onChange={(e) => {
        if (e.target.value === NEW) {
          setTyping(true);
          onChange("");
        } else onChange(e.target.value);
      }}
      disabled={readOnly || disabled}
      style={own}
    >
      <option value="">(none)</option>
      {options.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
      {!readOnly && <option value={NEW}>+ Add a new site…</option>}
    </select>
  ) : (
    <input
      id={id}
      type="text"
      className="k-input"
      maxLength={200}
      value={current}
      onChange={(e) => type(e.target.value)}
      readOnly={readOnly}
      disabled={disabled}
      autoFocus={typing}
      placeholder={disabled ? noClientText : typing ? "Type the new site" : "Optional"}
      style={own}
    />
  );

  const note = !pickFromList && !readOnly && !disabled && (isNew || typing) && (
    <small style={{ display: "block", marginTop: 4, fontSize: 12 }}>
      {isNew &&
        (remembers
          ? "Added to this customer's sites when you save, so it is in the list next time."
          : "Kept on this document. Someone who can edit customers can add it to their sites.")}
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
  );

  if (!label)
    return (
      <>
        {control}
        {note}
      </>
    );
  return (
    <div style={{ ...formStyles.formGroup, minWidth: 0 }}>
      <label htmlFor={id} style={formStyles.label}>
        {label}
      </label>
      {control}
      {note}
    </div>
  );
}
