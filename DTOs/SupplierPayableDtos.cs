namespace MyApp.Api.DTOs;

public class SupplierPayableSummaryDto
{
    public int SupplierId { get; set; }
    public string SupplierName { get; set; } = "";
    public decimal Purchases { get; set; }
    public decimal CashPaid { get; set; }
    public decimal OtherSettlement { get; set; }
    public decimal TotalCredits { get; set; }
    public decimal UnappliedAdvances { get; set; }
    public decimal UnallocatedCredits { get; set; }
    public decimal NetBalance { get; set; }
}

public class SupplierLedgerRowDto
{
    [System.Text.Json.Serialization.JsonIgnore]
    public DateTime CreatedAt { get; set; }
    public DateTime Date { get; set; }
    public string Kind { get; set; } = "";
    public int Id { get; set; }
    public string Reference { get; set; } = "";
    public decimal Increase { get; set; }
    public decimal CashPaid { get; set; }
    public decimal Adjustment { get; set; }
    public decimal Balance { get; set; }
    public List<int> PurchaseBillIds { get; set; } = new();
}

public class SupplierPurchaseBalanceDto
{
    public int Id { get; set; }
    public int Number { get; set; }
    public int SupplierId { get; set; }
    public string SupplierName { get; set; } = "";
    public string? SupplierBillNumber { get; set; }
    public string Category { get; set; } = "";
    public DateTime Date { get; set; }
    public decimal Liability { get; set; }
    public decimal CashPaid { get; set; }
    public decimal Adjustment { get; set; }
    public decimal CreditAmount { get; set; }
    public decimal Outstanding => Liability - CashPaid - Adjustment - CreditAmount;
    public List<int> InvoiceIds { get; set; } = new();
    public List<int> InvoiceNumbers { get; set; } = new();
    public List<int> ChallanNumbers { get; set; } = new();
    public List<int> ChallanIds { get; set; } = new();
    public bool CostChanged { get; set; }
}

public class SupplierLedgerDto
{
    public int SupplierId { get; set; }
    public string SupplierName { get; set; } = "";
    public decimal OpeningBalance { get; set; }
    public decimal NetBalance { get; set; }
    public decimal CashPaid { get; set; }
    public decimal UnappliedAdvances { get; set; }
    public decimal UnallocatedCredits { get; set; }
    public List<SupplierLedgerRowDto> Rows { get; set; } = new();
    public List<SupplierPurchaseBalanceDto> Purchases { get; set; } = new();
}
