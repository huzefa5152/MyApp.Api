using System.Text.RegularExpressions;
using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// "Reconcile to my stock sheet": turns the client's monthly stock sheet
    /// into the exact corrections that make the books hold it -- per item a
    /// quantity adjustment where the counted quantity differs, and a FIFO
    /// restatement to the sheet's GD lines (CLAUDE.md 5b-17). Pure: no database,
    /// so the plan the operator reviews is the plan Apply executes.
    ///
    /// Lessons from doing this by hand for a real client (2026-10-03):
    ///  • Clients often DERIVE a quantity as value / price, so a figure like
    ///    44.4496 sewing machines is arithmetic, not a count. Only a counted
    ///    (whole or one-decimal) quantity that differs from on-hand is PROPOSED
    ///    as a quantity correction; otherwise the books' quantity stands and the
    ///    difference is absorbed by the line whose quantity was derived.
    ///  • Rows that carry value but no quantity, on an item holding no stock,
    ///    cannot be restated (a GD line needs units) -- they are reported, not
    ///    forced in.
    ///  • The sheet's VALUE per item is matched to the paisa: dust rows' value
    ///    lands on the item's largest line.
    /// </summary>
    public static class StockSheetReconciler
    {
        /// <summary>A row's ChosenItemTypeId meaning "leave this row out".</summary>
        public const int LeaveOut = -1;

        public sealed record Pool(string? GdNumber, string? HsCode, decimal Quantity, decimal Value);

        public sealed record Item(int ItemTypeId, string Name, string? HsCode, string? Unit,
            decimal OnHand, decimal Value, IReadOnlyList<Pool> Pools, IReadOnlyList<string> OtherNames);

        public static StockReconcilePlanDto Plan(
            StockReconcileRequestDto request, IReadOnlyCollection<Item> items)
        {
            var plan = new StockReconcilePlanDto { AsOf = request.AsOf.Date };
            var byId = items.ToDictionary(i => i.ItemTypeId);
            var matched = new Dictionary<int, List<StockReconcileSheetRowDto>>();

            foreach (var row in request.Rows)
            {
                // -1 = the operator chose to leave this row out.
                if (row.ChosenItemTypeId == LeaveOut)
                {
                    plan.Messages.Add($"Row {row.SourceRow} ({row.ItemNameOnSheet}) left out as asked.");
                    continue;
                }
                var (itemId, candidates, reason) = MatchRow(row, items, byId);
                if (itemId is int id)
                {
                    if (!matched.TryGetValue(id, out var list)) matched[id] = list = new();
                    list.Add(row);
                    continue;
                }
                // A row with no quantity and no money is just a blank line.
                if (Math.Abs(row.BalanceQuantity) < 0.00005m && Math.Abs(row.BalanceValueExcludingTax) < 0.005m)
                    continue;
                plan.Unmatched.Add(Issue(row, reason, candidates.Select(c => new StockReconcileCandidateDto
                {
                    ItemTypeId = c.ItemTypeId, ItemTypeName = c.Name, OnHand = c.OnHand,
                }).ToList()));
            }

            foreach (var (itemId, rows) in matched)
            {
                var item = byId[itemId];
                var meaningful = rows.Where(r => r.BalanceQuantity > 0.00005m && Math.Abs(r.BalanceValueExcludingTax) >= 0.5m)
                                     .OrderBy(r => r.SourceRow).ToList();
                var sheetValue = Money(rows.Sum(r => r.BalanceValueExcludingTax));
                var sheetQty = meaningful.Sum(r => r.BalanceQuantity);
                var counted = meaningful.Count > 0 && meaningful.All(r => IsCounted(r.BalanceQuantity));
                var propose = counted && Math.Abs(sheetQty - item.OnHand) >= 0.5m;
                var use = request.UseSheetQuantityItemTypeIds is { } decided
                    ? decided.Contains(itemId) : propose;

                var dto = new StockReconcileItemDto
                {
                    ItemTypeId = itemId, ItemTypeName = item.Name, HsCode = item.HsCode, Unit = item.Unit,
                    OnHand = item.OnHand, CurrentValueExcludingTax = Money(item.Value),
                    SheetQuantity = sheetQty, SheetValueExcludingTax = sheetValue,
                    ProposeSheetQuantity = propose, UseSheetQuantity = use,
                };

                if (meaningful.Count == 0)
                {
                    // Value with no units: nothing a GD line can hold.
                    foreach (var r in rows.Where(r => Math.Abs(r.BalanceValueExcludingTax) >= 0.005m))
                        plan.NotApplied.Add(Issue(r, item.OnHand <= 0.00005m
                            ? $"\"{item.Name}\" holds no stock, so this row's value has nothing to sit on."
                            : $"The sheet gives \"{item.Name}\" value but no quantity on this row.", new()));
                    continue;
                }

                var target = use ? sheetQty : item.OnHand;
                dto.TargetQuantity = target;
                dto.TargetValueExcludingTax = sheetValue;
                if (target <= 0.00005m && !counted)
                {
                    // A derived crumb (0.0013 units) on an item the books hold
                    // none of: arithmetic, not stock. Reported, never forced in.
                    foreach (var r in meaningful)
                        plan.NotApplied.Add(Issue(r,
                            $"\"{item.Name}\" holds no stock and the sheet's {r.BalanceQuantity:0.####} is not a counted quantity.", new()));
                    continue;
                }
                if (target <= 0.00005m)
                {
                    dto.Error = $"The books hold no \"{item.Name}\" but the sheet lists {sheetQty:0.####}. Use the sheet's quantity to bring it in.";
                    plan.Items.Add(dto);
                    continue;
                }

                // Quantities: the sheet's, with any gap to the target absorbed by
                // the line whose quantity was derived (else the largest).
                var qty = meaningful.Select(r => r.BalanceQuantity).ToList();
                var gap = target - qty.Sum();
                if (Math.Abs(gap) > 0.000001m)
                {
                    var derived = Enumerable.Range(0, qty.Count).Where(i => !IsCounted(qty[i])).ToList();
                    var at = (derived.Count > 0 ? derived : Enumerable.Range(0, qty.Count).ToList())
                        .OrderByDescending(i => qty[i]).First();
                    qty[at] += gap;
                    if (qty[at] <= 0m)
                    {
                        dto.Error = $"The sheet's lines for \"{item.Name}\" add up to {qty.Sum() - gap:0.####} but the books hold {target:0.####}; "
                                  + "the difference cannot be placed on one line. Use the sheet's quantity, or correct the sheet.";
                        plan.Items.Add(dto);
                        continue;
                    }
                    if (!use)
                        dto.Notes.Add($"Quantity kept at the books' {target:0.####} (the sheet says {sheetQty:0.####}); "
                                    + $"the difference sits on row {meaningful[at].SourceRow}.");
                }

                // Values: the sheet's, with dust rows' value on the largest line.
                var val = meaningful.Select(r => Money(r.BalanceValueExcludingTax)).ToList();
                var residual = sheetValue - val.Sum();
                if (residual != 0m)
                {
                    var big = Enumerable.Range(0, val.Count).OrderByDescending(i => val[i]).First();
                    val[big] = Money(val[big] + residual);
                }

                for (var i = 0; i < meaningful.Count; i++)
                {
                    var r = meaningful[i];
                    var pool = item.Pools.FirstOrDefault(p => Gd(p.GdNumber) == Gd(r.LotRef) && Hs(p.HsCode) == Hs(r.HsCode));
                    dto.Lines.Add(new StockReconcileLineDto
                    {
                        SourceRow = r.SourceRow,
                        GdNumber = string.IsNullOrWhiteSpace(r.LotRef) ? $"Row {r.SourceRow}" : r.LotRef!.Trim(),
                        GdDate = r.LotDate, ClaimMonth = r.ClaimMonth,
                        Description = r.ItemNameOnSheet, HsCode = r.HsCode,
                        SheetQuantity = r.BalanceQuantity, Quantity = qty[i], ValueExcludingTax = val[i],
                        SalesTaxRate = r.BalanceSalesTaxRate,
                        CurrentValueExcludingTax = pool?.Value,
                    });
                }
                if (use && Math.Abs(sheetQty - item.OnHand) > 0.00005m)
                    dto.Notes.Add($"Quantity corrected from {item.OnHand:0.####} to the sheet's {sheetQty:0.####}, dated {plan.AsOf:dd-MM-yyyy}.");
                plan.Items.Add(dto);
            }

            var listed = matched.Keys.ToHashSet();
            plan.NotInSheet = items
                .Where(i => !listed.Contains(i.ItemTypeId) && (Math.Abs(i.OnHand) > 0.00005m || Math.Abs(i.Value) >= 0.005m))
                .Select(i => new StockReconcileCandidateDto { ItemTypeId = i.ItemTypeId, ItemTypeName = i.Name, OnHand = i.OnHand })
                .OrderBy(i => i.ItemTypeName, StringComparer.OrdinalIgnoreCase).ToList();

            plan.Items = plan.Items.OrderBy(i => i.ItemTypeName, StringComparer.OrdinalIgnoreCase).ToList();
            plan.CurrentValueExcludingTax = Money(items.Sum(i => i.Value));
            plan.SheetValueExcludingTax = Money(request.Rows.Sum(r => r.BalanceValueExcludingTax));
            var touched = plan.Items.Where(i => i.Error == null).ToList();
            var touchedIds = touched.Select(i => i.ItemTypeId).ToHashSet();
            plan.PlannedValueExcludingTax = Money(items.Where(i => !touchedIds.Contains(i.ItemTypeId)).Sum(i => i.Value)
                                                 + touched.Sum(i => i.TargetValueExcludingTax));
            plan.CanApply = touched.Count > 0 && plan.Items.All(i => i.Error == null) && plan.Unmatched.Count == 0;
            return plan;
        }

        /// <summary>The row's item: the operator's pick; else the item already
        /// holding this GD under this HS code; else the one item under the code;
        /// else the one whose name matches. Anything else is a question.</summary>
        private static (int? ItemId, List<Item> Candidates, string Reason) MatchRow(
            StockReconcileSheetRowDto row, IReadOnlyCollection<Item> items, Dictionary<int, Item> byId)
        {
            if (row.ChosenItemTypeId is int chosen && byId.ContainsKey(chosen)) return (chosen, new(), "");

            var hs = Hs(row.HsCode);
            var gd = Gd(row.LotRef);
            if (gd.Length > 0 && hs.Length > 0)
            {
                var byGd = items.Where(i => i.Pools.Any(p => Gd(p.GdNumber) == gd && Hs(p.HsCode ?? i.HsCode) == hs))
                                .ToList();
                if (byGd.Count == 1) return (byGd[0].ItemTypeId, new(), "");
            }
            if (hs.Length == 0)
                return (null, new(), "The row has no HS code, so no item can be matched to it. Choose one.");

            var byHs = items.Where(i => Hs(i.HsCode) == hs).ToList();
            if (byHs.Count == 1) return (byHs[0].ItemTypeId, new(), "");
            if (byHs.Count == 0)
                return (null, new(), $"No item on the books carries HS code {row.HsCode}.");

            var name = Name(row.ItemNameOnSheet);
            var named = byHs.Where(i => Name(i.Name) == name || i.OtherNames.Any(n => Name(n) == name)).ToList();
            if (named.Count == 1) return (named[0].ItemTypeId, new(), "");
            return (null, byHs, $"{byHs.Count} items share HS code {row.HsCode}. Choose which one this row is.");
        }

        private static StockReconcileRowIssueDto Issue(StockReconcileSheetRowDto r, string reason,
            List<StockReconcileCandidateDto> candidates) => new()
        {
            SourceRow = r.SourceRow, ItemNameOnSheet = r.ItemNameOnSheet, HsCode = r.HsCode, GdNumber = r.LotRef,
            BalanceQuantity = r.BalanceQuantity, BalanceValueExcludingTax = r.BalanceValueExcludingTax,
            Reason = reason, Candidates = candidates,
        };

        /// <summary>A counted quantity: whole, or to one decimal (346.4 kg).
        /// Anything finer is a value / price derivation.</summary>
        public static bool IsCounted(decimal q) => Math.Abs(q * 10m - Math.Round(q * 10m)) < 0.000001m;

        public static string Hs(string? hs)
        {
            var d = Regex.Replace(hs ?? "", "[^0-9]", "");
            return d.Length > 8 ? d[..8] : d;
        }

        private static string Gd(string? gd) => Regex.Replace((gd ?? "").ToUpperInvariant(), "[^A-Z0-9]", "");
        private static string Name(string? n) => Regex.Replace((n ?? "").ToUpperInvariant(), "[^A-Z0-9]", "");
        private static decimal Money(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    }
}
