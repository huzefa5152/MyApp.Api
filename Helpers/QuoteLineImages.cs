using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers;

public static class QuoteLineImages
{
    public const int MaxUrlLength = 300;
    private static readonly Regex Pattern = new(
        @"^/data/uploads/quoteitems/company_(?<company>[1-9]\d*)/[a-f0-9]{32}\.(png|jpg|jpeg|webp|gif)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static int? CompanyId(string? url)
    {
        if (url == null || url.Length > MaxUrlLength) return null;
        var match = Pattern.Match(url);
        return match.Success && int.TryParse(match.Groups["company"].Value, out var id) ? id : null;
    }

    public static string? Normalize(string? url, int companyId, string contentRoot)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        var path = url.Trim();
        if (CompanyId(path) != companyId || !File.Exists(Path.Combine(contentRoot, path.TrimStart('/'))))
            throw new InvalidOperationException("Choose an uploaded line image belonging to this company.");
        return path;
    }
}
