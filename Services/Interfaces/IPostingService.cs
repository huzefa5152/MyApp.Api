using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The GL posting engine (design §11.2 / Phase B). Every Post* method:
    ///   • is a NO-OP unless the company has <c>GlPostingEnabled</c> — existing
    ///     tenants are untouched until an operator enables + backfills;
    ///   • REPLACES the document's existing journal entry (replace-on-edit:
    ///     the ledger always mirrors current document state);
    ///   • writes a BALANCED entry (Σ debit = Σ credit asserted) or throws;
    ///   • resolves target accounts via Account.ControlType, falling back to a
    ///     Suspense account so a missing role account surfaces visibly instead
    ///     of failing the business operation;
    ///   • participates in the CALLER's ambient transaction (same scoped
    ///     DbContext) — callers invoke it inside their BeginTransactionAsync
    ///     block, before commit. Callers must SaveChanges after.
    /// </summary>
    public interface IPostingService
    {
        Task<bool> IsEnabledAsync(int companyId);

        /// <summary>Throws when posting is enabled and <paramref name="docDate"/>
        /// falls on/before the company's GlLockDate (period close guard).
        /// Document services call this before any GL-affecting mutation.</summary>
        Task AssertPeriodOpenAsync(int companyId, DateTime docDate);

        /// <summary>Receipt: Dr bank/cash, Cr AR (per invoice allocation) / Cr
        /// direct account lines. Payment: mirror image. Cancelled payments get
        /// their entry removed instead.</summary>
        Task PostPaymentAsync(Payment payment);

        /// <summary>Sales invoice: Dr AR, Cr Sales, Cr Output tax. Credit note
        /// (DocumentType 10): reversed. Debit note (9): invoice direction.
        /// Demo/cancelled/zero-total invoices get their entry removed.</summary>
        Task PostInvoiceAsync(Invoice invoice);

        /// <summary>Purchase bill: Dr Inventory (or Purchases/COGS when the
        /// company doesn't track inventory), Dr Input tax, Cr AP.</summary>
        Task PostPurchaseBillAsync(PurchaseBill bill);

        /// <summary>Inter-account transfer: Dr receiving, Cr paying account.</summary>
        Task PostTransferAsync(AccountTransfer transfer);

        /// <summary>Deletes the journal entry (and lines) for a source document.
        /// Called from document delete paths. Safe when none exists.</summary>
        Task RemoveForSourceAsync(int companyId, SourceDocType type, int sourceDocId);

        /// <summary>Seeds (if absent) the default inventory sales/purchase GL
        /// accounts into the company's CoA and pins them on Company.Default*.
        /// Idempotent; called on the GL-enable path so item-type lines resolve
        /// to real, correctly-placed accounts (design §3.2.1).</summary>
        Task EnsureDefaultInventoryAccountsAsync(int companyId);
    }
}
