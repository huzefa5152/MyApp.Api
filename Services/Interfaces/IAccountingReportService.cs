using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The accounting reports. Every one of them reads the LEDGER — journal
    /// lines, or a primitive on <see cref="IGeneralLedgerService"/> — and none
    /// grows an accounting calculation of its own.
    ///
    /// That rule is what makes the reports checkable against each other: the
    /// expense report's total has to equal the trial balance's expense movement,
    /// the cash book's closing has to equal the chart's balance for that
    /// account, and the dashboard's figures have to equal the reports they
    /// summarise. A reporting bug shows up as a plausible wrong number rather
    /// than a crash, so agreement between two engines is the only thing that
    /// catches it.
    ///
    /// The one deliberate exception is <see cref="GetTaxControlAsync"/>, which
    /// reports the ledger figure BESIDE the same figure re-derived from the
    /// documents — precisely so a disagreement is visible.
    ///
    /// All methods are company-scoped; controllers assert tenant access first.
    /// </summary>
    public interface IAccountingReportService
    {
        Task<BalanceSheetDto> GetBalanceSheetAsync(int companyId, DateTime? asOf);
        Task<ProfitAndLossDto> GetProfitAndLossAsync(int companyId, DateTime? from, DateTime? to);

        /// <summary>One client's or supplier's movement on their control
        /// account, with a running balance. Null when the party does not belong
        /// to the company.</summary>
        Task<PartyLedgerDto?> GetPartyLedgerAsync(int companyId, string partyType, int partyId,
            DateTime? from, DateTime? to);

        Task<AgedReportDto> GetAgedReceivablesAsync(int companyId, DateTime? asOf);
        Task<AgedReportDto> GetAgedPayablesAsync(int companyId, DateTime? asOf);

        Task<CashBookDto> GetCashBookAsync(int companyId, DateTime? from, DateTime? to);
        Task<ExpenseReportDto> GetExpenseReportAsync(int companyId, DateTime? from, DateTime? to);
        Task<TaxControlDto> GetTaxControlAsync(int companyId, DateTime? from, DateTime? to);
        Task<AccountingDashboardDto> GetDashboardAsync(int companyId, DateTime? from, DateTime? to);
    }
}
