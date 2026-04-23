namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Format-agnostic read-only view over an uploaded spreadsheet. Lets the
    /// importer read cell values by (sheetIndex, row, col) without caring
    /// whether the source is legacy .xls (NPOI) or modern .xlsx/.xlsm (ClosedXML).
    /// Rows and columns are 1-indexed to match ClosedXML's convention.
    /// </summary>
    public interface IImportedWorkbook : IDisposable
    {
        int WorksheetCount { get; }

        /// <summary>
        /// Last row that contains any data on the given sheet (1-indexed).
        /// Returns 0 if the sheet is empty.
        /// </summary>
        int GetLastRow(int sheetIndex);

        /// <summary>
        /// Cell value as a string (trimmed). Empty string if the cell is blank.
        /// Numeric, date and boolean cells are converted to their string form.
        /// </summary>
        string GetString(int sheetIndex, int row, int col);

        /// <summary>
        /// Cell value as a decimal. Returns null if the cell is blank or
        /// cannot be parsed as a number.
        /// </summary>
        decimal? GetDecimal(int sheetIndex, int row, int col);

        /// <summary>
        /// Cell value as an int. Returns null if blank / non-numeric.
        /// </summary>
        int? GetInt(int sheetIndex, int row, int col);

        /// <summary>
        /// Cell value as a DateTime. Handles both native Excel date cells and
        /// free-form text in common formats (dd/MM/yyyy, dd-MMM-yyyy, etc.).
        /// </summary>
        DateTime? GetDate(int sheetIndex, int row, int col);
    }
}
