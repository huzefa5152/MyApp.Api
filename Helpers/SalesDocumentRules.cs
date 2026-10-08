using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers;

public static class SalesDocumentRules
{
    public static bool BillEditable(Invoice bill) => !bill.IsCancelled
        && string.IsNullOrWhiteSpace(bill.FbrIRN) && bill.FbrSubmittedAt == null
        && bill.FbrCancelledAt == null && FbrSubmissionStatus.IsSubmittable(bill.FbrStatus);

    public static async Task RefreshOrdersAsync(AppDbContext context, int companyId)
    {
        var orders = await context.SalesOrders.Where(o => o.CompanyId == companyId && o.Status != "Cancelled")
            .Include(o => o.Items).Include(o => o.DeliveryChallans).ThenInclude(c => c.Items)
            .AsSplitQuery().ToListAsync();
        foreach (var order in orders)
        {
            if (order.ManuallyClosed) continue;
            var active = order.DeliveryChallans.Where(c => c.Status != "Cancelled").ToList();
            var quantities = active.SelectMany(c => c.Items).Where(i => i.SalesOrderItemId != null)
                .GroupBy(i => i.SalesOrderItemId!.Value).ToDictionary(g => g.Key, g => g.Sum(i => i.Quantity));
            var complete = order.Items.Count > 0 && order.Items.All(i => quantities.GetValueOrDefault(i.Id) >= i.Quantity)
                && active.Count > 0 && active.All(c => c.InvoiceId != null);
            order.Status = complete ? "Closed" : "Open";
        }
        await context.SaveChangesAsync();
    }
}
