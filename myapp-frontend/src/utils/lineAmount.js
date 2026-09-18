// Deriving one of (quantity, unit price, line total) from the other two.
//
// One module because three screens need the same arithmetic — the two bill
// creation forms and the invoice edit — and a line that sums differently
// depending on which form typed it is the bug this is meant to prevent.
//
// THE ROUND TRIP IS THE WHOLE POINT. The server always recomputes
// `LineTotal = Quantity × UnitPrice` (InvoiceService), so a rate the operator
// is shown has to reproduce the total they typed. `InvoiceItem.UnitPrice` is
// decimal(18,12) — widened for exactly this — while `LineTotal` is 2dp, so the
// rate carries the remainder and the product rounds back to the typed figure.
//
// The case that motivated it: 220,000 over 196 units. At the 2dp rate a form
// would previously show, 1122.45 × 196 = 220,000.20 — a bill 20 paisa above
// what the operator entered, and no way to correct it. At 12dp,
// 1122.448979591837 × 196 = 220,000.000000000052, which stores as 220,000.00.

/** Decimals `InvoiceItem.UnitPrice` can hold (migration WidenInvoiceUnitPriceTo12Decimals). */
export const UNIT_PRICE_DP = 12;

/** Decimals a money column holds. */
export const MONEY_DP = 2;

/**
 * Round half-away-from-zero at `dp`, going through an integer so the browser's
 * binary floats cannot drift a rupee figure (0.145 must not become 0.14).
 */
export function roundTo(value, dp) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const scale = 10 ** dp;
  const scaled = n * scale;
  // Nudge by ONE ulp of the scaled value before rounding, so a figure that is
  // exactly x.5 in decimal but a hair under in binary (0.145 -> 14.4999...)
  // still rounds up. It must be one ulp and no more: the nudge grows with the
  // value, so at 12 decimals a larger multiple is worth a whole unit and
  // pushes the last digit of a rate one too far.
  const eps = Math.abs(scaled) * Number.EPSILON;
  return (scaled < 0 ? -Math.round(-scaled + eps) : Math.round(scaled + eps)) / scale;
}

/** Line total implied by a quantity and a unit price, at money precision. */
export function lineTotalFrom(quantity, unitPrice) {
  const q = Number(quantity);
  const p = Number(unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
  return roundTo(q * p, MONEY_DP);
}

/**
 * Unit price implied by a line total and a quantity, at the precision the
 * column can actually store. Returns null when the quantity is not positive —
 * there is no rate that divides a total by nothing, and inventing 0 would
 * silently zero the line.
 */
export function unitPriceFrom(lineTotal, quantity) {
  const t = Number(lineTotal);
  const q = Number(quantity);
  if (!Number.isFinite(t) || !Number.isFinite(q) || q <= 0) return null;
  return roundTo(t / q, UNIT_PRICE_DP);
}

/**
 * Does `quantity × unitPrice` land on `lineTotal` once stored at 2dp?
 * Used to decide whether a derived rate is honest enough to show, rather than
 * assuming the division was exact.
 */
export function roundTripsTo(quantity, unitPrice, lineTotal) {
  return lineTotalFrom(quantity, unitPrice) === roundTo(lineTotal, MONEY_DP);
}

/**
 * Recompute a line after the operator edited one field.
 *
 * `edited` is "quantity" | "unitPrice" | "lineTotal" and decides which of the
 * other two gives way — the field just typed is never overwritten, which is
 * what keeps the box from fighting the person using it.
 *
 * Everything in and out is a STRING, because these are form inputs: an empty
 * box has to stay empty rather than becoming "0" under the cursor.
 */
export function recalcLine({ quantity, unitPrice, lineTotal }, edited) {
  const qStr = quantity ?? "";
  const pStr = unitPrice ?? "";
  const tStr = lineTotal ?? "";

  const q = parseFloat(qStr);
  const p = parseFloat(pStr);
  const t = parseFloat(tStr);

  const asText = (n) => (n == null ? "" : String(n));

  if (edited === "lineTotal") {
    // The total is the operator's word; the rate absorbs the remainder.
    if (!(q > 0) || !Number.isFinite(t)) return { quantity: qStr, unitPrice: pStr, lineTotal: tStr };
    const derived = unitPriceFrom(t, q);
    return { quantity: qStr, unitPrice: asText(derived), lineTotal: tStr };
  }

  if (edited === "quantity") {
    // A quantity change keeps whichever of rate / total the operator last
    // fixed. With a rate present the total follows it; with only a total
    // present the rate re-derives against the new quantity.
    if (Number.isFinite(p) && pStr !== "") {
      return { quantity: qStr, unitPrice: pStr, lineTotal: q > 0 ? asText(lineTotalFrom(q, p)) : "" };
    }
    if (Number.isFinite(t) && q > 0) {
      return { quantity: qStr, unitPrice: asText(unitPriceFrom(t, q)), lineTotal: tStr };
    }
    return { quantity: qStr, unitPrice: pStr, lineTotal: tStr };
  }

  // edited === "unitPrice"
  if (!Number.isFinite(p) || !(q > 0)) return { quantity: qStr, unitPrice: pStr, lineTotal: tStr };
  return { quantity: qStr, unitPrice: pStr, lineTotal: asText(lineTotalFrom(q, p)) };
}

/**
 * How a derived rate should READ on screen. A 12-decimal rate is correct and
 * unreadable, so it is shown trimmed — but never rounded to the point where it
 * stops reproducing the total, because a rate that visibly disagrees with the
 * line it produces is worse than a long one.
 */
export function displayUnitPrice(unitPrice, quantity, lineTotal) {
  const p = Number(unitPrice);
  if (!Number.isFinite(p)) return "";
  for (const dp of [2, 4, 6, 8, 12]) {
    const candidate = roundTo(p, dp);
    if (lineTotal == null || roundTripsTo(quantity, candidate, lineTotal)) return String(candidate);
  }
  return String(p);
}
