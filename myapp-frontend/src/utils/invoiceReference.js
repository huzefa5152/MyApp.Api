// One definition of "the reference number printed on this document", shared by
// the cards, the table and the print/export paths.
//
// A bill carries TWO numbers and they are not interchangeable:
//
//   invoiceNumber     the internal sequence — unique per company, what every
//                     screen, report and lookup keys on.
//   fbrInvoiceNumber  the company's `InvoiceNumberPrefix` followed by that
//                     number ("PTC-52"), plus "CN-"/"DN-" for a note. This is
//                     the reference on the copy the customer holds, and the one
//                     they quote back on the phone.
//
// The prefix lives under Configuration -> Companies -> Numbering. It predates
// nothing FBR-specific despite the column's name — it is the document's own
// reference, which is why it belongs on the list as well as on the print.
//
// Returns null when there is nothing extra to say: with no prefix configured a
// plain bill's reference IS its number, and rendering "52 / 52" is noise. A
// note still reads "CN-52" without a prefix, which is worth showing.
export function documentReference(inv) {
  const ref = inv?.fbrInvoiceNumber;
  if (!ref) return null;
  const trimmed = String(ref).trim();
  if (!trimmed) return null;
  return trimmed === String(inv?.invoiceNumber ?? "").trim() ? null : trimmed;
}
