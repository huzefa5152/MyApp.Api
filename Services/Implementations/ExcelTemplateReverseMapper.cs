using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class ExcelTemplateReverseMapper : IExcelTemplateReverseMapper
    {
        // Mirrors ExcelTemplateEngine so forward/reverse stay in sync.
        private static readonly Regex FieldRegex = new(@"\{\{([^}]+)\}\}", RegexOptions.Compiled);
        private static readonly Regex EachStartRegex = new(@"\{\{\s*#each\s+(\w+)", RegexOptions.Compiled);
        private static readonly Regex EachEndRegex = new(@"\{\{\s*/each\s*\}\}", RegexOptions.Compiled);

        // Maps placeholder expressions (like "fmtDate deliveryDate", "fmt subtotal",
        // "this.quantity") to the canonical field key we use in DTOs. Strips helper
        // prefixes and "this." so the map key is just the entity field name.
        private static string CanonicalizeFieldKey(string rawExpression)
        {
            var expr = rawExpression.Trim();
            // Strip any leading helper word ("fmt", "fmtDec", "fmtDate", "formatCurrency",
            // "join", "joinDates", "nl2br"). Helpers always have a single space
            // between helper name and field; if there's a space, last token is the field.
            if (expr.Contains(' '))
            {
                var parts = expr.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                expr = parts[^1];
            }
            if (expr.StartsWith("this.", StringComparison.OrdinalIgnoreCase))
                expr = expr[5..];
            return expr;
        }

        private static bool IsControlExpression(string expr)
        {
            var e = expr.Trim();
            return e.StartsWith("#each") || e.StartsWith("/each") ||
                   e.StartsWith("#if") || e.StartsWith("else") || e.StartsWith("/if") ||
                   e == "@index";
        }

        private readonly ConcurrentDictionary<string, (DateTime WrittenAt, TemplateCellMap Map)> _cache = new();

        public TemplateCellMap Build(string templateFilePath)
        {
            if (!File.Exists(templateFilePath))
                throw new FileNotFoundException("Excel template not found", templateFilePath);

            var writtenAt = File.GetLastWriteTimeUtc(templateFilePath);
            if (_cache.TryGetValue(templateFilePath, out var cached) && cached.WrittenAt == writtenAt)
                return cached.Map;

            var map = ParseTemplate(templateFilePath);
            _cache[templateFilePath] = (writtenAt, map);
            return map;
        }

        private static TemplateCellMap ParseTemplate(string path)
        {
            using var wb = new XLWorkbook(path);
            // Build on the first sheet that contains any placeholder — templates
            // occasionally carry helper sheets (MergeFields, MergeFieldsData)
            // that shouldn't be treated as the canvas.
            int sheetIndex = 0;
            IXLWorksheet? target = null;
            int idx = 0;
            foreach (var ws in wb.Worksheets)
            {
                if (WorksheetContainsPlaceholder(ws))
                {
                    target = ws;
                    sheetIndex = idx;
                    break;
                }
                idx++;
            }
            target ??= wb.Worksheets.First();

            var map = new TemplateCellMap { SheetIndex = sheetIndex };

            int lastRow = target.LastRowUsed()?.RowNumber() ?? 0;
            int lastCol = target.LastColumnUsed()?.ColumnNumber() ?? 0;

            // ── Pass 1: locate the items loop bounds by scanning row-level text ──
            int eachRow = 0, eachEndRow = 0;
            for (int r = 1; r <= lastRow; r++)
            {
                var rowText = GetRowText(target, r, lastCol);
                if (eachRow == 0 && EachStartRegex.IsMatch(rowText))
                {
                    eachRow = r;
                    continue;
                }
                if (eachRow != 0 && eachEndRow == 0 && EachEndRegex.IsMatch(rowText))
                {
                    eachEndRow = r;
                    break;
                }
            }

            // ── Pass 2: walk every cell, classify as header field or item column ──
            for (int r = 1; r <= lastRow; r++)
            {
                for (int c = 1; c <= lastCol; c++)
                {
                    var val = target.Cell(r, c).GetString();
                    if (string.IsNullOrEmpty(val) || !val.Contains("{{")) continue;

                    foreach (Match m in FieldRegex.Matches(val))
                    {
                        var raw = m.Groups[1].Value.Trim();
                        if (IsControlExpression(raw)) continue;

                        var key = CanonicalizeFieldKey(raw);
                        if (string.IsNullOrWhiteSpace(key)) continue;

                        bool insideItems = eachRow > 0 && eachEndRow > 0 && r > eachRow && r < eachEndRow;
                        if (insideItems)
                        {
                            // Only keep the first occurrence per item field (templates
                            // sometimes repeat the same placeholder across merged cells).
                            map.ItemColumns.TryAdd(key, c);
                        }
                        else
                        {
                            map.HeaderFields.TryAdd(key, (r, c));
                        }
                    }
                }
            }

            if (eachRow > 0 && eachEndRow > eachRow)
            {
                // When the template is EXPORTED, ExcelTemplateEngine deletes
                // the {{#each items N}} marker row AND the {{/each}} row and
                // writes item data starting at the position of the deleted
                // #each row (every later row shifts up by 1). So in a
                // filled-in challan file the first item sits on `eachRow`,
                // not `eachRow + 1`. Using +1 here silently skipped the
                // first item on every import.
                map.ItemsStartRow = eachRow;
                map.ItemsEndMarkerRow = eachEndRow - 1;
            }

            return map;
        }

        private static bool WorksheetContainsPlaceholder(IXLWorksheet ws)
        {
            int lastRow = ws.LastRowUsed()?.RowNumber() ?? 0;
            int lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 0;
            for (int r = 1; r <= lastRow; r++)
                for (int c = 1; c <= lastCol; c++)
                {
                    var v = ws.Cell(r, c).GetString();
                    if (!string.IsNullOrEmpty(v) && v.Contains("{{")) return true;
                }
            return false;
        }

        private static string GetRowText(IXLWorksheet ws, int row, int lastCol)
        {
            var parts = new List<string>();
            for (int c = 1; c <= lastCol; c++)
            {
                var v = ws.Cell(row, c).GetString();
                if (!string.IsNullOrEmpty(v)) parts.Add(v);
            }
            return string.Join(" ", parts);
        }
    }
}
