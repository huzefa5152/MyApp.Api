using NPOI.XSSF.UserModel;

namespace MyApp.Api.Services.Implementations
{
    // ── FBR Purchase Import — fictional sample workbook builder ──────────
    //
    // Produces a downloadable .xlsx the operator can open as a column
    // reference OR upload straight back to see a real preview/import. Two
    // layouts, matching what FbrPurchaseLedgerParser accepts:
    //
    //   • "ledger" — the IRIS "Sales Ledger" export: ALL purchases the
    //     supplier filed against us (claimed + unclaimed). Has the long
    //     "Value of Sales Excluding Sales Tax" / "Total Value of Sales"
    //     columns and a "Taxpayer Type" column.
    //   • "annexa" — the "AnnexA Excel Report" export: only the purchases
    //     WE have claimed. Renames several columns ("Supplier Type",
    //     "Purchase Type", "Value", "Invoice No") and adds buyer / authority
    //     columns.
    //
    // Every row is FULLY FICTIONAL — invented sellers, NTNs, HS codes and
    // products — so the file is safe to ship in demo videos and never leaks
    // a real client. The rows are still valid enough to pass the import
    // filter (Purchase Invoice / Registered / Claimed / valid HS / qty > 0),
    // so a demo can download → upload → watch bills import.
    public static class FbrPurchaseSampleWorkbook
    {
        public const string Annexa = "annexa";
        public const string Ledger = "ledger";

        // Fictional suppliers reused across both layouts. (ntn, name, hs,
        // description, uom, quantity, value-excl-tax, rate%).
        private static readonly (string Ntn, string Name, string Hs, string Desc, string Uom, string Qty, string Value, string Rate)[] Suppliers =
        {
            ("1112223", "Indus Steel & Pipe Co",       "7306.9000", "MS STEEL PIPE 2 INCH",       "KG",  "500",  "850000", "18"),
            ("2223334", "Crescent Packaging Ltd",       "4819.1000", "CORRUGATED CARTON BOX",      "PCS", "2000", "320000", "18"),
            ("3334445", "Meridian Chemicals",           "3402.9000", "INDUSTRIAL CLEANING AGENT",  "LTR", "150",  "180000", "18"),
            ("4445556", "Falcon Electric Supplies",     "8544.4990", "COPPER CABLE 4MM",           "MTR", "800",  "640000", "18"),
            ("5556667", "Summit Hardware Traders",      "8302.4110", "DOOR HINGE & FITTINGS SET",  "SET", "1200", "240000", "18"),
        };

        private const string InvoiceDate = "05-Aug-2026";
        // Fictional buyer (the importing company) for the Annexure-A layout.
        private const string BuyerNtn = "3520100000009";
        private const string BuyerName = "Demo Trading Company";

        private static readonly string[] AnnexaHeaders =
        {
            "Fixed assets / Capital goods", "InAdmissible/ Non Creditable", "Status", "Seller Return Status",
            "Source Authority", "Claimed Authority", "Buyer Registration No.", "Buyer Name",
            "Seller Registration No.", "Seller Name", "Supplier Type", "Sale Origination Province",
            "Destination of Supply", "Invoice Type", "Invoice No", "Invoice Date", "Product Description",
            "HS Code", "Purchase Type", "Rate", "Uom", "Quantity", "Value", "Sales Tax/ FED in ST Mode",
            "Fixed / notified value or Retail Price", "ST Withheld as WH Agent", "Extra Tax", "Further Tax",
            "Input Credit not allowed", "FED Changed",
        };

        private static readonly string[] LedgerHeaders =
        {
            "Invoice Ref No.", "Status", "Seller Return Status", "Invoice No.", "Invoice Type", "Invoice Date",
            "Seller Registration No.", "Seller Name", "Taxpayer Type", "Sale Type", "Quantity",
            "Product Description", "HS Code", "Rate", "UoM", "Value of Sales Excluding Sales Tax",
            "Sales Tax/ FED in ST Mode", "Extra Tax", "ST Withheld at Source", "Further Tax",
            "Fixed / Notified value or Retail Price / Toll Charges", "Total Value of Sales",
            "SRO No. / Schedule No.", "Item Sr. No.",
        };

        public static (byte[] Bytes, string FileName) Build(string? format)
        {
            var isLedger = string.Equals(format, Ledger, System.StringComparison.OrdinalIgnoreCase);
            var wb = new XSSFWorkbook();
            // The parser looks for a sheet named "Domestic Invoices" first.
            var sheet = wb.CreateSheet("Domestic Invoices");

            var headers = isLedger ? LedgerHeaders : AnnexaHeaders;
            var headerRow = sheet.CreateRow(0);
            for (int c = 0; c < headers.Length; c++)
                headerRow.CreateCell(c).SetCellValue(headers[c]);

            for (int i = 0; i < Suppliers.Length; i++)
            {
                var s = Suppliers[i];
                var salesTax = decimal.Parse(s.Value) * decimal.Parse(s.Rate) / 100m;
                var salesTaxStr = salesTax.ToString("0.##");
                var invNo = $"{s.Ntn}DI{i + 1:00}SAMPLE{1000 + i}";
                var cells = isLedger
                    ? LedgerRow(s, invNo, salesTaxStr, i)
                    : AnnexaRow(s, invNo, salesTaxStr);

                var row = sheet.CreateRow(i + 1);
                for (int c = 0; c < cells.Length; c++)
                    row.CreateCell(c).SetCellValue(cells[c]);
            }

            // NOTE: no AutoSizeColumn — it needs AWT font metrics that throw
            // on a headless Linux host (prod runs on Linux). Fixed widths keep
            // the file portable; the operator can widen columns themselves.
            for (int c = 0; c < headers.Length; c++) sheet.SetColumnWidth(c, 20 * 256);

            using var ms = new System.IO.MemoryStream();
            wb.Write(ms);
            var fileName = isLedger ? "FBR-Sales-Ledger-SAMPLE.xlsx" : "FBR-AnnexureA-SAMPLE.xlsx";
            return (ms.ToArray(), fileName);
        }

        private static string[] AnnexaRow((string Ntn, string Name, string Hs, string Desc, string Uom, string Qty, string Value, string Rate) s,
                                          string invNo, string salesTax) => new[]
        {
            "False",                 // Fixed assets / Capital goods
            "FALSE",                 // InAdmissible/ Non Creditable
            "Claimed",               // Status — Annexure-A is claimed-only
            "Unsubmitted",           // Seller Return Status
            "FBR", "FBR",            // Source / Claimed Authority
            BuyerNtn, BuyerName,     // Buyer Registration No. / Name (fictional)
            s.Ntn, s.Name,           // Seller Registration No. / Name
            "Registered",            // Supplier Type
            "SINDH", "SINDH",        // Sale Origination Province / Destination of Supply
            "Purchase Invoice",      // Invoice Type
            invNo, InvoiceDate,      // Invoice No / Date
            s.Desc, s.Hs,            // Product Description / HS Code
            "Goods at standard rate (default)", // Purchase Type
            s.Rate + "%", s.Uom, s.Qty, s.Value, salesTax,
            "0",                     // Fixed / notified value or Retail Price
            "0", "0", "0",           // ST Withheld as WH Agent / Extra Tax / Further Tax
            "",                      // Input Credit not allowed (blank = allowed)
            "0",                     // FED Changed
        };

        private static string[] LedgerRow((string Ntn, string Name, string Hs, string Desc, string Uom, string Qty, string Value, string Rate) s,
                                          string invNo, string salesTax, int i)
        {
            // The Sales Ledger carries claimed AND unclaimed rows — alternate
            // "Valid" (not yet claimed) and "Claimed" so the sample shows the
            // mix. Both import; other statuses would be skipped.
            var status = i % 2 == 0 ? "Valid" : "Claimed";
            var total = (decimal.Parse(s.Value) + decimal.Parse(salesTax)).ToString("0.##");
            return new[]
            {
                invNo, status, "Unsubmitted", invNo, "Purchase Invoice", InvoiceDate,
                s.Ntn, s.Name, "Registered", "Goods at standard rate (default)", s.Qty,
                s.Desc, s.Hs, s.Rate + "%", s.Uom, s.Value, salesTax, "0", "0", "0",
                "0", total, "", (i + 1).ToString(),
            };
        }
    }
}
