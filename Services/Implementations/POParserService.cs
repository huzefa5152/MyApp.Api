using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;
using UglyToad.PdfPig;

namespace MyApp.Api.Services.Implementations
{
    public class POParserService : IPOParserService
    {
        public string ExtractTextFromPdf(Stream pdfStream)
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

                // Group words into lines by Y-coordinate proximity
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

                // Sort: top to bottom (higher Y = higher on page in PDF coordinates)
                lineGroups.Sort((a, b) => b.Y.CompareTo(a.Y));

                foreach (var (_, lineWords) in lineGroups)
                {
                    var sorted = lineWords.OrderBy(w => w.BoundingBox.Left).ToList();
                    var sb = new StringBuilder();
                    for (int wi = 0; wi < sorted.Count; wi++)
                    {
                        if (wi > 0)
                        {
                            // Use actual gap between words to decide spacing
                            var gap = sorted[wi].BoundingBox.Left - sorted[wi - 1].BoundingBox.Right;
                            var prevCharWidth = sorted[wi - 1].BoundingBox.Width / Math.Max(sorted[wi - 1].Text.Length, 1);
                            // Gap wider than ~2 chars → column boundary → use double space
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

        // Helper classes for position-based PDF table extraction
        private class PdfWord
        {
            public string Text { get; set; } = "";
            public double Left { get; set; }
            public double Right { get; set; }
            public double Bottom { get; set; }
            public double Height { get; set; }
        }

        private class PdfLine
        {
            public double Y { get; set; }
            public List<PdfWord> Words { get; set; } = new();
            public string Text
            {
                get
                {
                    var sorted = Words.OrderBy(w => w.Left).Select(w => w.Text);
                    return string.Join(" ", sorted);
                }
            }
        }

        /// <summary>
        /// Parse PDF directly using word positions for accurate table extraction.
        /// </summary>
        public ParsedPODto ParsePdf(Stream pdfStream)
        {
            using var document = PdfDocument.Open(pdfStream);
            var allPdfLines = new List<PdfLine>();
            var textLines = new List<string>();

            foreach (var page in document.GetPages())
            {
                var words = page.GetWords().ToList();
                if (words.Count == 0) continue;

                var avgHeight = words.Average(w => w.BoundingBox.Height);
                var yTolerance = Math.Max(avgHeight * 0.4, 2);

                var lineGroups = new List<PdfLine>();

                foreach (var word in words)
                {
                    var pw = new PdfWord
                    {
                        Text = word.Text,
                        Left = word.BoundingBox.Left,
                        Right = word.BoundingBox.Right,
                        Bottom = word.BoundingBox.Bottom,
                        Height = word.BoundingBox.Height
                    };

                    bool added = false;
                    foreach (var line in lineGroups)
                    {
                        if (Math.Abs(pw.Bottom - line.Y) <= yTolerance)
                        {
                            line.Words.Add(pw);
                            added = true;
                            break;
                        }
                    }
                    if (!added)
                        lineGroups.Add(new PdfLine { Y = pw.Bottom, Words = new List<PdfWord> { pw } });
                }

                lineGroups.Sort((a, b) => b.Y.CompareTo(a.Y));
                allPdfLines.AddRange(lineGroups);
                textLines.AddRange(lineGroups.Select(l => l.Text));
            }

            var fullText = string.Join("\n", textLines);

            var result = new ParsedPODto
            {
                RawText = fullText,
                Warnings = new List<string>()
            };

            if (string.IsNullOrWhiteSpace(fullText))
            {
                result.Warnings.Add("No text content found.");
                return result;
            }

            fullText = fullText.Replace("\r\n", "\n").Replace("\r", "\n");

            result.PONumber = ExtractPONumber(fullText);
            result.PODate = ExtractPODate(fullText);

            // Primary: position-based table extraction from PDF coordinates
            result.Items = ExtractItemsFromPdfLines(allPdfLines);

            // Fallback: text-based parsing
            if (result.Items.Count == 0)
                result.Items = ExtractItems(fullText);

            // Normalize and filter false positives
            foreach (var item in result.Items)
            {
                item.Unit = NormalizeUnit(item.Unit);
                item.Description = CleanDescription(item.Description);
            }
            result.Items = FilterFalsePositiveItems(result.Items);

            if (string.IsNullOrEmpty(result.PONumber))
                result.Warnings.Add("Could not detect PO Number. Please enter it manually.");
            if (result.PODate == null)
                result.Warnings.Add("Could not detect PO Date. Please enter it manually.");
            if (result.Items.Count == 0)
                result.Warnings.Add("Could not detect any items. Please add items manually.");

            return result;
        }

        /// <summary>
        /// Extracts items from PDF using word positions to accurately detect table columns.
        /// </summary>
        private static List<ParsedPOItemDto> ExtractItemsFromPdfLines(List<PdfLine> lines)
        {
            // Step 1: Find header line containing "Item Name/Description" + "Qty/Quantity"
            int headerIdx = -1;
            for (int i = 0; i < lines.Count; i++)
            {
                var text = lines[i].Text.ToLower();
                if ((text.Contains("item") || text.Contains("desc") || text.Contains("particular")) &&
                    (text.Contains("qty") || text.Contains("quantity")))
                {
                    headerIdx = i;
                    break;
                }
            }

            if (headerIdx < 0) return new List<ParsedPOItemDto>();

            // Step 2: Group header words into column clusters based on spatial proximity
            var headerWords = lines[headerIdx].Words.OrderBy(w => w.Left).ToList();
            var columns = new List<(double Left, double Right, string Label)>();
            var currentCluster = new List<PdfWord>();

            for (int j = 0; j < headerWords.Count; j++)
            {
                if (currentCluster.Count == 0)
                {
                    currentCluster.Add(headerWords[j]);
                }
                else
                {
                    var prevRight = currentCluster.Last().Right;
                    var gap = headerWords[j].Left - prevRight;
                    var avgCharWidth = currentCluster.Last().Right - currentCluster.Last().Left;
                    if (currentCluster.Last().Text.Length > 0)
                        avgCharWidth /= currentCluster.Last().Text.Length;

                    if (gap > avgCharWidth * 1.5)
                    {
                        // New column — save current cluster
                        columns.Add((currentCluster.First().Left, currentCluster.Last().Right, string.Join(" ", currentCluster.Select(w => w.Text))));
                        currentCluster = new List<PdfWord> { headerWords[j] };
                    }
                    else
                    {
                        currentCluster.Add(headerWords[j]);
                    }
                }
            }
            if (currentCluster.Count > 0)
                columns.Add((currentCluster.First().Left, currentCluster.Last().Right, string.Join(" ", currentCluster.Select(w => w.Text))));

            // Step 3: Identify key columns by label
            int descColIdx = -1, unitColIdx = -1, qtyColIdx = -1, codeColIdx = -1;
            for (int c = 0; c < columns.Count; c++)
            {
                var label = columns[c].Label.ToLower();
                // "unit price" is a price column, not a unit column
                if (label.Contains("unit price") || label.Contains("unit cost"))
                    continue;
                if (codeColIdx < 0 && (label == "code" || label == "item #" || label == "item no" ||
                    label == "s.no" || label == "sr. no" || label == "sr.no" || label == "s. no" ||
                    label == "line no." || label == "line no"))
                    codeColIdx = c;
                else if (descColIdx < 0 && (label.Contains("desc") || label.Contains("particular") ||
                    (label.Contains("item") && !label.Contains("item #") && !label.Contains("item no"))))
                    descColIdx = c;
                else if (unitColIdx < 0 && (label == "unit" || label == "uom" || label == "u.o.m"))
                    unitColIdx = c;
                else if (qtyColIdx < 0 && (label.Contains("qty") || label.Contains("quantity")))
                    qtyColIdx = c;
            }

            if (descColIdx < 0 || qtyColIdx < 0) return new List<ParsedPOItemDto>();

            // Step 4: Build column boundaries using midpoints between adjacent headers
            var colBounds = new List<(double Start, double End)>();
            for (int c = 0; c < columns.Count; c++)
            {
                double start = c > 0
                    ? (columns[c - 1].Right + columns[c].Left) / 2
                    : 0;
                double end = c + 1 < columns.Count
                    ? (columns[c].Right + columns[c + 1].Left) / 2
                    : double.MaxValue;
                colBounds.Add((start, end));
            }

            // Step 4b: Refine Code→Description boundary using actual data positions.
            // Header positions may not match data positions (description data often starts
            // right after the code value, before where the "Item Name" header is positioned).
            if (codeColIdx >= 0 && descColIdx == codeColIdx + 1)
            {
                double maxCodeRight = 0;
                int samples = 0;
                for (int s = headerIdx + 1; s < Math.Min(headerIdx + 6, lines.Count); s++)
                {
                    if (s >= lines.Count || lines[s].Words.Count < 3) continue;
                    var lineText = lines[s].Text.ToLower().Trim();
                    if (lineText.StartsWith("total") || lineText.StartsWith("grand")) break;

                    var firstWord = lines[s].Words.OrderBy(w => w.Left).First();
                    if (Regex.IsMatch(firstWord.Text, @"^\d{3,}$"))
                    {
                        maxCodeRight = Math.Max(maxCodeRight, firstWord.Right);
                        samples++;
                    }
                }

                if (samples > 0)
                {
                    // Description starts right after the widest code value
                    colBounds[descColIdx] = (maxCodeRight + 1, colBounds[descColIdx].End);
                }
            }

            // Step 5: Parse data rows using column boundaries
            var items = new List<ParsedPOItemDto>();
            for (int i = headerIdx + 1; i < lines.Count; i++)
            {
                var lineText = lines[i].Text.ToLower().Trim();

                // Stop at totals/footer
                if (lineText.StartsWith("total") || lineText.StartsWith("sub total") ||
                    lineText.StartsWith("grand total") || lineText.StartsWith("sales tax") ||
                    lineText.StartsWith("remarks") || lineText.StartsWith("payment") ||
                    lineText.StartsWith("rupees") || lineText.StartsWith("for ") ||
                    lineText.StartsWith("et amount") || lineText.StartsWith("account code") ||
                    lineText.StartsWith("contact") || lineText.StartsWith("address") ||
                    lineText.StartsWith("telephone"))
                    break;

                if (lines[i].Words.Count < 2) continue;

                // Assign each word to a column based on its X midpoint
                var colTexts = new string[columns.Count];
                for (int c = 0; c < columns.Count; c++) colTexts[c] = "";

                foreach (var word in lines[i].Words.OrderBy(w => w.Left))
                {
                    var mid = (word.Left + word.Right) / 2;
                    for (int c = colBounds.Count - 1; c >= 0; c--)
                    {
                        if (mid >= colBounds[c].Start - 5)
                        {
                            colTexts[c] = string.IsNullOrEmpty(colTexts[c]) ? word.Text : colTexts[c] + " " + word.Text;
                            break;
                        }
                    }
                }

                var desc = descColIdx >= 0 && descColIdx < colTexts.Length ? colTexts[descColIdx].Trim() : "";
                var unit = unitColIdx >= 0 && unitColIdx < colTexts.Length ? colTexts[unitColIdx].Trim() : "";
                var qtyStr = qtyColIdx >= 0 && qtyColIdx < colTexts.Length ? colTexts[qtyColIdx].Replace(",", "").Trim() : "";
                // Keep the decimal portion — fractional UOMs (KG, Liter)
                // need it. Validation downstream rejects non-integer qty
                // for UOMs whose AllowsDecimalQuantity flag is off.

                if (!string.IsNullOrWhiteSpace(desc) && decimal.TryParse(qtyStr,
                        System.Globalization.NumberStyles.Number,
                        System.Globalization.CultureInfo.InvariantCulture,
                        out var qty) && qty > 0)
                    items.Add(new ParsedPOItemDto { Description = desc, Quantity = qty, Unit = unit });
            }

            return items;
        }

        public ParsedPODto ParsePO(string text)
        {
            var result = new ParsedPODto
            {
                RawText = text,
                Warnings = new List<string>()
            };

            if (string.IsNullOrWhiteSpace(text))
            {
                result.Warnings.Add("No text content found.");
                return result;
            }

            // Normalize line endings
            text = text.Replace("\r\n", "\n").Replace("\r", "\n");

            result.PONumber = ExtractPONumber(text);
            result.PODate = ExtractPODate(text);
            result.Items = ExtractItems(text);

            // Validation warnings
            if (string.IsNullOrEmpty(result.PONumber))
                result.Warnings.Add("Could not detect PO Number. Please enter it manually.");
            if (result.PODate == null)
                result.Warnings.Add("Could not detect PO Date. Please enter it manually.");
            if (result.Items.Count == 0)
                result.Warnings.Add("Could not detect any items. Please add items manually.");

            return result;
        }

        // Words that should never be accepted as PO numbers — these show up right
        // after "PO No" / "Purchase Order" labels when the value is on the NEXT line
        // or when the regex accidentally captures a different label.
        private static readonly HashSet<string> _invalidPoNumbers = new(StringComparer.OrdinalIgnoreCase)
        {
            "the", "to", "a", "an", "is", "in", "on", "at", "or", "and", "of", "for", "by",
            "this", "that", "with", "from", "be", "must", "shall", "will", "may", "can",
            "not", "no", "yes", "all", "any", "each", "every", "both", "such", "other",
            "customer", "vendor", "supplier", "company", "additional", "number", "order",
            "date", "total", "amount", "price", "qty", "quantity", "unit", "item", "items",
            "purchase", "invoice", "payment", "terms", "delivery", "ship", "bill",
            // Common false-positive labels that sit next to PO# labels in complex layouts
            "reference", "ref", "control", "scm", "rfq", "quotation", "contact", "person",
            "page", "print", "printed", "status", "flag", "attn", "fax", "sales", "tax",
            "approved", "new", "valid", "yes", "bank", "other", "address", "telephone",
        };

        /// <summary>
        /// Extracts the PO number from the raw text. Tries multiple patterns in order
        /// of specificity. Each candidate is validated against the known-bad list AND
        /// a structural check (must look like a real PO# — alphanumeric with optional
        /// separators, no spaces, reasonable length).
        /// </summary>
        private static string? ExtractPONumber(string text)
        {
            // Normalize: collapse whitespace within lines so "P.O. Number  21620" parses cleanly
            var normalized = text;

            // Ordered from most-specific to least-specific. The first valid match wins.
            // Each pattern captures the PO value in group 1. We require word boundaries
            // (\b) or end-of-line after the value so we don't accidentally eat the next
            // word (which was the "Reference" bug on the Soorty PDF).
            var patterns = new[]
            {
                // "P.O. Number 21620" / "P.O. Number: POGI-001-2626-0000505"
                @"P\.?\s*O\.?\s*Number\s*[:=\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/\._]*)",
                // "Purchase Order No/Number/# 12345"
                @"Purchase\s*Order\s*(?:No\.?|Number|#|Num\.?)\s*[:=\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/\._]*)",
                // "Purchase Order: POGI-001-2626-0000505"
                @"Purchase\s*Order\s*[:=]\s*([A-Za-z][A-Za-z0-9\-/\._]{2,})",
                // "P.O. # 12345" / "PO # 12345" / "PO: 12345"
                @"P\.?\s*O\.?\s*[#:]\s*([A-Za-z0-9][A-Za-z0-9\-/\._]*)",
                // "P. O. No 262445" — the compact "No." label
                @"P\.?\s*O\.?\s*No\.?\s*[:=\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/\._]*)",
                // "Order No 12345"
                @"Order\s*No\.?\s*[:=\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/\._]*)",
                // Reversed: value BEFORE the label (concatenated PDF text: "262445P. O. No")
                @"([A-Za-z0-9][A-Za-z0-9\-/\._]{3,})\s*P\.?\s*O\.?\s*No",
            };

            foreach (var pattern in patterns)
            {
                foreach (Match match in Regex.Matches(normalized, pattern, RegexOptions.IgnoreCase | RegexOptions.Multiline))
                {
                    var value = match.Groups[1].Value.Trim().TrimEnd('.', ',', ';', ':');
                    if (IsValidPONumber(value))
                        return value;
                }
            }

            return null;
        }

        /// <summary>
        /// Structural check for PO number candidates. Rejects common false positives
        /// (label words, too short / too long, pure punctuation, etc.).
        /// </summary>
        private static bool IsValidPONumber(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return false;
            if (value.Length < 2 || value.Length > 50) return false;
            if (_invalidPoNumbers.Contains(value)) return false;
            // Must contain at least one digit OR be recognizably alphanumeric.
            // Pure alphabetic strings like "Reference", "Control" would fail here.
            if (!value.Any(char.IsDigit) && value.Length < 6) return false;
            // Not just punctuation
            if (!value.Any(char.IsLetterOrDigit)) return false;
            return true;
        }

        private static DateTime? ExtractPODate(string text)
        {
            // Look for date near PO-related keywords first
            var dateContextPatterns = new[]
            {
                @"(?:P\.?\s*O\.?\s*Date|Purchase\s*Order\s*Date|Order\s*Date|Date\s*of\s*Order|Dated?)\s*[:=\-]?\s*(.{6,30})",
                // Reversed: "11-APR-26Date" (value before label in concatenated text)
                @"(\d{1,2}[\-/\.]\w{3,9}[\-/\.]\d{2,4})\s*Date\b",
            };

            foreach (var pattern in dateContextPatterns)
            {
                var match = Regex.Match(text, pattern, RegexOptions.IgnoreCase | RegexOptions.Multiline);
                if (match.Success)
                {
                    var dateStr = match.Groups[1].Value.Trim();
                    var parsed = TryParseDate(dateStr);
                    if (parsed.HasValue) return parsed;
                }
            }

            // Fallback: find any date-looking string in the first 20 lines
            var lines = text.Split('\n').Take(20);
            foreach (var line in lines)
            {
                var parsed = TryParseDate(line.Trim());
                if (parsed.HasValue) return parsed;
            }

            return null;
        }

        private static DateTime? TryParseDate(string input)
        {
            if (string.IsNullOrWhiteSpace(input)) return null;

            // Extract just the date portion (stop at newline, tab, or next label)
            var dateCandidate = Regex.Match(input, @"(\d{1,4}[\-/\.]\w{1,10}[\-/\.]\d{1,4})");
            if (dateCandidate.Success)
                input = dateCandidate.Groups[1].Value;

            // Also try "13 April 2026" or "April 13, 2026" style
            var longDate = Regex.Match(input, @"(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4})");
            if (longDate.Success)
                input = longDate.Groups[1].Value;

            var formats = new[]
            {
                "dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd", "dd-MM-yyyy", "MM-dd-yyyy",
                "dd.MM.yyyy", "MM.dd.yyyy", "yyyy.MM.dd",
                "dd-MMM-yyyy", "dd MMM yyyy", "MMM dd, yyyy", "MMMM dd, yyyy",
                "d MMMM yyyy", "dd MMMM yyyy", "MMMM d, yyyy",
                "d-MMM-yyyy", "d/MM/yyyy", "M/d/yyyy",
                // 2-digit year formats (e.g., 11-APR-26)
                "dd-MMM-yy", "d-MMM-yy", "dd/MM/yy", "MM/dd/yy", "d/M/yy",
            };

            if (DateTime.TryParseExact(input.Trim().TrimEnd('.', ','), formats,
                CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var result))
            {
                // Sanity check: date should be within a reasonable range
                if (result.Year >= 2020 && result.Year <= 2035)
                    return result;
            }

            if (DateTime.TryParse(input, CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces, out var fallback))
            {
                if (fallback.Year >= 2020 && fallback.Year <= 2035)
                    return fallback;
            }

            return null;
        }

        private static List<ParsedPOItemDto> ExtractItems(string text)
        {
            var items = new List<ParsedPOItemDto>();

            var lines = text.Split('\n')
                .Select(l => l.Trim())
                .Where(l => !string.IsNullOrWhiteSpace(l))
                .ToArray();

            // Strategy 0: Columnar format — headers appear as standalone lines
            // after their column values (common in Pakistani ERP PDFs)
            items = ParseColumnarFormat(lines);
            if (items.Count > 0) goto Cleanup;

            // Strategy 1: Row-based table with header row
            var headerIdx = FindTableHeaderIndex(lines);
            if (headerIdx >= 0)
            {
                items = ParseTableWithHeader(lines, headerIdx);
                if (items.Count == 0)
                    items = ParseTableRows(lines, headerIdx);
            }

            // Strategy 2: If no table found, look for list-style items
            if (items.Count == 0)
                items = ParseListItems(lines);

            // Strategy 3: If still nothing, try line-by-line with qty/unit detection
            if (items.Count == 0)
                items = ParseFreeformItems(lines);

        Cleanup:
            // Clean up and deduplicate
            items = items
                .Where(i => !string.IsNullOrWhiteSpace(i.Description) && i.Quantity > 0)
                .ToList();

            // Normalize units
            foreach (var item in items)
            {
                item.Unit = NormalizeUnit(item.Unit);
                item.Description = CleanDescription(item.Description);
            }

            items = FilterFalsePositiveItems(items);

            return items;
        }

        /// <summary>
        /// Detects columnar format where column values appear BEFORE their header label.
        /// Pattern: [code values...] "Code" [item names...] "Item Name" [units...] "Unit" [qtys...] "Qty"
        /// </summary>
        private static List<ParsedPOItemDto> ParseColumnarFormat(string[] lines)
        {
            // Find standalone header lines
            var headers = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            for (int i = 0; i < lines.Length; i++)
            {
                var t = lines[i].Trim();
                var lower = t.ToLower();

                if (lower == "code" && !headers.ContainsKey("Code"))
                    headers["Code"] = i;
                else if ((lower == "item name" || lower == "item description" || lower == "description" || lower == "particulars") && !headers.ContainsKey("ItemName"))
                    headers["ItemName"] = i;
                else if ((lower == "unit" || lower == "uom" || lower == "u.o.m") && !headers.ContainsKey("Unit"))
                    headers["Unit"] = i;
                else if ((lower == "qty" || lower == "quantity" || lower == "qty." || lower == "quantity.") && !headers.ContainsKey("Qty"))
                    headers["Qty"] = i;
                else if ((lower == "rate" || lower == "unit price" || lower == "price") && !headers.ContainsKey("Rate"))
                    headers["Rate"] = i;
            }

            // Need at least ItemName and Qty headers for columnar detection
            if (!headers.ContainsKey("ItemName") || !headers.ContainsKey("Qty"))
                return new List<ParsedPOItemDto>();

            // Ensure headers are in expected order: Code < ItemName < Unit < Qty
            if (headers.ContainsKey("Code") && headers["Code"] >= headers["ItemName"])
                return new List<ParsedPOItemDto>();
            if (headers.ContainsKey("Unit") && headers["Unit"] >= headers["Qty"])
                return new List<ParsedPOItemDto>();

            // Extract item names: lines between "Code" (or start-of-items) and "Item Name"
            int nameStart = headers.ContainsKey("Code") ? headers["Code"] + 1 : FindItemNameSectionStart(lines, headers["ItemName"]);
            int nameEnd = headers["ItemName"];
            var itemNames = ExtractColumnValues(lines, nameStart, nameEnd);

            if (itemNames.Count == 0) return new List<ParsedPOItemDto>();

            // Extract units: lines between "Item Name" and "Unit"
            var units = new List<string>();
            if (headers.ContainsKey("Unit") && headers["Unit"] > headers["ItemName"])
                units = ExtractColumnValues(lines, headers["ItemName"] + 1, headers["Unit"]);

            // Extract quantities: lines between "Unit" and "Qty" (or "Item Name" and "Qty" if no Unit header)
            int qtyStart = headers.ContainsKey("Unit") ? headers["Unit"] + 1 : headers["ItemName"] + 1;
            var quantities = ExtractColumnValues(lines, qtyStart, headers["Qty"]);

            // Build items by zipping columns
            var items = new List<ParsedPOItemDto>();
            for (int i = 0; i < itemNames.Count; i++)
            {
                decimal qty = 1m;
                if (i < quantities.Count)
                {
                    var qtyStr = quantities[i].Replace(",", "").Trim();
                    // Keep the decimal portion intact — fractional UOMs
                    // (KG, Liter, Carat) need it. Server-side validation
                    // rejects fractions for integer-only UOMs.
                    if (decimal.TryParse(qtyStr,
                            System.Globalization.NumberStyles.Number,
                            System.Globalization.CultureInfo.InvariantCulture,
                            out var q) && q > 0)
                        qty = q;
                }

                var unit = i < units.Count ? units[i] : "";

                if (!string.IsNullOrWhiteSpace(itemNames[i]))
                {
                    items.Add(new ParsedPOItemDto
                    {
                        Description = itemNames[i],
                        Quantity = qty,
                        Unit = unit
                    });
                }
            }

            return items;
        }

        /// <summary>
        /// Finds where the item name section starts when there's no "Code" header.
        /// Looks backward from the ItemName header to find where descriptive text begins.
        /// </summary>
        private static int FindItemNameSectionStart(string[] lines, int itemNameHeaderIdx)
        {
            // Walk backward from the ItemName header, looking for lines that aren't item-like
            for (int i = itemNameHeaderIdx - 1; i >= 0; i--)
            {
                var line = lines[i].Trim().ToLower();
                // Stop if we hit a known section boundary
                if (line.Contains("supplier") || line.Contains("date") || line.Contains("address") ||
                    line.Contains("dlv") || line.Contains("delivery") || line.Contains("store") ||
                    line.Contains("indent") || line.Contains("printed") || line.Contains("email"))
                    return i + 1;
            }
            return 0;
        }

        private static List<string> ExtractColumnValues(string[] lines, int startIdx, int endIdx)
        {
            var values = new List<string>();
            for (int i = startIdx; i < endIdx && i < lines.Length; i++)
            {
                var trimmed = lines[i].Trim();
                if (!string.IsNullOrWhiteSpace(trimmed))
                    values.Add(trimmed);
            }
            return values;
        }

        private static int FindTableHeaderIndex(string[] lines)
        {
            var headerPatterns = new[]
            {
                @"(?:s\.?no|sr\.?no|item|#)\b.*(?:desc|particular|detail|item).*(?:qty|quantity|qnty)",
                @"(?:desc|particular|detail|item).*(?:qty|quantity|qnty).*(?:unit|uom)",
                @"(?:desc|particular|detail|item).*(?:unit|uom).*(?:qty|quantity|qnty)",
                @"(?:code).*(?:item|desc).*(?:unit|uom).*(?:qty|quantity)",
                @"(?:item\s*name|description|particulars?).*(?:qty|quantity)",
                @"(?:qty|quantity).*(?:desc|particular|detail|item)",
                @"(?:s\.?no|sr\.?no|#)\b.*(?:desc|particular|detail|item)",
            };

            for (int i = 0; i < Math.Min(lines.Length, 30); i++)
            {
                var line = lines[i].ToLower();
                foreach (var pattern in headerPatterns)
                {
                    if (Regex.IsMatch(line, pattern, RegexOptions.IgnoreCase))
                        return i;
                }
            }
            return -1;
        }

        /// <summary>
        /// Parses table rows using header column positions for accurate column mapping.
        /// </summary>
        private static List<ParsedPOItemDto> ParseTableWithHeader(string[] lines, int headerIdx)
        {
            var items = new List<ParsedPOItemDto>();
            var headerLine = lines[headerIdx];

            // Split header to determine column names
            var headerParts = Regex.Split(headerLine, @"\s{2,}")
                .Select(p => p.Trim())
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .ToArray();

            if (headerParts.Length < 2) return items;

            // Map column indices by name
            int descCol = -1, qtyCol = -1, unitCol = -1;
            for (int j = 0; j < headerParts.Length; j++)
            {
                var h = headerParts[j].ToLower();
                // "unit price" is a price column, not unit
                if (h.Contains("unit price") || h.Contains("unit cost")) continue;
                if (descCol < 0 && (h.Contains("desc") || h.Contains("particular") || h.Contains("detail") ||
                    (h.Contains("item") && !h.Contains("item #") && !h.Contains("item no"))))
                    descCol = j;
                else if (qtyCol < 0 && (h.Contains("qty") || h.Contains("quantity") || h == "qnty"))
                    qtyCol = j;
                else if (unitCol < 0 && (h == "unit" || h == "uom" || h == "u.o.m"))
                    unitCol = j;
            }

            if (descCol < 0 || qtyCol < 0) return items;

            // Parse data rows using column positions
            for (int i = headerIdx + 1; i < lines.Length; i++)
            {
                var line = lines[i];
                if (IsEndOfItems(line)) break;
                if (line.Length < 3) continue;

                var parts = Regex.Split(line, @"\s{2,}")
                    .Select(p => p.Trim())
                    .Where(p => !string.IsNullOrWhiteSpace(p))
                    .ToArray();

                if (parts.Length <= Math.Max(descCol, qtyCol)) continue;

                var desc = descCol < parts.Length ? parts[descCol] : "";
                var qtyStr = qtyCol < parts.Length ? parts[qtyCol].Replace(",", "") : "0";
                var unit = unitCol >= 0 && unitCol < parts.Length ? parts[unitCol] : "";

                // Skip if desc looks like a serial number only
                if (Regex.IsMatch(desc, @"^\d{1,3}\.?$")) continue;

                if (decimal.TryParse(qtyStr,
                        System.Globalization.NumberStyles.Number,
                        System.Globalization.CultureInfo.InvariantCulture,
                        out var qty) && qty > 0 && !string.IsNullOrWhiteSpace(desc))
                    items.Add(new ParsedPOItemDto { Description = desc, Quantity = qty, Unit = unit });
            }

            return items;
        }

        private static List<ParsedPOItemDto> ParseTableRows(string[] lines, int headerIdx)
        {
            var items = new List<ParsedPOItemDto>();
            for (int i = headerIdx + 1; i < lines.Length; i++)
            {
                var line = lines[i];
                if (IsEndOfItems(line)) break;
                if (line.Length < 3) continue;

                var item = ParseSingleTableRow(line);
                if (item != null)
                    items.Add(item);
            }
            return items;
        }

        private static ParsedPOItemDto? ParseSingleTableRow(string line)
        {
            // Try to extract: [optional S.No] Description Qty Unit
            var parts = Regex.Split(line, @"\s*[\|]\s*|\t+")
                .Select(p => p.Trim())
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .ToArray();

            if (parts.Length >= 3)
            {
                var item = ParsePartsAsItem(parts);
                if (item != null) return item;
            }

            // Try splitting by 2+ spaces (column-aligned text)
            parts = Regex.Split(line, @"\s{2,}")
                .Select(p => p.Trim())
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .ToArray();

            if (parts.Length >= 3)
            {
                var item = ParsePartsAsItem(parts);
                if (item != null) return item;
            }

            // Last resort: look for embedded qty pattern in line. The qty
            // group now allows decimals so "12.5 KG" or "0.0004 Carat" round-
            // trip cleanly. Fractional qty for integer-only UOMs is rejected
            // server-side at save time.
            var qtyMatch = Regex.Match(line, @"(\d+(?:\.\d+)?)\s*(pcs|nos|kg|kgs|sets?|meters?|mtrs?|ltrs?|pieces?|numbers?|bags?|rolls?|pairs?|boxes?|cartons?|bottles?|units?|each|pc)\b", RegexOptions.IgnoreCase);
            if (qtyMatch.Success)
            {
                var qty = decimal.Parse(qtyMatch.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
                var unit = qtyMatch.Groups[2].Value;
                var desc = line.Substring(0, qtyMatch.Index).Trim();
                desc = Regex.Replace(desc, @"^\d+[\.\)\-\s]+", "").Trim();
                if (!string.IsNullOrWhiteSpace(desc) && qty > 0)
                    return new ParsedPOItemDto { Description = desc, Quantity = qty, Unit = unit };
            }

            return null;
        }

        private static ParsedPOItemDto? ParsePartsAsItem(string[] parts)
        {
            // Skip serial number if first part is just a small number
            int startIdx = 0;
            if (parts.Length > 3 && Regex.IsMatch(parts[0], @"^\d{1,3}\.?$"))
                startIdx = 1;

            // Find which parts are qty (numeric) and which are unit
            int qtyIdx = -1, unitIdx = -1;
            for (int j = startIdx; j < parts.Length; j++)
            {
                // Skip large numbers that look like codes (8+ digits).
                // Allow decimal quantities like "12.5" — the regex matches
                // an optional .digits tail.
                if (qtyIdx < 0 && Regex.IsMatch(parts[j], @"^\d+(?:\.\d+)?$") && parts[j].Length <= 8)
                {
                    var val = decimal.Parse(parts[j], System.Globalization.CultureInfo.InvariantCulture);
                    if (val > 0 && val <= 999999)
                        qtyIdx = j;
                }
                else if (qtyIdx >= 0 && unitIdx < 0 && IsUnitLike(parts[j]))
                    unitIdx = j;
            }

            if (qtyIdx > startIdx)
            {
                var descParts = parts.Skip(startIdx).Take(qtyIdx - startIdx);
                var desc = string.Join(" ", descParts).Trim();
                var qty = decimal.TryParse(parts[qtyIdx],
                    System.Globalization.NumberStyles.Number,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var q) ? q : 0m;
                var unit = unitIdx >= 0 ? parts[unitIdx] : "";

                if (!string.IsNullOrWhiteSpace(desc) && qty > 0)
                    return new ParsedPOItemDto { Description = desc, Quantity = qty, Unit = unit };
            }

            // Fallback: last numeric part = qty (decimal-aware so "12.5"
            // is accepted; integer-only validation happens server-side).
            if (parts.Length >= 2)
            {
                for (int j = parts.Length - 1; j >= startIdx + 1; j--)
                {
                    if (decimal.TryParse(parts[j],
                            System.Globalization.NumberStyles.Number,
                            System.Globalization.CultureInfo.InvariantCulture,
                            out var qty) && qty > 0 && parts[j].Length <= 8)
                    {
                        var descParts = parts.Skip(startIdx).Take(j - startIdx);
                        var unit = (j + 1 < parts.Length && IsUnitLike(parts[j + 1])) ? parts[j + 1] : "";
                        var desc = string.Join(" ", descParts).Trim();
                        if (!string.IsNullOrWhiteSpace(desc))
                            return new ParsedPOItemDto { Description = desc, Quantity = qty, Unit = unit };
                    }
                }
            }

            return null;
        }

        private static List<ParsedPOItemDto> ParseListItems(string[] lines)
        {
            var items = new List<ParsedPOItemDto>();

            foreach (var line in lines)
            {
                if (!Regex.IsMatch(line, @"^[\d\-\•\*\►\→]")) continue;
                if (IsEndOfItems(line)) break;

                var clean = Regex.Replace(line, @"^[\d]+[\.\)\-\s]+|^[\-\•\*\►\→]\s*", "").Trim();
                if (string.IsNullOrWhiteSpace(clean)) continue;

                var match = Regex.Match(clean, @"(\d+(?:\.\d+)?)\s*(pcs|nos|kg|kgs|sets?|meters?|mtrs?|ltrs?|pieces?|numbers?|bags?|rolls?|pairs?|boxes?|cartons?|bottles?|units?|each|pc)[\.\s,]*(.+)?", RegexOptions.IgnoreCase);
                if (match.Success)
                {
                    var qty = decimal.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
                    var unit = match.Groups[2].Value;
                    var desc = match.Groups[3].Value.Trim();
                    if (string.IsNullOrWhiteSpace(desc))
                        desc = clean.Substring(0, match.Index).Trim();
                    if (!string.IsNullOrWhiteSpace(desc) && qty > 0)
                        items.Add(new ParsedPOItemDto { Description = desc, Quantity = qty, Unit = unit });
                    continue;
                }

                match = Regex.Match(clean, @"(.+?)[\s\-–]+(\d+(?:\.\d+)?)\s*(pcs|nos|kg|kgs|sets?|meters?|mtrs?|ltrs?|pieces?|numbers?|bags?|rolls?|pairs?|boxes?|cartons?|bottles?|units?|each|pc)?", RegexOptions.IgnoreCase);
                if (match.Success && decimal.TryParse(match.Groups[2].Value,
                        System.Globalization.NumberStyles.Number,
                        System.Globalization.CultureInfo.InvariantCulture,
                        out var q2) && q2 > 0)
                {
                    items.Add(new ParsedPOItemDto
                    {
                        Description = match.Groups[1].Value.Trim(),
                        Quantity = q2,
                        Unit = match.Groups[3].Value
                    });
                }
            }

            return items;
        }

        private static List<ParsedPOItemDto> ParseFreeformItems(string[] lines)
        {
            var items = new List<ParsedPOItemDto>();
            bool inItemSection = false;

            foreach (var line in lines)
            {
                var lower = line.ToLower();
                if (lower.Contains("please supply") || lower.Contains("following items") ||
                    lower.Contains("item list") || lower.Contains("order details") ||
                    lower.Contains("bill of material"))
                {
                    inItemSection = true;
                    continue;
                }

                if (IsEndOfItems(line)) inItemSection = false;
                if (!inItemSection) continue;

                var match = Regex.Match(line, @"(\d+(?:\.\d+)?)\s*(pcs|nos|kg|kgs|sets?|meters?|mtrs?|ltrs?|pieces?|numbers?|bags?|rolls?|pairs?|boxes?|cartons?|bottles?|units?|each|pc)[\s\-–,]*(.+)", RegexOptions.IgnoreCase);
                if (match.Success)
                {
                    var qty = decimal.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
                    var unit = match.Groups[2].Value;
                    var desc = match.Groups[3].Value.Trim();
                    if (!string.IsNullOrWhiteSpace(desc) && qty > 0)
                        items.Add(new ParsedPOItemDto { Description = desc, Quantity = qty, Unit = unit });
                }
            }

            return items;
        }

        private static bool IsEndOfItems(string line)
        {
            var lower = line.ToLower().Trim();
            return lower.StartsWith("total") || lower.StartsWith("sub total") || lower.StartsWith("subtotal") ||
                   lower.StartsWith("grand total") || lower.StartsWith("terms") || lower.StartsWith("note:") ||
                   lower.StartsWith("notes:") || lower.StartsWith("delivery") || lower.StartsWith("payment") ||
                   lower.StartsWith("signature") || lower.StartsWith("authorized") || lower.StartsWith("stamp") ||
                   lower.StartsWith("thank") || lower.StartsWith("regards") ||
                   lower.StartsWith("account code") || lower.StartsWith("contact") ||
                   lower.StartsWith("address") || lower.StartsWith("telephone") ||
                   lower.StartsWith("sales tax amount") || lower.StartsWith("rupees");
        }

        private static bool IsUnitLike(string s)
        {
            var lower = s.ToLower().Trim().TrimEnd('.');
            var units = new HashSet<string> { "pcs", "pc", "nos", "kg", "kgs", "set", "sets", "meter", "meters",
                "mtr", "mtrs", "ltr", "ltrs", "piece", "pieces", "number", "numbers", "bag", "bags",
                "roll", "rolls", "pair", "pairs", "box", "boxes", "carton", "cartons", "bottle", "bottles",
                "unit", "units", "each", "ea", "ton", "tons", "ft", "feet", "inch", "inches", "mm", "cm",
                "m", "lbs", "gm", "gms", "gram", "grams", "litre", "litres", "liter", "liters",
                "dozen", "dzn", "bundle", "bundles", "packet", "packets", "pkt", "pkts", "ream", "reams",
                "sqft", "sqm", "rft", "cft", "nos.", "pcs.", "mtr.", "kg." };
            return units.Contains(lower);
        }

        private static string NormalizeUnit(string unit)
        {
            if (string.IsNullOrWhiteSpace(unit)) return "Pcs";
            var lower = unit.ToLower().Trim().TrimEnd('.');
            return lower switch
            {
                "piece" or "pieces" or "pcs" or "pc" => "Pcs",
                "number" or "numbers" or "nos" or "no" => "Nos",
                "kg" or "kgs" or "kilogram" or "kilograms" => "Kg",
                "set" or "sets" => "Set",
                "meter" or "meters" or "mtr" or "mtrs" or "m" => "Mtr",
                "ltr" or "ltrs" or "liter" or "liters" or "litre" or "litres" => "Ltr",
                "bag" or "bags" => "Bags",
                "roll" or "rolls" => "Rolls",
                "pair" or "pairs" => "Pairs",
                "box" or "boxes" => "Box",
                "each" or "ea" => "Each",
                "ton" or "tons" => "Ton",
                "ft" or "feet" => "Ft",
                "inch" or "inches" => "Inch",
                "dozen" or "dzn" => "Dozen",
                "bundle" or "bundles" => "Bundle",
                "packet" or "packets" or "pkt" or "pkts" => "Pkt",
                _ => CultureInfo.CurrentCulture.TextInfo.ToTitleCase(lower)
            };
        }

        private static string CleanDescription(string desc)
        {
            desc = Regex.Replace(desc, @"\s+", " ").Trim();
            desc = desc.TrimEnd(',', '.', ';', ':', '-', '–');
            desc = Regex.Replace(desc, @"^[\-\*\•]\s*", "");
            return desc.Trim();
        }

        /// <summary>
        /// Removes false positive items that look like body text, addresses, or legal clauses.
        /// </summary>
        private static List<ParsedPOItemDto> FilterFalsePositiveItems(List<ParsedPOItemDto> items)
        {
            return items.Where(item =>
            {
                var desc = item.Description.Trim();

                // Too short (single word like "of", "Net", "PC")
                if (desc.Length < 3) return false;

                // Too long — real item descriptions rarely exceed 120 chars
                if (desc.Length > 120) return false;

                // Looks like a sentence (legal text, body paragraphs) — has too many words
                var wordCount = desc.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
                if (wordCount > 15) return false;

                // Starts with common legal/body text markers
                var lower = desc.ToLower();
                if (lower.StartsWith("in the event") || lower.StartsWith("in case of") ||
                    lower.StartsWith("the service") || lower.StartsWith("the supplier") ||
                    lower.StartsWith("the contractor") || lower.StartsWith("iom shall") ||
                    lower.StartsWith("divide the") || lower.StartsWith("this purchase") ||
                    lower.StartsWith("net ") || lower.StartsWith("attention") ||
                    lower.StartsWith("*purchase order") || lower == "of" ||
                    lower.Contains("indicating that") || lower.Contains("payment is due") ||
                    lower.Contains("all aspects of"))
                    return false;

                // Contains legal/clause keywords strongly
                if (Regex.IsMatch(lower, @"\b(shall|hereby|notwithstanding|pursuant|hereunder|thereof|arbitration|conciliation|paragraphs?)\b"))
                    return false;

                // Address patterns (e.g., "14 St. NW", "123 Main St", "14th Street N.W.")
                if (Regex.IsMatch(desc, @"^\d+\w*\s+(St|Ave|Rd|Blvd|Dr|Ln|Way|Street|Avenue|Road)\b", RegexOptions.IgnoreCase))
                    return false;

                // Pure numbers (e.g., "123") — not a valid description
                if (Regex.IsMatch(desc, @"^\d+$"))
                    return false;

                // Quantity sanity: reject unrealistically large quantities (>100,000)
                if (item.Quantity > 100000) return false;

                return true;
            }).ToList();
        }
    }
}
