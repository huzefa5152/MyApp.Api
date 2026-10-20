using MyApp.Api.Helpers;
using Xunit;

// FBR rejects the second of two items it cannot tell apart as "DUPLICATE
// INVOICE EXISTS" (Hakimi INV-3973, 2026-10-20). These pin what counts as the
// same item, so the save refusal and the pre-flight stay in step with FBR.
public class FbrDuplicateItemsTests
{
    private static FbrDuplicateItems.Item Item(int row, string hs = "8470.1000", string desc = "Office Stationary",
        string sale = "Goods at Standard Rate (default)", string uom = "Numbers, pieces, units",
        string sro = "", string serial = "", string rate = "18%") => new(row, hs, desc, sale, uom, sro, serial, rate);

    [Fact]
    public void TheInvoice3973RowsCollide()
    {
        var message = FbrDuplicateItems.Message(new[] { Item(1), Item(2) });
        Assert.NotNull(message);
        Assert.Contains("Rows 1 and 2 are the same FBR item (HS 8470.1000, Office Stationary)", message);
        Assert.Contains("Merge them into one row", message);
    }

    [Fact]
    public void ThreeRepeatedRowsAreAllNamed()
    {
        Assert.Contains("Rows 1, 2 and 4 are the same FBR item",
            FbrDuplicateItems.Message(new[] { Item(1), Item(2), Item(3, hs: "8471.3000"), Item(4) }));
    }

    [Fact]
    public void CaseAndSpacingDoNotMakeRowsDifferent()
    {
        Assert.NotNull(FbrDuplicateItems.Message(new[] {
            Item(1), Item(2, desc: "  office   stationary ", sale: "goods at standard rate (default)") }));
    }

    [Theory]
    [InlineData("8471.3000", "Office Stationary", "Numbers, pieces, units", "")]
    [InlineData("8470.1000", "Office Furniture", "Numbers, pieces, units", "")]
    [InlineData("8470.1000", "Office Stationary", "Kilogram", "")]
    [InlineData("8470.1000", "Office Stationary", "Numbers, pieces, units", "EIGHTH SCHEDULE Table 1")]
    public void AnyIdentifyingDifferenceKeepsRowsDistinct(string hs, string desc, string uom, string sro)
    {
        Assert.Null(FbrDuplicateItems.Message(new[] { Item(1), Item(2, hs: hs, desc: desc, uom: uom, sro: sro) }));
    }

    [Fact]
    public void WithDescriptionsOmittedTheSameHsCodeCollides()
    {
        // A company set to omit product descriptions sends "" for both rows.
        var message = FbrDuplicateItems.Message(new[] { Item(1, desc: ""), Item(3, desc: "") });
        Assert.Contains("Rows 1 and 3 are the same FBR item (HS 8470.1000)", message);
    }

    [Fact]
    public void ExplainAddsTheMeaningOnlyToTheRepeatedItemError()
    {
        Assert.Contains("merge those rows into one", FbrDuplicateItems.Explain("DUPLICATE INVOICE EXISTS"));
        Assert.Equal("Invalid HS code", FbrDuplicateItems.Explain("Invalid HS code"));
        Assert.Equal("", FbrDuplicateItems.Explain(null));
    }
}
