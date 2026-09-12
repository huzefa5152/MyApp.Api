namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Turns a rate cell into a PERCENTAGE, whichever of the three ways a real
    /// accountant wrote it.
    ///
    /// The three GD costing workbooks disagree with each other on every rate
    /// column: PAK stores the sales-tax rate as numeric 0.18, Alpha and AY store
    /// the AST rate as the literal text "3%", and AY stores the income-tax rate
    /// as the whole number 6 (its formula reads "=R4*T4%", so the cell means
    /// six percent). All three mean the same thing.
    ///
    /// This matters more than it looks. A rate silently read as zero values a
    /// whole consignment at no tax, and the resulting selling value is a
    /// plausible wrong number rather than a crash - which is exactly how the
    /// opening-stock import once understated tax by 115,270.18 on two rows out
    /// of 120 (CLAUDE.md 5b-3b).
    ///
    /// A value at or below 1 is read as a FRACTION and multiplied up; anything
    /// above 1 is already a percentage. Exactly 1 is ambiguous and is treated as
    /// the fraction: 100% is a rate that exists, and none of these sheets writes
    /// a rate of 1%.
    /// </summary>
    public static class PercentRate
    {
        public static decimal? ToPercent(decimal? numeric, string? text)
        {
            // CellNumber already turns a trailing "%" into the fraction the
            // numeric cells in the same column carry, so the text form and the
            // numeric form arrive in the same shape and one rule serves both.
            var raw = numeric ?? CellNumber.Parse(text);
            if (raw is null) return null;

            var v = raw.Value;
            if (v < 0m) return null;

            return v <= 1m
                ? decimal.Round(v * 100m, 4, MidpointRounding.AwayFromZero)
                : decimal.Round(v, 4, MidpointRounding.AwayFromZero);
        }
    }
}
