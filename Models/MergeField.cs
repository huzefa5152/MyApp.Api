namespace MyApp.Api.Models
{
    public class MergeField
    {
        public int Id { get; set; }
        public string TemplateType { get; set; } = null!; // "Challan", "Bill", "TaxInvoice"
        public string FieldExpression { get; set; } = null!; // e.g. "{{companyBrandName}}"
        public string Label { get; set; } = null!; // e.g. "Company Brand Name"
        public string? Category { get; set; } // e.g. "Company", "Client", "Items"
        public int SortOrder { get; set; }
    }
}
