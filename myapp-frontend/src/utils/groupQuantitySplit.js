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
//   • Mixed mode (`decimalOk`): the group's lines do not share a unit — the
//     common shape is one Item Type covering a Kg line and a Nos line. Decimal
//     capability is a property of the UNIT, so it is applied per line: the
//     integer-only lines take whole shares first, and whatever fraction is left
//     is carried entirely by the lines whose unit allows it. A fraction is
//     never forced onto a Pcs line just because something else in the group
//     could hold one.
//
// Returns { shares, infeasible, minimum }. `shares` is always an array (in
// whole mode it may still hold zeros when infeasible, so a half-typed value
// keeps echoing back into the input); `minimum` is the smallest total that
// gives every line a unit.

export function splitGroupQuantity(total, weights, { allowDecimal = false, decimalOk = null } = {}) {
  // Per-line capability wins over the group-wide flag when it is supplied, and
  // collapses to one of the two simple modes when every line agrees.
  if (Array.isArray(decimalOk) && Array.isArray(weights) && decimalOk.length === weights.length
      && weights.length > 0) {
    const anyDecimal = decimalOk.some(Boolean);
    const allDecimal = decimalOk.every(Boolean);
    // A WHOLE total still splits into whole lines, whatever the units allow.
    // Capability is permission, not instruction: a group retyped as 58 keeps
    // the 1 + 57 it has always produced rather than becoming 0.5743 + 57.4257
    // just because both units happen to be decimal-capable.
    if (!anyDecimal) {
      // No line in this group can hold a fraction, so a fractional total is not
      // a thing that can be split — round it the way the integer-only input
      // would, rather than handing back shares the server will refuse.
      const whole = Math.round(Number(total) || 0);
      return splitPlain(whole, weights, { allowDecimal: false });
    }
    if (Number.isInteger(Number(total))) {
      return splitPlain(total, weights, { allowDecimal: false });
    }
    if (allDecimal) return splitPlain(total, weights, { allowDecimal: true });
    return splitMixed(total, weights, decimalOk);
  }
  return splitPlain(total, weights, { allowDecimal });
}

// Whole shares for the integer-only lines, the remainder — fraction included —
// spread across the lines whose unit allows decimals.
function splitMixed(total, weights, decimalOk) {
  const n = weights.length;
  const target = Number(total);
  const intIdx = [];
  const decIdx = [];
  for (let k = 0; k < n; k++) (decimalOk[k] ? decIdx : intIdx).push(k);

  const minimum = intIdx.length + decIdx.length * 0.0001;
  if (!Number.isFinite(target) || target <= 0) {
    return { shares: weights.map(() => 0), infeasible: true, minimum };
  }

  const w = weights.map((x) => (Number(x) > 0 ? Number(x) : 0));
  const wTotal = w.reduce((a, b) => a + b, 0) || n;
  const weightOf = (k) => (w[k] > 0 ? w[k] : (wTotal === n ? 1 : 0));

  // The integer lines take their proportional share, floored, but never zero —
  // a line at zero is the failure this module exists to prevent.
  const shares = new Array(n).fill(0);
  let used = 0;
  for (const k of intIdx) {
    const want = Math.floor((target * weightOf(k)) / wTotal);
    const give = Math.max(1, want);
    shares[k] = give;
    used += give;
  }

  // Everything left goes to the decimal lines, proportionally, with the last
  // absorbing the rounding so the group re-sums to exactly what was typed.
  let remaining = Math.round((target - used) * 10000) / 10000;
  if (remaining <= 0) {
    return { shares, infeasible: true, minimum };
  }
  const decWeightTotal = decIdx.reduce((a, k) => a + weightOf(k), 0) || decIdx.length;
  let handedOut = 0;
  decIdx.forEach((k, j) => {
    if (j === decIdx.length - 1) {
      shares[k] = Math.round(Math.max(0, remaining - handedOut) * 10000) / 10000;
    } else {
      const q = Math.round((remaining * weightOf(k)) / decWeightTotal * 10000) / 10000;
      shares[k] = q;
      handedOut += q;
    }
  });

  return { shares, infeasible: shares.some((q) => q <= 0), minimum };
}

function splitPlain(total, weights, { allowDecimal = false } = {}) {
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
