namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Withholding income tax (s.153) on a sales invoice or a purchase bill —
    /// the ONE place the amount and the collectible balance are worked out.
    ///
    /// Withholding is NOT part of the supply's tax. It is deducted at source by
    /// whoever pays, and remitted by them to FBR:
    ///
    ///   • on a SALES invoice the customer withholds it, so we collect less than
    ///     the grand total and hold a receivable against FBR for the difference;
    ///   • on a PURCHASE bill we withhold it, so we pay the supplier less and
    ///     owe FBR the difference.
    ///
    /// Either way it NEVER moves the grand total, and it is not on the FBR
    /// sales-tax invoice — GrandTotal, GSTAmount and the PRAL payload are
    /// untouched. It only changes what is collectible:
    ///
    ///   Collectible = GrandTotal − WithholdingTaxAmount
    ///
    /// It is computed on the GROSS document total (net + sales tax), not the
    /// net. Mode is implicit in the stored fields:
    ///
    ///   • rate has a value → RATE mode, amount = round(rate% x grandTotal, 2)
    ///   • rate is null     → FIXED-AMOUNT mode, the supplied amount is kept
    ///   • both empty       → no withholding, which is how every document
    ///                        written before this existed reads
    ///
    /// The result is clamped to [0, grandTotal] so a mistyped rate can never
    /// make a balance negative.
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

        /// <summary>What the counterparty actually pays, or is owed, once the
        /// withheld slice goes to FBR instead. This is the figure the balance
        /// due and the payment status are measured against — not the grand
        /// total, or an invoice with withholding on it would never read as
        /// fully paid.</summary>
        public static decimal Collectible(decimal grandTotal, decimal withholdingTaxAmount)
        {
            var c = grandTotal - withholdingTaxAmount;
            return c < 0m ? 0m : c;
        }
    }
}
