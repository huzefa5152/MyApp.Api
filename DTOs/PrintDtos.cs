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

        public List<PrintTaxItemDto> Items { get; set; } = new();
    }

    public class PrintTaxItemDto
    {
        public string ItemTypeName { get; set; } = "";
        public decimal Quantity { get; set; }
        public string UOM { get; set; } = "";
        public string Description { get; set; } = "";
        public decimal ValueExclTax { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal TotalInclTax { get; set; }
    }
}
