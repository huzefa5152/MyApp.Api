using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class DivisionService : IDivisionService
    {
        private readonly IDivisionRepository _repo;
        private readonly AppDbContext _db;
        private readonly ILogger<DivisionService> _logger;

        public DivisionService(IDivisionRepository repo, AppDbContext db, ILogger<DivisionService> logger)
        {
            _repo = repo;
            _db = db;
            _logger = logger;
        }

        private static DivisionDto ToDto(Division d) => new()
        {
            Id = d.Id,
            CompanyId = d.CompanyId,
            Name = d.Name,
            BrandName = d.BrandName,
            LogoPath = d.LogoPath,
            FullAddress = d.FullAddress,
            Phone = d.Phone,
            NTN = d.NTN,
            CNIC = d.CNIC,
            STRN = d.STRN,
            Email = d.Email,
            StartingSalesQuoteNumber = d.StartingSalesQuoteNumber,
            CurrentSalesQuoteNumber = d.CurrentSalesQuoteNumber,
        };

        private static string? Trimmed(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

        // Apply operator-editable "personal details" + the starting quote number
        // from the DTO. LogoPath is intentionally NOT set here (it flows through
        // the dedicated logo-upload endpoint) and CurrentSalesQuoteNumber is
        // system-managed by the sales-quote create flow, so neither is clobbered
        // by a plain create/edit save.
        private static void ApplyEditableFields(Division d, DivisionDto dto)
        {
            d.BrandName   = Trimmed(dto.BrandName);
            d.FullAddress = Trimmed(dto.FullAddress);
            d.Phone       = Trimmed(dto.Phone);
            d.NTN         = Trimmed(dto.NTN);
            d.CNIC        = Trimmed(dto.CNIC);
            d.STRN        = Trimmed(dto.STRN);
            d.Email       = Trimmed(dto.Email);
            d.StartingSalesQuoteNumber = dto.StartingSalesQuoteNumber < 0 ? 0 : dto.StartingSalesQuoteNumber;
        }

        public async Task<List<DivisionDto>> GetByCompanyAsync(int companyId) =>
            (await _repo.GetByCompanyAsync(companyId)).Select(ToDto).ToList();

        public async Task<DivisionDto?> GetByIdAsync(int id)
        {
            var d = await _repo.GetByIdAsync(id);
            return d == null ? null : ToDto(d);
        }

        public async Task<DivisionDto> CreateAsync(int companyId, DivisionDto dto)
        {
            var name = (dto.Name ?? "").Trim();
            if (string.IsNullOrWhiteSpace(name))
                throw new InvalidOperationException("Division name is required.");
            if (await _repo.ExistsByNameAsync(companyId, name))
                throw new InvalidOperationException($"A division named '{name}' already exists for this company.");
            var division = new Division { CompanyId = companyId, Name = name };
            ApplyEditableFields(division, dto);
            var created = await _repo.AddAsync(division);
            return ToDto(created);
        }

        public async Task<DivisionDto?> UpdateAsync(int id, DivisionDto dto)
        {
            var d = await _repo.GetByIdAsync(id);
            if (d == null) return null;
            var name = (dto.Name ?? "").Trim();
            if (string.IsNullOrWhiteSpace(name))
                throw new InvalidOperationException("Division name is required.");
            if (await _repo.ExistsByNameAsync(d.CompanyId, name, id))
                throw new InvalidOperationException($"A division named '{name}' already exists for this company.");
            d.Name = name;
            ApplyEditableFields(d, dto);
            await _repo.UpdateAsync(d);
            return ToDto(d);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var d = await _repo.GetByIdAsync(id);
            if (d == null) return false;

            var logoPath = d.LogoPath;

            // Delete-and-unlink: the division goes away, but documents/templates
            // that referenced it fall back to company-level rather than being
            // deleted.
            //   • Sales quotes auto-unlink via the SalesQuote->Division SetNull
            //     FK when the division row is removed (DB-level ON DELETE SET NULL).
            //   • Sales orders / challans / invoices / purchase bills / goods
            //     receipts use NoAction FKs (their SetNull would create multiple
            //     cascade paths — SQL Server error 1785), so they're unlinked here
            //     in app code: DivisionId -> null. The documents keep their numbers.
            //   • Print templates: NoAction; unlinked here, IsDefault -> false so
            //     the now company-level template can't collide with the existing
            //     company default (unique index UX_PrintTemplates_DefaultPerScope).
            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                await _db.SalesOrders.Where(o => o.DivisionId == id)
                    .ExecuteUpdateAsync(s => s.SetProperty(o => o.DivisionId, (int?)null));
                await _db.DeliveryChallans.Where(dc => dc.DivisionId == id)
                    .ExecuteUpdateAsync(s => s.SetProperty(dc => dc.DivisionId, (int?)null));
                await _db.Invoices.Where(i => i.DivisionId == id)
                    .ExecuteUpdateAsync(s => s.SetProperty(i => i.DivisionId, (int?)null));
                await _db.PurchaseBills.Where(pb => pb.DivisionId == id)
                    .ExecuteUpdateAsync(s => s.SetProperty(pb => pb.DivisionId, (int?)null));
                await _db.GoodsReceipts.Where(gr => gr.DivisionId == id)
                    .ExecuteUpdateAsync(s => s.SetProperty(gr => gr.DivisionId, (int?)null));

                var templates = await _db.PrintTemplates.Where(pt => pt.DivisionId == id).ToListAsync();
                foreach (var t in templates)
                {
                    t.DivisionId = null;
                    t.IsDefault = false;
                }

                _db.Divisions.Remove(d);
                await _db.SaveChangesAsync();
                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            // Best-effort: remove the division's own logo file after commit —
            // never throw (the DB row is already gone).
            if (!string.IsNullOrEmpty(logoPath))
            {
                try
                {
                    var full = Path.Combine(Directory.GetCurrentDirectory(), logoPath.TrimStart('/'));
                    if (File.Exists(full)) File.Delete(full);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to delete logo file for removed division {DivisionId}", id);
                }
            }

            return true;
        }

        public async Task<DivisionDto?> SetLogoAsync(int id, string logoPath)
        {
            var d = await _repo.GetByIdAsync(id);
            if (d == null) return null;
            d.LogoPath = logoPath;
            await _repo.UpdateAsync(d);
            return ToDto(d);
        }
    }
}
