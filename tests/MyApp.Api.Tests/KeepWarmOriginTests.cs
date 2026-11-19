using MyApp.Api.Services.HostedServices;
using Xunit;

namespace MyApp.Api.Tests;

// The keep-warm ping goes to the site's own address, learned from a request. The Host
// header is the caller's to write, so only the hosting platform's domain is accepted.
public class KeepWarmOriginTests
{
    [Theory]
    [InlineData("example-site.runasp.net", null, true)]
    [InlineData("EXAMPLE-SITE.RUNASP.NET", null, true)]
    [InlineData("localhost", null, false)]
    [InlineData("attacker.example", null, false)]
    [InlineData("runasp.net.attacker.example", null, false)]
    [InlineData("", null, false)]
    [InlineData(null, null, false)]
    [InlineData("erp.example.test", "erp.example.test", true)]
    [InlineData("other.example.test", "erp.example.test", false)]
    public void OnlyTheSitesOwnHostIsAccepted(string? host, string? configured, bool accepted) =>
        Assert.Equal(accepted, KeepWarmOrigin.Accepts(host, configured));
}
