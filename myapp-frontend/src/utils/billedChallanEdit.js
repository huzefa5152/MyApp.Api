const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export function deliveryBillImpact(snapshot, items) {
  const { bill, challan } = snapshot;
  const ids = new Set(challan.items.map(i => i.id));
  const kept = new Set(items.filter(i => i.id > 0).map(i => i.id));
  const subtotal = round(bill.items.filter(i => !ids.has(i.deliveryItemId)).reduce((s,i) => s + Number(i.lineTotal),0)
    + items.reduce((s,i) => s + round(Number(i.quantity || 0) * Number(i.unitPrice || 0)),0));
  const gst = round(subtotal * Number(bill.gstRate || 0) / 100);
  const further = round(subtotal * Number(bill.furtherTaxRate || 0) / 100);
  const total = round(subtotal + gst + further);
  const withheld = Math.max(0,Math.min(total,bill.withholdingTaxRate != null ? round(total * Number(bill.withholdingTaxRate)/100) : Number(bill.withholdingTaxAmount || 0)));
  return { added: items.filter(i => !i.id).length, removed: challan.items.filter(i => !kept.has(i.id)).length,
    subtotal, gst, further, total: round(total + Number(bill.freightCharges || 0)),
    collectible: Math.max(0,round(total + Number(bill.freightCharges || 0) - withheld)),
    valid: items.length > 0 && items.every(i => i.description?.trim() && i.unit?.trim() && Number.isFinite(Number(i.quantity)) && Number(i.quantity) > 0
      && i.unitPrice !== '' && i.unitPrice != null && Number.isFinite(Number(i.unitPrice)) && Number(i.unitPrice) >= 0 && Number(i.unitPrice) < 1000000) };
}
export const canEditBilledDelivery = (challan, has) => !!challan.invoiceId && challan.isEditable === true
  && !challan.hasAutoPurchaseBills && has('challans.manage.update') && has('bills.manage.update');
