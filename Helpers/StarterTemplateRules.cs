using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// What a shared starter design may contain (2026-10-29). Pure, so the HTTP API and the MCP
    /// tools check exactly the same things. A starter is seen by EVERY tenant, so:
    ///  - active content is refused outright (not silently stripped): an AI-written design that
    ///    tried to run script must be rejected, and the author told why;
    ///  - anything shaped like one tenant's data is refused: an NTN / CNIC / STRN number, a phone
    ///    number, an e-mail address, or an inline image big enough to be a logo -- use merge
    ///    fields and generic text instead (CLAUDE.md "A placeholder is seen by every tenant");
    ///  - merge fields the document type does not have are a WARNING, not a refusal: they print
    ///    blank, and the author has to accept that explicitly.
    /// </summary>
    public static class StarterTemplateRules
    {
        public const int MaxHtmlChars = 200_000;
        public const int MaxNameChars = 200;
        public const int MaxDescriptionChars = 500;
        /// <summary>An inline image over this many base64 characters (~6 KB) is a logo, not an icon.</summary>
        public const int MaxInlineImageChars = 8_000;

        private static readonly (Regex Pattern, string Reason)[] ActiveContent =
        {
            (new(@"<\s*(script|iframe|frame|object|embed|applet|base|meta|link)\b", RegexOptions.IgnoreCase), "a <script>, <iframe>, <object>, <embed>, <base>, <meta> or <link> tag"),
            (new(@"\son[a-z]+\s*=", RegexOptions.IgnoreCase), "an on... event handler attribute"),
            (new(@"(javascript|vbscript)\s*:", RegexOptions.IgnoreCase), "a javascript: or vbscript: link"),
            (new(@"\ssrcdoc\s*=", RegexOptions.IgnoreCase), "a srcdoc attribute"),
            (new(@"data:\s*text/html", RegexOptions.IgnoreCase), "a data:text/html link"),
        };

        private static readonly (Regex Pattern, string Reason)[] TenantData =
        {
            (new(@"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+"), "an e-mail address"),
            (new(@"(?<![\w#])\d{5}-\d{7}-\d(?!\w)"), "a CNIC number"),
            (new(@"(?<![\w#.])\d{13}(?![\w.])"), "a 13-digit CNIC or STRN number"),
            (new(@"(?<![\w#])\d{2}-\d{2}-\d{4}-\d{3}-\d{2}(?!\w)"), "an STRN number"),
            (new(@"(?<![\w#.-])[A-Z]?\d{7}(-\d)?(?![\w.%])"), "an NTN number"),
            (new(@"(\+92|0092|(?<![\w.])0)[\s-]?3\d{2}[\s-]?\d{7}(?!\w)"), "a mobile phone number"),
            (new(@"(\+92|0092|(?<![\w.])0)[\s-]?\d{2}[\s-]?\d{7,8}(?!\w)"), "a phone number"),
        };

        private static readonly Regex InlineImage = new(@"data:image/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)", RegexOptions.IgnoreCase);
        private static readonly Regex Mustache = new(@"\{\{\{?([^{}]*)\}?\}\}");
        private static readonly Regex Word = new(@"[A-Za-z_@][\w@]*");
        private static readonly Regex Literal = new("\"[^\"]*\"|'[^']*'|-?\\d+(\\.\\d+)?");

        /// <summary>Handlebars keywords and the helpers the app's templateEngine registers.</summary>
        public static readonly string[] Helpers =
        {
            "if", "unless", "each", "with", "else", "this", "fmtDate", "fmtDMY", "fmt", "fmtDec", "fmtQty", "nl2br",
            "richText", "join", "joinDates", "emptyRows", "math", "gt", "lt", "gte", "lte", "eq", "ne", "or", "and", "not",
            "uniqueTypes", "inc", "billEmptyRows", "taxEmptyRows", "stamp", "stamps", "lookup", "log", "true", "false", "null",
        };

        /// <summary>The first reason this HTML may not be a shared starter, or null.</summary>
        public static string? Refusal(string html)
        {
            if (html.Length > MaxHtmlChars) return $"The design is larger than {MaxHtmlChars:N0} characters.";
            foreach (var (pattern, reason) in ActiveContent)
                if (pattern.IsMatch(html)) return $"Active content is not allowed in a shared starter: it contains {reason}.";
            foreach (Match m in InlineImage.Matches(html))
                if (m.Groups[1].Value.Length > MaxInlineImageChars)
                    return "It contains an inline image large enough to be a company logo. A starter is seen by every company: leave the logo to the {{companyLogoPath}}-style merge field.";
            // Look for tenant data in the text and attributes, not inside merge-field tags or inline images.
            var text = InlineImage.Replace(Mustache.Replace(html, " "), " ");
            text = Regex.Replace(text, @"#[0-9a-fA-F]{3,8}\b", " "); // colours
            foreach (var (pattern, reason) in TenantData)
                if (pattern.Match(text) is { Success: true } hit)
                    return $"It contains what looks like {reason} (\"{hit.Value.Trim()}\"). A starter is seen by every company: use a merge field or generic text instead.";
            return null;
        }

        /// <summary>Merge-field names used in the HTML that this document type does not offer.</summary>
        public static List<string> UnknownFields(string html, IEnumerable<string> fieldExpressions)
        {
            var known = new HashSet<string>(Helpers, StringComparer.Ordinal);
            foreach (var expr in fieldExpressions)
                foreach (Match w in Word.Matches(expr)) known.Add(w.Value);
            var unknown = new SortedSet<string>(StringComparer.Ordinal);
            foreach (Match tag in Mustache.Matches(html))
            {
                var body = Literal.Replace(tag.Groups[1].Value, " ").Trim().TrimStart('#', '/', '^', '!', '>', '~').Trim();
                if (body.StartsWith('!')) continue; // comment
                foreach (Match w in Word.Matches(body))
                    if (!w.Value.StartsWith('@') && !known.Contains(w.Value)) unknown.Add(w.Value);
            }
            return unknown.ToList();
        }
    }
}
