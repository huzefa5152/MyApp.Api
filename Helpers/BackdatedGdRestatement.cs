using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// A GD that arrives on the books AFTER a stock-sheet match (a FIFO
    /// restatement) but is DATED on or before it (2026-10-21, Pak Trade).
    ///
    /// The walk orders by date, so the arrival runs before the restatement, and
    /// the restatement's sheet lines -- which never had those units -- no longer
    /// describe what is on hand. Quantity stays right; the item's value is
    /// redistributed (three items, 31,917 off). The fix is to restate the item
    /// again on the SAME date with the sheet's lines plus the late GD's lines;
    /// this is the one definition of which items need it and what to send.
    /// </summary>
    public static class BackdatedGdRestatement
    {
        /// <summary>An item's latest stock-sheet match: the Revaluation movement
        /// that owns its <c>StockRestatementLines</c>.</summary>
        public sealed record Restatement(int MovementId, DateTime Date, DateTime CreatedAt);

        /// <summary>A late GD line still missing from that match.</summary>
        public sealed record LateLine(
            int ItemTypeId, string GdNumber, DateTime GdDate, DateTime? ClaimMonth, int SourceRow,
            string? Description, decimal Quantity, decimal ValueExcludingTax, decimal SalesTaxRate);

        public sealed record Affected(int ItemTypeId, Restatement Restatement, List<LateLine> Lines);

        /// <summary>Latest match per item (by date, then id), optionally for some items only.</summary>
        public static async Task<Dictionary<int, Restatement>> LatestAsync(
            AppDbContext db, int companyId, ICollection<int>? itemTypeIds = null)
        {
            var q = db.StockMovements.AsNoTracking()
                .Where(m => m.CompanyId == companyId && m.SourceType == StockMovementSourceType.Revaluation
                         && db.StockRestatementLines.Any(r => r.StockMovementId == m.Id));
            if (itemTypeIds != null) q = q.Where(m => itemTypeIds.Contains(m.ItemTypeId));
            var rows = await q.Select(m => new { m.Id, m.ItemTypeId, m.MovementDate, m.CreatedAt }).ToListAsync();
            return rows.GroupBy(r => r.ItemTypeId).ToDictionary(
                g => g.Key,
                g =>
                {
                    var r = g.OrderByDescending(x => x.MovementDate).ThenByDescending(x => x.Id).First();
                    return new Restatement(r.Id, r.MovementDate.Date, r.CreatedAt);
                });
        }

        /// <summary>
        /// Every item holding a GD arrival dated on or before its latest match
        /// but written after it. An arrival dated AFTER the match is ordinary
        /// stock in and never listed; once the item is restated again the new
        /// match post-dates the arrival and it drops off.
        /// </summary>
        public static async Task<List<Affected>> FindAsync(AppDbContext db, int companyId)
        {
            var arrivals = await (
                from l in db.ImportConsignmentLines.AsNoTracking()
                join c in db.ImportConsignments.AsNoTracking() on l.ImportConsignmentId equals c.Id
                join m in db.StockMovements.AsNoTracking() on l.StockMovementId equals m.Id
                where c.CompanyId == companyId && m.CompanyId == companyId
                      && m.SourceType == StockMovementSourceType.ImportConsignment
                select new
                {
                    m.ItemTypeId, m.MovementDate, m.CreatedAt, m.Quantity,
                    c.GdNumber, c.GdDate, l.ClaimMonth, l.SourceRow, l.DescriptionOnSheet,
                    l.SellingValueExcludingTax, l.SalesTaxRate,
                }).ToListAsync();
            if (arrivals.Count == 0) return new List<Affected>();

            var latest = await LatestAsync(db, companyId, arrivals.Select(a => a.ItemTypeId).Distinct().ToList());
            return arrivals
                .Where(a => latest.TryGetValue(a.ItemTypeId, out var r)
                            && a.MovementDate.Date <= r.Date && a.CreatedAt > r.CreatedAt)
                .GroupBy(a => a.ItemTypeId)
                .Select(g => new Affected(g.Key, latest[g.Key], g
                    .OrderBy(a => a.GdDate).ThenBy(a => a.SourceRow)
                    .Select(a => new LateLine(a.ItemTypeId, a.GdNumber, a.GdDate.Date,
                        a.ClaimMonth, a.SourceRow, a.DescriptionOnSheet, a.Quantity,
                        Math.Round(a.SellingValueExcludingTax, 2), a.SalesTaxRate))
                    .ToList()))
                .ToList();
        }

        /// <summary>
        /// The lines to restate one item with: its match's own lines plus the
        /// late GD lines. When those come to more than was on hand on the match
        /// date -- a sale dated before the match but entered after it has used
        /// some of the sheet's lines -- the surplus comes off the SHEET lines in
        /// the walk's own FIFO order (claimed for the match's month first, then
        /// oldest GD), each keeping its unit value. The late GD lines are kept
        /// whole: they are what is being added. Pure.
        /// </summary>
        public static List<FifoRestatementLineDto> BuildLines(
            int itemTypeId, DateTime matchDate, IReadOnlyList<FifoRestatementLineDto> sheetLines,
            IReadOnlyList<LateLine> late, decimal onHandOnMatchDate)
        {
            var month = new DateTime(matchDate.Year, matchDate.Month, 1);
            var sheet = sheetLines.Select(l => new FifoRestatementLineDto
            {
                ItemTypeId = itemTypeId, GdNumber = l.GdNumber, GdDate = l.GdDate, ClaimMonth = l.ClaimMonth,
                SourceRow = l.SourceRow, Description = l.Description, Quantity = l.Quantity,
                ValueExcludingTax = l.ValueExcludingTax, SalesTaxRate = l.SalesTaxRate,
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
                ItemTypeId = itemTypeId, GdNumber = l.GdNumber, GdDate = l.GdDate,
                ClaimMonth = l.ClaimMonth is { } cm ? new DateTime(cm.Year, cm.Month, 1) : null,
                SourceRow = l.SourceRow, Description = l.Description, Quantity = l.Quantity,
                ValueExcludingTax = l.ValueExcludingTax, SalesTaxRate = l.SalesTaxRate,
            })).ToList();
        }
    }
}
