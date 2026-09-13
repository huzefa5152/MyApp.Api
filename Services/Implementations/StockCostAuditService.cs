using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <inheritdoc cref="IStockCostAuditService"/>
    public class StockCostAuditService : IStockCostAuditService
    {
        private readonly AppDbContext _db;
        private readonly int _defaultPageSize;

        // One user lookup per request, however many rows a single import writes.
        // A GD sheet costs 83 balances in one commit; joining the user table 83
        // times to snapshot the same name would be the slowest part of the
        // import for no reason.
        private readonly Dictionary<int, string?> _userNames = new();

        public StockCostAuditService(AppDbContext db, IConfiguration config)
        {
            _db = db;
            _defaultPageSize = config.GetValue<int?>("Pagination:DefaultPageSize") ?? 20;
        }

        public async Task RecordAsync(
            int companyId, int itemTypeId, int? openingStockBalanceId,
            int? userId, string source, string? sourceRef,
            StockFigures before, StockFigures after,
            string? note = null, int? importRunId = null, int? importConsignmentId = null)
        {
            if (before.SameAs(after)) return;

            _db.StockCostChanges.Add(new StockCostChange
            {
                CompanyId = companyId,
                ItemTypeId = itemTypeId,
                OpeningStockBalanceId = openingStockBalanceId,
                ChangedAt = DateTime.UtcNow,
                ChangedByUserId = userId,
                ChangedByUserName = await ResolveUserNameAsync(userId),
                Source = Trim(source, 40) ?? "",
                SourceRef = Trim(sourceRef, 120),
                ImportRunId = importRunId,
                ImportConsignmentId = importConsignmentId,
                OldQuantity = before.Quantity,
                NewQuantity = after.Quantity,
                OldActualCostExcludingTax = before.ActualCost,
                NewActualCostExcludingTax = after.ActualCost,
                OldValueExcludingTax = before.Value,
                NewValueExcludingTax = after.Value,
                Note = Trim(note, 500),
            });
        }

        public async Task<PagedResult<StockCostChangeDto>> GetPagedAsync(
            int companyId, int? itemTypeId, int page, int? pageSize)
        {
            var clampedPage = PaginationHelper.ClampPage(page);
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize, PaginationHelper.AuditMax);

            var q = _db.StockCostChanges.AsNoTracking().Where(c => c.CompanyId == companyId);
            if (itemTypeId.HasValue) q = q.Where(c => c.ItemTypeId == itemTypeId.Value);

            var total = await q.CountAsync();
            var rows = await q
                // Newest first, then by id so two rows written inside one
                // transaction (an import costs several balances on the same
                // UtcNow) still read back in the order they were written.
                .OrderByDescending(c => c.ChangedAt).ThenByDescending(c => c.Id)
                .Skip((clampedPage - 1) * size).Take(size)
                .Select(c => new StockCostChangeDto
                {
                    Id = c.Id,
                    CompanyId = c.CompanyId,
                    ItemTypeId = c.ItemTypeId,
                    ItemTypeName = c.ItemType.Name,
                    HsCode = c.ItemType.HSCode,
                    OpeningStockBalanceId = c.OpeningStockBalanceId,
                    ChangedAt = c.ChangedAt,
                    ChangedByUserId = c.ChangedByUserId,
                    ChangedByUserName = c.ChangedByUserName,
                    Source = c.Source,
                    SourceRef = c.SourceRef,
                    ImportRunId = c.ImportRunId,
                    ImportConsignmentId = c.ImportConsignmentId,
                    OldQuantity = c.OldQuantity,
                    NewQuantity = c.NewQuantity,
                    OldActualCostExcludingTax = c.OldActualCostExcludingTax,
                    NewActualCostExcludingTax = c.NewActualCostExcludingTax,
                    OldValueExcludingTax = c.OldValueExcludingTax,
                    NewValueExcludingTax = c.NewValueExcludingTax,
                    Note = c.Note,
                })
                .ToListAsync();

            return new PagedResult<StockCostChangeDto>
            {
                Items = rows, TotalCount = total, Page = clampedPage, PageSize = size,
            };
        }

        private async Task<string?> ResolveUserNameAsync(int? userId)
        {
            if (userId is not int id || id <= 0) return null;
            if (_userNames.TryGetValue(id, out var cached)) return cached;

            var found = await _db.Users.AsNoTracking()
                .Where(u => u.Id == id)
                .Select(u => new { u.FullName, u.Username })
                .FirstOrDefaultAsync();
            var name = found == null
                ? null
                : (!string.IsNullOrWhiteSpace(found.FullName) ? found.FullName : found.Username);
            _userNames[id] = name;
            return name;
        }

        private static string? Trim(string? value, int max)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            var t = value.Trim();
            return t.Length <= max ? t : t[..max];
        }
    }
}
