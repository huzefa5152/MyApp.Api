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
bool perpetual = args.Contains("--build-perpetual");
string? refDir = GetOpt("--ref");
// GL-only rebuild target: with --build-perpetual, pass --company-id N to
// (re)build the CoA + GL + true-up on an EXISTING company WITHOUT re-importing
// its documents. Wipes/rebuilds only CoA + journal entries; documents untouched.
int? existingCompanyId = int.TryParse(GetOpt("--company-id"), out var _cid) ? _cid : (int?)null;
// Where document-attachment blobs get written (the app's data/attachments dir).
// Defaults to <repo>/data/attachments so a locally-run import lands where the
// dev backend serves them. Attachment blobs themselves live in <exportDir>/attachments/.
string attachmentsRoot = GetOpt("--attachments-root")
    ?? Path.Combine(Directory.GetCurrentDirectory(), "data", "attachments");

string? GetOpt(string flag) { var i = Array.IndexOf(args, flag); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }

static Dictionary<string, JsonDocument> Load(string dir)
{
    var map = new Dictionary<string, JsonDocument>(StringComparer.OrdinalIgnoreCase);
    foreach (var f in Directory.EnumerateFiles(dir, "*.json"))
        map[Path.GetFileNameWithoutExtension(f)] = JsonDocument.Parse(File.ReadAllText(f));
    return map;
}

// Attachment blobs: <exportDir>/attachments/* → { filename : bytes }, matching
// the manifest's "file" refs. Null when the folder is absent (no attachments).
static Dictionary<string, byte[]>? LoadAttachmentBytes(string exportDir)
{
    var dir = Path.Combine(exportDir, "attachments");
    if (!Directory.Exists(dir)) return null;
    var map = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
    foreach (var f in Directory.EnumerateFiles(dir)) map[Path.GetFileName(f)] = File.ReadAllBytes(f);
    return map.Count > 0 ? map : null;
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

    if (perpetual)
    {
        // Perpetual GL: rebuild CoA (GUID-keyed) + post every doc as a JE on a
        // bare company (created if missing). Needs the export (summary+detail),
        // the ref dir (chart-of-accounts, starting balances, resolved tax/non-inv)
        // and the trial balance (for account types).
        var detailDir = Path.Combine(exportDir, "detail");
        if (!Directory.Exists(detailDir)) { Console.Error.WriteLine($"detail dir not found: {detailDir}"); return 2; }
        if (refDir == null || !Directory.Exists(refDir)) { Console.Error.WriteLine("--ref <perpetual dir> is required and must exist."); return 2; }
        if (tbPath == null) { Console.Error.WriteLine("--trial-balance <path> is required for --build-perpetual."); return 2; }
        var summary = Load(exportDir); var detail = Load(detailDir); var refd = Load(refDir);
        var tbText = await File.ReadAllTextAsync(tbPath);
        int targetCompanyId;
        if (existingCompanyId is int existId)
        {
            // GL-ONLY rebuild on an existing company: DO NOT re-import documents.
            // BuildPerpetualGlAsync wipes/rebuilds only the CoA + journal entries
            // and trues-up openings to the trial balance — documents are untouched.
            var existing = await db.Companies.FirstOrDefaultAsync(c => c.Id == existId)
                ?? throw new InvalidOperationException($"Company id={existId} not found.");
            Console.WriteLine($"== Perpetual GL (GL-ONLY, existing company) ==  id={existId} \"{existing.Name}\"  dryRun={dryRun}");
            targetCompanyId = existId;
        }
        else
        {
            // 1) Load the documents (invoices/bills/receipts/payments/notes/quotes/…)
            //    so every document screen is populated — always committed (the GL
            //    build below needs the company + docs to exist).
            var attBytes = LoadAttachmentBytes(exportDir);
            if (attBytes != null) Console.WriteLine($"   attachments: {attBytes.Count} blob(s) found → {attachmentsRoot}");
            Console.WriteLine($"== Perpetual GL — step 1: documents ==  company=\"{companyName}\"  (summary {summary.Count}, detail {detail.Count})");
            var docs = await svc.RunAsync(summary, detail, companyName, targetCompanyId: null, dryRun: false, fresh: true, callerUserId: null, attBytes, attachmentsRoot);
            Console.WriteLine($"   documents loaded into company id={docs.CompanyId}");
            targetCompanyId = docs.CompanyId;
        }
        // Build the perpetual GL (CoA + journal entries + transfers + cutover).
        Console.WriteLine($"== Perpetual GL — chart of accounts + journal entries ==  dryRun={dryRun}  (ref {refd.Count})");
        r = await svc.BuildPerpetualGlAsync(targetCompanyId, tbText, summary, detail, refd, dryRun);
    }
    else if (tbPath != null)
    {
        // Trial-balance mode: load into the existing company's chart of accounts.
        var company = await db.Companies.FirstOrDefaultAsync(c => c.Name == companyName);
        if (company == null) { Console.Error.WriteLine($"Company \"{companyName}\" not found — run the document import first."); return 3; }
        Console.WriteLine($"== Trial Balance import ==  company=\"{companyName}\" (id {company.Id})  dryRun={dryRun}");
        var text = await File.ReadAllTextAsync(tbPath);
        // Load the summary lists (if the export dir is present) so the TB import
        // can split Manager's rolled-up cash line into the real bank/cash accounts.
        var summary = Directory.Exists(exportDir) ? Load(exportDir) : new Dictionary<string, JsonDocument>();
        r = await svc.ImportTrialBalanceAsync(company.Id, text, dryRun, summary);
    }
    else
    {
        var detailDir = Path.Combine(exportDir, "detail");
        if (!Directory.Exists(detailDir)) { Console.Error.WriteLine($"detail dir not found: {detailDir}"); return 2; }
        var summary = Load(exportDir); var detail = Load(detailDir);
        var attBytes = LoadAttachmentBytes(exportDir);
        if (attBytes != null) Console.WriteLine($"   attachments: {attBytes.Count} blob(s) found → {attachmentsRoot}");
        Console.WriteLine($"== Document import ==  company=\"{companyName}\"  dryRun={dryRun}  fresh={fresh}  (summary {summary.Count}, detail {detail.Count})");
        r = await svc.RunAsync(summary, detail, companyName, targetCompanyId: null, dryRun, fresh, callerUserId: null, attBytes, attachmentsRoot);
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
