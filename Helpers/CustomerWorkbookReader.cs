using ClosedXML.Excel;
using MyApp.Api.DTOs;
using System.Globalization;
using System.IO.Compression;

namespace MyApp.Api.Helpers;

public sealed class CustomerWorkbookMapping
{
    public string Sheet { get; set; } = "";
    public string[]? Headers { get; set; }
    public int HeaderRow { get; set; } = 1;
    public int DescriptionColumn { get; set; }
    public int QuantityColumn { get; set; }
    public int UnitColumn { get; set; }
    public int RateColumn { get; set; }
    public int RemarksColumn { get; set; }
    public int ItemCodeColumn { get; set; }
}

public static class CustomerWorkbookReader
{
    public static XLWorkbook Open(Stream stream)
    {
        if (!stream.CanSeek) throw new InvalidOperationException("Workbook stream must support seeking.");
        var start = stream.Position;
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true))
            if (zip.Entries.Count > 2000 || zip.Entries.Sum(e => e.Length) > 50L * 1024 * 1024)
                throw new InvalidOperationException("This workbook is too large when expanded.");
        stream.Position = start;
        var workbook = new XLWorkbook(stream);
        if (workbook.Worksheets.Count > 30 || workbook.Worksheets.Any(s =>
            (s.LastRowUsed()?.RowNumber() ?? 0) > 10000 || (s.LastColumnUsed()?.ColumnNumber() ?? 0) > 100))
        {
            workbook.Dispose();
            throw new InvalidOperationException("Use a workbook with at most 30 sheets, 10,000 rows and 100 columns.");
        }
        return workbook;
    }

    public static void ValidateMapping(CustomerWorkbookMapping map)
    {
        var columns = new[] { map.DescriptionColumn, map.QuantityColumn, map.UnitColumn, map.RateColumn, map.RemarksColumn, map.ItemCodeColumn };
        if (string.IsNullOrWhiteSpace(map.Sheet) || map.HeaderRow is < 1 or > 10000 || map.DescriptionColumn < 1 || map.QuantityColumn < 1
            || columns.Any(c => c < 0 || c > 100) || columns.Where(c => c > 0).Distinct().Count() != columns.Count(c => c > 0)
            || map.Headers is { Length: > 100 })
            throw new InvalidOperationException("Choose a worksheet, header row and distinct columns.");
    }

    public static ParsedPODto Parse(XLWorkbook workbook, CustomerWorkbookMapping map)
    {
        ValidateMapping(map);
        var sheet = workbook.Worksheets.FirstOrDefault(s => s.Name == map.Sheet)
            ?? throw new InvalidOperationException("Choose a worksheet from this file.");
        var last = sheet.LastRowUsed()?.RowNumber() ?? 0;
        if (map.HeaderRow < 1 || map.HeaderRow >= last || map.DescriptionColumn < 1 || map.QuantityColumn < 1)
            throw new InvalidOperationException("Choose a header row, description column and quantity column.");
        if (map.Headers is { Length: > 0 } && !map.Headers.SequenceEqual(Enumerable.Range(1, map.Headers.Length)
            .Select(c => sheet.Cell(map.HeaderRow, c).GetFormattedString().Trim()), StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException("The saved headers differ. Map this layout again.");
        var columns = new[] { map.DescriptionColumn, map.QuantityColumn, map.UnitColumn, map.RateColumn, map.RemarksColumn, map.ItemCodeColumn }.Where(c => c > 0).ToList();
        if (columns.Any(c => c > 100) || columns.Distinct().Count() != columns.Count)
            throw new InvalidOperationException("Map each field to a different column.");
        var result = new ParsedPODto();
        for (int row = map.HeaderRow + 1; row <= last; row++)
        {
            string Read(int col) => col > 0 ? sheet.Cell(row, col).GetFormattedString().Trim() : "";
            var description = Read(map.DescriptionColumn);
            var quantityText = Read(map.QuantityColumn);
            if (description.Length == 0 && quantityText.Length == 0) continue;
            if (description.Length == 0 || !decimal.TryParse(quantityText, NumberStyles.Number, CultureInfo.InvariantCulture, out var quantity) || quantity <= 0)
            {
                result.Warnings.Add($"Row {row}: description and a positive quantity are required. Review this row in the original file.");
                continue;
            }
            decimal? rate = null;
            if (map.RateColumn > 0 && Read(map.RateColumn).Length > 0)
            {
                if (!decimal.TryParse(Read(map.RateColumn), NumberStyles.Number, CultureInfo.InvariantCulture, out var value) || value < 0)
                {
                    result.Warnings.Add($"Row {row}: invalid price; enter the price during review.");
                }
                else rate = value;
            }
            result.Items.Add(new ParsedPOItemDto { Description = description, Quantity = quantity,
                Unit = Read(map.UnitColumn), UnitPrice = rate, Remarks = Read(map.RemarksColumn), ItemCode = Read(map.ItemCodeColumn) });
        }
        return result;
    }
}
