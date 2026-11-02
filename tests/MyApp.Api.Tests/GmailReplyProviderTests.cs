using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Implementations;
using Xunit;
namespace MyApp.Api.Tests;
public class GmailReplyProviderTests
{
    private sealed class Handler(Func<HttpRequestMessage,Task<HttpResponseMessage>> run):HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)=>run(request);
    }
    private static HttpResponseMessage Json(object value)=>new(HttpStatusCode.OK){Content=new StringContent(JsonSerializer.Serialize(value))};
    private static GmailProvider Provider(Handler handler)=>new(new HttpClient(handler),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{
        ["Gmail:ClientId"]="synthetic-client",["Gmail:ClientSecret"]="synthetic-secret",["Gmail:RedirectUri"]="http://localhost/callback"}).Build());
    [Fact] public async Task HistoryIncludesReadChangesAndDeletes()
    {
        var response=new {historyId="10",history=new[]{new {
            labelsRemoved=new[]{new{message=new{id="read"}}},
            labelsAdded=new[]{new{message=new{id="unread"}}},
            messagesDeleted=new[]{new{message=new{id="deleted"}}}
        }}};
        var provider=Provider(new Handler(r=>Task.FromResult(Json(response))));
        var result=await provider.HistoryAsync("fake","1",null,default);
        Assert.Equal(new[]{"deleted","read","unread"},result.MessageIds.Order());
    }
    [Fact] public async Task ReadStateUsesOnlyUnreadLabel()
    {
        string? body=null;
        var provider=Provider(new Handler(async r=>{Assert.EndsWith("messages/incoming/modify",r.RequestUri!.AbsolutePath);body=await r.Content!.ReadAsStringAsync();return Json(new{});}));
        await provider.SetUnreadAsync("fake","incoming",false,default);
        using var doc=JsonDocument.Parse(body!);
        Assert.Empty(doc.RootElement.GetProperty("addLabelIds").EnumerateArray());
        Assert.Equal("UNREAD",doc.RootElement.GetProperty("removeLabelIds")[0].GetString());
    }
    [Fact] public async Task ReplySendCarriesThreadAndNeverRetriesFailure()
    {
        int calls=0;
        var provider=Provider(new Handler(async r=>{
            calls++; using var doc=JsonDocument.Parse(await r.Content!.ReadAsStringAsync());
            Assert.Equal("thread",doc.RootElement.GetProperty("threadId").GetString());
            var mime=Encoding.UTF8.GetString(Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlDecode(doc.RootElement.GetProperty("raw").GetString()!));
            Assert.Contains("In-Reply-To: <incoming@example.com>",mime);
            return new(HttpStatusCode.ServiceUnavailable);
        }));
        var preview=new EmailReplyPreview(Guid.NewGuid(),"Sample request",["buyer@example.com"],[],"Price","<p>Price</p>","thread","<incoming@example.com>","<incoming@example.com>");
        await Assert.ThrowsAsync<GmailProviderException>(()=>provider.SendReplyAsync("fake",preview,"owner@example.com",default));
        Assert.Equal(1,calls);
    }
    [Fact] public void UpgradeConsentIsSeparateFromReadOnlyConsent()
    {
        var provider=Provider(new Handler(r=>throw new Exception("No network expected")));
        Assert.Contains(Uri.EscapeDataString(GmailProvider.ReadScope),provider.AuthorizationUrl("state","challenge"));
        Assert.Contains(Uri.EscapeDataString(GmailProvider.ModifyScope),provider.UpgradeAuthorizationUrl("state","challenge"));
        Assert.Contains("code_challenge_method=S256",provider.UpgradeAuthorizationUrl("state","challenge"));
    }
    [Fact] public async Task ConversationIncludesSentButExcludesDraftTrashAndSpam()
    {
        object Message(string id,string label)=>new {id,threadId="thread",internalDate="1",labelIds=new[]{label},payload=new {
            mimeType="text/plain",headers=new[]{new{name="From",value="buyer@example.com"},new{name="Subject",value="Request"},new{name="Message-ID",value="<incoming@example.com>"}},
            body=new{data=Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes("Current enquiry"))}
        }};
        var provider=Provider(new Handler(r=>Task.FromResult(Json(new{messages=new[]{Message("incoming","UNREAD"),Message("sent","SENT"),Message("draft","DRAFT"),Message("trash","TRASH"),Message("spam","SPAM")}}))));
        var result=await provider.ThreadAsync("fake","thread",default);
        Assert.Equal(new[]{"incoming","sent"},result.Select(m=>m.Id));
        Assert.True(result[0].IsUnread); Assert.False(result[1].IsUnread);
        Assert.Equal("<incoming@example.com>",result[0].ReplyHeaders!.MessageId);
    }
}
