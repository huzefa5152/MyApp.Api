using MyApp.Api.Helpers;
using Xunit;

namespace MyApp.Api.Tests;

// Audit C-2: pure-logic coverage of the redactor that scrubs credentials and
// masks tax IDs before anything hits the AuditLogs table / Serilog sink.
public class SensitiveDataRedactorTests
{
    private readonly SensitiveDataRedactor _redactor = new();

    [Fact]
    public void Scrub_Null_ReturnsNull()
        => Assert.Null(_redactor.Scrub(null));

    [Fact]
    public void Scrub_Redacts_Password()
        => Assert.Equal("{\"password\":\"***\"}", _redactor.Scrub("{\"password\":\"hunter2\"}"));

    [Fact]
    public void Scrub_Redacts_FbrToken()
        => Assert.Equal("{\"fbrtoken\":\"***\"}", _redactor.Scrub("{\"fbrtoken\":\"abc123xyz\"}"));

    [Fact]
    public void Scrub_Masks_Ntn_KeepingLastFour()
        => Assert.Equal("{\"ntn\":\"*********0123\"}", _redactor.Scrub("{\"ntn\":\"1234567890123\"}"));

    [Fact]
    public void Scrub_ShortMaskValue_LeftIntact()
        => Assert.Equal("{\"ntn\":\"12\"}", _redactor.Scrub("{\"ntn\":\"12\"}"));

    [Fact]
    public void ScrubByContentType_FormEncoded_RedactsAndMasks()
    {
        var result = _redactor.ScrubByContentType(
            "password=hunter2&ntn=1234567890123",
            "application/x-www-form-urlencoded");

        Assert.Contains("password=***", result);
        Assert.DoesNotContain("hunter2", result);
        Assert.DoesNotContain("1234567890123", result); // full NTN never present
        Assert.Contains("0123", result);                // last four preserved
    }

    [Fact]
    public void ScrubByContentType_Json_DispatchesToScrub()
        => Assert.Equal("{\"password\":\"***\"}",
            _redactor.ScrubByContentType("{\"password\":\"secret\"}", "application/json"));
}
