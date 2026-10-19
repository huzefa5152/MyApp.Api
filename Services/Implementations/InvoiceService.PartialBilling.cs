using Microsoft.EntityFrameworkCore;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Implementations;

/// <summary>
/// Partial billing of a challan. A challan row is on at most one bill and, when
/// it is, EVERY one of its lines is on that bill. Billing only some lines
/// therefore moves the rest onto a new row with the same challan number
/// (<see cref="DeliveryChallan.SplitFromChallanId"/> → the original row), which
/// is billable on its own. Line ids never change, so costs and order links stay
/// with the line. Rows of one challan that are both off a bill (or both on the
/// same bill) are merged back into one.
/// </summary>
public partial class InvoiceService
{
    /// <summary>
    /// Moves <paramref name="deliveryItemIds"/> off <paramref name="source"/> onto a
    /// new, unbilled row of the same challan. Caller owns the transaction. The
    /// row is inserted on its own and the lines are moved with a set-based update,
    /// so nothing here depends on tracked state (a rolled-back retry starts clean).
    /// A moved line was not billed, so any delivered quantity a smaller billed
    /// quantity had overwritten comes back with it.
    /// </summary>
    private async Task<int> SplitOffAsync(DeliveryChallan source, IReadOnlyCollection<int> deliveryItemIds)
    {
        var ids = deliveryItemIds.Distinct().ToList();
        if (ids.Count == 0) throw new InvalidOperationException("Nothing to leave out.");
        var owned = await _context.DeliveryItems.CountAsync(i => i.DeliveryChallanId == source.Id && ids.Contains(i.Id));
        if (owned != ids.Count) throw new InvalidOperationException($"A line left out is not on challan #{source.ChallanNumber}.");
        var total = await _context.DeliveryItems.CountAsync(i => i.DeliveryChallanId == source.Id);
        if (owned == total)
            throw new InvalidOperationException($"Challan #{source.ChallanNumber} would have no line on the bill. Untick the whole challan instead.");
        // A supplier purchase made from this challan covers every one of its lines.
        if (await _context.PurchaseBills.AnyAsync(p => p.SourceDeliveryChallanId == source.Id))
            throw new InvalidOperationException($"Challan #{source.ChallanNumber} has supplier purchase bills, so its lines stay together. Bill the whole challan, or remove its purchase bills first.");

        var split = new DeliveryChallan
        {
            CompanyId = source.CompanyId, DivisionId = source.DivisionId, ChallanNumber = source.ChallanNumber,
            ClientId = source.ClientId, PoNumber = source.PoNumber, PoDate = source.PoDate, IndentNo = source.IndentNo,
            DeliveryDate = source.DeliveryDate, Site = source.Site, Notes = source.Notes,
            IsImported = source.IsImported, IsDemo = source.IsDemo, SalesOrderId = source.SalesOrderId,
            SplitFromChallanId = source.SplitFromChallanId ?? source.Id,
        };
        split.Status = ChallanBillingRules.UnbilledStatus(split);
        _context.DeliveryChallans.Add(split);
        await _context.SaveChangesAsync();
        await _context.DeliveryItems.Where(i => ids.Contains(i.Id))
            .ExecuteUpdateAsync(s => s
                .SetProperty(i => i.DeliveryChallanId, split.Id)
                .SetProperty(i => i.Quantity, i => i.DeliveredQuantity ?? i.Quantity)
                .SetProperty(i => i.DeliveredQuantity, (decimal?)null));
        _context.Entry(split).State = EntityState.Detached;
        // Detach first, then drop from the in-memory collection: a moved line still
        // listed under `source` would be re-attached and pulled back by the next save.
        foreach (var moved in _context.ChangeTracker.Entries<DeliveryItem>().Where(e => ids.Contains(e.Entity.Id)).ToList())
            moved.State = EntityState.Detached;
        foreach (var item in source.Items.Where(i => ids.Contains(i.Id)).ToList()) source.Items.Remove(item);
        return split.Id;
    }

    /// <summary>Re-joins the unbilled rows of each touched challan into one row, preferring the original.</summary>
    private async Task MergeUnbilledSplitsAsync(IEnumerable<int> challanIds)
    {
        var touched = challanIds.Distinct().ToList();
        if (touched.Count == 0) return;
        var roots = await _context.DeliveryChallans.AsNoTracking().Where(c => touched.Contains(c.Id))
            .Select(c => c.SplitFromChallanId ?? c.Id).Distinct().ToListAsync();
        foreach (var root in roots)
            await MergeRowsAsync(root, await _context.DeliveryChallans.AsNoTracking()
                .Where(c => (c.Id == root || c.SplitFromChallanId == root) && c.InvoiceId == null
                    && ChallanBillingRules.Statuses.Contains(c.Status))
                .Select(c => c.Id).ToListAsync());
    }

    /// <summary>Rows of one challan that meet again on the same bill become one row.</summary>
    private async Task MergeBilledSplitsAsync(int invoiceId)
    {
        var rows = await _context.DeliveryChallans.AsNoTracking().Where(c => c.InvoiceId == invoiceId)
            .Select(c => new { c.Id, Root = c.SplitFromChallanId ?? c.Id }).ToListAsync();
        foreach (var group in rows.GroupBy(r => r.Root).Where(g => g.Count() > 1))
            await MergeRowsAsync(group.Key, group.Select(r => r.Id).ToList());
    }

    /// <summary>
    /// Moves every line of <paramref name="rowIds"/> onto one of them (the original
    /// row when it can take part) and deletes the emptied rows. A row that carries
    /// anything of its own — a supplier purchase made from it, or an attachment —
    /// is left as it is and takes no lines.
    /// </summary>
    private async Task MergeRowsAsync(int root, List<int> rowIds)
    {
        if (rowIds.Count < 2) return;
        var pinned = (await _context.PurchaseBills.Where(p => p.SourceDeliveryChallanId != null && rowIds.Contains(p.SourceDeliveryChallanId.Value))
                .Select(p => p.SourceDeliveryChallanId!.Value).ToListAsync())
            .Concat(await _context.Attachments.Where(a => a.EntityType == "DeliveryChallan" && a.EntityId != null
                && rowIds.Contains(a.EntityId.Value)).Select(a => a.EntityId!.Value).ToListAsync())
            // A row that was duplicated is the parent of another challan row.
            .Concat(await _context.DeliveryChallans.Where(c => c.DuplicatedFromId != null && rowIds.Contains(c.DuplicatedFromId.Value))
                .Select(c => c.DuplicatedFromId!.Value).ToListAsync())
            .ToHashSet();
        var free = rowIds.Where(r => !pinned.Contains(r)).ToList();
        if (free.Count < 2) return;
        var keep = free.Contains(root) ? root : free.Min();
        var merge = free.Where(id => id != keep).ToList();
        await _context.DeliveryItems.Where(i => merge.Contains(i.DeliveryChallanId))
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.DeliveryChallanId, keep));
        await _context.DeliveryChallans.Where(c => merge.Contains(c.Id)).ExecuteDeleteAsync();
    }
}
