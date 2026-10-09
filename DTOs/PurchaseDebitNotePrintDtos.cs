namespace MyApp.Api.DTOs
{
    public class PrintPurchaseDebitNoteDto
    {
        public string SupplierName { get; set; } = "";
        public string? SupplierLogoPath { get; set; }
        public string? SupplierAddress { get; set; }
        public string? SupplierPhone { get; set; }
        public string? SupplierNTN { get; set; }
        public string? SupplierSTRN { get; set; }
        public string CompanyBrandName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string? CompanyNTN { get; set; }
        public string? CompanySTRN { get; set; }
        public string BuyerName { get; set; } = "";
        public string? BuyerAddress { get; set; }
        public string? BuyerPhone { get; set; }
        public string? BuyerNTN { get; set; }
        public string? BuyerSTRN { get; set; }
        public string InvoiceNumber { get; set; } = "";     // the debit-note number
        public DateTime Date { get; set; }
        public decimal Subtotal { get; set; }
        public decimal GstRate { get; set; }
        public decimal GstAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? OriginalInvoiceNumber { get; set; }  // supplier's own reference
        public string NoteKindLabel { get; set; } = "Debit Note";
        public List<PrintPurchaseDebitNoteItemDto> Items { get; set; } = new();
    }

    public class PrintPurchaseDebitNoteItemDto
    {
        public string? ItemTypeName { get; set; }
        public decimal Quantity { get; set; }
        public string? Uom { get; set; }
        public string Description { get; set; } = "";
        public string? HsCode { get; set; }
        public decimal ValueExclTax { get; set; }
        public decimal GstRate { get; set; }
        public decimal GstAmount { get; set; }
        public decimal TotalInclTax { get; set; }
    }
}
