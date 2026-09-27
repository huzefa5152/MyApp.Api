namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Audit H-14 (2026-05-13): the ONE rule for writing an operator-controlled
    /// string into a spreadsheet cell. A leading <c>=</c> / <c>+</c> / <c>-</c> /
    /// <c>@</c> / tab / CR is prefixed with a single quote so Excel does not run
    /// it as a formula (=WEBSERVICE -> SSRF, =HYPERLINK -> exfil, =cmd|... -> RCE).
    /// <see cref="ExcelTemplateEngine"/>'s CsvSafe delegates here; it lives in
    /// its own file so small builders (and their offline harnesses) can use it
    /// without the whole template engine.
    /// </summary>
    public static class SpreadsheetFormulaGuard
    {
        public static string Neutralise(string? s)
        {
            if (string.IsNullOrEmpty(s)) return s ?? "";
            var first = s[0];
            if (first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r')
                return "'" + s;
            return s;
        }
    }
}
