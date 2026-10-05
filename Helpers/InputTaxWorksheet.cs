namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The importer's monthly sales-tax return worksheet (2026-10-05). PURE: no
    /// database, no ledger -- the controller loads the figures, this decides.
    ///
    /// It answers the questions an importer's consultant works through every
    /// month, from the documents rather than the ledger, because the return is
    /// filed by CLAIM MONTH while the ledger posts a GD's input tax on its GD
    /// date:
    ///
    /// <list type="bullet">
    /// <item>Output tax: sales tax and further tax charged on the month's bills,
    ///   less credit notes, plus debit notes.</item>
    /// <item>Input tax: sales tax, the value-added tax (AST) and any GST/FED paid at
    ///   import on the GDs CLAIMED in the month, plus the input tax on the month's
    ///   purchase bills less purchase debit notes.</item>
    /// <item>Section 8B: input tax adjustable in a month is capped at a percentage
    ///   of that month's output tax (90% by default). The rest is carried forward,
    ///   month by month.</item>
    /// <item>Time limit: a GD's input tax has to be claimed within a number of tax
    ///   periods after the GD's month (6 by default). A GD not claimed in time is
    ///   listed as lapsed; one still open is listed with the month it must be
    ///   claimed by.</item>
    /// </list>
    ///
    /// Both limits are the installation's <c>TaxCompliance</c> settings, the same
    /// ones the per-bill claim panel already reads, so the two cannot disagree.
    /// This is a worksheet, not the return: the screen says so, and the Tax
    /// Summary report remains the ledger's own account of what was posted.
    /// </summary>
    public static class InputTaxWorksheet
    {
        public sealed record MonthFigures(
            DateTime Month, decimal OutputTax,
            decimal ImportSalesTax, decimal ImportValueAddedTax, decimal ImportOtherTax,
            decimal PurchaseInputTax);

        public sealed record GdTax(
            string GdNumber, DateTime GdDate, DateTime? ClaimMonth, string Description, string? HsCode,
            decimal SalesTax, decimal ValueAddedTax, decimal OtherTax)
        {
            public decimal InputTax => SalesTax + ValueAddedTax + OtherTax;
        }

        public sealed record MonthRow(
            DateTime Month, decimal OutputTax,
            decimal ImportSalesTax, decimal ImportValueAddedTax, decimal ImportOtherTax, decimal PurchaseInputTax,
            decimal InputThisMonth, decimal BroughtForward, decimal Available,
            decimal CapLimit, decimal Admissible, decimal CarriedForward, decimal Payable, bool CapApplied);

        public enum TimeLimitStatus { Lapsed, Open, ClaimedLate }

        public sealed record TimeLimitRow(
            string GdNumber, DateTime GdDate, DateTime? ClaimMonth, string Description, string? HsCode,
            decimal InputTax, DateTime ClaimBy, TimeLimitStatus Status);

        public sealed record Result(List<MonthRow> Months, List<TimeLimitRow> TimeLimit);

        public static DateTime MonthOf(DateTime d) => new(d.Year, d.Month, 1);

        /// <summary>The last month a GD's input tax may be claimed in: its own
        /// month plus <paramref name="periods"/>.</summary>
        public static DateTime ClaimBy(DateTime gdDate, int periods) => MonthOf(gdDate).AddMonths(periods);

        /// <param name="months">Every month from the first with any activity to
        /// the last month asked for, in order, gaps included. The carry-forward
        /// is walked from the first.</param>
        /// <param name="asOfMonth">The month the time-limit list is judged at
        /// (usually the last month shown).</param>
        public static Result Build(
            IReadOnlyList<MonthFigures> months, IEnumerable<GdTax> gdLines,
            decimal capPercent, int periods, DateTime asOfMonth)
        {
            var rows = new List<MonthRow>(months.Count);
            var carry = 0m;
            foreach (var m in months.OrderBy(m => m.Month))
            {
                var input = Money(m.ImportSalesTax + m.ImportValueAddedTax + m.ImportOtherTax + m.PurchaseInputTax);
                var available = Money(carry + input);
                var output = Money(m.OutputTax);
                var cap = output > 0m ? Money(output * capPercent / 100m) : 0m;
                // Never adjust more than is available, never more than the cap,
                // never below zero (a month whose credit notes exceed its bills).
                var admissible = Math.Max(0m, Math.Min(available, cap));
                var carried = Money(available - admissible);
                rows.Add(new MonthRow(m.Month, output,
                    Money(m.ImportSalesTax), Money(m.ImportValueAddedTax), Money(m.ImportOtherTax),
                    Money(m.PurchaseInputTax), input, Money(carry), available, cap, admissible, carried,
                    Money(Math.Max(0m, output - admissible)),
                    CapApplied: available > cap && output > 0m));
                carry = carried;
            }

            var asOf = MonthOf(asOfMonth);
            var limit = new List<TimeLimitRow>();
            foreach (var g in gdLines)
            {
                if (g.InputTax <= 0m) continue;
                var by = ClaimBy(g.GdDate, periods);
                TimeLimitStatus? status = g.ClaimMonth is DateTime cm
                    ? (MonthOf(cm) > by ? TimeLimitStatus.ClaimedLate : null)
                    : (asOf > by ? TimeLimitStatus.Lapsed : TimeLimitStatus.Open);
                if (status is TimeLimitStatus s)
                    limit.Add(new TimeLimitRow(g.GdNumber, g.GdDate, g.ClaimMonth, g.Description, g.HsCode,
                        Money(g.InputTax), by, s));
            }
            return new Result(rows, limit
                .OrderBy(r => r.Status).ThenBy(r => r.ClaimBy).ThenBy(r => r.GdNumber, StringComparer.OrdinalIgnoreCase)
                .ToList());
        }

        private static decimal Money(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    }
}
