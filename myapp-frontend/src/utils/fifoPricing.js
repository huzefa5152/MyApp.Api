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
  const parts = tiers
    .slice(0, max)
    .map(
      (t) =>
        `${t.gdNumber ? `GD ${t.gdNumber}` : "other stock"}${t.claimed ? " (claimed)" : ""}: ` +
        `${fmt(t.quantity, 4)}${uom ? ` ${uom}` : ""} at ${fmt(t.unitCost, 4)}`,
    );
  const more = tiers.length > max ? `, then ${tiers.length - max} more` : "";
  return `Uses ${parts.join(", then ")}${more}`;
}

/**
 * The GD pools a sale of `quantity` draws on, in order, each with what it
 * takes (`take`) and that slice's value; given the line's amount, the values
 * add up to it. Rows the sale does not reach carry
 * take 0. Beyond the last pool the last pool takes the rest, as the walk does.
 */
export function fifoTierTakes(price, quantity, lineTotal) {
  const tiers = usable(price);
  if (tiers.length === 0) return null;
  let left = Math.max(0, Number(quantity) || 0);
  const rows = tiers.map((t, i) => {
    const q = Number(t.quantity);
    const take = i === tiers.length - 1 ? left : Math.min(left, q);
    left -= take;
    const whole = take === q && Number(t.valueExcludingTax) > 0;
    return {
      ...t,
      take,
      takeValue: whole ? Number(t.valueExcludingTax) : take * Number(t.unitCost),
    };
  });
  // The line's amount is what is billed, so the last GD the line reaches
  // carries the rounding and the values add up to it exactly.
  const total = Number(lineTotal);
  const last = rows.map((r) => r.take > 0).lastIndexOf(true);
  if (total > 0 && last >= 0) {
    const before = rows.slice(0, last).reduce((sum, r) => sum + r.takeValue, 0);
    rows[last] = { ...rows[last], takeValue: Math.max(0, total - before) };
  }
  return rows;
}

/**
 * What a line priced from an amount takes out of stock (2026-11-15).
 *
 * The invoice bills a whole quantity, and an amount rarely buys a whole number
 * of units: 30,000 of a machine held as 1 Pcs worth 250,000 buys 0.12 Pcs.
 * The invoice still says 1 Pcs; stock gives up `rawQty`, so the value that
 * leaves is the amount that was billed. Null when that is the billed quantity
 * itself, or when the two are a whole unit or more apart (the server refuses
 * that, so it is never sent). Mirrors Helpers/StockOutQuantity.Resolve.
 */
export function stockQuantityForLine(rawQty, qty) {
  const raw = Number(rawQty);
  const billed = Number(qty);
  if (!(raw > 0) || !(billed > 0)) return null;
  const stock = Math.round(raw * 1e12) / 1e12;
  if (stock === billed || Math.abs(stock - billed) >= 1) return null;
  return stock;
}

/**
 * What deriving a line from an amount remembers on the row: the stock quantity,
 * and the item, quantity and rate it was worked out for.
 */
export function amountStock(rawQty, qty, rate, itemTypeId) {
  const stock = stockQuantityForLine(rawQty, qty);
  if (stock == null) return null;
  return { stock, quantity: String(qty), unitPrice: String(rate), itemTypeId };
}

/**
 * The stock quantity a row may send: the one worked out from its amount, only
 * while the row still shows the item, quantity and rate it was worked out for.
 * A quantity or rate typed by hand afterwards goes back to the billed quantity.
 */
export function rowStockQuantity(row) {
  const a = row?.amountStock;
  if (!a) return null;
  return String(row.quantity) === a.quantity &&
    String(row.unitPrice) === a.unitPrice &&
    row.itemTypeId === a.itemTypeId
    ? a.stock
    : null;
}

/**
 * Says so when an amount buys clearly less or more than the whole units the
 * invoice will show (a tenth of the quantity or more). Small rounding is not
 * worth a notice on every line.
 */
export function partUnitNote(stockQty, qty, uom, amount) {
  const stock = Number(stockQty);
  const billed = Number(qty);
  if (!(stock > 0) || !(billed > 0) || Math.abs(stock - billed) / billed < 0.1) return null;
  const n = (v, d) => Number(v).toLocaleString(undefined, { maximumFractionDigits: d });
  const unit = uom ? ` ${uom}` : "";
  const worth =
    Number(amount) > 0
      ? ` worth ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "";
  return (
    `This amount buys ${n(stock, 4)}${unit}. The invoice shows ${n(billed, 4)}${unit}; ` +
    `stock gives up ${n(stock, 4)}${unit}${worth}, not the whole ${n(billed, 4)}. ` +
    "If the whole quantity was sold at this price, type the quantity and the rate instead."
  );
}
