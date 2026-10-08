using Microsoft.Data.SqlClient;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using System.Security.Cryptography;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;
using System.Security.Claims;
using System.Text.Json;

namespace MyApp.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/poimport")]
public sealed class CustomerWorkbookImportController(AppDbContext db, ICompanyAccessGuard access,
    ILogger<CustomerWorkbookImportController> logger, IPOFormatRegistry registry, IWebHostEnvironment env, IPermissionService permissions) : ControllerBase
{
    private int UserId => int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var id) ? id : 0;

    [HttpGet("workbook-formats")]
    [HasPermission("poformats.import.create")]
    public async Task<IActionResult> Formats([FromQuery] int companyId, [FromQuery] int clientId)
    {
        await access.AssertAccessAsync(UserId, companyId);
        return Ok(await db.POFormats.AsNoTracking().Where(f => f.CompanyId == companyId && f.ClientId == clientId
            && f.Client != null && f.Client.CompanyId == companyId && f.IsActive && f.RuleSetJson.Contains("excel-columns-v1"))
            .Select(f => new { f.Id, f.Name, f.RuleSetJson, f.CurrentVersion }).ToListAsync());
    }

    [HttpPost("workbook-format")]
    [HasPermission("poformats.manage.create")]
    public async Task<IActionResult> SaveFormat([FromQuery] int companyId, [FromQuery] int clientId, [FromBody] WorkbookFormatRequest request)
    {
        await access.AssertAccessAsync(UserId, companyId);
        if (!await db.Clients.AsNoTracking().AnyAsync(c => c.Id == clientId && c.CompanyId == companyId))
            return BadRequest(new { error = "Choose a customer from this company." });
        var name = request.Name?.Trim() ?? "";
        if (request.Mapping == null) return BadRequest(new { error = "Choose the workbook columns." });
        try { CustomerWorkbookReader.ValidateMapping(request.Mapping); }
        catch (InvalidOperationException) { return BadRequest(new { error = "Choose a worksheet, header row and distinct column mappings." }); }
        if (name.Length is < 1 or > 200 || request.Mapping.DescriptionColumn < 1 || request.Mapping.QuantityColumn < 1
            || request.Mapping.Headers is not { Length: > 0 })
            return BadRequest(new { error = "Enter a format name and preview a complete column mapping first." });
        if (await db.POFormats.AnyAsync(f => f.CompanyId == companyId && f.ClientId == clientId && f.Name == name))
            return Conflict(new { error = "This customer already has a format with this name." });
        try
        {
        var format = await registry.CreateAsync(new POFormatCreateDto { CompanyId = companyId, ClientId = clientId,
            Name = name, RawText = string.Join(" ", request.Mapping.Headers),
            RuleSetJson = JsonSerializer.Serialize(new { engine = "excel-columns-v1", mapping = request.Mapping }, new JsonSerializerOptions(JsonSerializerDefaults.Web)) }, UserId.ToString());
        return Ok(new { format.Id, format.Name, format.CurrentVersion });
        }
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
        {
            return Conflict(new { error = "This customer already has a format with this name." });
        }
    }

    [HttpGet("archives/{archiveId:int}/duplicate")]
    [HasPermission("poformats.import.create")]
    public async Task<IActionResult> Duplicate(int archiveId, [FromQuery] string documentKind)
    {
        var archive = await db.PoImportArchives.AsNoTracking().FirstOrDefaultAsync(a => a.Id == archiveId);
        if (archive?.CompanyId is not int companyId) return NotFound();
        await access.AssertAccessAsync(UserId, companyId);
        if (documentKind is not ("salesquote" or "salesorder" or "challan")) return BadRequest();
        return Ok(new { duplicate = archive.ContentSha256 != null && await db.PoImportArchives.AsNoTracking().AnyAsync(a =>
            a.CompanyId == companyId && a.Id != archiveId && a.ContentSha256 == archive.ContentSha256
            && a.DocumentKind == documentKind && a.DocumentId != null) });
    }

    [HttpPost("archives/{archiveId:int}/link")]
    [HasPermission("poformats.import.create")]
    public async Task<IActionResult> Link(int archiveId, [FromBody] ImportLinkRequest request)
    {
        var archive = await db.PoImportArchives.FirstOrDefaultAsync(a => a.Id == archiveId);
        if (archive?.CompanyId is not int companyId) return NotFound();
        await access.AssertAccessAsync(UserId, companyId);
        var permission = request.DocumentKind switch { "salesquote" => "salesquotes.manage.create", "salesorder" => "salesorders.manage.create", "challan" => "challans.manage.create", _ => null };
        if (permission == null) return BadRequest(new { error = "Choose a supported document type." });
        // The document's own create permission must still be present when attaching its source.
        if (!await permissions.HasPermissionAsync(UserId, permission)) return Forbid();
        var belongs = request.DocumentKind switch
        {
            "salesquote" => await db.SalesQuotes.AnyAsync(d => d.Id == request.DocumentId && d.CompanyId == companyId),
            "salesorder" => await db.SalesOrders.AnyAsync(d => d.Id == request.DocumentId && d.CompanyId == companyId),
            "challan" => await db.DeliveryChallans.AnyAsync(d => d.Id == request.DocumentId && d.CompanyId == companyId),
            _ => false
        };
        if (!belongs) return NotFound();
        if (archive.DocumentId != null && (archive.DocumentKind != request.DocumentKind || archive.DocumentId != request.DocumentId))
            return Conflict(new { error = "This upload is already attached to another document." });
        archive.DocumentKind = request.DocumentKind;
        archive.DocumentId = request.DocumentId;
        await db.SaveChangesAsync();
        return Ok();
    }

    public sealed class ImportLinkRequest
    {
        public string DocumentKind { get; set; } = "";
        public int DocumentId { get; set; }
    }

    public sealed class WorkbookFormatRequest
    {
        public string Name { get; set; } = "";
        public CustomerWorkbookMapping Mapping { get; set; } = new();
    }

    [HttpPost("workbook")]
    [HasPermission("poformats.import.create")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    [EnableRateLimiting("import")]
    public async Task<IActionResult> Workbook(IFormFile file, [FromQuery] int companyId,
        [FromQuery] int clientId, [FromForm] string? mapping)
    {
        await access.AssertAccessAsync(int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub"), out var id) ? id : 0, companyId);
        if (!await db.Clients.AsNoTracking().AnyAsync(c => c.Id == clientId && c.CompanyId == companyId))
            return BadRequest(new { error = "Choose a customer from this company." });
        if (file == null || file.Length == 0 || file.Length > 10 * 1024 * 1024 ||
            !string.Equals(Path.GetExtension(file.FileName), ".xlsx", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { error = "Upload an Excel .xlsx file up to 10 MB." });
        try
        {
            using var stream = file.OpenReadStream();
            using var workbook = CustomerWorkbookReader.Open(stream);
            if (string.IsNullOrWhiteSpace(mapping))
                return Ok(new { sheets = workbook.Worksheets.Select(s => new { name = s.Name,
                    rows = s.RowsUsed().Take(30).Select(r => new { number = r.RowNumber(),
                        cells = Enumerable.Range(1, s.LastColumnUsed()?.ColumnNumber() ?? 1)
                            .Select(c => r.Cell(c).GetFormattedString()).ToArray() }).ToArray() }).ToArray() });
            var map = JsonSerializer.Deserialize<CustomerWorkbookMapping>(mapping,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (map == null) return BadRequest(new { error = "Choose the workbook columns." });
            var parsed = CustomerWorkbookReader.Parse(workbook, map);
            var uploadedAt = DateTime.UtcNow;
            var directory = Path.Combine(env.ContentRootPath, "Data/uploads/po_imports", uploadedAt.ToString("yyyy/MM"));
            Directory.CreateDirectory(directory);
            var filename = Guid.NewGuid().ToString("N") + ".xlsx";
            using var bytes = new MemoryStream();
            using (var original = file.OpenReadStream()) await original.CopyToAsync(bytes);
            await System.IO.File.WriteAllBytesAsync(Path.Combine(directory, filename), bytes.ToArray());
            var archive = new PoImportArchive { CompanyId = companyId, UploadedByUserId = UserId, UploadedAt = uploadedAt,
                OriginalFileName = Path.GetFileName(file.FileName), StoredPath = uploadedAt.ToString("yyyy/MM/") + filename,
                FileSizeBytes = file.Length, ContentSha256 = Convert.ToHexString(SHA256.HashData(bytes.ToArray())).ToLowerInvariant(),
                ParseOutcome = parsed.Warnings.Count > 0 ? "partial-ok" : "ok", ItemsExtracted = parsed.Items.Count };
            db.PoImportArchives.Add(archive);
            await db.SaveChangesAsync();
            parsed.ArchiveId = archive.Id;
            return Ok(parsed);
        }
        catch (InvalidOperationException ex)
        {
            logger.LogWarning(ex, "Customer workbook mapping rejected");
            return BadRequest(new { error = "Check the selected sheet, header row and distinct column mappings. Use a workbook with at most 30 sheets, 10,000 rows and 100 columns." });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Customer workbook could not be read");
            return BadRequest(new { error = "This workbook could not be read. Save it as a valid .xlsx file and try again." });
        }
    }
}
