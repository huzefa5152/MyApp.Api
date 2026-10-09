using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Implementations;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;
using System.Text.Json;
using Xunit;

namespace MyApp.Api.Tests;

/// <summary>
/// Security audit 2026-10-09: the Email Workspace fixes, each proven blocked AND
/// proven to leave the legitimate path working. Same disposable local SQL
/// database as <see cref="EmailWorkspaceTests"/> (EMAIL_TEST_CONNECTION).
/// </summary>
public class EmailSecurityAuditTests
{
    private const string Table = "<table><tr><th>Item</th><th>Qty</th><th>Unit</th></tr><tr><td>Steel bolt</td><td>22</td><td>Nos</td></tr></table>";

    [Fact]
    [Trait("Category", "LocalSql")]
    public async Task EmailWorkspaceAccessFollowsTheAuditRules()
    {
        var connection = Environment.GetEnvironmentVariable("EMAIL_TEST_CONNECTION")
            ?? throw new InvalidOperationException("Set EMAIL_TEST_CONNECTION to a disposable local MyApp_EmailWorkspace_Test_ database, or exclude Category=LocalSql.");
        DevelopmentSqlGuard.AssertLocal(connection, Environment.MachineName, false);
        Assert.StartsWith("MyApp_EmailWorkspace_Test_", new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection).InitialCatalog);
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).Options;
        await using var db = new AppDbContext(options);
        await db.Database.EnsureCreatedAsync();

        var gmail = new FakeGmail(); var guard = new FakeGuard(); var permissions = new FakePermissions();
        var owner = new User { Username = "email-audit-owner-" + Guid.NewGuid().ToString("N"), FullName = "Owner" };
        var viewer = new User { Username = "email-audit-viewer-" + Guid.NewGuid().ToString("N"), FullName = "Viewer" };
        var company = new Company { Name = "Audit Company" }; var second = new Company { Name = "Audit Second Company" };
        db.Users.AddRange(owner, viewer); db.Companies.AddRange(company, second); await db.SaveChangesAsync();
        guard.Allowed = [company.Id, second.Id];
        var client = new Client { Name = "Audit Customer", CompanyId = company.Id };
        db.Clients.Add(client); await db.SaveChangesAsync();
        var service = new EmailWorkspaceService(db, guard, permissions, gmail, new EphemeralDataProtectionProvider(),
            new SalesQuoteService(new SalesQuoteRepository(db), null!, db, NullLogger<SalesQuoteService>.Instance),
            new DivisionAccessGuard(db, new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions()), new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build()));

        var mailbox = new GmailConnection { OwnerUserId = owner.Id, GoogleSubject = Guid.NewGuid().ToString("N"), EmailAddress = "owner@example.com", ProtectedRefreshToken = service.Protect("audit-refresh") };
        db.GmailConnections.Add(mailbox); await db.SaveChangesAsync();
        await service.LinkAsync(owner.Id, company.Id, mailbox.Id, default);
        await service.LinkAsync(owner.Id, second.Id, mailbox.Id, default);
        var link = await db.GmailCompanyLinks.SingleAsync(l => l.CompanyId == company.Id && l.ConnectionId == mailbox.Id);
        await service.SettingsAsync(owner.Id, company.Id, link.Id, new() { ShareMatchingEmails = true, Rules = [new() { Sender = "buyer@example.com", ClientId = client.Id }] }, default);
        await service.SyncAsync(mailbox.Id, default);
        var genuine = await db.GmailMessages.SingleAsync(m => m.ConnectionId == mailbox.Id && m.ProviderMessageId == "genuine");
        var forged = await db.GmailMessages.SingleAsync(m => m.ConnectionId == mailbox.Id && m.ProviderMessageId == "forged");
        Assert.False(genuine.SenderUnverified); Assert.True(forged.SenderUnverified);

        // Forged From: never shared by a sender rule; the genuine one still is; the owner sees both.
        await service.ReadAsync(viewer.Id, company.Id, genuine.Id, default);
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.ReadAsync(viewer.Id, company.Id, forged.Id, default));
        await service.ReadAsync(owner.Id, company.Id, forged.Id, default);

        // Taking someone else's enquiry out of Kept.
        await service.DecideAsync(owner.Id, company.Id, genuine.Id, new("Kept", null), default);
        var enquiry = await db.EmailEnquiries.AsNoTracking().SingleAsync(e => e.MessageId == genuine.Id && e.CompanyId == company.Id);
        permissions.Denied.Add((viewer.Id, "email.enquiries.manage"));
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.DecideAsync(viewer.Id, company.Id, genuine.Id, new("Ignored", enquiry.Revision), default));
        Assert.Equal("Kept", (await db.EmailEnquiries.AsNoTracking().SingleAsync(e => e.Id == enquiry.Id)).Decision);
        permissions.Denied.Remove((viewer.Id, "email.enquiries.manage"));
        var ignored = JsonSerializer.SerializeToElement(await service.DecideAsync(viewer.Id, company.Id, genuine.Id, new("Ignored", enquiry.Revision), default));
        Assert.Equal("Ignored", ignored.GetProperty("Decision").GetString());
        await service.DecideAsync(owner.Id, company.Id, genuine.Id, new("Kept", ignored.GetProperty("Revision").GetGuid()), default);

        // The quotation draft (customer, prices) is for quotation preparers only.
        enquiry = await db.EmailEnquiries.AsNoTracking().SingleAsync(e => e.Id == enquiry.Id);
        var draft = await service.PrepareAsync(owner.Id, company.Id, genuine.Id, enquiry.Revision, default);
        await service.SaveDraftAsync(owner.Id, company.Id, genuine.Id, draft, default);
        permissions.Denied.Add((viewer.Id, "email.enquiries.manage"));
        var viewOnly = JsonSerializer.SerializeToElement(await service.ReadAsync(viewer.Id, company.Id, genuine.Id, default));
        Assert.Equal(JsonValueKind.Null, viewOnly.GetProperty("Draft").ValueKind);
        permissions.Denied.Remove((viewer.Id, "email.enquiries.manage"));
        var preparer = JsonSerializer.SerializeToElement(await service.ReadAsync(viewer.Id, company.Id, genuine.Id, default));
        Assert.Equal(JsonValueKind.Object, preparer.GetProperty("Draft").ValueKind);

        // A draft prepared for a division is hidden from a user restricted to another division.
        var north = new Division { CompanyId = company.Id, Name = "Audit North" }; var south = new Division { CompanyId = company.Id, Name = "Audit South" };
        db.Divisions.AddRange(north, south); await db.SaveChangesAsync();
        var current = await service.PrepareAsync(owner.Id, company.Id, genuine.Id, (await db.EmailEnquiries.AsNoTracking().SingleAsync(e => e.Id == enquiry.Id)).Revision, default);
        current.DivisionId = north.Id;
        await service.SaveDraftAsync(owner.Id, company.Id, genuine.Id, current, default);
        db.UserCompanies.Add(new UserCompany { UserId = viewer.Id, CompanyId = company.Id, AssignedAt = DateTime.UtcNow, RestrictToDivisions = true });
        db.UserDivisions.Add(new UserDivision { UserId = viewer.Id, DivisionId = south.Id, AssignedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        var otherDivision = JsonSerializer.SerializeToElement(await service.ReadAsync(viewer.Id, company.Id, genuine.Id, default));
        Assert.Equal(JsonValueKind.Null, otherDivision.GetProperty("Draft").ValueKind);
        var ownDivision = JsonSerializer.SerializeToElement(await service.ReadAsync(owner.Id, company.Id, genuine.Id, default));
        Assert.Equal(JsonValueKind.Object, ownDivision.GetProperty("Draft").ValueKind);
        db.UserDivisions.RemoveRange(db.UserDivisions.Where(d => d.UserId == viewer.Id));
        db.UserCompanies.RemoveRange(db.UserCompanies.Where(u => u.UserId == viewer.Id));
        await db.SaveChangesAsync();

        // Attachments are fetched live, so only for a company still linked to the mailbox.
        var (bytes, _) = await service.AttachmentAsync(owner.Id, company.Id, genuine.Id, "att-1", default);
        Assert.NotEmpty(bytes);
        db.ChangeTracker.Clear();
        await service.UnlinkAsync(owner.Id, company.Id, link.Id, default);
        Assert.Empty(gmail.Revoked); // still linked to the second company
        await service.ReadAsync(viewer.Id, company.Id, genuine.Id, default); // the kept enquiry stays readable
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.AttachmentAsync(owner.Id, company.Id, genuine.Id, "att-1", default));
        await Assert.ThrowsAsync<EmailWorkspaceException>(() => service.AttachmentAsync(viewer.Id, company.Id, genuine.Id, "att-1", default));
        await service.DecideAsync(owner.Id, second.Id, genuine.Id, new("Kept", null), default);
        (bytes, _) = await service.AttachmentAsync(owner.Id, second.Id, genuine.Id, "att-1", default);
        Assert.NotEmpty(bytes);

        // Disconnected everywhere: the refresh token is revoked at Google as well.
        db.ChangeTracker.Clear();
        var secondLink = await db.GmailCompanyLinks.SingleAsync(l => l.CompanyId == second.Id && l.ConnectionId == mailbox.Id);
        await service.UnlinkAsync(owner.Id, second.Id, secondLink.Id, default);
        Assert.Contains("audit-refresh", gmail.Revoked);
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
        public List<string> Revoked = [];
        public bool IsConfigured => true;
        public string RedirectUri => "http://localhost/email-workspace";
        public string AuthorizationUrl(string state, string challenge) => "https://accounts.google.com/?state=" + state;
        public Task<GmailIdentity> ExchangeAsync(string code, string verifier, CancellationToken ct) => Task.FromResult(new GmailIdentity("audit-subject", "owner@example.com", "audit-refresh"));
        public Task<string> RefreshAsync(string refreshToken, CancellationToken ct) => Task.FromResult("audit-access");
        public Task<string> GetHistoryIdAsync(string accessToken, CancellationToken ct) => Task.FromResult("100");
        public Task<GmailBatch> ListAsync(string accessToken, DateTime since, string? pageToken, CancellationToken ct) => Task.FromResult(new GmailBatch(["genuine", "forged"], null, null));
        public Task<GmailBatch> HistoryAsync(string accessToken, string historyId, string? pageToken, CancellationToken ct) => Task.FromResult(new GmailBatch([], null, "101"));
        public Task<GmailFetchedMessage?> ReadAsync(string accessToken, string id, CancellationToken ct) => Task.FromResult<GmailFetchedMessage?>(
            new(id, "thread-" + id, "buyer@example.com", "Quotation request " + id, DateTime.UtcNow,
                new("", Table, [new("att-1", "rfq.pdf", "application/pdf", 12)]), SenderUnverified: id == "forged"));
        public Task<byte[]> AttachmentAsync(string accessToken, string messageId, string attachmentId, CancellationToken ct) => Task.FromResult(new byte[] { 37, 80, 68, 70 });
        public Task RevokeAsync(string refreshToken, CancellationToken ct) { Revoked.Add(refreshToken); return Task.CompletedTask; }
    }
    private sealed class FakeGuard : ICompanyAccessGuard
    {
        public HashSet<int> Allowed = [];
        public Task<bool> HasAccessAsync(int userId, int companyId) => Task.FromResult(Allowed.Contains(companyId));
        public async Task AssertAccessAsync(int userId, int companyId) { if (!await HasAccessAsync(userId, companyId)) throw new UnauthorizedAccessException(); }
        public Task<HashSet<int>> GetAccessibleCompanyIdsAsync(int userId) => Task.FromResult(Allowed);
        public void InvalidateUser(int userId) { } public void InvalidateAll() { }
    }
    private sealed class FakePermissions : IPermissionService
    {
        public HashSet<(int, string)> Denied = [];
        public Task<bool> HasPermissionAsync(int userId, string permissionKey) => Task.FromResult(!Denied.Contains((userId, permissionKey)));
        public Task<IReadOnlyCollection<string>> GetUserPermissionsAsync(int userId) => Task.FromResult<IReadOnlyCollection<string>>([]);
        public void InvalidateUser(int userId) { } public void InvalidateAll() { }
        public bool IsSeedAdmin(int userId) => false;
        public Task<bool> HasMcpToolAccessAsync(int userId, string toolName) => Task.FromResult(false);
    }
}
