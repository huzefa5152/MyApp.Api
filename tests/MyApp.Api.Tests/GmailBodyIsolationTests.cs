using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using MyApp.Api.Services.Implementations;
using Xunit;

namespace MyApp.Api.Tests;
public class GmailBodyIsolationTests
{
    [Fact]
    public async Task AttachedMessagesDoNotBecomeCurrentEmailBody()
    {
        string Encode(string value) => Convert.ToBase64String(Encoding.UTF8.GetBytes(value)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var payload = new {
            id = "message", threadId = "thread", internalDate = "1791474000000", labelIds = new[] { "INBOX" },
            payload = new { mimeType = "multipart/mixed", headers = new[] { new { name = "From", value = "buyer@example.com" }, new { name = "Subject", value = "RFQ" } },
                parts = new object[] {
                    new { mimeType = "text/html", filename = "", body = new { data = Encode("<p>Current request</p>") } },
                    new { mimeType = "message/rfc822", filename = "old.eml", body = new { attachmentId = "attached", size = 100 },
                        parts = new[] { new { mimeType = "text/html", filename = "", body = new { data = Encode("<p>Old supplier quotation</p>") } } } }
                }
            }
        };
        using var client = new HttpClient(new Handler(JsonSerializer.Serialize(payload)));
        var provider = new GmailProvider(client, new ConfigurationBuilder().Build());
        var message = await provider.ReadAsync("test-token", "message", default);
        Assert.NotNull(message); Assert.Contains("Current request", message.Content.Html);
        Assert.DoesNotContain("Old supplier quotation", message.Content.Html);
        Assert.Equal("old.eml", Assert.Single(message.Content.Attachments).FileName);
    }
    private sealed class Handler(string json) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") });
    }
}
