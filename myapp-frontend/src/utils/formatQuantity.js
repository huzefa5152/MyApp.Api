// Quantity display formatter — used everywhere we print a quantity
// read-only (challan card, bill row, print templates, list pages).
//
// Rules:
//  • DB stores up to 4 decimal places (decimal(18,4)).
//  • Display shows the SHORTEST faithful representation, capped at 4
//    decimal places, with trailing zeros and trailing dot stripped:
//        12        → "12"
//        12.5      → "12.5"
//        12.50     → "12.5"
//        0.09      → "0.09"          (NOT "0.0900")
//        0.0004    → "0.0004"
//        12.555    → "12.555"        (3 places kept because there's signal)
//        12.5555   → "12.5555"
//  • For integer-only UOMs the value is rounded to a whole number.
//
// `units` is the array returned by /api/units (or the search variant). We
// look up the unit by name (case-insensitive) to decide whether decimals
// are even allowed; if the unit isn't in the table we default to allowing
// decimals so we don't lose precision the operator typed.

export function isDecimalUnit(unitName, units) {
  if (!unitName) return false;
  const cfg = units?.find(
    (u) => (u.name || "").toLowerCase() === unitName.toLowerCase()
  );
  return !!cfg?.allowsDecimalQuantity;
}

export function formatQuantity(qty, unitName, units) {
  const n = Number(qty || 0);
  if (!Number.isFinite(n)) return "0";

  // Integer-only UOM (or unknown unit): show the rounded whole number.
  // We still allow decimal representation through if the unit isn't in
  // the table at all — that's an "unknown territory" fallback so we
  // don't lie about the stored value.
  const known = units?.some(
    (u) => (u.name || "").toLowerCase() === (unitName || "").toLowerCase()
  );
  const allowsDecimal = isDecimalUnit(unitName, units);

  if (known && !allowsDecimal) {
    return Math.round(n).toLocaleString();
  }

  // Decimal-allowed (or unknown unit): toFixed(4) cleans up float
  // artefacts (0.1 + 0.2 → 0.30000000000000004), then parseFloat
  // strips trailing zeros and a trailing dot. Result is the natural
  // shortest form.
  const trimmed = parseFloat(n.toFixed(4));
  return trimmed.toString();
}
