namespace MyApp.Api.DTOs
{
    public class PurchaseBillDto
    {
        public int Id { get; set; }
        public int PurchaseBillNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public int SupplierId { get; set; }
        public string SupplierName { get; set; } = "";
        public string? SupplierBillNumber { get; set; }
        public string? SupplierIRN { get; set; }
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public string ReconciliationStatus { get; set; } = "Pending";
        public DateTime CreatedAt { get; set; }
        public List<PurchaseItemDto> Items { get; set; } = new();

        /// <summary>
        /// Distinct sale-bill numbers this purchase covered (computed from
        /// Items.SourceInvoiceItem.InvoiceId). Empty when the bill was
        /// created standalone, populated when it was made via the
        /// "Purchase Against Sale Bill" flow — possibly multiple if one
        /// purchase fulfilled lines from several sales.
        /// </summary>
        public List<int> LinkedSaleBillNumbers { get; set; } = new();
    }

    public class PurchaseItemDto
    {
        public int Id { get; set; }
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
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }

        /// <summary>
        /// Sale lines this purchase row covered (read-side projection of
        /// PurchaseItemSourceLines). Empty when the row was a stand-alone
        /// purchase. Multiple entries when one procurement covered a
        /// grouped set of sale lines.
        /// </summary>
        public List<int> SourceInvoiceItemIds { get; set; } = new();
    }

    /// <summary>
    /// Payload for POST /api/purchasebills.
    /// </summary>
    public class CreatePurchaseBillDto
    {
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int SupplierId { get; set; }
        public string? SupplierBillNumber { get; set; }
        public string? SupplierIRN { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public List<CreatePurchaseItemDto> Items { get; set; } = new();
    }

    public class CreatePurchaseItemDto
    {
        public int? ItemTypeId { get; set; }
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string? UOM { get; set; }
        public decimal UnitPrice { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }

        /// <summary>
        /// Optional: when this purchase line is being created via the
        /// "Purchase Against Sale Bill" flow, this lists the InvoiceItems
        /// it covers. The form groups sale lines by ItemType (e.g. 28
        /// "Medicines" rows collapse into one procurement row) so a
        /// single PurchaseItem can fulfil many sale lines. Server uses
        /// the list to back-fill HSCode/UOM/SaleType/ItemTypeId onto
        /// every linked InvoiceItem, making the sale bill FBR-ready in
        /// one save.
        /// </summary>
        public List<int> SourceInvoiceItemIds { get; set; } = new();
    }

    /// <summary>
    /// Payload for PUT /api/purchasebills/{id}.
    /// </summary>
    public class UpdatePurchaseBillDto
    {
        public DateTime? Date { get; set; }
        public string? SupplierBillNumber { get; set; }
        public string? SupplierIRN { get; set; }
        public decimal GSTRate { get; set; }
        public string? PaymentTerms { get; set; }
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public List<UpdatePurchaseItemDto> Items { get; set; } = new();
    }

    public class UpdatePurchaseItemDto
    {
        public int Id { get; set; }
        public int? ItemTypeId { get; set; }
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
        /// <summary>Preserves the source-line links if this row originated from a sale-bill grouping.</summary>
        public List<int> SourceInvoiceItemIds { get; set; } = new();
    }

    /// <summary>
    /// One row in the picker for the "Purchase Against Sale Bill" flow.
    /// Returned by GET /api/invoices/company/{cid}/awaiting-purchase. Filters
    /// to bills that have at least one line missing HSCode AND that line
    /// still has remaining qty to procure.
    /// </summary>
    public class AwaitingPurchaseInvoiceDto
    {
        public int InvoiceId { get; set; }
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";
        public int LinesAwaiting { get; set; }
        // Decimal because the sum source (InvoiceItem.Quantity) is now
        // decimal(18,4). PurchasedQty is still int on the purchase side,
        // so the math (decimal - int) lands as decimal here.
        public decimal TotalQtyRemaining { get; set; }
    }

    /// <summary>
    /// Per-line procurement template for one sale bill. Returned by
    /// GET /api/invoices/{invoiceId}/purchase-template. Drives the
    /// PurchaseBill form when it's pre-filled from a sale bill.
    ///
    /// Only includes lines where HSCode is empty AND remainingQty &gt; 0,
    /// matching the picker rules.
    /// </summary>
    public class PurchaseTemplateDto
    {
        public int InvoiceId { get; set; }
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";
        public List<PurchaseTemplateLineDto> Items { get; set; } = new();
    }

    /// <summary>
    /// A grouped procurement row. Sale lines on the source bill that share
    /// an ItemTypeId collapse into one row here — the operator buys the
    /// total qty in one go from one supplier line. The InvoiceItemIds
    /// field carries the line-level breakdown so the back-fill knows
    /// which sale rows to update with the chosen HSCode/UOM/SaleType.
    /// </summary>
    public class PurchaseTemplateLineDto
    {
        /// <summary>The catalog item these sale lines were classified as (no HSCode yet).</summary>
        public int ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";

        /// <summary>InvoiceItem IDs aggregated into this row.</summary>
        public List<int> InvoiceItemIds { get; set; } = new();
        public int LineCount { get; set; }

        /// <summary>Combined description preview (first description or "first +N more").</summary>
        public string Description { get; set; } = "";

        // Decimal because the sale-side Quantity is now decimal(18,4).
        // PurchasedQty stays consistent so subtraction lands as decimal.
        public decimal SoldQty { get; set; }
        public decimal PurchasedQty { get; set; }
        public decimal RemainingQty { get; set; }

        /// <summary>UOM the operator typed at sale time (most common across the group, if any).</summary>
        public string? SaleUom { get; set; }

        /// <summary>Avg unit price across the group — purely a sanity reference.</summary>
        public decimal AvgSaleUnitPrice { get; set; }
    }
}
