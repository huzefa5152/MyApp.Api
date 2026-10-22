// Does a stock adjustment look like a sale entered the wrong way? (AY, 2026-10-22)
//
// Operators took sold goods out with an adjustment, or wrote their value down
// to nothing, before the sale bill was entered. When the bill came in later the
// quantity adjustment was reversed, but a value write-down stayed and landed on
// the next GD's units. So the Adjustment dialog asks first when the change takes
// quantity OUT, or leaves stock on hand worth nothing.
//
// current: { onHand, valueExcludingTax } as the on-hand grid shows it.
// draft:   the Adjustment dialog's fields (mode "set" or "delta").
export function adjustmentLooksLikeSale(current, draft) {
  if (!current || !draft) return false;
  const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const curQty = Number(current.onHand || 0);
  const curVal = Number(current.valueExcludingTax || 0);
  let newQty, newVal;
  if (draft.mode === "delta") {
    newQty = curQty + (num(draft.delta) ?? 0);
    newVal = curVal + (num(draft.valueDelta) ?? 0);
  } else {
    newQty = num(draft.targetQuantity) ?? curQty;
    newVal = num(draft.targetValue) ?? curVal;
  }
  const takesQuantityOut = newQty < curQty - 0.00005;
  const leavesStockWorthNothing = newQty > 0.00005 && newVal <= 0.005 && curVal > 0.005;
  return takesQuantityOut || leavesStockWorthNothing;
}

export const SALE_WARNING =
  "If so, enter the sale bill instead (or a manually filed FBR invoice). " +
  "An adjustment made now is not undone when the bill is entered later, and the stock value can go wrong. " +
  "Use an adjustment only for goods that are damaged, lost or miscounted.";
