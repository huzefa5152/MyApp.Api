using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Challans that a purchase has bought from, for every "this challan is
    /// locked by a purchase" guard. A challan counts when a purchase row links
    /// to one of its lines, or to anything else on that line's trail (its sales
    /// order line, or a sale bill line that bills it), or when the challan was
    /// bought whole by its own "Create purchase bills" before rows recorded
    /// their sources. See <see cref="CustomerDemand"/>.
    /// </summary>
    public static class ChallanPurchases
    {
        public static IQueryable<int> ChallanIds(AppDbContext db)
        {
            var s = db.PurchaseItemSources;
            var viaLines = db.DeliveryItems.Where(di => s.Any(x =>
                    x.DeliveryItemId == di.Id
                    || (x.InvoiceItem != null && x.InvoiceItem.DeliveryItemId == di.Id)
                    || (di.SalesOrderItemId != null
                        && (x.SalesOrderItemId == di.SalesOrderItemId
                            || (x.InvoiceItem != null && x.InvoiceItem.SalesOrderItemId == di.SalesOrderItemId)
                            || (x.DeliveryItem != null && x.DeliveryItem.SalesOrderItemId == di.SalesOrderItemId)
                            || (x.InvoiceItem != null && x.InvoiceItem.DeliveryItem != null
                                && x.InvoiceItem.DeliveryItem.SalesOrderItemId == di.SalesOrderItemId)))))
                .Select(di => di.DeliveryChallanId);
            return db.PurchaseBills.Where(p => p.SourceDeliveryChallanId != null)
                .Select(p => p.SourceDeliveryChallanId!.Value)
                .Union(viaLines);
        }

        public static Task<bool> AnyAsync(AppDbContext db, int challanId) => ChallanIds(db).ContainsAsync(challanId);
    }
}
