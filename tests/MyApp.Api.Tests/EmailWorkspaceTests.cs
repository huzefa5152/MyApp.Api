using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Implementations;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;
using Xunit;

namespace MyApp.Api.Tests;
public class EmailWorkspaceTests
{
    private const string Table = "<table><tr><th>ITEAM</th><th>UNIT</th><th>QTY</th><th>Indent</th></tr><tr><td>Steel bolt</td><td>Nos</td><td>22</td><td>1234</td></tr></table>";
    [Fact]
    public void OAuthValuesAreRedactedFromJsonAndQueryAuditData()
    {
        var redactor = new SensitiveDataRedactor();
        Assert.DoesNotContain("sample-code", redactor.Scrub("{\"code\":\"sample-code\",\"state\":\"sample-state\"}")!);
        Assert.DoesNotContain("sample-state", redactor.ScrubFormEncoded("code=sample-code&state=sample-state")!);
    }
    [Fact]
    public void ExtractsHeadingBasedItemsAndMandatoryRequirements()
    {
        var d = EmailEnquiryExtractor.Extract("Request", new("Brand mandatory for every item. As per drawing.", Table, []));
        var line = Assert.Single(d.Items); Assert.Equal("Steel bolt", line.Description); Assert.Equal(22, line.Quantity);
        Assert.Equal("Nos", line.Unit); Assert.Null(line.UnitPrice); Assert.Equal("1234", d.CustomerEnquiryRef);
        Assert.True(d.RequiresBrand); Assert.True(d.RequiresSpecifications);
    }
    [Fact]
    public void EmbeddedUnitsAndUnsafeMarkupDoNotBecomeGuessedPrices()
    {
        var d = EmailEnquiryExtractor.Extract("Requirement 31", new("", "<script>secret()</script><table><tr><td>Description</td><td>Qty</td></tr><tr><td>Valve</td><td>22 no</td></tr><tr><td>Unknown</td><td>about twenty</td></tr></table>", []));
        Assert.Equal("no", Assert.Single(d.Items).Unit); Assert.Null(d.Items[0].UnitPrice);
        Assert.Contains(d.Warnings, w => w.Contains("unreadable quantity"));
        Assert.DoesNotContain("secret()", EmailEnquiryExtractor.PlainText(new("", "<script>secret()</script><p>Safe</p>", [])));
    }
    [Fact]
    public void NoSupportedTableFallsBackToManualReview()
    {
        var d = EmailEnquiryExtractor.Extract("Hello", new("Please quote the attached drawing", "", [new("a", "drawing.pdf", "application/pdf", 100)]));
        Assert.Empty(d.Items); Assert.NotEmpty(d.Warnings);
    }
    [Fact]
    public void ConversionRequiresExplicitReviewPricesBrandsAndSpecifications()
    {
        var d = new EmailDraftDto { ClientId = 1, Items = [new() { Description = "Bolt", Quantity = 2, Unit = "Nos" }] };
        Assert.True(EmailWorkspaceRules.ValidateDraft(d, true, true).Count >= 4);
        d.Items[0].UnitPrice = 50; d.Items[0].Brand = "Sample make"; d.Reviewed = true; d.SpecificationsConfirmed = true;
        Assert.Empty(EmailWorkspaceRules.ValidateDraft(d, true, true));
        d.Items[0].Quantity = -1; Assert.NotEmpty(EmailWorkspaceRules.ValidateDraft(d, false, false));
    }
    [Theory]
    [InlineData("BUYER@example.com", "Please QUOTE", true)]
    [InlineData("other@example.com", "Please quote", false)]
    [InlineData("buyer@example.com", "Newsletter", false)]
    public void SenderRulesRequireTheConfiguredSenderAndSubject(string sender, string subject, bool expected) =>
        Assert.Equal(expected, EmailWorkspaceRules.Matches(new() { Sender = "buyer@example.com", SubjectContains = "quote" }, sender, subject));

    [Fact]
    [Trait("Category", "LocalSql")]
    public async Task SqlWorkflowProtectsCompaniesAndCreatesExactlyOneRealQuotation()
    {
        var connection = Environment.GetEnvironmentVariable("EMAIL_TEST_CONNECTION")
            ?? throw new InvalidOperationException("Set EMAIL_TEST_CONNECTION to a disposable local MyApp_EmailWorkspace_Test_ database, or exclude Category=LocalSql.");
        var parsed = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
        DevelopmentSqlGuard.AssertLocal(connection, Environment.MachineName, false);
        Assert.StartsWith("MyApp_EmailWorkspace_Test_", parsed.InitialCatalog);
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).Options;
        await using var db = new AppDbContext(options);
        await db.Database.EnsureCreatedAsync();
        var protection = new EphemeralDataProtectionProvider(); var gmail = new FakeGmail(); var guard = new FakeGuard(); var permissions = new FakePermissions();
        var user = new User { Username = "email-test-" + Guid.NewGuid().ToString("N"), FullName = "Sample User" };
        var company = new Company { Name = "Sample Company" }; var other = new Company { Name = "Other Sample Company" };
        db.Users.Add(user); db.Companies.AddRange(company, other); await db.SaveChangesAsync();
        guard.Allowed = [company.Id];
        var client = new Client { Name = "Sample Customer", CompanyId = company.Id };
        var foreign = new Client { Name = "Other Sample Customer", CompanyId = other.Id };
        db.Clients.AddRange(client, foreign); await db.SaveChangesAsync();
        EmailWorkspaceService Service(AppDbContext context) => new(context, guard, permissions, gmail, protection,
            new SalesQuoteService(new SalesQuoteRepository(context), null!, context, NullLogger<SalesQuoteService>.Instance, new TestEnvironment()));
        var service = Service(db);
        var start = JsonSerializer.SerializeToElement(await service.StartAsync(user.Id, company.Id, default));
        var oauthState = new Uri(start.GetProperty("AuthorizationUrl").GetString()!).Query.Split("state=")[1];
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.CompleteAsync(user.Id + 10000, new("test-code", oauthState), default));
        await service.CompleteAsync(user.Id, new("test-code", oauthState), default);
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.CompleteAsync(user.Id, new("test-code", oauthState), default));
        var mailbox = new GmailConnection { OwnerUserId = user.Id, GoogleSubject = Guid.NewGuid().ToString("N"), EmailAddress = "owner@example.com", ProtectedRefreshToken = service.Protect("test-refresh") };
        db.GmailConnections.Add(mailbox); await db.SaveChangesAsync();
        await service.LinkAsync(user.Id, company.Id, mailbox.Id, default);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.LinkAsync(user.Id, other.Id, mailbox.Id, default));
        guard.Allowed.Add(other.Id); await service.LinkAsync(user.Id, other.Id, mailbox.Id, default); guard.Allowed.Remove(other.Id);
        await service.SyncAsync(mailbox.Id, default);
        await service.SyncAsync(mailbox.Id, default);
        var syncCount = gmail.RefreshCount;
        await using (var syncDb1 = new AppDbContext(options))
        await using (var syncDb2 = new AppDbContext(options))
            await Task.WhenAll(Service(syncDb1).SyncAsync(mailbox.Id, default), Service(syncDb2).SyncAsync(mailbox.Id, default));
        Assert.Equal(syncCount + 1, gmail.RefreshCount);
        Assert.Equal(1, await db.GmailMessages.CountAsync(m => m.ConnectionId == mailbox.Id));
        var message = await db.GmailMessages.SingleAsync(m => m.ConnectionId == mailbox.Id);
        Assert.DoesNotContain("Steel bolt", message.ProtectedContent); Assert.DoesNotContain("test-refresh", mailbox.ProtectedRefreshToken);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ReadAsync(user.Id, other.Id, message.Id, default));
        guard.DeniedUsers.Add(user.Id + 10000);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ReadAsync(user.Id + 10000, company.Id, message.Id, default));
        guard.DeniedUsers.Clear();
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.ReadAsync(user.Id + 10000, company.Id, message.Id, default));
        var link = await db.GmailCompanyLinks.SingleAsync(l => l.CompanyId == company.Id && l.ConnectionId == mailbox.Id);
        await service.SettingsAsync(user.Id, company.Id, link.Id, new() { ShareMatchingEmails = false, Rules = [new() { Sender = "buyer@example.com", ClientId = client.Id }] }, default);
        var suggestions = JsonSerializer.SerializeToElement(await service.ListAsync(user.Id, company.Id, "Suggested", null, 1, 20, default));
        Assert.Equal(1, suggestions.GetProperty("TotalCount").GetInt32());
        Assert.True(suggestions.GetProperty("Items")[0].GetProperty("IsSuggested").GetBoolean());
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.ReadAsync(user.Id + 10000, company.Id, message.Id, default));
        await service.SettingsAsync(user.Id, company.Id, link.Id, new() { ShareMatchingEmails = true, Rules = [new() { Sender = "buyer@example.com", ClientId = client.Id }] }, default);
        await service.ReadAsync(user.Id + 10000, company.Id, message.Id, default);
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.SettingsAsync(user.Id, company.Id, link.Id, new() { Rules = [new() { Sender = "buyer@example.com", ClientId = foreign.Id }] }, default));
        await service.DecideAsync(user.Id, company.Id, message.Id, new("Kept", null), default);
        var enquiry = await db.EmailEnquiries.SingleAsync(e => e.MessageId == message.Id);
        var draft = await service.PrepareAsync(user.Id, company.Id, message.Id, enquiry.Revision, default);
        Assert.Equal(client.Id, draft.ClientId); Assert.Single(draft.Items);
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.SaveDraftAsync(user.Id, company.Id, message.Id, new() { Revision = Guid.NewGuid() }, default));
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.ConvertAsync(user.Id, company.Id, message.Id, draft, default));
        draft.ClientId = foreign.Id; draft.Items[0].UnitPrice = 75; draft.Reviewed = true;
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.ConvertAsync(user.Id, company.Id, message.Id, draft, default));
        draft.ClientId = client.Id;
        // Separate contexts simulate two overlapping requests for the same source.
        await using var db2 = new AppDbContext(options); await using var db3 = new AppDbContext(options);
        var results = await Task.WhenAll(Service(db2).ConvertAsync(user.Id, company.Id, message.Id, draft, default), Service(db3).ConvertAsync(user.Id, company.Id, message.Id, draft, default));
        Assert.Equal(1, await db.SalesQuotes.CountAsync(q => q.CompanyId == company.Id));
        var quote = await db.SalesQuotes.AsNoTracking().Include(q => q.Items).SingleAsync(q => q.CompanyId == company.Id);
        Assert.Equal(1650, quote.Subtotal); Assert.Equal(1947, quote.GrandTotal);
        Assert.Contains(results, r => JsonSerializer.Serialize(r).Contains("\"AlreadyCreated\":true"));
        permissions.ModuleEnabled = false;
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ReadAsync(user.Id, company.Id, message.Id, default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.StartAsync(user.Id, company.Id, default));
        var beforeModuleRevocation = gmail.RefreshCount;
        await service.SyncAsync(mailbox.Id, default);
        Assert.Equal(beforeModuleRevocation, gmail.RefreshCount);
        permissions.ModuleEnabled = true;
        db.ChangeTracker.Clear();
        await service.UnlinkAsync(user.Id, company.Id, link.Id, default);
        await service.ReadAsync(user.Id + 10000, company.Id, message.Id, default);
        var before = gmail.RefreshCount; guard.Allowed.Clear(); await service.SyncAsync(mailbox.Id, default);
        Assert.Equal(before, gmail.RefreshCount);
    }
    private sealed class TestEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "MyApp.Api.Tests";
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = Path.GetTempPath();
        public string WebRootPath { get; set; } = Path.GetTempPath();
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }
    private sealed class FakeGmail : IGmailProvider
    {
        public int RefreshCount;
        public bool IsConfigured => true;
        public string RedirectUri => "http://localhost/email-workspace";
        public string AuthorizationUrl(string state, string challenge) => "https://accounts.google.com/?state=" + state;
        public Task<GmailIdentity> ExchangeAsync(string code, string verifier, CancellationToken ct) => Task.FromResult(new GmailIdentity("test-subject", "owner@example.com", "test-refresh"));
        public async Task<string> RefreshAsync(string refreshToken, CancellationToken ct) { Interlocked.Increment(ref RefreshCount); await Task.Delay(200, ct); return "test-access"; }
        public Task<string> GetHistoryIdAsync(string accessToken, CancellationToken ct) => Task.FromResult("100");
        public Task<GmailBatch> ListAsync(string accessToken, DateTime since, string? pageToken, CancellationToken ct) => Task.FromResult(new GmailBatch(["message-1"], null, null));
        public Task<GmailBatch> HistoryAsync(string accessToken, string historyId, string? pageToken, CancellationToken ct) => Task.FromResult(new GmailBatch(["message-1"], null, "101"));
        public Task<GmailFetchedMessage?> ReadAsync(string accessToken, string id, CancellationToken ct) => Task.FromResult<GmailFetchedMessage?>(new(id, "thread-1", "buyer@example.com", "Quotation request", DateTime.UtcNow, new("", Table, [])));
        public Task<byte[]> AttachmentAsync(string accessToken, string messageId, string attachmentId, CancellationToken ct) => Task.FromResult(Array.Empty<byte>());
    }
    private sealed class FakeGuard : ICompanyAccessGuard
    {
        public HashSet<int> Allowed = []; public HashSet<int> DeniedUsers = [];
        public Task<bool> HasAccessAsync(int userId, int companyId) => Task.FromResult(!DeniedUsers.Contains(userId) && Allowed.Contains(companyId));
        public async Task AssertAccessAsync(int userId, int companyId) { if (!await HasAccessAsync(userId, companyId)) throw new UnauthorizedAccessException(); }
        public Task<HashSet<int>> GetAccessibleCompanyIdsAsync(int userId) => Task.FromResult(DeniedUsers.Contains(userId) ? [] : Allowed);
        public void InvalidateUser(int userId) { } public void InvalidateAll() { }
    }
    private sealed class FakePermissions : IPermissionService
    {
        public bool ModuleEnabled = true;
        public Task<bool> HasPermissionAsync(int userId, string permissionKey) => Task.FromResult(permissionKey != "email.workspace.use" || ModuleEnabled);
        public Task<IReadOnlyCollection<string>> GetUserPermissionsAsync(int userId) => Task.FromResult<IReadOnlyCollection<string>>([]);
        public void InvalidateUser(int userId) { } public void InvalidateAll() { }
        public bool IsSeedAdmin(int userId) => false;
        public Task<bool> HasMcpToolAccessAsync(int userId, string toolName) => Task.FromResult(false);
    }
}
