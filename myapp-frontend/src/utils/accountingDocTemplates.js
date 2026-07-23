/**
 * Built-in default print templates for the accounting vouchers.
 *
 * Master (Division-free, GL-free) has two distinct voucher types — Receipt
 * (money in, settles sales invoices) and Payment (money out, settles purchase
 * bills). Each prints "Receipt Voucher" / "Payment Voucher" from its own
 * starter set; both bind the same print DTO (the DTO's `direction` field marks
 * which). Same pattern as salesDocTemplates.js — each default ALIASES its
 * type's "Classic Serif" starter, so the built-in fallback (used when a company
 * has no saved template of the type) and the starter catalog can never drift.
 */
import { receiptStarters } from "./starters/receipt";
import { paymentStarters } from "./starters/payment";

const classic = (starters, prefix) =>
  (starters.find((t) => t.id === `${prefix}-classic-serif`) || starters[0]).html;

export const defaultReceiptTemplate = classic(receiptStarters, "receipt");
export const defaultPaymentTemplate = classic(paymentStarters, "payment");
