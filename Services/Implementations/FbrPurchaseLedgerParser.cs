using System.Globalization;
using NPOI.HSSF.UserModel;
using NPOI.SS.UserModel;
using NPOI.XSSF.UserModel;

namespace MyApp.Api.Services.Implementations
{
    // ── FBR Purchase Ledger Parser ──────────────────────────────────────
    //
    // Reads FBR Annexure-A xls/xlsx files (the "Sales Ledger" export from
    // IRIS — sales from the supplier's perspective = purchases from ours)
    // into typed records. Header columns are matched BY NAME, not by
    // index, so FBR can rearrange or insert columns without breaking us.
    //
    // Concerns it owns:
    //   • opening NPOI workbook (.xls = HSSF, .xlsx = XSSF)
    //   • finding the "Domestic Invoices" sheet (or first sheet as fallback)
    //   • building header → column-index map from row 0
    //   • parsing each data row into FbrPurchaseLedgerRow
    //   • emitting per-row warnings for unparseable cells (still yields
    //     the row with whatever it could read; the filter decides whether
    //     to mark it failed-validation)
    //
    // Concerns it does NOT own (kept in the filter / matcher layers):
    //   • deciding whether to skip a row on Status / HS Code / etc.
    //   • dedup against existing PurchaseBills
    //   • product matching by HS Code or description
    //
    // Single source of truth for column-name strings is the static
    // KnownHeaders dictionary below — change once if FBR ever renames.

    /// <summary>
    /// One parsed row from the FBR Annexure-A spreadsheet. All fields
    /// are nullable because FBR doesn't fill every column for every row
    /// (POS rows skip HS Code, contested rows fill Reason, etc.).
    /// </summary>
    public class FbrPurchaseLedgerRow
    {
        public int SourceRowNumber { get; set; }   // 1-based, matching Excel's row number

        public string? FbrInvoiceRefNo { get; set; }
        public string? Status { get; set; }
        public string? SellerReturnStatus { get; set; }
        public string? InvoiceNo { get; set; }
        public string? InvoiceType { get; set; }
        public DateTime? InvoiceDate { get; set; }
        public string? SellerNtn { get; set; }
        public string? SellerName { get; set; }
        // FBR's "Taxpayer Type" — Registered / Unregistered. The seller's
        // FBR registration status. Unregistered sellers carry the
        // placeholder NTN 9999999999999 and aren't input-tax-claimable,
        // so we filter them out at import time.
        public string? TaxpayerType { get; set; }
        public string? SaleType { get; set; }
        public decimal? Quantity { get; set; }
        public string? ProductDescription { get; set; }
        public string? HsCode { get; set; }
        public decimal? Rate { get; set; }            // 0.18 for "18%"
        public string? Uom { get; set; }
        public decimal? ValueExclTax { get; set; }
        public decimal? SalesTax { get; set; }
        public decimal? ExtraTax { get; set; }
        public decimal? StWithheldAtSource { get; set; }
        public decimal? FurtherTax { get; set; }
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
        public decimal? TotalValueOfSales { get; set; }
        public string? SroScheduleNo { get; set; }
        public string? ItemSerialNo { get; set; }

        // Per-row warnings raised during parsing (e.g. unparseable date,
        // unparseable quantity). The filter promotes these to the
        // failed-validation decision.
        public List<string> ParseWarnings { get; set; } = new();
    }

    /// <summary>
    /// Result of parsing a whole workbook.
    /// </summary>
    public class FbrPurchaseLedgerParseResult
    {
        public string FileName { get; set; } = "";
        public List<FbrPurchaseLedgerRow> Rows { get; set; } = new();
        public List<string> WorkbookWarnings { get; set; } = new();
    }

    public interface IFbrPurchaseLedgerParser
    {
        FbrPurchaseLedgerParseResult Parse(Stream stream, string originalFileName);
    }

    public class FbrPurchaseLedgerParser : IFbrPurchaseLedgerParser
    {
        // Header strings as they appear in row 0 of the FBR export. Match
        // is case-insensitive and trims surrounding whitespace.
        private static class H
        {
            public const string FbrInvoiceRefNo = "Invoice Ref No.";
            public const string Status = "Status";
            public const string SellerReturnStatus = "Seller Return Status";
            public const string InvoiceNo = "Invoice No.";
            public const string InvoiceType = "Invoice Type";
            public const string InvoiceDate = "Invoice Date";
            public const string SellerNtn = "Seller Registration No.";
            public const string SellerName = "Seller Name";
            public const string TaxpayerType = "Taxpayer Type";
            public const string SaleType = "Sale Type";
            public const string Quantity = "Quantity";
            public const string ProductDescription = "Product Description";
            public const string HsCode = "HS Code";
            public const string Rate = "Rate";
            public const string Uom = "UoM";
            public const string ValueExclTax = "Value of Sales Excluding Sales Tax";
            public const string SalesTax = "Sales Tax/ FED in ST Mode";
            public const string ExtraTax = "Extra Tax";
            public const string StWithheld = "ST Withheld at Source";
            public const string FurtherTax = "Further Tax";
            public const string FixedNotifiedValue = "Fixed / Notified value or Retail Price / Toll Charges";
            public const string TotalValueOfSales = "Total Value of Sales";
            public const string SroScheduleNo = "SRO No. / Schedule No.";
            public const string ItemSerialNo = "Item Sr. No.";
        }

        // Date formats FBR has been seen using. Leading entries are
        // tried first.
        private static readonly string[] DateFormats =
        {
            "dd-MMM-yyyy",   // 25-Mar-2026
            "d-MMM-yyyy",
            "dd/MM/yyyy",
            "yyyy-MM-dd",
        };

        public FbrPurchaseLedgerParseResult Parse(Stream stream, string originalFileName)
        {
            var result = new FbrPurchaseLedgerParseResult { FileName = originalFileName };

            IWorkbook book;
            try
            {
                // Detect format by extension. .xls = HSSF (binary),
                // .xlsx = XSSF (OOXML zip).
                if (originalFileName.EndsWith(".xls", StringComparison.OrdinalIgnoreCase))
                    book = new HSSFWorkbook(stream);
                else
                    book = new XSSFWorkbook(stream);
            }
            catch (Exception ex)
            {
                result.WorkbookWarnings.Add($"Could not open workbook: {ex.Message}");
                return result;
            }

            // FBR's export names the sheet "Domestic Invoices". Fall back
            // to sheet 0 if the name has changed — better than 500 missed
            // rows.
            var sheet = book.GetSheet("Domestic Invoices");
            if (sheet == null)
            {
                if (book.NumberOfSheets == 0)
                {
                    result.WorkbookWarnings.Add("Workbook has no sheets.");
                    return result;
                }
                sheet = book.GetSheetAt(0);
                result.WorkbookWarnings.Add(
                    $"Sheet 'Domestic Invoices' not found — using first sheet '{sheet.SheetName}' instead.");
            }

            if (sheet.LastRowNum < 1)
            {
                result.WorkbookWarnings.Add("Sheet has no data rows.");
                return result;
            }

            var headerMap = BuildHeaderMap(sheet.GetRow(0));
            int? Idx(string name) => headerMap.TryGetValue(NormalizeHeader(name), out var i) ? i : (int?)null;

            // Soft-warn if a key column is missing — we'll still parse
            // what we can. Missing HS Code or Quantity will cascade into
            // every row hitting failed-validation, which is the right UX.
            foreach (var critical in new[] { H.InvoiceNo, H.InvoiceDate, H.SellerNtn, H.HsCode, H.Quantity })
            {
                if (Idx(critical) == null)
                    result.WorkbookWarnings.Add($"Header '{critical}' not found — every row will fail validation for this column.");
            }

            for (int r = 1; r <= sheet.LastRowNum; r++)
            {
                var row = sheet.GetRow(r);
                if (row == null) continue;
                if (IsRowEmpty(row)) continue;

                var parsed = new FbrPurchaseLedgerRow { SourceRowNumber = r + 1 }; // 1-based incl. header

                parsed.FbrInvoiceRefNo  = Get(row, Idx(H.FbrInvoiceRefNo));
                parsed.Status           = Get(row, Idx(H.Status));
                parsed.SellerReturnStatus = Get(row, Idx(H.SellerReturnStatus));
                parsed.InvoiceNo        = Get(row, Idx(H.InvoiceNo));
                parsed.InvoiceType      = Get(row, Idx(H.InvoiceType));
                parsed.InvoiceDate      = ParseDate(Get(row, Idx(H.InvoiceDate)), row, Idx(H.InvoiceDate), parsed);
                parsed.SellerNtn        = Get(row, Idx(H.SellerNtn));
                parsed.SellerName       = Get(row, Idx(H.SellerName));
                parsed.TaxpayerType     = Get(row, Idx(H.TaxpayerType));
                parsed.SaleType         = Get(row, Idx(H.SaleType));
                parsed.Quantity         = ParseDecimal(Get(row, Idx(H.Quantity)),  parsed, H.Quantity);
                parsed.ProductDescription = Get(row, Idx(H.ProductDescription));
                parsed.HsCode           = Get(row, Idx(H.HsCode));
                parsed.Rate             = ParseRate(Get(row, Idx(H.Rate)), parsed);
                parsed.Uom              = Get(row, Idx(H.Uom));
                parsed.ValueExclTax     = ParseDecimal(Get(row, Idx(H.ValueExclTax)), parsed, H.ValueExclTax);
                parsed.SalesTax         = ParseDecimal(Get(row, Idx(H.SalesTax)),    parsed, H.SalesTax);
                parsed.ExtraTax         = ParseDecimal(Get(row, Idx(H.ExtraTax)),   parsed, H.ExtraTax);
                parsed.StWithheldAtSource = ParseDecimal(Get(row, Idx(H.StWithheld)), parsed, H.StWithheld);
                parsed.FurtherTax       = ParseDecimal(Get(row, Idx(H.FurtherTax)), parsed, H.FurtherTax);
                parsed.FixedNotifiedValueOrRetailPrice = ParseDecimal(Get(row, Idx(H.FixedNotifiedValue)), parsed, H.FixedNotifiedValue);
                parsed.TotalValueOfSales = ParseDecimal(Get(row, Idx(H.TotalValueOfSales)), parsed, H.TotalValueOfSales);
                parsed.SroScheduleNo    = Get(row, Idx(H.SroScheduleNo));
                parsed.ItemSerialNo     = Get(row, Idx(H.ItemSerialNo));

                result.Rows.Add(parsed);
            }

            return result;
        }

        private static Dictionary<string, int> BuildHeaderMap(IRow? headerRow)
        {
            var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            if (headerRow == null) return map;
            for (int c = 0; c < headerRow.LastCellNum; c++)
            {
                var v = headerRow.GetCell(c)?.ToString();
                if (string.IsNullOrWhiteSpace(v)) continue;
                map[NormalizeHeader(v)] = c;
            }
            return map;
        }

        private static string NormalizeHeader(string s) => s.Trim().Replace("  ", " ");

        private static string? Get(IRow row, int? colIndex)
        {
            if (colIndex == null) return null;
            var cell = row.GetCell(colIndex.Value);
            if (cell == null) return null;
            // For numeric cells, ToString gives a localized string that
            // can include thousands separators — but the fall-through
            // ParseDecimal strips commas anyway, so this is consistent.
            // For date cells, NPOI returns the raw double; we override
            // in ParseDate via DateCellValue when the cell is recognized
            // as a date.
            return cell.ToString()?.Trim();
        }

        private static bool IsRowEmpty(IRow row)
        {
            for (int c = 0; c < row.LastCellNum; c++)
            {
                var v = row.GetCell(c)?.ToString();
                if (!string.IsNullOrWhiteSpace(v)) return false;
            }
            return true;
        }

        private static DateTime? ParseDate(string? raw, IRow row, int? colIndex, FbrPurchaseLedgerRow parsed)
        {
            // Excel-numeric date — NPOI exposes the cell as numeric and
            // we can ask it for the parsed DateTime via DateCellValue.
            // This handles the case where FBR exports dates as Excel
            // serial numbers rather than text.
            if (colIndex.HasValue)
            {
                var cell = row.GetCell(colIndex.Value);
                if (cell != null && cell.CellType == CellType.Numeric && DateUtil.IsCellDateFormatted(cell))
                {
                    return cell.DateCellValue;
                }
            }
            if (string.IsNullOrWhiteSpace(raw)) return null;
            foreach (var fmt in DateFormats)
            {
                if (DateTime.TryParseExact(raw, fmt, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
                    return dt;
            }
            // Last resort: locale-default parse. Catches "5/8/2026" etc.
            if (DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out var loose))
                return loose;
            parsed.ParseWarnings.Add($"Unparseable invoice date '{raw}'");
            return null;
        }

        private static decimal? ParseDecimal(string? raw, FbrPurchaseLedgerRow parsed, string columnName)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            // Strip thousands separators ("9,380.00") and trim ' %' that
            // FBR sometimes leaves on quantity columns by accident.
            var cleaned = raw.Replace(",", "").Replace("%", "").Trim();
            if (decimal.TryParse(cleaned, NumberStyles.Any, CultureInfo.InvariantCulture, out var d))
                return d;
            parsed.ParseWarnings.Add($"Unparseable {columnName} '{raw}'");
            return null;
        }

        private static decimal? ParseRate(string? raw, FbrPurchaseLedgerRow parsed)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var trimmed = raw.Trim().TrimEnd('%').Trim();
            if (decimal.TryParse(trimmed, NumberStyles.Any, CultureInfo.InvariantCulture, out var pct))
            {
                // Heuristic — "18%" arrives as the literal "18", store
                // as the percent. Callers that want a fraction divide
                // by 100. Keeping it as percent matches the Invoice
                // GstRate convention elsewhere in the codebase.
                return pct;
            }
            parsed.ParseWarnings.Add($"Unparseable rate '{raw}'");
            return null;
        }
    }
}
