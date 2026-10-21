using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// The writes behind the stock screen's Opening Balances tab and the GD claim-month
    /// editors, moved out of <c>StockController</c> unchanged so the screen and the MCP
    /// tools run ONE implementation. The caller has already asserted company access and
    /// division write scope (a claim month and an opening balance are company-level
    /// inventory state, policy D2). Every record is read by its OWN company here, so an
    /// id from another tenant reads as unknown.
    ///
    /// Refusals are <see cref="InvalidOperationException"/> (bad input) and
    /// <see cref="KeyNotFoundException"/> (nothing of that company by that id), with the
    /// screen's own wording.
    /// </summary>
    public sealed class StockRecordService(
        AppDbContext context, IAuditLogService audit, IStockCostAuditService costAudit,
        IPostingService posting, IStockService stock)
    {
        public static string? ClaimMonthError(DateTime? month) =>
            month is { } m && (m.Day != 1 || m.TimeOfDay != TimeSpan.Zero)
                ? "Claim month must be the first day of the month." : null;

        /// <summary>Record (or clear, with null) the period actually filed for a GD.</summary>
        public async Task SetGdClaimMonthAsync(int companyId, string? gdNumber, DateTime? claimMonth, string? userName)
        {
            var number = gdNumber?.Trim() ?? "";
            if (number.Length == 0 || number.Length > 100)
                throw new InvalidOperationException("Enter a valid GD number.");
            if (ClaimMonthError(claimMonth) is { } bad) throw new InvalidOperationException(bad);

            var known = await context.ImportConsignments.AnyAsync(c => c.CompanyId == companyId && c.GdNumber == number)
                || await context.OpeningStockLots.AnyAsync(l =>
                    l.OpeningStockBalance.CompanyId == companyId && l.LotRef == number);
            if (!known) throw new KeyNotFoundException("This company has no stock GD with that number.");

            var existing = await context.GdClaimPeriods
                .FirstOrDefaultAsync(x => x.CompanyId == companyId && x.GdNumber == number);
            if (claimMonth == null)
            {
                if (existing != null) context.GdClaimPeriods.Remove(existing);
            }
            else if (existing == null)
            {
                context.GdClaimPeriods.Add(new GdClaimPeriod
                {
                    CompanyId = companyId, GdNumber = number, ClaimMonth = claimMonth.Value,
                });
            }
            else existing.ClaimMonth = claimMonth.Value;

            await context.SaveChangesAsync();
            await audit.LogAsync(new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = "Information",
                UserName = userName,
                HttpMethod = "PUT",
                RequestPath = $"/api/stock/company/{companyId}/gd-claim-month",
                StatusCode = 204,
                ExceptionType = "GD_CLAIM_MONTH_CHANGE",
                Message = $"GD {number} claim month {(claimMonth.HasValue ? "set" : "cleared")} for company {companyId}",
                CompanyId = companyId,
            });
        }

        /// <summary>Record the claimed month of ONE GD line: an opening-sheet lot or a GD-import line.</summary>
        public async Task SetLineClaimMonthAsync(int companyId, int? lotId, int? consignmentLineId, DateTime? claimMonth, string? userName)
        {
            if (ClaimMonthError(claimMonth) is { } bad) throw new InvalidOperationException(bad);
            if ((lotId == null) == (consignmentLineId == null))
                throw new InvalidOperationException("Choose one stock line.");

            string? gd; int row;
            if (lotId is { } id)
            {
                var lot = await context.OpeningStockLots
                    .FirstOrDefaultAsync(l => l.Id == id && l.OpeningStockBalance.CompanyId == companyId)
                    ?? throw new KeyNotFoundException("This company has no such stock line.");
                lot.ClaimMonth = claimMonth;
                gd = lot.LotRef; row = lot.SourceRow;
            }
            else
            {
                var line = await context.ImportConsignmentLines.Include(l => l.ImportConsignment)
                    .FirstOrDefaultAsync(l => l.Id == consignmentLineId && l.ImportConsignment.CompanyId == companyId)
                    ?? throw new KeyNotFoundException("This company has no such stock line.");
                line.ClaimMonth = claimMonth;
                gd = line.ImportConsignment.GdNumber; row = line.SourceRow;
            }
            await context.SaveChangesAsync();
            await audit.LogAsync(new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = "Information",
                UserName = userName,
                HttpMethod = "PUT",
                RequestPath = $"/api/stock/company/{companyId}/line-claim-month",
                StatusCode = 204,
                ExceptionType = "LINE_CLAIM_MONTH_CHANGE",
                Message = $"GD {gd} row {row} claim month {(claimMonth.HasValue ? "set" : "cleared")} for company {companyId}",
                CompanyId = companyId,
            });
        }

        /// <summary>
        /// Upsert an opening balance row: at most one per (company, item). Posts the value
        /// DELTA to the Inventory control account and re-prices every later sale.
        /// </summary>
        public async Task<OpeningStockBalanceDto> UpsertOpeningBalanceAsync(UpsertOpeningBalanceDto dto, int userId)
        {
            // The item must already be one this company may see (CLAUDE.md §5b-2b).
            // Writing a balance against another tenant's item would REGISTER it here.
            if (!await ItemTypeMembership.IsVisibleAsync(context, dto.ItemTypeId, new[] { dto.CompanyId }))
                throw new KeyNotFoundException("Item type not found.");
            var existing = await context.OpeningStockBalances
                .FirstOrDefaultAsync(o => o.CompanyId == dto.CompanyId && o.ItemTypeId == dto.ItemTypeId);
            // Snapshot BEFORE anything is assigned: a first entry reads as 0 -> the figure entered.
            var before = existing == null
                ? new StockFigures(0m, 0m, 0m)
                : new StockFigures(existing.Quantity, existing.ActualCostExcludingTax, existing.ValueExcludingTax);
            var isNew = existing == null;

            if (existing == null)
            {
                existing = new OpeningStockBalance
                {
                    CompanyId = dto.CompanyId,
                    ItemTypeId = dto.ItemTypeId,
                    Quantity = dto.Quantity,
                    ValueExcludingTax = dto.ValueExcludingTax,
                    SalesTaxRate = dto.SalesTaxRate,
                    ActualCostExcludingTax = dto.ActualCostExcludingTax ?? 0m,
                    AsOfDate = dto.AsOfDate.Date,
                    Notes = dto.Notes,
                    CreatedAt = DateTime.UtcNow,
                };
                context.OpeningStockBalances.Add(existing);
            }
            else
            {
                existing.Quantity = dto.Quantity;
                existing.ValueExcludingTax = dto.ValueExcludingTax;
                existing.SalesTaxRate = dto.SalesTaxRate;
                // Null means the caller did not mention cost, so the row keeps what it had.
                if (dto.ActualCostExcludingTax is decimal actual)
                    existing.ActualCostExcludingTax = actual;
                existing.AsOfDate = dto.AsOfDate.Date;
                existing.Notes = dto.Notes;
            }

            // Recorded in the SAME SaveChanges as the change itself.
            await costAudit.RecordAsync(
                dto.CompanyId, dto.ItemTypeId, existing.Id, userId,
                StockCostChangeSources.OpeningBalanceEdit,
                isNew ? "Created" : "Edited",
                before,
                new StockFigures(existing.Quantity, existing.ActualCostExcludingTax, existing.ValueExcludingTax),
                note: isNew
                    ? "Opening balance entered on the Opening Balances tab."
                    : "Opening balance edited on the Opening Balances tab.");

            await context.SaveChangesAsync();

            // Opening stock entered by hand reaches the Inventory control account, by the DELTA.
            await posting.AdjustInventoryOpeningAsync(dto.CompanyId, existing.ValueExcludingTax - before.Value);

            // A new opening position re-prices every sale after it.
            await stock.RepostInventoryPeriodsAsync(dto.CompanyId, null);

            var it = await context.ItemTypes.FindAsync(existing.ItemTypeId);
            return new OpeningStockBalanceDto
            {
                Id = existing.Id,
                CompanyId = existing.CompanyId,
                ItemTypeId = existing.ItemTypeId,
                ItemTypeName = CompanyItemNames.Pick(
                    await CompanyItemNames.ForCompanyAsync(context, existing.CompanyId, new[] { existing.ItemTypeId }),
                    existing.ItemTypeId, it?.Name ?? ""),
                Quantity = existing.Quantity,
                ValueExcludingTax = existing.ValueExcludingTax,
                SalesTaxRate = existing.SalesTaxRate,
                ActualCostExcludingTax = existing.ActualCostExcludingTax,
                AsOfDate = existing.AsOfDate,
                Notes = existing.Notes,
            };
        }
    }
}
