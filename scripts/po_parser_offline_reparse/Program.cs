using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;
using UglyToad.PdfPig;

// Verbatim copy of POParserService.ExtractTextFromPdf (same custom PdfPig) so
// the text fed to the parser matches the running backend exactly.
static string ExtractTextFromPdf(Stream pdfStream)
{
    using var document = PdfDocument.Open(pdfStream);
    var allLines = new List<string>();
    foreach (var page in document.GetPages())
    {
        var words = page.GetWords().ToList();
        if (words.Count == 0)
        {
            if (!string.IsNullOrWhiteSpace(page.Text)) allLines.Add(page.Text);
            continue;
        }
        var avgHeight = words.Average(w => w.BoundingBox.Height);
        var yTolerance = Math.Max(avgHeight * 0.4, 2);
        var lineGroups = new List<(double Y, List<UglyToad.PdfPig.Content.Word> Words)>();
        foreach (var word in words)
        {
            var wordY = word.BoundingBox.Bottom;
            bool added = false;
            for (int i = 0; i < lineGroups.Count; i++)
                if (Math.Abs(wordY - lineGroups[i].Y) <= yTolerance)
                { lineGroups[i].Words.Add(word); added = true; break; }
            if (!added) lineGroups.Add((wordY, new List<UglyToad.PdfPig.Content.Word> { word }));
        }
        lineGroups.Sort((a, b) => b.Y.CompareTo(a.Y));
        foreach (var (_, lineWords) in lineGroups)
        {
            var sorted = lineWords.OrderBy(w => w.BoundingBox.Left).ToList();
            var sb = new StringBuilder();
            for (int wi = 0; wi < sorted.Count; wi++)
            {
                if (wi > 0)
                {
                    var gap = sorted[wi].BoundingBox.Left - sorted[wi - 1].BoundingBox.Right;
                    var prevCharWidth = sorted[wi - 1].BoundingBox.Width / Math.Max(sorted[wi - 1].Text.Length, 1);
                    sb.Append(gap > prevCharWidth * 1.8 ? "  " : " ");
                }
                sb.Append(sorted[wi].Text);
            }
            var text = sb.ToString();
            if (!string.IsNullOrWhiteSpace(text)) allLines.Add(text);
        }
    }
    return string.Join("\n", allLines);
}

// Manifest: [{ id, pdf, desc, qty, unit }]. Output: [{ id, items:[{description,quantity,unit}] }].
if (args.Length < 1) { Console.Error.WriteLine("usage: reparse <manifest.json>"); return 2; }
var manifest = JsonSerializer.Deserialize<List<Entry>>(File.ReadAllText(args[0]),
    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
var parser = new RuleBasedPOParser(NullLogger<RuleBasedPOParser>.Instance);
var outRows = new List<object>();
foreach (var e in manifest)
{
    List<object> items = new();
    string? err = null;
    try
    {
        using var fs = File.OpenRead(e.Pdf!);
        var text = ExtractTextFromPdf(fs);
        var ruleSet = JsonSerializer.Serialize(new
        {
            version = 1, engine = "simple-headers-v1",
            descriptionHeader = e.Desc ?? "", quantityHeader = e.Qty ?? "", unitHeader = e.Unit ?? "",
        });
        var r = parser.Parse(text, new POFormat { Id = 1, Name = "x", RuleSetJson = ruleSet });
        items = r.Items.Select(i => (object)new { description = i.Description, quantity = i.Quantity, unit = i.Unit }).ToList();
    }
    catch (Exception ex) { err = ex.Message; }
    outRows.Add(new { id = e.Id, items, err });
}
Console.OutputEncoding = Encoding.UTF8;
Console.WriteLine(JsonSerializer.Serialize(outRows, new JsonSerializerOptions { WriteIndented = false }));
return 0;

record Entry(int Id, string? Pdf, string? Desc, string? Qty, string? Unit);
