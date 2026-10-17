using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Controllers;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Implementations;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;
using Xunit;

namespace MyApp.Api.Tests;

public class PrintTemplateMcpTests : IAsyncLifetime
{
    private string connection = "";
    private AppDbContext db = null!;
    private ServiceProvider provider = null!;
    private readonly Guard guard = new();
    private readonly Grants grants = new();
    private Company own = null!, foreign = null!;
    private User user = null!;
    private McpAgentToken agent = null!;

    public async Task InitializeAsync()
    {
        var server = Environment.GetEnvironmentVariable("PRINT_MCP_TEST_SERVER") ?? @".\MSSQLSERVER02";
        connection = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder
        {
            DataSource = server, InitialCatalog = "MyApp_PrintMcp_Test_" + Guid.NewGuid().ToString("N"),
            IntegratedSecurity = true, TrustServerCertificate = true
        }.ConnectionString;
        DevelopmentSqlGuard.AssertLocal(connection, Environment.MachineName, false);
        db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).Options);
        await db.Database.EnsureCreatedAsync();
        own = new Company { Name = "Sample print company" }; foreign = new Company { Name = "Other sample company" };
        user = new User { Username = "print-test", FullName = "Sample operator" };
        db.AddRange(own, foreign, user); await db.SaveChangesAsync();
        guard.Allowed.UnionWith([own.Id, foreign.Id]);
        agent = new McpAgentToken { UserId = user.Id, CreatedByUserId = user.Id, Name = "Sample assistant",
            TokenHash = McpAgentAuthHandler.Hash(Guid.NewGuid().ToString()), CompanyIds = own.Id.ToString(),
            Scopes = "read,templates.read,templates.write", AllowWrites = true, ExpiresAt = DateTime.UtcNow.AddHours(1) };
        db.Add(agent); await db.SaveChangesAsync();
        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(o => o.UseSqlServer(connection));
        services.AddSingleton<IPrintTemplateRepository>(new PrintTemplateRepository(db));
        provider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        await provider.DisposeAsync();
        // Only the randomly named local database created by this fixture is removed.
        Assert.StartsWith("MyApp_PrintMcp_Test_", new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection).InitialCatalog);
        await db.Database.EnsureDeletedAsync(); await db.DisposeAsync();
    }

    private async Task<JsonElement> Rpc(string method, object? parameters = null, bool loginOnly = false, McpAgentToken? token = null)
    {
        db.ChangeTracker.Clear();
        var http = new DefaultHttpContext { RequestServices = provider,
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), new Claim(ClaimTypes.Name, "sample")], "test")) };
        http.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 1, method, @params = parameters })));
        if (!loginOnly) http.Items[McpAgentAuthHandler.ItemKey] = token ?? agent;
        var controller = new McpController(guard, grants, null!, null!, null!, null!, null!, null!, db,
            new SensitiveDataRedactor(), provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<McpController>.Instance)
            { ControllerContext = new ControllerContext { HttpContext = http } };
        return JsonSerializer.SerializeToElement(((JsonResult)await controller.Post()).Value).GetProperty("result");
    }
    private Task<JsonElement> Call(string name, object args, bool loginOnly = false, McpAgentToken? token = null) =>
        Rpc("tools/call", new { name, arguments = args }, loginOnly, token);
    private static JsonElement Data(JsonElement result)
    {
        Assert.False(result.GetProperty("isError").GetBoolean(), result.ToString());
        return JsonDocument.Parse(result.GetProperty("content")[0].GetProperty("text").GetString()!).RootElement.Clone();
    }
    private static void Denied(JsonElement result) => Assert.True(result.GetProperty("isError").GetBoolean(), result.ToString());
    private async Task<PrintTemplate> Template(string type = "SalesQuote", bool other = false)
    {
        var row = new PrintTemplate { CompanyId = other ? foreign.Id : own.Id, TemplateType = type,
            Name = "Sample design", HtmlContent = "<h1>{{clientName}}</h1>", TemplateJson = "{\"pages\":[]}", EditorMode = "visual",
            ExcelTemplatePath = "/sample.xlsx", ExcelSheetName = "Sample" };
        db.Add(row); await db.SaveChangesAsync(); return row;
    }
    private async Task<string> Revision(PrintTemplate row) => Data(await Call("get_print_template", new { companyId = row.CompanyId, templateId = row.Id })).GetProperty("revision").GetString()!;
    private object Edit(PrintTemplate row, string revision, string html = "<h1>Updated {{clientName}}</h1>") =>
        new { companyId = own.Id, templateId = row.Id, documentType = row.TemplateType, revision, htmlContent = html };
    private async Task<string> Prepare(PrintTemplate row) => Data(await Call("prepare_print_template_update", Edit(row, await Revision(row)))).GetProperty("planId").GetString()!;

    [Fact]
    public async Task AllDocumentTypesPrepareWithoutSavingAndCommitOncePreservingMetadata()
    {
        Assert.Contains(McpScopes.TemplatesWrite, await McpScopes.AvailableAsync(grants, user.Id));
        var catalog = await Rpc("tools/list");
        Assert.Contains(catalog.GetProperty("tools").EnumerateArray(), t => t.GetProperty("name").GetString() == "prepare_print_template_update");
        var stamp = new CompanyStamp { CompanyId = own.Id, Name = "Sample signature", Slug = "sample", FilePath = "/sample.png" };
        db.Add(stamp); await db.SaveChangesAsync();
        foreach (var type in PrintTemplateTypes.All)
        {
            var row = await Template(type); row.StampId = stamp.Id; await db.SaveChangesAsync();
            var revision = await Revision(row);
            var prepared = Data(await Call("prepare_print_template_update", Edit(row, revision, "<h1>Updated {{clientName}}</h1><script>alert(1)</script>")));
            Assert.DoesNotContain("<script", prepared.GetProperty("details").GetProperty("htmlContent").GetString());
            Assert.True(prepared.GetProperty("details").GetProperty("clearsVisualProject").GetBoolean());
            var unchanged = await db.PrintTemplates.AsNoTracking().SingleAsync(t => t.Id == row.Id);
            Assert.Equal(row.HtmlContent, unchanged.HtmlContent); Assert.NotNull(unchanged.TemplateJson);
            var planId = prepared.GetProperty("planId").GetString()!;
            Data(await Call("commit_action", new { planId }));
            var updated = await db.PrintTemplates.AsNoTracking().SingleAsync(t => t.Id == row.Id);
            Assert.Equal("<h1>Updated {{clientName}}</h1>", updated.HtmlContent);
            Assert.Equal(row.Name, updated.Name); Assert.Equal(row.IsDefault, updated.IsDefault);
            Assert.Equal(stamp.Id, updated.StampId); Assert.Equal(row.ExcelTemplatePath, updated.ExcelTemplatePath);
            Assert.Equal(row.ExcelSheetName, updated.ExcelSheetName); Assert.Equal("code", updated.EditorMode); Assert.Null(updated.TemplateJson);
            Assert.NotEqual(revision, await Revision(row));
            Denied(await Call("commit_action", new { planId }));
            Assert.Equal("succeeded", Data(await Call("get_action_status", new { planId })).GetProperty("status").GetString());
        }
        Assert.Equal(PrintTemplateTypes.All.Length, await db.AuditLogs.CountAsync(a => a.ExceptionType == "PrintTemplateUpdated"));
    }

    [Fact]
    public async Task CompanyRecordPermissionScopeAndRevisionBoundariesAreEnforced()
    {
        var row = await Template(); var other = await Template(other: true); var revision = await Revision(row);
        var edit = Edit(row, revision);
        Denied(await Call("prepare_print_template_update", Edit(other, revision)));
        Denied(await Call("get_print_template", new { companyId = foreign.Id, templateId = other.Id }));
        Denied(await Call("prepare_print_template_update", new { companyId = foreign.Id, templateId = other.Id, documentType = "SalesQuote", revision, htmlContent = "<p>foreign</p>" }));
        agent.CompanyIds += "," + foreign.Id;
        guard.Allowed.Remove(foreign.Id);
        Denied(await Call("prepare_print_template_update", new { companyId = foreign.Id, templateId = other.Id, documentType = "SalesQuote", revision, htmlContent = "<p>foreign</p>" }));
        agent.CompanyIds = own.Id.ToString();
        Denied(await Call("prepare_print_template_update", edit, loginOnly: true));
        agent.Scopes = "read,templates.read"; Denied(await Call("prepare_print_template_update", edit));
        agent.Scopes += ",templates.write";
        agent.AllowWrites = false; Denied(await Call("prepare_print_template_update", edit)); agent.AllowWrites = true;
        foreach (var permission in new[] { "mcp.write.use", "printtemplates.manage.view", "printtemplates.manage.update" })
        {
            grants.Denied.Add(permission); Denied(await Call("prepare_print_template_update", edit)); grants.Denied.Clear();
        }
        grants.ToolsDenied.Add("prepare_print_template_update"); Denied(await Call("prepare_print_template_update", edit)); grants.ToolsDenied.Clear();
        Denied(await Call("prepare_print_template_update", new { companyId = own.Id, templateId = row.Id, documentType = "Bill", revision, htmlContent = "<p>wrong type</p>" }));
        Denied(await Call("prepare_print_template_update", Edit(row, new string('0', 64))));
        Denied(await Call("prepare_print_template_update", Edit(row, revision, " ")));
        Denied(await Call("prepare_print_template_update", Edit(row, revision, new string('x', 24001))));
        Denied(await Call("prepare_print_template_update", new { companyId = own.Id, templateId = row.Id, documentType = "SalesQuote", revision, htmlContent = "<p>x</p>", stampId = 10 }));
        var planId = await Prepare(row);
        var second = new McpAgentToken { Id = agent.Id + 100, CompanyIds = agent.CompanyIds, Scopes = agent.Scopes, AllowWrites = true };
        Denied(await Call("commit_action", new { planId }, token: second));
        guard.Allowed.Remove(own.Id); Denied(await Call("commit_action", new { planId })); guard.Allowed.Add(own.Id);
        grants.Denied.Add("printtemplates.manage.view"); Denied(await Call("commit_action", new { planId })); grants.Denied.Clear();
        grants.ToolsDenied.Add("prepare_print_template_update"); Denied(await Call("commit_action", new { planId })); grants.ToolsDenied.Clear();
        await db.PrintTemplates.Where(t => t.Id == row.Id).ExecuteUpdateAsync(s => s.SetProperty(t => t.HtmlContent, "<p>Concurrent editor</p>"));
        Denied(await Call("commit_action", new { planId }));
        Assert.Equal("<p>Concurrent editor</p>", (await db.PrintTemplates.AsNoTracking().SingleAsync(t => t.Id == row.Id)).HtmlContent);
        Assert.Equal("failedOrIncomplete", Data(await Call("get_action_status", new { planId })).GetProperty("status").GetString());
        Assert.Equal(other.HtmlContent, (await db.PrintTemplates.AsNoTracking().SingleAsync(t => t.Id == other.Id)).HtmlContent);
    }

    [Fact]
    public async Task ScopeDiscoveryIdempotencyCancellationAndCommitRevocationStayBounded()
    {
        var row = await Template(); var revision = await Revision(row);
        var originalScopes = agent.Scopes;
        agent.Scopes = "read,templates.read";
        Assert.DoesNotContain((await Rpc("tools/list")).GetProperty("tools").EnumerateArray(),
            t => t.GetProperty("name").GetString() == "prepare_print_template_update");
        agent.Scopes = originalScopes;
        object edit = new { companyId = own.Id, templateId = row.Id, documentType = "SalesQuote", revision,
            htmlContent = "<h1>Updated {{clientName}}</h1>", idempotencyKey = "sample-template-operation" };
        var first = Data(await Call("prepare_print_template_update", edit));
        var second = Data(await Call("prepare_print_template_update", edit));
        Assert.Equal(first.GetProperty("planId").GetString(), second.GetProperty("planId").GetString());
        Assert.Equal(1, await db.McpPendingActions.CountAsync());
        var planId = first.GetProperty("planId").GetString()!;
        Data(await Call("cancel_action", new { planId })); Denied(await Call("commit_action", new { planId }));
        foreach (var permission in new[] { "mcp.write.use", "printtemplates.manage.update" })
        {
            planId = await Prepare(row);
            grants.Denied.Add(permission); Denied(await Call("commit_action", new { planId })); grants.Denied.Clear();
            Assert.Null((await db.McpPendingActions.AsNoTracking().SingleAsync(p => p.PlanId == planId)).CommittedAt);
        }
        planId = await Prepare(row); agent.Scopes = "read,templates.read";
        Denied(await Call("commit_action", new { planId })); agent.Scopes = originalScopes;
        await db.McpPendingActions.Where(p => p.PlanId == planId).ExecuteUpdateAsync(s => s.SetProperty(p => p.ExpiresAt, DateTime.UtcNow.AddSeconds(-1)));
        Denied(await Call("commit_action", new { planId }));
        planId = await Prepare(row);
        await db.PrintTemplates.Where(t => t.Id == row.Id).ExecuteUpdateAsync(s => s.SetProperty(t => t.IsDefault, false));
        Denied(await Call("commit_action", new { planId })); // Metadata is covered by the revision too.
        var fresh = await db.PrintTemplates.AsNoTracking().SingleAsync(t => t.Id == row.Id);
        Assert.Equal(row.HtmlContent, fresh.HtmlContent); Assert.False(fresh.IsDefault);
        Denied(await Call("prepare_print_template_update", Edit(row, await Revision(row), new string('界', 10000))));
        grants.Denied.Add("printtemplates.manage.view");
        Assert.DoesNotContain(McpScopes.TemplatesWrite, await McpScopes.AvailableAsync(grants, user.Id));
    }

    private sealed class Guard : ICompanyAccessGuard
    {
        public HashSet<int> Allowed = [];
        public Task<bool> HasAccessAsync(int uid, int companyId) => Task.FromResult(Allowed.Contains(companyId));
        public Task AssertAccessAsync(int uid, int companyId) => Allowed.Contains(companyId) ? Task.CompletedTask : throw new UnauthorizedAccessException();
        public Task<HashSet<int>> GetAccessibleCompanyIdsAsync(int uid) => Task.FromResult(Allowed);
        public void InvalidateUser(int uid) { } public void InvalidateAll() { }
    }
    private sealed class Grants : IPermissionService
    {
        public HashSet<string> Denied = [], ToolsDenied = [];
        public Task<bool> HasPermissionAsync(int uid, string key) => Task.FromResult(!Denied.Contains(key));
        public Task<bool> HasMcpToolAccessAsync(int uid, string name) => Task.FromResult(!ToolsDenied.Contains(name));
        public Task<IReadOnlyCollection<string>> GetUserPermissionsAsync(int uid) => Task.FromResult<IReadOnlyCollection<string>>([]);
        public bool IsSeedAdmin(int uid) => false;
        public void InvalidateUser(int uid) { } public void InvalidateAll() { }
    }
}
