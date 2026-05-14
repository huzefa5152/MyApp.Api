namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Result of reverse-mapping a company's print template.
    /// Describes which cell holds which field in the template — so we can
    /// read the same cells on an uploaded historical file and extract values.
    /// Rows and columns are 1-indexed.
    /// </summary>
    public class TemplateCellMap
    {
        public int SheetIndex { get; set; }

        /// <summary>
        /// Sheet name from the print template (e.g. "Delivery Note 1"). The
        /// importer prefers matching by name over index — multi-sheet upload
        /// files (e.g. one with a leading "Settings" tab) shift the data
        /// sheet to a higher index, so a name match avoids false
        /// "wrong company" rejections in that common case.
        /// </summary>
        public string? SheetName { get; set; }

        /// <summary>
        /// Plain header fields outside the {{#each items}} block.
        /// Key = placeholder name (e.g. "challanNumber", "clientName", "deliveryDate");
        /// Value = (row, col) in the template.
        /// </summary>
        public Dictionary<string, (int Row, int Col)> HeaderFields { get; set; } = new();

        /// <summary>
        /// Row inside the items loop. For templates where the single item
        /// template row sits immediately below {{#each items}}, this is
        /// `EachRow + 1` (or the exact row if the marker sits on the same row
        /// as the placeholders). The importer reads downward from here until
        /// it finds an empty row.
        /// </summary>
        public int ItemsStartRow { get; set; }

        /// <summary>
        /// Last row of the items block (the row containing {{/each}}). Used
        /// as a safety bound so we don't read past the footer rows when the
        /// uploaded file has blank lines inside the data range.
        /// </summary>
        public int ItemsEndMarkerRow { get; set; }

        /// <summary>
        /// Columns inside the items block.
        /// Key = field name (e.g. "description", "quantity", "unit");
        /// Value = column index.
        /// </summary>
        public Dictionary<string, int> ItemColumns { get; set; } = new();

        public bool HasItemsBlock => ItemsStartRow > 0 && ItemColumns.Count > 0;
    }
}
