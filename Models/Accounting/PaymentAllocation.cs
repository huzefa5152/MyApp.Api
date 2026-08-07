namespace MyApp.Api.Models.Accounting
{
    /// <summary>
    /// One line of a <see cref="Payment"/>: how much of the payment is applied,
    /// and to what. Exactly one target is set per line:
    ///   • <see cref="InvoiceId"/>      — a Receipt settling a sales invoice (AR).
    ///   • <see cref="PurchaseBillId"/> — a Payment settling a purchase bill (AP).
    ///   • <see cref="AccountId"/>      — a direct income/expense line with no
    ///     document (e.g. cash sale, sundry expense). The Account FK stays null
    ///     until the Chart-of-Accounts phase adds the Accounts table; for Phase A
    ///     a direct line carries just an amount + the payment's Description.
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
        public int? AccountId { get; set; }        // OR a direct income/expense account (CoA phase)

        /// <summary>Cash amount applied by this line. decimal(18,2) — see Payment.Amount.</summary>
        public decimal Amount { get; set; }

        /// <summary>
        /// Non-cash portion that ALSO clears the settled invoice/bill — the
        /// Manager-style "settle remainder" (operator receives less than the
        /// balance and routes the gap to a GL account: a discount, a write-off,
        /// a carry-forward receivable, or any account they pick). The amount
        /// cleared against the document is <see cref="Amount"/> + this; the
        /// payment's cash total stays Σ Amount. 0 for a plain cash allocation.
        /// </summary>
        public decimal AdjustmentAmount { get; set; }

        /// <summary>GL account the adjustment posts to when the ledger is on.
        /// Null when there is no adjustment, or the company runs GL-off (the
        /// adjustment then simply clears the balance with no posting).</summary>
        public int? AdjustmentAccountId { get; set; }

        // Navigation
        public Payment Payment { get; set; } = null!;
        public Invoice? Invoice { get; set; }
        public PurchaseBill? PurchaseBill { get; set; }
        public Account? AdjustmentAccount { get; set; }
    }
}
