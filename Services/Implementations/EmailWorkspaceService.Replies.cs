using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
namespace MyApp.Api.Services.Implementations;
public sealed partial class EmailWorkspaceService
{
    private static bool CanModify(GmailConnection c) => c.GrantedScopes.Split(' ').Contains(GmailProvider.ModifyScope);
    private async Task<GmailConnection> OwnedActiveMailboxAsync(int user, int company, GmailMessage message, CancellationToken ct)
    {
        access.InvalidateUser(user); permissions.InvalidateUser(user);
        await AssertWorkspaceAccessAsync(user, company);
        if (!await permissions.HasPermissionAsync(user,"email.inbox.view")) throw new UnauthorizedAccessException();
        var link = await db.GmailCompanyLinks.AsNoTracking().Include(l => l.Connection).SingleOrDefaultAsync(l => l.CompanyId == company && l.ConnectionId == message.ConnectionId && l.IsEnabled, ct);
        if (link == null || (link.Connection.OwnerUserId != user && !link.AllowCompanyReplies) || link.Connection.Status != "Connected" || !await OwnerCanSyncAsync(link.Connection, company))
            throw new UnauthorizedAccessException("This mailbox has not authorized company Gmail actions.");
        return link.Connection;
    }
    public async Task<object> ConversationAsync(int user, int company, int id, CancellationToken ct)
    {
        var anchor = await MessageAsync(user, company, id, ct);
        var owner = await db.GmailConnections.AsNoTracking().SingleAsync(c => c.Id == anchor.ConnectionId, ct);
        var linkActive = await db.GmailCompanyLinks.AnyAsync(l => l.ConnectionId == owner.Id && l.CompanyId == company && l.IsEnabled, ct);
        List<GmailFetchedMessage> messages;
        if (owner.OwnerUserId == user && owner.Status == "Connected" && linkActive && await OwnerCanSyncAsync(owner,company)) {
            var token = await gmail.RefreshAsync(Unprotect<string>(owner.ProtectedRefreshToken),ct);
            messages = await gmail.ThreadAsync(token,anchor.ThreadId,ct);
            await OwnedActiveMailboxAsync(user,company,anchor,ct);
            if (messages.Any(m => m.ThreadId != anchor.ThreadId)) throw Invalid("The mailbox returned a different conversation.");
            var latest = messages.FirstOrDefault(m => m.Id == anchor.ProviderMessageId);
            if (latest != null) await db.GmailMessages.Where(m => m.Id == id).ExecuteUpdateAsync(s => s.SetProperty(m => m.IsUnread,latest.IsUnread).SetProperty(m => m.LabelsSyncedAt,DateTime.UtcNow),ct);
        } else {
            var visible = await VisibleAsync(user,company,ct);
            var cached = await visible.Where(m => m.ConnectionId == anchor.ConnectionId && m.ThreadId == anchor.ThreadId).OrderBy(m => m.ReceivedAt).ToListAsync(ct);
            messages = cached.Select(m => new GmailFetchedMessage(m.ProviderMessageId,m.ThreadId,m.Sender,m.Subject,m.ReceivedAt,Unprotect<EmailContent>(m.ProtectedContent),m.SenderUnverified,m.IsUnread)).ToList();
            var visibleIds = cached.Select(m => m.Id).ToList();
            var sentReplies = await db.EmailReplyAttempts.AsNoTracking().Where(a => a.CompanyId == company && a.ConnectionId == owner.Id && visibleIds.Contains(a.MessageId) && a.Status == "Sent").OrderBy(a => a.SentAt).ToListAsync(ct);
            foreach (var sent in sentReplies) {
                var preview = Unprotect<EmailReplyPreview>(sent.ProtectedPreview);
                messages.Add(new GmailFetchedMessage(sent.ProviderMessageId ?? sent.Id.ToString(),anchor.ThreadId,owner.EmailAddress,preview.Subject,sent.SentAt ?? sent.CreatedAt,new EmailContent(preview.Text,preview.Html,[]),false,false));
            }
            messages = messages.OrderBy(m => m.ReceivedAt).ToList();
        }
        await MessageAsync(user,company,id,ct);
        var delegated = await db.GmailCompanyLinks.AnyAsync(l => l.ConnectionId == owner.Id && l.CompanyId == company && l.IsEnabled && l.AllowCompanyReplies,ct);
        var available = owner.Status == "Connected" && linkActive && await OwnerCanSyncAsync(owner,company);
        var pendingReplyId = await db.EmailReplyAttempts.AsNoTracking().Where(a => a.CompanyId == company && a.UserId == user && a.MessageId == id && (a.Status == "Sending" || a.Status == "Uncertain")).OrderByDescending(a => a.CreatedAt).Select(a => (Guid?)a.Id).FirstOrDefaultAsync(ct);
        return new { CanReply = available && (owner.OwnerUserId == user || delegated) && CanModify(owner) && await permissions.HasPermissionAsync(user,"email.replies.send"),
            CanChangeRead = available && (owner.OwnerUserId == user || delegated) && CanModify(owner) && await permissions.HasPermissionAsync(user,"email.read.manage"),
            NeedsUpgrade = owner.OwnerUserId == user && !CanModify(owner), ConnectionId = owner.Id,
            LimitedToSharedMessages = owner.OwnerUserId != user,
            PendingReplyId=pendingReplyId,
            Messages = messages.Select(m => new { ProviderId=m.Id,m.Sender,m.Subject,m.ReceivedAt,m.IsUnread, CanReplyToMessage=owner.OwnerUserId == user || m.Sender != owner.EmailAddress, Text=EmailReplyRules.CurrentText(m.Content), Html=m.Content.Html, m.Content.Attachments, IsCurrent=m.Id==anchor.ProviderMessageId, SuggestedItems=EmailEnquiryExtractor.Extract(m.Subject,EmailReplyRules.CurrentContent(m.Content)).Items }) };
    }
    public async Task SetReadStatusAsync(int user,int company,int id,bool unread,CancellationToken ct)
    {
        if (!await permissions.HasPermissionAsync(user,"email.read.manage")) throw new UnauthorizedAccessException();
        var message = await MessageAsync(user,company,id,ct);
        var mailbox = await OwnedActiveMailboxAsync(user,company,message,ct);
        if (!CanModify(mailbox)) throw Invalid("Enable replies and Gmail read-status access in Connections first.");
        var token = await gmail.RefreshAsync(Unprotect<string>(mailbox.ProtectedRefreshToken),ct);
        await OwnedActiveMailboxAsync(user,company,message,ct);
        await gmail.SetUnreadAsync(token,message.ProviderMessageId,unread,ct);
        await db.GmailMessages.Where(m => m.Id == id).ExecuteUpdateAsync(s => s.SetProperty(m => m.IsUnread,(bool?)unread).SetProperty(m => m.LabelsSyncedAt,DateTime.UtcNow),ct);
    }
    public async Task<EmailReplyPreview> PreviewReplyAsync(int user,int company,int id,EmailReplyDraftDto draft,CancellationToken ct)
    {
        if (!await permissions.HasPermissionAsync(user,"email.replies.send")) throw new UnauthorizedAccessException();
        var message = await MessageAsync(user,company,id,ct);
        var mailbox = await OwnedActiveMailboxAsync(user,company,message,ct);
        if (!CanModify(mailbox)) throw Invalid("Enable replies for this Gmail account first.");
        if (await db.EmailReplyAttempts.AnyAsync(a => a.CompanyId==company && a.UserId==user && a.MessageId==id && (a.Status=="Sending" || a.Status=="Uncertain"),ct))
            throw Invalid("Check the previous reply status before preparing another reply.");
        if (message.SenderUnverified) throw Invalid("This sender failed authentication. Review this message in Gmail before replying.");
        var token = await gmail.RefreshAsync(Unprotect<string>(mailbox.ProtectedRefreshToken),ct);
        if (mailbox.OwnerUserId != user && !string.IsNullOrWhiteSpace(draft.TargetProviderMessageId)
            && !await (await VisibleAsync(user,company,ct)).AnyAsync(m => m.ConnectionId==message.ConnectionId && m.ThreadId==message.ThreadId && m.ProviderMessageId==draft.TargetProviderMessageId,ct)) throw Missing();
        var live = mailbox.OwnerUserId != user
            ? await gmail.ReadAsync(token,draft.TargetProviderMessageId ?? message.ProviderMessageId,ct)
            : string.IsNullOrWhiteSpace(draft.TargetProviderMessageId)
            ? await gmail.ReadAsync(token,message.ProviderMessageId,ct)
            : (await gmail.ThreadAsync(token,message.ThreadId,ct)).FirstOrDefault(m => m.Id == draft.TargetProviderMessageId);
        if (live == null) throw Missing();
        if (live.SenderUnverified || live.ThreadId != message.ThreadId) throw Invalid("Refresh and verify this message before replying.");
        EmailReplyPreview preview;
        try { preview = EmailReplyRules.Build(Guid.NewGuid(),live,mailbox.EmailAddress,draft); }
        catch (Exception e) when (e is InvalidOperationException or FormatException) { throw Invalid("Review the enquiry, recipients and all item prices before previewing this reply."); }
        await OwnedActiveMailboxAsync(user,company,message,ct);
        db.EmailReplyAttempts.Add(new() {Id=preview.Id,CompanyId=company,UserId=user,ConnectionId=mailbox.Id,MessageId=id,ProtectedPreview=Protect(preview)});
        await db.SaveChangesAsync(ct);
        return preview;
    }
    private async Task<EmailReplyAttempt> ReplyAttemptAsync(int user,int company,Guid id,CancellationToken ct)
    {
        await AssertWorkspaceAccessAsync(user,company);
        if (!await permissions.HasPermissionAsync(user,"email.replies.send")) throw new UnauthorizedAccessException();
        var attempt = await db.EmailReplyAttempts.SingleOrDefaultAsync(a => a.Id==id && a.CompanyId==company && a.UserId==user,ct) ?? throw Missing();
        var message = await MessageAsync(user,company,attempt.MessageId,ct);
        if (message.ConnectionId != attempt.ConnectionId) throw Missing();
        await OwnedActiveMailboxAsync(user,company,message,ct);
        return attempt;
    }
    public async Task<object> SendReplyAsync(int user,int company,Guid id,CancellationToken ct)
    {
        var attempt = await ReplyAttemptAsync(user,company,id,ct);
        if (attempt.Status != "Draft") return new {attempt.Id,attempt.Status,attempt.ProviderMessageId};
        if (attempt.CreatedAt < DateTime.UtcNow.AddMinutes(-30)) throw Invalid("This reply preview expired. Review a fresh preview before sending.");
        var mailbox = await db.GmailConnections.AsNoTracking().SingleAsync(c => c.Id==attempt.ConnectionId,ct);
        if (!CanModify(mailbox)) throw Invalid("Reconnect Gmail to authorize replies.");
        var preview = Unprotect<EmailReplyPreview>(attempt.ProtectedPreview);
        var token = await gmail.RefreshAsync(Unprotect<string>(mailbox.ProtectedRefreshToken),ct);
        await ReplyAttemptAsync(user,company,id,ct);
        if (!await db.GmailConnections.AnyAsync(c => c.Id == mailbox.Id && c.Status == "Connected" && c.GrantedScopes.Contains(GmailProvider.ModifyScope),ct)) throw Invalid("Gmail reply access changed. Reconnect before sending.");
        if (await db.EmailReplyAttempts.Where(a => a.Id==id && a.Status=="Draft").ExecuteUpdateAsync(s => s.SetProperty(a => a.Status,"Sending"),ct)==0)
            return new {attempt.Id,Status="Sending",ProviderMessageId=(string?)null};
        try {
            var sent = await gmail.SendReplyAsync(token,preview,mailbox.EmailAddress,ct);
            await db.EmailReplyAttempts.Where(a => a.Id==id).ExecuteUpdateAsync(s => s.SetProperty(a => a.Status,"Sent").SetProperty(a => a.ProviderMessageId,sent.Id).SetProperty(a => a.SentAt,DateTime.UtcNow),CancellationToken.None);
            return new {attempt.Id,Status="Sent",ProviderMessageId=sent.Id};
        } catch {
            await db.EmailReplyAttempts.Where(a => a.Id==id).ExecuteUpdateAsync(s => s.SetProperty(a => a.Status,"Uncertain"),CancellationToken.None);
            throw new EmailWorkspaceException(409,"Sending could not be confirmed. Check the reply status before sending anything again; it may already be in Gmail Sent.");
        }
    }
    public async Task<object> CheckReplyAsync(int user,int company,Guid id,CancellationToken ct)
    {
        var attempt = await ReplyAttemptAsync(user,company,id,ct);
        if (attempt.Status=="Sent") return new {attempt.Id,attempt.Status,attempt.ProviderMessageId};
        var mailbox = await db.GmailConnections.AsNoTracking().SingleAsync(c => c.Id==attempt.ConnectionId,ct);
        var token=await gmail.RefreshAsync(Unprotect<string>(mailbox.ProtectedRefreshToken),ct);
        var found=await gmail.FindSentReplyAsync(token,id,ct);
        if (found!=null) await db.EmailReplyAttempts.Where(a=>a.Id==id).ExecuteUpdateAsync(s=>s.SetProperty(a=>a.Status,"Sent").SetProperty(a=>a.ProviderMessageId,found).SetProperty(a=>a.SentAt,DateTime.UtcNow),ct);
        return new {attempt.Id,Status=found!=null?"Sent":attempt.Status,ProviderMessageId=found};
    }
}
