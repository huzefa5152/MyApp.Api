// Offline checks for PO import layout and format matching:
//   - PoLayoutText.FromOcrPage: how OCR'd words become the lines the parser reads
//   - POFormatFingerprintService fuzzy-match keywords and MatchScore
// Synthetic data only — the repo is public.
//   cd scripts/po_layout_harness && dotnet run -c Release
using MyApp.Api.Helpers;
using MyApp.Api.Services.Implementations;

int passed = 0; var failed = new List<string>();
void Check(string label, bool ok, string detail = "")
{ if (ok) passed++; else { failed.Add(label); Console.WriteLine($"  FAIL {label} {detail}"); } }

// A word at x (left) on a line whose box spans top..bottom; 12px per character.
PositionedWord W(string text, double x, double top, double bottom, double conf = 95)
    => new(text, x, x + text.Length * 12, top, bottom, text.Length * 12, bottom - top, conf);

Console.WriteLine("OCR lines");
{
    // A table header whose word boxes do not share a bottom edge: "Item" sits
    // lower, "Description" is a tall box. They are one visual line.
    var words = new List<PositionedWord>
    {
        W("PR", 0, 100, 118), W("No", 40, 100, 118),
        W("Item", 150, 102, 132),
        W("Description", 300, 90, 140),
        W("Qty", 600, 104, 122),
        W("ROW", 0, 200, 218), W("Widget", 300, 200, 218), W("5", 600, 200, 218),
    };
    var lines = PoLayoutText.FromOcrPage(words);
    Check("a header with scattered bottoms stays one line", lines.Count == 2, string.Join(" / ", lines));
    Check("columns separated by two spaces", lines[0] == "PR No  Item  Description  Qty", lines[0]);
    Check("rows in reading order", lines[1].StartsWith("ROW"), lines[1]);
}
{
    var words = new List<PositionedWord>
    {
        W("00014625", 0, 100, 114), W("|", 110, 90, 124, 70), W("AIR", 130, 100, 114), W("~~", 180, 90, 124, 30),
        W("-", 400, 106, 108, 11), W("5.00", 500, 100, 114), W("PIECE", 552, 100, 114),
        W("FO", 0, 130, 132, 4), W("be", 200, 130, 134, 24),
        W("KG", 700, 100, 114, 90),
    };
    var lines = PoLayoutText.FromOcrPage(words);
    Check("grid-line debris is dropped", !lines[0].Contains('|') && !lines[0].Contains('~'), lines[0]);
    Check("a faint placeholder '-' keeps its cell", lines[0].Contains("  -  "), lines[0]);
    Check("low-confidence letter fragments are dropped", lines.Count == 1, string.Join(" / ", lines));
    Check("a clear short token is kept", lines[0].EndsWith("KG"), lines[0]);
    Check("a qty and its unit one space apart", lines[0].Contains("5.00 PIECE"), lines[0]);
}
{
    // A dotted rule read as faint junk, next to a faint but real size code.
    var words = new List<PositionedWord>
    {
        W("50X15", 0, 100, 114, 15), W("DOUBLE", 80, 100, 114, 90), W("ACTION", 170, 100, 114, 97),
        W("kiss", 300, 100, 114, 23), W("mmm", 360, 100, 114, 36), W("ARTs", 420, 100, 114, 6),
        W("DOUBLEACTION", 0, 200, 214, 22),
    };
    var lines = PoLayoutText.FromOcrPage(words);
    Check("a faint word with a digit stays", lines[0].StartsWith("50X15"), lines[0]);
    Check("faint short digit-free junk goes", !lines[0].Contains("kiss") && !lines[0].Contains("mmm") && !lines[0].Contains("ARTs"), lines[0]);
    Check("a faint LONG word stays", lines.Count == 2 && lines[1] == "DOUBLEACTION", string.Join(" / ", lines));
}
Check("an empty page gives no lines", PoLayoutText.FromOcrPage(new List<PositionedWord>()).Count == 0);

Console.WriteLine("PDF lines (the historical rule)");
{
    // PDF space: larger Y is higher. Bottom within 0.4 x height groups a line.
    var pdf = new List<PositionedWord>
    {
        new("Low", 0, 36, 20, 10, 36, 10), new("Top", 0, 36, 90, 80, 36, 10), new("Top2", 100, 148, 90, 81, 48, 10),
    };
    var lines = PoLayoutText.FromPdfPage(pdf);
    Check("PDF lines run top to bottom", lines.Count == 2 && lines[0].StartsWith("Top") && lines[1] == "Low", string.Join(" / ", lines));
    Check("PDF column gap is two spaces", lines[0] == "Top  Top2", lines[0]);
}

Console.WriteLine("Fuzzy matching");
{
    var stored = POFormatFingerprintService.StoredMatchKeywords("date|pm head office|p. o. no|qty|rate|item|total");
    Check("stored keywords lose a time prefix", stored.Contains("head office") && !stored.Contains("pm head office"));

    var po = "Supplier Name : ACME\nP. O. No : 101\nDate : 01-01-26\nCode  Item Name  Unit  Qty  Rate  Total Amount\n"
           + "123 EPOXY RESIN:  SET  4  4800  19,200\n1000gm HARDENER: 800gm\nTotal  19,200\n10:51 AM  Head Office : Karachi\n";
    var mk = POFormatFingerprintService.ComputeMatchKeywords(po);
    Check("item-row labels are set apart", mk.ItemRows.Contains("epoxy resin") && mk.ItemRows.Contains("hardener"),
        string.Join(",", mk.ItemRows));
    Check("layout keywords keep the real labels", mk.Layout.Contains("supplier name") && mk.Layout.Contains("head office"),
        string.Join(",", mk.Layout));
    Check("a time prefix is not part of a label", !mk.Layout.Contains("am head office"));

    // Item-row labels never count against a match...
    var sig = POFormatFingerprintService.StoredMatchKeywords(string.Join("|", mk.Layout));
    Check("item-row text does not lower the score", Math.Abs(POFormatFingerprintService.MatchScore(mk, sig) - 1.0) < 1e-9);
    // ...but count for it when the saved signature has them too.
    var sigWith = POFormatFingerprintService.StoredMatchKeywords(string.Join("|", mk.Layout.Append("hardener")));
    var without = new MatchKeywords(mk.Layout, new HashSet<string>());
    Check("a shared item-row label still counts",
        POFormatFingerprintService.MatchScore(mk, sigWith) > POFormatFingerprintService.MatchScore(without, sigWith));

    // The exact-hash signature is untouched by all of this.
    var fp = new POFormatFingerprintService().Compute(po);
    Check("Compute still includes item-row labels (stored hashes stay valid)", fp.Keywords.Contains("hardener"));
}

Console.WriteLine();
Console.WriteLine($"{passed + failed.Count} checks, {failed.Count} failed");
return failed.Count == 0 ? 0 : 1;
