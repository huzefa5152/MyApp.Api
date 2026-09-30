namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Wire shape for a Withholding Tax Receipt — the customer-issued tax
    /// certificate. List + create/edit + view all use this one shape; the view
    /// screen uses this shape; print data is supplied separately.
    /// </summary>
    public class WithholdingTaxReceiptDto
    {
        public int Id { get; set; }
        public int ReceiptNumber { get; set; }
        public int CompanyId { get; set; }


        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";

        public DateTime Date { get; set; }
        [System.ComponentModel.DataAnnotations.Range(typeof(decimal), "0.01", "9999999999999999.99")]
        public decimal Amount { get; set; }
        public string? Description { get; set; }

        public DateTime CreatedAt { get; set; }

        /// <summary>True when this is the highest-numbered receipt for its
        /// company sequence — gates Delete so the number stays
        /// gap-free, mirroring the other sales documents.</summary>
        public bool IsLatest { get; set; }
    }
}
