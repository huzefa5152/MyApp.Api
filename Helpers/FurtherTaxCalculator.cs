namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Further tax (Sales Tax Act s.3(1A)) on a sales document — the ONE place
    /// the document-level amount and the grand total are worked out.
    ///
    /// Unlike withholding tax, which is DEDUCTED from what the buyer pays,
    /// further tax IS part of the supply's tax: it is charged on the same base
    /// as sales tax, belongs on the sales-tax invoice, and ADDS to the grand
    /// total.
    ///
    ///   GrandTotal = Subtotal + GSTAmount + FurtherTaxAmount
    ///
    /// The BASE is the net value of supply — the subtotal, not the tax-inclusive
    /// total. That is what the per-line tax has always used (lineTotal x rate),
    /// so a document-level figure computed on the gross would disagree with the
    /// payload FBR receives.
    ///
    /// <see cref="GrandTotal"/> exists so no caller can compute a sales total
    /// and forget the third term. Every place that totals a sales document goes
    /// through it, including the ones where the rate is null — a null rate
    /// yields 0 and the result is byte-identical to the old two-term sum, which
    /// is what makes this safe on every document written before the tax existed.
    /// </summary>
    public static class FurtherTaxCalculator
    {
        /// <summary>
        /// The amount for a stored rate, or 0 when no rate applies. A null rate
        /// means the operator did not select further tax at all, which is how
        /// every existing document reads. Rounded to the 2dp money precision the
        /// column stores, away from zero, as every other tax figure on the
        /// document is.
        /// </summary>
        public static decimal Resolve(decimal? rate, decimal subtotal)
        {
            if (rate is null or <= 0m) return 0m;
            if (subtotal <= 0m) return 0m;
            return Math.Round(subtotal * rate.Value / 100m, 2, MidpointRounding.AwayFromZero);
        }

        /// <summary>What a sales document comes to once further tax is on it.</summary>
        public static decimal GrandTotal(decimal subtotal, decimal gstAmount, decimal furtherTaxAmount)
            => subtotal + gstAmount + furtherTaxAmount;

        /// <summary>Allocate the saved tax to payload rows without losing pennies
        /// when rows are grouped or their effective values have been adjusted.</summary>
        public static decimal[] Allocate(decimal amount, IReadOnlyList<decimal> values)
        {
            var result = new decimal[values.Count];
            if (amount == 0m) return result;
            var total = values.Sum(v => Math.Max(0m, v));
            if (amount < 0m || total <= 0m)
                throw new InvalidOperationException("Further tax requires a positive value of supply.");
            var remaining = Math.Round(amount, 2, MidpointRounding.AwayFromZero);
            var remainingBase = total;
            for (var i = 0; i < values.Count; i++)
            {
                var value = Math.Max(0m, values[i]);
                if (value == 0m) continue;
                result[i] = Math.Min(remaining, Math.Round(remaining * value / remainingBase,
                    2, MidpointRounding.AwayFromZero));
                remaining -= result[i];
                remainingBase -= value;
            }
            return result;
        }
    }
}
