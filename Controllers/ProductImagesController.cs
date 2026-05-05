using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace MyApp.Api.Controllers;

/// <summary>
/// Public catalog endpoints used by the marketing landing page. Returns
/// image URLs from <c>wwwroot/images/products/</c> grouped by category —
/// no DB access, no tenant data, no PII. Intentionally anonymous so the
/// pre-login landing page can fetch product imagery without a token.
///
/// Inputs are tightly bounded:
///   - Category names are regex-restricted to <c>[a-zA-Z0-9-]+</c>, so
///     path-traversal via "../something" is rejected at the controller.
///   - File listing is restricted to a fixed image-extension whitelist.
/// If a future change adds non-public folders under <c>images/products/</c>
/// (e.g. tenant-specific assets), revisit the AllowAnonymous gate.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/product-images")]
public class ProductImagesController : ControllerBase
{
    private readonly IWebHostEnvironment _env;

    public ProductImagesController(IWebHostEnvironment env)
    {
        _env = env;
    }

    /// <summary>
    /// Returns the list of image URLs for a given product category folder.
    /// Images are served from wwwroot/images/products/{category}/
    /// </summary>
    [HttpGet("{category}")]
    public IActionResult GetImages(string category)
    {
        // Sanitize: only allow alphanumeric + hyphens
        if (string.IsNullOrWhiteSpace(category) ||
            !System.Text.RegularExpressions.Regex.IsMatch(category, @"^[a-zA-Z0-9\-]+$"))
        {
            return BadRequest("Invalid category name.");
        }

        var folderPath = Path.Combine(_env.WebRootPath ?? "wwwroot", "images", "products", category);

        if (!Directory.Exists(folderPath))
            return Ok(Array.Empty<string>());

        var allowedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif"
        };

        var images = Directory.GetFiles(folderPath)
            .Where(f => allowedExtensions.Contains(Path.GetExtension(f)))
            .Select(f => $"/images/products/{category}/{Path.GetFileName(f)}")
            .OrderBy(f => f)
            .ToList();

        return Ok(images);
    }

    /// <summary>
    /// Returns all categories with their image counts.
    /// </summary>
    [HttpGet]
    public IActionResult GetCategories()
    {
        var productsPath = Path.Combine(_env.WebRootPath ?? "wwwroot", "images", "products");

        if (!Directory.Exists(productsPath))
            return Ok(Array.Empty<object>());

        var allowedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif"
        };

        var categories = Directory.GetDirectories(productsPath)
            .Select(d => new
            {
                Name = Path.GetFileName(d),
                ImageCount = Directory.GetFiles(d)
                    .Count(f => allowedExtensions.Contains(Path.GetExtension(f)))
            })
            .Where(c => c.ImageCount > 0)
            .OrderBy(c => c.Name)
            .ToList();

        return Ok(categories);
    }
}
