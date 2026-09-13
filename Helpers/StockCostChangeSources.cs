namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The writers of <see cref="Models.StockCostChange"/>. String constants
    /// rather than an enum for the same reason the import kinds and allocation
    /// modes are: the value is rendered straight onto a screen and read back out
    /// of the database by hand during an investigation, and an int there answers
    /// nothing.
    ///
    /// Add a member here whenever a new path writes
    /// <see cref="Models.OpeningStockBalance.ActualCostExcludingTax"/>. A path
    /// that writes it and records nothing is the whole failure this table exists
    /// to prevent.
    /// </summary>
    public static class StockCostChangeSources
    {
        /// <summary>A GD costing sheet was committed (either mode).</summary>
        public const string GdCostingImport = "GdCostingImport";

        /// <summary>One line of an already-recorded GD was corrected in place.</summary>
        public const string GdLineCorrection = "GdLineCorrection";

        /// <summary>A recorded consignment was deleted and its contribution reversed.</summary>
        public const string ConsignmentDelete = "ConsignmentDelete";

        /// <summary>The Opening Balances tab wrote the figure by hand.</summary>
        public const string OpeningBalanceEdit = "OpeningBalanceEdit";

        /// <summary>An opening balance row was removed outright.</summary>
        public const string OpeningBalanceDelete = "OpeningBalanceDelete";

        /// <summary>The stock dashboard's Adjust action corrected the pool.</summary>
        public const string StockAdjustment = "StockAdjustment";

        /// <summary>Every source, for a caller that wants to validate one.</summary>
        public static readonly string[] All =
        {
            GdCostingImport, GdLineCorrection, ConsignmentDelete,
            OpeningBalanceEdit, OpeningBalanceDelete, StockAdjustment,
        };
    }
}
