using MyApp.Api.Helpers;
using Xunit;

namespace MyApp.Api.Tests;

// Audit C-2: pure-logic unit coverage of the pageSize/​page clamp that guards
// every paged endpoint (see PaginationHelper). No DB, deterministic.
public class PaginationHelperTests
{
    [Theory]
    [InlineData(null, 25)]      // no request -> default page size
    [InlineData(10, 10)]        // in range, unchanged
    [InlineData(0, 1)]          // below floor -> 1
    [InlineData(-5, 1)]         // negative -> 1
    [InlineData(999999, 200)]   // above default max -> clamped to 200
    [InlineData(200, 200)]      // at max, unchanged
    public void Clamp_DefaultBounds(int? requested, int expected)
        => Assert.Equal(expected, PaginationHelper.Clamp(requested));

    [Theory]
    [InlineData(null, 50, 200, 50)]   // fallback to caller default
    [InlineData(null, 999, 200, 200)] // default itself clamped to max
    [InlineData(500, 25, 200, 200)]   // request clamped to max
    [InlineData(50, 25, 200, 50)]     // request in range
    [InlineData(5, 25, 3, 3)]         // custom max caps the request
    public void Clamp_CustomDefaultAndMax(int? requested, int def, int max, int expected)
        => Assert.Equal(expected, PaginationHelper.Clamp(requested, def, max));

    [Fact]
    public void Clamp_MaxBelowOne_TreatedAsOne()
        => Assert.Equal(1, PaginationHelper.Clamp(50, 25, 0));

    [Theory]
    [InlineData(0, 1)]
    [InlineData(-3, 1)]
    [InlineData(1, 1)]
    [InlineData(7, 7)]
    public void ClampPage_FloorsAtOne(int requested, int expected)
        => Assert.Equal(expected, PaginationHelper.ClampPage(requested));
}
