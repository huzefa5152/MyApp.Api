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
    }
}
