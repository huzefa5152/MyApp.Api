using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;
namespace MyApp.Api.Services.Implementations;

public sealed class EmailWorkspaceException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
public sealed class EmailWorkspaceService(AppDbContext db, ICompanyAccessGuard access, IPermissionService permissions,
    IGmailProvider gmail, IDataProtectionProvider protection, ISalesQuoteService quotes, IDivisionAccessGuard divisions)
{
    private readonly IDataProtector protector = protection.CreateProtector("MyApp.EmailWorkspace.v1");
    public string Protect<T>(T value) => protector.Protect(JsonSerializer.Serialize(value));
    public T Unprotect<T>(string value) => JsonSerializer.Deserialize<T>(protector.Unprotect(value))!;
    private static EmailWorkspaceException Invalid(string message) => new(400, message);
    private static EmailWorkspaceException Missing() => new(404, "Email resource not found.");
    private void Event(int user, int company, string action, int? enquiry = null) =>
        db.EmailWorkspaceEvents.Add(new() { UserId = user, CompanyId = company, Action = action, EnquiryId = enquiry });
    private async Task AssertWorkspaceAccessAsync(int user, int company)
    {
        await access.AssertAccessAsync(user, company);
        if (!await permissions.HasPermissionAsync(user, "email.workspace.use"))
            throw new UnauthorizedAccessException("Email Workspace module is not assigned.");
    }
    public async Task<object> CustomersAsync(int user, int company)
    {
        await AssertWorkspaceAccessAsync(user, company);
        return await db.Clients.AsNoTracking().Where(c => c.CompanyId == company).OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.Name }).ToListAsync();
    }
    public async Task<object> StatusAsync(int user, int company)
    {
        await AssertWorkspaceAccessAsync(user, company);
        var links = await db.GmailCompanyLinks.AsNoTracking().Include(l => l.Connection).Where(l => l.CompanyId == company).ToListAsync();
        var canRemove = permissions.IsSeedAdmin(user);
        var visible = new List<object>();
        foreach (var link in links)
        {
            var owner = link.Connection.OwnerUserId == user;
            if (!owner && !canRemove && !await OwnerCanSyncAsync(link.Connection, company)) continue;
            if (!owner && !canRemove && !link.ShareMatchingEmails && !await db.EmailEnquiries.AnyAsync(e => e.CompanyId == company && e.Message.ConnectionId == link.ConnectionId && e.Decision == "Kept")) continue;
            visible.Add(new { link.Id, link.ConnectionId, link.CompanyId, link.ShareMatchingEmails, link.IsEnabled,
                link.Connection.EmailAddress, link.Connection.Status, link.Connection.LastError, link.Connection.LastSyncedAt,
                link.Connection.BackfillComplete, IsOwner = owner, Rules = owner ? EmailWorkspaceRules.Read(link.RulesJson) : null });
        }
        var own = await db.GmailConnections.AsNoTracking().Where(c => c.OwnerUserId == user)
            .Select(c => new { c.Id, c.EmailAddress, c.Status }).ToListAsync();
        return new { Configured = gmail.IsConfigured, Links = visible, OwnConnections = own, CanPermanentlyRemove = canRemove };
    }
    public async Task<object> StartAsync(int user, int company, CancellationToken ct)
    {
        await AssertWorkspaceAccessAsync(user, company);
        if (!gmail.IsConfigured) throw new EmailWorkspaceException(503, "Gmail setup is not complete. Ask the installation administrator to configure Google OAuth.");
        var state = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var verifier = Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(48));
        var challenge = Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        await db.GmailOAuthRequests.Where(r => r.ExpiresAt < DateTime.UtcNow).ExecuteDeleteAsync(ct);
        db.GmailOAuthRequests.Add(new() { StateHash = Hash(state), UserId = user, CompanyId = company,
            ProtectedVerifier = Protect(verifier), ExpiresAt = DateTime.UtcNow.AddMinutes(10) });
        await db.SaveChangesAsync(ct);
        return new { AuthorizationUrl = gmail.AuthorizationUrl(state, challenge) };
    }
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public async Task<object> CompleteAsync(int user, GmailCompleteDto dto, CancellationToken ct)
    {
        var hash = Hash(dto.State);
        var pending = await db.GmailOAuthRequests.AsNoTracking().SingleOrDefaultAsync(r => r.StateHash == hash && r.UserId == user && !r.Used && r.ExpiresAt > DateTime.UtcNow, ct) ?? throw Invalid("Gmail authorization expired or was already used. Start again.");
        await AssertWorkspaceAccessAsync(user, pending.CompanyId);
        if (await db.GmailOAuthRequests.Where(r => r.StateHash == hash && !r.Used && r.ExpiresAt > DateTime.UtcNow)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.Used, true), ct) != 1) throw Invalid("Gmail authorization was already used.");
        var identity = await gmail.ExchangeAsync(dto.Code, Unprotect<string>(pending.ProtectedVerifier), ct);
        access.InvalidateUser(user);
        permissions.InvalidateUser(user);
        await AssertWorkspaceAccessAsync(user, pending.CompanyId);
        if (!await permissions.HasPermissionAsync(user, "email.connections.manage")) throw new UnauthorizedAccessException("Connection permission was revoked.");
        var connection = await db.GmailConnections.SingleOrDefaultAsync(c => c.OwnerUserId == user && c.GoogleSubject == identity.Subject, ct);
        if (connection == null)
        {
            if (await db.GmailConnections.CountAsync(c => c.OwnerUserId == user, ct) >= 20) throw Invalid("A user can connect up to 20 Gmail accounts.");
            connection = new() { OwnerUserId = user, GoogleSubject = identity.Subject, EmailAddress = identity.Email };
            db.GmailConnections.Add(connection);
        }
        connection.ProtectedRefreshToken = Protect(identity.RefreshToken);
        connection.Status = "Connected"; connection.LastError = null; connection.NextSyncAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await LinkAsync(user, pending.CompanyId, connection.Id, ct);
        return new { pending.CompanyId, connection.Id, connection.EmailAddress };
    }
    public async Task LinkAsync(int user, int company, int connectionId, CancellationToken ct)
    {
        await AssertWorkspaceAccessAsync(user, company);
        if (!await db.GmailConnections.AnyAsync(c => c.Id == connectionId && c.OwnerUserId == user, ct)) throw Missing();
        var link = await db.GmailCompanyLinks.SingleOrDefaultAsync(l => l.CompanyId == company && l.ConnectionId == connectionId, ct);
        if (link == null) db.GmailCompanyLinks.Add(new() { CompanyId = company, ConnectionId = connectionId });
        else link.IsEnabled = true;
        Event(user, company, "GmailLinked");
        await db.SaveChangesAsync(ct);
    }
    private async Task<GmailCompanyLink> OwnedLinkAsync(int user, int company, int linkId, CancellationToken ct)
    {
        await AssertWorkspaceAccessAsync(user, company);
        return await db.GmailCompanyLinks.Include(l => l.Connection).SingleOrDefaultAsync(l => l.Id == linkId && l.CompanyId == company && l.Connection.OwnerUserId == user, ct) ?? throw Missing();
    }
    public async Task SettingsAsync(int user, int company, int linkId, EmailLinkSettingsDto dto, CancellationToken ct)
    {
        var link = await OwnedLinkAsync(user, company, linkId, ct);
        if (dto.Rules.Count > 100) throw Invalid("Use at most 100 sender rules.");
        foreach (var rule in dto.Rules)
        {
            try { rule.Sender = EmailWorkspaceRules.NormalizeAddress(rule.Sender); }
            catch (ArgumentException) { throw Invalid("A sender rule contains an invalid email address."); }
            if (rule.ClientId.HasValue && !await db.Clients.AnyAsync(c => c.Id == rule.ClientId && c.CompanyId == company, ct)) throw Invalid("The selected customer does not belong to this company.");
        }
        link.RulesJson = JsonSerializer.Serialize(dto.Rules); link.ShareMatchingEmails = dto.ShareMatchingEmails;
        Event(user, company, "GmailRulesUpdated");
        await db.SaveChangesAsync(ct);
    }
    public async Task UnlinkAsync(int user, int company, int linkId, CancellationToken ct)
    {
        var link = await OwnedLinkAsync(user, company, linkId, ct);
        link.IsEnabled = false; link.ShareMatchingEmails = false;
        Event(user, company, "GmailUnlinked"); await db.SaveChangesAsync(ct);
        if (!await db.GmailCompanyLinks.AnyAsync(l => l.ConnectionId == link.ConnectionId && l.IsEnabled, ct))
        {
            link.Connection.ProtectedRefreshToken = ""; link.Connection.Status = "Disconnected";
            await db.SaveChangesAsync(ct);
        }
    }
    public async Task RemoveCompanyConnectionAsync(int user, int company, int linkId, CancellationToken ct)
    {
        if (!permissions.IsSeedAdmin(user)) throw new UnauthorizedAccessException();
        await AssertWorkspaceAccessAsync(user, company);
        if (!await permissions.HasPermissionAsync(user, "email.connections.manage")) throw new UnauthorizedAccessException();
        await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var link = await db.GmailCompanyLinks.AsNoTracking().Include(l => l.Connection)
            .SingleOrDefaultAsync(l => l.Id == linkId && l.CompanyId == company, ct) ?? throw Missing();
        if (link.Connection.SyncLeaseUntil > DateTime.UtcNow)
            throw new EmailWorkspaceException(409, "This mailbox is syncing. Wait for sync to finish before permanently removing its company connection.");
        var enquiries = db.EmailEnquiries.Where(e => e.CompanyId == company && e.Message.ConnectionId == link.ConnectionId);
        await db.EmailWorkspaceEvents.Where(e => e.CompanyId == company && e.EnquiryId != null && enquiries.Select(q => q.Id).Contains(e.EnquiryId.Value)).ExecuteDeleteAsync(ct);
        // Quotations are independent documents; deleting their source enquiries detaches email lineage only.
        await enquiries.ExecuteDeleteAsync(ct);
        await db.GmailCompanyLinks.Where(l => l.Id == linkId && l.CompanyId == company).ExecuteDeleteAsync(ct);
        if (!await db.GmailCompanyLinks.AnyAsync(l => l.ConnectionId == link.ConnectionId, ct))
        {
            // A remaining company's kept enquiries still need their shared mailbox content.
            await db.GmailMessages.Where(m => m.ConnectionId == link.ConnectionId && !db.EmailEnquiries.Any(e => e.MessageId == m.Id)).ExecuteDeleteAsync(ct);
            if (!await db.GmailMessages.AnyAsync(m => m.ConnectionId == link.ConnectionId, ct))
                await db.GmailConnections.Where(c => c.Id == link.ConnectionId).ExecuteDeleteAsync(ct);
            else
                await db.GmailConnections.Where(c => c.Id == link.ConnectionId).ExecuteUpdateAsync(s => s
                    .SetProperty(c => c.ProtectedRefreshToken, "").SetProperty(c => c.Status, "Disconnected")
                    .SetProperty(c => c.PageToken, (string?)null).SetProperty(c => c.HistoryId, (string?)null)
                    .SetProperty(c => c.LastError, (string?)null), ct);
        }
        Event(user, company, "GmailCompanyPermanentlyRemoved");
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }
    private async Task<bool> OwnerCanSyncAsync(GmailConnection connection, int? company = null)
    {
        if (!await db.Users.AsNoTracking().AnyAsync(u => u.Id == connection.OwnerUserId)) return false;
        if (!await permissions.HasPermissionAsync(connection.OwnerUserId, "email.workspace.use")) return false;
        if (!await permissions.HasPermissionAsync(connection.OwnerUserId, "email.connections.manage")) return false;
        if (company.HasValue) return await access.HasAccessAsync(connection.OwnerUserId, company.Value);
        var allowed = await access.GetAccessibleCompanyIdsAsync(connection.OwnerUserId);
        return await db.GmailCompanyLinks.AnyAsync(l => l.ConnectionId == connection.Id && l.IsEnabled && allowed.Contains(l.CompanyId));
    }
    public async Task SyncForUserAsync(int user, int company, int connectionId, CancellationToken ct)
    {
        await AssertWorkspaceAccessAsync(user, company);
        if (!await db.GmailCompanyLinks.AnyAsync(l => l.ConnectionId == connectionId && l.CompanyId == company && l.IsEnabled && l.Connection.OwnerUserId == user, ct)) throw Missing();
        await SyncAsync(connectionId, ct);
    }
    public async Task SyncAsync(int connectionId, CancellationToken ct)
    {
        var now = DateTime.UtcNow; var leaseId = Guid.NewGuid();
        var claimed = await db.GmailConnections.Where(c => c.Id == connectionId && c.Status == "Connected" && (c.SyncLeaseUntil == null || c.SyncLeaseUntil < now))
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.SyncLeaseUntil, now.AddMinutes(10)).SetProperty(c => c.SyncLeaseId, leaseId), ct);
        if (claimed == 0) return;
        try
        {
            var connection = await db.GmailConnections.SingleAsync(c => c.Id == connectionId, ct);
            if (!await OwnerCanSyncAsync(connection)) return;
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct); deadline.CancelAfter(TimeSpan.FromMinutes(4));
            var token = await gmail.RefreshAsync(Unprotect<string>(connection.ProtectedRefreshToken), deadline.Token);
            if (connection.HistoryId == null) connection.HistoryId = await gmail.GetHistoryIdAsync(token, deadline.Token);
            GmailBatch batch;
            try
            {
                batch = connection.BackfillComplete
                    ? await gmail.HistoryAsync(token, connection.HistoryId, connection.PageToken, deadline.Token)
                    : await gmail.ListAsync(token, connection.BackfillSince, connection.PageToken, deadline.Token);
            }
            catch (GmailProviderException e) when (e.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.BadRequest)
            {
                connection.BackfillComplete = false; connection.PageToken = null;
                connection.HistoryId = await gmail.GetHistoryIdAsync(token, deadline.Token);
                await db.SaveChangesAsync(deadline.Token); return;
            }
            foreach (var id in batch.MessageIds.Distinct())
            {
                if (await db.GmailMessages.AnyAsync(m => m.ConnectionId == connectionId && m.ProviderMessageId == id, deadline.Token)) continue;
                var fetched = await gmail.ReadAsync(token, id, deadline.Token);
                if (fetched == null) continue;
                db.GmailMessages.Add(new() { ConnectionId = connectionId, ProviderMessageId = fetched.Id, ThreadId = fetched.ThreadId,
                    Sender = fetched.Sender, Subject = fetched.Subject, ReceivedAt = fetched.ReceivedAt, ProtectedContent = Protect(fetched.Content) });
            }
            access.InvalidateUser(connection.OwnerUserId);
            permissions.InvalidateUser(connection.OwnerUserId);
            if (!await OwnerCanSyncAsync(connection) || !await db.GmailConnections.AsNoTracking().AnyAsync(c => c.Id == connectionId && c.Status == "Connected" && c.SyncLeaseId == leaseId, ct))
            { db.ChangeTracker.Clear(); return; }
            connection.PageToken = batch.NextPageToken;
            if (!connection.BackfillComplete && batch.NextPageToken == null) connection.BackfillComplete = true;
            if (batch.HistoryId != null && batch.NextPageToken == null) connection.HistoryId = batch.HistoryId;
            connection.LastSyncedAt = DateTime.UtcNow; connection.LastError = null;
            connection.NextSyncAt = DateTime.UtcNow.AddSeconds(batch.NextPageToken == null ? 60 : 5);
            await db.SaveChangesAsync(deadline.Token);
        }
        catch (GmailProviderException e) when (e.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.BadRequest)
        {
            db.ChangeTracker.Clear();
            await db.GmailConnections.Where(c => c.Id == connectionId && c.SyncLeaseId == leaseId)
                .ExecuteUpdateAsync(s => s.SetProperty(c => c.Status, "ReconnectRequired").SetProperty(c => c.LastError, "Gmail access expired. Reconnect this account."), ct);
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            db.ChangeTracker.Clear();
            await db.GmailConnections.Where(c => c.Id == connectionId && c.SyncLeaseId == leaseId)
                .ExecuteUpdateAsync(s => s.SetProperty(c => c.LastError, "Gmail sync could not finish. It will retry.")
                    .SetProperty(c => c.NextSyncAt, DateTime.UtcNow.AddMinutes(5)), ct);
        }
        finally
        {
            await db.GmailConnections.Where(c => c.Id == connectionId && c.SyncLeaseId == leaseId)
                .ExecuteUpdateAsync(s => s.SetProperty(c => c.SyncLeaseUntil, (DateTime?)null).SetProperty(c => c.SyncLeaseId, (Guid?)null), CancellationToken.None);
        }
    }
    private async Task<IQueryable<GmailMessage>> VisibleAsync(int user, int company, CancellationToken ct)
    {
        await AssertWorkspaceAccessAsync(user, company);
        var links = await db.GmailCompanyLinks.AsNoTracking().Include(l => l.Connection).Where(l => l.CompanyId == company).ToListAsync(ct);
        var owned = new List<int>();
        var shared = new List<int>();
        foreach (var link in links)
        {
            if (!link.IsEnabled || !await OwnerCanSyncAsync(link.Connection, company)) continue;
            if (link.Connection.OwnerUserId == user)
                owned.Add(link.ConnectionId);
            else if (link.ShareMatchingEmails) shared.Add(link.ConnectionId);
        }
        // JSON is joined in SQL to keep rule count from multiplying SQL parameters.
        var matching = MatchingMessages(company).Where(m => shared.Contains(m.ConnectionId)).Select(m => m.Id);
        var ids = db.EmailEnquiries.Where(e => e.CompanyId == company && e.Decision == "Kept").Select(e => e.MessageId)
            .Union(db.GmailMessages.Where(m => owned.Contains(m.ConnectionId)).Select(m => m.Id)).Union(matching);
        return db.GmailMessages.AsNoTracking().Where(m => ids.Contains(m.Id));
    }
    private IQueryable<GmailMessage> MatchingMessages(int company) => db.GmailMessages.FromSqlInterpolated($"""
            SELECT m.* FROM GmailMessages m WHERE EXISTS (
            SELECT 1 FROM GmailCompanyLinks l
            CROSS APPLY OPENJSON(l.RulesJson) WITH (Sender nvarchar(320) '$.Sender', SubjectContains nvarchar(200) '$.SubjectContains') r
            WHERE l.ConnectionId = m.ConnectionId AND l.CompanyId = {company} AND l.IsEnabled = 1
              AND LOWER(m.Sender) = LOWER(r.Sender)
              AND (r.SubjectContains IS NULL OR r.SubjectContains = '' OR CHARINDEX(LOWER(r.SubjectContains), LOWER(m.Subject)) > 0))
            """);
    public async Task<object> ListAsync(int user, int company, string? filter, string? search, int page, int pageSize, CancellationToken ct)
    {
        var visible = await VisibleAsync(user, company, ct);
        var suggested = MatchingMessages(company).Select(m => m.Id);
        var query = from m in visible
                    join e in db.EmailEnquiries.AsNoTracking().Where(e => e.CompanyId == company) on m.Id equals e.MessageId into enquiries
                    from e in enquiries.DefaultIfEmpty()
                    select new { m.Id, m.ConnectionId, m.Sender, m.Subject, m.ReceivedAt,
                        Decision = e == null ? "Unreviewed" : e.Decision, EnquiryId = e == null ? (int?)null : e.Id,
                        SalesQuoteId = e == null ? null : e.SalesQuoteId, SalesQuoteNumber = e == null ? null : e.SalesQuoteNumber,
                        Revision = e == null ? (Guid?)null : e.Revision,
                        IsSuggested = suggested.Contains(m.Id) || m.Subject.ToLower().Contains("quotation") || m.Subject.ToLower().Contains("quote") || m.Subject.ToLower().Contains("rfq") || m.Subject.ToLower().Contains("requirement") || m.Subject.ToLower().Contains("indent") };
        if (filter == "Converted") query = query.Where(x => x.SalesQuoteId != null);
        else if (filter is "Kept" or "Ignored" or "Unreviewed") query = query.Where(x => x.Decision == filter && x.SalesQuoteId == null);
        else query = query.Where(x => x.Decision != "Ignored");
        if (filter == "Suggested") query = query.Where(x => x.IsSuggested && x.SalesQuoteId == null);
        if (!string.IsNullOrWhiteSpace(search)) query = query.Where(x => x.Subject.Contains(search) || x.Sender.Contains(search));
        var count = await query.CountAsync(ct);
        var items = await query.OrderByDescending(x => x.ReceivedAt).ThenByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return new { Items = items, TotalCount = count, Page = page, PageSize = pageSize };
    }
    public async Task<GmailMessage> MessageAsync(int user, int company, int id, CancellationToken ct) =>
        await (await VisibleAsync(user, company, ct)).SingleOrDefaultAsync(m => m.Id == id, ct) ?? throw Missing();
    public async Task<object> ReadAsync(int user, int company, int id, CancellationToken ct)
    {
        var m = await MessageAsync(user, company, id, ct);
        var content = Unprotect<EmailContent>(m.ProtectedContent);
        var enquiry = await db.EmailEnquiries.AsNoTracking().SingleOrDefaultAsync(e => e.CompanyId == company && e.MessageId == id, ct);
        return new { m.Id, m.Subject, m.Sender, m.ReceivedAt, Text = EmailEnquiryExtractor.PlainText(content),
            content.Attachments, Decision = enquiry?.Decision ?? "Unreviewed", enquiry?.SalesQuoteId, enquiry?.SalesQuoteNumber,
            enquiry?.Revision, Draft = enquiry?.ProtectedDraft.Length > 0 ? Unprotect<EmailDraftDto>(enquiry.ProtectedDraft) : null };
    }
    private static void AssertRevision(EmailEnquiry? enquiry, Guid? revision)
    {
        if (enquiry != null && enquiry.Revision != revision) throw new EmailWorkspaceException(409, "This enquiry changed in another session. Reload before saving.");
    }
    public async Task<object> DecideAsync(int user, int company, int id, EmailDecisionDto dto, CancellationToken ct)
    {
        await MessageAsync(user, company, id, ct);
        if (dto.Decision is not ("Kept" or "Ignored" or "Unreviewed")) throw Invalid("Choose Keep, Ignore or Restore.");
        var enquiry = await db.EmailEnquiries.SingleOrDefaultAsync(e => e.CompanyId == company && e.MessageId == id, ct);
        AssertRevision(enquiry, dto.Revision);
        if (enquiry?.SalesQuoteId != null) throw Invalid("A converted enquiry cannot be ignored or restored.");
        if (enquiry == null)
        {
            enquiry = new() { CompanyId = company, MessageId = id };
            db.EmailEnquiries.Add(enquiry);
        }
        enquiry.Decision = dto.Decision; enquiry.DecidedByUserId = user; enquiry.UpdatedAt = DateTime.UtcNow; enquiry.Revision = Guid.NewGuid();
        Event(user, company, "Email" + dto.Decision);
        await db.SaveChangesAsync(ct);
        return new { enquiry.Revision, enquiry.Decision };
    }
    public async Task<EmailDraftDto> PrepareAsync(int user, int company, int id, Guid? revision, CancellationToken ct)
    {
        var m = await MessageAsync(user, company, id, ct);
        var enquiry = await db.EmailEnquiries.SingleOrDefaultAsync(e => e.CompanyId == company && e.MessageId == id, ct) ?? throw Invalid("Keep this enquiry first.");
        if (enquiry.Decision != "Kept" || enquiry.SalesQuoteId != null) throw Invalid("Only kept, unconverted enquiries can be prepared.");
        AssertRevision(enquiry, revision);
        if (enquiry.ProtectedDraft.Length > 0)
        {
            var existing = Unprotect<EmailDraftDto>(enquiry.ProtectedDraft); existing.Revision = enquiry.Revision; return existing;
        }
        var draft = EmailEnquiryExtractor.Extract(m.Subject, Unprotect<EmailContent>(m.ProtectedContent));
        draft.Date = DateTime.UtcNow.AddHours(5).Date;
        var link = await db.GmailCompanyLinks.AsNoTracking().SingleAsync(l => l.CompanyId == company && l.ConnectionId == m.ConnectionId, ct);
        var candidates = EmailWorkspaceRules.Read(link.RulesJson).Where(r => r.ClientId != null && EmailWorkspaceRules.Matches(r, m.Sender, m.Subject)).Select(r => r.ClientId).Distinct().ToList();
        if (candidates.Count == 1 && await db.Clients.AnyAsync(c => c.Id == candidates[0] && c.CompanyId == company, ct)) draft.ClientId = candidates[0];
        else draft.Warnings.Add("Confirm the customer. The sender may be a forwarder.");
        enquiry.Revision = Guid.NewGuid(); draft.Revision = enquiry.Revision; enquiry.ProtectedDraft = Protect(draft);
        Event(user, company, "EnquiryPrepared", enquiry.Id); await db.SaveChangesAsync(ct);
        return draft;
    }
    public async Task<EmailDraftDto> ReextractAsync(int user, int company, int id, Guid? revision, CancellationToken ct)
    {
        var message = await MessageAsync(user, company, id, ct);
        if (!await permissions.HasPermissionAsync(user, "email.enquiries.manage")) throw new UnauthorizedAccessException();
        var enquiry = await db.EmailEnquiries.SingleOrDefaultAsync(e => e.CompanyId == company && e.MessageId == id, ct) ?? throw Missing();
        await db.Entry(enquiry).ReloadAsync(ct);
        if (enquiry.Decision != "Kept" || enquiry.SalesQuoteId != null) throw Invalid("Only kept, unconverted enquiries can be re-read.");
        AssertRevision(enquiry, revision);
        var extracted = EmailEnquiryExtractor.Extract(message.Subject, Unprotect<EmailContent>(message.ProtectedContent));
        extracted.Date = DateTime.UtcNow.AddHours(5).Date;
        var draft = enquiry.ProtectedDraft.Length > 0 ? Unprotect<EmailDraftDto>(enquiry.ProtectedDraft) : extracted;
        await AssertDraftDivisionAsync(user, company, draft.DivisionId, ct);
        draft.Items = extracted.Items; draft.Warnings = extracted.Warnings;
        draft.RequiresBrand = extracted.RequiresBrand; draft.RequiresSpecifications = extracted.RequiresSpecifications;
        draft.Reviewed = false; draft.SpecificationsConfirmed = false;
        draft.CustomerEnquiryRef ??= extracted.CustomerEnquiryRef;
        enquiry.Revision = Guid.NewGuid(); draft.Revision = enquiry.Revision;
        enquiry.ProtectedDraft = Protect(draft); enquiry.UpdatedAt = DateTime.UtcNow;
        Event(user, company, "EmailItemsReextracted", enquiry.Id);
        await db.SaveChangesAsync(ct);
        return draft;
    }
    private async Task AssertDraftDivisionAsync(int user, int company, int? division, CancellationToken ct)
    {
        if (division.HasValue && !await db.Divisions.AnyAsync(d => d.Id == division.Value && d.CompanyId == company, ct))
            throw Invalid("Division must belong to this company.");
        divisions.InvalidateUser(user);
        await divisions.AssertWriteAccessAsync(user, company, division);
    }
    public async Task<object> SaveDraftAsync(int user, int company, int id, EmailDraftDto draft, CancellationToken ct)
    {
        await MessageAsync(user, company, id, ct);
        var e = await db.EmailEnquiries.SingleOrDefaultAsync(e => e.CompanyId == company && e.MessageId == id, ct) ?? throw Missing();
        AssertRevision(e, draft.Revision);
        if (e.Decision != "Kept" || e.SalesQuoteId != null) throw Invalid("Only kept, unconverted enquiries can be edited.");
        if (draft.Items.Count > 200) throw Invalid("Use at most 200 items.");
        if (draft.ClientId.HasValue && !await db.Clients.AnyAsync(c => c.Id == draft.ClientId && c.CompanyId == company, ct)) throw Invalid("Customer must belong to this company.");
        await AssertDraftDivisionAsync(user, company, draft.DivisionId, ct);
        var requirements = e.ProtectedDraft.Length > 0 ? Unprotect<EmailDraftDto>(e.ProtectedDraft) : new();
        draft.RequiresBrand = requirements.RequiresBrand; draft.RequiresSpecifications = requirements.RequiresSpecifications; draft.Warnings = requirements.Warnings;
        e.Revision = Guid.NewGuid(); draft.Revision = e.Revision; e.ProtectedDraft = Protect(draft); e.UpdatedAt = DateTime.UtcNow;
        Event(user, company, "EnquirySaved", e.Id); await db.SaveChangesAsync(ct);
        return new { e.Revision };
    }
    public async Task<object> ConvertAsync(int user, int company, int id, EmailDraftDto draft, CancellationToken ct)
    {
        await MessageAsync(user, company, id, ct);
        if (!await permissions.HasPermissionAsync(user, "salesquotes.manage.create")) throw new UnauthorizedAccessException("Quotation permission is required.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var e = await db.EmailEnquiries.FromSqlInterpolated(
            $"SELECT * FROM EmailEnquiries WITH (UPDLOCK, HOLDLOCK) WHERE CompanyId = {company} AND MessageId = {id}").SingleOrDefaultAsync(ct) ?? throw Missing();
        if (e.SalesQuoteId != null)
        {
            var existing = await db.SalesQuotes.AsNoTracking().SingleAsync(q => q.Id == e.SalesQuoteId && q.CompanyId == company, ct);
            divisions.InvalidateUser(user);
            await divisions.AssertAccessAsync(user, company, existing.DivisionId);
            return new { Id = e.SalesQuoteId.Value, QuoteNumber = e.SalesQuoteNumber, AlreadyCreated = true };
        }
        AssertRevision(e, draft.Revision);
        if (e.Decision != "Kept" || e.ProtectedDraft.Length == 0) throw Invalid("Prepare this enquiry first.");
        var requirements = Unprotect<EmailDraftDto>(e.ProtectedDraft);
        var errors = EmailWorkspaceRules.ValidateDraft(draft, requirements.RequiresBrand, requirements.RequiresSpecifications);
        if (errors.Count > 0) throw Invalid(string.Join(" ", errors));
        await AssertWorkspaceAccessAsync(user, company);
        if (!await db.Clients.AnyAsync(c => c.Id == draft.ClientId && c.CompanyId == company, ct)) throw Invalid("Customer must belong to this company.");
        await AssertDraftDivisionAsync(user, company, draft.DivisionId, ct);
        var created = await quotes.CreateAsync(company, new SalesQuoteDto
        {
            ClientId = draft.ClientId!.Value, Date = draft.Date, ValidUntil = draft.ValidUntil,
            CustomerEnquiryRef = draft.CustomerEnquiryRef, EnquiryDate = DateTime.SpecifyKind((await db.GmailMessages.AsNoTracking().SingleAsync(m => m.Id == id, ct)).ReceivedAt, DateTimeKind.Utc).AddHours(5).Date,
            DivisionId = draft.DivisionId,
            Notes = string.IsNullOrWhiteSpace(draft.ContactPerson) ? draft.Notes : $"Contact: {draft.ContactPerson.Trim()}\n{draft.Notes}".Trim(),
            GSTRate = draft.GSTRate,
            Items = draft.Items.Select(i => new SalesQuoteItemDto { Description = string.IsNullOrWhiteSpace(i.Brand) ? i.Description : i.Description + "\nBrand / make: " + i.Brand.Trim(),
                Quantity = i.Quantity, Unit = i.Unit, UnitPrice = i.UnitPrice!.Value }).ToList()
        });
        e.SalesQuoteId = created.Id; e.SalesQuoteNumber = created.QuoteNumber;
        e.ProtectedDraft = Protect(draft); e.Revision = Guid.NewGuid(); e.UpdatedAt = DateTime.UtcNow;
        Event(user, company, "QuotationCreated", e.Id); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new { created.Id, created.QuoteNumber, AlreadyCreated = false };
    }
    public async Task<(byte[] Bytes, string FileName)> AttachmentAsync(int user, int company, int id, string attachmentId, CancellationToken ct)
    {
        var message = await MessageAsync(user, company, id, ct);
        var info = Unprotect<EmailContent>(message.ProtectedContent).Attachments.SingleOrDefault(a => a.Id == attachmentId) ?? throw Missing();
        if (info.Size > 10 * 1024 * 1024) throw Invalid("Attachments are limited to 10 MB.");
        var connection = await db.GmailConnections.AsNoTracking().SingleAsync(c => c.Id == message.ConnectionId, ct);
        if (connection.Status != "Connected" || !await OwnerCanSyncAsync(connection, company)) throw Invalid("Reconnect the mailbox to download attachments.");
        var token = await gmail.RefreshAsync(Unprotect<string>(connection.ProtectedRefreshToken), ct);
        var bytes = await gmail.AttachmentAsync(token, message.ProviderMessageId, attachmentId, ct);
        if (bytes.Length > 10 * 1024 * 1024) throw Invalid("Attachments are limited to 10 MB.");
        return (bytes, info.FileName);
    }
}
