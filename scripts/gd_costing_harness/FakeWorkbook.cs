using MyApp.Api.Helpers.ExcelImport;

/// <summary>
/// Minimal in-memory IImportedWorkbook, built only to exercise
/// GdCostingMapping.Resolve without a real spreadsheet. Resolve reads
/// headings through GetString(sheet, row, col) alone -- confirmed by reading
/// its body before writing this -- so that is the only member with a real
/// implementation. Every other member throws NotImplementedException: if
/// Resolve is ever changed to call one of them, a test using this fake will
/// fail loudly rather than silently reading a wrong value.
///
/// Kept in the harness project, not under Helpers/, since it exists only to
/// drive this offline test suite and ships nothing to the app.
/// </summary>
public class FakeWorkbook : IImportedWorkbook
{
    private readonly Dictionary<(int Sheet, int Row, int Col), string> _cells = new();

    /// <summary>Seeds a cell's displayed text, as the heading row would hold it.</summary>
    public void Set(int sheet, int row, int col, string text) => _cells[(sheet, row, col)] = text;

    public string GetString(int sheetIndex, int row, int col) =>
        _cells.TryGetValue((sheetIndex, row, col), out var v) ? v : "";

    public int WorksheetCount => throw new NotImplementedException();
    public string GetSheetName(int sheetIndex) => throw new NotImplementedException();
    public int GetLastRow(int sheetIndex) => throw new NotImplementedException();
    public decimal? GetDecimal(int sheetIndex, int row, int col) => throw new NotImplementedException();
    public int? GetInt(int sheetIndex, int row, int col) => throw new NotImplementedException();
    public DateTime? GetDate(int sheetIndex, int row, int col) => throw new NotImplementedException();

    public void Dispose() { }
}
