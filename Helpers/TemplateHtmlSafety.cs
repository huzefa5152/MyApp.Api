using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers;

/// <summary>
/// Removes the constructs that can RUN from operator-edited print-template
/// HTML: script blocks, script-capable tags, inline event handlers and
/// javascript:/vbscript: URLs. A template is printed in a window that shares
/// the app's origin, so script in one would run as whoever prints it, with their
/// login token in reach (one company's template editor could take over the
/// seed admin). Layout, styles, images and merge fields are untouched; no
/// shipped template uses any of these, so a normal template is unchanged.
///
/// The browser applies the same rules on render (myapp-frontend/src/utils/
/// printSafety.js) plus a Content-Security-Policy, so rows saved before this
/// existed are made safe too. Keep the two in step.
/// </summary>
public static class TemplateHtmlSafety
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(2);
    private const RegexOptions Opts = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;

    private static readonly Regex ScriptBlock = new(@"<script\b[\s\S]*?</script\s*>", Opts, Timeout);
    private static readonly Regex ActiveTag = new(@"</?(?:script|iframe|frame|frameset|object|embed|applet|portal)\b[^>]*>", Opts, Timeout);
    private static readonly Regex EventAttr = new(@"(<[a-z][^>]*?)[\s/]+on[a-z]+\s*=\s*(?:""[^""]*""|'[^']*'|[^\s>]+)", Opts, Timeout);
    private static readonly Regex ScriptUrl = new(@"((?:href|src|xlink:href|action|formaction|data)\s*=\s*[""']?)\s*(?:javascript|vbscript)\s*:", Opts, Timeout);

    public static string? Strip(string? html)
    {
        if (string.IsNullOrEmpty(html)) return html;
        try
        {
            var output = ScriptBlock.Replace(html, "");
            output = ActiveTag.Replace(output, "");
            for (string? previous = null; previous != output;)
            {
                previous = output;
                output = EventAttr.Replace(output, "$1");
            }
            return ScriptUrl.Replace(output, "$1about:blank#");
        }
        catch (RegexMatchTimeoutException)
        {
            // A pathological input is refused rather than stored unchecked.
            throw new InvalidOperationException("This template could not be checked. Simplify its HTML and try again.");
        }
    }
}
