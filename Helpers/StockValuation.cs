using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Values a single item's stock: quantity AND money, from the opening
    /// balance and every movement since.
    ///
    /// WEIGHTED AVERAGE, walked in date order. Each inward movement adds its own
    /// cost to the pool; each outward movement removes stock at the average cost
    /// of the pool at that moment. That is why an outward movement must NOT be
    /// valued at its sale price — selling at a margin would otherwise drain more
    /// value than the goods ever cost and drive the stock value negative while
    /// quantity was still positive.
    ///
    /// A movement with no <see cref="StockMovement.UnitCostExcludingTax"/> is
    /// valued at the running average. That covers every sale and challan (their
    /// price is revenue, not cost) and every adjustment (breakage has no price
    /// at all), and it is what lets those write paths stay untouched.
    ///
    /// Derived from the value, never stored beside it:
    ///     SalesTax  = ValueExcludingTax × Rate / 100
    ///     Including = ValueExcludingTax + SalesTax
    /// The client's own sheet satisfies that identity on every row, so keeping a
    /// second copy would only give it somewhere to drift.
    /// </summary>
    public static class StockValuation
    {
        /// <summary>Where an item stands once every movement has been applied.</summary>
        public readonly record struct Position(
            decimal Quantity,
            decimal ValueExcludingTax,
            decimal SalesTaxRate,
            decimal TotalIn,
            decimal TotalOut,
            decimal ValueIn,
            decimal ValueOut)
        {
            public decimal SalesTax => Round(ValueExcludingTax * SalesTaxRate / 100m);
            public decimal ValueIncludingTax => Round(ValueExcludingTax) + SalesTax;

            /// <summary>Average cost of what is left, or 0 when nothing is.</summary>
            public decimal UnitCost => Quantity > 0m ? ValueExcludingTax / Quantity : 0m;
        }

        /// <summary>
        /// What one movement did to the value, once the walk reached it. The
        /// running figures are AFTER the movement, so a drill-down reads like a
        /// bank statement rather than a list of deltas.
        /// </summary>
        public readonly record struct Step(
            int MovementId,
            decimal UnitCost,
            decimal Amount,
            decimal RunningQuantity,
            decimal RunningValue);

        /// <summary>
        /// Walks <paramref name="movements"/> in date order over the opening
        /// position. Callers pass the movements already filtered to one item and
        /// one company (and to the caller's division scope, if any).
        /// </summary>
        public static Position Compute(
            decimal openingQuantity,
            decimal openingValueExcludingTax,
            decimal salesTaxRate,
            IEnumerable<StockMovement> movements)
            => Compute(openingQuantity, openingValueExcludingTax, salesTaxRate, movements, null);

        /// <summary>
        /// Same walk, but recording what each movement was costed at into
        /// <paramref name="trace"/>. The cost of a movement only exists as part
        /// of the walk — it is the average standing at that moment — so a caller
        /// that wants per-movement money has to collect it here rather than
        /// recompute it afterwards.
        /// </summary>
        public static Position Compute(
            decimal openingQuantity,
            decimal openingValueExcludingTax,
            decimal salesTaxRate,
            IEnumerable<StockMovement> movements,
            List<Step>? trace)
        {
            var qty = openingQuantity;
            var value = openingValueExcludingTax;
            var rate = salesTaxRate;

            decimal totalIn = 0m, totalOut = 0m, valueIn = 0m, valueOut = 0m;

            // Date first, then id: two movements on one day still have to be
            // applied in the order they were written, or the average a sale is
            // costed at depends on how the rows happened to come back.
            foreach (var m in movements.OrderBy(m => m.MovementDate).ThenBy(m => m.Id))
            {
                // A revaluation changes the money and nothing else, so it is
                // handled before the quantity guard below -- its quantity is 0
                // by definition and it would otherwise be skipped entirely.
                if (m.ValueAdjustmentExcludingTax is decimal valueDelta && valueDelta != 0m)
                {
                    if (m.SalesTaxRate is > 0m) rate = m.SalesTaxRate.Value;

                    // Value cannot go below zero, and stock that has run out is
                    // worth exactly nothing -- the same invariant the outward
                    // path keeps, enforced here too so a correction cannot
                    // leave money behind an empty bin.
                    value = qty <= 0m ? 0m : Math.Max(0m, value + valueDelta);

                    if (valueDelta > 0m) valueIn += Round(valueDelta);
                    else valueOut += Round(-valueDelta);

                    // The amount is stored POSITIVE and the direction carries
                    // the sign, exactly as a quantity movement does. Signing it
                    // twice made a write-down read as a write-up.
                    trace?.Add(new Step(m.Id, 0m, Round(Math.Abs(valueDelta)), qty, Round(value)));
                    continue;
                }

                if (m.Quantity <= 0m) continue;

                // A later movement that states its own rate wins — a purchase at
                // 25% moves the item onto 25%.
                if (m.SalesTaxRate is > 0m) rate = m.SalesTaxRate.Value;

                // The average BEFORE this movement is what an outward movement
                // (or a cost-less inward one) is valued at.
                var averageCost = qty > 0m ? value / qty : 0m;
                var unitCost = m.UnitCostExcludingTax ?? averageCost;
                var amount = Round(m.Quantity * unitCost);

                if (m.Direction == StockMovementDirection.In)
                {
                    qty += m.Quantity;
                    value += amount;
                    totalIn += m.Quantity;
                    valueIn += amount;
                }
                else
                {
                    qty -= m.Quantity;
                    // Never let rounding leave value behind on an emptied bin:
                    // the last unit out takes whatever is left, so an item at
                    // zero quantity is worth zero rather than a stray paisa.
                    // The traced amount follows suit, or the drill-down's
                    // running total would not match its own rows.
                    if (qty <= 0m) { amount = Round(value); value = 0m; }
                    else value -= amount;
                    totalOut += m.Quantity;
                    valueOut += amount;
                }

                trace?.Add(new Step(m.Id, unitCost, amount, qty, Round(value)));
            }

            return new Position(qty, Round(value), rate, totalIn, totalOut,
                                Round(valueIn), Round(valueOut));
        }

        /// <summary>
        /// The cost a movement recorded RIGHT NOW would be valued at — the
        /// current weighted average. Used when a caller wants to stamp a cost on
        /// an outward movement at write time rather than leave it to the reader.
        /// </summary>
        public static decimal CurrentUnitCost(
            decimal openingQuantity,
            decimal openingValueExcludingTax,
            IEnumerable<StockMovement> movements)
        {
            var p = Compute(openingQuantity, openingValueExcludingTax, 0m, movements);
            return p.UnitCost;
        }

        private static decimal Round(decimal value) =>
            Math.Round(value, 2, MidpointRounding.AwayFromZero);
    }
}
