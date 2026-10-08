using System.Globalization;
using System.Text.RegularExpressions;
using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers;

// Paste-specific extraction. PDF/OCR formats continue through their existing parser.
public static class CustomerEmailTextReader
{
    static readonly Regex Number = new(@"^\d[\d,]*(?:\.\d+)?$", RegexOptions.CultureInvariant);
    const string Units = @"pcs?\.?|pieces?|nos?\.?|numbers?|sets?|pairs?|kgs?\.?|kg|g|grams?|mtr\.?|mtrs|meters?|metres?|feet|foot|ft\.?|litres?|liters?|ltr|rolls?|boxes?|box|packets?|packs?|dozens?|reams?|bags?|lengths?|units?";
    static string Clean(string value) { var s = value.Trim(); return s.StartsWith("* ") ? s : s.Trim('*', '_').Trim(); }
    static string Header(string value)
    {
        var s = Regex.Replace(Clean(value).ToLowerInvariant(), @"[\s.#:_-]", "");
        return s switch {
            "sno" or "sr" or "srno" or "serial" or "serialno" or "linenumber" or "lineno" => "serial",
            "description" or "itemdescription" or "item" or "iteam" or "particular" or "particulars" or "product" or "itemname" or "material" or "materialdescription" or "productdescription" or "particularsofitems" => "description",
            "qty" or "quantity" or "requiredqty" or "requiredquantity" or "orderqty" => "quantity", "unit" or "uom" or "unitofmeasure" or "unitofmeasurement" => "unit",
            "pr" or "prno" or "indent" or "indentno" or "pono" or "reference" => "reference",
            "date" => "date", "brand" or "make" => "brand",
            "rate" or "rateexgst" or "unitprice" or "price" or "unitrate" => "price",
            "remarks" => "remarks", "itemcode" or "code" => "code", _ => ""
        };
    }
    static bool Decimal(string text, out decimal value) { value = 0; return Number.IsMatch(text.Trim()) && decimal.TryParse(text.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out value); }
    static bool Quantity(string text, out decimal value, out string unit)
    {
        var match = Regex.Match(Clean(text), @"^(\d[\d,]*(?:\.\d+)?)\s*(" + Units + @")?$", RegexOptions.IgnoreCase);
        value = 0; unit = "";
        if (!match.Success || !Decimal(match.Groups[1].Value, out value)) return false;
        unit = match.Groups[2].Value.TrimEnd('.'); return true;
    }
    static bool Signature(string text) => Regex.IsMatch(text, @"^(regards|best regards|thanks|thank you|disclaimer|procurement officer|.*procurement manager|sent from|on .+ wrote:|[- ]*original message|[- ]*forwarded message|from:|tel:|cell:|email:|www\.|https?://)", RegexOptions.IgnoreCase);

    public static ParsedPODto Parse(string text)
    {
        var result = new ParsedPODto { RawText = text };
        var lines = text.Replace("\r", "").Replace('\u00a0', ' ').Split('\n').Select(Clean).Where(s => s.Length > 0).ToList();
        var references = new HashSet<string>();
        var dates = new HashSet<DateTime>();
        int start = -1;
        var headers = new List<string>();
        bool tabular = false;
        // A header must explicitly identify both description and quantity.
        for (int i = 0; i < lines.Count; i++)
        {
            var cells = Regex.Split(lines[i], @"\t|\s*\|\s*|\s{2,}");
            var rowHeaders = cells.Select(Header).ToList();
            if (rowHeaders.Contains("description") && rowHeaders.Contains("quantity"))
            { headers = rowHeaders; start = i + 1; tabular = true; break; }
            if (Header(lines[i]) == "") continue;
            var candidate = new List<string>(); int j = i;
            while (j < lines.Count && Header(lines[j]) != "") candidate.Add(Header(lines[j++]));
            if (candidate.Contains("description") && candidate.Contains("quantity"))
            { headers = candidate; start = j; break; }
        }
        if (start >= 0)
        {
            if (!tabular && !headers.Contains("serial") && start < lines.Count && lines[start] == "1") headers.Insert(0, "serial");
            if (tabular && !headers.Contains("serial") && start < lines.Count) {
                var firstCells = Regex.Split(lines[start], @"\t|\s*\|\s*|\s{2,}");
                if (firstCells.Length == headers.Count + 1 && firstCells[0] == "1") headers.Insert(0, "serial");
            }
            int expected = 1;
            for (int i = start; i < lines.Count;)
            {
                if (Signature(lines[i])) break;
                if (result.Items.Count >= 500) { result.Warnings.Add("Only the first 500 items were extracted. Split the email into smaller imports."); break; }
                List<string> cells;
                if (tabular)
                {
                    cells = Regex.Split(lines[i++], @"\t|\s*\|\s*|\s{2,}").Select(Clean).ToList();
                    if (cells.Select(Header).Contains("description")) { result.Warnings.Add("Another table or quoted reply was found. Only the first table was imported; review the remaining email."); break; }
                }
                else
                {
                    cells = new();
                    if (headers.Contains("serial"))
                    {
                        if (lines[i] != expected.ToString()) { result.Warnings.Add("Text after the last complete table row was excluded. Check the original for additional items or replies."); break; }
                        cells.Add(lines[i++]);
                    }
                    foreach (var h in headers.Skip(cells.Count))
                    {
                        // Empty optional cells vanish when a mail table is copied as plain text.
                        if (i >= lines.Count || (h is "brand" or "price" or "remarks" or "code") && (lines[i] == (expected + 1).ToString() || Signature(lines[i]) || !lines.Skip(i).Contains((expected + 1).ToString()))) cells.Add("");
                        else {
                            var value = lines[i++];
                            if (h == "description") {
                                var nextHeader = headers.ElementAtOrDefault(cells.Count + 1);
                                while (i < lines.Count && !Signature(lines[i]) &&
                                    (nextHeader == "unit" && !Regex.IsMatch(lines[i], "^(" + Units + ")$", RegexOptions.IgnoreCase) ||
                                     nextHeader == "quantity" && !Quantity(lines[i], out _, out _)))
                                { value += " " + lines[i++]; }
                            }
                            cells.Add(value);
                        }
                    }
                }
                string Cell(string h) { var index = headers.IndexOf(h); return index >= 0 && index < cells.Count ? cells[index] : ""; }
                if (tabular && headers.Contains("serial") && Cell("serial") != expected.ToString()) { result.Warnings.Add("Row numbering changed or a quoted reply was found. Check remaining email rows manually."); break; }
                var description = Cell("description");
                if (!Regex.IsMatch(description, @"[\p{L}]")) { result.Warnings.Add($"Table row {expected}: description was unclear; review and add the row manually."); expected++; continue; }
                var qtyText = Cell("quantity");
                var valid = Quantity(qtyText, out var qty, out var qtyUnit) && qty > 0;
                var unit = Cell("unit").TrimEnd('.'); if (unit == "") unit = qtyUnit;
                if (!valid) result.Warnings.Add($"Table row {expected}: enter a valid quantity; none was guessed.");
                if (unit == "") result.Warnings.Add($"Table row {expected}: unit was missing; confirm the suggested Pcs unit.");
                decimal? price = null;
                if (Cell("price") != "") { if (Decimal(Cell("price"), out var parsedPrice) && parsedPrice >= 0) price = parsedPrice; else result.Warnings.Add($"Table row {expected}: price was unclear and left pending."); }
                var reference = Cell("reference"); if (reference != "") references.Add(reference);
                if (DateTime.TryParseExact(Cell("date"), new[] { "dd/MM/yyyy", "d/M/yyyy", "yyyy-MM-dd", "dd-MM-yyyy" }, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) dates.Add(date);
                result.Items.Add(new ParsedPOItemDto { Description = description, Quantity = valid ? qty : 0, Unit = unit == "" ? "Pcs" : unit,
                    UnitPrice = price, ItemCode = Cell("code"), Remarks = string.Join(" / ", new[] { reference == "" ? "" : "Reference " + reference, Cell("date"), Cell("brand") == "" ? "" : "Brand " + Cell("brand"), Cell("remarks") }.Where(x => x != "")) });
                expected++;
                // In a vertical table without an explicit serial heading, emails often still number rows.
            }
        }
        else
        {
            foreach (var raw in lines)
            {
                if (result.Items.Count > 0 && Signature(raw)) break;
                var marker = Regex.Match(raw, @"^(?:\d+[.)]\s+|[-•*]\s+)(.+)$");
                var line = marker.Success ? marker.Groups[1].Value : raw;
                if (result.Items.Count >= 500) { result.Warnings.Add("Only the first 500 items were extracted. Split the email into smaller imports."); break; }
                var match = Regex.Match(line, @"^(?<desc>.+?)\s*(?:[-:]\s*|\s{2,}|\s+)(?<qty>\d[\d,]*(?:\.\d+)?)\s+(?<unit>" + Units + @")$", RegexOptions.IgnoreCase);
                if (match.Success && !Regex.IsMatch(match.Groups["desc"].Value, @"\b(length|width|height|dia|diameter|size)\s*$", RegexOptions.IgnoreCase) && Decimal(match.Groups["qty"].Value, out var qty) && qty > 0)
                    result.Items.Add(new ParsedPOItemDto { Description = match.Groups["desc"].Value.Trim().TrimEnd('-', ':'), Quantity = qty, Unit = match.Groups["unit"].Value.TrimEnd('.') });
                else if (marker.Success && Regex.IsMatch(line, @"[\p{L}]"))
                { result.Items.Add(new ParsedPOItemDto { Description = line, Quantity = 0, Unit = "Pcs" }); result.Warnings.Add($"Item {result.Items.Count}: quantity/unit were unclear. Enter them before creating the document."); }
            }
        }
        if (!tabular && headers.Any(h => h is "brand" or "price" or "remarks")) result.Warnings.Add("Plain text can lose blank table cells. Check brands, remarks and prices in the original; copy the formatted table to preserve those columns.");
        if (references.Count > 0) result.PONumber = string.Join(", ", references);
        else { var m = Regex.Match(text, @"(?:requirement|enquiry|inquiry|rfq|pr|po)\s*(?:no\.?|number|#|\.)?\s*[:=-]?\s*(\d[\w/-]*)", RegexOptions.IgnoreCase); if (m.Success) result.PONumber = m.Groups[1].Value; }
        if (dates.Count == 1) result.PODate = dates.Single();
        if (result.Items.Count > 0) result.Warnings.Insert(0, $"Email extraction found {result.Items.Count} items. Check every description, quantity and unit against the original; missing prices remain pending.");
        if (Regex.IsMatch(text, @"brand name|mention brand|make with every", RegexOptions.IgnoreCase)) {
            result.SourceNotes = "Sender requirement: mention brand/make for every item before sending the quotation.";
            result.Warnings.Add("The sender requests a brand/make for each item. This requirement is retained in document notes.");
        }
        return result;
    }
}
