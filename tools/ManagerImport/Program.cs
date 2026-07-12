using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Services.Implementations;

// ============================================================================
// Al-Qahera Manager.io -> MyApp ETL (one-off migration) — LOCAL runner.
//
// Thin wrapper around the in-app ManagerImportService (same code the
// /api/manager-import endpoint runs). Connects directly to a DB by connection
// string — usable only where the DB is reachable (locally).
//
// Document import:
//   dotnet run --project tools/ManagerImport -- <exportDir> "<conn>" [--dry-run] [--fresh] [--company-name NAME]
// Trial-balance -> chart-of-accounts opening balances (company must exist):
//   dotnet run --project tools/ManagerImport -- <exportDir> "<conn>" --trial-balance <tb.txt> [--dry-run] [--company-name NAME]
// ============================================================================

if (args.Length < 2)
{
    Console.Error.WriteLine("usage: ManagerImport <exportDir> <connString> [--dry-run] [--fresh] [--company-name NAME] [--trial-balance <path>]");
    return 2;
}

string exportDir = args[0];
string conn = args[1];
bool dryRun = args.Contains("--dry-run");
bool fresh = args.Contains("--fresh");
string companyName = GetOpt("--company-name") ?? "Al-Qahera Trading Co.";
string? tbPath = GetOpt("--trial-balance");

string? GetOpt(string flag) { var i = Array.IndexOf(args, flag); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }

static Dictionary<string, JsonDocument> Load(string dir)
{
    var map = new Dictionary<string, JsonDocument>(StringComparer.OrdinalIgnoreCase);
    foreach (var f in Directory.EnumerateFiles(dir, "*.json"))
        map[Path.GetFileNameWithoutExtension(f)] = JsonDocument.Parse(File.ReadAllText(f));
    return map;
}

var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseSqlServer(conn)
    .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning))
    .Options;
await using var db = new AppDbContext(options);
Console.WriteLine($"   db: {db.Database.GetDbConnection().DataSource} / {db.Database.GetDbConnection().Database}");
var svc = new ManagerImportService(db);

try
{
    MyApp.Api.DTOs.ManagerImportReport r;

    if (tbPath != null)
    {
        // Trial-balance mode: load into the existing company's chart of accounts.
        var company = await db.Companies.FirstOrDefaultAsync(c => c.Name == companyName);
        if (company == null) { Console.Error.WriteLine($"Company \"{companyName}\" not found — run the document import first."); return 3; }
        Console.WriteLine($"== Trial Balance import ==  company=\"{companyName}\" (id {company.Id})  dryRun={dryRun}");
        var text = await File.ReadAllTextAsync(tbPath);
        r = await svc.ImportTrialBalanceAsync(company.Id, text, dryRun);
    }
    else
    {
        var detailDir = Path.Combine(exportDir, "detail");
        if (!Directory.Exists(detailDir)) { Console.Error.WriteLine($"detail dir not found: {detailDir}"); return 2; }
        var summary = Load(exportDir); var detail = Load(detailDir);
        Console.WriteLine($"== Document import ==  company=\"{companyName}\"  dryRun={dryRun}  fresh={fresh}  (summary {summary.Count}, detail {detail.Count})");
        r = await svc.RunAsync(summary, detail, companyName, targetCompanyId: null, dryRun, fresh, callerUserId: null);
    }

    Console.WriteLine($"\n   company id={r.CompanyId}");
    foreach (var kv in r.Created) Console.WriteLine($"   {kv.Key,-24} +{kv.Value}");
    foreach (var n in r.Notes) Console.WriteLine($"   • {n}");
    if (r.SalesTotal != 0 || r.ArManager != 0)
    {
        Console.WriteLine("\n== RECONCILIATION ==");
        Console.WriteLine($"   Sales invoiced total:          {r.SalesTotal,18:N2}");
        Console.WriteLine($"   AR outstanding Manager/MyApp:  {r.ArManager,18:N2} / {r.ArMyApp,14:N2}");
        Console.WriteLine($"   AP outstanding Manager/MyApp:  {r.ApManager,18:N2} / {r.ApMyApp,14:N2}");
    }
    Console.WriteLine(dryRun ? "\nDRY RUN — rolled back." : "\nCOMMITTED.");
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine("\nFAILED.\n" + ex);
    return 1;
}
