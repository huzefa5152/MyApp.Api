using System.Globalization;
using System.Text.RegularExpressions;
using ClosedXML.Excel;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Processes an Excel template file by replacing {{mergeField}} placeholders with actual data.
    /// Supports simple field replacement and {{#each items}}...{{/each}} row duplication.
    /// </summary>
    public static class ExcelTemplateEngine
    {
        private static readonly Regex FieldRegex = new(@"\{\{([^}]+)\}\}", RegexOptions.Compiled);
        private static readonly Regex EachStartRegex = new(@"\{\{#each\s+(\w+)(?:\s+(\d+))?\}\}", RegexOptions.Compiled);
        private static readonly Regex EachEndRegex = new(@"\{\{/each\}\}", RegexOptions.Compiled);

        /// <summary>
        /// Process the template workbook in-place, replacing merge fields with values from the data dictionary.
        /// </summary>
        public static void Process(XLWorkbook workbook, Dictionary<string, object?> data)
        {
            // Excel templates edited in LibreOffice / older Excel builds sometimes
            // leave behind "defined names" (named ranges) with empty or malformed
            // RefersTo formulas. On any row shift (#each expansion / deletion)
            // ClosedXML re-parses every defined name to update its formula — and
            // an empty formula crashes the parser with:
            //     "Error at char 0 of '': Unexpected token EofSymbolId"
            // Remove those before we touch any rows.
            RemoveBrokenDefinedNames(workbook);

            foreach (var ws in workbook.Worksheets)
            {
                ProcessEachBlocks(ws, data);
                ReplaceSimpleFields(ws, data);
            }
        }

        /// <summary>
        /// Drop any defined name (workbook-level or sheet-level) whose RefersTo
        /// formula is null / empty / not parseable. Without this, ClosedXML's
        /// FormulaParser throws on the first row delete and aborts the whole
        /// export. Safe because these names weren't resolving to anything
        /// anyway — removing them is a no-op for template rendering.
        /// </summary>
        private static void RemoveBrokenDefinedNames(XLWorkbook workbook)
        {
            // Collect first, then remove — mutating while enumerating would throw.
            var toRemoveWorkbook = new List<string>();
            foreach (var dn in workbook.DefinedNames)
            {
                if (IsBrokenRefersTo(dn))
                    toRemoveWorkbook.Add(dn.Name);
            }
            foreach (var name in toRemoveWorkbook)
            {
                try { workbook.DefinedNames.Delete(name); } catch { /* best effort */ }
            }

            foreach (var ws in workbook.Worksheets)
            {
                var toRemoveSheet = new List<string>();
                foreach (var dn in ws.DefinedNames)
                {
                    if (IsBrokenRefersTo(dn))
                        toRemoveSheet.Add(dn.Name);
                }
                foreach (var name in toRemoveSheet)
                {
                    try { ws.DefinedNames.Delete(name); } catch { /* best effort */ }
                }
            }
        }

        private static bool IsBrokenRefersTo(IXLDefinedName dn)
        {
            string? formula = null;
            try { formula = dn.RefersTo; }
            catch { return true; }  // even reading the property threw → definitely broken

            if (string.IsNullOrWhiteSpace(formula)) return true;
            var trimmed = formula.TrimStart('=').Trim();
            if (string.IsNullOrEmpty(trimmed)) return true;

            // #REF! means the formula pointed at cells that have since been
            // deleted. It's "valid" to read but when ClosedXML tries to shift
            // it during a row operation the transformer may emit "" and crash.
            // Same for #NAME? / #VALUE! / any error literal.
            // Real-world trigger: template opened + edited in LibreOffice where
            // someone deleted a range whose name they didn't clean up.
            if (trimmed == "#REF!" || trimmed.Contains("#REF!")) return true;
            if (trimmed.StartsWith("#") && trimmed.EndsWith("!")) return true;  // generic #ERROR!

            return false;
        }

        private static void ProcessEachBlocks(IXLWorksheet ws, Dictionary<string, object?> data)
        {
            // Scan for {{#each items}} markers — process from bottom to top to keep row indices stable
            var eachBlocks = new List<(int startRow, int endRow, string collectionName, int minRows)>();

            int lastRow = ws.LastRowUsed()?.RowNumber() ?? 0;
            for (int r = 1; r <= lastRow; r++)
            {
                var rowText = GetRowText(ws, r);
                var match = EachStartRegex.Match(rowText);
                if (match.Success)
                {
                    string collectionName = match.Groups[1].Value;
                    int minRows = match.Groups[2].Success ? int.Parse(match.Groups[2].Value) : 0;
                    // Find the matching {{/each}}
                    for (int e = r + 1; e <= lastRow; e++)
                    {
                        if (EachEndRegex.IsMatch(GetRowText(ws, e)))
                        {
                            eachBlocks.Add((r, e, collectionName, minRows));
                            break;
                        }
                    }
                }
            }

            // Process from bottom to top
            eachBlocks.Reverse();
            foreach (var (startRow, endRow, collectionName, minRows) in eachBlocks)
            {
                var items = GetCollection(data, collectionName);
                int templateRowCount = endRow - startRow - 1; // rows between #each and /each

                if (templateRowCount <= 0)
                {
                    DeleteRows(ws, startRow, endRow - startRow + 1);
                    continue;
                }

                // Determine total rows: max of item count and minRows
                int totalItemRows = Math.Max(items.Count, minRows);

                // Collect template rows (between #each and /each markers)
                int firstTemplateRow = startRow + 1;

                // Calculate how many rows to insert: (totalItemRows * templateRowCount) - templateRowCount
                int totalNewRows = totalItemRows * templateRowCount;
                int rowsToInsert = totalNewRows - templateRowCount;

                // Delete the {{/each}} marker row first
                DeleteRows(ws, endRow, 1);

                // Delete the {{#each}} marker row
                DeleteRows(ws, startRow, 1);

                // Now template rows start at 'startRow' (shifted up by 1 after deleting #each row)
                int templateStart = startRow;

                // Insert additional rows if needed
                if (rowsToInsert > 0)
                {
                    int insertAt = templateStart + templateRowCount;
                    ws.Row(insertAt).InsertRowsAbove(rowsToInsert);

                    // Copy template row formatting and merged cells to all rows (items + empty)
                    for (int itemIdx = 1; itemIdx < totalItemRows; itemIdx++)
                    {
                        int destStart = templateStart + (itemIdx * templateRowCount);
                        for (int tr = 0; tr < templateRowCount; tr++)
                        {
                            int srcRow = templateStart + tr;
                            int destRow = destStart + tr;
                            CopyRow(ws, srcRow, destRow);
                        }
                    }
                }

                // Fill in data for actual items
                for (int itemIdx = 0; itemIdx < items.Count; itemIdx++)
                {
                    var itemData = items[itemIdx];
                    int blockStart = templateStart + (itemIdx * templateRowCount);
                    for (int tr = 0; tr < templateRowCount; tr++)
                    {
                        int row = blockStart + tr;
                        ReplaceFieldsInRow(ws, row, itemData, itemIdx + 1);
                    }
                }

                // Clear merge field placeholders from empty rows (beyond actual items)
                for (int itemIdx = items.Count; itemIdx < totalItemRows; itemIdx++)
                {
                    int blockStart = templateStart + (itemIdx * templateRowCount);
                    for (int tr = 0; tr < templateRowCount; tr++)
                    {
                        int row = blockStart + tr;
                        ClearFieldsInRow(ws, row);
                    }
                }
            }
        }

        private static void ReplaceSimpleFields(IXLWorksheet ws, Dictionary<string, object?> data)
        {
            int lastRow = ws.LastRowUsed()?.RowNumber() ?? 0;
            int lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 0;

            for (int r = 1; r <= lastRow; r++)
            {
                for (int c = 1; c <= lastCol; c++)
                {
                    var cell = ws.Cell(r, c);
                    if (cell.HasFormula) continue;

                    var val = cell.GetString();
                    if (string.IsNullOrEmpty(val) || !val.Contains("{{")) continue;

                    var replaced = FieldRegex.Replace(val, m =>
                    {
                        string expr = m.Groups[1].Value.Trim();
                        return ResolveExpression(expr, data, 0);
                    });

                    SetCellValue(cell, replaced, val);
                }
            }
        }

        private static void ReplaceFieldsInRow(IXLWorksheet ws, int row, Dictionary<string, object?> itemData, int index)
        {
            int lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 0;
            for (int c = 1; c <= lastCol; c++)
            {
                var cell = ws.Cell(row, c);
                if (cell.HasFormula) continue;

                var val = cell.GetString();
                if (string.IsNullOrEmpty(val) || !val.Contains("{{")) continue;

                var replaced = FieldRegex.Replace(val, m =>
                {
                    string expr = m.Groups[1].Value.Trim();
                    return ResolveExpression(expr, itemData, index);
                });

                SetCellValue(cell, replaced, val);
            }
        }

        private static string ResolveExpression(string expr, Dictionary<string, object?> data, int index)
        {
            // Handle @index
            if (expr == "@index") return index.ToString();

            // Handle this.fieldName or just fieldName
            string key = expr.StartsWith("this.") ? expr[5..] : expr;

            // Handle format helpers: fmt, fmtDec, fmtDate, join, joinDates
            if (key.StartsWith("fmt ") || key.StartsWith("fmtDec "))
            {
                string innerKey = key.Contains(' ') ? key[(key.IndexOf(' ') + 1)..].Trim() : key;
                if (data.TryGetValue(innerKey, out var numVal) && numVal != null)
                {
                    if (decimal.TryParse(numVal.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d))
                        return d.ToString(key.StartsWith("fmtDec") ? "#,##0.00" : "#,##0");
                }
                return "0";
            }

            if (key.StartsWith("fmtDate "))
            {
                string innerKey = key[8..].Trim();
                if (data.TryGetValue(innerKey, out var dateVal) && dateVal != null)
                {
                    if (DateTime.TryParse(dateVal.ToString(), out var dt))
                        return dt.ToString("dd/MM/yyyy");
                }
                return "";
            }

            if (key.StartsWith("join "))
            {
                string innerKey = key[5..].Trim();
                if (data.TryGetValue(innerKey, out var listVal) && listVal is List<object?> list)
                    return string.Join(", ", list.Where(x => x != null));
                return "";
            }

            if (key.StartsWith("joinDates "))
            {
                string innerKey = key[10..].Trim();
                if (data.TryGetValue(innerKey, out var listVal) && listVal is List<object?> list)
                {
                    var dates = list
                        .Where(x => x != null && DateTime.TryParse(x.ToString(), out _))
                        .Select(x => DateTime.Parse(x!.ToString()!).ToString("dd/MM/yyyy"));
                    return string.Join(", ", dates);
                }
                return "";
            }

            if (key.StartsWith("formatCurrency "))
            {
                string innerKey = key[15..].Trim();
                if (data.TryGetValue(innerKey, out var numVal) && numVal != null)
                {
                    if (decimal.TryParse(numVal.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d))
                        return d.ToString("#,##0.00");
                }
                return "0.00";
            }

            // Simple field lookup
            if (data.TryGetValue(key, out var value) && value != null)
            {
                // If it's a date, format it
                if (value is DateTime dt)
                    return dt.ToString("dd/MM/yyyy");
                return value.ToString() ?? "";
            }

            return "";
        }

        private static void SetCellValue(IXLCell cell, string newValue, string originalValue)
        {
            // If the entire cell was a single merge field and the result looks numeric, set as number
            if (originalValue.Trim().StartsWith("{{") && originalValue.Trim().EndsWith("}}") &&
                originalValue.Count(c => c == '{') == 2)
            {
                if (decimal.TryParse(newValue, NumberStyles.Any, CultureInfo.InvariantCulture, out var d))
                {
                    // If the cell is formatted as percentage, divide by 100 so 18 becomes 0.18 (displayed as 18%)
                    var fmt = cell.Style.NumberFormat.Format ?? "";
                    int fmtId = cell.Style.NumberFormat.NumberFormatId;
                    bool isPercent = fmt.Contains('%') || fmtId == 9 || fmtId == 10;
                    if (isPercent)
                        d /= 100m;
                    cell.Value = d;
                    return;
                }
                if (DateTime.TryParse(newValue, out var dt))
                {
                    cell.Value = dt;
                    cell.Style.DateFormat.Format = "dd/MM/yyyy";
                    return;
                }
            }

            cell.Value = newValue;
        }

        private static List<Dictionary<string, object?>> GetCollection(Dictionary<string, object?> data, string name)
        {
            if (data.TryGetValue(name, out var val) && val is List<Dictionary<string, object?>> list)
                return list;
            return new List<Dictionary<string, object?>>();
        }

        private static string GetRowText(IXLWorksheet ws, int row)
        {
            int lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 0;
            var texts = new List<string>();
            for (int c = 1; c <= lastCol; c++)
            {
                var v = ws.Cell(row, c).GetString();
                if (!string.IsNullOrEmpty(v)) texts.Add(v);
            }
            return string.Join(" ", texts);
        }

        private static void CopyRow(IXLWorksheet ws, int srcRow, int destRow)
        {
            int lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 0;
            var srcR = ws.Row(srcRow);
            var destR = ws.Row(destRow);

            destR.Height = srcR.Height;

            for (int c = 1; c <= lastCol; c++)
            {
                var src = ws.Cell(srcRow, c);
                var dest = ws.Cell(destRow, c);
                dest.Value = src.Value;
                dest.Style = src.Style;
            }

            // Copy merged ranges that intersect the source row
            var mergedRanges = ws.MergedRanges
                .Where(mr => mr.FirstRow().RowNumber() == srcRow && mr.LastRow().RowNumber() == srcRow)
                .ToList();

            foreach (var mr in mergedRanges)
            {
                int fc = mr.FirstColumn().ColumnNumber();
                int lc = mr.LastColumn().ColumnNumber();

                // Save edge borders from source before merge overwrites them
                var srcFirstBorder = ws.Cell(srcRow, fc).Style.Border;
                var srcLastBorder = ws.Cell(srcRow, lc).Style.Border;

                var destRange = ws.Range(destRow, fc, destRow, lc);
                try { destRange.Merge(); } catch { }

                // Set outside border on the range itself
                destRange.Style.Border.TopBorder = srcFirstBorder.TopBorder;
                destRange.Style.Border.TopBorderColor = srcFirstBorder.TopBorderColor;
                destRange.Style.Border.BottomBorder = srcFirstBorder.BottomBorder;
                destRange.Style.Border.BottomBorderColor = srcFirstBorder.BottomBorderColor;
                destRange.Style.Border.LeftBorder = srcFirstBorder.LeftBorder;
                destRange.Style.Border.LeftBorderColor = srcFirstBorder.LeftBorderColor;
                destRange.Style.Border.RightBorder = srcLastBorder.RightBorder;
                destRange.Style.Border.RightBorderColor = srcLastBorder.RightBorderColor;

                // Also set right border directly on the last cell (Excel reads it from there for merged ranges)
                var destLast = ws.Cell(destRow, lc);
                destLast.Style.Border.RightBorder = srcLastBorder.RightBorder;
                destLast.Style.Border.RightBorderColor = srcLastBorder.RightBorderColor;
            }
        }

        private static void ClearFieldsInRow(IXLWorksheet ws, int row)
        {
            int lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 0;
            for (int c = 1; c <= lastCol; c++)
            {
                var cell = ws.Cell(row, c);
                if (cell.HasFormula) continue;
                var val = cell.GetString();
                if (!string.IsNullOrEmpty(val) && val.Contains("{{"))
                {
                    cell.Value = "";
                }
            }
        }

        private static void DeleteRows(IXLWorksheet ws, int startRow, int count)
        {
            for (int i = 0; i < count; i++)
            {
                ws.Row(startRow).Delete();
            }
        }

        /// <summary>
        /// Convert a PrintChallanDto to a flat dictionary for template processing.
        /// </summary>
        public static Dictionary<string, object?> ChallanToDict(DTOs.PrintChallanDto dto)
        {
            var d = new Dictionary<string, object?>
            {
                ["companyBrandName"] = dto.CompanyBrandName,
                ["companyLogoPath"] = dto.CompanyLogoPath,
                ["companyAddress"] = dto.CompanyAddress,
                ["companyPhone"] = dto.CompanyPhone,
                ["challanNumber"] = dto.ChallanNumber,
                ["deliveryDate"] = dto.DeliveryDate,
                ["clientName"] = dto.ClientName,
                ["clientAddress"] = dto.ClientAddress,
                ["clientSite"] = dto.ClientSite,
                ["poNumber"] = dto.PoNumber,
                ["poDate"] = dto.PoDate,
                ["itemCount"] = dto.Items.Count,
            };

            d["items"] = dto.Items.Select((item, idx) => new Dictionary<string, object?>
            {
                ["sNo"] = idx + 1,
                ["quantity"] = item.Quantity,
                ["description"] = item.Description,
                ["unit"] = item.Unit,
            }).Cast<Dictionary<string, object?>>().ToList();

            return d;
        }

        /// <summary>
        /// Convert a PrintBillDto to a flat dictionary for template processing.
        /// </summary>
        public static Dictionary<string, object?> BillToDict(DTOs.PrintBillDto dto)
        {
            var d = new Dictionary<string, object?>
            {
                ["companyBrandName"] = dto.CompanyBrandName,
                ["companyLogoPath"] = dto.CompanyLogoPath,
                ["companyAddress"] = dto.CompanyAddress,
                ["companyPhone"] = dto.CompanyPhone,
                ["companyNTN"] = dto.CompanyNTN,
                ["companySTRN"] = dto.CompanySTRN,
                ["invoiceNumber"] = dto.InvoiceNumber,
                ["date"] = dto.Date,
                ["challanNumbers"] = dto.ChallanNumbers.Cast<object?>().ToList(),
                ["challanDates"] = dto.ChallanDates.Cast<object?>().ToList(),
                ["poNumber"] = dto.PoNumber,
                ["poDate"] = dto.PoDate,
                ["clientName"] = dto.ClientName,
                ["clientAddress"] = dto.ClientAddress,
                ["concernDepartment"] = dto.ConcernDepartment,
                ["clientNTN"] = dto.ClientNTN,
                ["clientSTRN"] = dto.ClientSTRN,
                ["subtotal"] = dto.Subtotal,
                ["gstRate"] = dto.GSTRate,
                ["gstAmount"] = dto.GSTAmount,
                ["grandTotal"] = dto.GrandTotal,
                ["amountInWords"] = dto.AmountInWords,
                ["paymentTerms"] = dto.PaymentTerms,
                ["itemCount"] = dto.Items.Count,
            };

            d["items"] = dto.Items.Select(item => new Dictionary<string, object?>
            {
                ["sNo"] = item.SNo,
                ["itemTypeName"] = item.ItemTypeName,
                ["description"] = item.Description,
                ["quantity"] = item.Quantity,
                ["uom"] = item.UOM,
                ["unitPrice"] = item.UnitPrice,
                ["lineTotal"] = item.LineTotal,
            }).Cast<Dictionary<string, object?>>().ToList();

            return d;
        }

        /// <summary>
        /// Convert a PrintTaxInvoiceDto to a flat dictionary for template processing.
        /// </summary>
        public static Dictionary<string, object?> TaxInvoiceToDict(DTOs.PrintTaxInvoiceDto dto)
        {
            var d = new Dictionary<string, object?>
            {
                ["supplierName"] = dto.SupplierName,
                ["supplierAddress"] = dto.SupplierAddress,
                ["supplierNTN"] = dto.SupplierNTN,
                ["supplierSTRN"] = dto.SupplierSTRN,
                ["supplierPhone"] = dto.SupplierPhone,
                ["supplierLogoPath"] = dto.SupplierLogoPath,
                ["buyerName"] = dto.BuyerName,
                ["buyerAddress"] = dto.BuyerAddress,
                ["buyerPhone"] = dto.BuyerPhone,
                ["buyerNTN"] = dto.BuyerNTN,
                ["buyerSTRN"] = dto.BuyerSTRN,
                ["invoiceNumber"] = dto.InvoiceNumber,
                ["date"] = dto.Date,
                ["challanNumbers"] = dto.ChallanNumbers.Cast<object?>().ToList(),
                ["poNumber"] = dto.PoNumber,
                ["subtotal"] = dto.Subtotal,
                ["gstRate"] = dto.GSTRate,
                ["gstAmount"] = dto.GSTAmount,
                ["grandTotal"] = dto.GrandTotal,
                ["amountInWords"] = dto.AmountInWords,
                ["itemCount"] = dto.Items.Count,
            };

            d["items"] = dto.Items.Select((item, idx) => new Dictionary<string, object?>
            {
                ["sNo"] = idx + 1,
                ["itemTypeName"] = item.ItemTypeName,
                ["quantity"] = item.Quantity,
                ["uom"] = item.UOM,
                ["description"] = item.Description,
                ["valueExclTax"] = item.ValueExclTax,
                ["gstRate"] = item.GSTRate,
                ["gstAmount"] = item.GSTAmount,
                ["totalInclTax"] = item.TotalInclTax,
            }).Cast<Dictionary<string, object?>>().ToList();

            return d;
        }
    }
}
