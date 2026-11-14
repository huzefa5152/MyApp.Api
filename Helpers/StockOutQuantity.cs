namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The quantity an invoice line takes out of stock (2026-11-15).
    ///
    /// A line priced from an AMOUNT bills a whole quantity, and the amount
    /// rarely buys a whole number of units: Rs 30,000 of a machine held as
    /// 1 Pcs worth 250,000 buys 0.12 Pcs. The invoice still says 1 Pcs, but
    /// taking the whole unit out of stock removed 250,000 of value for a
    /// 30,000 sale. InvoiceItem.StockQuantity holds what the
    /// amount actually buys, so the stock gives up the value that was billed.
    ///
    /// It is only ever the rounding of the billed quantity, so it must sit
    /// within one unit of it. Anything else is refused: a stock quantity that
    /// could drift further from the invoice would be a second, unchecked
    /// quantity.
    /// </summary>
    public static class StockOutQuantity
    {
        /// <summary>What the line takes out of stock.</summary>
        public static decimal Of(decimal? stockQuantity, decimal billedQuantity) => stockQuantity ?? billedQuantity;

        /// <summary>
        /// The value to store for a stock quantity a caller sent: null when
        /// none was sent, it is not positive, or it equals the billed quantity.
        /// Throws when it is a whole unit or more away from the billed quantity.
        /// </summary>
        public static decimal? Resolve(decimal? sent, decimal billedQuantity)
        {
            if (sent is not { } s || s <= 0m) return null;
            s = Math.Round(s, 12);
            if (s == billedQuantity) return null;
            if (Math.Abs(s - billedQuantity) >= 1m)
                throw new InvalidOperationException(
                    $"The stock quantity {s:0.####} is not the rounding of the invoice quantity {billedQuantity:0.####}. " +
                    "Enter the amount again so the quantity is worked out from stock.");
            return s;
        }

        /// <summary>
        /// A line's stock quantity after an edit. A value the edit sends
        /// replaces it (zero clears it). When the edit sends none, the stored
        /// one is kept only while the line still bills the same item, quantity
        /// and price; otherwise it no longer describes the line and is cleared.
        /// </summary>
        public static decimal? AfterEdit(decimal? sent, decimal? stored, bool lineUnchanged, decimal billedQuantity)
        {
            if (sent.HasValue) return Resolve(sent, billedQuantity);
            return lineUnchanged ? stored : null;
        }

        /// <summary>A note line's share of its source line's stock quantity.</summary>
        public static decimal? Share(decimal? sourceStockQuantity, decimal sourceQuantity, decimal noteQuantity)
        {
            if (sourceStockQuantity is not { } s || sourceQuantity <= 0m) return null;
            return Math.Round(s * noteQuantity / sourceQuantity, 12);
        }
        /// <summary>One GD pool the next sale drains, in the order it drains them.</summary>
        public readonly record struct Tier(decimal Quantity, decimal Value, decimal UnitCost);

        /// <summary>What an amount becomes on an invoice line.</summary>
        public readonly record struct Priced(decimal Quantity, decimal UnitPrice, decimal? StockQuantity, bool CloseOut);

        /// <summary>
        /// The quantity <paramref name="amount"/> buys, walking the tiers in
        /// order; past the last tier its cost continues. With no tiers the
        /// single <paramref name="unitCost"/> prices it (weighted average).
        /// Mirrors fifoQuantityForAmount in utils/fifoPricing.js.
        /// </summary>
        public static decimal QuantityForAmount(decimal amount, decimal unitCost, IReadOnlyList<Tier>? tiers)
        {
            var usable = tiers?.Where(t => t.Quantity > 0m && t.UnitCost > 0m).ToList();
            if (usable == null || usable.Count == 0) return unitCost > 0m ? amount / unitCost : 0m;
            decimal left = amount, qty = 0m, last = 0m;
            foreach (var t in usable)
            {
                var value = t.Value > 0m ? t.Value : t.Quantity * t.UnitCost;
                last = value / t.Quantity;
                if (left <= value) return qty + left / last;
                qty += t.Quantity;
                left -= value;
            }
            return qty + left / last;
        }

        /// <summary>
        /// Prices a line from an amount exactly as the invoice forms do: a
        /// whole billed quantity (at least 1), a rate that makes the line the
        /// amount, and the stock quantity the amount really buys. An amount
        /// equal to the whole bin's value bills the whole bin (rounded up on a
        /// whole-unit item; the server settles the fraction). Null when the
        /// item has no stock or no value to price from.
        /// </summary>
        public static Priced? PriceFromAmount(
            decimal amount, decimal availableQuantity, decimal availableValue, decimal unitCost,
            IReadOnlyList<Tier>? tiers, bool decimalUnit)
        {
            if (amount <= 0m || availableQuantity <= 0m || availableValue <= 0m || unitCost <= 0m) return null;
            var fullValue = Math.Round(availableValue, 2, MidpointRounding.AwayFromZero);
            if (Math.Abs(amount - fullValue) < 0.005m)
            {
                var all = decimalUnit ? availableQuantity : Math.Max(1m, Math.Ceiling(availableQuantity));
                return new Priced(all, Math.Round(fullValue / all, 12), null, true);
            }
            var raw = QuantityForAmount(amount, unitCost, tiers);
            var qty = Math.Max(1m, Math.Round(raw, 0, MidpointRounding.AwayFromZero));
            return new Priced(qty, Math.Round(amount / qty, 12), Resolve(raw, qty), false);
        }
    }
}
