namespace MyApp.Api.Models.Accounting
{
    /// <summary>
    /// One line of a <see cref="Payment"/>: how much of the payment is applied,
    /// and to what. Exactly one target is set per line:
    ///   • <see cref="InvoiceId"/>      — a Receipt settling a sales invoice (AR).
    ///   • <see cref="PurchaseBillId"/> — a Payment settling a purchase bill (AP).
    ///   • <see cref="AccountId"/>      — a direct income/expense line with no
    ///     document. There is no Chart of Accounts in master, so this is a plain
    ///     FK-less nullable column carried for shape-compatibility with the
    ///     accounting build; the master UI does not populate it.
    ///
    /// BalanceDue/AmountPaid on the target invoice/bill is recomputed from the sum
    /// of these allocations inside the same transaction that writes them.
    /// </summary>
    public class PaymentAllocation
    {
        public int Id { get; set; }
        public int PaymentId { get; set; }

        public int? InvoiceId { get; set; }        // Receipt → sales invoice
        public int? PurchaseBillId { get; set; }   // Payment → purchase bill
        public int? AccountId { get; set; }        // OR a direct income/expense line (FK-less in master)

        /// <summary>Amount applied by this line. decimal(18,2) — see Payment.Amount.</summary>
        public decimal Amount { get; set; }

        // Navigation
        public Payment Payment { get; set; } = null!;
        public Invoice? Invoice { get; set; }
        public PurchaseBill? PurchaseBill { get; set; }
    }
}
