using MyApp.Api.Helpers.ExcelImport;

/// <summary>
/// Minimal in-memory IImportedWorkbook, built to exercise
/// GdCostingMapping.Resolve and GdCostingSheetReader.Read without a real
/// spreadsheet. Between the two, only GetString, GetDecimal and GetLastRow
/// are ever called -- confirmed by reading both bodies before extending this
/// fake -- so those are the only members with a real implementation. Every
/// other member throws NotImplementedException: if either is ever changed to
/// call one of them (GetDate, in particular -- Read only reaches it when a
/// mapping maps GdDate, which none of the harness's synthetic mappings do), a
/// test using this fake fails loudly rather than silently reading a wrong
/// value.
///
/// Kept in the harness project, not under Helpers/, since it exists only to
/// drive this offline test suite and ships nothing to the app.
/// </summary>
public class FakeWorkbook : IImportedWorkbook
{
    private readonly Dictionary<(int Sheet, int Row, int Col), string> _cells = new();
    private readonly Dictionary<int, int> _lastRow = new();

    /// <summary>Seeds a cell's displayed text, as the heading row would hold it.</summary>
    public void Set(int sheet, int row, int col, string text) => _cells[(sheet, row, col)] = text;

    /// <summary>Sets what GetLastRow(sheet) returns -- the same number a real
    /// workbook reader derives from the sheet's last populated row, and the
    /// bound GdCostingSheetReader.Read scans up to.</summary>
    public void SetLastRow(int sheet, int row) => _lastRow[sheet] = row;

    public string GetString(int sheetIndex, int row, int col) =>
        _cells.TryGetValue((sheetIndex, row, col), out var v) ? v : "";

    /// <summary>Derived from the same text GetString returns, via the real
    /// CellNumber parser -- exactly the fallback path both real
    /// IImportedWorkbook implementations take for a non-numeric-typed cell,
    /// which is the only kind this in-memory fake has.</summary>
    public decimal? GetDecimal(int sheetIndex, int row, int col) =>
        CellNumber.Parse(GetString(sheetIndex, row, col));

    public int GetLastRow(int sheetIndex) =>
        _lastRow.TryGetValue(sheetIndex, out var row) ? row : 0;

    public int WorksheetCount => throw new NotImplementedException();
    public string GetSheetName(int sheetIndex) => throw new NotImplementedException();
    public int? GetInt(int sheetIndex, int row, int col) => throw new NotImplementedException();
    public DateTime? GetDate(int sheetIndex, int row, int col) => throw new NotImplementedException();

    public void Dispose() { }
}
