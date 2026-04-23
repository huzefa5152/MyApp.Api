using System.Globalization;
using NPOI.HSSF.UserModel;
using NPOI.SS.UserModel;
using NPOI.XSSF.UserModel;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// NPOI-backed reader for legacy .xls and .xlsx/.xlsm uploads.
    /// ClosedXML cannot read .xls, so we fall back to NPOI for those. NPOI
    /// rows/cols are 0-indexed internally; we translate to 1-indexed on input
    /// to keep the IImportedWorkbook contract uniform.
    /// </summary>
    public class NpoiImportedWorkbook : IImportedWorkbook
    {
        private readonly IWorkbook _wb;
        private readonly IFormulaEvaluator _eval;
        private readonly DataFormatter _fmt = new();

        public NpoiImportedWorkbook(Stream stream, bool isXls)
        {
            // HSSF = .xls, XSSF = .xlsx/.xlsm
            _wb = isXls ? new HSSFWorkbook(stream) : new XSSFWorkbook(stream);
            _eval = _wb.GetCreationHelper().CreateFormulaEvaluator();
        }

        public int WorksheetCount => _wb.NumberOfSheets;

        public int GetLastRow(int sheetIndex)
        {
            if (sheetIndex < 0 || sheetIndex >= _wb.NumberOfSheets) return 0;
            var sheet = _wb.GetSheetAt(sheetIndex);
            // LastRowNum is 0-indexed; +1 for 1-indexed return. -1 → empty.
            return sheet.LastRowNum >= 0 ? sheet.LastRowNum + 1 : 0;
        }

        private ICell? GetCell(int sheetIndex, int row, int col)
        {
            if (sheetIndex < 0 || sheetIndex >= _wb.NumberOfSheets) return null;
            var sheet = _wb.GetSheetAt(sheetIndex);
            var r = sheet.GetRow(row - 1);
            return r?.GetCell(col - 1);
        }

        public string GetString(int sheetIndex, int row, int col)
        {
            var cell = GetCell(sheetIndex, row, col);
            if (cell == null) return "";
            try
            {
                var s = _fmt.FormatCellValue(cell, _eval);
                return (s ?? "").Trim();
            }
            catch
            {
                return (cell.ToString() ?? "").Trim();
            }
        }

        public decimal? GetDecimal(int sheetIndex, int row, int col)
        {
            var cell = GetCell(sheetIndex, row, col);
            if (cell == null) return null;
            try
            {
                if (cell.CellType == CellType.Numeric)
                    return (decimal)cell.NumericCellValue;
                if (cell.CellType == CellType.Formula)
                {
                    var cv = _eval.Evaluate(cell);
                    if (cv.CellType == CellType.Numeric) return (decimal)cv.NumberValue;
                }
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
            var cell = GetCell(sheetIndex, row, col);
            if (cell == null) return null;
            try
            {
                if (cell.CellType == CellType.Numeric && DateUtil.IsCellDateFormatted(cell))
                    return cell.DateCellValue;
            }
            catch { }
            return DateParser.TryParseLoose(GetString(sheetIndex, row, col));
        }

        public void Dispose()
        {
            _wb.Close();
            GC.SuppressFinalize(this);
        }
    }
}
