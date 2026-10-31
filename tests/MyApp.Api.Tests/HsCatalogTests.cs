using System.Reflection;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;
using Xunit;

namespace MyApp.Api.Tests;

public class HsCatalogTests
{
    // Real FBR descriptions as stored on Trader item types.
    [Theory]
    [InlineData("MISCELLANEOUS ARTICLES OF BASE METAL. - PADLOCKS AND LOCKS (KEY, COMBINATION OR ELECTRICALLY OPERATED)", "Padlocks and locks")]
    [InlineData("GLASS AND GLASSWARE. -  - OTHER", "Glass and glassware")]
    [InlineData("ARTICLES OF IRON AND STEEL. - SCREWS, BOLTS, NUTS, COACH SCREWS, SCREW HOOKS, RIVETS, COTTERS", "Screws, bolts, nuts, coach screws, screw hooks")]
    [InlineData("IRON AND STEEL. - FLAT-ROLLED PRODUCTS OF IRON OR NON-ALLOY STEEL, OF A WIDTH OF 600 MM OR MORE", "Flat-rolled products of iron or non-alloy steel")]
    [InlineData("PLASTICS AND ARTICLES THEREOF - OTHER ARTICLES OF PLASTICS - - Other", "Other articles of plastics")]
    [InlineData("X. - AAAAAAAAAA BBBBBBBBBB CCCCCCCCCC DDDDDDDDDD EEEEEEEEEE FFFFFFFFFF", "Aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd")]
    [InlineData("ELECTRICAL MACHINERY. - ELECTRIC ACCUMULATORS, INCLUDING SEPARATORS THEREFOR - PARTS", "Electric accumulators – parts")]
    [InlineData("KNITTED OR CROCHETED FABRICS. - OTHER KNITTED OR CROCHETED FABRICS - - DYED", "Other knitted or crocheted – dyed")]
    [InlineData("GLASS AND GLASSWARE. -  - (1) WIND SCREEN, REAR AND WINDOW GLASSES FOR VEHICLES OF SUB HEADING 8704.2190", "Wind screen, rear and window glasses")]
    [InlineData("VEHICLES. - TRACTORS - NOT EXCEEDING 18 KW", "Tractors")]
    [InlineData("BASE METALS. - BARS AND RODS, OTHER THAN THOSE OBTAINED SIMPLY BY SINTERING", "Bars and rods")]
    [InlineData("TELEVISION. - TELEVISION RECEIVERS - - OTHER, MONOCHROME", "Television receivers – other, monochrome")]
    [InlineData("-  - OTHERS", "")]
    [InlineData("", "")]
    [InlineData(null, "")]
    public void ShortNameIsOneReadableLine(string? description, string expected)
    {
        var name = HsShortName.From(description);
        Assert.Equal(expected, name);
        Assert.True(name.Length <= 60);
    }

    [Fact]
    public void PickersReceiveTheShortNameBesideFbrsFullText()
    {
        var json = JsonSerializer.Serialize(new FbrHSCodeDto { HS_CODE = "8301.1000", Description = "MISC. - PADLOCKS AND LOCKS (KEY)" },
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Contains("\"shortName\":\"Padlocks and locks\"", json);
        Assert.Contains("\"description\":\"MISC. - PADLOCKS AND LOCKS (KEY)\"", json);
    }

    [Fact]
    public async Task ACodeMissingOfflineNeverCallsPralWhileTheCallerHasUnsavedChanges()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        db.FbrLookups.Add(new FbrLookup { Category = "HsCode", Code = "8301.1000", Label = "Padlocks" });
        await db.SaveChangesAsync();
        db.ItemTypes.Add(new ItemType { CompanyId = 7, Name = "Unsaved filing work" }); // pending, as in a filing save
        var cache = typeof(FbrService).GetField("_hsCodeCatalog", BindingFlags.Static | BindingFlags.NonPublic)!;
        var previous = cache.GetValue(null);
        try
        {
            cache.SetValue(null, null);
            // Null HTTP/token dependencies: reaching PRAL would throw.
            var service = new FbrService(null!, null!, null!, null!, db, null!, null!, null!,
                NullLogger<FbrService>.Instance, null!, null!, new ConfigurationBuilder().Build());
            Assert.Empty(await service.GetHSCodesAsync(7, "9999.0000"));
            Assert.Single(await service.GetHSCodesAsync(7, "8301"));
            Assert.Single(db.ChangeTracker.Entries<ItemType>()); // the caller's work was not saved early
        }
        finally { cache.SetValue(null, previous); }
    }
}
