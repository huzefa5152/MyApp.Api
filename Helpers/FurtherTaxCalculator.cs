namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Further tax (Sales Tax Act s.3(1A)) on a sales document — the ONE place
    /// the document-level amount is worked out.
    ///
    /// Unlike withholding tax (deducted from what the buyer pays) and advance
    /// income tax (collected on top but OUTSIDE the sales-tax invoice), further
    /// tax IS part of the supply's tax: it is charged on the same base as sales
    /// tax, belongs on the sales-tax invoice, and adds to the grand total.
    ///
    ///   GrandTotal = Subtotal + GSTAmount + FurtherTaxAmount
    ///
    /// The BASE is the net value of supply — the subtotal, not the
    /// tax-inclusive total. That is what <see cref="FbrLineTax"/> has always
    /// used per line (lineTotal x rate), so a document-level figure computed on
    /// the gross would disagree with the payload FBR receives.
    ///
    /// Mode mirrors <see cref="WithholdingTaxCalculator"/>: a null rate means
    /// no further tax at all, which is how every existing row reads.
    /// </summary>
    public static class FurtherTaxCalculator
    {
        /// <summary>
        /// The amount for a stored rate, or 0 when no rate applies. Rounded to
        /// the 2dp money precision the column stores, away from zero, as every
        /// other tax figure on the document is.
        /// </summary>
        public static decimal Resolve(decimal? rate, decimal subtotal)
        {
            if (rate is null or <= 0m) return 0m;
            if (subtotal <= 0m) return 0m;
            return Math.Round(subtotal * rate.Value / 100m, 2, MidpointRounding.AwayFromZero);
        }

        /// <summary>
        /// What the document comes to once further tax is on it. Kept here so a
        /// caller cannot forget the third term.
        /// </summary>
        public static decimal GrandTotal(decimal subtotal, decimal gstAmount, decimal furtherTaxAmount)
            => subtotal + gstAmount + furtherTaxAmount;
    }
}
