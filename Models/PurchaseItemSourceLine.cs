namespace MyApp.Api.Models
{
    /// <summary>
    /// Join table for the "Purchase Against Sale Bill" flow. Records which
    /// InvoiceItems on a sale bill were fulfilled by which PurchaseItem on
    /// a procurement bill. The relationship is N:M because:
    ///
    ///  • One sale bill commonly has many lines of the same loose category
    ///    (e.g. 28 "Medicines" entries) that the operator groups into ONE
    ///    procurement row when buying from the supplier — so one
    ///    PurchaseItem covers many InvoiceItems.
    ///  • A single procurement bill from one supplier can fulfil items
    ///    from several different sale bills — so a InvoiceItem might
    ///    eventually be linked to PurchaseItems on multiple PurchaseBills
    ///    if procured incrementally.
    ///
    /// Composite primary key (PurchaseItemId, InvoiceItemId).
    /// </summary>
    public class PurchaseItemSourceLine
    {
        public int PurchaseItemId { get; set; }
        public PurchaseItem PurchaseItem { get; set; } = null!;

        public int InvoiceItemId { get; set; }
        public InvoiceItem InvoiceItem { get; set; } = null!;
    }
}
