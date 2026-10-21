using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Letters of credit and the GD-to-LC link, moved out of <c>ImportLcsController</c>
    /// unchanged so the screen and the MCP tools run ONE implementation. The caller has
    /// asserted company access; every record is read by its own stored company here.
    /// Refusals are <see cref="InvalidOperationException"/> (bad input) and
    /// <see cref="KeyNotFoundException"/> (no such record), with the screen's own wording.
    /// </summary>
    public sealed class ImportLcService(AppDbContext db)
    {
        public async Task<List<ImportLcDto>> ListAsync(int companyId)
        {
            var lcs = await db.ImportLetterOfCredits.AsNoTracking().Where(l => l.CompanyId == companyId)
                .OrderByDescending(l => l.OpenedOn).ThenByDescending(l => l.Id).ToListAsync();
            var gds = await GdsAsync(companyId, null);
            return lcs.Select(l => ToDto(l, gds.Where(g => g.LcId == l.Id).Select(g => g.Dto).ToList())).ToList();
        }

        /// <summary>The company that owns an LC, or null when there is no such LC.</summary>
        public Task<int?> CompanyOfAsync(int lcId) =>
            db.ImportLetterOfCredits.AsNoTracking().Where(l => l.Id == lcId).Select(l => (int?)l.CompanyId).FirstOrDefaultAsync();

        public async Task<ImportLcDto> CreateAsync(int companyId, ImportLcDto dto)
        {
            if (Validate(dto) is { } error) throw new InvalidOperationException(error);
            var number = dto.LcNumber.Trim();
            if (await db.ImportLetterOfCredits.AnyAsync(l => l.CompanyId == companyId && l.LcNumber == number))
                throw new InvalidOperationException($"LC {number} is already recorded for this company.");
            var lc = new ImportLetterOfCredit { CompanyId = companyId };
            Apply(lc, dto);
            db.ImportLetterOfCredits.Add(lc);
            await db.SaveChangesAsync();
            return ToDto(lc, new());
        }

        public async Task<ImportLcDto> UpdateAsync(int id, ImportLcDto dto)
        {
            var lc = await db.ImportLetterOfCredits.FirstOrDefaultAsync(l => l.Id == id)
                ?? throw new KeyNotFoundException("That LC no longer exists.");
            if (Validate(dto) is { } error) throw new InvalidOperationException(error);
            var number = dto.LcNumber.Trim();
            if (await db.ImportLetterOfCredits.AnyAsync(l => l.CompanyId == lc.CompanyId && l.LcNumber == number && l.Id != id))
                throw new InvalidOperationException($"LC {number} is already recorded for this company.");
            Apply(lc, dto);
            await db.SaveChangesAsync();
            var gds = await GdsAsync(lc.CompanyId, lc.Id);
            return ToDto(lc, gds.Select(g => g.Dto).ToList());
        }

        public async Task DeleteAsync(int id)
        {
            var lc = await db.ImportLetterOfCredits.FirstOrDefaultAsync(l => l.Id == id)
                ?? throw new KeyNotFoundException("That LC no longer exists.");
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.ImportConsignments.Where(c => c.CompanyId == lc.CompanyId && c.ImportLcId == id)
                .ExecuteUpdateAsync(u => u.SetProperty(c => c.ImportLcId, (int?)null));
            db.ImportLetterOfCredits.Remove(lc);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        }

        /// <summary>Link a GD to one of its OWN company's LCs (or unlink with null), and set its bill of lading.</summary>
        public async Task<(int ConsignmentId, int? LcId, string? BlNumber)> LinkAsync(int consignmentId, ImportLcLinkDto? dto)
        {
            var c = await db.ImportConsignments.FirstOrDefaultAsync(x => x.Id == consignmentId)
                ?? throw new KeyNotFoundException("That consignment no longer exists.");
            if (dto?.LcId is int lcId
                && !await db.ImportLetterOfCredits.AnyAsync(l => l.Id == lcId && l.CompanyId == c.CompanyId))
                throw new InvalidOperationException("That LC is not one of this company's.");
            c.ImportLcId = dto?.LcId;
            var bl = (dto?.BlNumber ?? "").Trim();
            c.BlNumber = bl.Length == 0 ? null : bl.Length <= 60 ? bl : bl[..60];
            await db.SaveChangesAsync();
            return (consignmentId, c.ImportLcId, c.BlNumber);
        }

        public static string? Validate(ImportLcDto? dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.LcNumber)) return "Enter the LC number.";
            if (dto.LcNumber.Trim().Length > 60) return "The LC number is too long.";
            if (dto.ForeignAmount < 0m) return "The LC amount cannot be negative.";
            if (dto.ExchangeRate is < 0m) return "The exchange rate cannot be negative.";
            if (dto.OpenedOn == default) return "Enter the date the LC was opened.";
            if (dto.ExpiresOn is DateTime e && e.Date < dto.OpenedOn.Date) return "The LC cannot expire before it opens.";
            var s = (dto.Status ?? "open").Trim().ToLowerInvariant();
            if (s != "open" && s != "closed") return "Status is open or closed.";
            return null;
        }

        private static void Apply(ImportLetterOfCredit lc, ImportLcDto dto)
        {
            static string? T(string? v, int max) { var t = (v ?? "").Trim(); return t.Length == 0 ? null : t.Length <= max ? t : t[..max]; }
            lc.LcNumber = dto.LcNumber.Trim();
            lc.BankName = T(dto.BankName, 120);
            lc.SupplierName = T(dto.SupplierName, 200);
            lc.Currency = (T(dto.Currency, 10) ?? "USD").ToUpperInvariant();
            lc.ForeignAmount = Math.Round(dto.ForeignAmount, 2);
            lc.ExchangeRate = dto.ExchangeRate;
            lc.OpenedOn = dto.OpenedOn.Date;
            lc.ExpiresOn = dto.ExpiresOn?.Date;
            lc.Status = (dto.Status ?? "open").Trim().ToLowerInvariant();
            lc.Notes = T(dto.Notes, 500);
        }

        private async Task<List<(int? LcId, ImportLcGdDto Dto)>> GdsAsync(int companyId, int? lcId)
        {
            var q = db.ImportConsignments.AsNoTracking().Where(c => c.CompanyId == companyId && c.ImportLcId != null);
            if (lcId is int id) q = q.Where(c => c.ImportLcId == id);
            var rows = await q.Select(c => new
            {
                c.Id, c.ImportLcId, c.GdNumber, c.GdDate, c.BlNumber, c.ImportClearingCredited, c.AmountSettled,
                Assessed = c.Lines.Sum(l => (decimal?)l.AssessedValue) ?? 0m,
                Landed = c.Lines.Sum(l => (decimal?)(l.CostExcludingTax + l.ChargesAllocated)) ?? 0m,
            }).OrderBy(c => c.GdDate).ToListAsync();
            return rows.Select(r => (r.ImportLcId, new ImportLcGdDto
            {
                Id = r.Id, GdNumber = r.GdNumber, GdDate = r.GdDate, BlNumber = r.BlNumber,
                AssessedValue = r.Assessed, LandedCost = r.Landed, Owed = r.ImportClearingCredited, Settled = r.AmountSettled,
            })).ToList();
        }

        private static ImportLcDto ToDto(ImportLetterOfCredit l, List<ImportLcGdDto> gds) => new()
        {
            Id = l.Id, LcNumber = l.LcNumber, BankName = l.BankName, SupplierName = l.SupplierName, Currency = l.Currency,
            ForeignAmount = l.ForeignAmount, ExchangeRate = l.ExchangeRate, OpenedOn = l.OpenedOn, ExpiresOn = l.ExpiresOn,
            Status = l.Status, Notes = l.Notes, Gds = gds, GdCount = gds.Count,
            AssessedValue = gds.Sum(g => g.AssessedValue), LandedCost = gds.Sum(g => g.LandedCost),
            Owed = gds.Sum(g => g.Owed), Settled = gds.Sum(g => g.Settled),
            Outstanding = gds.Sum(g => g.Owed - g.Settled),
        };
    }
}
