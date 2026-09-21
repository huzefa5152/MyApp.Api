using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Http;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Repositories.Implementations;

// Creates a unique, disposable LOCAL database. Never accepts a connection string.
var dbName = "MyApp_CodexAudit_" + Guid.NewGuid().ToString("N");
var connection = $@"Server=.\MSSQLSERVER02;Database={dbName};Trusted_Connection=True;TrustServerCertificate=True";
var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).Options;
await using var db = new AppDbContext(options);
var passed = 0;
var keep = false;
void Check(bool ok, string name) { if (!ok) throw new Exception(name); passed++; Console.WriteLine("PASS " + name); }
try
{
    await db.GetService<IMigrator>().MigrateAsync("20260916192004_AddCustomerPortal");
    Check((await db.Database.GetPendingMigrationsAsync()).Count()==1, "accounting baseline has one pending catalog migration");
    var legacyA = new Company { Name = "Legacy A" }; var legacyB = new Company { Name = "Legacy B" };
    db.Companies.AddRange(legacyA, legacyB); await db.SaveChangesAsync();
    await db.Database.ExecuteSqlRawAsync("INSERT ItemTypes (Name,CreatedAt,IsFavorite,UsageCount,IsHsCodePartial,IsDeleted) VALUES ('Legacy shared item',GETUTCDATE(),1,0,0,0),('Unused legacy item',GETUTCDATE(),1,0,0,0)");
    var oldItemId = await db.Database.SqlQueryRaw<int>("SELECT Id AS Value FROM ItemTypes WHERE Name='Legacy shared item'").SingleAsync();
    await db.Database.ExecuteSqlInterpolatedAsync($@"INSERT OpeningStockBalances (CompanyId,ItemTypeId,Quantity,AsOfDate,CreatedAt) VALUES ({legacyA.Id},{oldItemId},12,'2026-09-21',GETUTCDATE()),({legacyB.Id},{oldItemId},34,'2026-09-21',GETUTCDATE())");
    var legacyClient = new Client { CompanyId=legacyA.Id, Name="Legacy customer" };
    db.Clients.Add(legacyClient); await db.SaveChangesAsync();
    var legacyQuote = new SalesQuote { CompanyId=legacyA.Id, ClientId=legacyClient.Id, QuoteNumber=1, Date=DateTime.Today,
        Items = new List<SalesQuoteItem> { new() { Description="Used private description", Unit="Custom Measure", Quantity=2, UnitPrice=10, LineTotal=20 } }, Subtotal=20, GrandTotal=20 };
    db.SalesQuotes.Add(legacyQuote); await db.SaveChangesAsync();
    await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE SalesQuoteItems SET ItemTypeId={oldItemId} WHERE SalesQuoteId={legacyQuote.Id}");
    await db.Database.ExecuteSqlRawAsync("INSERT ItemDescriptions (Name,IsFavorite,UsageCount) VALUES ('Used private description',1,99),('Unused private description',1,99); INSERT Units (Name,AllowsDecimalQuantity) VALUES ('Custom Measure',1),('Unused Measure',0)");
    await db.Database.MigrateAsync();
    Check(!(await db.Database.GetPendingMigrationsAsync()).Any(), "all migrations including private catalogs apply");
    var privateItems = await db.ItemTypes.Where(x=>x.CompanyId!=null).ToListAsync();
    Check(privateItems.Count==2 && privateItems.Select(x=>x.CompanyId).Distinct().Count()==2, "shared item copied only to companies with usage");
    Check(await db.ItemTypes.CountAsync(x=>x.CompanyId==null)==2, "unowned originals retained in quarantine");
    Check(await db.OpeningStockBalances.AllAsync(x=>x.ItemType.CompanyId==x.CompanyId), "stock references remapped to company-owned copies");
    Check(await db.OpeningStockBalances.SumAsync(x=>x.Quantity)==46, "historical quantities preserved");
    await db.Database.MigrateAsync();
    Check(!(await db.Database.GetPendingMigrationsAsync()).Any(), "migration rerun is idempotent");
    Check(await db.SalesQuoteItems.AsNoTracking().AllAsync(x=>x.ItemType!.CompanyId==x.SalesQuote.CompanyId), "document item references remapped to their owner");
    Check(await db.SalesQuotes.Where(x=>x.Id==legacyQuote.Id).Select(x=>x.GrandTotal).SingleAsync()==20, "historical document amounts preserved");
    Check(await db.ItemDescriptions.CountAsync(x=>x.CompanyId==legacyA.Id && x.Name=="Used private description" && x.UsageCount==0)==1
        && !await db.ItemDescriptions.AnyAsync(x=>x.CompanyId==legacyB.Id), "description defaults copied only where document history proves usage");
    Check(await db.Units.CountAsync(x=>x.CompanyId==legacyA.Id && x.Name=="Custom Measure" && x.AllowsDecimalQuantity)==1
        && !await db.Units.AnyAsync(x=>x.CompanyId==legacyB.Id), "custom decimal unit copied only to its document owner");
    var http = new HttpContextAccessor { HttpContext = new DefaultHttpContext() };
    http.HttpContext.Items["catalogAllowedIds"] = new[] { legacyA.Id };
    http.HttpContext.Items["currentCompanyId"] = legacyA.Id;
    await using (var scoped = new AppDbContext(options, null!, http))
    {
        Check(await scoped.ItemTypes.CountAsync()==1, "HTTP catalog filter hides other company and quarantined rows");
        scoped.Units.Add(new Unit { Name="Private unit" }); await scoped.SaveChangesAsync();
        Check((await scoped.Units.SingleAsync(x=>x.Name=="Private unit")).CompanyId==legacyA.Id, "new catalog rows inherit verified owner");
        var foreign=privateItems.Single(x=>x.CompanyId==legacyB.Id);
        scoped.OpeningStockBalances.Add(new OpeningStockBalance { CompanyId=legacyA.Id, ItemTypeId=foreign.Id, Quantity=1, AsOfDate=DateTime.Today });
        var rejected=false;
        try { await scoped.SaveChangesAsync(); } catch(InvalidOperationException) { rejected=true; }
        Check(rejected, "cross-company item reference rejected on save");
    }
    legacyA.GlPostingEnabled=true; legacyB.GlPostingEnabled=true; await db.SaveChangesAsync();
    var a = new Company { Name = "Failed legacy company" };
    var b = new Company { Name = "Healthy legacy company" };
    db.Companies.AddRange(a,b); await db.SaveChangesAsync();
    var posting = new FailingPosting(db, a.Id);
    var seeder = new CoaPresetSeeder(new AccountRepository(db));
    await GlBackfill.RunAsync(db, seeder, posting, NullLogger.Instance);
    Check(!await db.Companies.Where(c=>c.Id==a.Id).Select(c=>c.GlPostingEnabled).SingleAsync(), "failed backfill remains disabled");
    Check(!await db.Accounts.AnyAsync(x=>x.CompanyId==a.Id), "failed chart creation rolls back");
    Check(!await db.AccountGroups.AnyAsync(x=>x.CompanyId==a.Id), "failed posting writes cannot escape through next company");
    Check(await db.Companies.Where(c=>c.Id==b.Id).Select(c=>c.GlPostingEnabled).SingleAsync(), "other company still succeeds");
    Check(!await db.AuditLogs.AnyAsync(x=>x.ExceptionType==GlBackfill.Marker), "failed batch has no completion marker");
    await GlBackfill.RunAsync(db, seeder, posting, NullLogger.Instance);
    Check(await db.Companies.AllAsync(c=>c.GlPostingEnabled), "retry enables failed company");
    Check(posting.Calls[a.Id]==2 && posting.Calls[b.Id]==1, "retry visits only failed company");
    Check(await db.AuditLogs.CountAsync(x=>x.ExceptionType==GlBackfill.Marker)==1, "marker written after complete success");
    await GlBackfill.RunAsync(db, seeder, posting, NullLogger.Instance);
    Check(posting.Calls[a.Id]==2 && posting.Calls[b.Id]==1, "completed startup is idempotent");

    var services = new ServiceCollection();
    services.AddLogging();
    services.AddDbContext<AppDbContext>(o=>o.UseSqlServer(connection));
    services.AddScoped<IAuditLogRepository,AuditLogRepository>();
    services.AddScoped<IAuditLogService,AuditLogService>();
    services.AddSingleton<ISensitiveDataRedactor,SensitiveDataRedactor>();
    await using var provider=services.BuildServiceProvider();
    async Task Record(int? company)
    {
        await using var scope=provider.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<IAuditLogService>().LogAsync(new AuditLog {
            Timestamp=DateTime.UtcNow,Level="Error",RequestPath="/api/same-path",Message="same error",
            HttpMethod="GET",StatusCode=500,CompanyId=company
        });
    }
    await Record(a.Id);await Record(b.Id);await Record(a.Id);
    var logs=await db.AuditLogs.AsNoTracking().Where(x=>x.RequestPath=="/api/same-path").ToListAsync();
    Check(logs.Count==2 && logs.Single(x=>x.CompanyId==a.Id).OccurrenceCount==2 && logs.Single(x=>x.CompanyId==b.Id).OccurrenceCount==1,"deduplication does not merge tenant events");
    var legacyLog = new AuditLog { Timestamp=DateTime.UtcNow, Level="Error", CompanyId=a.Id,
        RequestPath="/api/legacy", Message="historical unverified scope", Fingerprint=new string('a',40) };
    db.AuditLogs.Add(legacyLog); await db.SaveChangesAsync();
    var auditRepository = new AuditLogRepository(db);
    var auditService = new AuditLogService(auditRepository,db,NullLogger<AuditLogService>.Instance);
    var scopedLogs = await auditRepository.GetPagedAsync(1,200,companyScope:new[]{a.Id});
    Check(scopedLogs.Items.All(x=>x.Id!=legacyLog.Id) && scopedLogs.Items.Any(x=>x.RequestPath=="/api/same-path"), "tenant listing excludes historical unverified audit scope");
    Check(await auditService.GetByIdAsync(legacyLog.Id,new[]{a.Id})==null, "tenant detail excludes historical unverified audit scope");
    Check(await auditService.GetByIdAsync(legacyLog.Id)!=null, "platform administrator retains historical audit evidence");
    Check(await auditRepository.GetCountByLevelAsync("Error",24,new[]{a.Id})==1, "tenant audit summary counts only verified scope");
    var token=PublicTokenGenerator.Create();
    var evt = new Serilog.Events.LogEvent(DateTimeOffset.UtcNow, Serilog.Events.LogEventLevel.Error,
        null, new Serilog.Parsing.MessageTemplateParser().Parse("Failed {Path} {RequestPath}"),
        new[] { new Serilog.Events.LogEventProperty("Path", new Serilog.Events.ScalarValue("/portal/"+token)),
            new Serilog.Events.LogEventProperty("RequestPath", new Serilog.Events.ScalarValue("/api/public/customer-portal/"+token)) });
    new PortalTokenLogMasker().Enrich(evt, null!);
    Check(!evt.RenderMessage().Contains(token), "file logger masks both Path and RequestPath properties");
    async Task Request(bool throws, bool verified)
    {
        await using var scope=provider.CreateAsyncScope();
        var ctx=new DefaultHttpContext{RequestServices=scope.ServiceProvider};
        ctx.Request.Path="/api/public/customer-portal/"+token+ (throws?"/throw":"/status");
        ctx.Request.QueryString=new QueryString("?companyId="+a.Id);
        ctx.Request.Method="GET";ctx.Response.Body=new MemoryStream();
        if(verified)ctx.Items["currentCompanyId"]=b.Id;
        var middleware=new GlobalExceptionMiddleware(_=> {
            if(throws)throw new InvalidOperationException("audit fixture error");
            ctx.Response.StatusCode=500;return Task.CompletedTask;
        },NullLogger<GlobalExceptionMiddleware>.Instance);
        await middleware.InvokeAsync(ctx);
    }
    await Request(true,false);await Request(false,true);
    var portalLogs=await db.AuditLogs.AsNoTracking().Where(x=>x.RequestPath.Contains("customer-portal")).ToListAsync();
    Check(portalLogs.Count==2 && portalLogs.All(x=>!x.RequestPath.Contains(token)),"both audit error paths redact portal tokens");
    Check(portalLogs.Single(x=>x.RequestPath.EndsWith("/throw")).CompanyId==null,"query parameter cannot forge audit tenant ownership");
    Check(portalLogs.Single(x=>x.RequestPath.EndsWith("/status")).CompanyId==b.Id,"verified tenant wins over supplied query");
    Console.WriteLine($"{passed}/{passed} regression checks passed");
    if (args.Contains("--keep-local-fixture"))
    {
        // SecurityStamp is historically installed by Program.cs, not an EF
        // migration; let startup add it before using the Users entity model.
        var passwordHash = BCrypt.Net.BCrypt.HashPassword("admin123");
        await db.Database.ExecuteSqlInterpolatedAsync($@"UPDATE Users SET PasswordHash={passwordHash}, FailedLoginAttempts=0, LockoutUntil=NULL WHERE Username='admin'");
        await File.WriteAllTextAsync(".codex-audit/catalog-test-connection.txt", connection);
        keep = true;
    }
}
finally
{
    // This identifier is generated above; no existing or caller-supplied database can be removed.
    if (!keep) await db.Database.EnsureDeletedAsync();
}

sealed class FailingPosting(AppDbContext db,int failId):IPostingService
{
    public Dictionary<int,int> Calls {get;}=new();
    public Task EnsureDefaultAccountsAsync(int id)=>Task.CompletedTask;
    public async Task<PostingRebuildResult> RebuildAsync(int id)
    {
        Calls[id]=Calls.GetValueOrDefault(id)+1;
        db.AccountGroups.Add(new AccountGroup{CompanyId=id,Name="Posting side effect",Statement=FinancialStatement.BalanceSheet});
        await db.SaveChangesAsync();
        if(id==failId && Calls[id]==1)throw new InvalidOperationException("Injected mid-backfill failure");
        return new();
    }
    public Task PostInvoiceAsync(Invoice i)=>throw new NotSupportedException();
    public Task PostPurchaseBillAsync(PurchaseBill b)=>throw new NotSupportedException();
    public Task PostPaymentAsync(Payment p)=>throw new NotSupportedException();
    public Task RemoveForSourceAsync(int c,SourceDocType t,int d)=>throw new NotSupportedException();
}

