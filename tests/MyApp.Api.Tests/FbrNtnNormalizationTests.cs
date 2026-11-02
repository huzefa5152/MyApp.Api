using System.Reflection;
using MyApp.Api.Services.Implementations;
using Xunit;

public class FbrNtnNormalizationTests
{
    [Theory]
    [InlineData("A123456-7", "A123456")]
    [InlineData("A123456", "A123456")]
    [InlineData("a123456-7", "A123456")]
    [InlineData(" A123456-7 ", "A123456")]
    [InlineData("A1234567", "A123456")]
    [InlineData("B654321-0", "B654321")]
    [InlineData("1234567-8", "1234567")]
    [InlineData("1234567", "1234567")]
    [InlineData("12345678", "1234567")]
    [InlineData("12-34-0123456-7", "0123456")]
    [InlineData("0123456-7", "0123456")]
    [InlineData("123", "123")]
    [InlineData("", "")]
    [InlineData(null, "")]
    public void KeepsRegistrationIdentityAndRemovesCheckDigit(string? input, string expected)
    {
        var method = typeof(FbrService).GetMethod("SanitizeNtn",
            BindingFlags.NonPublic | BindingFlags.Static)!;
        Assert.Equal(expected, method.Invoke(null, new object?[] { input }));
    }
}
