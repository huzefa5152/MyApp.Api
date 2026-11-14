namespace MyApp.Api.Helpers
{
    /// <summary>
    /// A stock sheet describes a month end. Dated any later, the month's own
    /// sales and GDs entered afterwards land BEFORE the match and are treated as
    /// late documents (AY: the Sep 2026 sheet was matched dated 18 Oct, and every
    /// October document then fell in front of it). Pure.
    /// </summary>
    public static class StockSheetDates
    {
        public static DateTime MonthEnd(DateTime d) =>
            new DateTime(d.Year, d.Month, DateTime.DaysInMonth(d.Year, d.Month));

        public static string NotMonthEndMessage(DateTime asOf)
        {
            var before = new DateTime(asOf.Year, asOf.Month, 1).AddDays(-1);
            return $"A stock sheet is dated on the last day of the month it describes: use {before:dd MMM yyyy} " +
                   $"for a {before:MMMM} sheet, or {MonthEnd(asOf):dd MMM yyyy} for {asOf:MMMM} once it has ended. " +
                   "A physical count taken mid-month is marked as a stock count.";
        }
    }
}
