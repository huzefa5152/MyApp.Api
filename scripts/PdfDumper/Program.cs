using System.Text;
using UglyToad.PdfPig;

// Uses the SAME line-reconstruction algorithm as MyApp.Api.POParserService
// so the dumped text matches exactly what the production parser will see at
// runtime. Keep these in sync if one changes.
if (args.Length < 2)
{
    Console.Error.WriteLine("usage: PdfDumper <output-dir> <pdf1> [pdf2 ...]");
    return 1;
}

var outDir = args[0];
Directory.CreateDirectory(outDir);

var ok = 0;
var failed = 0;

for (int i = 1; i < args.Length; i++)
{
    var pdfPath = args[i];
    try
    {
        var text = ExtractText(pdfPath);
        var safeName = Path.GetFileNameWithoutExtension(pdfPath);
        if (safeName.Length > 60) safeName = safeName[..60];
        safeName = string.Concat(safeName.Select(c => char.IsLetterOrDigit(c) || c == '-' || c == '_' ? c : '_'));
        var outPath = Path.Combine(outDir, $"{i:D2}_{safeName}.txt");
        File.WriteAllText(outPath, text);
        Console.WriteLine($"OK {Path.GetFileName(pdfPath)} -> {outPath} ({text.Length} chars)");
        ok++;
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"FAIL {Path.GetFileName(pdfPath)}: {ex.Message}");
        failed++;
    }
}

Console.WriteLine($"--- {ok} ok, {failed} failed ---");
return failed > 0 ? 2 : 0;

static string ExtractText(string pdfPath)
{
    using var document = PdfDocument.Open(pdfPath);
    var allLines = new List<string>();

    foreach (var page in document.GetPages())
    {
        var words = page.GetWords().ToList();
        if (words.Count == 0)
        {
            if (!string.IsNullOrWhiteSpace(page.Text))
                allLines.Add(page.Text);
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
            {
                if (Math.Abs(wordY - lineGroups[i].Y) <= yTolerance)
                {
                    lineGroups[i].Words.Add(word);
                    added = true;
                    break;
                }
            }

            if (!added)
                lineGroups.Add((wordY, new List<UglyToad.PdfPig.Content.Word> { word }));
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
            if (!string.IsNullOrWhiteSpace(text))
                allLines.Add(text);
        }

        allLines.Add("===PAGE-BREAK===");
    }

    return string.Join("\n", allLines);
}
