/**
 * Built-in default print templates for the five accounting document types:
 * Receipt, Payment, (Inter-Account) Transfer, Journal Entry, Withholding Tax
 * Receipt.
 *
 * Same pattern as purchaseNoteDocTemplates.js — each default ALIASES its
 * type's "Classic Serif" starter, so the built-in fallback (used when a
 * company has no saved template of the type) and the starter catalog can
 * never drift apart.
 */
import { receiptStarters } from "./starters/receipt";
import { paymentStarters } from "./starters/payment";
import { transferStarters } from "./starters/transfer";
import { journalEntryStarters } from "./starters/journalEntry";
import { withholdingTaxStarters } from "./starters/withholdingTax";

const classic = (starters, prefix) =>
  (starters.find((t) => t.id === `${prefix}-classic-serif`) || starters[0]).html;

export const defaultReceiptTemplate = classic(receiptStarters, "receipt");
export const defaultPaymentTemplate = classic(paymentStarters, "payment");
export const defaultTransferTemplate = classic(transferStarters, "transfer");
export const defaultJournalEntryTemplate = classic(journalEntryStarters, "journal");
export const defaultWithholdingTaxTemplate = classic(withholdingTaxStarters, "wht");
