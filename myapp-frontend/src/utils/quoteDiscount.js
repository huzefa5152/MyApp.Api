// Quote discounts, the screen's half of Helpers/QuoteDiscount.cs. One box takes
// "10%" or "1,000". Discounts come off before GST: each line's own, then the
// whole quote's. The server recomputes everything; this only previews it.

const round2 = (n) => Math.round(n * 100) / 100;

export function parseDiscount(text) {
  const t = String(text ?? "").trim().replace(/,/g, "");
  if (!t) return { value: 0, isPercent: false, valid: true };
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(%)?$/);
  if (!m) return { value: 0, isPercent: false, valid: false };
  const value = parseFloat(m[1]);
  const isPercent = !!m[2];
  return { value, isPercent, valid: !(isPercent && value > 100) };
}

/** The text a stored discount is edited as: "10%" or "1000"; "" for none. */
export const discountText = (value, isPercent) => (Number(value) ? `${Number(value)}${isPercent ? "%" : ""}` : "");

/** { amount, error } for a discount typed against `base`. */
export function applyDiscount(base, text) {
  const d = parseDiscount(text);
  if (!d.valid) return { amount: 0, error: d.isPercent ? "Max 100%" : "Type 10% or 500" };
  if (!d.value) return { amount: 0, error: null };
  const amount = d.isPercent ? round2(base * d.value / 100) : round2(d.value);
  return amount > base ? { amount: 0, error: "More than the amount" } : { amount, error: null };
}

export function lineAmounts(item) {
  const gross = round2((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0));
  const { amount, error } = applyDiscount(gross, item.discountText);
  return { gross, discount: amount, net: round2(gross - amount), error };
}

export function quoteTotals(items, headerDiscountText, gstRate) {
  const subtotal = round2(items.reduce((s, it) => s + lineAmounts(it).net, 0));
  const { amount: discount, error } = applyDiscount(subtotal, headerDiscountText);
  const taxable = round2(subtotal - discount);
  const gstAmount = round2(taxable * (Number(gstRate) || 0) / 100);
  return { subtotal, discount, error, taxable, gstAmount, grandTotal: round2(taxable + gstAmount) };
}

/** The API fields for a typed discount + reason. */
export function discountFields(text, reason) {
  const d = parseDiscount(text);
  const value = d.valid ? d.value : 0;
  return { discountValue: value, discountIsPercent: value ? d.isPercent : false, discountReason: value ? (reason || "").trim() || null : null };
}

const num = (v) => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "Less 10% (Rs 4,100): reason", matching QuoteDiscount.Note on the server; "" without a discount. */
export function discountNote(value, isPercent, amount, reason) {
  if (!(Number(amount) > 0)) return "";
  const head = isPercent ? `Less ${num(value)}% (Rs ${num(amount)})` : `Less Rs ${num(amount)}`;
  return reason ? `${head}: ${reason}` : head;
}
