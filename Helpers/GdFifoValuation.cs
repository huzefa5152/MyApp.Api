namespace MyApp.Api.Helpers
{
    /// <summary>
    /// FIFO BY GD: values one item's stock as a set of POOLS -- one per
    /// customs-declaration line it came in on -- and drains them in a fixed
    /// priority order, so every sale is costed at what the goods it actually
    /// used cost, and can say which GD they came from.
    ///
    /// The alternative to <see cref="StockValuation"/>'s weighted average, for a
    /// company whose <c>StockCostingMethod</c> is GdFifo (see
    /// <see cref="StockCostingMethod"/>). Rules: CLAUDE.md section 5b-17.
    ///
    /// Consumption order for an outward movement dated D (CLAUDE.md 5b-17):
    ///   0. GD pools CLAIMED FOR D -- claim month on or before D's month --
    ///      oldest GD date first. The test is against the movement's OWN month,
    ///      so entering a claim month later never re-costs an earlier invoice.
    ///   1. GD pools not claimed for D, oldest first.
    ///   2. Opening stock not traced to any GD line.
    ///   3. Any other inward stock (purchase bill, goods receipt, adjustment),
    ///      by date.
    ///
    /// Opening pools are available from the start of the walk whatever their
    /// GD date: the GD date ORDERS pools, it never makes opening stock
    /// unavailable (an opening sheet routinely lists GDs dated after its own
    /// as-of date).
    ///
    /// It NEVER refuses. A movement that needs more than every pool holds is
    /// applied in full; the uncovered quantity is a SHORTFALL costed at the
    /// last pool used, and the next inward movement settles it first so
    /// quantity still equals opening + in - out. The settlement's cost
    /// difference is taken as value OUT on that inward movement, so
    ///     value = opening value + ValueIn - ValueOut
    /// holds after every step, exactly as it does for the weighted average.
    ///
    /// Pure: no database, no services. Callers build the <see cref="Book"/>
    /// (StockCostingBooks) and map their movements onto <see cref="Movement"/>.
    /// </summary>
    public static class GdFifoValuation
    {
        public enum PoolKind { GdLot = 0, GdArrival = 1, OpeningUntraced = 2, Inward = 3, Restated = 4 }

        /// <summary>One opening source line: an opening-sheet lot under the
        /// item's opening balance, with its value already resolved (landed
        /// cost apportioned, 0% lot rate replaced by the item's).</summary>
        public sealed record OpeningLot(
            string Key,
            string? GdNumber,
            DateTime? OrderDate,
            DateTime? ClaimMonth,
            decimal Quantity,
            decimal Value,
            decimal ActualValue,
            decimal Rate,
            int Tiebreak,
            int? LotId,
            string? Description);

        /// <summary>A GD line that brought stock in as an inward movement.</summary>
        public sealed record Arrival(
            string GdNumber,
            DateTime? GdDate,
            DateTime? ClaimMonth,
            int ConsignmentLineId,
            string? Description);

        /// <summary>Everything the walk needs beyond the movements themselves.</summary>
        public sealed class Book
        {
            public List<OpeningLot> Lots { get; init; } = new();
            /// <summary>Keyed by StockMovement id.</summary>
            public Dictionary<int, Arrival> Arrivals { get; init; } = new();
            /// <summary>Keyed by the StockMovement id of a restatement: from that
            /// movement on, the item holds exactly these GD lines (CLAUDE.md 5b-17).</summary>
            public Dictionary<int, List<OpeningLot>> Restatements { get; init; } = new();
        }

        /// <summary>The fields of a StockMovement the walk reads.</summary>
        public readonly record struct Movement(
            int Id,
            DateTime Date,
            bool IsIn,
            decimal Quantity,
            decimal? UnitCost,
            decimal? ActualUnitCost,
            decimal? Rate,
            decimal? ValueDelta,
            decimal? ActualDelta,
            string SourceType,
            int? SourceId);

        /// <summary>What one movement took from (or returned to) one pool.</summary>
        public readonly record struct Take(
            string PoolKey,
            decimal Quantity,
            decimal Value,
            decimal ActualValue);

        public sealed class Pool
        {
            public string Key { get; init; } = "";
            public PoolKind Kind { get; init; }
            public string? GdNumber { get; init; }
            public DateTime? OrderDate { get; init; }
            public DateTime? ClaimMonth { get; init; }
            public int Tiebreak { get; init; }
            public int? LotId { get; init; }
            public int? ConsignmentLineId { get; init; }
            public int? MovementId { get; init; }
            public string? Description { get; init; }
            public decimal Rate { get; set; }

            public decimal InQuantity { get; set; }
            public decimal InValue { get; set; }
            public decimal InActualValue { get; set; }

            public decimal Quantity { get; set; }
            public decimal Value { get; set; }
            public decimal ActualValue { get; set; }

            public decimal ConsumedQuantity { get; set; }
            public decimal ConsumedValue { get; set; }
            public decimal ConsumedActualValue { get; set; }
            /// <summary>What a restatement replaced -- neither sold nor held.</summary>
            public decimal RestatedAwayQuantity { get; set; }

            internal decimal UnitValue => Quantity > 0m ? Value / Quantity
                : InQuantity > 0m ? InValue / InQuantity : 0m;
            internal decimal UnitActual => Quantity > 0m ? ActualValue / Quantity
                : InQuantity > 0m ? InActualValue / InQuantity : 0m;
        }

        public sealed class Result
        {
            public StockValuation.Position Position { get; init; }
            public List<Pool> Pools { get; init; } = new();
            /// <summary>Keyed by movement id; an outward movement's takes, or
            /// the pools an inward return went back into.</summary>
            public Dictionary<int, List<Take>> Takes { get; init; } = new();
            /// <summary>Quantity sold that no pool covered and no later inward
            /// movement has settled yet.</summary>
            public decimal ShortfallQuantity { get; init; }
            public decimal ShortfallValue { get; init; }
        }

        public const string ShortfallKey = "shortfall";
        public const string UntracedKey = "opening-untraced";

        /// <summary>
        /// Walks the movements in date-then-id order -- the same order
        /// <see cref="StockValuation"/> uses -- over the opening pools.
        /// </summary>
        public static Result Compute(
            decimal openingQuantity,
            decimal openingValue,
            decimal openingActualValue,
            decimal openingRate,
            Book? book,
            IEnumerable<Movement> movements,
            List<StockValuation.Step>? trace = null)
        {
            var pools = new List<Pool>();
            var takes = new Dictionary<int, List<Take>>();
            book ??= new Book();

            // ── Opening pools: each GD lot, then whatever the lots do not explain.
            decimal lotQty = 0m, lotValue = 0m, lotActual = 0m;
            foreach (var l in book.Lots)
            {
                if (l.Quantity <= 0m) continue;
                lotQty += l.Quantity; lotValue += l.Value; lotActual += l.ActualValue;
                pools.Add(new Pool
                {
                    Key = l.Key, Kind = PoolKind.GdLot, GdNumber = l.GdNumber,
                    OrderDate = l.OrderDate, ClaimMonth = l.ClaimMonth, Tiebreak = l.Tiebreak,
                    LotId = l.LotId, Description = l.Description,
                    Rate = l.Rate > 0m ? l.Rate : openingRate,
                    InQuantity = l.Quantity, InValue = l.Value, InActualValue = l.ActualValue,
                    Quantity = l.Quantity, Value = l.Value, ActualValue = l.ActualValue,
                });
            }
            // Lots claiming MORE than the opening holds: the opening balance is
            // the stock figure, so scale the lots down to it rather than let
            // the two methods disagree on quantity.
            if (lotQty > openingQuantity + 0.0001m && lotQty > 0m)
            {
                var f = Math.Max(0m, openingQuantity) / lotQty;
                decimal assignedQty = 0m;
                for (var i = 0; i < pools.Count; i++)
                {
                    var p = pools[i];
                    // The last lot takes the remainder, so the scaled lots add
                    // up to the opening EXACTLY rather than to 28 digits of it.
                    var q = i == pools.Count - 1 ? Math.Max(0m, openingQuantity) - assignedQty : p.Quantity * f;
                    assignedQty += q;
                    p.Quantity = p.InQuantity = q;
                    p.Value = p.InValue = Round(p.Value * f);
                    p.ActualValue = p.InActualValue = Round(p.ActualValue * f);
                }
                lotQty = pools.Sum(p => p.Quantity);
                lotValue = pools.Sum(p => p.Value);
                lotActual = pools.Sum(p => p.ActualValue);
            }
            var untracedQty = openingQuantity - lotQty;
            if (untracedQty > 0.0001m)
            {
                var v = Math.Max(0m, openingValue - lotValue);
                var a = Math.Max(0m, openingActualValue - lotActual);
                pools.Add(new Pool
                {
                    Key = UntracedKey, Kind = PoolKind.OpeningUntraced, Rate = openingRate,
                    Tiebreak = int.MaxValue,
                    InQuantity = untracedQty, InValue = v, InActualValue = a,
                    Quantity = untracedQty, Value = v, ActualValue = a,
                });
            }
            // The pools must open at EXACTLY the opening balance's money, or
            // switching method would move a figure before anything was sold.
            // A lot set whose values do not add up to it is corrected in
            // proportion (the balance is what every report ties to).
            if (pools.Count > 0)
            {
                var dv = Round(openingValue) - pools.Sum(p => p.Value);
                if (dv != 0m) Spread(pools, dv, p => p.Value, (p, x) => p.Value = p.InValue = x);
                var da = Round(openingActualValue) - pools.Sum(p => p.ActualValue);
                if (da != 0m) Spread(pools, da, p => p.ActualValue, (p, x) => p.ActualValue = p.InActualValue = x);
            }

            decimal totalIn = 0m, totalOut = 0m, valueIn = 0m, valueOut = 0m;
            decimal shortQty = 0m, shortValue = 0m, shortActual = 0m; // shortQty > 0 = owed
            decimal lastUnit = pools.Count > 0 ? pools[0].UnitValue : 0m;
            decimal lastUnitActual = pools.Count > 0 ? pools[0].UnitActual : 0m;
            decimal displayRate = openingRate;
            // What each source document took, so a return can go back where it came from.
            var takenBySource = new Dictionary<string, List<(Pool Pool, decimal Qty, decimal Unit, decimal UnitActual)>>();

            // Quantity is counted exactly as the weighted average counts it --
            // opening, plus every inward, minus every outward -- so the two
            // methods can never disagree on how much is held, even by the
            // last decimal a pool split leaves behind. The pools say WHERE it
            // came from; this says how much there is.
            var exactQty = openingQuantity;
            decimal HeldValue() => pools.Sum(p => p.Value);
            decimal HeldActual() => pools.Sum(p => p.ActualValue);
            decimal RunQty() => exactQty;
            decimal RunValue() => HeldValue() - shortValue;
            decimal RunActual() => HeldActual() - shortActual;

            foreach (var m in movements.OrderBy(m => m.Date).ThenBy(m => m.Id))
            {
                // ── Restatement: the item holds exactly these GD lines from here.
                // Whatever the pools held is replaced (not consumed -- nothing
                // was sold), an unsettled shortfall is cleared, and the value
                // difference is booked in or out so value = opening + in - out
                // still holds. Quantity does not move; lines holding more than
                // it (a sale dated earlier, entered since) give up the
                // difference in FIFO order, lines holding less are scaled up.
                if (book.Restatements.TryGetValue(m.Id, out var restated))
                {
                    var before = RunValue();
                    var lines = restated.Where(l => l.Quantity > 0m).ToList();
                    var lineQty = lines.Sum(l => l.Quantity);
                    var target = Math.Max(0m, exactQty);
                    // Lines holding LESS than is on hand: stock dated before the
                    // restatement was entered after it (a GD arrival, a purchase,
                    // a return). The sheet never saw it, so the NEWEST pools keep
                    // that surplus at their own cost and GD rather than having it
                    // smeared pro rata over the sheet's lines.
                    var surplus = shortQty > 0m ? 0m : target - lineQty;
                    foreach (var p in pools.Where(p => p.Quantity > 0m)
                                 .OrderByDescending(p => p.OrderDate ?? DateTime.MinValue)
                                 .ThenByDescending(p => p.Tiebreak))
                    {
                        var keep = surplus > 0.0001m ? Math.Min(surplus, p.Quantity) : 0m;
                        surplus -= keep;
                        var away = p.Quantity - keep;
                        if (away <= 0m) continue;
                        var av = keep <= 0m ? p.Value : Round(away * p.Value / p.Quantity);
                        var aa = keep <= 0m ? p.ActualValue : Round(away * p.ActualValue / p.Quantity);
                        p.RestatedAwayQuantity += away;
                        p.Quantity = keep; p.Value -= av; p.ActualValue -= aa;
                        if (p.Quantity <= 0m) { p.Quantity = 0m; p.Value = 0m; p.ActualValue = 0m; }
                    }
                    shortQty = 0m; shortValue = 0m; shortActual = 0m;
                    var kept = pools.Sum(p => p.Quantity);
                    // Lines holding MORE than is on hand: a sale dated before
                    // the restatement was entered after it. Those units leave
                    // the lines in FIFO order, below -- never pro rata, which
                    // costed them at the sheet's average (Alpha, 2026-10-08:
                    // 2,937 KG of 7018.1000 left at 496.74 against a first
                    // GD of 473.36, 68,479 short). A surplus no pool could
                    // keep (nothing held before) still scales the lines up.
                    target -= kept;
                    var scaleUp = lineQty > 0m && target - lineQty > 0.0001m;
                    var f = scaleUp ? target / lineQty : 1m;
                    var restatedPools = new List<Pool>();
                    decimal given = 0m;
                    for (var i = 0; i < lines.Count; i++)
                    {
                        var l = lines[i];
                        var q = !scaleUp ? l.Quantity
                            : i == lines.Count - 1 ? target - given : l.Quantity * f;
                        given += q;
                        var v = !scaleUp ? l.Value : Round(l.Value * f);
                        var a = !scaleUp ? l.ActualValue : Round(l.ActualValue * f);
                        var pool = new Pool
                        {
                            Key = l.Key, Kind = PoolKind.Restated, GdNumber = l.GdNumber,
                            OrderDate = l.OrderDate, ClaimMonth = l.ClaimMonth, Tiebreak = l.Tiebreak,
                            MovementId = m.Id, Description = l.Description,
                            Rate = l.Rate > 0m ? l.Rate : displayRate,
                            InQuantity = q, InValue = v, InActualValue = a,
                            Quantity = q, Value = v, ActualValue = a,
                        };
                        pools.Add(pool);
                        restatedPools.Add(pool);
                    }
                    var excess = lineQty - target;
                    if (excess > 0.0001m)
                    {
                        var restMonth = new DateTime(m.Date.Year, m.Date.Month, 1);
                        foreach (var p in Ranked(restatedPools, restMonth))
                        {
                            if (excess <= 0m) break;
                            var take = Math.Min(excess, p.Quantity);
                            var tv = take >= p.Quantity ? p.Value : Round(take * p.Value / p.Quantity);
                            var ta = take >= p.Quantity ? p.ActualValue : Round(take * p.ActualValue / p.Quantity);
                            p.Quantity -= take; p.Value -= tv; p.ActualValue -= ta;
                            if (p.Quantity <= 0m) { p.Quantity = 0m; p.Value = 0m; p.ActualValue = 0m; }
                            // The earlier-dated sale took these units, so the GD
                            // panel shows them consumed from this line (and keeps
                            // the line: RestatedAwayQuantity hides a pool there).
                            p.ConsumedQuantity += take; p.ConsumedValue += tv; p.ConsumedActualValue += ta;
                            excess -= take;
                        }
                    }
                    var delta = RunValue() - before;
                    if (delta > 0m) valueIn += delta; else valueOut += -delta;
                    trace?.Add(new StockValuation.Step(m.Id, 0m, Round(Math.Abs(delta)), RunQty(),
                        Round(RunValue()), 0m, Round(RunActual())));
                    continue;
                }

                var hasValueDelta = m.ValueDelta is decimal vd && vd != 0m;
                var hasActualDelta = m.ActualDelta is decimal ad && ad != 0m;

                // ── Revaluation: a value-only correction, spread over what is held.
                if (hasValueDelta || hasActualDelta)
                {
                    if (m.Rate is > 0m)
                    {
                        displayRate = m.Rate.Value;
                        foreach (var p in pools.Where(p => p.Quantity > 0m)) p.Rate = m.Rate.Value;
                    }
                    var traced = 0m;
                    if (hasValueDelta)
                    {
                        var delta = m.ValueDelta!.Value;
                        var before = HeldValue();
                        Spread(pools, delta, p => p.Value, (p, x) => p.Value = x);
                        var applied = HeldValue() - before;
                        if (applied > 0m) valueIn += Round(applied); else valueOut += Round(-applied);
                        traced = Round(Math.Abs(delta));
                    }
                    if (hasActualDelta)
                        Spread(pools, m.ActualDelta!.Value, p => p.ActualValue, (p, x) => p.ActualValue = x);

                    trace?.Add(new StockValuation.Step(m.Id, 0m, traced, RunQty(), Round(RunValue()),
                        0m, Round(RunActual())));
                    continue;
                }

                if (m.Quantity <= 0m) continue;
                if (m.Rate is > 0m) displayRate = m.Rate.Value;

                if (m.IsIn)
                {
                    var q = m.Quantity;
                    var sourceKey = SourceKey(m);
                    var list = new List<Take>();
                    var amount = 0m; var actualAmount = 0m;
                    decimal settledValue = 0m, settledActual = 0m;

                    // A sale return goes back into the pools that sale drained,
                    // most recently taken first, at their own cost.
                    var returned = 0m;
                    if (IsSaleSide(m.SourceType) && sourceKey != null
                        && takenBySource.TryGetValue(sourceKey, out var taken))
                    {
                        for (var i = taken.Count - 1; i >= 0 && returned < q; i--)
                        {
                            var t = taken[i];
                            var back = Math.Min(q - returned, t.Qty);
                            if (back <= 0m) continue;
                            var bv = Round(back * t.Unit); var ba = Round(back * t.UnitActual);
                            t.Pool.Quantity += back; t.Pool.Value += bv; t.Pool.ActualValue += ba;
                            t.Pool.ConsumedQuantity -= back; t.Pool.ConsumedValue -= bv;
                            t.Pool.ConsumedActualValue -= ba;
                            taken[i] = (t.Pool, t.Qty - back, t.Unit, t.UnitActual);
                            returned += back; amount += bv; actualAmount += ba;
                            list.Add(new Take(t.Pool.Key, back, bv, ba));
                        }
                    }

                    var rest = q - returned;
                    if (rest > 0m)
                    {
                        var avg = CurrentAverage(pools, lastUnit, p => p.Value);
                        var avgActual = CurrentAverage(pools, lastUnitActual, p => p.ActualValue);
                        var unit = m.UnitCost ?? avg;
                        var unitActual = m.ActualUnitCost ?? avgActual;
                        var restValue = Round(rest * unit);
                        var restActual = Round(rest * unitActual);
                        amount += restValue; actualAmount += restActual;

                        // Settle a shortfall first: those units were already sold.
                        var settle = Math.Min(rest, shortQty);
                        if (settle > 0m)
                        {
                            var estValue = shortQty > 0m ? Round(shortValue * settle / shortQty) : 0m;
                            var estActual = shortQty > 0m ? Round(shortActual * settle / shortQty) : 0m;
                            var settleValue = Round(settle * unit);
                            var settleActual = Round(settle * unitActual);
                            shortQty -= settle; shortValue -= estValue; shortActual -= estActual;
                            if (shortQty <= 0m) { shortQty = 0m; shortValue = 0m; shortActual = 0m; }
                            // The units cost settleValue, the sale was booked at
                            // estValue: the difference leaves the stock now.
                            valueOut += settleValue - estValue;
                            settledValue = settleValue - estValue;
                            settledActual = settleActual - estActual;
                            list.Add(new Take(ShortfallKey, settle, settleValue, settleActual));
                        }

                        var poolQty = rest - settle;
                        if (poolQty > 0m)
                        {
                            var pv = restValue - (settle > 0m ? Round(settle * unit) : 0m);
                            var pa = restActual - (settle > 0m ? Round(settle * unitActual) : 0m);
                            book.Arrivals.TryGetValue(m.Id, out var arr);
                            var pool = new Pool
                            {
                                Key = arr != null ? $"arrival-{arr.ConsignmentLineId}" : $"move-{m.Id}",
                                Kind = arr != null ? PoolKind.GdArrival : PoolKind.Inward,
                                GdNumber = arr?.GdNumber, OrderDate = arr?.GdDate ?? m.Date,
                                ClaimMonth = arr?.ClaimMonth, Tiebreak = m.Id,
                                ConsignmentLineId = arr?.ConsignmentLineId, MovementId = m.Id,
                                Description = arr?.Description,
                                Rate = m.Rate is > 0m ? m.Rate.Value : displayRate,
                                InQuantity = poolQty, InValue = pv, InActualValue = pa,
                                Quantity = poolQty, Value = pv, ActualValue = pa,
                            };
                            pools.Add(pool);
                            list.Add(new Take(pool.Key, poolQty, pv, pa));
                        }
                    }

                    totalIn += q; valueIn += amount; exactQty += q;
                    if (list.Count > 0) takes[m.Id] = list;
                    trace?.Add(new StockValuation.Step(m.Id, q > 0m ? amount / q : 0m, amount,
                        RunQty(), Round(RunValue()), q > 0m ? actualAmount / q : 0m, Round(RunActual()),
                        settledValue, settledActual));
                }
                else
                {
                    var need = m.Quantity;
                    var list = new List<Take>();
                    var amount = 0m; var actualAmount = 0m;
                    var monthStart = new DateTime(m.Date.Year, m.Date.Month, 1);
                    var sourceKey = SourceKey(m);

                    foreach (var p in Ranked(pools, monthStart))
                    {
                        if (need <= 0m) break;
                        var take = Math.Min(need, p.Quantity);
                        decimal tv, ta;
                        if (take >= p.Quantity)
                        {
                            // The last unit out takes whatever is left: an
                            // emptied pool is worth exactly zero.
                            tv = p.Value; ta = p.ActualValue;
                        }
                        else
                        {
                            tv = Round(take * p.Value / p.Quantity);
                            ta = Round(take * p.ActualValue / p.Quantity);
                        }
                        lastUnit = take > 0m ? tv / take : lastUnit;
                        lastUnitActual = take > 0m ? ta / take : lastUnitActual;
                        p.Quantity -= take; p.Value -= tv; p.ActualValue -= ta;
                        if (p.Quantity <= 0m) { p.Quantity = 0m; p.Value = 0m; p.ActualValue = 0m; }
                        p.ConsumedQuantity += take; p.ConsumedValue += tv; p.ConsumedActualValue += ta;
                        need -= take; amount += tv; actualAmount += ta;
                        list.Add(new Take(p.Key, take, tv, ta));
                        if (sourceKey != null)
                        {
                            if (!takenBySource.TryGetValue(sourceKey, out var tl))
                                takenBySource[sourceKey] = tl = new();
                            tl.Add((p, take, take > 0m ? tv / take : 0m, take > 0m ? ta / take : 0m));
                        }
                    }

                    if (need > 0m)
                    {
                        // Sold past every pool: never refused, costed at the
                        // last pool used and owed back by the next arrival.
                        var sv = Round(need * lastUnit);
                        var sa = Round(need * lastUnitActual);
                        shortQty += need; shortValue += sv; shortActual += sa;
                        amount += sv; actualAmount += sa;
                        list.Add(new Take(ShortfallKey, need, sv, sa));
                    }

                    totalOut += m.Quantity; valueOut += amount; exactQty -= m.Quantity;
                    takes[m.Id] = list;
                    trace?.Add(new StockValuation.Step(m.Id, m.Quantity > 0m ? amount / m.Quantity : 0m,
                        amount, RunQty(), Round(RunValue()),
                        m.Quantity > 0m ? actualAmount / m.Quantity : 0m, Round(RunActual())));
                }
            }

            var held = pools.Where(p => p.Quantity > 0m).ToList();
            var heldValue = held.Sum(p => p.Value);
            var rate = heldValue > 0m
                ? held.Sum(p => p.Value * p.Rate) / heldValue
                : held.Count > 0 ? held[^1].Rate : displayRate;

            var position = new StockValuation.Position(
                RunQty(), Round(RunValue()), Round(RunActual()), rate,
                totalIn, totalOut, Round(valueIn), Round(valueOut));

            return new Result
            {
                Position = position, Pools = pools, Takes = takes,
                ShortfallQuantity = shortQty, ShortfallValue = Round(shortValue),
            };
        }

        /// <summary>
        /// The pools an outward movement recorded now would drain, in order, and
        /// what each holds -- the price tiers a bill line priced from stock
        /// walks. <paramref name="asOf"/> decides which GDs count as claimed.
        /// </summary>
        public static List<Pool> NextConsumption(Result result, DateTime asOf)
            => Ranked(result.Pools, new DateTime(asOf.Year, asOf.Month, 1)).ToList();

        /// <summary>Whether a pool counts as claimed for a movement in the month
        /// starting <paramref name="monthStart"/>.</summary>
        public static bool ClaimedFor(Pool p, DateTime monthStart)
            => (p.Kind == PoolKind.GdLot || p.Kind == PoolKind.GdArrival || p.Kind == PoolKind.Restated)
               && p.ClaimMonth is DateTime c && c.Date <= monthStart;

        private static IEnumerable<Pool> Ranked(List<Pool> pools, DateTime monthStart)
            => pools.Where(p => p.Quantity > 0m)
                .OrderBy(p => p.Kind switch
                {
                    PoolKind.GdLot or PoolKind.GdArrival or PoolKind.Restated => ClaimedFor(p, monthStart) ? 0 : 1,
                    PoolKind.OpeningUntraced => 2,
                    _ => 3,
                })
                .ThenBy(p => p.OrderDate ?? DateTime.MaxValue)
                .ThenBy(p => p.Tiebreak)
                .ThenBy(p => p.Key, StringComparer.Ordinal);

        /// <summary>Spreads a signed correction over the pools holding stock in
        /// proportion to the figure being corrected (by quantity when that is
        /// zero everywhere). No pool goes below zero; the last pool takes the
        /// rounding remainder.</summary>
        private static void Spread(List<Pool> pools, decimal delta,
            Func<Pool, decimal> get, Action<Pool, decimal> set)
        {
            var held = pools.Where(p => p.Quantity > 0m).ToList();
            if (held.Count == 0) return;
            var basis = held.Sum(get);
            var byQty = basis <= 0m;
            var total = byQty ? held.Sum(p => p.Quantity) : basis;
            var left = delta;
            for (var i = 0; i < held.Count; i++)
            {
                var p = held[i];
                var share = i == held.Count - 1 ? left
                    : Round(delta * (byQty ? p.Quantity : get(p)) / total);
                left -= share;
                set(p, Math.Max(0m, get(p) + share));
            }
        }

        private static decimal CurrentAverage(List<Pool> pools, decimal fallback, Func<Pool, decimal> get)
        {
            var held = pools.Where(p => p.Quantity > 0m).ToList();
            var q = held.Sum(p => p.Quantity);
            return q > 0m ? held.Sum(get) / q : fallback;
        }

        // A bill and the credit note / edit that reverses it both carry the
        // Invoice source; matching on it lets a reversal return to the pools
        // the original sale drained.
        private static bool IsSaleSide(string sourceType) => sourceType == "Invoice";

        private static string? SourceKey(Movement m)
            => m.SourceId is int id ? $"{m.SourceType}:{id}" : null;

        private static decimal Round(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    }
}
