using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

// Read-only SQL proof of the exact predicate used before any FBR POST.
if (args.Length != 1 || !int.TryParse(args[0], out var invoiceId)) throw new ArgumentException("Supply the LOCAL test-fixture invoice ID.");
var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(
    "Server=.\\MSSQLSERVER02;Database=MyApp_Trader_Local;Trusted_Connection=True;TrustServerCertificate=True;").Options;
await using var db = new AppDbContext(options);
var snapshot = await db.Invoices.AsNoTracking().Include(i => i.Items).SingleAsync(i => i.Id == invoiceId);
var fixture = await db.Companies.AsNoTracking().SingleAsync(c => c.Id == snapshot.CompanyId);
if (!fixture.Name.StartsWith("[TEMP] Filing ")) throw new InvalidOperationException("Only this suite's synthetic fixture is allowed.");
var passed = 0;
async Task Check(bool expected, string label) {
    var actual = await FbrSubmissionClaim.Eligible(db.Invoices, snapshot).AnyAsync();
    if (actual != expected) throw new Exception(label);
    Console.WriteLine("PASS " + label); passed++;
}
await Check(true, "current filing snapshot can be claimed");
var originalJson = snapshot.TaxFilingRowsJson;
snapshot.TaxFilingRowsJson = originalJson!.Replace("\"SavedBy\":", "\"SavedByOld\":");
await Check(false, "a different filing snapshot cannot claim an older prepared payload");
snapshot.TaxFilingRowsJson = null;
await Check(false, "a payload prepared before independent filing existed cannot claim the new filing");
snapshot.TaxFilingRowsJson = originalJson;
snapshot.Items.Remove(snapshot.Items.First());
await Check(false, "a different source-line set cannot claim the payload");
Console.WriteLine($"{passed} passed, 0 failed");
