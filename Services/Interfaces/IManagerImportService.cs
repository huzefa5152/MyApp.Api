using System.Text.Json;
using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Loads an exported Manager.io business (the JSON produced by
    /// scripts/techvologix_export.py + pull_details.py) into a MyApp company.
    /// Runs entirely through EF against the app's own DbContext, so the SAME
    /// code path works locally and on the live server (where the DB is only
    /// reachable from inside the app). Idempotent per ExternalRef; supports a
    /// dry-run (transaction rollback) and a --fresh wipe-and-reload.
    /// </summary>
    public interface IManagerImportService
    {
        /// <param name="summaryDocs">entity → parsed summary list JSON (e.g. "sales-invoices").</param>
        /// <param name="detailDocs">entity → parsed detail (-form) list JSON.</param>
        /// <param name="companyName">Target company (created if it doesn't exist).</param>
        /// <param name="dryRun">Run in a transaction and roll back (validate only).</param>
        /// <param name="fresh">If the company already has imported data, wipe it first.</param>
        /// <param name="callerUserId">Granted access to the (isolated) company; null = none.</param>
        /// <param name="companyId">Target an EXISTING company (must exist). When
        /// null, the company is found-or-created by <paramref name="companyName"/>.</param>
        Task<ManagerImportReport> RunAsync(
            IReadOnlyDictionary<string, JsonDocument> summaryDocs,
            IReadOnlyDictionary<string, JsonDocument> detailDocs,
            string? companyName, int? companyId, bool dryRun, bool fresh, int? callerUserId,
            IReadOnlyDictionary<string, byte[]>? attachmentBytes = null,
            string? attachmentsRoot = null);

        /// <summary>
        /// Load an exported Manager Trial Balance (tab-separated text) into the
        /// company's chart of accounts as opening balances — one account per TB
        /// line under an Assets/Liabilities/Equity/Income/Expenses group, so the
        /// CoA / balance-sheet / P&L match Manager. Balances render via
        /// GetAccountBalancesAsync (opening balance + posting movement), so the
        /// GL posting engine can stay off and the imported documents (which have
        /// no postings) don't double-count. Replaces any existing CoA for the
        /// company (idempotent). dryRun rolls back.
        ///
        /// When <paramref name="summaryDocs"/> carries Manager's
        /// "bank-and-cash-accounts" list, the single rolled-up cash line in the
        /// trial balance ("Cash &amp; cash equivalents") is replaced by the
        /// individual bank/cash accounts, each flagged <c>ControlType.BankCash</c>
        /// so the receipt/payment "Received in" dropdown is populated. The 13
        /// balances sum to the roll-up, so total assets are unchanged.
        /// </summary>
        Task<ManagerImportReport> ImportTrialBalanceAsync(
            int companyId, string trialBalanceText, bool dryRun,
            IReadOnlyDictionary<string, JsonDocument>? summaryDocs = null);

        /// <summary>Parse-only preview of a Trial Balance (no DB writes): returns
        /// the account count + the balance-sheet / P&L reconciliation. Used for a
        /// dry-run, where the document import rolls back and there's no company to
        /// load into yet.</summary>
        ManagerImportReport PreviewTrialBalance(string trialBalanceText);

        /// <summary>
        /// Perpetual-GL migration (the perpetual-GL migration design): rebuild the
        /// company's chart of accounts keyed by Manager GUID with control types +
        /// STARTING balances, and post every historical document as a faithful
        /// balanced journal entry (ManualJournal) so each account carries a
        /// Manager-style ledger and the balance sheet / P&amp;L reconcile.
        /// <paramref name="refDocs"/> = chart-of-accounts + starting-balance lists +
        /// resolved tax codes / non-inventory items. Replaces the company's CoA+GL.
        /// </summary>
        Task<ManagerImportReport> BuildPerpetualGlAsync(
            int companyId, string trialBalanceText,
            IReadOnlyDictionary<string, JsonDocument> summaryDocs,
            IReadOnlyDictionary<string, JsonDocument> detailDocs,
            IReadOnlyDictionary<string, JsonDocument> refDocs,
            bool dryRun);
    }
}
