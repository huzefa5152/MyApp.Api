using System.Globalization;
using System.Text.RegularExpressions;
using HtmlAgilityPack;
using MyApp.Api.DTOs;
namespace MyApp.Api.Helpers;

public static class EmailEnquiryExtractor
{
    private static readonly Dictionary<string, string[]> Aliases = new()
    {
        ["description"] = ["item description", "item name", "material description", "descriptions", "description", "item", "iteam", "particular", "particulars", "material", "product"],
        ["quantity"] = ["qty", "quantity", "required qty"],
        ["unit"] = ["uom", "a/unit", "unit", "units"],
        ["reference"] = ["pr", "pr #", "indent", "indent no", "reference"],
    };
    private static string Clean(string text) => Regex.Replace(HtmlEntity.DeEntitize(text), @"\s+", " ", RegexOptions.None, TimeSpan.FromSeconds(1)).Trim();
    public static string PlainText(EmailContent content)
    {
        if (!string.IsNullOrWhiteSpace(content.Text)) return content.Text;
        var document = new HtmlDocument(); document.LoadHtml(content.Html);
        foreach (var node in document.DocumentNode.SelectNodes("//script|//style|//noscript") ?? Enumerable.Empty<HtmlNode>()) node.Remove();
        return Clean(document.DocumentNode.InnerText);
    }
    public static EmailDraftDto Extract(string subject, EmailContent content)
    {
        var draft = new EmailDraftDto();
        var text = PlainText(content);
        draft.RequiresBrand = Regex.IsMatch(text, @"\b(brand|make)\b.*\b(every|each|mandatory|required|acceptable)\b|\b(every|each)\b.*\b(brand|make)\b",
            RegexOptions.IgnoreCase | RegexOptions.Singleline, TimeSpan.FromSeconds(1));
        draft.RequiresBrand |= Regex.IsMatch(text, @"please\s+mention\s+(?:brand|make)", RegexOptions.IgnoreCase, TimeSpan.FromSeconds(1));
        draft.RequiresSpecifications = Regex.IsMatch(text, @"as per (?:sample|drawing)|drawing attached", RegexOptions.IgnoreCase, TimeSpan.FromSeconds(1));
        var reference = Regex.Match(subject, @"(?:PR[.\s:#-]*|requirement\s*(?:no[.\s]*)?|indent\s*)([\d][\d\s&/-]*)", RegexOptions.IgnoreCase, TimeSpan.FromSeconds(1));
        if (reference.Success) draft.CustomerEnquiryRef = reference.Value.Trim();
        var document = new HtmlDocument(); document.LoadHtml(content.Html);
        var references = new HashSet<string>();
        var inferredTableRead = false;
        foreach (var table in document.DocumentNode.SelectNodes("//table") ?? Enumerable.Empty<HtmlNode>())
        {
            var rows = table.SelectNodes("./tr|./tbody/tr|./thead/tr");
            if (rows == null) continue;
            Dictionary<string, int>? map = null;
            int[] descriptionColumns = [];
            var dataRows = rows.Select(r => r.SelectNodes("./th|./td")).OfType<HtmlNodeCollection>().ToList();
            // Infer only a repeated code / description / specification / quantity / unit layout.
            if (dataRows.Count >= 2 && dataRows.All(c => c.Count == 5 && c.All(n => n.GetAttributeValue("colspan", 1) == 1 && n.GetAttributeValue("rowspan", 1) == 1)
                && Regex.IsMatch(Clean(c[0].InnerText), @"^\d+$", RegexOptions.None, TimeSpan.FromSeconds(1))
                && Clean(c[1].InnerText).Any(char.IsLetter)
                && decimal.TryParse(Clean(c[3].InnerText), NumberStyles.Number, CultureInfo.InvariantCulture, out var q) && q > 0
                && Regex.IsMatch(Clean(c[4].InnerText), @"^(?:pcs?\.?|nos?\.?|kg|mtr|meter|metre|set|sets|pair|pairs|ltr|litre|roll|rolls)$", RegexOptions.IgnoreCase, TimeSpan.FromSeconds(1))))
            {
                if (inferredTableRead) { draft.Warnings.Add("Additional tables without headings were skipped to avoid importing older quoted requests. Review the original email."); continue; }
                inferredTableRead = true;
                map = new() { ["description"] = 1, ["quantity"] = 3, ["unit"] = 4 };
                descriptionColumns = [1, 2];
                draft.Warnings.Add("Items came from a table without headings. Confirm its column meanings and specifications.");
            }
            foreach (var row in rows)
            {
                var cells = row.SelectNodes("./th|./td");
                if (cells == null || cells.Count > 40) continue;
                var values = cells.Select(c => Clean(c.InnerText)).ToArray();
                if (map == null)
                {
                    var candidate = new Dictionary<string, int>();
                    foreach (var (key, aliases) in Aliases)
                    {
                        var indices = values.Select((v, i) => (v, i)).Where(x => aliases.Contains(x.v.ToLowerInvariant().Trim(' ', '.', '#'))).Select(x => x.i).ToArray();
                        if (indices.Length == 1 || key == "description" && indices.Length == 2) candidate[key] = indices[0];
                    }
                    if (candidate.ContainsKey("description") && candidate.ContainsKey("quantity"))
                    {
                        map = candidate;
                        descriptionColumns = values.Select((v, i) => (v, i)).Where(x => Aliases["description"].Contains(x.v.ToLowerInvariant().Trim(' ', '.', '#'))).Select(x => x.i).ToArray();
                    }
                    continue;
                }
                if (cells.Any(c => c.GetAttributeValue("rowspan", 1) > 1 || c.GetAttributeValue("colspan", 1) > 1))
                { draft.Warnings.Add("A merged data row needs manual review."); continue; }
                string At(string key) => map.TryGetValue(key, out var i) && i < values.Length ? values[i] : "";
                var description = string.Join(" ", descriptionColumns.Where(i => i < values.Length).Select(i => values[i]).Where(v => v.Length > 0)); var quantity = At("quantity"); var unit = At("unit");
                if (string.IsNullOrWhiteSpace(description) || description.Equals("total", StringComparison.OrdinalIgnoreCase)) continue;
                var match = Regex.Match(quantity, @"^([\d,]+(?:\.\d+)?)\s*([^\d]*)$", RegexOptions.None, TimeSpan.FromSeconds(1));
                if (!match.Success || !decimal.TryParse(match.Groups[1].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var qty) || qty <= 0)
                { draft.Warnings.Add("A row had an unreadable quantity and was not imported: " + description[..Math.Min(description.Length, 80)]); continue; }
                if (unit.Length == 0) unit = match.Groups[2].Value.Trim();
                draft.Items.Add(new() { Description = description[..Math.Min(description.Length, 2000)], Quantity = qty, Unit = unit });
                var rf = At("reference"); if (rf.Length > 0) references.Add(rf);
                if (draft.Items.Count >= 200) { draft.Warnings.Add("Only the first 200 items were extracted. Review the source."); break; }
            }
            if (draft.Items.Count >= 200) break;
        }
        if (references.Count > 0) draft.CustomerEnquiryRef = string.Join(" / ", references);
        if (draft.Items.Count == 0) draft.Warnings.Add("No supported item table was found. Add items manually or review a supported attachment.");
        if (draft.Items.Any(i => string.IsNullOrWhiteSpace(i.Unit))) draft.Warnings.Add("Some items need a unit.");
        if (draft.RequiresBrand) draft.Warnings.Add("Brand / make is required for every item.");
        if (draft.RequiresSpecifications) draft.Warnings.Add("Confirm the referenced sample / drawing before conversion.");
        if (content.Attachments.Any()) draft.Warnings.Add("Attachments are available on the source email. Verify their requirements before creating a quotation.");
        return draft;
    }
}
