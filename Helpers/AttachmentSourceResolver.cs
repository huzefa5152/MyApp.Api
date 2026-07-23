using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Fills <see cref="AttachmentDto.EntityNumber"/> + <see cref="AttachmentDto.SourceLabel"/>
    /// for folder / uncategorized listings so the operator can tell where each
    /// file came from (a direct upload vs a specific business document, with its
    /// real document number). Batches one query per entity type present — never
    /// one per row. Entity-scoped listings skip this (all rows share one source).
    ///
    /// All lookups are already tenant-safe: the DTOs handed in come from a
    /// company-scoped listing, and the linked record's own CompanyId was asserted
    /// at upload time (cross-tenant link guard in AttachmentService.UploadAsync).
    /// </summary>
    public static class AttachmentSourceResolver
    {
        public static async Task PopulateAsync(AppDbContext ctx, List<AttachmentDto> dtos)
        {
            if (dtos.Count == 0) return;

            foreach (var d in dtos)
            {
                if (string.IsNullOrEmpty(d.EntityType))
                {
                    d.SourceLabel = "Direct upload";   // no entity link
                    d.EntityNumber = null;
                }
            }

            // Group the entity-linked rows by type so each type is one query.
            var byType = dtos
                .Where(d => !string.IsNullOrEmpty(d.EntityType) && d.EntityId.HasValue)
                .GroupBy(d => d.EntityType!);

            foreach (var group in byType)
            {
                var ids = group.Select(d => d.EntityId!.Value).Distinct().ToList();

                switch (group.Key)
                {
                    case AttachmentEntityTypes.SalesQuote:
                    {
                        var map = await ctx.SalesQuotes.AsNoTracking()
                            .Where(x => ids.Contains(x.Id))
                            .ToDictionaryAsync(x => x.Id, x => x.QuoteNumber);
                        Apply(group, map, _ => "Sales Quote");
                        break;
                    }
                    case AttachmentEntityTypes.SalesOrder:
                    {
                        var map = await ctx.SalesOrders.AsNoTracking()
                            .Where(x => ids.Contains(x.Id))
                            .ToDictionaryAsync(x => x.Id, x => x.SalesOrderNumber);
                        Apply(group, map, _ => "Sales Order");
                        break;
                    }
                    case AttachmentEntityTypes.DeliveryChallan:
                    {
                        var map = await ctx.DeliveryChallans.AsNoTracking()
                            .Where(x => ids.Contains(x.Id))
                            .ToDictionaryAsync(x => x.Id, x => x.ChallanNumber);
                        Apply(group, map, _ => "Delivery Challan");
                        break;
                    }
                    case AttachmentEntityTypes.Invoice:
                    {
                        // Invoice covers sale invoices, bills, and credit/debit
                        // notes — NoteKind (0 sale, 1 debit note, 2 credit note)
                        // picks the label.
                        var rows = await ctx.Invoices.AsNoTracking()
                            .Where(x => ids.Contains(x.Id))
                            .Select(x => new { x.Id, x.InvoiceNumber, x.NoteKind })
                            .ToListAsync();
                        var numMap = rows.ToDictionary(r => r.Id, r => r.InvoiceNumber);
                        var kindMap = rows.ToDictionary(r => r.Id, r => r.NoteKind);
                        Apply(group, numMap, id => kindMap.TryGetValue(id, out var k)
                            ? k switch { 1 => "Debit Note", 2 => "Credit Note", _ => "Invoice" }
                            : "Invoice");
                        break;
                    }
                    case AttachmentEntityTypes.PurchaseBill:
                    {
                        var map = await ctx.PurchaseBills.AsNoTracking()
                            .Where(x => ids.Contains(x.Id))
                            .ToDictionaryAsync(x => x.Id, x => x.PurchaseBillNumber);
                        Apply(group, map, _ => "Purchase Bill");
                        break;
                    }
                    case AttachmentEntityTypes.GoodsReceipt:
                    {
                        var map = await ctx.GoodsReceipts.AsNoTracking()
                            .Where(x => ids.Contains(x.Id))
                            .ToDictionaryAsync(x => x.Id, x => x.GoodsReceiptNumber);
                        Apply(group, map, _ => "Goods Receipt");
                        break;
                    }
                    case AttachmentEntityTypes.Payment:
                    {
                        // Direction flips the label: Receipt (money in) vs Payment (out).
                        var rows = await ctx.Payments.AsNoTracking()
                            .Where(x => ids.Contains(x.Id))
                            .Select(x => new { x.Id, x.Number, x.Direction })
                            .ToListAsync();
                        var numMap = rows.ToDictionary(r => r.Id, r => r.Number);
                        var dirMap = rows.ToDictionary(r => r.Id, r => r.Direction);
                        Apply(group, numMap, id => dirMap.TryGetValue(id, out var dir)
                            ? (dir == PaymentDirection.Payment ? "Payment" : "Receipt")
                            : "Receipt");
                        break;
                    }
                    default:
                        // Unknown/stale type — label by the raw type, no number.
                        foreach (var d in group) d.SourceLabel = group.Key;
                        break;
                }
            }
        }

        // Stamps EntityNumber (from the id→number map) + SourceLabel (from the
        // label picker) onto each DTO in the group. A missing id (record deleted
        // out from under a still-linked attachment) leaves EntityNumber null.
        private static void Apply(
            IEnumerable<AttachmentDto> group,
            IReadOnlyDictionary<int, int> numberMap,
            Func<int, string> labelFor)
        {
            foreach (var d in group)
            {
                var id = d.EntityId!.Value;
                d.SourceLabel = labelFor(id);
                d.EntityNumber = numberMap.TryGetValue(id, out var num) ? num.ToString() : null;
            }
        }
    }
}
