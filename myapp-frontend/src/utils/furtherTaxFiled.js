// The sentence a submit confirmation opens with: what further tax this filing
// carries. FBR is sent the bill's own rate and nothing else, so the bill's
// fields are the filing. Said before the operator commits, because a filed
// invoice is corrected only with a note.

const money = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const charged = (inv) => Number(inv?.furtherTaxAmount || 0) > 0;

export function furtherTaxFiled(inv) {
  return charged(inv)
    ? `Further tax filed: ${Number(inv.furtherTaxRate || 0)}% (Rs ${money(inv.furtherTaxAmount)}).`
    : "No further tax is filed on this one.";
}

export function furtherTaxFiledForAll(invoices) {
  const withTax = (invoices || []).filter(charged);
  const without = (invoices || []).length - withTax.length;
  if (withTax.length === 0) return "None of them carries further tax.";
  const total = withTax.reduce((s, i) => s + Number(i.furtherTaxAmount || 0), 0);
  return `Further tax is filed on ${withTax.length} (Rs ${money(total)} in all) and on none of the other ${without}.`.replace(
    " and on none of the other 0.",
    ".",
  );
}
