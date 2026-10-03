using System;
using System.IdentityModel.Tokens.Jwt;
using System.IO;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Parser-feedback API. The import Review screen records whether a PO parsed
    /// correctly; developers get a triage surface — list the imports users
    /// flagged as wrong, download the original PDFs (single or ZIP), and measure
    /// parser accuracy over time. Fully isolated from the PO-import flow, which
    /// this feature never touches. Reusable as the foundation for feedback on
    /// any future document importer.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/import-feedback")]
    public class ImportFeedbackController : ControllerBase
    {
        private readonly IParserFeedbackService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly IPermissionService _permissions;

        public ImportFeedbackController(IParserFeedbackService service, ICompanyAccessGuard access,
            IPermissionService permissions)
        {
            _service = service;
            _access = access;
            _permissions = permissions;
        }

        /// <summary>Null for the seed admin (the parser's owner reviews every
        /// tenant's misreads); anyone else sees only their own companies' --
        /// a feedback row hands out a customer's original PO PDF.</summary>
        private async Task<IReadOnlyCollection<int>?> ScopeAsync()
            => _permissions.IsSeedAdmin(CurrentUserId)
                ? null
                : await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // Record a verdict from the import Review screen. Multipart so the
        // original PDF rides along and is retained. Feedback never blocks PO
        // creation — the UI fires this AFTER the document is created.
        [HttpPost]
        [HasPermission("importfeedback.manage.create")]
        [RequestSizeLimit(10 * 1024 * 1024)]
        public async Task<ActionResult<ParserFeedbackDto>> Record(
            [FromForm] string feedbackStatus,
            [FromForm] int? purchaseOrderId,
            [FromForm] int? companyId,
            [FromForm] string? parserVersion,
            [FromForm] string? originalFileName,
            IFormFile? file)
        {
            if (!Enum.TryParse<ParserFeedbackStatus>(feedbackStatus, ignoreCase: true, out var status))
                return BadRequest(new { error = "feedbackStatus must be 'Correct' or 'Incorrect'." });

            // Tenant guard — if a company is named, the caller must own it.
            if (companyId.HasValue)
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);

            var dto = await _service.RecordAsync(new RecordParserFeedbackInput
            {
                File = file,
                Status = status,
                PurchaseOrderId = purchaseOrderId,
                CompanyId = companyId,
                ParserVersion = parserVersion,
                OriginalFileName = originalFileName,
                CreatedBy = User?.Identity?.Name,
            });
            return Ok(dto);
        }

        // Imports users flagged as incorrectly parsed — paged, filterable by
        // date range + parser version, sortable.
        [HttpGet("incorrect")]
        [HasPermission("importfeedback.list.view")]
        public async Task<ActionResult<ParserFeedbackPageDto>> GetIncorrect(
            [FromQuery] DateTime? from,
            [FromQuery] DateTime? to,
            [FromQuery] string? parserVersion,
            [FromQuery] string? sortBy,
            [FromQuery] bool desc = true,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50)
        {
            var result = await _service.GetIncorrectAsync(new ParserFeedbackQuery
            {
                From = from,
                To = to,
                ParserVersion = parserVersion,
                SortBy = sortBy,
                Descending = desc,
                Page = page,
                PageSize = pageSize,
            }, await ScopeAsync());
            return Ok(result);
        }

        // Overall + per-parser-version accuracy.
        [HttpGet("statistics")]
        [HasPermission("importfeedback.list.view")]
        public async Task<ActionResult<ParserFeedbackStatisticsDto>> GetStatistics()
            => Ok(await _service.GetStatisticsAsync(await ScopeAsync()));

        // Download one retained PDF.
        [HttpGet("{id:int}/download")]
        [HasPermission("importfeedback.download.view")]
        public async Task<IActionResult> Download(int id)
        {
            var pdf = await _service.GetPdfAsync(id, await ScopeAsync());
            if (pdf == null) return NotFound(new { error = "No retained PDF for this feedback." });
            var stream = new FileStream(pdf.FilePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            return File(stream, "application/pdf", pdf.FileName);
        }

        // Download several retained PDFs as a single ZIP.
        [HttpPost("download")]
        [HasPermission("importfeedback.download.view")]
        public async Task<IActionResult> BulkDownload([FromBody] ParserFeedbackBulkDownloadDto body)
        {
            if (body?.Ids == null || body.Ids.Count == 0)
                return BadRequest(new { error = "Provide at least one id." });
            var zip = await _service.GetBulkZipAsync(body.Ids, await ScopeAsync());
            if (zip == null) return NotFound(new { error = "None of the selected feedbacks have a retained PDF." });
            return File(zip, "application/zip", "parser-feedback-pdfs.zip");
        }
    }
}
