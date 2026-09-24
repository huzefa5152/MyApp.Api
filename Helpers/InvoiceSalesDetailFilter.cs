using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The period and filters of the Invoice Sales Detail report, resolved ONCE
    /// for the screen and the Excel export, so the two always select the same
    /// bills.
    ///
    /// The period is the shared <see cref="ReportPeriod"/> preset set, resolved on
    /// Pakistan time like every Accounting report, except All Periods: this report
    /// returns every line in one response, so it needs a bounded window. An unknown
    /// preset parses to All Periods and is refused with it. The old Year + Month
    /// pair still works when no preset is given, so a link written before the
    /// presets keeps opening the month it named.
    /// </summary>
    public static class InvoiceSalesDetailFilter
    {
        public const int MaxSearchLength = 100;
        public const string Submitted = "submitted";
        public const string NotSubmitted = "notSubmitted";

        /// <summary>An operator-worded reason the query cannot run, or null.</summary>
        public static string? Validate(InvoiceSalesDetailQueryDto q)
        {
            if (string.IsNullOrWhiteSpace(q.Period))
            {
                if ((q.Year.HasValue || q.Month.HasValue)
                    && (q.Year is not (>= 2000 and <= 2100) || q.Month is not (>= 1 and <= 12)))
                    return "Choose a valid month and year.";
            }
            else
            {
                var preset = ReportPeriod.ParsePreset(q.Period);
                if (preset == ReportDatePreset.AllPeriods)
                    return "Choose a period for this report: this month, this year or a custom range.";
                if (ReportPeriod.Validate(preset, q.From, q.To) is { } err) return err;
            }
            if (!TryParseFbrStatus(q.FbrStatus, out _))
                return "Choose an FBR status of submitted or not submitted.";
            if ((q.Search?.Trim().Length ?? 0) > MaxSearchLength)
                return $"Search is limited to {MaxSearchLength} characters.";
            return null;
        }

        /// <summary>The dates the query covers, both ends included. Call after <see cref="Validate"/>.</summary>
        public static ReportWindow ResolveWindow(InvoiceSalesDetailQueryDto q)
        {
            if (string.IsNullOrWhiteSpace(q.Period) && q.Year.HasValue && q.Month.HasValue)
            {
                var from = new DateTime(q.Year.Value, q.Month.Value, 1);
                var to = from.AddMonths(1).AddDays(-1);
                return new ReportWindow(from, to, ReportPeriod.DescribeRange(from, to));
            }
            var preset = string.IsNullOrWhiteSpace(q.Period)
                ? ReportDatePreset.ThisMonth
                : ReportPeriod.ParsePreset(q.Period);
            return ReportPeriod.Resolve(preset, q.From, q.To);
        }

        /// <summary>"submitted" / "notSubmitted"; empty or "all" = no filter. False = not a status.</summary>
        public static bool TryParseFbrStatus(string? raw, out string? status)
        {
            status = null;
            var v = (raw ?? "").Trim();
            if (v.Length == 0 || v.Equals("all", StringComparison.OrdinalIgnoreCase)) return true;
            if (v.Equals(Submitted, StringComparison.OrdinalIgnoreCase)) { status = Submitted; return true; }
            if (v.Equals(NotSubmitted, StringComparison.OrdinalIgnoreCase)) { status = NotSubmitted; return true; }
            return false;
        }

        /// <summary>
        /// Search is BILL-level: a bill is listed when any of its lines shows the
        /// text in a field the grid displays, so a search never splits a bill.
        /// </summary>
        public static bool RowMatches(InvoiceSalesDetailRowDto r, string term) =>
            Has(r.InvoiceNumber, term) || Has(r.InvoiceSeries + r.InvoiceNumber, term)
            || Has(r.DeliveryChallanNumbers, term) || Has(r.Buyer, term) || Has(r.BuyerNtn, term)
            || Has(r.FbrInvoiceNumber, term) || Has(r.HsCode, term) || Has(r.Description, term);

        /// <summary>
        /// The workbook's file name: a window that is exactly one calendar month
        /// keeps the name the export has always had; any other range names its dates.
        /// </summary>
        public static string ExcelFileName(DateTime from, DateTime to)
        {
            var f = from.Date;
            var wholeMonth = f.Day == 1 && to.Date == f.AddMonths(1).AddDays(-1);
            return wholeMonth
                ? $"Invoice-Sales-Detail-{f:yyyy-MM}.xlsx"
                : $"Invoice-Sales-Detail-{f:yyyy-MM-dd}_to_{to:yyyy-MM-dd}.xlsx";
        }

        private static bool Has(string? field, string term) =>
            !string.IsNullOrEmpty(field) && field.Contains(term, StringComparison.OrdinalIgnoreCase);
    }
}
