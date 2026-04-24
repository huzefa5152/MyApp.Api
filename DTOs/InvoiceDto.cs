namespace MyApp.Api.DTOs
{
    public class InvoiceDto
    {
        public int Id { get; set; }
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public string? FbrInvoiceNumber { get; set; }
        public string? FbrIRN { get; set; }
        public string? FbrStatus { get; set; }
        public DateTime? FbrSubmittedAt { get; set; }
        public string? FbrErrorMessage { get; set; }
        public DateTime CreatedAt { get; set; }
        public bool IsEditable { get; set; }
        /// <summary>
        /// True when this is the LATEST (highest-numbered) bill for its
        /// company — only the latest bill can be deleted. Earlier bills
        /// must be edited instead to keep the numbering sequence gap-free.
        /// </summary>
        public bool IsLatest { get; set; }
        /// <summary>
        /// When true, the bulk Validate All / Submit All buttons skip this
        /// bill. Per-bill Validate / Submit remain available — the toggle
        /// is strictly about bulk opt-out.
        /// </summary>
        public bool IsFbrExcluded { get; set; }
        /// <summary>
        /// True when every item has HSCode + SaleType + UOM (either FbrUOMId or a non-empty UOM string),
        /// meaning the bill has enough data to be validated/submitted to FBR.
        /// </summary>
        public bool FbrReady { get; set; }
        /// <summary>
        /// Human-readable list of what's missing for FBR submission. Empty when FbrReady == true.
        /// </summary>
        public List<string> FbrMissing { get; set; } = new();
        public List<InvoiceItemDto> Items { get; set; } = new();
        public List<int> ChallanNumbers { get; set; } = new();
    }

    public class InvoiceItemDto
    {
        public int Id { get; set; }
        public int? DeliveryItemId { get; set; }
        /// <summary>FK to ItemType (FBR catalog entry) driving HS/UOM/Sale Type on this line.</summary>
        public int? ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        /// <summary>
        /// 3rd Schedule retail price (MRP × qty). Required when SaleType is
        /// "3rd Schedule Goods" to satisfy FBR error 0090.
        /// </summary>
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
    }

    public class CreateInvoiceDto
    {
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        /// <summary>FBR document type: 4 = Sale Invoice (default), 9 = Debit Note, 10 = Credit Note.</summary>
        public int? DocumentType { get; set; }
        /// <summary>Optional payment mode (Cash / Credit / Bank Transfer / Cheque / Online).</summary>
        public string? PaymentMode { get; set; }
        public List<int> ChallanIds { get; set; } = new();
        public List<CreateInvoiceItemDto> Items { get; set; } = new();
        public Dictionary<int, DateTime> PoDateUpdates { get; set; } = new();
    }

    public class CreateInvoiceItemDto
    {
        public int DeliveryItemId { get; set; }
        public decimal UnitPrice { get; set; }
        public string? Description { get; set; }
        /// <summary>Optional override of the delivery item's UOM (e.g. the FBR-matched UOM).</summary>
        public string? UOM { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        /// <summary>3rd Schedule retail price (MRP × qty) — required for "3rd Schedule Goods" sale type.</summary>
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
    }

    /// <summary>
    /// DTO for editing an existing invoice (bill) before FBR submission.
    /// Users can update prices, descriptions, GST rate, FBR fields, and even
    /// quantity if an item's source challan item was also updated.
    /// </summary>
    public class UpdateInvoiceDto
    {
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public List<UpdateInvoiceItemDto> Items { get; set; } = new();
    }

    public class UpdateInvoiceItemDto
    {
        public int Id { get; set; }  // 0 for new items, >0 for existing
        public int? DeliveryItemId { get; set; }
        /// <summary>
        /// When set, the server re-derives HS Code / UOM / Sale Type / FbrUOMId
        /// from this ItemType — overriding whatever was on the line before.
        /// The UOM/HSCode/SaleType fields in this DTO are ignored when ItemTypeId is set.
        /// </summary>
        public int? ItemTypeId { get; set; }
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        /// <summary>3rd Schedule retail price (MRP × qty) — required for "3rd Schedule Goods" sale type.</summary>
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
    }
}
