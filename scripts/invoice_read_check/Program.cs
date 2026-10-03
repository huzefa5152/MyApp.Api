// SELECT-only replay of invoice reads from the production audit. Never saves.
// Build the app first, then: dotnet run --project scripts/invoice_read_check -c Release
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Repositories.Implementations;

var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
using var config = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "production.databases.json")));
var connection = config.RootElement.GetProperty("environments")
    .GetProperty("feat/importer-ledger-receipts").GetProperty("connectionString").GetString()!;
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseSqlServer(connection + ";ApplicationIntent=ReadOnly", sql => sql.CommandTimeout(30)).Options;
await using var db = new AppDbContext(options);
var paths = await db.AuditLogs.Where(a => a.StatusCode >= 500)
    .Select(a => a.RequestPath).Distinct().ToListAsync();
var auditedIds = paths.Select(p => Regex.Match(p, @"^/api/(?:invoices|fbr)/(\d+)(?:/|$)"))
    .Where(m => m.Success).Select(m => int.Parse(m.Groups[1].Value)).Distinct().ToList();
var samples = await db.Invoices.OrderByDescending(i => i.Id).Select(i => i.Id).Take(20).ToListAsync();
var delivered = await db.Invoices.Where(i => i.DeliveryChallans.Any())
    .OrderByDescending(i => i.Id).Select(i => i.Id).Take(3).ToListAsync();
// Deleted documents in old audit entries cannot be replayed.
var ids = await db.Invoices.Where(i => auditedIds.Concat(samples).Concat(delivered).Contains(i.Id))
    .OrderBy(i => i.Id).Select(i => i.Id).ToListAsync();
var failures = 0;
foreach (var id in ids)
{
    db.ChangeTracker.Clear();
    var watch = Stopwatch.StartNew();
    try
    {
        var invoice = await new InvoiceRepository(db).GetByIdAsync(id);
        var elapsed = watch.Elapsed.TotalMilliseconds;
        if (invoice == null) { failures++; Console.WriteLine($"FAIL invoice {id}: missing"); continue; }
        var lines = await db.InvoiceItems.CountAsync(i => i.InvoiceId == id);
        var challans = await db.DeliveryChallans.CountAsync(c => c.InvoiceId == id);
        var deliveries = await db.DeliveryItems.CountAsync(d => d.DeliveryChallan.InvoiceId == id);
        var adjustments = await db.InvoiceItemAdjustments.CountAsync(a => a.InvoiceItem.InvoiceId == id);
        var valid = invoice.Items.Count == lines && invoice.DeliveryChallans.Count == challans
            && invoice.DeliveryChallans.Sum(c => c.Items.Count) == deliveries
            && invoice.Items.Count(i => i.Adjustment != null) == adjustments
            && invoice.Company != null && invoice.Client != null
            && invoice.Items.All(i => !i.ItemTypeId.HasValue || i.ItemType != null)
            && invoice.Items.All(i => !i.DeliveryItemId.HasValue || i.DeliveryItem != null)
            && invoice.Items.All(i => !i.NonInventoryItemId.HasValue || i.NonInventoryItem != null)
            && db.Entry(invoice).State == EntityState.Unchanged;
        if (!valid) failures++;
        Console.WriteLine($"{(valid ? "PASS" : "FAIL")} invoice {id}: {elapsed:F0} ms; lines {lines}; challans {challans}; delivery lines {deliveries}; graph and tracking verified");
    }
    catch (Exception ex)
    {
        failures++;
        Console.WriteLine($"FAIL invoice {id}: {watch.Elapsed.TotalSeconds:F1}s; {ex.GetType().Name}");
    }
}
Console.WriteLine($"{ids.Count - failures}/{ids.Count} invoice reads passed; no writes performed");
var companies = await db.Invoices.Where(i => ids.Contains(i.Id))
    .Select(i => i.CompanyId).Distinct().ToListAsync();
foreach (var company in companies)
{
    db.ChangeTracker.Clear();
    var expected = db.Invoices.Where(i => i.CompanyId == company && !i.IsDemo
        && i.DocumentType != 9 && i.DocumentType != 10);
    var expectedCount = await expected.CountAsync();
    var expectedIds = await expected.OrderByDescending(i => i.CreatedAt).ThenByDescending(i => i.Id)
        .Skip(3).Take(3).Select(i => i.Id).ToListAsync();
    var page = await new InvoiceRepository(db).GetPagedByCompanyAsync(company, 2, 3);
    var valid = page.TotalCount == expectedCount && page.Items.Select(i => i.Id).SequenceEqual(expectedIds)
        && page.Items.All(i => i.CompanyId == company && i.Client != null);
    foreach (var invoice in page.Items)
    {
        valid &= invoice.Items.Count == await db.InvoiceItems.CountAsync(i => i.InvoiceId == invoice.Id);
        valid &= invoice.DeliveryChallans.Count == await db.DeliveryChallans.CountAsync(c => c.InvoiceId == invoice.Id);
    }
    if (!valid) failures++;
    Console.WriteLine($"{(valid ? "PASS" : "FAIL")} company {company}: page 2, count, ordering, company scope and collections verified");
}
Console.WriteLine($"Total failures: {failures}; no writes performed");
return failures == 0 ? 0 : 1;
