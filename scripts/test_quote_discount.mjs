// Quote discount arithmetic on the screen (offline): node scripts/test_quote_discount.mjs
import { copyLine } from "../myapp-frontend/src/utils/documentCopy.js";
import { parseDiscount, applyDiscount, lineAmounts, quoteTotals, discountFields, discountText } from "../myapp-frontend/src/utils/quoteDiscount.js";

let passed = 0, failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

eq("percent", parseDiscount("10%"), { value: 10, isPercent: true, valid: true });
eq("percent with space", parseDiscount(" 12.5 % "), { value: 12.5, isPercent: true, valid: true });
eq("amount with commas", parseDiscount("10,000"), { value: 10000, isPercent: false, valid: true });
eq("blank is no discount", parseDiscount(""), { value: 0, isPercent: false, valid: true });
eq("text is invalid", parseDiscount("ten").valid, false);
eq("negative is invalid", parseDiscount("-5").valid, false);
eq("over 100% is invalid", parseDiscount("101%").valid, false);

eq("10% of 41,000", applyDiscount(41000, "10%"), { amount: 4100, error: null });
eq("rupee amount", applyDiscount(41000, "10000"), { amount: 10000, error: null });
eq("more than the line is refused", applyDiscount(500, "600").error, "More than the amount");
eq("100% is the whole line", applyDiscount(500, "100%"), { amount: 500, error: null });

eq("line net", lineAmounts({ quantity: 2, unitPrice: 27500, discountText: "5%" }), { gross: 55000, discount: 2750, net: 52250, error: null });
eq("line without discount", lineAmounts({ quantity: 1, unitPrice: 88000 }).net, 88000);

// Quote #512 shape: battery 10% off, then 5,000 off the whole quote, GST 18% on the rest.
const t = quoteTotals([
  { quantity: 1, unitPrice: 88000 },
  { quantity: 1, unitPrice: 41000, discountText: "10%" },
], "5000", 18);
eq("subtotal is net of line discounts", t.subtotal, 124900);
eq("whole-quote discount", t.discount, 5000);
eq("GST on the discounted amount", t.gstAmount, 21582);
eq("grand total", t.grandTotal, 141482);
eq("whole-quote percent", quoteTotals([{ quantity: 1, unitPrice: 1000 }], "10%", 0).grandTotal, 900);
eq("whole-quote too big", quoteTotals([{ quantity: 1, unitPrice: 1000 }], "2000", 0).error, "More than the amount");

eq("api fields", discountFields("10%", "  Exchange of old battery "), { discountValue: 10, discountIsPercent: true, discountReason: "Exchange of old battery" });
eq("reason dropped without a discount", discountFields("", "x"), { discountValue: 0, discountIsPercent: false, discountReason: null });
eq("edit text round trip", [discountText(10, true), discountText(5000, false), discountText(0, false)], ["10%", "5000", ""]);

// Copying a saved quote line: a quote keeps the discount, anything else takes the net price.
const saved = { description: "Battery", quantity: 2, unit: "Pcs", unitPrice: 41000, lineTotal: 73800, discountAmount: 8200, discountValue: 10, discountIsPercent: true, discountReason: "Exchange" };
const toQuote = copyLine(saved, () => ({}), true);
eq("copy into a quote keeps the discount", [toQuote.unitPrice, toQuote.discountText, toQuote.discountReason], [41000, "10%", "Exchange"]);
eq("copy into a bill takes the net unit price", copyLine(saved).unitPrice, 36900);
eq("copy of an undiscounted line is unchanged", copyLine({ description: "X", quantity: 1, unitPrice: 5 }).unitPrice, 5);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
