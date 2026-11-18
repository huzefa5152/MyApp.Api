export const amount = (value) => Math.round(Number(value || 0) * 100);
export const money = (value) =>
  Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function mergeFilingRows(rows, selected) {
  const picked = rows.filter((_, i) => selected.includes(i));
  if (picked.length < 2) return rows;
  const same = (field) => picked.every((r) => r[field] === picked[0][field]);
  const merged = {
    ...picked[0],
    sourceLineIds: picked.flatMap((r) => r.sourceLineIds),
    description: same("itemTypeId") ? picked[0].description : "Combined supply",
    itemTypeId: same("itemTypeId") ? picked[0].itemTypeId : null,
    hsCode: same("hsCode") ? picked[0].hsCode : null,
    uom: same("uom") ? picked[0].uom : "",
    quantity: same("uom")
      ? Math.round(picked.reduce((n, r) => n + Number(r.quantity || 0), 0) * 10000) / 10000
      : "",
    valueExclTax: picked.reduce((n, r) => n + amount(r.valueExclTax), 0) / 100,
  };
  return rows.flatMap((r, i) =>
    i === Math.min(...selected) ? [merged] : selected.includes(i) ? [] : [r],
  );
}

export function separateFilingRow(row, billItems) {
  if (row.sourceLineIds.length < 2) return [row];
  const sources = row.sourceLineIds.map((id) => billItems.find((i) => i.id === id)).filter(Boolean);
  if (sources.length !== row.sourceLineIds.length)
    throw new Error("Some original lines changed. Rebuild from the current bill first.");
  const total = sources.reduce(
    (n, s) => n + amount(s.adjustment?.adjustedLineTotal ?? s.lineTotal),
    0,
  );
  let remaining = amount(row.valueExclTax);
  return sources.map((source, index) => {
    const cents =
      index === sources.length - 1
        ? remaining
        : Math.round(
            amount(row.valueExclTax) *
              (total
                ? amount(source.adjustment?.adjustedLineTotal ?? source.lineTotal) / total
                : 1 / sources.length),
          );
    remaining -= cents;
    return {
      ...row,
      sourceLineIds: [source.id],
      description: source.description,
      quantity: source.adjustment?.adjustedQuantity ?? source.quantity,
      valueExclTax: cents / 100,
    };
  });
}

// tolerancePkr: the server's rounding allowance between the filing total and the subtotal.
export function filingErrors(rows, bill, tolerancePkr = 0) {
  const issues = [];
  rows.forEach((r, i) => {
    const prefix = `Row ${i + 1}: `;
    if (!r.hsCode || !r.saleType || !r.uom)
      issues.push(prefix + "choose an HS classification with a unit and sale type.");
    if (!r.itemTypeId && !r.description?.trim())
      issues.push(prefix + "enter a name for the new company classification.");
    if (!(Number(r.quantity) > 0) || !Number.isFinite(Number(r.quantity)))
      issues.push(prefix + "enter a positive filing quantity.");
    if (!(Number(r.valueExclTax) > 0) || !Number.isFinite(Number(r.valueExclTax)))
      issues.push(prefix + "enter a positive amount excluding tax.");
  });
  const ids = rows.flatMap((r) => r.sourceLineIds);
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== bill.items.length ||
    bill.items.some((i) => !ids.includes(i.id))
  )
    issues.push("Source lines changed. Rebuild from the current bill and review each row.");
  const gap = Math.abs(
    rows.reduce((n, r) => n + amount(r.valueExclTax), 0) - amount(bill.subtotal),
  );
  if (gap > amount(tolerancePkr))
    issues.push(
      tolerancePkr > 0
        ? `The filing total must be within Rs. ${money(tolerancePkr)} of the bill subtotal.`
        : "The filing total must equal the bill subtotal exactly.",
    );
  return issues;
}
