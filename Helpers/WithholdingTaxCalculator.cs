namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Resolves the stored withholding-tax amount (PKR) on an Invoice /
    /// PurchaseBill from its rate/amount mode (Manager.io parity). WHT is an
    /// income-tax deduction that sits ON TOP of sales tax — it is computed on
    /// the GROSS document total (net + GST), never on the net.
    ///
    /// Mode is implicit in the stored fields:
    ///   • rate has value  → RATE mode: amount = round(rate% × grandTotal, 2)
    ///   • rate is null     → FIXED-AMOUNT mode: keep the supplied amount
    /// The result is always clamped to [0, grandTotal] so a bad rate/amount can
    /// never make the collectible balance negative.
    /// </summary>
    public static class WithholdingTaxCalculator
    {
        public static decimal Resolve(decimal? rate, decimal grandTotal, decimal explicitAmount)
        {
            if (grandTotal <= 0m) return 0m;

            var amount = rate.HasValue
                ? Math.Round(grandTotal * rate.Value / 100m, 2, MidpointRounding.AwayFromZero)
                : explicitAmount;

            if (amount < 0m) amount = 0m;
            if (amount > grandTotal) amount = grandTotal;
            return amount;
        }

        /// <summary>Collectible balance = what the counterparty actually pays /
        /// is owed after the withheld slice is remitted to the tax authority.</summary>
        public static decimal Collectible(decimal grandTotal, decimal withholdingTaxAmount)
        {
            var c = grandTotal - withholdingTaxAmount;
            return c < 0m ? 0m : c;
        }
    }
}
