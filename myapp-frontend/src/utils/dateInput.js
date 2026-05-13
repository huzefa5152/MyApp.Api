// Date-input helpers (2026-05-12).
//
// Why this file exists: across the codebase we hydrate `<input type="date">`
// controls and write defaults via `new Date().toISOString().slice(0, 10)` or
// `new Date(apiString).toISOString().slice(0, 10)`. Both go through UTC and
// can roll the calendar day backward/forward by one in non-UTC timezones
// (PKT operators see the bill they entered on May 9 read back as May 8 in
// the edit form, while the bill card — which formats with toLocaleDateString
// — correctly shows May 9). HTML `<input type="date">` always wants
// "YYYY-MM-DD" in LOCAL time, never UTC.
//
// Use `toLocalYmd(value)` whenever you feed a date input.

/**
 * Returns the local-time "YYYY-MM-DD" string for the given value.
 * Accepts:
 *   • a `Date` instance              → uses local getFullYear / getMonth / getDate
 *   • an ISO-ish string from the API → if it starts with YYYY-MM-DD, that
 *                                      date-part is returned verbatim (no
 *                                      reparse through `new Date()`, so no
 *                                      timezone conversion happens). For
 *                                      anything else we fall back to local
 *                                      parsing.
 *   • null / undefined / invalid     → ""
 */
export function toLocalYmd(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    // API datetime shape is "2026-05-08T00:00:00" (Unspecified Kind on
    // .NET side, serialized without offset). Taking the first 10 chars
    // sidesteps timezone math entirely — the date prefix is exactly what
    // the operator entered.
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return localYmd(d);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return localYmd(value);
  }
  return "";
}

/** Today's date as YYYY-MM-DD in the user's local timezone. */
export function todayYmd() {
  return localYmd(new Date());
}

function localYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
