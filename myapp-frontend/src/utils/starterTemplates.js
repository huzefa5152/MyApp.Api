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
 * IRN + QR on tax invoices, signatures, optional Bismillah header).
 */
import { challanStarters } from "./starters/challan";
import { billStarters } from "./starters/bill";
import { taxInvoiceStarters } from "./starters/taxInvoice";
import { quoteStarters } from "./starters/quote";
import { orderStarters } from "./starters/order";

export const STARTER_TEMPLATES = [
  ...challanStarters,
  ...billStarters,
  ...taxInvoiceStarters,
  ...quoteStarters,
  ...orderStarters,
];
