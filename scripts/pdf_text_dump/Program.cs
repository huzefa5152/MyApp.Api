using System.Text;
using UglyToad.PdfPig;

// Verbatim copy of POParserService.ExtractTextFromPdf so the offline text matches
// exactly what the backend feeds RuleBasedPOParser (same custom PdfPig version).
static string ExtractTextFromPdf(Stream pdfStream)
{
    using var document = PdfDocument.Open(pdfStream);
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
    }
    return string.Join("\n", allLines);
}

if (args.Length < 1)
{
    Console.Error.WriteLine("usage: pdf_text_dump <file.pdf> [--marks]");
    return 2;
}
bool marks = args.Contains("--marks");
using var fs = File.OpenRead(args[0]);
var txt = ExtractTextFromPdf(fs);
if (marks)
    // Make 2-space column boundaries visible as ‖ for inspection.
    txt = string.Join("\n", txt.Split('\n').Select(l =>
        System.Text.RegularExpressions.Regex.Replace(l, @"\s{2,}", " ‖ ")));
Console.OutputEncoding = Encoding.UTF8;
Console.WriteLine(txt);
return 0;
