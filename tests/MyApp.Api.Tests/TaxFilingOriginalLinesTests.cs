using MyApp.Api.Helpers;
using Xunit;

namespace MyApp.Api.Tests;

// A company that prints its original bill lines may give several lines one HS code; FBR gets one row for them.
public class TaxFilingOriginalLinesTests
{
    [Fact]
    public void ADuplicateItemTellsTheOperatorToMerge()
    {
        var items = new[] { new FbrDuplicateItems.Item(1, "8204.1100", "Spanner", "Std", "69", null, null),
                            new FbrDuplicateItems.Item(2, "8204.1100", "Spanner", "Std", "69", null, null) };
        Assert.Contains("Merge them into one row", FbrDuplicateItems.Message(items));
    }
}
