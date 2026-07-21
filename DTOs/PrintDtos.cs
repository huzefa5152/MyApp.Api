namespace MyApp.Api.DTOs
{
    // Data for printing a Delivery Challan
    public class PrintChallanDto
    {
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public int ChallanNumber { get; set; }
        public DateTime? DeliveryDate { get; set; }
        public string ClientName { get; set; } = "";
        public string? ClientAddress { get; set; }
        public string? ClientSite { get; set; }
        public string PoNumber { get; set; } = "";
        public DateTime? PoDate { get; set; }
        public string? IndentNo { get; set; }
        public List<PrintChallanItemDto> Items { get; set; } = new();
    }

    public class PrintChallanItemDto
    {
        public decimal Quantity { get; set; }
        public string Description { get; set; } = "";
        public string Unit { get; set; } = "";
    }

    // Data for printing a Bill (Invoice)
    public class PrintBillDto
    {
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string? CompanyNTN { get; set; }
        public string? CompanySTRN { get; set; }
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public List<int> ChallanNumbers { get; set; } = new();
        public List<DateTime?> ChallanDates { get; set; } = new();
        public string PoNumber { get; set; } = "";
        public DateTime? PoDate { get; set; }
        public string ClientName { get; set; } = "";
        public string? ClientAddress { get; set; }
        public string? ConcernDepartment { get; set; }
        public string? ClientNTN { get; set; }
        public string? ClientSTRN { get; set; }
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? PaymentTerms { get; set; }
        public List<PrintBillItemDto> Items { get; set; } = new();
    }

    public class PrintBillItemDto
    {
        public int SNo { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
    }

    // Data for printing a Sales Tax Invoice
    public class PrintTaxInvoiceDto
    {
        // Supplier (company) details
        public string SupplierName { get; set; } = "";
        public string? SupplierAddress { get; set; }
        public string? SupplierNTN { get; set; }
        public string? SupplierSTRN { get; set; }
        public string? SupplierPhone { get; set; }
        public string? SupplierLogoPath { get; set; }

        // The SAME issuer (our company), ALSO exposed under the company* token
        // names. TaxInvoice / Credit-Note / Debit-Note templates all share this
        // DTO, and a template may print the letterhead logo via {{companyLogoPath}}
        // rather than {{supplierLogoPath}}. Populating both makes the logo +
        // letterhead render regardless of which convention the active template
        // was authored with. (Cause of the "logo missing on print" bug elsewhere —
        // the template referenced {{companyLogoPath}} but the DTO only filled
        // {{supplierLogoPath}}.)
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string? CompanyNTN { get; set; }
        public string? CompanySTRN { get; set; }

        // Buyer (client) details
        public string BuyerName { get; set; } = "";
        public string? BuyerAddress { get; set; }
        public string? BuyerPhone { get; set; }
        public string? BuyerNTN { get; set; }
        public string? BuyerSTRN { get; set; }

        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public List<int> ChallanNumbers { get; set; } = new();
        public string PoNumber { get; set; } = "";
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";

        // FBR Digital Invoicing
        public string? FbrIRN { get; set; }
        public string? FbrStatus { get; set; }
        public DateTime? FbrSubmittedAt { get; set; }
        /// <summary>
        /// Pre-rendered QR PNG encoded as a `data:image/png;base64,...` URI.
        /// Populated by InvoiceService when FbrIRN is set so the print
        /// template can embed the QR inline (no external HTTP, works in
        /// PDF + offline, no IRN leak to a third-party renderer).
        /// Merge field: {{{fbrQrPngDataUrl}}} (triple braces to avoid HTML
        /// escaping the data URI).
        /// </summary>
        public string? FbrQrPngDataUrl { get; set; }
        /// <summary>
        /// Path to the deployed FBR logo asset. Stable URL served by
        /// app.UseStaticFiles() from wwwroot/ — does not depend on the
        /// gitignored runtime data/ folder. Merge field: {{fbrLogoUrl}}.
        /// </summary>
        public string FbrLogoUrl { get; set; } = "/images/fbr-logo.png";

        // ── Credit / Debit note fields ───────────────────────────────────
        // Populated only when the printed row is a note (DocumentType 9/10);
        // null on ordinary sales invoices so existing TaxInvoice templates
        // are unaffected. CreditNote/DebitNote templates bind these via
        // {{originalInvoiceNumber}}, {{noteReason}}, {{noteKindLabel}}, etc.
        public string? NoteKindLabel { get; set; }        // "Credit Note" | "Debit Note"
        public int? OriginalInvoiceNumber { get; set; }
        public DateTime? OriginalInvoiceDate { get; set; }
        public string? OriginalInvoiceRefIRN { get; set; }
        public string? NoteReason { get; set; }
        public string? NoteReasonRemarks { get; set; }

        public List<PrintTaxItemDto> Items { get; set; } = new();
    }

    public class PrintTaxItemDto
    {
        public string ItemTypeName { get; set; } = "";
        public decimal Quantity { get; set; }
        public string UOM { get; set; } = "";
        public string Description { get; set; } = "";
        /// <summary>Net unit price (pre-tax). Lets the tax-invoice template render a
        /// "Unit price" column like Manager's; = line ValueExclTax / Quantity.</summary>
        public decimal UnitPrice { get; set; }
        public decimal ValueExclTax { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal TotalInclTax { get; set; }
        /// <summary>
        /// HS Code copied from the InvoiceItem (which inherits it from
        /// the ItemType picked on the line). Null/empty when the row is
        /// against an un-classified item type. Surfaced in tax-invoice
        /// templates as {{this.hsCode}} so the template can render
        /// "&lt;hsCode&gt; - &lt;description&gt;" when present, falling
        /// back to plain "&lt;description&gt;" when the line has no HS
        /// Code (typical guard: {{#if this.hsCode}}{{this.hsCode}} -
        /// {{this.description}}{{else}}{{this.description}}{{/if}}).
        /// </summary>
        public string? HSCode { get; set; }
    }

    // Data for printing a Sales Quote (priced — mirrors PrintBillDto).
    public class PrintQuoteDto
    {
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string? CompanyNTN { get; set; }
        public string? CompanySTRN { get; set; }
        public int QuoteNumber { get; set; }
        public DateTime Date { get; set; }
        public DateTime? ValidUntil { get; set; }
        public string? CustomerEnquiryRef { get; set; }
        public DateTime? EnquiryDate { get; set; }
        public string ClientName { get; set; } = "";
        public string? ClientAddress { get; set; }
        public string? ClientNTN { get; set; }
        public string? ClientSTRN { get; set; }
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? Notes { get; set; }
        public List<PrintQuoteItemDto> Items { get; set; } = new();
    }

    public class PrintQuoteItemDto
    {
        public int SNo { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        // Named "Uom" (not "UOM") so the default camelCase JSON key is a clean
        // "uom" — matching the {{this.uom}} merge token in the templates.
        public string Uom { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
    }

    // Data for printing a Sales Order (quantity-only — mirrors PrintChallanDto
    // plus the delivered/remaining fulfilment columns).
    public class PrintOrderDto
    {
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public int SalesOrderNumber { get; set; }
        public DateTime OrderDate { get; set; }
        public DateTime? RequiredDate { get; set; }
        public string? CustomerPoNumber { get; set; }
        public DateTime? CustomerPoDate { get; set; }
        /// <summary>Fulfilment roll-up shown on the printed order ({{status}}).</summary>
        public string Status { get; set; } = "";
        public string ClientName { get; set; } = "";
        public string? ClientAddress { get; set; }
        public string? Site { get; set; }
        public List<PrintOrderItemDto> Items { get; set; } = new();
    }

    public class PrintOrderItemDto
    {
        public int SNo { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        // See PrintQuoteItemDto.Uom — clean camelCase "uom" key.
        public string Uom { get; set; } = "";
        public decimal DeliveredQuantity { get; set; }
        public decimal RemainingQuantity { get; set; }
    }

    // Data for printing a Purchase Bill (priced — the tenant company is the
    // BUYER; supplier* fields carry the vendor party, company* the tenant).
    public class PrintPurchaseBillDto
    {
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string? CompanyNTN { get; set; }
        public string? CompanySTRN { get; set; }
        public string SupplierName { get; set; } = "";
        public string? SupplierAddress { get; set; }
        public string? SupplierPhone { get; set; }
        public string? SupplierNTN { get; set; }
        public string? SupplierSTRN { get; set; }
        public int PurchaseBillNumber { get; set; }
        public DateTime Date { get; set; }
        public string? SupplierBillNumber { get; set; }
        public string? SupplierIRN { get; set; }
        public string? PaymentTerms { get; set; }
        public DateTime? DueDate { get; set; }
        public List<int> GoodsReceiptNumbers { get; set; } = new();
        public List<int> LinkedSaleBillNumbers { get; set; } = new();
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public List<PrintPurchaseBillItemDto> Items { get; set; } = new();
    }

    public class PrintPurchaseBillItemDto
    {
        public int SNo { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
        public string? HSCode { get; set; }
    }

    // Data for printing a Goods Receipt Note (quantity-only — mirrors
    // PrintChallanDto on the purchase side).
    public class PrintGoodsReceiptDto
    {
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string SupplierName { get; set; } = "";
        public string? SupplierAddress { get; set; }
        public string? SupplierPhone { get; set; }
        public int GoodsReceiptNumber { get; set; }
        public DateTime ReceiptDate { get; set; }
        public string? SupplierChallanNumber { get; set; }
        public int? PurchaseBillNumber { get; set; }
        public string? Site { get; set; }
        public string Status { get; set; } = "";
        public List<PrintGoodsReceiptItemDto> Items { get; set; } = new();
    }

    public class PrintGoodsReceiptItemDto
    {
        public int SNo { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        // Matches the Challan item convention — templates bind {{this.unit}}.
        public string Unit { get; set; } = "";
    }
}
