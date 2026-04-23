using MyApp.Api.Helpers.ExcelImport;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Parses a company's Excel print template once and produces a
    /// <see cref="TemplateCellMap"/> — the reverse of the export-time
    /// placeholder-filling that ExcelTemplateEngine does. Given the same
    /// template file, we know which cell any given field lives in, so an
    /// uploaded historical challan following that layout can be read back
    /// into the system.
    /// </summary>
    public interface IExcelTemplateReverseMapper
    {
        /// <summary>
        /// Build (or fetch the cached) cell map for the given template file.
        /// Caches keyed on (filePath, lastWriteTime) so repeated imports for the
        /// same company don't re-parse.
        /// </summary>
        TemplateCellMap Build(string templateFilePath);
    }
}
