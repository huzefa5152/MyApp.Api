// Pricing a bill line from stock under FIFO by GD.
//
// For a company on FIFO by GD, /invoices/company/{id}/stock-pricing returns
// `tiers`: the GD pools the next sale will drain, in the order it will drain
// them (claimed GDs first, oldest GD date first; then unclaimed GDs). An amount
// is walked through them -- the first GD's units at its cost, then the next
// GD's -- which is what "the invoice uses the first GD, and moves to the second
// when it needs more" means for the quantity an amount buys.
//
// A weighted-average company gets no tiers, and every function here returns
// null so the caller keeps its own `total / unitCost` arithmetic unchanged.
// Pure and dependency-free: pinned by scripts/test_fifo_pricing.mjs.

const usable = (price) =>
  Array.isArray(price?.tiers)
    ? price.tiers.filter((t) => Number(t.quantity) > 0 && Number(t.unitCost) > 0)
    : [];

/**
 * The (unrounded) quantity `total` buys, walking the tiers in order. Beyond the
 * last tier the last tier's cost continues, so an amount larger than the stock
 * still gives a quantity (the oversell warning is the caller's job, as today).
 */
export function fifoQuantityForAmount(price, total) {
  const tiers = usable(price);
  if (tiers.length === 0 || !(total > 0)) return null;
  let left = total;
  let qty = 0;
  let lastUnit = 0;
  for (const t of tiers) {
    const q = Number(t.quantity);
    const unit = Number(t.unitCost);
    const value = Number(t.valueExcludingTax) > 0 ? Number(t.valueExcludingTax) : q * unit;
    lastUnit = value / q;
    if (left <= value + 1e-9) return qty + left / lastUnit;
    qty += q;
    left -= value;
  }
  return qty + left / lastUnit;
}

/** "GD KAPE-1 (claimed) 550 at 528.82, then GD KAPE-2 ..." for the line's hint. */
export function fifoTierText(price, uom, max = 3) {
  const tiers = usable(price);
  if (tiers.length === 0) return null;
  const fmt = (n, d) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
  const parts = tiers.slice(0, max).map((t) =>
    `${t.gdNumber ? `GD ${t.gdNumber}` : "other stock"}${t.claimed ? " (claimed)" : ""}: `
    + `${fmt(t.quantity, 4)}${uom ? ` ${uom}` : ""} at ${fmt(t.unitCost, 4)}`);
  const more = tiers.length > max ? `, then ${tiers.length - max} more` : "";
  return `Uses ${parts.join(", then ")}${more}`;
}
