namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Per-supplier roll-up for the Suppliers screen — the payables mirror of
    /// <see cref="ClientSummaryDto"/>. One row per supplier.
    /// </summary>
    public class SupplierSummaryDto
    {
        public int SupplierId { get; set; }
        public string SupplierName { get; set; } = "";

        /// <summary>
        /// What we owe this supplier: Σ(GrandTotal − WithholdingTax − AmountPaid)
        /// over their purchase bills, LESS any money already sitting with them on
        /// account (an advance paid before their bill arrived).
        ///
        /// Bill-settling payments are already reflected in AmountPaid, so only the
        /// UNAPPLIED on-account movements are folded in here — counting every
        /// payment would double-count. Goes NEGATIVE when we have paid more in
        /// advance than they have billed, which is real and worth seeing.
        /// </summary>
        public decimal AccountsPayable { get; set; }

        /// <summary>"Paid" when nothing is outstanding (including a supplier we
        /// are in credit with), "Partial" when some bills are part-paid, otherwise
        /// "Unpaid". Same vocabulary the invoice/bill rows already use.</summary>
        public string Status { get; set; } = "Paid";

        /// <summary>Count of bills with a balance still owing — lets the screen
        /// show "3 open bills" without a second call.</summary>
        public int OpenBills { get; set; }
    }
}
