// Match decimal Math.Round(value, 2): half-to-even, without binary-float drift.
export function challanPurchaseTax(subtotal, rate) {
  const scaled = value => {
    const [whole, fraction = ""] = String(value).split(".");
    return BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  };
  const numerator = scaled(subtotal) * scaled(rate || "0");
  let cents = numerator / 10000n;
  const remainder = numerator % 10000n;
  if (remainder > 5000n || (remainder === 5000n && cents % 2n === 1n)) cents++;
  return Number(cents) / 100;
}
export const validChallanPurchaseRate = value => /^\d+(?:\.\d{0,2})?$/.test(String(value)) && Number(value) <= 100;
