/**
 * Built-in default print templates for the four newer document types:
 * Credit Note, Debit Note, Purchase Bill, Goods Receipt.
 *
 * Unlike defaultTemplates.js / salesDocTemplates.js (hand-written constants),
 * these alias each type's "Classic Serif" starter — the same design the
 * Template Editor offers first — so the built-in fallback and the starter
 * catalog can never drift apart. Used when a company has no saved template
 * of the type (and by the editor's Reset / New-blank seeds).
 */
import { creditNoteStarters } from "./starters/creditNote";
import { debitNoteStarters } from "./starters/debitNote";
import { purchaseBillStarters } from "./starters/purchaseBill";
import { goodsReceiptStarters } from "./starters/goodsReceipt";

const classic = (starters, prefix) =>
  (starters.find((t) => t.id === `${prefix}-classic-serif`) || starters[0]).html;

export const defaultCreditNoteTemplate = classic(creditNoteStarters, "creditnote");
export const defaultDebitNoteTemplate = classic(debitNoteStarters, "debitnote");
export const defaultPurchaseBillTemplate = classic(purchaseBillStarters, "purchasebill");
export const defaultGoodsReceiptTemplate = classic(goodsReceiptStarters, "goodsreceipt");
