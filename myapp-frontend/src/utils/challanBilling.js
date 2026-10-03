export const billableChallanStatuses = ["Pending", "Imported", "No PO", "Setup Required"];
export const isBillableChallan = (challan) => !challan.invoiceId && billableChallanStatuses.includes(challan.status);
export const hasChallanPo = (challan) => !!challan.poNumber?.trim();
export const challanPoKey = (challan) => JSON.stringify([challan.poNumber?.trim().toLowerCase() || "", challan.poDate?.slice(0, 10) || ""]);

export function groupChallansByPo(challans) {
  const groups = new Map();
  for (const challan of challans) {
    const key = challanPoKey(challan);
    if (!groups.has(key)) groups.set(key, { key, poNumber: challan.poNumber?.trim() || "", poDate: challan.poDate?.slice(0, 10) || "", challans: [] });
    groups.get(key).challans.push(challan);
  }
  return [...groups.values()];
}
