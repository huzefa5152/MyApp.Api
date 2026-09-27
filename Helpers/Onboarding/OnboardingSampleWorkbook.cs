using ClosedXML.Excel;

namespace MyApp.Api.Helpers.Onboarding
{
    /// <summary>Dropdown values for the sample's hidden Lists sheet.</summary>
    public record SampleLists(
        IReadOnlyList<string> Provinces,
        IReadOnlyList<string> RegistrationTypes,
        IReadOnlyList<string> Units);

    /// <summary>One sheet of a fix list: the rows that failed, with their reason.</summary>
    public record FixListSheet(string SheetKey, IReadOnlyList<FixListRow> Rows);

    public record FixListRow(IReadOnlyDictionary<string, string> Values, string Error);

    /// <summary>
    /// Builds the onboarding sample workbook and the "rows to fix" workbook.
    /// Both come from <see cref="OnboardingSchema"/>, and a fix list has the
    /// sample's exact layout plus an Error column the reader ignores, so the
    /// operator can correct it and upload it straight back.
    /// </summary>
    public static class OnboardingSampleWorkbook
    {
        private static readonly XLColor RequiredColour = XLColor.FromHtml("#C62828");
        private static readonly XLColor ConditionalColour = XLColor.FromHtml("#EF6C00");
        private static readonly XLColor OptionalColour = XLColor.FromHtml("#546E7A");
        private static readonly XLColor HelpFill = XLColor.FromHtml("#F4F6F8");
        private static readonly XLColor HelpText = XLColor.FromHtml("#455A64");

        private const string ListsSheet = "Lists";
        private const int LastValidatedRow = OnboardingSchema.FirstDataRow + OnboardingSchema.MaxRowsPerSheet - 1;

        public static string HeadingText(OnboardingColumn col) =>
            col.Requirement == Requirement.Required ? col.Heading + " *" : col.Heading;

        public static XLColor ColourFor(Requirement r) => r switch
        {
            Requirement.Required => RequiredColour,
            Requirement.Conditional => ConditionalColour,
            _ => OptionalColour,
        };

        public static byte[] BuildSample(IEnumerable<string> sheetKeys, SampleLists lists, string? companyName = null)
        {
            var sheets = sheetKeys.Select(OnboardingSchema.Find).Where(s => s != null).Select(s => s!).ToList();
            using var wb = new XLWorkbook();

            BuildStartHere(wb.Worksheets.Add("Start Here"), sheets, companyName);
            var listRanges = BuildLists(wb.Worksheets.Add(ListsSheet), lists);

            foreach (var sheet in sheets)
            {
                var ws = wb.Worksheets.Add(sheet.Title);
                WriteHeader(ws, sheet, extraHeading: null);
                ApplyColumnFormats(ws, sheet);
                ApplyValidations(ws, sheet, listRanges);
            }

            wb.Worksheet(ListsSheet).Visibility = XLWorksheetVisibility.Hidden;
            wb.Worksheet("Start Here").SetTabActive();
            return Save(wb);
        }

        public static byte[] BuildFixList(IEnumerable<FixListSheet> fixSheets)
        {
            using var wb = new XLWorkbook();
            var any = false;
            foreach (var fs in fixSheets)
            {
                var sheet = OnboardingSchema.Find(fs.SheetKey);
                if (sheet == null || fs.Rows.Count == 0) continue;
                any = true;
                var ws = wb.Worksheets.Add(sheet.Title);
                WriteHeader(ws, sheet, extraHeading: "Error");
                ApplyColumnFormats(ws, sheet);
                var r = OnboardingSchema.FirstDataRow;
                foreach (var row in fs.Rows)
                {
                    var c = 1;
                    foreach (var col in sheet.Columns)
                    {
                        row.Values.TryGetValue(col.Key, out var v);
                        ws.Cell(r, c).SetValue(SpreadsheetFormulaGuard.Neutralise(v));
                        c++;
                    }
                    var err = ws.Cell(r, c);
                    err.SetValue(SpreadsheetFormulaGuard.Neutralise(row.Error));
                    err.Style.Font.FontColor = RequiredColour;
                    err.Style.Alignment.WrapText = true;
                    r++;
                }
            }
            if (!any)
            {
                var ws = wb.Worksheets.Add("Nothing to fix");
                ws.Cell(1, 1).SetValue("Every row in the file imports. There is nothing to fix.");
            }
            return Save(wb);
        }

        private static byte[] Save(XLWorkbook wb)
        {
            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            return ms.ToArray();
        }

        private static void BuildStartHere(IXLWorksheet ws, List<OnboardingSheet> sheets, string? companyName)
        {
            ws.Column(1).Width = 4;
            ws.Column(2).Width = 110;
            var r = 1;
            void Line(string text, bool bold = false, double size = 11, XLColor? colour = null)
            {
                var cell = ws.Cell(r, 2);
                cell.SetValue(text);
                cell.Style.Font.Bold = bold;
                cell.Style.Font.FontSize = size;
                cell.Style.Alignment.WrapText = true;
                if (colour != null) cell.Style.Font.FontColor = colour;
                r++;
            }

            Line(string.IsNullOrWhiteSpace(companyName) ? "Import your data" : $"Import your data into {companyName}", true, 16);
            Line("Fill in the sheets you need, save the file, then upload it on the Import Data screen.");
            r++;
            Line("How it works", true, 13);
            Line("1. Fill in one row per record, starting on row 3. Row 2 on every sheet explains its column.");
            Line("2. Leave a sheet empty if you have nothing for it. It is simply skipped.");
            Line("3. Upload the file. Nothing is saved until you have checked the preview and pressed Import.");
            Line("4. Records that already exist are skipped, never changed, so the same file can be uploaded twice safely.");
            Line("5. Rows with a problem are listed with the reason. Download them, fix them and upload them again.");
            r++;
            Line("Column headings", true, 13);
            Line("Red heading with *  = required. The row is not imported without it.", colour: RequiredColour);
            Line("Orange heading = required in some cases; row 2 says when (e.g. NTN for a Registered customer).", colour: ConditionalColour);
            Line("Grey heading = optional. Leave it empty if you do not have it.", colour: OptionalColour);
            Line("Columns with a dropdown only accept a value from the list.");
            r++;
            Line("Sheets in this file", true, 13);
            foreach (var s in sheets)
            {
                var req = s.Columns.Count(c => c.Requirement == Requirement.Required);
                Line($"{s.Title}: {s.Purpose} ({req} required, {s.Columns.Count - req} other columns)");
            }
            if (sheets.Any(s => s.Key == OnboardingSheets.OpeningStock))
            {
                r++;
                Line("Opening Stock names items by their Item Name. An item can be on the Items sheet of this same file; items import first.");
            }
        }

        /// <summary>Writes each list into a column of the hidden sheet; returns the range per list.</summary>
        private static Dictionary<ListSource, IXLRange> BuildLists(IXLWorksheet ws, SampleLists lists)
        {
            var ranges = new Dictionary<ListSource, IXLRange>();
            void Put(int col, ListSource source, string title, IReadOnlyList<string> values)
            {
                ws.Cell(1, col).SetValue(title);
                for (var i = 0; i < values.Count; i++)
                    ws.Cell(i + 2, col).SetValue(SpreadsheetFormulaGuard.Neutralise(values[i]));
                if (values.Count > 0)
                    ranges[source] = ws.Range(2, col, values.Count + 1, col);
            }
            Put(1, ListSource.Province, "Province", lists.Provinces);
            Put(2, ListSource.RegistrationType, "Registration Type", lists.RegistrationTypes);
            Put(3, ListSource.SaleType, "Sale Type", OnboardingSchema.SaleTypes);
            Put(4, ListSource.Unit, "Unit", lists.Units);
            return ranges;
        }

        private static void WriteHeader(IXLWorksheet ws, OnboardingSheet sheet, string? extraHeading)
        {
            var c = 1;
            foreach (var col in sheet.Columns)
            {
                var head = ws.Cell(OnboardingSchema.HeaderRow, c);
                head.SetValue(HeadingText(col));
                head.Style.Font.Bold = true;
                head.Style.Font.FontColor = XLColor.White;
                head.Style.Fill.BackgroundColor = ColourFor(col.Requirement);
                head.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;

                var help = ws.Cell(OnboardingSchema.HelpRow, c);
                help.SetValue(col.Help);
                help.Style.Font.Italic = true;
                help.Style.Font.FontSize = 9;
                help.Style.Font.FontColor = HelpText;
                help.Style.Fill.BackgroundColor = HelpFill;
                help.Style.Alignment.WrapText = true;
                help.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;

                ws.Column(c).Width = col.Width;
                c++;
            }
            if (extraHeading != null)
            {
                var head = ws.Cell(OnboardingSchema.HeaderRow, c);
                head.SetValue(extraHeading);
                head.Style.Font.Bold = true;
                head.Style.Font.FontColor = XLColor.White;
                head.Style.Fill.BackgroundColor = XLColor.FromHtml("#37474F");
                ws.Cell(OnboardingSchema.HelpRow, c).SetValue("Why this row was not imported. You can leave this column; it is ignored on upload.");
                ws.Cell(OnboardingSchema.HelpRow, c).Style.Font.Italic = true;
                ws.Cell(OnboardingSchema.HelpRow, c).Style.Font.FontSize = 9;
                ws.Cell(OnboardingSchema.HelpRow, c).Style.Alignment.WrapText = true;
                ws.Column(c).Width = 50;
            }
            ws.Row(OnboardingSchema.HeaderRow).Height = 22;
            ws.Row(OnboardingSchema.HelpRow).Height = 62;
            ws.SheetView.FreezeRows(OnboardingSchema.HelpRow);
        }

        private static void ApplyColumnFormats(IXLWorksheet ws, OnboardingSheet sheet)
        {
            var c = 1;
            foreach (var col in sheet.Columns)
            {
                var range = ws.Range(OnboardingSchema.FirstDataRow, c, LastValidatedRow, c);
                // Text format keeps an NTN / CNIC / HS code as the digits typed,
                // instead of 4.2301E+12 or 8481.809.
                if (col.Kind == ColumnKind.Identifier) range.Style.NumberFormat.Format = "@";
                if (col.Kind == ColumnKind.Date) range.Style.DateFormat.Format = "dd-mm-yyyy";
                c++;
            }
        }

        private static void ApplyValidations(IXLWorksheet ws, OnboardingSheet sheet, Dictionary<ListSource, IXLRange> lists)
        {
            var c = 1;
            foreach (var col in sheet.Columns)
            {
                if (col.List != ListSource.None && lists.TryGetValue(col.List, out var source))
                {
                    var target = ws.Range(OnboardingSchema.FirstDataRow, c, LastValidatedRow, c);
                    var dv = target.CreateDataValidation();
                    dv.List(source, true);
                    dv.IgnoreBlanks = true;
                    // A unit the company has not used yet is still a valid unit,
                    // so the Unit list suggests without refusing.
                    dv.ShowErrorMessage = col.List != ListSource.Unit;
                    dv.ErrorTitle = col.Heading;
                    dv.ErrorMessage = $"Pick a {col.Heading} from the list.";
                }
                c++;
            }
        }
    }
}
