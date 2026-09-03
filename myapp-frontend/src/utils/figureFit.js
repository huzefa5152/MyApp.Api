// Fitting an unbounded figure into a fixed tile.
//
// A KPI tile has a floor (the grid's minmax) but a money figure has no upper
// bound: a wholesaler's aged receivable reaches twelve digits, and a negative
// one arrives wrapped in brackets — "(226,670,962.34)" is sixteen characters.
// Rendered at one fixed font size, that spilled straight out of its box on the
// Accounts Receivable Aging report.
//
// CSS alone cannot size text to fit its container (container queries aside), but
// we already hold the formatted STRING at render time, so scale the type to its
// length. Deterministic, no measuring, works in every browser and in print.
//
// Pair it with `figureFitStyle` on the same element: the font step keeps a long
// figure inside a normal tile, and the wrap rules stop an extreme one (a
// thirteen-digit total on a phone) from overflowing anyway.

/**
 * Font size for a figure, stepped down as the string gets longer.
 *
 * @param {string|number} text  the formatted figure, exactly as displayed
 * @param {number} base         rem size for a short figure (the design size)
 * @returns {string}            a rem value for `fontSize`
 */
export function figureFontSize(text, base = 1.35) {
  const len = String(text ?? "").length;
  // ~13 characters is what fits a tile at the design size; each step buys
  // roughly three more.
  const scale = len <= 12 ? 1
              : len <= 15 ? 0.85
              : len <= 18 ? 0.72
              : 0.62;
  return `${(base * scale).toFixed(3)}rem`;
}

/**
 * The style a figure needs to stay inside its tile, whatever its length.
 *
 * `minWidth: 0` matters: a grid or flex child sizes to min-content by default,
 * so a long unbroken number widens the tile past its track instead of wrapping
 * — that is the actual overflow. The wrap rules are the backstop for a figure
 * longer than any font step can rescue.
 */
export const figureFitStyle = {
  minWidth: 0,
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  lineHeight: 1.15,
};

/** Both at once, for the common case. */
export function fitFigure(text, base = 1.35) {
  return { ...figureFitStyle, fontSize: figureFontSize(text, base) };
}
