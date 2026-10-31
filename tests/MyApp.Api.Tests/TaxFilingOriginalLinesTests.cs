using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using Xunit;

namespace MyApp.Api.Tests;

// A company that prints its original bill lines gives each line its own HS code (2026-10-31).
public class TaxFilingOriginalLinesTests
{
    private static readonly Invoice Bill = new()
    {
        Items = new List<InvoiceItem>
        {
            new() { Id = 11, Description = "S.S NUT BOLTS 10X40MM" },
            new() { Id = 12, Description = "ALLEN KEY 4MM" },
            new() { Id = 13, Description = "ALLEN KEY 5MM" },
        }
    };

    private static TaxFilingRowDto Row(int line, string? hs) => new() { SourceLineIds = new() { line }, HSCode = hs };

    [Fact]
    public void ACodeAlreadyOnOneLineIsRefusedOnAnotherNamingThatLine()
    {
        var message = TaxFilingProjection.RepeatedHsCode(Bill.Items, new[] { Row(11, "7318.1590"), Row(12, "8204.1100"), Row(13, " 8204.1100 ") });
        Assert.Equal("HS code 8204.1100 is already in use on the line \"ALLEN KEY 4MM\". Each bill line of this company needs its own HS code.", message);
    }

    [Fact]
    public void DistinctOrMissingCodesPass()
    {
        Assert.Null(TaxFilingProjection.RepeatedHsCode(Bill.Items, new[] { Row(11, "7318.1590"), Row(12, "8204.1100"), Row(13, "8204.1200") }));
        Assert.Null(TaxFilingProjection.RepeatedHsCode(Bill.Items, new[] { Row(11, null), Row(12, ""), Row(13, "8204.1200") }));
    }

    [Fact]
    public void ANewMergedRowIsRefusedButOneSavedBeforeTheRuleMayStay()
    {
        var merged = new TaxFilingRowDto { SourceLineIds = new() { 12, 11 } };
        Assert.Contains("own row", TaxFilingProjection.MergedRow(null, new[] { merged, Row(13, null) }));
        var saved = new[] { new TaxFilingRowDto { SourceLineIds = new() { 11, 12 } }, Row(13, null) };
        Assert.Null(TaxFilingProjection.MergedRow(saved, new[] { merged, Row(13, null) }));
        Assert.Null(TaxFilingProjection.MergedRow(null, new[] { Row(11, null), Row(12, null), Row(13, null) }));
    }

    [Fact]
    public void ADuplicateItemNeverTellsAnOriginalLinesCompanyToMerge()
    {
        var items = new[] { new FbrDuplicateItems.Item(1, "8204.1100", "Spanner", "Std", "69", null, null),
                            new FbrDuplicateItems.Item(2, "8204.1100", "Spanner", "Std", "69", null, null) };
        Assert.Contains("Merge them into one row", FbrDuplicateItems.Message(items));
        var perLine = FbrDuplicateItems.Message(items, canMerge: false);
        Assert.DoesNotContain("Merge", perLine);
        Assert.Contains("different descriptions on the bill", perLine);
    }
}
