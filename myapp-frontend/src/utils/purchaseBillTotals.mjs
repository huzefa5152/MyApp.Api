// PurchaseBillService rounds each decimal line and GST to two places, half to even.
function decimal(value) {
  const text = String(value ?? 0);
  if (!Number.isFinite(Number(text))) return [0n, 1n];
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return [0n, 1n];
  const fraction = match[3] || '', exponent = Number(match[4] || 0);
  if (Math.abs(exponent) > 100 || fraction.length > 100) return [0n, 1n];
  const scale = fraction.length - exponent;
  const coefficient = BigInt(match[2] + fraction) * (match[1] === '-' ? -1n : 1n);
  return scale < 0 ? [coefficient * 10n ** BigInt(-scale), 1n] : [coefficient, 10n ** BigInt(scale)];
}
function roundEven(numerator, denominator) {
  const sign = numerator < 0n ? -1n : 1n;
  numerator *= sign;
  let result = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && result % 2n !== 0n)) result++;
  return result * sign;
}
export function purchaseBillTotals(items, gstRate) {
  const lineCents = items.map(item => {
    const [quantity, quantityScale] = decimal(item.quantity);
    const [price, priceScale] = decimal(item.unitPrice);
    return roundEven(quantity * price * 100n, quantityScale * priceScale);
  });
  const subtotalCents = lineCents.reduce((sum, amount) => sum + amount, 0n);
  const [rate, rateScale] = decimal(gstRate);
  const gstCents = roundEven(subtotalCents * rate, rateScale * 100n);
  return { lineTotals: lineCents.map(cents => Number(cents) / 100), subtotal: Number(subtotalCents) / 100,
    gstAmount: Number(gstCents) / 100, grandTotal: Number(subtotalCents + gstCents) / 100 };
}
