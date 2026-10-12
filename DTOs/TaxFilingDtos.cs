namespace MyApp.Api.DTOs;

public class TaxFilingRowDto
{
    public List<int> SourceLineIds { get; set; } = new();
    public int? ItemTypeId { get; set; }
    public string Description { get; set; } = "";
    public string? HSCode { get; set; }
    public string UOM { get; set; } = "";
    public int? FbrUOMId { get; set; }
    public string? SaleType { get; set; }
    public int? RateId { get; set; }
    public string? SroScheduleNo { get; set; }
    public string? SroItemSerialNo { get; set; }
    public decimal? RetailPrice { get; set; }
    public decimal Quantity { get; set; }
    public decimal ValueExclTax { get; set; }
}

public class TaxFilingPlan
{
    public string Revision { get; set; } = Guid.NewGuid().ToString("N");
    public string SourceVersion { get; set; } = "";
    public List<TaxFilingRowDto> Rows { get; set; } = new();
    public DateTime SavedAt { get; set; }
    public int SavedBy { get; set; }
}

public class SaveTaxFilingDto
{
    public string Version { get; set; } = "";
    public List<TaxFilingRowDto> Rows { get; set; } = new();
}

public class TaxFilingEditorDto
{
    public InvoiceDto Bill { get; set; } = null!;
    public string Version { get; set; } = "";
    public bool HasSavedRows { get; set; }
    public bool RequiresReview { get; set; }
    public List<TaxFilingRowDto> Rows { get; set; } = new();
    public List<TaxFilingRowDto> InitialRows { get; set; } = new();
}
