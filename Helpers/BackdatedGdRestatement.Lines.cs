using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers
{
    // The pure half of BackdatedGdRestatement: no database, so the offline
    // harness (scripts/stock_fifo_harness) links it as it ships.
    public static partial class BackdatedGdRestatement
    {
        /// <summary>A late GD line still missing from that match.</summary>
        public sealed record LateLine(
            int ItemTypeId, string GdNumber, DateTime GdDate, DateTime? ClaimMonth, int SourceRow,
            string? Description, decimal Quantity, decimal ValueExcludingTax, decimal SalesTaxRate, int MovementId = 0);

        /// <summary>
        /// The lines to restate one item with: its match's own lines plus the
        /// late GD lines. When those come to more than was on hand on the match
        /// date -- a sale dated before the match but entered after it has used
        /// some of the sheet's lines -- the surplus comes off the SHEET lines in
        /// the walk's own FIFO order (claimed for the match's month first, then
        /// oldest GD), each keeping its unit value. The late GD lines are kept
        /// whole: they are what is being added, and the consultant's stock sheet
        /// adds a late GD whole too (AY, Oct 2026). When the sales used more than
        /// the sheet held, the lines still come to more than is on hand and the
        /// restatement leaves that item out rather than revalue it away from the
        /// sheet. Pure.
        /// </summary>
        public static List<FifoRestatementLineDto> BuildLines(
            int itemTypeId, DateTime matchDate, IReadOnlyList<FifoRestatementLineDto> sheetLines,
            IReadOnlyList<LateLine> late, decimal onHandOnMatchDate)
        {
            var month = new DateTime(matchDate.Year, matchDate.Month, 1);
            var sheet = sheetLines.Select(l => new FifoRestatementLineDto
            {
                ItemTypeId = itemTypeId,
                GdNumber = l.GdNumber,
                GdDate = l.GdDate,
                ClaimMonth = l.ClaimMonth,
                SourceRow = l.SourceRow,
                Description = l.Description,
                Quantity = l.Quantity,
                ValueExcludingTax = l.ValueExcludingTax,
                SalesTaxRate = l.SalesTaxRate,
            }).ToList();
            var surplus = sheet.Sum(l => l.Quantity) + late.Sum(l => l.Quantity) - onHandOnMatchDate;
            if (surplus > 0.0001m)
            {
                foreach (var l in sheet
                             .OrderBy(l => l.ClaimMonth is { } cm && cm <= month ? 0 : 1)
                             .ThenBy(l => l.GdDate ?? DateTime.MaxValue).ThenBy(l => l.SourceRow))
                {
                    if (surplus <= 0.0001m) break;
                    var take = Math.Min(surplus, l.Quantity);
                    var keep = l.Quantity - take;
                    l.ValueExcludingTax = l.Quantity == 0m ? 0m : Math.Round(l.ValueExcludingTax * keep / l.Quantity, 2);
                    l.Quantity = keep;
                    surplus -= take;
                }
                sheet = sheet.Where(l => l.Quantity > 0.0001m).ToList();
            }
            return sheet.Concat(late.Select(l => new FifoRestatementLineDto
            {
                ItemTypeId = itemTypeId,
                GdNumber = l.GdNumber,
                GdDate = l.GdDate,
                ClaimMonth = l.ClaimMonth is { } cm ? new DateTime(cm.Year, cm.Month, 1) : null,
                SourceRow = l.SourceRow,
                Description = l.Description,
                Quantity = l.Quantity,
                ValueExcludingTax = l.ValueExcludingTax,
                SalesTaxRate = l.SalesTaxRate,
            })).ToList();
        }
    }
}
