using Microsoft.AspNetCore.StaticFiles;

namespace MyApp.Api.Helpers;

public static class PrivateImageDataUrl
{
    // Called only with an image path read from an already-authorized company.
    public static async Task<string?> ReadAsync(string contentRoot, string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        if (!url.StartsWith("/data/uploads/logos/", StringComparison.OrdinalIgnoreCase)
            && !url.StartsWith("/data/uploads/stamps/", StringComparison.OrdinalIgnoreCase)) return null;
        var root = Path.GetFullPath(Path.Combine(contentRoot, "data")) + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(Path.Combine(contentRoot, url.TrimStart('/')));
        if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) return null;
        if (new FileInfo(path).Length > ImageUploadValidator.LogoMaxBytes) return null;
        if (!new FileExtensionContentTypeProvider().TryGetContentType(path, out var mime)
            || !mime.StartsWith("image/", StringComparison.Ordinal)) return null;
        return $"data:{mime};base64,{Convert.ToBase64String(await File.ReadAllBytesAsync(path))}";
    }
}
