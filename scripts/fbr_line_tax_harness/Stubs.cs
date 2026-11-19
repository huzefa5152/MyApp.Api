namespace MyApp.Api.Models
{
    // Shape-for-shape copy of the fields FbrLineTax reads from Models/InvoiceItem.cs.
    public class InvoiceItem
    {
        public decimal LineTotal { get; set; }
        public decimal Quantity { get; set; }
        public string? SaleType { get; set; }
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }
    }
}
