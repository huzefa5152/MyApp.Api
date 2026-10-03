// Read-only regression: printed data must match the full invoice graph.
// Build the app, then run with --env <branch> to read its configured database.
using System.Diagnostics;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Controllers;
using MyApp.Api.Data;
using MyApp.Api.Middleware;
using MyApp.Api.Repositories.Implementations;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
var envIndex = Array.IndexOf(args, "--env");
if (envIndex < 0 || envIndex + 1 >= args.Length) throw new ArgumentException("Specify --env <branch>.");
using var config = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "production.databases.json")));
var cs = config.RootElement.GetProperty("environments").GetProperty(args[envIndex + 1])
    .GetProperty("connectionString").GetString()! + ";ApplicationIntent=ReadOnly";
await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
    .UseSqlServer(cs, sql => sql.CommandTimeout(30)).Options);
var repo = new InvoiceRepository(db);
InvoiceService Service(IInvoiceRepository repository) => new(repository, null!, null!, null!, null!,
    db, new ConfigurationBuilder().Build(), null!, null!, null!, null!, NullLogger<InvoiceService>.Instance);
var service = Service(repo);
int checks = 0;
void Check(bool ok, string name)
{
    if (!ok) throw new InvalidOperationException(name);
    checks++;
    Console.WriteLine($"PASS {name}");
}
var requestedIndex = Array.IndexOf(args, "--invoice");
var ids = requestedIndex >= 0
    ? new[] { int.Parse(args[requestedIndex + 1]) }
    : (await db.Invoices.AsNoTracking().OrderByDescending(i => i.Id).Select(i => i.Id).Take(12).ToListAsync()).ToArray();
foreach (var id in ids)
{
    var timer = Stopwatch.StartNew();
    var actualBill = await service.GetPrintBillAsync(id);
    var actualTax = await service.GetPrintTaxInvoiceAsync(id);
    var elapsed = timer.Elapsed.TotalSeconds;
    Check(actualBill != null && actualTax != null, $"invoice {id}: both print documents load ({elapsed:F2}s)");
    // Independently load the original detail graph without its collection cross product.
    var full = await db.Invoices.AsNoTracking().AsSplitQuery()
        .Include(i => i.Company).Include(i => i.Client)
        .Include(i => i.Items).ThenInclude(i => i.DeliveryItem)
        .Include(i => i.Items).ThenInclude(i => i.ItemType)
        .Include(i => i.Items).ThenInclude(i => i.NonInventoryItem)
        .Include(i => i.Items).ThenInclude(i => i.Adjustment)
        .Include(i => i.DeliveryChallans).ThenInclude(c => c.Items)
        .Include(i => i.OriginalInvoice).Include(i => i.Division)
        .SingleAsync(i => i.Id == id);
    var baselineRepo = DispatchProxy.Create<IInvoiceRepository, ReadProxy>();
    ((ReadProxy)(object)baselineRepo).Handler = (_, _) => Task.FromResult<MyApp.Api.Models.Invoice?>(full);
    var baseline = Service(baselineRepo);
    Check(JsonSerializer.Serialize(actualBill) == JsonSerializer.Serialize(await baseline.GetPrintBillAsync(id)),
        $"invoice {id}: bill fields, lines and totals unchanged");
    Check(JsonSerializer.Serialize(actualTax) == JsonSerializer.Serialize(await baseline.GetPrintTaxInvoiceAsync(id)),
        $"invoice {id}: tax fields, overlays, notes and totals unchanged");
}
var target = ids.First();
var company = DispatchProxy.Create<ICompanyAccessGuard, ReadProxy>();
var division = DispatchProxy.Create<IDivisionAccessGuard, ReadProxy>();
var companyProxy = (ReadProxy)(object)company;
var divisionProxy = (ReadProxy)(object)division;
var controller = new InvoicesController(service, company, division, null!, db, new ConfigurationBuilder().Build());
controller.ControllerContext = new ControllerContext
{
    HttpContext = new DefaultHttpContext
    {
        User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, "1") }))
    }
};
foreach (var tax in new[] { false, true })
{
    var method = typeof(InvoicesController).GetMethod(tax ? "GetPrintTaxInvoice" : "GetPrintBill")!;
    var permission = method.GetCustomAttribute<HasPermissionAttribute>();
    Check(permission?.Arguments?.Single()?.ToString() == (tax ? "invoices.print.view" : "bills.print.view"),
        $"{(tax ? "tax" : "bill")}: print permission remains required");
    async Task Invoke() { if (tax) await controller.GetPrintTaxInvoice(target); else await controller.GetPrintBill(target); }
    foreach (var denyCompany in new[] { true, false })
    {
        companyProxy.Handler = (_, _) => denyCompany ? throw new UnauthorizedAccessException() : Task.CompletedTask;
        divisionProxy.Handler = (_, _) => throw new UnauthorizedAccessException();
        try { await Invoke(); Check(false, "denied access reached print service"); }
        catch (UnauthorizedAccessException) { Check(true, $"{(tax ? "tax" : "bill")}: {(denyCompany ? "company" : "division")} denial enforced"); }
    }
    companyProxy.Handler = (_, _) => Task.CompletedTask;
    divisionProxy.Handler = (_, _) => Task.CompletedTask;
    if (tax) Check((await controller.GetPrintTaxInvoice(target)).Result is OkObjectResult, "authorized tax print succeeds");
    else Check((await controller.GetPrintBill(target)).Result is OkObjectResult, "authorized bill print succeeds");
}
Check((await controller.GetPrintBill(int.MaxValue)).Result is NotFoundResult, "unknown bill returns 404");
Check((await controller.GetPrintTaxInvoice(int.MaxValue)).Result is NotFoundResult, "unknown tax invoice returns 404");
Check(!db.ChangeTracker.HasChanges(), "read check leaves no pending data changes");
Console.WriteLine($"{checks}/{checks} checks passed; SELECT only, no SaveChanges.");

public class ReadProxy : DispatchProxy
{
    public Func<MethodInfo?, object?[]?, object?> Handler { get; set; } = (_, _) => throw new NotSupportedException();
    protected override object? Invoke(MethodInfo? method, object?[]? args) => Handler(method, args);
}
