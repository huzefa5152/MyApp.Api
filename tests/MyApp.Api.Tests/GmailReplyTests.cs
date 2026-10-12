using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Implementations;
using Xunit;
namespace MyApp.Api.Tests;
public class GmailReplyTests
{
    private static GmailFetchedMessage Source() => new("incoming","thread","buyer@example.com","RFQ — request",DateTime.UtcNow,
        new("Current requirement\nOn Monday, Someone wrote:\nOLD SECRET THREAD", "<p>Current requirement</p><blockquote>OLD SECRET THREAD</blockquote>",[]),false,true,
        new("<original@example.com>","<older@example.com>","purchasing@example.com",["owner@example.com","colleague@example.com"],["copy@example.com","colleague@example.com","owner@example.com"]));
    [Fact] public void ReplyUsesReplyToAndDoesNotSendPreviousHistory()
    {
        var p=EmailReplyRules.Build(Guid.NewGuid(),Source(),"owner@example.com",new() {Items=[new(){Description="Valve",Quantity=2,Unit="Nos",UnitPrice=125.50m}]});
        Assert.Equal(new[]{"purchasing@example.com"},p.To); Assert.Empty(p.Cc);
        Assert.Equal(Source().Subject,p.Subject); Assert.Contains("125.50",p.Html); Assert.DoesNotContain("OLD SECRET",p.Text); Assert.Contains("Current requirement",p.Text);
        var mime=Encoding.UTF8.GetString(EmailReplyRules.Mime(p,"owner@example.com"));
        Assert.Contains("In-Reply-To: <original@example.com>",mime); Assert.Contains("References: <older@example.com> <original@example.com>",mime);
        Assert.Contains(EmailReplyRules.MessageId(p.Id),mime); Assert.DoesNotContain("Bcc:",mime);
    }
    [Fact] public void ReplyAllExcludesSelfDeduplicatesAndNeverIncludesBcc()
    {
        var p=EmailReplyRules.Build(Guid.NewGuid(),Source(),"owner@example.com",new(){ReplyAll=true});
        Assert.Equal(new[]{"purchasing@example.com","colleague@example.com"},p.To); Assert.Equal(new[]{"copy@example.com"},p.Cc);
        Assert.DoesNotContain("owner@example.com",p.To.Concat(p.Cc));
    }
    [Fact] public void HeaderInjectionAndMissingPricesAreRefused()
    {
        Assert.Throws<InvalidOperationException>(()=>EmailReplyRules.Addresses("buyer@example.com\r\nBcc: victim@example.com"));
        Assert.Throws<InvalidOperationException>(()=>EmailReplyRules.Build(Guid.NewGuid(),Source(),"owner@example.com",new(){Items=[new(){Description="Valve",Quantity=1}]}));
        var p=EmailReplyRules.Build(Guid.NewGuid(),Source(),"owner@example.com",new());
        Assert.Throws<InvalidOperationException>(()=>EmailReplyRules.Mime(p with {Subject="Bad\r\nBcc: victim@example.com"},"owner@example.com"));
    }
    [Fact] public void ItemMarkupIsEscapedAndHtmlHistoryIsExcluded()
    {
        var p=EmailReplyRules.Build(Guid.NewGuid(),Source() with {Content=new("","<p>New</p><div class='gmail_quote'>OLD SECRET</div>",[])},"owner@example.com",new(){Items=[new(){Description="<script>bad()</script>",Quantity=1,Unit="Nos",UnitPrice=0}]});
        Assert.DoesNotContain("<script>",p.Html); Assert.Contains("&lt;script&gt;",p.Html); Assert.DoesNotContain("OLD SECRET",p.Html);
    }
    [Fact] public void ExistingReadOnlyRoleDoesNotAutomaticallyGainSendingPermission()
    {
        Assert.DoesNotContain("email.replies.send",EditionCatalog.EmailWorkspaceKeys);
        Assert.DoesNotContain("email.read.manage",EditionCatalog.EmailWorkspaceKeys);
    }
    [Fact] public void FractionalPricesAndLongUnicodeSubjectsRemainExact()
    {
        var subject=string.Concat(Enumerable.Repeat("Quotation درخواست ",60));
        var p=EmailReplyRules.Build(Guid.NewGuid(),Source() with {Subject=subject},"owner@example.com",new(){Items=[new(){Description="Valve",Quantity=1,UnitPrice=0.123456m}]});
        Assert.Contains("0.123456",p.Text);
        var mime=Encoding.UTF8.GetString(EmailReplyRules.Mime(p,"owner@example.com"));
        var decoded=string.Concat(System.Text.RegularExpressions.Regex.Matches(mime,@"=\?UTF-8\?B\?([^?]+)\?=").Select(m=>Encoding.UTF8.GetString(Convert.FromBase64String(m.Groups[1].Value))));
        Assert.Equal(subject,decoded);
        Assert.All(mime.Split("\r\n"),line=>Assert.True(line.Length<998));
    }
    [Fact, Trait("Category","LocalReplySql")]
    public async Task ReplyWorkflowRefusesLeaksAndPreservesExactlyOnceSend()
    {
        var connection=Environment.GetEnvironmentVariable("REPLY_TEST_CONNECTION") ?? throw new Exception("Set a local isolated reply test connection.");
        DevelopmentSqlGuard.AssertLocal(connection,Environment.MachineName,false);
        var builder=new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
        Assert.EndsWith("_Test",builder.InitialCatalog);
        await using var db=new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).Options);
        await using var tx=await db.Database.BeginTransactionAsync();
        var owner=new User{Username="[TEMP] reply-"+Guid.NewGuid().ToString("N")}; var colleague=new User{Username="[TEMP] reader-"+Guid.NewGuid().ToString("N")};
        var company=new Company{Name="[TEMP] Reply fixture"}; var other=new Company{Name="[TEMP] Other reply fixture"};
        db.AddRange(owner,colleague,company,other); await db.SaveChangesAsync();
        var guard=new Guard(company.Id); var permissions=new Permissions(); var fake=new Gmail();
        var service=new EmailWorkspaceService(db,guard,permissions,fake,new EphemeralDataProtectionProvider(),null!);
        var mailbox=new GmailConnection{OwnerUserId=owner.Id,GoogleSubject="test-"+Guid.NewGuid(),EmailAddress="owner@example.com",ProtectedRefreshToken=service.Protect("local-fake"),GrantedScopes=GmailProvider.ModifyScope};
        db.GmailConnections.Add(mailbox);await db.SaveChangesAsync();
        db.GmailCompanyLinks.Add(new(){CompanyId=company.Id,ConnectionId=mailbox.Id});
        var message=new GmailMessage{ConnectionId=mailbox.Id,ProviderMessageId="incoming",ThreadId="thread",Sender="buyer@example.com",Subject="RFQ",ProtectedContent=service.Protect(Source().Content),IsUnread=true};
        db.GmailMessages.Add(message);await db.SaveChangesAsync();
        db.EmailEnquiries.Add(new(){CompanyId=company.Id,MessageId=message.Id,Decision="Kept"});await db.SaveChangesAsync();
        var shared=JsonSerializer.SerializeToElement(await service.ConversationAsync(colleague.Id,company.Id,message.Id,default));
        Assert.True(shared.GetProperty("LimitedToSharedMessages").GetBoolean()); Assert.Single(shared.GetProperty("Messages").EnumerateArray()); Assert.False(shared.GetProperty("CanReply").GetBoolean());
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>service.PreviewReplyAsync(colleague.Id,company.Id,message.Id,new(),default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>service.ConversationAsync(owner.Id,other.Id,message.Id,default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>service.SetReadStatusAsync(colleague.Id,company.Id,message.Id,false,default));
        await db.GmailCompanyLinks.Where(l=>l.CompanyId==company.Id && l.ConnectionId==mailbox.Id).ExecuteUpdateAsync(s=>s.SetProperty(l=>l.AllowCompanyReplies,true));
        var delegated=JsonSerializer.SerializeToElement(await service.ConversationAsync(colleague.Id,company.Id,message.Id,default));
        Assert.True(delegated.GetProperty("CanReply").GetBoolean());
        Assert.True(delegated.GetProperty("LimitedToSharedMessages").GetBoolean());
        Assert.Single(delegated.GetProperty("Messages").EnumerateArray());
        await Assert.ThrowsAsync<EmailWorkspaceException>(()=>service.PreviewReplyAsync(colleague.Id,company.Id,message.Id,new(){TargetProviderMessageId="private"},default));
        var delegatedPreview=await service.PreviewReplyAsync(colleague.Id,company.Id,message.Id,new(),default);
        await service.SetReadStatusAsync(colleague.Id,company.Id,message.Id,false,default);
        await db.GmailCompanyLinks.Where(l=>l.CompanyId==company.Id && l.ConnectionId==mailbox.Id).ExecuteUpdateAsync(s=>s.SetProperty(l=>l.AllowCompanyReplies,false));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>service.SendReplyAsync(colleague.Id,company.Id,delegatedPreview.Id,default));
        Assert.Equal(0,fake.SendCount);
        await service.SetReadStatusAsync(owner.Id,company.Id,message.Id,false,default);
        Assert.False((await db.GmailMessages.AsNoTracking().SingleAsync(m=>m.Id==message.Id)).IsUnread);
        permissions.Denied.Add("email.replies.send");
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>service.PreviewReplyAsync(owner.Id,company.Id,message.Id,new(),default)); permissions.Denied.Clear();
        await db.GmailConnections.Where(c=>c.Id==mailbox.Id).ExecuteUpdateAsync(s=>s.SetProperty(c=>c.GrantedScopes,GmailProvider.ReadScope));
        await Assert.ThrowsAsync<EmailWorkspaceException>(()=>service.PreviewReplyAsync(owner.Id,company.Id,message.Id,new(),default));
        await db.GmailConnections.Where(c=>c.Id==mailbox.Id).ExecuteUpdateAsync(s=>s.SetProperty(c=>c.GrantedScopes,GmailProvider.ModifyScope));
        var preview=await service.PreviewReplyAsync(owner.Id,company.Id,message.Id,new(){ReplyAll=true},default);
        Assert.DoesNotContain("Current requirement",(await db.EmailReplyAttempts.AsNoTracking().SingleAsync(a=>a.Id==preview.Id)).ProtectedPreview);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>service.SendReplyAsync(owner.Id,other.Id,preview.Id,default));
        await Assert.ThrowsAsync<EmailWorkspaceException>(()=>service.SendReplyAsync(colleague.Id,company.Id,preview.Id,default));
        await service.SendReplyAsync(owner.Id,company.Id,preview.Id,default);await service.SendReplyAsync(owner.Id,company.Id,preview.Id,default);
        Assert.Equal(1,fake.SendCount);
        var companyConversation=JsonSerializer.SerializeToElement(await service.ConversationAsync(colleague.Id,company.Id,message.Id,default));
        Assert.Equal(2,companyConversation.GetProperty("Messages").GetArrayLength());
        Assert.DoesNotContain("Private unrelated content",companyConversation.ToString());
        var uncertain=await service.PreviewReplyAsync(owner.Id,company.Id,message.Id,new(),default);fake.TimeoutAfterSend=true;
        await Assert.ThrowsAsync<EmailWorkspaceException>(()=>service.SendReplyAsync(owner.Id,company.Id,uncertain.Id,default));
        await service.SendReplyAsync(owner.Id,company.Id,uncertain.Id,default);Assert.Equal(2,fake.SendCount);
        await Assert.ThrowsAsync<EmailWorkspaceException>(()=>service.PreviewReplyAsync(owner.Id,company.Id,message.Id,new(),default));
        var recovery=JsonSerializer.SerializeToElement(await service.ConversationAsync(owner.Id,company.Id,message.Id,default));
        Assert.Equal(uncertain.Id,recovery.GetProperty("PendingReplyId").GetGuid());
        var colleagueRecovery=JsonSerializer.SerializeToElement(await service.ConversationAsync(colleague.Id,company.Id,message.Id,default));
        Assert.Equal(JsonValueKind.Null,colleagueRecovery.GetProperty("PendingReplyId").ValueKind);
        var checkedStatus=JsonSerializer.SerializeToElement(await service.CheckReplyAsync(owner.Id,company.Id,uncertain.Id,default));
        Assert.Equal("Sent",checkedStatus.GetProperty("Status").GetString());
        permissions.Denied.Add("email.workspace.use");
        await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>service.SendReplyAsync(owner.Id,company.Id,preview.Id,default));
        await tx.RollbackAsync();
    }
    private class Guard(int company):ICompanyAccessGuard
    {
        public Task<bool> HasAccessAsync(int user,int id)=>Task.FromResult(id==company);
        public Task AssertAccessAsync(int user,int id)=>id==company?Task.CompletedTask:Task.FromException(new UnauthorizedAccessException());
        public Task<HashSet<int>> GetAccessibleCompanyIdsAsync(int user)=>Task.FromResult(new HashSet<int>{company});
        public void InvalidateUser(int user){} public void InvalidateAll(){}
    }
    private class Permissions:IPermissionService
    {
        public HashSet<string> Denied=[];
        public Task<bool> HasPermissionAsync(int user,string key)=>Task.FromResult(!Denied.Contains(key));
        public Task<IReadOnlyCollection<string>> GetUserPermissionsAsync(int user)=>Task.FromResult<IReadOnlyCollection<string>>([]);
        public bool IsSeedAdmin(int user)=>false;public void InvalidateUser(int user){}public void InvalidateAll(){}
        public Task<bool> HasMcpToolAccessAsync(int user,string name)=>Task.FromResult(false);
    }
    private class Gmail:IGmailProvider
    {
        public int SendCount;public bool TimeoutAfterSend;
        public bool IsConfigured=>true;public string RedirectUri=>"http://localhost/callback";
        public string AuthorizationUrl(string state,string challenge)=>"http://localhost/?state="+state;
        public Task<GmailIdentity> ExchangeAsync(string code,string verifier,CancellationToken ct)=>Task.FromResult(new GmailIdentity("test","owner@example.com","local-fake"));
        public Task<string> RefreshAsync(string token,CancellationToken ct)=>Task.FromResult("fake-access");
        public Task<string> GetHistoryIdAsync(string token,CancellationToken ct)=>Task.FromResult("1");
        public Task<GmailBatch> ListAsync(string token,DateTime since,string? page,CancellationToken ct)=>Task.FromResult(new GmailBatch([],null,null));
        public Task<GmailBatch> HistoryAsync(string token,string history,string? page,CancellationToken ct)=>Task.FromResult(new GmailBatch([],null,"2"));
        public Task<GmailFetchedMessage?> ReadAsync(string token,string id,CancellationToken ct)=>Task.FromResult<GmailFetchedMessage?>(Source());
        public Task<byte[]> AttachmentAsync(string token,string message,string attachment,CancellationToken ct)=>Task.FromResult(Array.Empty<byte>());
        public Task<List<GmailFetchedMessage>> ThreadAsync(string token,string thread,CancellationToken ct)=>Task.FromResult(new List<GmailFetchedMessage>{Source(),Source() with{Id="private",Content=new("Private unrelated content","",[])}});
        public Task SetUnreadAsync(string token,string id,bool unread,CancellationToken ct)=>Task.CompletedTask;
        public Task<GmailSentMessage> SendReplyAsync(string token,EmailReplyPreview preview,string from,CancellationToken ct){SendCount++;return TimeoutAfterSend?Task.FromException<GmailSentMessage>(new TimeoutException()):Task.FromResult(new GmailSentMessage("sent","thread"));}
        public Task<string?> FindSentReplyAsync(string token,Guid id,CancellationToken ct)=>Task.FromResult<string?>("sent");
    }
}
