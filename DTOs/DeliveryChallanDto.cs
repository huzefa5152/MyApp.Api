namespace MyApp.Api.DTOs
{
    public class DeliveryChallanDto
    {
        public int Id { get; set; }
        public int ChallanNumber { get; set; }
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";
        public string PoNumber { get; set; } = "";
        public DateTime? PoDate { get; set; }
        public DateTime? DeliveryDate { get; set; }
        public string? Site { get; set; }
        public string Status { get; set; } = "Pending";
        public int? InvoiceId { get; set; }
        public string? InvoiceFbrStatus { get; set; }
        public bool IsEditable { get; set; }
        /// <summary>
        /// True when this challan is the LATEST (highest-numbered) one for
        /// its company — only the latest challan can be deleted, so the
        /// UI uses this to gate the Delete button. Earlier challans must
        /// be edited instead to keep the numbering sequence gap-free.
        /// </summary>
        public bool IsLatest { get; set; }
        public List<DeliveryItemDto> Items { get; set; } = new();
        public List<string> Warnings { get; set; } = new();
    }
}
