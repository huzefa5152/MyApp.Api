using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Controllers;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Helpers;
using MyApp.Api.Repositories.Implementations;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Tax;
using Xunit;

public class FilingClassificationTests
{
    private const string Code = "9403.6000";
    private const string SaleType = "Goods at standard rate (default)";
    public class Stub : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Call(method!, args);
    }
    private static T Fake<T>(Func<MethodInfo, object?[]?, object?> call) where T : class
    {
        var proxy = DispatchProxy.Create<T, Stub>();
        ((Stub)(object)proxy).Call = call;
        return proxy;
    }
    private sealed class Fixture : IDisposable
    {
        public AppDbContext Db = new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        public ItemTypeDto? Created;
        public bool Known = true;
        public List<FbrUOMDto> Units = new() { new() { UOM_ID = 13, Description = "Numbers" } };
        public TaxFilingRowDto Row = new() { HSCode = Code, Description = "Office furniture", UOM = "Numbers", FbrUOMId = 13, SaleType = "Forged sale type" };
        public async Task<ItemType> Resolve()
        {
            var items = Fake<IItemTypeService>((m, args) => {
                Assert.Equal("CreateAsync", m.Name);
                Created = (ItemTypeDto)args![0]!;
                Assert.Equal(7, args[1]);
                Created.Id = 100;
                return Task.FromResult(Created);
            });
            var fbr = Fake<IFbrService>((m, args) => {
                Assert.Equal("GetHSCodesAsync", m.Name);
                Assert.Equal(7, args![0]);
                return Task.FromResult(Known ? new List<FbrHSCodeDto> { new() { HS_CODE = Code, Description = "Official furniture" } } : new());
            });
            var tax = Fake<ITaxMappingEngine>((m, args) => {
                Assert.Equal("GetHsCodeHintsAsync", m.Name);
                Assert.Equal(7, args![0]);
                return Task.FromResult(new HsCodeHints(Units, Units.FirstOrDefault(), new(), 18, SaleType, new()));
            });
            var service = new InvoiceService(null!, null!, null!, null!, Db, new ConfigurationBuilder().Build(),
                null!, null!, tax, null!, NullLogger<InvoiceService>.Instance, items, fbr);
            var method = typeof(InvoiceService).GetMethod("ResolveNewFilingClassificationAsync", BindingFlags.Instance | BindingFlags.NonPublic)!;
            return await (Task<ItemType>)method.Invoke(service, new object[] { Row, 7 })!;
        }
        public void Dispose() => Db.Dispose();
    }
    [Fact]
    public async Task ReusesOnlyTheDocumentsCompanyItem()
    {
        using var f = new Fixture();
        f.Db.ItemTypes.AddRange(new ItemType { Id = 1, CompanyId = 8, Name = "Foreign", HSCode = Code },
            new ItemType { Id = 2, CompanyId = 7, Name = "Own", HSCode = Code });
        await f.Db.SaveChangesAsync();
        Assert.Equal(2, (await f.Resolve()).Id);
        Assert.Equal(2, f.Row.ItemTypeId);
        Assert.Null(f.Created);
    }
    [Fact]
    public async Task ForeignAndLegacyCodesDoNotPreventNewCompanyClassification()
    {
        using var f = new Fixture();
        f.Db.ItemTypes.AddRange(new ItemType { CompanyId = 8, Name = "Foreign", HSCode = Code },
            new ItemType { CompanyId = null, Name = "Legacy", HSCode = Code });
        await f.Db.SaveChangesAsync();
        var type = await f.Resolve();
        Assert.Equal(7, type.CompanyId);
        Assert.Equal(SaleType, type.SaleType);
        Assert.Equal("Official furniture", f.Created!.FbrDescription);
        Assert.Equal(100, f.Row.ItemTypeId);
    }
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task RequiresANewName(string name)
    {
        using var f = new Fixture(); f.Row.Description = name;
        await Assert.ThrowsAsync<InvalidOperationException>(() => f.Resolve());
        Assert.Null(f.Created);
    }
    [Fact]
    public async Task RejectsAnUnverifiedCodeBeforeCreatingAnItem()
    {
        using var f = new Fixture(); f.Known = false;
        await Assert.ThrowsAsync<InvalidOperationException>(() => f.Resolve());
        Assert.Null(f.Created);
    }
    [Theory]
    [InlineData(99, "Numbers")]
    [InlineData(13, "Forged unit")]
    public async Task RejectsForgedFbrUnits(int id, string name)
    {
        using var f = new Fixture(); f.Row.FbrUOMId = id; f.Row.UOM = name;
        await Assert.ThrowsAsync<InvalidOperationException>(() => f.Resolve());
        Assert.Null(f.Created);
    }
    [Fact]
    public async Task CreatesTheNewItemWithTheConsultantsSelectedSaleType()
    {
        using var f = new Fixture(); f.Row.SelectedSaleType = "Exempt goods";
        var created = await f.Resolve();
        Assert.Equal(TaxScenarios.All.First(s => s.SaleType.Equals("Exempt goods", StringComparison.OrdinalIgnoreCase)).SaleType, created.SaleType);
    }
    [Fact]
    public async Task RefusesAnUnknownSelectedSaleType()
    {
        using var f = new Fixture(); f.Row.SelectedSaleType = "Invented tax treatment";
        await Assert.ThrowsAsync<InvalidOperationException>(() => f.Resolve());
        Assert.Null(f.Created);
    }
    [Fact]
    public void FbrSearchAllowsTheFormAudienceAndKeepsCompanyAuthorization()
    {
        var method = typeof(FbrController).GetMethod("GetHSCodes")!;
        Assert.NotNull(method.GetCustomAttribute<AuthorizeCompanyAttribute>());
        var keys = (string[])method.GetCustomAttribute<HasAnyPermissionAttribute>()!.Arguments![0];
        Assert.Contains("itemtypes.manage.create", keys);
        Assert.Contains("invoices.manage.update.itemtype", keys);
        Assert.Contains("invoices.manage.update.itemtype.qty", keys);
        Assert.DoesNotContain("bills.list.view", keys);
    }

    [Fact]
    public async Task CatalogExclusionIsCompanySpecificAndRunsBeforeTheBrowseLimit()
    {
        using var f = new Fixture();
        var catalog = Enumerable.Range(1, 102).Select(i => new FbrHSCodeDto {
            HS_CODE = $"9403.{i:0000}", Description = "Official reference"
        }).ToList();
        f.Db.ItemTypes.AddRange(catalog.Take(100).Select(h => new ItemType {
            CompanyId = 7, Name = h.HS_CODE, HSCode = h.HS_CODE
        }));
        f.Db.ItemTypes.Add(new ItemType { CompanyId = 8, Name = "Other company's item", HSCode = catalog[100].HS_CODE });
        await f.Db.SaveChangesAsync();
        var cache = typeof(FbrService).GetField("_hsCodeCatalog", BindingFlags.Static | BindingFlags.NonPublic)!;
        var previous = cache.GetValue(null);
        try
        {
            cache.SetValue(null, catalog);
            var service = new FbrService(null!, null!, null!, null!, f.Db, null!, null!, null!,
                NullLogger<FbrService>.Instance, null!, null!, new ConfigurationBuilder().Build());
            var available = await service.GetHSCodesAsync(7, excludeSaved: true);
            Assert.Equal(catalog.Skip(100).Select(h => h.HS_CODE), available.Select(h => h.HS_CODE));
            Assert.Equal(100, (await service.GetHSCodesAsync(7)).Count);
            Assert.Contains(await service.GetHSCodesAsync(7, excludeSaved: true, includeHsCode: catalog[0].HS_CODE),
                h => h.HS_CODE == catalog[0].HS_CODE);
        }
        finally { cache.SetValue(null, previous); }
    }

    [Theory]
    [InlineData("itemtypes.manage.create", 7, true)]
    [InlineData("invoices.manage.update.itemtype", 7, true)]
    [InlineData("invoices.manage.update.itemtype.qty", 7, true)]
    [InlineData("invoices.manage.update.itemtype", 8, false)]
    [InlineData("bills.list.view", 7, false)]
    public async Task RealSearchFiltersRequireBothFormPermissionAndCompanyAccess(string permission, int companyId, bool allowed)
    {
        var permissions = Fake<IPermissionService>((_, args) => Task.FromResult((string)args![1]! == permission));
        var access = Fake<ICompanyAccessGuard>((_, args) => Task.FromResult((int)args![1]! == 7));
        using var services = new ServiceCollection().AddSingleton(permissions).AddSingleton(access).BuildServiceProvider();
        var http = new DefaultHttpContext {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, "42") }, "test"))
        };
        var routes = new RouteData(); routes.Values["companyId"] = companyId;
        var context = new AuthorizationFilterContext(new ActionContext(http, routes, new ActionDescriptor()), new List<IFilterMetadata>());
        var method = typeof(FbrController).GetMethod("GetHSCodes")!;
        foreach (var attribute in method.GetCustomAttributes<TypeFilterAttribute>())
        {
            await ((IAsyncAuthorizationFilter)attribute.CreateInstance(services)).OnAuthorizationAsync(context);
            if (context.Result != null) break;
        }
        Assert.Equal(allowed, context.Result == null);
        if (!allowed) Assert.Equal(403, Assert.IsType<ObjectResult>(context.Result).StatusCode);
    }

    [Fact, Trait("Category", "LocalFilingSql")]
    public async Task NewClassificationAndFilingCommitTogetherAndRollBackTogether()
    {
        var connection = Environment.GetEnvironmentVariable("FILING_TEST_CONNECTION")
            ?? throw new InvalidOperationException("Set FILING_TEST_CONNECTION to an isolated local Trader test database.");
        DevelopmentSqlGuard.AssertLocal(connection, Environment.MachineName, false);
        Assert.StartsWith("MyApp_Trader_Test_", new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection).InitialCatalog);
        var http = new HttpContextAccessor { HttpContext = new DefaultHttpContext() };
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).Options, null!, http);
        var company = new Company { Name = "[TEMP] Atomic HS classification" };
        var client = new Client { Name = "[TEMP] Filing buyer", Company = company };
        db.AddRange(company, client); await db.SaveChangesAsync();
        http.HttpContext.Items["currentCompanyId"] = company.Id;
        var invoice = new Invoice { CompanyId = company.Id, Company = company, ClientId = client.Id, Client = client,
            InvoiceNumber = 1, Date = DateTime.UtcNow.Date, Subtotal = 100, GSTRate = 18, GSTAmount = 18, GrandTotal = 118,
            Items = new List<InvoiceItem> {
                new() { Description = "First commercial line", UOM = "Numbers", Quantity = 1, UnitPrice = 50, LineTotal = 50 },
                new() { Description = "Second commercial line", UOM = "Numbers", Quantity = 1, UnitPrice = 50, LineTotal = 50 }
            } };
        db.Add(invoice); await db.SaveChangesAsync();
        var ids = invoice.Items.Select(i => i.Id).ToArray();
        var audit = Fake<IAuditLogService>((_, _) => Task.CompletedTask);
        var fbr = Fake<IFbrService>((m, _) => m.Name switch {
            "IsKnownHsCodeAsync" => Task.FromResult(true),
            "GetHSCodesAsync" => Task.FromResult(new List<FbrHSCodeDto> { new() { HS_CODE = Code, Description = "Official furniture" } }),
            _ => throw new NotSupportedException(m.Name)
        });
        var tax = Fake<ITaxMappingEngine>((_, _) => Task.FromResult(new HsCodeHints(
            new() { new() { UOM_ID = 13, Description = "Numbers" }, new() { UOM_ID = 14, Description = "Feet" } }, null, new(), 18, SaleType, new())));
        var itemService = new ItemTypeService(new ItemTypeRepository(db), db, tax, null!, fbr);
        var service = new InvoiceService(new InvoiceRepository(db), null!, null!, null!, db,
            new ConfigurationBuilder().Build(), audit, null!, tax, null!, NullLogger<InvoiceService>.Instance, itemService, fbr);
        TaxFilingRowDto Row(int[] sources, decimal value, string code = Code) => new() {
            SourceLineIds = sources.ToList(), Description = "New company furniture", HSCode = code,
            UOM = "Numbers", FbrUOMId = 13, Quantity = sources.Length, ValueExclTax = value
        };
        try
        {
            var editor = (await service.GetTaxFilingAsync(invoice.Id))!;
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveTaxFilingAsync(invoice.Id,
                new() { Version = editor.Version, Rows = new() { Row(new[] { ids[0] }, 50), Row(new[] { ids[1] }, 50, "9999.9999") } }, 1, "Local test", true));
            db.ChangeTracker.Clear();
            Assert.False(await db.ItemTypes.AnyAsync(i => i.CompanyId == company.Id));
            Assert.False(await db.Units.AnyAsync(u => u.CompanyId == company.Id));
            Assert.Null(await db.Invoices.Where(i => i.Id == invoice.Id).Select(i => i.TaxFilingRowsJson).SingleAsync());
            editor = (await service.GetTaxFilingAsync(invoice.Id))!;
            var saved = (await service.SaveTaxFilingAsync(invoice.Id,
                new() { Version = editor.Version, Rows = new() { Row(ids, 100) } }, 1, "Local test", true))!;
            var created = await db.ItemTypes.SingleAsync(i => i.CompanyId == company.Id);
            Assert.Equal(created.Id, Assert.Single(saved.Rows).ItemTypeId);
            Assert.Equal(Code, created.HSCode); Assert.Equal(SaleType, created.SaleType);
            Assert.Equal(company.Id, created.CompanyId);
            Assert.Equal(2, saved.Bill.Items.Count);
            Assert.All(saved.Bill.Items, i => { Assert.Equal(1, i.Quantity); Assert.Equal(50, i.LineTotal); Assert.Null(i.ItemTypeId); });
            Assert.False(await db.StockMovements.AnyAsync(i => i.CompanyId == company.Id));
            Assert.False(await db.JournalEntries.AnyAsync(i => i.CompanyId == company.Id));
            editor = (await service.GetTaxFilingAsync(invoice.Id))!;
            await service.SaveTaxFilingAsync(invoice.Id, new() { Version = editor.Version, Rows = new() { Row(ids, 100) } }, 1, "Local test", true);
            Assert.Equal(1, await db.ItemTypes.CountAsync(i => i.CompanyId == company.Id));
            editor = (await service.GetTaxFilingAsync(invoice.Id))!;
            var alternate = Row(ids, 100); alternate.ItemTypeId = created.Id; alternate.SelectedFbrUOMId = 14;
            var alternateSaved = (await service.SaveTaxFilingAsync(invoice.Id,
                new() { Version = editor.Version, Rows = new() { alternate } }, 1, "Local test", true))!;
            Assert.Equal("Feet", Assert.Single(alternateSaved.Rows).UOM);
            Assert.Equal(14, Assert.Single(alternateSaved.Rows).FbrUOMId);
            Assert.Equal("Numbers", (await db.ItemTypes.AsNoTracking().SingleAsync(i => i.Id == created.Id)).UOM);
            editor = (await service.GetTaxFilingAsync(invoice.Id))!;
            var resaved = (await service.SaveTaxFilingAsync(invoice.Id,
                new() { Version = editor.Version, Rows = editor.Rows }, 1, "Local test", true))!;
            Assert.Equal("Feet", Assert.Single(resaved.Rows).UOM);
            var rejected = Row(ids, 100); rejected.ItemTypeId = created.Id; rejected.SelectedFbrUOMId = 999;
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveTaxFilingAsync(invoice.Id,
                new() { Version = resaved.Version, Rows = new() { rejected } }, 1, "Local test", true));
        }
        finally
        {
            db.ChangeTracker.Clear();
            await db.InvoiceItems.Where(i => i.InvoiceId == invoice.Id).ExecuteDeleteAsync();
            await db.Invoices.Where(i => i.Id == invoice.Id).ExecuteDeleteAsync();
            await db.Clients.Where(c => c.CompanyId == company.Id).ExecuteDeleteAsync();
            await db.ItemTypes.Where(i => i.CompanyId == company.Id).ExecuteDeleteAsync();
            await db.Units.Where(u => u.CompanyId == company.Id).ExecuteDeleteAsync();
            await db.Companies.Where(c => c.Id == company.Id).ExecuteDeleteAsync();
        }
    }
}
