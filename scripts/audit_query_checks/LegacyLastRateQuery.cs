// Frozen Trader query used only to verify identical results.
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Data;

public static class LegacyLastRateQuery
{
        public static async Task<List<LastRateDto>> ExecuteAsync(AppDbContext context, int companyId, int challanId)
        {
            // Pull the challan's items (including ItemType + description). We
            // scope by companyId AS WELL to defend against cross-tenant probes
            // — a user can only see last-rates for their own challan.
            var challan = await context.DeliveryChallans
                .Include(dc => dc.Items)
                .FirstOrDefaultAsync(dc => dc.Id == challanId && dc.CompanyId == companyId);
            if (challan == null) return new List<LastRateDto>();

            var result = new List<LastRateDto>();

            // Build a single query base — we'll execute it once per item below.
            // Demo bills are excluded so synthetic FBR sandbox prices don't
            // leak into real quoting.
            var bills = context.InvoiceItems
                // Debit/Credit Note lines are RETURNS — excluding them keeps
                // rate suggestions based on actual sales only.
                .Where(ii => ii.Invoice.CompanyId == companyId && !ii.Invoice.IsDemo && !ii.Invoice.IsCancelled
                          && ii.Invoice.DocumentType != 9 && ii.Invoice.DocumentType != 10);

            foreach (var di in challan.Items)
            {
                LastRateDto row = new() { DeliveryItemId = di.Id };

                // 1. Match by ItemTypeId — the precise path.
                if (di.ItemTypeId.HasValue)
                {
                    var hit = await bills
                        .Where(ii => ii.ItemTypeId == di.ItemTypeId.Value)
                        .OrderByDescending(ii => ii.Invoice.Date)
                        .ThenByDescending(ii => ii.Invoice.InvoiceNumber)
                        .Select(ii => new
                        {
                            ii.UnitPrice,
                            ii.Invoice.InvoiceNumber,
                            ii.Invoice.Date,
                            ClientName = ii.Invoice.Client.Name
                        })
                        .FirstOrDefaultAsync();
                    if (hit != null)
                    {
                        row.LastUnitPrice = hit.UnitPrice;
                        row.LastInvoiceNumber = hit.InvoiceNumber;
                        row.LastInvoiceDate = hit.Date;
                        row.LastClientName = hit.ClientName;
                        row.MatchedBy = "ItemType";
                    }
                }

                // 2. Fallback: exact (case-insensitive) Description match.
                if (row.LastUnitPrice == null && !string.IsNullOrWhiteSpace(di.Description))
                {
                    var desc = di.Description.ToLower();
                    var hit = await bills
                        .Where(ii => ii.Description.ToLower() == desc)
                        .OrderByDescending(ii => ii.Invoice.Date)
                        .ThenByDescending(ii => ii.Invoice.InvoiceNumber)
                        .Select(ii => new
                        {
                            ii.UnitPrice,
                            ii.Invoice.InvoiceNumber,
                            ii.Invoice.Date,
                            ClientName = ii.Invoice.Client.Name
                        })
                        .FirstOrDefaultAsync();
                    if (hit != null)
                    {
                        row.LastUnitPrice = hit.UnitPrice;
                        row.LastInvoiceNumber = hit.InvoiceNumber;
                        row.LastInvoiceDate = hit.Date;
                        row.LastClientName = hit.ClientName;
                        row.MatchedBy = "Description";
                    }
                }

                result.Add(row);
            }

            return result;
        }
}
