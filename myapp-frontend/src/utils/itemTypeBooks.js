// Which item types belong in which book, under Inventory Overlay Behaviour.
//
// An overlay company keeps two books for one sale and they are deliberately
// DISJOINT, because each answers a different question:
//
//   the BILL     what the customer ordered, in the units they buy. Item types
//                with NO HS code — a "carton of assorted fittings" is a real
//                thing to sell and a meaningless thing to file.
//   the INVOICE  the same money decomposed for FBR. HS-coded item types only,
//                because every filed line must carry a tariff classification.
//
// With the overlay OFF this does nothing at all: both books are the same book,
// and every item type stays available exactly as it is today. That is the
// whole point of the flag — an existing company must not notice this file
// exists.
//
// It lives here rather than in each form because three screens ask the
// question (standalone bill, challan-based bill, and the edit form that serves
// both tabs) and a picker that disagreed with the one next to it would let an
// operator build a line the other book cannot represent.

export const BOOK_BILL = "bill";
export const BOOK_INVOICE = "invoice";

const hasHs = (it) => !!(it?.hsCode && String(it.hsCode).trim());

/**
 * @param {Array}   items    item types as the pickers receive them
 * @param {boolean} overlayOn company's InventoryOverlayEnabled
 * @param {string}  book     BOOK_BILL | BOOK_INVOICE
 */
export function itemTypesForBook(items, overlayOn, book) {
  const arr = items || [];
  if (!overlayOn) return arr;
  if (book === BOOK_BILL) return arr.filter((it) => !hasHs(it));
  if (book === BOOK_INVOICE) return arr.filter(hasHs);
  return arr;
}

/** Copy for the empty state, so a filtered-to-nothing picker explains itself
 *  instead of looking broken. */
export function emptyBookHint(book) {
  return book === BOOK_BILL
    ? "No item types without an HS code. A bill line uses the commercial item; add one on the Item Catalog with the HS code left blank."
    : "No item types with an HS code. An invoice line must carry a tariff classification; set an HS code on the Item Catalog.";
}
