// Whether an invoice line has the stock it sells, BEFORE save (importer D8,
// 2026-10-28). The server's guard (InvoiceService.AssertBillStockAvailabilityAsync)
// is the authority and is never loosened; this only says so in advance, so the
// operator is not surprised by a refusal.
//
// The guard refuses on a company with inventory tracking AND the hard block on,
// for every user. Elsewhere a shortfall saves and the line only warns.

/** Is this company's stock guard a hard block? */
export const isHardBlock = (company) =>
  !!(company && company.inventoryTrackingEnabled !== false && company.stockGuardHardBlock);

/**
 * @param {object} p
 * @param {object|null} p.pending  the line's pending new item (newItemType), if any
 * @param {object|null} p.item     the picked catalog item (with availableQty when known)
 * @param {number}      p.quantity the line quantity
 * @param {object}      p.company  the invoice's company
 * @returns {{ noStock: boolean, blocksSave: boolean, onHand: number|null }}
 */
export function lineStock({ pending, item, quantity, company }) {
  const none = { noStock: false, blocksSave: false, onHand: null };
  if (!company || company.inventoryTrackingEnabled === false) return none;
  const qty = Number(quantity) || 0;
  let onHand = null;
  if (pending) onHand = 0;                     // a brand-new item has no stock
  else if (item && typeof item.availableQty === "number") {
    // Legacy tracking (version 1) moves stock for HS-coded items only.
    const tracked = company.inventoryFlowVersion === 2 || !!(item.hsCode && item.hsCode.trim());
    if (!tracked) return none;
    onHand = Number(item.availableQty) || 0;
  } else return none;
  const noStock = qty > 0 ? onHand < qty : onHand <= 0;
  return { noStock, blocksSave: noStock && isHardBlock(company), onHand };
}

/** A pending new item built from an FBR HS code the picker offered. */
export function pendingFromFbrCode(row) {
  const desc = (row.fbrDescription || "").trim();
  return {
    placeholderId: row.id,
    // The FBR wording, trimmed to the catalog's 100-character name. Editable.
    name: (desc || row.name || "").slice(0, 100),
    hsCode: row.hsCode,
    uom: row.uom || "",
    fbrUOMId: row.fbrUOMId || null,
    saleType: row.saleType || "",
  };
}
