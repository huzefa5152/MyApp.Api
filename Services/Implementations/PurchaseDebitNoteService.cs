using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class PurchaseDebitNoteService : IPurchaseDebitNoteService
    {
        private readonly AppDbContext _context;
        public PurchaseDebitNoteService(AppDbContext context) => _context = context;

        private static PurchaseDebitNoteDto ToDto(Models.PurchaseDebitNote d) => new()
        {
            Id = d.Id,
            DebitNoteNumber = d.DebitNoteNumber,
            Date = d.Date,
            CompanyId = d.CompanyId,
            DivisionId = d.DivisionId,
            DivisionName = d.Division?.Name,
            SupplierId = d.SupplierId,
            SupplierName = d.Supplier?.Name ?? "",
            SupplierRef = d.SupplierRef,
            Notes = d.Notes,
            Subtotal = d.Subtotal,
            GSTAmount = d.GSTAmount,
            GrandTotal = d.GrandTotal,
            IsMigrated = d.IsMigrated,
            Items = d.Items.OrderBy(i => i.Id).Select(i => new PurchaseDebitNoteItemDto
            {
                Id = i.Id,
                Description = i.Description,
                Quantity = i.Quantity,
                UOM = i.UOM,
                UnitPrice = i.UnitPrice,
                LineTotal = i.LineTotal,
            }).ToList(),
        };

        public async Task<List<PurchaseDebitNoteDto>> GetByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var q = _context.PurchaseDebitNotes.AsNoTracking()
                .Include(d => d.Supplier).Include(d => d.Division).Include(d => d.Items)
                .Where(d => d.CompanyId == companyId);
            if (allowedDivisionIds != null)
                q = q.Where(d => d.DivisionId == null || allowedDivisionIds.Contains(d.DivisionId.Value));
            var rows = await q.OrderByDescending(d => d.DebitNoteNumber).ToListAsync();
            return rows.Select(ToDto).ToList();
        }

        public async Task<PurchaseDebitNoteDto?> GetByIdAsync(int id)
        {
            var d = await _context.PurchaseDebitNotes.AsNoTracking()
                .Include(x => x.Supplier).Include(x => x.Division).Include(x => x.Items)
                .FirstOrDefaultAsync(x => x.Id == id);
            return d == null ? null : ToDto(d);
        }

        public async Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var q = _context.PurchaseDebitNotes.Where(d => d.CompanyId == companyId);
            if (allowedDivisionIds != null)
                q = q.Where(d => d.DivisionId == null || allowedDivisionIds.Contains(d.DivisionId.Value));
            return await q.CountAsync();
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var d = await _context.PurchaseDebitNotes.FindAsync(id);
            if (d == null) return false;
            _context.PurchaseDebitNotes.Remove(d);   // items cascade
            await _context.SaveChangesAsync();
            return true;
        }
    }
}
