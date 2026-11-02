using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using Xunit;

public class FbrUnitMatchTests
{
    private static readonly List<FbrUOMDto> Units = new() {
        new() { UOM_ID = 13, Description = "KG" }, new() { UOM_ID = 71, Description = "Packs" }
    };

    [Theory]
    [InlineData("Packs", 13, 71)]   // bill 3985: the name shown wins over KG's id stored beside it
    [InlineData("packs", null, 71)] // a typed name finds its own id, not FBR's default
    [InlineData("Nos", 13, 13)]     // a local alias keeps the id it was saved with
    [InlineData(null, 71, 71)]
    public void ResolvesTheUnitTheOperatorChose(string? uom, int? id, int expected)
        => Assert.Equal(expected, FbrUnitMatch.Resolve(Units, uom, id)!.UOM_ID);

    [Theory]
    [InlineData("Dozen", null)]
    [InlineData("Dozen", 99)]
    [InlineData(null, null)]
    public void FindsNothingFbrDoesNotList(string? uom, int? id)
        => Assert.Null(FbrUnitMatch.Resolve(Units, uom, id));
}
