using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Splits a company's stock consumption into calendar months, so the ledger
    /// can relieve inventory once per month instead of once per sale.
    ///
    /// WHY MONTHLY. Weighted average is path-dependent: the cost of a sale is
    /// the average standing at that moment, so editing an old invoice changes
    /// the cost of every sale after it. Posting per invoice would mean one edit
    /// rewriting dozens of entries, and colliding with <c>GlLockDate</c> on
    /// closed periods. A monthly figure sidesteps that, and matches how the
    /// domain already works — the customs stock sheet IS monthly, with a
    /// Consumed block per month.
    ///
    /// WHAT IT VALUES. The whole history is walked, because the average at any
    /// point depends on everything before it — but only the movements the
    /// ledger does not already carry are BUCKETED:
    ///
    ///   • <see cref="StockMovementSourceType.Invoice"/> → cost of goods sold.
    ///     Outward on a sale or debit note, inward on a credit note that
    ///     affects stock, so a return reduces the month it lands in.
    ///   • <see cref="StockMovementSourceType.Adjustment"/> and
    ///     <see cref="StockMovementSourceType.Revaluation"/> → inventory
    ///     adjustments. Breakage and revaluation are not cost of goods SOLD,
    ///     and keeping them apart is what stops a future write-off landing
    ///     silently in gross margin.
    ///   • Purchases, goods receipts and supplier debit notes are SKIPPED —
    ///     they already debit or credit Inventory through their own postings.
    ///     Including them would double-count. (Verified on this line: movement
    ///     value, bill subtotal and GL debit agree to the rupee.)
    ///
    /// The declared (selling-value) pool is used throughout, never the actual
    /// landed-cost pool — see the COGS design spec for why that basis was
    /// chosen.
    /// </summary>
    public static class InventoryPeriodConsumption
    {
        /// <summary>One calendar month's worth of value leaving the stock pool.</summary>
        public readonly record struct Period(int Year, int Month)
        {
            /// <summary>The key a journal entry is filed under: 202608.</summary>
            public int SourceDocId => Year * 100 + Month;

            /// <summary>Last day of the month — the entry's date.</summary>
            public DateTime EndDate => new DateTime(Year, Month, DateTime.DaysInMonth(Year, Month));

            public override string ToString() => $"{Year:0000}-{Month:00}";
        }

        /// <summary>
        /// Signed money that left the pool in one month. Positive means value
        /// left (the ordinary case: Dr expense, Cr Inventory). Negative means
        /// value came back — a month whose credit notes outweigh its sales —
        /// and the caller flips the entry rather than clamping, because a
        /// clamped month would silently stop reconciling to the stock walk.
        /// </summary>
        public readonly record struct Totals(decimal CostOfGoodsSold, decimal Adjustments)
        {
            public decimal Total => CostOfGoodsSold + Adjustments;
            public bool IsEmpty => CostOfGoodsSold == 0m && Adjustments == 0m;
        }

        /// <summary>An item's starting position, as the opening balance records it.</summary>
        public readonly record struct Opening(
            decimal Quantity,
            decimal ValueExcludingTax,
            decimal ActualCostExcludingTax,
            decimal SalesTaxRate);

        /// <summary>
        /// Buckets every item's movements into months.
        /// </summary>
        /// <param name="openings">
        /// Opening position per item type. An item with movements but no opening
        /// row starts from zero, which is what "this item had no position" has
        /// always meant here.
        /// </param>
        /// <param name="movementsByItem">
        /// Every movement for the company, grouped by item type. Must be the
        /// COMPLETE history per item — a partial slice would compute the wrong
        /// average and therefore the wrong cost.
        /// </param>
        public static SortedDictionary<Period, Totals> Compute(
            IReadOnlyDictionary<int, Opening> openings,
            IReadOnlyDictionary<int, List<StockMovement>> movementsByItem)
        {
            var cogs = new Dictionary<Period, decimal>();
            var adjustments = new Dictionary<Period, decimal>();

            foreach (var (itemTypeId, movements) in movementsByItem)
            {
                if (movements.Count == 0) continue;

                openings.TryGetValue(itemTypeId, out var open);

                // The walk has to see EVERY movement, in the order it applies
                // them, or the average a sale is costed at is wrong. The trace
                // is how the per-movement cost comes back out — it exists only
                // as part of the walk (StockValuation's own note).
                var trace = new List<StockValuation.Step>(movements.Count);
                StockValuation.Compute(
                    open.Quantity, open.ValueExcludingTax, open.ActualCostExcludingTax,
                    open.SalesTaxRate, movements, trace);

                var byId = movements.ToDictionary(m => m.Id);

                // Each movement's contribution is the fall in the RUNNING VALUE
                // across it, not its own Amount.
                //
                // Amount is the raw figure the movement asked for, and that is
                // not always what happened. A revaluation is clamped
                // (`value = qty <= 0 ? 0 : Math.Max(0, value + delta)`) and an
                // emptied bin hands the last movement whatever is left. Using
                // Amount left one company's relief 41.93 adrift from the walk
                // — small, but it breaks the one invariant this entry exists to
                // hold, that the Inventory account equals the stock walk.
                //
                // Running differences telescope to exactly (opening − closing),
                // so the ledger reconciles by construction however the walk
                // clamps. They are already signed the right way round: a fall in
                // value means value LEFT, which is the positive direction here.
                var previous = Round(open.ValueExcludingTax);

                foreach (var step in trace)
                {
                    var contribution = previous - step.RunningValue;
                    previous = step.RunningValue;

                    if (contribution == 0m) continue;
                    if (!byId.TryGetValue(step.MovementId, out var m)) continue;

                    var bucket = Classify(m.SourceType);
                    if (bucket == Bucket.Skip) continue;

                    var period = new Period(m.MovementDate.Year, m.MovementDate.Month);
                    var target = bucket == Bucket.Cogs ? cogs : adjustments;
                    target[period] = target.TryGetValue(period, out var running)
                        ? running + contribution
                        : contribution;
                }
            }

            var result = new SortedDictionary<Period, Totals>(PeriodOrder.Instance);
            foreach (var period in cogs.Keys.Union(adjustments.Keys))
            {
                cogs.TryGetValue(period, out var c);
                adjustments.TryGetValue(period, out var a);
                var totals = new Totals(Round(c), Round(a));
                if (!totals.IsEmpty) result[period] = totals;
            }
            return result;
        }

        /// <summary>
        /// The same walk, totalled over an ARBITRARY date range instead of
        /// bucketed into months.
        ///
        /// The dashboard's periods are not month-aligned (All Time, this week,
        /// a custom range), and summing whole monthly entries would pull a
        /// whole month's cost into a part-month view. Both this and
        /// <see cref="Compute"/> walk the same history the same way, so a
        /// whole-month selection agrees with the posted entry by construction.
        ///
        /// <paramref name="from"/> is inclusive, <paramref name="to"/>
        /// EXCLUSIVE — matching how the dashboard's own period filters compare
        /// dates, so a bill on the last day of a range is counted once.
        /// </summary>
        public static Totals ComputeRange(
            IReadOnlyDictionary<int, Opening> openings,
            IReadOnlyDictionary<int, List<StockMovement>> movementsByItem,
            DateTime? from,
            DateTime? to)
        {
            var cogs = 0m;
            var adjustments = 0m;

            foreach (var (itemTypeId, movements) in movementsByItem)
            {
                if (movements.Count == 0) continue;
                openings.TryGetValue(itemTypeId, out var open);

                var trace = new List<StockValuation.Step>(movements.Count);
                StockValuation.Compute(
                    open.Quantity, open.ValueExcludingTax, open.ActualCostExcludingTax,
                    open.SalesTaxRate, movements, trace);

                var byId = movements.ToDictionary(m => m.Id);
                var previous = Round(open.ValueExcludingTax);

                foreach (var step in trace)
                {
                    var contribution = previous - step.RunningValue;
                    previous = step.RunningValue;

                    if (contribution == 0m) continue;
                    if (!byId.TryGetValue(step.MovementId, out var m)) continue;

                    // Filtered AFTER the walk, never before: the average a sale
                    // is costed at depends on every movement before it, so a
                    // walk over only the range would price the range wrongly.
                    if (from.HasValue && m.MovementDate < from.Value) continue;
                    if (to.HasValue && m.MovementDate >= to.Value) continue;

                    switch (Classify(m.SourceType))
                    {
                        case Bucket.Cogs: cogs += contribution; break;
                        case Bucket.Adjustment: adjustments += contribution; break;
                    }
                }
            }

            return new Totals(Round(cogs), Round(adjustments));
        }

        private enum Bucket { Skip, Cogs, Adjustment }

        private static Bucket Classify(StockMovementSourceType source) => source switch
        {
            StockMovementSourceType.Invoice => Bucket.Cogs,
            StockMovementSourceType.Adjustment => Bucket.Adjustment,
            StockMovementSourceType.Revaluation => Bucket.Adjustment,
            // Already in the ledger through their own postings, or not a value
            // change at all. Listed rather than defaulted so a NEW source type
            // has to be classified deliberately instead of silently vanishing
            // from cost of sales.
            StockMovementSourceType.PurchaseBill => Bucket.Skip,
            StockMovementSourceType.GoodsReceipt => Bucket.Skip,
            StockMovementSourceType.PurchaseDebitNote => Bucket.Skip,
            StockMovementSourceType.OpeningBalance => Bucket.Skip,
            _ => Bucket.Skip,
        };

        private static decimal Round(decimal v) =>
            Math.Round(v, 2, MidpointRounding.AwayFromZero);

        private sealed class PeriodOrder : IComparer<Period>
        {
            public static readonly PeriodOrder Instance = new();
            public int Compare(Period a, Period b) => a.SourceDocId.CompareTo(b.SourceDocId);
        }
    }
}
