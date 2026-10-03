// Port of the importer SELECT-only read check, adapted to Trader's graph/order.
// Build the app first. Set MYAPP_PRODUCTION_CONFIG to the gitignored config
// path, then run: dotnet run --project scripts/invoice_read_check -c Release
using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Implementations;

var configPath = Environment.GetEnvironmentVariable("MYAPP_PRODUCTION_CONFIG")
    ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../production.databases.json"));
using var config = JsonDocument.Parse(File.ReadAllText(configPath));
var connection = config.RootElement.GetProperty("environments")
    .GetProperty("TraderFbrInvoicingSystem").GetProperty("connectionString").GetString()!;
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseSqlServer(connection + ";ApplicationIntent=ReadOnly", sql => sql.CommandTimeout(30)).Options;
await using var db = new AppDbContext(options);
var failures = 0;
var checks = 0;
void Check(string label, bool valid)
{
    checks++;
    if (!valid) failures++;
    Console.WriteLine($"{(valid ? "PASS" : "FAIL")} {label}");
}
async Task<bool> GraphMatches(Invoice invoice, bool detail)
{
    var valid = invoice.Items.Count == await db.InvoiceItems.CountAsync(i => i.InvoiceId == invoice.Id)
        && invoice.DeliveryChallans.Count == await db.DeliveryChallans.CountAsync(c => c.InvoiceId == invoice.Id)
        && invoice.Client != null
        && invoice.Items.Count(i => i.Adjustment != null)
            == await db.InvoiceItemAdjustments.CountAsync(a => a.InvoiceItem.InvoiceId == invoice.Id)
        && (!invoice.OriginalInvoiceId.HasValue || invoice.OriginalInvoice != null)
        && (!invoice.SupplementsInvoiceId.HasValue || invoice.SupplementsInvoice != null)
        && (!invoice.HandoverByUserId.HasValue || invoice.HandoverBy != null);
    if (detail)
        valid &= invoice.Company != null && db.Entry(invoice).State == EntityState.Unchanged
            && invoice.DeliveryChallans.Sum(c => c.Items.Count)
                == await db.DeliveryItems.CountAsync(d => d.DeliveryChallan.InvoiceId == invoice.Id)
            && invoice.Items.All(i => !i.ItemTypeId.HasValue || i.ItemType != null)
            && invoice.Items.All(i => !i.DeliveryItemId.HasValue || i.DeliveryItem != null);
    return valid;
}
var companies = await db.Invoices.Select(i => i.CompanyId).Distinct().OrderBy(i => i).ToListAsync();
Check("production has invoices to verify", companies.Count > 0);
foreach (var company in companies)
{
    db.ChangeTracker.Clear();
    var expected = db.Invoices.Where(i => i.CompanyId == company && !i.IsDemo
        && i.DocumentType != 9 && i.DocumentType != 10);
    var total = await expected.CountAsync();
    foreach (var pageNumber in new[] { 1, 2 })
    {
        var expectedIds = await expected.OrderByDescending(i => i.InvoiceNumber).ThenByDescending(i => i.Id)
            .Skip((pageNumber - 1) * 3).Take(3).Select(i => i.Id).ToListAsync();
        var watch = Stopwatch.StartNew();
        var page = await new InvoiceRepository(db).GetPagedByCompanyAsync(company, pageNumber, 3);
        var elapsed = watch.ElapsedMilliseconds;
        var valid = page.TotalCount == total && page.Items.Select(i => i.Id).SequenceEqual(expectedIds)
            && page.Items.All(i => i.CompanyId == company);
        foreach (var invoice in page.Items) valid &= await GraphMatches(invoice, false);
        Check($"company {company} page {pageNumber}: count, order and graph ({elapsed} ms)", valid);
    }
}
var ids = await db.Invoices.OrderByDescending(i => i.Id).Select(i => i.Id).Take(10).ToListAsync();
foreach (var id in ids)
{
    db.ChangeTracker.Clear();
    var watch = Stopwatch.StartNew();
    var invoice = await new InvoiceRepository(db).GetByIdAsync(id);
    var elapsed = watch.ElapsedMilliseconds;
    Check($"invoice {id}: detail graph and tracking ({elapsed} ms)", invoice != null && await GraphMatches(invoice, true));
}
Console.WriteLine($"{checks - failures}/{checks} checks passed; no writes performed");
return failures == 0 ? 0 : 1;
