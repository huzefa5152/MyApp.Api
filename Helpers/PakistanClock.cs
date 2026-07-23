using System;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Pakistan Standard Time clock + invoice-date validation.
    ///
    /// Why this exists (2026-06-17): FBR rule [0043] rejects future-dated
    /// invoices. The bill date the frontend submits is the operator's LOCAL
    /// calendar date encoded as midnight UTC — picking "2026-06-17" in a
    /// <c>&lt;input type="date"&gt;</c> sends <c>"2026-06-17T00:00:00Z"</c>. The
    /// old guards compared that instant against server <see cref="DateTime.UtcNow"/>.
    /// Pakistan is UTC+5, so between 19:00 and 23:59 UTC the server's UTC date is
    /// still "yesterday" relative to Karachi, and a bill an operator legitimately
    /// dates "today" was computed as tomorrow-00:00Z and wrongly rejected as
    /// future — blocking a Pakistani wholesaler from billing early in their day.
    ///
    /// FBR is a Pakistani system and rule 0043 concerns the *calendar date*, not
    /// the time-of-day. So "future" is evaluated against today's date in Pakistan,
    /// comparing date-only. The incoming bill date is NOT re-zoned (it already
    /// carries the operator's chosen calendar date as midnight); only "now" is
    /// converted to PKT to learn today's Karachi date.
    ///
    /// PKT has no daylight saving (Pakistan abolished it after 2009), so the
    /// offset is a fixed +5. We resolve the OS time-zone record when present and
    /// fall back to a fixed +5 custom zone when the host lacks tzdata (e.g. a
    /// slim Linux container), so CI and prod behave identically.
    /// </summary>
    public static class PakistanClock
    {
        private static readonly TimeZoneInfo Tz = ResolveTimeZone();

        private static TimeZoneInfo ResolveTimeZone()
        {
            // Windows uses "Pakistan Standard Time"; Linux/macOS use the IANA id
            // "Asia/Karachi". .NET 6+ understands both on most hosts, but we try
            // each and fall back to a fixed +5 offset so a missing tzdata package
            // can never throw at startup.
            foreach (var id in new[] { "Pakistan Standard Time", "Asia/Karachi" })
            {
                try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
                catch (TimeZoneNotFoundException) { }
                catch (InvalidTimeZoneException) { }
            }
            return TimeZoneInfo.CreateCustomTimeZone(
                "PKT", TimeSpan.FromHours(5), "Pakistan Standard Time", "Pakistan Standard Time");
        }

        /// <summary>Current wall-clock time in Pakistan (Karachi).</summary>
        public static DateTime Now => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Tz);

        /// <summary>Today's calendar date in Pakistan (time component 00:00).</summary>
        public static DateTime Today => Now.Date;

        /// <summary>
        /// True when <paramref name="date"/>'s calendar date is after today in
        /// Pakistan — i.e. it violates the FBR [0043] future-date rule. Compares
        /// date-only, so the operator may pick "today" at any time of day, in any
        /// server time zone, without tripping the gate. The incoming value's
        /// time-of-day and <see cref="DateTimeKind"/> are ignored: only the
        /// calendar date the operator entered is considered.
        /// </summary>
        public static bool IsFutureInvoiceDate(DateTime date) => date.Date > Today;
    }
}
