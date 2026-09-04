using ClosedXML.Excel;
using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Turns the stock dashboard into a styled .xlsx: one row per item carrying
    /// the five figures the dashboard shows (Opening, In, Out, On-Hand, and the
    /// money — Excluding / Rate / Sales Tax / Including), with that item's
    /// movement history nested UNDER it as a collapsed Excel outline group.
    ///
    /// Why an outline group rather than a second sheet: the screen's drill-down
    /// is per item, and a flat movement sheet loses which figures a movement
    /// explains. Excel's own grouping reproduces the screen exactly — every item
    /// starts closed, and the ± in the left margin opens one.
    ///
    /// Layout rules this file exists to keep:
    ///  • Item rows and movement rows share the SAME columns wherever they mean
    ///    the same thing (In / Out / balance / unit cost / value), so the sheet
    ///    reads as one grid instead of two stacked tables. A sub-header inside
    ///    each group names the movement meanings, so nothing is ambiguous.
    ///  • Column widths are measured from the longest value actually written
    ///    (banner text excluded, or the merged title would stretch column A), so
    ///    no figure or note is ever cut off. Notes wrap instead of being clipped.
    ///  • Totals are an ORDINARY bold row, never an <c>IXLTable</c> totals row —
    ///    ClosedXML 0.104.2 corrupts those on SaveAs (known issue in this repo).
    ///  • Every operator-supplied string routes through
    ///    <see cref="ExcelTemplateEngine.CsvSafe"/>, so an item named
    ///    <c>=WEBSERVICE(...)</c> cannot execute in the recipient's Excel.
    /// </summary>
    public static class StockExcelBuilder
    {
        // Palette — the product's blue, so the workbook is recognisably ours.
        private static readonly XLColor Navy = XLColor.FromHtml("#0D47A1");
        private static readonly XLColor NavyLight = XLColor.FromHtml("#1565C0");
        private static readonly XLColor KpiFill = XLColor.FromHtml("#E8F1FB");
        private static readonly XLColor HeaderFill = XLColor.FromHtml("#0D47A1");
        private static readonly XLColor SubHeadFill = XLColor.FromHtml("#EDF4FC");
        private static readonly XLColor ZebraFill = XLColor.FromHtml("#FAFBFD");
        private static readonly XLColor TotalFill = XLColor.FromHtml("#DCE9F8");
        private static readonly XLColor Muted = XLColor.FromHtml("#5F6D7E");
        private static readonly XLColor Rule = XLColor.FromHtml("#D6DEE9");
        private static readonly XLColor InGreen = XLColor.FromHtml("#1B6E32");
        private static readonly XLColor OutRed = XLColor.FromHtml("#B3261E");

        private const string Money = "#,##0.00;[Red]-#,##0.00";
        private const string Qty = "#,##0.####;[Red]-#,##0.####";
        private const string Cost = "#,##0.0000;[Red]-#,##0.0000";
        private const string Rate = "0.00\"%\"";
        private const string DateFmt = "dd-MM-yyyy";

        /// <summary>Hard ceiling on written rows. Past this the workbook says it
        /// was truncated rather than growing into a file that never opens.</summary>
        public const int MaxRows = 60_000;

        private const int Cols = 14;

        // Column indices, named once so the two row shapes cannot drift apart.
        private const int CName = 1;   // Item            | Date
        private const int CCode = 2;   // HS Code         | Document
        private const int CUom = 3;    // UOM             | Direction
        private const int COpen = 4;   // Opening         | —
        private const int CIn = 5;     // Total In        | Qty In
        private const int COut = 6;    // Total Out       | Qty Out
        private const int COnHand = 7; // On Hand         | Balance
        private const int CUnit = 8;   // Unit Cost       | Unit Cost
        private const int CExcl = 9;   // Excluding       | Value
        private const int CRate = 10;  // Tax Rate %      | —
        private const int CTax = 11;   // Sales Tax       | —
        private const int CIncl = 12;  // Including       | Running Value
        private const int CLast = 13;  // Last Movement   | —
        private const int CNotes = 14; // —               | Notes

        public static byte[] Build(StockExportDto data)
        {
            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add("Stock");

            // Summary rows sit ABOVE their detail, so the ± sits on the item row
            // itself rather than after the movements it opens.
            ws.Outline.SummaryVLocation = XLOutlineSummaryVLocation.Top;

            // Longest string written per column, so widths can be measured from
            // real content at the end. Banner rows are deliberately not measured.
            var widths = new double[Cols + 1];

            var r = WriteBanner(ws, data);
            var headerRow = r;
            WriteHeader(ws, r, widths);
            r++;

            var truncated = false;
            var zebra = false;
            var totals = new Totals();
            // Deepest row outline actually written — 0 when nothing is grouped,
            // which is what tells the fix-up below there is nothing to declare.
            var grouped = 0;

            foreach (var item in data.Items)
            {
                if (r > MaxRows) { truncated = true; break; }

                WriteItemRow(ws, r, item.Summary, zebra, widths);
                totals.Add(item.Summary);
                zebra = !zebra;
                r++;

                if (!data.IncludeMovements || item.Movements.Count == 0) continue;

                var groupStart = r;
                WriteMovementSubHeader(ws, r, widths);
                r++;

                foreach (var m in item.Movements)
                {
                    if (r > MaxRows) { truncated = true; break; }
                    WriteMovementRow(ws, r, m, widths);
                    r++;
                }

                // Group the sub-header WITH its rows: collapsing the item must
                // take its column captions away too, or a closed item leaves a
                // stray caption band behind.
                var rows = ws.Rows(groupStart, r - 1);
                rows.Group();
                rows.Collapse();
                grouped = 1;

                if (truncated) break;
            }

            WriteTotals(ws, r, totals, data, widths);
            r += 2;

            if (truncated)
            {
                ws.Cell(r, CName).Value =
                    $"Truncated at {MaxRows:N0} rows — narrow the search for a complete export.";
                ws.Range(r, CName, r, Cols).Merge()
                  .Style.Font.SetItalic().Font.SetFontColor(XLColor.DarkRed);
                r += 2;
            }

            WriteLegend(ws, r, data);

            ApplyWidths(ws, widths);

            // Freeze the header AND the item-name column, so scrolling right
            // never leaves a row of figures with nothing naming it.
            ws.SheetView.Freeze(headerRow, CName);

            ws.PageSetup.PageOrientation = XLPageOrientation.Landscape;
            ws.PageSetup.FitToPages(1, 0);
            ws.PageSetup.SetRowsToRepeatAtTop(headerRow, headerRow);
            ws.PageSetup.Margins.Left = 0.3;
            ws.PageSetup.Margins.Right = 0.3;

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            return FixRowOutlineLevel(ms.ToArray(), grouped);
        }

        // ── ClosedXML outline workaround ──────────────────────────────────────

        /// <summary>
        /// ClosedXML 0.104.2 writes the sheet's ROW outline depth into
        /// <c>sheetFormatPr/@outlineLevelCol</c> and never emits
        /// <c>@outlineLevelRow</c> — verified with an isolated repro: a workbook
        /// with only rows grouped, and one with only columns grouped, both come
        /// out as <c>outlineLevelCol="1"</c>. The result is a declared COLUMN
        /// outline this sheet does not have (an empty gutter strip above the
        /// column headers) and a row outline of depth 0 on paper, even though
        /// every detail row carries <c>outlineLevel="1"</c>.
        ///
        /// The drill-down is the point of this export, so the two attributes are
        /// corrected in the saved part rather than left to the reader's
        /// tolerance. Deliberately conservative: if the element does not look
        /// exactly as expected the bytes are returned untouched, so a future
        /// ClosedXML that fixes this cannot be made wrong by this method.
        /// </summary>
        private static byte[] FixRowOutlineLevel(byte[] xlsx, int maxRowLevel)
        {
            if (maxRowLevel <= 0) return xlsx;

            try
            {
                using var ms = new MemoryStream();
                ms.Write(xlsx, 0, xlsx.Length);
                ms.Position = 0;

                using (var zip = new System.IO.Compression.ZipArchive(
                    ms, System.IO.Compression.ZipArchiveMode.Update, leaveOpen: true))
                {
                    var sheets = zip.Entries
                        .Where(e => e.FullName.StartsWith("xl/worksheets/", StringComparison.Ordinal)
                                 && e.FullName.EndsWith(".xml", StringComparison.Ordinal))
                        .ToList();

                    foreach (var entry in sheets)
                    {
                        string xml;
                        using (var reader = new StreamReader(entry.Open()))
                            xml = reader.ReadToEnd();

                        var patched = PatchSheetFormatPr(xml, maxRowLevel);
                        if (ReferenceEquals(patched, xml)) continue;

                        var name = entry.FullName;
                        entry.Delete();
                        var fresh = zip.CreateEntry(name);
                        using var writer = new StreamWriter(
                            fresh.Open(), new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
                        writer.Write(patched);
                    }
                }

                return ms.ToArray();
            }
            catch (Exception)
            {
                // A workbook with a stale outline hint still opens and still
                // holds every figure; failing the whole export over a cosmetic
                // attribute would be the worse trade.
                return xlsx;
            }
        }

        private static string PatchSheetFormatPr(string xml, int maxRowLevel)
        {
            var match = System.Text.RegularExpressions.Regex.Match(
                xml, @"<(?<p>[A-Za-z0-9]+:)?sheetFormatPr\b(?<attrs>[^>]*?)/>",
                System.Text.RegularExpressions.RegexOptions.None,
                TimeSpan.FromSeconds(2));
            if (!match.Success) return xml;

            var attrs = match.Groups["attrs"].Value;
            if (attrs.Contains("outlineLevelRow", StringComparison.Ordinal)) return xml;

            // Drop the misfiled column depth; this sheet groups rows only.
            attrs = System.Text.RegularExpressions.Regex.Replace(
                attrs, @"\s+outlineLevelCol=""[^""]*""", "");

            var prefix = match.Groups["p"].Value;
            var replacement =
                $"<{prefix}sheetFormatPr{attrs} outlineLevelRow=\"{maxRowLevel}\" />";

            return xml.Remove(match.Index, match.Length).Insert(match.Index, replacement);
        }

        // ── Banner ────────────────────────────────────────────────────────────

        private static int WriteBanner(IXLWorksheet ws, StockExportDto data)
        {
            var r = 1;

            ws.Cell(r, CName).Value = Safe(data.CompanyName);
            var title = ws.Range(r, CName, r, Cols).Merge();
            title.Style.Font.SetFontSize(18).Font.SetBold().Font.SetFontColor(XLColor.White);
            title.Style.Fill.BackgroundColor = Navy;
            title.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            title.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            ws.Row(r).Height = 30;
            r++;

            ws.Cell(r, CName).Value = Safe(data.Title);
            var sub = ws.Range(r, CName, r, Cols).Merge();
            sub.Style.Font.SetFontSize(12.5).Font.SetFontColor(XLColor.White);
            sub.Style.Fill.BackgroundColor = NavyLight;
            sub.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            sub.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            ws.Row(r).Height = 21;
            r++;

            // Provenance. A stock sheet with no statement of what shaped it is
            // not auditable — the reader cannot tell a filtered export from a
            // complete one.
            var parts = new List<string>();
            parts.AddRange(data.FiltersApplied);
            parts.Add($"{data.Items.Count:N0} item{(data.Items.Count == 1 ? "" : "s")}");
            parts.Add($"Generated {data.GeneratedAt:dd-MM-yyyy HH:mm}");

            ws.Cell(r, CName).Value = Safe(string.Join("  ·  ", parts));
            var meta = ws.Range(r, CName, r, Cols).Merge();
            meta.Style.Font.SetItalic().Font.SetFontColor(Muted);
            meta.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Row(r).Height = 17;
            r++;

            // Headline figures, written as one centred line rather than tiles:
            // tiles built out of merged column pairs come out ragged, because
            // the grid's columns are deliberately different widths.
            var t = new Totals();
            foreach (var i in data.Items) t.Add(i.Summary);
            ws.Cell(r, CName).Value = Safe(
                $"Quantity on hand {t.Qty:N4}   ·   Excluding tax {t.Excl:N2}   ·   " +
                $"Sales tax {t.Tax:N2}   ·   Including tax {t.Incl:N2}");
            var kpi = ws.Range(r, CName, r, Cols).Merge();
            kpi.Style.Font.SetBold().Font.SetFontSize(11).Font.SetFontColor(Navy);
            kpi.Style.Fill.BackgroundColor = KpiFill;
            kpi.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            kpi.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            ws.Row(r).Height = 22;
            r++;

            ws.Row(r).Height = 7; // spacer
            r++;
            return r;
        }

        // ── Header ────────────────────────────────────────────────────────────

        private static readonly (int Col, string Label, bool Right)[] HeaderCells =
        {
            (CName,   "Item",          false),
            (CCode,   "HS Code",       false),
            (CUom,    "UOM",           false),
            (COpen,   "Opening",       true),
            (CIn,     "Total In",      true),
            (COut,    "Total Out",     true),
            (COnHand, "On Hand",       true),
            (CUnit,   "Unit Cost",     true),
            (CExcl,   "Excluding",     true),
            (CRate,   "Tax Rate",      true),
            (CTax,    "Sales Tax",     true),
            (CIncl,   "Including",     true),
            (CLast,   "Last Movement", false),
            (CNotes,  "Notes",         false),
        };

        private static void WriteHeader(IXLWorksheet ws, int r, double[] widths)
        {
            foreach (var (col, label, right) in HeaderCells)
            {
                var cell = ws.Cell(r, col);
                cell.Value = label;
                cell.Style.Font.SetBold().Font.SetFontColor(XLColor.White);
                cell.Style.Fill.BackgroundColor = HeaderFill;
                cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
                cell.Style.Alignment.Horizontal = right
                    ? XLAlignmentHorizontalValues.Right
                    : XLAlignmentHorizontalValues.Left;
                cell.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
                cell.Style.Border.BottomBorderColor = XLColor.White;
                Measure(widths, col, label);
            }
            ws.Row(r).Height = 22;
        }

        // ── Item row ──────────────────────────────────────────────────────────

        private static void WriteItemRow(IXLWorksheet ws, int r, StockOnHandRowDto s,
                                         bool zebra, double[] widths)
        {
            Text(ws, r, CName, s.ItemTypeName, widths);
            Text(ws, r, CCode, s.HSCode, widths);
            Text(ws, r, CUom, s.UOM, widths);

            Number(ws, r, COpen, s.OpeningBalance, Qty, widths);
            Number(ws, r, CIn, s.TotalIn, Qty, widths);
            Number(ws, r, COut, s.TotalOut, Qty, widths);
            Number(ws, r, COnHand, s.OnHand, Qty, widths);
            Number(ws, r, CUnit, s.UnitCost, Cost, widths);
            Number(ws, r, CExcl, s.ValueExcludingTax, Money, widths);
            Number(ws, r, CRate, s.SalesTaxRate, Rate, widths);
            Number(ws, r, CTax, s.SalesTax, Money, widths);
            Number(ws, r, CIncl, s.ValueIncludingTax, Money, widths);

            if (s.LastMovementAt.HasValue)
                Date(ws, r, CLast, s.LastMovementAt.Value, widths);

            var row = ws.Range(r, CName, r, Cols);
            if (zebra) row.Style.Fill.BackgroundColor = ZebraFill;
            row.Style.Border.BottomBorder = XLBorderStyleValues.Hair;
            row.Style.Border.BottomBorderColor = Rule;

            // The item's identity and its headline figures carry the weight;
            // the flow columns behind them stay light so the eye lands on the
            // three that answer "what have I got, and what is it worth".
            ws.Cell(r, CName).Style.Font.SetBold();
            ws.Cell(r, COnHand).Style.Font.SetBold();
            ws.Cell(r, CIncl).Style.Font.SetBold();
            ws.Range(r, COpen, r, COut).Style.Font.SetFontColor(Muted);

            // Item names run past any sane column width, and the HS code in the
            // next cell means a long one has nothing to spill into — it would be
            // clipped on screen and in print. Wrapping is what keeps the whole
            // name readable; the row carries no explicit height, so Excel grows
            // it to fit. (This is the same failure the dashboard hit with
            // nowrap+ellipsis: "MEKO FABRICS" and "MEKO DENIM" read identical.)
            ws.Cell(r, CName).Style.Alignment.WrapText = true;
            ws.Cell(r, CName).Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        }

        // ── Movement sub-header + rows ────────────────────────────────────────

        private static readonly (int Col, string Label, bool Right)[] MovementHeaderCells =
        {
            (CName,   "Date",          false),
            (CCode,   "Document",      false),
            (CUom,    "Direction",     false),
            (CIn,     "Qty In",        true),
            (COut,    "Qty Out",       true),
            (COnHand, "Balance",       true),
            (CUnit,   "Unit Cost",     true),
            (CExcl,   "Value",         true),
            (CIncl,   "Running Value", true),
            (CNotes,  "Notes",         false),
        };

        private static void WriteMovementSubHeader(IXLWorksheet ws, int r, double[] widths)
        {
            foreach (var (col, label, right) in MovementHeaderCells)
            {
                var cell = ws.Cell(r, col);
                cell.Value = label;
                cell.Style.Font.SetBold().Font.SetFontSize(9).Font.SetFontColor(Navy);
                cell.Style.Alignment.Horizontal = right
                    ? XLAlignmentHorizontalValues.Right
                    : XLAlignmentHorizontalValues.Left;
                Measure(widths, col, label);
            }
            ws.Cell(r, CName).Style.Alignment.Indent = 2;
            ws.Range(r, CName, r, Cols).Style.Fill.BackgroundColor = SubHeadFill;
            ws.Row(r).Height = 15;
        }

        private static void WriteMovementRow(IXLWorksheet ws, int r,
                                             StockMovementRowDto m, double[] widths)
        {
            var isIn = string.Equals(m.Direction, "In", StringComparison.OrdinalIgnoreCase);

            Date(ws, r, CName, m.MovementDate, widths);
            ws.Cell(r, CName).Style.Alignment.Indent = 2;

            var source = Humanise(m.SourceType);
            var doc = string.IsNullOrWhiteSpace(m.SourceDocNumber)
                ? source
                : $"{source} #{m.SourceDocNumber}";
            Text(ws, r, CCode, doc, widths);

            Text(ws, r, CUom, isIn ? "IN" : "OUT", widths);
            ws.Cell(r, CUom).Style.Font.SetBold().Font.SetFontColor(isIn ? InGreen : OutRed);

            // In and Out live in their own columns rather than one signed
            // column: a reader scanning down should be able to total either
            // side without first reading every sign.
            if (isIn) Number(ws, r, CIn, m.Quantity, Qty, widths);
            else Number(ws, r, COut, m.Quantity, Qty, widths);

            Number(ws, r, COnHand, m.RunningQuantity, Qty, widths);
            Number(ws, r, CUnit, m.UnitCost, Cost, widths);
            Number(ws, r, CExcl, m.Value, Money, widths);
            Number(ws, r, CIncl, m.RunningValue, Money, widths);
            ws.Cell(r, CIncl).Style.Font.SetFontColor(Muted);

            if (!string.IsNullOrWhiteSpace(m.Notes))
            {
                var cell = ws.Cell(r, CNotes);
                cell.Value = Safe(m.Notes);
                cell.Style.Alignment.WrapText = true;
                cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
                cell.Style.Font.SetFontColor(Muted);
                // Notes are the one free-text field here and run long. Wrapping
                // is what keeps them whole; the width cap below stops one long
                // note stretching the column past a printable page.
                Measure(widths, CNotes, m.Notes!);
            }

            ws.Range(r, CName, r, Cols).Style.Font.SetFontSize(10);
        }

        // ── Totals ────────────────────────────────────────────────────────────

        private sealed class Totals
        {
            public decimal Opening, In, Out, Qty, Excl, Tax, Incl;

            public void Add(StockOnHandRowDto s)
            {
                Opening += s.OpeningBalance;
                In += s.TotalIn;
                Out += s.TotalOut;
                Qty += s.OnHand;
                Excl += s.ValueExcludingTax;
                Tax += s.SalesTax;
                Incl += s.ValueIncludingTax;
            }
        }

        private static void WriteTotals(IXLWorksheet ws, int r, Totals t,
                                        StockExportDto data, double[] widths)
        {
            var label = $"TOTAL — {data.Items.Count:N0} item{(data.Items.Count == 1 ? "" : "s")}";
            ws.Cell(r, CName).Value = label;
            ws.Cell(r, CName).Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            Measure(widths, CName, label);

            Number(ws, r, COpen, t.Opening, Qty, widths);
            Number(ws, r, CIn, t.In, Qty, widths);
            Number(ws, r, COut, t.Out, Qty, widths);
            Number(ws, r, COnHand, t.Qty, Qty, widths);
            Number(ws, r, CExcl, t.Excl, Money, widths);
            Number(ws, r, CTax, t.Tax, Money, widths);
            Number(ws, r, CIncl, t.Incl, Money, widths);

            // No total unit cost or tax rate: a weighted average and a
            // percentage do not add up, and a column of them summed is a
            // number that means nothing.
            var row = ws.Range(r, CName, r, Cols);
            row.Style.Font.SetBold();
            row.Style.Fill.BackgroundColor = TotalFill;
            row.Style.Border.TopBorder = XLBorderStyleValues.Double;
            row.Style.Border.TopBorderColor = Navy;
            ws.Row(r).Height = 20;
        }

        // ── Legend ────────────────────────────────────────────────────────────

        private static void WriteLegend(IXLWorksheet ws, int r, StockExportDto data)
        {
            var lines = new List<string>();
            if (data.IncludeMovements)
            {
                lines.Add("Every item's movements are nested under it and start collapsed — "
                        + "use the + in the left margin (or Data ▸ Group ▸ Show Detail) to open one.");
                lines.Add("Balance and Running Value are the quantity and value AFTER that movement, "
                        + "so a drill-down reads like a bank statement.");
            }
            else
            {
                lines.Add("Movement detail is not included — it needs the "
                        + "\"View the stock-movement audit log\" permission.");
            }
            lines.Add("Stock is valued at WEIGHTED AVERAGE cost. Sales Tax = Excluding × Tax Rate ÷ 100, "
                    + "and Including = Excluding + Sales Tax.");

            foreach (var line in lines)
            {
                ws.Cell(r, CName).Value = Safe(line);
                var range = ws.Range(r, CName, r, Cols).Merge();
                range.Style.Font.SetItalic().Font.SetFontSize(9).Font.SetFontColor(Muted);
                range.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
                r++;
            }
        }

        // ── Cell writers ──────────────────────────────────────────────────────

        private static void Text(IXLWorksheet ws, int r, int c, string? value, double[] widths)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            ws.Cell(r, c).Value = Safe(value);
            Measure(widths, c, value!);
        }

        private static void Number(IXLWorksheet ws, int r, int c, decimal value,
                                   string format, double[] widths)
        {
            var cell = ws.Cell(r, c);
            cell.Value = value;
            cell.Style.NumberFormat.Format = format;
            cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
            // Measure the RENDERED text, not the raw decimal: 1234567.5 occupies
            // "1,234,567.50" on screen, and measuring the shorter form is how a
            // figure ends up shown as ####.
            Measure(widths, c, value.ToString(format.Contains("0.0000") ? "N4" : "N2"));
        }

        private static void Date(IXLWorksheet ws, int r, int c, DateTime value, double[] widths)
        {
            var cell = ws.Cell(r, c);
            cell.Value = value;
            cell.Style.NumberFormat.Format = DateFmt;
            Measure(widths, c, "00-00-0000");
        }

        // ── Widths ────────────────────────────────────────────────────────────

        // Per-column ceiling in Excel width units. Only Notes and Item can run
        // long; the rest are figures whose worst case is already narrow.
        private static double CapFor(int col) => col switch
        {
            CName => 44,
            CNotes => 52,
            CCode => 26,
            _ => 20,
        };

        private static void Measure(double[] widths, int col, string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            // Longest single line: a note holding a newline should not claim the
            // width of both halves joined.
            var longest = 0;
            foreach (var line in text.Split('\n'))
                if (line.Length > longest) longest = line.TrimEnd('\r').Length;
            if (longest > widths[col]) widths[col] = longest;
        }

        private static void ApplyWidths(IXLWorksheet ws, double[] widths)
        {
            for (var c = 1; c <= Cols; c++)
            {
                // +3 covers the indent on nested rows, the bold header face, and
                // Excel's own padding — the difference between a column that
                // fits and one that shows ####.
                var w = widths[c] + 3;
                var cap = CapFor(c);
                ws.Column(c).Width = Math.Clamp(w, 9, cap);
            }
        }

        /// <summary>
        /// <c>PurchaseBill</c> → <c>Purchase Bill</c>. The source type is a C#
        /// enum name, and an operator's stock sheet should not be reading our
        /// identifiers back at them.
        /// </summary>
        private static string Humanise(string? pascal)
        {
            if (string.IsNullOrEmpty(pascal)) return "";
            var sb = new System.Text.StringBuilder(pascal.Length + 4);
            for (var i = 0; i < pascal.Length; i++)
            {
                if (i > 0 && char.IsUpper(pascal[i]) && !char.IsUpper(pascal[i - 1]))
                    sb.Append(' ');
                sb.Append(pascal[i]);
            }
            return sb.ToString();
        }

        private static string Safe(string? s) => ExcelTemplateEngine.CsvSafe(s);
    }
}
