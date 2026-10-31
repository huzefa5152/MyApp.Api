using System.Collections;
using System.Reflection;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
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
        db.FbrLookups.Add(new FbrLookup { Category = TaxMappingEngine.SaleTypeRateCategory, Code = $"18|8|{today}",
            Label = JsonSerializer.Serialize(new List<FbrSaleTypeRateDto> { new() { RATE_ID = 734, RATE_DESC = "18%", RATE_VALUE = 18m } }) });
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
}
