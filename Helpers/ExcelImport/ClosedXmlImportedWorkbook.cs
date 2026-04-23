using System.Globalization;
using ClosedXML.Excel;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// ClosedXML-backed reader for .xlsx / .xlsm uploads.
    /// </summary>
    public class ClosedXmlImportedWorkbook : IImportedWorkbook
    {
        private readonly XLWorkbook _wb;
        private readonly List<IXLWorksheet> _sheets;

        public ClosedXmlImportedWorkbook(Stream stream)
        {
            _wb = new XLWorkbook(stream);
            _sheets = _wb.Worksheets.ToList();
        }

        public int WorksheetCount => _sheets.Count;

        public int GetLastRow(int sheetIndex)
        {
            if (sheetIndex < 0 || sheetIndex >= _sheets.Count) return 0;
            return _sheets[sheetIndex].LastRowUsed()?.RowNumber() ?? 0;
        }

        public string GetString(int sheetIndex, int row, int col)
        {
            if (sheetIndex < 0 || sheetIndex >= _sheets.Count) return "";
            var cell = _sheets[sheetIndex].Cell(row, col);
            if (cell == null || cell.IsEmpty()) return "";
            try
            {
                var s = cell.GetFormattedString();
                return (s ?? "").Trim();
            }
            catch
            {
                return cell.GetString()?.Trim() ?? "";
            }
        }

        public decimal? GetDecimal(int sheetIndex, int row, int col)
        {
            if (sheetIndex < 0 || sheetIndex >= _sheets.Count) return null;
            var cell = _sheets[sheetIndex].Cell(row, col);
            if (cell == null || cell.IsEmpty()) return null;
            try
            {
                if (cell.DataType == XLDataType.Number)
                    return (decimal)cell.GetDouble();
            }
            catch { }
            var s = GetString(sheetIndex, row, col);
            if (string.IsNullOrWhiteSpace(s)) return null;
            var cleaned = s.Replace(",", "").Trim();
            return decimal.TryParse(cleaned, NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : null;
        }

        public int? GetInt(int sheetIndex, int row, int col)
        {
            var d = GetDecimal(sheetIndex, row, col);
            return d.HasValue ? (int)Math.Round(d.Value) : null;
        }

        public DateTime? GetDate(int sheetIndex, int row, int col)
        {
            if (sheetIndex < 0 || sheetIndex >= _sheets.Count) return null;
            var cell = _sheets[sheetIndex].Cell(row, col);
            if (cell == null || cell.IsEmpty()) return null;
            try
            {
                if (cell.DataType == XLDataType.DateTime)
                    return cell.GetDateTime();
            }
            catch { }
            return DateParser.TryParseLoose(GetString(sheetIndex, row, col));
        }

        public void Dispose()
        {
            _wb.Dispose();
            GC.SuppressFinalize(this);
        }
    }
}
