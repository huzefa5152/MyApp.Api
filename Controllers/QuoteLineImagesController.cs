using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;

namespace MyApp.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/companies/{companyId:int}/quote-images")]
public class QuoteLineImagesController(IWebHostEnvironment environment, ILogger<QuoteLineImagesController> logger) : ControllerBase
{
    [HttpPost]
    [HasAnyPermission("salesquotes.manage.create", "salesquotes.manage.update")]
    [AuthorizeCompany]
    public async Task<IActionResult> Upload(int companyId, IFormFile file)
    {
        var error = ImageUploadValidator.Validate(file, ImageUploadValidator.LogoMaxBytes);
        if (error != null) return BadRequest(new { error });
        var url = $"/data/uploads/quoteitems/company_{companyId}/{Guid.NewGuid():N}{Path.GetExtension(file.FileName).ToLowerInvariant()}";
        try
        {
            var path = Path.Combine(environment.ContentRootPath, url.TrimStart('/'));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await using var stream = new FileStream(path, FileMode.CreateNew);
            await file.CopyToAsync(stream);
            return Ok(new { url });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Quote line image upload failed for company {CompanyId}", companyId);
            return StatusCode(500, new { error = "Could not save the image. Please try again." });
        }
    }
}
