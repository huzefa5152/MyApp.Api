using ClosedXML.Excel;
using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Turns the stock dashboard into the customs-lot stock sheet the importer
    /// clients already keep by hand — the same workbook shape the opening-stock
    /// IMPORT reads (see CLAUDE.md §5b-3b), so what the system exports and what
    /// an accountant hands back are one layout rather than two.
    ///
    /// The sheet is three quantity/money blocks across one row per item:
    ///
    ///   A..I   identity      Claim Month · GDs No · GD Date · Items · Sub cat ·
    ///                        4/8 Digit Hs Code · Price · Unit
    ///   J..M   OPENING       Qty · Exl · Rate · S.Tax      (everything received)
    ///   N..Q   CONSUMED      Qty · Consumed Exl · Rate · S.Tax
    ///   R..U   BALANCE       Qty · Bal Exl · Rate · S.Tax  (the live position)
    ///   X..AF  COST OF GOOD SOLD, in the same three blocks × Exl · S.Tax · Vat
    ///
    /// Rules this file exists to keep:
    ///
    ///  • <b>A figure the dashboard reports is written as a VALUE; a figure it
    ///    does not is written as the client's own FORMULA.</b> So Balance Qty is
    ///    <c>OnHand</c> and Balance Exl is <c>ValueExcludingTax</c> — never
    ///    <c>=J-N</c> / <c>=K-O</c>, however natural those look on the face of
    ///    the sheet. <c>StockValuation</c> clamps value to zero on an emptied
    ///    bin and on a revaluation, so the subtraction can legitimately differ
    ///    from the walk, and a workbook that disagrees with the screen it was
    ///    taken from is the one failure this export must not have (§5b-9).
    ///    Opening/Consumed S.Tax, Price and the 4-digit code have no figure on
    ///    the screen, so they stay formulas and recompute as the sheet is edited.
    ///
    ///  • <b>The OPENING block is everything that came in</b> — the opening
    ///    balance PLUS purchases since (<c>TotalIn</c> / <c>ValueIn</c>). The
    ///    client's sheet has no "received" block: its arithmetic is
    ///    Balance = Opening − Consumed, and folding purchases into Opening is
    ///    what keeps that true on a company that buys as well as imports. On an
    ///    importer whose stock all arrives on GDs, <c>TotalIn</c> is zero and
    ///    the column is the opening balance exactly.
    ///
    ///  • <b>Cost of Good Sold is an INPUT block.</b> Its opening Exl (X) sits
    ///    on a basis nothing in this system derives — on the client's own sheet
    ///    it runs below the stock value by a ratio that varies with the tax rate
    ///    — so X is left empty for the accountant, and S.Tax / Vat / Consumed /
    ///    Balance around it are the client's formulas, which fill the moment X
    ///    is keyed. Vat is 3% throughout, as on the source sheet.
    ///
    ///  • <b>Provenance lives on the Summary sheet, not the data sheet.</b> The
    ///    data sheet has to BE the client's layout, which has no banner; but an
    ///    export that cannot say it was filtered, division-scoped or truncated
    ///    is not auditable. Sheet 2 carries that, as the source workbook's own
    ///    second sheet carries its title block.
    ///
    ///  • Every operator-supplied string routes through
    ///    <see cref="ExcelTemplateEngine.CsvSafe"/>, so an item named
    ///    <c>=WEBSERVICE(...)</c> cannot execute in the recipient's Excel.
    /// </summary>
    public static class StockExcelBuilder
    {
        // ── Palette, lifted from the client's workbook ────────────────────────
        // The three blocks are colour-coded the same way on the data sheet and
        // in the Cost of Good Sold band, so a reader tracks one block across.
        private static readonly XLColor OpeningFill = XLColor.FromHtml("#FFFF00"); // yellow
        private static readonly XLColor ConsumedFill = XLColor.FromHtml("#FFC000"); // amber
        private static readonly XLColor BalanceFill = XLColor.FromHtml("#A9D08E"); // Accent6, lighter 40%
        private static readonly XLColor CogsBalanceFill = XLColor.FromHtml("#D0CECE"); // Background2, darker 10%
        private static readonly XLColor CogsTitleFill = XLColor.FromHtml("#E7E6E6"); // Background2
        private static readonly XLColor SeparatorFill = XLColor.FromHtml("#00B0F0"); // the sheet's own divider stripe
        private static readonly XLColor Muted = XLColor.FromHtml("#5F6D7E");
        private static readonly XLColor Navy = XLColor.FromHtml("#0D47A1");

        private const string Face = "Calibri Light";

        // Accounting formats, as the source sheet uses them: a zero renders as
        // "-" rather than 0, which is what makes an unkeyed Cost of Good Sold
        // column read as empty instead of as a claim that it is nil.
        private const string Acct0 = "_(* #,##0_);_(* \\(#,##0\\);_(* \"-\"??_);_(@_)";
        private const string Acct2 = "_(* #,##0.00_);_(* \\(#,##0.00\\);_(* \"-\"??_);_(@_)";

        /// <summary>Rate column. The source sheet uses a bare <c>0%</c>, which
        /// rounds 12.5% to 13% — on a tax sheet that is the silent-wrong-number
        /// failure §5b-3b was written about. <c>0.##%</c> renders 18% and 25%
        /// identically and keeps a fractional rate legible.</summary>
        private const string Pct = "0.##%";
        private const string DateFmt = "dd-mm-yyyy";

        /// <summary>Hard ceiling on written rows. Past this the workbook says it
        /// was truncated rather than growing into a file that never opens.</summary>
        public const int MaxRows = 60_000;

        // ── Column map ────────────────────────────────────────────────────────
        // Named once so the header, the data rows and the totals row cannot
        // drift apart. Letters are in the comments because every formula this
        // file writes, and the client's own sheet, speak in letters.
        private const int CClaim = 1;       // A  Claim Month
        private const int CGdNo = 2;        // B  GDs No
        private const int CGdDate = 3;      // C  GD Date
        private const int CItem = 4;        // D  Items
        private const int CSubCat = 5;      // E  Sub cat
        private const int CHs4 = 6;         // F  4 Digit Hs Code
        private const int CHs8 = 7;         // G  8 Digit Hs Code
        private const int CPrice = 8;       // H  Price
        private const int CUnit = 9;        // I  Unit

        private const int COpenQty = 10;    // J  Opening   Qty
        private const int COpenExl = 11;    // K            Exl
        private const int COpenRate = 12;   // L            Rate
        private const int COpenTax = 13;    // M            S.Tax

        private const int CConsQty = 14;    // N  Consumed  Qty
        private const int CConsExl = 15;    // O            Consumed Exl
        private const int CConsRate = 16;   // P            Rate
        private const int CConsTax = 17;    // Q            S.Tax

        private const int CBalQty = 18;     // R  Balance   Qty
        private const int CBalExl = 19;     // S            Bal Exl
        private const int CBalRate = 20;    // T            Rate
        private const int CBalTax = 21;     // U            S.Tax

        private const int CStripe = 22;     // V  divider stripe (no data)
        private const int CGap = 23;        // W  gap

        private const int CCogsOpenExl = 24;  // X   COGS Opening   Exl
        private const int CCogsOpenTax = 25;  // Y                  S.Tax
        private const int CCogsOpenVat = 26;  // Z                  Vat
        private const int CCogsConsExl = 27;  // AA  COGS Consumed  Exl
        private const int CCogsConsTax = 28;  // AB                 S.Tax
        private const int CCogsConsVat = 29;  // AC                 Vat
        private const int CCogsBalExl = 30;   // AD  COGS Balance   Exl
        private const int CCogsBalTax = 31;   // AE                 S.Tax
        private const int CCogsBalVat = 32;   // AF                 Vat

        private const int Cols = 32;

        /// <summary>Row the band labels sit on, the header row, and the first
        /// data row — the source sheet's 2 / 3 / 4.</summary>
        private const int BandRow = 2;
        private const int HeaderRow = 3;
        private const int FirstDataRow = 4;

        /// <summary>Further VAT charged alongside sales tax in the Cost of Good
        /// Sold block. Flat 3% on the client's sheet.</summary>
        private const string VatRate = "3%";

        /// <summary>
        /// Column widths, verbatim from the client's workbook AS STORED — the
        /// widths ARE part of the layout being reproduced, so they are pinned
        /// rather than measured from content. Items (D) wraps instead, so a name
        /// longer than its 65-wide column grows the row rather than being
        /// clipped.
        /// </summary>
        private static readonly (int Col, double Width)[] Widths =
        {
            (CClaim, 11.5703125), (CGdNo, 16.0), (CGdDate, 13.85546875),
            (CItem, 65.140625), (CSubCat, 26.42578125),
            (CHs4, 21.0), (CHs8, 21.0), (CPrice, 12.140625), (CUnit, 10.140625),
            (COpenQty, 10.85546875), (COpenExl, 14.5703125), (COpenRate, 10.28515625), (COpenTax, 14.5703125),
            (CConsQty, 10.85546875), (CConsExl, 21.140625), (CConsRate, 10.28515625), (CConsTax, 13.140625),
            (CBalQty, 10.85546875), (CBalExl, 18.0), (CBalRate, 10.42578125), (CBalTax, 16.5703125),
            (CStripe, 9.140625), (CGap, 8.28515625),
            (CCogsOpenExl, 18.0), (CCogsOpenTax, 16.5703125), (CCogsOpenVat, 14.5703125),
            (CCogsConsExl, 14.7109375), (CCogsConsTax, 13.28515625), (CCogsConsVat, 11.28515625),
            (CCogsBalExl, 18.0), (CCogsBalTax, 16.5703125), (CCogsBalVat, 14.5703125),
        };

        /// <summary>
        /// ClosedXML 0.104.2 treats <c>IXLColumn.Width</c> as the CONTENT width
        /// and adds the cell's padding when it serialises, so setting the
        /// client's stored 11.5703125 writes 12.280625 and every column comes
        /// out ~0.71 characters wider than the sheet being reproduced. The
        /// padding is a constant of the workbook's default font (Calibri 11) —
        /// verified across all 32 columns, the delta is 0.710625 on every one.
        ///
        /// Subtracted here so the SAVED width is the client's. The harness
        /// asserts against the saved XML rather than the ClosedXML property for
        /// exactly this reason: if a future ClosedXML stops padding, the
        /// generated widths shift and that check is what catches it.
        /// </summary>
        private const double WidthPadding = 0.710625;

        public static byte[] Build(StockExportDto data)
        {
            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add(SheetName(data.GeneratedAt));

            WriteCogsTitle(ws);
            WriteBandLabels(ws);
            WriteHeader(ws);

            var r = FirstDataRow;
            var truncated = false;

            foreach (var item in data.Items)
            {
                if (r > MaxRows) { truncated = true; break; }
                WriteItemRow(ws, r, item);
                r++;
            }

            var lastDataRow = r - 1;

            // Two blank rows then the totals, exactly as the source sheet lays
            // them out: the gap is what lets an operator append a row without
            // it landing inside the SUM range.
            var totalsRow = lastDataRow + 3;
            WriteTotals(ws, totalsRow, lastDataRow);

            ApplyWidths(ws);

            // Freeze the header ROWS ONLY — never the identity columns.
            //
            // Freezing through Unit (column I) locked 197 characters, about
            // 1,430 pixels: on a 1366-wide laptop the frozen pane is wider than
            // the window, so Excel leaves a sliver to scroll 23 columns through
            // and the sheet reads as broken. Items alone is 65 characters wide,
            // so no column freeze that includes it can ever be affordable, and
            // the client's own workbook freezes nothing at all.
            //
            // Rows cost no horizontal space, so the header stays put while
            // scrolling down and the whole sheet still scrolls across.
            ws.SheetView.FreezeRows(HeaderRow);

            ws.PageSetup.PageOrientation = XLPageOrientation.Landscape;
            ws.PageSetup.FitToPages(1, 0);
            ws.PageSetup.SetRowsToRepeatAtTop(HeaderRow, HeaderRow);
            ws.PageSetup.Margins.Left = 0.3;
            ws.PageSetup.Margins.Right = 0.3;

            WriteSummarySheet(wb, data, truncated);

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            return ms.ToArray();
        }

        /// <summary>"Aug 2026" — the client names the data sheet for the month
        /// it reports, and a workbook they file month on month reads better for
        /// keeping that.</summary>
        private static string SheetName(DateTime asAt) =>
            asAt.ToString("MMM yyyy", System.Globalization.CultureInfo.InvariantCulture);

        // ── Row 1: the Cost of Good Sold banner ───────────────────────────────

        private static void WriteCogsTitle(IXLWorksheet ws)
        {
            var band = ws.Range(1, CCogsOpenExl, 1, CCogsBalVat).Merge();
            ws.Cell(1, CCogsOpenExl).Value = "Cost of Good Sold";
            band.Style.Font.SetBold().Font.SetFontName(Face);
            band.Style.Fill.BackgroundColor = CogsTitleFill;
            band.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            band.Style.NumberFormat.Format = Acct0;
            Outline(band);
            ws.Row(1).Height = 15.75;
        }

        // ── Row 2: the block band labels ──────────────────────────────────────

        private static readonly (int First, int Last, string Label, string Fill)[] Bands =
        {
            (COpenQty, COpenTax, "Opening", "open"),
            (CConsQty, CConsTax, "Consumed", "cons"),
            (CBalQty, CBalTax, "Balance", "bal"),
            (CCogsOpenExl, CCogsOpenVat, "Opening", "open"),
            (CCogsConsExl, CCogsConsVat, "Consumed", "cons"),
            (CCogsBalExl, CCogsBalVat, "Balance", "cogsbal"),
        };

        private static void WriteBandLabels(IXLWorksheet ws)
        {
            foreach (var (first, last, label, fill) in Bands)
            {
                var band = ws.Range(BandRow, first, BandRow, last).Merge();
                ws.Cell(BandRow, first).Value = label;
                band.Style.Font.SetFontName(Face);
                band.Style.Fill.BackgroundColor = FillFor(fill);
                band.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                band.Style.NumberFormat.Format = Acct0;
                Outline(band);
            }
            // Only the first band on the row is bold on the source sheet; the
            // rest carry the same face at regular weight.
            ws.Cell(BandRow, COpenQty).Style.Font.SetBold();
            ws.Row(BandRow).Height = 15.75;
        }

        private static XLColor FillFor(string key) => key switch
        {
            "open" => OpeningFill,
            "cons" => ConsumedFill,
            "bal" => BalanceFill,
            _ => CogsBalanceFill,
        };

        // ── Row 3: the header ─────────────────────────────────────────────────

        private static readonly (int Col, string Label, string? Fill)[] HeaderCells =
        {
            (CClaim,  "Claim Month",      null),
            (CGdNo,   "GDs No",           null),
            (CGdDate, "GD Date",          null),
            (CItem,   "Items",            null),
            (CSubCat, "Sub cat",          null),
            (CHs4,    "4 Digit Hs Code",  null),
            (CHs8,    "8 Digit Hs Code",  null),
            (CPrice,  "Price",            null),
            (CUnit,   "Unit",             null),

            (COpenQty,  "Qty",    "open"),
            (COpenExl,  "Exl",    "open"),
            (COpenRate, "Rate",   "open"),
            (COpenTax,  "S.Tax",  "open"),

            (CConsQty,  "Qty",            "cons"),
            (CConsExl,  "Consumed Exl",   "cons"),
            (CConsRate, "Rate",           "cons"),
            (CConsTax,  "S.Tax",          "cons"),

            (CBalQty,  "Qty",      "bal"),
            (CBalExl,  "Bal Exl",  "bal"),
            (CBalRate, "Rate",     "bal"),
            (CBalTax,  "S.Tax",    "bal"),

            (CStripe, "", "stripe"),

            (CCogsOpenExl, "Exl",   "open"),
            (CCogsOpenTax, "S.Tax", "open"),
            (CCogsOpenVat, "Vat",   "open"),
            (CCogsConsExl, "Exl",   "cons"),
            (CCogsConsTax, "S.Tax", "cons"),
            (CCogsConsVat, "Vat",   "cons"),
            (CCogsBalExl,  "Exl",   "cogsbal"),
            (CCogsBalTax,  "S.Tax", "cogsbal"),
            (CCogsBalVat,  "Vat",   "cogsbal"),
        };

        private static void WriteHeader(IXLWorksheet ws)
        {
            foreach (var (col, label, fill) in HeaderCells)
            {
                var cell = ws.Cell(HeaderRow, col);
                if (label.Length > 0) cell.Value = label;
                cell.Style.Font.SetBold().Font.SetFontName(Face);
                cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;

                if (fill == "stripe")
                {
                    // A colour-only divider between the stock blocks and the
                    // Cost of Good Sold band, carried down the data rows too.
                    cell.Style.Fill.BackgroundColor = SeparatorFill;
                    continue;
                }

                if (fill != null)
                {
                    cell.Style.Fill.BackgroundColor = FillFor(fill);
                    cell.Style.NumberFormat.Format = Acct0;
                    Outline(cell);
                }
                else
                {
                    cell.Style.Border.BottomBorder = XLBorderStyleValues.Medium;
                }
            }

            // "Claim Month" is the one header that does not fit its column.
            var claim = ws.Cell(HeaderRow, CClaim).Style;
            claim.Alignment.WrapText = true;
            claim.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
            claim.Alignment.Vertical = XLAlignmentVerticalValues.Top;

            ws.Row(HeaderRow).Height = 31.5;
        }

        // ── Data rows ─────────────────────────────────────────────────────────

        private static void WriteItemRow(IXLWorksheet ws, int r, StockExportItemDto item)
        {
            var s = item.Summary;

            // A — Claim Month. The client stamps their customs claim period here
            // by hand; nothing in this system records one, so it is left for
            // them rather than filled with a month that would only look official.
            Text(ws, r, CGdNo, item.LotRef);
            if (item.LotDate.HasValue) Date(ws, r, CGdDate, item.LotDate.Value);

            // The three free-text columns WRAP rather than clip. Their widths are
            // the client's and may not move, and these are the fields no width
            // can size away: an item name runs past any column, a GD reference
            // is the operator's own string, and a UOM here is FBR's DESCRIPTION
            // ("Numbers, pieces, units" — 22 characters in a 10-wide column),
            // not the "Pcs" the client's own sheet holds. The row carries no
            // explicit height, so Excel grows it. (Same failure the dashboard
            // hit with nowrap+ellipsis: "MEKO FABRICS" and "MEKO DENIM" read
            // identical.)
            Text(ws, r, CItem, s.ItemTypeName);
            foreach (var col in new[] { CItem, CGdNo, CUnit })
            {
                ws.Cell(r, col).Style.Alignment.WrapText = true;
                ws.Cell(r, col).Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            }

            // E — Sub cat. The client's own product grouping; the catalog has no
            // such field, so the column stays theirs to fill.

            // The 4-digit heading is the first four characters of the 8-digit
            // code, and stays a FORMULA so correcting a code corrects both.
            Formula(ws, r, CHs4, $"LEFT(G{r},4)", Acct0);
            Text(ws, r, CHs8, s.HSCode);

            // Landed unit price — what the opening block paid per unit. A
            // formula, as on the source sheet, so it follows an edited value.
            Formula(ws, r, CPrice, $"IFERROR(K{r}/J{r},\"\")", Acct0);
            Text(ws, r, CUnit, s.UOM);

            // ── Opening: everything that came in ─────────────────────────────
            // Opening balance PLUS purchases since. See the class comment: the
            // client's sheet has no "received" block, and this is what keeps
            // Balance = Opening − Consumed true on a company that buys as well
            // as imports.
            Number(ws, r, COpenQty, s.OpeningBalance + s.TotalIn, Acct0);
            Number(ws, r, COpenExl, s.OpeningValueExcludingTax + s.ValueIn, Acct0);
            Number(ws, r, COpenRate, s.SalesTaxRate / 100m, Pct);
            Formula(ws, r, COpenTax, $"L{r}*K{r}", Acct2);

            // ── Consumed: what the walk took out ─────────────────────────────
            Number(ws, r, CConsQty, s.TotalOut, Acct0);
            Number(ws, r, CConsExl, s.ValueOut, Acct0);
            Formula(ws, r, CConsRate, $"L{r}", Pct);
            Formula(ws, r, CConsTax, $"O{r}*P{r}", Acct0);

            // ── Balance: the live position, as VALUES ────────────────────────
            // Never =J-N / =K-O. StockValuation clamps value to zero on an
            // emptied bin and on a revaluation, so the subtraction can differ
            // from the walk — and the workbook must not contradict the screen.
            Number(ws, r, CBalQty, s.OnHand, Acct0);
            Number(ws, r, CBalExl, s.ValueExcludingTax, Acct0);
            Number(ws, r, CBalRate, s.SalesTaxRate / 100m, Pct);
            Number(ws, r, CBalTax, s.SalesTax, Acct0);

            ws.Cell(r, CStripe).Style.Fill.BackgroundColor = SeparatorFill;

            // ── Cost of Good Sold: X is keyed, the rest follows ──────────────
            // X (opening Exl) is deliberately empty — see the class comment. The
            // consumed Exl is backed out of the consumed sales tax at the
            // combined rate the way the client's own sheet does it (their
            // literal /21% generalised to the row's rate + VAT, so a 25% line
            // does not silently use an 18% basis).
            Blank(ws, r, CCogsOpenExl, Acct0);
            Formula(ws, r, CCogsOpenTax, $"X{r}*L{r}", Acct2);
            Formula(ws, r, CCogsOpenVat, $"X{r}*{VatRate}", Acct0);
            Formula(ws, r, CCogsConsExl, $"Q{r}/(L{r}+{VatRate})", Acct0);
            Formula(ws, r, CCogsConsTax, $"AA{r}*L{r}", Acct0);
            Formula(ws, r, CCogsConsVat, $"AA{r}*{VatRate}", Acct0);
            Formula(ws, r, CCogsBalExl, $"X{r}-AA{r}", Acct2);
            Formula(ws, r, CCogsBalTax, $"Y{r}-AB{r}", Acct2);
            Formula(ws, r, CCogsBalVat, $"Z{r}-AC{r}", Acct2);

            // The block edges, carried down the data rows as on the source sheet
            // so the three blocks stay visually separate all the way down.
            foreach (var col in new[] { COpenQty, CCogsOpenExl })
                ws.Cell(r, col).Style.Border.LeftBorder = XLBorderStyleValues.Medium;
            foreach (var col in new[] { COpenTax, CConsTax, CBalTax,
                                        CCogsOpenVat, CCogsConsVat, CCogsBalVat })
                ws.Cell(r, col).Style.Border.RightBorder = XLBorderStyleValues.Medium;

            ws.Range(r, CClaim, r, Cols).Style.Font.SetFontName(Face);
        }

        // ── Totals ────────────────────────────────────────────────────────────

        /// <summary>
        /// Written as SUM formulas over the data range, as on the source sheet —
        /// an accountant who deletes a row expects the totals to follow, and
        /// every data row here is an item row, so the range is contiguous.
        ///
        /// Rate columns (L / P / T) and Price (H) are deliberately not summed: a
        /// percentage and a weighted unit cost do not add up, and a column of
        /// them totalled is a number that means nothing.
        /// </summary>
        private static readonly int[] TotalledColumns =
        {
            COpenQty, COpenExl, COpenTax,
            CConsQty, CConsExl, CConsTax,
            CBalQty, CBalExl, CBalTax,
            CCogsOpenExl, CCogsOpenTax, CCogsOpenVat,
            CCogsConsExl, CCogsConsTax, CCogsConsVat,
            CCogsBalExl, CCogsBalTax, CCogsBalVat,
        };

        private static void WriteTotals(IXLWorksheet ws, int r, int lastDataRow)
        {
            // No data rows: a SUM over an empty range would be =SUM(J4:J3),
            // which Excel refuses to open. Total nothing instead.
            if (lastDataRow < FirstDataRow) return;

            var last = r - 1; // the blank row above, so an appended row is caught
            foreach (var col in TotalledColumns)
            {
                var letter = ColumnLetter(col);
                Formula(ws, r, col, $"SUM({letter}{FirstDataRow}:{letter}{last})", Acct0);
                ws.Cell(r, col).Style.Font.SetBold();
            }
            ws.Range(r, CClaim, r, Cols).Style.Font.SetFontName(Face);
        }

        private static string ColumnLetter(int col)
        {
            var s = "";
            while (col > 0)
            {
                var m = (col - 1) % 26;
                s = (char)('A' + m) + s;
                col = (col - 1) / 26;
            }
            return s;
        }

        // ── Summary sheet ─────────────────────────────────────────────────────

        /// <summary>
        /// The title block and the provenance. It is a second sheet because the
        /// data sheet has to BE the client's layout, which starts at its band
        /// labels with no banner above them — but an export that cannot say it
        /// was filtered, division-scoped or truncated is not auditable, and
        /// §5b-9's rule that a workbook must admit what it left out still holds.
        /// </summary>
        private static void WriteSummarySheet(XLWorkbook wb, StockExportDto data, bool truncated)
        {
            var ws = wb.Worksheets.Add("Summary");

            var r = 1;
            ws.Cell(r, 1).Value = Safe(data.CompanyName);
            ws.Cell(r, 1).Style.Font.SetBold().Font.SetFontSize(14).Font.SetFontColor(Navy);
            r++;

            ws.Cell(r, 1).Value = "Stock Sheet";
            ws.Cell(r, 1).Style.Font.SetFontSize(12);
            r++;

            ws.Cell(r, 1).Value = SheetName(data.GeneratedAt);
            ws.Cell(r, 1).Style.Font.SetFontSize(12);
            r += 2;

            // Headline figures — the same four the dashboard shows, summed from
            // the rows written, so the workbook states its own totals in words
            // as well as in the totals row.
            decimal qty = 0, excl = 0, tax = 0, incl = 0;
            foreach (var i in data.Items)
            {
                qty += i.Summary.OnHand;
                excl += i.Summary.ValueExcludingTax;
                tax += i.Summary.SalesTax;
                incl += i.Summary.ValueIncludingTax;
            }

            foreach (var (label, value, format) in new (string, decimal, string)[]
            {
                ("Quantity on hand", qty, "#,##0.####"),
                ("Excluding tax", excl, "#,##0.00"),
                ("Sales tax", tax, "#,##0.00"),
                ("Including tax", incl, "#,##0.00"),
            })
            {
                ws.Cell(r, 1).Value = label;
                ws.Cell(r, 2).Value = value;
                ws.Cell(r, 2).Style.NumberFormat.Format = format;
                ws.Cell(r, 1).Style.Font.SetBold();
                r++;
            }
            r++;

            var lines = new List<string>();
            lines.AddRange(data.FiltersApplied);
            lines.Add($"{data.Items.Count:N0} item{(data.Items.Count == 1 ? "" : "s")}");
            lines.Add($"Generated {data.GeneratedAt:dd-MM-yyyy HH:mm}");
            if (truncated)
                lines.Add($"TRUNCATED at {MaxRows:N0} rows — narrow the search for a complete export.");

            foreach (var line in lines)
            {
                ws.Cell(r, 1).Value = Safe(line);
                ws.Cell(r, 1).Style.Font.SetItalic().Font.SetFontColor(Muted);
                if (truncated && line.StartsWith("TRUNCATED", StringComparison.Ordinal))
                    ws.Cell(r, 1).Style.Font.SetFontColor(XLColor.DarkRed).Font.SetBold();
                r++;
            }
            r++;

            foreach (var note in new[]
            {
                "Opening is everything received — the opening balance plus purchases since.",
                "Balance is the live position from the weighted-average valuation, not Opening minus Consumed.",
                "Cost of Good Sold: key the Opening Exl column (X); S.Tax, Vat and the Consumed and Balance blocks follow by formula.",
                "Claim Month and Sub cat are yours to fill — this system records neither.",
                "GDs No and GD Date are shown only where every customs lot behind an item names the same declaration.",
            })
            {
                ws.Cell(r, 1).Value = note;
                ws.Cell(r, 1).Style.Font.SetItalic().Font.SetFontSize(9).Font.SetFontColor(Muted);
                r++;
            }

            ws.Column(1).Width = 80;
            ws.Column(2).Width = 20;
        }

        // ── Cell writers ──────────────────────────────────────────────────────

        private static void Text(IXLWorksheet ws, int r, int c, string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            ws.Cell(r, c).Value = Safe(value);
        }

        private static void Number(IXLWorksheet ws, int r, int c, decimal value, string format)
        {
            var cell = ws.Cell(r, c);
            cell.Value = value;
            cell.Style.NumberFormat.Format = format;
        }

        /// <summary>A cell that carries a format and a border but no value — the
        /// Cost of Good Sold input column. Written explicitly so the accounting
        /// format is already on it when the figure is typed.</summary>
        private static void Blank(IXLWorksheet ws, int r, int c, string format)
        {
            ws.Cell(r, c).Style.NumberFormat.Format = format;
        }

        private static void Formula(IXLWorksheet ws, int r, int c, string formula, string format)
        {
            var cell = ws.Cell(r, c);
            cell.FormulaA1 = formula;
            cell.Style.NumberFormat.Format = format;
        }

        private static void Date(IXLWorksheet ws, int r, int c, DateTime value)
        {
            var cell = ws.Cell(r, c);
            cell.Value = value;
            cell.Style.NumberFormat.Format = DateFmt;
        }

        private static void Outline(IXLStyle style)
        {
            style.Border.OutsideBorder = XLBorderStyleValues.Medium;
        }

        private static void Outline(IXLRange range) => Outline(range.Style);

        private static void Outline(IXLCell cell) => Outline(cell.Style);

        private static void ApplyWidths(IXLWorksheet ws)
        {
            foreach (var (col, width) in Widths) ws.Column(col).Width = width - WidthPadding;
        }

        private static string Safe(string? s) => ExcelTemplateEngine.CsvSafe(s);
    }
}
