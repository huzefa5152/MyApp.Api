namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The nine date options every report filter bar offers, resolved server-side.
    ///
    /// Why server-side: the browser's clock and time zone are not the business's.
    /// "This Month" for a Karachi wholesaler means the Pakistani calendar month, so
    /// every preset resolves off <see cref="PakistanClock.Today"/> — the same clock
    /// the FBR future-date guard and the accounting dashboard already use. A client
    /// computing its own boundaries would disagree with the ledger between 19:00 and
    /// midnight UTC, exactly the bug PakistanClock exists to prevent.
    ///
    /// <see cref="AllPeriods"/> resolves to (null, null): no date predicate at all.
    /// That is the "how did this balance ever arise" case — a customer ledger or cash
    /// book covering the entire life of the company — and is deliberately distinct
    /// from a very wide custom range, because a null window lets the query planner
    /// skip the date index entirely.
    /// </summary>
    public enum ReportDatePreset
    {
        AllPeriods = 0,
        Today = 1,
        ThisWeek = 2,
        ThisMonth = 3,
        LastMonth = 4,
        ThisQuarter = 5,
        ThisYear = 6,
        LastYear = 7,
        Custom = 8,
    }

    /// <summary>A resolved reporting window. Both bounds null = all periods.</summary>
    public readonly record struct ReportWindow(DateTime? From, DateTime? To, string Label)
    {
        public bool IsAllPeriods => From == null && To == null;
    }

    public static class ReportPeriod
    {
        /// <summary>Monday. Pakistan's business week starts Monday, and an operator
        /// asking for "this week" on a Sunday means the week that is ending, not one
        /// that started hours ago.</summary>
        private const DayOfWeek WeekStart = DayOfWeek.Monday;

        /// <summary>
        /// Parse the wire value of the preset. Unknown/empty → <see cref="ReportDatePreset.AllPeriods"/>
        /// so a malformed query string degrades to a valid (if broad) report rather
        /// than a 400 — the caller can still see their data.
        /// </summary>
        public static ReportDatePreset ParsePreset(string? raw) => (raw ?? "").Trim().ToLowerInvariant() switch
        {
            "today" => ReportDatePreset.Today,
            "thisweek" or "week" => ReportDatePreset.ThisWeek,
            "thismonth" or "month" => ReportDatePreset.ThisMonth,
            "lastmonth" => ReportDatePreset.LastMonth,
            "thisquarter" or "quarter" => ReportDatePreset.ThisQuarter,
            "thisyear" or "year" => ReportDatePreset.ThisYear,
            "lastyear" => ReportDatePreset.LastYear,
            "custom" => ReportDatePreset.Custom,
            _ => ReportDatePreset.AllPeriods,
        };

        /// <summary>
        /// Validate a caller-supplied period. Returns an operator-friendly message,
        /// or null when the period is usable. Mirrors
        /// <c>ReportsController.ValidatePeriod</c>'s contract so both reporting
        /// surfaces reject the same inputs the same way.
        /// </summary>
        public static string? Validate(ReportDatePreset preset, DateTime? from, DateTime? to)
        {
            if (preset != ReportDatePreset.Custom) return null;
            if (!from.HasValue || !to.HasValue)
                return "Provide both a start and end date for a custom range.";
            if (from.Value.Date > to.Value.Date)
                return "Start date must be on or before the end date.";
            return null;
        }

        /// <summary>
        /// Resolve a preset into an inclusive date window plus the human label the
        /// report header and Excel banner print. <paramref name="from"/>/<paramref name="to"/>
        /// are honoured only for <see cref="ReportDatePreset.Custom"/>.
        /// </summary>
        public static ReportWindow Resolve(ReportDatePreset preset, DateTime? from = null, DateTime? to = null)
        {
            var today = PakistanClock.Today;

            switch (preset)
            {
                case ReportDatePreset.Today:
                    return Window(today, today);

                case ReportDatePreset.ThisWeek:
                {
                    // ((current - start) + 7) % 7 gives days elapsed since Monday for
                    // any DayOfWeek numbering, including Sunday == 0.
                    var offset = ((int)today.DayOfWeek - (int)WeekStart + 7) % 7;
                    var start = today.AddDays(-offset);
                    return Window(start, start.AddDays(6));
                }

                case ReportDatePreset.ThisMonth:
                {
                    var start = new DateTime(today.Year, today.Month, 1);
                    return Window(start, start.AddMonths(1).AddDays(-1));
                }

                case ReportDatePreset.LastMonth:
                {
                    var start = new DateTime(today.Year, today.Month, 1).AddMonths(-1);
                    return Window(start, start.AddMonths(1).AddDays(-1));
                }

                case ReportDatePreset.ThisQuarter:
                {
                    var startMonth = ((today.Month - 1) / 3) * 3 + 1;
                    var start = new DateTime(today.Year, startMonth, 1);
                    return Window(start, start.AddMonths(3).AddDays(-1));
                }

                case ReportDatePreset.ThisYear:
                {
                    var start = new DateTime(today.Year, 1, 1);
                    return Window(start, start.AddYears(1).AddDays(-1));
                }

                case ReportDatePreset.LastYear:
                {
                    var start = new DateTime(today.Year - 1, 1, 1);
                    return Window(start, start.AddYears(1).AddDays(-1));
                }

                case ReportDatePreset.Custom:
                    // Validate() is the gate; if a caller skipped it, fall back to an
                    // open-ended window on whichever bound was supplied rather than
                    // throwing — a report is more useful than an error here.
                    return new ReportWindow(from?.Date, to?.Date, DescribeRange(from?.Date, to?.Date));

                case ReportDatePreset.AllPeriods:
                default:
                    return new ReportWindow(null, null, "All periods");
            }
        }

        private static ReportWindow Window(DateTime from, DateTime to) =>
            new(from, to, DescribeRange(from, to));

        /// <summary>"1 Aug 2026 – 31 Aug 2026", or an open-ended variant when a
        /// custom range carries only one bound.</summary>
        public static string DescribeRange(DateTime? from, DateTime? to)
        {
            if (from == null && to == null) return "All periods";
            if (from != null && to == null) return $"From {Fmt(from.Value)}";
            if (from == null) return $"Up to {Fmt(to!.Value)}";
            return from.Value.Date == to!.Value.Date ? Fmt(from.Value) : $"{Fmt(from.Value)} – {Fmt(to.Value)}";
        }

        private static string Fmt(DateTime d) => d.ToString("d MMM yyyy");
    }
}
