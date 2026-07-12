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
            string? companyName, int? companyId, bool dryRun, bool fresh, int? callerUserId);

        /// <summary>
        /// Load an exported Manager Trial Balance (tab-separated text) into the
        /// company's chart of accounts as opening balances — one account per TB
        /// line under an Assets/Liabilities/Equity/Income/Expenses group, so the
        /// CoA / balance-sheet / P&L match Manager. Balances render via
        /// GetAccountBalancesAsync (opening balance + posting movement), so the
        /// GL posting engine can stay off and the imported documents (which have
        /// no postings) don't double-count. Replaces any existing CoA for the
        /// company (idempotent). dryRun rolls back.
        /// </summary>
        Task<ManagerImportReport> ImportTrialBalanceAsync(int companyId, string trialBalanceText, bool dryRun);

        /// <summary>Parse-only preview of a Trial Balance (no DB writes): returns
        /// the account count + the balance-sheet / P&L reconciliation. Used for a
        /// dry-run, where the document import rolls back and there's no company to
        /// load into yet.</summary>
        ManagerImportReport PreviewTrialBalance(string trialBalanceText);
    }
}
