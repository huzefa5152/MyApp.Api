namespace MyApp.Api.DTOs
{
    public class LinkInvoiceDeliveriesDto
    {
        public List<int> ChallanIds { get; set; } = new();
        public int? SalesOrderId { get; set; }
    }
}
