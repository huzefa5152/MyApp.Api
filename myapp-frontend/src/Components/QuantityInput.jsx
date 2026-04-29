import { isDecimalUnit } from "../utils/formatQuantity";

/**
 * Shared quantity input for bill / challan / PO-import forms.
 *
 * Reacts to the picked UOM:
 *   - decimal-allowed UOM (KG, Liter, Carat) → step="0.0001", up to 4 places
 *   - integer-only UOM (Pcs, SET, Pair)      → step="1", whole numbers
 *
 * `units` is the array from /api/units (or the lookup search). The lookup
 * is case-insensitive on `name`. If the unit isn't in the table at all,
 * we err on the side of decimal-allowed so the operator doesn't lose
 * precision they meant to type.
 *
 * Value contract:
 *   - onChange receives the parsed Number (or "" while the user is typing
 *     an empty string). The form is responsible for clamping / defaulting
 *     before save — same as before.
 *   - For integer-only units, parseInt is used so "2.5" snaps to 2 and the
 *     server-side guard would reject it anyway.
 */
export default function QuantityInput({
  value,
  onChange,
  unit,
  units,
  disabled = false,
  style = {},
  placeholder,
  ...rest
}) {
  const allowsDecimal = isDecimalUnit(unit, units);

  return (
    <input
      type="number"
      min={allowsDecimal ? 0 : 1}
      step={allowsDecimal ? "0.0001" : "1"}
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange("");
        // Parse defensively — for integer-only UOMs we snap to int so a
        // determined user pasting "2.5 Pcs" gets 2 client-side too.
        // Server-side validation is the actual guard.
        const n = allowsDecimal ? parseFloat(raw) : parseInt(raw, 10);
        onChange(Number.isFinite(n) ? n : "");
      }}
      disabled={disabled}
      placeholder={placeholder}
      title={
        unit
          ? allowsDecimal
            ? `Decimal allowed for ${unit} (e.g. 12.5, 0.0004 — up to 4 places)`
            : `Whole numbers only for ${unit}`
          : undefined
      }
      style={style}
      {...rest}
    />
  );
}
