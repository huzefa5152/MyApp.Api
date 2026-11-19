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
        /// The rate a new bill starts on when nobody has said: 4% for a buyer
        /// who is not registered, none for one who is. This is the bill form's
        /// own default (the forms treat a buyer with no registration type as
        /// unregistered), kept here so a bill made any other way -- an agent's
        /// -- starts where an operator's would. It is only ever a starting
        /// point: a rate that was stated, zero included, is never replaced.
        /// </summary>
        public static decimal? DefaultRate(string? buyerRegistrationType) =>
            string.Equals(buyerRegistrationType?.Trim(), "Registered", StringComparison.OrdinalIgnoreCase)
                ? null : 4m;

        /// <summary>
        /// Makes the filed items add up to the bill's further tax to the paisa.
        /// Each item is rounded on its own, so several lines can land a paisa
        /// or two off the figure the bill prints; the largest item takes the
        /// difference. Anything bigger than rounding is NOT a rounding matter
        /// and is left exactly as computed.
        /// </summary>
        public static decimal[] SettleToBill(decimal billAmount, IReadOnlyList<decimal> itemAmounts)
        {
            var settled = itemAmounts.ToArray();
            var drift = billAmount - settled.Sum();
            if (drift == 0m || settled.Length == 0 || Math.Abs(drift) > 0.01m * settled.Length) return settled;
            settled[Array.IndexOf(settled, settled.Max())] += drift;
            return settled;
        }

        /// <summary>
        /// What the document comes to once further tax is on it. Kept here so a
        /// caller cannot forget the third term.
        /// </summary>
        public static decimal GrandTotal(decimal subtotal, decimal gstAmount, decimal furtherTaxAmount)
            => subtotal + gstAmount + furtherTaxAmount;
    }
}
