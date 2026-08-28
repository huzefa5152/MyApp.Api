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

// ── Pakistan-time helpers (2026-08-28) ────────────────────────────────────
//
// Bills may be dated in the FUTURE (an operator cuts a 1-September bill in
// late August). FBR rule [0043] still refuses to validate/submit a
// future-dated invoice, so the UI hides those actions until the bill's date
// arrives. "Future" must be judged in Pakistan time — the same rule the
// server applies in Helpers/PakistanClock — not in the browser's timezone,
// so an operator abroad sees the same gate as one in Karachi.

/** Today's calendar date in Pakistan (PKT, UTC+5) as "YYYY-MM-DD". */
export function todayPakistanYmd() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  } catch {
    // Host without tzdata: PKT has no daylight saving, so a fixed +5 shift
    // on the UTC instant gives exactly the Karachi calendar date.
    return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

/**
 * True when a document's date is AFTER today in Pakistan (date-only).
 * The stored value's date part is used verbatim (never re-parsed through
 * `new Date()`), so no timezone math can roll the day — see `toLocalYmd`.
 * ISO "YYYY-MM-DD" strings compare correctly as plain strings.
 */
export function isFutureDocDate(value) {
  const ymd = toLocalYmd(value);
  return !!ymd && ymd > todayPakistanYmd();
}
