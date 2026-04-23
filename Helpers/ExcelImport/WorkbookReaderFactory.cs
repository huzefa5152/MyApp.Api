namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Picks the right reader implementation based on file extension.
    /// - .xls  → NPOI (ClosedXML can't read legacy binary .xls)
    /// - .xlsx / .xlsm → ClosedXML (matches the rest of the system)
    /// </summary>
    public static class WorkbookReaderFactory
    {
        public static IImportedWorkbook Open(Stream stream, string extension)
        {
            var ext = (extension ?? "").Trim().ToLowerInvariant();
            if (ext == ".xls")
                return new NpoiImportedWorkbook(stream, isXls: true);
            return new ClosedXmlImportedWorkbook(stream);
        }

        public static bool IsSupported(string extension)
        {
            var ext = (extension ?? "").Trim().ToLowerInvariant();
            return ext == ".xls" || ext == ".xlsx" || ext == ".xlsm";
        }
    }
}
