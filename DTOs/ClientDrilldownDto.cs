namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Per-customer drill-down bundle behind the Customers screen — the
    /// documents that make up each clickable count/amount cell, grouped by
    /// type. Each section is capped (most-recent first) with the full
    /// <see cref="ClientDocSectionDto.Total"/> so the popup can show
    /// "showing N of M". Powers the expandable/collapsible customer-detail
    /// popup.
    /// </summary>
    public class ClientDrilldownDto
    {
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";

        public ClientDocSectionDto Quotes { get; set; } = new();
        public ClientDocSectionDto Orders { get; set; } = new();
        public ClientDocSectionDto Invoices { get; set; } = new();
        public ClientDocSectionDto CreditNotes { get; set; } = new();
        public ClientDocSectionDto Challans { get; set; } = new();
        public ClientDocSectionDto WithholdingReceipts { get; set; } = new();
    }

    public class ClientDocSectionDto
    {
        /// <summary>Full count for this type (may exceed Rows.Count when capped).</summary>
        public int Total { get; set; }
        public List<ClientDocRowDto> Rows { get; set; } = new();
    }

    /// <summary>One document row in a drill-down section. Generic across types —
    /// only the fields relevant to a type are populated.</summary>
    public class ClientDocRowDto
    {
        public int Id { get; set; }
        public string Number { get; set; } = "";
        public DateTime? Date { get; set; }
        /// <summary>Money total (quotes/invoices/credit notes/WHT); null for the
        /// quantity-only documents (orders/challans).</summary>
        public decimal? Amount { get; set; }
        /// <summary>Outstanding balance — invoices only (GrandTotal − AmountPaid).</summary>
        public decimal? Balance { get; set; }
        /// <summary>Lifecycle / payment / FBR status, per type.</summary>
        public string? Status { get; set; }
    }
}
