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
        /// direct account lines. Payment: mirror image — including Dr Import
        /// Clearing for an allocation settling a GD consignment (Task 23), the
        /// same shape as a PurchaseBillId allocation debiting AP. Cancelled
        /// payments get their entry removed instead.</summary>
        Task PostPaymentAsync(Payment payment);

        /// <summary>Sales invoice: Dr AR, Cr Sales, Cr Output tax. Credit note
        /// (DocumentType 10): reversed. Debit note (9): invoice direction.
        /// Demo/cancelled/zero-total invoices get their entry removed.</summary>
        Task PostInvoiceAsync(Invoice invoice);

        /// <summary>Purchase bill: Dr Inventory (or Purchases/COGS when the
        /// company doesn't track inventory), Dr Input tax, Cr AP.</summary>
        Task PostPurchaseBillAsync(PurchaseBill bill);

        /// <summary>Purchase (supplier) debit note — the exact mirror of a
        /// purchase bill: Dr AP (reduces what we owe the supplier), Cr Inventory
        /// (or the per-line/COGS account), Cr Input tax. Migration-created notes
        /// (IsMigrated) post nothing — their effect is already in opening
        /// balances.</summary>
        Task PostPurchaseDebitNoteAsync(PurchaseDebitNote note);

        /// <summary>Inter-account transfer: Dr receiving, Cr paying account.</summary>
        Task PostTransferAsync(AccountTransfer transfer);

        /// <summary>GD costing consignment: Dr Inventory, Dr Input tax (sales
        /// tax + AST + Others), Dr Advance income tax on imports, Cr Import
        /// Clearing for the balancing total. Dated the GD's own date, not
        /// today. The CALLER decides whether to invoke this at all — only a
        /// New Arrivals commit should; a Backfill commit must post nothing, so
        /// the GD costing import service never calls this for one.
        ///
        /// The Inventory leg sums EVERY costed line (CostOnly and StockPosted
        /// alike) — never disposition alone. Under New Arrivals (the only mode
        /// that ever reaches this method) a CostOnly line is exactly where new
        /// quantity, cost and selling value are ADDED onto an existing balance,
        /// so its landed cost belongs in Inventory the same as a brand-new
        /// StockPosted line's does. Backfill would have been different: there,
        /// a CostOnly line only RE-PRICES stock already on the books, with no
        /// new quantity or value to account for — which is exactly why a
        /// Backfill commit posts no journal entry at all, rather than this
        /// method excluding CostOnly lines from the debit itself. Skipped/
        /// Ambiguous lines contribute nothing to any leg — no cost was ever
        /// attributed to them.
        ///
        /// Task 23: also stamps <see cref="ImportConsignment.ImportClearingCredited"/>
        /// with the balancing total (0 when nothing posts) and saves it — the
        /// subledger's settlement cap, so it must be right whether or not an
        /// entry follows.</summary>
        Task PostImportConsignmentAsync(ImportConsignment consignment);

        /// <summary>
        /// Rewrites the monthly stock-relief entries (Dr Cost of goods sold /
        /// Dr-Cr Inventory adjustments / Cr Inventory) from
        /// <paramref name="changedFrom"/>'s month to the latest, or the whole
        /// history when it is null.
        ///
        /// Always reposts every LATER month too: weighted average is
        /// path-dependent, so a movement changing in March changes the cost of
        /// every sale after it.
        /// </summary>
        Task PostInventoryPeriodsAsync(int companyId, DateTime? changedFrom = null);

        /// <summary>
        /// Moves the Inventory control account's OPENING balance by
        /// <paramref name="delta"/>, offsetting to Retained earnings.
        ///
        /// Every path that creates or changes opening stock calls this — the
        /// stock-sheet import, the GD costing import and the manual
        /// opening-balance endpoint. Opening stock is a POSITION, not a
        /// movement, so it belongs on the opening figure rather than in a
        /// journal entry.
        /// </summary>
        Task AdjustInventoryOpeningAsync(int companyId, decimal delta);

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
