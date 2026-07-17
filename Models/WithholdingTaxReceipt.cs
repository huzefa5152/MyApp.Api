namespace MyApp.Api.Models
{
    /// <summary>
    /// Records a Withholding Tax certificate a CUSTOMER issued to us — i.e.
    /// tax the customer deducted at source when paying an invoice and remitted
    /// to the government on our behalf. Each receipt is money we can later
    /// claim against our own income-tax liability, so the per-customer sum is
    /// surfaced as the "Withholding tax receivable" figure on the Customers
    /// screen (mirrors TechvoLogix / Manager.io).
    ///
    /// Quantity-free, single-amount document: Date + Customer + Amount +
    /// Description (+ an optional scanned certificate via the shared
    /// Attachment component). Numbered per (Company, Division) like the other
    /// sales documents. NOT an FBR document.
    ///
    /// Accounting note: when a company later enables the GL engine
    /// (Company.GlPostingEnabled, default off) this document is the natural
    /// source for a Dr "Withholding tax receivable" / Cr "Accounts receivable"
    /// journal (ControlType.WithholdingReceivable already exists). That posting
    /// is a deliberately-deferred seam — see WithholdingTaxReceiptService — so
    /// nothing here depends on the GL being on.
    /// </summary>
    public class WithholdingTaxReceipt
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }

        /// <summary>Optional division ("sub-company"); when set the receipt
        /// numbers from the division's own sequence. Null = company-level.</summary>
        public int? DivisionId { get; set; }

        /// <summary>Per-(company, division) sequential number (WHT-0001, …).
        /// Allocated with collision-retry like the other document numbers.</summary>
        public int ReceiptNumber { get; set; }

        public int ClientId { get; set; }

        /// <summary>Date printed on the customer's withholding-tax certificate.</summary>
        public DateTime Date { get; set; }

        /// <summary>Amount of tax the customer withheld (PKR).</summary>
        public decimal Amount { get; set; }

        /// <summary>Free-text note (certificate ref, section, period, …).</summary>
        public string? Description { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Division? Division { get; set; }
        public Client Client { get; set; } = null!;
    }
}
