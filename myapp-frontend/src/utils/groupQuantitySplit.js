// Spread ONE quantity typed for a grouped Item Type row across the group's
// underlying bill lines.
//
// The grouped view (EditBillForm, invoice mode) shows every line that shares
// an Item Type as a single row with a summed quantity — the same shape FBR
// receives. When the operator retypes that sum, the lines underneath must be
// rewritten so they add up to it again, and every line must keep a quantity
// the server accepts: greater than zero, and a whole number for Pcs-style
// units.
//
// Why this is its own module: the first version floored each line's
// proportional share and handed the remainder out largest-fraction-first. On a
// 37-line medicines bill (137 units) retyped to 61, every 1-unit line floored
// to 0.45 → 0, the 22-unit remainder went to the 2s, 4s, 6s and the 8, and TEN
// lines were left at 0. The operator saw a grouped row reading 61 and a Save
// error about a quantity they could not see. (2026-09-19, INV-3932.)
//
// Rules:
//   • Proportional to `weights` (the lines' ORIGINAL bill quantities), so the
//     split is stable however the number is typed. Lines with no weight at all
//     fall back to an even split.
//   • Whole mode: floors + remainder, then a repair pass that moves one unit at
//     a time from the largest line to any line left at 0. Nothing ends at zero
//     as long as there are at least as many units as lines; below that no
//     whole-unit split exists and the caller is told (`infeasible`), instead of
//     being handed zeros.
//   • Decimal mode (KG, Liter, …): 4-decimal shares with the last line
//     absorbing the rounding, so the lines always re-sum to the typed total.
//
// Returns { shares, infeasible, minimum }. `shares` is always an array (in
// whole mode it may still hold zeros when infeasible, so a half-typed value
// keeps echoing back into the input); `minimum` is the smallest total that
// gives every line a unit.

export function splitGroupQuantity(total, weights, { allowDecimal = false } = {}) {
  const n = Array.isArray(weights) ? weights.length : 0;
  const target = Number(total);
  if (n === 0) return { shares: [], infeasible: !(target > 0), minimum: 0 };
  if (!Number.isFinite(target) || target <= 0) {
    return { shares: weights.map(() => 0), infeasible: true, minimum: allowDecimal ? 0.0001 : n };
  }

  let w = weights.map((x) => (Number(x) > 0 ? Number(x) : 0));
  let wTotal = w.reduce((a, b) => a + b, 0);
  if (wTotal <= 0) { w = weights.map(() => 1); wTotal = n; }

  if (allowDecimal || !Number.isInteger(target)) {
    const shares = new Array(n);
    let remaining = target;
    for (let k = 0; k < n; k++) {
      if (k === n - 1) {
        shares[k] = Math.round(Math.max(0, remaining) * 10000) / 10000;
      } else {
        const q = Math.round((target * w[k]) / wTotal * 10000) / 10000;
        shares[k] = q;
        remaining -= q;
      }
    }
    return { shares, infeasible: shares.some((q) => q <= 0), minimum: n * 0.0001 };
  }

  // Whole units: proportional floors, remainder largest-fraction-first.
  const exact = w.map((x) => (target * x) / wTotal);
  const shares = exact.map((x) => Math.floor(x));
  let rem = target - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, k) => ({ k, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.k - b.k);
  for (let j = 0; j < order.length && rem > 0; j++, rem--) shares[order[j].k] += 1;

  // Repair: a line at zero takes one unit from whichever line currently has
  // the most. Each move changes two lines by one unit, so the total is kept
  // and the proportions are disturbed as little as possible.
  if (target >= n) {
    for (let k = 0; k < n; k++) {
      if (shares[k] > 0) continue;
      let donor = -1;
      for (let d = 0; d < n; d++) if (shares[d] > 1 && (donor < 0 || shares[d] > shares[donor])) donor = d;
      if (donor < 0) break; // cannot happen when target >= n, kept for safety
      shares[donor] -= 1;
      shares[k] = 1;
    }
  }

  return { shares, infeasible: shares.some((q) => q <= 0), minimum: n };
}
