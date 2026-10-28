// The ONE rule for a line description when the operator picks an item
// (importer, 2026-10-28). Used by the standalone create form, the
// create-from-challan form and the edit form, so all three behave alike.
//
// The description is the operator's words on the commercial invoice; FBR gets
// it blank (FbrService). Picking an item fills it with the item's text only
// when the line has none, or when it still reads exactly what the previous
// pick filled in (catalog text, not the operator's). Anything typed stays.
// Clearing the item keeps the words. The field stays editable after a fill.

/** The text an item fills a line with: its default line text, else its name. */
export const autoDescription = (item) =>
  ((item && (item.defaultLineDescription || item.name)) || "").trim();

/**
 * Description to show after a pick.
 * @param {string} current  the line's description now
 * @param {string} prevAuto the text the PREVIOUS pick would have filled ("" if none)
 * @param {object|null} next the item just picked (null = cleared)
 */
export function descriptionAfterPick(current, prevAuto, next) {
  const cur = current ?? "";
  if (!next) return cur;
  const auto = autoDescription(next);
  if (!auto) return cur;
  const trimmed = cur.trim();
  if (!trimmed) return auto;
  if (prevAuto && trimmed === prevAuto.trim()) return auto;
  return cur;
}
