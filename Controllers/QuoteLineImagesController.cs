using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    // Per-line product photos for Sales Quote lines. Upload happens BEFORE the
    // quote is saved (the operator may still be typing line 1), so the file is
    // company-scoped rather than quote-scoped and the returned URL is stamped
    // onto the line when the quote is saved — SalesQuoteService re-validates it
    // against this company's folder, so a forged path can't get stored.
    //
    // Files are served publicly by the /data static provider, same class as the
    // company logo and print stamps: the print popup renders them with a plain
    // <img src>, which cannot carry an Authorization header. Names are GUIDs, so
    // the folder isn't enumerable.
    [ApiController]
    [Route("api/companies/{companyId:int}/quote-images")]
    [Authorize]
    public class QuoteLineImagesController : ControllerBase
    {
        private readonly IAuditLogService _audit;
        private readonly ILogger<QuoteLineImagesController> _logger;

        public QuoteLineImagesController(IAuditLogService audit, ILogger<QuoteLineImagesController> logger)
        {
            _audit = audit;
            _logger = logger;
        }

        private string? CurrentUserName => User.Identity?.Name;

        [HttpPost]
        [HasAnyPermission("salesquotes.manage.create", "salesquotes.manage.update")]
        [AuthorizeCompany]
        public async Task<IActionResult> Upload(int companyId, IFormFile file)
        {
            var err = ImageUploadValidator.Validate(file, ImageUploadValidator.LogoMaxBytes);
            if (err != null) return BadRequest(new { error = err });

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!ImageUploadValidator.AllowedExtensions.Contains(ext)) ext = ".png";

            var relDir = QuoteLineImages.CompanyRelDir(companyId);
            var absDir = Path.Combine(Directory.GetCurrentDirectory(), relDir);

            try
            {
                Directory.CreateDirectory(absDir);
                var fileName = $"{Guid.NewGuid():N}{ext}";
                var absPath = Path.Combine(absDir, fileName);
                using (var stream = new FileStream(absPath, FileMode.Create))
                {
                    await file.CopyToAsync(stream);
                }

                var url = QuoteLineImages.BuildUrl(companyId, fileName);
                await AuditAsync("QUOTELINEIMAGE_UPLOAD",
                    $"Uploaded quote line image {fileName} ({file.Length} bytes) in company {companyId}", companyId);
                return Ok(new { url });
            }
            catch (Exception ex)
            {
                // Never leak the filesystem path / exception text to the client.
                _logger.LogError(ex, "Quote line image upload failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not save the image. Please try again." });
            }
        }

        private async Task AuditAsync(string eventType, string message, int companyId)
        {
            try
            {
                await _audit.LogAsync(new AuditLog
                {
                    Timestamp = DateTime.UtcNow,
                    Level = "Information",
                    UserName = CurrentUserName,
                    HttpMethod = Request.Method,
                    RequestPath = Request.Path,
                    StatusCode = 200,
                    ExceptionType = eventType,
                    Message = message,
                    CompanyId = companyId,
                });
            }
            catch { /* audit must never break the operation */ }
        }
    }
}
