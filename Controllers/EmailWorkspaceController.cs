using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Implementations;
namespace MyApp.Api.Controllers;

[Authorize, ApiController, Route("api/email-workspace")]
[HasPermission("email.workspace.use")]
public sealed class EmailWorkspaceController(EmailWorkspaceService service, ILogger<EmailWorkspaceController> logger) : ControllerBase
{
    private int UserId => int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var id) ? id : 0;
    private async Task<IActionResult> Run(Func<Task<object>> action)
    {
        try { var result = await action(); return result is IActionResult response ? response : Ok(result); }
        catch (EmailWorkspaceException e) { return StatusCode(e.Status, new { message = e.Message }); }
        catch (UnauthorizedAccessException) { return Forbid(); }
        catch (DbUpdateConcurrencyException) { return Conflict(new { message = "This enquiry changed. Reload before saving." }); }
        catch (DbUpdateException) { return Conflict(new { message = "This record changed. Reload and try again." }); }
        catch (Exception e)
        {
            logger.LogError("Email workspace request failed ({ExceptionType})", e.GetType().Name);
            return StatusCode(500, new { message = "The email workspace could not complete this request. Please try again." });
        }
    }
    private async Task<object> Done(Func<Task> action) { await action(); return new { success = true }; }

    [HttpGet("company/{companyId}/connections")]
    [HasPermission("email.inbox.view")]
    [AuthorizeCompany]
    public Task<IActionResult> Connections(int companyId) => Run(() => service.StatusAsync(UserId, companyId));
    [HttpGet("company/{companyId}/customers")]
    [HasPermission("email.inbox.view")]
    [HasAnyPermission("email.enquiries.manage", "email.connections.manage")]
    [AuthorizeCompany]
    public Task<IActionResult> Customers(int companyId) => Run(() => service.CustomersAsync(UserId, companyId));
    [HttpPost("company/{companyId}/oauth/start")]
    [HasPermission("email.connections.manage")]
    [AuthorizeCompany]
    public Task<IActionResult> Start(int companyId, CancellationToken ct) => Run(() => service.StartAsync(UserId, companyId, ct));
    [HttpPost("oauth/complete")]
    [HasPermission("email.connections.manage")]
    public Task<IActionResult> Complete(GmailCompleteDto dto, CancellationToken ct) => Run(() => service.CompleteAsync(UserId, dto, ct));
    [HttpPost("company/{companyId}/connections")]
    [HasPermission("email.connections.manage")]
    [AuthorizeCompany]
    public Task<IActionResult> Link(int companyId, GmailLinkDto dto, CancellationToken ct) => Run(() => Done(() => service.LinkAsync(UserId, companyId, dto.ConnectionId, ct)));
    [HttpPut("company/{companyId}/connections/{linkId}")]
    [HasPermission("email.connections.manage")]
    [AuthorizeCompany]
    public Task<IActionResult> Settings(int companyId, int linkId, EmailLinkSettingsDto dto, CancellationToken ct) => Run(() => Done(() => service.SettingsAsync(UserId, companyId, linkId, dto, ct)));
    [HttpDelete("company/{companyId}/connections/{linkId}")]
    [HasPermission("email.connections.manage")]
    [AuthorizeCompany]
    public Task<IActionResult> Unlink(int companyId, int linkId, CancellationToken ct) => Run(() => Done(() => service.UnlinkAsync(UserId, companyId, linkId, ct)));
    [HttpPost("company/{companyId}/sync/{connectionId}")]
    [HasPermission("email.connections.manage")]
    [AuthorizeCompany]
    public Task<IActionResult> Sync(int companyId, int connectionId, CancellationToken ct) => Run(() => Done(() => service.SyncForUserAsync(UserId, companyId, connectionId, ct)));
    [HttpGet("company/{companyId}/messages")]
    [HasPermission("email.inbox.view")]
    [AuthorizeCompany]
    public Task<IActionResult> List(int companyId, CancellationToken ct, string? filter = null, string? search = null, int page = 1, int? pageSize = null) =>
        Run(() => service.ListAsync(UserId, companyId, filter, search, PaginationHelper.ClampPage(page), PaginationHelper.Clamp(pageSize, 20), ct));
    [HttpGet("company/{companyId}/messages/{id}")]
    [HasPermission("email.inbox.view")]
    [AuthorizeCompany]
    public Task<IActionResult> Read(int companyId, int id, CancellationToken ct) => Run(() => service.ReadAsync(UserId, companyId, id, ct));
    [HttpPut("company/{companyId}/messages/{id}/decision")]
    [HasPermission("email.inbox.manage")]
    [AuthorizeCompany]
    public Task<IActionResult> Decide(int companyId, int id, EmailDecisionDto dto, CancellationToken ct) => Run(() => service.DecideAsync(UserId, companyId, id, dto, ct));
    [HttpPost("company/{companyId}/messages/{id}/prepare")]
    [HasPermission("email.enquiries.manage")]
    [AuthorizeCompany]
    public Task<IActionResult> Prepare(int companyId, int id, EmailDecisionDto dto, CancellationToken ct) => Run(async () => await service.PrepareAsync(UserId, companyId, id, dto.Revision, ct));
    [HttpPut("company/{companyId}/messages/{id}/draft")]
    [HasPermission("email.enquiries.manage")]
    [AuthorizeCompany]
    public Task<IActionResult> Save(int companyId, int id, EmailDraftDto dto, CancellationToken ct) => Run(() => service.SaveDraftAsync(UserId, companyId, id, dto, ct));
    [HttpPost("company/{companyId}/messages/{id}/convert")]
    [HasPermission("email.enquiries.manage")]
    [HasPermission("salesquotes.manage.create")]
    [AuthorizeCompany]
    public Task<IActionResult> Convert(int companyId, int id, EmailDraftDto dto, CancellationToken ct) => Run(() => service.ConvertAsync(UserId, companyId, id, dto, ct));
    [HttpGet("company/{companyId}/messages/{id}/attachment")]
    [HasPermission("email.inbox.view")]
    [AuthorizeCompany]
    public Task<IActionResult> Attachment(int companyId, int id, string attachmentId, CancellationToken ct) => Run(async () =>
    {
        var file = await service.AttachmentAsync(UserId, companyId, id, attachmentId, ct);
        Response.Headers.XContentTypeOptions = "nosniff";
        return File(file.Bytes, "application/octet-stream", Path.GetFileName(file.FileName));
    });
}
