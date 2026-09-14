namespace MyApp.Api.Helpers
{
    /// <summary>
    /// What a customs consignment line costs, and what it therefore has to sell
    /// for. The ONE place the GD costing chain is computed — pure, so it can be
    /// exercised offline by scripts/gd_costing_harness with no database.
    ///
    /// Read off the clients' own workbooks, whose formulas are the spec:
    ///
    ///     Cost      = AssessedValue + C.Duty + ACD + RD
    ///     SalesTax  = Cost x STRate
    ///     AST       = Cost x ASTRate
    ///     Subtotal  = Cost + SalesTax + AST + Others
    ///     IncomeTax = Subtotal x ITRate
    ///     InputTax  = SalesTax + AST
    ///     Selling   = InputTax / STRate + AddOnProfit
    ///
    /// The last line is the point of the whole exercise and is not an arbitrary
    /// markup: it reduces to Cost x (1 + ASTRate/STRate), which is the value at
    /// which the output sales tax on the eventual sale exactly absorbs the input
    /// tax paid at import. At the usual 18% / 3% that is a fixed x7/6.
    ///
    /// COST EXCLUDES all three taxes. Sales tax and AST are recoverable input
    /// tax; income tax at import is adjustable against the year's liability.
    /// The clients' own sheets confirm it — they compute Profit = Selling - Cost,
    /// with no tax term.
    ///
    /// Rates are PERCENTAGES (18.00, 3.00, 6.00), matching
    /// <see cref="Models.OpeningStockBalance.SalesTaxRate"/>. The workbooks write
    /// them three different ways; normalising that is the reader's job, not this
    /// one's.
    /// </summary>
    public static class ImportCostingCalculator
    {
        public readonly record struct ImportCostingInput(
            decimal AssessedValue,
            decimal CustomsDuty,
            decimal Acd,
            decimal RegulatoryDuty,
            decimal Others,
            decimal SalesTaxRate,
            decimal AstRate,
            decimal IncomeTaxRate,
            decimal AddOnProfit);

        public readonly record struct ImportCosting(
            decimal Cost,
            decimal SalesTax,
            decimal Ast,
            decimal Subtotal,
            decimal IncomeTax,
            decimal InputTax,
            decimal SellingValue);

        private static decimal Money(decimal v) =>
            Math.Round(v, 2, MidpointRounding.AwayFromZero);

        public static ImportCosting Compute(ImportCostingInput input)
        {
            var cost = Money(input.AssessedValue + input.CustomsDuty
                           + input.Acd + input.RegulatoryDuty);

            var st = Math.Max(0m, input.SalesTaxRate);
            var ast = Math.Max(0m, input.AstRate);
            var it = Math.Max(0m, input.IncomeTaxRate);

            var salesTax = Money(cost * st / 100m);
            var astAmount = Money(cost * ast / 100m);
            var subtotal = Money(cost + salesTax + astAmount + input.Others);
            var incomeTax = Money(subtotal * it / 100m);
            var inputTax = Money(salesTax + astAmount);

            // A zero sales-tax rate has nothing to divide by. Falling back to
            // cost is right rather than merely safe: with no output tax to
            // absorb, there is no tax-driven uplift, so the floor IS the cost.
            var sellingValue = st > 0m
                ? Money(inputTax * 100m / st) + Money(input.AddOnProfit)
                : cost + Money(input.AddOnProfit);

            return new ImportCosting(
                cost, salesTax, astAmount, subtotal, incomeTax, inputTax, sellingValue);
        }

        /// <summary>
        /// The chain RUN BACKWARDS: what a landed cost must have been for stock
        /// carrying this selling value. Selling is cost x (st + ast) / st, so
        /// cost is selling x st / (st + ast).
        ///
        /// Used to sanity-check a Backfill projection, never to write a figure:
        /// a GD's unit cost applied to a balance's whole quantity should land
        /// near this, and when it does not, the goods the GD priced are not
        /// representative of the goods on the books (see
        /// <c>GdCostingImportService.MatchAll</c>).
        ///
        /// Returns null when the answer would be meaningless rather than
        /// returning a misleading zero: a zero or negative selling value has
        /// nothing to invert, and a zero sales-tax rate has no uplift to unwind
        /// — the same guard <c>StockExcelBuilder</c>'s cost-of-goods-sold
        /// fallback keeps, and for the same reason (CLAUDE.md 5b-9: unguarded,
        /// it reports an exempt item's cost as NIL rather than as its value).
        ///
        /// An add-on profit is deliberately NOT subtracted. It is stated per
        /// GD line, while this is asked of a BALANCE that several lines and
        /// several months may have fed, so there is no one figure to remove;
        /// leaving it in makes the expectation slightly high, which only ever
        /// makes the check more forgiving.
        /// </summary>
        public static decimal? ExpectedCostFromSelling(
            decimal sellingValue, decimal salesTaxRate, decimal astRate)
        {
            if (sellingValue <= 0m) return null;
            var st = Math.Max(0m, salesTaxRate);
            var ast = Math.Max(0m, astRate);
            if (st <= 0m) return null;
            return Money(sellingValue * st / (st + ast));
        }
    }
}
