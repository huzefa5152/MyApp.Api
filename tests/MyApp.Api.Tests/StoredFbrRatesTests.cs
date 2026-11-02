using System.Collections;
using System.Reflection;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Tax;
using Xunit;

namespace MyApp.Api.Tests;

// The live host recycles the app after a few idle minutes, emptying the in-memory caches. Today's FBR
// sale-type rates are stored like HS units, so the first lookup after a recycle reads the database.
public class StoredFbrRatesTests
{
    [Fact]
    public async Task HintsUseTodaysStoredRatesAndUnitsWithoutAskingFbr()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        db.Companies.Add(new Company { Id = 8, Name = "Rates Co", FbrProvinceCode = 8, FbrToken = "t" });
        var today = DateTime.UtcNow.Date.ToString("yyyy-MM-dd");
        db.FbrLookups.Add(new FbrLookup
        {
            Category = TaxMappingEngine.SaleTypeRateCategory,
            Code = $"18|8|{today}",
            Label = JsonSerializer.Serialize(new List<FbrSaleTypeRateDto> { new() { RATE_ID = 734, RATE_DESC = "18%", RATE_VALUE = 18m } })
        });
        db.FbrLookups.Add(new FbrLookup { Category = TaxMappingEngine.HsUomCategory, Code = "5602.2100|13", Label = "KG" });
        await db.SaveChangesAsync();
        foreach (var name in new[] { "_hsUomCache", "_saleTypeRateCache" })
            ((IDictionary)typeof(TaxMappingEngine).GetField(name, BindingFlags.Static | BindingFlags.NonPublic)!.GetValue(null)!).Clear();

        // No FBR service at all: reaching FBR would throw, and the rate failure would leave RateOptions empty.
        var hints = await new TaxMappingEngine(null!, db).GetHsCodeHintsAsync(8, "5602.2100");

        Assert.Equal(new[] { "KG" }, hints.Uoms.Select(u => u.Description));
        Assert.Equal(734, Assert.Single(hints.RateOptions).RateId);
        Assert.Equal(18m, hints.DefaultRate);
    }

    [Fact]
    public async Task FbrIsAskedForRatesWithTheDateFormatItAccepts()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        db.Companies.Add(new Company { Id = 8, Name = "Rates Co", FbrProvinceCode = 8, FbrToken = "t" });
        db.FbrLookups.Add(new FbrLookup { Category = TaxMappingEngine.HsUomCategory, Code = "5602.2100|13", Label = "KG" });
        await db.SaveChangesAsync();
        ((IDictionary)typeof(TaxMappingEngine).GetField("_saleTypeRateCache", BindingFlags.Static | BindingFlags.NonPublic)!.GetValue(null)!).Clear();
        string? asked = null;
        var fbr = DispatchProxy.Create<IFbrService, FilingClassificationTests.Stub>();
        ((FilingClassificationTests.Stub)(object)fbr).Call = (m, args) => m.Name == "GetSaleTypeRatesAsync"
            ? Task.FromResult((asked = (string)args![1]!) is { } ? new List<FbrSaleTypeRateDto> { new() { RATE_ID = 734, RATE_DESC = "18%", RATE_VALUE = 18m } } : new())
            : throw new NotSupportedException(m.Name);

        var hints = await new TaxMappingEngine(fbr, db).GetHsCodeHintsAsync(8, "5602.2100");

        Assert.Equal(DateTime.UtcNow.Date.ToString("dd-MMM-yyyy", System.Globalization.CultureInfo.InvariantCulture), asked);
        Assert.Equal(734, Assert.Single(hints.RateOptions).RateId);
    }

    // FBR has no unit for some codes (mostly 98xx services). A recent "<hs>|none" mark answers without
    // asking PRAL; a week-old one is asked again.
    [Theory]
    [InlineData(2, false)]
    [InlineData(8, true)]
    public async Task ACodeMarkedAsHavingNoUnitIsAskedAgainOnlyAfterAWeek(int daysOld, bool expectAsked)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        db.FbrLookups.Add(new FbrLookup
        {
            Category = TaxMappingEngine.HsUomCategory,
            Code = "9801.1000|none",
            Label = DateTime.UtcNow.Date.AddDays(-daysOld).ToString("yyyy-MM-dd")
        });
        await db.SaveChangesAsync();
        ((IDictionary)typeof(TaxMappingEngine).GetField("_hsUomCache", BindingFlags.Static | BindingFlags.NonPublic)!.GetValue(null)!).Clear();
        var asked = 0;
        var fbr = DispatchProxy.Create<IFbrService, FilingClassificationTests.Stub>();
        ((FilingClassificationTests.Stub)(object)fbr).Call = (m, args) => m.Name == "GetHSCodeUOMAsync"
            ? Task.FromResult<List<FbrUOMDto>?>(++asked > 0 ? new List<FbrUOMDto> { new() { UOM_ID = 77, Description = "Numbers, pieces, units" } } : null)
            : throw new NotSupportedException(m.Name);

        var units = await new TaxMappingEngine(fbr, db).GetValidUomsForHsCodeAsync(1, "9801.1000");

        Assert.Equal(expectAsked, asked > 0);
        Assert.Equal(expectAsked ? 1 : 0, units.Count);
    }

    // The mark is written with raw SQL, so this runs against a real local test database.
    [Fact, Trait("Category", "LocalFilingSql")]
    public async Task OnlyARealEmptyAnswerMarksACodeAndUnitsClearTheMark()
    {
        var connection = Environment.GetEnvironmentVariable("FILING_TEST_CONNECTION")
            ?? throw new InvalidOperationException("Set FILING_TEST_CONNECTION to an isolated local Trader test database.");
        DevelopmentSqlGuard.AssertLocal(connection, Environment.MachineName, false);
        Assert.StartsWith("MyApp_Trader_Test_", new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection).InitialCatalog);
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).Options);
        const string failed = "0000.0001", empty = "0000.0002", recovered = "0000.0003";
        async Task Clean() => await db.Database.ExecuteSqlRawAsync("DELETE FROM FbrLookups WHERE Category = 'HsUom' AND Code LIKE '0000.000%'");
        string? Mark(string hs) => db.FbrLookups.AsNoTracking().Where(l => l.Category == TaxMappingEngine.HsUomCategory && l.Code == hs + "|none")
            .Select(l => l.Label).FirstOrDefault();
        await Clean();
        try
        {
            ((IDictionary)typeof(TaxMappingEngine).GetField("_hsUomCache", BindingFlags.Static | BindingFlags.NonPublic)!.GetValue(null)!).Clear();
            var fbr = DispatchProxy.Create<IFbrService, FilingClassificationTests.Stub>();
            ((FilingClassificationTests.Stub)(object)fbr).Call = (m, args) => Task.FromResult((string)args![1]! switch
            {
                failed => null,
                empty => new List<FbrUOMDto>(),
                _ => new List<FbrUOMDto> { new() { UOM_ID = 77, Description = "Numbers, pieces, units" } },
            });
            var engine = new TaxMappingEngine(fbr, db);

            await engine.GetValidUomsForHsCodeAsync(1, failed);
            Assert.Null(Mark(failed));

            await engine.GetValidUomsForHsCodeAsync(1, empty);
            Assert.Equal(DateTime.UtcNow.Date.ToString("yyyy-MM-dd"), Mark(empty));
            await db.Database.ExecuteSqlRawAsync("UPDATE FbrLookups SET Label = '2000-01-01' WHERE Code = '0000.0002|none'");
            await engine.GetValidUomsForHsCodeAsync(1, empty);
            Assert.Equal(DateTime.UtcNow.Date.ToString("yyyy-MM-dd"), Mark(empty));
            Assert.Equal(1, db.FbrLookups.Count(l => l.Code == empty + "|none"));

            db.FbrLookups.Add(new FbrLookup { Category = TaxMappingEngine.HsUomCategory, Code = recovered + "|none", Label = "2000-01-01", IsActive = true });
            await db.SaveChangesAsync();
            Assert.Single(await engine.GetValidUomsForHsCodeAsync(1, recovered));
            Assert.Null(Mark(recovered));
            Assert.True(db.FbrLookups.Any(l => l.Code == recovered + "|77"));
        }
        finally { await Clean(); }
    }
}
