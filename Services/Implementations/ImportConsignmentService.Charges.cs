using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// GD-level charges (2026-10-05): freight, clearing, wharfage, demurrage and
    /// port costs that belong to the whole GD. Each add or delete re-spreads
    /// every charge over the GD's costed lines by assessed value
    /// (<see cref="ImportChargeAllocator"/>), moves each arrival's landed unit
    /// cost (the actual cost margin reports read -- never the declared value or
    /// the FBR figures) and re-posts the GD's journal entry, in one transaction.
    ///
    /// New Arrivals GDs only: a Backfill GD re-priced stock already on the books
    /// and posts nothing, so a charge on it would have nowhere honest to land.
    /// </summary>
    public partial class ImportConsignmentService
    {
        public async Task<List<ImportConsignmentChargeDto>> GetChargesAsync(int consignmentId) =>
            await _db.ImportConsignmentCharges.AsNoTracking()
                .Where(c => c.ImportConsignmentId == consignmentId)
                .OrderBy(c => c.ChargeDate).ThenBy(c => c.Id)
                .Select(c => new ImportConsignmentChargeDto
                {
                    Id = c.Id, Kind = c.Kind, Amount = c.Amount, Description = c.Description,
                    PaidTo = c.PaidTo, ChargeDate = c.ChargeDate,
                })
                .ToListAsync();

        public async Task<ImportConsignmentChargesResultDto> AddChargeAsync(int consignmentId, CreateImportConsignmentChargeDto dto)
        {
            var kind = ImportChargeKinds.Normalize(dto?.Kind)
                ?? throw new InvalidOperationException("Choose what the charge is: freight, clearing, wharfage, demurrage, port or other.");
            if (dto!.Amount <= 0m) throw new InvalidOperationException("Enter the charge's amount.");
            if (dto.Amount > 1_000_000_000m) throw new InvalidOperationException("That amount is too large to be a GD charge.");
            return await ReallocateAsync(consignmentId, c =>
            {
                c.Charges.Add(new ImportConsignmentCharge
                {
                    CompanyId = c.CompanyId, ImportConsignmentId = c.Id, Kind = kind,
                    Amount = Math.Round(dto.Amount, 2, MidpointRounding.AwayFromZero),
                    Description = Trim(dto.Description, 200), PaidTo = Trim(dto.PaidTo, 200),
                    ChargeDate = (dto.ChargeDate ?? c.GdDate).Date,
                });
            });
        }

        public async Task<ImportConsignmentChargesResultDto> DeleteChargeAsync(int consignmentId, int chargeId) =>
            await ReallocateAsync(consignmentId, c =>
            {
                var charge = c.Charges.FirstOrDefault(x => x.Id == chargeId)
                    ?? throw new KeyNotFoundException("That charge no longer exists.");
                c.Charges.Remove(charge);
                _db.ImportConsignmentCharges.Remove(charge);
            });

        private async Task<ImportConsignmentChargesResultDto> ReallocateAsync(int consignmentId, Action<ImportConsignment> change)
        {
            await using var tx = await _db.Database.BeginTransactionAsync();
            var consignment = await _db.ImportConsignments
                .Include(c => c.Lines).Include(c => c.Charges)
                .FirstOrDefaultAsync(c => c.Id == consignmentId)
                ?? throw new KeyNotFoundException("That consignment no longer exists.");
            if (GdCostingImportModeNames.Normalize(consignment.Mode) != GdCostingImportModeNames.NewArrivals)
                throw new InvalidOperationException(
                    "Charges can be added to a GD brought in as new goods. This one re-priced stock already on the books.");

            change(consignment);

            var costed = consignment.Lines
                .Where(l => l.Disposition is GdCostingDisposition.CostOnly or GdCostingDisposition.StockPosted)
                .OrderBy(l => l.SourceRow).ThenBy(l => l.Id).ToList();
            var total = Math.Round(consignment.Charges.Sum(c => c.Amount), 2);
            if (total != 0m && costed.Count == 0)
                throw new InvalidOperationException("This GD brought no goods in, so there is nothing to spread a charge over.");
            var shares = ImportChargeAllocator.Allocate(
                costed.Select(l => new ImportChargeAllocator.Line(l.Id, l.AssessedValue, l.Quantity)).ToList(), total);
            foreach (var l in consignment.Lines)
                l.ChargesAllocated = shares.GetValueOrDefault(l.Id);

            // The landed cost each arrival carries into the stock walk.
            var movementIds = costed.Where(l => l.StockMovementId != null).Select(l => l.StockMovementId!.Value).ToList();
            var movements = await _db.StockMovements.Where(m => movementIds.Contains(m.Id)).ToDictionaryAsync(m => m.Id);
            foreach (var l in costed)
                if (l.StockMovementId is int mid && movements.TryGetValue(mid, out var m) && m.Quantity > 0m)
                    m.ActualUnitCostExcludingTax = (l.CostExcludingTax + l.ChargesAllocated) / m.Quantity;

            await _db.SaveChangesAsync();

            var posted = await _db.JournalEntries.AnyAsync(e =>
                e.CompanyId == consignment.CompanyId && e.SourceDocType == SourceDocType.ImportConsignment
                && e.SourceDocId == consignment.Id);
            if (posted)
            {
                await _posting.PostImportConsignmentAsync(consignment);
                if (consignment.AmountSettled > consignment.ImportClearingCredited + OutstandingEpsilon)
                    throw new InvalidOperationException(
                        $"Removing that charge drops GD {consignment.GdNumber}'s liability to "
                        + $"{consignment.ImportClearingCredited:N2}, but {consignment.AmountSettled:N2} has already been "
                        + "settled against it. Reduce or cancel the settlement first.");
            }
            await _db.SaveChangesAsync();
            await tx.CommitAsync();

            return new ImportConsignmentChargesResultDto
            {
                ConsignmentId = consignment.Id,
                TotalCharges = total,
                ImportClearingCredited = consignment.ImportClearingCredited,
                LandedCostWithCharges = Math.Round(costed.Sum(l => l.CostExcludingTax + l.ChargesAllocated), 2),
                Charges = await GetChargesAsync(consignment.Id),
            };
        }

        private static string? Trim(string? s, int max)
        {
            var t = (s ?? "").Trim();
            return t.Length == 0 ? null : t.Length <= max ? t : t[..max];
        }
    }
}
