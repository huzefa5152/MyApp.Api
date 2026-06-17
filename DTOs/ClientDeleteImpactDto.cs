namespace MyApp.Api.DTOs
{
    /// <summary>
    /// What deleting a client will cascade-remove — drives the confirm dialog.
    /// <see cref="FbrSubmittedInvoices"/> &gt; 0 BLOCKS the delete (FBR bills
    /// can't be wiped for compliance).
    /// </summary>
    public class ClientDeleteImpactDto
    {
        public int SalesQuotes { get; set; }
        public int SalesOrders { get; set; }
        public int DeliveryChallans { get; set; }
        public int Invoices { get; set; }
        public int FbrSubmittedInvoices { get; set; }
    }
}
