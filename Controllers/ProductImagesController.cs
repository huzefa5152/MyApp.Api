using Microsoft.AspNetCore.Mvc;

namespace MyApp.Api.Controllers;

[ApiController]
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
