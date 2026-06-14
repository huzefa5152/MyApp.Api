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

        private static DivisionDto ToDto(Division d) => new() { Id = d.Id, CompanyId = d.CompanyId, Name = d.Name };

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
            var created = await _repo.AddAsync(new Division { CompanyId = companyId, Name = name });
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
            await _repo.UpdateAsync(d);
            return ToDto(d);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var d = await _repo.GetByIdAsync(id);
            if (d == null) return false;

            // The PrintTemplate -> Division FK is NoAction (avoids multiple cascade
            // paths from Company), so a division's templates must be removed in app
            // code. Delete the templates and the division in one transaction; remove
            // the templates' on-disk Excel files only after the commit succeeds.
            var excelPaths = new List<string>();
            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                var templates = await _db.PrintTemplates.Where(pt => pt.DivisionId == id).ToListAsync();
                excelPaths = templates
                    .Where(t => !string.IsNullOrEmpty(t.ExcelTemplatePath))
                    .Select(t => t.ExcelTemplatePath!)
                    .ToList();

                if (templates.Count > 0) _db.PrintTemplates.RemoveRange(templates);
                _db.Divisions.Remove(d);
                await _db.SaveChangesAsync();
                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            // Best-effort file cleanup — never throw (the DB rows are already gone).
            foreach (var rel in excelPaths)
            {
                try
                {
                    var full = Path.Combine(Directory.GetCurrentDirectory(), rel.TrimStart('/'));
                    if (File.Exists(full)) File.Delete(full);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to delete Excel template file for removed division {DivisionId}", id);
                }
            }

            return true;
        }
    }
}
