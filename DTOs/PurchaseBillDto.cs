namespace MyApp.Api.DTOs
{
    public class PurchaseBillDto
    {
        public string? Notes { get; set; }
        public int Id { get; set; }
        public int PurchaseBillNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public int? DivisionId { get; set; }
        public string? DivisionName { get; set; }
        public int SupplierId { get; set; }
        public int? SourceDeliveryChallanId { get; set; }
        public string SupplierName { get; set; } = "";
        public string? SupplierBillNumber { get; set; }
        public string? SupplierIRN { get; set; }
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? PaymentTerms { get; set; }

        // ── Withholding tax (income-tax, Manager.io parity) — mirror of InvoiceDto,
        // supplier side. Rate non-null → % mode; rate null & amount > 0 → fixed
        // amount. Reduces BalanceDue (what we owe the supplier); never sent to FBR.
        public decimal? WithholdingTaxRate { get; set; }
        public decimal WithholdingTaxAmount { get; set; }

        // ── Payments (design §11.5) — mirror of InvoiceDto. PaymentStatus is
        // "Unpaid" | "PartiallyPaid" | "Paid" | "Overdue", derived at read time.
        public DateTime? DueDate { get; set; }
        public decimal AmountPaid { get; set; }
        public decimal BalanceDue { get; set; }
        public string PaymentStatus { get; set; } = "Unpaid";
        public int DaysOverdue { get; set; }

        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public string ReconciliationStatus { get; set; } = "Pending";
        public DateTime CreatedAt { get; set; }
        /// <summary>
        /// Copy lineage — when this document was produced by the Copy action,
        /// the type and id of the document it was copied from. Null otherwise.
        /// </summary>
        public string? CopiedFromType { get; set; }
        public int? CopiedFromId { get; set; }

        public List<PurchaseItemDto> Items { get; set; } = new();

        /// <summary>
        /// Distinct sale-bill numbers this purchase covered (computed from
        /// Items.SourceInvoiceItem.InvoiceId). Empty when the bill was
        /// created standalone, populated when it was made via the
        /// "Purchase Against Sale Bill" flow — possibly multiple if one
        /// purchase fulfilled lines from several sales.
        /// </summary>
        public List<int> LinkedSaleBillNumbers { get; set; } = new();

        /// <summary>Customer documents this bill buys for, each once, oldest stage first.</summary>
        public List<DemandTagDto> ForDocuments { get; set; } = new();
    }

    public class PurchaseItemDto
    {
        public int Id { get; set; }
        public int? ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        /// <summary>Optional NonInventoryItem link (GL-account shortcut). Mutually exclusive with ItemTypeId.</summary>
        public int? NonInventoryItemId { get; set; }
        public string? NonInventoryItemName { get; set; }
        /// <summary>Per-line GL expense/COGS account this line posts to (design §3.3);
        /// null = derived at post time.</summary>
        public int? AccountId { get; set; }
        public string? AccountName { get; set; }
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }

        /// <summary>Customer-document lines this row buys, and how much of each.</summary>
        public List<PurchaseItemSourceDto> Sources { get; set; } = new();
        /// <summary>The documents those lines are on, for the row's tag.</summary>
        public List<DemandTagDto> Tags { get; set; } = new();
    }

    /// <summary>
    /// Payload for POST /api/purchasebills.
    /// </summary>
    public class CreatePurchaseBillDto
    {
        public int? CustomNumber { get; set; }
        public string? Notes { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int? DivisionId { get; set; }
        public int SupplierId { get; set; }
        public string? SupplierBillNumber { get; set; }
        public string? SupplierIRN { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public decimal? WithholdingTaxRate { get; set; }
        public decimal WithholdingTaxAmount { get; set; }
        public List<CreatePurchaseItemDto> Items { get; set; } = new();
    }

    public class CreatePurchaseItemDto
    {
        public int? ItemTypeId { get; set; }
        /// <summary>Optional NonInventoryItem link (GL-account shortcut line, no stock/FBR). Mutually exclusive with ItemTypeId.</summary>
        public int? NonInventoryItemId { get; set; }
        /// <summary>Optional per-line GL expense/COGS account override (design §4 step 1).</summary>
        public int? AccountId { get; set; }
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string? UOM { get; set; }
        public decimal UnitPrice { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }

        /// <summary>Customer-document lines this row buys (order, challan or bill
        /// lines). Their quantities add up to the row's; the server checks each
        /// trail has that much left to buy.</summary>
        public List<PurchaseItemSourceDto> Sources { get; set; } = new();
    }

    /// <summary>
    /// Payload for PUT /api/purchasebills/{id}.
    /// </summary>
    public class UpdatePurchaseBillDto
    {
        public int? CustomNumber { get; set; }
        public string? Notes { get; set; }
        public DateTime? Date { get; set; }
        public string? SupplierBillNumber { get; set; }
        public string? SupplierIRN { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public decimal? WithholdingTaxRate { get; set; }
        public decimal WithholdingTaxAmount { get; set; }
        public List<UpdatePurchaseItemDto> Items { get; set; } = new();
    }

    public class UpdatePurchaseItemDto
    {
        public int Id { get; set; }
        public int? ItemTypeId { get; set; }
        /// <summary>Optional NonInventoryItem link (GL-account shortcut). Mutually exclusive with ItemTypeId.</summary>
        public int? NonInventoryItemId { get; set; }
        /// <summary>Optional per-line GL expense/COGS account override (design §4 step 1).</summary>
        public int? AccountId { get; set; }
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
        /// <summary>Keeps (or changes) the customer-document lines this row buys.</summary>
        public List<PurchaseItemSourceDto> Sources { get; set; } = new();
    }
}
