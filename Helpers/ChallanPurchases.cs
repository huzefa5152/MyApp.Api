using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// What a challan's lines have been bought for. Two paths buy them: the
    /// challan's own "Create purchase bills" (bill-level
    /// <see cref="PurchaseBill.SourceDeliveryChallanId"/>, every line) and a
    /// purchase bill that picked lines (<see cref="PurchaseItem.SourceDeliveryItemId"/>).
    /// Every "this challan is locked by a purchase" guard reads <see cref="ChallanIds"/>,
    /// so both paths lock a challan the same way.
    /// </summary>
    public static class ChallanPurchases
    {
        /// <summary>Ids of challans that any purchase bill buys from.</summary>
        public static IQueryable<int> ChallanIds(AppDbContext db) =>
            db.PurchaseBills.Where(p => p.SourceDeliveryChallanId != null).Select(p => p.SourceDeliveryChallanId!.Value)
                .Union(db.PurchaseItems.Where(i => i.SourceDeliveryItemId != null).Select(i => i.SourceDeliveryItem!.DeliveryChallanId));

        public static Task<bool> AnyAsync(AppDbContext db, int challanId) => ChallanIds(db).ContainsAsync(challanId);

        /// <summary>What a purchase may claim: the delivered quantity, which a bill
        /// can have overwritten with a smaller billed one.</summary>
        public static decimal Delivered(DeliveryItem i) => i.DeliveredQuantity ?? i.Quantity;

        /// <summary>
        /// Quantity already purchased per challan line, leaving out
        /// <paramref name="excludeBillId"/> (the bill being edited). A challan
        /// bought by its own "Create purchase bills" before line links existed
        /// has every line counted as fully purchased.
        /// </summary>
        public static async Task<Dictionary<int, decimal>> PurchasedAsync(
            AppDbContext db, IReadOnlyCollection<DeliveryItem> lines, int? excludeBillId)
        {
            var ids = lines.Select(l => l.Id).ToList();
            var challanIds = lines.Select(l => l.DeliveryChallanId).Distinct().ToList();
            var claimed = await db.PurchaseItems.AsNoTracking()
                .Where(p => p.SourceDeliveryItemId != null && ids.Contains(p.SourceDeliveryItemId.Value)
                            && p.PurchaseBillId != excludeBillId)
                .GroupBy(p => p.SourceDeliveryItemId!.Value)
                .Select(g => new { Id = g.Key, Qty = g.Sum(p => p.Quantity) })
                .ToDictionaryAsync(x => x.Id, x => x.Qty);
            var wholeChallan = (await db.PurchaseBills.AsNoTracking()
                .Where(p => p.SourceDeliveryChallanId != null && challanIds.Contains(p.SourceDeliveryChallanId.Value)
                            && p.Id != excludeBillId && !p.Items.Any(i => i.SourceDeliveryItemId != null))
                .Select(p => p.SourceDeliveryChallanId!.Value).ToListAsync()).ToHashSet();
            return lines.ToDictionary(l => l.Id,
                l => wholeChallan.Contains(l.DeliveryChallanId) ? Delivered(l) : claimed.GetValueOrDefault(l.Id));
        }
    }
}
