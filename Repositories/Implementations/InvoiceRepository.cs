using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class InvoiceRepository : IInvoiceRepository
    {
        private readonly AppDbContext _context;

        public InvoiceRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<Invoice>> GetByCompanyAsync(int companyId)
        {
            // Default list excludes IsDemo bills — those are managed via the
            // FBR Sandbox tab, not the regular Bills page — and Debit/Credit
            // Notes (DocumentType 9/10), which live on the Return Invoices
            // tab with their own numbering sequence.
            return await _context.Invoices
                .Include(i => i.Client)
                .Include(i => i.Items)
                .Include(i => i.DeliveryChallans)
                .Include(i => i.OriginalInvoice)
                .Where(i => i.CompanyId == companyId && !i.IsDemo
                         && i.DocumentType != 9 && i.DocumentType != 10)
                .OrderByDescending(i => i.InvoiceNumber)
                .ToListAsync();
        }

        public async Task<(List<Invoice> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? clientId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null,
            int? noteType = null, string? fbrFilter = null)
        {
            // Three disjoint document groups, each with its own numbering
            // sequence: sale bills (noteType null, default), Debit Notes
            // (9) and Credit Notes (10). A row is never in two lists.
            var query = _context.Invoices
                .Include(i => i.Client)
                .Include(i => i.Items)
                    // Dual-book overlay pulled on the list too, so the DTO's
                    // FbrReady / FbrMissing badge reflects the EFFECTIVE line
                    // (a bill reclassified to an HS type in Invoice mode shows
                    // "ready" even though its base line is a non-HS declaration).
                    .ThenInclude(ii => ii.Adjustment)
                .Include(i => i.DeliveryChallans)
                .Include(i => i.OriginalInvoice)
                .Where(i => i.CompanyId == companyId && !i.IsDemo
                         && (noteType == null
                              ? (i.DocumentType != 9 && i.DocumentType != 10)
                              : i.DocumentType == noteType));

            if (clientId.HasValue)
                query = query.Where(i => i.ClientId == clientId.Value);

            if (dateFrom.HasValue)
                query = query.Where(i => i.Date >= dateFrom.Value);

            if (dateTo.HasValue)
                query = query.Where(i => i.Date <= dateTo.Value);

            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                query = query.Where(i =>
                    i.InvoiceNumber.ToString().Contains(term) ||
                    (i.FbrInvoiceNumber != null && i.FbrInvoiceNumber.ToLower().Contains(term)) ||
                    (i.Client != null && i.Client.Name.ToLower().Contains(term)) ||
                    i.Items.Any(item => item.Description.ToLower().Contains(term) ||
                                         (item.ItemType != null && item.ItemType.Name.ToLower().Contains(term))) ||
                    i.DeliveryChallans.Any(dc => dc.ChallanNumber.ToString().Contains(term) ||
                                                  (dc.PoNumber != null && dc.PoNumber.ToLower().Contains(term))));
            }

            // FBR workflow-status filter (server-side so pagination stays correct).
            //   submitted    → already sent to FBR
            //   ready        → FBR setup complete (every line has HS Code + Sale
            //                  Type + a UOM + a positive unit price), not yet
            //                  submitted — ready to validate/submit. Mirrors the
            //                  in-memory FbrReady flag / ComputeFbrMissing, in SQL.
            //   notadjusted  → not submitted and at least one line still missing
            //                  an FBR field (HS Code / Sale Type / UOM / price) —
            //                  i.e. qty/price/HS not adjusted for FBR yet.
            if (!string.IsNullOrWhiteSpace(fbrFilter))
            {
                switch (fbrFilter.Trim().ToLowerInvariant())
                {
                    case "submitted":
                        query = query.Where(i => i.FbrStatus == "Submitted");
                        break;
                    // Dual-book: judge each line on its EFFECTIVE value
                    // (overlay AdjustedXxx when present, else the bill row) so a
                    // bill reclassified to an HS type in Invoice mode counts as
                    // "ready" and drops out of "notadjusted". COALESCE(adj, base)
                    // mirrors ComputeFbrMissing / FbrService.ApplyAdjustmentOverlay.
                    case "ready":
                        query = query.Where(i =>
                            i.FbrStatus != "Submitted" && !i.IsCancelled &&
                            i.Items.Any() &&
                            !i.Items.Any(it =>
                                (it.Adjustment.AdjustedHSCode ?? it.HSCode) == null || (it.Adjustment.AdjustedHSCode ?? it.HSCode) == "" ||
                                (it.Adjustment.AdjustedSaleType ?? it.SaleType) == null || (it.Adjustment.AdjustedSaleType ?? it.SaleType) == "" ||
                                ((it.Adjustment.AdjustedFbrUOMId ?? it.FbrUOMId) == null && ((it.Adjustment.AdjustedUOM ?? it.UOM) == null || (it.Adjustment.AdjustedUOM ?? it.UOM) == "")) ||
                                (it.Adjustment.AdjustedUnitPrice ?? it.UnitPrice) <= 0));
                        break;
                    case "notadjusted":
                        query = query.Where(i =>
                            i.FbrStatus != "Submitted" && !i.IsCancelled &&
                            (!i.Items.Any() ||
                             i.Items.Any(it =>
                                (it.Adjustment.AdjustedHSCode ?? it.HSCode) == null || (it.Adjustment.AdjustedHSCode ?? it.HSCode) == "" ||
                                (it.Adjustment.AdjustedSaleType ?? it.SaleType) == null || (it.Adjustment.AdjustedSaleType ?? it.SaleType) == "" ||
                                ((it.Adjustment.AdjustedFbrUOMId ?? it.FbrUOMId) == null && ((it.Adjustment.AdjustedUOM ?? it.UOM) == null || (it.Adjustment.AdjustedUOM ?? it.UOM) == "")) ||
                                (it.Adjustment.AdjustedUnitPrice ?? it.UnitPrice) <= 0)));
                        break;
                }
            }

            var totalCount = await query.CountAsync();
            var items = await query
                .OrderByDescending(i => i.InvoiceNumber)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            return (items, totalCount);
        }

        public async Task<Invoice?> GetByIdAsync(int id)
        {
            return await _context.Invoices
                .Include(i => i.Company)
                .Include(i => i.Client)
                .Include(i => i.Items)
                    .ThenInclude(ii => ii.DeliveryItem)
                .Include(i => i.Items)
                    .ThenInclude(ii => ii.ItemType)
                // Dual-book overlay (2026-05-11). Pulled on detail
                // fetches so EditBillForm in Invoice mode can hydrate
                // the AdjustedXxx values as "current" while keeping
                // the InvoiceItem row above as "original".
                .Include(i => i.Items)
                    .ThenInclude(ii => ii.Adjustment)
                .Include(i => i.DeliveryChallans)
                    .ThenInclude(dc => dc.Items)
                .Include(i => i.OriginalInvoice)
                .FirstOrDefaultAsync(i => i.Id == id);
        }

        public async Task<Invoice> CreateAsync(Invoice invoice)
        {
            _context.Invoices.Add(invoice);
            await _context.SaveChangesAsync();
            return invoice;
        }

        public async Task UpdateAsync(Invoice invoice)
        {
            _context.Invoices.Update(invoice);
            await _context.SaveChangesAsync();
        }

        public async Task<int> GetTotalCountAsync()
        {
            return await _context.Invoices.CountAsync(i => !i.IsDemo);
        }

        public async Task<int> GetCountByCompanyAsync(int companyId)
        {
            return await _context.Invoices.CountAsync(i => i.CompanyId == companyId && !i.IsDemo);
        }

        public async Task<bool> HasInvoicesForClientAsync(int clientId)
        {
            return await _context.Invoices.AnyAsync(i => i.ClientId == clientId);
        }

        public async Task<bool> HasInvoicesForCompanyAsync(int companyId)
        {
            return await _context.Invoices.AnyAsync(i => i.CompanyId == companyId);
        }

        public async Task<bool> HasNotesForCompanyAsync(int companyId, int docType)
        {
            return await _context.Invoices.AnyAsync(i =>
                i.CompanyId == companyId && i.DocumentType == docType);
        }

        public async Task<Dictionary<int, bool>> HasInvoicesForClientsAsync(IEnumerable<int> clientIds)
        {
            var clientsWithInvoices = await _context.Invoices
                .Where(i => clientIds.Contains(i.ClientId))
                .Select(i => i.ClientId)
                .Distinct()
                .ToListAsync();

            return clientIds.ToDictionary(id => id, id => clientsWithInvoices.Contains(id));
        }
    }
}
