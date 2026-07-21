/**
 * Starter template catalog.
 *
 * Each entry is { id, name, type, description, html } where `html` is a complete
 * Handlebars document (see utils/templateEngine.js for the registered helpers and
 * the per-type merge fields). The Template Editor's "New from starter" picker reads
 * STARTER_TEMPLATES and filters by the current document type.
 *
 * The per-type sets live under utils/starters/ — ~15 distinct designs each, tuned to
 * Pakistani wholesale conventions (NTN/STRN, GST, amount-in-words, FBR digital-invoice
 * IRN + QR on tax invoices, signatures, optional Bismillah header). Receipt's on-screen
 * selector arrives with the Receipt document in Phase 3; its starters ship now so the
 * library is complete.
 */
import { challanStarters } from "./starters/challan";
import { billStarters } from "./starters/bill";
import { taxInvoiceStarters } from "./starters/taxInvoice";
import { quoteStarters } from "./starters/quote";
import { orderStarters } from "./starters/order";
import { creditNoteStarters } from "./starters/creditNote";
import { debitNoteStarters } from "./starters/debitNote";
import { purchaseBillStarters } from "./starters/purchaseBill";
import { goodsReceiptStarters } from "./starters/goodsReceipt";
import { receiptStarters } from "./starters/receipt";

export const STARTER_TEMPLATES = [
  ...challanStarters,
  ...billStarters,
  ...taxInvoiceStarters,
  ...quoteStarters,
  ...orderStarters,
  ...creditNoteStarters,
  ...debitNoteStarters,
  ...purchaseBillStarters,
  ...goodsReceiptStarters,
  ...receiptStarters,
];
