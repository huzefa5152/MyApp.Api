using MyApp.Api.Helpers.ExcelImport;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// What makes a GD costing line complete -- the ONE definition, for an
    /// uploaded sheet row and a hand-typed line alike (maintainer's decision,
    /// 2026-09-25).
    ///
    /// Before this every field but the GD number, description and quantity was
    /// optional, and each gap let stock come up wrong without a word: no HS
    /// code or no unit and the item cannot be billed to FBR, no GD date and the
    /// import date stood in (the stock, the journal entry and the claim month
    /// all landed in the wrong month), a zero assessed value and the goods
    /// came in with no cost.
    ///
    /// Pure: no database, no clock -- the caller passes today. The rules that
    /// need the books (a unit against the item it adds to, a new item's HS code
    /// against the tariff master) live in <c>GdCostingImportService</c>, next
    /// to the matching they depend on. <c>utils/gdCostingEntry.js</c> mirrors
    /// this file word for word for instant feedback on screen; the server's
    /// answer is the one that counts, at preview AND at commit.
    ///
    /// Every problem on a line is reported, in form order -- one message at a
    /// time is how an operator fixes one thing and meets the next.
    /// </summary>
    public static class GdLineRules
    {
        /// <summary>Which box a problem belongs to. The screen puts the message
        /// under that box, so these are the line editor's field names.</summary>
        public static class Fields
        {
            public const string GdNumber = "gdNumber";
            public const string GdDate = "gdDate";
            public const string Description = "description";
            public const string HsCode = "hsCode";
            public const string Quantity = "quantity";
            public const string Unit = "unit";
            public const string AssessedValue = "assessedValue";
            public const string Amounts = "amounts";
            public const string Rates = "rates";
            public const string SellingValue = "sellingValue";

            /// <summary>Not a box: the item the line lands on (ambiguous, or a
            /// unit that disagrees with the item's). Service-side only.</summary>
            public const string Item = "item";
        }

        public sealed record Problem(string Field, string Message);

        public sealed record Line(
            string? GdNumber,
            DateTime? GdDate,
            string? Description,
            string? HsCode,
            decimal Quantity,
            string? Unit,
            decimal AssessedValue,
            decimal CustomsDuty,
            decimal Acd,
            decimal RegulatoryDuty,
            decimal Others,
            decimal AddOnProfit,
            decimal SalesTaxRate,
            decimal AstRate,
            decimal IncomeTaxRate,
            decimal? SellingValue);

        /// <summary>No GD in these books predates this; a date before it is a
        /// typing slip (1926 for 2026), not history.</summary>
        public static readonly DateTime EarliestGdDate = new(2000, 1, 1);

        /// <summary>
        /// Every rule this line breaks, empty when it is complete.
        /// <paramref name="todayUtc"/> is the server's date: a GD dated TOMORROW
        /// is allowed, because Pakistan runs five hours ahead of UTC and a GD
        /// typed at 2am there is dated a day the server has not reached yet.
        /// </summary>
        public static List<Problem> Check(Line line, DateTime todayUtc)
        {
            var problems = new List<Problem>();

            if (string.IsNullOrWhiteSpace(line.GdNumber))
                problems.Add(new(Fields.GdNumber, "Enter the GD number."));

            if (line.GdDate is not DateTime gdDate)
                problems.Add(new(Fields.GdDate, "Enter the GD date."));
            else if (gdDate.Date < EarliestGdDate)
                problems.Add(new(Fields.GdDate, "The GD date is before 2000. Check the year."));
            else if (gdDate.Date > todayUtc.Date.AddDays(1))
                problems.Add(new(Fields.GdDate, "The GD date is in the future."));

            if (string.IsNullOrWhiteSpace(line.Description))
                problems.Add(new(Fields.Description, "Enter what the goods are (the item name)."));

            if (GdCostingMapping.CleanHsCode(line.HsCode).Length == 0)
                problems.Add(new(Fields.HsCode, "Enter the HS code."));

            if (line.Quantity <= 0m)
                problems.Add(new(Fields.Quantity, "Enter a quantity above zero."));

            if (string.IsNullOrWhiteSpace(line.Unit))
                problems.Add(new(Fields.Unit, "Enter the unit (Pcs, Kg, ...)."));

            if (line.AssessedValue <= 0m)
                problems.Add(new(Fields.AssessedValue, "Enter the assessed value from the GD."));

            if (line.CustomsDuty < 0m || line.Acd < 0m || line.RegulatoryDuty < 0m
                || line.Others < 0m || line.AddOnProfit < 0m)
                problems.Add(new(Fields.Amounts, "Duties, other charges and add-on profit cannot be negative."));

            // 100% is refused, not just warned about: a cell holding "1" meant
            // as 1% reads as 100% (PercentRate), and no GD carries a 100% rate of
            // anything. The 50-99% band stays a warning (RateWarning) -- odd, but
            // not impossible enough to stop an import over.
            if (NotAPercentage(line.SalesTaxRate) || NotAPercentage(line.AstRate) || NotAPercentage(line.IncomeTaxRate))
                problems.Add(new(Fields.Rates, "Each rate is a percentage from 0 to 100 (write 1% as 1)."));

            if (line.SellingValue is < 0m)
                problems.Add(new(Fields.SellingValue, "The stated selling value cannot be negative."));

            return problems;
        }

        private static bool NotAPercentage(decimal rate) => rate < 0m || rate >= 100m;
    }
}
