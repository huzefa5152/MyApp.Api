/**
 * Splitting a merged bill row back over the deliveries it came from.
 *
 * One item delivered three times shows as ONE editable row on the bill form.
 * When the operator changes that row's quantity, the change has to be written
 * back to the individual delivery lines, because each delivery line is what the
 * bill and its challans are joined by.
 *
 * The rule is a minimum-preserving reverse waterfall:
 *
 *   - every selected challan keeps at least a token quantity, so none is marked
 *     billed with nothing of its goods on the bill;
 *   - a reduction is taken from the NEWEST delivery backwards;
 *   - an older challan is only touched once every newer one is at its minimum.
 *
 * So 50 / 5 / 1 billed as 52 becomes 50 / 1 / 1 — the oldest is left alone
 * because the middle delivery still had room to give — and only at 51 does the
 * oldest finally move, to 49 / 1 / 1.
 *
 * Members are ordered OLDEST FIRST; the caller owns that ordering.
 */

/**
 * What one delivery must keep: a single unit, or the whole delivery when it was
 * smaller than one (a 0.5 KG delivery cannot keep 1). Whole deliveries therefore
 * stay whole — the rule never produces 49.1 / 4.9 / 0.98.
 */
export const minKeep = (quantity) => Math.min(1, Number(quantity) || 0);

/** The smallest quantity a row can be billed at without dropping a challan. */
export const rowFloor = (members) =>
  (members || []).reduce((sum, m) => sum + minKeep(m.quantity), 0);

/** True when the row cannot be split without starving one of its challans. */
export const isUnderFloor = (quantity, members) =>
  (Number(quantity) || 0) < rowFloor(members);

/**
 * @param {number} quantity  what the operator wants to bill for the row
 * @param {Array<{quantity: number}>} members  its deliveries, oldest first
 * @returns {number[]} the quantity for each delivery, in the same order
 */
export function splitDeliveryQuantities(quantity, members) {
  const originals = (members || []).map((m) => Number(m.quantity) || 0);
  const wanted = Number(quantity) || 0;
  const delivered = originals.reduce((a, b) => a + b, 0);
  const alloc = [...originals];

  if (wanted < delivered) {
    let reduce = delivered - wanted;
    // Newest first: the last member is the most recent delivery.
    for (let k = alloc.length - 1; k >= 0 && reduce > 0; k--) {
      const give = Math.min(reduce, Math.max(0, alloc[k] - minKeep(originals[k])));
      alloc[k] -= give;
      reduce -= give;
    }
    // reduce > 0 here means the row is under its floor. The caller blocks the
    // save on that; nothing is silently taken below the minimum.
  } else if (wanted > delivered && alloc.length > 0) {
    // More than was delivered can only honestly sit on the newest line.
    alloc[alloc.length - 1] += wanted - delivered;
  }

  // Float arithmetic on decimal UOMs otherwise leaves 0.30000000000000004.
  return alloc.map((q) => Math.round(q * 10000) / 10000);
}
