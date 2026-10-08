export function withTaxUom(row, types, filed = false) {
  const type = types.find((t) => t.id === row.itemTypeId);
  if (filed || !type?.uom) return { ...row };
  return { ...row, uom: row.adjustment?.adjustedUOM ?? type.uom,
    fbrUOMId: row.adjustment?.adjustedFbrUOMId ?? type.fbrUOMId ?? null };
}

export function taxGroupKey(it, index) {
  return it.itemTypeId ? `type:${it.itemTypeId}` : `u${index}`;
}
