using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The company's own letterhead for an exported report: logo, name, address,
    /// phone, NTN / STRN, and the header colours of the company's default Bill
    /// template (sent by the browser, which already reads them for Print and PDF).
    ///
    /// Presentation only. It never changes a figure, a row or a column of the
    /// report; a workbook built without it is the old workbook exactly.
    /// </summary>
    public sealed class ReportExcelLetterhead
    {
        public string Name { get; init; } = "";
        public string? Address { get; init; }
        public string? Phone { get; init; }
        public string? Ntn { get; init; }
        public string? Strn { get; init; }
        public byte[]? Logo { get; init; }
        public XLColor HeaderFill { get; init; } = XLColor.FromHtml("#0D47A1");
        public XLColor HeaderText { get; init; } = XLColor.White;
        public XLColor Accent { get; init; } = XLColor.FromHtml("#0D47A1");

        private static readonly Regex Hex = new("^#?[0-9a-fA-F]{6}$", RegexOptions.Compiled);

        /// <summary>
        /// Loads the letterhead of a company the caller has ALREADY been authorised
        /// for (the action carries <c>[AuthorizeCompany]</c>). Colours outside
        /// <c>#rrggbb</c> are ignored, never echoed into the workbook.
        /// </summary>
        public static async Task<ReportExcelLetterhead?> LoadAsync(AppDbContext db, string contentRoot,
            int companyId, string? fill, string? text)
        {
            var c = await db.Companies.AsNoTracking()
                .Where(x => x.Id == companyId)
                .Select(x => new { x.Name, x.BrandName, x.FullAddress, x.Phone, x.NTN, x.STRN, x.LogoPath })
                .FirstOrDefaultAsync();
            if (c == null) return null;

            byte[]? logo = null;
            var dataUrl = await PrivateImageDataUrl.ReadAsync(contentRoot, c.LogoPath);
            if (dataUrl != null && (dataUrl.StartsWith("data:image/png") || dataUrl.StartsWith("data:image/jpeg")))
            {
                try { logo = Convert.FromBase64String(dataUrl[(dataUrl.IndexOf(',') + 1)..]); }
                catch (FormatException) { logo = null; }
            }

            var accent = Parse(fill);
            return new ReportExcelLetterhead
            {
                Name = string.IsNullOrWhiteSpace(c.BrandName) ? c.Name : c.BrandName!,
                Address = c.FullAddress,
                Phone = c.Phone,
                Ntn = c.NTN,
                Strn = c.STRN,
                Logo = logo,
                // A template whose header has no fill (white) still needs a visible
                // header row: fall back to the app blue, and keep its text readable.
                HeaderFill = accent is { } a && !IsNearWhite(a) ? XLColor.FromHtml(a) : XLColor.FromHtml("#0D47A1"),
                HeaderText = accent is { } b && !IsNearWhite(b) && Parse(text) is { } t ? XLColor.FromHtml(t) : XLColor.White,
                Accent = accent is { } d && !IsNearWhite(d) ? XLColor.FromHtml(d) : XLColor.FromHtml("#1A2332"),
            };
        }

        private static string? Parse(string? hex)
        {
            if (string.IsNullOrWhiteSpace(hex) || !Hex.IsMatch(hex.Trim())) return null;
            var h = hex.Trim();
            return h.StartsWith('#') ? h : "#" + h;
        }

        private static bool IsNearWhite(string hex)
        {
            var r = Convert.ToInt32(hex.Substring(1, 2), 16);
            var g = Convert.ToInt32(hex.Substring(3, 2), 16);
            var b = Convert.ToInt32(hex.Substring(5, 2), 16);
            return r > 235 && g > 235 && b > 235;
        }

        /// <summary>Writes the letterhead from row <paramref name="r"/>; returns the next free row.</summary>
        public int Write(IXLWorksheet ws, int colCount, int r)
        {
            var first = r;
            var safe = (string? s) => SpreadsheetFormulaGuard.Neutralise(s);

            ws.Cell(r, 1).Value = safe(Name);
            var name = ws.Range(r, 1, r, colCount).Merge();
            name.Style.Font.FontSize = 20;
            name.Style.Font.Bold = true;
            name.Style.Font.FontColor = Accent;
            name.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            name.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            ws.Row(r).Height = 30;
            r++;

            var lines = new[]
            {
                string.Join("  ·  ", new[] { Address, Phone }.Where(s => !string.IsNullOrWhiteSpace(s))),
                string.Join("  ·  ", new[]
                {
                    string.IsNullOrWhiteSpace(Ntn) ? null : $"NTN {Ntn}",
                    string.IsNullOrWhiteSpace(Strn) ? null : $"STRN {Strn}",
                }.Where(s => s != null)),
            }.Where(s => s.Length > 0);
            foreach (var line in lines)
            {
                ws.Cell(r, 1).Value = safe(line);
                var cell = ws.Range(r, 1, r, colCount).Merge();
                cell.Style.Font.FontSize = 10;
                cell.Style.Font.FontColor = XLColor.FromHtml("#3D4A5C");
                cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                cell.Style.Alignment.WrapText = true;
                r++;
            }

            if (Logo != null)
            {
                try
                {
                    using var stream = new MemoryStream(Logo);
                    var pic = ws.AddPicture(stream).MoveTo(ws.Cell(first, 1), 4, 2);
                    var height = Math.Max(1, (r - first)) * 18.0;
                    pic.ScaleHeight(Math.Min(1.0, height / Math.Max(1, pic.OriginalHeight)), true);
                    if (pic.Width > 140) pic.ScaleWidth(140.0 / pic.OriginalWidth, true);
                }
                catch (Exception) { /* an unreadable logo is left out, never fatal */ }
            }

            // A rule in the company's colour between the letterhead and the report.
            ws.Range(r - 1, 1, r - 1, colCount).Style.Border.BottomBorder = XLBorderStyleValues.Medium;
            ws.Range(r - 1, 1, r - 1, colCount).Style.Border.BottomBorderColor = Accent;
            return r + 1;
        }

        public void StyleHeaderCell(IXLCell cell)
        {
            cell.Style.Fill.BackgroundColor = HeaderFill;
            cell.Style.Font.FontColor = HeaderText;
            cell.Style.Font.Bold = true;
        }
    }
}
