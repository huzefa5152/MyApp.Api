using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Implementations;

/// <summary>
/// Partial billing of a challan. A challan row is on at most one bill and, when
/// it is, EVERY one of its lines is on that bill. Billing only some lines
/// therefore moves the rest onto a new row with the same challan number
/// (<see cref="DeliveryChallan.SplitFromChallanId"/> → the original row), which
/// is billable on its own. Line ids never change, so costs, supplier purchases
/// and order links stay with the line. Rows of one challan that are both off a
/// bill are merged back into one, so a challan released in full is whole again.
/// </summary>
public partial class InvoiceService
{
    /// <summary>The status a challan returns to when it is not on a bill (same table as ReleaseChallans).</summary>
    private static string UnbilledStatus(DeliveryChallan dc) =>
        !string.IsNullOrWhiteSpace(dc.PoNumber) ? (dc.IsImported ? "Imported" : "Pending") : "No PO";

    /// <summary>
    /// Moves <paramref name="deliveryItemIds"/> off <paramref name="source"/> onto a
    /// new, unbilled row of the same challan. Caller owns the transaction. The
    /// row is inserted on its own and the lines are moved with a set-based update,
    /// so nothing here depends on tracked state (a rolled-back retry starts clean).
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

        // Open automatic supplier purchases follow the line; a paid, credited or
        // entered supplier bill pins it to its challan, so that refuses here.
        await _purchases.ReleaseLinesAsync(source.CompanyId, ids, Array.Empty<int>());

        var split = new DeliveryChallan
        {
            CompanyId = source.CompanyId, ChallanNumber = source.ChallanNumber, ClientId = source.ClientId,
            PoNumber = source.PoNumber, PoDate = source.PoDate, IndentNo = source.IndentNo,
            DeliveryDate = source.DeliveryDate, Site = source.Site, Notes = source.Notes,
            IsImported = source.IsImported, IsDemo = source.IsDemo, SalesOrderId = source.SalesOrderId,
            SplitFromChallanId = source.SplitFromChallanId ?? source.Id,
        };
        split.Status = UnbilledStatus(split);
        _context.DeliveryChallans.Add(split);
        await _context.SaveChangesAsync();
        await _context.DeliveryItems.Where(i => ids.Contains(i.Id))
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.DeliveryChallanId, split.Id));
        _context.Entry(split).State = EntityState.Detached;
        // Detach first, then drop from the in-memory collection: a moved line still
        // listed under `source` would be re-attached and pulled back by the next save.
        foreach (var moved in _context.ChangeTracker.Entries<DeliveryItem>().Where(e => ids.Contains(e.Entity.Id)).ToList())
            moved.State = EntityState.Detached;
        foreach (var item in source.Items.Where(i => ids.Contains(i.Id)).ToList()) source.Items.Remove(item);
        return split.Id;
    }

    /// <summary>
    /// Re-joins the unbilled rows of each touched challan into one row, preferring
    /// the original. A row that carries anything of its own (attachments, a
    /// supplier purchase made from it) is left as it is.
    /// </summary>
    private async Task MergeUnbilledSplitsAsync(IEnumerable<int> challanIds)
    {
        var touched = challanIds.Distinct().ToList();
        if (touched.Count == 0) return;
        var roots = await _context.DeliveryChallans.AsNoTracking().Where(c => touched.Contains(c.Id))
            .Select(c => c.SplitFromChallanId ?? c.Id).Distinct().ToListAsync();
        foreach (var root in roots)
            await MergeRowsAsync(root, await _context.DeliveryChallans.AsNoTracking()
                .Where(c => (c.Id == root || c.SplitFromChallanId == root) && c.InvoiceId == null
                    && c.Status != "Cancelled" && Helpers.ChallanBillingRules.Statuses.Contains(c.Status))
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
    /// row when it is among them) and deletes the emptied rows. A row that carries
    /// anything of its own — a supplier bill that is paid, credited or entered by
    /// hand, or an attachment — is left as it is.
    /// </summary>
    private async Task MergeRowsAsync(int root, List<int> rowIds)
    {
        if (rowIds.Count < 2) return;
        var keep = rowIds.Contains(root) ? root : rowIds.Min();
        var candidates = rowIds.Where(id => id != keep).ToList();
        var companyId = await _context.DeliveryChallans.Where(c => c.Id == keep).Select(c => c.CompanyId).SingleAsync();
        var lines = await _context.DeliveryItems.Where(i => candidates.Contains(i.DeliveryChallanId))
            .Select(i => new { i.Id, i.DeliveryChallanId }).ToListAsync();
        var fixedLines = (await _purchases.FixedAsync(companyId, lines.Select(l => l.Id), Array.Empty<int>())).ByDelivery.Keys;
        var openAuto = LocalPurchaseSyncService.OpenAuto(_context).Select(p => p.Id);
        var pinned = lines.Where(l => fixedLines.Contains(l.Id)).Select(l => l.DeliveryChallanId)
            .Concat(await _context.PurchaseBills.Where(p => p.SourceDeliveryChallanId != null
                && candidates.Contains(p.SourceDeliveryChallanId.Value) && !openAuto.Contains(p.Id))
                .Select(p => p.SourceDeliveryChallanId!.Value).ToListAsync())
            .Concat(await _context.Attachments.Where(a => a.EntityType == "DeliveryChallan" && a.EntityId != null
                && candidates.Contains(a.EntityId.Value)).Select(a => a.EntityId!.Value).ToListAsync())
            .ToHashSet();
        var merge = candidates.Where(c => !pinned.Contains(c)).ToList();
        if (merge.Count == 0) return;
        // Their open automatic purchases are rebooked on the kept row below.
        await _purchases.ReleaseLinesAsync(companyId, lines.Where(l => merge.Contains(l.DeliveryChallanId)).Select(l => l.Id), Array.Empty<int>());
        await _context.DeliveryItems.Where(i => merge.Contains(i.DeliveryChallanId))
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.DeliveryChallanId, keep));
        await _context.DeliveryChallans.Where(c => merge.Contains(c.Id)).ExecuteDeleteAsync();
        await _purchases.SyncChallanAsync(keep);
    }
}
