using System.Reflection;
using ClosedXML.Excel;
using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Turns any <see cref="ReportResultDto"/> into a styled .xlsx.
    ///
    /// Generic on purpose: every accounting report shares the envelope, so they all
    /// share one export implementation and cannot drift apart in styling, provenance
    /// header, or injection safety. Column layout comes from
    /// <see cref="ReportResultDto.Columns"/>, so a report that gains a column gets it
    /// in Excel with no change here.
    ///
    /// Style matches the existing Sale Report / Tax Sheet exports (grey merged title
    /// banner, italic provenance line, bold frozen header row, #,##0.00 money) so the
    /// whole product exports one recognisable document.
    ///
    /// Two deliberate constraints:
    ///  • Totals are written as an ORDINARY bold row, never an <c>IXLTable</c> totals
    ///    row — ClosedXML 0.104.2 corrupts table totals rows on SaveAs (known issue
    ///    in this repo).
    ///  • Every operator-supplied string routes through
    ///    <see cref="ExcelTemplateEngine.CsvSafe"/> so a payee or description named
    ///    <c>=WEBSERVICE(...)</c> can't execute in the recipient's Excel.
    /// </summary>
    public static class ReportExcelBuilder
    {
        private static readonly XLColor Grey = XLColor.FromHtml("#D9D9D9");
        private static readonly XLColor Muted = XLColor.FromHtml("#5F6D7E");
        private static readonly XLColor GroupFill = XLColor.FromHtml("#F0F7FF");

        private const string MoneyFormat = "#,##0.00";
        private const string DateFormat = "dd-MM-yyyy";

        /// <summary>Hard ceiling on exported detail rows. An export beyond this is
        /// almost certainly an unfiltered year of data; we truncate and say so on the
        /// sheet rather than build a workbook that never opens.</summary>
        public const int MaxRows = 50_000;

        public static byte[] Build(ReportResultDto report)
        {
            var columns = report.Columns.Count > 0 ? report.Columns : InferColumns(report);
            var colCount = Math.Max(columns.Count, 1);

            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add(SheetName(report.Title));

            SetColumnWidths(ws, columns);

            var r = 1;
            r = WriteBanner(ws, report, colCount, r);
            var headerRow = r;
            WriteHeader(ws, columns, r);
            r++;

            r = WriteRows(ws, report, columns, r, out var written);
            r = WriteTotals(ws, report, columns, r);

            if (written >= MaxRows)
            {
                r++;
                ws.Cell(r, 1).Value = $"Truncated at {MaxRows:N0} rows — narrow the filters for a complete export.";
                ws.Range(r, 1, r, colCount).Merge().Style.Font.SetItalic().Font.SetFontColor(XLColor.DarkRed);
                r++;
            }

            if (report.GroupSummaries.Count > 0)
                WriteGroupSummaries(ws, report, colCount, r + 1);

            // Freeze the header so a long detail list stays readable while scrolling.
            ws.SheetView.FreezeRows(headerRow);

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            return ms.ToArray();
        }

        // ── Banner ────────────────────────────────────────────────────────────────

        private static int WriteBanner(IXLWorksheet ws, ReportResultDto report, int colCount, int r)
        {
            ws.Cell(r, 1).Value = Safe(report.CompanyName);
            var title = ws.Range(r, 1, r, colCount).Merge();
            title.Style.Font.FontSize = 20;
            title.Style.Font.Bold = true;
            title.Style.Fill.BackgroundColor = Grey;
            title.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Row(r).Height = 30;
            r++;

            ws.Cell(r, 1).Value = Safe(report.Title);
            var sub = ws.Range(r, 1, r, colCount).Merge();
            sub.Style.Font.FontSize = 15;
            sub.Style.Fill.BackgroundColor = Grey;
            sub.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Row(r).Height = 22;
            r++;

            // Provenance: period, the filters that shaped it, whether it came from
            // the ledger, and when it was produced. A printed report with no
            // provenance is not auditable.
            var parts = new List<string> { report.PeriodLabel };
            parts.AddRange(report.FiltersApplied);
            parts.Add(report.LedgerSourced ? "Source: general ledger" : "Source: payment subledger (GL posting off)");
            parts.Add($"Generated {report.GeneratedAt:dd-MM-yyyy HH:mm}");

            ws.Cell(r, 1).Value = Safe(string.Join("  ·  ", parts));
            var meta = ws.Range(r, 1, r, colCount).Merge();
            meta.Style.Font.Italic = true;
            meta.Style.Font.FontColor = Muted;
            meta.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            meta.Style.Alignment.WrapText = true;
            r += 2; // blank spacer
            return r;
        }

        private static void WriteHeader(IXLWorksheet ws, List<ReportColumnDto> columns, int r)
        {
            for (var c = 0; c < columns.Count; c++)
            {
                var cell = ws.Cell(r, c + 1);
                cell.Value = Safe(columns[c].Label);
                cell.Style.Font.Bold = true;
                cell.Style.Fill.BackgroundColor = Grey;
                cell.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
                cell.Style.Alignment.Horizontal = IsNumeric(columns[c].Format)
                    ? XLAlignmentHorizontalValues.Right
                    : XLAlignmentHorizontalValues.Left;
            }
        }

        // ── Detail rows ───────────────────────────────────────────────────────────

        private static int WriteRows(IXLWorksheet ws, ReportResultDto report,
            List<ReportColumnDto> columns, int r, out int written)
        {
            written = 0;
            foreach (var row in report.Rows)
            {
                if (written >= MaxRows) break;
                var props = PropertyMap(row.GetType());
                for (var c = 0; c < columns.Count; c++)
                {
                    if (!props.TryGetValue(columns[c].Key, out var prop)) continue;
                    WriteValue(ws.Cell(r, c + 1), prop.GetValue(row), columns[c].Format);
                }
                r++;
                written++;
            }
            return r;
        }

        private static int WriteTotals(IXLWorksheet ws, ReportResultDto report,
            List<ReportColumnDto> columns, int r)
        {
            var totalled = columns.Where(c => c.Totalled).ToList();
            if (totalled.Count == 0 && report.Totals.Count == 0) return r;

            // Ordinary row, deliberately NOT an IXLTable totals row — see class remarks.
            var labelWritten = false;
            for (var c = 0; c < columns.Count; c++)
            {
                var cell = ws.Cell(r, c + 1);
                cell.Style.Font.Bold = true;
                cell.Style.Border.TopBorder = XLBorderStyleValues.Double;
                cell.Style.Fill.BackgroundColor = Grey;

                if (columns[c].Totalled && report.Totals.TryGetValue(columns[c].Key, out var total))
                {
                    cell.Value = total;
                    cell.Style.NumberFormat.Format = MoneyFormat;
                    cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
                }
                else if (!labelWritten && !IsNumeric(columns[c].Format))
                {
                    cell.Value = "Total";
                    labelWritten = true;
                }
            }
            r++;

            // Totals the columns can't express (counts, net positions).
            foreach (var extra in report.Totals.Where(t => !columns.Any(c => c.Totalled && c.Key == t.Key)))
            {
                ws.Cell(r, 1).Value = Safe(Humanise(extra.Key));
                ws.Cell(r, 1).Style.Font.Bold = true;
                var valueCell = ws.Cell(r, 2);
                valueCell.Value = extra.Value;
                valueCell.Style.NumberFormat.Format =
                    extra.Key.EndsWith("Count", StringComparison.OrdinalIgnoreCase) ? "#,##0" : MoneyFormat;
                valueCell.Style.Font.Bold = true;
                r++;
            }
            return r;
        }

        // ── Grouped summaries (Expenses by Account / by Payee, …) ─────────────────

        private static void WriteGroupSummaries(IXLWorksheet ws, ReportResultDto report, int colCount, int r)
        {
            foreach (var group in report.GroupSummaries)
            {
                ws.Cell(r, 1).Value = Safe(group.Title);
                var head = ws.Range(r, 1, r, Math.Min(4, colCount)).Merge();
                head.Style.Font.Bold = true;
                head.Style.Font.FontSize = 12;
                head.Style.Fill.BackgroundColor = GroupFill;
                r++;

                foreach (var label in new[] { "", "Amount", "Tax", "Count" }.Select((l, i) => (l, i)))
                {
                    var cell = ws.Cell(r, label.i + 1);
                    cell.Value = label.l;
                    cell.Style.Font.Bold = true;
                    cell.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
                }
                r++;

                foreach (var row in group.Rows)
                {
                    ws.Cell(r, 1).Value = Safe(row.Label);
                    ws.Cell(r, 2).Value = row.Amount;
                    ws.Cell(r, 2).Style.NumberFormat.Format = MoneyFormat;
                    ws.Cell(r, 3).Value = row.Tax;
                    ws.Cell(r, 3).Style.NumberFormat.Format = MoneyFormat;
                    ws.Cell(r, 4).Value = row.Count;
                    r++;
                }

                ws.Cell(r, 1).Value = "Total";
                ws.Cell(r, 1).Style.Font.Bold = true;
                ws.Cell(r, 2).Value = group.Total;
                ws.Cell(r, 2).Style.NumberFormat.Format = MoneyFormat;
                ws.Cell(r, 2).Style.Font.Bold = true;
                ws.Cell(r, 2).Style.Border.TopBorder = XLBorderStyleValues.Thin;
                r += 2;
            }
        }

        // ── Value writing ─────────────────────────────────────────────────────────

        private static void WriteValue(IXLCell cell, object? value, string format)
        {
            if (value == null) { cell.Value = ""; return; }

            switch (format)
            {
                case "money":
                    cell.Value = ToDecimal(value);
                    cell.Style.NumberFormat.Format = MoneyFormat;
                    cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
                    return;
                case "int":
                    cell.Value = ToDecimal(value);
                    cell.Style.NumberFormat.Format = "#,##0";
                    cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
                    return;
                case "date":
                    if (value is DateTime dt)
                    {
                        cell.Value = dt;
                        cell.Style.DateFormat.Format = DateFormat;
                    }
                    else cell.Value = Safe(value.ToString());
                    return;
                default:
                    cell.Value = Safe(value.ToString());
                    return;
            }
        }

        private static decimal ToDecimal(object value) => value switch
        {
            decimal d => d,
            int i => i,
            long l => l,
            double db => (decimal)db,
            _ => decimal.TryParse(value.ToString(), out var p) ? p : 0m,
        };

        private static bool IsNumeric(string format) => format is "money" or "int";

        /// <summary>Shared with the template engine so injection neutralisation has
        /// exactly one implementation.</summary>
        private static string Safe(string? s) => ExcelTemplateEngine.CsvSafe(s);

        // ── Layout helpers ────────────────────────────────────────────────────────

        private static void SetColumnWidths(IXLWorksheet ws, List<ReportColumnDto> columns)
        {
            for (var c = 0; c < columns.Count; c++)
            {
                // Names and descriptions run long in this catalog; money stays compact.
                var width = columns[c].Format switch
                {
                    "money" or "int" => 15,
                    "date" => 12,
                    _ => columns[c].Key.Contains("escription", StringComparison.OrdinalIgnoreCase)
                         || columns[c].Key.Contains("ccount", StringComparison.OrdinalIgnoreCase)
                         || columns[c].Key.Contains("ayee", StringComparison.OrdinalIgnoreCase)
                         || columns[c].Key.Contains("ontact", StringComparison.OrdinalIgnoreCase) ? 30 : 18,
                };
                ws.Column(c + 1).Width = width;
            }
        }

        /// <summary>Excel sheet names cap at 31 chars and reject <c>: \ / ? * [ ]</c>.</summary>
        private static string SheetName(string title)
        {
            var cleaned = new string((title ?? "Report")
                .Select(ch => ":\\/?*[]".Contains(ch) ? '-' : ch).ToArray()).Trim();
            if (cleaned.Length == 0) cleaned = "Report";
            return cleaned.Length <= 31 ? cleaned : cleaned[..31];
        }

        /// <summary>"totalTax" → "Total tax". Only used for the extra-totals block.</summary>
        private static string Humanise(string key)
        {
            var spaced = string.Concat(key.Select((ch, i) =>
                i > 0 && char.IsUpper(ch) ? " " + char.ToLowerInvariant(ch) : ch.ToString()));
            return char.ToUpperInvariant(spaced[0]) + spaced[1..];
        }

        // Reflection is cached per row type: a 50k-row export would otherwise pay
        // GetProperty on every cell.
        private static readonly Dictionary<Type, Dictionary<string, PropertyInfo>> PropCache = new();
        private static readonly object PropCacheLock = new();

        private static Dictionary<string, PropertyInfo> PropertyMap(Type type)
        {
            lock (PropCacheLock)
            {
                if (PropCache.TryGetValue(type, out var cached)) return cached;
                var map = type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                    .ToDictionary(p => Camel(p.Name), p => p, StringComparer.OrdinalIgnoreCase);
                PropCache[type] = map;
                return map;
            }
        }

        private static string Camel(string name) =>
            name.Length == 0 ? name : char.ToLowerInvariant(name[0]) + name[1..];

        /// <summary>Fallback when a report ships no column metadata: every public
        /// property, in declaration order, guessing format from the CLR type.</summary>
        private static List<ReportColumnDto> InferColumns(ReportResultDto report)
        {
            var first = report.Rows.FirstOrDefault();
            if (first == null) return new List<ReportColumnDto>();
            return first.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Select(p => new ReportColumnDto
                {
                    Key = Camel(p.Name),
                    Label = Humanise(p.Name),
                    Format = Nullable.GetUnderlyingType(p.PropertyType) is { } u
                        ? FormatFor(u) : FormatFor(p.PropertyType),
                })
                .ToList();
        }

        private static string FormatFor(Type t) =>
            t == typeof(decimal) ? "money"
            : t == typeof(DateTime) ? "date"
            : t == typeof(int) || t == typeof(long) ? "int"
            : "text";
    }
}
