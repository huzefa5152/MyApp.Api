using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Turns two FIFO-by-GD walks of one company's stock -- cut on the first of
    /// a month and on the first of the next -- into the client's monthly stock
    /// sheet lines: one per GD line (GD x product). Pure: no database, so the
    /// controller and the read-only production check run the same code.
    ///
    ///  • Opening = the pool on the first of the month; a pool that came into
    ///    being during the month (a GD arrival, other stock in) opens at what it
    ///    brought in. A line a restatement created opens at nil: the lines it
    ///    replaced already open the month, and their balance goes to nil.
    ///  • Consumed = what the month's SALES took from the pool, less what a sale
    ///    RETURN put back -- the same figure as Annex-H1's supplies. A stock
    ///    adjustment is not a sale: one reversed the same day used to read as
    ///    consumption on the sheet (Alpha, Oct 2026, 2.13M).
    ///  • Other = Opening - Consumed - Balance: adjustments, revaluations and
    ///    restatements, out positive (Annex-H1's sign), so every row adds up.
    ///  • Balance = the pool at month end -- next month's Opening, since both
    ///    come from a walk cut at the same date.
    ///  • A GD line dated AFTER the month that the month never drew on did not
    ///    exist yet in the client's books, so it is left out and counted.
    /// </summary>
    public static class StockMonthlySheet
    {
        public sealed record ItemInfo(int ItemTypeId, string Name, string? HsCode, string? Unit, decimal SalesTaxRate);

        public sealed class Output
        {
            public List<StockMonthlyLineDto> Lines { get; } = new();
            public int LaterLinesOmitted { get; set; }
            public decimal LaterLinesValue { get; set; }
        }

        public static Output Build(
            DateTime monthStart,
            IEnumerable<ItemInfo> items,
            IReadOnlyDictionary<int, GdFifoValuation.Result> atStart,
            IReadOnlyDictionary<int, GdFifoValuation.Result> atEnd,
            IEnumerable<StockMovement> movementsInMonth,
            IReadOnlyDictionary<int, string?> lotHsCodes,
            IReadOnlyDictionary<int, string?> consignmentLineHsCodes,
            bool includeActualCost)
        {
            var monthEnd = monthStart.AddMonths(1);
            var byItem = movementsInMonth
                .Where(m => m.MovementDate >= monthStart && m.MovementDate < monthEnd)
                .GroupBy(m => m.ItemTypeId)
                .ToDictionary(g => g.Key, g => g.ToList());
            var output = new Output();

            foreach (var item in items)
            {
                if (!atEnd.TryGetValue(item.ItemTypeId, out var end)) continue;
                atStart.TryGetValue(item.ItemTypeId, out var start);
                var startPools = start?.Pools.ToDictionary(p => p.Key) ?? new();
                var endPools = end.Pools.ToDictionary(p => p.Key);

                var consumed = new Dictionary<string, (decimal Qty, decimal Value)>();
                var sold = new Dictionary<string, (decimal Qty, decimal Value)>();
                foreach (var m in byItem.GetValueOrDefault(item.ItemTypeId) ?? new())
                {
                    if (!end.Takes.TryGetValue(m.Id, out var takes)) continue;
                    var sign = m.Direction == StockMovementDirection.Out ? 1m
                        : m.SourceType == StockMovementSourceType.Invoice ? -1m : 0m;
                    if (sign == 0m) continue;
                    foreach (var t in takes)
                    {
                        if (endPools.TryGetValue(t.PoolKey, out var own) && own.MovementId == m.Id) continue;
                        consumed.TryGetValue(t.PoolKey, out var c);
                        consumed[t.PoolKey] = (c.Qty + sign * t.Quantity, c.Value + sign * t.Value);
                        if (m.SourceType == StockMovementSourceType.Invoice)
                        {
                            sold.TryGetValue(t.PoolKey, out var so);
                            sold[t.PoolKey] = (so.Qty + sign * t.Quantity, so.Value + sign * t.Value);
                        }
                    }
                }

                // What each RECEIPT (a GD arrival, a purchase, a goods receipt)
                // handed straight to sales made before it (the owed or oversold
                // part, ShortfallKey takes). The receipt brought that stock in
                // too, so its line opens at the FULL arrival and the hand-over
                // shows in Other, against the "sold beyond stock" line -- else
                // Annex-H1's purchased/imported misses it (Prime demo, Nov 2026:
                // 55,000 for an 84,000 GD). An inward ADJUSTMENT that settles a
                // shortfall is not a purchase and stays in Other, as before.
                var settled = new Dictionary<int, (decimal Qty, decimal Value, decimal Actual)>();
                foreach (var m in byItem.GetValueOrDefault(item.ItemTypeId) ?? new())
                {
                    if (m.Direction != StockMovementDirection.In
                        || m.SourceType is not (StockMovementSourceType.ImportConsignment
                            or StockMovementSourceType.PurchaseBill or StockMovementSourceType.GoodsReceipt)
                        || !end.Takes.TryGetValue(m.Id, out var takes)) continue;
                    foreach (var t in takes.Where(t => t.PoolKey == GdFifoValuation.ShortfallKey))
                    {
                        settled.TryGetValue(m.Id, out var st);
                        settled[m.Id] = (st.Qty + t.Quantity, st.Value + t.Value, st.Actual + t.ActualValue);
                    }
                }

                foreach (var p in end.Pools)
                {
                    startPools.TryGetValue(p.Key, out var s);
                    consumed.TryGetValue(p.Key, out var c);
                    sold.TryGetValue(p.Key, out var sd);
                    if (p.OrderDate.HasValue && p.OrderDate.Value >= monthEnd && c.Qty == 0m
                        && p.Quantity == p.InQuantity)
                    {
                        output.LaterLinesOmitted++;
                        output.LaterLinesValue += p.Value;
                        continue;
                    }
                    // A line a RESTATEMENT created this month replaces lines that
                    // already open the month; opening it at its full value as
                    // well would count that stock twice. It opens at nil and its
                    // balance carries the restated figure.
                    var restatedHere = s == null && p.Kind == GdFifoValuation.PoolKind.Restated;
                    var openQty = s?.Quantity ?? (restatedHere ? 0m : p.InQuantity);
                    var openVal = s?.Value ?? (restatedHere ? 0m : p.InValue);
                    var openAct = s?.ActualValue ?? (restatedHere ? 0m : p.InActualValue);
                    var bornHere = s == null && !restatedHere;
                    (decimal Qty, decimal Value, decimal Actual) handed = default;
                    if (bornHere && p.MovementId is int mid && settled.Remove(mid, out handed))
                    {
                        openQty += handed.Qty; openVal += handed.Value; openAct += handed.Actual;
                    }
                    if (Nil(openQty, openVal) && Nil(c.Qty, c.Value) && Nil(p.Quantity, p.Value))
                        continue;

                    string? hs = p.LotId is int lid && lotHsCodes.TryGetValue(lid, out var lh) ? lh
                        : p.ConsignmentLineId is int cid && consignmentLineHsCodes.TryGetValue(cid, out var ch) ? ch
                        : null;
                    var costed = includeActualCost && (openAct > 0m || p.ActualValue > 0m);
                    output.Lines.Add(new StockMonthlyLineDto
                    {
                        ItemTypeId = item.ItemTypeId,
                        ItemTypeName = item.Name,
                        ClaimMonth = p.ClaimMonth,
                        GdNumber = p.GdNumber,
                        GdDate = p.GdNumber != null ? p.OrderDate : null,
                        Description = p.Kind switch
                        {
                            GdFifoValuation.PoolKind.OpeningUntraced => $"{item.Name} (opening — not traced to a GD)",
                            GdFifoValuation.PoolKind.Inward => $"{item.Name} (other stock in)",
                            _ => string.IsNullOrWhiteSpace(p.Description) ? item.Name : p.Description!.Trim(),
                        },
                        HsCode = string.IsNullOrWhiteSpace(hs) ? item.HsCode : hs.Trim(),
                        Unit = item.Unit,
                        SalesTaxRate = p.Rate,
                        OpeningQuantity = openQty,
                        OpeningValueExcludingTax = Money(openVal),
                        ConsumedQuantity = sd.Qty,
                        ConsumedValueExcludingTax = Money(sd.Value),
                        BalanceQuantity = p.Quantity,
                        BalanceValueExcludingTax = Money(p.Value),
                        OtherQuantity = openQty - sd.Qty - p.Quantity,
                        OtherValueExcludingTax = Money(openVal) - Money(sd.Value) - Money(p.Value),
                        // Born this month (not by a restatement): it opened at what it
                        // brought in, including what it handed to earlier sales.
                        ReceivedQuantity = bornHere ? p.InQuantity + handed.Qty : 0m,
                        ReceivedValueExcludingTax = bornHere ? Money(p.InValue + handed.Value) : 0m,
                        SoldQuantity = sd.Qty,
                        SoldValueExcludingTax = Money(sd.Value),
                        OpeningActualCostExcludingTax = costed ? Money(openAct) : null,
                        BalanceActualCostExcludingTax = costed ? Money(p.ActualValue) : null,
                    });
                }

                // Sold past every GD: one line per item, so the sheet still adds up.
                var startShort = start?.ShortfallQuantity ?? 0m;
                consumed.TryGetValue(GdFifoValuation.ShortfallKey, out var sc);
                sold.TryGetValue(GdFifoValuation.ShortfallKey, out var ss);
                // A hand-over whose stock left no line of its own (the arrival
                // went entirely to earlier sales) is still a receipt: it opens here.
                var unplaced = (Qty: settled.Values.Sum(v => v.Qty), Value: settled.Values.Sum(v => v.Value));
                var openShortQty = -startShort + unplaced.Qty;
                var openShortValue = -Money(start?.ShortfallValue ?? 0m) + Money(unplaced.Value);
                if (end.ShortfallQuantity > 0m || startShort > 0m || sc.Qty != 0m || unplaced.Qty != 0m)
                    output.Lines.Add(new StockMonthlyLineDto
                    {
                        ItemTypeId = item.ItemTypeId,
                        ItemTypeName = item.Name,
                        Description = $"{item.Name} (sold beyond stock — not covered by a GD yet)",
                        HsCode = item.HsCode,
                        Unit = item.Unit,
                        SalesTaxRate = item.SalesTaxRate,
                        OpeningQuantity = openShortQty,
                        OpeningValueExcludingTax = openShortValue,
                        ReceivedQuantity = unplaced.Qty,
                        ReceivedValueExcludingTax = Money(unplaced.Value),
                        ConsumedQuantity = ss.Qty,
                        ConsumedValueExcludingTax = Money(ss.Value),
                        SoldQuantity = ss.Qty,
                        SoldValueExcludingTax = Money(ss.Value),
                        BalanceQuantity = -end.ShortfallQuantity,
                        BalanceValueExcludingTax = -Money(end.ShortfallValue),
                        OtherQuantity = openShortQty - ss.Qty + end.ShortfallQuantity,
                        OtherValueExcludingTax = openShortValue - Money(ss.Value) + Money(end.ShortfallValue),
                    });
            }

            // The client's order: by GD date, each GD's lines together.
            var ordered = output.Lines
                .OrderBy(l => l.GdDate ?? DateTime.MaxValue)
                .ThenBy(l => l.GdNumber ?? "￿", StringComparer.OrdinalIgnoreCase)
                .ThenBy(l => l.Description, StringComparer.OrdinalIgnoreCase)
                .ToList();
            output.Lines.Clear();
            output.Lines.AddRange(ordered);
            return output;
        }

        private static bool Nil(decimal qty, decimal value) => Math.Abs(qty) < 0.00005m && Math.Abs(value) < 0.005m;
        private static decimal Money(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    }
}
