using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.VisualBasic.FileIO;
using MyApp.Api.DTOs;
using NPOI.HSSF.UserModel;
using NPOI.SS.UserModel;
using NPOI.XSSF.UserModel;
using UglyToad.PdfPig;

namespace MyApp.Api.Helpers;

public static class EmailAttachmentReader
{
    public const int MaxBytes = 10 * 1024 * 1024;
    public static EmailDraftDto FromText(string subject, string text)
    {
        if (text.Length > 250_000) throw new ArgumentException("The attachment contains too much text.");
        var rows = text.Split('\n').Take(5000).Select(line => Regex.Split(line.TrimEnd('\r'), @"\t|\s{2,}|\s*\|\s*",
            RegexOptions.None, TimeSpan.FromSeconds(1))).ToList();
        return FromRows(subject, text, rows);
    }
    private static EmailDraftDto FromRows(string subject, string text, IEnumerable<string[]> rows)
    {
        var html = new StringBuilder("<table>");
        foreach (var row in rows)
        {
            if (row.Length == 0) { html.Append("</table><table>"); continue; }
            html.Append("<tr>");
            foreach (var cell in row.Take(40)) html.Append("<td>").Append(WebUtility.HtmlEncode(cell)).Append("</td>");
            html.Append("</tr>");
        }
        html.Append("</table>");
        var draft = EmailEnquiryExtractor.Extract(subject, new(text, html.ToString(), []));
        foreach (var item in draft.Items) item.SourceDescription = item.Description;
        return draft;
    }
    public static EmailAttachmentPreview Read(string subject, EmailAttachmentInfo info, byte[] bytes)
    {
        if (bytes.Length == 0 || bytes.Length > MaxBytes) throw new ArgumentException("Use a non-empty attachment up to 10 MB.");
        var extension = Path.GetExtension(info.FileName).ToLowerInvariant();
        var warnings = new List<string>();
        EmailDraftDto draft;
        string text;
        bool Starts(params byte[] signature) => bytes.AsSpan().StartsWith(signature);
        if (extension is ".png" or ".jpg" or ".jpeg" or ".webp")
        {
            var valid = extension == ".png" ? Starts(137, 80, 78, 71, 13, 10, 26, 10) : extension == ".webp"
                ? bytes.Length >= 12 && Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP"
                : Starts(255, 216, 255);
            if (!valid) throw new ArgumentException("The attachment contents do not match its image format.");
            return new(info.FileName, "", [], ["Read this image with OCR, then check every value against the source."], true, false, false);
        }
        if (extension == ".pdf")
        {
            if (!Starts(37, 80, 68, 70, 45)) throw new ArgumentException("The attachment is not a readable PDF.");
            using var document = PdfDocument.Open(bytes);
            if (document.NumberOfPages > 10) throw new ArgumentException("Split PDFs into files of at most 10 pages.");
            var lines = new List<string>();
            foreach (var page in document.GetPages())
            {
                var words = page.GetWords().Take(3001).ToList();
                if (words.Count > 3000) throw new ArgumentException("A PDF page contains too many words.");
                lines.AddRange(PoLayoutText.FromPdfPage(words.Select(w => new PositionedWord(w.Text,
                    w.BoundingBox.Left, w.BoundingBox.Right, w.BoundingBox.Top, w.BoundingBox.Bottom,
                    w.BoundingBox.Width, w.BoundingBox.Height)).ToList()));
            }
            text = string.Join('\n', lines);
            if (string.IsNullOrWhiteSpace(text)) return new(info.FileName, "", [], ["This PDF has no readable text layer. Use OCR and review the source."], true, false, false);
            draft = FromText(subject, text);
        }
        else if (extension is ".xlsx" or ".xls")
        {
            if (extension == ".xlsx")
            {
                if (!Starts(80, 75)) throw new ArgumentException("The attachment is not an Excel workbook.");
                using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
                if (zip.Entries.Count > 5000 || zip.Entries.Sum(e => e.Length) > 30 * 1024 * 1024)
                    throw new ArgumentException("The expanded workbook is too large.");
            }
            else if (!Starts(208, 207, 17, 224, 161, 177, 26, 225)) throw new ArgumentException("The attachment is not a legacy Excel workbook.");
            using IWorkbook workbook = extension == ".xls" ? new HSSFWorkbook(new MemoryStream(bytes)) : new XSSFWorkbook(new MemoryStream(bytes));
            if (workbook.NumberOfSheets > 5) throw new ArgumentException("Use a workbook with at most five sheets.");
            var rows = new List<string[]>();
            var formatter = new DataFormatter();
            for (var sheetIndex = 0; sheetIndex < workbook.NumberOfSheets; sheetIndex++)
            {
                var sheet = workbook.GetSheetAt(sheetIndex);
                rows.Add([]);
                if (sheet.LastRowNum >= 5000) throw new ArgumentException("Use sheets with at most 5,000 rows.");
                for (var n = sheet.FirstRowNum; n <= sheet.LastRowNum; n++)
                {
                    var row = sheet.GetRow(n); if (row == null) continue;
                    if (row.LastCellNum > 40) throw new ArgumentException("Use sheets with at most 40 columns.");
                    rows.Add(Enumerable.Range(0, Math.Max(0, (int)row.LastCellNum)).Select(c =>
                    {
                        var cell = row.GetCell(c);
                        if (cell?.CellType == CellType.Formula) { warnings.Add("Formula cells were skipped. Replace them with values before importing."); return ""; }
                        return cell == null ? "" : formatter.FormatCellValue(cell);
                    }).ToArray());
                }
            }
            text = string.Join('\n', rows.Select(r => string.Join('\t', r)));
            if (text.Length > 250_000) throw new ArgumentException("The workbook contains too much text.");
            draft = FromRows(subject, text, rows);
        }
        else if (extension is ".csv" or ".txt")
        {
            text = new UTF8Encoding(false, true).GetString(bytes).TrimStart('\uFEFF');
            if (text.Length > 250_000 || text.Contains('\0')) throw new ArgumentException("Use a UTF-8 text file up to 250,000 characters.");
            if (extension == ".csv")
            {
                using var parser = new TextFieldParser(new StringReader(text)) { HasFieldsEnclosedInQuotes = true };
                parser.SetDelimiters(",");
                var rows = new List<string[]>();
                while (!parser.EndOfData && rows.Count < 5000) rows.Add(parser.ReadFields() ?? []);
                if (!parser.EndOfData || rows.Any(r => r.Length > 40)) throw new ArgumentException("Use CSV files with at most 5,000 rows and 40 columns.");
                draft = FromRows(subject, text, rows);
            }
            else draft = FromText(subject, text);
        }
        else throw new ArgumentException("Supported files: PDF, XLSX, XLS, CSV, TXT, PNG, JPG and WebP.");
        warnings.AddRange(draft.Warnings);
        warnings.Add("Preview only: verify descriptions, quantities and units. No attachment price is applied.");
        return new(info.FileName, text, draft.Items, warnings.Distinct().ToList(), false, draft.RequiresBrand, draft.RequiresSpecifications);
    }
}
