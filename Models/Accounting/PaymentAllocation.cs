namespace MyApp.Api.Models.Accounting
{
    /// <summary>What one <see cref="PaymentAllocation"/> line is for. Explicit
    /// rather than inferred from which id is set, because <see cref="OnAccount"/>
    /// sets NO target at all — it is money moved against a party's running
    /// balance with no document and no income/expense account.</summary>
    public enum AllocationKind
    {
        /// <summary>Settles a specific sales invoice or purchase bill.
        /// <see cref="PaymentAllocation.InvoiceId"/> or
        /// <see cref="PaymentAllocation.PurchaseBillId"/> is set.</summary>
        Document = 0,
        /// <summary>A direct income/expense line —
        /// <see cref="PaymentAllocation.AccountId"/> is set. The everyday
        /// "paid the electricity bill" case.</summary>
        Account = 1,
        /// <summary>An advance / on-account movement: posts to the AR (receipt)
        /// or AP (payment) control account against the payment's contact, with no
        /// document. A supplier advance leaves that supplier in debit until a bill
        /// arrives to absorb it. Requires a Client/Supplier contact on the header;
        /// before this existed the amount silently plugged to Suspense.</summary>
        OnAccount = 2,
    }

    /// <summary>
    /// One line of a <see cref="Payment"/>: how much of the payment is applied,
    /// and to what. <see cref="Kind"/> says which:
    ///   • <see cref="AllocationKind.Document"/>   — <see cref="InvoiceId"/> (Receipt
    ///     settling a sales invoice, AR) or <see cref="PurchaseBillId"/> (Payment
    ///     settling a purchase bill, AP).
    ///   • <see cref="AllocationKind.Account"/>    — <see cref="AccountId"/>, a direct
    ///     income/expense line with no document (electricity, rent, a cash sale).
    ///     May carry recoverable tax; see <see cref="TaxAmount"/>.
    ///   • <see cref="AllocationKind.OnAccount"/>  — no target; an advance against the
    ///     contact's AR/AP balance.
    ///
    /// BalanceDue/AmountPaid on the target invoice/bill is recomputed from the sum
    /// of these allocations inside the same transaction that writes them.
    /// </summary>
    public class PaymentAllocation
    {
        public int Id { get; set; }
        public int PaymentId { get; set; }

        /// <summary>Which of the three shapes this line is. Defaults to
        /// <see cref="AllocationKind.Document"/> so existing rows — every one of
        /// which targets an invoice or a bill — keep their meaning with no
        /// backfill. The migration derives it for account-targeted rows.</summary>
        public AllocationKind Kind { get; set; } = AllocationKind.Document;

        public int? InvoiceId { get; set; }        // Receipt → sales invoice
        public int? PurchaseBillId { get; set; }   // Payment → purchase bill
        public int? AccountId { get; set; }        // OR a direct income/expense account

        // ── Recoverable tax on a direct income/expense line ──
        // Follows the document convention (Invoice/PurchaseBill GSTRate+GSTAmount):
        // Amount is the GROSS cash that left/entered the bank, and TaxAmount is the
        // tax slice inside it. So the expense recognised is Amount − TaxAmount and
        // the tax posts to Input Tax (payment) / Output Tax (receipt). Keeping
        // Amount gross means Payment.Amount stays the true cash movement.

        /// <summary>Tax rate applied to this line, as a percentage (18 = 18%).
        /// Null = no tax. Kept for display/audit; <see cref="TaxAmount"/> is what
        /// posts, so a hand-entered amount is never silently recomputed.</summary>
        public decimal? TaxRate { get; set; }

        /// <summary>Tax included in <see cref="Amount"/>. 0 = none. Only meaningful
        /// on an <see cref="AllocationKind.Account"/> line — a document line's tax
        /// was already posted by the invoice/bill itself.</summary>
        public decimal TaxAmount { get; set; }

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
        /// <summary>The income/expense account on an <see cref="AllocationKind.Account"/>
        /// line — so a saved expense can be read back and displayed by name.</summary>
        public Account? Account { get; set; }
        public Account? AdjustmentAccount { get; set; }
    }
}
