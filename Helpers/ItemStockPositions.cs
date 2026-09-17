using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// One row per item: where it opened, what left, what it earned and what is
    /// still on the shelf — on BOTH the declared and the landed-cost basis.
    ///
    /// WHY THIS EXISTS. Every stock-derived figure on the dashboards comes out
    /// of this one walk: cost of goods sold, stock on hand, dead stock, real
    /// margin, stock converted, the ageing buckets, and the drill-down behind
    /// each of them. A drill-down whose rows did not add up to its own headline
    /// would be worse than no drill-down, and the only way to guarantee they
    /// add up is to compute them from the same place rather than twice.
    ///
    /// The walk itself is <see cref="StockValuation"/>, which keeps the two
    /// pools in parallel. Contributions come from the fall in RUNNING VALUE,
    /// never from a movement's own stated amount — a revaluation is clamped and
    /// an emptied bin takes whatever is left, so the stated figure is not
    /// always what happened.
    /// </summary>
    public static class ItemStockPositions
    {
        public sealed record Position(
            int ItemTypeId,
            string Name,
            string? HsCode,
            decimal OpeningQuantity,
            decimal OpeningDeclared,
            decimal OpeningLanded,
            decimal SoldQuantity,
            /// <summary>Declared value consumed by SALES (not adjustments).</summary>
            decimal ConsumedDeclared,
            /// <summary>The same goods at actual landed cost.</summary>
            decimal ConsumedLanded,
            /// <summary>Breakage, count corrections and revaluations.</summary>
            decimal AdjustmentsDeclared,
            decimal ClosingQuantity,
            decimal ClosingDeclared,
            decimal ClosingLanded,
            DateTime? LastMovement)
        {
            /// <summary>Never sold a single unit. Dead stock, if it opened with
            /// value.</summary>
            public bool NeverSold => SoldQuantity <= 0m;

            /// <summary>Everything this item has ever been worth on the
            /// declared basis — the denominator for "what share converted".</summary>
            public decimal EverHeldDeclared => OpeningDeclared > 0m ? OpeningDeclared : ConsumedDeclared;

            /// <summary>Declared minus landed on what is STILL held: profit
            /// locked up in unsold stock, which no report shows today.</summary>
            public decimal UnrealisedMargin => ClosingDeclared - ClosingLanded;
        }

        /// <summary>An item's opening position, summed across its balance rows.</summary>
        public readonly record struct Opening(
            decimal Quantity, decimal Declared, decimal Landed, decimal SalesTaxRate);

        /// <summary>
        /// Walks every item once. <paramref name="names"/> supplies the display
        /// name and HS code; an item missing from it is skipped, which is how a
        /// soft-deleted catalog row drops out (the on-hand grid does the same).
        /// </summary>
        /// <param name="from">
        /// Inclusive start for the CONSUMED figures. The walk itself always
        /// covers the whole history — the average a sale is costed at depends
        /// on everything before it — so the range filters which movements are
        /// counted, never which are walked. Null means all time.
        /// </param>
        /// <param name="to">Exclusive end, matching the dashboard's own filters.</param>
        public static List<Position> Compute(
            IReadOnlyDictionary<int, Opening> openings,
            IReadOnlyDictionary<int, List<StockMovement>> movementsByItem,
            IReadOnlyDictionary<int, (string Name, string? HsCode)> names,
            DateTime? from = null,
            DateTime? to = null)
        {
            var result = new List<Position>();
            var itemIds = openings.Keys.Union(movementsByItem.Keys).Distinct();

            foreach (var itemTypeId in itemIds)
            {
                if (!names.TryGetValue(itemTypeId, out var meta)) continue;

                openings.TryGetValue(itemTypeId, out var open);
                movementsByItem.TryGetValue(itemTypeId, out var movements);
                movements ??= new List<StockMovement>();

                var trace = new List<StockValuation.Step>(movements.Count);
                var final = StockValuation.Compute(
                    open.Quantity, open.Declared, open.Landed, open.SalesTaxRate,
                    movements, trace);

                decimal soldQty = 0m, consumedDeclared = 0m, consumedLanded = 0m, adjustments = 0m;
                var byId = movements.ToDictionary(x => x.Id);
                var prevDeclared = Round(open.Declared);
                var prevLanded = Round(open.Landed);
                DateTime? last = null;

                foreach (var step in trace)
                {
                    var declaredOut = prevDeclared - step.RunningValue;
                    var landedOut = prevLanded - step.RunningActualValue;
                    prevDeclared = step.RunningValue;
                    prevLanded = step.RunningActualValue;

                    if (!byId.TryGetValue(step.MovementId, out var m)) continue;
                    if (last == null || m.MovementDate > last) last = m.MovementDate;

                    // Filtered AFTER the walk, never before.
                    if (from.HasValue && m.MovementDate < from.Value) continue;
                    if (to.HasValue && m.MovementDate >= to.Value) continue;

                    switch (m.SourceType)
                    {
                        case StockMovementSourceType.Invoice:
                            consumedDeclared += declaredOut;
                            consumedLanded += landedOut;
                            if (m.Direction == StockMovementDirection.Out) soldQty += m.Quantity;
                            else soldQty -= m.Quantity;   // a return is not a sale
                            break;
                        case StockMovementSourceType.Adjustment:
                        case StockMovementSourceType.Revaluation:
                            adjustments += declaredOut;
                            break;
                    }
                }

                result.Add(new Position(
                    itemTypeId, meta.Name, meta.HsCode,
                    open.Quantity, Round(open.Declared), Round(open.Landed),
                    soldQty,
                    Round(consumedDeclared), Round(consumedLanded), Round(adjustments),
                    final.Quantity, Round(final.ValueExcludingTax), Round(final.ActualValueExcludingTax),
                    last));
            }

            return result;
        }

        private static decimal Round(decimal v) =>
            Math.Round(v, 2, MidpointRounding.AwayFromZero);
    }
}
